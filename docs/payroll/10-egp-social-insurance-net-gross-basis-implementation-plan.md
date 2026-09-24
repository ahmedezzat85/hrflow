# FUX-421 — EGP Social Insurance and NET/GROSS Internal Salary Basis

**Status:** Approved for implementation planning
**Branch scope:** `feature/payroll-deductions`
**Planning reference:** verified local checkout of the GitHub branch, clean working tree
**Base branch / merge base:** `main` / `0025289413cf582e1f11d789ba57214f7d13ee26`
**Scope:** Convert employee social-insurance calculation to EGP, introduce effective-dated NET/GROSS basis for `internal_usd_cash`, and preserve dual-currency payroll snapshots.

## 1. Branch intake

### Verified baseline

- The checkout is on `feature/payroll-deductions` with no uncommitted changes.
- `0021_fux_payroll_social_insurance.py` is the current latest migration, following payroll compensation, FX, funding-account, and statutory-obligation migrations.
- Current social-insurance configuration is effective-dated. `employee_social_insurance` stores `insured_flag`, `insured_base`, `currency`, dates, notes, and audit fields.
- Current insurance and payroll snapshot currency semantics are USD: the schema/model defaults `employee_social_insurance.currency` to `USD`, the service explicitly creates rows with `currency="USD"`, and the repository default/fallback is `USD`.
- Current payroll calculation multiplies `insured_base` by configured employee/employer rates and applies the employee result directly to `deductions_total`/`net_pay`, with the employer result in `employer_cost_extra`.
- Current payroll calculation applies that deduction to every non-`external_usd` component, including the internal recurring component.
- Current payroll line snapshots include only insured base and employee/employer rate snapshots; no salary-basis, EGP calculation, USD-equivalent, employee-tax, or final-payment snapshots exist.
- `EmployeeCompensationPlanDB` currently has `external_usd` and `internal_usd_cash` components with an amount, USD currency, and effective dates; it has no salary-basis field.
- `PayrollRunDB` already records `fx_rate_source` and `fx_rate_value`; `_resolve_fx_rate()` resolves a USD→EGP rate from a manual override or historical USD→EGP account transfer, with a fallback of `50.0`.
- The payroll preview/generation paths resolve and persist FX metadata, but current SI/net-pay math does not consume the resolved FX rate. This feature wires the existing resolved/locked rate into statutory calculation for the first time.
- The `SocialInsuranceService` currently performs a save-time comparison of insured base to `EmployeeDB.internal_salary_usd`. That comparison becomes invalid when insured base becomes EGP and must move to payroll-calculation time.
- Social-insurance reads use `hr.employee.read`; insurance writes use `hr.salary.write`. Payroll settings use `finance.settings.write`; payroll lifecycle uses `finance.payroll.read`/`finance.payroll.write`.

### Product goal

Make local payroll and statutory-estimate calculation EGP-first while retaining USD internal salary input and final payment presentation. An employee's effective-dated `internal_usd_cash` component must be configurable as a protected `NET` target or a forward-calculated `GROSS` amount. Social-insurance inputs and outputs must be stored/snapshotted with unambiguous EGP semantics, use the payroll run's locked USD→EGP rate, and remain clearly internal estimates rather than statutory authority.

### Success criteria

- Insured base is stored as EGP and never compared directly with a USD figure.
- `NET` is the default basis for `internal_usd_cash`; it preserves the configured USD target when tax and variable pay are zero, after final whole-USD rounding.
- `GROSS` calculates forward from the configured internal USD amount.
- Bonus and commission remain gross, optional monthly additions, applied before employee-tax reduction.
- Employee SI, employer SI, employee tax placeholder, EGP net, USD equivalents, salary basis, FX rate, and final whole-USD payment are historically explainable line snapshots.
- Payroll exposes rollups for employee tax and total employee-plus-employer SI without treating them as paid/portal-confirmed obligations.
- Finalized/paid payroll runs are immutable when later employee, rate, FX-source, or compensation changes occur.

## 2. Governing decisions and gates

### Applicable accepted decisions

