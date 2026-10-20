"""
be/finance/services/cheques_importer.py
Cheques importer for the bulk / historical import (D-033, slice I3).

Rows become DRAFT cheques only, with the scan attached through the finance-attachment path (D-032). A draft cheque
posts nothing to the ledger; issuing it later does (posting_policy at_issue), so this importer never sets a status
beyond `draft`. Handwriting is the weakest input, so the rules are stricter than for bills: amount, cheque number
and issue date must be present and valid for a row to import, and the owner checks every row against the scan.
"""
import os
import uuid
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from finance import import_config as cfg
from finance.import_archive import detect_content_type
from finance.import_manifest import parse_amount, parse_iso_date
from finance.import_report import LEVEL_DUPLICATE, LEVEL_ERROR, LEVEL_WARNING, Finding
from finance.models import BankStatementImportDB, FinanceBankAccountDB
from finance.repositories.cheques_repository import ChequesRepository
from finance.schemas import ChequeCreate
from finance.services.cheques_service import ChequesService
from finance.services.import_service import ImportActor, RowContext, finding, register_importer
from finance.services.subscriptions_service import FINANCE_UPLOADS_DIR

REQUIRED_FIELDS = ("amount", "cheque_number", "issue_date")
_MIME = {"pdf": "application/pdf", "png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp", "heic": "image/heic"}


def _display_name(name: str) -> str:
    base = os.path.basename((name or "").replace("\\", "/"))
    return "".join(ch for ch in base if ch >= " ").strip()[:255] or "cheque-scan"


