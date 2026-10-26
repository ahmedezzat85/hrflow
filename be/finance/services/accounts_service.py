"""
be/finance/services/accounts_service.py
Business logic and security rules for Company Bank Accounts.
"""
import json
from datetime import datetime
from typing import List, Optional
from fastapi import HTTPException, status

from finance.repositories.accounts_repository import AccountsRepository
import os
import uuid
from fastapi import UploadFile
from finance import books
from finance.schemas import (
    BankAccountCreate,
    BankAccountUpdate,
    BankAccountResponse,
    BalanceCheckpointCreate,
    BalanceCheckpointResponse,
    YearOpeningItem,
    YearOpeningsResponse,
    YearOpeningUpsert,
)
from finance import year_openings
from finance.repositories.ledger_repository import LedgerRepository
from models_db import AuditLogDB
from finance.models import FinanceBankAccountDB, FinanceBookDB, AccountBalanceCheckpointDB
from finance.services.subscriptions_service import FINANCE_UPLOADS_DIR
import file_layout

VALID_VISIBILITY = ("full", "partial")
MAX_CHECKPOINT_FILE_BYTES = 15 * 1024 * 1024
MIN_FISCAL_YEAR = 2000


class AccountsService:
    def __init__(self, repo: AccountsRepository):
        self.repo = repo

    @staticmethod
    def mask_account_number(raw: str) -> str:
        """Masks all but the last 4 characters of the bank account number."""
        clean = (raw or "").strip()
        if len(clean) <= 4:
            return f"******{clean}"
        return f"{'*' * (len(clean) - 4)}{clean[-4:]}"

    def to_response(self, account: FinanceBankAccountDB, reveal: bool = False) -> BankAccountResponse:
        metrics = self.repo.get_balance_metrics(account)
        account_num = account.account_number if reveal else self.mask_account_number(account.account_number)
        book = account.book
        latest = None
        if (account.visibility or "full") == "partial":
            cps = self.repo.list_checkpoints(account.id)
            if cps:
                latest = self._checkpoint_to_response(cps[0])

        return BankAccountResponse(
            id=account.id,
            book_id=account.book_id,
            book_code=book.code if book else None,
            book_name=book.name if book else None,
            visibility=account.visibility or "full",
            latest_checkpoint=latest,
            account_name=account.account_name,
            bank_name=account.bank_name,
            account_number=account_num,
            currency=account.currency,
            opening_balance=account.opening_balance,
            opening_balance_date=account.opening_balance_date,
            current_balance=account.current_balance,
            account_type=getattr(account, "account_type", "bank"),
            country=getattr(account, "country", "Egypt"),
            is_active=account.is_active,
            created_at=account.created_at,
            book_balance=metrics["book_balance"],
            bank_balance=metrics["bank_balance"],
            available_balance=metrics["available_balance"],
            reconciled_balance=metrics["reconciled_balance"],
            unreconciled_count=metrics["unreconciled_count"],
            last_reconciled_date=metrics["last_reconciled_date"],
            last_import_date=metrics["last_import_date"],
            has_postings=metrics["has_postings"],
            balance_definitions=metrics["balance_definitions"],
            balance_as_of=metrics["balance_as_of"],
        )

    def list_accounts(
        self,
        is_active: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
        book: Optional[str] = None,
    ) -> List[BankAccountResponse]:
        accounts = self.repo.list_all(is_active=is_active, limit=limit, offset=offset, book=book)
        return [self.to_response(acc) for acc in accounts]

    def get_account(self, account_id: int, reveal: bool = False) -> BankAccountResponse:
        account = self.repo.get_by_id(account_id)
        if not account:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bank account with ID {account_id} not found",
            )
        return self.to_response(account, reveal=reveal)

    def create_account(self, payload: BankAccountCreate) -> BankAccountResponse:
        existing = self.repo.get_by_name(payload.account_name)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"A bank account with name '{payload.account_name}' already exists",
            )

        data = payload.model_dump() if hasattr(payload, "model_dump") else payload.dict()
        self._validate_book_fields(data.get("book_id"), data.get("visibility"))
        account = self.repo.create(data)
        return self.to_response(account)

    def update_account(self, account_id: int, payload: BankAccountUpdate) -> BankAccountResponse:
        existing = self.repo.get_by_id(account_id)
        if not existing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bank account with ID {account_id} not found",
            )

        # Name collision check
        if payload.account_name and payload.account_name.lower() != existing.account_name.lower():
            name_clash = self.repo.get_by_name(payload.account_name)
            if name_clash and name_clash.id != account_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"A bank account with name '{payload.account_name}' already exists",
                )

        # Story 5.1 Acceptance Criteria: Prevent ordinary currency changes after postings
        if payload.currency and payload.currency.upper() != existing.currency.upper():
            if self.repo.has_transactions(account_id):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Currency cannot be modified after transactions have been posted to this account.",
                )

        data = (
            payload.model_dump(exclude_unset=True)
            if hasattr(payload, "model_dump")
            else payload.dict(exclude_unset=True)
        )
        self._validate_book_fields(data.get("book_id"), data.get("visibility"))
        # Moving an account to another book would silently rewrite the history of both books' reports
        if data.get("book_id") and data["book_id"] != existing.book_id and self.repo.has_transactions(account_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="The book cannot be changed after transactions have been posted to this account.",
            )
        updated = self.repo.update(account_id, data)
        return self.to_response(updated)

    def deactivate_account(self, account_id: int) -> BankAccountResponse:
        existing = self.repo.get_by_id(account_id)
        if not existing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bank account with ID {account_id} not found",
            )
        deactivated = self.repo.soft_delete(account_id)
        return self.to_response(deactivated)

    def compute_balance_as_of(self, account_id: int, as_of_date: Optional[str] = None) -> float:
        existing = self.repo.get_by_id(account_id)
        if not existing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bank account with ID {account_id} not found",
            )
        return self.repo.compute_balance(account_id, as_of_date=as_of_date)

    def recalculate_balance(self, account_id: int) -> float:
        existing = self.repo.get_by_id(account_id)
        if not existing:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bank account with ID {account_id} not found",
            )
        return self.repo.recalculate_and_sync_current_balance(account_id)

    # ------------------------------------------------------------------
    # Fiscal-year opening balances (BI-1, D-043)
    # ------------------------------------------------------------------
    def _year_opening_item(self, account, year: int, openings: dict, rows: dict, closed: dict) -> YearOpeningItem:
        info = year_openings.year_opening_info(self.repo.db, account, year, openings)
        row = rows.get(year)
        return YearOpeningItem(
            fiscal_year=year,
            entered=row is not None,
            opening=info["opening"],
            source=info["source"],
            previous_closing=info["previous_closing"],
            variance=info["variance"],
            note=(row.note or "") if row is not None else None,
            updated_by=row.updated_by if row is not None else None,
            updated_at=row.updated_at if row is not None else None,
            closed_reconciliation_months=closed.get(year, 0),
        )

    def list_year_openings(self, account_id: int) -> YearOpeningsResponse:
        account = self._require_account(account_id)
        rows = {r.fiscal_year: r for r in self.repo.list_year_openings(account_id)}
        openings = {y: float(r.opening_balance) for y, r in rows.items()}
        closed = self.repo.closed_reconciliation_months_by_year(account_id)
        activity = self.repo.activity_year_range(account_id)
        this_year = year_openings._today().year
        years = list(rows) + ([activity[0]] if activity else []) + [this_year]
        first, last = min(years), max(years + [this_year])
        items = [self._year_opening_item(account, y, openings, rows, closed) for y in range(first, last + 1)]
        if rows:
            before = self.repo.count_transactions_before(account_id, f"{min(rows):04d}-01-01")
        elif account.opening_balance_date:
            before = self.repo.count_transactions_before(account_id, account.opening_balance_date)
        else:
            before = 0
        return YearOpeningsResponse(
            account_id=account_id, currency=account.currency,
            transactions_before_first_base=before, items=items,
        )

    def _validate_fiscal_year(self, year: int) -> None:
        latest = year_openings._today().year + 1
        if year < MIN_FISCAL_YEAR or year > latest:
            raise HTTPException(status_code=400, detail=f"fiscal_year must be between {MIN_FISCAL_YEAR} and {latest}")

    def _audit_year_opening(self, action: str, account_id: int, year: int, details: dict, user: Optional[str]) -> None:
        self.repo.db.add(AuditLogDB(
            timestamp=datetime.utcnow().isoformat() + "Z",
            actor_email=user or "system@hrflow.internal",
            action=action,
            target_type="bank_account",
            target_id=str(account_id),
            details=json.dumps({"fiscal_year": year, **details}),
        ))

    def _single_year_item(self, account_id: int, year: int) -> YearOpeningItem:
        account = self._require_account(account_id)
        rows = {r.fiscal_year: r for r in self.repo.list_year_openings(account_id)}
        openings = {y: float(r.opening_balance) for y, r in rows.items()}
        return self._year_opening_item(account, year, openings, rows, self.repo.closed_reconciliation_months_by_year(account_id))

    def set_year_opening(self, account_id: int, year: int, payload: YearOpeningUpsert, user: Optional[str] = None) -> YearOpeningItem:
        self._require_account(account_id)
        self._validate_fiscal_year(year)
        existing = self.repo.get_year_opening(account_id, year)
        old = float(existing.opening_balance) if existing else None
        note = (payload.note or "").strip()
        self.repo.upsert_year_opening(account_id, year, payload.opening_balance, note, user)
        LedgerRepository(self.repo.db).recalculate_account_running_balances(account_id, commit=False)
        self._audit_year_opening("account.year_opening.set", account_id, year,
                                 {"old_opening_balance": old, "opening_balance": float(payload.opening_balance), "note": note}, user)
        self.repo.db.commit()
        return self._single_year_item(account_id, year)

    def delete_year_opening(self, account_id: int, year: int, user: Optional[str] = None) -> YearOpeningItem:
        self._require_account(account_id)
        row = self.repo.get_year_opening(account_id, year)
        if row is None:
            raise HTTPException(status_code=404, detail=f"No entered opening balance for {year}")
        old = float(row.opening_balance)
        self.repo.delete_year_opening(row)
        LedgerRepository(self.repo.db).recalculate_account_running_balances(account_id, commit=False)
        self._audit_year_opening("account.year_opening.deleted", account_id, year, {"old_opening_balance": old}, user)
        self.repo.db.commit()
        return self._single_year_item(account_id, year)

    # ------------------------------------------------------------------
    # Books and balance checkpoints (D-028)
    # ------------------------------------------------------------------
    def _validate_book_fields(self, book_id: Optional[int], visibility: Optional[str]) -> None:
        if visibility is not None and visibility not in VALID_VISIBILITY:
            raise HTTPException(status_code=400, detail=f"Invalid visibility. Must be one of: {', '.join(VALID_VISIBILITY)}")
        if book_id is not None and not self.repo.db.query(FinanceBookDB).filter(FinanceBookDB.id == book_id).first():
            raise HTTPException(status_code=404, detail=f"Book {book_id} not found")

    def list_books(self) -> List[FinanceBookDB]:
        return list(books.ensure_books(self.repo.db).values())

    def _require_account(self, account_id: int) -> FinanceBankAccountDB:
        account = self.repo.get_by_id(account_id)
        if not account:
            raise HTTPException(status_code=404, detail=f"Bank account with ID {account_id} not found")
        return account

    def _checkpoint_to_response(self, cp: AccountBalanceCheckpointDB) -> BalanceCheckpointResponse:
        computed = self.repo.compute_balance(cp.account_id, as_of_date=cp.date)
        att = self.repo.checkpoint_attachment(cp.id)
        return BalanceCheckpointResponse(
            id=cp.id,
            account_id=cp.account_id,
            date=cp.date,
            balance=cp.balance,
            note=cp.note,
            computed_balance=round(computed, 2),
            unrecorded_difference=round(float(cp.balance) - computed, 2),
            has_attachment=att is not None,
            attachment_name=att.file_name if att else None,
            created_at=cp.created_at,
            created_by=cp.created_by,
        )

    def list_checkpoints(self, account_id: int) -> List[BalanceCheckpointResponse]:
        self._require_account(account_id)
        return [self._checkpoint_to_response(cp) for cp in self.repo.list_checkpoints(account_id)]

    def create_checkpoint(self, account_id: int, payload: BalanceCheckpointCreate, created_by: Optional[str] = None) -> BalanceCheckpointResponse:
        account = self._require_account(account_id)
        if (account.visibility or "full") != "partial":
            raise HTTPException(status_code=400, detail="Balance checkpoints are for partial-visibility accounts. Set the account visibility to partial first.")
        try:
            from datetime import datetime as _dt
            _dt.strptime(payload.date, "%Y-%m-%d")
        except ValueError:
            raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
        cp = self.repo.create_checkpoint(account_id, payload.model_dump(), created_by=created_by)
        return self._checkpoint_to_response(cp)

    async def upload_checkpoint_attachment(self, account_id: int, checkpoint_id: int, file: UploadFile, uploaded_by: Optional[str] = None) -> BalanceCheckpointResponse:
        account = self._require_account(account_id)
        cp = self.repo.get_checkpoint(account_id, checkpoint_id)
        if not cp:
            raise HTTPException(status_code=404, detail=f"Checkpoint {checkpoint_id} not found")
        if not file or not file.filename:
            raise HTTPException(status_code=400, detail="A valid file is required.")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file cannot be empty.")
        if len(content) > MAX_CHECKPOINT_FILE_BYTES:
            raise HTTPException(status_code=413, detail="File exceeds the 15 MB limit.")
        name = os.path.basename(file.filename)
        clean_ext = os.path.splitext(name)[1].lstrip(".")
        att = self.repo.add_checkpoint_attachment(
            cp.id, name, len(content), file.content_type or "application/octet-stream", "pending", uploaded_by
        )
        account_folder = file_layout.build_account_folder(
            account_id=account.id,
            bank_name=account.bank_name,
            currency=account.currency,
            account_name=account.account_name,
        )
        ref = file_layout.build_ref(
            "balance_checkpoint",
            date=cp.date,
            account_folder=account_folder,
            checkpoint_id=cp.id,
            att_id=att.id,
            ext=clean_ext,
        )
        file_layout.save_file(content, ref)
        att.storage_ref = ref
        self.repo.db.commit()
        return self._checkpoint_to_response(cp)

    def get_checkpoint_attachment_file(self, account_id: int, checkpoint_id: int):
        self._require_account(account_id)
        cp = self.repo.get_checkpoint(account_id, checkpoint_id)
        att = self.repo.checkpoint_attachment(checkpoint_id) if cp else None
        if not att:
            raise HTTPException(status_code=404, detail="Checkpoint attachment not found")
        try:
            file_path = file_layout.resolve_path(att.storage_ref, must_exist=True)
        except (FileNotFoundError, ValueError):
            raise HTTPException(status_code=404, detail="Checkpoint attachment not found")
        return file_path, att.file_name, att.mime_type or "application/octet-stream"
