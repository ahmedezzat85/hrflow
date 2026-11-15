"""
be/finance/services/bank_fees_importer.py
Bank fees importer for the bulk / historical import: standalone fees (monthly charge, card fee, subscription charge)
that the transfers kind cannot carry. Manifest only, no ZIP.

Each valid row posts ONE money-out ledger row through `LedgerService.record_manual_transaction`, the same path as a
manual transaction, so the account-currency rule, the closed reconciliation month lock and every other manual check
apply unchanged. Payment type BANK_FEES (by code) and the category (default "Bank Fees", by name) are resolved at run
time, never by id. Accounts are never created (the finance account table holds company accounts only).

Owner-pending defaults (marked DEFAULT below): fixed default category "Bank Fees"; an identical fee already in the
ledger is a WARNING, not an error; no balance check (fees follow what manual transactions do today).

Provenance is kept out of the ledger text: the rows are plain manual rows (so the existing manual delete is the undo)
and each created row is written to the audit log with its batch and row_ref. That audit entry also makes a re-commit
of the same file safe: a row whose (row_ref, account, date, amount) was already imported is reported as a duplicate.
"""
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from finance import import_config as cfg
from finance.import_manifest import parse_amount, parse_iso_date
from finance.import_report import LEVEL_DUPLICATE, LEVEL_ERROR, LEVEL_WARNING, Finding
from finance.models import FinanceBankAccountDB, LedgerTransactionDB
from finance.repositories.accounts_repository import AccountsRepository
from finance.repositories.categories_repository import CategoriesRepository
from finance.repositories.ledger_repository import LedgerRepository
from finance.repositories.payment_types_repository import PaymentTypesRepository
from finance.schemas import LedgerTransactionCreate
from finance.services.import_service import ImportActor, RowContext, finding, register_importer
from finance.services.ledger_service import LedgerService

AUDIT_ACTION = "bank_fee.imported"
PAYMENT_TYPE_CODE = "BANK_FEES"
DEFAULT_CATEGORY = "Bank Fees"  # DEFAULT: owner to confirm
DEFAULT_DESCRIPTION = "Bank fees"
REQUIRED_FIELDS = ("account", "date", "amount")


def _audit_key(row_ref: str, account_id: int, date: str, amount: float) -> str:
    return f"{row_ref}|{account_id}|{date}|{amount:.2f}"


