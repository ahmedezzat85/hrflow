# Bank Accounts, Ledger & Cheques — Feature Backlog

Status: Completed (Phases 0–8 Fully Implemented & Tested)
Owner: Finance module
Related: `docs/finance-module/02-project-description.md`
Companion doc: `docs/finance-module/03-bank-accounts-ledger-implementation-plan.md`
(engineering phased delivery plan)

## Purpose of This Document

This is the durable, business-readable requirements record for the bank
accounts / money-tracking side of the Finance module. It exists so that:

- Non-technical stakeholders can understand what the system does and why,
  without reading code.
- As implementation proceeds or requirements shift, this document is
  updated to reflect what changed and why — it is the history of intent,
  not just a snapshot.
- Nothing gets lost in translation between "what the business asked for"
  and "what got built" as the feature is broken into smaller technical
  tasks over time.

Structure: **Epics → Features → User Stories**. Each user story has an ID
for traceability.

---

## Background & Problem Statement

The company operates primarily from Egypt but earns revenue from both
local (Egyptian, EGP) and overseas (mostly US, USD) customers. Money sits
across several bank accounts in different countries, currencies, and
institutions, plus physical cash held at the company. Today, this is
tracked manually across Excel workbooks — a cash book with one tab per
month, and a separate revenue-tracking workbook.

Reviewing the real workbooks alongside the original requirements
conversation shaped this backlog in three ways, noted throughout: things
the spreadsheets already do well and this system should preserve, things
that are structurally limiting and this system should fix, and gaps
neither the conversation nor the spreadsheets fully covered that this
system adds as good practice.

---

## What the Real Spreadsheets Confirmed and Where This Design Improves On Them

The current cash book already enforces a controlled vocabulary for
accounts (`ARAB_BANK`, `CIB`, `NBK`, `CASH`) and payment types
(`CASHWITHDRAW`, `CHK`, `INTTRANS`, `INBOUND_TRANS`, `USDTOEGP`,
`OUTBOUND_TRANS`, `BANK-FEES`, `Debit Card`, `CASH`), records the FX rate
applied on the day of nearly every transaction, and maintains a running
cheque register by number. These habits are good practice and this system
formalizes them rather than replacing them.

At the same time, three structural issues in the spreadsheet approach are
deliberately designed out of this system:

- **Storage siloed by calendar month** — each month is its own tab with
  its own opening balance carried forward by hand. This system uses one
  continuous ledger per account; "this month's view" becomes a report
  filter, never a storage boundary, so nothing needs manual carry-forward
  and nothing breaks at year-end.
- **Categories and payment types are hardcoded and drift over time** — the
  spreadsheet shows inconsistent casing between months (`ROBOT` vs
  `Robot`) and categories that silently appear or disappear (`Rent` is
  present some months, absent others). This system makes both lists
  user-managed settings — add, rename, deactivate — addressed directly per
  your instruction that categories must be extensible without breaking
  historical data.
- **A duplicate mini-ledger exists for Transportation** in several monthly
  tabs, seemingly because petty recurring spend needed a running view
  separate from the main category rollup. This system solves that with a
  "petty/recurring" flag on any category, giving a condensed running view
  without a second parallel ledger.

---

## Epic A — Multi-Account, Multi-Currency Money Tracking

**Why:** The business holds money across several bank accounts (different
countries, banks, currencies) plus physical cash, and needs individual and
rolled-up balances at any point in time.

### Feature A1 — Extended Bank & Cash Accounts

- **A1.1** Register a bank account with country, bank name, currency, and
  account number, so accounts like an Egypt EGP account, an Egypt USD
  account, and a US USD account are each represented individually.
- **A1.2** Register a "cash" account type not tied to any bank, to track
  physical cash separately from bank balances.
- **A1.3** See the current balance of each individual account at a glance.
- **A1.4** See totals rolled up by currency and by country, so "how much
  USD do we have overall" never requires manual addition.
- **A1.5** Deactivate an account no longer in use without losing its
  history; it stays in reports but not in day-to-day entry screens.

### Feature A2 — Continuous Transaction Ledger

- **A2.1** Manually record any transaction against an account — date,
  amount, currency, direction, category, payment type, description — the
  same granularity as the current cash book, without needing a new sheet
  each month.
- **A2.2** Every invoice payment and bill payment automatically appears in
  the relevant account's transaction history — no double-entry.
- **A2.3** Edit or delete a transaction entered manually.
- **A2.4** See a running balance next to each transaction, so tracing how
  a balance was reached works the same way the cash book's running totals
  do today, but without manual month-boundary carry-forward.
