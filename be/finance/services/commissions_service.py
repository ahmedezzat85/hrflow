"""
be/finance/services/commissions_service.py
Sales commissions: accrual when an invoice becomes fully paid, voiding when a receipt reversal un-pays it,
salesperson management, and the quarterly report.

Rules:
- Commission is earned on the invoice's net subtotal (VAT excluded) at the customer's rate when the invoice becomes Paid.
- Rate and base are snapshotted on the commission row; later customer changes never rewrite it.
- One accrued row per invoice. A receipt reversal that leaves the invoice un-paid voids the row (kept for audit).
- Amounts stay in the invoice currency (no conversion); reports total each currency separately.
- A customer without a salesperson, or with a 0 rate, earns nothing.
"""
from calendar import monthrange
from datetime import date, datetime
from typing import Dict, List, Optional, Tuple

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from finance.models import CommissionSettlementDB, CustomerDB, SalesCommissionDB, SalesInvoiceDB, SalespersonDB
from finance.schemas import (
    CommissionLine,
    CommissionPeriod,
    CommissionQuarterReport,
    CommissionSalespersonReport,
    CommissionTotal,
    SalespersonCreate,
    SalespersonResponse,
    SalespersonUpdate,
    SettlementCreate,
    SettlementResponse,
)

SETTLED = "settled"
UNDONE = "undone"
ACCRUED = "accrued"
VOID = "void"


def commission_amount(base: float, rate: float) -> float:
    return round(float(base or 0.0) * float(rate or 0.0) / 100.0, 2)


def accrue_for_paid_invoice(db: Session, invoice: SalesInvoiceDB, earned_date: str) -> Optional[SalesCommissionDB]:
    """Create the commission for an invoice that just became Paid. Caller owns the commit. Idempotent per invoice."""
    customer = db.query(CustomerDB).filter(CustomerDB.id == invoice.customer_id).first()
    if not customer or not customer.salesperson_id or not (customer.commission_rate or 0) > 0:
        return None
    existing = (
        db.query(SalesCommissionDB)
        .filter(SalesCommissionDB.invoice_id == invoice.id, SalesCommissionDB.status == ACCRUED)
        .first()
    )
    if existing:
        return existing
    base = round(float(invoice.subtotal or 0.0), 2)
    row = SalesCommissionDB(
        salesperson_id=customer.salesperson_id,
        customer_id=customer.id,
        invoice_id=invoice.id,
        currency=invoice.currency,
        base_amount=base,
        rate=float(customer.commission_rate),
        amount=commission_amount(base, customer.commission_rate),
        earned_date=str(earned_date)[:10],
        status=ACCRUED,
    )
    db.add(row)
    return row


def void_for_invoice(db: Session, invoice_id: int, reason: str) -> int:
    """Void the accrued commission of an invoice that is no longer fully paid. Caller owns the commit."""
    rows = (
        db.query(SalesCommissionDB)
        .filter(SalesCommissionDB.invoice_id == invoice_id, SalesCommissionDB.status == ACCRUED)
        .all()
    )
    for r in rows:
        r.status = VOID
        r.void_reason = reason
        r.voided_at = datetime.utcnow()
    return len(rows)


def quarter_bounds(year: int, quarter: int) -> Tuple[str, str]:
    if quarter not in (1, 2, 3, 4):
        raise HTTPException(status_code=400, detail="quarter must be 1, 2, 3 or 4")
    first_month = (quarter - 1) * 3 + 1
    last_month = first_month + 2
    return f"{year:04d}-{first_month:02d}-01", f"{year:04d}-{last_month:02d}-{monthrange(year, last_month)[1]:02d}"


def _totals(lines: List[CommissionLine]) -> List[CommissionTotal]:
    acc: Dict[str, List[float]] = {}
    for ln in lines:
        t = acc.setdefault(ln.currency, [0, 0.0, 0.0])
        t[0] += 1
        t[1] += ln.base_amount
        t[2] += ln.amount
    return [
        CommissionTotal(currency=c, count=v[0], base_amount=round(v[1], 2), amount=round(v[2], 2))
        for c, v in sorted(acc.items())
    ]


