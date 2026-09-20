# Payroll Net-Payments Runner — Implementation Plan

**Status:** Proposed implementation plan  
**Target branch:** `feature/payroll`  
**Scope:** Current payroll payment runner and its supporting API, persistence, mock data, run details, exports, workflow controls, and tests  
**Decision owner:** Product/Finance  

## 1. Purpose

Redesign the current payroll feature as a **net-payment preparation and execution system**. The active payroll contract and UI must not calculate, store, request, return, or display gross pay, allowances, deductions, taxes, employer costs, statutory liabilities, or gross-to-net payslip data.

The central user task is:

> Prepare the final net amounts owed to employees, verify routes and destinations, resolve payment-readiness issues, submit the run for independent approval, and track payment execution.

This plan also replaces the current five-step runner with the approved four-step UX prototype:

1. Setup
2. Review payments
3. Resolve readiness issues
4. Confirm and submit for approval

No production behavior is changed by this document. Implementation must be delivered in small, independently reviewable pull requests as described below.

## 2. Authoritative scope decision

For the current payroll design, the following concepts are **out of scope** and must not appear in active payroll UI or API payloads:

- Gross pay or total gross
- Allowances
- Employee deductions
- Income tax or tax withholding
- Employee or employer insurance amounts
- Employer payroll cost
- Taxable/insurable classification flags
- Payroll-generated statutory obligations
- Liability summaries
- Gross-to-net payslips
- Gross, deduction, tax, liability, or employer-cost journal lines

The old percentage-based mock calculation is not to be corrected or zeroed; it is to be removed. Zero-valued legacy keys are still the wrong contract.

The current payroll runner is responsible only for:

- Period and payment date
- Final employee payment amount
- Payment route
- Funding account
- Masked payment destination
- Currency and locked conversion data only where an actual payment requires conversion
- Readiness status and actionable issue details
- Approval and execution status
- Failure reason, payment reference, and audit metadata

This decision supersedes conflicting guidance in `docs/payroll/07-review-table-and-deduction-removal-plan.md`, including guidance to retain deduction/tax/employer-cost fields at zero, retain taxable/insurable flags in the current payroll contract, or auto-create zero-value statutory obligations. It also supersedes any runner-specific wording in earlier payroll documents that treats the current feature as a gross-to-net calculation engine.

Compensation planning/reporting may remain a separate source domain if still required by FUX-416 through FUX-419, but the payment runner must consume only the final payable amounts and must not expose compensation-calculation internals in its current API or screens.

## 3. Current problems to remove

### 3.1 Domain and contract

- Mock payroll data includes fabricated deduction, tax, employer-cost, and liability values.
- Backend schemas and services preserve gross-to-net fields even when normal calculation sets them to zero.
- Finalization is coupled to liability/statutory-obligation generation.
- Payroll journal previews imply accounting behaviors that are not part of the net-payment runner.
- Similar concepts use inconsistent names across frontend mocks, backend responses, and UI rendering.

### 3.2 Runner UX

- The current runner has five steps and dedicates a full step to liabilities and journal entries.
- The review step emphasizes gross variance and abbreviated `EXT`/`INT` totals instead of recipient, route, destination, readiness, and final amount.
- Exceptions describe problems but do not consistently provide a direct correction path.
- Missing bank details are treated generically instead of being blocking only when the selected route requires a bank destination.
- Step indicators can imply completion based on navigation rather than successful validation or review.
- Cancel/close can discard reviewed work without confirmation.
- Funding-account load failures can fall back to a fabricated account instead of showing a blocking retry state.
- Recipient review does not scale well because search, filtering, sorting, sticky headers, and mobile card treatment are incomplete.
- Dialog semantics, focus management, keyboard behavior, and live status announcements are insufficient.

### 3.3 Workflow and controls

- `Create & Approve Run` combines preparation and approval.
- Maker-checker separation is not reliably enforced on the backend.
- The server has no durable stale-preview guard tying submission to the exact source data reviewed by the preparer.
- Run creation and submission need idempotency and duplicate-period protection.

### 3.4 Downstream surfaces

