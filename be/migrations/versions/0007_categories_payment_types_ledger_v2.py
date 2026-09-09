"""0007_categories_payment_types_ledger_v2

Revision ID: 0007_categories_payment_types_ledger_v2
Revises: 0006_ledger_and_extended_accounts
Create Date: 2026-09-09 17:25:00.000000

"""
from typing import Sequence, Union
from datetime import datetime
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0007_categories_payment_types_ledger_v2'
down_revision: Union[str, None] = '0006_ledger_and_extended_accounts'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


SEED_CATEGORIES = [
    ("Revenue", "revenue", False, 1),
    ("Salaries", "cost", False, 2),
    ("Medical Insurance", "cost", False, 3),
    ("Kitchen Supplies", "cost", True, 4),
    ("Legal & Accountant", "cost", False, 5),
    ("Internet", "cost", False, 6),
    ("Landline", "cost", False, 7),
    ("Events", "cost", False, 8),
    ("Transportation", "cost", True, 9),
    ("Robot/R&D Equipment", "cost", False, 10),
    ("Taxes", "cost", False, 11),
    ("Social Insurance", "cost", False, 12),
    ("Rent", "cost", False, 13),
    ("Computers", "cost", False, 14),
    ("Bank Fees", "cost", False, 15),
    ("Electricity", "cost", False, 16),
    ("Other", "other", False, 17),
]

SEED_PAYMENT_TYPES = [
    ("Cash", "CASH", False, False),
    ("Cash Withdrawal", "CASHWITHDRAW", False, False),
    ("Cheque", "CHK", True, False),
    ("Internal Transfer", "INTTRANS", False, False),
    ("Inbound Transfer", "INBOUND_TRANS", False, False),
    ("Outbound Transfer", "OUTBOUND_TRANS", False, False),
    ("USD to EGP Conversion", "USDTOEGP", False, False),
    ("Debit Card", "DEBIT_CARD", False, False),
    ("Bank Fees", "BANK_FEES", False, True),
    ("Other", "OTHER", False, False),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. Create finance_transaction_categories
    if 'finance_transaction_categories' not in tables:
        op.create_table(
            'finance_transaction_categories',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('name', sa.String(length=100), nullable=False),
            sa.Column('kind', sa.String(length=20), nullable=False, server_default='other'),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
            sa.Column('sort_order', sa.Integer(), nullable=False, server_default='0'),
            sa.Column('is_petty', sa.Boolean(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_finance_transaction_categories_name'), 'finance_transaction_categories', ['name'], unique=True)

        # Seed categories
        cat_table = sa.table(
            'finance_transaction_categories',
            sa.column('name', sa.String),
            sa.column('kind', sa.String),
            sa.column('is_active', sa.Boolean),
            sa.column('sort_order', sa.Integer),
            sa.column('is_petty', sa.Boolean),
            sa.column('created_at', sa.DateTime),
        )
        op.bulk_insert(cat_table, [
            {
                'name': name,
                'kind': kind,
                'is_active': True,
                'sort_order': sort_order,
                'is_petty': is_petty,
                'created_at': datetime.utcnow(),
            }
            for name, kind, is_petty, sort_order in SEED_CATEGORIES
        ])

    # 2. Create finance_payment_types
    if 'finance_payment_types' not in tables:
        op.create_table(
            'finance_payment_types',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('name', sa.String(length=100), nullable=False),
            sa.Column('code', sa.String(length=50), nullable=False),
            sa.Column('requires_cheque_number', sa.Boolean(), nullable=False, server_default='0'),
            sa.Column('requires_bank_fee_flag', sa.Boolean(), nullable=False, server_default='0'),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_finance_payment_types_code'), 'finance_payment_types', ['code'], unique=True)

        # Seed payment types
        pt_table = sa.table(
            'finance_payment_types',
            sa.column('name', sa.String),
            sa.column('code', sa.String),
            sa.column('requires_cheque_number', sa.Boolean),
            sa.column('requires_bank_fee_flag', sa.Boolean),
            sa.column('is_active', sa.Boolean),
            sa.column('created_at', sa.DateTime),
        )
        op.bulk_insert(pt_table, [
            {
                'name': name,
                'code': code,
                'requires_cheque_number': req_chk,
                'requires_bank_fee_flag': req_fee,
                'is_active': True,
                'created_at': datetime.utcnow(),
            }
            for name, code, req_chk, req_fee in SEED_PAYMENT_TYPES
        ])

    # 3. Extend finance_ledger_transactions
    if 'finance_ledger_transactions' in tables:
        cols = [c['name'] for c in inspector.get_columns('finance_ledger_transactions')]
        if 'category_id' not in cols:
            op.add_column(
                'finance_ledger_transactions',
                sa.Column('category_id', sa.Integer(), nullable=True)
            )
            op.create_index(op.f('ix_finance_ledger_transactions_category_id'), 'finance_ledger_transactions', ['category_id'], unique=False)

        if 'payment_type_id' not in cols:
            op.add_column(
                'finance_ledger_transactions',
                sa.Column('payment_type_id', sa.Integer(), nullable=True)
            )
            op.create_index(op.f('ix_finance_ledger_transactions_payment_type_id'), 'finance_ledger_transactions', ['payment_type_id'], unique=False)

        if 'reference' not in cols:
            op.add_column(
                'finance_ledger_transactions',
                sa.Column('reference', sa.String(length=255), nullable=False, server_default='')
            )

        if 'fx_rate' not in cols:
            op.add_column(
                'finance_ledger_transactions',
                sa.Column('fx_rate', sa.Float(), nullable=True)
            )

        # Backfill default category_id and payment_type_id for existing ledger rows
        rev_cat = bind.execute(sa.text("SELECT id FROM finance_transaction_categories WHERE name = 'Revenue'")).scalar()
        other_cat = bind.execute(sa.text("SELECT id FROM finance_transaction_categories WHERE name = 'Other'")).scalar()
        inbound_pt = bind.execute(sa.text("SELECT id FROM finance_payment_types WHERE code = 'INBOUND_TRANS'")).scalar()
        outbound_pt = bind.execute(sa.text("SELECT id FROM finance_payment_types WHERE code = 'OUTBOUND_TRANS'")).scalar()

        if rev_cat and inbound_pt:
            bind.execute(sa.text(
                f"UPDATE finance_ledger_transactions SET category_id = {rev_cat}, payment_type_id = {inbound_pt} "
                f"WHERE direction = 'in' AND category_id IS NULL"
            ))
        if other_cat and outbound_pt:
            bind.execute(sa.text(
                f"UPDATE finance_ledger_transactions SET category_id = {other_cat}, payment_type_id = {outbound_pt} "
                f"WHERE direction = 'out' AND category_id IS NULL"
            ))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_ledger_transactions' in tables:
        cols = [c['name'] for c in inspector.get_columns('finance_ledger_transactions')]
        if 'fx_rate' in cols:
            op.drop_column('finance_ledger_transactions', 'fx_rate')
        if 'reference' in cols:
            op.drop_column('finance_ledger_transactions', 'reference')
        if 'payment_type_id' in cols:
            op.drop_column('finance_ledger_transactions', 'payment_type_id')
        if 'category_id' in cols:
            op.drop_column('finance_ledger_transactions', 'category_id')

    if 'finance_payment_types' in tables:
        op.drop_table('finance_payment_types')

    if 'finance_transaction_categories' in tables:
        op.drop_table('finance_transaction_categories')
