# HRFlow Payroll v9 — UI-Only Prototype-Parity Closure Plan

**Version:** 2 — prototype artifact availability clarified  
**Prepared:** September 28, 2026  
**Target branch / implementation truth:** `feature/payroll-deductions`  
**Functional baseline to preserve:** current branch HEAD after commit `9b2325c86a` — `feat(payroll): execute revised integration and state machine (Phases -1 to B3)`  
**Canonical visual source:** `docs/payroll/payroll-full-cycle-prototype-v9.html`  
**Plan type:** UI-only presentation-parity closure  
**Owner objective:** Make the production payroll UI a faithful visual port of the approved v9 prototype while continuing to use only real, existing API-backed payroll data.

---

## 1. Required Delivery Package

This plan is not executable unless the exact approved v9 prototype is present in the repository at the required path.

Before the coding agent starts, the branch must contain these files together:

```text
docs/payroll/
├── payroll-v9-ui-only-prototype-parity-closure-plan-v2.md
└── payroll-full-cycle-prototype-v9.html
```

### 1.1 Prototype availability gate

The coding agent must stop before investigation or code changes if any condition below is true:

- `docs/payroll/payroll-full-cycle-prototype-v9.html` is absent.
- The file is unreadable or is not the owner-approved v9 artifact.
- The file has been substituted with a different prototype without owner approval.
- The agent is asked to use `docs/payroll/payroll-final-prototype.html` instead.
- The agent has only screenshots, a conversation attachment, memory, a verbal description, or inferred styling instead of the repository artifact.

The agent must report the problem and wait. It must not proceed by recreating, guessing, approximating, or using the older prototype.

### 1.2 Historical prototype exclusion

```text
docs/payroll/payroll-final-prototype.html
```

is an older/historical prototype. It is **not** the visual source for this task.

Only this file is authoritative for visual parity:

```text
docs/payroll/payroll-full-cycle-prototype-v9.html
```

### 1.3 Prototype role limitation

The v9 prototype is the canonical source for **presentation and layout only**. It is not a source of runtime data, backend behavior, API contracts, lifecycle rules, permission rules, or financial calculations.

---

## 2. Executive Directive

The coding agent must port the v9 prototype’s presentation into the live payroll UI.

The task requires the production UI to preserve the prototype’s:

- information hierarchy;
- screen composition;
- ordering of cards, tables, badges, notices, controls, and footer actions;
- desktop layout intent;
- narrow/mobile layout intent;
- spacing rhythm;
- card geometry and grouping;
- typography hierarchy;
- color semantics;
- control and action placement;
- Screen 1 through Screen 6 visual journey.

The coding agent must replace prototype demonstration values only with already-existing live runtime values from the current payroll UI/controller/API integration.

> **Port the UI; do not reinterpret the UI. Bind live data; do not copy demonstration data.**

This task is not a redesign, an approximation exercise, a backend extension, a payroll-policy change, or a state-machine rewrite.

---

## 3. Why This Closure Is Needed

The current branch has completed functional payroll integration, including live data flow, missing-bank warning behavior, state/resume behavior, payment-rail data, and statutory UI actions.

However, the functional work did not enforce artifact-level prototype parity. It allowed implementation of equivalent features without requiring an exact prototype-to-production layout port.

The result is a functionally capable payroll UI that can still drift in:

- layout hierarchy;
- card/table structure;
- spacing and density;
- typography and metric emphasis;
- responsive composition;
- action placement;
- visual treatment of warnings, rails, and statutory cards.

This plan closes the presentation gap without reopening completed functional work.

---

## 4. Non-Negotiable Scope Boundary

### 4.1 In scope

- Payroll production HTML structure required for v9 visual parity.
- Payroll-specific CSS required for v9 visual parity.
- Minimal payroll-controller JavaScript changes only when required to:
  - preserve an existing event hook after markup changes;
  - preserve stable IDs used by current live code;
  - target a prototype-derived dynamic content container;
  - render existing live data into prototype-derived structure;
  - preserve existing loading, empty, error, disabled, and lock states.
- Playwright UI and visual-regression coverage.
- Responsive and accessibility-safe adaptation of prototype presentation.

### 4.2 Explicitly out of scope