- Run details, exports, and employee-facing payslip views continue to expose deductions or other gross-to-net concepts.
- “Payslip” is misleading when the system stores only a final payment.

## 4. Target user journey

### Step 1 — Setup

Collect only the inputs needed to prepare payments:

- Payroll period
- Payment date
- External funding account when external bank payments exist
- Internal cash account when internal cash payments exist
- Currency/FX policy only where conversion is required by an actual payment

Behavior:

- Derived cycle dates are read-only.
- Funding accounts are real records loaded from the API; no synthetic fallback is permitted.
- Account-load failure is a blocking inline error with **Retry**.
- Changing a setup input after preview generation marks the preview stale.
- Primary action: **Preview payments**.
- Secondary action: **Save draft**.

### Step 2 — Review payments

Make recipient verification the central working view.

Summary metrics:

- Total net payment
- Recipient count
- Change from prior run's total net payment
- Blocking issue count and warning count

Recipient presentation:

- One top-level row/card per employee
- Expandable payment lines when an employee has multiple routes
- Employee name and department
- Route shown with plain-language labels such as `External bank payment` and `Internal cash payment`
- Masked destination
- Final payment amount
- Change from prior period
- Readiness status

Interactions:

- Search recipient or destination
- Filter by route and readiness status
- Sort by recipient, amount, change, route, or status
- Expand/collapse payment lines
- Sticky table header on desktop
- Accessible card layout on mobile

No gross, allowance, deduction, tax, employer-cost, or liability values appear.

### Step 3 — Resolve readiness issues

Separate issues into two severities:

**Blocking**

- Missing or invalid final payment amount
- Missing verified destination for a bank-routed payment
- Missing required funding account
- Invalid or unavailable payment route
- Inactive/ineligible employee
- Duplicate period/run conflict
- Insufficient permission
- Stale preview

**Warnings**

- Unusual change from prior net payment
- Newly added recipient
- Changed payment destination
- Manual payment-amount override

Every issue must include:

- Employee/payment context
- Specific explanation
- Severity
- Direct action such as **Fix employee**, **Change route**, or **Review payment**
- A correction path that preserves runner state

**Recheck payments** refreshes the preview and reports added, removed, changed, and resolved items. Submission remains disabled while blocking issues exist.

### Step 4 — Confirm

Show an immutable summary of what will be submitted:

- Period and payment date
- Recipient and payment-line counts
- Total payment amount
- Totals by route and funding account
- Blocking/warning status
- Warnings reviewed
- Preparer identity
- Preview generation time
- Preview identifier/version

Actions:

- Primary: **Submit for approval**
- Secondary: **Save draft**
- Back: **Readiness**

The confirmation screen must state that submission creates an approval request and that the preparer cannot approve their own run.

## 5. Canonical net-payment contract

Exact naming should follow the nearest repository conventions, but one meaning must have one canonical field.

### 5.1 Preview request

Required fields:

- `period_start`
- `period_end`
- `payment_date`
- `external_funding_account_id` when required
- `internal_funding_account_id` when required
- FX inputs only when required

The request must not accept deduction, tax, gross, employer-cost, or liability inputs.

### 5.2 Preview response

Proposed shape:

```json
{
  "preview_id": "PRV-SEP26-0042",
  "preview_version": 1,
  "generated_at": "2026-09-20T13:54:00Z",
  "setup": {
    "period_start": "2026-09-01",
    "period_end": "2026-09-30",
    "payment_date": "2026-09-30"
  },
  "summary": {
    "recipient_count": 2,
    "payment_line_count": 3,
    "total_payment_amount": 29000.0,
    "prior_period_total": 27500.0,
    "change_amount": 1500.0
  },
  "funding_totals": [],
  "recipients": [],
  "issues": [],
  "source_version": "opaque-server-version"
}
```

Each payment line contains only what is necessary to verify and execute the payment:

- Stable line identifier
- Employee identifier and display name
- Department where useful for review
- Route
- Amount and currency
- Masked destination
- Funding account identifier/display summary
- Readiness/payment status
- Change metadata
- Failure reason/reference where applicable