class ChequesImporter:
    def __init__(self, db: Session, actor: ImportActor):
        from repositories.sql.audit import SqlAuditRepository

        self.db = db
        self.actor = actor
        self.audit = SqlAuditRepository()
        self.repo = ChequesRepository(db)
        self.service = ChequesService(self.repo)
        self._accounts: Optional[List[FinanceBankAccountDB]] = None
        self._seen: Dict[tuple, int] = {}

    def _account_rows(self) -> List[FinanceBankAccountDB]:
        if self._accounts is None:
            self._accounts = self.db.query(FinanceBankAccountDB).all()
        return self._accounts

    # ------------------------------------------------------------------
    def _resolve(self, ctx: RowContext):
        """Returns (payload dict, findings). The payload is None when the row cannot be imported."""
        row = ctx.row
        findings: List[Finding] = []

        def err(code, msg):
            findings.append(finding(LEVEL_ERROR, code, msg))

        def warn(code, msg):
            findings.append(finding(LEVEL_WARNING, code, msg))

        # Required fields (plan 25, I3). A blank is an error even when flagged: the cheque table cannot hold a blank
        # amount, number or date, and nothing is ever guessed. A flagged row is told to be entered by hand.
        blank = [f for f in REQUIRED_FIELDS if not row.get(f)]
        if blank:
            if row.get("review_flags"):
                err(
                    "required_blank_flagged",
                    f"{', '.join(blank)} blank (flagged: {row.get('review_flags')}). A cheque cannot be saved without them: enter this one by hand from the scan",
                )
            else:
                err("required_missing", f"{', '.join(blank)} is required for a cheque; leave the row out or flag it in review_flags")

        # Account: exact name (case-insensitive) or numeric id; must be an active bank account
        account = None
        ref = row.get("account")
        if not ref:
            err("account_missing", "account is required")
        else:
            matches = [a for a in self._account_rows() if (a.account_name or "").strip().lower() == ref.lower()]
            if not matches and ref.isdigit():
                matches = [a for a in self._account_rows() if a.id == int(ref)]
            if not matches:
                err("account_unknown", f"Account '{ref}' does not exist (use its exact name or id)")
            elif len(matches) > 1:
                err("account_ambiguous", f"More than one account is named '{ref}'; use its id")
            else:
                account = matches[0]
                if not account.is_active:
                    err("account_inactive", f"Account '{account.account_name}' is inactive")
                elif account.account_type != "bank":
                    err("account_not_bank", f"Cheques must be drawn from a bank account; '{account.account_name}' is a {account.account_type} account")

        issue_date = amount = None
        if row.get("issue_date"):
            try:
                issue_date = parse_iso_date(row.get("issue_date"))
            except ValueError as e:
                err("issue_date_invalid", f"issue_date: {e}")
        if row.get("amount"):
            try:
                amount = parse_amount(row.get("amount"))
                if amount <= 0:
                    err("amount_not_positive", "amount must be greater than 0")
            except ValueError as e:
                err("amount_invalid", f"amount: {e}")
        number = row.get("cheque_number")
        if number and len(number) > 50:
            err("cheque_number_too_long", "cheque_number is longer than 50 characters")
        payee = row.get("payee")
        if not payee:
            err("payee_required", "payee is required")
        elif len(payee) > 255:
            err("payee_too_long", "payee is longer than 255 characters")

        currency = (row.get("currency") or "").upper()
        if account is not None:
            if not currency:
                currency = (account.currency or "").upper()
            elif currency != (account.currency or "").upper():
                err("currency_mismatch", f"currency {currency} differs from the account's currency {account.currency}")

        if account is not None and issue_date:
            closed = (
                self.db.query(BankStatementImportDB)
                .filter(
                    BankStatementImportDB.account_id == account.id,
                    BankStatementImportDB.period_month == issue_date[:7],
                    BankStatementImportDB.status == "closed",
                )
                .first()
            )
            if closed:
                err("period_closed", f"The reconciliation period {issue_date[:7]} is closed for this account")

        if ctx.confidence is not None and ctx.confidence < cfg.LOW_CONFIDENCE_THRESHOLD:
            warn("low_confidence", f"Confidence {ctx.confidence:g} is below {cfg.LOW_CONFIDENCE_THRESHOLD:g}: compare this row with the scan")
        if ctx.entry is None:
            warn("no_scan", "No source file: the cheque will be flagged as scan missing")

        if any(f.level == LEVEL_ERROR for f in findings):
            return None, findings
        return {"account": account, "cheque_number": number, "issue_date": issue_date, "amount": amount,
                "currency": currency, "payee": payee}, findings

    # ------------------------------------------------------------------
    def check_row(self, ctx: RowContext) -> List[Finding]:
        data, findings = self._resolve(ctx)
        if data is None:
            return findings
        account = data["account"]
        existing = self.repo.get_by_account_and_number(account.id, data["cheque_number"])
        if existing:
            findings.append(
                finding(LEVEL_DUPLICATE, "duplicate_existing", f"Cheque {data['cheque_number']} already exists on {account.account_name} as cheque #{existing.id}")
            )
            return findings
        key = (account.id, data["cheque_number"])
        if key in self._seen:
            findings.append(finding(LEVEL_DUPLICATE, "duplicate_in_manifest", f"Same account and cheque number as line {self._seen[key]}"))
            return findings
        self._seen[key] = ctx.row.line
        return findings

    def create_row(self, ctx: RowContext) -> int:
        data, _findings = self._resolve(ctx)
        if data is None:
            raise ValueError("Row is not importable")
        account = data["account"]

        provenance = f"Imported (batch {ctx.batch_id}, row {ctx.row.get('row_ref')}"
        if ctx.row.get("source_file"):
            provenance += f", file {ctx.row.get('source_file')}"
        provenance += ")."
        if ctx.confidence is not None:
            provenance += f" Confidence {ctx.confidence:g}."
        if ctx.row.get("review_flags"):
            provenance += f" Review flags: {ctx.row.get('review_flags')}."
        notes = provenance + (f"\n{ctx.row.get('notes')}" if ctx.row.get("notes") else "")

        payload = ChequeCreate(
            account_id=account.id,
            cheque_number=data["cheque_number"],
            issue_date=data["issue_date"],
            amount=data["amount"],
            currency=data["currency"],
            payee=data["payee"],
            purpose_type="other",
            status="draft",
            notes=notes,
        )

        path = None
        if ctx.entry is not None:
            ext = os.path.splitext(ctx.entry.base_name)[1].lower()
            os.makedirs(FINANCE_UPLOADS_DIR, exist_ok=True)
            path = os.path.join(FINANCE_UPLOADS_DIR, f"{uuid.uuid4().hex}{ext}")
            with open(path, "wb") as fh:
                fh.write(ctx.entry.data)
        try:
            cheque = self.service.issue_cheque(payload, created_by=ctx.actor.email, import_batch_id=ctx.batch_id)
            if path is not None:
                mime = _MIME.get(detect_content_type(ctx.entry.data[:16]) or "", "application/octet-stream")
                self.repo.add_attachment(
                    cheque_id=cheque.id,
                    file_name=_display_name(ctx.entry.base_name),
                    file_size=len(ctx.entry.data),
                    mime_type=mime,
                    storage_ref=path,
                    uploaded_by=ctx.actor.email,
                )
        except Exception:
            self.db.rollback()
            if path:
                try:
                    os.remove(path)
                except OSError:
                    pass
            raise

        try:
            self.audit.log(
                "cheque.created", ctx.actor.email, "cheque", cheque.id,
                f"draft; imported from batch {ctx.batch_id} row {ctx.row.get('row_ref')}",
            )
        except Exception:
            pass
        return cheque.id


register_importer("cheques", lambda db, actor: ChequesImporter(db, actor))
