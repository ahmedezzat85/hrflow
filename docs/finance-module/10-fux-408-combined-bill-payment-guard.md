# FUX-408 — Combined create-and-pay bill action with settlement-status integrity guard

Related: `docs/finance-module/08-fux-406-unified-settlement-linking.md` (SettlementService), `docs/finance-module/09-fux-407-bill-document-repository.md`

## Context

Direct review of the current bill workflow confirms two things:

1. The bill list already shows a **Pay** button once a bill reaches `ready_to_pay` (added in Story 4.2), which opens the Record Payment modal and calls `SettlementService.settle_bill()` (via `bills_repository.record_payment()`), correctly creating a linked `PaymentDB` row, adjusting the bank account balance, and transitioning bill status based on `amount_paid` versus `total`. This existing two-step flow (create bill, then click Pay) is confirmed as the preferred base pattern going forward.
2. There is a real, currently unguarded gap: `bills_service.create_bill()` and `update_bill()` accept `status` directly from the request body with no cross-check against `amount_paid` or the existence of a `PaymentDB` record. A bill can be created or edited with `status="paid"` (or `"partially_paid"`) while `amount_paid` remains `0.0` and no payment has ever been recorded. This produces a bill that reports as settled with no corresponding bank-account effect, audit trail, or vendor payment history — a silent reconciliation discrepancy.

This story adds a single combined action for the common case of entering a vendor bill that is already fully paid at the time of entry, while closing the integrity gap that would otherwise let that same shortcut (or direct status editing) create a fictitiously "paid" bill.

## High-level scope

1. Add a **"Bill is already paid"** option to the bill creation form. Selecting it reveals inline payment fields (bank account, payment date, method, reference) directly in the same form, defaulting the payment amount to the bill total.
2. Saving with this option checked performs bill creation and full settlement as one atomic backend action, internally calling the same `SettlementService.settle_bill()` logic used by the existing Pay button — no duplicated settlement code path.
3. Add a server-side integrity guard: `status` can only become `"paid"` or `"partially_paid"` as a computed outcome of an actual settlement (via `SettlementService`), never as a directly settable value from `create_bill()` or `update_bill()`. Direct requests attempting to set either status without a corresponding real payment are rejected.
4. Remove "Paid" and "Partially Paid" as freely selectable options in the bill Status dropdown in the create/edit form; status in that form reflects current settlement state as read-only display once any payment exists, matching how `getDerivedBillStatus()` already treats `overdue` as computed rather than freely editable.

## Implementation level

- Add an `is_paid_now` (or equivalent) boolean flag to the bill-creation request path only, not persisted on `BillDB` itself, used purely to trigger the combined action.
- In `bills_service.create_bill()`, when `is_paid_now` is true: validate required payment fields (bank account, amount, date), create the bill via the existing path with an initial non-paid status, then immediately invoke `SettlementService.settle_bill()` with the provided payment details, inside the same transaction/atomic scope so a failure in either step rolls back both.
- Add a guard in `bills_service.create_bill()` and `update_bill()`: if the incoming payload's `status` is `"paid"` or `"partially_paid"` and this is not a call originating from `SettlementService`, raise a 400 error explaining that paid status is derived from recorded payments, not directly settable.
- Update `BillUpdate`/`BillCreate` schemas or service-layer logic so that a plain PUT/POST cannot set `status` to a settled state; the enum of directly settable statuses becomes `{inbox, needs_coding, needs_approval, ready_to_pay, scheduled, exceptions, void}` only.
- Update the bill Status dropdown in `bill-modal.html` to remove `paid`/`partially_paid` as selectable `<option>` entries; if the bill already has partial or full payment, show status as a read-only badge instead of an editable field.
- Add the "Bill is already paid" checkbox and inline payment fields to the same bill creation form (not a separate modal), following the same field-reveal pattern already used elsewhere in the form (e.g., duplicate-override reason field).
- Ensure the combined action still runs through existing safeguards unchanged: duplicate bill detection, review-required gating, and (if `requires_approval` is true for the bill) the existing approval requirement before any settlement can occur — the combined action must not create a backdoor around approval policy.

## Acceptance criteria

- Creating a bill with "Bill is already paid" checked, a bank account, and an amount produces one bill and one linked payment/ledger entry in a single save action, with the bill correctly showing `paid` (or `partially_paid` if a lesser amount was entered).
- Attempting to directly set `status="paid"` or `status="partially_paid"` via the API without going through `SettlementService` is rejected with a clear error.
- The bill Status dropdown in the UI no longer offers "Paid" or "Partially Paid" as directly selectable options.
- A bill that requires approval cannot be settled via the combined create-and-pay action until approved, identical to the existing Pay-button behavior.
- Existing Pay-button, payment reversal, and duplicate-detection behavior from Stories 4.1–4.2 and FUX-406 are unaffected.
- No existing bill in the system that was already correctly marked paid through the normal Pay flow is affected by this change.

## Verification plan

- Attempt to create a bill with `status="paid"` set directly (no `is_paid_now`, no payment fields) via the API; confirm rejection with a clear error message.
- Attempt the same via `update_bill()` on an existing unpaid bill; confirm rejection.
- Create a bill with "Bill is already paid" checked and full payment details; confirm one bill and one payment/ledger entry are created atomically, and that a simulated failure partway through (e.g., invalid bank account) rolls back the bill creation as well, leaving no orphaned unpaid-but-marked-paid bill.
- Confirm a bill requiring approval cannot be settled via the combined action while `approval_status != "approved"`.
- Regression-test the existing Pay button, payment reversal, and bill CRUD test suites (Stories 4.1, 4.2, FUX-406) in full.
- Manually verify the bill Status dropdown in the UI no longer lists Paid/Partially Paid as selectable options, and that an already-settled bill shows status as read-only.
