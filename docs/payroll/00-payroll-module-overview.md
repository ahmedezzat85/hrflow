# Payroll Module — Overview & Business Objectives

Related: `docs/finance-module/12-fux-410-statutory-obligations-tracker.md` (StatutoryObligationDB, SettlementService), Phase 3 Finance Data Model (`PayrollRunDB`, `PayrollLineDB`), Story 8.1 Guided payroll run.

## Why this module exists

HRFlow's payroll is not a standard single-country payroll. Compensation for each employee is split into two legally and operationally distinct parts:

1. **External part** — transferred directly from the company's US bank account in USD to the employee's personal account. Not taxable in Egypt, not subject to Egyptian payroll rules or reporting.
2. **Internal part** — paid regularly to the employee in USD cash inside Egypt. Reported monthly to the Egyptian government, subject to income tax and social insurance under local rules.

On top of this split, employees may earn **sales/support commissions** and **discretionary bonuses**, which sit outside the fixed monthly salary but must still be tracked as compensation and (where applicable) as taxable/insurable local pay.

The FX rate used to value USD amounts for local reporting is drawn from either the first day of the month or the actual payment date, and this choice must be configurable per payroll run.

## Decision: scope boundary between HRFlow and the government portal

Egypt's ETA payroll tax portal (eta.gov.eg) and NOSI compute the authoritative income tax and social insurance figures internally; their formulas are not public and can diverge from any internally reproduced calculation, including the company's own tracking sheet. Building a tax/insurance calculation engine inside HRFlow would therefore chase a moving, non-reproducible target.

**Decision:** HRFlow does not calculate Egyptian income tax or social insurance. It tracks the resulting obligations as payables (already implemented in FUX-410 `StatutoryObligationDB`) and focuses its payroll engine on:

- Splitting and recording gross compensation into external/internal/commission/bonus components per employee per period.
- Capturing the FX rate policy and locked rate per payroll run.
- Feeding the existing FUX-410 statutory obligation auto-generation with correctly separated (taxable/insurable) amounts instead of a single flat salary figure.
- Distributing and tracking each payable part (external transfer, internal cash, tax, insurance) through to settlement, reusing the existing Payment/LedgerTransaction/SettlementService infrastructure.

## Business objectives (locked)

1. Track total compensation per employee — external, internal, commission, bonus, and grand total — for any period (month, year, multi-year, custom range).
2. Report total company salary spend for expense/spending reporting, currency-consistent despite a configurable FX policy.
3. Track total statutory obligations settled (tax + social insurance) per month — already satisfied by FUX-410, fed with correct source amounts.
4. Cleanly distribute and track payable parts: external transfer, internal cash, tax obligation, insurance obligation — each with its own payment trail.
5. Support variable pay: sales/support commissions and bonuses, flowing through the same reporting without special-casing.
6. No duplicate tax logic: statutory amounts are entered/confirmed against the government portal's own figures (FUX-410 estimate → confirm/adjust → settle flow), never recomputed by HRFlow.

## What already exists (as of 2026-09-17, `feature/payroll` branch)

- `PayrollRunDB` / `PayrollLineDB` (Phase 3): period-based runs with a single flat `base_salary` per employee line, `total_gross`/`total_tax`/`total_deductions`/`total_net`/`total_employer_cost` aggregates, and a `liabilities_summary_json` blob consumed at finalization.
- `payroll_service.py::finalize_run()`: on finalization, reads `liabilities_summary_json` and auto-creates three `estimated` `StatutoryObligationDB` rows (`social_insurance_employee`, `social_insurance_employer`, `income_tax`) linked back to the run via `source_type="payroll_run"`.
- `StatutoryObligationDB` + `StatutoryObligationsService` + `StatutoryObligationsRepository` + `finance/routers/statutory.py` (FUX-410): full estimate → confirm/adjust → settle lifecycle, status-integrity guard, atomic settlement via `SettlementService.settle_statutory_obligation()`, Needs-Attention queue integration. **This layer needs no further changes.**
- `SettlementService`, `PaymentDB`, `LedgerTransactionDB`, `PaymentTypeDB`, `TransactionCategoryDB`: the settlement/ledger backbone already reused by bills, invoices, and statutory obligations.

## The actual gap

`PayrollLineDB` has no concept of external-USD vs. internal-USD-cash vs. commission vs. bonus — it is one flat number per employee per run. There is no FX policy field on `PayrollRunDB`. There is no per-employee compensation plan (recurring amounts by type) — every run currently appears to require re-entry. This gap is what stories FUX-416 through FUX-419 close.

## Story breakdown

| Story | Title | Depends on |
|---|---|---|
| FUX-416 | Employee compensation plan (external/internal/commission/bonus components) | none |
| FUX-417 | Payroll run compensation split & FX rate policy | FUX-416 |
| FUX-418 | Commission & bonus entry within a payroll run | FUX-417 |
| FUX-419 | Compensation & spend reporting | FUX-417, FUX-418 |

Each story is scoped to be independently shippable and testable, following the incremental delivery pattern already used for FUX-406 through FUX-415.
