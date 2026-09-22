# FUX-419 — Compensation & spend reporting

Related: `docs/payroll/02-fux-417-payroll-run-compensation-split-fx.md`, `docs/payroll/03-fux-418-commission-bonus-entry.md`, `docs/finance-module/12-fux-410-statutory-obligations-tracker.md`, `finance/routers/reports.py`.

**User story:** As a finance/product admin, I want reports showing total compensation per employee and per period broken down by type, total company salary spend, and total statutory obligations settled, so that I can answer spend and payroll questions without exporting to a spreadsheet.

## Context

Once FUX-416–418 land, every dollar of compensation (external, internal, commission, bonus) exists as a correctly-typed `PayrollLineDB` row, and every settled tax/insurance obligation exists in `StatutoryObligationDB` with `amount_remitted` populated by `SettlementService`. This story adds no new source-of-truth tables — it is a pure reporting layer over data that will already exist, following the pattern already established in `finance/routers/reports.py`.

## High-level scope

1. **Per-employee compensation report**: total external, internal, commission, bonus, and grand total for a given employee across a selected period (month, year, multi-year, or custom date range).
2. **Company salary spend report**: aggregate total compensation across all employees for a selected period, broken down by compensation type, for expense/spending reporting purposes.
3. **Statutory obligations paid report**: total tax and social insurance actually remitted (not just accrued) for a selected period — a thin aggregation over `StatutoryObligationDB.amount_remitted`, already fully supported by FUX-410's data model with no new fields required.
4. **Payable/paid status view**: a single view showing, per period, the status of each of the four money flows (external transfer, internal cash, tax obligation, insurance obligation) — pending vs. settled — for at-a-glance tracking of what's outstanding.
5. All reports support the same date-range flexibility already used elsewhere in the finance module (month, year, multi-year, custom range) rather than being locked to calendar-month periods only.

## Implementation level

- `finance/routers/reports.py`: add new report endpoints following the existing pattern (likely already has date-range query param handling reusable here):
  - `GET /api/finance/reports/compensation/employee/{employee_id}?start_date=&end_date=` — grouped by `compensation_type`, with grand total.
  - `GET /api/finance/reports/compensation/company?start_date=&end_date=` — grouped by `compensation_type` across all employees, plus per-employee breakdown option.
  - `GET /api/finance/reports/statutory/remitted?start_date=&end_date=` — sums `StatutoryObligationDB.amount_remitted` grouped by `obligation_type` and `period`, filtered to periods within range.
  - `GET /api/finance/reports/payroll/payable-status?period=` — one row per money-flow type (external, internal, tax, insurance) per employee/company with pending/settled amounts, joining `PayrollLineDB` (for external/internal payment tracking, assuming a lightweight payable/paid flag or linked `PaymentDB` reference is added alongside FUX-417 if not already present) and `StatutoryObligationDB` (for tax/insurance).
- If `PayrollLineDB` does not yet have a payment-settlement link for the external/internal lines specifically (distinct from the run-level `bank_account_id`/`paid_at` already on `PayrollRunDB`), this story adds a `paid_at` and `linked_payment_id` to `PayrollLineDB` so per-line (not just per-run) settlement tracking is possible — needed for the payable-status report to be accurate at the individual employee level rather than only at the whole-run level.
- Frontend: extend the existing Finance Reports page (`finance-reports.html` per the FUX-415 sidebar convention) with a new "Payroll & Compensation" report category, reusing existing chart/table components and the date-range picker already used by other finance reports.
- No changes to `StatutoryObligationDB`, `SettlementService`, or the FUX-410 confirm/settle flow — this story only reads from them.

## Acceptance criteria

- The per-employee compensation report correctly sums external, internal, commission, and bonus amounts for any selected date range spanning one or more payroll runs, matching manual spot-checks against the underlying `PayrollLineDB` rows.
- The company salary spend report's grand total matches the sum of all individual employee reports for the same period (no double-counting or omission).
- The statutory remitted report shows only `amount_remitted` (money actually paid), not `amount_accrued` or `amount_estimated` — accrued-but-unpaid obligations do not inflate the "paid" figure.
- The payable-status view clearly distinguishes pending vs. settled for each of the four money-flow types, for both a single employee and the whole company.
- All reports correctly handle a custom date range spanning multiple payroll periods and multiple years without requiring the user to query month-by-month manually.

## Verification plan

- Seed two payroll runs (two consecutive months) with a mix of external, internal, commission, and bonus lines for two test employees; confirm the per-employee and company reports produce correct totals matching manual calculation.
- Settle a subset of statutory obligations across the two periods; confirm the remitted report reflects only the settled amounts and the payable-status view correctly flags the remainder as pending.
- Query a custom date range crossing a calendar year boundary; confirm totals are correct and no period is double-counted or skipped.
- Regression-test the existing `finance/routers/reports.py` endpoints to confirm the new report additions don't alter existing report behavior or response shapes.
