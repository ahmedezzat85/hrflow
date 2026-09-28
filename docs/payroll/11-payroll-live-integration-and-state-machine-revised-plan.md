# HRFlow Payroll — Live Integration, D-006, and State-Machine Revised Plan

**Prepared:** September 28, 2026  
**Active branch / implementation truth:** `feature/payroll-deductions`  
**Planning baseline:** current local branch state as verified during this review  
**Supersedes for execution sequencing:** `docs/payroll/payroll-ui-v9-parity-and-state-machine-plan.md`  
**Design reference:** `payroll-full-cycle-prototype-v9.html` remains the approved visual and interaction reference. It is not a runtime data source.

## 1. Purpose of This Revision

The prior v9 parity/state-machine plan identified valid product goals but cannot be executed safely on the current branch without first correcting two structural mismatches found during direct repository verification:

1. The backend has two independent payroll-run calculation paths that each construct `MISSING_BANK_DETAILS` exceptions.
2. The named six-screen payroll controller is currently mock-driven and does not obtain payroll state from the backend.

This revised plan adds two prerequisite phases before the prior D-006 and UI state-machine work:

- **Phase -1:** consolidate duplicated payroll snapshot/exception construction.
- **Phase 0:** establish a clear, live frontend/backend integration contract for the six-screen controller.

Only then should the system alter missing-bank-details policy and implement resume/state-machine/UI parity behavior.

## 2. Verified Findings

### 2.1 Two backend construction paths emit the same bank-details exception

`be/finance/services/payroll_service.py` contains two independent sites that create a `MISSING_BANK_DETAILS` exception:

| Method | Verified location at planning time | Route / use | Current behavior |
|---|---:|---|---|
| `preview_run()` | approximately line 260 | `POST /api/finance/payroll/runs/preview` | Emits a `blocking` missing-bank-details exception |
| `generate_run_from_compensation_plans()` | approximately line 853 | `POST /api/finance/payroll/runs/generate` | Independently emits the same `blocking` exception |

The direct-generate path is live:

- `be/finance/routers/payroll.py` routes `POST /api/finance/payroll/runs/generate` to `generate_run_from_compensation_plans()`.
- `be/tests/test_payroll_social_insurance.py` calls this service method.
- The direct-generate method persists its exceptions through `run.exceptions_json = json.dumps(exceptions)`.
- `approve_run()` blocks unresolved exceptions where `severity == "blocking"`.

Therefore, changing only the preview path would leave D-006 violated for runs created through the direct-generation path.

### 2.2 Payment execution has no separate employee-bank-details block

`execute_payment()` was inspected directly. It does not independently check employee IBAN/bank details and does not create `MISSING_BANK_DETAILS` exceptions. No method named `mark_paid` exists in the currently verified `PayrollService` file.

### 2.3 The named six-screen controller is mock-driven

`fe/public/js/finance-payroll.js` exists and is a 1,649-line six-screen controller, but its normal initial state is hardcoded:

- `seedEmployees`
- `seedBanks`
- `historyRuns`

At the time of verification, repository searches found no `fetch`, `apiRequest`, or `/api/finance/payroll` call in this controller. The function names described in the previous plan—such as `openRun()`, `openHistoryRun()`, `drawScreen4()`, `drawScreen5()`, `drawScreen6()`, `loadLinkedStatutoryObligations()`, `settleStatutory()`, and `drawRunsList()`—were not present in this file.

The prior B1–B3 plan must therefore not be applied directly until the active frontend architecture is re-verified and a live data boundary exists.

## 3. Product Goal

Deliver a real, server-backed six-screen payroll workflow that:

1. Uses persisted payroll, company-account, employee-bank-display, and statutory-obligation data during normal operation.
2. Treats missing employee bank details as a visible, non-blocking D-006 warning across every payroll-run creation path.
3. Preserves backend ownership of lifecycle state:

   `draft → submitted → approved → finalized → paid / partially_paid`

4. Resolves the resumed UI screen from persisted payroll-run status plus linked statutory-obligation status.
5. Reaches approved v9 visual parity only after screens display live data rather than local sample data.
6. Requires no new Alembic migration, backend endpoint, or RBAC permission key.

## 4. Non-Negotiable Constraints

