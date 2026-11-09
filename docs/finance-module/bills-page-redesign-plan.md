# Bills page redesign (Spend > Bills): implementation plan

Status: plan, approved design, not started. Story ID: to assign (`FUX-xxx`).
Design reference: the interactive mockup the owner approved (round 2, "Bills: proposed redesign").
Risk class: High-Risk under AGENTS.md (finance UI, new list and summary queries, spec churn). Backend 3-tier order applies.

## 1. Goal

Make the Spend > Bills page answer a daily finance user's two questions quickly: "how much, in which book" and "which bills need me". Keep it consistent with the other Spend tabs.

Approved changes:

1. Rename the tab and page title **Vendor Bills -> Bills**.
2. Shared Spend head row: `[Local | Overseas | Consolidated] [search] [actions]`, the same pattern as Subscriptions. The book choice is shared by Bills and Subscriptions. **Add Vendor** appears only on the Vendors tab. **Upload bills** and **Record Bill** stay as two separate buttons (no dropdown).
3. Four summary cards in the app's `.fv-cards` / `.fv-card` pattern: To pay, Overdue, Paid this month, Awaiting approval. Each card has a link that opens the matching queue.
4. Queues: Needs attention (default), Overdue, To pay, Paid, All, plus a Status select for the exact eight statuses. Type filter (All / Subscriptions / One-off) and a Group by vendor switch.
5. Columns: Bill, **Bill date** (with the due line under it for bills that still owe money), **Source** (paid-from account, book underneath, styled like Subscriptions "Paid from"), Status (dot), Amount (own currency code). Category moves to the details drawer and stays searchable.
6. Recurring bills carry a "Monthly" tag.

Out of scope: Subscriptions page changes (empty "To settle" panel, zero-count pills), the Vendors and Statutory tables, the bulk historical import, any change to Upload bills behaviour, payment/approval workflow rules.

## 2. Findings that shape the plan

- **The due line already exists.** `renderFinanceBills` in `fe/public/js/finance-bills.js` already prints `FinanceUI.dateCell(issue_date, "Due in N days" / "N days late")` under the bill date for owed bills. Your screenshot only showed paid bills. So item 5 is mostly kept as is; `is_overdue` stays server-owned.
- **A book switcher already exists.** `FinanceBookView` (`fe/public/js/finance-core.js`, D-028) renders Local | Overseas | Consolidated, remembered per page in localStorage. Subscriptions mounts it into `financeBookSwitcherSubscriptions`. Reuse it; do not build a second one.
- **The backend book rule already exists.** `be/finance/books.py` `filter_bills`: a bill belongs to the book of the account of its first outgoing payment; an **unpaid bill belongs to the default (Local) book**. Reports, forecast and attention services already use it. The bills list and queue-counts endpoints do **not** take a `book` parameter today.
- **Consequence (see decision D1):** under that rule an unpaid USD bill (for example AWS awaiting payment) shows under Local until it is paid. In the Overseas view, "To pay" and "Overdue" would miss it. This is the main design risk.
- **Bills have no stored subscription flag.** The link is `SubscriptionChargeDB.linked_bill_id`. `BillResponse` has no account, book or subscription fields today.
- **Cards need server totals.** `GET /api/finance/bills` returns up to 100 rows (default 50) and the page paginates client-side, so totals cannot be computed in the browser without being wrong.
- **Upload bills** (`POST /api/finance/bills/upload`, `BillsService.upload_drafts`) turns each PDF or photo into a Draft: PDF text extraction, vendor match (never auto-created), SHA-256 duplicate check. Unchanged here.

## 3. Decisions needed before building

| # | Question | Recommendation |
|---|----------|----------------|
| D1 | Which book does an **unpaid** bill belong to? | **DECIDED (owner): infer from vendor history, no schema change.** Use the book of the account that paid the vendor's most recent paid bill; if none, the default book. Return `book_source` (`paid`, `inferred`, `default`) and mark inferred or default values in the UI (for example "Overseas (expected)"). Applies to the list filter, queue counts and summary cards alike. Revisit with a nullable `expected_account_id` on bills only if inference proves wrong in practice. |
| D2 | Fourth card | Awaiting approval (count). Swap for "Due in 7 days" if the approval workflow is not used. |
| D3 | Default book on first visit | Consolidated, as D-028 already specifies for spend and subscriptions. |
| D4 | Shared key | One shared page key (`spend`) for Bills and Subscriptions, with a one-time fallback to the old `subscriptions` value. |
| D5 | Status pills | Replace the nine pills with five plus the Status select (this renames or removes element IDs, see section 6). |

