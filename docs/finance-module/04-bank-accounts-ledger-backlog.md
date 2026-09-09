# Bank Accounts, Ledger & Cheques — Feature Backlog

Status: Planned
Owner: Finance module
Related: `docs/finance-module/02-project-description.md`
Companion doc: `docs/finance-module/03-bank-accounts-ledger-implementation-plan.md`
(engineering phased delivery plan)

## Purpose of This Document

This is the durable, business-readable requirements record for the bank
accounts / money-tracking side of the Finance module. It exists so that:

- Non-technical stakeholders (management, finance owner) can understand
  what the system does and why, without reading code.
- As implementation proceeds or requirements shift, this document is
  updated to reflect what changed and why — it is the history of intent,
  not just a snapshot.
- Nothing gets lost in translation between "what the business asked for"
  and "what got built" as the feature is broken into smaller technical
  tasks over time.

Structure: **Epics → Features → User Stories**. Each user story has an ID
for traceability (e.g., referenced in commits, PRs, or future change
requests).

---

## Background & Problem Statement

The company operates primarily from Egypt but earns revenue from both
local (Egyptian, EGP) and overseas (mostly US, USD) customers. Money sits
across several bank accounts in different countries, currencies, and
institutions, plus physical cash held at the company. Today, all of this
is tracked manually across multiple Excel workbooks:

- An "Egypt Cash Book" tracking every local transaction, bill, and invoice
  as daily accounting records, manually reconciled against official bank
  statements each month.
- A separate revenue-tracking workbook covering all revenue sources,
  local and overseas.
- No systematic tracking of subscription service spending (e.g., cloud
  hosting, SaaS tools) paid via a card tied to the US account, since there
  is no direct visibility into that account's statement.

This manual process is time-consuming, error-prone, and makes it hard to
answer manager or ad-hoc reporting requests quickly. The goal of this
feature set is to bring all of this into HRFlow's Finance module as a
single system of record, while matching how the business actually
operates today (bank transfers, cheque withdrawals, cash spending, partial
visibility into the US account).

---

## Epic A — Multi-Account, Multi-Currency Money Tracking

**Why:** The business holds money across several bank accounts (different
countries, banks, currencies) plus physical cash, and needs to know
individual and rolled-up balances at any point in time, not just "now."

### Feature A1 — Extended Bank & Cash Accounts

- **A1.1** As a finance owner, I want to register a bank account with its
  country, bank name, currency, and account number, so all our accounts
  (Egypt EGP, Egypt USD, US USD) are represented individually.
- **A1.2** As a finance owner, I want to register a "cash" account type
  (not tied to a bank), so I can track physical cash held at the company
  separately from bank balances.
- **A1.3** As a finance owner, I want to see the current balance of each
  individual account at a glance, so I know exactly how much is where.
- **A1.4** As a finance owner, I want to see totals rolled up by currency
  (all EGP across accounts, all USD across accounts) and by country, so I
  can answer "how much USD do we have overall" without adding manually.
- **A1.5** As a finance owner, I want to deactivate an account we no longer
  use without losing its historical records, so old accounts stay in
  reports but don't clutter day-to-day entry screens.

### Feature A2 — Transaction Ledger

- **A2.1** As a finance owner, I want to manually record any transaction
  against an account (revenue, cost, withdrawal, other) with a date,
  amount, category, and description, so I can log activity the same way I
  currently do in Excel.
- **A2.2** As a finance owner, I want every invoice payment and bill
  payment to automatically appear in the relevant account's transaction
  history, so I don't have to double-enter what's already recorded
  elsewhere in the system.
- **A2.3** As a finance owner, I want to edit or delete a transaction I
  entered manually, so I can correct mistakes.
- **A2.4** As a finance owner, I want to see a running balance next to each
  transaction in an account's history, so I can trace exactly how the
  balance got to its current value, like a bank statement.
- **A2.5** As a finance owner, I want to know the balance of any account as
  of a specific past date (not just today), so I can answer "what was our
  balance at the end of last month" without recomputing manually.