class BankFeesImporter:
    def __init__(self, db: Session, actor: ImportActor):
        from repositories.sql.audit import SqlAuditRepository

        self.db = db
        self.actor = actor
        self.audit = SqlAuditRepository()
        self.service = LedgerService(
            LedgerRepository(db), AccountsRepository(db), CategoriesRepository(db), PaymentTypesRepository(db)
        )
        self._accounts: Optional[List[FinanceBankAccountDB]] = None
        self._imported_keys: Optional[set] = None

    def _account_rows(self) -> List[FinanceBankAccountDB]:
        if self._accounts is None:
            self._accounts = self.db.query(FinanceBankAccountDB).all()
        return self._accounts

    def _already_imported(self, key: str) -> bool:
        if self._imported_keys is None:
            from models_db import AuditLogDB

            rows = self.db.query(AuditLogDB.details).filter(AuditLogDB.action == AUDIT_ACTION).all()
            self._imported_keys = {(r[0] or "").split(" ", 1)[0] for r in rows}
        return key in self._imported_keys

    def _resolve(self, ctx: RowContext):
        row = ctx.row
        findings: List[Finding] = []

        def err(code, msg):
            findings.append(finding(LEVEL_ERROR, code, msg))

        blank = [f for f in REQUIRED_FIELDS if not row.get(f)]
        if blank:
            err("required_missing", f"{', '.join(blank)} is required for a bank fee")

        account = None
        ref = row.get("account")
        if ref:
            matches = [a for a in self._account_rows() if (a.account_name or "").strip().lower() == ref.strip().lower()]
            if not matches:
                err("account_unknown", f"account '{ref}' does not exist (use its exact name); accounts are never created by an import")
            elif len(matches) > 1:
                err("account_ambiguous", f"More than one account is named '{ref}'")
            elif not matches[0].is_active:
                err("account_inactive", f"Account '{matches[0].account_name}' is inactive")
            else:
                account = matches[0]

        date = None
        if row.get("date"):
            try:
                date = parse_iso_date(row.get("date"))
            except ValueError as e:
                err("date_invalid", f"date: {e}")

        amount = None
        if row.get("amount"):
            try:
                amount = parse_amount(row.get("amount"))
            except ValueError as e:
                err("amount_invalid", f"amount: {e}")
            else:
                if amount <= 0:
                    err("amount_not_positive", "amount must be greater than 0")
                    amount = None

        if account is not None and row.get("currency") and row.get("currency").strip().upper() != (account.currency or "").upper():
            err("currency_mismatch", f"currency {row.get('currency').strip().upper()} differs from the account currency ({account.currency})")

        category = self.service.categories_repo.get_by_name(row.get("category") or DEFAULT_CATEGORY)
        if category is None:
            err("category_unknown", f"Category '{row.get('category') or DEFAULT_CATEGORY}' does not exist")
        payment_type = self.service.payment_types_repo.get_by_code(PAYMENT_TYPE_CODE)
        if payment_type is None:
            err("payment_type_missing", f"Payment type {PAYMENT_TYPE_CODE} is not configured")

        if account is not None and date:
            from finance.models import BankStatementImportDB

            closed = (
                self.db.query(BankStatementImportDB)
                .filter(BankStatementImportDB.account_id == account.id, BankStatementImportDB.period_month == date[:7],
                        BankStatementImportDB.status == "closed")
                .first()
            )
            if closed:
                err("period_closed", f"The reconciliation period {date[:7]} is closed for account '{account.account_name}'")

        if any(f.level == LEVEL_ERROR for f in findings):
            return None, findings
        return {"account": account, "date": date, "amount": amount, "category": category, "payment_type": payment_type}, findings

    # ------------------------------------------------------------------
    def check_row(self, ctx: RowContext) -> List[Finding]:
        data, findings = self._resolve(ctx)
        if data is None:
            return findings
        account = data["account"]

        key = _audit_key(ctx.row.get("row_ref"), account.id, data["date"], data["amount"])
        if self._already_imported(key):
            findings.append(finding(LEVEL_DUPLICATE, "duplicate_existing", "This row was already imported from an earlier run"))
            return findings

        # DEFAULT: an identical fee is a warning, not an error (identical monthly fees are legitimate)
        twin = (
            self.db.query(LedgerTransactionDB.id)
            .filter(LedgerTransactionDB.account_id == account.id, LedgerTransactionDB.date == data["date"],
                    LedgerTransactionDB.direction == "out", LedgerTransactionDB.amount == data["amount"],
                    LedgerTransactionDB.category_id == data["category"].id)
            .first()
        )
        if twin:
            findings.append(finding(
                LEVEL_WARNING, "possible_existing_ledger_row",
                f"Account '{account.account_name}' already has a {data['category'].name} out of {data['amount']:,.2f} on {data['date']} (ledger #{twin[0]}). Leave the row out if it is the same fee",
            ))
        findings.append(finding(
            LEVEL_WARNING, cfg.POSTING_CODE,
            f"Will post a fee of {data['amount']:,.2f} {account.currency} out of '{account.account_name}' on {data['date']}",
        ))
        return findings

    def create_row(self, ctx: RowContext) -> int:
        data, _findings = self._resolve(ctx)
        if data is None:
            raise ValueError("Row is not importable")
        account = data["account"]
        payload = LedgerTransactionCreate(
            date=data["date"], amount=data["amount"], direction="out", currency=account.currency,
            category_id=data["category"].id, payment_type_id=data["payment_type"].id, entry_type="bank_fee",
            reference=ctx.row.get("reference") or "", description=ctx.row.get("description") or DEFAULT_DESCRIPTION,
        )
        tx = self.service.record_manual_transaction(account.id, payload, user_email=ctx.actor.email)
        try:
            key = _audit_key(ctx.row.get("row_ref"), account.id, data["date"], data["amount"])
            self.audit.log(AUDIT_ACTION, ctx.actor.email, "ledger_transaction", tx.id, f"{key} batch {ctx.batch_id}")
        except Exception:
            pass
        return tx.id


register_importer("bank_fees", lambda db, actor: BankFeesImporter(db, actor))
