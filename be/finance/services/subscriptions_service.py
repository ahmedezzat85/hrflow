"""
be/finance/services/subscriptions_service.py
Business logic for Subscriptions, Variable/Recurring Charges, and Private Finance Attachments.
"""
import os
import uuid
import calendar
from datetime import datetime, date
from typing import List, Optional
from fastapi import HTTPException, status, UploadFile

from finance.repositories.subscriptions_repository import SubscriptionsRepository
from finance.schemas import (
    SubscriptionCreate,
    SubscriptionUpdate,
    SubscriptionResponse,
    SubscriptionChargeCreate,
    SubscriptionChargeResponse,
    SubscriptionChargeSettle,
    SubscriptionChargeSkip,
    SubscriptionChargeProof,
    GenerateChargesResult,
    FinanceAttachmentResponse,
)
from finance import books
from finance.models import SubscriptionDB, SubscriptionChargeDB, FinanceAttachmentDB

CYCLE_MONTHS = {"monthly": 1, "quarterly": 3, "yearly": 12}
PROOF_SOURCES = {"email_inbox", "vendor_portal", "bank_only", "none"}
PROOF_STATUSES = {"attached", "pending", "unavailable"}
MAX_GENERATED_PER_SUBSCRIPTION = 24


def add_cycle(day: date, cycle: Optional[str], steps: int = 1) -> date:
    """Move a billing date forward by whole cycles, keeping the day of month where the month allows."""
    months = CYCLE_MONTHS.get((cycle or "monthly").lower(), 1) * steps
    idx = day.year * 12 + (day.month - 1) + months
    year, month = divmod(idx, 12)
    month += 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


FINANCE_UPLOADS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads", "finance_attachments")


