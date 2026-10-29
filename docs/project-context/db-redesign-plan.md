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
| 3 | Payroll line cleanup (migration 0055): `payroll_lines.tax_employee_si_egp` and `.total_social_insurance_egp` are derived (model properties, same API fields); foreign keys added for `payroll_lines.tax_settings_version_id` (orphans set to NULL and logged) and `payroll_adjustments.employee_id` (the upgrade stops and lists orphan adjustments). `payroll_lines.tax_amount` (always written as 0.0) was dropped in migration 0060 (owner decision: real tax): the model derives it from `employee_tax_usd_equivalent` and the employee payment-flows report now uses each line's real employee tax and social insurance; stored run totals (`total_net`, `total_tax`, ...) remain | done (3a) |
| 4a | Constraints (migration 0056): unique bill number (Drafts and duplicate overrides excluded), one non-cancelled payroll run per period, one open-ended row per employee in the compensation plan, social insurance and tax method tables, one generated salary document per employee and month, and a CHECK that a finance attachment has exactly one parent. The upgrade checks existing data first and stops with a list of every violation (run the audit script beforehand). A unique payroll line per employee and component was tried and left out: see below | done |
| 4b-1 | Payroll base pay line unique (migration 0057): one `external_usd` / `internal_usd_cash` line per employee and run. Owner asked for one line per run, employee and component type; commission and bonus lines are left repeatable because the payroll flow and its tests allow several per run (FUX-418) | done |
| 4b-2 | Value CHECKs (migration 0058) on columns whose allowed values the code defines in one place: bill status, invoice status, ledger direction, payment direction, bank account type. Other status columns (payroll runs, cheques, statement lines) have no single authoritative list and are left alone. The upgrade stops with a list of out-of-set values | done |
| 4b-3 | Employee delete guard (migration 0059, owner decision: block): an employee with pay plan, tax method, social insurance, payroll line or payroll adjustment history cannot be deleted. The API answers 409 (`services/employee_delete_guard.py`, use status Suspended instead), the ORM no longer cascades the delete to pay history, and the tax method and social insurance foreign keys changed from `CASCADE` to `RESTRICT` like the plan table | done |
| 4b-4 | Still open: full non-overlap of effective ranges (needs real date columns, Stage 5) | planned |
| 4c | Employee archived state (migration 0061, owner decision): `employees.archived_at` / `archived_by`; the API reports status `Archived` while set (the saved status comes back on unarchive); `POST /api/employees/{id}/archive` and `/unarchive`; the linked login is archived and, following RBAC F5 (archived users are never restored), stays archived when the employee is unarchived (cannot archive yourself or the last Super-Admin); archived employees are left out of current and future payroll runs and new salary documents (historical periods still include them); the delete block now says to archive. The employee table has an Archive / Unarchive action, an Archived tab (All hides archived employees), a locked status field in the edit dialog for an archived employee, and archived employees are left out of the raise picker and the payroll table | done |
| 4d | Schema parity (migration 0062): a database built by `alembic upgrade head` (production) lacked 31 foreign keys and 34 indexes the models declare, and kept 5 `ix_invoices_*` indexes under the old table name. They are added (checked on PostgreSQL 16 too). Orphan references on `ON DELETE SET NULL` columns are set to NULL and logged; orphans on CASCADE / RESTRICT columns stop the upgrade with a list. The drift baseline falls from 128 to 56 entries: what is left is 55 NOT NULL / nullable differences and the legacy `finance_ledger_transactions.category` column, which the models no longer have (drop it in Stage 6 after checking it holds nothing) | done |
| 5a | Alembic is the only schema path: `init_db()` no longer adds missing columns or creates tables on an existing database (only a brand-new SQLite file is built from the models); it logs an error when the database is not at the Alembic head. Migration 0013 still builds missing tables from the current models on a fresh `upgrade head`; the drift ratchet and tests guard that fresh chain, and a baseline squash is the remaining option | done |
| 5b-1 | Money columns, ledger and accounts (migration 0063, owner decision: exact in the database, floats in Python): `finance/money.py` defines `Money` = NUMERIC(18,4) and `Rate` = NUMERIC(18,8) with `asdecimal=False`, so the app still reads floats. Four decimals for amounts, not two, so nothing the app writes today is rounded silently. Done for `finance_ledger_transactions` (7 columns) and `finance_bank_accounts` (2). The upgrade checks first and stops with a list of any value with more decimals than its column keeps. Checked on PostgreSQL 16 (conversion, exact sums, floats read back) | done |
| 5b-2 | Money columns, sales and purchase side (migration 0064): invoices and lines, bills and lines, payments, cheques, products, customer and vendor withholding rates (`Quantity` = NUMERIC(18,4) added for line quantities; `extraction_confidence` stays a float). Checked on PostgreSQL 16 | done |
| 5b-3 | Money columns, payroll (migration 0065: runs, lines, adjustments, compensation plans, dated rate settings, tax limit) and the rest (migration 0066: transfers, subscriptions and charges, statement imports and lines, reconciliation rules, checkpoints, fiscal-year openings, statutory obligations, insurance, salary document amounts, employee insurance base and flat tax rate). **No money column is a float any more** (`tests/test_money_columns_remaining.py` fails when a new `Float` column is added). Checked on PostgreSQL 16 | done |
| 5b-4 | Dates: 40 columns that hold a `YYYY-MM-DD` string get a CHECK (length, dashes, year 1900-2999, month, day; empty allowed where the model allows it) from one list, `finance/date_checks.py` (migration 0067). On PostgreSQL the effective-dated pay history (compensation plans, social insurance, tax method) also gets a no-overlap exclusion constraint. A refused write is a 409 with no details, a malformed `join_date` is a 422. `salary_payment_docs.invoice_date` (printed date) is excluded on purpose | done |
| 6a | Bill scans: `finance_bills.attachment_url` / `attachment_name` move into `finance_attachments.bill_id` (migration 0068; one scan per bill, seven-parent rule). The API fields keep their names; the model exposes them from the attachment row. Checked on PostgreSQL 16 | done |
| 5b-3 | Date strings to real dates and timestamps to timezone-aware (this enables the non-overlap rule for effective-dated rows) | planned |
| 6b | Cleanup: the legacy `finance_ledger_transactions.category` text column is dropped (migration 0069; it only ever held `other`, `revenue` or `cost`, the category is `category_id`), the 17 unused alias classes in `finance/models.py` are removed, the decision log has D-049. Kept on purpose: the Sheets backfill, reconcile, cold-storage and SQLite-to-PostgreSQL scripts (they still run and the test fixtures use them), and the local `*.db` files (untracked, gitignored). Not done: dropping `salary_payment_docs.drive_web_url` and renaming the salary-document "invoice" columns (they reach the Sheets export and the document API) | done |

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

