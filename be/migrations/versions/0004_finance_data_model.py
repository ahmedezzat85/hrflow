"""0004_finance_data_model

Revision ID: 0004_finance_data_model
Revises: 0003_rbac_skeleton
Create Date: 2026-09-09 12:00:00.000000

"""
from typing import Sequence, Union
from datetime import datetime

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0004_finance_data_model'
down_revision: Union[str, None] = '0003_rbac_skeleton'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = inspector.get_table_names()

    # 1. finance_customers
    if 'finance_customers' not in tables:
        op.create_table(
            'finance_customers',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('name', sa.String(length=255), nullable=False),
            sa.Column('contact_email', sa.String(length=255), nullable=True),
            sa.Column('contact_phone', sa.String(length=50), nullable=True),
            sa.Column('tax_id', sa.String(length=100), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )

    # 2. finance_vendors
    if 'finance_vendors' not in tables:
        op.create_table(
            'finance_vendors',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('name', sa.String(length=255), nullable=False),
            sa.Column('contact_email', sa.String(length=255), nullable=True),
            sa.Column('contact_phone', sa.String(length=50), nullable=True),
            sa.Column('tax_id', sa.String(length=100), nullable=True),
            sa.Column('category', sa.String(length=100), nullable=True, server_default='General'),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )

    # 3. finance_bank_accounts
    if 'finance_bank_accounts' not in tables:
        op.create_table(
            'finance_bank_accounts',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('account_name', sa.String(length=100), nullable=False),
            sa.Column('bank_name', sa.String(length=100), nullable=False),
            sa.Column('account_number', sa.String(length=100), nullable=False),
            sa.Column('currency', sa.String(length=10), nullable=False, server_default='USD'),
            sa.Column('opening_balance', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('current_balance', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id')
        )

    # 4. finance_sales_invoices
    if 'finance_sales_invoices' not in tables:
        op.create_table(
            'finance_sales_invoices',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('customer_id', sa.Integer(), nullable=False),
            sa.Column('invoice_number', sa.String(length=50), nullable=False),
            sa.Column('issue_date', sa.String(length=20), nullable=False),
            sa.Column('due_date', sa.String(length=20), nullable=False),
            sa.Column('status', sa.String(length=30), nullable=False, server_default='draft'),
            sa.Column('currency', sa.String(length=10), nullable=False, server_default='USD'),
            sa.Column('subtotal', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('tax_amount', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('total', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['customer_id'], ['finance_customers.id'], ondelete='RESTRICT'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_finance_sales_invoices_invoice_number'), 'finance_sales_invoices', ['invoice_number'], unique=True)
        op.create_index(op.f('ix_finance_sales_invoices_status'), 'finance_sales_invoices', ['status'], unique=False)
        op.create_index(op.f('ix_finance_sales_invoices_customer_id'), 'finance_sales_invoices', ['customer_id'], unique=False)

    # 5. finance_sales_invoice_lines
    if 'finance_sales_invoice_lines' not in tables:
        op.create_table(
            'finance_sales_invoice_lines',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('invoice_id', sa.Integer(), nullable=False),
            sa.Column('description', sa.String(length=255), nullable=False),
            sa.Column('quantity', sa.Float(), nullable=False, server_default='1.0'),
            sa.Column('unit_price', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('line_total', sa.Float(), nullable=False, server_default='0.0'),
            sa.ForeignKeyConstraint(['invoice_id'], ['finance_sales_invoices.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_finance_sales_invoice_lines_invoice_id'), 'finance_sales_invoice_lines', ['invoice_id'], unique=False)

    # 6. finance_bills
    if 'finance_bills' not in tables:
        op.create_table(
            'finance_bills',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('vendor_id', sa.Integer(), nullable=False),
            sa.Column('bill_number', sa.String(length=50), nullable=False),
            sa.Column('category', sa.String(length=100), nullable=False, server_default='Operating Expense'),
            sa.Column('issue_date', sa.String(length=20), nullable=False),
            sa.Column('due_date', sa.String(length=20), nullable=False),
            sa.Column('status', sa.String(length=30), nullable=False, server_default='unpaid'),
            sa.Column('currency', sa.String(length=10), nullable=False, server_default='USD'),
            sa.Column('subtotal', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('tax_amount', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('total', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['vendor_id'], ['finance_vendors.id'], ondelete='RESTRICT'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_finance_bills_bill_number'), 'finance_bills', ['bill_number'], unique=False)
        op.create_index(op.f('ix_finance_bills_status'), 'finance_bills', ['status'], unique=False)
        op.create_index(op.f('ix_finance_bills_vendor_id'), 'finance_bills', ['vendor_id'], unique=False)

    # 7. finance_bill_lines
    if 'finance_bill_lines' not in tables:
        op.create_table(
            'finance_bill_lines',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('bill_id', sa.Integer(), nullable=False),
            sa.Column('description', sa.String(length=255), nullable=False),
            sa.Column('quantity', sa.Float(), nullable=False, server_default='1.0'),
            sa.Column('unit_price', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('line_total', sa.Float(), nullable=False, server_default='0.0'),
            sa.ForeignKeyConstraint(['bill_id'], ['finance_bills.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_finance_bill_lines_bill_id'), 'finance_bill_lines', ['bill_id'], unique=False)

    # 8. finance_payments
    if 'finance_payments' not in tables:
        op.create_table(
            'finance_payments',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('direction', sa.String(length=20), nullable=False),
            sa.Column('related_invoice_id', sa.Integer(), nullable=True),
            sa.Column('related_bill_id', sa.Integer(), nullable=True),
            sa.Column('amount', sa.Float(), nullable=False),
            sa.Column('currency', sa.String(length=10), nullable=False, server_default='USD'),
            sa.Column('payment_date', sa.String(length=20), nullable=False),
            sa.Column('bank_account_id', sa.Integer(), nullable=False),
            sa.Column('method', sa.String(length=50), nullable=False, server_default='bank_transfer'),
            sa.Column('reference', sa.String(length=100), nullable=True, server_default=''),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['related_invoice_id'], ['finance_sales_invoices.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['related_bill_id'], ['finance_bills.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['bank_account_id'], ['finance_bank_accounts.id'], ondelete='RESTRICT'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_finance_payments_payment_date'), 'finance_payments', ['payment_date'], unique=False)
        op.create_index(op.f('ix_finance_payments_related_invoice_id'), 'finance_payments', ['related_invoice_id'], unique=False)
        op.create_index(op.f('ix_finance_payments_related_bill_id'), 'finance_payments', ['related_bill_id'], unique=False)
        op.create_index(op.f('ix_finance_payments_bank_account_id'), 'finance_payments', ['bank_account_id'], unique=False)

    # 9. finance_subscriptions
    if 'finance_subscriptions' not in tables:
        op.create_table(
            'finance_subscriptions',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('vendor_id', sa.Integer(), nullable=False),
            sa.Column('name', sa.String(length=255), nullable=False),
            sa.Column('amount', sa.Float(), nullable=False),
            sa.Column('currency', sa.String(length=10), nullable=False, server_default='USD'),
            sa.Column('billing_cycle', sa.String(length=20), nullable=False, server_default='monthly'),
            sa.Column('next_renewal_date', sa.String(length=20), nullable=False),
            sa.Column('auto_generate_bill', sa.Boolean(), nullable=False, server_default='1'),
            sa.Column('is_active', sa.Boolean(), nullable=False, server_default='1'),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['vendor_id'], ['finance_vendors.id'], ondelete='RESTRICT'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_finance_subscriptions_vendor_id'), 'finance_subscriptions', ['vendor_id'], unique=False)

    # 10. finance_payroll_runs
    if 'finance_payroll_runs' not in tables:
        op.create_table(
            'finance_payroll_runs',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('period_label', sa.String(length=20), nullable=False),
            sa.Column('period_start', sa.String(length=20), nullable=False),
            sa.Column('period_end', sa.String(length=20), nullable=False),
            sa.Column('status', sa.String(length=30), nullable=False, server_default='draft'),
            sa.Column('total_gross', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('total_tax', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('total_deductions', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('total_net', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('total_employer_cost', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('bank_account_id', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('approved_at', sa.DateTime(), nullable=True),
            sa.Column('paid_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['bank_account_id'], ['finance_bank_accounts.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_finance_payroll_runs_period_label'), 'finance_payroll_runs', ['period_label'], unique=False)
        op.create_index(op.f('ix_finance_payroll_runs_status'), 'finance_payroll_runs', ['status'], unique=False)
        op.create_index(op.f('ix_finance_payroll_runs_bank_account_id'), 'finance_payroll_runs', ['bank_account_id'], unique=False)

    # 11. finance_payroll_lines
    if 'finance_payroll_lines' not in tables:
        op.create_table(
            'finance_payroll_lines',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('payroll_run_id', sa.Integer(), nullable=False),
            sa.Column('employee_id', sa.Integer(), nullable=False),
            sa.Column('base_salary', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('allowances_total', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('deductions_total', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('tax_amount', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('net_pay', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('employer_cost_extra', sa.Float(), nullable=False, server_default='0.0'),
            sa.Column('snapshot_notes', sa.Text(), nullable=True, server_default=''),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['payroll_run_id'], ['finance_payroll_runs.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='RESTRICT'),
            sa.PrimaryKeyConstraint('id')
        )
        op.create_index(op.f('ix_finance_payroll_lines_payroll_run_id'), 'finance_payroll_lines', ['payroll_run_id'], unique=False)
        op.create_index(op.f('ix_finance_payroll_lines_employee_id'), 'finance_payroll_lines', ['employee_id'], unique=False)


def downgrade() -> None:
    op.drop_table('finance_payroll_lines')
    op.drop_table('finance_payroll_runs')
    op.drop_table('finance_subscriptions')
    op.drop_table('finance_payments')
    op.drop_table('finance_bill_lines')
    op.drop_table('finance_bills')
    op.drop_table('finance_sales_invoice_lines')
    op.drop_table('finance_sales_invoices')
    op.drop_table('finance_bank_accounts')
    op.drop_table('finance_vendors')
    op.drop_table('finance_customers')
