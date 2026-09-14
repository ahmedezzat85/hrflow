# Finance UX Implementation Plan — Addendum

Related: `docs/finance-module/05-finance-ux-implementation-plan.md`

The following stories were added after direct product usage uncovered two concrete gaps: no way to record internal people-payments (salaries, reimbursements, medical insurance) without a Vendor, and no way to add a transaction without first navigating to a specific account's workspace. Both are scoped, numbered, and formatted consistently with the main implementation plan, and should be treated as part of it. FUX-405 belongs in Phase 4 (Spend, Payables, Vendors, and Recurring Costs). FUX-505 belongs in Phase 5 (Banking Workspace and Cash Operations).

## FUX-405 — Employee payee type

**User story:** As a finance user, I want to record salaries, reimbursements, and medical insurance payments against a distinct Employee payee, separate from Vendor, so that internal people-payments do not pollute vendor reporting and payables aging.

### High-level scope

- Add a new payee classification, **Employee**, distinct from **Vendor**.
- Make Employee selectable on manual transactions (not on Bills, which remain vendor-scoped).
- Exclude Employee-tagged transactions from vendor spend reports, vendor aging, and vendor duplicate-detection.
- Where HR/employee records already exist in the system, offer linking to a real employee record; otherwise support a free-text employee name.

This follows the same distinction QuickBooks and Xero make natively: QuickBooks treats Vendor and Employee as separate entity types and explicitly does not require payroll transactions to have a vendor, and Xero's Spend Money transaction type similarly does not require a formal contact for direct payments.

### Implementation level

- Add a `payee_type` enum (`vendor` | `employee` | `none`) and `payee_id`/`payee_name` fields to `LedgerTransaction`, additive and nullable to avoid breaking existing rows.
- If an employee directory already exists elsewhere in the product, add a lookup service to resolve `payee_id` to that record; otherwise accept free-text `payee_name` only.
- Update the manual transaction form (`finance-transaction-modal.html`) to add a **Payee type** selector: **None**, **Vendor**, **Employee**. Selecting Vendor reuses the existing vendor picker; selecting Employee shows an employee picker/free-text field; selecting None shows neither.
- Update category seed data or documentation to clarify that Salaries, Medical Insurance, and similar categories are commonly paired with an Employee payee, not a Vendor.
- Update `reports_service.py` vendor-facing reports (Category Spend Rollup, vendor aging) to exclude `payee_type='employee'` rows by default, with an explicit toggle to include them if a user wants a full internal-spend view.
- Add backend validation: a transaction cannot have both `payee_type='vendor'` and an employee reference, or vice versa.

### Acceptance criteria

- A manual transaction can be saved with no payee, a vendor payee, or an employee payee — exactly one of the three.
- Employee-tagged transactions do not appear in vendor spend/aging reports by default.
- An explicit "include internal payments" toggle on relevant reports surfaces employee-tagged transactions when needed.
- Existing transactions with no payee type set continue to display and function unchanged (backward compatible).
- Category Spend Rollup still shows Salaries/Medical Insurance category totals correctly regardless of payee type.

### Verification plan

- Create one transaction with each payee type (none, vendor, employee) and confirm correct field display and persistence.
- Run vendor spend and aging reports with seeded employee- and vendor-tagged transactions; confirm employee rows are excluded by default and included only when the toggle is set.
- Attempt to set both vendor and employee payee on one transaction via the API directly; confirm rejection.
- Regression-test existing manual transaction flows created before this change.

---

## FUX-505 — Global quick-add transaction

**User story:** As a finance operator entering several transactions in a row, I want to add a transaction from anywhere in Finance without navigating to a specific account's workspace first, so that rapid sequential entry does not require repeated back-and-forth navigation.

### High-level scope

- Add a globally accessible **Add Transaction** action (command palette and/or persistent quick-action button) available from every Finance page, not only the account workspace.
- Make **Account** the first required field in the transaction form when opened globally, rather than assumed from page context.
- Support staying in a fast entry loop: after saving one transaction, offer an immediate **Save & add another** action that reopens a blank form with the same account/date preselected.

### Implementation level

- Extend the existing command palette (`command-palette-modal.html`) with an **Add Transaction** command, available from any Finance route.
- Extend the shared modal controller so the transaction modal can be opened either account-scoped (from the account workspace, account preselected and locked as today) or global (account required and empty, full account selector shown first).
- Add **Save & add another** as a secondary submit action alongside the existing **Save**, which persists the current transaction, resets the form, and retains account/date/currency from the just-saved entry to speed up back-to-back entries for the same account.
- Add a lightweight persistent quick-action affordance (e.g., a fixed action button or keyboard shortcut) so the flow doesn't strictly depend on discovering the command palette.
- Ensure the safe-command framework (idempotency, review summary) from FUX-004 and the guided transaction-type flow from FUX-502 apply identically whether the modal was opened globally or from the account workspace — no shortcuts on validation or duplicate protection for the sake of speed.

### Acceptance criteria

- A transaction can be created from any Finance page without first opening a specific account's workspace.
- The global entry form requires an explicit account selection before any other field is enabled.
- **Save & add another** persists the transaction, confirms success, and reopens a blank form with account/date/currency retained, ready for the next entry.
- Entering five transactions in a row against the same account requires no full-page navigation between entries.
- All safety, validation, and duplicate-prevention behavior from the standard transaction flow (FUX-004, FUX-502) applies identically in the global entry path.

### Verification plan

- Open the global Add Transaction command from at least three different Finance pages (Overview, Invoices, Reports) and confirm successful entry each time.
- Enter a sequence of five transactions using **Save & add another** and confirm no duplicate submissions, correct running balances, and retained context between entries.
- Confirm keyboard-only users can invoke the global command, complete the form, and use **Save & add another** without a mouse.
- Regression-test the existing account-scoped transaction entry to confirm it is unaffected (account still preselected and locked when opened from the account workspace).