## 4. Backend (be/finance)

Order: schemas -> repository -> service -> router -> tests.

1. **`schemas.py` `BillResponse`**: add `book` (`local|overseas`), `book_source`, `paid_from_account_name`, `is_subscription` (bool) and `subscription_name` (optional). All optional with safe defaults so existing clients keep working.
2. **`bills_repository.py` / `bills_service.py`**
   - `list_bills(..., book=None, kind=None)`: `book` uses `books.resolve` plus the D1 rule; `kind` is `subscription|one_off`, from a `linked_bill_id` existence check (one query, no N+1).
   - Build the account and book maps once per request (`books.bill_account_map` already does this for paid bills) and attach `book`, `paid_from_account_name`.
   - `queue` accepts two new aggregates: `attention` (draft, pending_approval, rejected, or overdue open bills) and `to_pay` (approved, scheduled, partially_paid). The existing eight status values keep their meaning.
   - `get_queue_counts(vendor_id, book)`: add `attention` and `to_pay`; `book` filter applies to every count.
3. **New `GET /api/finance/bills/summary?book=`** (permission `finance.bill.read`): returns, per currency and never summed across currencies (no conversion, same policy as the dashboard):
   - `to_pay`: remaining balance of approved, scheduled and partially paid bills, with a count
   - `overdue`: same predicate as `is_overdue`, with a count
   - `paid_this_month`: outgoing bill payments dated in the current month, excluding reversed payments (confirm how reversals are stored before coding)
   - `awaiting_approval`: count of `pending_approval`
4. **Router**: add `book` and `kind` query params to `GET ""`; add the summary route above `/{bill_id}` so the path is not captured as an id. Validate `book` with `books.validate_view`.
5. No migration (unless D1 alternative is chosen). No change to authorization rules, workflow states or money calculations.

## 5. Frontend (fe/src, fe/public/js, fe/api)

Run `npm run build` in `fe/` after any change. Finance styling uses tokens only (`npm run lint:finance-tokens`); do not restyle global `.btn`, `.badge`, `.card`, `.filter-tab`.

1. **Head row** (`finance-bills.html`, `finance-nav.js`, `finance-bills.js`)
   - `SpendTabs.TABS[0].label`: `Vendor Bills` -> `Bills`. Check `ui.js` for the section title string.
   - Add a book switcher host (`financeBookSwitcherBills`) in the head actions; mount with `FinanceBookView.mount("spend", ...)` on Bills and Subscriptions. Hide it on Vendors and Statutory.
   - `switchBillSubTab`: `financeAddVendorBtn` is visible only on the Vendors sub-tab (today it shows on both). Keep `financeRecordBillBtn` and `financeUploadDraftsBtn` as they are.
   - `FinanceBookView`: add `spend` default, plus a one-time read of the legacy `subscriptions` key.
2. **Cards**: new `.fv-cards` block with four `.fv-card` in `finance-bills.html`, filled from `FinanceApi.getBillsSummary(book)`. Multi-currency values render as stacked lines inside the card. A small tokenised modifier in `finance-v2.css` for the stacked value; no colour literals. Card links call `setBillWorkQueue(...)` or set the Status select.
3. **Queues and filters**: replace the nine pill buttons with Needs attention, Overdue, To pay, Paid, All; add the Status select, Type select and Group by vendor switch. `setBillWorkQueue`, `_updateBillQueueTabs`, `loadFinanceBillQueueCounts` and `loadFinanceBills` pass `book` and `kind`; the Overdue-only checkbox becomes the Overdue queue. Default queue: `attention`. Persist per `FinanceTable` state as today.
4. **Table** (`renderFinanceBills`): columns Bill, Bill date, Source, Status, Amount, actions. Reuse `FinanceUI.dateCell`, `statusPill` (dot variant) and `amountCell`; add a `sourceCell` helper in `finance-core.js` that matches the Subscriptions "Paid from" cell. Add the Monthly tag and the grouped-by-vendor rows (client-side over the loaded page; confirm the page size so groups are not cut mid-way, see risks).
5. **Details drawer**: add Category, Paid from (account and book), Type. Drawer code lives in `FinanceDrawer`.
6. **API layer**: `fe/api/finance/bills-api.js` gets `getBillsSummary`, and `getBills` / `getBillQueueCounts` forward `book` and `kind`.

