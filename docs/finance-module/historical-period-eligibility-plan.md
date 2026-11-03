# HP-1: Historical period eligibility for payroll runs

**Date:** October 26, 2026. **Status:** plan, awaiting implementation. **Risk class:** high (money logic), small code surface, **no migration**.
**Baseline:** `origin/main` at `e2b6fb9` (BI-1 merged). Re-verify names and line numbers before changing code.
**Why now:** the owner is about to enter 2025 and 2026 payroll history. Today the employee list of a run does not depend on the period, so the workaround is to keep leavers Active and delete lines by hand.

## 1. Facts verified on `main`
- `PayrollService._evaluate_employee_payroll_snapshots(period_label, period_start, period_end, resolved_fx, missing_plan_mode)` in `be/finance/services/payroll_service.py` selects employees with `EmployeeDB.status.ilike("active")`. No hire or leave filter.
- It is called three times: run preview (`missing_plan_mode="exception"`), run creation (`"error"`, raises 400 when an Active employee has no plan) and `refresh_run` (`"exception"`).
- Already period-aware and **not to be changed:** `CompensationPlanRepository.get_components_for_period` (effective_start_date <= period_end and effective_end_date null or >= period_start), social insurance (`get_insurance_for_period`), tax method (`tax_method_repo.get_for_period`), SI rates and tax brackets by `period_start`.
- A past-period employee with no plan produces a blocking `MISSING_COMP_PLAN` exception (or the 400 in create mode). `EmployeeDB.join_date` is a free string, `status` is free text, there is no leave date.

## 2. Rule (decided by the owner on October 26, 2026)
**Historical period** = a period whose `period_end` is before the first day of the current month (use the application's existing "today" source, which respects the local timezone; do not use naive UTC).

For a historical period the candidate set is **all employees regardless of status**, and an employee is included only if:
1. at least one compensation component overlaps the period (`get_components_for_period` returns rows), and
2. `join_date`, when it can be parsed to a date, is not after `period_end`. An empty or unparsable `join_date` never excludes anyone.

Everything else about the line (components, insurance, tax method, rates, FX, variable pay) is unchanged.

For a non-historical period (current month or later) behaviour is **exactly as today**: status Active only, missing plan blocks. The On Leave handling decision (E4) is **not** part of this slice.

## 3. Skipped employees must be visible
Employees excluded from a historical run are returned as `skipped_employees: [{employee_id, employee_name, reason}]` with reason `NO_PLAN_IN_PERIOD` or `JOINED_AFTER_PERIOD`, plus `historical_period: true`, in the snapshot returned by preview, create and refresh. Skipping is never silent. If a run record has a notes/metadata field, store the count there; do not add a column or migration for this slice (preview and refresh responses are enough).

## 4. Behaviour details
- Create-mode (`"error"`): in a historical period nobody is blocked for lacking a plan; they are skipped and listed. In a non-historical period the 400 stays.
- Leaver handling: the owner closes the leaver's last pay plan (`effective_end_date` = last day). Months after that drop the employee automatically. The leave month stays at full plan amounts and the owner edits the line (no proration, E5). The line carries no new flag in this slice unless one already exists; mention it in the report if a "partial month" marker would be easy to add.
- `refresh_run` uses the same rule, so it cannot restore a line for a skipped employee. Existing finalized or paid runs are never recomputed (check that refresh is already refused for them and keep it that way).
- Existing draft runs for past periods will change on refresh (they may lose lines). Document this in the report; no data migration.
- The helper that decides eligibility is a small pure function with unit tests, called from `_evaluate_employee_payroll_snapshots`; do not duplicate the rule at the three call sites.

## 5. Frontend (HP-1b, small)
In payroll run preview/detail: a "Historical period" badge when `historical_period` is true, and a collapsible "Skipped employees (N)" list showing name and reason. No other screen changes. Update the mock API and fixtures; add a Playwright spec for the badge and the list.

## 6. Tests (backend)
1. Employee hired mid-year (plan starts June): excluded from January to May runs with `NO_PLAN_IN_PERIOD`, included from June.
2. Leaver with plan end date 31 March, status Inactive: included in January to March, skipped from April.
3. Employee with a gap in plan history: skipped in the gap months.
4. Active employee with plan but `join_date` after the period end: skipped `JOINED_AFTER_PERIOD`.
5. Empty and unparsable `join_date`: included when a plan overlaps.
6. Status Inactive and On Leave employees with a plan: included in a historical run.
7. Current-month run: unchanged (Inactive excluded, Active without plan raises the same error/exception as before). Golden test written first against current behaviour.
8. Period boundary: a period ending on the last day of the previous month is historical; the current month is not.
9. `refresh_run` on a historical draft does not restore a skipped employee; refresh of a finalized run is still refused.
10. Create-mode in a historical period with a plan-less employee: no 400, skipped listed.
11. Twelve-month scenario (2025): mixed hires and leavers, totals per month match hand-computed values.
Run the full backend suite and report exact counts against the baseline.

## 7. Documentation
Decision-log entry (use the next free number after D-044, provisionally D-045): the rule in section 2 and the skipped-employee visibility. Roadmap: add HP-1 and note that EA-1/LJ-1 (employment periods table, owner choice E2) later replace the plan-based inference with real employment periods; HP-1 does not conflict with it. `docs/finance-module/` plan copy is this file. Cutover guide: add to Phase 3 that leavers can be set Inactive immediately and that each leaver's last plan needs an end date (note for the owner; update the Project copy, not the repository, unless the repository already has the guide).

## 8. Acceptance criteria
- A 2025 run lists exactly the employees whose plan overlaps that month and whose join date allows it; skipped employees are listed with reasons.
- A current-month run behaves as before (golden tests unchanged).
- No migration, no change to finalized/paid runs, backend suite green, RBAC test unchanged (no route changes expected; if a route changes, update the route-guard inventory).
- Owner can set a leaver to Inactive without losing their historical months.

## 9. Out of scope
Archived state, employment periods, LJ-1, proration, On Leave rule (E4), any change to current-month eligibility.
