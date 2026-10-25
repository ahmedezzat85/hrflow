# Effective-dated social insurance rates (SI-1): design note

Status: DESIGN NOTE, awaiting owner approval. Nothing below is implemented. Branch: `feat/payroll-si-rates-effective-dated` (from `main` at `0107a73`).
Risk class: high (payroll calculation input, schema, migration). Origin: Q-023, D-040, roadmap 3K.

## 1. Problem (verified in code on main)

The employee and employer social insurance rates are one global row, `finance_payroll_settings` id=1 (`PayrollSettingsDB`, defaults 0.11 and 0.18), with no effective date. A run line keeps the rate it used (`employee_rate_snapshot`, `employer_rate_snapshot`), but `refresh_run` on a draft re-reads the current setting, and any rate change applies to every period still being calculated. The owner's 2023 workbook used 18.75% for the employer share.

## 2. Consumers of the global rates (grep: `get_payroll_settings`, `employee_rate`, `employer_rate`)

| Consumer | Where | Reads rates? | Change |
|---|---|---|---|
| Rate resolution for every calculation (preview, generate, create run, refresh) | `PayrollService._evaluate_employee_payroll_snapshots` (`emp_rate` / `org_rate`, about line 417) | yes | resolve by `period_start` |
| `get_payroll_settings`, `update_payroll_settings` | `payroll_service.py` ~62-140 | yes (rates), also the funding accounts added by 0045 | rates part moves to the dated table; funding accounts stay on the id=1 row |
| `GET/PUT /api/finance/payroll/settings`, `_settings_view` | `finance/routers/payroll.py` ~345-385 | yes | `GET` returns the rate in force for today plus the dated history; `PUT` creates or edits a dated row |
| Statutory payment account lookup | `finance/services/statutory_service.py` ~202 | no (funding account only) | none |
| Calculation helper defaults (`0.11` / `0.18` when None) | `payroll_calculation_helper.py` ~231 | fallback only | none (the service always passes a value) |
| Settings screen: rate fields, load and save | `fe/public/js/finance-payroll.js` (~2403, ~2661, ~2761), `fe/src/partials/admin/sections/finance-payroll.html` (~692-703) | yes | add "Effective from" and a history table |
| Review fallback table (`this.employeeInsuranceRate`) | `finance-payroll.js` ~1527 | display estimate only | unchanged |
| Mock API | `fe/api/finance/payroll-api.js` (~23, ~401, ~1245) | yes | mock the dated table |
| Tests | `test_payroll_social_insurance.py` and others that call `/payroll/settings` | yes | updated, see section 6 |

No other consumers: reports and exports read the snapshots on the lines, not the setting.

## 3. Proposed design

### 3.1 Data (migration `0046_payroll_rate_settings`; `main` head is `0045_payroll_funding_accounts`)
New table `finance_payroll_rate_settings`, following `PayrollTaxSettingsDB`:
`id`, `effective_from` (String, `YYYY-MM-01`, indexed), `employee_rate`, `employer_rate` (Float, 0 to 1), `created_at`, `created_by`, `updated_at`, `updated_by`.
Migration seeds one row from the current global row (id=1; 0.11 and 0.18 if the row is missing) with `effective_from = '2000-01-01'`, so every existing period resolves exactly as today. Idempotent; downgrade drops the table. SQLite (batch) and PostgreSQL.

`finance_payroll_settings` keeps `employee_rate` and `employer_rate` as the readable fallback and as a mirror of the newest dated row, and keeps the funding accounts (0045). It is not dropped.

### 3.2 Resolution
`get_effective_rate_settings(period_start)`: newest row with `effective_from <= period_start` (ties by id), same rule as `get_effective_tax_settings`. If no row matches (cannot happen after the seed), fall back to the global row. `_evaluate_employee_payroll_snapshots` calls it with the run's `period_start`; refresh therefore re-reads the rate for that period only.

### 3.3 Writes
- `POST /api/finance/payroll/settings/rates` `{effective_from, employee_rate, employer_rate}` and `GET /api/finance/payroll/settings/rates` (history, newest first). Permissions reuse `finance.settings.write` (write) and `finance.payroll.read` (read). No new permission key. Route-guard inventory updated.
- Guards: `effective_from` must be the 1st of a month; each rate between 0 and 1; not in or before the latest finalized/paid/partially_paid period end (same guard as the other dated settings); a row with the same `effective_from` is edited in place (like the insured base) instead of duplicated. Audit log `payroll.settings.rates_updated` keeps old and new values and the date.
- After a write the global row mirrors the rates in force for the current month, so old readers keep working.
- `PUT /api/finance/payroll/settings` keeps accepting `employee_rate` / `employer_rate` for compatibility (the funding accounts still go through it). Decision A below.

### 3.4 Draft behaviour
A draft run for month M uses the rate in force for M when it is created, previewed or refreshed. Changing a later month's rate never touches an earlier period. A change dated in the same month as an open draft changes that draft on its next refresh (expected, the owner dated it there). Finalized runs are untouched: their lines keep snapshots and the guard blocks changes in or before them.

### 3.5 UI
Payroll Settings > Social insurance rates: the two rate fields now show the rate in force, plus an "Effective from" date (1st of a month) and a "Save new rate" button, and a short history table (From, Employee, Employer; newest first, current row marked). Saving never overwrites a row with a different date. Mock mode mirrors the dated table.

## 4. Decisions needed from the owner

- **A. `PUT /settings` with rates but no date.** Options: (1) default `effective_from` to the 1st of the current month (keeps existing callers working; a same-month edit updates that month's row); (2) require the date and answer 400 without it (clear, but changes the contract and the old tests). Recommended: (1).
- **B. 2023 rate.** The 18.75% employer rate only matters if 2023 payroll is ever entered (D-040 defers 2023 and 2024). It can be added later as a dated row (`2023-01-01`, employee 11%, employer 18.75%, then `2024-01-01` back to 18%) with no code change. Confirm you do not want it pre-seeded.
- **C. Seed date.** `2000-01-01` for the seed row (so any historical period resolves). Confirm.

## 5. Out of scope
Per-employee rates, changing the insured base logic, the calculation formulas, the funding accounts.

## 6. Tests (backend, plus one UI spec)
- A run for a period before the change uses the old rate; after it, the new rate.
- Refreshing a draft never changes an earlier period or a finalized run's lines.
- A change dated in or before a finalized period is rejected; non-1st dates, rates outside 0..1 and bad dates are rejected; same-date edit updates in place; history order.
- Existing runs, snapshots and the migration seed leave results unchanged (a run before and after the migration is identical).
- Permissions (401/403/200), audit log, `test_rbac.py` green with the inventory update.
- Playwright: set a new rate with a date, history table order, mock parity.

## 7. Rollback
Revert the PR and run the downgrade. The global row still holds the mirrored rates, so calculations keep working.
