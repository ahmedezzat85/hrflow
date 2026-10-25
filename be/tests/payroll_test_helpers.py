"""Shared payroll test helpers: funding accounts now live in Payroll Settings, not on each request."""
from db import get_db_context
from finance.models import PayrollSettingsDB


def _settings_row(db):
    row = db.query(PayrollSettingsDB).filter(PayrollSettingsDB.id == 1).first()
    if not row:
        row = PayrollSettingsDB(id=1, employee_rate=0.11, employer_rate=0.18, updated_by="test")
        db.add(row)
        db.flush()
    return row


def set_funding_accounts_in(db, external_id, internal_id=None):
    """Set both Payroll Settings funding accounts on an open session (flushes, caller commits)."""
    row = _settings_row(db)
    row.external_funding_account_id = external_id
    row.internal_funding_account_id = internal_id or external_id
    db.flush()


def set_funding_accounts(external_id, internal_id=None):
    """Set both Payroll Settings funding accounts in its own transaction."""
    with get_db_context() as db:
        set_funding_accounts_in(db, external_id, internal_id)
        db.commit()