## Finding from Stage 4a

Probing the suite with each candidate constraint showed which application rules are real. Drafts may hold any bill
number (D-019), so the unique index excludes them. A payroll line unique on (run, employee, component type) was not
added: the audit script flags such duplicates, but the payroll flow was not shown to forbid them, so the rule needs an
owner decision before it becomes a constraint.

## Release note for Stages 1 to 4 (backward compatibility)

`deploy/prod/RUNBOOK.md` asks migrations to be backward compatible with the previous release where possible, because a
failed health check rolls the app back to the old release. Several migrations in this redesign drop columns that the old
release still reads (for example `employees.role`, `employees.vac_used`, `finance_bills.category`, `finance_bills.amount_paid`,
the document URL columns) or tighten constraints the old release can violate. The old release cannot run against a database
migrated by them, so a rollback after such a migration means restoring the backup taken at the start of the deploy
(`scripts/restore.ps1`). Release these stages deliberately, with a fresh backup, and run
`python scripts/audit_db_integrity.py` on a copy of production first because several migrations stop on bad data.

## Finding: production schema check (2026-11-04)

With the owner's go-ahead, production's schema (tables, columns, constraints, indexes; no row data) was dumped with
`pg_dump --schema-only`, loaded into a throwaway PostgreSQL 16 database and compared with the models.
- Production is at revision `0049_history_amounts_derived`: none of migrations 0050 to 0064 is applied yet.
- Against the models it differs by exactly the planned changes: 17 columns to drop, 4 to add, 25 foreign keys and 30 indexes to add,
  6 stale indexes to drop, 29 money columns to convert (floats to NUMERIC), and nullability differences.
- Applying `alembic upgrade head` (0050 to 0064) to that schema copy succeeds, and the result matches the models except for 49
  nullability differences and the legacy `finance_ledger_transactions.category` column (production: `varchar(100) NOT NULL DEFAULT 'other'`,
  which the app never fills, so it holds `other` on every row; drop it in Stage 6).
- Not covered: anything that depends on rows. Whether production holds orphan rows, duplicate bill numbers, overlapping pay-plan rows
  or out-of-set statuses needs the audit script run on a restored backup, as the release checklist says.

## Finding: dry run on the latest production backup (2026-10-29)

With the owner's go-ahead, the latest production backup (taken 2026-10-28 13:47, checksum verified) was decrypted with the
production passphrase, restored into a throwaway PostgreSQL 16 database (not production) and used for a full dry run.
The decrypted files and the data copy were deleted afterwards.
- The backup holds 14 employees, 58 compensation plan rows, 54 pay-change rows, 14 users and 2 bank accounts; no bills, invoices,
  payments, ledger rows or payroll runs yet. Finance is barely used in production.
- `scripts/audit_db_integrity.py` on that data: **no findings** (no orphans, duplicates, overlapping or out-of-set rows).
- `alembic upgrade head` (migrations 0050 to 0064) on that data: all 15 migrations apply, with **no warnings and no stop**.
- Afterwards the application code reads the copy correctly (employee list with the derived vacation and next-raise fields,
  floats from the NUMERIC columns, no balance drift), the audit still reports no findings, and the row counts are unchanged.
- Not covered: data entered after 2026-10-28, and the document files (the dry run touched the database only). Repeat the audit on a
  fresh backup immediately before the release, as the checklist says.

## Finding: final dry run of the whole chain (2026-10-29)

With the owner's go-ahead, the newest production backup (still the 2026-10-28 13:47 one; checksum verified) was decrypted (database dump only, no documents), restored into a throwaway PostgreSQL 16 database (not production), and the final code (migrations 0050 to 0069) was run on it. The decrypted dump and the restored database were deleted afterwards, and the throwaway container removed.
- `scripts/audit_db_integrity.py` before and after: **no findings**.
- `alembic upgrade head` from 0049 to 0069: all 20 migrations apply with **no warnings and no stop**; the database ends at `0069_drop_ledger_category`.
- Row counts of all 21 non-empty tables are identical before and after; the application models read the result correctly (14 employees, accounts and balances as floats from the NUMERIC columns).
- This run adds 0065 to 0069 (payroll and remaining money, date checks, bill scans, ledger category) to the earlier dry run of 0050 to 0064. The copy has no bills, payments or payroll runs, so those migrations were run on empty tables; their data paths are covered by the tests and the PostgreSQL runs with planted data.
- Still to do at release time: a fresh backup immediately before deploying, as the checklist says.
