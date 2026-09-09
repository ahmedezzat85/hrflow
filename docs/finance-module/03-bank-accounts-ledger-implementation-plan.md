# Bank Accounts, Ledger & Cheques — Phased Implementation Plan

Status: Planned
Owner: Finance module
Related: `docs/finance-module/01-implementation-plan.md`, `docs/finance-module/02-project-description.md`
Companion doc: `docs/finance-module/04-bank-accounts-ledger-backlog.md` (feature backlog / requirements)

## Purpose

This document breaks the multi-currency bank account, ledger, transfer, cheque,
subscription-cost, and bank-statement-reconciliation feature set into small,
independently verifiable increments. Each phase should be shippable and
testable on its own, following the same delivery pattern used for the
Sales Invoices and Vendor Bills phases already implemented on
`feature/finance-baseline`.

Every phase lists: scope, backend changes, frontend changes, and a
verification checklist. Phases are ordered so that later phases only depend
on earlier ones, never the reverse.

---

## Phase 1 — Schema Foundation: Ledger & Extended Accounts

**Goal:** Introduce the transaction ledger as the single source of truth for
account balances, without changing any existing user-facing behavior yet.

**Backend**
- Extend `FinanceAccount`: add `account_type` (`bank` | `cash`), `country`.
- Add `LedgerTransaction` table: `account_id`, `date`, `amount`, `direction`
  (`in`/`out`), `currency`, `category`, `description`, `source`
  (`manual` | `invoice_payment` | `bill_payment` | `transfer` | `cheque` |
  `subscription_charge` | `statement_import`), `linked_invoice_id`,
  `linked_bill_id`, `running_balance`, `created_at`, `created_by`.
- Migration script to backfill: for every existing invoice payment and bill
  payment record, create one corresponding `LedgerTransaction` row so
  historical data is preserved in the new model.
- Add a balance-recomputation service function: given an account and a date,
  compute balance as opening_balance + signed sum of transactions up to
  that date. Do not remove `current_balance` on `FinanceAccount` yet — keep
  it as a cached/denormalized value updated on every new transaction, for
  fast reads.

**Frontend**
- No new screens yet. Existing account list/detail views unaffected.

**Verification**
- Unit tests: creating a manual `LedgerTransaction` updates `current_balance`
  correctly for both `in` and `out` directions.
- Migration test: run backfill against seeded invoice/bill payment data and
  confirm ledger totals match prior `current_balance` values exactly.
- No regression in existing invoice/bill payment flows (existing tests in
  `be/tests/test_finance_bills.py` and invoice equivalents still pass).

---

## Phase 2 — Manual Transaction Entry

**Goal:** Let a user record any transaction directly against an account —
the first real replacement for ad-hoc Excel rows.

**Backend**
- `POST /api/finance/accounts/{id}/transactions` — create manual
  `LedgerTransaction`.
- `GET /api/finance/accounts/{id}/transactions` — list with filters:
  `date_from`, `date_to`, `category`, `direction`.
- `PATCH /api/finance/transactions/{id}` — edit a manual transaction
  (only allowed when `source = manual`; system-generated transactions from
  invoices/bills/transfers/cheques are edited via their originating entity).
- `DELETE /api/finance/transactions/{id}` — soft-delete/void a manual
  transaction, recomputing `current_balance`.

**Frontend**
- "Add Transaction" modal on the account detail view: date, amount,
  direction, category dropdown (revenue / cost / withdrawal / other),
  description.
- Transaction list table on account detail view, sortable by date, with
  running balance column.
- Edit/delete actions restricted to manual-source rows in the UI (system
  rows show as read-only with a "view source" link once later phases add
  linking).

**Verification**
- Create, edit, delete a manual transaction; confirm balance updates and
  running-balance column recalculates for subsequent rows.
- Filter list by date range and category; confirm correct subset returned.
- Attempt to edit a non-manual transaction via API directly; confirm
  rejected with a clear error.

---

## Phase 3 — Account Transfers (Including FX)

**Goal:** Support moving money between accounts, including USD→EGP
conversions, as a single tracked action producing correctly linked ledger
entries.

**Backend**
- Add `AccountTransfer` table: `from_account_id`, `to_account_id`, `date`,
  `from_amount`, `to_amount`, `conversion_rate` (nullable if same currency),
  `same_bank` (bool), `exchange_reference` (nullable, for cross-institution
  linkage), `note`.
- `POST /api/finance/transfers` — creates one or two `LedgerTransaction`
  rows depending on whether it's a same-bank same-transfer or a two-step
  external exchange (see business rule below).
- Business rule: if `same_bank=true`, create both legs atomically in one
  transaction (debit from-account, credit to-account, using
  `conversion_rate` to compute `to_amount`). If `same_bank=false`, still
  create the record but only auto-generate the leg(s) the user confirms
  (supports the "withdraw USD, exchange separately, deposit EGP later"
  real-world flow as two related-but-separate actions sharing
  `exchange_reference`).
- `GET /api/finance/transfers` — list with filters.

