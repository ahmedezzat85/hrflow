# Fiscal-year opening balances and balance integrity (BI-1): implementation plan

Status: PLAN, owner decisions recorded October 26, 2026 (section 1). Nothing below is implemented. Proposed decision: **D-043**. Branch: `feat/fiscal-year-opening-balances` (from `origin/main`, which was at `1404adf` when this was written).
Risk class: **high** (finance money logic, schema, migration). **Production database is clean (owner, October 26, 2026): no production data exists to migrate or protect.** The legacy path (accounts without entered rows) therefore exists for tests, development databases and compatibility, and the change is inert in production until the owner enters data. Related: D-042 (FY-1 yearly summary), D-028 (balance checkpoints), D-040 (cutover), open question Q-024 (new, section 11).
Origin: known issues found during FY-1 (issues 1, 4 and 5 in `docs/finance-module/fiscal-year-reporting-discovery.md`, findings F1, F4, F5) and the owner's request to enter an opening balance by hand for every fiscal year so that an error stays inside its year.

## 1. Owner decisions (October 26, 2026)

| # | Decision |
|---|---|
| O1 | An opening balance is **entered by hand for each account and each fiscal year** (calendar year, January to December, D-042). It is stored and is the starting point for that year. An error in one year must not change any other year. |
| O2 | The system **compares** each entered opening with the previous year's calculated closing and shows the difference and a warning. A **note is optional**, not mandatory. |
| O3 | A year with **no entered opening falls back to the previous closing** (carried forward), clearly labelled, never blocked and never an error. |
| O4 | A **month view** (opening, money in, money out, closing for one month) is part of this slice. |
| O5 | No year lock (D-042 stands). |
| O6 | Negative opening balances are allowed for a yearly opening (closes known issue 5). The rule "a payment may not exceed the account balance" is **not changed** (Q-024). |

## 2. Verified facts (code on `origin/main`, October 26, 2026)

| # | Fact | Where |
|---|---|---|
| V1 | An account has one `opening_balance` (schema requires `>= 0`) and an informational `opening_balance_date`. No balance calculation reads the date. | `finance/models.py` ~303, `finance/schemas.py` ~21, ~38 |
| V2 | `ReportsService.get_point_in_time_balances(as_of_date, book, include_inactive)` = `opening_balance` + all inflows - all outflows with `date <= as_of_date`. Used by balances, balance sheet, trial balance, cash flow and the yearly summary. | `reports_service.py` ~827 |
| V3 | `AccountsRepository.compute_balance(account_id, as_of_date)` does the same; used by `recalculate_and_sync_current_balance` and by balance checkpoints (`_checkpoint_to_response`). | `repositories/accounts_repository.py` ~108 |
| V4 | `LedgerRepository.recalculate_account_running_balances(account_id)` iterates all transactions by date then id from `opening_balance`, writes `running_balance` on every row and `current_balance` on the account. It is called after every ledger change (bills, invoices, cheques, transfers, statements, payroll, settlements, subscriptions). | `repositories/ledger_repository.py` ~63 |
| V5 | `current_balance` (cached) is read by: payment sufficiency (`settlement_service` ~129, "No overdraft on any account"), statements/reconciliation book balance, transfers, forecast, attention queue (negative balance = overdraft alert), dashboard totals. | grep `current_balance` |
| V6 | The cash flow statement takes beginning cash from the balance **as of** `date_from` (inclusive), then adds the flows from `date_from`, so the first day is counted twice; `is_reconciled` is hard-coded `True`. | `reports_service.py` ~1919 |
| V7 | `get_fiscal_year_summary(year, book)` takes opening as of 31 December of the previous year and closing as of 31 December; flags transactions dated before `opening_balance_date`; shows "no data" when the year ends before `opening_balance_date`. | `reports_service.py` ~908 |
| V8 | Balance checkpoints (D-028) already exist for **partial-visibility** accounts: an observed balance on a date, with an attachment, difference shown and never posted. They are a different concept (observation, not a starting point) and are not changed. | `accounts_service.py` ~180, `routers/bank_accounts.py` ~211 |
| V9 | Account routes: read `finance.account.read`, write `finance.account.write`. A closed reconciliation month blocks creating or editing transactions in that month. | `routers/bank_accounts.py`, `ledger_repository.py` ~100 |
| V10 | Alembic head on main: `0046_payroll_rate_settings`. | `be/migrations/versions` |

