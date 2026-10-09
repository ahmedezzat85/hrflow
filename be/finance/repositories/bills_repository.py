"""
be/finance/repositories/bills_repository.py
SQLAlchemy-backed repository for Vendor Bills, Bill Lines, and
outgoing Payments (Accounts Payable side).

Conventions (matches Phase 4.3 InvoicesRepository pattern):
 - All write operations commit and refresh before returning.
 - No hard deletes — bills are voided, not deleted.
 - Balance adjustment on Payment is done here so it stays atomic with the Payment insert.
"""
import logging
from datetime import datetime
from typing import List, Optional
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_

from finance import bill_status as bs
from finance import bill_payment_rules as rules
from finance.repositories.ledger_repository import LedgerRepository

from finance.models import (
    BillDB,
    BillLineDB,
    PaymentDB,
    FinanceBankAccountDB,
    VendorDB,
    LedgerTransactionDB,
    TransactionCategoryDB,
    PaymentTypeDB,
)

logger = logging.getLogger(__name__)


class BillsRepository:
    def __init__(self, db: Session):
        self.db = db

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _compute_totals(self, lines: List[BillLineDB]) -> tuple[float, float, float]:
        """Returns (subtotal, tax_amount, total). Tax is stored separately; subtotal = sum of line_totals."""
        subtotal = sum(ln.line_total for ln in lines)
        tax_amount = 0.0  # Tax handled separately in a future phase; field reserved.
        total = subtotal + tax_amount
        return round(subtotal, 4), round(tax_amount, 4), round(total, 4)

    def _load_bill_full(self, bill_id: int) -> Optional[BillDB]:
        return (
            self.db.query(BillDB)
            .options(joinedload(BillDB.lines), joinedload(BillDB.vendor))
            .filter(BillDB.id == bill_id)
            .first()
        )

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------
    def list_all(
        self,
        status: Optional[str] = None,
        queue: Optional[str] = None,
        vendor_id: Optional[int] = None,
        search: Optional[str] = None,
        has_attachment: Optional[bool] = None,
        limit: int = 50,
        offset: int = 0,
        overdue: Optional[bool] = None,
    ) -> List[BillDB]:
        query = (
            self.db.query(BillDB)
            .options(joinedload(BillDB.lines), joinedload(BillDB.vendor))
        )
        if queue:
            q_norm = queue.lower().strip()
            if q_norm in bs.VALID_BILL_STATUSES:
                query = query.filter(BillDB.status == q_norm)
            elif q_norm == "all":
                query = query.filter(BillDB.status != bs.VOID)
        elif status:
            query = query.filter(BillDB.status == status)
        if overdue is True:
            query = query.filter(BillDB.status.in_(bs.OPEN_STATUSES), BillDB.due_date < datetime.utcnow().strftime("%Y-%m-%d"))

        if vendor_id is not None:
            query = query.filter(BillDB.vendor_id == vendor_id)
        if has_attachment is True:
            query = query.filter(BillDB.attachment_url.isnot(None), BillDB.attachment_url != "")
        elif has_attachment is False:
            query = query.filter(or_(BillDB.attachment_url.is_(None), BillDB.attachment_url == ""))
        if search:
            s = f"%{search.strip()}%"
            query = query.join(VendorDB, isouter=True).filter(
                or_(
                    BillDB.bill_number.ilike(s),
                    VendorDB.name.ilike(s),
                    BillDB.department.ilike(s),
                    BillDB.category.ilike(s),
                )
            )
        return (
            query.order_by(BillDB.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

    def update_attachment(
        self,
        bill_id: int,
        attachment_name: str,
        attachment_url: str,
        file_fingerprint: Optional[str] = None,
    ) -> Optional[BillDB]:
        bill = self.get_by_id(bill_id)
        if not bill:
            return None
        bill.attachment_name = attachment_name
        bill.attachment_url = attachment_url
        if file_fingerprint:
            bill.file_fingerprint = file_fingerprint
        self.db.commit()
        self.db.refresh(bill)
        return self._load_bill_full(bill_id)

    def delete_attachment(self, bill_id: int) -> Optional[BillDB]:
        bill = self.get_by_id(bill_id)
        if not bill:
            return None
        bill.attachment_name = None
        bill.attachment_url = None
        bill.file_fingerprint = None
        self.db.commit()
        self.db.refresh(bill)
        return self._load_bill_full(bill_id)

    def get_queue_counts(self, vendor_id: Optional[int] = None) -> dict:
        query = self.db.query(BillDB)
        if vendor_id is not None:
            query = query.filter(BillDB.vendor_id == vendor_id)
        bills = query.all()
        counts = {st: 0 for st in bs.BILL_STATUSES}
        counts["overdue"] = 0
        counts["all"] = 0
        for b in bills:
            st = (b.status or "").lower()
            if st not in bs.VALID_BILL_STATUSES:
                continue
            counts[st] += 1
            if st == bs.VOID:
                continue
            counts["all"] += 1
            if bs.is_overdue(st, b.due_date):
                counts["overdue"] += 1
        return counts

    def find_duplicate_candidates(
        self,
        vendor_id: Optional[int] = None,
        bill_number: Optional[str] = None,
        issue_date: Optional[str] = None,
        total: Optional[float] = None,
        file_fingerprint: Optional[str] = None,
        exclude_id: Optional[int] = None,
    ) -> List[dict]:
        candidates = []
        seen = set()

        def _clean_num(v: Optional[str]) -> str:
            if not v:
                return ""
            return "".join(c for c in v.lower() if c.isalnum())

        norm_num = _clean_num(bill_number)

        query = self.db.query(BillDB).options(joinedload(BillDB.vendor)).filter(BillDB.status != "void")
        if exclude_id is not None:
            query = query.filter(BillDB.id != exclude_id)

        all_bills = query.all()
        for b in all_bills:
            if b.id in seen:
                continue
            b_norm_num = _clean_num(b.bill_number)
            matched_field = None
            matching_val = ""

            # Check 1: File fingerprint match
            if file_fingerprint and b.file_fingerprint and file_fingerprint == b.file_fingerprint:
                matched_field = "file_fingerprint"
                matching_val = file_fingerprint[:16] + "..."
            # Check 2: Same vendor + matching normalized bill number
            elif vendor_id and b.vendor_id == vendor_id and norm_num and norm_num == b_norm_num:
                matched_field = "bill_number"
                matching_val = b.bill_number
            # Check 3: Same vendor + same total amount + same issue date
            elif (
                vendor_id
                and b.vendor_id == vendor_id
                and total is not None
                and abs(b.total - total) < 0.01
                and issue_date
                and b.issue_date == issue_date
            ):
                matched_field = "amount_and_date"
                matching_val = f"${b.total:.2f} on {b.issue_date}"

            if matched_field:
                seen.add(b.id)
                candidates.append({
                    "id": b.id,
                    "bill_number": b.bill_number,
                    "vendor_id": b.vendor_id,
                    "vendor_name": b.vendor.name if b.vendor else None,
                    "issue_date": b.issue_date,
                    "total": b.total,
                    "status": b.status,
                    "matched_field": matched_field,
                    "matching_value": matching_val,
                })
        return candidates

    def get_by_id(self, bill_id: int) -> Optional[BillDB]:
        return self._load_bill_full(bill_id)

    def get_by_number(self, bill_number: Optional[str]) -> Optional[BillDB]:
        if not bill_number or not bill_number.strip():
            return None
        return (
            self.db.query(BillDB)
            .filter(BillDB.bill_number == bill_number.strip())
            .first()
        )

    def list_payments(self, bill_id: int) -> List[PaymentDB]:
        return (
            self.db.query(PaymentDB)
            .filter(PaymentDB.related_bill_id == bill_id)
            .order_by(PaymentDB.payment_date.desc())
            .all()
        )

    # ------------------------------------------------------------------
    # Writes: Bill
    # ------------------------------------------------------------------
    def create(self, data: dict, lines_data: List[dict], commit: bool = True) -> BillDB:
        """Create a bill with its lines. Totals are computed from lines."""
        category_id = data.get("category_id")
        category_name = data.get("category", "Operating Expense")
        if category_id:
            cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.id == category_id).first()
            if cat:
                category_name = cat.name
        elif category_name:
            cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name.ilike(category_name.strip())).first()
            if cat:
                category_id = cat.id

        bill = BillDB(
            vendor_id=data.get("vendor_id"),
            bill_number=(data.get("bill_number") or "").strip() or None,
            category_id=category_id,
            category=category_name,
            issue_date=data.get("issue_date") or None,
            due_date=data.get("due_date") or None,
            status=data.get("status", bs.DRAFT),
            currency=data.get("currency", "EGP"),
            notes=data.get("notes", ""),
            capture_source=data.get("capture_source", "manual"),
            extraction_confidence=data.get("extraction_confidence"),
            missing_fields=data.get("missing_fields"),
            department=data.get("department"),
            legal_entity=data.get("legal_entity", "Voyance Health Inc"),
            attachment_url=data.get("attachment_url"),
            attachment_name=data.get("attachment_name"),
            file_fingerprint=data.get("file_fingerprint"),
            is_reviewed=data.get("is_reviewed", True),
            is_duplicate_override=data.get("is_duplicate_override", False),
            duplicate_override_reason=data.get("duplicate_override_reason"),
            created_by=data.get("created_by"),
            requires_approval=data.get("requires_approval", False),
            approval_status=data.get("approval_status"),
            approved_by=data.get("approved_by"),
            approved_at=data.get("approved_at"),
            approval_comment=data.get("approval_comment"),
            scheduled_payment_date=data.get("scheduled_payment_date"),
            amount_paid=data.get("amount_paid", 0.0),
            vendor_to_confirm=bool(data.get("vendor_to_confirm", False)),
            suggested_vendor_name=data.get("suggested_vendor_name"),
        )
        self.db.add(bill)
        self.db.flush()  # obtain bill.id before inserting lines

        db_lines = []
        for ln in lines_data:
            line_total = ln.get("line_total") or round(ln.get("quantity", 1.0) * ln.get("unit_price", 0.0), 4)
            db_line = BillLineDB(
                bill_id=bill.id,
                description=ln["description"].strip(),
                quantity=ln.get("quantity", 1.0),
                unit_price=ln.get("unit_price", 0.0),
                line_total=line_total,
            )
            self.db.add(db_line)
            db_lines.append(db_line)

        self.db.flush()
        subtotal, tax_amount, total = self._compute_totals(db_lines)
        bill.subtotal = subtotal
        bill.tax_amount = tax_amount
        bill.total = total

        if commit:
            self.db.commit()
        else:
            self.db.flush()
        return self._load_bill_full(bill.id)

    def update(self, bill_id: int, data: dict, lines_data: Optional[List[dict]] = None) -> Optional[BillDB]:
        """Update bill fields. If lines_data is provided, replace all lines."""
        bill = self.db.query(BillDB).filter(BillDB.id == bill_id).first()
        if not bill:
            return None

        if "vendor_id" in data and data["vendor_id"] is not None:
            bill.vendor_id = data["vendor_id"]
        if "bill_number" in data and data["bill_number"] is not None:
            bill.bill_number = data["bill_number"].strip()
        if "category_id" in data:
            bill.category_id = data["category_id"]
            if bill.category_id:
                cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.id == bill.category_id).first()
                if cat:
                    bill.category = cat.name
        elif "category" in data and data["category"] is not None:
            bill.category = data["category"]
            cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name.ilike(data["category"].strip())).first()
            if cat:
                bill.category_id = cat.id
        if "issue_date" in data and data["issue_date"] is not None:
            bill.issue_date = data["issue_date"]
        if "due_date" in data and data["due_date"] is not None:
            bill.due_date = data["due_date"]
        if "currency" in data and data["currency"] is not None:
            bill.currency = data["currency"]
        if "notes" in data and data["notes"] is not None:
            bill.notes = data["notes"]
        if "capture_source" in data and data["capture_source"] is not None:
            bill.capture_source = data["capture_source"]
        if "extraction_confidence" in data:
            bill.extraction_confidence = data["extraction_confidence"]
        if "missing_fields" in data:
            bill.missing_fields = data["missing_fields"]
        if "department" in data:
            bill.department = data["department"]
        if "legal_entity" in data:
            bill.legal_entity = data["legal_entity"]
        if "attachment_url" in data:
            bill.attachment_url = data["attachment_url"]
        if "attachment_name" in data:
            bill.attachment_name = data["attachment_name"]
        if "file_fingerprint" in data:
            bill.file_fingerprint = data["file_fingerprint"]
        if "is_reviewed" in data and data["is_reviewed"] is not None:
            bill.is_reviewed = data["is_reviewed"]
        if "is_duplicate_override" in data and data["is_duplicate_override"] is not None:
            bill.is_duplicate_override = data["is_duplicate_override"]
        if "duplicate_override_reason" in data:
            bill.duplicate_override_reason = data["duplicate_override_reason"]
        if "created_by" in data:
            bill.created_by = data["created_by"]
        if "requires_approval" in data and data["requires_approval"] is not None:
            bill.requires_approval = data["requires_approval"]
        if "approval_status" in data:
            bill.approval_status = data["approval_status"]
        if "approved_by" in data:
            bill.approved_by = data["approved_by"]
        if "approved_at" in data:
            bill.approved_at = data["approved_at"]
        if "approval_comment" in data:
            bill.approval_comment = data["approval_comment"]
        if "scheduled_payment_date" in data:
            bill.scheduled_payment_date = data["scheduled_payment_date"]
        if "amount_paid" in data and data["amount_paid"] is not None:
            bill.amount_paid = data["amount_paid"]
        if "vendor_to_confirm" in data and data["vendor_to_confirm"] is not None:
            bill.vendor_to_confirm = data["vendor_to_confirm"]
        if "suggested_vendor_name" in data:
            bill.suggested_vendor_name = data["suggested_vendor_name"]

        if lines_data is not None:
            # Replace all lines
            self.db.query(BillLineDB).filter(BillLineDB.bill_id == bill_id).delete()
            self.db.flush()
            new_lines = []
            for ln in lines_data:
                line_total = ln.get("line_total") or round(ln.get("quantity", 1.0) * ln.get("unit_price", 0.0), 4)
                db_line = BillLineDB(
                    bill_id=bill_id,
                    description=ln["description"].strip(),
                    quantity=ln.get("quantity", 1.0),
                    unit_price=ln.get("unit_price", 0.0),
                    line_total=line_total,
                )
                self.db.add(db_line)
                new_lines.append(db_line)
            self.db.flush()
            subtotal, tax_amount, total = self._compute_totals(new_lines)
            bill.subtotal = subtotal
            bill.tax_amount = tax_amount
            bill.total = total

        self.db.commit()
        return self._load_bill_full(bill_id)

    def set_status(self, bill_id: int, new_status: str, extra: Optional[dict] = None) -> Optional[BillDB]:
        """Persist a status chosen by BillsService / bill_status. The only write path for status."""
        bill = self.db.query(BillDB).filter(BillDB.id == bill_id).first()
        if not bill:
            return None
        bill.status = new_status
        for key, value in (extra or {}).items():
            setattr(bill, key, value)
        self.db.commit()
        return self._load_bill_full(bill_id)

    def delete_bill(self, bill_id: int) -> bool:
        """Hard-delete a bill and its lines. Only used to discard a Draft (D-019)."""
        bill = self.db.query(BillDB).filter(BillDB.id == bill_id).first()
        if not bill:
            return False
        self.db.delete(bill)
        self.db.commit()
        return True

    def count_unreversed_payments(self, bill_id: int) -> int:
        return (
            self.db.query(PaymentDB)
            .filter(PaymentDB.related_bill_id == bill_id, PaymentDB.is_reversed == False)  # noqa: E712
            .count()
        )

    # ------------------------------------------------------------------
    # Writes: Payment
    # ------------------------------------------------------------------
    def record_payment(self, data: dict, commit: bool = True) -> PaymentDB:
        """
        Record an outgoing payment against a bill through the settlement service (currency,
        balance and payment-type checks), then write the ledger row and recompute the account
        balance with recalculate_account_running_balances so backdated payments keep running
        balances correct. With commit=False the caller owns the transaction (create-and-pay).
        """
        from finance.services.settlement_service import SettlementService
        from finance.repositories.ledger_repository import LedgerRepository

        bill_id = data.get("related_bill_id")
        if not bill_id:
            raise ValueError("A bill payment must reference a bill")

        settlement_svc = SettlementService(self.db)
        bill, payment = settlement_svc.settle_bill(
            bill_id=bill_id,
            amount=data["amount"],
            payment_date=data["payment_date"],
            bank_account_id=data["bank_account_id"],
            payment_type_id=data.get("payment_type_id"),
            reference=data.get("reference") or "",
            cheque_number=data.get("cheque_number"),
        )
        self.db.flush()

        payment_type = None
        if data.get("payment_type_id"):
            payment_type = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.id == data["payment_type_id"]).first()
        else:
            account = self.db.query(FinanceBankAccountDB).filter(FinanceBankAccountDB.id == data["bank_account_id"]).first()
            code = rules.DEFAULT_PAYMENT_TYPE_CODE_BY_ACCOUNT_TYPE.get((account.account_type or "bank").lower()) if account else None
            payment_type = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.code == code).first() if code else None

        # Record corresponding ledger transaction for single source of truth (FUX-411)
        bill_cat = None
        if bill.category_id:
            bill_cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.id == bill.category_id).first()
        if not bill_cat:
            logger.warning(
                f"[FUX-411] Bill #{bill.id} ({bill.bill_number}) has missing or invalid category_id at payment time. Explicitly falling back to 'Other'."
            )
            bill_cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name == "Other").first()

        vendor = self.db.query(VendorDB).filter(VendorDB.id == bill.vendor_id).first() if bill.vendor_id else None
        vendor_name = vendor.name if vendor else None
        details = (data.get("details") or "").strip() or vendor_name or f"Bill {bill.bill_number}"

        ledger_tx = LedgerTransactionDB(
            account_id=payment.bank_account_id,
            date=payment.payment_date,
            amount=payment.amount,
            direction="out",
            currency=payment.currency,
            category_id=bill_cat.id if bill_cat else None,
            payment_type_id=payment_type.id if payment_type else None,
            reference=(data.get("reference") or "").strip(),
            description=details,
            cheque_number=(data.get("cheque_number") or "").strip() or None,
            payee_type="vendor" if vendor else "none",
            payee_id=vendor.id if vendor else None,
            payee_name=vendor_name,
            source="bill_payment",
            linked_bill_id=bill.id,
            running_balance=0.0,
            created_by=data.get("created_by"),
        )
        self.db.add(ledger_tx)
        self.db.flush()
        LedgerRepository(self.db).recalculate_account_running_balances(payment.bank_account_id, commit=False)

        if commit:
            self.db.commit()
            self.db.refresh(payment)
        return payment

    def reverse_payment(
        self, bill_id: int, payment_id: int, reason: str, reversed_by: Optional[str] = None
    ) -> PaymentDB:
        """
        Atomically reverse a recorded bill payment.
        Restores the bank account balance, creates a reversal ledger entry,
        marks the payment as reversed, and recalculates the bill status.
        """
        payment = (
            self.db.query(PaymentDB)
            .filter(PaymentDB.id == payment_id, PaymentDB.related_bill_id == bill_id)
            .first()
        )
        if not payment:
            raise ValueError(f"Payment {payment_id} not found for bill {bill_id}")
        if payment.is_reversed:
            raise ValueError(f"Payment {payment_id} has already been reversed")

        bank_account = (
            self.db.query(FinanceBankAccountDB)
            .filter(FinanceBankAccountDB.id == payment.bank_account_id)
            .first()
        )
        if not bank_account:
            raise ValueError(f"Bank account {payment.bank_account_id} not found")

        bill = self.db.query(BillDB).filter(BillDB.id == bill_id).first()
        if not bill:
            raise ValueError(f"Bill {bill_id} not found")

        # 1. Mark payment as reversed
        payment.is_reversed = True
        payment.reversed_at = datetime.utcnow()
        payment.reversed_by = reversed_by
        payment.reversal_reason = reason.strip()

        # 2. Add reversal ledger entry; balances come from the ledger, never set directly
        ledger_tx = LedgerTransactionDB(
            account_id=bank_account.id,
            date=datetime.utcnow().strftime("%Y-%m-%d"),
            amount=payment.amount,
            direction="in" if payment.direction == "outgoing" else "out",
            currency=payment.currency,
            reference=payment.reference or f"REV-PAY-{payment.id}",
            description=f"Reversal of payment #{payment.id}: {reason.strip()}",
            source="bill_payment_reversal",
            linked_bill_id=bill_id,
            running_balance=0.0,
            created_by=reversed_by,
        )
        self.db.add(ledger_tx)
        self.db.flush()
        LedgerRepository(self.db).recalculate_account_running_balances(bank_account.id, commit=False)

        # 3. Recalculate bill amount_paid and status
        self.db.flush()
        remaining_payments = [
            p for p in self.list_payments(bill_id) if not p.is_reversed and p.id != payment.id
        ]
        paid_remaining = sum(p.amount for p in remaining_payments)
        bill.amount_paid = round(paid_remaining, 2)

        if bill.amount_paid <= 0.001:
            bill.amount_paid = 0.0
        bill.status = bs.derive_payment_status(bill, amount_paid=bill.amount_paid)

        self.db.commit()
        self.db.refresh(payment)
        return payment

    # ------------------------------------------------------------------
    # FUX-411: Category Data-Quality Report
    # ------------------------------------------------------------------
    def get_category_quality_report(self) -> dict:
        """
        Data-quality pass identifying bills whose category is unmatched
        or miscategorized historically as 'Other', providing full audit visibility.
        """
        bills = (
            self.db.query(BillDB)
            .options(joinedload(BillDB.vendor), joinedload(BillDB.transaction_category))
            .order_by(BillDB.id.asc())
            .all()
        )
        matched_count = 0
        unmatched_bills = []
        for b in bills:
            cat_name = b.transaction_category.name if b.transaction_category else None
            if b.category_id is not None:
                matched_count += 1
            else:
                v_name = b.vendor.name if b.vendor else None
                unmatched_bills.append({
                    "id": b.id,
                    "bill_number": b.bill_number,
                    "vendor_id": b.vendor_id,
                    "vendor_name": v_name,
                    "category_id": b.category_id,
                    "category_name": cat_name,
                    "raw_category": b.category,
                    "issue_date": b.issue_date,
                    "total": b.total,
                    "status": b.status,
                })
        return {
            "total_bills": len(bills),
            "matched_count": matched_count,
            "unmatched_count": len(unmatched_bills),
            "unmatched_bills": unmatched_bills,
        }
