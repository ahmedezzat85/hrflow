"""
be/finance/repositories/bills_repository.py
SQLAlchemy-backed repository for Vendor Bills, Bill Lines, and
outgoing Payments (Accounts Payable side).

Conventions (matches Phase 4.3 InvoicesRepository pattern):
 - All write operations commit and refresh before returning.
 - No hard deletes — bills are voided, not deleted.
 - Balance adjustment on Payment is done here so it stays atomic with the Payment insert.
"""
from typing import List, Optional
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import or_

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
        limit: int = 50,
        offset: int = 0,
    ) -> List[BillDB]:
        query = (
            self.db.query(BillDB)
            .options(joinedload(BillDB.lines), joinedload(BillDB.vendor))
        )
        if queue:
            q_norm = queue.lower().strip()
            if q_norm == "inbox":
                query = query.filter(BillDB.status == "inbox")
            elif q_norm == "needs_coding":
                query = query.filter(BillDB.status == "needs_coding")
            elif q_norm == "needs_approval":
                query = query.filter(BillDB.status == "needs_approval")
            elif q_norm == "ready_to_pay":
                query = query.filter(BillDB.status.in_(["ready_to_pay", "unpaid"]))
            elif q_norm == "scheduled":
                query = query.filter(BillDB.status == "scheduled")
            elif q_norm == "paid":
                query = query.filter(BillDB.status == "paid")
            elif q_norm == "exceptions":
                query = query.filter(BillDB.status == "exceptions")
            elif q_norm == "all":
                query = query.filter(BillDB.status != "void")
        elif status:
            query = query.filter(BillDB.status == status)

        if vendor_id is not None:
            query = query.filter(BillDB.vendor_id == vendor_id)
        if search:
            s = f"%{search.strip()}%"
            query = query.join(VendorDB, isouter=True).filter(
                or_(
                    BillDB.bill_number.ilike(s),
                    VendorDB.name.ilike(s),
                    BillDB.department.ilike(s),
                )
            )
        return (
            query.order_by(BillDB.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

    def get_queue_counts(self, vendor_id: Optional[int] = None) -> dict:
        query = self.db.query(BillDB)
        if vendor_id is not None:
            query = query.filter(BillDB.vendor_id == vendor_id)
        bills = query.all()
        counts = {
            "inbox": 0,
            "needs_coding": 0,
            "needs_approval": 0,
            "ready_to_pay": 0,
            "scheduled": 0,
            "paid": 0,
            "exceptions": 0,
            "all": 0,
        }
        for b in bills:
            if b.status == "void":
                continue
            counts["all"] += 1
            st = (b.status or "").lower()
            if st in counts:
                counts[st] += 1
            elif st == "unpaid":
                counts["ready_to_pay"] += 1
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

    def get_by_number(self, bill_number: str) -> Optional[BillDB]:
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
    def create(self, data: dict, lines_data: List[dict]) -> BillDB:
        """Create a bill with its lines. Totals are computed from lines."""
        bill = BillDB(
            vendor_id=data["vendor_id"],
            bill_number=data["bill_number"].strip(),
            category=data.get("category", "Operating Expense"),
            issue_date=data["issue_date"],
            due_date=data["due_date"],
            status=data.get("status", "inbox"),
            currency=data.get("currency", "USD"),
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

        self.db.commit()
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
        if "category" in data and data["category"] is not None:
            bill.category = data["category"]
        if "issue_date" in data and data["issue_date"] is not None:
            bill.issue_date = data["issue_date"]
        if "due_date" in data and data["due_date"] is not None:
            bill.due_date = data["due_date"]
        if "status" in data and data["status"] is not None:
            bill.status = data["status"]
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

        if lines_data is not None:
            # Replace all lines
            self.db.query(BillLineDB).filter(BillLineDB.bill_id == bill_id).delete()
            db_lines = []
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
                db_lines.append(db_line)
            self.db.flush()
            subtotal, tax_amount, total = self._compute_totals(db_lines)
            bill.subtotal = subtotal
            bill.tax_amount = tax_amount
            bill.total = total

        self.db.commit()
        return self._load_bill_full(bill_id)

    def void_bill(self, bill_id: int) -> Optional[BillDB]:
        """Void a bill (soft-delete via status change)."""
        return self.update(bill_id, {"status": "void"})

    # ------------------------------------------------------------------
    # Writes: Payment
    # ------------------------------------------------------------------
    def record_payment(self, data: dict) -> PaymentDB:
        """
        Record an outgoing payment against a bill.
        Adjusts the bank account's current_balance atomically (-amount for outgoing).
        After a full payment, marks the bill as 'paid' if the payment covers it.
        """
        bank_account = (
            self.db.query(FinanceBankAccountDB)
            .filter(FinanceBankAccountDB.id == data["bank_account_id"])
            .first()
        )
        if not bank_account:
            raise ValueError(f"Bank account {data['bank_account_id']} not found")

        payment = PaymentDB(
            direction=data.get("direction", "outgoing"),
            related_invoice_id=data.get("related_invoice_id"),
            related_bill_id=data.get("related_bill_id"),
            amount=data["amount"],
            currency=data.get("currency", "USD"),
            payment_date=data["payment_date"],
            bank_account_id=data["bank_account_id"],
            method=data.get("method", "bank_transfer"),
            reference=data.get("reference", ""),
        )
        self.db.add(payment)

        # Adjust balance: incoming → credit, outgoing → debit
        if payment.direction == "incoming":
            bank_account.current_balance = round(bank_account.current_balance + payment.amount, 4)
        else:
            bank_account.current_balance = round(bank_account.current_balance - payment.amount, 4)

        # Auto-mark bill as paid if this payment covers remaining total
        bill = None
        if data.get("related_bill_id"):
            bill = self.db.query(BillDB).filter(
                BillDB.id == data["related_bill_id"]
            ).first()
            if bill and bill.status not in ("void", "paid"):
                existing_payments = self.list_payments(bill.id)
                paid_so_far = sum(p.amount for p in existing_payments)
                if paid_so_far + payment.amount >= bill.total:
                    bill.status = "paid"

        # Record corresponding ledger transaction for single source of truth
        bill_cat = None
        if bill and bill.category:
            bill_cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name.ilike(bill.category.strip())).first()
        if not bill_cat:
            bill_cat = self.db.query(TransactionCategoryDB).filter(TransactionCategoryDB.name == "Other").first()
        outbound_pt = self.db.query(PaymentTypeDB).filter(PaymentTypeDB.code == "OUTBOUND_TRANS").first()

        ledger_tx = LedgerTransactionDB(
            account_id=bank_account.id,
            date=payment.payment_date,
            amount=payment.amount,
            direction="in" if payment.direction == "incoming" else "out",
            currency=payment.currency,
            category_id=bill_cat.id if bill_cat else None,
            payment_type_id=outbound_pt.id if outbound_pt else None,
            reference=bill.bill_number if bill else (payment.reference or ""),
            description=f"Payment for bill #{bill.bill_number}" if bill else (payment.reference or f"Outgoing payment #{payment.id}"),
            source="bill_payment",
            linked_bill_id=payment.related_bill_id,
            running_balance=bank_account.current_balance,
            created_at=payment.created_at,
        )
        self.db.add(ledger_tx)

        self.db.commit()
        self.db.refresh(payment)
        return payment
