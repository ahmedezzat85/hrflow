# FUX-410 — Statutory obligations tracker (government/tax liability types)

Related: `docs/finance-module/08-fux-406-unified-settlement-linking.md` (SettlementService), `docs/finance-module/10-fux-408-combined-bill-payment-guard.md` (settlement integrity guard), Phase 2 Needs-Attention queue (FUX-202), Story 8.1 Guided payroll run

**User story:** As a finance user, I want to record and track government and statutory obligations (sales tax, salary/income tax withheld, social insurance, health insurance, withholding tax) with precise types, separate from vendor Bills, so that these can be accrued when owed and settled when paid without misrepresenting them as vendor spend — and I want the option to correct the accrued amount to match what the government portal actually calculates, since HRFlow's payroll engine cannot replicate the government's own formulas exactly.

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

### Revision note: payroll-derived amounts are estimates, not authoritative figures

An earlier version of this story assumed the payroll engine's computed social insurance and income tax figures could be trusted as final and simply confirmed at remittance. Direct feedback identified a real constraint: the actual formulas for these obligations are owned and executed by the government's own online tax/social-insurance systems, which may apply calculation logic, rounding, or add-on processing fees that HRFlow's payroll engine has no way to replicate exactly. Treating the payroll-computed number as locked and authoritative would force a mismatch to be explained away every single period. This revision replaces that assumption with an **estimate-then-confirm** model, consistent with standard payroll tax liability accounting, where an accrual estimate is later trued up against the amount actually assessed or paid, with the difference booked as a visible variance rather than silently overwritten or hidden.

## High-level scope

1. Add a new **Statutory Obligation** entity, distinct from Bill and from plain categorized Transaction, with a controlled `obligation_type` enum: `sales_tax`, `withholding_tax`, `income_tax`, `social_insurance_employee`, `social_insurance_employer`, `health_insurance`, `other_statutory`.
2. Support three states per obligation: **Estimated** (a draft figure, typically from payroll, not yet confirmed against the actual government-calculated amount), **Accrued** (the confirmed amount owed, either the estimate confirmed as-is or corrected to match the government portal), and **Remitted** (actually paid), mirroring standard accrual-then-true-up-then-payment practice.
3. Allow the accrued amount to be edited before or during remittance to match the real figure from the government system, for obligation types where an external authority computes the final number (`income_tax`, `social_insurance_employee`, `social_insurance_employer`, `health_insurance`). Obligation types the company calculates itself (`sales_tax`, `withholding_tax`) are not subject to this same estimate/correction distinction, since the company already controls that calculation.
4. Record and display the variance between the original payroll-derived estimate and the confirmed/remitted amount, including any government-side processing fees, as a visible, explained figure — never silently discarded.
5. Link remittance to the same `SettlementService` pattern already used for bills/invoices (FUX-406) so paying a statutory obligation creates a real linked ledger transaction, applying the same integrity guard already built in FUX-408.
6. Auto-generate **estimated** obligations where the source is already known: social insurance and salary tax withheld can be estimated directly from a finalized payroll run (Story 8.1); sales tax/VAT and WHT can be accrued directly (not merely estimated) from invoice/bill tax line items, since the company controls that calculation.
7. Fully support recording a statutory obligation manually with no payroll linkage at all, for users who prefer to record the payment only once the real amount is known from the government portal, bypassing the estimate step entirely.
8. Add a Statutory Obligations view (list + simple dashboard) showing outstanding amounts by type, due dates where known, and remittance history, with estimate-vs-actual variance visible per record — separate from the Bills list and from the plain Transaction ledger, but visible from the Finance Overview attention queue as another source of "needs attention" items.

## Implementation level

