"""0043_employee_personal_details

Employee personal details (D-036, slice S2): adds nullable legal_name, phone, id_type and id_number to
`employees` (address_line_1/2 already exist) and backfills legal_name from name so local databases stay
valid. Idempotent; the downgrade drops the four columns.

Revision ID: 0043_employee_personal_details
Revises: 0042_invoice_scans
Create Date: 2026-10-21 18:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0043_employee_personal_details'
down_revision: Union[str, None] = '0042_invoice_scans'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    ('legal_name', sa.String(length=255)),
    ('phone', sa.String(length=32)),
    ('id_type', sa.String(length=20)),
    ('id_number', sa.String(length=40)),
)


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if 'employees' not in insp.get_table_names():
        return
    existing = {c['name'] for c in insp.get_columns('employees')}
    for name, type_ in _COLUMNS:
        if name not in existing:
            op.add_column('employees', sa.Column(name, type_, nullable=True))
    op.execute("UPDATE employees SET legal_name = name WHERE legal_name IS NULL")


def downgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if 'employees' not in insp.get_table_names():
        return
    existing = {c['name'] for c in insp.get_columns('employees')}
    with op.batch_alter_table('employees') as batch:
        for name, _type in _COLUMNS:
            if name in existing:
                batch.drop_column(name)
