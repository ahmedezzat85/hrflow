# Vendor Bill Workflow v2: Statuses, Approval, Payments and Drafts

**Status:** Approved by owner, October 8, 2026. Slice B1 implemented on `feature/bills-b1-status-model`; B2 to B6 not implemented.
**Baseline:** `main` @ `f01f226` (latest Alembic revision `0027_single_assigned_role`).
**Decisions:** D-016 to D-019 in [../project-context/04-decision-log.md](../project-context/04-decision-log.md).
**Supersedes in part:** FUX-401 status queues (Inbox, Needs Coding, Needs Approval, Ready to Pay, Exceptions), [10-fux-408-combined-bill-payment-guard.md](10-fux-408-combined-bill-payment-guard.md) (combined create-and-pay ledger fields and approval input), [16-fux-414-collapsible-status-tab-bar.md](16-fux-414-collapsible-status-tab-bar.md) (status list only; the tab-bar control stays).

This plan delivers the agreed vendor-bill decisions in five slices, each on its own branch with one PR. Visual restyling (status pills, tag filters, compact tables, summary cards, segmented controls) is **out of scope** and gets a separate plan, shown visually before approval.

## Target model

| Status (key) | Set by | Counts as money owed (AP, forecast, vendor open totals) | Old statuses mapped here |
| --- | --- | --- | --- |
| Draft (`draft`) | Save as draft, PDF upload | No | `inbox`, `needs_coding` |
| Pending approval (`pending_approval`) | Finance user submits | No (own queue) | `needs_approval` |
| Rejected (`rejected`) | Approver rejects, with reason | No | `exceptions` |
| Approved (`approved`) | Approver saves, or approves | Yes | `unpaid`, `ready_to_pay`, `overdue` |
| Scheduled (`scheduled`) | Schedule payment | Yes | `scheduled` |
| Partially paid (`partially_paid`) | Payments only | Yes (remaining) | `partially_paid` |
| Paid (`paid`) | Payments only | No | `paid` |
| Void (`void`) | Void bill, with reason | No | `void` |

Overdue is a flag (`is_overdue`): due date before today and status Approved, Scheduled or Partially paid.

Rules for every slice:

- Status is never accepted from the client; it changes only through server actions.
- Super admin's bills, and system-created bills (subscription charges), enter as Approved, marked auto-approved.
- A bill payment uses an account in the bill's currency, and the account must cover the amount. No exchange rate on bills or bill payments; currency exchange happens only through account transfers.
- Discard draft deletes a draft permanently. Every other bill is kept; cancelling is Void.

## Slice B1: Status model and data migration

Backend:

1. Alembic `0028_bill_status_model`: remap rows per the table above, change the column default from `unpaid` to `draft`, add `void_reason`, `voided_by`, `voided_at`. `is_reviewed` and `requires_approval` stay in the table but are no longer used.
2. `bills_service.py`: replace `VALID_BILL_STATUSES` with the eight keys and route every action through one `BILL_TRANSITIONS` table. An action not in the table returns 409 with the current status and allowed actions.
3. `status` is no longer accepted in `BillCreate` / `BillUpdate` (422).
4. `is_overdue` added to `BillResponse`.
5. Void: reason in the new columns, not appended to notes. Void is refused while any unreversed payment exists. (Today only `paid` is blocked, so a partially paid bill can be voided and its payment orphaned.)
6. Update every reader of bill statuses: `bills_repository.get_queue_counts` and list `queue` filter, `vendors_repository.get_vendor_metrics`, `attention_service` (overdue from due date), `forecast_service`, `reports_service` (unpaid count, AP aging), `routers/activity.py`.
7. `subscriptions_repository`: auto-created bills become Approved (auto-approved by system) instead of `ready_to_pay`.
8. Other routes that change a bill's status must stop writing it directly (added 9 Oct 2026): `cheques_repository._post_cheque_ledger_entries` sets `bill.status = "paid"` and `_reverse_cheque_ledger_entries` sets `"unpaid"`. Replace both with one shared helper that derives Approved / Scheduled / Partially paid / Paid from recorded, unreversed payments.

Frontend minimum: remove the status dropdown from `bill-modal.html` (read-only badge instead); `FinanceFormat.getDerivedBillStatus`, labels and badge colours use the new keys; the existing status tab bar lists the eight statuses.

Acceptance:

- [x] Migration maps every old status and runs up and down on a copy of `hrflow_Prod.db`.
- [x] A status change not in the transition table is refused with 409; `status` in create/update is refused with 422.
- [x] A partially paid bill cannot be voided.
- [x] Draft, Pending approval and Rejected are excluded from AP aging, the forecast and vendor open totals.
- [x] Tests: new `test_finance_bill_status_model.py`; `test_finance_bills_inbox.py` retired; `test_finance_bills.py` updated.

