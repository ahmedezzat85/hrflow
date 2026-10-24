"""
be/finance/services/payroll_read_service.py
Service interface for querying persisted payroll lines and runs for an employee.
Extracted from ReportsService to allow shared reading across Finance and Analytics domains.
"""
from typing import List, Tuple, Optional
from sqlalchemy.orm import Session
from finance.models import PayrollLineDB, PayrollRunDB


class PayrollReadService:
    def __init__(self, db: Session):
        self.db = db

    def get_employee_pay_lines(
        self,
        employee_id: int,
        start: Optional[str] = None,
        end: Optional[str] = None,
        currency: Optional[str] = None,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
    ) -> List[Tuple[PayrollLineDB, PayrollRunDB]]:
        """
        Query non-cancelled payroll lines and associated runs for a given employee,
        optionally filtered by period overlap (start/end) and currency.
        Returns a list of (PayrollLineDB, PayrollRunDB) tuples ordered by
        period_start ascending, line id ascending.
        """
        s_date = start or start_date
        e_date = end or end_date

        query = (
            self.db.query(PayrollLineDB, PayrollRunDB)
            .join(PayrollRunDB, PayrollLineDB.payroll_run_id == PayrollRunDB.id)
            .filter(PayrollLineDB.employee_id == employee_id)
            .filter(PayrollRunDB.status != "cancelled")
        )

        if s_date:
            query = query.filter(PayrollRunDB.period_end >= s_date)
        if e_date:
            query = query.filter(PayrollRunDB.period_start <= e_date)
        if currency and currency.upper() != "ALL":
            query = query.filter(PayrollRunDB.currency == currency.upper())

        return query.order_by(PayrollRunDB.period_start.asc(), PayrollLineDB.id.asc()).all()

    def get_available_currencies(self, employee_id: int) -> List[str]:
        """
        Returns a sorted list of unique currencies present in non-cancelled payroll runs
        for the given employee.
        """
        rows = (
            self.db.query(PayrollRunDB.currency)
            .join(PayrollLineDB, PayrollLineDB.payroll_run_id == PayrollRunDB.id)
            .filter(
                PayrollLineDB.employee_id == employee_id,
                PayrollRunDB.status != "cancelled",
            )
            .distinct()
            .all()
        )
        currencies = sorted({r[0] for r in rows if r[0]})
        return currencies if currencies else ["USD"]