Do not modify any of the following:

- `be/**` backend services, routers, models, schemas, migrations, or backend tests.
- Alembic migrations.
- Backend endpoints, API request/response contracts, or API client semantics.
- RBAC keys, guards, or role behavior.
- Payroll calculation, compensation, deductions, FX, statutory calculation, journal logic, payment execution, or run lifecycle behavior.
- Persisted-state resolver logic or resume mapping.
- Finance/statutory record or settlement semantics and payloads.
- Independent Internal or External rail disbursement actions.
- New source-of-truth data models, background jobs, bank rails, storage, or integrations.

### 4.3 No dummy-data rule

The prototype’s employees, bank accounts, payroll totals, dates, history rows, statutory obligations, labels, statuses, and payment examples are demonstration data only.

At normal runtime:

- payroll runs come from existing live payroll API/controller state;
- run lines, totals, exceptions, bank display values, and status come from existing live run/preview state;
- company accounts come from existing live Finance-account state;
- statutory obligations and settlement states come from existing live statutory state;
- loading, empty, error, disabled, and permission behavior reflect actual production conditions;
- no automatic fallback may show prototype values.

Test fixtures may use deterministic values only inside existing explicit mock paths or test-level request interception. They must never be restored as production runtime seed data.

---

## 5. Required Branch Intake

Before changing any code, the agent must provide the following block and wait for owner approval:

```text
Branch: feature/payroll-deductions
HEAD: <actual current SHA>
Merge-base with main: <actual SHA>
Working tree: <clean or exact changed files>
Task: Payroll v9 UI-only prototype-parity closure
Functional baseline preserved: <confirmed current live payroll behavior>
Canonical visual source: docs/payroll/payroll-full-cycle-prototype-v9.html
Prototype availability: <exists, read in full, and confirmed distinct from historical prototype>
Excluded areas: backend, migrations, APIs, RBAC, lifecycle/resolver semantics, payroll logic
```

Then the agent must verify:

1. `docs/payroll/payroll-full-cycle-prototype-v9.html` exists and is read in full.
2. `docs/payroll/payroll-final-prototype.html` is not used for this task.
3. The active payroll bundle/controller relationship.
4. The current live production payroll partial.
5. The current payroll CSS module loaded by the page.
6. Existing DOM IDs, event hooks, and render containers required by `PayrollApp`.
7. Existing live API/render functions that must remain behaviorally unchanged.
8. Existing Playwright fixtures, viewport configuration, screenshot support, and test setup.

The agent must not edit code until the owner approves the required U0 mapping and visual-delta register.

---

## 6. Source-of-Truth Rules

Resolve conflicts in this order:

1. Current branch functional behavior and current live API behavior.
2. This plan’s no-backend and no-dummy-data constraints.
3. `docs/payroll/payroll-full-cycle-prototype-v9.html` for visual structure and visual behavior.
4. Existing HRFlow global accessibility and design-token requirements.
5. Existing payroll CSS conventions where they do not prevent prototype parity.

### 6.1 Functional behavior is frozen

The agent must preserve current:

- API calls and payloads;
- run list/load/open behavior;
- preview/create/submit/approve/finalize/payment behavior;
- status resolver and resume destinations;
- Screen 5 single combined confirmation/disbursement action;
- statutory record and settlement actions;
- live data refresh behavior after mutations.

If prototype layout requires a different DOM shape, the agent may change wrappers, content containers, and presentation classes, but must preserve IDs and live event wiring or adapt them minimally without changing behavior.

### 6.2 Prototype is visual authority, not data authority

Do not copy into production:

- prototype seed arrays;
- prototype fake accounts;
- prototype payroll history;
- prototype demo salaries/totals;
- prototype simulated obligation records;
- prototype lifecycle or state-management behavior that conflicts with live API-backed behavior.

The agent may copy/translate only:

- screen DOM hierarchy;
- presentation-oriented CSS/layout rules;
- iconography and static non-data labels, when product terminology remains correct;
- visual state treatment;
- wrappers and static layout controls;
- responsive behavior;
- visual-only expansion/collapse placement where compatible with existing live behavior.

---

## 7. Mandatory Prototype-to-Production Mapping