- The active branch is `feature/payroll-deductions`; its current code, migrations, and tests are implementation truth.
- Do not defer to `main` or to `docs/project-context/00-project-start-here.md` for branch implementation truth.
- No new Alembic migrations.
- No new backend endpoints.
- No new RBAC permission keys.
- Do not silently remove, rename, or deprecate `POST /api/finance/payroll/runs/generate`.
- Do not use hardcoded payroll employees, bank accounts, run history, compensation, payroll status, or statutory state as a normal-runtime fallback.
- An API failure must render a visible operational error; it must not display fabricated payroll data.
- Reuse existing CSS, HTML, and component conventions.
- Work in small, independently reviewable, testable phases.
- Do not begin a later phase until the preceding phase is reviewed and merged.
- Before editing code in every phase, re-verify the current symbols, files, routes, tests, and line ranges cited by this plan.
- Before editing code in every phase, report verified baseline, scope, acceptance criteria, and planned tests; wait for owner confirmation.

## 5. Ownership Model

| Concern | Authoritative owner | Frontend responsibility |
|---|---|---|
| Payroll lifecycle | `PayrollService` and persisted `PayrollRunDB` | Render returned status, issue permitted commands, refresh state afterward |
| Payroll amounts and lines | Persisted backend snapshots | Display returned values; never recalculate authoritative payroll |
| Payroll exceptions | Shared backend snapshot calculation | Render returned severity and guidance; do not synthesize exceptions |
| Employee bank data | HR employee-bank-account source, read by Finance | Display safe/masked fields only |
| Company funding accounts | Finance bank-account records | Load real eligible company accounts |
| Statutory obligations | Existing Finance statutory records/endpoints | List, record, and settle via existing API |
| Resume decision | Frontend resolver over persisted state | Resolve presentation only; never own lifecycle truth |
| Prototype data | Test/demo fixture | Never become a silent runtime data source |

## 6. Revised Phase Sequence

| Phase | Name | Depends on | Purpose |
|---|---|---|---|
| -1 | Payroll snapshot consolidation | Nothing | Eliminate duplicated payroll calculation and exception generation |
| 0 | Live UI/backend integration foundation | Phase -1 merged | Replace normal-runtime seed data with existing API-backed data flow |
| A | D-006 missing-bank severity | Phase -1 and Phase 0 merged | Change centralized missing-bank exception to a warning |
| B1 | Persisted-state resolver and resume | A merged | Resolve correct screen and reconciliation state from persisted server data |
| B2 | Screens 4–6 v9 parity | B1 merged | Render warnings, rails, and inline statutory settlement using live data |
| B3 | History obligation-state surfacing | B1 and B2 merged | Show statutory-reconciliation state in real run history |

Although Phase A could technically follow Phase -1, it is intentionally sequenced after Phase 0 so the warning is delivered through a live, visible UI rather than remaining only a backend behavior change.

---

# Phase -1 — Payroll Snapshot Consolidation

## Goal

Make one internal payroll snapshot/calculation implementation responsible for employee/compensation/bank/statutory/exception construction. Both preview and direct-generation flows must consume that implementation.

## Confirmed Baseline

- `preview_run()` constructs a `MISSING_BANK_DETAILS` exception directly.
- `generate_run_from_compensation_plans()` constructs a second copy directly.
- `approve_run()` blocks unresolved blocking exceptions from `run.exceptions_json`.
- Direct generation is a live routed path and must preserve compatibility.
- `execute_payment()` has no independent bank-details gate.

## Proposed Change

Extract a private `PayrollService` helper from current duplicated logic. Its final name must follow the verified local code style; a candidate is `_build_payroll_snapshot(...)`.

The shared helper should be the only place that:

- Loads active employees for the requested payroll period.
- Reads applicable compensation components.
- Determines internal and external compensation routing.
- Reads bank display data through the existing Finance-to-HR read boundary.
- Builds safe/masked bank display values and existing fallback values.
- Produces validation exceptions such as `MISSING_COMP_PLAN` and `MISSING_BANK_DETAILS`.
- Retains current statutory validation and snapshot behavior.
- Produces recipient/line calculation data and totals needed by callers.
- Derives blocking-summary information from exception severity.

Then:

- `preview_run()` returns the shared snapshot in its existing preview contract.
- `generate_run_from_compensation_plans()` consumes the shared snapshot and persists `PayrollRunDB`, lines, and `exceptions_json` while preserving its existing route contract.

## Scope

Expected files:

- `be/finance/services/payroll_service.py`
- `be/tests/test_finance_guided_payroll.py`
- `be/tests/test_payroll_social_insurance.py`, only if direct-generate parity coverage requires it

Do not touch frontend files in this phase.

## Explicitly Out of Scope

- D-006 severity change from `blocking` to `warning`.
- UI/API integration.
- State resolver, visual parity, or statutory UI work.
- New API fields, endpoints, migrations, or RBAC keys.
- Route removal or deprecation.
- Changes to approval, finalization, payment execution, journal posting, or unrelated statutory policy.

