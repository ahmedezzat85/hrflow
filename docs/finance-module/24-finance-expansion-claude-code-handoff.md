# 24 — Claude Code Handoff: Finance Expansion (X1–X6)

**Branch:** `feature/finance-expansion` (created from `main` at `67a8e65`; first commit = design docs only).
**Plan (authoritative):** [23-finance-expansion-plan.md](23-finance-expansion-plan.md).
**Decisions:** D-028 to D-032 in [../project-context/04-decision-log.md](../project-context/04-decision-log.md). Questions Q-015 to Q-020 are resolved; do not reopen them.
**Roadmap:** section 3E of [../project-context/05-roadmap-and-next-slices.md](../project-context/05-roadmap-and-next-slices.md).
**Owner confirmations (Oct 18, 2026):** overseas account is USD; all overseas data is entered manually or linked to invoices (no bank/Stripe API, no CSV assumption required).

---

## 0. Start here (do this first, then begin X1 immediately)

1. `git checkout feature/finance-expansion && git pull`. Confirm HEAD is the docs commit on top of `67a8e65`.
2. Read, in order: `AGENTS.md`, `docs/project-context/00-project-start-here.md`, plan doc 23, decisions D-016 to D-032, `be/finance/cash_basis.py`, `be/finance/models.py`.
3. Post a short branch-intake block (branch, HEAD, merge-base, slice, files you expect to touch) and begin X1. Do **not** wait for approval between slices unless a stop condition in section 3 is hit.

Alembic head on `main` is `0035_category_color`. New migrations continue from there (`0036_…`, `0037_…`), one per slice at most, in `be/migrations/versions/`.

---

## 1. Slice order and scope

Work strictly in this order. One slice = one or more commits prefixed with the slice ID (e.g. `X1: cheque attachments endpoints`). Each slice must leave the app working and the full backend suite green.

### X1 — Cheque scans and entry shortcuts (D-032)
- Backend: add nullable `cheque_id` FK (CASCADE) to `finance_attachments` + relationship on `FinanceChequeDB`. Endpoints under the cheques router: `POST /finance/cheques/{id}/attachments` (multipart, multiple files), `GET …/attachments`, `GET …/attachments/{att_id}/download`, `DELETE …/attachments/{att_id}`. Reuse the subscription-charge attachment pattern (`subscriptions_service` / `StorageClient`); permissions: read = `finance.cheque.read`, write = the existing cheque write permission. Cheque responses gain `attachment_count` / `has_scan`. List filter `has_scan`.
- Migration: create attachment rows for any non-empty `finance_cheques.attachment_url` (keep the column; mark deprecated in a comment; stop writing it).
- Shortcuts: endpoint or field returning the suggested next cheque number per account (last issued numeric + 1, preserving zero padding); in the cheque dialog, selecting a linked bill prefills payee, amount (bill open balance) and currency.
- Frontend: upload zone in the cheque dialog (files queued before save, uploaded after create), scan list with download/delete in the cheque drawer/row actions (follow the D-027 row-action pattern), "Scan missing" flag and filter. Update `FinanceMockState`/`FinanceApi` mock handlers.
- Tests: backend (upload/list/download/delete, permission denial, migration of `attachment_url`, next-number suggestion), Playwright spec for upload + missing-scan filter.

### X3 — Product catalog (D-030)  *(do before X2; it is independent and small)*
- `finance_products` model/repo/service/router (`finance.product.read` / `finance.product.write`, seeded into the RBAC catalog the same way existing finance permissions are; grant to the roles that hold invoice permissions — record the exact grants in the slice report).
- Fields: name, code (unique), type (`saas_subscription | license | implementation_service | support | other`), default_currency, default_price (nullable), default_receiving_account_id (nullable FK), is_active.
- Nullable `product_id` on `finance_sales_invoice_lines`. Invoice line editor gets an optional product picker that prefills description/price/currency while Draft; locked when Sent (D-022).
- UI: Products list + dialog under Finance Settings (or Sales, follow nearest pattern). Mock handlers.
- Tests: CRUD, uniqueness, invoice line with/without product, lock after Sent.