### 7.1 U0 deliverable required before implementation

Before editing production UI, the coding agent must produce a mapping table containing these columns:

| Screen / state | Exact v9 prototype anchor | Production target | Live IDs/hooks retained | Live data substitutions | Required visual parity | Permitted deviation |
|---|---|---|---|---|---|---|

A prototype anchor must be concrete: a unique HTML id/class, exact nearby heading text, or clearly locatable section. “Screen 5” alone is not acceptable.

### 7.2 Required mapping coverage

The mapping must cover:

1. Payroll shell, topbar, navigation, and page container.
2. Payroll run-history/list page.
3. Screen 1 — initiation, period, funding accounts, FX controls, summary cards, and footer.
4. Screen 2 — review header, KPI cards, filters, worksheet, totals, and footer.
5. Screen 3 — processing header, lock/read-only treatment, snapshot table, totals, and footer.
6. Screen 4 — preview header, stat cards, payment table, bank details, missing-bank warning, and footer.
7. Screen 5 — rail cards, exception display, combined action, result state, journal presentation, and footer.
8. Screen 6 — statutory header/status, authority notice, obligation cards, amount/variance layout, inline fields, record/settle actions, and visual statuses.
9. Loading, empty, API-error, locked, disabled, warning, paid, partially-paid, unrecorded, recorded-unpaid, partially-reconciled, reconciled, and narrow/mobile states.

### 7.3 Example mapping form

| Screen / state | Exact v9 prototype anchor | Production target | Live IDs/hooks retained | Live data substitutions | Required visual parity | Permitted deviation |
|---|---|---|---|---|---|---|
| Screen 5 rails | Exact v9 heading `Payment Confirmation & Disbursal` plus adjacent two-card rail grid | `#payrollScreen5` | `#btnP5ConfirmDisburse`, current live render containers | current live external/internal totals, account labels, recipient counts, payment date, exceptions | card order, grid, title hierarchy, badge placement, metric emphasis, combined-action placement | longer live account names may wrap; production error state may be added |

No production implementation starts until the owner approves this mapping.

---

## 8. CSS and Markup Rules

### 8.1 Primary file scope

Expected UI-only files:

```text
fe/src/partials/admin/sections/finance-payroll.html
fe/src/styles/modules/payroll.css
fe/public/js/finance-payroll.js
fe/tests/ui/finance-payroll-table-cycle.spec.js
```

Do not widen this set without reporting why and obtaining approval.

### 8.2 CSS location and discipline

Primary presentation changes belong in:

```text
fe/src/styles/modules/payroll.css
```

Primary markup changes belong in:

```text
fe/src/partials/admin/sections/finance-payroll.html
```

Do not add repeated inline structural styling for grid, flex, spacing, padding, border, radius, card, typography, or responsive composition.

Move repeated structural inline styles in the actively ported screen into `payroll.css`. Do not conduct a broad unrelated cleanup outside the active screen slice.

### 8.3 New scoped classes are permitted

The agent may add the minimum set of payroll-scoped CSS classes needed to port the prototype. This is mandatory when existing generic primitives cannot reproduce prototype layout without approximation.

New classes must:

- correspond to a verified prototype layout/component role;
- remain payroll-scoped;
- be named clearly and consistently;
- be listed in the phase handoff;
- not create a new visual system or design interpretation.

Illustrative categories only; derive exact final names from the prototype:

```css
.payroll-screen-header
.payroll-screen-title
.payroll-screen-description
.payroll-screen-body
.payroll-action-bar
.payroll-rail-grid
.payroll-rail-card
.payroll-rail-card--external
.payroll-rail-card--internal
.payroll-rail-metric
.payroll-rail-meta
.payroll-exception-list
.payroll-exception-item
.payroll-bank-warning
.payroll-bank-warning-pill
.payroll-reconciliation-grid
.payroll-obligation-card
.payroll-obligation-card__header
.payroll-obligation-card__summary
.payroll-obligation-settlement-fields
```

### 8.4 Existing conventions to reuse

Use existing global tokens and primitives when they materially reproduce the prototype:

- `--surface`, `--surface-2`, `--primary`, `--text-muted`, `--border-color`;
- `btn`, `btn-primary`, `btn-ghost`, `btn-sm`;
- `p-badge` variants when semantic/color treatment aligns;
- existing payroll containers when appropriate.

Do not force generic reuse when it prevents prototype fidelity. Add a narrow class instead of approximating with generic cards plus inline styles.

---

## 9. Visual Parity Standard

Parity means more than equivalent data and controls. Every screen must faithfully preserve or translate the prototype’s:

1. **Hierarchy:** title, subtitle, notice, main content, secondary information, and actions.
2. **Grouping:** cards, rails, tables, notices, exceptions, and footer controls.
3. **Geometry:** columns, card widths, gaps, padding, table density, and action-bar placement.
4. **Typography:** heading scale, label weight, metric emphasis, muted metadata, and badge scale.
5. **Color semantics:** neutral, information, success, warning, blocking/error, and completed state treatment.
6. **Control placement:** button/select/date-input arrangement and visual priority.
7. **Responsive composition:** intended reflow, stacking, scrolling, and density at narrower widths.
8. **State treatment:** loading, empty, error, disabled, locked, warning, paid, partially-paid, unrecorded, recorded-unpaid, partially-reconciled, and reconciled views.

### 9.1 Allowed deviations

Only these deviations are allowed without a separate product decision:

- live text may be longer than demonstration text and wrap/truncate accessibly;
- production-only loading, empty, API-error, permission-denied, disabled, and lock states may be added;
- stable IDs, ARIA attributes, and event hooks may be added;
- existing global token values may replace hard-coded prototype values only when appearance remains materially equivalent;
- responsive adaptation may prevent unsafe table overflow while preserving hierarchy.

Any other visual difference must be listed and owner-approved before implementation continues.

---

## 10. Mandatory UI-Only Phase Sequence

Do not combine all UI work into one pass or one review gate. Work strictly in this sequence:

```text
U0 → U1 → U2 → U3 → U4 → U5 → U6
```

Do not start the next phase until the current phase has owner visual approval.

### Phase U0 — Visual Audit, Mapping, and Baseline

**No production code changes.**

#### Required work

1. Read `docs/payroll/payroll-full-cycle-prototype-v9.html` in full.
2. Read current payroll HTML, CSS, JS, and UI tests in full.
3. Verify the active bundle/controller/partial relationship.
4. Produce the required prototype-to-production mapping.
5. Produce a visual-delta register:

| Screen | Exact v9 prototype element | Current production state | Delta | Planned correction | Needs minimal JS adaptation? |
|---|---|---|---|---|---|

6. Capture current production baseline screenshots at required states.
7. List existing DOM IDs/event hooks that must be retained.
8. List proposed prototype-derived CSS classes per screen.
9. Confirm that no backend/API/RBAC/data-model changes are needed.

#### Acceptance criteria

- No production UI code has changed.
- Owner can review mapping, deltas, and baseline screenshots.
- U1 candidate file scope is exact.
- Prototype availability is confirmed.

#### Gate

Wait for owner approval before U1.

---

### Phase U1 — Shell, Navigation, Run History, and Screen 1

#### Scope

- Payroll shell and top bar.
- Run-list/history page.
- Screen 1 initiation/period/funding/FX composition.
- Screen 1 summary-card layout.
- Screen 1 action/footer composition.
- Desktop and narrow responsive behavior for these areas.

#### Allowed files

- `fe/src/partials/admin/sections/finance-payroll.html`
- `fe/src/styles/modules/payroll.css`
- `fe/public/js/finance-payroll.js` only for stable selector/container adaptation
- `fe/tests/ui/finance-payroll-table-cycle.spec.js`

#### Do not change

- run-list API behavior;
- preview creation behavior;
- funding-account selection semantics;
- FX calculation or payload behavior;
- backend files.

#### Acceptance criteria

1. Shell/history/Screen 1 matches v9 hierarchy and composition.
2. History rows render only current live data.
3. Screen 1 controls retain existing live handlers.
4. No prototype dates, employee data, account names, totals, or statuses become runtime fallback.
5. Repeated structural styles in touched sections move into `payroll.css`.
6. Desktop and narrow checkpoints are provided and owner-approved.
7. Existing functional tests remain intact.

