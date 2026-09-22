# FUX-417 — Payroll run compensation split & FX rate policy

Related: `docs/payroll/01-fux-416-employee-compensation-plan.md` (compensation plan source), Phase 3 Finance Data Model (`PayrollRunDB`, `PayrollLineDB`), `finance/services/payroll_service.py::finalize_run()`, `docs/finance-module/12-fux-410-statutory-obligations-tracker.md`.

**User story:** As a finance admin, I want each payroll run to record external and internal compensation as separate typed lines with a locked FX rate, so that the run correctly distinguishes non-taxable external pay from taxable/insurable internal pay before it feeds statutory obligations.

## Context

`PayrollLineDB` currently stores one flat `base_salary` per employee per run — it cannot represent the external/internal split defined in FUX-416, and `PayrollRunDB` has no FX rate field despite all compensation being USD-denominated while Egyptian tax/insurance obligations are computed (by the government portal) against EGP-equivalent local wage. The FX rate must be capturable as either the first-of-month rate or the actual payment-date rate, per run, and locked at that point for audit purposes — rates should not silently change if looked up again later.

This story is the core of the payroll engine: generating a run's lines from each employee's active compensation plan (FUX-416), tagging each line with its component type and tax/insurance treatment, and locking the FX rate used.

## High-level scope

1. Add `compensation_type` to `PayrollLineDB`: `external_usd`, `internal_usd_cash` (commission/bonus lines are added in FUX-418, same column, same table — no separate table needed).
2. Replace the single `base_salary` field usage with **one line row per employee per compensation type** — an employee with both external and internal pay gets two `PayrollLineDB` rows in the same run.
3. Add `is_taxable_local` and `is_insurable` boolean columns to `PayrollLineDB`, derived automatically from `compensation_type` at creation time (`internal_usd_cash` → both `true`; `external_usd` → both `false`) but stored explicitly so `payroll_service.py` doesn't need to re-derive the rule at every read.
4. Add `fx_rate_source` (`first_of_month` | `payment_date`) and `fx_rate_value` to `PayrollRunDB`, set at run creation and locked once the run moves past `draft` status.
5. New "Generate run lines from compensation plans" action: given a period, pull each active employee's current compensation plan (FUX-416) and create the corresponding `PayrollRunDB`/`PayrollLineDB` rows automatically, so a standard month requires no manual re-entry — only exceptions (new hires, commissions, bonuses) need manual touches.
6. Update `finalize_run()` so `liabilities_summary_json` — the input to FUX-410's auto-generated statutory obligations — is computed only from lines where `is_taxable_local = true` / `is_insurable = true`, never from `external_usd` lines.

## Implementation level

- Migration `00XX_fux_417_payroll_line_compensation_split.py`:
  - Add nullable columns to `finance_payroll_lines`: `compensation_type` (default `internal_usd_cash` for existing rows, preserving current behavior for historical runs), `is_taxable_local` (default `true`), `is_insurable` (default `true`).
  - Add nullable columns to `finance_payroll_runs`: `fx_rate_source` (default `first_of_month`), `fx_rate_value` (nullable — populated at run creation).
  - Backfill: existing `PayrollLineDB` rows get `compensation_type='internal_usd_cash'` since that has been the de facto behavior (single flat local salary), preserving historical statutory obligation linkage exactly as-is.
- `finance/services/payroll_service.py`:
  - New `generate_run_from_compensation_plans(period_label, period_start, period_end, fx_rate_source)`: resolves the FX rate (first-of-month lookup or payment-date value, per `fx_rate_source`), fetches each active employee's compensation plan via the FUX-416 service, and creates one `PayrollRunDB` plus two `PayrollLineDB` rows per employee with pay in both components.
  - Update `finalize_run()`: filter lines by `is_taxable_local`/`is_insurable` before computing the values written to `liabilities_summary_json`, so external USD transfers never leak into the social-insurance/income-tax estimate handed to FUX-410.
  - FX rate value itself is looked up from wherever the system already tracks exchange rates (existing `USDTOEGP` payment-type/category convention in `finance/seed_data.py`) or entered manually if no live source exists yet — this story does not add a new FX-rate-fetching integration, only the storage and selection policy.
- `finance/schemas.py`: extend `PayrollLineResponse`/`PayrollRunResponse` (or equivalent existing schemas) with the new fields; add request schema for the "generate from plans" action.
- `finance/routers/payroll.py`: new endpoint `POST /api/finance/payroll/runs/generate` accepting `{period_label, period_start, period_end, fx_rate_source}`.
- Frontend: payroll run creation screen gains an FX rate policy selector (First of Month / Payment Date) and, once lines are generated, the run detail view groups lines by employee showing External / Internal / (Commission / Bonus once FUX-418 lands) side by side with a per-employee total.

## Acceptance criteria

- Generating a run from compensation plans creates two correctly-typed lines for an employee with both external and internal pay, and one line for an employee with only one component.
- `fx_rate_value` is captured and locked at run creation; re-generating or re-fetching the rate after creation does not change an existing run's stored value.
- Finalizing a run produces `liabilities_summary_json` values computed only from `internal_usd_cash` lines — an employee paid entirely externally contributes zero to the auto-generated FUX-410 statutory obligations.
- Existing (pre-migration) payroll runs and their already-created statutory obligations remain valid and queryable after the backfill — no historical data loss or reclassification error.
- A run in `draft` status can still be regenerated/edited; once `approved` or beyond, the FX rate and line composition are locked (reuses the same status-integrity philosophy as FUX-408/410).

## Verification plan

- Generate a run for a test employee with external=3000 and internal=1500 (from FUX-416 plan); confirm two lines are created with correct `compensation_type`, `is_taxable_local`, `is_insurable` values.
- Finalize the run and confirm the resulting `StatutoryObligationDB` estimated amounts reflect only the 1500 internal portion, not the full 4500.
- Create two runs with `fx_rate_source=first_of_month` and `fx_rate_source=payment_date` for the same period with different underlying rates; confirm each run's `fx_rate_value` is independently locked and correctly attributed.
- Run the existing Phase 3 payroll model tests (`test_finance_models.py`) and FUX-410 statutory tests (`test_finance_statutory_obligations.py`) to confirm no regression in cross-domain employee FK behavior or auto-obligation generation.
- Confirm a run generated for an employee with no active compensation plan produces a clear validation error rather than a silent zero-amount line.