class CommissionsService:
    def __init__(self, db: Session):
        self.db = db

    # --- salespeople ---------------------------------------------------------------------------------------
    def _salesperson_response(self, sp: SalespersonDB, customer_count: int = 0) -> SalespersonResponse:
        employee_name = None
        if sp.employee_id:
            from models_db import EmployeeDB
            emp = self.db.query(EmployeeDB).filter(EmployeeDB.id == sp.employee_id).first()
            employee_name = emp.name if emp else None
        return SalespersonResponse(
            id=sp.id, name=sp.name, email=sp.email, employee_id=sp.employee_id, notes=sp.notes,
            settlement_frequency=sp.settlement_frequency or "quarterly",
            employee_name=employee_name, is_active=sp.is_active, customer_count=customer_count, created_at=sp.created_at,
        )

    def _check_employee(self, employee_id: Optional[int]) -> None:
        if employee_id:
            from models_db import EmployeeDB
            if not self.db.query(EmployeeDB).filter(EmployeeDB.id == employee_id).first():
                raise HTTPException(status_code=404, detail=f"Employee {employee_id} not found")

    def _name_taken(self, name: str, exclude_id: Optional[int] = None) -> bool:
        q = self.db.query(SalespersonDB).filter(func.lower(SalespersonDB.name) == name.strip().lower())
        if exclude_id:
            q = q.filter(SalespersonDB.id != exclude_id)
        return q.first() is not None

    def list_salespeople(self, is_active: Optional[bool] = None) -> List[SalespersonResponse]:
        q = self.db.query(SalespersonDB)
        if is_active is not None:
            q = q.filter(SalespersonDB.is_active == is_active)
        counts = dict(
            self.db.query(CustomerDB.salesperson_id, func.count(CustomerDB.id))
            .filter(CustomerDB.salesperson_id.isnot(None), CustomerDB.is_active == True)  # noqa: E712
            .group_by(CustomerDB.salesperson_id)
            .all()
        )
        return [self._salesperson_response(sp, counts.get(sp.id, 0)) for sp in q.order_by(SalespersonDB.name).all()]

    def create_salesperson(self, payload: SalespersonCreate) -> SalespersonResponse:
        if self._name_taken(payload.name):
            raise HTTPException(status_code=400, detail=f"A salesperson named '{payload.name}' already exists")
        self._check_employee(payload.employee_id)
        sp = SalespersonDB(
            name=payload.name.strip(),
            email=(payload.email or "").strip() or None,
            employee_id=payload.employee_id or None,
            notes=(payload.notes or "").strip() or None,
            settlement_frequency=payload.settlement_frequency or ("monthly" if payload.employee_id else "quarterly"),
        )
        self.db.add(sp)
        self.db.commit()
        self.db.refresh(sp)
        return self._salesperson_response(sp)

    def update_salesperson(self, salesperson_id: int, payload: SalespersonUpdate) -> SalespersonResponse:
        sp = self.db.query(SalespersonDB).filter(SalespersonDB.id == salesperson_id).first()
        if not sp:
            raise HTTPException(status_code=404, detail=f"Salesperson {salesperson_id} not found")
        data = payload.model_dump(exclude_unset=True)
        if data.get("name") is not None:
            if self._name_taken(data["name"], exclude_id=sp.id):
                raise HTTPException(status_code=400, detail=f"A salesperson named '{data['name']}' already exists")
            sp.name = data["name"].strip()
        if "email" in data:
            sp.email = (data["email"] or "").strip() or None
        if "employee_id" in data:
            self._check_employee(data["employee_id"])
            sp.employee_id = data["employee_id"] or None
        if "notes" in data:
            sp.notes = (data["notes"] or "").strip() or None
        if data.get("settlement_frequency"):
            sp.settlement_frequency = data["settlement_frequency"]
        if data.get("is_active") is not None:
            sp.is_active = bool(data["is_active"])
        self.db.commit()
        self.db.refresh(sp)
        return self._salesperson_response(sp)

    # --- commissions ---------------------------------------------------------------------------------------
    def list_commissions(
        self,
        salesperson_id: Optional[int] = None,
        start: Optional[str] = None,
        end: Optional[str] = None,
        status: Optional[str] = ACCRUED,
    ) -> List[CommissionLine]:
        q = (
            self.db.query(SalesCommissionDB, SalespersonDB.name, CustomerDB.name, SalesInvoiceDB.invoice_number)
            .join(SalespersonDB, SalespersonDB.id == SalesCommissionDB.salesperson_id)
            .join(CustomerDB, CustomerDB.id == SalesCommissionDB.customer_id)
            .join(SalesInvoiceDB, SalesInvoiceDB.id == SalesCommissionDB.invoice_id)
        )
        if salesperson_id:
            q = q.filter(SalesCommissionDB.salesperson_id == salesperson_id)
        if status and status != "all":
            q = q.filter(SalesCommissionDB.status == status)
        if start:
            q = q.filter(SalesCommissionDB.earned_date >= start)
        if end:
            q = q.filter(SalesCommissionDB.earned_date <= end)
        q = q.order_by(SalespersonDB.name, SalesCommissionDB.earned_date, SalesInvoiceDB.invoice_number)
        return [
            CommissionLine(
                id=c.id, salesperson_id=c.salesperson_id, salesperson_name=sp_name, customer_id=c.customer_id,
                customer_name=cust_name, invoice_id=c.invoice_id, invoice_number=inv_no, currency=c.currency,
                base_amount=c.base_amount, rate=c.rate, amount=c.amount, earned_date=c.earned_date,
                status=c.status, void_reason=c.void_reason, settlement_id=c.settlement_id,
            )
            for c, sp_name, cust_name, inv_no in q.all()
        ]

    # --- settlement ----------------------------------------------------------------------------------------
    @staticmethod
    def _period_label(start: str, end: str) -> str:
        months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        s, e = int(start[5:7]), int(end[5:7])
        return f"{months[s - 1]} {start[:4]}" if s == e else f"Q{(s - 1) // 3 + 1} {start[:4]}"

    @staticmethod
    def _parse(value: str, field: str) -> date:
        try:
            return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail=f"{field} must be a date (YYYY-MM-DD)")

    def _check_period(self, frequency: str, start: str, end: str) -> None:
        s, e = self._parse(start, "period_start"), self._parse(end, "period_end")
        if frequency == "monthly":
            ok = s.day == 1 and e == date(s.year, s.month, monthrange(s.year, s.month)[1])
        else:
            ok = s.day == 1 and s.month in (1, 4, 7, 10) and e == date(s.year, s.month + 2, monthrange(s.year, s.month + 2)[1])
        if not ok:
            raise HTTPException(
                status_code=400,
                detail=f"This salesperson is settled {frequency}: the period must be a whole calendar {'month' if frequency == 'monthly' else 'quarter'}",
            )

    def _settlement_response(self, st: CommissionSettlementDB) -> SettlementResponse:
        rows = self.list_commissions(salesperson_id=st.salesperson_id, status="all")
        lines = [r for r in rows if r.settlement_id == st.id]
        return SettlementResponse(
            id=st.id, salesperson_id=st.salesperson_id, period_start=st.period_start, period_end=st.period_end,
            settled_date=st.settled_date, reference=st.reference, notes=st.notes, settled_by=st.settled_by,
            status=st.status, line_count=len(lines), totals=_totals(lines),
        )

    def settle(self, payload: SettlementCreate, actor: Optional[str] = None) -> SettlementResponse:
        sp = self.db.query(SalespersonDB).filter(SalespersonDB.id == payload.salesperson_id).first()
        if not sp:
            raise HTTPException(status_code=404, detail=f"Salesperson {payload.salesperson_id} not found")
        self._check_period(sp.settlement_frequency or "quarterly", payload.period_start, payload.period_end)
        self._parse(payload.settled_date, "settled_date")
        rows = (
            self.db.query(SalesCommissionDB)
            .filter(
                SalesCommissionDB.salesperson_id == sp.id,
                SalesCommissionDB.status == ACCRUED,
                SalesCommissionDB.settlement_id.is_(None),
                SalesCommissionDB.earned_date >= payload.period_start,
                SalesCommissionDB.earned_date <= payload.period_end,
            )
            .all()
        )
        if not rows:
            raise HTTPException(status_code=400, detail="Nothing to settle: no unsettled commissions in this period")
        st = CommissionSettlementDB(
            salesperson_id=sp.id, period_start=payload.period_start, period_end=payload.period_end,
            settled_date=payload.settled_date[:10], reference=(payload.reference or "").strip() or None,
            notes=(payload.notes or "").strip() or None, settled_by=actor, status=SETTLED,
        )
        self.db.add(st)
        self.db.flush()
        for r in rows:
            r.settlement_id = st.id
        self.db.commit()
        self.db.refresh(st)
        return self._settlement_response(st)

    def undo_settlement(self, settlement_id: int, actor: Optional[str] = None) -> SettlementResponse:
        st = self.db.query(CommissionSettlementDB).filter(CommissionSettlementDB.id == settlement_id).first()
        if not st:
            raise HTTPException(status_code=404, detail=f"Settlement {settlement_id} not found")
        if st.status != SETTLED:
            raise HTTPException(status_code=409, detail="This settlement was already undone")
        for r in self.db.query(SalesCommissionDB).filter(SalesCommissionDB.settlement_id == st.id).all():
            r.settlement_id = None
        st.status = UNDONE
        st.undone_at = datetime.utcnow()
        st.undone_by = actor
        self.db.commit()
        self.db.refresh(st)
        return self._settlement_response(st)

    # --- report --------------------------------------------------------------------------------------------
    def quarter_report(self, year: int, quarter: int, salesperson_id: Optional[int] = None) -> CommissionQuarterReport:
        start, end = quarter_bounds(year, quarter)
        lines = self.list_commissions(salesperson_id=salesperson_id, start=start, end=end, status=ACCRUED)
        freq = {sp.id: sp.settlement_frequency or "quarterly" for sp in self.db.query(SalespersonDB).all()}
        settlements = (
            self.db.query(CommissionSettlementDB)
            .filter(CommissionSettlementDB.status == SETTLED, CommissionSettlementDB.period_start >= start, CommissionSettlementDB.period_end <= end)
            .all()
        )
        grouped: Dict[int, List[CommissionLine]] = {}
        for ln in lines:
            grouped.setdefault(ln.salesperson_id, []).append(ln)

        def period_of(sid: int, earned: str) -> Tuple[str, str]:
            if freq.get(sid) == "monthly":
                y, m = int(earned[:4]), int(earned[5:7])
                return f"{y:04d}-{m:02d}-01", f"{y:04d}-{m:02d}-{monthrange(y, m)[1]:02d}"
            return start, end

        people = []
        for sid, group in grouped.items():
            by_period: Dict[Tuple[str, str], List[CommissionLine]] = {}
            for ln in group:
                by_period.setdefault(period_of(sid, ln.earned_date), []).append(ln)
            periods = []
            for (ps, pe), plines in sorted(by_period.items()):
                sts = [self._settlement_response(s) for s in settlements if s.salesperson_id == sid and s.period_start == ps and s.period_end == pe]
                periods.append(CommissionPeriod(
                    period_start=ps, period_end=pe, label=self._period_label(ps, pe), totals=_totals(plines), lines=plines,
                    unsettled_count=sum(1 for l in plines if l.settlement_id is None), settlements=sts,
                ))
            people.append(CommissionSalespersonReport(
                salesperson_id=sid, salesperson_name=group[0].salesperson_name, settlement_frequency=freq.get(sid, "quarterly"),
                totals=_totals(group), lines=group, periods=periods,
            ))
        people.sort(key=lambda p: p.salesperson_name.lower())
        return CommissionQuarterReport(
            year=year, quarter=quarter, period_start=start, period_end=end, salespeople=people, grand_totals=_totals(lines)
        )