## Acceptance Criteria

1. There is one authoritative construction site for `MISSING_BANK_DETAILS` payloads.
2. Preview and direct-generation paths produce/persist equivalent bank-detail exception payloads for equivalent input.
3. `POST /api/finance/payroll/runs/generate` remains available and compatible.
4. Unresolved real blockers such as `MISSING_COMP_PLAN` still prevent approval.
5. No migration, endpoint, or RBAC change is introduced.
6. Focused tests prove the two paths cannot drift on bank-detail exception content/severity.

## Test Strategy

- Preserve and update backend tests without weakening missing-plan blocking assertions.
- Add parity coverage for preview and direct-generate paths.
- Run focused finance-payroll pytest suites.
- Report exact commands and pass/fail/skip/error counts.

## Rollback

Revert the helper extraction as a source-only change. No migration or data backfill is involved.

---

# Phase 0 — Live UI/Backend Integration Foundation

## Goal

Replace runtime dummy data in the six-screen payroll controller with a clear, existing API-backed controller before implementing state resolution or visual parity.

## Required Discovery Before Editing

Re-verify all of the following, in full where appropriate:

- `fe/vite.config.js`: bundle and module-entry behavior.
- `fe/src/index.html`: payroll partial inclusion/build relationship.
- `fe/src/partials/admin/sections/finance-payroll.html`: current six-screen markup.
- `fe/public/js/finance-payroll.js`: actual controller structure, current seed data, and event/render methods.
- `fe/api/finance/payroll-api.js` and `fe/finance-api.js`: identify the canonical existing API client.
- Existing Finance account methods for company/funding accounts.
- Existing statutory-obligation methods.
- `be/finance/routers/payroll.py` and `be/finance/routers/statutory.py`: existing route shapes and guards.
- `fe/tests/ui/finance-payroll-table-cycle.spec.js` plus relevant payroll UI specifications.

If discovery identifies a separate real controller or an unexpected Vite/runtime relationship, stop and report the path, role, evidence, and revised scoped recommendation before editing.

## Proposed Integration Boundary

Use the canonical existing Finance API client. If a payroll-specific frontend adapter is necessary, keep it thin and delegate to existing client methods. Do not scatter raw API calls across drawing/render functions.

The controller needs existing capabilities for:

- listing payroll runs;
- loading a run detail;
- creating a preview;
- persisting a run;
- submitting, approving, finalizing, and executing a run;
- listing Finance company accounts;
- listing/creating/settling statutory obligations.

Exact method names and payloads must be verified from the repository; this list is conceptual, not an authorization to invent interfaces.

## Runtime Data Rule

Normal runtime must render only server-returned data.

Permitted test strategies:

- an existing explicit mock mode, if verified;
- Playwright request interception or fixtures;
- explicit test-only injected data.

Forbidden:

- automatic fallback to `seedEmployees`, `seedBanks`, or `historyRuns` after a failed request;
- silently presenting sample salaries/accounts/history as live payroll state.

## Scope

Likely files, subject to discovery:

- `fe/public/js/finance-payroll.js`
- `fe/api/finance/payroll-api.js` only when an existing route lacks an existing client wrapper
- `fe/src/partials/admin/sections/finance-payroll.html`
- `fe/tests/ui/finance-payroll-table-cycle.spec.js`

Do not modify backend services, routers, migrations, RBAC seed data, or CSS in this phase unless a verified existing-contract mismatch makes the phase impossible. If that occurs, stop and report rather than expanding scope.

## Acceptance Criteria

1. Screen 1 loads server-backed run history in normal operation.
2. Opening a run reads server detail, lines, exceptions, and available funding information.
3. Preview and lifecycle actions call existing backend endpoints and refresh the client with returned/persisted state.
4. Funding account selection comes from real Finance company accounts, not `seedBanks`.
5. Failed API calls render an explicit error state and do not show fabricated payroll records.
6. Any retained mock behavior is explicit and test-scoped.
7. No new backend endpoint, migration, or permission key is introduced.

## Test Strategy

- Add Playwright coverage proving rendered values come from controlled API/mock responses rather than inline seeds.
- Add an error-state test proving failed load does not render fake data.
- Add a focused list/open-run test using server-shaped data.
- Preserve all existing assertions unless a documented, intentional change is required.

## Rollback

Revert the frontend-only adapter/controller slice. No persistence or schema changes are required.

---

# Phase A — D-006 Missing Bank Details Are Non-Blocking

## Goal

After consolidation and live integration are merged, change the one centralized `MISSING_BANK_DETAILS` exception from `blocking` to `warning`.