#### Gate

Owner visual approval required before U2.

---

### Phase U2 — Screens 2 and 3

#### Scope

- Screen 2 heading, KPI composition, filters, worksheet/table density, totals, and footer.
- Screen 3 frozen-snapshot hierarchy, lock/read-only treatment, table composition, totals, and footer.
- Responsive table strategy consistent with v9 intent.

#### Do not change

- bonus/commission logic;
- submit/approve/finalize APIs or lifecycle behavior;
- statutory calculations;
- existing data calculation/render semantics.

#### Acceptance criteria

1. Screens 2 and 3 visually match v9 hierarchy and density.
2. Existing live renderer continues to supply real values.
3. Existing actions retain current semantics.
4. No demo employee values are embedded in production runtime code.
5. Desktop and narrow checkpoints are owner-approved.

#### Gate

Owner visual approval required before U3.

---

### Phase U3 — Screen 4 Payment Preview

#### Scope

- Header and description.
- Stat-card composition and emphasis.
- Recipient/payment table presentation.
- Bank/routing display treatment.
- Missing-bank count and affected-row warning treatment.
- Footer/action placement.
- Narrow responsive preview-table behavior.

#### Do not change

- live missing-bank calculation;
- D-006 severity behavior;
- run-line response shape;
- lifecycle transitions.

#### Required live-data rule

Missing-bank count and row indicators must use current live run/preview data. Do not show prototype bank identifiers, employee names, or warning counts as fallbacks.

#### Acceptance criteria

1. Screen 4 follows v9 composition rather than a generic card/table approximation.
2. Missing-bank treatment is visually distinct and prototype-aligned.
3. Current live count/rows remain correct.
4. Existing API/render behavior is unchanged.
5. Desktop and narrow checkpoints include an explicit warning case and are owner-approved.

#### Gate

Owner visual approval required before U4.

---

### Phase U4 — Screen 5 Payment Confirmation and Disbursal

#### Scope

- Exact v9-derived Screen 5 composition.
- External and Internal rail cards.
- Rail totals, recipient counts, account labels, and payment date.
- Persisted exception/warning presentation.
- Combined confirm/disburse action placement.
- Paid/partially-paid result presentation.
- Journal presentation.
- Narrow responsive rail behavior.

#### Critical functional rule

Screen 5 remains a **single combined confirmation/disbursement action** for the full run.

Do not create independent External or Internal confirm/disburse actions.

#### Do not change

- payment/disbursement endpoint calls or payloads;
- payment execution behavior;
- journal posting behavior;
- current rail-total calculation behavior.

#### Required live-data rule

- Totals and recipient counts: current live run lines.
- Funding account labels: live Finance/run fields.
- Payment date: live run data.
- Exceptions: persisted live run exceptions.
- Paid/partial state: live run/line status.
- No prototype account labels, amounts, or recipients as fallback data.

#### Acceptance criteria

1. Screen 5 is a faithful visual port of the v9 rail layout and action hierarchy.
2. Both rail totals reconcile to the live grand total.
3. Combined action keeps current behavior.
4. Warnings/exceptions and paid/partial results use real data.
5. Desktop and narrow checkpoints cover pending, warning, and paid states and are owner-approved.

#### Gate

Owner visual approval required before U5.

---

### Phase U5 — Screen 6 Statutory Reconciliation

#### Scope

- Header and statutory-status badge.
- Government-authority notice.
- Social Insurance and Income Tax card composition.
- Estimate/actual/variance hierarchy.
- Existing inline debit-account and settlement-date fields.
- Record and remit/settle action arrangement.
- Recorded-unpaid, partially-reconciled, and reconciled visual states.
- Responsive card layout.

#### Do not change

- statutory API calls;
- record/settle payloads;
- backend permission behavior;
- linking/status logic;
- obligation business semantics.

#### Required live-data rule

Estimates, actuals, variances, status, available accounts, and dates must come from existing live data. Do not populate statutory cards with prototype numbers.

#### Acceptance criteria

1. Screen 6 matches v9 card hierarchy, notice, fields, action placement, and state presentation.
2. Unrecorded, recorded-unpaid, partially reconciled, and reconciled states remain distinct.
3. Inline fields retain current live behavior.
4. No endpoint/data behavior changes.
5. Desktop and narrow checkpoints cover recorded-unpaid and reconciled states and are owner-approved.

