# Fiscal year reporting (FY-1): discovery note

Status: APPROVED by the owner on October 25, 2026 (answers in section 5); implemented. Decision D-042. Branch: `feat/fiscal-year-reporting` (from `main` at `0107a73`).
Scope (owner, D-040): reports only, no year lock. Fiscal year = January to December, start month as a setting (default 1). For every single year: opening balance, closing balance, money in, money out, spend.

## 1. Verified facts (code on main)

| # | Fact | Where |
|---|---|---|
| V1 | Only cheques have a `fiscal_year` field. | `finance/models.py` ~414 |
| V2 | Point-in-time balances: `GET /api/finance/reports/balances?as_of_date=&book=`. Per active account: `opening_balance + sum(in) - sum(out)` for ledger rows dated on or before `as_of_date` (inclusive). | `ReportsService.get_point_in_time_balances`, `routers/reports.py` ~300 |
| V3 | Date-range reports exist: category summary, profit and loss, balance sheet, trial balance, cash flow, transactions. Cash flow, balance sheet and trial balance already call the point-in-time function for their opening and closing figures. | `reports_service.py` ~462, ~1484, ~1692, ~1824, ~1919 |
| V4 | An account has one `opening_balance` and one `opening_balance_date`. The create and update schemas require `opening_balance >= 0`. | `finance/models.py` ~303, `finance/schemas.py` ~21, ~38 |
| V5 | Ledger rows have no status or void flag; `date` is a `YYYY-MM-DD` string. Own-account movements (transfers, exchange, cash withdrawals) are classified out of revenue and spend by `cash_basis.classify()` / `is_own_account_movement`. | `finance/models.py` ~336, `finance/cash_basis.py` |
| V6 | There is no general company-settings store (see section 3). | |

## 2. Findings that matter for the design

**F1. Point-in-time balances ignore `opening_balance_date` (pinned by tests, not changed).**
The balance is `opening_balance` plus every inflow minus every outflow dated up to `as_of_date`, whatever the opening date is. So:
- a transaction dated before the opening date is added on top of the opening balance (opening 1,000 on 2025-01-01, +200 dated 2024-06-15, -100 dated 2025-03-01: balance at 2025-12-31 is 1,100, not 900);
- an `as_of_date` before the opening date still returns the opening balance (1,000 on 2023-01-01), so the account looks funded before it existed.
For your plan (opening balance set to 1 January of the earliest imported year, nothing imported before it) the figures are correct. It goes wrong only if transactions earlier than the opening date are ever imported. Report only; no change without your approval.

**F2. Inactive accounts disappear from history.** Point-in-time balances list only `is_active` accounts, so an account closed in 2026 vanishes from the 2025 yearly summary even though it held money then.

**F3. The category summary mixes currencies.** It sums `amount` across all currencies unless `currency` is passed, and it also counts outflows that are own-account movements (it does not use `cash_basis`), so its "total spent" can be higher than the dashboard and profit and loss spend. The new report must group by currency, and you must pick the spend definition (decision D3).

**F4. Cash flow double-counts its first day.** `get_cash_flow_statement` takes the beginning cash from the balance as of `date_from` (inclusive) and then adds the flows from `date_from` as well, so flows on the first day are in both; `is_reconciled` is hard-coded `True`. The yearly summary avoids this by taking the opening as of the day before the year starts. Not fixed here; tell me if you want it fixed separately.

**F5. Negative opening balances are rejected** (`ge=0`). An account that is overdrawn on the opening date cannot be entered. Out of scope unless you need it.

## 3. Where to store the start month: no existing mechanism fits

Searched `core/` (RBAC and permissions only), `models_db.py`, `finance/models.py`, `db.py`, `config.py`. The only stores are:
- `Config` environment variables (`config.py`): per deployment, no screen, a redeploy to change;
- `finance_payroll_settings` (`PayrollSettingsDB`, single row id=1): a payroll-only table, wrong domain for a company-wide report setting.
I did not invent a store. Options for decision D1:
1. **Config variable** `FISCAL_YEAR_START_MONTH` (default 1). No schema, no screen. Simple and enough if the start month never changes.
2. **Small singleton table** `finance_report_settings` (one row, `fiscal_year_start_month`), edited in Reports with `finance.settings.write`, same pattern as `PayrollSettingsDB`. One migration (`0046` after `main`'s `0045`, or the next free number at merge time).
Recommended: option 2, because you asked for a setting you can see and change.

## 4. Proposed design

**Endpoint (as built)** `GET /api/finance/reports/fiscal-year-summary?year=YYYY[&book=][&format=xlsx]`, permission `finance.report.read` (no new key; route-guard inventory updated).
- Year bounds: 1 January to 31 December of `year` (no start-month setting).
- Per account (all currencies, never added together): `opening` = point-in-time balance as of the day before the year starts; `money_in`, `money_out` = sum of ledger inflows and outflows dated inside the year; `closing` = point-in-time balance as of the year end; `currency`, `account_name`, `book`. Identity checked per row: `opening + in - out = closing`.
- Per currency totals only.
- Per category: spend for the year, grouped by currency, from the existing category summary logic so the numbers agree with the Category Summary report.
- Warnings, not changes: rows per account for ledger transactions dated before the account's `opening_balance_date` (F1), and a flag when the whole year ends before the opening date (the account did not exist yet).
- Reuses `get_point_in_time_balances` for both boundaries, so figures agree with `/balances` on the two boundary dates by construction.

**Frontend:** Reports gets a "Yearly summary" tab: year selector (years from the earliest transaction or opening date to the current year), account table, category table, per-currency totals, xlsx export like the other reports (`excel_exporter`, same pattern as `export_balances_xlsx`).

**Tests:** opening of year N equals closing of year N-1 for every account; a year with no activity (opening = closing); a negative closing balance; multi-currency (no cross-currency totals); boundary dates equal `/balances`; category spend equals the category summary for the year; the F1 warning; non-January start month; RBAC and route-guard inventory green; one Playwright spec in mock mode.

## 5. Owner answers (October 25, 2026) and what was built

- **D1 and D2:** January always, nothing configurable. No start-month setting, no settings table, no migration. Section 3 (storage options) is therefore not used.
- **D3:** account figures keep every movement (so statements match the system); company spend excludes own-account transfers within the same country. Transfers to an account in another country stay in spend, shown as "Transfers to another country".
- **D4:** years that end before an account's opening date show "no data"; transactions before the opening date are flagged.
- **D5:** inactive accounts appear only when they had activity or a balance in the year.
- **D6** (cash flow first-day double count): left as is. Plain words: the Cash Flow statement takes its beginning cash from the balance on its first day, including that day's transactions, and then adds the same day's transactions again, so its numbers are off by that day's net movement and it still says "reconciled". The yearly summary avoids this by taking the opening from the day before the year starts.

## 6. Rollback
Revert the PR. Nothing existing changes: the new endpoint and tab are additions (the balances report only gains two extra fields and an optional inactive-accounts switch).

Findings F1, F4, F5 are handled by BI-1 (D-043); plan: `docs/finance-module/fiscal-year-opening-balances-plan.md`.