**Frontend**
- "Record Transfer" modal: from-account, to-account, date, from-amount,
  conversion rate (auto-computes to-amount, editable), same-bank toggle,
  note.
- When `same_bank=false`, UI clarifies that this creates a single leg now
  and prompts creating the paired leg separately (with a shared reference
  shown for manual linking).
- Transfers list/history view, filterable by account and date range.

**Verification**
- Same-bank transfer: confirm both accounts' balances update correctly and
  the conversion rate is stored and displayed.
- Cross-institution transfer: confirm only the confirmed leg posts, and the
  `exchange_reference` allows finding the paired transaction later.
- Reverse/void a transfer (if within same accounting period) and confirm
  both legs are reversed consistently.

---

## Phase 4 — Invoice Bank Routing & Revenue Channel

**Goal:** Classify expected revenue by destination account and channel at
invoice creation time.

**Backend**
- Add `expected_bank_account_id` (nullable FK to `FinanceAccount`) and
  `revenue_channel` (`local_egp` | `overseas_usd` | `cash` | `other`) to the
  invoice model.
- Update invoice create/update endpoints to accept and validate these
  fields.
- When an invoice payment is recorded, if `bank_account_id` on the payment
  differs from `expected_bank_account_id`, allow it (real life varies) but
  flag the discrepancy in the response for UI display.

**Frontend**
- Add "Expected Bank Account" and "Revenue Channel" fields to the invoice
  modal (`fe/src/partials/modals/invoice-modal.html`), populated from the
  existing accounts dropdown pattern already used in the payment modal.
- Show a small badge/icon on the invoice list when actual payment account
  differs from expected.

**Verification**
- Create invoice with expected account/channel set; confirm both persist
  and display correctly on edit.
- Record a payment to a different account than expected; confirm the
  discrepancy flag appears without blocking the payment.

---

## Phase 5 — Cheque Module

**Goal:** Full cheque lifecycle: issue, track, clear/bounce/void, with
automatic cash-account funding when applicable.

**Backend**
- Add `Cheque` table: `cheque_number`, `account_id`, `issue_date`, `amount`,
  `currency`, `payee`, `purpose_type` (`vendor_payment` | `cash_withdrawal` |
  `other`), `destination_cash_account_id` (required when
  `purpose_type=cash_withdrawal`), `linked_bill_id` (optional),
  `status` (`issued` | `cleared` | `bounced` | `voided`), `clear_date`,
  `fiscal_year` (derived from `issue_date`, stored for indexed queries),
  `linked_transaction_id`.
- `POST /api/finance/cheques` — issuing a cheque:
  - Always creates one outflow `LedgerTransaction` on `account_id`.
  - If `purpose_type=cash_withdrawal`, also creates a same-day inflow
    `LedgerTransaction` on `destination_cash_account_id`, tagged
    `source=cheque` and linked back to the cheque.
  - If `linked_bill_id` set, marks that bill as paid via cheque.
- `PATCH /api/finance/cheques/{id}/status` — transition to `cleared`
  (sets `clear_date`), `bounced` (reverses both ledger legs), or `voided`
  (reverses both ledger legs, no clear date).
- `GET /api/finance/cheques` — filter by `fiscal_year`, `status`,
  `account_id`, `payee` search.

**Frontend**
- "Issue Cheque" modal: account, cheque number, date, amount, payee,
  purpose type (with conditional destination-cash-account field), optional
  bill link.
- Cheque register table: number, date, payee, amount, status, clear date,
  with status-change actions (Mark Cleared / Bounced / Voided).
- Filter by fiscal year (default current year) and status.

**Verification**
- Issue a vendor-payment cheque linked to a bill; confirm bill marked paid
  and single ledger outflow created.
- Issue a cash-withdrawal cheque; confirm both bank outflow and cash inflow
  transactions are created and linked.
- Mark a cheque bounced; confirm both ledger legs reverse and balances
  return to pre-cheque state.
- Filter cheque register by fiscal year; confirm correct year boundary
  handling (Jan 1–Dec 31 or configured fiscal year start).

---

## Phase 6 — Subscription Charges & Finance Attachments

**Goal:** Track recurring/variable subscription costs with supporting
invoice/receipt files, independent of Document Hub.

**Backend**
- Add `SubscriptionCharge` table: `subscription_id`, `billing_date`,
  `amount`, `currency`, `linked_transaction_id`, `note`.
- Add `FinanceAttachment` table: generic file reference with polymorphic
  link (`subscription_charge_id` | `bank_statement_import_id` |
  `ledger_transaction_id` — exactly one set), `file_name`, `storage_ref`,
  `uploaded_at`, `uploaded_by`.
- Reuse existing storage backend (`be/storage.py` / `drive_client.py`
  patterns) but a distinct storage namespace/bucket path from Document Hub
  documents.
- `POST /api/finance/subscriptions/{id}/charges` — logs a charge, optionally
  creates the linked `LedgerTransaction` on the subscription's associated
  account, accepts a file upload for the attachment.
- `GET /api/finance/subscriptions/{id}/charges` — history per subscription.