### 5.3 Submission request

Submission must reference the reviewed preview:

- `preview_id`
- `preview_version`
- `source_version`
- Idempotency key
- Warning acknowledgements, if policy requires explicit acknowledgement

The backend recalculates/validates authoritative totals. Client-submitted totals are not trusted.

### 5.4 Compatibility strategy

1. Inventory all readers/writers of removed payroll fields across backend, frontend, mock mode, exports, and tests.
2. Stop emitting removed fields from the new preview/create/detail DTOs.
3. If historical sheet/database columns must remain temporarily, isolate them behind repository mapping; do not leak them into current DTOs.
4. If persisted historical records need display, map them to net-only payment details using their final payment value.
5. Add a deprecation/migration note for any external consumer found during inventory.
6. Do not silently reinterpret gross as net. Only migrate values proven to represent the actual final payment.

## 6. Backend implementation

### 6.1 Schemas and models

Primary files to inspect/change:

- `be/finance/schemas.py`
- `be/finance/models.py`
- Payroll repository modules used by `payroll_service.py`
- Relevant migrations or Google Sheet schema helpers

Changes:

- Introduce net-payment-only request and response DTOs.
- Remove forbidden fields from current payroll DTOs.
- Add preview/version metadata needed for stale-preview protection.
- Add issue DTOs with severity, code, entity context, and correction path.
- Preserve historical columns only when required for migration/compatibility, clearly separated from the current contract.
- Add specific external/internal funding account references if not already represented correctly.

### 6.2 Payroll service

Primary file:

- `be/finance/services/payroll_service.py`

Changes:

- Remove all hardcoded deduction, tax, insurance, and employer-cost calculations.
- Calculate every run total strictly as the sum of its final payment lines.
- Remove liability-summary generation from the current payroll lifecycle.
- Stop auto-creating statutory obligations during current payroll finalization.
- Produce readiness issues based on route-specific requirements.
- Generate an opaque source version from the authoritative inputs that affect the preview.
- Reject submission with a dedicated stale-preview error when source data changed.
- Reject duplicate period submissions according to the established payroll uniqueness rule.
- Make creation/submission idempotent.
- Separate draft creation, submission, approval, finalization, and payment execution transitions.
- Prohibit self-approval server-side regardless of frontend state.
- Split net outflow posting by actual funding account/route only when ledger posting is part of the accepted workflow.
- Never create deduction, tax, employer-cost, or liability journal lines.

### 6.3 Authorization and audit

- Reuse `require_permission(...)`; UI visibility is not authorization.
- Define separate permissions for prepare, submit, approve, and execute if existing permissions do not already express them.
- Store preparer, submitter, approver, executor, timestamps, and transition audit details.
- Return a specific domain error for self-approval attempts.
- Mask destination data in all list/preview responses; expose only the minimum required detail through authorized backend flows.

### 6.4 Persistence and migration

- Create an idempotent migration only if net-payment, funding, preview-version, or approval-audit fields are missing.
- Do not drop historical columns until all compatibility readers are removed and rollback requirements are agreed.
- Backfill only values that can be derived without guessing.
- Document unmigratable legacy data and keep it read-only if necessary.
- Provide rollback instructions for schema additions and feature-flag activation.

## 7. Frontend implementation

### 7.1 Markup

Primary file:

- `fe/src/partials/admin/sections/finance-payroll.html`

Changes:

- Replace the five-step wizard with the four target steps.
- Remove liabilities/journal markup and all forbidden payroll labels.
- Add semantic step navigation and explicit current/complete/warning/blocked states.
- Add recipient review table plus mobile card representation.
- Add search, route filter, status filter, sorting controls, and expanded payment-line regions.
- Add actionable readiness cards and recheck summary.
- Add immutable confirmation summary.
- Replace `Create & Approve Run` with `Submit for approval`.
- Add cancel/discard confirmation after preview generation or user edits.
- Add proper dialog title, description, close control, and live status region.

### 7.2 Controller/state model

Primary file:

- `fe/public/js/finance-payroll.js`

