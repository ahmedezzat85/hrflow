# Bank Accounts, Ledger & Cheques — Phased Implementation Plan

Status: Planned (Revision 2 — informed by real cash book and revenue sheets)
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

## Revision Note

This plan was revised after reviewing the actual `VOYANCE-CASH-BOOK-2026.xlsx`
and `VOYANCE-REVENUE-2026.xlsx` workbooks the business currently maintains.
The real sheets confirmed several design decisions (controlled vocabularies
for accounts/payment types, per-transaction FX rate capture, a formal cheque
register) and exposed structural pain points worth deliberately fixing rather
than replicating: monthly-tab storage that breaks continuous running
balances, hardcoded/inconsistent category lists, duplicate mini-ledgers for
recurring spend, and free-text references instead of structured links. See
`04-bank-accounts-ledger-backlog.md` for the full "what we kept / what we
fixed / what we added" rationale. Every phase below reflects the revised
design.

---

## Phase 0 — Extensible Lookups: Categories & Payment Types

**Goal:** Before any transaction can be entered, categories and payment
types must exist as user-managed, extensible lists — not hardcoded enums —
since the user explicitly needs to add/remove/rename them over time without
breaking historical data.

**Backend**
- Add `TransactionCategory` table: `name`, `kind` (`revenue` | `cost` |
  `transfer` | `other`, for reporting grouping only — does not restrict
  which accounts can use it), `is_active`, `sort_order`, `is_petty` (bool,
  replaces the spreadsheet's duplicate "Transportation mini-ledger" pattern
  — flags categories that should support a compact recurring-entry view).
- Add `PaymentType` table: `name`, `code` (stable machine key, e.g.
  `CHK`, `CASHWITHDRAW`, `INTTRANS`, `USDTOEGP`, `BANK_FEES`, `CASH`,
  `DEBIT_CARD`, `OTHER`), `requires_cheque_number` (bool), `requires_bank_fee_flag`
  (bool), `is_active`.
- Seed both tables on migration with the business's current real taxonomy
  (Salaries, Medical Insurance, Kitchen Supplies, Legal & Accountant,
  Internet, Landline, Events, Transportation, Robot/R&D Equipment, Taxes,
  Social Insurance, Rent, Computers, Bank Fees, Electricity, Other; and
  payment types CASH, CASHWITHDRAW, CHK, INTTRANS, INBOUND_TRANS,
  OUTBOUND_TRANS, USDTOEGP, DEBIT_CARD, BANK-FEES) — but every seeded row is
  just a normal editable row, not a fixed enum.
- `GET/POST/PATCH /api/finance/categories`, `GET/POST/PATCH
  /api/finance/payment-types` — full CRUD except hard delete; deactivation
  only, so historical transactions referencing a deactivated category/type
  still render correctly.

**Frontend**
- Settings screen (Finance → Settings, or extend existing subscriptions
  settings area): manage categories and payment types — add, rename,
  reorder, deactivate/reactivate. Deactivated items show a "Deactivated"
  badge and are hidden from new-entry dropdowns but remain visible on old
  records.

**Verification**
- Add a new category and confirm it's immediately usable in transaction
  entry without a deploy.
- Deactivate a category with existing transactions; confirm those
  transactions still display the category name correctly, and the category
  no longer appears in the "Add Transaction" dropdown.
- Rename a category; confirm historical transactions show the new name
  (categories are referenced by ID, not by stored string).

---

## Phase 1 — Schema Foundation: Continuous Ledger & Extended Accounts

**Goal:** Introduce one continuous transaction ledger per account (not
month-siloed) as the single source of truth for balances.

**Backend**
- Extend `FinanceAccount`: add `account_type` (`bank` | `cash`), `country`,
  `bank_name` (nullable for cash accounts).
