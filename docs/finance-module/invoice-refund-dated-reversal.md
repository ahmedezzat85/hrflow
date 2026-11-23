# Invoice refund: dated reversal of a customer receipt (INV-REFUND-1)

Status: built on `feature/invoice-refund-dated-reversal`, awaiting owner review. Decision D-061 (proposed), open question Q-028.

## Why

A customer paid an invoice and the company later sent the money back. Real case: Edusoft invoice 25060002, USD 11,168 received into Voyance Main Account (Arab Bank USD) on 2025-01-22, refunded USD 11,200 on 2025-05-13. The reverse action used to date the reversing ledger row with the day of the click, so a refund recorded months later reduced the account, and cash-basis revenue, in the wrong month.

## How it works

- The reverse action on a receipt takes an optional `reversal_date` (default today) and `reversal_kind` (`refund` or `correction`, default `correction`).
- The reversing ledger row (source `payment_reversal`, direction out, same account and currency, amount equal to the receipt, category Revenue) is dated `reversal_date`. Its description is `Refund of payment #<id>: <reason>` for a refund and `Reversal of payment #<id>: <reason>` for a correction (the wording used before this change).
- `finance_payments` gains `reversal_date` (`YYYY-MM-DD`) and `reversal_kind`. `reversed_at` stays the timestamp of the action; `reversal_date` is the accounting date. Migration 0080 backfills reversed payments with the date part of `reversed_at` and kind `correction`.
- Rules, in order, each refused with a code and nothing written: `reversal_date_invalid` (400), `reversal_date_future` (400), `reversal_date_before_receipt` (400), `period_closed` (409, the closed-reconciliation-month lock of the receiving account, also for a default-today reversal), then the existing refusals (already reversed, settled commission, invalid transition), then `reversal_kind_invalid` (400).
- Running balances are recomputed so the back-dated row lands in date order. Withheld tax on the receipt (D-024) has no bank movement and posts no row.
- One activity entry `invoice.payment_reversed` records the payment, kind, date, ledger row and reason.
- After the only receipt is reversed the invoice is Sent again and the existing void applies. A void keeps the action timestamp.

## API

`POST /api/finance/invoices/{invoice_id}/payments/{payment_id}/reverse?reason=...&reversal_date=YYYY-MM-DD&kind=refund|correction`. Permission `finance.invoice.write`. Receipt responses carry `reversal_date` and `reversal_kind` (null for bill payments).

## Screen

Invoices, open an invoice, tab Related: each receipt has a Reverse button (with `finance.invoice.write`). The dialog asks for the kind, the date (not before the receipt, not in the future) and a required reason, and states the account, amount and date it will post. A reversed receipt reads "Refunded on <date>" or "Reversed on <date>" with the reason.

## Not covered

A refund amount different from the receipt (enter the difference as a separate manual transaction), a partial refund of one receipt, a different refund account, credit notes, a void date, and bill payment reversals (same pattern, later).

## Effects to expect

- Cash-basis revenue shows the receipt in its month and the reversal as a reduction in the reversal month.
- A reversal dated in an earlier fiscal year changes that year's closing balance; an opening already entered for the next year (BI-1) then shows a variance. This is expected.
- A settled sales commission still blocks the reversal; an accrued one is voided when the invoice stops being fully paid (D-059).

## Tests

`be/tests/test_finance_invoice_refund.py` (service, API, MCP listing, drawer data, BI-1, migration) and `fe/tests/ui/finance-invoice-refund.spec.js` (mock mode).
