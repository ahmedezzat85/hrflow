# Payroll UI/Data Fixes — Execution Plan (Bank Warning, Compensation Sync)

Related: `docs/payroll/05-payroll-engine-wiring-fix-plan.md`, `docs/payroll/01-fux-416-employee-compensation-plan.md`.

Purpose of this doc: give a coding agent exact file paths, exact functions, and exact before/after logic so it can jump straight to editing without re-discovering the codebase. No exploratory search should be needed — read only the specific function named in each fix, patch it, run the specific test named, done.

## Fix 1 — Downgrade "Missing Bank Wire Details" from blocking to warning

**Why:** Payroll here is a compensation-tracking/concept tool, not the wire-transfer execution engine. Missing bank details should not prevent creating/approving a payroll run.

**File:** `be/finance/services/payroll_service.py`
**Function:** `preview_run()` (and if duplicated, `generate_run_from_compensation_plans()` — check both, they historically had parallel exception-building blocks for the same check)

**Exact change:** Find the exception dict with `"title": "Missing Bank Wire Details"`. Change:
```python
"severity": "blocking",
```
to:
```python
"severity": "warning",
```
Do not change anything else in that dict (`id`, `title`, `description`, `correction_path` stay as-is). Do not touch the "No Active Compensation Plan" exception — that one stays `blocking` (see Fix 2 rationale below, no change needed there, it is correct as-is).

**Frontend check (should need no change, verify only):** `fe/public/js/finance-payroll.js` already reads `severity === "blocking"` generically via the `isBlocking()` helper introduced in the last fix commit (`648ccaf`) to compute `hasBlocking` for disabling the Create/Approve button. Since this fix only changes the *value* of `severity` on one exception type, not the detection logic, no JS change should be required. Confirm by reading `isBlocking()` in that file only — do not re-scan the whole file.

**Test to run:** `be/tests/test_finance_guided_payroll.py::test_payroll_preview_and_exception_detection` — update its assertion if it currently expects `"Missing Bank Wire Details"` to be blocking; it should now just confirm the exception exists with `severity == "warning"`.

**Optional (defer if it adds scope):** Introduce a config flag (e.g. `PAYROLL_REQUIRE_BANK_DETAILS`) so this can be turned back to blocking later once an actual transfer/disbursement engine is built. Not required for this fix; only do this if it is a trivial one-line addition, otherwise skip and leave it hardcoded to warning.

## Fix 2 — Sync employee-creation salary fields into the Compensation Plan automatically

**Why:** `EmployeeDB.internal_salary_usd` / `external_salary_usd` (added 2026-08-18, commit `8b1bca2`) and `EmployeeCompensationPlanDB` (added 2026-09-17, FUX-416) are two separate stores for the same concept. The employee-creation form writes only the first; the payroll engine reads only the second. Result: every employee created via the normal employee form shows "$0.00 — No active plan" in the Compensation Plan modal despite having values, forcing tedious re-entry.

**Do not remove or rename either field/table.** This fix is purely additive: write to both places from one action.

### Step 2a — Write-through on create/update

**File:** find the employee create/update service function that currently sets `internal_salary_usd` / `external_salary_usd` (per commit `8b1bca2`, this is in the employee service/router layer — search only for the literal string `internal_salary_usd` to locate it, do not read the whole employees module).

**Exact change:** immediately after `internal_salary_usd` and/or `external_salary_usd` are written (create or update), call the existing FUX-416 compensation-plan service to set the matching component(s):

```python
from finance.services.compensation_plan_service import CompensationPlanService
comp_service = CompensationPlanService(db)

if internal_salary_usd is not None and internal_salary_usd > 0:
    comp_service.set_component(
        employee_id=employee.id,
        component_type="internal_usd_cash",
        amount=internal_salary_usd,
        effective_start_date=<today's date, or the employee's start date on create>,
        notes="Synced from employee profile",
    )
if external_salary_usd is not None and external_salary_usd > 0:
    comp_service.set_component(
        employee_id=employee.id,
        component_type="external_usd",
        amount=external_salary_usd,
        effective_start_date=<same>,
        notes="Synced from employee profile",
    )
```

Use whatever the actual method name/signature is in `compensation_plan_service.py` (`set_component` is the name used in the FUX-416 story spec; verify against the real file, but do not read the whole file — grep only for `def set_component` or equivalent setter to confirm signature).

