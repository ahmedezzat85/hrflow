"""0049_history_amounts_derived

Pay-change history keeps only the event (D-048). Drops the stored amounts and percentage from `salary_history`:
  previous_internal_usd, previous_external_usd, new_internal_usd, new_external_usd, pct_change
They are derived on read from the compensation plan: the new pay of a change dated D is the plan in force on D, the
previous pay is the plan in force on the day before. Nothing is written to the plan table; each history row whose
stored new amounts differ from the plan is listed in the migration log first, so nothing is lost silently.
The downgrade re-adds the columns and refills them from the plan the same way.

Revision ID: 0049_history_amounts_derived
Revises: 0048_pay_single_source
Create Date: 2026-10-27 15:00:00.000000

"""
import logging
from datetime import date, timedelta
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0049_history_amounts_derived'
down_revision: Union[str, None] = '0048_pay_single_source'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

AMOUNT_COLUMNS = ("previous_internal_usd", "previous_external_usd", "new_internal_usd", "new_external_usd")
COLUMNS = AMOUNT_COLUMNS + ("pct_change",)


def _columns(inspector, table):
    return [c["name"] for c in inspector.get_columns(table)] if table in inspector.get_table_names() else []


def _pay_on(bind, employee_id, day):
    """(internal, external) of the plan in force on day (YYYY-MM-DD)."""
    rows = bind.execute(sa.text(
        "SELECT component_type, amount FROM finance_employee_compensation_plans "
        "WHERE employee_id = :e AND effective_start_date <= :d AND (effective_end_date IS NULL OR effective_end_date >= :d)"
    ), {"e": employee_id, "d": day}).fetchall()
    internal = round(sum(float(a or 0.0) for c, a in rows if c == "internal_usd_cash"), 2)
    external = round(sum(float(a or 0.0) for c, a in rows if c == "external_usd"), 2)
    return internal, external


def _day_before(day):
    try:
        return (date.fromisoformat(str(day)[:10]) - timedelta(days=1)).isoformat()
    except ValueError:
        return str(day)


def _pct(prev_total, new_total):
    pct = round((new_total - prev_total) / prev_total * 100, 2) if prev_total > 0 else 0.0
    return f"{'+' if pct >= 0 else ''}{pct}%"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = _columns(inspector, "salary_history")
    if {"new_internal_usd", "new_external_usd"} <= set(cols) and "finance_employee_compensation_plans" in inspector.get_table_names():
        rows = bind.execute(sa.text(
            "SELECT id, employee_id, date, new_internal_usd, new_external_usd FROM salary_history ORDER BY id"
        )).fetchall()
        for row_id, emp_id, day, stored_int, stored_ext in rows:
            stored = (round(float(stored_int or 0.0), 2), round(float(stored_ext or 0.0), 2))
            derived = _pay_on(bind, emp_id, str(day or ""))
            if stored != derived:
                log.warning(
                    "pay history row %s (employee %s, %s): stored new internal/external %s, plan says %s; amounts are now derived from the plan",
                    row_id, emp_id, day, stored, derived,
                )
    drop = [c for c in COLUMNS if c in cols]
    if drop:
        with op.batch_alter_table("salary_history") as batch_op:
            for name in drop:
                batch_op.drop_column(name)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    cols = _columns(inspector, "salary_history")
    if not cols:
        return
    with op.batch_alter_table("salary_history") as batch_op:
        for name in AMOUNT_COLUMNS:
            if name not in cols:
                batch_op.add_column(sa.Column(name, sa.Float(), nullable=True, server_default="0"))
        if "pct_change" not in cols:
            batch_op.add_column(sa.Column("pct_change", sa.String(20), nullable=True, server_default=""))
    if "finance_employee_compensation_plans" not in sa.inspect(bind).get_table_names():
        return
    rows = bind.execute(sa.text("SELECT id, employee_id, date FROM salary_history ORDER BY id")).fetchall()
    for row_id, emp_id, day in rows:
        day = str(day or "")
        prev_int, prev_ext = _pay_on(bind, emp_id, _day_before(day))
        new_int, new_ext = _pay_on(bind, emp_id, day)
        bind.execute(sa.text(
            "UPDATE salary_history SET previous_internal_usd = :pi, previous_external_usd = :pe, "
            "new_internal_usd = :ni, new_external_usd = :ne, pct_change = :pct WHERE id = :id"
        ), {"pi": prev_int, "pe": prev_ext, "ni": new_int, "ne": new_ext,
            "pct": _pct(prev_int + prev_ext, new_int + new_ext), "id": row_id})
