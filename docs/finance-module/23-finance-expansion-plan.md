# 23 — Finance Expansion: Overseas Book, Products, Revenue Sources, Subscriptions v2, Cheque Scans

**Status:** Accepted by owner, October 18, 2026. Decisions D-028 to D-032 (resolve Q-015 to Q-020). Not implemented.
**Baseline:** `main` at `67a8e65` (merge of PR #28).
**Roadmap:** section 3E of [../project-context/05-roadmap-and-next-slices.md](../project-context/05-roadmap-and-next-slices.md).

Owner requests covered: (1) cheque scans, (2) overseas company account, (3) invoices paid into the overseas account, (4) external revenue (Stripe / direct overseas), (5) product portfolio revenue, (6) external-service subscriptions with recurring reminders and settlement.

---

## 1. Baseline (verified on `main`, October 18, 2026)

| Area | What exists | Gap |
|---|---|---|
| Cheques | `finance_cheques` with lifecycle, posting policy, bill link, reversal rules (D-020); `attachment_url` column returned by the API. | No upload/download endpoint or UI for the paper cheque. |
| Attachments | `finance_attachments` with one nullable FK per owner (subscription charge, statement import, ledger transaction); `StorageClient` (local / Google Drive). | Reusable pattern. |
| Bank accounts | `finance_bank_accounts`: name, bank, currency, type `bank|cash`, country, active. | No book/scope; every account feeds every report. |
| Revenue channel | `finance_sales_invoices.revenue_channel` (`local_egp | overseas_usd | cash | intercompany_transfer_us | other`), `expected_bank_account_id`. | Free label; reports ignore it. |
| Money in without invoice | Ledger `money_in` with category. | No product, customer or source tagging. |
| Products | None; invoice lines are free text. | — |
| Payroll funding | `finance_payroll_runs.external_funding_account_id` / `internal_funding_account_id`; line `compensation_type` (`external_usd`, …). | Already sufficient for overseas salaries. |
| Subscriptions | Subscriptions, charges (log, link ledger/bill, variance, attachments), renewal attention items, forecast; page exists. | No expected charges, proof tracking, billing email, renewal advance. |
| Scheduler / email | None. | Not planned now (D-031). |
| Cash-basis P&L | D-026: own-account movements excluded; per-currency columns. | Must be respected. |

---

## 2. Books and views (D-028)

- `finance_books`: `Local` (default; all existing accounts) and `Overseas`. Required `book_id` and `visibility = full | partial` on every company account.
- Partial accounts: balance = known movements + owner-entered **balance checkpoints**; gap shown as "Unrecorded difference", never auto-adjusted. Statement CSV import usable whenever available.
- **Inter-book transfer**, recorded once (FX allowed as in existing FX transfers):

| View | Reading |
|---|---|
| Local | Income — "Income from overseas entity" |
| Overseas | Outflow — "Transferred to local entity" (not an operating expense) |
| Consolidated | Eliminated on both sides |

- Intercompany customer flag: a local invoice to the overseas entity is settled by the inter-book transfer and eliminated in Consolidated.
- View switcher `Local | Overseas | Consolidated`, remembered per user. First defaults:

| Page | Default |
|---|---|
| Dashboard, cash-basis P&L, cash flow | Local (unchanged) |
| Accounts | All accounts grouped by book |
| Revenue analytics | Consolidated |
| Spend: subscriptions, vendors, categories | Consolidated + "Paid from" book column |
| Payroll | Unaffected |

- Worked example (one month): local receipts 500k EGP; overseas client 10k USD; Stripe payout 4k USD; tools 345 USD and external salaries 3k USD paid overseas; 5k USD moved overseas → local. Local revenue = 500k EGP + 5k USD (from overseas entity). Overseas revenue = 14k USD; outflows 3,345 USD spend + 5k transferred. Consolidated revenue = 500k EGP + 14k USD; the 5k is eliminated.
- Overseas salaries: payroll run `external_funding_account_id` = overseas account; no payroll change.
- Legal/tax treatment out of scope; no converted totals.

## 3. External revenue (D-029)

- No Stripe account now. **Revenue receipt** = `money_in` ledger row with `revenue_source` (editable list: `Invoice`, `Stripe payout`, `Direct transfer`, `Cash`, `Other`), optional `product_id`, `customer_id`, period covered, memo-only gross and fees, reference, attachment.
- Future service integration: imported service revenue becomes the revenue record; bank payouts are matched to it. Earlier payout receipts remain historical.

## 4. Products (D-030)

- `finance_products`: name, code, type (`saas_subscription | license | implementation_service | support | other`), default currency/price, default receiving account, active.
- Optional `product_id` on invoice lines and revenue receipts; "untagged revenue" visible.
- Invoice book derived from expected receiving account; `revenue_channel` kept and mapped.
- Out of scope: product cost/margin, MRR/churn.

## 5. Subscriptions v2 (D-031)

- Fields: `billing_email`, `proof_source` (`email_inbox | vendor_portal | bank_only | none`), paid-from account (any book), `proof_expected`.
- Expected charges generated on demand, idempotently (button + page open); status `expected → settled | skipped`; variance.
- Settle: link existing ledger/statement row, or create "Already paid" bill via settlement service (D-020); advance `next_renewal_date`.
- Proof per charge `attached | pending | unavailable` + reason; never blocks; "proofs missing" list.
- In-app attention items: due soon, overdue settlement, missing proof. No email, no scheduler.

## 6. Cheque scans (D-032)

- `cheque_id` FK on `finance_attachments`; `/finance/cheques/{id}/attachments` upload/list/download/delete; multiple files; upload in cheque dialog (before save) and row actions; "scan missing" flag and filter; migrate `attachment_url`, deprecate column.
- Shortcuts: next cheque number per account; payee/amount/currency prefilled from linked bill.
- No extraction.

---

## 7. Slices and acceptance criteria

| # | Slice | Depends on |
|---|---|---|
| X1 | Cheque scans + shortcuts | — |
| X2 | Books, visibility, checkpoints, inter-book transfers, view switcher | — |
| X3 | Products + `product_id` on invoice lines | — |
| X4 | Revenue receipts, invoice book, revenue reports by book/product/source | X2, X3 |
| X5 | Subscriptions v2 | X2 |
| X6 | Analytics pass and Excel exports (one record per row) | X2–X5 |
| Later | Revenue-service integration with payout matching; email/scheduler feature | separate plans |

- **X1:** ≥1 scan per cheque; download respects `finance.cheque.read`; missing-scan flag/filter; existing `attachment_url` preserved; next number suggested; bill-linked cheque prefilled.
- **X2:** with no overseas data, all existing reports return identical numbers (regression on a DB snapshot); an overseas→local transfer is income in Local, outflow in Overseas, absent in Consolidated; partial account shows checkpoint difference.
- **X3/X4:** revenue grouped by product, book and source per currency; untagged revenue visible.
- **X5:** generating twice creates no duplicates; settle links exactly one ledger/bill row; missing proof flagged, not blocking; renewal advances one cycle.

## 8. Assumptions (not verified)

- Overseas account is USD.
- Overseas data entered manually or by CSV; no bank/Stripe API.
- `StorageClient` acceptable for cheque scans while Q-003 is open.
- New permissions follow existing patterns (`finance.book.read`, `finance.product.*`); grants confirmed at implementation.
