"""
routers/invoices.py
Backward-compatibility alias pointing to salary_payment_docs.py.
"""
from routers.salary_payment_docs import (
    router,
    compat_router,
    preview_eligible_employees,
    generate_invoices,
    generate_invoice_single,
    list_invoices,
    get_invoice,
    stream_invoice_pdf,
)

__all__ = [
    "router",
    "compat_router",
    "preview_eligible_employees",
    "generate_invoices",
    "generate_invoice_single",
    "list_invoices",
    "get_invoice",
    "stream_invoice_pdf",
]
