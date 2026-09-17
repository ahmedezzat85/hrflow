# Finance UX Transformation — Phased Implementation Plan

Status: Completed
Owner: Finance module
Working branch: `refactor/finance-ux`
Completed: All 32 Stories (Phases 0 through 8) Verified & Delivered
Baseline: `feature/finance-baseline` merged at `ef602347dde50e396362d23012ec648fd5fd9ef0`
Related: `docs/finance-module/03-bank-accounts-ledger-implementation-plan.md`, `docs/finance-module/04-bank-accounts-ledger-backlog.md`

## Purpose

This plan converts the finance UI/UX review into small, independently deliverable and verifiable stories. It follows the bank implementation-plan pattern: each phase has a clear goal, each story defines both product behavior and technical work, and every story has acceptance criteria plus a verification plan.

The delivery objective is not only a visual redesign. The finished module must help a non-accountant understand what needs attention, complete routine finance work without a steep learning curve, and remain safe enough for high-trust financial operations.

## Delivery rules

1. Complete stories in dependency order unless a story explicitly says it is parallel-safe.
2. One pull request should implement one story, or one tightly coupled milestone when splitting would create an unusable intermediate state.
3. Every PR must include automated tests, manual verification notes, screenshots for affected breakpoints/themes, and migration notes when persistence changes.
4. New UI must not display believable placeholder finance values.
5. Posted financial records must be corrected by reversal or controlled state transition, never by deleting history.
6. New controls must be keyboard accessible and have programmatic labels before the story is complete.
7. Additive schema changes may ship behind feature flags. Destructive migrations require a separate reviewed migration plan.
8. Existing invoice, bill, ledger, transfer, cheque, statement, subscription, and report behavior must remain functional while UX work is phased in.

## Shared definition of done

A story is done only when all applicable checks pass:

- Product acceptance criteria pass with realistic seeded finance data.
- Backend tests pass under `be/tests`, including authorization and negative cases.
- Frontend Playwright tests pass under `fe/tests/ui` for desktop and the agreed mobile viewport.
- Keyboard-only completion succeeds for the primary path.
- Automated accessibility checks report no new serious or critical violations.
- Light and dark themes are visually checked.
- Loading, empty, error, stale, permission-denied, and success states are handled.
- API requests prevent duplicate submission and preserve entered data after recoverable errors.
- Monetary values use the shared money formatter and statuses use the shared status model.
- Audit events and permissions are tested for high-risk actions.
- Relevant documentation and screenshots are updated.

## Target architecture

### Frontend

- Page partials remain under `fe/src/partials/admin/sections/` during this plan unless a separate frontend architecture decision approves component migration.
- Finance dialogs remain under `fe/src/partials/modals/`, but use one shared modal/dialog controller and common field primitives.
- Finance API and state orchestration remain in `fe/finance-api.js` initially; extract focused modules only when a story would otherwise make that file materially harder to test or maintain.
- Shared visual primitives belong in `fe/src/styles/` and are imported by `fe/src/styles.css`.
- Existing Playwright suites in `fe/tests/ui/` are extended rather than replaced.

### Backend

- Domain persistence changes belong in `be/finance/models.py` and migrations.
- Request/response contracts belong in `be/finance/schemas.py`.
- Endpoint composition belongs in `be/finance/routers/`.
- Workflow and accounting rules belong in `be/finance/services/`; routers must not become the source of business truth.
- Data access belongs in `be/finance/repositories/`.
- Finance tests remain split by domain under `be/tests/test_finance_*.py`; authorization and audit coverage also extend `test_authorization.py`, `test_rbac.py`, and `test_audit_log.py` where appropriate.

---

# Phase 0 — Trust, Safety, and Delivery Baseline

**Goal:** Remove misleading behavior and establish the financial, accessibility, and test primitives that every redesign phase depends on.

## Story 0.1 — Verified finance loading states

**User story:** As a finance user, I want to know whether a number is loaded, stale, unavailable, or current so that I never mistake placeholder content for company data.

**High-level scope**

- Remove hard-coded dashboard amounts and internal roadmap copy.
- Define loading, empty, error, stale, and last-updated states for finance data.
- Hide unfinished actions or expose them as explicitly unavailable—not clickable simulations.

**Implementation level**

- Replace default values in `finance-dashboard.html` with semantic skeletons or `—`.
- Extend finance API state handling with `idle/loading/success/empty/error/stale` states.
- Add a reusable page-state and retry component.
- Add `generated_at`, data scope, and base-currency metadata to dashboard/report responses where absent.
- Remove “Phase 5/6” language and feature-flag unfinished payroll/visualization actions.

**Acceptance criteria**

- No believable monetary value appears before a successful response.
- Failed requests show an inline error, retry action, and retained page context.
- Stale data remains visible only with a clear stale label and timestamp.
- Dashboard KPIs show last updated, period, and currency context.
- Unimplemented actions cannot be mistaken for functional actions.

**Verification plan**

- Intercept dashboard APIs in Playwright for delayed, empty, failed, and stale responses.
- Confirm no hard-coded finance amount exists in the dashboard DOM before success.
- Verify retry performs one new request and recovers without page reload.

## Story 0.2 — Shared money, date, and status semantics

**User story:** As a finance user, I want amounts and statuses to mean the same thing everywhere so that I can scan screens without reinterpreting formats.

**High-level scope**

- Standardize amount, currency, date, balance, and status display.
- Separate workflow states from settlement/financial states.
- Correct misleading KPI language, especially amount versus margin.

**Implementation level**

