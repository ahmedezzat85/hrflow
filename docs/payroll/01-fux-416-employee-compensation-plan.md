# FUX-416 — Employee compensation plan (external/internal/commission/bonus components)

Related: `docs/payroll/00-payroll-module-overview.md`, Phase 3 Finance Data Model (`PayrollLineDB`), HR `routers/salary.py`.

**User story:** As a finance/HR admin, I want to define each employee's recurring compensation as separate typed components (external USD transfer, internal USD cash, and optionally recurring commission/bonus baselines), so that payroll runs can be generated from a stable source of truth instead of re-entering a single flat salary number every period.

## Context

Today an employee's pay is represented as one flat `base_salary` figure on each `PayrollLineDB` row. This cannot represent the company's actual compensation structure: an external part paid from the US account (non-taxable, non-reportable in Egypt) and an internal part paid as local USD cash (taxable, insurable, reported monthly to ETA/NOSI). Commissions and bonuses are irregular and employee-specific and must be trackable without being confused with the fixed recurring parts.

A compensation **plan** (recurring, effective-dated) is the right home for the fixed external/internal amounts; commissions and bonuses are per-period entries handled in FUX-418, not part of the recurring plan.

## High-level scope

1. New `EmployeeCompensationPlanDB` model: one row per employee per compensation component per effective period, so raises or restructuring don't overwrite history.
2. Component types are a controlled enum: `external_usd`, `internal_usd_cash`. (`commission` and `bonus` are per-run entries per FUX-418, not part of the recurring plan, since they vary by definition.)
3. Each plan row carries the amount, currency (defaults `USD` since both parts are USD-denominated per the company's actual practice), effective start date, and optional effective end date (open-ended if still active).
4. A given employee may have at most one active (`effective_end_date IS NULL`) row per component type at any time — enforced at the service layer, not just documented.
5. Simple CRUD endpoints and an admin UI panel under the existing Salary/HR area (`routers/salary.py` context) to view and edit an employee's current compensation plan, with history visible (past effective-dated rows), not just the current snapshot.

## Implementation level

- New table `finance_employee_compensation_plans`:
  - `id`, `employee_id` (FK `employees.id`, RESTRICT), `component_type` (`external_usd` | `internal_usd_cash`), `amount`, `currency` (default `USD`), `effective_start_date`, `effective_end_date` (nullable), `notes`, `created_at`, `updated_at`.
  - Index on `(employee_id, component_type, effective_end_date)` for fast "current plan" lookups.
- New `finance/repositories/compensation_plan_repository.py` and `finance/services/compensation_plan_service.py`:
  - `get_active_plan(employee_id)` returns the currently effective external/internal amounts.
  - `set_component(employee_id, component_type, amount, effective_start_date, notes)` closes any existing open-ended row for that component (`effective_end_date = effective_start_date - 1 day`) and inserts the new one — preserves history automatically, mirroring how salary raises should be auditable.
  - Validation: amount must be greater than 0; `effective_start_date` cannot be in the past beyond the current open payroll run's period (prevents silently rewriting an already-finalized period).
- New router `finance/routers/compensation_plans.py`:
  - `GET /api/finance/employees/{employee_id}/compensation-plan` — current active components.
  - `GET /api/finance/employees/{employee_id}/compensation-plan/history` — full effective-dated history.
  - `PUT /api/finance/employees/{employee_id}/compensation-plan/{component_type}` — set/update a component (creates new effective-dated row per above).
- New Alembic migration `00XX_fux_416_employee_compensation_plans.py` following the existing idempotent `if table not in tables` pattern used in `0014`/`0015`.
- Frontend: extend the existing employee Salary panel with two fields (External USD / Internal USD Cash) instead of one flat salary field, each showing current value and an "Edit" action that opens a small effective-dated update modal, consistent with the existing modal system (`docs/modal-form-system-implementation-plan.md`).

## Acceptance criteria

- Setting an employee's external and internal amounts creates two independent, correctly typed rows.
- Updating an existing component's amount preserves the prior row with a closed `effective_end_date` rather than overwriting it — full history is queryable.
- An employee can have exactly one active row per component type at any given time; attempting to create a second active row for the same type is rejected.
- The current-plan endpoint returns both components (or whichever exist) in a single call, ready to seed a new payroll run line (consumed by FUX-417).
- No changes to `PayrollRunDB`, `PayrollLineDB`, or any FUX-410 statutory code in this story — this is additive, isolated schema and service work.

## Verification plan

- Create a plan with external=3000, internal=1500 for a test employee; confirm both rows persist with correct types and `effective_end_date IS NULL`.
- Update the internal amount to 1700 effective next month; confirm the original 1500 row now has a closed `effective_end_date` and the new 1700 row is open-ended.
- Attempt to insert a second open-ended `external_usd` row for the same employee without closing the first; confirm rejection.
- Confirm the history endpoint returns both the closed and open rows in correct chronological order.
- Regression: run existing HR/salary and finance test suites to confirm no interference with `routers/salary.py` or Phase 3 payroll tests.
