# Payroll Engine Wiring Fix — Targeted Plan

Related: `docs/payroll/02-fux-417-payroll-run-compensation-split-fx.md`, `docs/payroll/00-payroll-module-overview.md`.

## Symptom

After implementing FUX-416–419, running payroll through the "Run Payroll" wizard still shows the old engine: flat 5% deductions / 10% tax / 12% employer cost, no External/Internal split.

## Root cause (confirmed from commit diffs `a66cf99`, `bb64ff3`, `2c28fb2`, `be06124`)

Two issues, both confirmed directly from the actual commit patches on `feature/payroll`:

### 1. `preview_run()` silently falls back to the pre-FUX-417 formula

In `be/finance/services/payroll_service.py`, `preview_run()` branches per employee:

```python
comps = comp_repo.get_components_for_period(emp.id, period_start, period_end)
if comps:
    # new split logic: external_usd / internal_usd_cash typed lines
    ...
else:
    # OLD ENGINE - still present, this is what you are seeing:
    base_salary = float(emp.salary or 0.0)
    deductions = round(base_salary * 0.05, 2)
    tax_amt = round(base_salary * 0.10, 2)
    employer_extra = round(base_salary * 0.12, 2)
    ...
```

Any active employee **without** an `EmployeeCompensationPlanDB` row (FUX-416) silently uses the old flat formula. This is a real fallback path in the shipped code, not a caching or UI issue.

### 2. The "Run Payroll" wizard likely still targets the pre-FUX-417 endpoints

`generate_run_from_compensation_plans()` (backing `POST /api/finance/payroll/runs/generate`) was added in FUX-417 and is covered by its own test suite (`test_finance_payroll_split_fx.py`), but the wizard's Step 1→Step 2 flow in `fe/public/js/finance-payroll.js` (`navigateWizardStep()`) and submission (`submitWizardCreateRun()`) call `FinanceApi.previewPayrollRun()` / `createPayrollRun()` — the older preview/create path — based on the FUX-417 diff. FUX-419 refactored the frontend API surface into modular files under `fe/api/finance/` (including a new `payroll-api.js`), so this needs re-verification against the current file, not the FUX-417-era diff.

## Fix — Step by step (apply locally / via coding agent with full file read access)

### Step 1 — Verify employee data first

Before touching code, open the Salary panel for each active employee and confirm whether an External/Internal compensation plan (FUX-416) is actually set. If none are set, the wizard will legitimately have nothing new to show regardless of code correctness — rule this out first since it is the cheapest check.

### Step 2 — Remove the silent fallback in `preview_run()`

File: `be/finance/services/payroll_service.py`

Replace the `else` branch (the one computing `base_salary * 0.05/0.10/0.12`) with a blocking exception, mirroring the guard already enforced in `generate_run_from_compensation_plans()`:

```python
comps = comp_repo.get_components_for_period(emp.id, period_start, period_end)
if not comps:
    has_blocking = True
    exceptions.append({
        "id": f"exc-plan-{emp.id}",
        "employee_id": emp.id,
        "employee_name": emp.name,
        "severity": "blocking",
        "title": "No Active Compensation Plan",
        "description": f"{emp.name} has no active external/internal compensation plan configured for this period. Configure their plan under Salary before running payroll.",
        "correction_path": f"/admin?section=salary&employee_id={emp.id}",
        "is_resolved": False,
    })
    continue

for comp in comps:
    # existing split logic unchanged
    ...
```

Delete the old `base_salary = float(emp.salary or 0.0)` block and its associated exception-building code entirely — `generate_run_from_compensation_plans()` already proves this validation approach works (see its own test: `test_generate_payroll_run_missing_plan_error`).

### Step 3 — Confirm (and if needed, repoint) the wizard's API calls

File: `fe/public/js/finance-payroll.js` (and/or `fe/api/finance/payroll-api.js` post FUX-419 refactor)

Check what `navigateWizardStep()` and `submitWizardCreateRun()` actually call today:
- If they call `previewPayrollRun()` / `createPayrollRun()`: either (a) repoint them to `generatePayrollRun()` (`POST /api/finance/payroll/runs/generate`), which already produces correctly split, FX-locked lines from compensation plans, or (b) keep `preview_run()`/`create_run()` as the wizard's path but ensure Step 2 fix above makes them behave identically to `generate_run_from_compensation_plans()` — either is acceptable as long as there is exactly one effective behavior, not two divergent ones.
- If they already call `generatePayrollRun()`: the bug is likely isolated to Step 1 (data), not Step 3 (wiring) — re-check Step 1.

### Step 4 — Regression check

Run `be/tests/test_finance_payroll_split_fx.py` and `be/tests/test_finance_models.py` after the `preview_run()` change to confirm no existing test asserted the old fallback behavior (none should, since `generate_run_from_compensation_plans()`'s own tests already expect rejection, not silent computation, for missing plans).

## Acceptance check

- An active employee with no compensation plan produces a blocking exception in the wizard preview, not a computed payroll line.
- An active employee with a compensation plan shows correctly split External/Internal (and Commission/Bonus once used) lines with the new engine's numbers, not 5%/10%/12% flat math.
- Only one behavior exists for "run payroll" — whichever endpoint the wizard calls, it must match `generate_run_from_compensation_plans()`'s validation and split logic.
