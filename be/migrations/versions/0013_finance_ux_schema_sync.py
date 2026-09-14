"""0013_finance_ux_schema_sync

Revision ID: 0013_finance_ux_schema_sync
Revises: 0012_create_bank_statement_imports
Create Date: 2026-09-14 11:00:00.000000

Syncs all finance domain tables and columns added during Phases 1-8 UX transformation:
- Adds missing customer and vendor profile columns (legal_name, address, terms, etc.)
- Adds AP bill processing, approval workflow, and duplicate override columns
- Adds banking, ledger, cheque lifecycle, and transfer settlement columns
- Adds subscription management and variance tracking columns
- Adds statement import reconciliation state and period close columns
- Adds guided payroll run, line item, and liability snapshot columns
- Creates missing tables: finance_vendor_payment_instructions, finance_statement_mapping_templates,
  finance_reconciliation_rules, finance_attention_reviews, finance_saved_report_views,
  finance_export_audits, finance_report_schedules.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

# Revision identifiers, used by Alembic.
revision: str = '0013_finance_ux_schema_sync'
down_revision: Union[str, None] = '0012_create_bank_statement_imports'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    existing_tables = set(inspector.get_table_names())

    # Import Base and models to inspect target schema
    import db
    import models_db  # noqa: F401
    import finance.models  # noqa: F401

    # 1. Create any missing tables defined in Base metadata
    db.Base.metadata.create_all(bind=bind)

    # Refresh inspector after table creation
    inspector = inspect(bind)

    # 2. Synchronize missing columns on existing tables
    for t_name, table in db.Base.metadata.tables.items():
        if t_name in existing_tables:
            current_cols = {c['name'] for c in inspector.get_columns(t_name)}
            for col in table.columns:
                if col.name not in current_cols:
                    # Clone column definition safely with nullable=True for SQLite compatibility
                    col_type = col.type
                    server_default = None
                    if col.server_default is not None:
                        server_default = col.server_default
                    elif col.default is not None and getattr(col.default, 'arg', None) is not None:
                        arg_val = col.default.arg
                        if isinstance(arg_val, (int, float)):
                            server_default = sa.text(str(arg_val))
                        elif isinstance(arg_val, bool):
                            server_default = sa.text('1' if arg_val else '0')
                        elif isinstance(arg_val, str):
                            server_default = sa.text(f"'{arg_val}'")

                    op.add_column(
                        t_name,
                        sa.Column(
                            col.name,
                            col_type,
                            nullable=True,
                            server_default=server_default,
                        ),
                    )


def downgrade() -> None:
    pass
