"""0062_schema_parity

Database redesign, Stage 4c: a database built by `alembic upgrade head` (how production is built) did not have 31 foreign
keys and 34 indexes that the models declare, and kept 5 indexes under the old `invoices` table name. Tables that
`create_all` built had them; tables the early migrations built did not. This migration closes that gap (found by the
schema-drift check, Stage 0; confirmed on PostgreSQL).

Foreign keys: before each one is added, rows pointing at a record that does not exist are looked for.
  - ON DELETE SET NULL columns: the orphan reference is set to NULL and logged (it points at nothing).
  - ON DELETE CASCADE / RESTRICT columns (attachments of a missing cheque or invoice, statement lines of a missing parent,
    a bank account without a book): not repaired automatically. The upgrade stops and lists every one of them, across all
    keys at once; fix or remove those rows, then upgrade again (`python scripts/audit_db_integrity.py`, `fk:violations` and
    the orphan sections, reports the same rows).
Indexes: created when missing. The 5 stale `ix_invoices_*` indexes are dropped; their `ix_salary_payment_docs_*`
replacements are created. (`employee_bank_accounts.employee_id` already has a unique constraint from the first migration;
the model now declares exactly that instead of a unique index, so nothing is added there.)

The downgrade drops the foreign keys this migration named (`fk_<table>_<column>`) and the indexes it created.

Revision ID: 0062_schema_parity
Revises: 0061_employee_archived
Create Date: 2026-11-02 10:00:00.000000

"""
import logging
from collections import defaultdict
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '0062_schema_parity'
down_revision: Union[str, None] = '0061_employee_archived'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

log = logging.getLogger("alembic.runtime.migration")

# table, column, referenced table, referenced column, ON DELETE
FKS = (
    ('finance_attachments', 'checkpoint_id', 'finance_account_balance_checkpoints', 'id', 'CASCADE'),
    ('finance_attachments', 'cheque_id', 'finance_cheques', 'id', 'CASCADE'),
    ('finance_attachments', 'sales_invoice_id', 'finance_sales_invoices', 'id', 'CASCADE'),
    ('finance_attachments', 'statement_import_id', 'finance_statement_imports', 'id', 'CASCADE'),
    ('finance_bank_accounts', 'book_id', 'finance_books', 'id', 'RESTRICT'),
    ('finance_bills', 'category_id', 'finance_transaction_categories', 'id', 'SET NULL'),
    ('finance_bills', 'import_batch_id', 'finance_import_batches', 'id', 'SET NULL'),
    ('finance_cheques', 'import_batch_id', 'finance_import_batches', 'id', 'SET NULL'),
    ('finance_cheques', 'replaced_cheque_id', 'finance_cheques', 'id', 'SET NULL'),
    ('finance_cheques', 'replacement_cheque_id', 'finance_cheques', 'id', 'SET NULL'),
    ('finance_ledger_transactions', 'category_id', 'finance_transaction_categories', 'id', 'SET NULL'),
    ('finance_ledger_transactions', 'customer_id', 'finance_customers', 'id', 'SET NULL'),
    ('finance_ledger_transactions', 'linked_statutory_obligation_id', 'finance_statutory_obligations', 'id', 'SET NULL'),
    ('finance_ledger_transactions', 'linked_transfer_id', 'finance_account_transfers', 'id', 'SET NULL'),
    ('finance_ledger_transactions', 'payment_type_id', 'finance_payment_types', 'id', 'SET NULL'),
    ('finance_ledger_transactions', 'product_id', 'finance_products', 'id', 'SET NULL'),
    ('finance_ledger_transactions', 'revenue_source_id', 'finance_revenue_sources', 'id', 'SET NULL'),
    ('finance_payments', 'related_statutory_obligation_id', 'finance_statutory_obligations', 'id', 'SET NULL'),
    ('finance_payroll_lines', 'linked_payment_id', 'finance_payments', 'id', 'SET NULL'),
    ('finance_payroll_runs', 'external_funding_account_id', 'finance_bank_accounts', 'id', 'SET NULL'),
    ('finance_payroll_runs', 'internal_funding_account_id', 'finance_bank_accounts', 'id', 'SET NULL'),
    ('finance_payroll_runs', 'journal_transaction_id', 'finance_ledger_transactions', 'id', 'SET NULL'),
    ('finance_payroll_runs', 'tax_settings_version_id', 'finance_payroll_tax_settings', 'id', 'SET NULL'),
    ('finance_sales_invoice_lines', 'product_id', 'finance_products', 'id', 'SET NULL'),
    ('finance_sales_invoices', 'expected_bank_account_id', 'finance_bank_accounts', 'id', 'SET NULL'),
    ('finance_sales_invoices', 'import_batch_id', 'finance_import_batches', 'id', 'SET NULL'),
    ('finance_statement_lines', 'applied_rule_id', 'finance_reconciliation_rules', 'id', 'SET NULL'),
    ('finance_statement_lines', 'parent_line_id', 'finance_statement_lines', 'id', 'CASCADE'),
    ('finance_subscription_charges', 'linked_bill_id', 'finance_bills', 'id', 'SET NULL'),
    ('finance_subscriptions', 'payment_account_id', 'finance_bank_accounts', 'id', 'SET NULL'),
    ('finance_vendors', 'default_category_id', 'finance_transaction_categories', 'id', 'SET NULL'),
)