Implementation notes (B1):

- Status logic lives in `be/finance/bill_status.py` (`BILL_TRANSITIONS`, `OPEN_STATUSES`, `derive_payment_status`, `is_overdue`); `bills_service` applies every action through it. A refused action returns 409 with `detail = {code, message, action, current_status, allowed_actions}`.
- B1 adds `POST /bills/{id}/submit` and `POST /bills/{id}/withdraw` (permission `finance.bill.write` until B2) and `POST /bills/{id}/void`; `DELETE` still voids until B4. Create-and-pay starts the bill Approved and settles it (B2/B3 tighten this path). `requires_approval` is still honoured on create-and-pay until B2 replaces it.
- A cheque linked to a bill counts as payment in `derive_payment_status` until B3 gives cheques payment records.
- Extra readers updated beyond the list above: `reports_service` (operating spend now counts only Approved, Scheduled, Partially paid and Paid bills; unpaid count, balance sheet and trial balance AP), `settlement_service.check_duplicate_settlement`, `routers/activity.py`, `attention_service`, the mock API, `finance-accounts.js`.
- List filter `overdue=true` added; `queue-counts` returns the eight statuses plus `overdue` and `all`.

## Slice B2: Approval rules and permissions

1. Add `finance.bill.approve` and `finance.bill.pay` (each implies `finance.bill.read`) to `core/permission_catalog.py`. Super admin holds them automatically.
2. Migration `0029_bill_approve_pay_permissions` grants them to no seeded role. Financial-Admin keeps create/edit but can no longer approve or pay until granted.
3. Remove `approval_status`, `approved_by`, `approved_at`, `created_by`, `amount_paid`, `is_reviewed` from `BillCreate` / `BillUpdate`; the server sets them.
4. Saving: a user with `finance.bill.approve` gets Approved (`approval_status = auto`). Others get Draft, then `POST /bills/{id}/submit` -> Pending approval.
5. `POST /bills/{id}/approve` needs `finance.bill.approve`; a creator may not approve their own bill unless super admin. Reject needs a reason.
6. `POST /bills/{id}/withdraw` (submitter, Pending approval) -> Draft. Resubmitting a Rejected bill uses `submit`.
7. A user without `finance.bill.approve` who changes vendor, amount, currency or lines of an Approved or Scheduled bill sends it back to Pending approval and clears the schedule. Notes, attachment and due date do not.
8. Recording a payment (Pay dialog or "Already paid") needs `finance.bill.pay`; scheduling needs `finance.bill.write`.
9. Every action writes an activity entry (who, when, from/to status, reason).
10. Every other route that pays a bill needs `finance.bill.pay` too (added 9 Oct 2026): a manual ledger transaction with `linked_bill_id` (`ledger_service.record_manual_transaction`) and a cheque with `linked_bill_id` (`cheques_service.issue_cheque`).

Acceptance:

- [ ] Any approval field in a create/update request is refused with 422.
- [ ] A finance user's bill reaches Approved only through `approve`; a super admin's bill is Approved on save, marked auto-approved.
- [ ] A non-super-admin approver cannot approve their own bill.
- [ ] A material edit by a finance user returns an Approved bill to Pending approval.
- [ ] Pay without `finance.bill.pay` returns 403.
- [ ] Tests: `test_finance_bills_approval.py` rewritten; RBAC tests extended.

## Slice B3: Payment fields, currency and balance checks

Payment input (`BillPaymentInline` and `PaymentCreate`, one shared schema):

- Source account and payment type: separate, required. Form defaults: CASH - EGP and Cash payment.
- Reference optional and empty by default; details optional, default vendor name; cheque number required for Cheque.
- No exchange-rate field.

Server checks in `settlement_service.settle_bill` (400 each):

1. `currency_mismatch`: account currency differs from the bill's.
2. `insufficient_balance`: account balance below the payment, for every account (no overdraft).
3. `payment_type_not_allowed`: cash account -> Cash payment; bank account -> Outgoing transfer, Cheque, Debit card. Incoming, internal transfer, exchange, ATM withdrawal and bank-fee types are never allowed for a bill.
4. Over-payment beyond the remaining balance stays refused.

Ledger row written by `bills_repository.record_payment`:

| Field | Today | After |
| --- | --- | --- |
| `payment_type_id` | Always Outgoing transfer | The chosen type |
| `reference` | Bill number | As entered (may be empty) |
| `description` | "Payment for bill #..." | Details as entered |
| `cheque_number` | Empty | Set for Cheque |
| `payee_type`, `payee_id`, `payee_name` | Empty | The bill's vendor |
| `created_by` | Empty | Current user |

