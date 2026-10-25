"""
be/tests/fx_test_helpers.py
Payroll no longer falls back to a silent 50.0 USD-EGP rate (FX-1). Tests that generate or preview a run without
passing a manual rate seed one explicit USD-to-EGP transfer dated before every period they use.
"""
from db import get_session_factory
from finance.models import AccountTransferDB

EARLY_DATE = "2000-01-01"


def seed_usd_egp_rate(rate: float = 50.0) -> None:
    """Insert one settled USD-to-EGP transfer at `rate` (idempotent for the same rate)."""
    session = get_session_factory()()
    try:
        exists = (
            session.query(AccountTransferDB)
            .filter(AccountTransferDB.date == EARLY_DATE, AccountTransferDB.from_currency == "USD",
                    AccountTransferDB.to_currency == "EGP")
            .first()
        )
        if not exists:
            session.add(AccountTransferDB(
                date=EARLY_DATE, from_amount=1000.0, from_currency="USD", to_amount=1000.0 * rate,
                to_currency="EGP", fx_rate=rate, transfer_type="same_bank_fx", note="test rate",
            ))
            session.commit()
    finally:
        session.close()