# table, index name, columns, unique
INDEXES = (
    ('finance_account_transfers', 'ix_finance_account_transfers_settlement_status', ['settlement_status'], False),
    ('finance_attachments', 'ix_finance_attachments_checkpoint_id', ['checkpoint_id'], False),
    ('finance_attachments', 'ix_finance_attachments_cheque_id', ['cheque_id'], False),
    ('finance_attachments', 'ix_finance_attachments_sales_invoice_id', ['sales_invoice_id'], False),
    ('finance_attachments', 'ix_finance_attachments_statement_import_id', ['statement_import_id'], False),
    ('finance_bank_accounts', 'ix_finance_bank_accounts_book_id', ['book_id'], False),
    ('finance_bills', 'ix_finance_bills_category_id', ['category_id'], False),
    ('finance_bills', 'ix_finance_bills_file_fingerprint', ['file_fingerprint'], False),
    ('finance_bills', 'ix_finance_bills_import_batch_id', ['import_batch_id'], False),
    ('finance_cheques', 'ix_finance_cheques_import_batch_id', ['import_batch_id'], False),
    ('finance_ledger_transactions', 'ix_finance_ledger_transactions_customer_id', ['customer_id'], False),
    ('finance_ledger_transactions', 'ix_finance_ledger_transactions_entry_type', ['entry_type'], False),
    ('finance_ledger_transactions', 'ix_finance_ledger_transactions_linked_statutory_obligation_id', ['linked_statutory_obligation_id'], False),
    ('finance_ledger_transactions', 'ix_finance_ledger_transactions_payee_id', ['payee_id'], False),
    ('finance_ledger_transactions', 'ix_finance_ledger_transactions_payee_type', ['payee_type'], False),
    ('finance_ledger_transactions', 'ix_finance_ledger_transactions_product_id', ['product_id'], False),
    ('finance_ledger_transactions', 'ix_finance_ledger_transactions_revenue_source_id', ['revenue_source_id'], False),
    ('finance_payments', 'ix_finance_payments_related_statutory_obligation_id', ['related_statutory_obligation_id'], False),
    ('finance_payroll_lines', 'ix_finance_payroll_lines_linked_payment_id', ['linked_payment_id'], False),
    ('finance_sales_invoice_lines', 'ix_finance_sales_invoice_lines_product_id', ['product_id'], False),
    ('finance_sales_invoices', 'ix_finance_sales_invoices_import_batch_id', ['import_batch_id'], False),
    ('finance_statement_imports', 'ix_finance_statement_imports_file_fingerprint', ['file_fingerprint'], False),
    ('finance_statement_lines', 'ix_finance_statement_lines_applied_rule_id', ['applied_rule_id'], False),
    ('finance_statement_lines', 'ix_finance_statement_lines_line_fingerprint', ['line_fingerprint'], False),
    ('finance_statement_lines', 'ix_finance_statement_lines_parent_line_id', ['parent_line_id'], False),
    ('finance_subscription_charges', 'ix_finance_subscription_charges_linked_bill_id', ['linked_bill_id'], False),
    ('finance_vendors', 'ix_finance_vendors_default_category_id', ['default_category_id'], False),
    ('salary_payment_docs', 'ix_salary_payment_docs_emp_period', ['employee_id', 'payment_year', 'payment_month'], False),
    ('salary_payment_docs', 'ix_salary_payment_docs_employee_id', ['employee_id'], False),
    ('salary_payment_docs', 'ix_salary_payment_docs_invoice_number', ['invoice_number'], False),
    ('salary_payment_docs', 'ix_salary_payment_docs_payment_month', ['payment_month'], False),
    ('salary_payment_docs', 'ix_salary_payment_docs_payment_year', ['payment_year'], False),
    ('salary_payment_docs', 'ix_salary_payment_docs_status', ['status'], False),
)