### X2 — Books, visibility, checkpoints, inter-book transfers, view switcher (D-028)  *(largest; highest risk)*
- `finance_books` (id, code `local|overseas`, name, is_default). Seed `Local` (default) and `Overseas`.
- `finance_bank_accounts`: required `book_id` (migration backfills every existing account to Local), `visibility` (`full|partial`, default full). Account dialog gets **Book** and **Visibility** fields.
- `finance_account_balance_checkpoints` (account_id, date, balance, note, attachment optional). For partial accounts show computed balance, latest checkpoint and "Unrecorded difference". Never post adjustments automatically.
- Classification (central, in `cash_basis.py` or a sibling module, used by every report): a transfer whose two accounts are in different books is an **inter-book transfer**. Per view:
  - `local`: inflow to a Local account from an Overseas account = revenue line "Income from overseas entity"; outflow from Local to Overseas = outflow line "Transferred to overseas entity".
  - `overseas`: mirror ("Transferred to local entity" / "Received from local entity"), not operating expense/revenue.
  - `consolidated`: eliminated (same as today's own-account movements).
  - Same-book transfers keep today's exclusion. Customer `is_intercompany` flag (nullable bool, default false): receipts from intercompany customers follow the same per-view treatment.
- API: every report, dashboard KPI, P&L, cash flow, forecast and attention endpoint accepts `book=local|overseas|consolidated`. **Backward compatibility rule: when `book` is omitted the behaviour must equal today's (all accounts)** so existing clients and tests stay valid; the frontend always sends an explicit value.
- Frontend: a `Local | Overseas | Consolidated` switcher component in the Finance page header, remembered per user (localStorage key per page, try/catch). First defaults per D-028: dashboard/P&L/cash flow = Local; accounts = all grouped by book; revenue analytics = Consolidated; subscriptions/vendors/categories = Consolidated with a "Paid from" book column.
- **Regression gate (mandatory):** a test that builds a representative dataset with only Local accounts and asserts every report returns identical numbers for `book` omitted, `book=local` and `book=consolidated`. Plus the worked example from plan §2 as a test (500k EGP local, 10k + 4k USD overseas revenue, 3,345 USD overseas spend, 5k USD inter-book transfer → expected figures in each view).
- Respect D-026: per-currency columns, never a converted total.

### X4 — Revenue receipts by source (D-029, D-030)
- `finance_revenue_sources` lookup (editable; seed `Invoice`, `Stripe payout`, `Direct transfer`, `Cash`, `Other`).
- `finance_ledger_transactions`: nullable `product_id`, `customer_id`, `revenue_source_id`, `period_start`, `period_end`, `memo_gross_amount`, `memo_fee_amount` (memo fields never affect balances).
- "Record revenue receipt" action (money_in on any account, same-currency rule D-020, optional attachment via existing ledger attachment).
- Invoice receipts set `revenue_source = Invoice` automatically; invoice book is derived from `expected_bank_account_id`. Map existing `revenue_channel` values in a data migration (keep column).
- Reports: revenue by product × book × source × month, per currency; "Untagged revenue" row.

### X5 — Subscriptions v2 (D-031)
- Subscription fields: `billing_email`, `proof_source`, `proof_expected`; paid-from = existing `payment_account_id` (any book).
- Charge status `expected | settled | skipped`, `proof_status attached | pending | unavailable`, `proof_note`. "Generate due charges" is idempotent (unique subscription_id + billing_date) and also runs on page open via the list endpoint call.
- Settle: link existing ledger row **or** create an "Already paid" bill through the settlement service (D-017/D-018/D-020 checks); store variance; advance `next_renewal_date` by one cycle. Skip with reason.
- Attention items: due within N days, expected-but-unsettled past due, proofs missing. In-app only — **no email, no scheduler**.
- "Proofs missing" list/filter. Tests for idempotency, settle paths, renewal advance, proof not blocking.

### X6 — Analytics and exports
- Revenue analytics page (by product/book/source/customer, per currency), subscription spend by vendor/department/book, proofs-missing report. Excel exports through the existing exporter: one record per row, audited like current exports.

---

## 2. Rules that must not be broken

- Finance owns all new tables. Employee bank accounts (HR) are never mixed with company accounts.
- D-016 to D-027 remain in force (bill/invoice status rules, settlement service for every bill/invoice payment, same-currency entries, cash-basis rules, D-027 styling via `.fv` scope, no colour literals — run `npm run lint:finance-tokens`).
- No background jobs, schedulers, email, OCR/AI services, bank/Stripe APIs, automatic FX feeds or S3.
- Ledger rows are never deleted for corrections; reversals only.
- Backend authorization on every new endpoint (`require_permission`). Frontend visibility is not authorization.
- Mock mode (`fe/finance-api.js` `FinanceMockState`/`FinanceApi`) updated for every user-visible state you add.
- `npm run build` in `fe/` before any Playwright run. Targeted tests during work; full `pytest be/tests -q` and the relevant Playwright specs once at the end of each slice.

## 3. Stop and ask the owner only if

- A change would alter numbers in any existing report for Local-only data (X2 regression gate fails and the cause is not a bug in new code).
- An existing decision (D-001 to D-032) conflicts with what the code needs.
- A migration cannot be made reversible or would rewrite existing ledger amounts.
- RBAC grants for new permissions are ambiguous beyond "mirror the nearest existing finance permission".
Otherwise use the nearest established repository pattern and continue.

## 4. End-of-slice report (post after each slice, then continue)

- Slice ID, commits, files changed (`git diff --stat`), migration ID.
- Tests run with exact pass/fail counts.
- Confirmed facts vs assumptions; any deviation from plan 23 and why.
- Docs to update: mark the slice **Done** in roadmap §3E; update decision status lines ("Implemented on `feature/finance-expansion` (slice Xn, migration 00NN)") in the same commit as the slice.

When X6 is done: final full regression, push the branch, and open a PR to `main` summarising slices, migrations (0036+), and test results.
