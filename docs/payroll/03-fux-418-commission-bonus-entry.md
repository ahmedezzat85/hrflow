# FUX-418 — Commission & bonus entry within a payroll run

Related: `docs/payroll/02-fux-417-payroll-run-compensation-split-fx.md` (PayrollLineDB compensation_type), Phase 3 Finance Data Model.

**User story:** As a finance admin, I want to add sales/support commissions and discretionary bonuses to a specific employee within a specific payroll run, so that variable pay is tracked alongside fixed salary without needing a separate system or manual side-tracking.

## Context

Commissions (sales commission, support commission) and bonuses are irregular, employee-specific, and vary month to month — they don't belong in the recurring `EmployeeCompensationPlanDB` (FUX-416), which represents stable, effective-dated amounts. They do belong in the same `PayrollLineDB` table introduced by FUX-417, using the same `compensation_type` column, since they need to flow through the same reporting, statutory-feed, and payment-distribution logic as external/internal salary.

In Egypt, commissions paid to employees are generally treated as part of taxable/insurable wage (same tax treatment as internal cash salary) unless structured otherwise — this story defaults commission/bonus lines to `is_taxable_local=true`/`is_insurable=true`, matching `internal_usd_cash`, but keeps the flag editable per line in case a specific commission arrangement is structured differently.

## High-level scope

1. Extend the `compensation_type` enum on `PayrollLineDB` (already added in FUX-417) with `commission_sales`, `commission_support`, `bonus`.
2. Add an "Add commission/bonus" action on an existing (not-yet-finalized) payroll run: select employee, select type, enter amount, optional note (e.g., "September sales commission — Client X deal").
3. Default `is_taxable_local`/`is_insurable` to `true` for all three new types, editable at entry time for edge cases.
4. Multiple commission/bonus lines per employee per run are allowed (e.g., two separate sales commissions in the same month) — no uniqueness constraint, unlike the compensation plan's one-active-row rule.
5. These lines participate in the same `finalize_run()` taxable-amount aggregation as internal salary lines (FUX-417), so they correctly flow into the FUX-410 auto-generated statutory obligation estimates.

## Implementation level

- No new migration needed beyond FUX-417's `compensation_type` column — this story only widens the accepted enum values in validation (schema + service layer), since the column is already a string/enum-like field.
- `finance/services/payroll_service.py`:
  - New `add_ad_hoc_line(run_id, employee_id, compensation_type, amount, notes)`: validates the run is still in `draft` (or whatever the earliest editable status is), validates `compensation_type` is one of the five now-valid values, creates the `PayrollLineDB` row with default tax/insurance flags, and recalculates the run's `total_gross`/`total_net` aggregates.
  - Guard: rejects adding lines to a run that has already been finalized, consistent with the FUX-408/410 status-integrity pattern — corrections to a finalized run require a new run or an explicit adjustment line in the next period, not a retroactive edit.
- `finance/schemas.py`: `PayrollLineCreate` request schema with `compensation_type` restricted to the full enum, `amount`, optional `notes`, optional override booleans for `is_taxable_local`/`is_insurable`.
- `finance/routers/payroll.py`: `POST /api/finance/payroll/runs/{run_id}/lines` for ad hoc line creation; `DELETE /api/finance/payroll/runs/{run_id}/lines/{line_id}` to remove a mistakenly added line while still in draft.
- Frontend: within the payroll run detail view (already grouping lines by employee per FUX-417), add an "Add Commission/Bonus" button per employee row opening a small modal (type, amount, note), consistent with the existing modal system.

## Acceptance criteria

- A commission or bonus line can be added to any employee within a draft payroll run, independent of whether that employee has an active compensation plan for external/internal salary.
- Multiple commission/bonus lines for the same employee in the same run are allowed and each is individually visible in the run detail view.
- Commission/bonus amounts default to taxable/insurable and are correctly included in `finalize_run()`'s statutory obligation estimate calculation.
- Attempting to add a line to a finalized run is rejected with a clear error, matching the integrity-guard pattern already used elsewhere in the finance module.
- Removing a line from a still-draft run correctly recalculates the run's totals.

## Verification plan

- Add a sales commission of 500 and a support commission of 200 to the same employee in a draft run; confirm both lines persist independently and the run's `total_gross` reflects both.
- Finalize the run and confirm the resulting statutory obligation estimates include the commission amounts alongside internal salary.
- Attempt to add a line to an already-finalized run; confirm rejection.
- Confirm deleting a draft-run line correctly reduces the run's cached totals.
- Regression-test FUX-417's run generation and FUX-410's statutory auto-generation to confirm ad hoc lines integrate cleanly with plan-generated lines in the same run.
