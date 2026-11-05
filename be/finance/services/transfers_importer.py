"""
be/finance/services/transfers_importer.py
Transfers importer for the bulk / historical import (D-052).

Each row is one transfer between two company accounts, created through the transfers service so its two ledger legs
post exactly as a transfer entered by hand. When the accounts sit in different books (overseas to local) the book
rules of D-028 classify it with no extra work: Local sees "Income from overseas entity", Overseas sees "Transferred
to local entity", Consolidated eliminates both. The supporting document (for example the payment document the local
entity issued) is attached to both legs, so either cashbook shows it.

Accounts are never created. Unlike the Draft kinds, a committed transfer is posted, so rows carry the
`will_post_ledger` warning and the commit needs the posting confirmation.
"""
import os
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from finance import import_config as cfg
from finance.import_archive import detect_content_type
from finance.import_manifest import parse_amount, parse_iso_date
from finance.import_report import LEVEL_DUPLICATE, LEVEL_ERROR, LEVEL_WARNING, Finding
from finance.models import AccountTransferDB, BankStatementImportDB, FinanceAttachmentDB, FinanceBankAccountDB, LedgerTransactionDB
from finance.schemas import AccountTransferCreate
from finance.services.import_service import ImportActor, RowContext, finding, register_importer
from finance.services.transfers_service import TransfersService
import file_layout

_MIME = {"pdf": "application/pdf", "png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp", "heic": "image/heic"}
REQUIRED_FIELDS = ("from_account", "to_account", "date", "from_amount")


def _display_name(name: str) -> str:
    base = os.path.basename((name or "").replace("\\", "/"))
    return "".join(ch for ch in base if ch >= " ").strip()[:255] or "transfer-document"