**Idempotency:** `set_component()` already closes the prior open-ended row and inserts a new one (per FUX-416 design) — so calling it again on every update is safe and matches the "effective-dated history" design. No extra guard needed.

**On employee update where only one of the two fields changes:** call `set_component()` only for the field(s) present in the update payload, exactly mirroring the existing legacy-`salary`-recompute logic already in `update_employee()` (commit `8b1bca2` already handles "only one component supplied" for the derived `salary` field — reuse the same conditional structure for the plan-sync calls).

### Step 2b — Backfill existing employees

**New one-time script:** `be/scripts/backfill_compensation_plans_from_employee_fields.py`

```python
"""One-time backfill: create EmployeeCompensationPlanDB rows for any employee
that has internal_salary_usd/external_salary_usd set but no active plan component
of that type yet. Safe to run multiple times (skips employees that already
have an active row for a given component type)."""
from db import get_db_context
from models_db import EmployeeDB
from finance.models import EmployeeCompensationPlanDB
from finance.services.compensation_plan_service import CompensationPlanService

def run():
    with get_db_context() as db:
        service = CompensationPlanService(db)
        employees = db.query(EmployeeDB).all()
        created = 0
        for emp in employees:
            existing_types = {
                c.component_type for c in db.query(EmployeeCompensationPlanDB)
                .filter(
                    EmployeeCompensationPlanDB.employee_id == emp.id,
                    EmployeeCompensationPlanDB.effective_end_date.is_(None),
                ).all()
            }
            if getattr(emp, "internal_salary_usd", 0) and "internal_usd_cash" not in existing_types:
                service.set_component(
                    employee_id=emp.id,
                    component_type="internal_usd_cash",
                    amount=emp.internal_salary_usd,
                    effective_start_date="2026-01-01",  # or emp.start_date if available
                    notes="Backfilled from legacy employee field",
                )
                created += 1
            if getattr(emp, "external_salary_usd", 0) and "external_usd" not in existing_types:
                service.set_component(
                    employee_id=emp.id,
                    component_type="external_usd",
                    amount=emp.external_salary_usd,
                    effective_start_date="2026-01-01",
                    notes="Backfilled from legacy employee field",
                )
                created += 1
        print(f"Backfilled {created} compensation plan component(s).")

if __name__ == "__main__":
    run()
```

Adjust the effective start date choice (either a fixed date or `emp.start_date`/`emp.hire_date` if such a field exists — check the `EmployeeDB` model definition only for that one field name, nothing else).

**Run once** against the working database after Step 2a is deployed, before testing payroll runs again.

### Step 2c — Compensation Plan modal becomes edit-only in practice, no UI change required

No frontend change needed for this fix. Once 2a+2b are applied, the modal (screenshotted by the user) will show real values instead of $0.00/"No active plan" for every existing and newly-created employee, and will only be opened going forward for actual raises/changes — which is its intended purpose per the FUX-416 spec.

**Test to run:** `be/tests/test_finance_compensation_plan.py` (existing FUX-416 suite) plus a new minimal test: create an employee via the employee-create endpoint with `internal_salary_usd=1000`, then call `GET /api/finance/employees/{id}/compensation-plan` and assert the `internal_usd_cash` component is present with `amount == 1000` — confirms the write-through without needing to touch the UI.

## Execution order

1. Fix 1 (bank severity) — isolated, ~5 lines, no dependencies.
2. Fix 2a (write-through) — depends on locating one existing function, additive only.
3. Fix 2b (backfill script) — depends on 2a's `CompensationPlanService` import pattern being correct; run once after deploy.
4. Re-test the "Run Payroll" wizard end-to-end for an existing employee (e.g. James Parker) to confirm the compensation plan now shows real values and the run preview no longer blocks on bank details.

## Explicit non-goals (do not implement, out of scope for this fix)

- No changes to the actual wire-transfer/disbursement engine — stays optional/unbuilt, per user instruction.
- No changes to `EmployeeCompensationPlanDB` schema or the FUX-416/417/418 calculation logic — those are correct as designed; this plan only fixes wiring/severity/sync gaps around them.
- No changes to commission/bonus (FUX-418) — already confirmed working as designed.
