"""
be/finance/services/statements_service.py
Service layer for Bank Statement Imports, preview parsing, validation,
template management, and review-driven reconciliation.
"""
import os
import uuid
from typing import List, Optional, Dict, Any
from fastapi import UploadFile, HTTPException, status

from finance.repositories.statements_repository import StatementsRepository
from finance.models import (
    BankStatementImportDB,
    StatementLineDB,
    StatementMappingTemplateDB,
    FinanceAttachmentDB,
)
from finance.schemas import (
    StatementImportResponse,
    StatementLineResponse,
    StatementLineResolveRequest,
    FinanceAttachmentResponse,
    CSVColumnMapping,
    StatementPreviewResponse,
    StatementValidationSummary,
    StatementValidationErrorItem,
    StatementLinePreviewItem,
    StatementMappingTemplateCreate,
    StatementMappingTemplateResponse,
    ReconciliationWorkspaceSummary,
)
from finance.services.statement_parsers import (
    CSVStatementParser,
    PDFStatementParser,
    compute_file_fingerprint,
)

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
            file_fingerprint=imp.file_fingerprint,
            opening_balance=imp.opening_balance,
            closing_balance=imp.closing_balance,
            encoding=imp.encoding or "utf-8",
            date_format=imp.date_format or "auto",
            decimal_separator=imp.decimal_separator or ".",
            review_state=imp.review_state or "needs_review",
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

        child_responses = []
        for ch in getattr(line, "child_lines", []) or []:
            child_responses.append(
                StatementLineResponse(
                    id=ch.id,
                    import_id=ch.import_id,
                    raw_date=ch.raw_date,
                    raw_amount=ch.raw_amount,
                    direction=ch.direction,
                    raw_description=ch.raw_description,
                    raw_reference=ch.raw_reference or "",
                    status=ch.status,
                    notes=ch.notes or "",
                    matched_transaction_id=ch.matched_transaction_id,
                    matched_cheque_id=ch.matched_cheque_id,
                    parent_line_id=ch.parent_line_id,
                    created_at=ch.created_at,
                    suggested_matches=[],
                    child_lines=[],
                )
            )

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
            parent_line_id=line.parent_line_id,
            created_at=line.created_at,
            suggested_matches=suggestions,
            child_lines=child_responses,
        )

    async def preview_statement(
        self,
        account_id: int,
        period_month: str,
        file: UploadFile,
        mapping: Optional[CSVColumnMapping] = None,
        encoding: str = "utf-8",
        date_format: str = "auto",
        decimal_separator: str = ".",
        opening_balance: Optional[float] = None,
        closing_balance: Optional[float] = None,
    ) -> StatementPreviewResponse:
        """
        Parse and validate statement rows entirely in memory.
        No database commits occur before validation confirmation.
        """
        content = await file.read()
        if not content:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

        filename = file.filename or "statement.csv"
        ext = os.path.splitext(filename)[1].lower().lstrip(".")
        detected_format = "pdf" if ext == "pdf" else "csv"

        # 1. Compute file fingerprint
        file_fp = compute_file_fingerprint(content)

        # 2. Check duplicate file on this account
        existing_dup = self.repo.find_import_by_fingerprint(account_id, file_fp)
        dup_file_detected = existing_dup is not None
        dup_import_id = existing_dup.id if existing_dup else None

        # 3. Parse rows
        map_dict = mapping.dict(exclude_unset=True) if mapping else None
        if detected_format == "csv":
            parsed_lines, errors, detected_headers, suggested = CSVStatementParser.parse_with_validation(
                content,
                mapping=map_dict,
                encoding=encoding,
                date_format=date_format,
                decimal_separator=decimal_separator,
            )
            is_review_required = False
        else:
            parsed_lines, errors, detected_headers, suggested = PDFStatementParser.parse_with_validation(content)
            is_review_required = True  # PDF extractions are always review-required

        # 4. Check for existing line fingerprints in DB for this account
        line_fps = [l["line_fingerprint"] for l in parsed_lines if l.get("line_fingerprint")]
        existing_fps = self.repo.find_existing_line_fingerprints(account_id, line_fps)

        duplicate_lines_count = 0
        preview_items: List[StatementLinePreviewItem] = []
        total_debit = 0.0
        total_credit = 0.0

        for row in parsed_lines:
            is_dup = row.get("is_duplicate", False) or (row.get("line_fingerprint") in existing_fps)
            if is_dup:
                duplicate_lines_count += 1

            amt = float(row["raw_amount"])
            if row["direction"] == "in":
                total_credit += amt
            else:
                total_debit += amt

            preview_items.append(
                StatementLinePreviewItem(
                    row_index=row.get("row_index", 0),
                    raw_date=row["raw_date"],
                    raw_amount=amt,
                    direction=row["direction"],
                    raw_description=row["raw_description"],
                    raw_reference=row.get("raw_reference", ""),
                    line_fingerprint=row["line_fingerprint"],
                    is_duplicate=is_dup,
                    is_valid=True,
                )
            )

        # 5. Balance summary calculation
        total_debit = round(total_debit, 2)
        total_credit = round(total_credit, 2)
        calculated_net = round(total_credit - total_debit, 2)

        expected_closing = None
        balance_delta = None
        balance_matches = False
        if opening_balance is not None and closing_balance is not None:
            expected_closing = round(opening_balance + calculated_net, 2)
            balance_delta = round(closing_balance - expected_closing, 2)
            balance_matches = abs(balance_delta) < 0.01

        validation_summary = StatementValidationSummary(
            total_rows=len(parsed_lines) + len(errors),
            valid_count=len(parsed_lines),
            error_count=len(errors),
            warning_count=duplicate_lines_count,
            duplicate_lines_count=duplicate_lines_count,
            opening_balance=opening_balance,
            closing_balance=closing_balance,
            total_debit=total_debit,
            total_credit=total_credit,
            calculated_net=calculated_net,
            expected_closing_balance=expected_closing,
            balance_delta=balance_delta,
            balance_matches=balance_matches,
        )

        error_items = [
            StatementValidationErrorItem(
                row_index=e.get("row_index", 0),
                column=e.get("column", ""),
                value=e.get("value", ""),
                message=e.get("message", ""),
                correction_path=e.get("correction_path", ""),
            )
            for e in errors
        ]

        suggested_obj = CSVColumnMapping(**suggested) if suggested else None

        return StatementPreviewResponse(
            file_fingerprint=file_fp,
            duplicate_file_detected=dup_file_detected,
            duplicate_import_id=dup_import_id,
            detected_format=detected_format,
            detected_headers=detected_headers,
            suggested_mapping=suggested_obj,
            preview_rows=preview_items[:30],  # Preview first 30 rows
            validation_summary=validation_summary,
            errors=error_items,
            is_review_required=is_review_required,
        )

    async def upload_and_parse_statement(
        self,
        account_id: int,
        period_month: str,
        file: UploadFile,
        mapping: Optional[CSVColumnMapping] = None,
        opening_balance: Optional[float] = None,
        closing_balance: Optional[float] = None,
        encoding: str = "utf-8",
        date_format: str = "auto",
        decimal_separator: str = ".",
        allow_duplicate: bool = False,
        review_state: str = "needs_review",
        created_by: Optional[str] = None,
    ) -> StatementImportResponse:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file is empty")

        filename = file.filename or "statement.csv"
        ext = os.path.splitext(filename)[1].lower().lstrip(".")
        file_type = "pdf" if ext == "pdf" else "csv"

        # Duplicate file detection
        file_fp = compute_file_fingerprint(content)
        existing_dup = self.repo.find_import_by_fingerprint(account_id, file_fp)
        if existing_dup and not allow_duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"This exact statement file was already imported on {existing_dup.created_at.strftime('%Y-%m-%d')} (Import #{existing_dup.id}). Set allow_duplicate=true to re-import.",
            )

        # Save to private uploads/finance_attachments/
        os.makedirs(UPLOAD_DIR, exist_ok=True)
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
            file_fingerprint=file_fp,
            opening_balance=opening_balance,
            closing_balance=closing_balance,
            encoding=encoding,
            date_format=date_format,
            decimal_separator=decimal_separator,
            review_state="needs_review" if file_type == "pdf" else review_state,
            created_by=created_by,
        )

        # Create FinanceAttachmentDB
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
        map_dict = mapping.dict(exclude_unset=True) if mapping else None
        if file_type == "csv":
            parsed_lines, _, _, _ = CSVStatementParser.parse_with_validation(
                content,
                mapping=map_dict,
                encoding=encoding,
                date_format=date_format,
                decimal_separator=decimal_separator,
            )
        elif file_type == "pdf":
            parsed_lines, _, _, _ = PDFStatementParser.parse_with_validation(content)

        if parsed_lines:
            self.repo.add_statement_lines(stmt_import.id, parsed_lines)

        self.repo.db.refresh(stmt_import)
        return self._import_to_response(stmt_import)

    def discard_statement(self, import_id: int) -> Dict[str, Any]:
        try:
            success = self.repo.delete_import(import_id)
            if not success:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Statement import not found")
            return {"status": "discarded", "id": import_id}
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

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

        splits_data = [s.dict() for s in req.splits] if req.splits else None
        try:
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
                splits=splits_data,
                created_by=user_email,
            )
        except ValueError as ex:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ex))

        return self._line_to_response(resolved, line.statement_import.account_id)

    def get_reconciliation_workspace_summary(self, import_id: int) -> ReconciliationWorkspaceSummary:
        imp = self.repo.get_import_by_id(import_id)
        if not imp:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Statement import not found")

        account = imp.account
        currency = account.currency if account else "USD"
        book_balance = round(account.current_balance, 2) if account else 0.0

        all_lines = self.repo.get_statement_lines(import_id)
        # Exclude parent lines that have been split into child portions
        active_lines = [l for l in all_lines if l.status != "split"]

        resolved_lines = [l for l in active_lines if l.status in ("matched", "created", "ignored")]
        unmatched_lines = [l for l in active_lines if l.status == "unmatched"]

        resolved_amount = round(sum(l.raw_amount for l in resolved_lines), 2)
        unresolved_amount = round(sum(l.raw_amount for l in unmatched_lines), 2)

        difference = None
        if imp.closing_balance is not None:
            difference = round(imp.closing_balance - book_balance, 2)

        return ReconciliationWorkspaceSummary(
            statement_id=imp.id,
            account_id=imp.account_id,
            account_name=account.account_name if account else f"Account #{imp.account_id}",
            currency=currency,
            period_month=imp.period_month,
            statement_opening_balance=imp.opening_balance,
            statement_closing_balance=imp.closing_balance,
            book_balance=book_balance,
            difference=difference,
            total_lines_count=len(active_lines),
            resolved_lines_count=len(resolved_lines),
            unmatched_lines_count=len(unmatched_lines),
            resolved_amount=resolved_amount,
            unresolved_amount=unresolved_amount,
            status=imp.status,
        )

    def reconcile_statement(self, import_id: int, user_email: Optional[str] = None) -> StatementImportResponse:
        imp = self.repo.get_import_by_id(import_id)
        if not imp:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Statement import not found")

        if imp.status == "reconciled":
            return self._import_to_response(imp)

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

    # Template service methods
    def create_template(self, req: StatementMappingTemplateCreate) -> StatementMappingTemplateResponse:
        tmpl = self.repo.create_template(
            template_name=req.template_name,
            bank_name=req.bank_name,
            account_id=req.account_id,
            date_col=req.date_col,
            description_col=req.description_col,
            debit_col=req.debit_col,
            credit_col=req.credit_col,
            amount_col=req.amount_col,
            reference_col=req.reference_col,
            date_format=req.date_format,
            decimal_separator=req.decimal_separator,
            encoding=req.encoding,
        )
        return StatementMappingTemplateResponse.from_orm(tmpl)

    def list_templates(self, account_id: Optional[int] = None) -> List[StatementMappingTemplateResponse]:
        templates = self.repo.list_templates(account_id=account_id)
        return [StatementMappingTemplateResponse.from_orm(t) for t in templates]

    def delete_template(self, template_id: int) -> Dict[str, Any]:
        success = self.repo.delete_template(template_id)
        if not success:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Template not found")
        return {"status": "deleted", "id": template_id}