## 3. Model: base point and the three functions

**Entered opening**: one row per (account, fiscal year): the balance at the **start of January 1**, before any transaction dated that day.

**Base for a date D in year Y**: the latest entered opening with `fiscal_year <= Y`; if the account has none, the **legacy** base (the account's `opening_balance`, all movements since the beginning, exactly as today).

Three functions, written once (new module `be/finance/year_openings.py`), used everywhere:

1. `balance_as_of(account, D)` = base amount + movements with `base_start <= date <= D` (`base_start` = January 1 of the base year; legacy: no lower bound).
2. `balance_at_start_of(account, D)` = the entered opening of year Y if D is January 1 of Y and a row exists; otherwise `balance_as_of(account, D - 1 day)`.
3. `year_opening_info(account, Y)` = `{opening, source, previous_closing, variance}`. `previous_closing = balance_as_of(account, Y-1-12-31)`; `source` is `entered`, `carried_forward` (no row, a base exists from an earlier entered year) or `account_opening` (legacy, no rows at all); `variance = entered - previous_closing` only when `source == entered`.

Consequences, to be pinned by tests:
- Accounts with **no entered rows behave bit for bit as today** (balances, running balances, `current_balance`).
- A year with an entered row is independent of earlier years: correcting 2024 never changes the 2025 closing.
- Once any row exists, the account's legacy `opening_balance` applies only to dates **before** the first entered year.
- Invariant for any year or month: `opening + money_in - money_out = closing`.
- `current_balance` = balance including all ledger movements, using the base for the year `max(year of the last transaction, current calendar year)`. If an entered opening exists for a later year than the last transaction (up to the current year), `current_balance` equals that opening. Entered rows dated in future years beyond the current year are ignored for `current_balance`.

## 4. Data model (migration 0047, or head + 1)

Table `finance_account_year_openings`: `id`, `account_id` (FK `finance_bank_accounts`, ON DELETE CASCADE, indexed), `fiscal_year` (Integer), `opening_balance` (Float, **may be negative**), `note` (Text, default empty), `created_by`, `created_at`, `updated_by`, `updated_at`. Unique `(account_id, fiscal_year)`. SQLite and PostgreSQL safe, with downgrade. Validation: `2000 <= fiscal_year <= current year + 1`. No change to `finance_bank_accounts` and no backfill: nothing changes until a row is entered.

## 5. Backend work

### 5.1 Resolver and recalculation (slice BI-1a)
- New `be/finance/year_openings.py` with the three functions and a bulk loader (one query per call for all accounts) so reports do not add queries per account.
- `LedgerRepository.recalculate_account_running_balances`: start `running` from the base for the year of the first transaction; whenever the transaction year changes to a year with an entered row, **reset `running` to that opening** before applying the transaction; after the loop set `current_balance` as defined in section 3. Same function, same call sites.
- `AccountsRepository.compute_balance` and `recalculate_and_sync_current_balance` use `balance_as_of`. Balance checkpoints follow automatically.
- Creating, changing or deleting a yearly opening **triggers `recalculate_account_running_balances(account_id)`** in the same transaction.

### 5.2 API (slice BI-1a), under `/api/finance/accounts/{account_id}/year-openings`
- `GET` (permission `finance.account.read`, same visibility/book scoping as the account `GET`): one item per year from the earliest year with activity or an entered row to the current year: `fiscal_year`, `entered` (bool), `opening` (entered or carried forward), `source`, `previous_closing`, `variance`, `note`, `updated_by`, `updated_at`, `closed_reconciliation_months` (count, information only), plus top level `transactions_before_first_base` (count).
- `PUT /{year}` body `{opening_balance, note?}` (upsert) and `DELETE /{year}` (permission `finance.account.write`). Audit log actions `account.year_opening.set` and `account.year_opening.deleted`. Deleting returns the year to carried forward.
- No new permission key. Update `docs/project-context/rbac/route-guard-inventory.csv`; `be/tests/test_rbac.py` stays green.
- The account form's legacy `opening_balance >= 0` rule is **unchanged** (legacy field); negatives are entered through a yearly opening.

### 5.3 Reports (slice BI-1b)
- `get_point_in_time_balances`: use `balance_as_of`; keep every existing key and its meaning (`opening_balance` stays the legacy account value); add `base_year`, `base_amount`, `base_source`. Balance sheet and trial balance need no logic change; confirm with tests.
- `get_cash_flow_statement`: `beginning_cash_balance` = sum of `balance_at_start_of(d_from)`, `ending_cash_balance` = sum of `balance_as_of(d_to)`. For each account and each January 1 of year Y inside `(d_from, d_to]` where an entered row exists, the **fiscal-year adjustment** is `variance(Y)`; list them in a new key `fiscal_year_adjustments` (account, year, amount) and show their sum as one line. `unexplained_difference = ending - (beginning + net_change + adjustments)`; `is_reconciled = abs(unexplained_difference) <= 0.01` (real check, no longer hard-coded). Keep existing keys.
- `get_fiscal_year_summary(year, book, month=None)`: opening = `balance_at_start_of(Jan 1)`, closing = `balance_as_of(Dec 31)` using the base logic. Per account add `opening_source`, `previous_year_closing`, `opening_variance`, `opening_note`; top level `warnings` (variance, carried forward, transactions before the first base). The "no data" rule applies only to accounts with no entered row and a legacy `opening_balance_date` after the year end.
- **Month view**: optional `month` (1 to 12) on the same endpoint (`GET /api/finance/reports/fiscal-year-summary?year=&month=`) and in the xlsx export. Period = first to last day of the month; opening = `balance_at_start_of(first day)` (January: the year opening; later months: the previous month's closing); `money_in`, `money_out` for the month; closing = `balance_as_of(last day)`; company spend per category for the month; response gains `period {from, to}`. No new permission key. Year-to-date columns are **not** part of this slice.

### 5.4 Not changed
`current_balance` consumers (payment sufficiency, forecast, attention queue, transfers, statements) keep reading the cached value. The "no overdraft" payment rule is unchanged (Q-024). The category summary currency mixing (known issue 3) and the checkpoint feature are unchanged.

## 6. Frontend work (slice BI-1c)

- **Accounts workspace**: a "Yearly opening balances" action on each account opens a modal with a table: Year, Opening, Calculated from previous year, Difference, Note, Edit / Remove. Years without an entered row show the carried-forward value in a lighter style labelled "Carried forward" with a "Set opening" action. A difference other than 0.00 is highlighted with the text "Differs from the previous year's closing by X. Add a note to explain it (optional)." Editing needs `finance.account.write`; viewing needs `finance.account.read` (follow the checkpoints modal pattern).
- **Reports > Yearly summary tab**: add a **Month** selector next to the year selector ("Whole year", January to December); headings show the period; a badge per account row for the opening source (Entered / Carried forward); a warnings banner for variances with a link to the account's yearly openings modal.
- **Reports > Cash flow**: show the "Fiscal-year opening adjustments" line when present and a clear warning when `is_reconciled` is false, with the unexplained difference.
- **Account create/edit form**: keep the legacy opening balance fields (they stay valid) but add a short hint under them: "For yearly figures, use Yearly opening balances after saving the account. An entered yearly opening replaces this value for that year and later."
- Mock API and fixtures in the same place the account and report mocks live (mock-first pattern), real API calls, Playwright specs for the modal and the month selector. Smoke test against the real backend and report it.

## 7. Tests (must exist before the slice is called done)

Backend:
1. **Legacy golden tests**: accounts without rows give identical `balance_as_of`, running balances, `current_balance`, yearly summary figures and cash flow (apart from the corrected first-day rule) as before.
2. Base selection with rows for 2024 and 2026 and dates in 2023, 2024, 2025, 2026; an entered row overrides the chain; a year with no row is labelled `carried_forward`.
3. Variance: entered above and below the previous closing; no row; first entered year against the legacy chain.
4. Running balance restarts at each entered year; `current_balance` with an opening entered for the current year and no transactions yet; future-year rows ignored.
5. Negative yearly opening allowed; settlement still refuses a payment above the balance (Q-024 pinned).
6. CRUD: upsert, delete, uniqueness, year range, audit log, permissions (401, 403, 200 per key), recalculation triggered.
7. Checkpoint `computed_balance` follows the base logic.
8. Cash flow: opening 1,000 dated for May 1, one outflow of 100 on May 1, range May 1 to May 31: beginning 1,000, outflow 100, ending 900, reconciled. A range crossing January 1 with a variance of +50: adjustment line +50, reconciled; a forced mismatch gives `is_reconciled = false` and the unexplained difference.
9. Month view: for every month the invariant opening + in - out = closing; opening of month m+1 equals the closing of month m inside a year; January opening equals the year opening; the sum of the months equals the year totals; multi-currency totals stay separate; xlsx export carries the month.
10. Yearly summary and balance sheet/trial balance regression tests.
11. Migration up and down on SQLite; PostgreSQL run if available (report if not).

Frontend: Playwright for the modal (set, edit, remove, difference highlight, permission gating) and the month selector; console-error check.

## 8. Slices and order

| Slice | Scope | Stop and report |
|---|---|---|
| BI-1a | Table and migration, resolver, recalculation, `current_balance`, CRUD API, RBAC inventory, backend tests 1 to 7 | yes |
| BI-1b | Reports: point-in-time, cash flow, yearly summary with month view, xlsx, tests 8 to 11 | yes |
| BI-1c | Accounts modal, yearly summary month selector and warnings, cash flow display, mock + real smoke, Playwright | yes |

All on `feat/fiscal-year-opening-balances`, commits per slice. The first commit on the branch is the documentation (section 10).

## 9. Acceptance criteria

1. With no entered rows nothing changes for any account (golden tests).
2. The owner can enter, edit and remove an opening balance per account per year, with an optional note, and negative values are accepted.
3. A year's figures never depend on an earlier year's entered opening; correcting one year changes no other year.
4. Each entered opening shows its difference from the previous year's calculated closing, with a visible warning when it is not zero; a missing year is carried forward and labelled.
5. The cash flow statement has no first-day double count and a real reconciliation flag; year-boundary differences appear as an explicit adjustment line.
6. For any year and any month: opening + money in - money out = closing, and each month's opening equals the previous month's closing.
7. The month view is available in the yearly summary and its export.
8. No new permission key; route-guard inventory and RBAC tests green.
9. Payment sufficiency still uses `current_balance` and still refuses a payment above the balance.
10. Migration reversible; no data change at upgrade.

## 10. Documentation to commit first (before any code)

1. This plan, at `docs/finance-module/fiscal-year-opening-balances-plan.md`.
2. `04-decision-log.md`: add **D-043** (Accepted by owner October 26, 2026; implementation not started): yearly opening balances entered by hand per account and fiscal year; derived comparison with warning and optional note; fallback to the previous closing; month view; negative yearly openings allowed; resolves known issues 1 (as far as reporting), 4 and 5 of D-042; payment rule unchanged.
3. `05-roadmap-and-next-slices.md`: new section **3L** (BI-1a, BI-1b, BI-1c, status "planned, branch `feat/fiscal-year-opening-balances`") and a row in the 4B register; mark section 3K statuses as merged (FT-1, FX-1, SI-1, FY-1) and section 3J / D-038 as implemented, and the Pay analytics review fixes as merged, if they are still shown as pending (they are on `main`).
4. `06-open-questions.md`: add **Q-024** (section 11) to the table and body.
5. `fiscal-year-reporting-discovery.md`: append a one-line pointer "findings F1, F4, F5 are handled by BI-1 (D-043)".

## 11. Open question and follow-ups

- **Q-024: may a payment exceed an account's balance (overdraft)?** Today `settlement_service` refuses any payment above `current_balance` on every account, while the attention queue treats a negative balance as an overdraft alert. With negative yearly openings allowed, an overdrawn account can exist but still cannot pay. Options: keep as is; add a per-account "allow overdraft" setting. Owner decision needed only if an overdraft or credit-card account exists.
- Not in this slice: year lock (D-042); category summary currency mixing; blocking guard for transactions dated before the first opening (the account's yearly openings list reports them as a count instead); attaching a statement file to a yearly opening (checkpoints exist for partial accounts, D-028); year-to-date columns.
- **Deployment order (production is clean):** merge and deploy BI-1 (with the earlier migrations 0044 to 0046 if production is not yet on them) **before** entering any account balance data, so the legacy single opening is never relied on in production. Take a database backup before the first real data entry. Employee, pay-history and payroll-run entry do not depend on BI-1.
- Owner data entry after merge: for each account, enter the openings from the bank statements, starting with the current year; then look at the differences column.

## 12. Rollback

Delete the rows (or revert the PR and downgrade the migration). With no rows entered, behaviour equals today's, so the change is inert until used. Recalculation is idempotent: running it again restores consistent running balances.
