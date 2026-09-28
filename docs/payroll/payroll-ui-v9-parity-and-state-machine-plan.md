# HRFlow Payroll UI — v9 Parity, D-006 Fix, and State Machine

**Prepared:** September 28, 2026
**Branch (implementation truth for this task):** `fix/payroll-ui-drift-and-finalize-error-handling`
**HEAD at time of planning:** `b32607cb01` — "align screen 1 and 4 summary card classes with payroll-stat styling"
**Merge-base:** `main` at `9d6394aeeaa3631d1787a6a94b8181da3c0c3690` (10 commits behind this branch)
**Design reference:** `payroll-full-cycle-prototype-v9.html` (attached prototype) — approved as the current target design, superseding `payroll-final-prototype.html` (older 3-step prototype, now historical only)
**Scope note:** Open questions Q-001–Q-005 are explicitly set aside for this plan per owner direction; none of them gates the work below.

---

## 1. Verified Current Behavior

### 1.1 Branch and lifecycle

The payroll module implements a six-screen frontend (`fe/src/partials/admin/sections/finance-payroll.html` + `fe/public/js/finance-payroll.js`) mapped onto a five-state backend lifecycle in `be/finance/services/payroll_service.py`:

`draft → submitted → approved → finalized → paid / partially_paid`

| Screen | Label | Lifecycle action on entry | Editable |
|---|---|---|---|
| 1 | Initiation & FX | None (preview only) | Yes |
| 2 | Approve & Adjustments | Persists `draft → submitted → approved` on "Submit & Approve" | Yes |
| 3 | Processing (Statutory Snapshots) | Triggers `finalize_run()` (`approved → finalized`) | No (read-only) |
| 4 | Payment Preview | None (reads `finalized` run) | No |
| 5 | Payment Confirmation & Disbursal | Triggers disbursement (`finalized → paid`/`partially_paid`) | Action-only |
| 6 | Statutory Reconciliation | None — independent of run status, calls `/api/finance/statutory-obligations` directly | Yes |