Changes:

- Replace navigation-derived completion with explicit validation/review state.
- Centralize runner state: setup, preview, filters, expanded rows, issue acknowledgements, dirty/stale state, and submission state.
- Remove deduction, gross, tax, employer-cost, liability, and journal mapping/rendering.
- Group payment lines by employee for the review screen while preserving expandable line detail.
- Do not create a synthetic funding account on API failure.
- Invalidate the preview when setup inputs change.
- Keep corrections and rechecks in the same runner context.
- Add keyboard behavior, focus movement on step changes, focus trap/restore, Escape handling, and `aria-live` announcements.
- Prevent double submission and surface backend idempotency/stale-preview errors inline.
- Keep the main action singular and visually dominant for each step.

### 7.3 Styles

Use existing finance/payroll tokens and stylesheet organization. Add only scoped styles needed for:

- Four-step responsive stepper
- Dense recipient table and sticky header
- Mobile recipient cards
- Warning/blocker states that do not rely on color alone
- Sticky mobile action bar
- Focus-visible states
- Loading skeletons, empty states, and inline errors

Do not introduce a frontend framework or a parallel design system.

### 7.4 Run details and employee surface

- Remove forbidden fields from run list/detail views.
- Rename `Employee Pay Slip` to `Payment details` or `Payment receipt`.
- Show only final amount, route, masked destination, payment date, reference, status, and failure/retry information.
- Retain line-level audit detail where useful, but keep it net-payment-only.
- Ensure retry actions apply only to failed executable payment lines and are permission guarded.

### 7.5 Exports

- Replace gross-to-net exports with net-payment exports.
- Export recipient, employee ID where permitted, route, masked destination, amount, currency, funding account, payment date, status, and reference.
- Remove deduction, tax, allowance, gross, employer-cost, and liability columns.
- Add regression tests for headers and totals.

## 8. Mock-mode implementation

Primary files:

- `fe/api/finance/payroll-api.js`
- `fe/finance-api.js` where bundled mock behavior is maintained
- Any payroll fixture/state module used by `FinanceMockState`

Requirements:

- Remove forbidden keys completely; do not leave zero placeholders.
- Keep deterministic fixtures for:
  - Valid external bank payment
  - Valid internal cash payment
  - Employee with multiple payment routes
  - Missing required destination blocker
  - Missing funding account blocker
  - Changed net-payment warning
  - New recipient warning
  - Changed destination warning
  - Duplicate period conflict
  - Stale preview rejection
  - Self-approval rejection
  - Partial execution failure
  - Retry success
  - Account-load failure and retry
- Model draft, submitted, approved, finalized/ready, processing, partially paid, paid, and failed states only if they are valid in the accepted backend lifecycle.
- Keep mock-mode limitations explicit; backend tests remain authoritative for permissions, persistence, concurrency, and financial integrity.

## 9. Workflow state machine

Use the smallest set of explicit states that matches established repository conventions. The intended transition model is:

```text
Draft -> Submitted for approval -> Approved -> Ready/Finalized -> Processing -> Paid
                                  -> Rejected -> Draft
                                                   -> Partially paid / Failed -> Retry -> Processing
```

Rules:

- Only drafts can be edited.
- Submission requires a current preview and zero blockers.
- The preparer cannot approve their own run.
- Approval does not execute payment.
- Execution is idempotent at run and payment-line level.
- Retry targets only failed lines and must not duplicate successful payments.
- Every transition is permission checked and audited.
- Exact names should reuse existing states where their semantics are already correct; do not add aliases for identical states.

## 10. Accessibility and defensive UX

Acceptance requirements:

- Dialog exposes correct role/name/description.
- Opening moves focus into the runner; closing restores focus to the trigger.
- Tab/Shift+Tab stay within the open dialog.
- Escape invokes the same safe-cancel logic as the close button.
- Step changes move focus to the new step heading and announce the change.
- Loading, error, recheck, stale-preview, and submission results use an appropriate live region.
- Every interactive target is at least 44 by 44 CSS pixels on touch layouts.
- Status is represented by text/icon as well as color.
- Mobile has one scroll region and a non-obscuring sticky action bar.
- Empty/loading/error states are intentionally designed.
- Reduced-motion preferences are honored.