| ID | Effect on this feature |
|---|---|
| D-001 — Payroll statutory-calculation boundary | All SI/tax values are labeled and modeled as internal estimates; EETAX/NOSI/other official portals remain authoritative. |
| D-002 — Actual statutory-payment reconciliation | Estimated payroll SI cannot be represented as portal-confirmed liability or actual remittance; preserve separate future reconciliation path. |
| D-003 — Salary-component carry-forward | Add `salary_basis` to the authoritative compensation-plan path so onboarding/review flows preserve it alongside internal salary. |
| D-004 — Monthly variable compensation | Bonus and commission remain inline, optional monthly components; they are gross inputs, not protected NET amounts. |
| D-005 — Optional payment rail | No bank-transfer execution or payment-rail work is introduced. |
| D-006 — Bank-details warning | Existing bank-detail blocking conflict is separate debt; do not change or conflate it with SI validation/blocking. |
| D-007 — Payroll export row shape | Export remains exactly one row per employee, with applicable components and new payroll fields on that same row. |

### Open-question gates

- **Q-001 — Paid-state funding scope:** adjacent but non-blocking. This feature must not decide whether `Paid` funds only net employee pay or total employer cost. Store the employer-SI estimate separately and clearly so either later decision remains possible.
- **Q-004 — Automated FX rate source:** adjacent but non-blocking. Reuse the current manual/transfer-derived resolver and locked run value; do not add an external feed. The fallback rate needs explicit test/visibility coverage.
- **Q-002, Q-003, Q-005:** out of scope.
- **Design decision before calculation code:** Insured-base validation uses the **recurring internal base only**, converted to EGP with the run's locked FX rate. It excludes bonuses/commissions because the insured base is independent recurring employee data and variable-pay insurability is deliberately out of scope. This makes validation stable, prevents a temporary bonus from making an otherwise invalid base pass, and aligns with NET protection applying only to recurring internal salary.

## 3. Confirmed scope boundaries

### In scope

- EGP insured-base write semantics, UI labeling, payroll-time validation, and clean-break handling for legacy USD rows.
- `NET`/`GROSS` salary basis on effective-dated `internal_usd_cash` compensation-plan rows, defaulting to `NET`.
- Run-locked-FX-driven EGP SI calculation and whole-USD final internal payment.
- Employee SI, employer SI, employee tax `0`, dual-currency display/snapshots, and payroll-level rollups.
- Existing effective-dating, audit, authorization, payroll lifecycle, and finalized-run immutability protections.
- Export/report/payslip compatibility review with D-007 one-row export regression coverage.

### Out of scope

- Authoritative Egyptian tax or social-insurance compliance calculations.
- Non-zero employee tax, tax-bracket inversion, gross-up algorithm, policy versioning, or portal reconciliation execution.
- Changing external USD compensation, applying salary basis to `external_usd`, or introducing net/gross bonus options.
- Defining variable-pay taxability/insurability beyond gross pre-tax input handling.
- Government portal integration, automatic SI payment, bank rail execution, or Q-001 paid-state funding behavior.
- Automatic conversion, reinterpretation, or recalculation of historical USD insurance records/finalized payroll.
- Resolving the existing D-006 missing-bank-details blocking defect.

## 4. Proposed behavior and calculation

### Effective inputs

For each employee and payroll period, resolve:

- Locked USD→EGP FX rate from `PayrollRunDB.fx_rate_value`.
- Effective `internal_usd_cash` amount and `salary_basis`.
- Effective insured flag, insured base in EGP, and currency.
- Organization-wide employee/employer contribution rates.
- Internal gross bonus and commission adjustments, in USD source values converted using the locked FX rate.

`external_usd` remains outside local internal statutory calculation.

### Preflight and validation

- An insured employee with recurring internal salary and no active EGP base (`insured_base` missing/non-positive or `currency != "EGP"`) receives a blocking `MISSING_INSURED_BASE` exception with a remediation path to the Social Insurance employee profile.
- A legacy row with `currency="USD"` is never read as EGP or auto-converted. It is treated as stale/unconfigured.
- Validate `InsuredBase(EGP) ≤ RecurringInternalSalary(EGP)`, where `RecurringInternalSalary(EGP) = internal_usd_cash.amount × locked_fx_rate`.
- This recurring-base denominator deliberately excludes bonus/commission. The validation is performed at payroll calculation time because only the run has the locked FX rate.
- Employees with no recurring internal salary remain outside employee SI deduction even if an insurance record exists. External-only employees receive no local SI/tax calculation solely because of that record.