- Add shared formatters for ISO currency, locale, precision, signs, dates, and time zones.
- Add reusable money and status rendering helpers with accessible text.
- Define state maps for invoices, bills, transfers, cheques, statements, payroll, and subscriptions.
- Rename the currency-valued “Net Operating Margin” card to “Net Operating Result”; add an actual percentage metric only when the API supplies numerator and denominator.
- Right-align monetary table cells and use tabular numerals.

**Acceptance criteria**

- `$` never appears without unambiguous currency context.
- Negative, zero, and large values render consistently in all finance pages.
- Dates use one application format and disclose time zone where time affects meaning.
- Status meaning does not rely on color alone.
- Overdue is derived from due date, outstanding balance, and void state rather than manually selected during creation.

**Verification plan**

- Add formatter unit tests for EGP, USD, zero, negatives, decimal rounding, and missing values.
- Add Playwright assertions across invoices, bills, accounts, subscriptions, and reports.
- Review status transitions with seeded partial-payment and overdue cases.

## Story 0.3 — Accessible dialog and form foundation

**User story:** As a keyboard or assistive-technology user, I want every finance dialog and form to be understandable and operable without a mouse.

**High-level scope**

- Standardize dialog semantics, labels, focus behavior, validation, and disclosures.
- Remove clickable non-controls and placeholder-only labels.

**Implementation level**

- Create one modal controller with accessible name, `role="dialog"`, `aria-modal`, initial focus, focus trap, Escape rules, scroll lock, and focus restoration.
- Associate every finance field with a label and connect help/error text with `aria-describedby`.
- Add shared field-error rendering and an error summary for long forms.
- Convert finance tabs/disclosures to buttons with correct semantics and keyboard behavior.
- Give icon-only controls specific accessible names.

**Acceptance criteria**

- Every finance modal can be opened, completed, validated, and closed by keyboard.
- Focus never escapes an open modal and returns to its invoking control.
- Screen readers announce modal title, required fields, errors, and success.
- No finance control relies on placeholder text as its only label.
- Touch targets meet the agreed minimum size/spacing.

**Verification plan**

- Add reusable Playwright keyboard and focus tests for each modal family.
- Run automated accessibility scans on every finance page and modal-open state.
- Conduct manual screen-reader spot checks on invoice, bill, transfer, statement upload, and reconciliation flows.

## Story 0.4 — Safe financial command framework

**User story:** As an authorized finance user, I want to review the impact of a high-risk action and recover through a controlled correction so that mistakes do not silently damage financial history.

**High-level scope**

- Standardize review, submit, confirmation, reversal, reason capture, and idempotency.
- Replace browser-native confirmation prompts.

**Implementation level**

- Add a reusable review-summary component showing entity, account, date, amount, currency, FX, attachments, and posting effect.
- Add idempotency-key support to create/post/pay/transfer/cheque/reconcile endpoints.
- Add service-level duplicate checks for document numbers, cheque numbers, payment references, and statement import fingerprints.
- Replace hard delete of posted finance records with reverse/void state transitions and linked reversal records.
- Extend the existing confirmation modal for record identity, consequences, required reason, and permission-aware final action.

**Acceptance criteria**

- Double-clicking submit creates one financial result.
- Replaying the same idempotency key returns the original result and creates no duplicate.
- Posted entries cannot be silently deleted or edited into a different history.
- Destructive actions identify the record and consequence and require a reason where configured.
- Duplicate warnings are actionable and distinguish blocking from non-blocking cases.

**Verification plan**

- Add concurrent/replayed request tests to finance backend suites.
- Test reversal balances and audit links for payments, transfers, cheques, and manual transactions.
- Run browser tests for rapid double-click, timeout then retry, and duplicate-warning resolution.

**Phase 0 exit gate:** No redesign phase starts until Stories 0.1–0.3 are complete. Story 0.4 must be complete before any redesigned posting or payment flow is released.

---

# Phase 1 — Navigation and Shared Work Surfaces

**Goal:** Simplify wayfinding and establish shared list/detail patterns before redesigning individual domains.

## Story 1.1 — Finance information architecture

**User story:** As a user who is not an accountant, I want finance areas grouped by the job I am doing so that I do not need to understand the current implementation structure.

**High-level scope**

- Reorganize Finance into Overview, Sales, Spend, Banking, Payroll, Reports, and Settings.
- Move Categories and Payment Types from daily Banking work into Settings.
- Preserve deep links and authorized access.

**Implementation level**

- Update sidebar/navigation configuration and section routing.
- Add sub-navigation for Sales (Invoices, Customers), Spend (Bills, Vendors, Recurring), and Banking (Accounts, Transactions, Transfers, Cheques, Statements/Reconciliation).
- Add redirect/compatibility mapping for old section identifiers.
- Add permission-aware navigation visibility without treating hidden links as backend authorization.
- Add actionable badge-count endpoints or aggregate counts in the finance summary API.

**Acceptance criteria**

- Every existing finance capability is reachable in two navigation decisions or fewer.
- Old bookmarked finance routes resolve to the correct new destination.
- Categories and Payment Types appear under Settings, not Account operations.
- Badges display only actionable items and link to the corresponding filtered view.
- Unauthorized areas are absent from navigation and rejected by the API.

**Verification plan**

- Create a route/link matrix covering old and new destinations.
- Run role-based navigation tests for admin, finance operator, approver, payroll-only, and read-only roles.
- Perform first-click testing with representative users.

## Story 1.2 — Shared finance data table

**User story:** As a finance operator, I want lists to sort, filter, paginate, and retain my working view consistently so that repetitive work is fast.

**High-level scope**

- Build one list shell for invoices, bills, customers, vendors, accounts, transactions, transfers, cheques, statements, subscriptions, payroll runs, and report details.

**Implementation level**

