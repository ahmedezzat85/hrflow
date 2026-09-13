"""
be/repositories/dual/salary_payment_docs.py
DualWriteInvoiceRepository
"""
from typing import Optional, List, Dict, Any, Union
from logging_config import get_logger

from repositories.interfaces import InvoiceRepository, SalaryPaymentDocRepository
from repositories.sheets.salary_payment_docs import SheetsInvoiceRepository
from repositories.sql.salary_payment_docs import SqlInvoiceRepository

logger = get_logger("dual_write")


class DualWriteInvoiceRepository:
    def __init__(self, primary: Optional[InvoiceRepository] = None, shadow: Optional[InvoiceRepository] = None):
        self.primary = primary or SqlInvoiceRepository()
        self.shadow = shadow or SheetsInvoiceRepository()

    def list_all(
        self,
        employee_id: Optional[Union[int, str]] = None,
        payment_year: Optional[int] = None,
        payment_month: Optional[int] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        return self.primary.list_all(
            employee_id=employee_id,
            payment_year=payment_year,
            payment_month=payment_month,
            status=status,
        )

    def get_by_id(self, invoice_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        return self.primary.get_by_id(invoice_id)

    def find_existing(
        self,
        employee_id: Union[int, str],
        payment_year: int,
        payment_month: int,
    ) -> Optional[Dict[str, Any]]:
        return self.primary.find_existing(employee_id, payment_year, payment_month)

    def create(self, data: Dict[str, Any]) -> int:
        inv_id = self.primary.create(data)
        try:
            self.shadow.create(data)
        except Exception:
            logger.exception("Dual-write shadow create invoice failed for %s", data.get("invoice_number"))
        return inv_id

    def update(self, invoice_id: Union[int, str], updates: Dict[str, Any]) -> bool:
        res = self.primary.update(invoice_id, updates)
        try:
            self.shadow.update(invoice_id, updates)
        except Exception:
            logger.exception("Dual-write shadow update invoice failed for id=%s", invoice_id)
        return res

