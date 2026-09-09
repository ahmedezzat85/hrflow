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
        vendor_id: Optional[int] = None,
        search: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[BillDB]:
        query = (
            self.db.query(BillDB)
            .options(joinedload(BillDB.lines), joinedload(BillDB.vendor))
        )
        if status:
            query = query.filter(BillDB.status == status)
        if vendor_id is not None:
            query = query.filter(BillDB.vendor_id == vendor_id)
        if search:
            s = f"%{search.strip()}%"
            query = query.join(VendorDB, isouter=True).filter(
                or_(
                    BillDB.bill_number.ilike(s),
                    VendorDB.name.ilike(s),
                )
            )
        return (
            query.order_by(BillDB.created_at.desc())
            .offset(offset)
            .limit(limit)
            .all()
        )

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
            status=data.get("status", "unpaid"),
            currency=data.get("currency", "USD"),
            notes=data.get("notes", ""),
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
        if "notes" in data:
            bill.notes = data["notes"]

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
        if data.get("related_bill_id"):
            bill = self.db.query(BillDB).filter(
                BillDB.id == data["related_bill_id"]
            ).first()
            if bill and bill.status not in ("void", "paid"):
                existing_payments = self.list_payments(bill.id)
                paid_so_far = sum(p.amount for p in existing_payments)
                if paid_so_far + payment.amount >= bill.total:
                    bill.status = "paid"

        self.db.commit()
        self.db.refresh(payment)
        return payment
