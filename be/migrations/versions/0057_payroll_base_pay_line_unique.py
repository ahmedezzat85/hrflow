"""0057_payroll_base_pay_line_unique

Database redesign, Stage 4b: an employee has at most one base pay line per payroll run and component
(`external_usd`, `internal_usd_cash`), enforced by the unique index `uq_payroll_lines_base_pay`.

Commission and bonus lines are NOT covered: the payroll flow lets several of them exist for one employee in one run
(several deals or bonuses, FUX-418; tests/test_finance_payroll_commission_bonus.py), so a unique rule over every line
type would break a documented feature.

Existing data is checked first. A duplicated base pay line would pay the same component twice and cannot be repaired
automatically, so the upgrade stops and lists every duplicate; fix them and upgrade again
(`python scripts/audit_db_integrity.py` reports `dup:payroll_lines`). The downgrade drops the index.

Revision ID: 0057_payroll_base_pay_line_unique
Revises: 0056_integrity_constraints
Create Date: 2026-10-30 16:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0057_payroll_base_pay_line_unique'
down_revision: Union[str, None] = '0056_integrity_constraints'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX = "uq_payroll_lines_base_pay"
TABLE = "finance_payroll_lines"
WHERE = "compensation_type IN ('external_usd', 'internal_usd_cash')"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE not in inspector.get_table_names():
        return
    if INDEX in {ix["name"] for ix in inspector.get_indexes(TABLE)}:
        return
    dups = bind.execute(sa.text(
        f"SELECT payroll_run_id, employee_id, compensation_type, COUNT(*) FROM {TABLE} WHERE {WHERE} "
        "GROUP BY payroll_run_id, employee_id, compensation_type HAVING COUNT(*) > 1")).fetchall()
    if dups:
        listing = "\n  ".join(f"run {r} / employee {e} / {t}: {n} lines" for r, e, t, n in dups[:50])
        raise RuntimeError(
            f"{len(dups)} base pay line group(s) appear more than once; fix them, then upgrade again "
            f"(python scripts/audit_db_integrity.py reports dup:payroll_lines):\n  {listing}"
        )
    op.create_index(INDEX, TABLE, ["payroll_run_id", "employee_id", "compensation_type"], unique=True,
                    sqlite_where=sa.text(WHERE), postgresql_where=sa.text(WHERE))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if TABLE in inspector.get_table_names() and INDEX in {ix["name"] for ix in inspector.get_indexes(TABLE)}:
        op.drop_index(INDEX, table_name=TABLE)
