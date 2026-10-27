# Historical period eligibility for payroll runs (HP-1): implementation plan

Status: IMPLEMENTED on `feat/hp1-historical-payroll-eligibility` (from `origin/main` at `e2b6fb9`), awaiting review. Decision: **D-045**. Risk class: **high** (money logic), small code surface, **no migration**.
Why now: the owner is about to enter 2025 and 2026 payroll history. Before HP-1 the employee list of a run did not depend on the period, so the workaround was to keep leavers Active and delete lines by hand.

## 1. Owner rule (October 26, 2026)

A **historical period** is a period whose `period_end` is before the first day of the current month ("today" is `date.today()`, the server's local date, like `finance/year_openings.py`).

For a historical period the candidate set is **all employees regardless of status**, and an employee is included only if:
1. at least one compensation component overlaps the period (`CompensationPlanRepository.get_components_for_period` returns rows), and
2. `join_date`, when it parses to a date, is not after `period_end`. An empty or unparsable `join_date` never excludes anyone.

Everything else about a line (components, insurance, tax method, rates, FX, variable pay) is unchanged. For the current month or later, behaviour is exactly as before: status Active only, a missing plan blocks (`MISSING_COMP_PLAN` exception in preview and refresh, HTTP 400 in `POST /runs/generate`). The On Leave handling (E4) is not part of this slice.

## 2. Design

- `be/finance/payroll_eligibility.py`: `is_historical_period`, `historical_skip_reason`, `parse_date` (pure, unit-tested; `_today` is patchable). Called only from `PayrollService._evaluate_employee_payroll_snapshots`, which serves preview, `generate_run_from_compensation_plans` and `refresh_run`; `create_run` goes through preview.
- Skipped employees are never silent: the snapshot carries `historical_period` and `skipped_employees: [{employee_id, employee_name, reason}]`, reason `NO_PLAN_IN_PERIOD` or `JOINED_AFTER_PERIOD`. Preview returns them at top level. For saved runs they are stored inside the existing `variance_summary_json` (no column, no migration) and surfaced at top level of the run detail by `_format_run_detail`; create, generate and refresh keep them current.
- `headcount` and the variance headcount delta count included employees only.
- Create-mode (`generate`): in a historical period nobody is blocked for lacking a plan. In a non-historical period the 400 stays.
- Refresh uses the same rule, so it cannot restore a line for a skipped employee. Refresh was already refused for any status other than `draft`; finalized and paid runs are never recomputed (pinned by a test).
- Leavers: the owner closes the leaver's last pay plan (`effective_end_date` = last day). Later months drop the employee automatically. The leave month stays at full plan amounts and the owner edits the line (no proration, E5). No "partial month" flag exists on lines; one would be easy to add later (a line note when `effective_end_date` falls inside the period).
- Existing draft runs for past periods change on refresh (they may lose lines). No data migration.
- No route is added or changed, so the RBAC inventory is unchanged.

## 3. Frontend (HP-1b)

Payroll wizard screen 2 (`#p2HistoricalPanel`): a "Historical period" badge when `historical_period` is true and a collapsible "Skipped employees (N)" list with name and reason. Mock API (`fe/api/finance/payroll-api.js`) derives `historical_period` from the period end and returns two skipped employees for past periods. Spec: `fe/tests/ui/payroll-historical-period.spec.js`.

## 4. Tests

`be/tests/test_payroll_historical_eligibility.py`: golden tests for the current month (written against the pre-HP-1 code first), pure helper and period boundary, mid-year hire, leaver with a closed plan, gap in plan history, join date after period end, empty/unparsable join date, Inactive/On Leave/Resigned with a plan, generate without a 400, create stores the list, refresh never restores a skipped employee, finalized refresh refused, twelve months of 2025 with hand-computed totals.

## 5. Out of scope

Archived state, employment periods (EA-1/LJ-1 will later replace the plan-based inference with real employment periods; HP-1 does not conflict with it), proration, the On Leave rule (E4), any change to current-month eligibility.

## 6. Note for the cutover guide (Phase 3)

Leavers can be set Inactive immediately; each leaver's **last pay plan needs an end date** (their last working day). Without an end date the employee keeps appearing in every later historical month. The leave month shows the full plan amount: edit the line by hand.