### Feature A3 — Account Transfers (Including Currency Conversion)

- **A3.1** As a finance owner, I want to record a transfer of money from
  one of our accounts to another (e.g., US account to Egypt account), so
  the movement is tracked on both sides.
- **A3.2** As a finance owner, I want to record the currency conversion
  rate used when transferring between a USD and an EGP account, so the
  converted amount and the rate are both preserved for later reference.
- **A3.3** As a finance owner, when the conversion happens inside a single
  bank (moving between our USD and EGP accounts at that bank), I want the
  system to handle it as one linked transfer, so both account balances
  update together correctly.
- **A3.4** As a finance owner, when I receive USD and then exchange it
  separately (a different bank or an exchange office) before depositing
  EGP, I want to record these as two connected steps sharing a reference,
  so I can still trace the full flow of money even though it didn't happen
  as one bank operation.
- **A3.5** As a finance owner, I want a list/history of all transfers with
  filters by account and date, so I can review money movement between our
  accounts over time.

---

## Epic B — Revenue Classification & Invoice Routing

**Why:** Revenue arrives via different channels (local EGP transfer,
overseas USD transfer, occasional cash payment) and needs to be tracked by
source for accurate revenue reporting, separate from the general local
cash book.

### Feature B1 — Invoice Bank & Channel Assignment

- **B1.1** As a finance owner, when creating a sales invoice, I want to
  select which of our bank accounts I expect payment to arrive in, so
  revenue is pre-classified before it's even received.
- **B1.2** As a finance owner, I want to tag an invoice's revenue channel
  (local EGP, overseas USD, or cash), so I can report revenue by source
  the same way my separate revenue-tracking spreadsheet does today.
- **B1.3** As a finance owner, if a payment actually lands in a different
  account than expected, I want the system to flag the difference rather
  than block the payment, since real-world payments don't always match
  the plan exactly.

---

## Epic C — Cheque Management

**Why:** Cheques are the primary method used to withdraw funds from the
Egyptian bank accounts, most commonly by sending an employee to the bank
to cash a cheque and bring back physical money for company expenses (e.g.,
taxes, petty spending). This needs proper tracking by cheque number and
status, plus year-based reporting.

### Feature C1 — Cheque Issuance & Lifecycle

- **C1.1** As a finance owner, I want to record a cheque I've issued with
  its number, date, amount, and payee, so every cheque is individually
  trackable.
- **C1.2** As a finance owner, I want to specify why a cheque was issued —
  paying a vendor bill directly, or withdrawing cash for company use — so
  the system knows how to handle the money on the other end.
- **C1.3** As a finance owner, when a cheque is for cash withdrawal, I want
  the system to automatically add the withdrawn amount to the correct cash
  account balance, so I don't have to separately log the cash arriving
  after sending someone to the bank.
- **C1.4** As a finance owner, when a cheque pays a vendor bill, I want it
  linked to that bill so the bill is marked paid and I can trace the
  payment method used.
- **C1.5** As a finance owner, I want to track a cheque's status (issued,
  cleared, bounced, voided), so I know which cheques are still outstanding
  against the bank versus already settled.
- **C1.6** As a finance owner, if a cheque bounces or is voided, I want the
  system to automatically reverse whatever balance changes it caused, so
  my records stay accurate without manual correction.

### Feature C2 — Cheque Reporting

- **C2.1** As a finance owner, I want a register/list of all cheques
  issued in a given fiscal year, so I can review cheque activity for that
  year specifically.
- **C2.2** As a finance owner, I want to view cheque registers for
  previous fiscal years as well as the current one, so historical review
  and audits are possible.
- **C2.3** As a finance owner, I want summary totals (count and amount of
  issued, cleared, and outstanding cheques), so I get an at-a-glance
  status without counting manually.
- **C2.4** As a finance owner, I want to export the cheque register (for
  any fiscal year) as an Excel sheet, so I can share it with management or
  archive it the way I do today.

