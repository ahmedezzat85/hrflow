"""0001_initial_schema

Revision ID: 0001_initial_schema
Revises: 
Create Date: 2026-08-23 13:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0001_initial_schema'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Employees
    op.create_table(
        'employees',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('role', sa.String(length=50), server_default='employee', nullable=True),
        sa.Column('dept', sa.String(length=100), server_default='', nullable=True),
        sa.Column('job_role', sa.String(length=100), server_default='', nullable=True),
        sa.Column('salary', sa.Float(), server_default='0.0', nullable=True),
        sa.Column('internal_salary_usd', sa.Float(), server_default='0.0', nullable=True),
        sa.Column('external_salary_usd', sa.Float(), server_default='0.0', nullable=True),
        sa.Column('join_date', sa.String(length=20), server_default='', nullable=True),
        sa.Column('status', sa.String(length=50), server_default='Active', nullable=True),
        sa.Column('vac_total', sa.Integer(), server_default='21', nullable=True),
        sa.Column('vac_used', sa.Integer(), server_default='0', nullable=True),
        sa.Column('next_raise', sa.String(length=20), server_default='', nullable=True),
        sa.Column('employment_state', sa.String(length=50), server_default='Full-Time', nullable=True),
        sa.Column('invoice_id', sa.String(length=20), server_default='', nullable=True),
        sa.Column('address_line_1', sa.String(length=255), server_default='', nullable=True),
        sa.Column('address_line_2', sa.String(length=255), server_default='', nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.Column('updated_at', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_employees_email'), 'employees', ['email'], unique=True)

    # 2. Users
    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('role', sa.String(length=50), server_default='employee', nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_users_email'), 'users', ['email'], unique=True)
    op.create_index(op.f('ix_users_employee_id'), 'users', ['employee_id'], unique=False)

    # 3. Salary History
    op.create_table(
        'salary_history',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.String(length=20), nullable=False),
        sa.Column('previous_salary', sa.Float(), server_default='0.0', nullable=True),
        sa.Column('new_salary', sa.Float(), server_default='0.0', nullable=True),
        sa.Column('pct_change', sa.String(length=20), server_default='', nullable=True),
        sa.Column('reason', sa.String(length=255), server_default='', nullable=True),
        sa.Column('applied_by', sa.String(length=255), server_default='', nullable=True),
        sa.Column('previous_internal_usd', sa.Float(), server_default='0.0', nullable=True),
        sa.Column('previous_external_usd', sa.Float(), server_default='0.0', nullable=True),
        sa.Column('new_internal_usd', sa.Float(), server_default='0.0', nullable=True),
        sa.Column('new_external_usd', sa.Float(), server_default='0.0', nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_salary_history_employee_id'), 'salary_history', ['employee_id'], unique=False)

    # 4. Employee Bank Accounts
    op.create_table(
        'employee_bank_accounts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('bank_name', sa.String(length=255), nullable=False),
        sa.Column('iban', sa.String(length=100), nullable=False),
        sa.Column('swift_code', sa.String(length=50), server_default='', nullable=True),
        sa.Column('updated_by', sa.String(length=255), server_default='', nullable=True),
        sa.Column('updated_at', sa.String(length=50), server_default='', nullable=True),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('employee_id')
    )

    # 5. Employee Notes
    op.create_table(
        'employee_notes',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('date', sa.String(length=20), nullable=False),
        sa.Column('category', sa.String(length=100), server_default='General', nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_by', sa.String(length=255), server_default='', nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_employee_notes_employee_id'), 'employee_notes', ['employee_id'], unique=False)

    # 6. Employee Documents
    op.create_table(
        'employee_documents',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('file_type', sa.String(length=50), nullable=False),
        sa.Column('drive_file_id', sa.String(length=255), nullable=False),
        sa.Column('view_url', sa.Text(), nullable=True),
        sa.Column('download_url', sa.Text(), nullable=True),
        sa.Column('uploaded_by', sa.String(length=255), server_default='', nullable=True),
        sa.Column('uploaded_at', sa.String(length=50), server_default='', nullable=True),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_employee_documents_employee_id'), 'employee_documents', ['employee_id'], unique=False)

    # 7. Company Documents
    op.create_table(
        'company_documents',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=255), nullable=False),
        sa.Column('file_type', sa.String(length=50), nullable=False),
        sa.Column('category', sa.String(length=100), server_default='General', nullable=True),
        sa.Column('drive_file_id', sa.String(length=255), nullable=False),
        sa.Column('view_url', sa.Text(), nullable=True),
        sa.Column('download_url', sa.Text(), nullable=True),
        sa.Column('uploaded_by', sa.String(length=255), server_default='', nullable=True),
        sa.Column('uploaded_at', sa.String(length=50), server_default='', nullable=True),
        sa.PrimaryKeyConstraint('id')
    )

    # 8. Insurance Categories
    op.create_table(
        'insurance_categories',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('annual_limit', sa.Float(), server_default='0.0', nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_insurance_categories_name'), 'insurance_categories', ['name'], unique=True)

    # 9. Insurance Claims
    op.create_table(
        'insurance_claims',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('employee_name', sa.String(length=255), server_default='', nullable=True),
        sa.Column('category', sa.String(length=100), nullable=False),
        sa.Column('provider', sa.String(length=255), server_default='', nullable=True),
        sa.Column('amount', sa.Float(), server_default='0.0', nullable=True),
        sa.Column('date', sa.String(length=20), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='Pending', nullable=True),
        sa.Column('document_url', sa.Text(), nullable=True),
        sa.Column('submitted_by', sa.String(length=255), server_default='', nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_insurance_claims_employee_id'), 'insurance_claims', ['employee_id'], unique=False)
    op.create_index(op.f('ix_insurance_claims_status'), 'insurance_claims', ['status'], unique=False)

    # 10. Requests
    op.create_table(
        'requests',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('employee_name', sa.String(length=255), server_default='', nullable=True),
        sa.Column('type', sa.String(length=100), nullable=False),
        sa.Column('details', sa.Text(), nullable=True),
        sa.Column('date', sa.String(length=20), nullable=False),
        sa.Column('status', sa.String(length=50), server_default='Pending', nullable=True),
        sa.Column('reviewed_by', sa.String(length=255), server_default='', nullable=True),
        sa.Column('reviewed_at', sa.String(length=50), server_default='', nullable=True),
        sa.Column('submitted_by', sa.String(length=255), server_default='', nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_requests_employee_id'), 'requests', ['employee_id'], unique=False)
    op.create_index(op.f('ix_requests_type'), 'requests', ['type'], unique=False)
    op.create_index(op.f('ix_requests_status'), 'requests', ['status'], unique=False)

    # 11. Vacation History
    op.create_table(
        'vacation_history',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('type', sa.String(length=100), nullable=False),
        sa.Column('start_date', sa.String(length=20), nullable=False),
        sa.Column('end_date', sa.String(length=20), nullable=False),
        sa.Column('days', sa.Integer(), server_default='1', nullable=True),
        sa.Column('status', sa.String(length=50), server_default='Pending', nullable=True),
        sa.Column('submitted_by', sa.String(length=255), server_default='', nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_vacation_history_employee_id'), 'vacation_history', ['employee_id'], unique=False)
    op.create_index(op.f('ix_vacation_history_status'), 'vacation_history', ['status'], unique=False)

    # 12. Invoices
    op.create_table(
        'invoices',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('employee_id', sa.Integer(), nullable=False),
        sa.Column('employee_name', sa.String(length=255), server_default='', nullable=True),
        sa.Column('invoice_number', sa.String(length=50), nullable=False),
        sa.Column('payment_year', sa.Integer(), nullable=False),
        sa.Column('payment_month', sa.Integer(), nullable=False),
        sa.Column('invoice_date', sa.String(length=20), server_default='', nullable=True),
        sa.Column('amount_usd', sa.Float(), server_default='0.0', nullable=True),
        sa.Column('currency', sa.String(length=10), server_default='USD', nullable=True),
        sa.Column('document_name', sa.String(length=255), server_default='', nullable=True),
        sa.Column('drive_file_id', sa.String(length=255), server_default='', nullable=True),
        sa.Column('drive_web_url', sa.Text(), nullable=True),
        sa.Column('template_version', sa.String(length=20), server_default='v1', nullable=True),
        sa.Column('status', sa.String(length=50), server_default='generated', nullable=True),
        sa.Column('failure_reason', sa.String(length=255), server_default='', nullable=True),
        sa.Column('generated_by', sa.String(length=255), server_default='', nullable=True),
        sa.Column('created_at', sa.String(length=50), server_default='', nullable=True),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_invoices_emp_period', 'invoices', ['employee_id', 'payment_year', 'payment_month'], unique=False)
    op.create_index(op.f('ix_invoices_invoice_number'), 'invoices', ['invoice_number'], unique=False)
    op.create_index(op.f('ix_invoices_payment_year'), 'invoices', ['payment_year'], unique=False)
    op.create_index(op.f('ix_invoices_payment_month'), 'invoices', ['payment_month'], unique=False)
    op.create_index(op.f('ix_invoices_status'), 'invoices', ['status'], unique=False)

    # 13. Audit Log
    op.create_table(
        'audit_log',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('timestamp', sa.String(length=50), nullable=False),
        sa.Column('actor_email', sa.String(length=255), server_default='', nullable=True),
        sa.Column('action', sa.String(length=100), nullable=False),
        sa.Column('target_type', sa.String(length=100), server_default='', nullable=True),
        sa.Column('target_id', sa.String(length=100), server_default='', nullable=True),
        sa.Column('details', sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_audit_log_timestamp'), 'audit_log', ['timestamp'], unique=False)
    op.create_index(op.f('ix_audit_log_action'), 'audit_log', ['action'], unique=False)


def downgrade() -> None:
    op.drop_table('audit_log')
    op.drop_table('invoices')
    op.drop_table('vacation_history')
    op.drop_table('requests')
    op.drop_table('insurance_claims')
    op.drop_table('insurance_categories')
    op.drop_table('company_documents')
    op.drop_table('employee_documents')
    op.drop_table('employee_notes')
    op.drop_table('employee_bank_accounts')
    op.drop_table('salary_history')
    op.drop_table('users')
    op.drop_table('employees')
