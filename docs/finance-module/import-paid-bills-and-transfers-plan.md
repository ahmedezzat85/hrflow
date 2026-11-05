# Import of paid bills and inter-book transfers (2023 backlog)

**Date:** November 5, 2026. **Status:** approved by the owner (answers to Q-A to Q-D, November 5, 2026) and built on `feat/import-paid-bills-transfers`. The decision is D-052 (D-046 was already taken). **Risk class:** high (writes ledger rows, extends D-033).
**Baseline:** `main` plus the import engine from plan 25 (I0 to I4 done). Re-verify names and line numbers before changing code.

## 1. Why
Plan 25 / D-033 imports Drafts only. For the 2023 backlog the owner needs money that really moved to appear in the right cashbook:

| Case | Required result |
|---|---|
| Subscription or other bill paid straight from an overseas account | One outflow in the **Overseas** account only. Nothing in Local. |
| Money moved from an overseas account to a local account, with a payment document issued by the local entity | Recorded **once** as an inter-book transfer: an outflow leg in the overseas account and an inflow leg in the local account, so it shows in both cashbooks. The document is attached as proof. |

The owner's reading of the document: it is called an invoice, but it is paid by an external entity, so for HRFlow it is a **money movement**, not a sale. This plan therefore stores it as proof on the transfer and does not create a sales invoice for it (see Q-A).

## 2. Verified facts
- A bill's book is the book of the account that paid it; an unpaid bill is Local (`books.filter_bills`, `bill_account_map`). Drafts can never land in Overseas.
- `BillsService.create_bill` already supports create-and-pay (`is_paid_now` plus `BillPaymentInline`), used by the subscription "Already paid" flow (`SubscriptionsService._create_already_paid_bill`). It applies the payment-type, currency, balance and duplicate rules (D-017, D-018, D-020).
- An overseas to local transfer is classified by D-028: Local sees "Income from overseas entity", Overseas sees "Transferred to local entity", Consolidated eliminates both. `TransfersService.create_transfer` supports `external_linked` with two owned accounts, `fx_rate` and `to_amount`.
- `finance_attachments.ledger_transaction_id` exists, so a document can be attached to a transfer leg. The one-parent check allows it.
- `BillsImporter`, `InvoicesImporter` and `ChequesImporter` register through `register_importer`; the engine does the dry run, per-row transactions, batch record and file safety.

## 3. Decision needed: D-052 (proposed), paid rows are opt-in
D-033 says an import never pays or posts. This plan keeps that as the default and adds an explicit, per-row opt-in:
- A bill row with `paid_date` and `paid_from_account` both blank stays a Draft, exactly as today. `payment_type` is optional: blank uses the account type's default (Outgoing transfer for a bank account, Cash payment for a cash account). A cheque payment is not supported (it needs a cheque number).
- A row with both filled is created and paid through `BillsService.create_bill` and therefore posts one outflow in that account.
- A row with only one of the two filled, or a payment_type or reference without them, is an error.
- The Import screen shows a notice and a required confirmation before a commit that will post ledger rows, with the count and total per account in the dry-run report.

## 4. Slices (each stops for review)

### P1: Paid bills
- New optional bill columns: `paid_date`, `paid_from_account` (name or id), `payment_type` (code or name), `payment_reference` (optional).
- Dry run checks, using the same helpers as normal payment: account exists and is active; bill currency equals the account currency (same-currency ledger entries); payment type is allowed for the account type; `paid_date` is a valid ISO date and not before `issue_date` unless flagged; the reconciliation month is not closed for that account (the cheque importer already does this check); balance and overdraft rules.
- Double-count guard: a warning when the account already has a ledger row with the same date, amount and reference.
- The paid row skips the extractor-cross-check exemption: the check stays a warning.
- Backdated 2023 rows must recompute running balances correctly and respect the yearly opening balances (D-043, BI-1). Verify and test.
- Acceptance: a paid overseas bill creates exactly one ledger outflow in the overseas account, appears in the Overseas view and not in Local; a Draft row creates no ledger row; partial paid columns are an error; re-committing the package creates nothing new.

### P2: Subscription charges (required, owner answer to Q-C)
- Subscription bills are recorded **as subscription charges**. Optional `subscription` column (exact subscription name); when filled the row must also be paid (P1 columns). The importer creates a settled charge for the bill's date linked to the bill and its ledger row, as the "Already paid" settlement does. It must respect the unique (subscription, billing date) index and must not collide with `generate_due_charges`.

### P3: `transfers` kind
- Manifest columns: `row_ref`, `source_file`, `confidence`, `review_flags`, `notes`, `from_account`, `to_account`, `date`, `from_amount`, `to_amount` (optional), `fx_rate` (optional), `fee` (optional), `exchange_reference`.
- Type is derived, not typed by the owner: same currency gives `internal`; different currencies between an overseas and a local account give `external_linked` with both legs confirmed. This must be verified against `repo.create_transfer`, which I have not read.
- The source file is attached to **both** ledger legs, so either cashbook shows the document. Both attachment rows may point at one stored file; verify deletion behaviour.
- Duplicate check: same accounts, date, amounts and exchange reference.
- New permission: reuse the transfer write permission; no new key.
- Acceptance: one transfer, two legs, correct classification in Local, Overseas and Consolidated; the worked example in plan 23 §2 still passes; the document downloads from both legs with account-level read permission.

### P4: Invoice routing (small)
- Optional invoice columns `expected_bank_account` and `revenue_channel` (validated against the allowed list), so real overseas customer invoices land in the right book. Payment recording for invoices stays manual and is out of scope.

### P5: Screen, mock mode and templates
- Import screen: new kind `transfers`, new bill columns in the template, the posting notice and confirmation, per-account totals in the report. D-027 styling, mock handlers in `fe/finance-api.js`, a Playwright spec, `npm run build` and `npm run lint:finance-tokens`.

### Later: MCP
After P1 to P3, add finance staging tools to `mcp_server/` with a new token scope and a review page. The PDFs are uploaded to the app locally and matched by `source_file`, not sent through Claude. Separate plan.

## 5. Rules that must not be broken
- Ledger rows are never deleted for corrections. A wrong paid import is reversed by the normal reversal flow.
- Backend permission checks per kind and per action; the paid columns need the same permission as paying a bill.
- Imported files and manifests are never committed.
- Existing bill upload, payment and transfer behaviour and tests stay unchanged.

## 6. Owner answers (November 5, 2026)
- **Q-A: Yes.** The local entity's payment document stays as proof on the transfer and is not also created as a sales invoice.
- **Q-B: Yes.** Yearly opening balances for 2023 are set on the overseas and local accounts. Still verify the interplay with D-043 in tests.
- **Q-C:** Subscription bills are recorded as subscription charges (P2 is required, not optional).
- **Q-D: Yes.** Overseas bills are in the overseas account's currency; a mismatch stays an error.

## 7. Documentation
Decision-log entry D-052, roadmap section for P1 to P5, and the notice text in the Import screen.
