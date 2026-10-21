import os
import uuid
from typing import List, Optional, Tuple
from datetime import datetime
from fastapi import HTTPException, status, UploadFile

from finance.repositories.cheques_repository import ChequesRepository, VALID_STATUS_TRANSITIONS, EXCEPTION_STATUSES
from finance.schemas import (
    ChequeCreate,
    ChequeStatusUpdate,
    ChequeReplaceRequest,
    ChequeResponse,
    ChequeAttachmentResponse,
    NextChequeNumberResponse,
)
from finance.bill_payment_rules import BillPaymentError
from finance.models import FinanceChequeDB, FinanceBankAccountDB, BillDB, FinanceAttachmentDB
from finance.services.subscriptions_service import FINANCE_UPLOADS_DIR
import file_layout

MAX_SCAN_BYTES = 15 * 1024 * 1024


VALID_PURPOSE_TYPES = {"vendor_payment", "cash_withdrawal", "other"}
VALID_CHEQUE_STATUSES = {
    "draft",
    "issued",
    "outstanding",
    "cleared",
    "bounced",
    "stopped",
    "voided",
    "replaced",
}


class ChequesService:
    def __init__(self, repo: ChequesRepository):
        self.repo = repo

    def _cheque_to_response(self, cheque: FinanceChequeDB) -> ChequeResponse:
        account_name = cheque.account.account_name if cheque.account else None
        dest_cash_name = (
            cheque.destination_cash_account.account_name
            if cheque.destination_cash_account
            else None
        )

        # Calculate stale-date check (standard bank validity is 180 days)
        is_stale = False
        stale_warning = None
        try:
            issue_dt = datetime.strptime(cheque.issue_date, "%Y-%m-%d").date()
            today = datetime.utcnow().date()
            diff_days = (today - issue_dt).days
            if diff_days > 180 and cheque.status in ("draft", "issued", "outstanding"):
                is_stale = True
                stale_warning = f"Cheque is stale-dated ({diff_days} days old, exceeding standard 180-day validity)."
        except Exception:
            pass

        return ChequeResponse(
            id=cheque.id,
            cheque_number=cheque.cheque_number,
            account_id=cheque.account_id,
            account_name=account_name,
            issue_date=cheque.issue_date,
            amount=cheque.amount,
            currency=cheque.currency,
            payee=cheque.payee,
            purpose_type=cheque.purpose_type,
            destination_cash_account_id=cheque.destination_cash_account_id,
            destination_cash_account_name=dest_cash_name,
            linked_bill_id=cheque.linked_bill_id,
            status=cheque.status,
            posting_policy=cheque.posting_policy or "at_issue",
            signer_name=cheque.signer_name,
            authorized_by=cheque.authorized_by,
            attachment_url=cheque.attachment_url,
            attachment_count=len(cheque.attachments or []),
            has_scan=bool(cheque.attachments),
            exception_reason=cheque.exception_reason,
            exception_evidence=cheque.exception_evidence,
            replacement_cheque_id=cheque.replacement_cheque_id,
            replaced_cheque_id=cheque.replaced_cheque_id,
            is_stale=is_stale,
            stale_warning=stale_warning,
            clear_date=cheque.clear_date,
            fiscal_year=cheque.fiscal_year,
            linked_transaction_id=cheque.linked_transaction_id,
            linked_cash_transaction_id=cheque.linked_cash_transaction_id,
            notes=cheque.notes or "",
            created_at=cheque.created_at,
            created_by=cheque.created_by,
        )

    def list_cheques(
        self,
        fiscal_year: Optional[int] = None,
        status: Optional[str] = None,
        account_id: Optional[int] = None,
        payee: Optional[str] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        has_scan: Optional[bool] = None,
    ) -> List[ChequeResponse]:
        if status and status not in VALID_CHEQUE_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{status}'. Must be one of: {', '.join(sorted(VALID_CHEQUE_STATUSES))}",
            )
        cheques = self.repo.list_cheques(
            fiscal_year=fiscal_year,
            status=status,
            account_id=account_id,
            payee=payee,
            search=search,
            limit=limit,
            offset=offset,
            has_scan=has_scan,
        )
        return [self._cheque_to_response(c) for c in cheques]

    def get_cheque(self, cheque_id: int) -> ChequeResponse:
        cheque = self.repo.get_by_id(cheque_id)
        if not cheque:
            raise HTTPException(status_code=404, detail=f"Cheque {cheque_id} not found")
        return self._cheque_to_response(cheque)

    def issue_cheque(
        self, payload: ChequeCreate, created_by: Optional[str] = None, import_batch_id: Optional[int] = None
    ) -> ChequeResponse:
        # Validate purpose type
        if payload.purpose_type not in VALID_PURPOSE_TYPES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid purpose_type '{payload.purpose_type}'. Must be one of: {', '.join(sorted(VALID_PURPOSE_TYPES))}",
            )

        # Validate source bank account
        bank_acc = self.repo.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == payload.account_id).first()
        if not bank_acc:
            raise HTTPException(status_code=404, detail=f"Source bank account {payload.account_id} not found")
        if not bank_acc.is_active:
            raise HTTPException(status_code=400, detail=f"Bank account '{bank_acc.account_name}' is inactive")
        if bank_acc.account_type != "bank":
            raise HTTPException(
                status_code=400,
                detail=f"Cheques must be drawn from a bank account, but '{bank_acc.account_name}' is an account of type '{bank_acc.account_type}'",
            )

        # Validate cash withdrawal destination account
        if payload.purpose_type == "cash_withdrawal":
            if not payload.destination_cash_account_id:
                raise HTTPException(
                    status_code=400,
                    detail="destination_cash_account_id is required when purpose_type is 'cash_withdrawal'",
                )
            cash_acc = (
                self.repo.db.query(FinanceBankAccountDB)
                .filter(FinanceBankAccountDB.id == payload.destination_cash_account_id)
                .first()
            )
            if not cash_acc:
                raise HTTPException(
                    status_code=404,
                    detail=f"Destination cash account {payload.destination_cash_account_id} not found",
                )
            if not cash_acc.is_active:
                raise HTTPException(status_code=400, detail=f"Destination cash account '{cash_acc.account_name}' is inactive")
            if cash_acc.account_type != "cash":
                raise HTTPException(
                    status_code=400,
                    detail=f"Destination account '{cash_acc.account_name}' must be of account_type 'cash', not '{cash_acc.account_type}'",
                )
            # D-020: a cash withdrawal funds a cash account in the same currency as the bank account
            if (cash_acc.currency or "").upper() != (bank_acc.currency or "").upper():
                raise HTTPException(
                    status_code=400,
                    detail={
                        "code": "currency_mismatch",
                        "message": f"A cash withdrawal must go to a cash account in the same currency: '{cash_acc.account_name}' is {cash_acc.currency}, the bank account is {bank_acc.currency}.",
                    },
                )

        # Validate linked bill if present
        if payload.linked_bill_id:
            bill = self.repo.db.query(BillDB).filter(BillDB.id == payload.linked_bill_id).first()
            if not bill:
                raise HTTPException(status_code=404, detail=f"Linked bill {payload.linked_bill_id} not found")

        # Check unique cheque number for this account
        existing = self.repo.get_by_account_and_number(payload.account_id, payload.cheque_number)
        if existing:
            raise HTTPException(
                status_code=400,
                detail=f"Cheque number '{payload.cheque_number}' has already been issued for account '{bank_acc.account_name}'",
            )

        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        if import_batch_id is not None:
            data["import_batch_id"] = import_batch_id  # set by the bulk importer only (D-033)
        try:
            cheque = self.repo.create_cheque(data, created_by=created_by)
        except BillPaymentError as e:
            self.repo.db.rollback()
            raise HTTPException(status_code=400, detail=e.detail())
        except ValueError as e:
            self.repo.db.rollback()
            raise HTTPException(status_code=400, detail=str(e))

        return self._cheque_to_response(cheque)

    def update_cheque_status(
        self, cheque_id: int, payload: ChequeStatusUpdate
    ) -> ChequeResponse:
        cheque = self.repo.get_by_id(cheque_id)
        if not cheque:
            raise HTTPException(status_code=404, detail=f"Cheque {cheque_id} not found")

        if payload.status not in VALID_CHEQUE_STATUSES:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status '{payload.status}'. Must be one of: {', '.join(sorted(VALID_CHEQUE_STATUSES))}",
            )

        try:
            updated = self.repo.update_status(
                cheque_id=cheque_id,
                status=payload.status,
                clear_date=payload.clear_date,
                reason=payload.reason,
                evidence=payload.evidence,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        return self._cheque_to_response(updated)

    def replace_cheque(
        self, cheque_id: int, payload: ChequeReplaceRequest, created_by: Optional[str] = None
    ) -> ChequeResponse:
        try:
            new_cheque = self.repo.replace_cheque(
                cheque_id=cheque_id,
                new_cheque_number=payload.new_cheque_number,
                new_issue_date=payload.new_issue_date,
                reason=payload.reason,
                evidence=payload.evidence,
                signer_name=payload.signer_name,
                notes=payload.notes,
                created_by=created_by,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        return self._cheque_to_response(new_cheque)

    # ------------------------------------------------------------------
    # Scans (D-032)
    # ------------------------------------------------------------------
    @staticmethod
    def _att_to_response(att: FinanceAttachmentDB) -> ChequeAttachmentResponse:
        return ChequeAttachmentResponse(
            id=att.id,
            cheque_id=att.cheque_id,
            file_name=att.file_name,
            file_size=att.file_size or 0,
            mime_type=att.mime_type or "application/octet-stream",
            uploaded_at=att.uploaded_at,
            uploaded_by=att.uploaded_by,
        )

    def _require_cheque(self, cheque_id: int) -> FinanceChequeDB:
        cheque = self.repo.get_by_id(cheque_id)
        if not cheque:
            raise HTTPException(status_code=404, detail=f"Cheque {cheque_id} not found")
        return cheque

    async def upload_attachments(
        self, cheque_id: int, files: List[UploadFile], uploaded_by: Optional[str] = None
    ) -> List[ChequeAttachmentResponse]:
        self._require_cheque(cheque_id)
        if not files:
            raise HTTPException(status_code=400, detail="At least one file is required")
        # Validate every file before writing anything so a bad file does not leave a partial upload
        payloads = []
        for f in files:
            if not f or not f.filename:
                raise HTTPException(status_code=400, detail="A valid file is required for scan upload.")
            content = await f.read()
            if len(content) == 0:
                raise HTTPException(status_code=400, detail=f"Uploaded file '{f.filename}' cannot be empty.")
            if len(content) > MAX_SCAN_BYTES:
                raise HTTPException(status_code=413, detail=f"File '{f.filename}' exceeds the 15 MB limit.")
            payloads.append((os.path.basename(f.filename), content, f.content_type or "application/octet-stream"))

        cheque = self._require_cheque(cheque_id)
        acc = cheque.account
        account_folder = file_layout.build_account_folder(
            account_id=acc.id if acc else cheque.account_id,
            bank_name=acc.bank_name if acc else None,
            currency=acc.currency if acc else cheque.currency,
            account_name=acc.account_name if acc else None,
        )
        created = []
        for name, content, mime in payloads:
            att = self.repo.add_attachment(
                cheque_id=cheque_id,
                file_name=name,
                file_size=len(content),
                mime_type=mime,
                storage_ref="pending",
                uploaded_by=uploaded_by,
            )
            clean_ext = os.path.splitext(name)[1].lstrip(".")
            ref = file_layout.build_ref(
                "cheque",
                date=cheque.issue_date,
                account_folder=account_folder,
                cheque_number=cheque.cheque_number,
                att_id=att.id,
                ext=clean_ext,
            )
            file_layout.save_file(content, ref)
            att.storage_ref = ref
            self.repo.db.commit()
            created.append(self._att_to_response(att))
        return created

    def list_attachments(self, cheque_id: int) -> List[ChequeAttachmentResponse]:
        self._require_cheque(cheque_id)
        return [self._att_to_response(a) for a in self.repo.list_attachments(cheque_id)]

    def get_attachment_file(self, cheque_id: int, attachment_id: int) -> Tuple[str, str, str]:
        self._require_cheque(cheque_id)
        att = self.repo.get_attachment(cheque_id, attachment_id)
        if not att:
            raise HTTPException(status_code=404, detail=f"Attachment {attachment_id} not found for cheque {cheque_id}")
        try:
            file_path = file_layout.resolve_path(att.storage_ref, must_exist=True)
        except (FileNotFoundError, ValueError):
            raise HTTPException(status_code=404, detail="Attachment file not found on disk")
        return file_path, att.file_name, att.mime_type or "application/octet-stream"

    def delete_attachment(self, cheque_id: int, attachment_id: int) -> None:
        self._require_cheque(cheque_id)
        att = self.repo.get_attachment(cheque_id, attachment_id)
        if not att:
            raise HTTPException(status_code=404, detail=f"Attachment {attachment_id} not found for cheque {cheque_id}")
        if att.storage_ref:
            file_layout.delete_file(att.storage_ref)
        self.repo.delete_attachment(att)

    def suggest_next_number(self, account_id: int) -> NextChequeNumberResponse:
        acc = self.repo.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == account_id).first()
        if not acc:
            raise HTTPException(status_code=404, detail=f"Bank account {account_id} not found")
        last = self.repo.last_cheque_number(account_id)
        nxt = str(int(last) + 1).zfill(len(last)) if last else None
        return NextChequeNumberResponse(account_id=account_id, next_cheque_number=nxt, last_cheque_number=last)
