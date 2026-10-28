# Database redesign plan

Goal: one source of truth per fact, no legacy columns or tables, and constraints that make bad data impossible.
Each stage is its own PR with an Alembic migration, a downgrade, and tests. A migration logs every row it cannot
reconcile instead of dropping it silently (as 0048 and 0049 did). The API keeps its field names and derives values
on read.

| Stage | Scope | Status |
| --- | --- | --- |
| 0 | Audit script, SQLite foreign keys on, schema-drift ratchet | done |
| 1 | Derived employee data (migration 0050): `vac_used` (approved annual leave starting this year) and `next_raise` (latest pay change + 365 days) are derived in `services/employee_derived.py`; `employees.role` and the document `view_url`/`download_url` columns are dropped; `InvoiceDB` alias and `EmployeeDB.invoices` removed. Kept on purpose: `users.name` (users without an employee need it) and `salary_payment_docs.amount_usd`/`currency` (a snapshot of what the generated document says). Deferred to Stage 6: renaming the salary-document "invoice" columns and dropping `salary_payment_docs.drive_web_url` | done |
| 2 | Finance duplicates: `bills.category` text, `bills.amount_paid`, `cheques.attachment_url`, bill attachment columns, `payroll_runs.bank_account_id`, global payroll rates; real payment-to-ledger link; decide on cached balances | planned |
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