This matches decision **D-008** (six-screen redesign, Screen 6 statutory linkage via Option (b): frontend-only call to the existing manual statutory-obligations endpoint, prefilled from run snapshot totals, traced via a `payroll_run_id:{id}` tag in the obligation's `notes` field — no formal FK exists).

### 1.2 Confirmed defect: D-006 is violated on this branch

`create_run_preview()` in `payroll_service.py` raises a `severity: "blocking"` exception (`code: "MISSING_BANK_DETAILS"`) whenever an employee has an external-USD compensation component but no bank record or IBAN. `approve_run()` filters `exceptions_json` for `severity == "blocking" and not is_resolved` and raises **HTTP 400**, preventing "Submit & Approve Run" on Screen 2. This reproduces the exact conflict `docs/project-context/00-project-start-here.md` documented against `main` — verification confirms it is **not fixed** on this feature branch either, despite the six-screen redesign otherwise being D-006-aware in its UI copy ("non-blocking (D-006)" strings already appear in the v9 prototype and in Screen 5's static exception text).

Accepted decision **D-006** requires missing bank details to be a visible, non-blocking warning — never a hard block on payroll progression.

### 1.3 Data already available, currently underused

- Every payroll line already carries `bank_account_masked` (e.g. `"••••4821"` or `"Not Provided"` fallback) and `bank_name` (`"Unassigned"` fallback), computed per-employee from `emp.bank_account` in `payroll_service.py`. Screen 4's current markup ignores this and renders a hardcoded placeholder pill (`"Verified Wire ****8821"`) instead.
- `GET /api/finance/payroll/runs/{run_id}` (`_format_run_detail`) and `GET /api/finance/payroll/runs` (`_format_run_summary`) already return `status`, `exceptions` (parsed from `exceptions_json`), and full `lines` — everything needed to know where a run is in its lifecycle.
- `POST /api/finance/statutory-obligations/{id}/settle` already accepts `bank_account_id` and `payment_date` in a single call (`StatutoryObligationSettle` schema), atomically posting a ledger transaction and updating the bank balance. Screen 6's current UI splits this into a disabled "Remit Payment" button gated on a separate fetch, not because the backend requires two steps.
- `StatutoryObligationDB` records carry their own `status` (`accrued`/`remitted`/etc.), independently queryable and already matched via the `payroll_run_id:{id}` notes tag by `loadLinkedStatutoryObligations()`.

**Conclusion:** the data needed for both the D-006 fix and the state-machine/resume feature already exists and is already partially fetched. The gaps are in how the frontend *uses* what's already available — not missing backend capability.

### 1.4 Confirmed frontend gap: no state-aware resume

`PayrollApp.openRun('current')` unconditionally calls `setStep(0)`, ignoring `currentRun.status`. `openHistoryRun()` has partial status→step mapping (paid/partially_paid → step 4, finalized → step 3, approved → step 2, else → step 1) but this logic is not shared with `openRun()`, and neither path considers statutory-obligation sub-state at all. This is the root cause of the exact scenario described in planning: a run sitting at Screen 6 with an SI obligation recorded-but-unpaid reopens at Screen 1 instead of Screen 6.

### 1.5 RBAC and permissions (unchanged, verified present)

`finance.statutory.read` / `finance.statutory.write` are already seeded in `be/core/rbac_seed.py` per D-008, granted explicitly to `system_admin` in addition to the wildcard `*`. The documented D-008 gap (frontend gate ≠ backend `finance.bill.write` guard) is unaffected by this plan and remains out of scope.

### 1.6 Existing test coverage

`fe/tests/ui/finance-payroll-table-cycle.spec.js` (345 lines) already exercises the in-page architecture, 6-step stepper, Screen 1 FX override, and Screen 2 bonuses under a `?mock=admin` fixture. No existing assertions cover blocking-exception surfacing, missing-bank-detail display, or Screen 6 inline settlement/resume state.

---

## 2. Product Goal and Success Criteria

**Goal:** Close the verified gap between the shipped six-screen payroll UI and the approved v9 prototype, fix the confirmed D-006 policy violation, and add a durable state machine so any run/obligation state survives a close-and-reopen — without expanding scope into anything the roadmap or RBAC model doesn't already support.

**Success criteria:**
1. A run with an employee missing bank details can reach "Paid" without being blocked at approval.
2. Screen 4/5 visibly flag the specific affected employee(s), matching v9's "N missing bank details" treatment.
3. Screen 5 visually separates Internal and External disbursement rails, matching v9.
4. Screen 6 supports recording and settling an obligation with bank account + date inline, in one action.
5. Reopening any run — at any lifecycle stage, including a "paid" run with an obligation recorded but unremitted — lands the user on the correct screen with the correct sub-state badge, with no manual navigation required.
6. All pre-existing tests continue to pass except where explicitly and intentionally updated.

---

## 3. Confirmed Facts vs. Assumptions

**Confirmed (code-verified):**
- Exact trigger condition and enforcement point of the blocking bank-details exception.
- `bank_account_masked`/`bank_name` per-line fields and their fallback values.
- `StatutoryObligationSettle`'s existing single-call shape (`bank_account_id`, `payment_date`).
- `run.status` and `run.exceptions` already round-trip through `GET /runs` and `GET /runs/{id}` — durable, not client-memory-only.
- RBAC keys for statutory read/write are seeded to `system_admin` only; no other role currently exists to test the documented D-008 gap.
- `_format_run_summary()`'s exact field set (used to confirm the history-list extension in Phase B3 is feasible without new backend fields).

**Assumptions / decisions already made by the owner in this thread (not re-litigated here):**
- Open questions Q-001–Q-005 are set aside for this plan.
- The state resolver may trust `list_payroll_runs()` summary status plus a single `loadLinkedStatutoryObligations()` call per opened run, rather than re-verifying state with additional round trips on every open.
- The Screen 1 history list should also surface the obligation sub-state per row (Phase B3), extending the same resolver logic rather than deferring it.

**Still open / not assumed:**
- Whether Screen 5's two-rail split should allow independently confirming/disbursing External vs Internal, or remain a single confirm action with two informational cards. This plan assumes the latter (single action, two cards) unless told otherwise.
- Whether `execute_payment`/`mark_paid` contains an independent, separate bank-details block not covered by the `create_run_preview()` exception reviewed here — not yet verified line-by-line across the full 1993-line service file.

---

## 4. Impact Analysis

| Dimension | Impact |
|---|---|
| **Architecture** | None. No new domain, service, or cross-domain boundary change. Finance retains ownership of `PayrollRunDB`/exceptions and `StatutoryObligationDB`; HR's `EmployeeBankAccountDB` remains the read-only source for masked bank data. |
| **Data / migrations** | None anticipated anywhere in this plan. No new Alembic migration. All consumed fields already exist and are already returned by current endpoints. |
| **Authorization / security** | None. No permission keys added, removed, or re-scoped. Existing `finance.payroll.*` and `finance.statutory.*`/`finance.bill.*` guards apply unchanged. |
| **Backward compatibility** | The D-006 severity change (Phase A) alters behavior for any run currently blocked by this exact exception — intended. Any test or caller asserting the old 400 must be updated, not silently left failing. All frontend changes (Phase B) are additive UI/logic changes with no API-shape changes. |
| **Test impact** | `be/tests/test_finance_guided_payroll.py` needs a located-and-updated assertion (Phase A). `fe/tests/ui/finance-payroll-table-cycle.spec.js` needs new cases per phase (B1–B3). No existing spec is expected to require deletion. |

---

## 5. In-Scope and Out-of-Scope

**In scope:**
- Reclassify `MISSING_BANK_DETAILS` from blocking to warning severity (D-006 compliance).
- Missing-bank-detail visualization on Screens 4 and 5.
- Screen 5 two-rail (Internal/External) visual split.
- Screen 6 inline settlement (bank account + date) wired to the existing `settle` endpoint.
- A client-side state resolver mapping `run.status` + obligation sub-state to the correct screen and badge, replacing the current unconditional/partial resume logic.
- Extending the Screen 1 history list to surface the same obligation-state badge per row.
- Backend and frontend test updates/additions for all of the above.

**Out of scope (explicitly deferred):**
- Q-001–Q-005 and anything gated by them.
- The documented D-008 gap between `finance.statutory.write` (frontend) and `finance.bill.write` (backend).
- Any change to `finalize_run()`'s no-statutory-side-effects behavior.
- Independent per-rail disbursement actions on Screen 5 (single combined action assumed).
- Any new backend endpoint, field, or migration for batched obligation-state lookups at scale (flagged as a future limitation in Phase B3, not solved here).
- Employee self-service payslips, HR RBAC harmonization, or any other roadmap slice unrelated to payroll UI.

---

## 6. Implementation Plan

### Phase A — Backend: D-006 Non-Blocking Bank Details

**Proposed behavior.** Change the `MISSING_BANK_DETAILS` exception's `severity` from `"blocking"` to `"warning"` in `create_run_preview()`. No change needed to `approve_run()`'s filter logic — it already only reacts to `severity == "blocking"`.

**Affected modules:**
- `be/finance/services/payroll_service.py` — one field value in one dict literal.
- `be/tests/test_finance_guided_payroll.py` — locate and update the specific test asserting a 400 on approval with missing bank details.

**Data/migration impact:** None — `exceptions_json` is unstructured JSON.

**Authorization/security implications:** None.

**Backward compatibility and rollback:** Any run currently stuck due to this exception becomes approvable post-deploy (intended fix). Single-line revert if needed.

**Acceptance criteria:**
1. Preview generation for an employee with an external-pay component and no bank record produces a `warning`-severity `MISSING_BANK_DETAILS` exception, not `blocking`.
2. `approve_run()` succeeds for such a run without raising 400.
3. The exception remains present and visible in `run.exceptions` for Phase B2 to consume.

**Test strategy:** Update the existing failing-approval assertion; add a new test asserting successful approval with only warning-level exceptions; regression-test that `finalize_run`/`execute_payment` still succeed downstream.

---

### Phase B1 — Frontend: State Resolver and Resume Logic

**Proposed behavior and user flow.** Introduce a single resolver function, e.g. `resolveRunState(run, obligations)`, called from `openRun('current')`, `openHistoryRun()`, and on `init()` if a run is already active. It maps lifecycle state to the correct screen and, only when `status` is `paid`/`partially_paid`, reads the existing `loadLinkedStatutoryObligations()` result to derive a Screen 6 badge — no new network calls beyond what already exists.

| Run status | Obligation sub-state | Resolved screen | Screen 6 badge |
|---|---|---|---|
| `draft` / `submitted` | n/a | Screen 2 | — |
| `approved` | n/a | Screen 3 (auto-finalizes on entry, existing gate unchanged) | — |
| `finalized` | n/a | Screen 4 | — |
| `paid` / `partially_paid` | no linked obligations found | Screen 5 | "Not Recorded" |
| `paid` / `partially_paid` | ≥1 obligation `accrued`, none `remitted` | Screen 6 | "Recorded — Unpaid" |
| `paid` / `partially_paid` | mix of `accrued` and `remitted` | Screen 6 | "Partially Reconciled" |
| `paid` / `partially_paid` | all obligations `remitted` | Screen 6 | "Reconciled" |

This directly resolves the reference scenario: a run at Screen 6 with SI recorded-but-unpaid reopens at Screen 6 showing "Recorded — Unpaid."

**Affected modules and interfaces:**
- `fe/public/js/finance-payroll.js`: new `resolveRunState()` function; `openRun()` and `openHistoryRun()` refactored to call it instead of their current unconditional/duplicated logic. `setStep()` itself is unchanged — it remains the mechanism, not the decision point.
- No HTML changes required for B1 alone (badge rendering is visual, deferred to B2).

**Data/migration impact:** None — client-side branching over existing response fields only.

**Authorization/security implications:** None — uses the same read-permission-gated calls already in use.

**Backward compatibility and rollback:** If `resolveRunState()` cannot determine a state (malformed/unexpected data), default to Screen 1 — preserving today's fallback behavior, so no regression on edge cases. Revertible by reverting this function and its two call sites.

**Acceptance criteria:**
1. Opening a `paid` run with an `accrued`, unremitted SI obligation lands on Screen 6 with a "Recorded — Unpaid" badge, no manual navigation.
2. Opening a `draft` run lands on Screen 2; a `finalized` run lands on Screen 4 — applying `openHistoryRun()`'s existing mapping consistently to `openRun('current')` too.
3. A full page reload (not just in-app navigation) preserves the same resolved screen, since all inputs are server-persisted.

**Test strategy:** New Playwright cases seeding mock runs at each status combination in the table above, asserting correct screen and badge after a fresh `page.goto()` reload — proving state survives a close/reopen, not just in-session navigation.

---

### Phase B2 — Frontend: v9 Visual Parity (Screens 4, 5, 6)

**Proposed behavior and user flow.**
- **Screen 4:** New "Missing Bank Details" stat card showing a live count from `run.lines`/preview recipients where `bank_account_masked === "Not Provided"`. Affected rows show a "Missing bank details" pill instead of today's hardcoded bank placeholder.
- **Screen 5:** Split into two cards — "Internal Salaries" and "External Salaries" — each with its own total, payment date, funding account name, and recipient count, computed from `run.lines` grouped by `compensation_type`. The exception strip renders real `run.exceptions` entries (now warning-severity after Phase A) instead of the current static "verified" string.
- **Screen 6:** Each obligation card gains inline "Debit From Bank Account" (populated via `FinanceApi.getAccounts`) and "Settlement Date" fields. "Remit Payment" becomes a single action calling the existing `settle` endpoint with these inline values. The card displays the B1-resolved badge.

**Affected modules and interfaces:**
- `fe/src/partials/admin/sections/finance-payroll.html` — Screen 4 stat card; Screen 5 two-card layout; Screen 6 inline inputs.
- `fe/public/js/finance-payroll.js` — `drawScreen4()`, `drawScreen5()`, `drawScreen6()`/`settleStatutory()`.
- `fe/src/styles/modules/payroll.css` — new classes for the missing-bank pill and two-rail cards, following existing `p-badge`/`payroll-card payroll-stat` conventions already present in the file.

**Data/migration impact:** None — all consumed fields already exist.

**Authorization/security implications:** None. Screen 6 continues routing through existing `finance.statutory.write` (frontend) / `finance.bill.write` (backend) guards; the documented D-008 gap is unchanged and untouched.

**Backward compatibility and rollback:** Additive/replacement UI only, no dual-rendering risk. Revertible independently of Phase A and B1 since it only touches presentation.

**Acceptance criteria:**
1. Screen 4's missing-bank count matches the actual count of lines with `bank_account_masked === "Not Provided"` — no false positives/negatives against seeded mock data.
2. Screen 5's two rail totals sum to the same grand total shown today.
3. Screen 6's "Remit Payment" succeeds in one click using inline account/date, with no separate enable-then-click step.
4. Screen 6's badge matches the B1-resolved sub-state exactly.

**Test strategy:** Playwright cases for the missing-bank pill, independent rail totals on Screen 5, and a full record→settle flow completing via inline fields in one interaction.

---

### Phase B3 — Frontend: History List Obligation-State Surfacing

**Proposed behavior and user flow.** Screen 1's runs table gains a secondary indicator per `paid`/`partially_paid` row (e.g., "· SI Unsettled" or a small badge beside the status pill), reusing B1's badge vocabulary so operators can spot incomplete reconciliation without opening each run.

**Affected modules and interfaces:**
- `fe/public/js/finance-payroll.js` — `drawRunsList()` extended to look up or batch-fetch linked obligations per `paid`/`partially_paid` row (reusing the notes-tag matching logic, refactored into a shared helper with B1) and apply `resolveRunState()`'s badge logic.
- `fe/src/partials/admin/sections/finance-payroll.html` — minor markup for the secondary badge in the runs table.

**Data/migration impact:** None. Reuses `GET /api/finance/statutory-obligations` per run — now potentially called once per historical `paid` row shown, not just per opened run. This is a real, bounded cost increase worth being explicit about.

**Authorization/security implications:** None — same read-permission path already used.

**Backward compatibility and rollback:** Additive to runs-list rendering only; revertible independently of B1/B2.

**Acceptance criteria:**
1. Every `paid`/`partially_paid` history row shows the correct obligation-state badge without opening the run.
2. Runs list load time remains acceptable for current (small) history size.

**Test strategy:** Playwright assertion that the runs-list badge matches what a direct `openHistoryRun()` on that row resolves to — cross-checking B1 and B3 share logic rather than diverging.

**Known limitation (flagged, not solved here):** If historical `paid` run count grows large, per-row obligation lookups will not scale as sequential calls. A future batched "obligations by period-list" backend query could remove this cost — that would be a backend change outside this plan's no-new-backend-endpoint scope for Phase B, and is explicitly deferred.

---

## 7. Consolidated Sequencing

| Phase | Backend change? | Depends on | Ships independently? |
|---|---|---|---|
| A — D-006 severity fix | Yes | Nothing | Yes |
| B1 — State resolver/resume | No | Nothing (reads existing fields) | Yes |
| B2 — Visual parity | No | B1 for Screen 6's badge only; Screens 4/5 independent of B1 | Partially |
| B3 — History list badges | No | B1 (shared resolver logic) | No |

Recommended merge order: **A → B1 → B2 → B3**. Phase A and B1 can proceed in parallel (different files, no shared dependency) but should each be reviewed and merged as their own PR before B2 begins, since B2's Screen 6 piece and all of B3 depend on B1 existing.

---

## 8. Coding-Agent Handoff

**Read before editing:**
- `be/finance/services/payroll_service.py` in full. Sections directly verified in this planning pass: `create_run_preview()` (lines ~200–400, including the bank-details exception and per-line snapshot construction), `submit_run`/`approve_run`/`finalize_run` (lines ~1400–1490), `_format_run_summary`/`_format_run_detail`/`_format_line_dict` (lines ~1863–1993). **Not yet verified:** `execute_payment`/`mark_paid` internals (referenced around lines 1589–1945 but not read line-by-line) — check for any independent bank-details block before assuming Phase A's fix is the only place this needs to change.
- `be/finance/routers/payroll.py` and `be/finance/routers/statutory.py` — both read in full; confirm no route changes are needed (none are planned).
- `fe/public/js/finance-payroll.js` — read in full (1649 lines); confirm exact current implementations of `openRun()`, `openHistoryRun()`, `setStep()`, `drawScreen4()`, `drawScreen5()`, `drawScreen6()`, `loadLinkedStatutoryObligations()`, `settleStatutory()`, `drawRunsList()` before editing, since this plan describes target behavior, not exact diffs.
- `fe/tests/ui/finance-payroll-table-cycle.spec.js` — read in full to locate exact existing assertions before adding new ones, to avoid duplicating coverage or breaking existing locators.
- `be/tests/test_finance_guided_payroll.py` — not yet read in full; locate the specific blocking-approval assertion before editing.

**Do not assume:**
- Exact CSS class names for the new badges/pills/cards — derive from existing conventions (`p-badge`, `payroll-card payroll-stat`) already used in `payroll.css` and the six-screen HTML.
- That Screen 5's two rail cards should have independent confirm/disburse actions — this plan assumes a single combined action with two informational cards; confirm before implementing if this assumption needs revisiting.
- That `execute_payment`/`mark_paid` has no independent bank-details check — verify before closing out Phase A as complete.

**Sequencing:** Implement and merge in order A → B1 → B2 → B3. Do not begin B2's Screen 6 work or any of B3 before B1's resolver is merged, since both depend on its badge vocabulary and logic.

**Flag before merging, don't fix silently:**
- Any discovery that `execute_payment`/disbursement has its own independent bank-details block not covered by Phase A — this would need a separate, explicitly scoped follow-up.
- Any discovery that the v9 prototype's Screen 5 two-rail layout implies independent per-rail actions (not yet verified against the prototype's own JS behavior, only its markup) — if so, report back before changing the single-action assumption used throughout this plan.

**End-of-task handoff format (per project thread protocol):** On completion of each phase, state outcome, files changed, exact test results (pass/fail counts, not just "tests pass"), and explicitly separate confirmed facts from any new assumptions surfaced during implementation. Identify whether `docs/project-context/04-decision-log.md` needs a new entry (e.g., recording the D-006 fix as implemented) or whether `06-open-questions.md`/`05-roadmap-and-next-slices.md` need status updates — do not update those documents automatically as part of code changes without a separate review step.