class TransfersImporter:
    def __init__(self, db: Session, actor: ImportActor):
        from repositories.sql.audit import SqlAuditRepository

        self.db = db
        self.actor = actor
        self.audit = SqlAuditRepository()
        self.service = TransfersService(db)
        self._accounts: Optional[List[FinanceBankAccountDB]] = None
        self._seen: Dict[tuple, int] = {}

    def _account_rows(self) -> List[FinanceBankAccountDB]:
        if self._accounts is None:
            self._accounts = self.db.query(FinanceBankAccountDB).all()
        return self._accounts

    def _find_account(self, ref: str, label: str, err):
        matches = [a for a in self._account_rows() if (a.account_name or "").strip().lower() == ref.lower()]
        if not matches and ref.isdigit():
            matches = [a for a in self._account_rows() if a.id == int(ref)]
        if not matches:
            err(f"{label}_unknown", f"{label} '{ref}' does not exist (use its exact name or id); accounts are never created by an import")
            return None
        if len(matches) > 1:
            err(f"{label}_ambiguous", f"More than one account is named '{ref}'; use its id")
            return None
        account = matches[0]
        if not account.is_active:
            err(f"{label}_inactive", f"Account '{account.account_name}' is inactive")
            return None
        return account

    def _resolve(self, ctx: RowContext):
        row = ctx.row
        findings: List[Finding] = []

        def err(code, msg):
            findings.append(finding(LEVEL_ERROR, code, msg))

        def warn(code, msg):
            findings.append(finding(LEVEL_WARNING, code, msg))

        blank = [f for f in REQUIRED_FIELDS if not row.get(f)]
        if blank:
            err("required_missing", f"{', '.join(blank)} is required for a transfer")

        src = self._find_account(row.get("from_account"), "from_account", err) if row.get("from_account") else None
        dst = self._find_account(row.get("to_account"), "to_account", err) if row.get("to_account") else None
        if src is not None and dst is not None and src.id == dst.id:
            err("same_account", "from_account and to_account are the same account")

        date = None
        if row.get("date"):
            try:
                date = parse_iso_date(row.get("date"))
            except ValueError as e:
                err("date_invalid", f"date: {e}")

        def number(name, minimum_exclusive=False):
            raw = row.get(name)
            if not raw:
                return None
            try:
                value = parse_amount(raw)
            except ValueError as e:
                err(f"{name}_invalid", f"{name}: {e}")
                return None
            if value < 0 or (minimum_exclusive and value == 0):
                err(f"{name}_not_positive", f"{name} must be greater than 0" if minimum_exclusive else f"{name} cannot be negative")
                return None
            return value

        from_amount = number("from_amount", True)
        to_amount = number("to_amount", True)
        fx_rate = number("fx_rate", True)
        fee = number("fee") or 0.0

        if src is not None and dst is not None and from_amount is not None:
            same_currency = (src.currency or "").upper() == (dst.currency or "").upper()
            if same_currency:
                if to_amount is not None and abs(to_amount - from_amount) > 0.005:
                    err("to_amount_differs", f"Both accounts are in {src.currency}, so to_amount must equal from_amount (or be left blank)")
                to_amount = from_amount
                fx_rate = None
            else:
                if to_amount is None and fx_rate is None:
                    err("fx_required", f"The accounts are in different currencies ({src.currency} to {dst.currency}): fill to_amount or fx_rate")
                elif to_amount is not None and fx_rate is not None and abs(from_amount * fx_rate - to_amount) > max(0.01, 0.005 * to_amount):
                    warn("fx_inconsistent", f"from_amount x fx_rate ({from_amount * fx_rate:,.2f}) differs from to_amount ({to_amount:,.2f}); to_amount was used")
                if to_amount is None and fx_rate is not None:
                    to_amount = round(from_amount * fx_rate, 2)
                if fx_rate is None and to_amount is not None:
                    fx_rate = round(to_amount / from_amount, 6)

        if date:
            for account in (src, dst):
                if account is None:
                    continue
                closed = (
                    self.db.query(BankStatementImportDB)
                    .filter(BankStatementImportDB.account_id == account.id, BankStatementImportDB.period_month == date[:7],
                            BankStatementImportDB.status == "closed")
                    .first()
                )
                if closed:
                    err("period_closed", f"The reconciliation period {date[:7]} is closed for account '{account.account_name}'")

        if ctx.entry is None:
            warn("no_document", "No source file: the transfer has no supporting document attached")

        if any(f.level == LEVEL_ERROR for f in findings):
            return None, findings
        return {
            "src": src, "dst": dst, "date": date, "from_amount": from_amount, "to_amount": to_amount, "fx_rate": fx_rate,
            "fee": fee, "reference": row.get("exchange_reference") or None,
        }, findings

    # ------------------------------------------------------------------
    def check_row(self, ctx: RowContext) -> List[Finding]:
        data, findings = self._resolve(ctx)
        if data is None:
            return findings
        src, dst = data["src"], data["dst"]

        existing = (
            self.db.query(AccountTransferDB)
            .filter(AccountTransferDB.from_account_id == src.id, AccountTransferDB.to_account_id == dst.id,
                    AccountTransferDB.date == data["date"], AccountTransferDB.from_amount == data["from_amount"])
            .first()
        )
        if existing and (not data["reference"] or existing.exchange_reference == data["reference"]):
            findings.append(finding(LEVEL_DUPLICATE, "duplicate_existing", f"The same transfer already exists as transfer #{existing.id}"))
            return findings
        key = (src.id, dst.id, data["date"], round(data["from_amount"], 2), data["reference"] or "")
        if key in self._seen:
            findings.append(finding(LEVEL_DUPLICATE, "duplicate_in_manifest", f"Same transfer as line {self._seen[key]}"))
            return findings
        self._seen[key] = ctx.row.line

        for account, direction, amount in ((src, "out", data["from_amount"]), (dst, "in", data["to_amount"])):
            twin = (
                self.db.query(LedgerTransactionDB.id)
                .filter(LedgerTransactionDB.account_id == account.id, LedgerTransactionDB.date == data["date"],
                        LedgerTransactionDB.direction == direction, LedgerTransactionDB.amount == amount)
                .first()
            )
            if twin:
                findings.append(finding(
                    LEVEL_WARNING, "possible_existing_ledger_row",
                    f"Account '{account.account_name}' already has a {direction} of {amount:,.2f} on {data['date']} (ledger #{twin[0]}). If it is this transfer, leave the row out or it is counted twice",
                ))
        findings.append(finding(
            LEVEL_WARNING, cfg.POSTING_CODE,
            f"Will move {data['from_amount']:,.2f} {src.currency} from '{src.account_name}' to {data['to_amount']:,.2f} {dst.currency} in '{dst.account_name}' on {data['date']}: posts the ledger legs to both accounts",
        ))
        return findings

    def create_row(self, ctx: RowContext) -> int:
        data, _findings = self._resolve(ctx)
        if data is None:
            raise ValueError("Row is not importable")
        src, dst = data["src"], data["dst"]
        same_currency = (src.currency or "").upper() == (dst.currency or "").upper()
        label = ctx.row.get("notes") or "Imported transfer"
        note = f"{label} [import batch {ctx.batch_id}, row {ctx.row.get('row_ref')}]"[:240]

        payload = AccountTransferCreate(
            from_account_id=src.id, to_account_id=dst.id, date=data["date"],
            from_amount=data["from_amount"], from_currency=src.currency, to_amount=data["to_amount"], to_currency=dst.currency,
            fx_rate=data["fx_rate"], transfer_type="internal" if same_currency else "same_bank_fx",
            exchange_reference=data["reference"], fee=data["fee"], note=note,
        )
        transfer = self.service.create_transfer(payload, created_by=ctx.actor.email)

        if ctx.entry is not None:
            try:
                self._attach_document(ctx, transfer.id, data["date"])
            except Exception:
                self.db.rollback()
                import logging

                logging.getLogger(__name__).exception("Import row %s: transfer %s was created but its document could not be saved", ctx.row.get("row_ref"), transfer.id)
        try:
            self.audit.log("transfer.created", ctx.actor.email, "transfer", transfer.id,
                           f"imported from batch {ctx.batch_id} row {ctx.row.get('row_ref')}")
        except Exception:
            pass
        return transfer.id

    def _attach_document(self, ctx: RowContext, transfer_id: int, date: str) -> None:
        """One copy of the document per cashbook leg, so either side opens it from its own transaction."""
        legs = (
            self.db.query(LedgerTransactionDB)
            .filter(LedgerTransactionDB.linked_transfer_id == transfer_id, LedgerTransactionDB.source == "transfer")
            .all()
        )
        ext = os.path.splitext(ctx.entry.base_name)[1].lower().lstrip(".")
        mime = _MIME.get(detect_content_type(ctx.entry.data[:16]) or "", "application/octet-stream")
        for leg in legs:
            att = FinanceAttachmentDB(
                ledger_transaction_id=leg.id, file_name=_display_name(ctx.entry.base_name), file_size=len(ctx.entry.data),
                mime_type=mime, storage_ref="pending", uploaded_by=ctx.actor.email,
            )
            self.db.add(att)
            self.db.flush()
            ref = file_layout.build_ref("ledger_attachment", transaction_id=leg.id, att_id=att.id, ext=ext, date=date)
            file_layout.save_file(ctx.entry.data, ref)
            att.storage_ref = ref
        self.db.commit()


register_importer("transfers", lambda db, actor: TransfersImporter(db, actor))
