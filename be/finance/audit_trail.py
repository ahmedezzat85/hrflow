"""
be/finance/audit_trail.py
Automatic audit trail for finance records (audit 2026-11, finding H-4).

Most finance services wrote no audit entry, so "who changed this cheque, rule or customer, and when" had no answer.
Instead of a call in every service action, an after_flush hook on every Session writes one audit_log row per finance
record that the flush inserted, changed or deleted:

    action       finance.<table without the finance_ prefix>.<created|updated|deleted>, e.g. finance.cheques.updated
    actor_email  the signed-in user (auth.get_current_user puts it on the request's Session as info["actor_email"]);
                 empty when the write did not come from a request (scripts, background jobs): never invented
    target_type  the table name, target_id the primary key
    details      JSON: {"values": {...}} for a new record, {"changes": {field: {"from", "to"}}} for a change,
                 {"removed": {...}} for a deletion

The rows go into the same database transaction as the change, so a rolled-back change leaves no audit row and a
committed one always has its row. Named entries some services already write (invoice.sent, bill.approved,
finance.transfer.voided, payroll.run.approved, ...) are kept; this trail is the floor under them.

Not recorded: derived values the system recomputes (running and current balances, timestamps), tables whose service
already audits every change in full (payroll runs and lines, compensation plans), the export audit table itself, and
the raw bank rows of a statement import (their later resolution is recorded). Bank account numbers and IBANs are
masked to their last four characters.
"""
import json
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import event, inspect
from sqlalchemy.orm import Session

ACTOR_KEY = "actor_email"

# Recomputed by the system, not decided by a person
IGNORED_FIELDS = frozenset({"running_balance", "current_balance", "created_at", "updated_at"})
# Audited in full by their own services, or an audit table already
SKIPPED_TABLES = frozenset({
    "finance_payroll_runs", "finance_payroll_lines", "finance_employee_compensation_plans", "finance_export_audits",
})
# Inserted in bulk from an uploaded file; changes and deletions are still recorded
SKIPPED_INSERTS = frozenset({"finance_statement_lines"})
MASKED_FIELDS = frozenset({"account_number", "iban"})
_MAX_TEXT = 300


def set_actor(session: Session, email) -> None:
    """Called by authentication for the request's Session."""
    if email:
        session.info[ACTOR_KEY] = email


def _plain(field, value):
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "<binary>"
    text = str(value)
    if field in MASKED_FIELDS:
        return ("****" + text[-4:]) if len(text) > 4 else "****"
    return text if len(text) <= _MAX_TEXT else text[:_MAX_TEXT] + "..."


def _table(obj):
    table = getattr(obj, "__tablename__", "") or ""
    return table if table.startswith("finance_") and table not in SKIPPED_TABLES else None


def _fields(obj):
    return [a.key for a in inspect(obj).mapper.column_attrs if a.key not in IGNORED_FIELDS]


def _values(obj):
    """Only what is already loaded: reading an expired attribute of a deleted record would query a row that is gone."""
    loaded = inspect(obj).dict
    out = {}
    for f in _fields(obj):
        v = _plain(f, loaded.get(f))
        if v is not None:
            out[f] = v
    return out


def _changes(obj):
    state = inspect(obj)
    out = {}
    for f in _fields(obj):
        hist = state.attrs[f].history
        if not hist.has_changes():
            continue
        old = hist.deleted[0] if hist.deleted else None
        new = hist.added[0] if hist.added else None
        old, new = _plain(f, old), _plain(f, new)
        if old != new:
            out[f] = {"from": old, "to": new}
    return out


def _pk(obj):
    """From the row's own key columns: a record inserted by this flush has no identity key yet."""
    state = inspect(obj)
    ident = [v for v in (state.identity or state.mapper.primary_key_from_instance(obj)) if v is not None]
    if not ident:
        return ""
    return str(ident[0]) if len(ident) == 1 else ",".join(str(i) for i in ident)


@event.listens_for(Session, "after_flush")
def _write_finance_audit_rows(session: Session, flush_context) -> None:
    rows = []
    for obj in session.new:
        table = _table(obj)
        if table and table not in SKIPPED_INSERTS:
            rows.append((table, "created", obj, {"values": _values(obj)}))
    for obj in session.dirty:
        table = _table(obj)
        if not table or obj in session.deleted or not session.is_modified(obj, include_collections=False):
            continue
        changes = _changes(obj)
        if changes:
            rows.append((table, "updated", obj, {"changes": changes}))
    for obj in session.deleted:
        table = _table(obj)
        if table:
            rows.append((table, "deleted", obj, {"removed": _values(obj)}))
    if not rows:
        return

    from models_db import AuditLogDB

    stamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    actor = session.info.get(ACTOR_KEY) or ""
    session.connection().execute(AuditLogDB.__table__.insert(), [
        {
            "timestamp": stamp,
            "actor_email": actor,
            "action": f"finance.{table[len('finance_'):]}.{op}",
            "target_type": table,
            "target_id": _pk(obj),
            "details": json.dumps(details, default=str, sort_keys=True),
        }
        for table, op, obj, details in rows
    ])