---

## Epic D — Subscription & Recurring Cost Tracking

**Why:** The company pays for numerous online services (cloud hosting,
AI tools, SaaS subscriptions) through a card tied to the US bank account,
which the business does not have direct statement visibility into. These
costs still need to be tracked for accurate cost reporting.

### Feature D1 — Subscription Charge Logging

- **D1.1** As a finance owner, I want to log a charge for a subscription
  service each billing cycle, entering the actual amount charged, so
  variable/usage-based services (like cloud hosting) are tracked
  accurately even when the amount changes month to month.
- **D1.2** As a finance owner, I want to attach the invoice or receipt file
  I receive by email for a subscription charge, so I have supporting
  documentation for each cost without relying on bank statement access I
  don't have.
- **D1.3** As a finance owner, I want to see the history of charges for a
  given subscription over time, so I can spot cost trends or unexpected
  increases.
- **D1.4** As a finance owner, I want subscription charge attachments kept
  separate from the general HR/company document hub, since these are
  private accounting records, not general company documentation.

---

## Epic E — Bank Statement Import & Reconciliation

**Why:** The business currently reconciles its manual cash book against
official bank statements at the end of each month. This process should be
supported directly, tolerating that most statements are only available as
PDF, while still allowing CSV when available for more reliable parsing.

### Feature E1 — Statement Upload & Parsing

- **E1.1** As a finance owner, I want to upload a bank statement file
  (PDF or CSV) for a specific account and month, so the system has a
  record of what the bank reported for that period.
- **E1.2** As a finance owner, when I upload a CSV statement, I want the
  system to parse it accurately into individual transaction rows, so
  reconciliation is fast when this format is available.
- **E1.3** As a finance owner, when I upload a PDF statement, I want the
  system to attempt to extract transaction rows automatically, but always
  let me review and correct them before anything is accepted, since PDF
  extraction can be imperfect.

### Feature E2 — Reconciliation Workflow

- **E2.1** As a finance owner, I want the system to suggest matches between
  statement lines and transactions I've already recorded (by date and
  amount), so I don't have to manually cross-check every line myself.
- **E2.2** As a finance owner, I want to confirm a suggested match, create
  a new transaction from an unmatched statement line, or ignore a line, so
  I have full control over how each line is resolved.
- **E2.3** As a finance owner, when a statement line matches an issued
  cheque, I want confirming that match to automatically mark the cheque as
  cleared, so cheque status stays in sync with actual bank clearing.
- **E2.4** As a finance owner, I want to mark a month's reconciliation as
  complete once all lines are resolved, so I have a clear month-end close
  point, the same way I finalize my cash book today.

---

## Epic F — Reporting & Data Export

**Why:** The core value of this entire effort is eliminating manual
Excel-based reporting for management and ad-hoc requests, while producing
output in the same familiar Excel format for sharing.

### Feature F1 — Flexible Transaction Reports

- **F1.1** As a finance owner, I want to generate a report of all
  transactions within any date range I choose (a day, a month, a custom
  range), so I can respond to any reporting request without manual
  compilation.
- **F1.2** As a finance owner, I want to filter reports by account,
  currency, or category, so I can drill into specific slices of the data
  (e.g., "only USD revenue" or "only Egypt cash spending").
- **F1.3** As a finance owner, I want to export any report to Excel, so I
  can share it exactly the way I currently share my manual spreadsheets.

### Feature F2 — Point-in-Time Balances

- **F2.1** As a finance owner, I want to check the balance of any account,
  or the total balance per currency, as of any past date, so I can answer
  historical balance questions without reconstructing them manually.

---

## Change Log

Use this section to record material changes to scope or understanding
after this document's initial creation, so history isn't lost as details
evolve.

| Date | Change | Reason |
|---|---|---|
| 2026-09-09 | Initial backlog created (Epics A–F) | Captures full requirements discussion for bank accounts, ledger, transfers, cheques, subscriptions, statement import, and reporting |
