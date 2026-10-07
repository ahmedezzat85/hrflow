# Compensation entry points plan: one place to change pay

**Status:** Scope approved by the owner on 2026-10-07. Not started. Implementation kicks off on a new branch after the UI refinements plan (`docs/fix-plans/01-ui-refinements-plan.md`, slices R1 to R6) is merged.
**Created:** 2026-10-07
**Scope:** frontend only. The Salary and Raises page becomes a read-only overview; the employee profile becomes the single place to change one person's pay.
**Related, not part of this plan:** the finalized-payroll guard on effective dates (see section 7).

---

## 1. Why

Today there are **seven** ways to change one employee's pay:

| # | Where | Control | Opens | Writes a raise record? |
| :-- | :-- | :-- | :-- | :-- |
| 1 | Salary and Raises, toolbar | "Apply New Raise" | `raiseModal` with an employee dropdown | Yes |
| 2 | Salary and Raises, each row | "Raise" | `raiseModal`, employee preselected | Yes |
| 3 | Salary and Raises, each row | "Plan" | `compPlanModal` | No |
| 4 | Salary and Raises, External USD cell | pencil | `compPlanModal` (external) | No |
| 5 | Salary and Raises, Internal USD cell | pencil | `compPlanModal` (internal) | No |
| 6 | Employee profile, Quick Actions | "Apply Salary Raise" | `raiseModal`, preselected | Yes |
| 7 | Employee profile, "Payroll and payments" card | "View compensation plan" | `compPlanModal` | No |

Problems:

- Paths 3, 4, 5 and 7 change pay **without a raise record**, so raise history is incomplete.
- Path 1 asks the user to pick the employee from an unsearchable dropdown for a money-affecting change.
- The employee profile cannot show a person's raise history, their external and internal split, or their next and last raise date. Only the list page can, so people open the list to look and the profile to act.

## 2. Decisions already made by the owner

| # | Decision |
| :-- | :--- |
| 1 | Keep the Salary and Raises page, as a **read-only** overview. |
| 2 | Remove the toolbar "Apply New Raise" button. |
| 3 | The employee profile becomes the single place to apply a raise or edit a plan. |
| 4 | The page's search moves into the table card header; no search bar floating alone in a toolbar. |
| 5 | Do nothing about the finalized-payroll guard on effective dates now (section 7). |

Do not reopen these. Do not decide open questions in `docs/project-context/06-open-questions.md`.

## 3. Verified facts at 2026-10-07 (HEAD `1d02045` of `fix/review-ui-fixes`)

| Fact | Where |
| :-- | :-- |
| Raise history per employee is **already loaded**: `Api.getSalaryHistory()` fills `employees[].salaryHistory` (date, prev, next, pct, reason, newInternal, newExternal, prevInternal, prevExternal). No new API is needed. | `fe/public/js/app.js:31-36`, `normalizeEmployee` at `app.js:1-12` |
| Backend route and permission: `GET /api/salary/history` needs `hr.salary.read`; `POST /api/salary/raise` needs `hr.salary.write`. | `be/routers/salary.py` |
| Salary permissions are separate keys from employee permissions (`hr.salary.*` vs `hr.employee.*`), but both are held today only by Super-Admin and HR-Admin. | `docs/project-context/rbac/permission-matrix.md` |
| Salary page render, row buttons, pencils, search, stat cards. | `fe/public/js/salary.js:20-90` (`renderSalaryPage`), `fe/src/partials/admin/sections/salary.html` |
| Raise modal and comp-plan modal markup live outside the page, so removing page buttons does not remove the modals. | `fe/src/partials/modals/raise-modal.html`, `fe/src/partials/modals/compensation-plan-modal.html` |
| `openCompPlanModal` is also called from the payroll "fix issue" link for `MISSING_COMP_PLAN`. It must keep working. | `fe/public/js/finance-payroll.js:846`, `fe/public/js/salary.js:159` |
| Employee profile quick action "Apply Salary Raise". | `fe/src/partials/admin/sections/employee-detail.html:185` |
| "Payroll and payments" card with "View compensation plan" button and monthly total. | `fe/public/js/employees.js` `loadPayrollPaymentsCard` (about line 617) |
| `viewProfile(id, section)` already supports deep links to a section of the profile (`bank`, `social`) by scrolling to a card. | `fe/public/js/employees.js:121-130` |
| The company-wide raise history table and the four stat cards are built from `employees[].salaryHistory`. | `salary.js:20-33, 70-90` |
| Specs that reference these buttons or ids (re-check at intake): `admin-dual-rail`, `admin-rail-landing`, `finance-compensation-plan`, `forms-feedback`, `hr-tables`, `mobile-a11y`, `shell-foundations` (R3-3 expects one primary on `a-salary`), `topbar-account-menu`, `truthful-screens`. | `fe/tests/ui/` |