### Calculation fields and formulas

All intermediate local statutory amounts use EGP. Round EGP monetary calculations to two decimal places at calculation-component boundaries; do not round the USD payment until the final conversion. Use the runtime's explicit half-up decimal rounding policy for the final whole-USD amount; do not use binary floating-point rounding semantics for statutory calculations.

| Fact | Rule |
|---|---|
| Employee SI | `insured_base_egp × employee_rate` |
| Employer SI | `insured_base_egp × employer_rate` |
| Employee tax | `0.00 EGP` in this release |
| Variable gross EGP | `(bonus_usd + commission_usd) × locked_fx_rate` |
| GROSS configured base EGP | `internal_usd_cash.amount × locked_fx_rate` |
| NET target EGP | `internal_usd_cash.amount × locked_fx_rate` |
| NET base gross EGP | `target_net_egp + employee_si_egp + employee_tax_egp` |
| GROSS base net EGP | `configured_gross_egp − employee_si_egp − employee_tax_egp` |
| Final internal net EGP | `base_net_egp + variable_gross_egp − employee_tax_on_variable_egp` (currently variable tax is zero) |
| Final internal payment USD | `round_half_up(final_internal_net_egp / locked_fx_rate, 0)` |
| SI USD equivalent | `employee_si_egp / locked_fx_rate` for display; retain EGP as authoritative estimate currency |

For `NET`, zero bonus/commission and zero tax guarantee that the final whole-USD payment equals the configured recurring target under the documented final rounding rule. Variable pay is gross and is not protected by the NET guarantee.

### User flow

1. HR sets insured/uninsured status, an EGP insured base, effective date, and notes from the employee Social Insurance card.
2. HR/Finance maintains the recurring internal compensation plan with USD amount plus `NET`/`GROSS` basis; `NET` is preselected for new internal component rows.
3. Finance sets organization-wide SI rates through existing payroll settings.
4. Finance selects a payroll period and locked FX source/value, then previews/generates payroll.
5. Payroll resolves effective HR and compensation records, validates EGP data, calculates/snapshots EGP statutory amounts and USD equivalents, and surfaces blocking exceptions.
6. Finance handles optional gross bonuses/commissions in the normal payroll flow.
7. Finalization/payment freezes the line inputs/outputs; later configuration changes cannot rewrite historical results.

## 5. Data and migration design

### Migration strategy

Create one additive Alembic migration after `0021_fux_payroll_social_insurance.py`.

| Area | Change |
|---|---|
| `employee_social_insurance` | Retain existing `currency` column; change new-record server default from `USD` to `EGP`. Do not transform existing values. Legacy rows remain `USD` and are deliberately invalid for new EGP calculation. |
| `EmployeeSocialInsuranceDB` | Change model default to `EGP`. |
| `SocialInsuranceRepository` | Change `create_insurance` parameter default and fallback from `USD` to `EGP`. |
| `SocialInsuranceService` | Change explicit create calls to `EGP`; remove save-time USD ceiling validation. |
| `finance_employee_compensation_plans` | Add non-null `salary_basis` string/enum constrained to `NET`/`GROSS`, with server/model default `NET`. Existing plan rows receive `NET` as the safe, approved default. |
| `finance_payroll_lines` | Add immutable calculation snapshots listed below. All new currency-specific fields use unambiguous names/suffixes. |
| `finance_payroll_runs` | Add `total_employee_tax_egp` and `total_social_insurance_egp` as persisted run rollups, populated from line snapshots and not as settlement/remittance amounts. |

### Required payroll-line snapshots

- `salary_basis_snapshot` (`NET`/`GROSS`)
- `configured_internal_salary_usd_snapshot`
- `insured_base_egp_snapshot`
- `employee_rate_snapshot` and `employer_rate_snapshot` (preserve existing rates; clarify rate-only semantics)
- `fx_rate_snapshot` (or use run FX with explicit line-level copy if line-level explainability is required by existing snapshot convention)
- `base_gross_egp`
- `variable_gross_egp`
- `employee_social_insurance_egp`
- `employer_social_insurance_egp`
- `total_social_insurance_egp`
- `employee_tax_egp`
- `employee_social_insurance_usd_equivalent`
- `employee_tax_usd_equivalent`
- `final_internal_net_egp`
- `final_internal_payment_usd` (whole-number amount)