## 6. Mock mode (`fe/finance-api.js` and `fe/api/finance/bills-api.js`)

`?mock=admin` must reproduce the new states: bills in both books with account names, a subscription bill, an overdue bill, a draft, a pending-approval bill, an inferred-book bill. Mock `getBillsSummary`, queue counts with `attention` and `to_pay`, and `book` / `kind` filtering. Note: `fe/finance-api.js` has an uncommitted change on the current branch that is unrelated to this work. Start from a fresh branch off `origin/main` and leave that change alone (commit or stash it first, owner's call).

## 7. Tests

Backend (`be/tests`, targeted first, then `cd be && python -m pytest tests -q -n 12` once at the end):
- `book` filter: paid bill follows its payment account; unpaid bill follows the D1 rule; Consolidated returns all.
- `kind` filter and `is_subscription` from `linked_bill_id`.
- `queue=attention` and `queue=to_pay` membership; counts honour `book`.
- Summary: per-currency totals, never mixed; overdue predicate equals `is_overdue`; reversed payments excluded; permission denied without `finance.bill.read`.
- Existing schema-drift and env-contract tests stay green.

Playwright (`fe/tests/ui`, build first): update or add
- `finance-bill-status-tab-bar.spec.js` (21 references) and the pill-ID references in `finance-bills-inbox`, `finance-bills-approval`, `finance-restyle-v2`, `finance-bills-header-restyle`, `finance-vendor-security`, `finance-bill-drafts`, `finance-bill-category-defaults` (46 in total). Where a spec needs an exact status it now uses the Status select. Keep the old IDs on controls whose meaning is unchanged (All, Paid) where possible.
- `admin-dual-rail.spec.js` and `finance.spec.js`: tab label `Bills`. Also `docs/ui-design/dual-rail-navigation-plan-v2.md` and `fe/tests/ui/README.md`.
- New `finance-bills-redesign.spec.js`: book switch changes cards and rows and is remembered on Subscriptions; cards link to queues; Add Vendor only on Vendors; due line only on owed bills; Monthly tag; group by vendor; empty "Needs attention" state; keyboard access; phone and tablet widths (modals and drawers already have fit specs).

## 8. Phasing

- **Phase A (backend)**: sections 4 and the backend tests. Mergeable alone; clients ignore the new fields.
- **Phase B (frontend)**: sections 5 to 7. Needs Phase A deployed or mocked.

Each phase: rebase onto `origin/main`, open a PR, enable auto-merge and auto-fix.

## 9. Risks and checks before coding

- **Unpaid-bill book (D1)** decides whether Overseas "To pay" is trustworthy. Decide first.
- **Page size**: confirm how `FinanceApi.getBills` pages (server default 50). Counts and cards come from the server, but grouping runs on loaded rows only. If needed, raise the fetch limit for this page or move grouping server-side.
- **Spec churn** is the largest cost (about 46 pill-ID references in 8 specs). Budget for it in Phase B.
- **Reversed payments**: confirm the stored shape before writing the "paid this month" query.
- **Per-user memory**: D-028 says the view is remembered per user; today it is localStorage per browser. Keep the same behaviour; do not expand scope.
- **Mixed currencies** are never added together; cards show one line per currency.

## 10. Definition of done

Design matches the approved mockup; every acceptance item in section 1 has a test; backend and UI suites pass (`pytest -q -n 12`, Playwright on the touched specs plus the Spend regression set); `npm run build` and `npm run lint:finance-tokens` pass; no scratch files in `git status`; docs and the decision log updated if D1 changes the book rule.