**Frontend**
- Extend the existing Subscriptions section: "Log Charge" action per
  subscription row — amount (pre-filled from last charge if fixed-price,
  blank if usage-based), billing date, file upload for the invoice/receipt.
- Subscription detail/history view showing all past charges with
  attachment download links.

**Verification**
- Log a charge with a fixed amount and an attachment; confirm ledger
  transaction created and file retrievable.
- Log a usage-based charge with a different amount than last cycle; confirm
  no validation blocks the change.
- Confirm attachments are not visible/accessible via the Document Hub UI
  (separate storage namespace).

---

## Phase 7 — Bank Statement Import (CSV First, PDF Best-Effort)

**Goal:** Ingest monthly bank statements and support review-driven
reconciliation, without ever auto-posting unreviewed data.

**Backend**
- Add `BankStatementImport` table: `account_id`, `period_month`,
  `file_type` (`csv` | `pdf`), `status` (`parsing` | `needs_review` |
  `reconciled`), `uploaded_file_ref`.
- Add `StatementLine` table: `import_id`, `raw_date`, `raw_amount`,
  `raw_description`, `matched_transaction_id`, `status` (`unmatched` |
  `matched` | `created` | `ignored`).
- CSV parser: column-mapping step (user maps date/amount/description
  columns once per bank format, remembered per account for next time).
- PDF parser: best-effort text/table extraction producing draft
  `StatementLine` rows, always landing in `needs_review` status — never
  auto-confirmed.
- `POST /api/finance/accounts/{id}/statements` — upload + parse.
- `GET /api/finance/statements/{id}/lines` — list parsed lines with
  suggested matches (by date+amount proximity against existing
  `LedgerTransaction` rows on that account, including cheque outflows so
  cheque clearing can be confirmed here too).
- `POST /api/finance/statements/{id}/lines/{line_id}/resolve` — confirm
  match (optionally flips a matched cheque to `cleared`), create new
  transaction from line, or mark ignored.
- `POST /api/finance/statements/{id}/reconcile` — closes the import once
  all lines resolved.

**Frontend**
- "Upload Statement" action on account detail view, with file type
  selection and (for CSV) a one-time column mapping step.
- Review screen: two columns — bank statement lines vs. suggested/matched
  app transactions — with per-line actions (Confirm Match / Create
  Transaction / Ignore).
- Import history list per account showing reconciliation status per month.

**Verification**
- Upload a CSV with known column layout; confirm correct parsing and
  auto-match suggestions for a set of seeded transactions.
- Upload a PDF; confirm it lands in `needs_review` with draft lines and
  nothing posts until manually resolved.
- Fully resolve an import and mark reconciled; confirm status locks further
  edits to that period's matched transactions (or requires an explicit
  reopen action).
- Confirm a matched line against an issued cheque flips its status to
  `cleared` with the correct `clear_date`.

---

## Phase 8 — Reporting Engine & Excel Export

**Goal:** Arbitrary-range reporting and point-in-time balances, replacing
the manual Excel reporting workflow.

**Backend**
- `GET /api/finance/reports/transactions` — filters: `date_from`, `date_to`,
  `account_id[]`, `currency`, `category`, `revenue_channel`; returns
  transaction-level rows plus subtotals.
- `GET /api/finance/reports/balances` — point-in-time balance per account
  (and rolled up by currency and country) as of a given date.
- `GET /api/finance/reports/cheques` — cheque register for a given fiscal
  year, with summary totals by status.
- Excel export variants of all three above (`?format=xlsx`), using a
  shared export utility (styled header row, frozen pane, summary sheet +
  detail sheet).

**Frontend**
- Reports section (new or extending Finance Dashboard): date-range picker,
  account/currency/category filters, "Export to Excel" button per report
  type.
- Point-in-time balance widget: pick a date, see balance per account and
  rolled-up totals by currency at that moment.
- Cheque register report screen with fiscal-year selector and export.

**Verification**
- Generate a transaction report for a known date range against seeded data;
  confirm totals match manual calculation.
- Export to Excel; confirm file opens correctly with expected sheets/
  columns and correct subtotals.
- Query point-in-time balance for a past date; confirm it matches the
  balance that existed at that time (i.e., excludes later transactions).
- Export cheque register for a prior fiscal year; confirm year boundaries
  and summary totals are correct.

---

## Cross-Cutting Notes

- **No breaking changes to existing invoice/bill flows**: all new fields
  are additive/nullable; Phase 1's backfill must not alter any currently
  displayed balance.
- **Every phase ships with its own backend tests**, following the existing
  `be/tests/test_finance_bills.py` pattern (one test file per new router/
  feature area).
- **Currency handling**: all amounts stored with an explicit `currency`
  field on every transaction row; no implicit conversion happens outside
  the Transfer entity's `conversion_rate`.
- **Fiscal year boundary**: confirm with finance owner whether fiscal year
  = calendar year before Phase 5 ships the cheque register (currently
  assumed Jan 1–Dec 31 pending confirmation).
