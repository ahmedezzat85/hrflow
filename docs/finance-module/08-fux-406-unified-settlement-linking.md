# FUX-406 — Unified settlement linking across Bill Payment, Invoice Payment, and Add Transaction

Related: `docs/finance-module/05-finance-ux-implementation-plan.md`, `docs/finance-module/07-finance-ux-plan-addendum.md` (FUX-405 Employee payee type, FUX-505 Global quick-add transaction)

**User story:** As a finance user, I want any transaction that settles a bill or invoice to be linked to that document no matter which screen I used to record it, so that I never accidentally create a duplicate, unlinked entry for money that was already recorded against a bill or invoice.

## Problem this addresses

Bill Payment and (presumed, pending verification) Invoice Payment already create a `LedgerTransaction` linked back to the source document via `linked_bill_id` / `linked_invoice_id`. Add Transaction — including the recently shipped Employee/Vendor payee type (FUX-405) and the global quick-add entry point (FUX-505) — creates a `LedgerTransaction` with a `payee_type`/`payee_id` (who the money went to) but has no way to record which specific bill or invoice it settles. This gap allows the same real-world payment to be entered twice: once correctly through Record Payment, and again manually, with no structural link between them and no warning at entry time.

## High-level scope

1. Add an optional **document link step** to the Add Transaction flow: when payee type is Vendor, show that vendor's open bills as selectable settlement targets; when payee type is Customer (or equivalent), show that customer's open invoices. Selecting one auto-fills amount/currency and sets the link; "No specific document" remains a valid explicit choice.
2. Unify the backend so Bill Payment, Invoice Payment, and Add Transaction all create their `LedgerTransaction` through one shared settlement function, rather than duplicated logic per entry point, so balance adjustment and document status transitions (paid/partially paid) behave identically regardless of origin screen.
3. Add a non-blocking duplicate-likelihood warning at Add Transaction submit time when an open bill/invoice for the selected vendor/customer closely matches the entered amount, date proximity, and account.
4. Add a lightweight indicator on existing unlinked transactions that have a Vendor/Employee payee and a plausible matching open bill, surfaced as an optional review list — not automatic linking.

## Implementation level

- Extend the transaction modal's existing payee-type logic (from FUX-405) so selecting **Vendor** triggers a lookup of that vendor's bills in `ready_to_pay`, `scheduled`, `partially_paid`, and `overdue` states, rendered as a secondary picker beneath the vendor field.
- Add the same pattern symmetrically for a **Customer** payee type on incoming transactions against open/partially-paid invoices, if a Customer payee classification does not already exist as a counterpart to Vendor/Employee — confirm current schema before implementing, since only Vendor and Employee were confirmed in the FUX-405 diff.
- Add `linked_bill_id` / `linked_invoice_id` (optional, nullable) to the manual transaction create/update path and schema, mirroring the existing fields already used by `bills_repository.record_payment()`.
- Refactor `bills_repository.record_payment()`, the equivalent invoice payment path, and the manual transaction create path to call one shared internal function (e.g., `ledger_service.record_settlement()`) responsible for: balance adjustment, ledger row creation, and document status transition (paid/partially_paid) — each caller supplies only the document type and ID, or none.
- Add a pre-submit check comparing the entered vendor/customer, amount (within a small tolerance), and date (within a configurable window, e.g. 14 days) against that party's open documents; if a close match exists and no document was selected, show a dismissible warning with a one-click "Link to Bill #X instead" action.
- Add a computed flag or lightweight query (not a new table) that identifies existing transactions with a Vendor/Employee payee, no document link, and a same-vendor open bill within a reasonable amount tolerance, to support a manual "Possible unlinked settlements" review list on the Bills or Reports section.

## Acceptance criteria

- From Add Transaction, selecting a Vendor payee surfaces that vendor's open bills, and selecting one links the transaction and updates the bill's paid amount/status identically to using Record Payment on the bill directly.
- A transaction created with no document link remains fully valid and unaffected — this feature is additive, not a new requirement.
- Recording a payment via Bill Payment, Invoice Payment, or Add Transaction against the same document produces the same balance and status outcome, verified by comparing all three paths against an identical bill/invoice fixture.
- Attempting to submit a manual transaction that closely matches an existing open bill for the same vendor triggers a visible, dismissible warning before submission completes.
- The "possible unlinked settlements" review indicator never auto-links anything; it only surfaces candidates for a human decision.
- No existing bill payment, invoice payment, or transaction functionality regresses as a result of the shared settlement refactor.

## Verification plan

- Unit-test the shared settlement function directly with bill-linked, invoice-linked, and unlinked inputs, confirming identical balance and status behavior across all three.
- Backend test: create a bill, pay it in full via Add Transaction's new bill picker, and confirm the bill shows `status=paid` exactly as it would via the existing Record Payment endpoint.
- Backend test: attempt the same for partial payment and confirm `partially_paid` status and remaining balance match Record Payment's existing behavior.
- Playwright test: open Add Transaction, select a Vendor with a known open bill, confirm the bill appears as a selectable option, select it, and verify the resulting transaction and bill state.
- Playwright test: enter a manual transaction with vendor/amount/date closely matching an existing open bill without selecting it, and confirm the duplicate-likelihood warning appears.
- Regression suite: re-run existing Bill Payment (Story 4.2) and manual transaction (Story 5.2, FUX-405) test suites in full to confirm no behavior change for already-passing cases.

## Open item to confirm before implementation

Whether a **Customer** payee type (parallel to Vendor/Employee) already exists on `LedgerTransaction`, or whether incoming-transaction-to-invoice linking needs its own classification added first — this could not be confirmed from available tooling and should be checked directly against `be/finance/models.py` before scoping begins.
