# 20. Finance Review Round 2: Sales Invoices, VAT, Withholding, Statutory, Payroll Funding, Cash Reports

**Status:** Approved by owner, October 10, 2026. F1 to F5 implemented on `feature/fin-f1-invoice-rules`; F6 not implemented.
**Baseline:** `main` @ `2a3681f` (bill workflow B1 to B6 merged).
**Decisions:** D-022 to D-026 in [../project-context/04-decision-log.md](../project-context/04-decision-log.md). Q-001 resolved by D-025.
**Depends on:** D-016 to D-020 (bill and banking rules), which these slices mirror for receivables, statutory and payroll.

Six slices, F1 to F6, each on its own branch with one PR, in the owner's current working directory (no worktrees). Visual restyle of these screens is out of scope (D-021 covers Bills only).

## Slice F1: Sales invoice status and safety rules (D-022)

1. Statuses: `draft`, `sent`, `partially_paid`, `paid`, `void`. Overdue becomes a flag (`is_overdue`: due date before today, status `sent` or `partially_paid`). `overdue`, `open` and `awaiting_payment` stop being stored or accepted as statuses; `open`, `overdue` and `awaiting_payment` may stay as list **filters** only. Migration remaps stored rows.
2. Status changes only through actions (save, send, receipts, reverse receipt, void); `status` is refused on create and update (422).
3. Once sent, the invoice's customer, currency, lines, amounts, VAT and withholding rate are locked; corrections are void and reissue. Notes and due date stay editable.
4. Void is refused while any unreversed receipt exists (today only `paid` is blocked, so a partly paid invoice can be voided and its receipts orphaned). Void reason stored in dedicated columns, not appended to notes.
5. Receipts go through `settlement_service.settle_invoice`, which must refuse an account whose currency differs from the invoice's (`currency_mismatch`), post the ledger row with the chosen payment type, reference and customer as payee, and update balances with `recalculate_account_running_balances`. No exchange rate on receipts.

Acceptance:
- [x] Migration maps every stored invoice status; `status` in requests is refused.
- [x] A sent invoice's lines, amounts, currency and customer cannot be edited. (Owner decision, October 10, 2026: issue date is locked too; notes, due date, expected account and revenue channel stay editable.)
- [x] A partly paid invoice cannot be voided.
- [x] A USD invoice cannot be received into an EGP account.
- [x] Tests: `test_finance_invoices.py` updated; new `test_finance_invoice_rules.py` (status, locks, void, receipts, migration 0031) and `fe/tests/ui/finance-invoice-rules.spec.js`.

## Slice F2: VAT on sales invoices (D-023)

1. Invoice gets `vat_rate` (percent). Default: 14 for EGP invoices, 0 for other currencies; editable while Draft.
2. Totals: subtotal (net, sum of lines), `tax_amount` = subtotal × rate, total = subtotal + VAT. Today `tax_amount` is hard-coded to 0 in `invoices_repository._compute_totals`.
3. Revenue in reports uses the net subtotal, never the VAT-inclusive total.
4. Statutory: an action "Generate VAT estimate" for a month creates or updates one `sales_tax` obligation (status `estimated`, EGP) whose estimate is the VAT on invoices issued that month. It is run on demand by the user; there is no scheduler. The portal-confirmed amount is entered later through the existing confirm/adjust step (D-001, D-002).
5. Migration adds `vat_rate`; existing invoices get 0 so their totals do not change.

Acceptance:
- [x] An EGP invoice of 105,000 net at 14% shows VAT 14,700 and total 119,700.
- [x] Revenue reports show 105,000 for it. (Accrual summary and revenue-by-customer use the net subtotal; the cash-basis view is F6.)
- [x] Generating the VAT estimate for a month twice updates one obligation, not two. (Once the obligation is confirmed against the portal, regenerating is refused with 409 `obligation_confirmed`.)
- [x] Existing invoices keep their totals after migration (`0032_invoice_vat_rate`).

## Slice F3: Customer withholding tax (D-024)

1. Customer gets an optional default `withholding_tax_rate` (normally 0). Invoice gets `withholding_tax_rate`, defaulted from the customer, editable while Draft.
2. The invoice shows "Expected to receive" = total minus withholding (withholding computed on the net subtotal).
3. A receipt can carry a `withheld_amount`. Received plus withheld settles the invoice; a receipt of the expected amount closes it as Paid.
4. The withheld amount is recorded on the payment (no bank movement) and listed in a "Withholding tax credits" report by customer and month, for offsetting against income tax.
5. Rarely used today (owner, October 10, 2026); the default 0 keeps it invisible unless set.