- Implement server-supported sorting, pagination, total count, and filter query contracts.
- Add visible filter chips, clear-all, saved views, result count, column chooser, density preference, sticky identifiers, and overflow actions.
- Persist non-sensitive view preferences per user.
- Standardize row detail activation, selection, bulk action review, empty/loading/error states, and responsive card rendering.
- Keep semantic table headers and accessible action names.

**Acceptance criteria**

- A user can sort, filter, paginate, save, reopen, and clear a view in every migrated list.
- Filters survive navigation back from record detail.
- Table preferences do not expose or persist unauthorized data.
- Keyboard users can reach row details and row actions without traversing meaningless cells.
- Mobile card view preserves labels, primary amount/status, and actions.

**Verification plan**

- Add contract tests for invalid sort/filter/page inputs.
- Add a shared Playwright table behavior suite and apply it to at least invoices, bills, and transactions before general rollout.
- Test 0, 1, 50, and 10,000-row datasets for behavior and performance.

## Story 1.3 — Detail drawer and activity timeline

**User story:** As a finance user, I want to inspect a record and its history without losing my list context.

**High-level scope**

- Provide a shared side drawer for record summary, related records, attachments, notes, and audit activity.

**Implementation level**

- Add a drawer controller with URL/state integration, focus management, responsive full-screen mode, and close-to-origin behavior.
- Define summary and activity response shapes for finance entities.
- Render actor, timestamp, event, state transition, before/after fields, and linked records.
- Support permission-aware attachment preview/download and sensitive-data masking.

**Acceptance criteria**

- Opening and closing detail preserves filters, sort, page, and scroll position.
- Timeline entries use plain language and show actor and timestamp.
- Sensitive fields remain masked unless separately authorized.
- A related invoice, bill, payment, transfer, or transaction can be opened without losing navigation history.

**Verification plan**

- Browser-test direct links, Back/Forward, refresh with an open drawer, mobile mode, and focus restoration.
- Verify timeline event ordering and role-based redaction with backend tests.

**Phase 1 exit gate:** Navigation, table shell, and detail drawer are stable and documented before domain pages migrate.

---

# Phase 2 — Action-Oriented Finance Overview

**Goal:** Make the first finance screen answer what needs attention, what cash is available, and what changed.

## Story 2.1 — Finance context bar and trustworthy KPIs

**User story:** As a finance manager, I want every dashboard value scoped by entity, period, basis, and currency so that I can interpret it correctly.

**High-level scope**

- Add Company/Entity, Period, Cash/Accrual basis, Base Currency, and Last Updated context.
- Make KPI definitions and drill-down available.

**Implementation level**

- Extend dashboard endpoints to accept and return context.
- Add KPI metadata: formula, source coverage, comparison period, generated timestamp, and drill-down filter.
- Build context controls with persisted non-sensitive defaults.
- Implement KPIs for total book cash, revenue, operating spend, net operating result, and actual margin only when valid.

**Acceptance criteria**

- Changing context refreshes all dashboard sections consistently.
- Each KPI displays currency/unit, period, freshness, and a definition.
- Each KPI drills to the records that compose it.
- Multi-currency totals identify the conversion date/policy.

**Verification plan**

- Reconcile KPI totals against seeded source transactions for cash and accrual modes.
- Test empty and mixed-currency entities and boundary dates.

## Story 2.2 — Needs-attention queue

**User story:** As a finance operator, I want one prioritized queue of work so that I can resolve exceptions without checking every page.

**High-level scope**

- Aggregate overdue receivables, bills due, pending approvals, unreconciled lines, failed imports, duplicate warnings, negative cash, and missing documents.

**Implementation level**

- Add an attention-item schema with type, severity, due date, amount/currency, owner, permission, target route, and deduplication key.
- Implement aggregate service queries with deterministic priority rules.
- Add count, amount, owner, severity, and due-date filters.
- Support resolve/open, assign where permitted, and mark-reviewed only when the domain permits it.

**Acceptance criteria**

- Every queue item links to an actionable filtered record or exception.
- Resolved items disappear after refresh and cannot remain as stale duplicates.
- Severity and due state do not rely on color alone.
- Unauthorized item details are neither returned nor counted.

**Verification plan**

- Seed one case per attention type and verify ordering, counts, permissions, and resolution behavior.
- Measure time to identify the top three urgent tasks in usability testing.

## Story 2.3 — Cash position and forecast

**User story:** As a finance manager, I want current cash and upcoming obligations in one view so that I can anticipate shortfalls.

**High-level scope**

- Show bank/book balances by account and currency, upcoming inflows/outflows, and a 30/60/90-day forecast.

**Implementation level**

- Define forecast inputs from open invoices, approved/scheduled bills, payroll, subscriptions, and planned transfers.
- Add assumption metadata and exclude draft/unapproved items by default.
- Build account/currency breakdown, trend, obligation list, and forecast uncertainty labels.
- Drill forecast items to sources.

**Acceptance criteria**

- Bank, book, available, and reconciled balances are never conflated.
- Forecast clearly separates confirmed and expected items.
- Users can inspect every material source item and forecast assumption.
- Missing exchange rates or source dates produce a visible warning rather than a fabricated total.

**Verification plan**

- Test forecasts with partial invoice payments, scheduled bills, multi-currency accounts, and missing rates.
- Compare generated totals with a manual seeded-data calculation.

---

# Phase 3 — Sales and Receivables

**Goal:** Complete the invoice lifecycle from draft through collection while keeping customer context visible.

## Story 3.1 — Invoice work queue and detail

**User story:** As a receivables user, I want to see open, overdue, partially paid, and completed invoices with outstanding balances so that I know what to collect.

