# FUX-410 — Statutory obligations tracker (government/tax liability types)

Related: `docs/finance-module/08-fux-406-unified-settlement-linking.md` (SettlementService), `docs/finance-module/10-fux-408-combined-bill-payment-guard.md` (settlement integrity guard), Phase 2 Needs-Attention queue (FUX-202), Story 8.1 Guided payroll run

**User story:** As a finance user, I want to record and track government and statutory obligations (sales tax, salary/income tax withheld, social insurance, health insurance, withholding tax) with precise types, separate from vendor Bills, so that these can be accrued when owed and settled when paid without misrepresenting them as vendor spend.

## Context

Government and statutory remittances are neither a vendor Bill nor a plain undifferentiated expense category, and they are not interchangeable with each other. Each type has a distinct source, payer, and accounting treatment:

| Type | What it is | Who actually bears it |
|---|---|---|
| Salary/Income Tax Withheld | Tax withheld from employee salaries and remitted on their behalf | Employee (company is the remitting agent) |
| Social Insurance — Employee Portion | Deducted from employee pay | Employee |
| Social Insurance — Employer Portion | Company's own contribution on top of payroll | Employer |
| Health Insurance | Separate statutory contribution, often split employee/employer | Both, at different rates |
| Withholding Tax (WHT) | Tax withheld from payments to third parties (services, royalties, interest) | The recipient vendor; company is the remitting agent |
| Sales Tax / VAT | Collected from customers, held in trust, then remitted | Customer (company holds as a liability, not revenue) |
| Corporate Income Tax | Tax on the company's own profit | Employer directly |

Some of these (salary tax withheld, social insurance employee portion, withholding tax, sales tax/VAT) are money the company collected or withheld on someone else's behalf and holds as a liability until remitted — not an expense in the traditional sense. Others (social insurance employer portion, corporate income tax) are genuinely the company's own cost. A single flat "Government" category or vendor loses this distinction, which matters for correct P&L reporting and for reconciling what was withheld against what was actually remitted.

## High-level scope

1. Add a new **Statutory Obligation** entity, distinct from Bill and from plain categorized Transaction, with a controlled `obligation_type` enum: `sales_tax`, `withholding_tax`, `income_tax`, `social_insurance_employee`, `social_insurance_employer`, `health_insurance`, `other_statutory`.
2. Support two states per obligation: **Accrued** (recognized as owed, typically generated automatically from a payroll run or invoice/bill tax lines) and **Remitted** (actually paid to the authority), mirroring the standard liability-then-payment accounting pattern.
3. Link remittance to the same `SettlementService` pattern already used for bills/invoices (FUX-406) so paying a statutory obligation creates a real linked ledger transaction, not a status flip with no financial trail — applying the same integrity guard already built in FUX-408.
4. Auto-generate accrued obligations where the source is already known: social insurance and salary tax withheld can be accrued directly from a finalized payroll run (Story 8.1 already computes these amounts); sales tax/VAT and WHT can be accrued from invoice/bill tax line items where applicable.
5. Add a Statutory Obligations view (list + simple dashboard) showing outstanding accrued amounts by type, due dates where known, and remittance history — separate from the Bills list and from the plain Transaction ledger, but visible from the Finance Overview attention queue as another source of "needs attention" items.

## Implementation level

- New `StatutoryObligationDB` model: `obligation_type` (enum above), `period` (e.g., month/quarter the obligation relates to), `amount_accrued`, `amount_remitted`, `currency`, `status` (`accrued`, `partially_remitted`, `remitted`), `due_date`, `source_type` (`payroll_run`, `invoice_tax_line`, `bill_tax_line`, `manual`), `source_id` (nullable FK to the originating record), `notes`.
- New settlement linkage: remitting a statutory obligation creates a `LedgerTransaction` via `SettlementService.settle_statutory_obligation()` (new method, following the exact pattern of `settle_bill()`/`settle_invoice()`), with the same overpayment prevention and atomic balance adjustment already built.
- Apply the same status-integrity guard from FUX-408: `status` cannot become `remitted` or `partially_remitted` directly; only as a computed outcome of an actual settlement.
- Wire payroll finalization (Story 8.1) to automatically create `accrued` `social_insurance_employee`, `social_insurance_employer`, and `income_tax` obligation records for the relevant period once a payroll run is finalized, using amounts already computed in that flow.
- Add a manual "Record Statutory Obligation" entry point for obligations not sourced from payroll (e.g., quarterly VAT/sales tax return, or a one-off WHT on a specific payment) with the same account-and-payment-details pattern as the Bill combined create-and-pay action from FUX-408.
- Add the Statutory Obligations list under **Finance → Spend** (alongside Bills, per the navigation structure already defined in the implementation plan), with filters by type, period, and status.
- Add outstanding statutory obligations to the Needs-Attention queue (FUX-202) as a new attention-item type, alongside overdue bills and invoices.

## Acceptance criteria

- Recording a statutory obligation payment produces one obligation record and one linked ledger transaction, atomically, exactly like the bill/invoice settlement pattern.
- Obligation type is one of the seven controlled values; free-text or ad-hoc types are not permitted, keeping reporting consistent.
- A finalized payroll run automatically creates the correct accrued social insurance and income tax obligation records for that period without manual re-entry.
- Manually recording a one-off obligation (e.g., quarterly VAT) works without requiring a payroll run.
- Government/tax remittances no longer need to be modeled as a fake "Government" vendor Bill or as an undifferentiated plain transaction category; they have their own correctly-typed record.
- Statutory obligations appear as their own item type in the Needs-Attention queue when accrued and unremitted past a reasonable window.
- `status` on a statutory obligation cannot be set directly to `remitted`/`partially_remitted` without a real corresponding payment, identical to the bill integrity guard in FUX-408.

## Verification plan

- Finalize a test payroll run and confirm the correct social insurance (employee and employer portions) and income tax obligation records are created automatically with correct amounts and period.
- Manually record a one-off sales tax/VAT remittance and confirm it creates a correctly linked ledger transaction and bank balance adjustment.
- Attempt to set an obligation's status to `remitted` directly via the API without a real settlement; confirm rejection, mirroring the FUX-408 test pattern.
- Confirm partial remittance (e.g., paying half of an accrued social insurance obligation) correctly updates `amount_remitted` and leaves status as `partially_remitted`.
- Confirm outstanding obligations surface correctly in the Needs-Attention queue.
- Regression-test payroll finalization (Story 8.1) and the settlement engine (FUX-406/408) to confirm no interference with existing bill/invoice/payroll behavior.