## 11. Test strategy

### 11.1 Backend tests

Add or update focused tests for:

- Current DTOs omit every forbidden field.
- Preview total equals the sum of final payment lines.
- Route-specific destination validation.
- Required funding-account validation.
- Duplicate-period protection.
- Stale-preview rejection after compensation/payment source, destination, route, or funding input changes.
- Idempotent creation/submission and payment execution.
- Maker-checker self-approval rejection.
- Permission enforcement for prepare/submit/approve/execute.
- Approval does not execute payment.
- Ledger/outflow entries contain only real net payments split by actual funding account.
- Finalization creates no statutory obligation or liability rows.
- Retry does not duplicate successful lines.
- Historical record compatibility, where required.

Likely existing tests to update include payroll split/FX, commission/bonus, workflow/finalization, and schema serialization tests under `be/tests/`.

### 11.2 Playwright tests

Primary existing spec to replace/update:

- `fe/tests/ui/finance-guided-payroll.spec.js`

Cover:

1. Four-step happy path for external and internal payments.
2. Review table grouping and expansion.
3. Search, filters, sorting, and zero-results state.
4. Blocking missing bank destination for external route.
5. Internal cash route not blocked by irrelevant bank data.
6. Warning review and acknowledgement.
7. Direct correction action, preserved state, and recheck diff.
8. Funding-account API failure with no synthetic fallback.
9. Setup edit invalidates preview.
10. Backend stale-preview rejection.
11. Save draft and resume if supported by current product behavior.
12. Submit-for-approval wording and state transition.
13. Self-approval rejection.
14. Double-click/double-submit protection.
15. Safe cancel/discard confirmation.
16. Keyboard-only navigation and focus restoration.
17. Live announcements for steps, blockers, and async outcomes.
18. Mobile recipient cards and sticky actions at 375px.
19. Payment details/receipt with no forbidden fields.
20. Net-payment CSV headers and summed amount.

Delete assertions for five steps, liabilities, gross totals, deductions, tax, employer cost, and journal rows.

### 11.3 Required verification sequence

For every frontend implementation PR:

1. Run `npm run build` in `fe/`.
2. Run the single targeted payroll Playwright spec with `--reporter=line`.
3. Run relevant backend tests with `-q`/`--tb=short`.
4. Run the broader payroll regression set once before final commit.
5. Inspect `git diff --stat` and scoped diffs; do not commit generated or temporary artifacts unless the repository intentionally tracks them.

## 12. Delivery plan

### PR 1 — Contract and calculation cleanup

- Add net-payment-only DTOs.
- Remove fabricated calculations and forbidden fields from active payroll responses.
- Make totals line-sum based.
- Remove liability/statutory generation from current payroll finalization.
- Add compatibility mapping/migration where required.
- Add backend contract and calculation tests.

**Exit criteria:** no current API payload emits forbidden fields; no service calculates them.

### PR 2 — Mock and frontend data cleanup

- Replace mock fixtures with net-payment-only fixtures.
- Align `payroll-api.js` and bundled finance mock behavior.
- Remove obsolete frontend mappings before visual redesign.
- Add deterministic error/stale/partial-failure scenarios.

**Exit criteria:** mock mode accurately represents the new contract and contains no forbidden keys.

### PR 3 — Four-step runner

- Implement Setup, Payments, Readiness, and Confirm.
- Add grouped recipient review, expansion, search, filters, and sorting.
- Add route-aware blockers/warnings and direct correction actions.
- Add stale/dirty state and recheck diff.
- Remove liabilities/journal step.

**Exit criteria:** all four steps work end to end in mock mode and match the accepted prototype behavior.

### PR 4 — Approval and integrity controls

- Separate draft, submit, approve, and execute actions.
- Enforce maker-checker server-side.
- Add preview/source version validation.
- Add idempotency and duplicate protection.
- Add transition audit metadata.