**High-level scope**

- Replace the basic invoice list with views for Open, Draft, Awaiting Payment, Overdue, Paid, and Void.
- Add invoice detail drawer.

**Implementation level**

- Extend invoice list responses with outstanding balance, days overdue, sent/viewed state, last reminder, and owner where available.
- Add date, customer, currency, amount, channel, and payment-state filters.
- Add sorting, saved views, row overflow actions, and safe bulk send/remind/export.
- Populate detail with document preview, payment history, messages, attachments, linked bank records, and audit activity.

**Acceptance criteria**

- Outstanding balance equals total minus valid non-reversed payments.
- Overdue is derived and updates automatically with date/balance changes.
- Default Open view excludes Paid and Void records.
- Detail explains invoice state and next available action.

**Verification plan**

- Test unpaid, partial, paid, overdue, void, and reversed-payment invoices.
- Verify filter totals and detail history against backend records.

## Story 3.2 — Guided invoice editor and lifecycle

**User story:** As a sales/finance user, I want to draft, review, preview, approve, and send an invoice without manually managing accounting status.

**High-level scope**

- Convert invoice creation from a routine modal to a full-page editor or large drawer.
- Support line-item calculation and lifecycle actions.

**Implementation level**

- Add customer, dates/terms, currency, expected account, revenue channel, notes, attachments, and line-item grid.
- Support quantity, unit price, tax, discount, account/category, subtotal, tax, total, paid, balance, and base-currency equivalent.
- Add Save Draft, Save & Preview, Submit for Approval, Approve & Send according to permission.
- Add immutable document numbering after issue, server-side recalculation, duplicate-number detection, and due-date validation.
- Add PDF/document rendering and send-delivery event capture.

**Acceptance criteria**

- Server-calculated totals match the preview and persisted invoice.
- Creator cannot manually choose Paid or Overdue.
- Draft can be resumed without data loss.
- Issued invoices use correction/credit/void paths rather than silent destructive edits.
- Send events, failures, and retries appear in activity.

**Verification plan**

- Unit-test taxes, discounts, rounding, currencies, negative/zero values, and numbering collision.
- Browser-test draft resume, validation recovery, preview, approval, send failure, and retry.

## Story 3.3 — Collections and payment recording

**User story:** As a receivables user, I want to send reminders and record partial or complete payment safely so that collection status is accurate.

**High-level scope**

- Add reminder policy, collection actions, payment review, partial payments, and matching.

**Implementation level**

- Add reminder templates/schedules and event history.
- Extend payment flow with remaining balance, destination account, payment method, reference, date, FX, fees, and attachment.
- Prevent overpayment by default; model credit/prepayment explicitly if enabled.
- Suggest bank-statement matches and mark discrepancy when actual account differs from expected.

**Acceptance criteria**

- Partial payment updates balance and state atomically.
- A reversed payment restores the correct outstanding balance.
- Reminder actions never send to a missing/invalid address without a blocking explanation.
- Duplicate payment references trigger review.

**Verification plan**

- Test multiple partial payments, final payment, overpayment, reversal, duplicate reference, and multi-currency payment.
- Verify sent reminder content with test transport, not production delivery.

## Story 3.4 — Customer 360 profile

**User story:** As a finance user, I want customer identity, terms, receivables, and activity together so that I can make collection decisions quickly.

**High-level scope**

- Expand customer fields and add a customer detail workspace.

**Implementation level**

- Add legal/display name, billing address, country, tax treatment/ID, default currency, terms, default revenue account, contact, owner, and notes.
- Add duplicate matching by normalized identity fields.
- Add receivables summary, overdue total, average days to pay, invoices, documents, contacts, and timeline.

**Acceptance criteria**

- Customer name is required and legal/display identity is unambiguous.
- Duplicate candidates are shown before create without exposing unauthorized records.
- Customer totals drill to the composing invoices.
- Inactive customers remain visible on historical documents but cannot be selected for new work by default.

**Verification plan**

- Test normalization and duplicate candidates for name, email, phone, and tax ID.
- Verify customer aging and totals against invoice/payment fixtures.

---

# Phase 4 — Spend, Payables, Vendors, and Recurring Costs

**Goal:** Turn bill entry into a controlled capture-to-payment workflow and integrate recurring spend into the same operating model.

## Story 4.1 — Bill capture and AP inbox

**User story:** As an AP user, I want to upload or enter a bill into a review inbox so that coding and errors are resolved before payment.

**High-level scope**

- Add Inbox, Needs Coding, Needs Approval, Ready to Pay, Scheduled, Paid, and Exceptions queues.
- Support manual entry and attachment-first capture.

**Implementation level**

- Add bill workflow state, capture source, attachment state, extraction confidence, and duplicate fingerprint.
- Implement file upload and review UI; extracted values remain suggestions until confirmed.
- Add legal entity, vendor, dates/terms, number, line items, tax, account/category, department/cost center, currency, recurring flag, and attachment.
- Add duplicate checks using vendor, number, date, amount, and file fingerprint.

**Acceptance criteria**

- Uploaded bills do not become payable until required fields are reviewed.
- Low-confidence or missing fields are clearly identified.
- Likely duplicates are blocked or require authorized override with reason.
- Queue counts and statuses update after each transition.

**Verification plan**

- Test manual, uploaded, duplicate, unreadable, missing-vendor, and multi-page attachment cases.
- Verify files cannot be retrieved without bill permission.

## Story 4.2 — Bill approval and payment

**User story:** As an approver or payer, I want policy-based review and a clear payment impact so that the company does not pay the wrong bill twice or from the wrong account.

**High-level scope**

- Add maker-checker approval, scheduling, partial payment, and payment review.

