# Database redesign plan

Goal: one source of truth per fact, no legacy columns or tables, and constraints that make bad data impossible.
Each stage is its own PR with an Alembic migration, a downgrade, and tests. A migration logs every row it cannot
reconcile instead of dropping it silently (as 0048 and 0049 did). The API keeps its field names and derives values
on read.

| Stage | Scope | Status |
| --- | --- | --- |
| 0 | Audit script, SQLite foreign keys on, schema-drift ratchet | done |
| 1 | Derived employee data (migration 0050): `vac_used` (approved annual leave starting this year) and `next_raise` (latest pay change + 365 days) are derived in `services/employee_derived.py`; `employees.role` and the document `view_url`/`download_url` columns are dropped; `InvoiceDB` alias and `EmployeeDB.invoices` removed. Kept on purpose: `users.name` (users without an employee need it) and `salary_payment_docs.amount_usd`/`currency` (a snapshot of what the generated document says). Deferred to Stage 6: renaming the salary-document "invoice" columns and dropping `salary_payment_docs.drive_web_url` | done |
| 2a | Finance duplicate columns (migration 0051): `finance_payroll_runs.bank_account_id` (the external funding account), `finance_payroll_settings.employee_rate`/`employer_rate` (the effective-dated rate table is the only store), `finance_cheques.attachment_url` (scans are `finance_attachments` rows) | done |
| 2b-1 | Bill category (migration 0052): `finance_bills.category` text becomes `imported_category`, kept only while no category row matched; `category_id` is the category and the API still returns `category` | done |
| 2b-2 | `bills.amount_paid` (migration 0053): not stored; a read-only `column_property` sums the bill's live payments in the same query. After adding or reversing a payment, flush and `session.expire(bill, ["amount_paid"])` (done in `SettlementService` and `BillsRepository`) | done |
| 2b-3 | `finance_payments.ledger_transaction_id` (migration 0054): unique link to the ledger row a payment posted, set by every payment path (bill pay, invoice receipt, manual transaction, cheque, statutory remittance). Older payments are backfilled by matching; unmatched ones stay empty and are logged and listed by the audit script | done |
| 2b-4 | Cached balances (decided: keep, one writer): `LedgerRepository.recalculate_account_running_balances` is the only code that writes `current_balance` and `running_balance`; the rule lives in `finance/balances.py` (`compute_balances`, `find_drift`). The account update and recalculate paths now go through it, which also fixes an opening-balance change on an account that already had transactions. `tests/test_balance_write_path.py` fails if another file assigns a stored balance; the audit script reports drift. Bill scans into `finance_attachments` still open | done |
| 3 | Payroll line cleanup: dead `tax_amount`, redundant snapshot columns, run totals, missing foreign keys | planned |
| 4 | Constraints: uniqueness (bill number per vendor, payroll run period, line per employee, salary document per month), no overlapping effective-dated rows, one-parent CHECK on attachments, status CHECKs, delete-rule fixes | planned |
| 5 | Types: Float to Numeric for money, date strings to Date, timezone-aware timestamps; Alembic as the only schema path (remove the `ALTER TABLE` sync in `init_db()`); index clean-up | planned |
| 6 | Remove alias classes, dead Sheets-era scripts, stray `.db` files; update the decision log | planned |

## Tools from Stage 0

- `python scripts/audit_db_integrity.py [--json]` (from `be/`): read-only report of overlapping effective ranges,
  duplicate keys, bad date strings, cached values that drifted from their source, payments without a ledger row,
  orphans and attachments without exactly one parent. Exit code 1 when there are findings. Run it on a copy of
  production before every stage.
- `db.enable_sqlite_foreign_keys`: SQLite now enforces the same RESTRICT / CASCADE / SET NULL rules as PostgreSQL.
  A test that needs a user or child row must create the parent first (`ensure_employee` in `tests/conftest.py`).
- `tests/test_schema_drift.py`: compares `alembic upgrade head` on an empty database with the models. The known
  differences are listed in `tests/data/schema_drift_baseline.txt`. New drift fails the test; a fixed entry must be
  removed from the baseline, so the file only shrinks. Regenerate with `python scripts/schema_drift.py --write-baseline`.

## Finding from Stage 0

A database built from migrations alone differs from the models in 129 places: 31 foreign keys, 34 indexes and 58
NOT NULL / nullable settings that the models declare are missing from the migrations, plus 5 stale indexes on the old
`invoices` table name. If production was built by `create_all` it has them; if it was built by Alembic it does not.
Check the real production schema before Stage 4, and close the gap with a migration in Stage 4 or 5.

## Finding from Stage 2a

Migration 0013 builds missing tables with `Base.metadata.create_all` from the *current* models, so a fresh
`alembic upgrade head` never had a column that a later stage drops, and older data-moving migrations that read such a
column fail on a fresh database (0036 and 0046 now check that the column exists first). Any stage that drops a column
must check the older migrations that read it. The permanent fix is Stage 5 (Alembic as the only schema path, with
0013 made explicit).

## Finding from Stage 2b-4

Running the whole backend suite with a balance-drift probe at teardown found 20 tests that end with stored balances
that differ from the ledger. All of them set up report data by inserting `LedgerTransactionDB` rows directly through
the ORM; no application path left drift. The probe was not kept because those tests would fail it; the static and
behaviour tests in `tests/test_balance_write_path.py` and the audit script are the guards.