## 4. Ground rules

The ground rules of `docs/fix-plans/01-ui-refinements-plan.md` section 4 apply: frontend only, vanilla HTML, CSS and JS, tokens only, no new inline `style=`, shared `escapeHtml`, do not rename or remove element ids, `data-page` values or global function names that are still used, mock mode keeps working, `fe/finance-api.js` is generated, no line-ending-only commits, one slice per commit group, stop after each slice.

Additional rules for this plan:

1. **Backend enforces permissions; the frontend only hides.** Hide the Compensation card without `hr.salary.read` and hide the action buttons without `hr.salary.write`. Do not assume the frontend hiding is authorization.
2. **Do not change which numbers are computed, stored or requested.** The one exception is listed in section 8 (hard-coded year) and needs the owner's yes.
3. **Do not remove `raiseModal`, `compPlanModal` or their global functions** (`openRaiseModal`, `openCompPlanModal`, `applyRaise`, `onRaiseEmployeeChange`, `updateRaisePreview`). The employee profile and payroll still use them.
4. Use the shared button set (`btn btn-fill`, `btn btn-outline`, `btn btn-quiet`, `btn-sm`) and form controls documented at the top of `fe/src/styles/components.css`. One primary per screen.

## 5. Slices

### H1. Compensation card on the employee profile (M)

| Change | Files |
| :-- | :-- |
| Add a **Compensation** card to the employee profile with: external USD, internal USD cash and total per month (internal blue, external green, as elsewhere); next raise date; last raise (date and percentage); a raise history list for that employee (effective date, new internal, new external, new total, change, reason), newest first; empty state "No raises recorded yet." | `fe/src/partials/admin/sections/employee-detail.html`, `fe/public/js/employees.js` (render from `employees[].salaryHistory`; call it from `viewProfile`), `fe/src/styles/modules/employees.css` |
| Card actions: **Apply raise** (primary within the card) opens `raiseModal` preselected; **Edit plan** (secondary) opens `compPlanModal`. Both only with `hr.salary.write`. | same |
| The whole card is hidden without `hr.salary.read`. | `employees.js` |
| `raiseModal` opened from the profile has the employee field **read-only** (it shows the name, not a dropdown the user could change by accident). The modal still works with the dropdown when `openRaiseModal()` is called without an id (kept for compatibility). | `fe/public/js/salary.js` (`openRaiseModal`), `fe/src/partials/modals/raise-modal.html` |
| Remove the Quick Action "Apply Salary Raise" (it moves into the card). Remove the "View compensation plan" button from the "Payroll and payments" card; that card keeps the monthly total as plain text, salary payment docs and latest payroll. | `employee-detail.html:185`, `employees.js` `loadPayrollPaymentsCard` |
| Deep link: `viewProfile(id, 'compensation')` scrolls to the card, like `bank` and `social`. Optional route suffix in `fe/public/js/router.js` if the router needs it for `bank`. | `employees.js:121`, `router.js` |
| After a raise or plan change from the profile, the card refreshes (the code already calls `loadAdminData()` after a raise; confirm the profile re-renders). | `salary.js` `applyRaise` |

**Acceptance criteria**

1. The profile of an employee with raises shows the split, next raise, last raise and the full raise history for that employee only.
2. A viewer without `hr.salary.read` sees no Compensation card and no salary figure in "Payroll and payments".
3. A viewer with `hr.salary.read` but not `hr.salary.write` sees the card with no action buttons.
4. "Apply raise" opens the raise modal with that employee fixed; saving shows the new values in the card without leaving the page.
5. "Edit plan" opens the compensation plan modal for that employee.
6. The profile has no "Apply Salary Raise" quick action and no "View compensation plan" button.
7. Payroll's "fix issue" link for a missing compensation plan still opens the plan modal.

**Tests:** new `fe/tests/ui/employee-compensation.spec.js` covering 1 to 5 and 7; update `forms-feedback.spec.js` and `finance-compensation-plan.spec.js` if they click the removed buttons.

### H2. Salary and Raises becomes a read-only overview (S)