#### Gate

Owner visual approval required before U6.

---

### Phase U6 — Responsive, State, and Visual-Regression Closure

#### Scope

- Cross-screen spacing/typography consistency.
- Desktop, tablet, and narrow/mobile responsive composition.
- Table overflow/accessibility strategy.
- Loading, empty, error, disabled, lock, warning, and completion-state consistency.
- Final screenshot baseline/approval.

#### Required viewports

Use existing repository Playwright viewport conventions. If absent, propose exact values and wait for owner approval. At minimum evaluate:

- Desktop: approximately 1440px width.
- Medium/tablet: approximately 1024px width.
- Narrow/mobile: approximately 390px width.

#### Acceptance criteria

1. All screens preserve v9 hierarchy across required viewports.
2. No horizontal page overflow occurs outside intentional scrollable tables.
3. Complex tables are usable and visibly scrollable on narrow screens.
4. Production loading/empty/error states are safe and contain no dummy data.
5. Visual checkpoints pass or are owner-approved.
6. Existing functional tests remain green.

---

## 11. Visual Test Strategy

### 11.1 Functional test preservation

Retain and run existing payroll functional coverage. UI work must not weaken lifecycle, data, or interaction assertions.

Primary evolving spec:

```text
fe/tests/ui/finance-payroll-table-cycle.spec.js
```

### 11.2 Required visual checkpoints

Use `expect(page).toHaveScreenshot(...)` when current Playwright configuration supports it. If unavailable, create deterministic named screenshots and provide them for explicit owner review before moving forward.

| Checkpoint | Required state | Test data source |
|---|---|---|
| `payroll-runs-list` | run list loaded | explicit test fixture/interception only |
| `payroll-screen-1-initiation` | live-shaped funding/FX/summary | explicit test fixture/interception only |
| `payroll-screen-2-review` | real-shaped variable addition | explicit test fixture/interception only |
| `payroll-screen-3-processing` | finalized snapshot | explicit test fixture/interception only |
| `payroll-screen-4-missing-bank` | real-shaped missing-bank warning | explicit test fixture/interception only |
| `payroll-screen-5-confirmation` | both rails/accounts/totals/exception | explicit test fixture/interception only |
| `payroll-screen-5-paid` | paid result and journal/status | explicit test fixture/interception only |
| `payroll-screen-6-recorded-unpaid` | obligation and inline settlement controls | explicit test fixture/interception only |
| `payroll-screen-6-reconciled` | remitted/reconciled state | explicit test fixture/interception only |
| `payroll-mobile-screen-4` | narrow preview layout | explicit test fixture/interception only |
| `payroll-mobile-screen-5` | narrow rail layout | explicit test fixture/interception only |
| `payroll-mobile-screen-6` | narrow statutory layout | explicit test fixture/interception only |

### 11.3 Screenshot review requirement

Each UI-phase handoff must state:

- screenshot/checkpoint names;
- viewport sizes;
- exact v9 prototype section compared;
- approved controlled deviations;
- functional test results.

---

## 12. Accessibility and Production Safety

Prototype parity must not regress:

- semantic buttons, inputs, and selects;
- accessible names for icon controls;
- visible focus states;
- keyboard operation;
- adequate contrast;
- labels associated with fields;
- table usability and scroll affordance;
- ARIA/status semantics where current project convention supports them.

Accessibility adjustments are allowed when they do not redesign the visual layout.

---

## 13. Stop-and-Report Conditions

Stop and report before proceeding if:

1. The required v9 prototype artifact is missing, wrong, unreadable, or replaced by the historical prototype.
2. Matching the v9 design needs a backend field current live APIs do not return.
3. Matching v9 needs an endpoint or payload change.
4. Matching v9 requires independent Screen 5 rail payment actions.
5. Matching v9 requires lifecycle/resolver changes.
6. The prototype conflicts with approved payroll policy or current domain terminology.
7. A different active payroll UI entry point is discovered.
8. A requested presentation behavior depends on prototype dummy data with no live equivalent.
9. A visual change would alter calculation, payment, or statutory behavior.
10. Screenshot infrastructure is unavailable and no owner-approved manual visual-review method exists.

