"""
be/repositories/sql/invoices.py
Backward-compatibility alias pointing to salary_payment_docs.py.
"""
from repositories.sql.salary_payment_docs import (
    SqlSalaryPaymentDocRepository,
    SqlInvoiceRepository,
    _doc_to_dict,
    _invoice_to_dict,
)

__all__ = [
    "SqlSalaryPaymentDocRepository",
    "SqlInvoiceRepository",
    "_doc_to_dict",
    "_invoice_to_dict",
]