**Implementation level**

- Add approval requests, steps, decision, comment, delegation, amount limit, and timestamps.
- Add payment schedule and state.
- Extend payment review with bill total, prior payments, remaining amount, account balance, currency, FX, fees, date, reference, cheque/transfer, and evidence.
- Reject self-approval where segregation policy applies.

**Acceptance criteria**

- A bill cannot move to Ready to Pay before required approvals complete.
- Unauthorized or over-limit approvals are rejected server-side.
- Payment cannot exceed remaining balance unless an explicit credit/prepayment flow is authorized.
- Payment and reversal update bill and ledger atomically.

**Verification plan**

- Test single/multi-step approvals, reject/resubmit, delegate, self-approval denial, threshold boundary, partial/final payment, and reversal.
- Add concurrent-payment test to prevent two payers settling the same balance.

## Story 4.3 — Vendor profile and payment-data security

**User story:** As an AP user, I want a complete vendor profile while sensitive payment changes receive extra control.

**High-level scope**

- Expand vendor profile and separate payment instructions from general data.

**Implementation level**

- Add remit address, country, terms, currency, tax/withholding treatment, default expense account, department, contact, onboarding status, and compliance documents.
- Add a permission-gated payment-instruction entity with masking, verification state, effective dates, and change audit.
- Add open bills, recent spend, renewals, and last payment to vendor detail.

**Acceptance criteria**

- General vendor editors cannot reveal or change payment instructions unless authorized.
- Payment-detail changes create an audit event and require verification before use when configured.
- Historical bills retain the vendor identity used when issued.
- Inactive vendors remain on history but are excluded from new bills by default.

**Verification plan**

- Add RBAC tests for masked/revealed/edited payment data.
- Test vendor merge/duplicate handling and historical rendering.

## Story 4.4 — Recurring spend and subscriptions

**User story:** As a finance manager, I want recurring commitments matched to actual charges so that renewals and price changes are visible before they become surprises.

**High-level scope**

- Move Subscriptions to Spend → Recurring.
- Add owner, department, contract, renewal, payment source, expected charge, and matching.

**Implementation level**

- Extend subscription schema with contract dates, notice/cancellation date, owner, department, payment account/method, seats/usage, expected amount, tax, and monthly equivalent.
- Match bill/ledger/statement activity to expected charges.
- Add variance, price-change, failed-renewal, missing-owner, duplicate-tool, and upcoming-renewal attention items.
- Make Log Charge default expected values and create/match an underlying finance record.

**Acceptance criteria**

- Every logged charge links to a bill or ledger transaction.
- Expected-versus-actual variance is visible and explained.
- Renewal alerts occur before the configured notice deadline.
- “Auto-bill” does not imply payment execution unless an actual payment integration exists.

**Verification plan**

- Test monthly, annual, variable, paused, cancelled, and multi-currency subscriptions.
- Verify matching does not duplicate an existing statement or ledger entry.

---

# Phase 5 — Banking Workspace and Cash Operations

**Goal:** Replace the overloaded Accounts page with account-centered activity and guided transaction, transfer, withdrawal, and cheque flows.

## Story 5.1 — Account list and account workspace

**User story:** As a treasury user, I want to see the health of each account and open its activity, reconciliation, statements, and details in one place.

**High-level scope**

- Create a concise account list and account workspace.
- Separate book, bank, available, and reconciled balances.

**Implementation level**

- Update account list with institution/custodian, currency, masked identifier, balance types, unreconciled count, last import/feed, and status.
- Build workspace tabs: Activity, Reconcile, Statements, Details.
- Keep a sticky context header with balance definitions, last reconciled date, import/connection state, and permitted actions.
- Add searchable country selector and opening-balance date/offset behavior to account setup.
- Prevent ordinary currency changes after postings.

**Acceptance criteria**

- Account identifiers are masked by default and reveal is permission-gated.
- Every displayed balance has a definition and “as of” time/date.
- Account actions default to the active account and cannot silently post elsewhere.
- Settings are no longer mixed into account operational tabs.

**Verification plan**

- Test bank and cash accounts, inactive accounts, no-activity accounts, and foreign currency.
- Verify masking and reveal audit across roles.

## Story 5.2 — Guided transaction entry

**User story:** As a finance operator, I want to record Money In, Money Out, Bank Fee, or Adjustment with only relevant fields so that manual ledger entry is understandable.

**High-level scope**

- Replace generic In/Out entry with progressive transaction types and financial preview.

**Implementation level**

- Add transaction-type first step and conditional fields.
- Default account, date, currency, and prior context.
- Add counterparty, category/account, payment method, tax, reference, attachment, FX, base equivalent, and reason.
- Restrict Adjustment to accounting roles and show journal preview.
- Apply safe-command framework from Story 0.4.

**Acceptance criteria**

- Only fields relevant to the selected type are shown.
- Currency and account mismatch cannot be posted silently.
- Preview describes the balance/ledger effect in plain language.
- Manual adjustments require authorization and reason.

**Verification plan**

- Test each type with zero, negative, oversized, missing-rate, and closed-period cases.
- Confirm resulting balances and activity timeline.

## Story 5.3 — Transfer and withdrawal composer

**User story:** As a treasury user, I want to see both sides of a transfer and its conversion so that I can confirm exactly what leaves and arrives.

**High-level scope**

- Build From, To, Conversion, Timing, and Review sections.
- Replace “confirmed leg” terminology with an in-transit/matching model.

**Implementation level**

