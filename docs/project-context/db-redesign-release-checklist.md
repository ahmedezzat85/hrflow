# Releasing the database redesign (migrations 0050 to 0061, init_db change)

Read `db-redesign-plan.md` first. This is the checklist for putting Stages 1 to 5a into production. Production is
PostgreSQL in Docker (`deploy/prod/RUNBOOK.md`); the app container runs `alembic upgrade head` on every start.

## Why this release is different

- **Not backward compatible.** The previous release reads columns these migrations drop (`employees.role`,
  `employees.vac_used`, `employees.next_raise`, `finance_bills.category`, `finance_bills.amount_paid`, the document
  `view_url` / `download_url`, and others) and can break constraints they add. If the new release fails its health check
  and the deploy rolls back to the old image, **the old image will not run on the migrated database**. A rollback means
  restoring the backup taken at the start of the deploy (`scripts/restore.ps1`).
- **Several migrations stop on bad data** instead of guessing (below). A stop leaves the app unable to start the new
  release, so find these before the deploy, not during it.

## Before the deploy

1. Take a backup: `powershell deploy/prod/scripts/backup.ps1`. Check the file exists and `BACKUP_PASSPHRASE` is known.
2. Restore that backup into a scratch database (or use a copy of production) and run, from `be/`, with
   `DATABASE_URL` pointing at the copy:
   ```bash
   python scripts/audit_db_integrity.py
   ```
   It is read-only. Fix everything it lists under the headings below, in production, with the owner's decision on which
   row to keep. Re-run until it prints `No findings.` (the `info:` sections are information only).
3. On the same copy, run `alembic upgrade head` and read the log: every `WARNING` line is a row a migration
   changed or could not match (see "Logged, not stopped"). Decide whether each one needs a follow-up.
4. Check the pre-flight on the copy afterwards: `python scripts/audit_db_integrity.py` again, and start the app against it.
5. Release deliberately (`gh workflow run release.yml`), not alongside unrelated changes.

## What stops the upgrade (fix first)

| Migration | Stops when | Audit section |
| --- | --- | --- |
| 0055 | a payroll adjustment belongs to an employee that does not exist | `orphan:adjustment_employee` |
| 0056 | a bill number is used by more than one non-draft bill without the duplicate override; two non-cancelled payroll runs for one period; two open-ended (no end date) compensation plan rows for one employee and component; two open-ended social insurance or tax method rows for one employee; two generated salary documents for one employee and month; a finance attachment with zero or several parents | `dup:bills`, `dup:payroll_runs`, `overlap:*`, `dup:salary_docs`, `attach:parents` |
| 0057 | a base pay line (`external_usd` / `internal_usd_cash`) appears twice for one employee in one payroll run | `dup:payroll_lines` |
| 0058 | a bill or invoice status, a ledger or payment direction, or a bank account type outside the allowed sets | (the migration message lists the values) |

The migration message lists every offending row at once.

## Logged, not stopped (review the log)

| Migration | Logs |
| --- | --- |
| 0050 | employees whose stored `vac_used` / `next_raise` differ from the derived values; non-default `employees.role` |
| 0051 | payroll runs whose `bank_account_id` differed from the external funding account; rate differences; cheques with an `attachment_url` and no attachment row |
| 0052 | bills whose old category text matched no category (kept as `imported_category`) or conflicted with their category row |
| 0053 | bills whose stored `amount_paid` differed from their live payments |
| 0054 | payments with no matching ledger row (`ledger_transaction_id` stays empty; the audit lists them under `link:payment_no_ledger`) |
| 0055 | payroll lines whose stored totals differed from the derived ones; tax settings versions that do not exist (set to NULL) |
| 0060 | payroll lines whose stored `tax_amount` was not zero (none expected) |

## Deploy

1. Run the release workflow, then the production deploy (`RUNBOOK.md`). The deploy takes its own backup first.
2. Watch the container log: `alembic upgrade head` runs 0050 to 0061, then the app starts. `init_db()` no longer changes the
   schema; it logs an error if the database is not at the Alembic head.
3. If a migration stops: read the message, fix the rows (the audit script lists them), restart the container. Nothing was
   half-applied for the data checks in 0056 to 0058 because they run before any change.

## After the deploy

- Run `python scripts/audit_db_integrity.py` against production (read-only). Expect `No findings.` apart from the unmatched
  payments logged by 0054.
- Smoke test: an employee profile (vacation used, next raise), a bill with a payment and its reversal, an invoice receipt,
  a payroll preview, an account's balance and ledger, deleting an employee with a pay plan (409), deleting one without.
- API changes to expect: employees can be archived (`archived`, status `Archived`); the payment-flows report now shows real employee tax and insurance (it showed 0 tax before); the employee response no longer has `role`; the employee export has no `Role` column; new employees
  show no next raise until their first pay change; a bill with no category has none (it used to get "Operating Expense").

## Rollback

- Before any migration ran: set `HRFLOW_VERSION` to the previous tag and restart.
- After the migrations ran: restore the backup taken at the start of the deploy (`restore.ps1 -File <backup.enc>`), then set
  `HRFLOW_VERSION` to the previous tag. Data entered after the backup is lost; export it first if it matters.
- The migrations have working downgrades (`alembic downgrade 0049_history_amounts_derived`), but a downgrade refills dropped
  columns from the data that still exists; it cannot bring back values that were never stored (document URLs come back empty).
  Prefer the backup restore.
