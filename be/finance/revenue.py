"""
be/finance/revenue.py
Revenue sources (D-029): the editable list and the seed. Invoice receipts always carry the Invoice source.
"""
from typing import Dict

from sqlalchemy.orm import Session

from finance.models import RevenueSourceDB

INVOICE = "invoice"
SEED_SOURCES = (
    (INVOICE, "Invoice", 1, True),
    ("stripe_payout", "Stripe payout", 2, False),
    ("direct_transfer", "Direct transfer", 3, False),
    ("cash", "Cash", 4, False),
    ("other", "Other", 5, False),
)


def ensure_sources(db: Session) -> Dict[str, RevenueSourceDB]:
    """Idempotently create the seed sources; returns every source by code."""
    existing = {s.code: s for s in db.query(RevenueSourceDB).all()}
    changed = False
    for code, name, order, system in SEED_SOURCES:
        if code not in existing:
            existing[code] = RevenueSourceDB(code=code, name=name, sort_order=order, is_active=True, is_system=system)
            db.add(existing[code])
            changed = True
    if changed:
        db.commit()
    return existing


def invoice_source_id(db: Session) -> int:
    return ensure_sources(db)[INVOICE].id