- Display source/destination balances, amounts, currencies, explicit FX direction, implied rate, fees, reference, initiated date, expected date, and settlement state.
- Compute one of rate/from/to amount from the other two; detect inconsistent combinations.
- Reject same-account transfers and enforce balance/period policy.
- Show both ledger legs and resulting balances before post.
- Represent single-leg external movement as In Transit/Awaiting Match with later pairing.

**Acceptance criteria**

- User cannot create a transfer from an account to itself.
- FX direction and both resulting amounts are unambiguous.
- Both legs post atomically for internal transfers.
- In-transit transfers can be matched without creating duplicate legs.

**Verification plan**

- Test same-currency, cross-currency, fee, teller withdrawal, external one-leg, failure rollback, and later match.
- Verify implied-rate rounding against service calculations.

## Story 5.4 — Cheque lifecycle

**User story:** As a finance user, I want cheque issuance and exceptions to follow valid states so that the register and ledger remain trustworthy.

**High-level scope**

- Expand cheque lifecycle and conditional issue form.

**Implementation level**

- Add Draft, Issued, Outstanding, Cleared, Bounced, Stopped, Voided, Replaced states/transitions as appropriate to workflow/settlement separation.
- Add sequence/duplicate check per account, signer/authorization, attachment, stale-date warning, replacement link, and reason/evidence for exceptions.
- Show destination cash account only for cash withdrawal and bill link only for bill payment.
- Define configurable posting policy at issue versus clearance and display it.

**Acceptance criteria**

- Invalid transitions are rejected server-side.
- Duplicate cheque number per account is blocked.
- Bounce/void/replacement produces correct linked reversals and history.
- Conditional fields and accounting effect match purpose and posting policy.

**Verification plan**

- Add a transition-matrix test and ledger assertions for each terminal/exception state.
- Browser-test conditional fields, warning thresholds, and replacement navigation.

---

# Phase 6 — Statement Import, Reconciliation, and Close

**Goal:** Make statement import recoverable and reconciliation explainable, auditable, and closable only when balanced.

## Story 6.1 — Statement import wizard

**User story:** As a reconciler, I want to preview and validate an import before it affects work queues so that format errors and duplicates are caught early.

**High-level scope**

- Replace the single upload modal with Choose, Upload, Map/Preview, Validate, and Import steps.

**Implementation level**

- Use one accessible month/period control, not synchronized duplicate controls.
- Capture account, period, opening/closing statement balance, file, encoding, date format, decimal separator, and format.
- Preview actual rows and column mapping; save reusable templates per bank/account format.
- Add file/line fingerprints, duplicate import detection, validation summary, rejected-row export, and resumable review state.
- Keep PDF extraction explicitly review-required.

**Acceptance criteria**

- No statement line is committed before preview and validation confirmation.
- Duplicate files/lines are detected before import.
- Mapping errors identify the row/column and correction path.
- PDF imports never auto-confirm parsed data.
- Interrupted imports can resume or be safely discarded.

**Verification plan**

- Test CSV layouts, encodings, date/decimal conventions, duplicate file, overlapping periods, malformed rows, and PDF review state.
- Confirm opening/closing totals against parsed lines.

## Story 6.2 — Side-by-side reconciliation workspace

**User story:** As a reconciler, I want suggested matches next to each statement line so that I can match, split, create, or explain exceptions quickly.

**High-level scope**

- Create full-page side-by-side reconciliation with progress and balance difference.

**Implementation level**

- Show statement line on the left and ranked existing matches/create/categorize controls on the right.
- Add confidence and rationale based on amount, date, reference, counterparty, and existing links.
- Support one-to-one, one-to-many, many-to-one, split, create, transfer pair, cheque clear, and ignore-with-reason.
- Show statement balance, book balance, difference, resolved amount/count, and remaining items at all times.
- Prevent a line/transaction from being matched twice.

**Acceptance criteria**

- Every suggested match explains why it was suggested.
- Confirming a match updates progress and balances without full-page reload.
- Splits must equal the source amount within currency precision.
- Ignored lines require reason and remain in the audit report.
- Concurrent resolution attempts cannot create duplicate matches.

**Verification plan**

- Build deterministic fixtures for each match cardinality and cheque/transfer case.
- Add concurrency tests and browser tests for keyboard reconciliation.
- Measure time and errors per 100 lines against the baseline flow.

## Story 6.3 — Reconciliation rules

**User story:** As a repeat reconciler, I want approved rules to suggest or apply routine categorization so that repetitive statement work is reduced without hiding risk.

**High-level scope**

- Add rules for description, counterparty, amount range, account, category, payment method, and action.

**Implementation level**

- Add ordered rules with active state, conditions, scope, preview count, creator/approver, and last-used metadata.
- Start in suggestion-only mode; permit auto-apply only for explicitly approved low-risk rule types.
- Detect rule conflicts and show winning rule/rationale.
- Add dry-run preview against existing unmatched lines.

**Acceptance criteria**

- A new or changed rule shows affected examples before activation.
- Conflicts are visible and deterministic.
- Auto-applied results are identifiable and reversible.
- Deactivating a rule does not rewrite historical reconciliations.

**Verification plan**

- Unit-test operators, ordering, conflicts, precision boundaries, and permissions.
- Verify suggestion-only versus auto-apply behavior with seeded lines.

## Story 6.4 — Reconcile, close, and reopen controls

**User story:** As a controller, I want a period to close only when balanced, with controlled reopening, so that completed reconciliation remains reliable.

**High-level scope**

- Add zero-difference gate, completion report, period state, and reopen approval.

**Implementation level**

- Add Open, Reconciled, Closed, and Reopened states plus close/reopen actor, date, and reason.
- Block close when difference is non-zero or blocking exceptions remain, unless an authorized documented exception policy allows it.
- Generate a reconciliation report covering cleared, uncleared, created, ignored, adjusted, and exception items.
- Enforce posting rules for closed periods and route corrections to the current period where policy requires.