**Exit criteria:** preparer cannot self-approve; changed source data cannot be submitted without re-preview; repeated requests do not duplicate work.

### PR 5 — Details, exports, and execution states

- Convert payslip to payment details/receipt.
- Clean run list/detail surfaces.
- Replace CSV export columns.
- Implement/verify partial failure and safe retry behavior.
- Ensure ledger posting is net-only and split by actual funding source.

**Exit criteria:** every downstream payroll surface is net-payment-only.

### PR 6 — Accessibility and responsive hardening

- Complete dialog/focus/live-region behavior.
- Add safe cancel flow.
- Finish mobile cards/sticky actions and large-recipient behavior.
- Add keyboard/mobile/async error Playwright coverage.

**Exit criteria:** runner is usable by keyboard and at 375px without loss of functionality or obscured content.

## 13. File impact checklist

Expected files/modules; confirm exact repository/repository-class names during implementation:

- `be/finance/schemas.py`
- `be/finance/models.py`
- `be/finance/services/payroll_service.py`
- Payroll router and repository modules
- Migration/schema initialization files if persistence changes
- Payroll-related tests under `be/tests/`
- `fe/src/partials/admin/sections/finance-payroll.html`
- `fe/public/js/finance-payroll.js`
- Existing scoped finance/payroll stylesheet(s)
- `fe/api/finance/payroll-api.js`
- `fe/finance-api.js`
- `fe/tests/ui/finance-guided-payroll.spec.js`
- Any payroll run-detail/export/payment-receipt specs

Do not edit `fe/dist/index.html` unless repository policy explicitly tracks a production build artifact for this branch.

## 14. Release and rollback

- Gate the new runner/contract behind an existing feature-flag mechanism if one exists; do not invent a parallel flag framework.
- Deploy additive schema changes before code that requires them.
- Observe preview failures, stale-preview frequency, submission failures, approval failures, execution failures, and retry outcomes without logging sensitive destination data.
- Keep the old read path only for a short, documented compatibility window if historical records require it.
- Rollback must disable the new path without corrupting newly created net-payment runs.
- Do not roll back by restoring fabricated deductions or liabilities.

## 15. Final acceptance criteria

The implementation is complete only when all criteria below pass:

1. No active payroll request, response, mock fixture, screen, export, or receipt contains gross, allowance, deduction, tax, insurance, employer-cost, taxable/insurable, or liability fields.
2. Every run total equals the sum of its final payment lines, verified server-side.
3. The runner has exactly four steps: Setup, Payments, Readiness, Confirm.
4. There is no liabilities/journal step.
5. Account-loading failure never creates or displays a fabricated account.
6. External bank payments without a valid destination are blocking.
7. Internal cash payments are not blocked by irrelevant bank-detail requirements.
8. Every readiness issue has a severity, explanation, and direct correction/review action.
9. Editing setup or authoritative source data invalidates the preview.
10. Submission references a current preview/source version and is idempotent.
11. The preparer cannot approve their own run, enforced on the backend.
12. Approval and payment execution are separate actions.
13. Finalization creates no payroll statutory obligations or liability records.
14. Ledger/outflow posting, where applicable, contains only actual net payments by funding source.
15. Run details and exports are net-payment-only.
16. `Payslip` is replaced by `Payment details`/`Payment receipt` unless a true gross-to-net payslip product is introduced later.
17. Partial failures can be retried without duplicating successful payments.
18. The dialog and step flow meet keyboard, focus, announcement, contrast, and touch-target requirements.
19. Desktop and 375px mobile flows pass Playwright coverage.
20. `npm run build`, targeted backend tests, targeted payroll Playwright tests, and final payroll regressions pass before merge.

## 16. Non-goals

- Building a tax or social-insurance calculation engine
- Reproducing government portal calculations
- Adding new compensation-planning features unrelated to final payment preparation
- Replacing the vanilla frontend stack
- Refactoring unrelated finance modules
- Dropping historical columns before compatibility and rollback needs are resolved
- Treating mock mode as proof of backend authorization, persistence, concurrency, or financial integrity