Do not silently solve any such issue by editing backend code, copying dummy data, or inventing runtime behavior.

---

## 14. Required Handoff After Every UI Phase

After U0, U1, U2, U3, U4, U5, and U6, provide:

1. **Outcome**
   - completed scope;
   - acceptance criteria met/not met;
   - confirmation that functional behavior was preserved.

2. **Prototype traceability**
   - exact v9 anchors/sections ported;
   - production selectors/files changed;
   - approved deviations, if any.

3. **Exact files changed**
   - repository-relative paths only.

4. **Live-data verification**
   - explicit confirmation that no prototype demonstration data entered normal runtime;
   - exact existing live fields/containers rendered by each changed screen.

5. **Tests**
   - exact commands;
   - passed/failed/skipped/error counts;
   - screenshot checkpoint names and viewport sizes.

6. **CSS discipline**
   - new/changed payroll-scoped classes;
   - inline styles removed/moved for active screen;
   - any remaining inline structural style and why it is unavoidable.

7. **Assumptions and deviations**
   - actual assumptions only;
   - prototype differences requiring approval.

8. **Next-phase readiness**
   - state that owner visual approval is required;
   - or state exact blocker.

Do not begin the next phase without owner approval.

---

## 15. Coding-Agent Start Prompt

Use this exact prompt with the coding agent:

```text
You are working in the HRFlow repository on branch feature/payroll-deductions.

Read these files in full before doing anything else:
1. docs/payroll/payroll-v9-ui-only-prototype-parity-closure-plan-v2.md
2. docs/payroll/payroll-full-cycle-prototype-v9.html

The second file is the sole canonical visual source. Do not use docs/payroll/payroll-final-prototype.html; it is historical.

This is UI-only work. Preserve all existing live payroll behavior, API calls/payloads, state resolver logic, lifecycle behavior, RBAC, backend code, and functional tests. Do not create or modify backend endpoints, migrations, permissions, payroll calculations, payment behavior, statutory behavior, or API contracts.

The v9 prototype has demonstration employees, banks, totals, dates, history, obligations, and statuses. They are visual examples only. Do not copy them into production runtime code, and do not add dummy-data fallbacks. Production must keep using only existing live API-backed data. Test fixtures may use deterministic mock/intercept data only inside tests or existing explicit test-mode paths.

Follow exact phase order U0 → U1 → U2 → U3 → U4 → U5 → U6. Do not start a phase before owner visual approval of the preceding phase.

Begin with U0 only. Before editing:
1. State branch, HEAD, merge-base, and working-tree status.
2. Confirm docs/payroll/payroll-full-cycle-prototype-v9.html exists, is readable, and was read in full.
3. Confirm docs/payroll/payroll-final-prototype.html will not be used.
4. Verify active payroll bundle/controller/partial/CSS/test paths.
5. Read current payroll HTML, CSS, JS, and tests in full.
6. Produce the mandatory prototype-to-production mapping table.
7. Produce the visual-delta register.
8. Identify preserved DOM IDs/event hooks and proposed scoped CSS classes.
9. State U1’s exact candidate scope, acceptance criteria, screenshot checkpoints, and test commands.
10. Wait for owner approval before editing.

Port the v9 UI; do not reinterpret it. Bind live data; do not copy demonstration data.
```

---

## 16. Definition of Done

The UI-only closure is complete only when:

1. The v9 prototype artifact was available at the required repository path throughout implementation.
2. U0 through U6 were individually reviewed and owner-approved.
3. Every production payroll screen has a documented v9 prototype-to-production mapping.
4. Production runtime has no prototype demo data and no silent dummy-data fallback.
5. Production layout, grouping, action placement, typography hierarchy, color semantics, and responsive composition faithfully match v9.
6. Existing live payroll behavior, lifecycle transitions, resolver behavior, API calls, and statutory/payment semantics remain unchanged.
7. Existing functional tests remain green.
8. Visual screenshot checks or owner-reviewed visual artifacts exist for every required checkpoint.
9. Every remaining prototype difference is explicitly documented, justified, and owner-approved.
