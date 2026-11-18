"""
be/finance/services/vat_statutory_sync.py
Keeps the sales-tax (VAT) statutory obligation in step with issued sales invoices (D-060).

An invoice that carries VAT owes it to the tax authority once it is issued (sent), so the tracker (Finance > Spend >
Statutory) must show it without anyone re-typing it. One `sales_tax` obligation exists per issue month and currency
(`source_type = invoice_tax_line`, the key the D-023 "Generate VAT estimate" button already uses); it holds the sum of
the VAT of that month's sent / partially paid / paid invoices. It is due on the last day of the calendar quarter of that
month. The sum is recomputed from the invoices every time (never incremented), so a repeated call cannot double count.

Only an `estimated` obligation is rewritten. Once the user has confirmed the portal figure (accrued) or paid any of it,
the row is left alone and `sync_vat_obligation` returns a notice for the caller to show.
"""
import calendar
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from finance.models import SalesInvoiceDB, StatutoryObligationDB

logger = logging.getLogger(__name__)

VAT_SOURCE_TYPE = "invoice_tax_line"
VAT_INVOICE_STATUSES = ("sent", "partially_paid", "paid")


def quarter_end_date(issue_date: str) -> str:
    """Last day of the calendar quarter that contains `issue_date` (YYYY-MM-DD)."""
    year, month = int(issue_date[0:4]), int(issue_date[5:7])
    end_month = ((month - 1) // 3 + 1) * 3
    return f"{year:04d}-{end_month:02d}-{calendar.monthrange(year, end_month)[1]:02d}"


def month_vat_total(db: Session, period: str, currency: str):
    """(sum of invoice VAT, number of invoices carrying VAT) for sent/partially paid/paid invoices issued in `period`."""
    invoices = (
        db.query(SalesInvoiceDB)
        .filter(
            SalesInvoiceDB.currency == currency,
            SalesInvoiceDB.status.in_(VAT_INVOICE_STATUSES),
            SalesInvoiceDB.issue_date >= f"{period}-01",
            SalesInvoiceDB.issue_date <= f"{period}-31",
        )
        .all()
    )
    with_vat = [i for i in invoices if float(i.tax_amount or 0.0) > 0]
    return round(sum(float(i.tax_amount or 0.0) for i in with_vat), 2), len(with_vat)


def find_vat_obligation(db: Session, period: str, currency: str) -> Optional[StatutoryObligationDB]:
    return (
        db.query(StatutoryObligationDB)
        .filter(
            StatutoryObligationDB.obligation_type == "sales_tax",
            StatutoryObligationDB.period == period,
            StatutoryObligationDB.source_type == VAT_SOURCE_TYPE,
            StatutoryObligationDB.currency == currency,
        )
        .first()
    )


def sync_vat_obligation(db: Session, issue_date: str, currency: str) -> Optional[str]:
    """
    Recomputes the sales-tax obligation of the invoice's issue month and currency. Commits.
    Returns a notice (str) when the obligation can no longer be changed and differs from the invoices, else None.
    """
    period = (issue_date or "")[:7]
    currency = (currency or "").upper()
    if len(period) != 7 or not currency:
        return None
    total, count = month_vat_total(db, period, currency)
    obligation = find_vat_obligation(db, period, currency)
    note = f"VAT from {count} {currency} invoice(s) issued in {period}"

    if obligation is None:
        if total <= 0:
            return None
        db.add(
            StatutoryObligationDB(
                obligation_type="sales_tax",
                period=period,
                amount_estimated=total,
                amount_accrued=total,
                amount_remitted=0.0,
                variance_amount=0.0,
                currency=currency,
                status="estimated",
                due_date=quarter_end_date(f"{period}-01"),
                source_type=VAT_SOURCE_TYPE,
                notes=note,
                created_at=datetime.utcnow(),
                updated_at=datetime.utcnow(),
            )
        )
        db.commit()
        return None

    if obligation.status != "estimated":
        if round(float(obligation.amount_accrued or 0.0), 2) == total:
            return None
        return (
            f"The {period} sales tax obligation is already {obligation.status} at "
            f"{float(obligation.amount_accrued or 0.0):,.2f} {currency}, while this month's invoices now carry "
            f"{total:,.2f} {currency} VAT. It was left unchanged: adjust it in the Statutory tracker."
        )

    if total <= 0:
        db.delete(obligation)  # estimated, never remitted: nothing is owed any more
    else:
        obligation.amount_estimated = total
        obligation.amount_accrued = total
        obligation.variance_amount = 0.0
        obligation.notes = note
        obligation.updated_at = datetime.utcnow()
    db.commit()
    return None


def sync_vat_obligation_safely(db: Session, invoice: SalesInvoiceDB) -> Optional[str]:
    """Never fails the invoice action that already committed: a sync error is logged and reported as a notice."""
    try:
        return sync_vat_obligation(db, invoice.issue_date, invoice.currency)
    except Exception:  # noqa: BLE001
        db.rollback()
        logger.exception("VAT obligation sync failed for invoice %s", getattr(invoice, "id", None))
        return "The invoice was saved, but its VAT could not be added to the Statutory tracker. Use Generate VAT estimate to retry."