Every route that pays a bill goes through `settlement_service.settle_bill` with these checks, creating a payment record and updating `amount_paid` (added 9 Oct 2026): the bill dialogs, a manual transaction with `linked_bill_id`, and a cheque with `linked_bill_id` (today the cheque path only flips the status, with no payment record or amount check). Balances are updated with `recalculate_account_running_balances`, not by setting `current_balance` directly, so backdated payments keep running balances correct.

The bill stays linked through `linked_bill_id`. Creating a bill with "Already paid" commits bill, payment, balance change and ledger row in one transaction. New bills default to EGP. `GET /finance/payment-types?usage=bill_payment&account_type=...` supplies the allowed types.

Acceptance:

- [ ] USD bill from an EGP account fails with `currency_mismatch`, nothing changed.
- [ ] Payment above the account balance fails with `insufficient_balance`, nothing changed.
- [ ] Cash payment from a bank account, or Outgoing transfer from a cash account, fails.
- [ ] Ledger row carries the entered type, reference, details, cheque number, vendor payee and creator.
- [ ] A failed "Already paid" save leaves no bill behind.
- [ ] A cheque or manual transaction linked to a bill creates a payment record, updates `amount_paid`, and is refused on currency mismatch, insufficient balance or missing `finance.bill.pay`.
- [ ] Tests: new `test_finance_bill_payment_rules.py`; `test_finance_bill_payment_guard.py` and `test_finance_settlement_linking.py` updated.

## Slice B4: Drafts and PDF upload

1. Migration `0030_bill_draft_fields`: `vendor_id`, `bill_number`, `issue_date`, `due_date` become nullable (Alembic batch mode on SQLite). The same migration seeds a protected **Miscellaneous** vendor (added 9 Oct 2026, D-020 amendment): it cannot be deleted, renamed or deactivated, and is the vendor for shops not worth tracking.
2. A draft needs a vendor or an attachment. Leaving Draft runs the full checks (required fields, category, inactive vendor, duplicate detection).
3. Bill number is optional when leaving Draft: a blank number is auto-assigned as `EXP-YYMM-NNNN` (sequence per month, unique). Duplicate detection still compares vendor, date and amount, so two equal Miscellaneous receipts on the same day get the existing warning with override.
4. PDF upload creates a Draft with the file and extracted fields (`bill_extractor.py`, FUX-413).
5. Multi-file upload: several PDFs or photos at once, any mix of vendors. Each file becomes its own Draft with its own vendor match; a weak match leaves the vendor empty and flags "vendor to confirm"; a new vendor is suggested, never auto-created. After upload the list opens filtered to the new drafts.
6. `DELETE /bills/{id}` on a Draft deletes it, its lines and attachment, with one activity line. On other statuses DELETE returns 409; cancelling is `POST /bills/{id}/void` with a reason.

Acceptance:

- [ ] A draft saves with only a vendor, or only an attachment.
- [ ] Leaving Draft with a missing required field is refused field by field.
- [ ] Five PDFs from three vendors yield five Drafts, each with its own vendor or a "vendor to confirm" flag.
- [ ] Discarding a draft removes row and file; DELETE on any other bill is refused.
- [ ] The Miscellaneous vendor exists after migration and cannot be deleted, renamed or deactivated.
- [ ] A bill saved with a blank number gets the next `EXP-YYMM-NNNN` number; numbers never repeat.
- [ ] Tests: `test_finance_bill_extraction.py`, `test_finance_bill_attachments.py` updated; new draft-lifecycle tests.

## Slice B5: Bill screens, behaviour only (current visual style)

New-bill form (`bill-modal.html`, `finance-bills.js`):

- Super admin: "Not paid yet / Already paid" choice, starting on the user's last choice (first time Not paid yet). "Already paid" shows source account (bill currency only), payment type (filtered by account type), amount paid, payment date, reference (empty), details (vendor name), cheque number for Cheque.
- Finance user: no payment choice; primary button "Submit for approval".
- Vendor list shows Miscellaneous first; Bill number field hint: "Leave blank to auto-number"; with Miscellaneous the Details field prompts for the shop name.
- Defaults: currency EGP, account CASH - EGP, Cash payment. Changing currency moves the account to that currency's cash account.
- "Saves as" line naming the resulting status. Footer: Save as draft, "Add another after saving", Cancel, primary action. Line items optional.

