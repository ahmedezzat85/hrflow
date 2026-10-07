# Handoff prompt: compensation entry points plan

Paste the block below to the coding agent at the start of each slice. Replace `H?` with the slice id (start with `H1`).

---

You are implementing slice **H?** of `docs/hr/01-compensation-entry-points-plan.md` in the HRFlow repository. HRFlow is an internal HR, Finance and Payroll tool: a FastAPI backend in `be/` and a vanilla HTML, CSS and JavaScript frontend in `fe/` built by Vite.

**Read first, in this order**

1. `AGENTS.md`
2. `docs/project-context/00-project-start-here.md`
3. `docs/hr/01-compensation-entry-points-plan.md`: all of it
4. `docs/fix-plans/01-ui-refinements-plan.md` section 4 (ground rules) and the button and form-control documentation at the top of `fe/src/styles/components.css`

**What the owner has already decided. Do not reopen these.**

- The Salary and Raises page stays, as a **read-only** overview. The toolbar "Apply New Raise" button goes.
- The employee profile is the single place to apply a raise or edit a compensation plan, through a new Compensation card.
- Search moves into the table card header.
- The finalized-payroll effective-date guard is **not** touched. The owner handles historical data at go-live. Raises dated inside a finalized period fail with the backend message; show that message in the existing error toast.
- Backend, security and calculation changes are out of scope. If you think one is needed, report it; do not make it.
- Do not edit `docs/project-context/*` or `docs/REVIEW.md`. Do not decide open questions.

**Facts established in the previous session. Verify them at intake, do not assume.**

- Per-employee raise history is already in memory: `employees[].salaryHistory` (built in `fe/public/js/app.js`, `normalizeEmployee`). No new API is needed.
- `raiseModal` and `compPlanModal` are in `fe/src/partials/modals/`. `openCompPlanModal` is also used by the payroll "fix issue" link (`fe/public/js/finance-payroll.js`). Keep both modals and their global functions.
- `viewProfile(id, section)` in `fe/public/js/employees.js` already scrolls to a section for `bank` and `social`; add `compensation` the same way.
- `hr.salary.read` and `hr.salary.write` are separate from `hr.employee.*`. The backend enforces them; the frontend only hides.
- Raises go through the effective-date guard in the backend (see plan section 7).

**Working notes that will save you time**

- **Build before testing.** Playwright reuses a static server on port 8080 that serves `fe/dist`. Run `npm run build` in `fe/` before every UI test run or you test stale code. Do not rebuild while a full Playwright run is in progress.
- **Baseline at 2026-10-07: 15 failing specs** (`npx playwright test --reporter=line` from `fe/`). They are not yours: `finance-bills-approval:149`, `finance-dialogs-forms:101` and `:186`, `finance-guided-payroll:18` and `:59`, `finance-navigation:106`, `finance-payroll-commission-bonus:17`, `finance-payroll-runner-adjustments:17`, `finance-payroll-split:17`, `finance-payroll-table-cycle:970`, `frontend-consistency-phase-a:15`, `reports:16`, `:38`, `:53`, `:68`. Re-run the baseline once at intake; the numbers may differ after the refinements plan merged. A few other specs flake under load; rerun a failing spec alone with `--retries=0` before treating it as a regression.
- Working-tree files are CRLF. Edit with the Edit tool or with a script that preserves line endings, and check `git diff --stat` is small before committing.
- Playwright runs in `channel: 'chrome'`. For screenshots, write a small Node script in the scratchpad that imports `@playwright/test` from `fe/node_modules`, sets `document.documentElement.setAttribute('data-theme', 'dark')` for dark, and use `?mock=admin`.
- A shared `escapeHtml` is in `fe/public/js/ui.js`. A shared `toast()` is there too; it clears error toasts when the page changes.
- Shared button set: `btn btn-fill` (one primary per screen), `btn btn-outline`, `btn btn-quiet`, `btn btn-sm`, `btn-danger-outline`. Controls: `.form-control` and `.form-input` are the same look. No new inline `style=`, no hex colours outside `fe/src/styles/tokens.css`.
- Never poll background commands. Run the full suite once at the end of a slice, in the background, and wait for the notification.
- Per `AGENTS.md`, after a slice passes, stage only the relevant files, commit with a descriptive message and push the active branch. **Only after the owner has approved the slice** in this project; until then, leave it uncommitted.

**Your first reply must contain only this, then stop and wait for approval**

1. A branch-intake block: branch, HEAD, merge-base with `main`, and whether `git status` is clean once line endings are ignored.
2. Whether the refinements plan (R1 to R6) is in this branch, and whether the app you can run is a fresh build of HEAD.
3. For each change in the slice: the current behaviour you verified in code, with file and line. Say plainly if something in the plan is already fixed or no longer matches the code.
4. The exact list of files you will change, including the specs you will update.
5. The acceptance criteria, copied from the plan.
6. Anything unclear. Ask the owner the three kickoff questions from plan section 8 (hard-coded year, "last raise" ordering, nav label) before you design around them.
7. Anything that would need a backend change. Report it; do not make it.
8. The Playwright baseline, listing the failing specs.

**After approval**

- Implement this slice only. Frontend only; nothing under `be/`.
- Do not rename or remove element ids, `data-page` values or global function names that are still used.
- Keep mock mode working (`?mock=admin`); mock employees carry `salaryHistory`.
- Do not change which numbers the app computes, stores or requests, except where the owner says so in answer to the kickoff questions.

**Finish with a handoff**

1. Outcome per acceptance criterion: met, not met or unverified.
2. Files changed.
3. Commands run with exact results: CSS variable check, build, Playwright now against the baseline, the new specs.
4. Screenshots at 1440px and 390px, light and dark, of each page touched.
5. Anything you could not verify, and which criteria need the owner's manual check on the real backend (a raise applied from the profile, and a role with `hr.salary.read` only).
6. Follow-ups, including anything that belongs in `docs/REVIEW.md`.

Then stop. Do not start the next slice until the owner approves this one.