- **A2.5** Know the balance of any account as of any specific past date.
- **A2.6** Optionally record the day's FX rate on any transaction (not
  just transfers), so cross-currency reporting reflects the actual rate
  used that day — matching current practice of noting a rate on almost
  every cash book row.

### Feature A3 — Extensible Categories & Payment Types

- **A3.1** Add, rename, reorder, or deactivate spending/revenue categories
  at any time, without needing a developer or breaking past records —
  directly addressing that the category list must be extensible going
  forward.
- **A3.2** Add, rename, or deactivate payment/transaction types (e.g.
  cheque, teller withdrawal, internal transfer, currency conversion, bank
  fee) the same way, mirroring the discipline already used informally in
  the current cash book's config list.
- **A3.3** See a "petty/recurring" option on any category (useful for
  things like transportation or small daily costs), giving a condensed
  running-total view for that category without needing a separate,
  duplicated tracking sheet — replacing the workaround currently used for
  transportation.

### Feature A4 — Account Transfers (Including Currency Conversion)

- **A4.1** Record a transfer of money from one account to another (e.g.
  US account to Egypt account).
- **A4.2** Record the currency conversion rate used when transferring
  between a USD and an EGP account, preserving both the converted amount
  and the rate.
- **A4.3** When the conversion happens inside a single bank (moving
  between the business's own USD and EGP accounts there), handle it as one
  linked transfer updating both balances together — matching the existing
  `USDTOEGP` pattern.
- **A4.4** Record a same-currency internal transfer between two of the
  business's own accounts (e.g. moving funds from a bank account into the
  cash-tracking side) — matching the existing `INTTRANS` pattern.
- **A4.5** When USD is received and exchanged separately (a different bank
  or an exchange office) before depositing EGP, record these as two
  connected steps sharing a reference, preserving traceability even though
  it wasn't one bank operation.
- **A4.6** See a list/history of all transfers, filterable by account,
  date, and type.

---

## Epic B — Revenue Classification & Invoice Routing

**Why:** Revenue arrives via different channels — local EGP transfer,
overseas USD transfer, occasional cash payment, and intercompany transfers
from the US entity into the Egypt entity — and needs to be tracked by
source for accurate revenue reporting.

### Feature B1 — Invoice Bank & Channel Assignment

- **B1.1** When creating a sales invoice, select which bank account
  payment is expected in, so revenue is pre-classified before it's
  received.
- **B1.2** Tag an invoice's revenue channel — local EGP, overseas USD,
  cash, or intercompany transfer from the US entity — the last option
  directly reflecting the real "transfers from US" pattern already
  present in the revenue workbook, so it doesn't get lumped into a
  generic bucket.
- **B1.3** If a payment lands in a different account than expected, see a
  flag rather than a block, since real payments don't always match the
  plan exactly.

---

## Epic C — Cheque & Teller Withdrawal Management

**Why:** Cheques and direct bank-teller withdrawals are the two primary
methods used to move money out of the Egyptian bank accounts — the real
cash book distinguishes them as separate transaction types, and both
commonly fund the physical cash balance for expenses like taxes.

### Feature C1 — Cheque Issuance & Lifecycle

- **C1.1** Record a cheque issued with its number, date, amount, currency
  (cheques may be EGP or USD denominated), and payee.
- **C1.2** Specify why a cheque was issued — paying a vendor bill
  directly, or withdrawing cash for company use — so the system knows how
  to handle the other side of the transaction.
- **C1.3** When a cheque funds a cash withdrawal, have the withdrawn
  amount automatically added to the correct cash account balance, without
  a separate manual entry.
- **C1.4** When a cheque pays a vendor bill, link it to that bill so the
  bill is marked paid and the payment method is traceable.
- **C1.5** Track a cheque's status — issued, cleared, bounced, voided —
  to know what's still outstanding against the bank.
- **C1.6** If a cheque bounces or is voided, automatically reverse whatever
  balance changes it caused.

### Feature C2 — Direct Teller Withdrawals

- **C2.1** Record a direct bank-teller cash withdrawal that has no cheque
  number attached, distinct from a cheque-based withdrawal — matching the
  real cash book's separate `CASHWITHDRAW` transaction type.
- **C2.2** Have a teller withdrawal optionally fund a cash account
  automatically, the same way a cash-withdrawal cheque does, without
  forcing every withdrawal to pretend to be a cheque.

### Feature C3 — Cheque Reporting

- **C3.1** View a register/list of all cheques issued in a given fiscal
  year.
- **C3.2** View cheque registers for previous fiscal years as well.
- **C3.3** See summary totals — count and amount of issued, cleared, and
  outstanding cheques.