class SubscriptionsService:
    def __init__(self, repo: SubscriptionsRepository):
        self.repo = repo
        os.makedirs(FINANCE_UPLOADS_DIR, exist_ok=True)

    def _attachment_to_response(self, att: FinanceAttachmentDB) -> FinanceAttachmentResponse:
        return FinanceAttachmentResponse(
            id=att.id,
            subscription_charge_id=att.subscription_charge_id,
            statement_import_id=att.statement_import_id,
            ledger_transaction_id=att.ledger_transaction_id,
            file_name=att.file_name,
            file_size=att.file_size or 0,
            mime_type=att.mime_type or "application/octet-stream",
            storage_ref=att.storage_ref,
            uploaded_at=att.uploaded_at,
            uploaded_by=att.uploaded_by,
        )

    def _book_code(self, sub: Optional[SubscriptionDB]) -> Optional[str]:
        if sub is None:
            return None
        scope = books.resolve(self.repo.db, None)
        return scope.book_of(sub.payment_account_id)

    def _charge_to_response(self, charge: SubscriptionChargeDB) -> SubscriptionChargeResponse:
        sub_name = charge.subscription.name if charge.subscription else None
        owner_sub = charge.subscription
        vendor_name = charge.subscription.vendor.name if charge.subscription and charge.subscription.vendor else None
        attachments = [self._attachment_to_response(a) for a in (charge.attachments or [])]

        return SubscriptionChargeResponse(
            id=charge.id,
            subscription_id=charge.subscription_id,
            subscription_name=sub_name,
            vendor_name=vendor_name,
            billing_date=charge.billing_date,
            amount=charge.amount,
            currency=charge.currency,
            create_bill=bool(charge.linked_bill_id),
            linked_transaction_id=charge.linked_transaction_id,
            linked_bill_id=charge.linked_bill_id,
            variance_amount=charge.variance_amount or 0.0,
            variance_reason=charge.variance_reason,
            note=charge.note or "",
            created_at=charge.created_at,
            created_by=charge.created_by,
            attachments=attachments,
            status=charge.status or "settled",
            expected_amount=charge.expected_amount,
            proof_status=charge.proof_status or "pending",
            proof_note=charge.proof_note,
            proof_expected=bool(owner_sub.proof_expected) if owner_sub else False,
            proof_source=owner_sub.proof_source if owner_sub else None,
            settled_at=charge.settled_at,
            skipped_reason=charge.skipped_reason,
            payment_account_id=owner_sub.payment_account_id if owner_sub else None,
            payment_account_name=owner_sub.payment_account.account_name if owner_sub and owner_sub.payment_account else None,
            book_code=self._book_code(owner_sub),
        )

    def _sub_to_response(self, sub: SubscriptionDB) -> SubscriptionResponse:
        from datetime import datetime, timedelta
        vendor_name = sub.vendor.name if sub.vendor else None
        charges = sub.charges or []
        last_charge = None
        settled = [c for c in charges if (c.status or "settled") == "settled"]
        if settled:
            sorted_charges = sorted(settled, key=lambda c: c.billing_date, reverse=True)
            last_charge = sorted_charges[0]

        # Calculate notice deadline date
        notice_deadline_str = None
        is_renewal_imminent = False
        try:
            renewal_dt = datetime.strptime(sub.next_renewal_date, "%Y-%m-%d").date()
            notice_days = sub.notice_period_days if sub.notice_period_days is not None else 30
            notice_dt = renewal_dt - timedelta(days=notice_days)
            notice_deadline_str = notice_dt.strftime("%Y-%m-%d")
            today = datetime.utcnow().date()
            if today >= notice_dt and today <= renewal_dt:
                is_renewal_imminent = True
        except Exception:
            pass

        return SubscriptionResponse(
            id=sub.id,
            vendor_id=sub.vendor_id,
            vendor_name=vendor_name,
            name=sub.name,
            amount=sub.amount,
            currency=sub.currency,
            billing_cycle=sub.billing_cycle,
            next_renewal_date=sub.next_renewal_date,
            contract_start_date=sub.contract_start_date,
            contract_end_date=sub.contract_end_date,
            notice_period_days=sub.notice_period_days,
            owner=sub.owner,
            department=sub.department,
            payment_method=sub.payment_method,
            payment_account_id=sub.payment_account_id,
            seats_count=sub.seats_count,
            monthly_equivalent_amount=sub.monthly_equivalent_amount or round(sub.amount / 12.0 if sub.billing_cycle == 'yearly' else sub.amount, 2),
            notice_deadline_date=notice_deadline_str,
            is_renewal_imminent=is_renewal_imminent,
            auto_generate_bill=sub.auto_generate_bill,
            is_active=sub.is_active,
            created_at=sub.created_at,
            charges_count=len(settled),
            last_charge_date=last_charge.billing_date if last_charge else None,
            last_charge_amount=last_charge.amount if last_charge else None,
            billing_email=sub.billing_email,
            proof_source=sub.proof_source or "none",
            proof_expected=bool(sub.proof_expected),
            payment_account_name=sub.payment_account.account_name if sub.payment_account else None,
            book_code=self._book_code(sub),
            expected_charges_count=len([c for c in charges if c.status == "expected"]),
            proofs_missing_count=len([
                c for c in charges
                if sub.proof_expected and c.proof_status == "pending" and (c.status or "settled") in ("expected", "settled")
            ]),
        )

    def list_subscriptions(
        self,
        is_active: Optional[bool] = None,
        vendor_id: Optional[int] = None,
    ) -> List[SubscriptionResponse]:
        # Expected charges are generated whenever the list is opened (D-031); it is idempotent and never blocks the list
        try:
            self.generate_due_charges()
        except Exception:
            self.repo.db.rollback()
        subs = self.repo.list_subscriptions(is_active=is_active, vendor_id=vendor_id)
        return [self._sub_to_response(s) for s in subs]

    def get_subscription(self, subscription_id: int) -> SubscriptionResponse:
        sub = self.repo.get_by_id(subscription_id)
        if not sub:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Subscription with ID {subscription_id} not found",
            )
        return self._sub_to_response(sub)

    def create_subscription(self, data: SubscriptionCreate) -> SubscriptionResponse:
        # Validate billing_cycle
        if data.billing_cycle not in {"monthly", "quarterly", "yearly"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="billing_cycle must be one of: monthly, quarterly, yearly",
            )
        if data.proof_source not in PROOF_SOURCES:
            raise HTTPException(status_code=400, detail=f"proof_source must be one of: {', '.join(sorted(PROOF_SOURCES))}")
        sub = self.repo.create_subscription(data)
        return self._sub_to_response(sub)

    def update_subscription(
        self, subscription_id: int, data: SubscriptionUpdate
    ) -> SubscriptionResponse:
        if data.billing_cycle and data.billing_cycle not in {"monthly", "quarterly", "yearly"}:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="billing_cycle must be one of: monthly, quarterly, yearly",
            )
        if data.proof_source is not None and data.proof_source not in PROOF_SOURCES:
            raise HTTPException(status_code=400, detail=f"proof_source must be one of: {', '.join(sorted(PROOF_SOURCES))}")
        sub = self.repo.update_subscription(subscription_id, data)
        if not sub:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Subscription with ID {subscription_id} not found",
            )
        return self._sub_to_response(sub)

    def list_charges(self, subscription_id: Optional[int] = None) -> List[SubscriptionChargeResponse]:
        charges = self.repo.list_charges(subscription_id=subscription_id)
        return [self._charge_to_response(c) for c in charges]

    def get_charge(self, charge_id: int) -> SubscriptionChargeResponse:
        charge = self.repo.get_charge_by_id(charge_id)
        if not charge:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Subscription charge with ID {charge_id} not found",
            )
        return self._charge_to_response(charge)

    async def log_charge(
        self,
        data: SubscriptionChargeCreate,
        file: Optional[UploadFile] = None,
        created_by: Optional[str] = None,
    ) -> SubscriptionChargeResponse:
        try:
            charge = self.repo.create_charge(data, created_by=created_by)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

        if file and file.filename:
            # Save file locally into private finance uploads
            safe_filename = os.path.basename(file.filename)
            unique_name = f"{uuid.uuid4().hex}_{safe_filename}"
            file_path = os.path.join(FINANCE_UPLOADS_DIR, unique_name)

            content = await file.read()
            file_size = len(content)
            with open(file_path, "wb") as f:
                f.write(content)

            self.repo.add_attachment(
                subscription_charge_id=charge.id,
                file_name=safe_filename,
                file_size=file_size,
                mime_type=file.content_type or "application/octet-stream",
                storage_ref=file_path,
                uploaded_by=created_by,
            )

        # Refresh charge response
        return self.get_charge(charge.id)

    def get_attachment(self, attachment_id: int) -> FinanceAttachmentDB:
        att = self.repo.get_attachment_by_id(attachment_id)
        if not att:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Attachment with ID {attachment_id} not found",
            )
        return att

    # ------------------------------------------------------------------
    # Subscriptions v2 (X5, D-031): expected charges, settle, skip, proof
    # ------------------------------------------------------------------
    def generate_due_charges(self, as_of: Optional[str] = None) -> GenerateChargesResult:
        """Create an expected charge for every active subscription cycle that is due and has none yet.
        Idempotent: a date that already has a charge (any status) is skipped, and a unique index guards races."""
        today = datetime.strptime(as_of, "%Y-%m-%d").date() if as_of else datetime.utcnow().date()
        created = 0
        subs = self.repo.list_subscriptions(is_active=True)
        for sub in subs:
            if float(sub.amount or 0.0) <= 0.0:
                continue
            try:
                due = datetime.strptime(sub.next_renewal_date, "%Y-%m-%d").date()
            except (TypeError, ValueError):
                continue
            end = None
            if sub.contract_end_date:
                try:
                    end = datetime.strptime(sub.contract_end_date, "%Y-%m-%d").date()
                except ValueError:
                    end = None
            step = 0
            while due <= today and step < MAX_GENERATED_PER_SUBSCRIPTION:
                if end is None or due <= end:
                    billing_date = due.strftime("%Y-%m-%d")
                    if not self.repo.charge_exists(sub.id, billing_date):
                        if self.repo.add_expected_charge(sub, billing_date):
                            created += 1
                step += 1
                due = add_cycle(date.fromisoformat(sub.next_renewal_date), sub.billing_cycle, step)
        return GenerateChargesResult(created=created, subscriptions_checked=len(subs))

    def list_charges_v2(self, subscription_id=None, status_filter=None, proof_status=None, proofs_missing=False, date_from=None, date_to=None, book=None) -> List[SubscriptionChargeResponse]:
        if status_filter and status_filter not in {"expected", "settled", "skipped"}:
            raise HTTPException(status_code=400, detail="status must be one of: expected, settled, skipped")
        if proof_status and proof_status not in PROOF_STATUSES:
            raise HTTPException(status_code=400, detail="proof_status must be one of: attached, pending, unavailable")
        scope = books.resolve(self.repo.db, books.validate_view(book))
        charges = self.repo.list_charges_filtered(subscription_id, status_filter, proof_status, proofs_missing, date_from, date_to)
        if scope.restricts:
            charges = [
                c for c in charges
                if (scope.owns_account(c.subscription.payment_account_id) if c.subscription.payment_account_id else scope.owns_unattributed())
            ]
        return [self._charge_to_response(c) for c in charges]

    def _require_open_charge(self, charge_id: int) -> SubscriptionChargeDB:
        charge = self.repo.get_charge_by_id(charge_id)
        if not charge:
            raise HTTPException(status_code=404, detail=f"Subscription charge with ID {charge_id} not found")
        if charge.status != "expected":
            raise HTTPException(status_code=400, detail=f"Only an expected charge can be settled or skipped; this one is {charge.status}.")
        return charge

    def _advance_renewal(self, charge: SubscriptionChargeDB) -> None:
        sub = charge.subscription
        try:
            nxt = add_cycle(date.fromisoformat(charge.billing_date), sub.billing_cycle, 1).strftime("%Y-%m-%d")
        except ValueError:
            return
        if nxt > (sub.next_renewal_date or ""):
            sub.next_renewal_date = nxt

    def settle_charge(self, charge_id: int, payload: SubscriptionChargeSettle, actor=None) -> SubscriptionChargeResponse:
        from finance.models import LedgerTransactionDB, FinanceBankAccountDB
        db = self.repo.db
        charge = self._require_open_charge(charge_id)
        sub = charge.subscription
        expected = float(charge.expected_amount if charge.expected_amount is not None else charge.amount)

        if payload.mode == "link_ledger":
            if not payload.ledger_transaction_id:
                raise HTTPException(status_code=400, detail="ledger_transaction_id is required to link an existing payment")
            tx = db.query(LedgerTransactionDB).filter(LedgerTransactionDB.id == payload.ledger_transaction_id).first()
            if not tx:
                raise HTTPException(status_code=404, detail=f"Ledger transaction {payload.ledger_transaction_id} not found")
            if tx.direction != "out":
                raise HTTPException(status_code=400, detail="Only a payment (money out) can settle a subscription charge")
            if (tx.currency or "").upper() != (charge.currency or "").upper():
                raise HTTPException(status_code=400, detail={"code": "currency_mismatch", "message": f"The payment is in {tx.currency} but the charge is in {charge.currency}."})
            if tx.linked_bill_id:
                raise HTTPException(status_code=400, detail="This payment already settles a vendor bill; it cannot settle a subscription charge as well")
            taken = db.query(SubscriptionChargeDB.id).filter(SubscriptionChargeDB.linked_transaction_id == tx.id, SubscriptionChargeDB.id != charge.id).first()
            if taken:
                raise HTTPException(status_code=400, detail="This payment is already linked to another subscription charge")
            actual = float(tx.amount)
            charge.linked_transaction_id = tx.id
        elif payload.mode == "already_paid_bill":
            actual = float(payload.amount if payload.amount is not None else expected)
            account_id = payload.bank_account_id or sub.payment_account_id
            if not account_id:
                raise HTTPException(status_code=400, detail="bank_account_id is required: the subscription has no paying account")
            account = db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == account_id).first()
            if not account:
                raise HTTPException(status_code=404, detail=f"Account {account_id} not found")
            bill = self._create_already_paid_bill(charge, actual, account_id, payload, actor)
            charge.linked_bill_id = bill.id
            ledger = (
                db.query(LedgerTransactionDB)
                .filter(LedgerTransactionDB.linked_bill_id == bill.id)
                .order_by(LedgerTransactionDB.id.desc())
                .first()
            )
            if ledger is not None:
                charge.linked_transaction_id = ledger.id
        else:
            raise HTTPException(status_code=400, detail="mode must be link_ledger or already_paid_bill")

        charge.amount = actual
        charge.variance_amount = round(actual - expected, 2)
        charge.variance_reason = (payload.variance_reason or None) if charge.variance_amount != 0.0 else None
        charge.status = "settled"
        charge.settled_at = datetime.utcnow()
        self._advance_renewal(charge)
        db.commit()
        return self.get_charge(charge.id)

    def _create_already_paid_bill(self, charge, actual: float, account_id: int, payload, actor):
        """The 'Already paid' bill goes through the bills service, so the draft, duplicate, currency, balance and
        payment-type rules (D-017, D-018, D-020) all apply exactly as they do for any bill."""
        from finance.repositories.bills_repository import BillsRepository
        from finance.services.bills_service import BillsService, SYSTEM_ACTOR
        from finance.schemas import BillCreate, BillLineCreate, BillPaymentInline
        from finance.bill_payment_rules import BillPaymentError
        from finance import bill_payment_rules as rules
        from finance.models import FinanceBankAccountDB, PaymentTypeDB
        sub = charge.subscription
        pay_date = payload.payment_date or charge.billing_date
        payment_type_id = payload.payment_type_id
        if payment_type_id is None:
            account = self.repo.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == account_id).first()
            code = rules.DEFAULT_PAYMENT_TYPE_CODE_BY_ACCOUNT_TYPE.get((account.account_type or "bank").lower()) if account else None
            pt = self.repo.db.query(PaymentTypeDB).filter(PaymentTypeDB.code == code).first() if code else None
            if pt is None:
                raise HTTPException(status_code=400, detail={"code": "payment_type_not_allowed", "message": "Choose a payment type for this account."})
            payment_type_id = pt.id
        bill_service = BillsService(BillsRepository(self.repo.db))
        number = f"SUB-{sub.id}-{charge.billing_date.replace('-', '')}"
        create = BillCreate(
            vendor_id=sub.vendor_id,
            bill_number=number,
            category="SaaS / Software",
            issue_date=charge.billing_date,
            due_date=charge.billing_date,
            currency=charge.currency,
            department=sub.department or "Operations",
            notes=f"Subscription charge: {sub.name}",
            lines=[BillLineCreate(description=f"Subscription: {sub.name}", quantity=1, unit_price=actual, line_total=actual)],
            is_paid_now=True,
            payment=BillPaymentInline(bank_account_id=account_id, payment_type_id=payment_type_id, payment_date=pay_date, amount=actual),
        )
        try:
            return bill_service.create_bill(create, actor or SYSTEM_ACTOR)
        except BillPaymentError as e:
            self.repo.db.rollback()
            raise HTTPException(status_code=400, detail=e.detail())

    def skip_charge(self, charge_id: int, payload: SubscriptionChargeSkip) -> SubscriptionChargeResponse:
        charge = self._require_open_charge(charge_id)
        charge.status = "skipped"
        charge.skipped_reason = payload.reason.strip()
        self._advance_renewal(charge)
        self.repo.db.commit()
        return self.get_charge(charge.id)

    def set_proof(self, charge_id: int, payload: SubscriptionChargeProof) -> SubscriptionChargeResponse:
        """Proof never blocks a charge: any status can be set at any time. 'Unavailable' needs a reason."""
        if payload.proof_status not in PROOF_STATUSES:
            raise HTTPException(status_code=400, detail="proof_status must be one of: attached, pending, unavailable")
        charge = self.repo.get_charge_by_id(charge_id)
        if not charge:
            raise HTTPException(status_code=404, detail=f"Subscription charge with ID {charge_id} not found")
        if payload.proof_status == "unavailable" and not (payload.proof_note or "").strip():
            raise HTTPException(status_code=400, detail="A reason is required when the proof is unavailable")
        if payload.proof_status == "attached" and not charge.attachments:
            raise HTTPException(status_code=400, detail="Upload the proof file to mark it attached")
        charge.proof_status = payload.proof_status
        charge.proof_note = (payload.proof_note or "").strip() or None
        self.repo.db.commit()
        return self.get_charge(charge.id)

    async def add_proof_file(self, charge_id: int, file: UploadFile, uploaded_by: Optional[str] = None) -> SubscriptionChargeResponse:
        charge = self.repo.get_charge_by_id(charge_id)
        if not charge:
            raise HTTPException(status_code=404, detail=f"Subscription charge with ID {charge_id} not found")
        if not file or not file.filename:
            raise HTTPException(status_code=400, detail="A valid file is required.")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file cannot be empty.")
        if len(content) > 15 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="File exceeds the 15 MB limit.")
        safe = os.path.basename(file.filename)
        os.makedirs(FINANCE_UPLOADS_DIR, exist_ok=True)
        path = os.path.join(FINANCE_UPLOADS_DIR, f"{uuid.uuid4().hex}_{safe}")
        with open(path, "wb") as fh:
            fh.write(content)
        self.repo.add_attachment(
            subscription_charge_id=charge.id, file_name=safe, file_size=len(content),
            mime_type=file.content_type or "application/octet-stream", storage_ref=path, uploaded_by=uploaded_by,
        )
        charge.proof_status = "attached"
        charge.proof_note = None
        self.repo.db.commit()
        return self.get_charge(charge.id)