## Required Verification

Before editing:

1. Confirm Phase -1 is merged.
2. Search for all `MISSING_BANK_DETAILS` occurrences and confirm there is one construction site.
3. Re-read `approve_run()`, `finalize_run()`, and `execute_payment()` for any changed independent bank block.
4. Re-read relevant pytest and Playwright coverage.

## Proposed Change

Change centralized exception severity:

```python
"severity": "blocking"
```

to:

```python
"severity": "warning"
```

Do not change `approve_run()` logic. It must still block actual unresolved blockers.

## Scope

- `be/finance/services/payroll_service.py`
- `be/tests/test_finance_guided_payroll.py`
- `be/tests/test_payroll_social_insurance.py` when needed for direct-generation parity
- `fe/tests/ui/finance-payroll-table-cycle.spec.js` only if the Phase 0 test boundary already supports warning rendering

## Acceptance Criteria

1. Missing external-payment bank details return `MISSING_BANK_DETAILS` with severity `warning` from both creation paths.
2. A run with only this warning can be approved, finalized, and continue to payment processing.
3. Missing compensation plan remains blocking.
4. The warning persists in run exceptions for B2 rendering.
5. No new migration, route, or permission key.

## Test Strategy

- Update the current preview assertion that expects bank details to be blocking.
- Preserve a blocker assertion for missing compensation plan.
- Add an approval-success case where bank data is missing but compensation is valid.
- Assert equivalent behavior for direct-generated runs.
- Report exact pytest totals.

---

# Phase B1 — Persisted-State Resolver and Resume Logic

## Goal

Introduce one frontend resolver that uses real persisted run status and linked statutory-obligation status to select the screen users should see after open/reload.

## Dependency Gate

Phase 0 and Phase A must be merged. Do not implement this against local seed data.

## Resolver Rules

| Run status | Linked obligation state | Resolved screen | Statutory badge |
|---|---|---:|---|
| `draft` / `submitted` | n/a | Screen 2 | — |
| `approved` | n/a | Screen 3 | — |
| `finalized` | n/a | Screen 4 | — |
| `paid` / `partially_paid` | none found | Screen 5 | Not Recorded |
| `paid` / `partially_paid` | one or more `accrued`, none `remitted` | Screen 6 | Recorded — Unpaid |
| `paid` / `partially_paid` | mixed `accrued` and `remitted` | Screen 6 | Partially Reconciled |
| `paid` / `partially_paid` | all linked obligations `remitted` | Screen 6 | Reconciled |
| malformed/unknown | unknown | safe existing fallback | no fabricated state |

The actual statutory status vocabulary and notes-tag linkage must be verified again. The previous plan referenced `payroll_run_id:{id}` in the obligation notes; do not assume that remains accurate.

## Scope

- Verified live payroll controller file(s)
- Existing API client/adapter only if an already-existing endpoint lacks a read wrapper
- `fe/tests/ui/finance-payroll-table-cycle.spec.js`

Avoid HTML/CSS work except a minimal existing placeholder necessary to make a badge testable. Defer visual work to B2.

## Acceptance Criteria

1. A fresh open/reload of a draft run reaches Screen 2.
2. A fresh open/reload of a finalized run reaches Screen 4.
3. A fresh open/reload of a paid/partially-paid run with an accrued linked obligation reaches Screen 6 with `Recorded — Unpaid` state.
4. Current-run, history-run, and initialization paths use shared resolver logic rather than duplicated mappings.
5. The result relies on persisted server state, not navigation memory.

## Test Strategy

- Add Playwright cases for each material state combination.
- Every case must include fresh `page.goto()` or reload behavior.
- Include a malformed/unknown safe-fallback case if existing fixtures support it.

---

# Phase B2 — Screens 4–6 v9 Visual Parity on Real Data

## Mandatory Verification Before Editing

1. Read `payroll-full-cycle-prototype-v9.html` in full, including Screen 5 event wiring.
2. Verify whether the two rails imply independent per-rail confirm/disburse actions.
3. If the prototype contradicts the current single combined-action assumption, stop and report before coding.
4. Re-read active controller/partial/CSS conventions.

## Screen 4 — Payment Preview

- Add a real `Missing Bank Details` stat card.
- Count actual returned affected lines/recipients; verify the exact current bank field/fallback before implementation.
- Display a missing-bank warning pill for affected employees instead of a hardcoded verified-bank placeholder.

## Screen 5 — Confirmation and Disbursal

