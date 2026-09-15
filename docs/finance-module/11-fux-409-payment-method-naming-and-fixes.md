# FUX-409 — Standard payment-method naming, settings list integrity, and Bank Fee auto-fill

Related: `docs/finance-module/08-fux-406-unified-settlement-linking.md`, `docs/finance-module/10-fux-408-combined-bill-payment-guard.md`

**User story:** As a finance user, I want payment methods to use standard banking/accounting terminology, remain fully configurable from Settings, reliably display existing entries, and avoid unnecessary required clicks on transaction types where a payment method choice is not meaningful.

## Context

Three related issues were confirmed by direct review of the current implementation:

1. **Non-standard naming.** The nine seeded payment types (`CASHWITHDRAW`, `CHK`, `INTTRANS`, `INBOUND_TRANS`, `CASH`, `DEBIT_CARD`, `USDTOEGP`, `OUTBOUND_TRANS`, `BANK-FEES`) follow a personal-spreadsheet convention rather than standard terminology. Direction (in/out) is already captured structurally by the transaction's `direction` field, so encoding direction into the payment-type name is redundant. Standard banking/accounting taxonomy (AFP payment-method categories; bank-statement and QuickBooks conventions) names payment methods by instrument — Check, ACH/Bank Transfer, Cash, Card, Wire — not by direction.
2. **Settings list may render empty.** The Payment Types (and likely Categories) tab in Settings has been reported as showing no entries, blocking editing. Two candidate causes were identified from code review and could not be fully diagnosed without live database/API access: (a) the real-mode `GET /api/finance/payment-types` call may be failing or returning an empty response without a clearly visible error, since the current failure path only shows a toast and leaves the table blank; or (b) migration `0007_categories_payment_types_ledger_v2`, which seeds the seven default categories and payment types, may never have been applied to the live database.
3. **Bank Fee entry forces an unnecessary click.** In `setTransactionEntryType()`, selecting the "Bank Fee" guided transaction type correctly hides Counterparty, Tax, and Direction fields (since none are meaningful for a bank-initiated fee), and correctly auto-selects a matching "Bank Fee" category. However, the Payment Method field remains visible and required, with no equivalent auto-fill — forcing a manual dropdown selection for a field whose value is definitionally constant for this entry type.

## High-level scope

1. Rename the seeded default payment types to standard banking/accounting terminology, without removing configurability or breaking existing references.
2. Diagnose and fix the empty Settings list: confirm whether the issue is a failed/empty API response or a missing seed migration, and fix whichever is the actual cause. Add a visible, non-silent error state so this class of failure is never invisible again.
3. Fix the Bank Fee guided-entry type to hide the Payment Method field and auto-fill it behind the scenes, matching the existing Category auto-fill pattern.
4. Preserve all existing configurability (add/edit/deactivate) and all existing guided-entry validation (currency mismatch, adjustment authorization) exactly as already built.

## Implementation level

### Part 1 — Standard naming

- Add a migration updating the `name` field (not `code`, to avoid a riskier migration affecting historical transaction references) on the seeded `PaymentType` rows:
  - `CASHWITHDRAW` → "ATM Withdrawal"
  - `CHK` → "Check Payment"
  - `INTTRANS` → "Internal Transfer"
  - `INBOUND_TRANS` → "Incoming Transfer"
  - `CASH` → "Cash Payment"
  - `DEBIT_CARD` → "Debit Card Payment"
  - `USDTOEGP` → "Currency Exchange"
  - `OUTBOUND_TRANS` → "Outgoing Transfer"
  - `BANK_FEES` → "Bank Fee"
- Leave `code` values unchanged in this story; a separate, explicitly-requested migration would be needed to also rename machine codes, since those may be referenced by seeded reports, rules, or the cash-book migration script's `ACCOUNT_MAP`/taxonomy normalization logic.

### Part 2 — Settings list integrity

- Verify whether migration `0007_categories_payment_types_ledger_v2` has been applied to the current database (`SELECT * FROM finance_payment_types;` should return the seeded rows). If missing, apply it or write a corrective seed migration.
- Verify `GET /api/finance/payment-types` and `GET /api/finance/categories` return data correctly for an authenticated admin session in the real (non-mock) backend.
- Update `loadFinancePaymentTypes()` and `loadFinanceCategories()` in `finance.js` to distinguish three states explicitly: loading, confirmed-empty ("No payment types configured yet" — already exists as the empty-state message), and failed-to-load (a visible error banner naming the failure, not only a toast that can be missed).
- Document in deployment notes that finance seed migrations must run automatically on deploy, to prevent this class of "silently empty lookup table" issue from recurring for future seed data (e.g., if Customer payee type or other new lookups are added later).

### Part 3 — Bank Fee payment-method auto-fill

- In `setTransactionEntryType()`, within the `bank_fee` branch, change `paymentTypeGroup.style.display` from `"block"` to `"none"`, matching how Counterparty, Tax, and Direction are already hidden for this type.
- Add auto-fill logic mirroring the existing category auto-select:
  ```javascript
  if (FinanceState.paymentTypes) {
    const feePt = FinanceState.paymentTypes.find((p) => p.requires_bank_fee_flag === true);
    if (feePt) {
      const ptSel = document.getElementById("fFinanceTxPaymentType");
      if (ptSel) ptSel.value = feePt.id;
    }
  }
  ```
- Ensure `saveFinanceTransaction()`'s payment-type validation (if any exists) does not block submission when the field is hidden but has a valid auto-filled value.
- Ensure switching away from Bank Fee to another entry type correctly re-shows the Payment Method field and clears or resets the auto-filled selection to avoid a stale hidden value persisting into a different entry type by mistake.

## Acceptance criteria

- All nine default payment types display standard banking/accounting names in the Settings list, the transaction modal, the cheque modal, and any report grouped by payment type.
- Existing custom payment types (if any were added) are unaffected by the rename migration.
- Opening Settings → Payment Types reliably shows existing entries; if the list is ever empty, the cause is either a confirmed absence of data (clear "no payment types yet" state) or a visibly reported API/loading failure — never a silent blank table with no explanation.
- The same diagnostic and error-state fix is applied to Transaction Categories, since it shares the same loading pattern and risk profile.
- Add/Edit/Deactivate on both Payment Types and Categories continues to work exactly as before.
- Selecting "Bank Fee" as the transaction type hides the Payment Method field and automatically submits the correct Bank Fee payment type with zero additional clicks.
- Switching from Bank Fee to any other entry type correctly restores the Payment Method field as a normal, user-selectable, required field.

## Verification plan

- Directly query the payment types table (or call `GET /api/finance/payment-types` with valid admin credentials) to confirm seed data exists and displays the new names; apply the migration if missing and re-verify the expected nine rows.
- Simulate an API failure (e.g., temporarily revoke read permission or point at an invalid endpoint) and confirm the Settings list shows a visible error state, not a blank table.
- Confirm existing category/payment-type edit and deactivate actions still function correctly after the rename.
- Spot-check renamed payment types display correctly across the transaction modal, cheque issuance modal, and payment-type-grouped reports.
- Create a Bank Fee transaction end-to-end without ever interacting with the Payment Method field, and confirm the resulting record has the correct payment type set.
- Switch from Bank Fee to Money Out (and back) within the same modal session and confirm the Payment Method field's visibility and required state toggle correctly each time, with no leftover invalid state.
- Re-run the existing Story 5.2 (Guided transaction entry) backend and Playwright suites in full to confirm no regression in currency-mismatch or adjustment-authorization behavior.