Acceptance:
- [x] With 0 rate, receipts behave exactly as in F1.
- [x] With 1% on a 100,000 net invoice, a receipt of the total minus 1,000 plus 1,000 withheld closes it as Paid; only the received amount moves the bank balance. (Withheld tax above the invoice's expected withholding is refused: 400 `withheld_exceeds_expected`.)
- [x] The credits report lists the 1,000 (`GET /api/finance/reports/withholding-credits`, "Withholding Credits" tab; migration `0033_customer_withholding_tax`).

## Slice F4: Statutory obligations fixes (D-025 context, D-022 rules)

1. New obligations default to EGP (today USD).
2. `settle_statutory_obligation` refuses an account whose currency differs from the obligation's, posts the chosen payment type and reference, and updates balances with `recalculate_account_running_balances`.
3. The existing estimated / accrued / remitted / variance model stays unchanged.

Acceptance:
- [x] A new obligation without a currency is EGP.
- [x] An EGP obligation cannot be paid from a USD account (400 `currency_mismatch`; payment type by account kind: cash -> Cash payment, bank -> Outgoing transfer or Debit card; no migration needed).

## Slice F5: Payroll funding posting fixes (D-025)

1. Q-001 resolved: marking a run paid moves **net pay only**; employer tax and social insurance are paid separately as statutory obligations.
2. `payroll_service` journal posting: ledger rows get `source="payroll"` (today `"manual"`, which lets them be edited or deleted as hand entries); payment type follows the funding account kind (cash account: Cash; bank: Outgoing transfer); balances are updated with `recalculate_account_running_balances` (today the rows are added without recalculation).
3. Remove the hard-coded fallbacks (account `1`, category `2`, payment type `5`): posting is refused with a clear message when funding accounts are not set.
4. Each leg's currency must equal its funding account's currency; mismatch is refused.
5. Data migration: existing payroll ledger rows (reference `PAYROLL-...`) change source from `manual` to `payroll`; then recalculate the affected accounts.

Acceptance:
- [x] After marking a run paid, the funding account balance drops by the net pay immediately. (`execute_payment` posts the ledger rows when the run becomes fully paid, in the same transaction; `post-journal` stays and is idempotent. A partially paid run posts nothing until it is fully paid.)
- [x] Payroll ledger rows cannot be edited or deleted from the ledger screen (`source="payroll"`; migration `0034_payroll_ledger_source`).
- [x] Posting without funding accounts is refused, never posted to account 1 (400 `funding_account_required`; the run stays unpaid).
- [x] A USD run cannot post to an EGP funding account (400 `currency_mismatch`).

## Slice F6: Cash-basis reports fixed; accrual marked partial (D-026)

1. Cash basis is the main P&L view.
2. Reversal entries (`bill_payment_reversal`, `cheque_reversal`, `payment_reversal`) reduce the side of the entry they reverse; they are never counted as revenue or as new spend.
3. Movements between own accounts are excluded from revenue and spend: transfers, FX exchange, teller withdrawals and cash-withdrawal cheques (both legs).
4. Payroll (`source="payroll"`) and statutory payments count as spend.
5. "All currencies" no longer adds USD and EGP: the report shows one column per currency side by side, with no converted total (USD-equivalent reporting stays skipped by owner).
6. The accrual view is labelled "Partial: excludes payroll, statutory and bank fees" until a later slice completes it.

Acceptance:
- [ ] Reversing a 1,000 bill payment leaves revenue unchanged and reduces spend by 1,000.
- [ ] A 5,000 teller withdrawal changes neither revenue nor spend.
- [ ] Payroll net pay appears in spend.
- [ ] "All currencies" shows separate USD and EGP figures.

## Order and delivery

F1 → F2 → F3 (F3 needs F2's invoice totals), F4 and F5 independent, F6 last (needs F1, F5). One slice per session, plan shown and approved before code, draft PR into `main`, as in the bill workflow handoff.

## Deferred

- Complete accrual P&L (payroll, statutory, bank fees).
- Balance check for non-bill outflows (from doc 18).
- VAT on bills (input VAT) and VAT netting.
- Q-002 for annual income tax (VAT estimates are covered by F2's on-demand action).