Preserve existing USD-facing `deductions_total`, `tax_amount`, `net_pay`, and `employer_cost_extra` only after a consumer audit confirms their current API/export/report contracts. Do not silently change their unit semantics from USD to EGP. Prefer additive EGP fields and explicit mapping until all consumers are migrated.

## 6. Module, interface, and UI impacts

### Backend

- `be/models_db.py`, `be/models.py`, and new migration: schema/defaults/snapshots.
- `be/services/social_insurance_service.py`: EGP write semantics, remove invalid save-time ceiling, preserve effective-date/finalized-period/audit safeguards.
- `be/repositories/social_insurance_repository.py`: EGP default/fallback only; preserve period lookup/row closure behavior.
- `be/finance/services/compensation_plan_service.py` and repository: validate/store basis only for `internal_usd_cash`; reject it or ignore it for `external_usd` according to explicit API schema.
- `be/finance/services/payroll_service.py`: replace USD-only SI block in all three calculation paths with a shared pure calculation helper, so preview, generate, and persistence cannot drift.
- `be/finance/schemas.py`, payroll/compensation routers: expose new request/response fields with explicit units and backward-compatible optional additions.
- Export/report/payslip endpoints: add new columns/display values while preserving D-007 row shape and employee-access boundaries.

### Frontend

- Employee Social Insurance card/modal: EGP-only label, integer/decimal format, legacy-configuration remediation message.
- Salary/compensation editing: `NET`/`GROSS` selector shown only for `internal_usd_cash`, default `NET`; use authoritative compensation-plan API.
- Payroll review/detail/payslip: show employee SI, employer SI, employee tax, EGP statutory figures, USD equivalents, final whole-USD internal payment, FX rate, and “Internal estimate” labeling.
- CSV/Excel export: one employee row containing internal/external amounts, applicable variable additions, deductions/estimates, and final payment fields.

## 7. Authorization, security, and audit

- No new RBAC permissions, roles, or self-service capabilities.
- Preserve `hr.employee.read` for insurance read, `hr.salary.write` for insurance write, `finance.settings.write` for rates, and `finance.payroll.read/write` for payroll lifecycle.
- Preserve effective-dating and finalized-period guards before permitting insurance/basis changes.
- Audit each insurance update with EGP base/currency and each salary-basis update with old/new value, actor, and effective date.
- Do not expose unmasked employee bank information as part of new payroll fields.
- Currency/unit names in API, UI, logs, and snapshots must be explicit to prevent EGP/USD confusion.

## 8. Backward compatibility and rollback

- New schema fields are additive and nullable where historical data lacks a value.
- Existing compensation plans default to `NET`, the approved product default; effective-dated edits create future rows and do not reinterpret finalized payroll.
- Existing insurance records marked `USD` are not converted or repurposed. They trigger visible blocking remediation for insured employees with recurring internal pay.
- Historical payroll lines retain their original USD snapshot semantics and are never recalculated.
- Schema downgrade removes only newly added columns/defaults. Behavioral rollback is safe only for unfinalized runs; never recalculate or overwrite finalized EGP-path snapshots.
- Do not change paid-state cash/funding or statutory-liability postings in this feature; that remains Q-001 work.

## 9. Acceptance criteria

