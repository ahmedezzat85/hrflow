"""0044_payroll_funding_accounts

Payroll Settings own the funding accounts (owner rule, docs/finance-module/payroll-funding-account-settings-plan.md):
adds nullable external_funding_account_id and internal_funding_account_id to `finance_payroll_settings`
(FK to finance_bank_accounts, ON DELETE SET NULL). No backfill: existing databases start with the accounts unset
and a Financial-Admin sets them once. Idempotent; the downgrade drops both columns.

Revision ID: 0044_payroll_funding_accounts
Revises: 0043_employee_personal_details
Create Date: 2026-10-25 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0044_payroll_funding_accounts'
down_revision: Union[str, None] = '0043_employee_personal_details'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = 'finance_payroll_settings'
_COLUMNS = ('external_funding_account_id', 'internal_funding_account_id')


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if _TABLE not in insp.get_table_names():
        return
    existing = {c['name'] for c in insp.get_columns(_TABLE)}
    missing = [name for name in _COLUMNS if name not in existing]
    if not missing:
        return
    with op.batch_alter_table(_TABLE) as batch:
        for name in missing:
            batch.add_column(sa.Column(name, sa.Integer(), nullable=True))
            batch.create_foreign_key(
                f'fk_{_TABLE}_{name}', 'finance_bank_accounts', [name], ['id'], ondelete='SET NULL'
            )


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if _TABLE not in insp.get_table_names():
        return
    existing = {c['name'] for c in insp.get_columns(_TABLE)}
    present = [name for name in _COLUMNS if name in existing]
    if not present:
        return
    # Databases built from the models (create_all) carry unnamed foreign keys; only drop the ones this migration named.
    named = {fk['name'] for fk in insp.get_foreign_keys(_TABLE) if fk.get('name')}
    with op.batch_alter_table(_TABLE) as batch:
        for name in present:
            if f'fk_{_TABLE}_{name}' in named:
                batch.drop_constraint(f'fk_{_TABLE}_{name}', type_='foreignkey')
            batch.drop_column(name)