- Render Internal Salaries and External Salaries as two informational rail cards.
- Compute rail totals, recipient counts, payment date, and funding-account labels from real run data.
- Render persisted run exceptions rather than static copy.
- Retain one combined confirm/disburse action unless prototype verification and owner approval require otherwise.

## Screen 6 — Statutory Reconciliation

- Render real linked obligation cards and B1 badge state.
- Add inline existing-style controls for debit bank account and settlement date.
- Call the existing settle endpoint once with the required account/date values.
- Do not introduce a separate enable/fetch step unless verified API behavior requires it.

## Scope

- Verified live payroll controller file(s)
- `fe/src/partials/admin/sections/finance-payroll.html`
- `fe/src/styles/modules/payroll.css`
- `fe/tests/ui/finance-payroll-table-cycle.spec.js`

Do not change backend routes/services, migrations, or RBAC. Stop and report if existing API data is actually insufficient.

## Acceptance Criteria

1. Screen 4 count exactly matches affected returned data.
2. Affected Screen 4 rows show a real missing-bank warning.
3. Screen 5 internal and external totals reconcile exactly to the grand total.
4. Screen 5 renders persisted warning/exception data.
5. Screen 6 can settle with inline account/date in one existing-endpoint action.
6. Screen 6 badge exactly matches B1 resolver output.
7. Existing payroll CSS conventions, including `p-badge` and `payroll-card payroll-stat`, are reused.

## Test Strategy

- Missing-bank count and row-pill Playwright coverage.
- Rail-total reconciliation coverage.
- Real/server-shaped exception rendering coverage.
- Inline record/settle flow coverage.
- Preserve current assertions unless an explicit documented change is needed.

---

# Phase B3 — History Obligation-State Surfacing

## Goal

Show statutory-reconciliation state in the real Screen 1 payroll-run history list before a user opens each run.

## Dependency Gate

B1 and B2 must be merged, and Phase 0 must already provide real history data.

## Behavior

For paid/partially-paid runs, show a secondary indicator using B1 vocabulary:

- `Not Recorded`
- `Recorded — Unpaid`
- `Partially Reconciled`
- `Reconciled`

Use the same shared obligation-state helper/resolver as B1 to prevent history/opened-run divergence.

## Known Limitation

The existing statutory lookup may require one lookup per paid historical row. This bounded cost is accepted only for current small history volumes. Do not add a batching endpoint in this plan.

## Scope

- Verified live payroll controller file(s)
- `fe/src/partials/admin/sections/finance-payroll.html`, only if minor markup is required
- `fe/tests/ui/finance-payroll-table-cycle.spec.js`

## Acceptance Criteria

1. Every paid/partially-paid row shows the correct statutory indicator without opening it.
2. Opening the same row resolves to the same B1 status vocabulary.
3. Shared resolver/helper logic is used.
4. Current small-history load remains acceptable; any observed limitation is reported rather than solved by scope expansion.

## Test Strategy

Add a Playwright cross-check between the history-row badge and the state shown after opening the same run.

---

# Cross-Phase Delivery Rules

## Stop-and-Report Triggers

Stop rather than silently expanding scope if a phase appears to require:

- a migration;
- a new backend endpoint;
- a new RBAC key;
- route removal/deprecation;
- a changed lifecycle model;
- independent Screen 5 rail actions;
- unavailable API fields;
- a background job, bank rail, FX feed, or storage service assumption.

## Required Completion Handoff Per Phase

At the end of each phase, report:

1. **Outcome:** implementation and acceptance-criteria status.
2. **Exact files changed:** repository-relative paths.
3. **Tests:** exact commands plus passed/failed/skipped/error counts.
4. **Confirmed facts:** re-verified repository facts.
5. **Assumptions:** bounded assumptions made during implementation.
6. **Scope exceptions:** deferred items and rationale.
7. **Documentation impact:** whether `docs/project-context/04-decision-log.md`, `05-roadmap-and-next-slices.md`, or `06-open-questions.md` should be updated. Do not edit them without separate owner approval.
8. **Next-phase readiness:** merged gate status or current blocker.

## Initial Intake Checklist

Before Phase -1 code changes, the coding agent must:

1. Confirm branch `feature/payroll-deductions`, current HEAD, merge-base versus `main`, and pending changes.
2. Treat the current branch as implementation truth.
3. Read this revised plan in full.
4. Read the previous v9 plan only as historical/design context.
5. Re-verify both `MISSING_BANK_DETAILS` sites and report changed count/locations if different.
6. Re-verify routing and tests for `/runs/generate`.
7. Propose the exact narrow Phase -1 change, acceptance criteria, and test commands.
8. Wait for owner confirmation before editing.