- New `StatutoryObligationDB` model: `obligation_type` (enum above), `period`, `amount_estimated` (nullable, populated only for payroll-derived types), `amount_accrued` (the confirmed/corrected figure used for remittance), `amount_remitted`, `variance_amount` (computed as `amount_accrued - amount_estimated` where an estimate exists), `variance_note` (free text, e.g. "government portal rounding + processing fee"), `currency`, `status` (`estimated`, `accrued`, `partially_remitted`, `remitted`), `due_date`, `source_type` (`payroll_run`, `invoice_tax_line`, `bill_tax_line`, `manual`), `source_id` (nullable FK to the originating record), `notes`.
- Payroll finalization (Story 8.1) creates obligations in `estimated` status for `social_insurance_employee`, `social_insurance_employer`, and `income_tax`, using amounts already computed in that flow, with `amount_accrued` initially equal to `amount_estimated`.
- Add an explicit "Confirm / Adjust Accrued Amount" action on `estimated` obligations: editing `amount_accrued` away from `amount_estimated` moves the obligation to `accrued` status, computes and stores `variance_amount`, and optionally accepts a `variance_note`. Leaving the amount unchanged and confirming also moves it to `accrued` with `variance_amount = 0`.
- Invoice/bill tax-line-derived obligations (`sales_tax`, `withholding_tax`) are created directly in `accrued` status with no estimate step, since the company controls that calculation and there is no external recalculation to reconcile against.
- New settlement linkage: remitting an obligation (from `accrued` status) creates a `LedgerTransaction` via `SettlementService.settle_statutory_obligation()`, following the exact pattern of `settle_bill()`/`settle_invoice()`, with overpayment prevention and atomic balance adjustment.
- Apply the same status-integrity guard from FUX-408: `status` cannot become `remitted` or `partially_remitted` directly; only as a computed outcome of an actual settlement. `accrued` status likewise cannot be set directly except through the explicit confirm/adjust action described above, to preserve the audit trail of what was estimated versus what was confirmed.
- Add a manual "Record Statutory Obligation" entry point that skips the estimate step entirely — for users who prefer to wait until the real government-calculated amount is known and record it directly in `accrued` status with no payroll linkage, exactly as scoped for one-off obligations like VAT.
- Add the Statutory Obligations list under **Finance → Spend** (alongside Bills, per the navigation structure already defined in the implementation plan), with filters by type, period, and status, and a variance column visible wherever an estimate exists.
- Add outstanding statutory obligations to the Needs-Attention queue (FUX-202) as a new attention-item type, alongside overdue bills and invoices.

## Acceptance criteria

- Recording a statutory obligation remittance produces one obligation record and one linked ledger transaction, atomically, exactly like the bill/invoice settlement pattern.
- Obligation type is one of the seven controlled values; free-text or ad-hoc types are not permitted, keeping reporting consistent.
- A finalized payroll run automatically creates `estimated` social insurance and income tax obligation records for that period without manual re-entry, clearly labeled as estimates in the UI.
- The accrued amount for a payroll-derived obligation can be edited to match the government portal's actual figure before remittance, and the resulting variance (including any government-side fees) is calculated, stored, and visibly displayed — never silently overwritten or hidden.
- Confirming a payroll-derived estimate without changes results in a recorded variance of zero, not an absent variance field.
- Sales tax/VAT and withholding tax obligations, which the company calculates itself, skip the estimate step and are created directly as accrued.
- A user can record a statutory obligation manually, with no reference to a payroll run, entering the real government-confirmed amount directly.
- Government/tax remittances no longer need to be modeled as a fake "Government" vendor Bill or as an undifferentiated plain transaction category; they have their own correctly-typed record with estimate-vs-actual traceability where relevant.
- Statutory obligations appear as their own item type in the Needs-Attention queue when unremitted past a reasonable window.
- `status` cannot be set directly to `accrued` (from `estimated`), `partially_remitted`, or `remitted` without going through the defined confirm/adjust or settlement actions, identical in spirit to the bill integrity guard in FUX-408.

## Verification plan

- Finalize a test payroll run and confirm the correct social insurance (employee and employer portions) and income tax obligation records are created automatically in `estimated` status with correct amounts and period.
- Adjust an estimated obligation's accrued amount to simulate a government portal recalculation plus a processing fee; confirm the variance amount and note are correctly stored and displayed, and status transitions to `accrued`.
- Confirm an estimated obligation without changes; verify status transitions to `accrued` with `variance_amount = 0`.
- Manually record a one-off sales tax/VAT remittance with no payroll linkage; confirm it is created directly in `accrued` status and settles correctly with a linked ledger transaction and bank balance adjustment.
- Attempt to set an obligation's status to `accrued`, `remitted`, or `partially_remitted` directly via the API bypassing the confirm/adjust or settlement actions; confirm rejection, mirroring the FUX-408 test pattern.
- Confirm partial remittance (e.g., paying half of an accrued social insurance obligation) correctly updates `amount_remitted` and leaves status as `partially_remitted`.
- Confirm outstanding obligations surface correctly in the Needs-Attention queue, including those still in `estimated` status awaiting confirmation.
- Regression-test payroll finalization (Story 8.1) and the settlement engine (FUX-406/408) to confirm no interference with existing bill/invoice/payroll behavior.