**Acceptance criteria**

- Ordinary users cannot close a non-zero reconciliation or post into a closed period.
- Completion report totals reproduce the close decision.
- Reopening requires permission and reason and appears in audit history.
- Closing/reopening is idempotent and safe under concurrent requests.

**Verification plan**

- Test close gates, override policy, late postings, reopen, re-close, and concurrent close.
- Recalculate report totals independently in backend tests.

---

# Phase 7 — Reports and Decision Support

**Goal:** Replace isolated operational exports with a traceable report library and core financial views.

## Story 7.1 — Standard report library and shell

**User story:** As a finance user, I want reports organized by business question and controlled by one consistent filter shell.

**High-level scope**

- Group reports into Performance, Cash & Banking, Sales & Receivables, Spend & Payables, Payroll, and Audit & Compliance.

**Implementation level**

- Replace horizontal report tabs with a searchable report library.
- Build a shared report shell with entity, period, basis, currency, comparison, group-by, filters, generation state, saved view, drill-down, and export menu.
- Add report metadata and permission checks.
- Add sticky headers/first columns and accessible horizontal navigation for matrices.

**Acceptance criteria**

- Existing reports remain available through the library with equivalent filters and exports.
- Applied filters and data freshness are always visible.
- Saved views restore the full report definition.
- Report totals can drill into contributing records without losing context.

**Verification plan**

- Regression-compare existing report totals/exports before and after shell migration.
- Test deep links, saved views, large matrices, and mobile filter behavior.

## Story 7.2 — Core accounting and aging reports

**User story:** As a finance manager/controller, I want standard financial and aging reports so that operational data can support month-end review.

**High-level scope**

- Add Profit & Loss, Balance Sheet, Cash Flow, Trial Balance, General Ledger, AR Aging, AP Aging, and Bank Reconciliation reports.

**Implementation level**

- Confirm chart-of-accounts mapping and report-basis rules before implementation.
- Add report services with point-in-time and period semantics, base-currency conversion policy, and drill-down identifiers.
- Label management-only reports distinctly until accounting validation is signed off.
- Add comparison period and subgrouping where valid.

**Acceptance criteria**

- Trial Balance debits equal credits for posted data.
- P&L, Balance Sheet, and Cash Flow agree with source ledger rules and period boundaries.
- Aging buckets use outstanding balance and correct as-of date.
- Reconciliation report matches the closed statement report.
- Every material line drills to sources.

**Verification plan**

- Create a golden accounting fixture with opening balances, invoices, bills, payments, transfer, FX, reversal, and close.
- Independently validate outputs with the finance owner/accountant before production label removal.

## Story 7.3 — Controlled exports and scheduled delivery

**User story:** As an authorized user, I want exports to preserve context and sensitive-data rules so that offline files remain understandable and controlled.

**High-level scope**

- Standardize Excel/PDF/CSV exports and optional scheduled delivery.

**Implementation level**

- Include report name, entity, basis, currency, filters, generated time, and requesting user in export metadata.
- Apply role-based column redaction and export permission.
- Add export audit events, async generation for large files, progress, expiry, and safe download.
- Add scheduling only after permission and recipient policy are defined.

**Acceptance criteria**

- Export totals match the visible report under identical filters.
- Unauthorized sensitive columns are absent, not merely hidden in UI.
- Large exports do not block the browser request lifecycle.
- Every export/download is auditable.

**Verification plan**

- Compare visible totals to generated files for every format.
- Test authorization, expiry, repeated download, large data, and formula-injection defenses.

---

# Phase 8 — Payroll UX, Mobile Tasks, and Release Hardening

**Goal:** Complete the remaining high-risk workflow, optimize common mobile tasks, and release through measurable gates.

## Story 8.1 — Guided payroll run

**User story:** As a payroll operator, I want a controlled run from readiness through payment and journal posting so that payroll cannot be finalized with hidden exceptions.

**High-level scope**

- Replace placeholder payroll with Select, Review Changes, Resolve Exceptions, Preview, Approve, Finalize, Fund/Pay, and Post Journal.

**Implementation level**

- Add payroll run workflow states, readiness checks, prior-period variance, approval, finalization lock, payment result, liability summary, payslip generation, and journal link.
- Mask compensation/bank data by role.
- Add maker-checker and correction workflow after finalization.
- Integrate payroll obligations into dashboard forecast and attention queue.

**Acceptance criteria**

- Run Payroll is visible only when executable and authorized.
- Blocking exceptions prevent finalization and explain their correction path.
- Preview reconciles gross, deductions, net, employer cost, liabilities, and journal totals.
- Finalized runs cannot be silently edited.
- Partial payment failure is visible and recoverable without rerunning successful payments.

**Verification plan**

- Test joiner/leaver, raise, unpaid leave, deduction, missing bank data, prior-period variance, approval denial, partial payment failure, and correction.
- Reconcile payroll report, payment totals, and journal fixture.

## Story 8.2 — Mobile priority workflows

**User story:** As an approver or operator away from a desk, I want urgent finance tasks optimized for touch without exposing complex accounting work in an unsafe layout.

**High-level scope**

- Optimize approvals, receipt/bill capture, status checks, urgent exceptions, and simple payment review.
- Keep reconciliation and complex report authoring desktop-first unless proven usable.

**Implementation level**

- Define mobile card hierarchy and sticky primary actions.
- Add camera/file capture where supported.
- Ensure tables convert to labeled cards without losing currency/status context.
- Add responsive drawer/dialog full-screen behavior and safe keyboard handling.