Bill detail: status badge and Overdue flag; actions by status and permission (Record payment, Schedule payment, Void bill, Approve, Reject, Withdraw, Edit and resubmit, Discard draft); inline reject reason shown to the submitter; void confirmation with reasons (Duplicate, Entered by mistake, Cancelled by vendor, Other) and optional note; Record payment shows balance after payment; server errors shown beside their field.

List: existing status tab bar (FUX-414) with All plus eight statuses and counts, an "Overdue only" toggle; one primary row action per status.

Acceptance:

- [ ] No control sets a bill status directly.
- [ ] Super admin records a paid cash bill in one save typing only vendor, number, category and amount.
- [ ] A finance user sees no payment fields and cannot approve.
- [ ] Each server error appears next to its field.
- [ ] `npm run build` passes; Playwright `finance-bills-inbox`, `finance-bills-approval`, `finance-bill-combined-pay`, `finance-bill-status-tab-bar` rewritten and passing.

## Slice B6: Banking rules (added 9 Oct 2026, D-020)

1. **Same currency for manual transactions.** `ledger_service.record_manual_transaction` refuses a transaction whose currency differs from its account's; the `fx_rate` path for manual entries is removed. Exchange happens only through FX transfers. Today a foreign-currency entry lowers the balance by the foreign amount, because `recalculate_account_running_balances` uses `amount` and ignores `base_amount`.
2. **Same currency for cash withdrawals.** A teller withdrawal (`destination_cash_account_id` on a manual outflow) and a cash-withdrawal cheque (`cheques_service.issue_cheque`) are refused when the cash account's currency differs from the bank account's. Today the same number is added in the other currency.
3. **Cheque reversals post reversing entries.** When a cheque is stopped, voided, bounced or replaced, `_reverse_cheque_ledger_entries` adds opposite entries with the reason instead of deleting the original rows; the bill payment it made is reversed through the settlement service.
4. **Spend is a bill.** Payments to a vendor or shop are recorded as bills; plain transactions are for bank fees, transfers, exchange, withdrawals and money in. Proposed enforcement, to confirm at plan approval: a manual money-out with a vendor payee and no `linked_bill_id` is refused with a message pointing to New bill; the money-out form shows the same hint.

Acceptance:

- [ ] A USD transaction on an EGP account is refused; no rate field remains on manual entries.
- [ ] A USD withdrawal into CASH - EGP is refused, for both teller withdrawals and cheques.
- [ ] Stopping a cheque keeps its original entries, adds reversing entries, restores the balance and reverses its bill payment.
- [ ] A vendor money-out without a bill is refused (if the enforcement is confirmed).
- [ ] Tests: `test_finance_ledger.py`, `test_finance_cheques.py`, `test_finance_cheque_lifecycle.py` updated; new tests per criterion.

## Order, tests, risks

Order B1 -> B2 -> B3 -> B4 -> B5 -> B6 (B4 needs only B1; B6 needs B3). Each slice ships the smallest frontend change that keeps the bill screen usable. Tests: targeted `pytest be/tests/<file> -q`, then the finance suite; UI slices run `npm run build` then named specs with `--reporter=line`, compared against the known failing Playwright baseline.

| Risk | Effect | Mitigation |
| --- | --- | --- |
| HRFlow balances not yet accurate | Balance check blocks real payments | Run the cashbook 2026 import before B3 reaches prod |
| Financial-Admin loses approve/pay | That role cannot pay bills | Intended; grant keys when needed |
| Nullable columns on SQLite | Table rewrite | Batch mode; up/down test on a DB copy |
| Missed reader of old status keys | Wrong totals | B1 lists every reader; a test asserts no old key remains |

## Deferred

- **Visual restyle plan** (separate; shown visually first): status pills, single-select tag filters, compact table, summary cards, segmented controls, dialog layout. Reference: "Vendor Bills UI" design canvas. Decided in D-021 (direction A) and planned in [19-finance-ui-restyle-direction-a.md](19-finance-ui-restyle-direction-a.md). It runs after B5 is merged: B5 builds the bill screens' behaviour in today's style and the restyle then changes only their look.
- **Balance check for other outflows** (manual ledger entries, statutory payments, payroll funding): small follow-up slice after B3.
- **Bulk and historical import** (own plan): spreadsheet import with row-level preview creating Drafts or Approved bills; historical bills imported as Paid and linked to ledger transactions already imported from the cashbook (never paid twice), using unlinked-settlement matching; vendor matching by tax registration number and remembered aliases. An in-app AI assistant comes later, calling the same bill functions with the user's permissions and landing everything as Drafts.
- Skipped by owner: USD-equivalent consolidated reporting, monthly cash count, correcting dev bills BILL-001/BILL-006.
