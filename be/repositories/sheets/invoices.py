"""
be/repositories/sheets/invoices.py
Sheets-backed implementation of InvoiceRepository.
"""
from typing import Optional, List, Dict, Any, Union

import sheets_client


class SheetsInvoiceRepository:
    def __init__(self, client=None):
        self._client = client

    @property
    def client(self):
        return self._client or sheets_client.get_client()

    def list_all(
        self,
        employee_id: Optional[Union[int, str]] = None,
        payment_year: Optional[int] = None,
        payment_month: Optional[int] = None,
        status: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        invoices = self.client.get_all_records("Invoices")
        if employee_id is not None:
            invoices = [i for i in invoices if str(i.get("employee_id")) == str(employee_id)]
        if payment_year is not None:
            invoices = [i for i in invoices if str(i.get("payment_year")) == str(payment_year)]
        if payment_month is not None:
            invoices = [i for i in invoices if str(i.get("payment_month")) == str(payment_month)]
        if status is not None:
            invoices = [i for i in invoices if i.get("status") == status]
        invoices.sort(key=lambda i: str(i.get("created_at", "")), reverse=True)
        return invoices

    def get_by_id(self, invoice_id: Union[int, str]) -> Optional[Dict[str, Any]]:
        invoices = self.client.get_all_records("Invoices")
        return next((i for i in invoices if str(i.get("id")) == str(invoice_id)), None)

    def find_existing(
        self,
        employee_id: Union[int, str],
        payment_year: int,
        payment_month: int,
    ) -> Optional[Dict[str, Any]]:
        invoices = self.client.get_all_records("Invoices")
        emp_str = str(employee_id)
        year_str = str(payment_year)
        month_str = str(payment_month)
        for inv in invoices:
            if (
                str(inv.get("employee_id")) == emp_str
                and str(inv.get("payment_year")) == year_str
                and str(inv.get("payment_month")) == month_str
            ):
                return inv
        return None

    def create(self, data: Dict[str, Any]) -> int:
        new_id = self.client.next_id("Invoices")
        record = dict(data)
        record["id"] = new_id
        self.client.append_row("Invoices", record)
        return new_id

    def update(self, invoice_id: Union[int, str], updates: Dict[str, Any]) -> bool:
        return self.client.update_row_by_match("Invoices", "id", invoice_id, updates)