STALE_INDEXES = (
    ('salary_payment_docs', 'ix_invoices_emp_period'),
    ('salary_payment_docs', 'ix_invoices_invoice_number'),
    ('salary_payment_docs', 'ix_invoices_payment_month'),
    ('salary_payment_docs', 'ix_invoices_payment_year'),
    ('salary_payment_docs', 'ix_invoices_status'),
)


def _fk_name(table, column):
    return f"fk_{table}_{column}"


def _columns(inspector, table):
    return {c["name"] for c in inspector.get_columns(table)}


def _has_fk(inspector, table, column):
    return any(fk["constrained_columns"] == [column] for fk in inspector.get_foreign_keys(table))


def _missing_fks(inspector):
    tables = set(inspector.get_table_names())
    for table, column, ref_table, ref_column, ondelete in FKS:
        if table in tables and ref_table in tables and column in _columns(inspector, table) and not _has_fk(inspector, table, column):
            yield table, column, ref_table, ref_column, ondelete


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    problems, nullify = [], []
    for table, column, ref_table, ref_column, ondelete in _missing_fks(inspector):
        orphans = bind.execute(sa.text(
            f"SELECT id, {column} FROM {table} WHERE {column} IS NOT NULL AND {column} NOT IN (SELECT {ref_column} FROM {ref_table})")).fetchall()
        if not orphans:
            continue
        if ondelete == "SET NULL":
            nullify.append((table, column, ref_table, ref_column, orphans))
        else:
            problems.append(f"{table}.{column} -> {ref_table}: {len(orphans)} row(s) point at a missing record, e.g. id {orphans[0][0]} "
                            f"-> {orphans[0][1]} (ON DELETE {ondelete}, not repaired automatically)")
    if problems:
        raise RuntimeError(
            f"{len(problems)} problem(s) block the schema parity migration; fix them, then upgrade again:\n  " + "\n  ".join(problems))

    for table, column, ref_table, ref_column, orphans in nullify:
        for row_id, value in orphans[:20]:
            log.warning("%s id %s: %s %s points at a missing record; set to NULL", table, row_id, column, value)
        if len(orphans) > 20:
            log.warning("%s.%s: %s more orphan reference(s) set to NULL", table, column, len(orphans) - 20)
        bind.execute(sa.text(
            f"UPDATE {table} SET {column} = NULL WHERE {column} IS NOT NULL AND {column} NOT IN (SELECT {ref_column} FROM {ref_table})"))

    by_table = defaultdict(list)
    for item in _missing_fks(sa.inspect(bind)):
        by_table[item[0]].append(item)
    for table, items in by_table.items():
        with op.batch_alter_table(table) as batch_op:
            for _t, column, ref_table, ref_column, ondelete in items:
                batch_op.create_foreign_key(_fk_name(table, column), ref_table, [column], [ref_column], ondelete=ondelete)

    inspector = sa.inspect(bind)
    for table, name in STALE_INDEXES:
        if table in inspector.get_table_names() and name in {ix["name"] for ix in inspector.get_indexes(table)}:
            op.drop_index(name, table_name=table)
    for table, name, cols, unique in INDEXES:
        if table in inspector.get_table_names() and set(cols) <= _columns(inspector, table) \
                and name not in {ix["name"] for ix in sa.inspect(bind).get_indexes(table)}:
            op.create_index(name, table, cols, unique=unique)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    for table, name, _cols, _unique in INDEXES:
        if table in tables and name in {ix["name"] for ix in inspector.get_indexes(table)}:
            op.drop_index(name, table_name=table)
    by_table = defaultdict(list)
    for table, column, *_rest in FKS:
        if table in tables:
            named = {fk["name"] for fk in inspector.get_foreign_keys(table)}
            if _fk_name(table, column) in named:
                by_table[table].append(column)
    for table, columns in by_table.items():
        with op.batch_alter_table(table) as batch_op:
            for column in columns:
                batch_op.drop_constraint(_fk_name(table, column), type_="foreignkey")