1. New insurance configurations persist `currency=EGP`; no new write path can default to USD.
2. Legacy `currency=USD` insured-base rows cannot be silently used as EGP and cause the designated blocking remediation path.
3. The save-time service no longer compares EGP base to `EmployeeDB.internal_salary_usd`.
4. Payroll validates EGP insured base against recurring `internal_usd_cash × locked_fx_rate`, excluding variable pay.
5. `NET` basis with zero variable pay/tax yields configured target after explicit whole-USD rounding.
6. `GROSS` basis calculates forward correctly from configured USD base using locked FX and EGP SI.
7. EGP SI uses 11%/18% defaults or configured rate values; never USD-base multiplication.
8. Bonuses/commissions are gross pre-tax additions and do not alter the protected NET recurring-base guarantee.
9. `external_usd`-only employees receive no local SI/tax merely because insurance configuration exists.
10. Employee SI, employer SI, tax placeholder, EGP net, USD equivalents, basis, and FX snapshots persist and are immutable after finalization.
11. Two runs at different locked FX rates produce independent, historically stable EGP and USD-equivalent outcomes.
12. Final internal USD payment is an integer under documented half-up rounding; statutory EGP totals remain based on EGP calculation amounts, not USD-rounded residuals.
13. Run rollups equal sums of payroll-line employee tax and employee-plus-employer SI snapshots.
14. All existing HR/Finance authorization boundaries return expected 403 behavior for unauthorized users.
15. Audit records capture insurance-base/currency and salary-basis changes.
16. Preview, generation, approval, finalization, payment, journal, reports, export, and payslip access regressions are covered.
17. Payroll CSV/Excel emits one row per employee after the new fields are added, satisfying D-007.
18. FX resolver fallback (`50.0` when no override or transfer history exists) is visible in preview/run metadata and explicitly test-covered; it must not be mistaken for a portal/market authoritative rate.

## 10. Test strategy

### Unit/service tests

- Pure EGP calculation helper: NET, GROSS, zero/non-zero variable inputs, rate variations, zero tax, rounding boundaries, invalid/non-positive FX rate handling.
- `SocialInsuranceService`: EGP write default, no USD salary ceiling validation, effective-dating, future-date prohibition, finalized-boundary guard, audit payload.
- `CompensationPlanService`: NET default, GROSS validation, external component exclusion, effective-date history.

### Integration/API tests

- HR insurance read/write permissions and Finance rate permissions.
- Preview/generation consistency: identical inputs produce identical per-line results across all calculation paths.
- Locked-FX variance and immutable snapshots after source-rate/configuration changes.
- Legacy USD configuration block/remediation.
- Missing EGP base blocking, external-only exemption, and recurring-base validation.
- Run rollups, export row shape, report and payslip responses.
- Existing approval/finalize/pay/post-journal behavior remains intact; assert no new statutory liability/payment posting is introduced.

### UI tests

- EGP labels and validation feedback in employee insurance card.
- NET default/GROSS selector only on internal compensation component.
- Payroll dual-currency estimate display and whole-USD final payment.
- Inline bonus/commission operational flow remains available.
- Clearly distinguish mock-only UI tests from API-backed integration coverage.

## 11. Incremental delivery slices

1. **Schema and contracts:** migration, models, Pydantic schemas, compensation basis defaults, insurance EGP defaults; no payroll arithmetic behavior changed yet.
2. **HR configuration:** social-insurance service/repository changes, legacy detection, authorization/audit tests, employee UI labels.
3. **Calculation core:** shared pure EGP helper; wire it into preview/generate/persist paths; tests first for NET/GROSS, FX, and legacy blocking.
4. **Snapshots and rollups:** persist line/run EGP facts, preserve historical immutability, expose response contracts.
5. **UI, export, report, payslip:** dual-currency display and D-007 one-row export verification.
6. **Regression hardening:** full lifecycle, journal non-regression, permissions, audit, rounding, and production-data migration rehearsal.

## 12. Coding-agent handoff

- Begin on `feature/payroll-deductions`; verify HEAD and clean tree before edits.
- Treat this document as branch-specific planning truth. Do not promote it to `main` project context until reviewed and merged.
- Do not make line-level edits based on historical docs alone; inspect active code before each slice.
- Build one shared calculation helper and route all three existing payroll calculation paths through it. Avoid duplicated NET/GROSS/SI arithmetic.
- Use decimal-safe monetary arithmetic and a documented explicit rounding mode; do not rely on float/banker’s-rounding behavior.
- Preserve existing model/table ownership: HR owns employee insurance record; Finance owns payroll calculation/rates/snapshots; no direct cross-domain database mutation outside existing service/repository interfaces.
- Keep D-001 labels and D-007 export shape visible throughout.
- Do not decide Q-001/Q-004 in code. Record any newly approved denominator/rounding details in the decision log if product policy changes.
- End implementation with files changed, migrations applied, tests executed/results, migration rollback result, unresolved risks, and required documentation updates.