| Change | Files |
| :-- | :-- |
| Remove the toolbar button `#btnOpenRaiseModal` and the whole toolbar. | `fe/src/partials/admin/sections/salary.html`, `salary.js` (the show/hide code for the button) |
| Remove the Actions column, the row "Raise" and "Plan" buttons and the two pencils. | `salary.js` `renderSalaryPage`, `salary.html` |
| The employee name in each row is a link to the profile (`viewProfile(id)`); the whole row is clickable with a pointer cursor. Use a real `<a href>` for keyboard and middle-click, as other tables do (`Router.hrefFor`). | `salary.js` |
| Move the search into the "Employee Compensation" card header, aligned right. Keep `#salarySearch` and its listener. | `salary.html`, `fe/src/styles/modules/` |
| Page subtitle in `titles` becomes "Review compensation and raise history." | `fe/public/js/ui.js:214` |
| The page now has no primary button. Update the R3 check that expects exactly one primary on `a-salary`. | `fe/tests/ui/shell-foundations.spec.js` |
| Keep the stat cards and the company-wide raise history unchanged. | |

**Acceptance criteria**

1. No control on the page opens `raiseModal` or `compPlanModal`.
2. Clicking a row (or its name) opens that employee's profile.
3. Search still filters by name and department; it sits inside the table card header.
4. At 1440px and 390px, light and dark, there is no empty toolbar strip and no clipped or horizontally scrolling table (390px may scroll the table inside its card as other tables do).
5. Stat cards and raise history are unchanged in content.

**Tests:** new `fe/tests/ui/salary-overview.spec.js` for 1 to 4; update `hr-tables.spec.js`, `truthful-screens.spec.js`, `mobile-a11y.spec.js`, `admin-dual-rail.spec.js`, `admin-rail-landing.spec.js`, `topbar-account-menu.spec.js` only where they use removed ids.

## 6. Order and dependencies

| Order | Slice | Depends on |
| :-- | :-- | :-- |
| 1 | H1 | the UI refinements plan merged (shared button and control styles) |
| 2 | H2 | H1 (the profile must offer the actions before the list page loses them) |

Do not merge H2 without H1: the system must never be left without a way to apply a raise.

## 7. Related, not in this plan

- **Finalized-payroll guard.** `SocialInsuranceService.set_insurance`, `CompensationPlanService.set_component` and the employee create or update repository reject or shift effective dates on or before the latest finalized payroll period. The owner will handle historical data at go-live (decision 5). **Raises and plan edits go through that guard**, so a raise dated inside a finalized period fails with the backend message; the profile must show that message in the existing error toast and not hide it. No change to the guard here.

## 8. Observed while preparing this plan

| Item | Proposal |
| :-- | :-- |
| `renderSalaryPage` counts "raises applied (YTD)" with `h.date.startsWith('2026')`, a hard-coded year. It will be wrong from 2027. | Replace with the current year. This changes a number the page computes, so **ask the owner at kickoff** before including it in H2. |
| "Last raise" takes the last element of `salaryHistory`; this assumes it is sorted ascending. | Sort by date when rendering; verify the order the backend returns. |
| `loadAdminData` requests salary history together with employees in one `Promise.all`. A role that has `hr.employee.read` but not `hr.salary.read` would fail the whole load. No seeded role has that split today. | Report only; backend and RBAC owner decision. |
| The nav label is "Salary & Raises". With the page now read-only, "Compensation" would fit better. | Owner decides at kickoff. Default: keep the label, change nothing in `data-page` values. |

## 9. Verification for every slice

Run from `fe/`. **Run `npm run build` first**: Playwright reuses a static server on port 8080 that serves `fe/dist`, so tests run against the last build, not the source.

| Step | Command | Pass condition |
| :-- | :-- | :-- |
| Baseline (once) | `npx playwright test --reporter=line` | Record the failing specs. At 2026-10-07 the baseline is 15 failures, listed in the handoff prompt. |
| CSS variables | `node scripts/check-css-vars.js` | No undefined variables |
| Build | `npm run build` | Succeeds; no "Missing partial" warnings |
| Regression | `npx playwright test --reporter=line` | No spec fails that passed in the baseline |
| New checks | the spec named in the slice | Pass |
| Visual | screenshots at 1440px and 390px, light and dark, of every page touched | Attached to the handoff |

## 10. Definition of done

- H1 and H2 delivered with their acceptance criteria met or an explicit owner waiver.
- No spec fails that passed in the baseline; the new specs pass.
- Manual check by the owner on the real backend as Super-Admin: apply a raise from the profile, see it in the card and in the company-wide history on the overview page, and confirm the overview page offers no way to change pay.
