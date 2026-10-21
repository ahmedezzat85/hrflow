# 28 — Claude Code Handoff: Pay Plan Sync and Pay Plan Modal (P1–P3)

Plan (authoritative): `docs/finance-module/27-pay-plan-sync-and-modal-plan.md`. Decision: D-034, accepted by owner October 21, 2026. Q-008 stays **Open** (interim treatment extended to raises). Do not reopen D-016 to D-034. No migration is planned.

## 0. Start here

1. The owner's working tree may contain uncommitted edits that are not yours (at last check: `be/finance/services/*`, `be/finance/storage_paths.py`, `be/tests/test_finance_uploads_dir.py`, `deploy/prod/*`, `export.xlsx`). Never run `git add -A` or `git add .`; stage explicit paths only. Do not stash, reset or revert them. If a `git switch` would conflict with them, stop and tell the owner.
2. The branch `feature/pay-plan-sync` already exists and carries the docs commit (plan 27, this handoff, D-034, roadmap 3G, Q-008 note, and the characterization test file). Check it out; do not recreate it. If it is missing, create it from `main` and re-add the docs.
3. Read, in order: `AGENTS.md`, `docs/project-context/00-project-start-here.md`, plan 27, D-034, Q-008, then the code: `be/finance/services/compensation_plan_service.py`, `be/finance/repositories/compensation_plan_repository.py`, `be/finance/routers/compensation_plans.py`, `be/repositories/sql/employees.py` (create/update write-through), `be/repositories/sql/salary.py` (`apply_raise`), `be/routers/salary.py`, `be/repositories/dual/salary.py`, `be/tests/test_finance_compensation_plan.py`, `be/tests/test_salary_history_data_entry_checks.py`, and for the UI `fe/src/partials/modals/compensation-plan-modal.html`, `fe/src/partials/modals/raise-modal.html`, `fe/public/js/salary.js`, `fe/public/js/employees.js`.
4. Post a branch-intake block: branch, HEAD, merge-base with `main`, Alembic head (expected: no new migration), files you expect to touch, anything in plan 27 that differs from the code, and the baseline result of `test_salary_history_data_entry_checks.py` (expected: 10 passed, 1 xfailed).
5. Begin P1. Do not wait for approval between slices unless a stop condition below is hit.

## 1. Slices

Work in order P1 → P2 → P3. Commit prefix per slice (`P1: …`). Each slice leaves the app working and the full backend suite green. Scope and acceptance criteria are in plan 27 §3–§4; do not alter them without telling the owner.

- **P1** `apply_pay_change` in `CompensationPlanService` (one transaction, one audit entry, zero closes a component, both-zero rejected before any write, finalized guard on every change, new guard against overlapping a closed row, close needs a date strictly after the active start). Refactor `set_component` so its inner logic flushes and only the public wrappers commit; its public behaviour and tests stay unchanged. Raise: reject future dates, call `apply_pay_change`, then write history and `next_raise`; remove the history-only branch. Employee update: route salary fields through it, no-op when unchanged. Convert the characterization test file into regression tests.
- **P2** atomic `PUT /api/finance/employees/{id}/compensation-plan`, `earliest_effective_date` on the GET, single-form Pay plan modal, API wrapper, mock handlers, Playwright and updated specs.
- **P3** "Pay effective from" on the create modal (`pay_effective_from`), read-only pay + "Edit pay plan" button on the edit modal.

## 2. Rules

- Plan rows are never deleted; closing sets `effective_end_date`. No schema change. If you believe one is needed, stop and ask.
- Permissions: `PUT /compensation-plan` and the existing per-component `PUT` need `finance.payroll.prepare`; the raise stays `hr.salary.write` and calls the **service** (not the router) so it does not require the finance permission (D-034 / Q-008 interim). Backend `require_permission` on every endpoint.
- The existing per-component `PUT /{component_type}` keeps rejecting amounts ≤ 0 and its current tests stay green.
- No background jobs, no external services, no new auth. Google Sheets stays export-only; leave the dual-write shadow path as is.
- Do not touch payroll calculation, tax or social-insurance logic.
- Frontend: D-027 `.fv` scope, no colour literals (`npm run lint:finance-tokens`), `npm run build` in `fe/` before any Playwright run, mock mode updated for every new visible state.
- Test data is synthetic only. Tests use the standard fixtures and an isolated DB. Never run anything against production data.
- Tests: targeted during work; the full `pytest be/tests -q` and the relevant Playwright specs once at the end of each slice.

## 3. Stop and ask the owner only if

- A change alters numbers in any existing payroll or report test and the cause is not a bug in new code.
- A decision (D-001 to D-034) conflicts with what the code needs, or plan 27 contradicts the code.
- A schema change or migration seems necessary.
- Making the raise atomic with the plan requires changing the dual-write or Sheets path in a way that affects exports.
- Anything points toward changing who may edit compensation plans (Q-008 itself is not yours to decide).

Otherwise use the nearest established repository pattern and continue.

## 4. End-of-slice report (post after each slice, then continue)

Slice ID and commits; files changed (`git diff --stat`); tests run with exact pass/fail counts; confirmed facts vs assumptions; deviations from plan 27 and why; docs updated (mark the slice Done in roadmap 3G). After P3: final full regression, push the branch, open a PR to `main` summarising slices and test results, and list any decision-log or open-question updates still needed.

## 5. Prompt to paste into Claude Code

```text
Work on HRFlow, branch feature/pay-plan-sync (already created from main with the docs commit).

Read docs/finance-module/28-pay-plan-claude-code-handoff.md first and follow it exactly; the authoritative plan is docs/finance-module/27-pay-plan-sync-and-modal-plan.md and the decision is D-034 (accepted by the owner on October 21, 2026).

Goal: (1) make raises and employee edits reach the compensation plan that payroll reads, (2) let 0 close a component (either component may be 0, never both), and (3) replace the multi-step Pay plan dialog with one form backed by one atomic endpoint, then (4) fix the create/edit employee modals' pay handling.

Do now: check out the branch, post the branch-intake block (branch, HEAD, merge-base, expected baseline of be/tests/test_salary_history_data_entry_checks.py = 10 passed, 1 xfailed), then implement slice P1, then P2, then P3, with the end-of-slice report after each. Stage explicit paths only; the working tree has uncommitted edits of the owner's that you must not touch. Stop only on the conditions listed in section 3 of the handoff.
```