**Acceptance criteria**

- Priority mobile tasks complete without horizontal page scrolling.
- Touch targets, focus, and zoom remain usable.
- Sensitive values are masked in mobile notifications and summaries.
- Complex unsupported tasks give a clear desktop recommendation rather than a broken layout.

**Verification plan**

- Run Playwright at agreed phone/tablet viewports and manual checks on iOS Safari and Android Chrome.
- Test with large text and 200% zoom.

## Story 8.3 — Performance, observability, and rollout

**User story:** As a product owner, I want measurable quality gates and safe rollout so that the redesign improves real finance work without destabilizing existing operations.

**High-level scope**

- Add performance targets, error observability, feature flags, migration monitoring, pilot rollout, and UX outcome tracking.

**Implementation level**

- Instrument page/API latency, failed commands, retries, duplicate prevention, reconciliation throughput, approval turnaround, and task completion.
- Add correlation IDs from UI command to audit event.
- Define feature flags by phase and role/company.
- Pilot with finance operator, manager, and controller personas before full release.
- Resolve frontend deployment configuration warnings and ensure `config.js`/API base behavior is validated in packaged builds.

**Acceptance criteria**

- Critical finance command failures are observable with record-safe diagnostics.
- Feature flags can disable a new workflow without corrupting records or hiding already-created data.
- Production build and smoke tests pass with deployment configuration.
- Pilot exit criteria are met and signed off before general rollout.

**Verification plan**

- Conduct load tests on large transaction, statement, and report datasets.
- Run failure-injection for API timeout, duplicate retry, partial dependency failure, and expired session.
- Execute a production-like build, deploy smoke suite, rollback drill, and pilot usability study.

---

# Cross-Cutting Permission Model

The following permissions should be explicit capabilities rather than one broad finance-admin flag:

- View finance summary.
- View sensitive account identifiers.
- Create and edit drafts.
- Submit for approval.
- Approve within amount limit.
- Post manual transaction.
- Record/reverse payment.
- Initiate/approve transfer.
- Issue/change cheque state.
- Upload statement.
- Reconcile statement lines.
- Close/reopen period.
- Run/finalize payroll.
- View compensation details.
- Export standard/sensitive reports.
- Manage finance settings and rules.

Backend authorization is authoritative. UI visibility only improves usability.

# Cross-Cutting Audit Events

At minimum, audit:

- Creation and field changes.
- Submission, approval, rejection, delegation, and override.
- Issue/send/delivery/reminder events.
- Payment, transfer, cheque transition, reversal, and correction.
- Statement upload, mapping, match, split, create, ignore, close, and reopen.
- Sensitive-value reveal and payment-instruction change.
- Report generation, export, and download.
- Payroll preview, approval, finalization, payment, correction, and posting.

Each event should include actor, timestamp, object, action, source, reason/comment where applicable, and structured before/after data with sensitive-value redaction.

# Recommended Pull Request Sequence

1. `FUX-001` Verified loading and readiness states.
2. `FUX-002` Shared money/date/status primitives.
3. `FUX-003` Accessible modal/form framework.
4. `FUX-004` Safe command/idempotency/reversal framework.
5. `FUX-101` Finance navigation and Settings move.
6. `FUX-102` Shared finance table.
7. `FUX-103` Detail drawer and timeline.
8. `FUX-201` Dashboard context and KPIs.
9. `FUX-202` Needs-attention queue.
10. `FUX-203` Cash position and forecast.
11. `FUX-301` Invoice queue/detail.
12. `FUX-302` Invoice editor/lifecycle.
13. `FUX-303` Collections/payments.
14. `FUX-304` Customer 360.
15. `FUX-401` AP inbox/capture.
16. `FUX-402` Bill approval/payment.
17. `FUX-403` Vendor profile/security.
18. `FUX-404` Recurring spend.
19. `FUX-501` Account workspace.
20. `FUX-502` Guided transaction entry.
21. `FUX-503` Transfer/withdrawal composer.
22. `FUX-504` Cheque lifecycle.
23. `FUX-601` Statement import wizard.
24. `FUX-602` Reconciliation workspace.
25. `FUX-603` Reconciliation rules.
26. `FUX-604` Close/reopen controls.
27. `FUX-701` Report library/shell.
28. `FUX-702` Core statements/aging.
29. `FUX-703` Controlled exports.
30. `FUX-801` Guided payroll.
31. `FUX-802` Mobile priority workflows.
32. `FUX-803` Performance, observability, and rollout.

# UX Success Measures

Capture a baseline before Phase 2 and compare after each relevant release:

- Time to identify top three urgent finance tasks.
- Time to create, approve, and send an invoice.
- Time to capture, approve, and pay a bill.
- Overdue receivable balance and collection cycle.
- Approval turnaround and rejection/resubmission rate.
- Automatic/suggested match acceptance rate.
- Reconciliation time per 100 statement lines.
- Correction, reversal, and duplicate-prevention rates.
- Percentage of records with required category, counterparty, memo, and evidence.
- Keyboard-only task completion.
- Accessibility defect count.
- Support requests by task and terminology.

# Final Release Gate

The finance UX transformation is complete only when:

- No user-facing placeholder or roadmap content remains.
- Core tasks are usable by a non-accountant without coaching.
- All high-risk commands use review, permission, audit, idempotency, and correction safeguards.
- Invoice, bill, banking, reconciliation, payroll, and report totals reconcile to golden fixtures.
- Critical workflows pass desktop, mobile-priority, keyboard, accessibility, dark-theme, and failure-state tests.
- Finance owner/controller signs off the accounting semantics and close reports.
- Pilot UX measures improve from baseline without a rise in financial correction or support rates.