- Add `LedgerTransaction` table: `account_id`, `date`, `amount`, `currency`
  (native currency of the transaction, matches the account's currency),
  `direction` (`in`/`out`), `category_id` (FK to `TransactionCategory`),
  `payment_type_id` (FK to `PaymentType`), `description`, `reference`
  (free-text, e.g. invoice numbers, generic notes — distinct from
  `cheque_number` added in Phase 5), `fx_rate` (nullable — the rate applied
  that day, matching the spreadsheet's per-row `Rate` column), `source`
  (`manual` | `invoice_payment` | `bill_payment` | `transfer` | `cheque` |
  `subscription_charge` | `statement_import`), `linked_invoice_id`,
  `linked_bill_id`, `running_balance`, `created_at`, `created_by`.
- Balance-recomputation service: given an account and a date, balance =
  opening_balance + signed sum of transactions up to that date. Store
  `current_balance` on `FinanceAccount` as a cached value, recomputed on
  every write, for fast reads.
- Reporting helper: given any transaction and a target currency, compute
  its equivalent value using `fx_rate` if present, so dual-currency views
  (like the spreadsheet's EGP_EQV/USD_EQV columns) are derived on read,
  never stored redundantly.
- Migration: backfill existing invoice/bill payment records into
  `LedgerTransaction` rows so historical data flows into the new model with
  no gaps.

**Frontend**
- No new screens yet beyond Phase 0's settings. Existing account list/
  detail views unaffected.

**Verification**
- Unit tests: manual transaction creation updates `current_balance`
  correctly for both directions and both currencies.
- Migration test: backfilled ledger totals exactly match prior
  `current_balance` values.
- No regression in existing invoice/bill payment flows.

---

## Phase 2 — Manual Transaction Entry & Petty/Recurring View

**Goal:** Replace the spreadsheet's row-by-row entry (and its duplicate
mini-ledger workaround for recurring petty spend) with a single, flexible
transaction form and a dedicated recurring-spend view.

**Backend**
- `POST /api/finance/accounts/{id}/transactions` — create manual
  `LedgerTransaction`, referencing `category_id` and `payment_type_id`.
- `GET /api/finance/accounts/{id}/transactions` — filters: `date_from`,
  `date_to`, `category_id`, `payment_type_id`, `direction`, `is_petty`
  (via joined category flag).
- `PATCH /api/finance/transactions/{id}` — edit (manual-source only).
- `DELETE /api/finance/transactions/{id}` — void, recomputes balance.
- `GET /api/finance/accounts/{id}/transactions/petty-summary` — rollup view
  for categories flagged `is_petty` (e.g. Transportation), giving a compact
  running list + period total without needing a parallel ledger, directly
  addressing the duplicate-mini-ledger pattern seen in the real sheets.

**Frontend**
- "Add Transaction" modal: date, amount, currency (defaults to account
  currency), direction, category dropdown (from Phase 0's managed list),
  payment type dropdown, fx_rate (optional, auto-suggested from last entry
  that day if available), reference, description.
- Transaction list on account detail view with running balance column,
  filters, and a toggle to show only petty/recurring categories in a
  condensed view.

**Verification**
- Create/edit/delete a manual transaction; confirm balance and equivalent-
  currency display update correctly.
- Filter by petty category (e.g. Transportation); confirm the condensed
  view matches a manual sum of those entries.
- Attempt to edit a non-manual transaction via API directly; confirm
  rejected.

---

## Phase 3 — Account Transfers (Including FX & Internal Moves)

**Goal:** Support same-bank FX conversion, internal transfers between the
business's own accounts, and cross-institution transfers — covering the
`USDTOEGP` and `INTTRANS` patterns seen in real usage.

**Backend**
- Add `AccountTransfer` table: `from_account_id`, `to_account_id`, `date`,
  `from_amount`, `from_currency`, `to_amount`, `to_currency`, `fx_rate`
  (nullable if same currency), `transfer_type` (`same_bank_fx` |
  `internal` | `external_linked`), `exchange_reference` (nullable, links
  two independently-recorded legs when the conversion happens outside any
  single bank operation), `note`.
- `POST /api/finance/transfers` — same-bank FX or internal transfer creates
  both `LedgerTransaction` legs atomically. External-linked transfers
  create only the confirmed leg, sharing `exchange_reference` for later
  pairing.
- `GET /api/finance/transfers` — list with filters.

**Frontend**
- "Record Transfer" modal: from-account, to-account, date, from-amount,
  fx_rate (auto-computes to-amount, editable), transfer type selector, note.
- External-linked transfers show a clear "this creates one leg — record the
  paired leg separately" hint with the shared reference displayed for
  manual lookup.
- Transfers history view, filterable by account/date/type.

**Verification**
- Same-bank FX transfer (mirroring `USDTOEGP` rows): both balances update,
  rate stored and displayed correctly.
- Internal transfer (mirroring `INTTRANS` rows) between two owned accounts:
  both legs post correctly with no FX involved.
- External-linked transfer: only the confirmed leg posts; shared reference
  allows finding the paired transaction.

---

## Phase 4 — Invoice Bank Routing & Revenue Channel

**Goal:** Classify expected revenue by destination account and channel at
invoice creation, including the cross-border "transfer from US entity"
pattern seen in the real revenue sheet.

**Backend**
- Add `expected_bank_account_id` (nullable FK) and `revenue_channel`
  (`local_egp` | `overseas_usd` | `cash` | `intercompany_transfer_us` |
  `other` — the extra `intercompany_transfer_us` value directly reflects
  the real "TRANSFERS FROM US" pattern rather than forcing it into a
  generic bucket) on the invoice model.
- Payment recording flags a discrepancy (non-blocking) if actual account
  differs from expected.

**Frontend**
- "Expected Bank Account" and "Revenue Channel" fields added to the invoice
  modal, using the same accounts dropdown pattern as the payment modal.
- Discrepancy badge on invoice list when actual ≠ expected.

**Verification**
- Create invoice with expected account/channel; confirm persistence and
  display on edit.
- Record payment to a different account; confirm non-blocking flag.

---

## Phase 5 — Cheque & Teller Withdrawal Module

**Goal:** Full lifecycle for both cheque-based and direct teller
withdrawals, since the real sheets show these as two distinct payment
types (`CHK` vs `CASHWITHDRAW`), both commonly funding the cash account.

**Backend**
- Add `Cheque` table: `cheque_number` (required, validated unique per
  account), `account_id`, `issue_date`, `amount`, `currency` (EGP or USD,
  matching real usage — cheques appear in both), `payee`, `purpose_type`
  (`vendor_payment` | `cash_withdrawal` | `other`),
  `destination_cash_account_id` (required when `cash_withdrawal`),
  `linked_bill_id` (optional), `status` (`issued` | `cleared` | `bounced` |
  `voided`), `clear_date`, `fiscal_year`, `linked_transaction_id`.
- `POST /api/finance/cheques` — always creates one bank outflow leg; if
  `cash_withdrawal`, also creates the matching cash inflow leg, tagged
  `source=cheque` and linked back.
- Direct teller withdrawals (payment type `CASHWITHDRAW`, no cheque number)
  are handled as a manual transaction (Phase 2) with `payment_type=CASHWITHDRAW`
  and an optional `destination_cash_account_id` on the transaction itself —
  reusing the same auto-funding logic as cheques without requiring a
  cheque number, matching real usage where not every withdrawal is by cheque.
- `PATCH /api/finance/cheques/{id}/status` — cleared/bounced/voided, with
  ledger reversal on bounce/void.
- `GET /api/finance/cheques` — filter by `fiscal_year`, `status`,
  `account_id`, `payee`.

**Frontend**
- "Issue Cheque" modal: account, cheque number, date, amount, currency,
  payee, purpose type (conditional destination-cash field), optional bill
  link.
- "Withdraw Cash" quick action (non-cheque path) on account detail view,
  reusing the same destination-cash-account auto-funding logic.
- Cheque register table: number, date, payee, amount, currency, status,
  clear date, with status-change actions and fiscal-year filter (default
  current year).

**Verification**
- Issue a vendor-payment cheque linked to a bill; bill marked paid, single
  ledger outflow created.
- Issue a cash-withdrawal cheque; both bank outflow and cash inflow created
  and linked.
- Record a direct teller withdrawal (no cheque number) funding cash;
  confirm identical linking behavior without requiring a cheque number.
- Bounce a cheque; both legs reverse correctly.

---

## Phase 6 — Subscription Charges & Finance Attachments

**Goal:** Track recurring/variable subscription costs with supporting
files, independent of Document Hub, matching the business's description
of paying for cloud/SaaS tools via a card on the US account it can't see
statements for directly.

**Backend**
- Add `SubscriptionCharge` table: `subscription_id`, `billing_date`,
  `amount`, `currency`, `linked_transaction_id`, `note`.
- Add `FinanceAttachment` table: polymorphic file reference
  (`subscription_charge_id` | `bank_statement_import_id` |
  `ledger_transaction_id` — exactly one set), `file_name`, `storage_ref`,
  `uploaded_at`, `uploaded_by`. Own storage namespace, distinct from
  Document Hub.
- `POST /api/finance/subscriptions/{id}/charges` — logs a charge, optional
  linked transaction, accepts file upload.
- `GET /api/finance/subscriptions/{id}/charges` — history per subscription.

**Frontend**
- "Log Charge" action per subscription row: amount (pre-filled from last
  charge if fixed-price, blank if usage-based like cloud hosting), billing
  date, file upload.
- Subscription detail/history view with attachment download links.

**Verification**
- Log a charge with attachment; ledger transaction created, file
  retrievable.
- Log a usage-based charge with a different amount than last cycle; no
  validation blocks the change.
- Confirm attachments are not accessible via Document Hub UI.

---

## Phase 7 — Bank Statement Import (CSV First, PDF Best-Effort)

**Goal:** Ingest monthly bank statements and support review-driven
reconciliation, matching the business's actual month-end process of
truing up the cash book against official statements.

**Backend**
- Add `BankStatementImport` table: `account_id`, `period_month`,
  `file_type` (`csv` | `pdf`), `status` (`parsing` | `needs_review` |
  `reconciled`), `uploaded_file_ref`.
- Add `StatementLine` table: `import_id`, `raw_date`, `raw_amount`,
  `raw_description`, `matched_transaction_id`, `status` (`unmatched` |
  `matched` | `created` | `ignored`).
- CSV parser with a one-time column-mapping step per account/bank format.
- PDF parser: best-effort extraction, always landing in `needs_review` —
  never auto-confirmed.
- `POST /api/finance/accounts/{id}/statements` — upload + parse.
- `GET /api/finance/statements/{id}/lines` — parsed lines with suggested
  matches (date+amount proximity), including matching against issued
  cheques so confirming a match can flip cheque status to `cleared`.
- `POST /api/finance/statements/{id}/lines/{line_id}/resolve` — confirm
  match, create transaction, or ignore.
- `POST /api/finance/statements/{id}/reconcile` — closes the import.

**Frontend**
- "Upload Statement" action per account, with file type selection and
  (CSV) column mapping.
- Review screen: bank lines vs. suggested/matched app transactions, with
  per-line resolve actions.
- Import history per account showing reconciliation status per period.

**Verification**
- CSV upload with known layout: correct parsing and match suggestions.
- PDF upload: lands in `needs_review`, nothing posts until resolved.
- Full reconciliation locks the period (or requires explicit reopen).
- Matched line against an issued cheque flips it to `cleared` with correct
  date.

---

## Phase 8 — Reporting Engine & Excel Export

**Goal:** Arbitrary-range reporting, point-in-time balances, and the
specific rollup views the business already relies on monthly and
annually — but generated on demand for any range, not siloed by
calendar-month tabs.

**Backend**
- `GET /api/finance/reports/transactions` — filters: `date_from`,
  `date_to`, `account_id[]`, `currency`, `category_id[]`,
  `payment_type_id[]`, `revenue_channel`; returns transaction rows plus
  subtotals.
- `GET /api/finance/reports/category-summary` — category × currency rollup
  with computed cross-currency equivalents, for any date range (replaces
  the spreadsheet's fixed monthly SPENT block).
- `GET /api/finance/reports/category-by-period-matrix` — category ×
  month/quarter/year matrix with percentage-of-total column (replaces the
  annual "2026" sheet's matrix, but works for any period grouping and any
  date range).
- `GET /api/finance/reports/balances` — point-in-time balance per account,
  rolled up by currency and country.
- `GET /api/finance/reports/cheques` — cheque register for a fiscal year,
  with summary totals.
- Excel export for all of the above (`?format=xlsx`), styled to match the
  clarity of the current cash book (frozen header row, summary sheet +
  detail sheet, dual-currency columns where relevant).

**Frontend**
- Reports section: date-range picker, account/currency/category/payment-
  type filters, export button per report type.
- Category rollup view mirroring the familiar SPENT-block layout, but
  range-selectable instead of fixed to a calendar month.
- Point-in-time balance widget.
- Cheque register report with fiscal-year selector and export.

**Verification**
- Category-summary report for a known range matches manual calculation
  against seeded data mirroring real transaction patterns.
- Category-by-period matrix reproduces the same shape as the real annual
  sheet for a full year of seeded data.
- Excel export opens correctly with expected sheets/columns/subtotals.
- Point-in-time balance for a past date excludes later transactions.
- Cheque register export for a prior fiscal year has correct boundaries.

---

## Cross-Cutting Notes

- **No breaking changes to existing invoice/bill flows**: all new fields
  additive/nullable.
- **Every phase ships its own backend tests**, following the existing
  `be/tests/test_finance_bills.py` pattern.
- **Currency handling**: every transaction stores its native currency;
  cross-currency views are always computed at read time from stored
  `fx_rate`, never duplicated as stored columns (unlike the spreadsheet's
  EGP_EQV/USD_EQV columns, which this design keeps ephemeral/computed).
- **Categories and payment types are data, not code**: Phase 0 must ship
  first since every later phase depends on referencing them by ID.
- **Fiscal year boundary**: confirm with finance owner whether fiscal year
  = calendar year before Phase 5 ships the cheque register (currently
  assumed Jan 1–Dec 31 pending confirmation).
