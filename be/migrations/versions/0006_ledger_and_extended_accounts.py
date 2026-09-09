"""0006_ledger_and_extended_accounts

Revision ID: 0006_ledger_and_extended_accounts
Revises: 0005_customer_vendor_is_active
Create Date: 2026-09-09 16:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0006_ledger_and_extended_accounts'
down_revision: Union[str, None] = '0005_customer_vendor_is_active'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. Extend finance_bank_accounts with account_type and country
    if 'finance_bank_accounts' in tables:
        acc_cols = [c['name'] for c in inspector.get_columns('finance_bank_accounts')]
        if 'account_type' not in acc_cols:
            op.add_column(
                'finance_bank_accounts',
                sa.Column('account_type', sa.String(length=20), server_default='bank', nullable=False)
            )
        if 'country' not in acc_cols:
            op.add_column(
                'finance_bank_accounts',
                sa.Column('country', sa.String(length=100), server_default='Egypt', nullable=True)
            )

    # 2. Create finance_ledger_transactions table
    if 'finance_ledger_transactions' not in tables:
        op.create_table(
            'finance_ledger_transactions',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('account_id', sa.Integer(), nullable=False),
            sa.Column('date', sa.String(length=20), nullable=False),
            sa.Column('amount', sa.Float(), nullable=False),
            sa.Column('direction', sa.String(length=20), nullable=False),
            sa.Column('currency', sa.String(length=10), nullable=False, server_default='USD'),
            sa.Column('category', sa.String(length=100), nullable=False, server_default='other'),
            sa.Column('description', sa.String(length=255), nullable=False, server_default=''),
            sa.Column('source', sa.String(length=50), nullable=False, server_default='manual'),
            sa.Column('linked_invoice_id', sa.Integer(), nullable=True),
            sa.Column('linked_bill_id', sa.Integer(), nullable=True),
            sa.Column('running_balance', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('created_by', sa.String(length=255), nullable=True),
            sa.ForeignKeyConstraint(['account_id'], ['finance_bank_accounts.id'], ondelete='RESTRICT'),
            sa.ForeignKeyConstraint(['linked_invoice_id'], ['finance_sales_invoices.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['linked_bill_id'], ['finance_bills.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_finance_ledger_transactions_account_id'), 'finance_ledger_transactions', ['account_id'], unique=False)
        op.create_index(op.f('ix_finance_ledger_transactions_date'), 'finance_ledger_transactions', ['date'], unique=False)
        op.create_index(op.f('ix_finance_ledger_transactions_source'), 'finance_ledger_transactions', ['source'], unique=False)
        op.create_index(op.f('ix_finance_ledger_transactions_linked_invoice_id'), 'finance_ledger_transactions', ['linked_invoice_id'], unique=False)
        op.create_index(op.f('ix_finance_ledger_transactions_linked_bill_id'), 'finance_ledger_transactions', ['linked_bill_id'], unique=False)

    # 3. Backfill historical invoice and bill payments into finance_ledger_transactions
    if 'finance_bank_accounts' in tables:
        accounts_res = bind.execute(sa.text("SELECT id, opening_balance FROM finance_bank_accounts")).fetchall()
        running_balances = {acc[0]: float(acc[1] or 0.0) for acc in accounts_res}

        if 'finance_payments' in tables:
            payments_res = bind.execute(sa.text(
                "SELECT id, direction, related_invoice_id, related_bill_id, amount, currency, payment_date, bank_account_id, reference, created_at "
                "FROM finance_payments ORDER BY payment_date ASC, id ASC"
            )).fetchall()

            invoices_map = {}
            if 'finance_sales_invoices' in tables:
                inv_rows = bind.execute(sa.text("SELECT id, invoice_number FROM finance_sales_invoices")).fetchall()
                invoices_map = {row[0]: row[1] for row in inv_rows}

            bills_map = {}
            if 'finance_bills' in tables:
                bill_rows = bind.execute(sa.text("SELECT id, bill_number FROM finance_bills")).fetchall()
                bills_map = {row[0]: row[1] for row in bill_rows}

            ledger_table = sa.table(
                'finance_ledger_transactions',
                sa.column('account_id', sa.Integer),
                sa.column('date', sa.String),
                sa.column('amount', sa.Float),
                sa.column('direction', sa.String),
                sa.column('currency', sa.String),
                sa.column('category', sa.String),
                sa.column('description', sa.String),
                sa.column('source', sa.String),
                sa.column('linked_invoice_id', sa.Integer),
                sa.column('linked_bill_id', sa.Integer),
                sa.column('running_balance', sa.Float),
                sa.column('created_at', sa.DateTime),
                sa.column('created_by', sa.String),
            )

            for p in payments_res:
                p_id, p_dir, rel_inv, rel_bill, amount, curr, p_date, acc_id, ref, created_at = p
                amount = float(amount or 0.0)
                if p_dir == "incoming":
                    direction = "in"
                    source = "invoice_payment" if rel_inv else "manual"
                    category = "revenue"
                    desc = f"Payment for invoice #{invoices_map.get(rel_inv, rel_inv)}" if rel_inv else (ref or f"Incoming payment #{p_id}")
                    current_run = running_balances.get(acc_id, 0.0) + amount
                else:
                    direction = "out"
                    source = "bill_payment" if rel_bill else "manual"
                    category = "cost"
                    desc = f"Payment for bill #{bills_map.get(rel_bill, rel_bill)}" if rel_bill else (ref or f"Outgoing payment #{p_id}")
                    current_run = running_balances.get(acc_id, 0.0) - amount

                running_balances[acc_id] = round(current_run, 4)

                op.bulk_insert(ledger_table, [{
                    'account_id': acc_id,
                    'date': p_date or '',
                    'amount': amount,
                    'direction': direction,
                    'currency': curr or 'USD',
                    'category': category,
                    'description': desc,
                    'source': source,
                    'linked_invoice_id': rel_inv,
                    'linked_bill_id': rel_bill,
                    'running_balance': running_balances[acc_id],
                    'created_at': created_at,
                    'created_by': 'migration_backfill',
                }])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    if 'finance_ledger_transactions' in tables:
        op.drop_table('finance_ledger_transactions')

    if 'finance_bank_accounts' in tables:
        acc_cols = [c['name'] for c in inspector.get_columns('finance_bank_accounts')]
        if 'country' in acc_cols:
            op.drop_column('finance_bank_accounts', 'country')
        if 'account_type' in acc_cols:
            op.drop_column('finance_bank_accounts', 'account_type')
