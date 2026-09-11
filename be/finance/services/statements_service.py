"""
be/finance/services/statements_service.py
Service layer for Bank Statement Imports, parsing, and review-driven reconciliation.
"""
import os
import uuid
from typing import List, Optional, Dict, Any
from fastapi import UploadFile, HTTPException, status

from finance.repositories.statements_repository import StatementsRepository
from finance.models import BankStatementImportDB, StatementLineDB
from finance.schemas import (
    StatementImportResponse,
    StatementLineResponse,
    StatementLineResolveRequest,
    FinanceAttachmentResponse,
    CSVColumnMapping,
)
from finance.services.statement_parsers import CSVStatementParser, PDFStatementParser

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads", "finance_attachments")


class StatementsService:
    def __init__(self, repo: StatementsRepository):
        self.repo = repo
        os.makedirs(UPLOAD_DIR, exist_ok=True)

    def _import_to_response(self, imp: BankStatementImportDB) -> StatementImportResponse:
        attachments_resp: List[FinanceAttachmentResponse] = []
        for att in getattr(imp, "attachments", []) or []:
            attachments_resp.append(
                FinanceAttachmentResponse(
                    id=att.id,
                    file_name=att.file_name,
                    file_size=att.file_size,
                    mime_type=att.mime_type,
                    storage_ref=att.storage_ref,
                    uploaded_at=att.uploaded_at,
                    uploaded_by=att.uploaded_by,
                )
            )

        account_name = imp.account.account_name if imp.account else None
        matched_count = (
            self.repo.db.query(StatementLineDB)
            .filter(
                StatementLineDB.import_id == imp.id,
                StatementLineDB.status.in_(["matched", "created", "ignored"]),
            )
            .count()
        )

        return StatementImportResponse(
            id=imp.id,
            account_id=imp.account_id,
            account_name=account_name,
            period_month=imp.period_month,
            file_type=imp.file_type,
            status=imp.status,
            uploaded_file_ref=imp.uploaded_file_ref,
            total_lines_count=imp.total_lines_count,
            matched_lines_count=matched_count,
            reconciled_at=imp.reconciled_at,
            reconciled_by=imp.reconciled_by,
            created_at=imp.created_at,
            created_by=imp.created_by,
            attachments=attachments_resp,
        )

    def _line_to_response(self, line: StatementLineDB, account_id: int) -> StatementLineResponse:
        suggestions = []
        if line.status == "unmatched":
            suggestions = self.repo.find_suggested_matches(account_id, line)

        return StatementLineResponse(
            id=line.id,
            import_id=line.import_id,
            raw_date=line.raw_date,
            raw_amount=line.raw_amount,
            direction=line.direction,
            raw_description=line.raw_description,
            raw_reference=line.raw_reference or "",
            status=line.status,
            notes=line.notes or "",
            matched_transaction_id=line.matched_transaction_id,
            matched_cheque_id=line.matched_cheque_id,
            created_at=line.created_at,
            suggested_matches=suggestions,
        )

    async def upload_and_parse_statement(
        self,
        account_id: int,
        period_month: str,
        file: UploadFile,
        mapping: Optional[CSVColumnMapping] = None,
        created_by: Optional[str] = None,
    ) -> StatementImportResponse:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

        filename = file.filename or "statement.csv"
        ext = os.path.splitext(filename)[1].lower().lstrip(".")
        file_type = "pdf" if ext == "pdf" else "csv"

        # Save to private uploads/finance_attachments/
        unique_name = f"stmt_{uuid.uuid4().hex[:12]}_{filename}"
        disk_path = os.path.join(UPLOAD_DIR, unique_name)
        with open(disk_path, "wb") as f:
            f.write(content)

        # Create BankStatementImportDB
        stmt_import = self.repo.create_import(
            account_id=account_id,
            period_month=period_month,
            file_type=file_type,
            uploaded_file_ref=disk_path,
            created_by=created_by,
        )

        # Create FinanceAttachmentDB
        from finance.models import FinanceAttachmentDB
        att = FinanceAttachmentDB(
            statement_import_id=stmt_import.id,
            file_name=filename,
            file_size=len(content),
            mime_type=file.content_type or "application/octet-stream",
            storage_ref=disk_path,
            uploaded_by=created_by,
        )
        self.repo.db.add(att)
        self.repo.db.commit()

        # Parse lines
        parsed_lines: List[Dict[str, Any]] = []
        if file_type == "csv":
            map_dict = mapping.dict(exclude_unset=True) if mapping else None
            parsed_lines = CSVStatementParser.parse(content, mapping=map_dict)
        elif file_type == "pdf":
            parsed_lines = PDFStatementParser.parse(content)

        if parsed_lines:
            self.repo.add_statement_lines(stmt_import.id, parsed_lines)

        self.repo.db.refresh(stmt_import)
        return self._import_to_response(stmt_import)

    def list_statements(
        self, account_id: Optional[int] = None, period_month: Optional[str] = None
    ) -> List[StatementImportResponse]:
        imports = self.repo.list_imports(account_id=account_id, period_month=period_month)
        return [self._import_to_response(imp) for imp in imports]

    def get_statement(self, import_id: int) -> StatementImportResponse:
        imp = self.repo.get_import_by_id(import_id)
        if not imp:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Statement import not found")
        return self._import_to_response(imp)

    def get_statement_lines(self, import_id: int) -> List[StatementLineResponse]:
        imp = self.repo.get_import_by_id(import_id)
        if not imp:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Statement import not found")

        lines = self.repo.get_statement_lines(import_id)
        return [self._line_to_response(line, imp.account_id) for line in lines]

    def resolve_statement_line(
        self, import_id: int, line_id: int, req: StatementLineResolveRequest, user_email: Optional[str] = None
    ) -> StatementLineResponse:
        line = self.repo.get_line_by_id(line_id)
        if not line or line.import_id != import_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Statement line not found")

        if line.statement_import.status == "reconciled":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot modify lines of an already reconciled statement",
            )

        resolved = self.repo.resolve_line(
            line=line,
            action=req.action,
            matched_transaction_id=req.matched_transaction_id,
            matched_cheque_id=req.matched_cheque_id,
            category_id=req.category_id,
            payment_type_id=req.payment_type_id,
            description=req.description,
            reference=req.reference,
            notes=req.notes,
            created_by=user_email,
        )
        return self._line_to_response(resolved, line.statement_import.account_id)

    def reconcile_statement(self, import_id: int, user_email: Optional[str] = None) -> StatementImportResponse:
        imp = self.repo.get_import_by_id(import_id)
        if not imp:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Statement import not found")

        if imp.status == "reconciled":
            return self._import_to_response(imp)

        # Check if any lines are still unmatched
        unmatched_count = (
            self.repo.db.query(StatementLineDB)
            .filter(StatementLineDB.import_id == import_id, StatementLineDB.status == "unmatched")
            .count()
        )
        if unmatched_count > 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot reconcile: {unmatched_count} statement line(s) remain unmatched or unresolved.",
            )

        reconciled = self.repo.reconcile_import(import_id, user_email=user_email)
        return self._import_to_response(reconciled)