- **C3.4** Export the cheque register for any fiscal year as an Excel
  sheet.

---

## Epic D — Subscription & Recurring Cost Tracking

**Why:** The company pays for numerous online services through a card tied
to the US bank account, which it cannot see statements for directly.
These costs still need accurate tracking.

### Feature D1 — Subscription Charge Logging

- **D1.1** Log a charge for a subscription service each billing cycle with
  the actual amount charged, so variable/usage-based services (like cloud
  hosting) are tracked accurately even when the amount changes.
- **D1.2** Attach the invoice or receipt file received by email for a
  subscription charge, as supporting documentation.
- **D1.3** See the history of charges for a subscription over time, to
  spot cost trends or unexpected increases.
- **D1.4** Keep subscription attachments separate from the general HR/
  company document hub, since these are private accounting records.

---

## Epic E — Bank Statement Import & Reconciliation

**Why:** The business currently reconciles its manual cash book against
official bank statements at the end of each month. This should be
supported directly, tolerating that most statements are only available as
PDF, while allowing CSV when available.

### Feature E1 — Statement Upload & Parsing

- **E1.1** Upload a bank statement file (PDF or CSV) for a specific
  account and period.
- **E1.2** When uploading a CSV statement, have the system parse it
  accurately into individual transaction rows.
- **E1.3** When uploading a PDF statement, have the system attempt
  automatic extraction, but always review and correct rows before
  anything is accepted.

### Feature E2 — Reconciliation Workflow

- **E2.1** See suggested matches between statement lines and already-
  recorded transactions, by date and amount.
- **E2.2** Confirm a suggested match, create a new transaction from an
  unmatched line, or ignore a line.
- **E2.3** When a statement line matches an issued cheque, have confirming
  that match automatically mark the cheque as cleared.
- **E2.4** Mark a period's reconciliation as complete once all lines are
  resolved, mirroring the current monthly close process.

---

## Epic F — Reporting & Data Export

**Why:** The core value of this effort is eliminating manual Excel-based
reporting, while producing output in the same familiar Excel format for
sharing, and matching the specific rollup views the business already
relies on — but for any date range, not fixed calendar-month tabs.

### Feature F1 — Flexible Transaction Reports

- **F1.1** Generate a report of all transactions within any date range —
  a day, a month, a custom range.
- **F1.2** Filter reports by account, currency, category, or payment type.
- **F1.3** Export any report to Excel.

### Feature F2 — Category & Period Rollups

- **F2.1** See a category-by-currency summary (matching the current
  monthly "SPENT" block) for any date range, not just a fixed calendar
  month.
- **F2.2** See a category-by-period matrix (matching the current annual
  category-by-month view, with percentage of total) for any period
  grouping — monthly, quarterly, or annual — and any date range.

### Feature F3 — Point-in-Time Balances

- **F3.1** Check the balance of any account, or the total balance per
  currency, as of any past date.

---

## Noted But Out of Scope for This Backlog

Two things surfaced while reviewing the real workbooks that are
deliberately not included here, to keep this backlog focused:

- **Lightweight budget-vs-actual tracking per category per month** — the
  cash book has a small ad hoc "planned cash debit vs actual" note each
  month. This is a real but distinct need (budgeting, not transaction
  tracking) worth its own future conversation.
- **Sales & commission tracking for the US-side SaaS revenue** (product
  lines, sales reps, dealers/resellers, deal types, billing frequency,
  per-rep commission and payout tracking) — the real revenue workbook
  shows this is a substantially larger subsystem than invoice bank
  routing (Epic B) covers, and deserves its own scoping discussion rather
  than being folded in here.

---

## Change Log

| Date | Change | Reason |
|---|---|---|
| 2026-09-09 | Initial backlog created (Epics A–F) | Captures full requirements discussion for bank accounts, ledger, transfers, cheques, subscriptions, statement import, and reporting |
| 2026-09-09 | Revision 2: reviewed real VOYANCE-CASH-BOOK-2026.xlsx and VOYANCE-REVENUE-2026.xlsx workbooks | Confirmed controlled-vocabulary approach for accounts/payment types; added extensible category/payment-type management (Feature A3) per explicit requirement; added petty/recurring category flag to replace duplicate mini-ledger pattern; split cheque vs. direct teller withdrawal into distinct features (C1/C2); added intercompany-transfer-from-US revenue channel; added category/period rollup reports (Feature F2) matching real monthly and annual views; noted budget-vs-actual tracking and sales/commission tracking as explicitly out of scope, flagged for future discussion |
