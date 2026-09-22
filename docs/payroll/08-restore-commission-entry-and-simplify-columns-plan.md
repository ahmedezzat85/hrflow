# Restore Commission/Bonus Entry + Simplify Review Table Columns — Execution Plan

Related: `docs/payroll/07-review-table-and-deduction-removal-plan.md` (Fix 1 of that plan is the likely cause of Issue 1 below).

## Issue 1 — "Add Commission/Bonus" is missing from the payroll screens

**Diagnosis:** The previous plan (07) instructed changes only to the Step 2 wizard preview table (`populateWizardData()` in `fe/public/js/finance-payroll.js`) and explicitly said not to touch the Run Detail modal's per-line table. The "Add Commission/Bonus" button (`#btnRunDetailAddBonus`, wired to `openAddBonusModal()`) and its per-row equivalent (`.btn-add-bonus`, opening the same modal for a specific employee) both live in the Run Detail modal, rendered by `renderPayrollRunDetail()` — a **different** function from `populateWizardData()`. If commission/bonus entry disappeared, the most likely causes, in order of likelihood, are:

1. The agent editing `populateWizardData()` accidentally also modified or duplicated logic inside `renderPayrollRunDetail()` (both functions live in the same file and were both touched across the FUX-417/418 history, making cross-contamination easy).
2. The button's visibility guard (`btnAddBonus.style.display = status === "draft" ? "inline-block" : "none";`) got altered or the run's `status` value changed unexpectedly due to the deduction-removal changes in Fix 2 of plan 07 touching `_recalculate_run_aggregates()`, which `add_ad_hoc_line()` and `delete_line()` both call — if that function's signature or return shape changed in a way that broke the run-refresh call chain, the UI might silently fail to re-render the button.
3. The `finance-api.js` → `fe/api/finance/payroll-api.js` refactor (FUX-419) already made this module fragile to blind edits; a Fix 2 edit to `payroll_service.py` could have desynced the response shape the modal expects.

**Fix instructions for the coding agent (do this first, before anything else):**

1. Open `fe/src/partials/admin/sections/finance-payroll.html` and confirm the `#btnRunDetailAddBonus` button element and the `#payrollAddBonusModal` markup still exist exactly as introduced in FUX-418 (commit `2c28fb2`). If either was accidentally deleted during the Fix 1/Fix 2 edits from plan 07, restore them verbatim from that commit.
2. Open `fe/public/js/finance-payroll.js` and confirm `renderPayrollRunDetail()` still contains the `btnAddBonus.style.display = status === "draft" ? "inline-block" : "none";` line and the per-row `.btn-add-bonus` button generation inside the lines-table row-building loop (introduced in FUX-418, in the same function, NOT in `populateWizardData()`). If plan 07's Fix 1 edit was mistakenly applied inside `renderPayrollRunDetail()` instead of `populateWizardData()`, revert that portion and re-apply the grouping logic only inside `populateWizardData()`.
3. Confirm `openAddBonusModal()`, `closeAddBonusModal()`, `submitAddPayrollBonus()`, and `deletePayrollLineItem()` (all four introduced in FUX-418) are still present and unmodified, and still exported via `window.openAddBonusModal = openAddBonusModal;` etc. at the bottom of the file.
4. Confirm the run currently open in the Run Detail modal is actually in `draft` status — per FUX-418's design, the button is intentionally hidden once a run is `approved`/`finalized`. If the run being tested was already approved, this is expected behavior, not a bug; create/regenerate a fresh draft run to test commission/bonus entry.
5. If all of the above are intact and the button still doesn't appear, check the browser console for a JS error thrown during `renderPayrollRunDetail()` — a single error partway through that function would prevent later lines (including the button-visibility line) from executing. Fix whatever the actual thrown error is rather than guessing further.

**Do not re-implement FUX-418 from scratch.** It is fully built and tested (`be/tests/test_finance_payroll_commission_bonus.py`, `fe/tests/ui/finance-payroll-commission-bonus.spec.js` both exist and passed at merge time). This is a regression-hunt, not a new feature.

## Issue 2 — Remove Department and last column, keep only Employee + money columns

**File:** `fe/src/partials/admin/sections/finance-payroll.html`
**Section:** Step 2 wizard preview table header (the one redesigned in plan 07's Fix 1)

**Exact change:** replace the current header:
```html
<tr>
  <th>Employee</th>
  <th>Department</th>
  <th style="text-align:right;">EXT</th>
  <th style="text-align:right;">INT</th>
  <th style="text-align:right;">Net Pay</th>
  <th>Bank Wire Target</th>
</tr>
```
with:
```html
<tr>
  <th>Employee</th>
  <th style="text-align:right;">EXT</th>
  <th style="text-align:right;">INT</th>
  <th style="text-align:right;">Net Pay</th>
</tr>
```

**File:** `fe/public/js/finance-payroll.js`
**Function:** `populateWizardData()`, the row-template inside the `Object.values(linesByEmployee).map(row => ...)` block introduced by plan 07's Fix 1

**Exact change:** remove the `<td>${row.department}</td>` cell and the trailing `<td>${row.bank_name ? ... }</td>` cell. Result:
```javascript
empTableBody.innerHTML = Object.values(linesByEmployee).map(row => `
  <tr style="font-size:0.8rem;">
    <td><strong>${row.employee_name}</strong></td>
    <td style="text-align:right;">$${row.external.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
    <td style="text-align:right;">$${row.internal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
    <td style="text-align:right; font-weight:700; color:var(--primary, #2563EB);">$${row.net_pay.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
  </tr>
`).join("");
```
The `linesByEmployee` object can keep tracking `department`/`bank_name`/`bank_account_masked` internally (harmless, no need to strip the aggregation logic) — only the rendered `<td>` cells for those fields are removed. Simpler: it's fine to leave those fields in the object even though unused; do not spend extra edit time removing them from the aggregation step, only from the render step.

**Do not touch:** the Run Detail modal's lines table (`#runDetailLinesTableBody`) — this column-simplification request is specifically about the Step 2 wizard review table, matching the pattern already established (Step 2 = simplified quick review, Run Detail = full audit view with all columns and type badges).

## Test updates

If `fe/tests/ui/finance-payroll-split.spec.js` or any other Playwright spec asserts on column count/headers in the Step 2 table (e.g. counting `<th>` elements or checking for a "Department"/"Bank Wire Target" header text in that specific table), update the assertion to match the new 4-column header. Do not touch assertions targeting the Run Detail modal's table, which is unchanged.

## Explicit non-goals

- Do not modify FUX-418 commission/bonus business logic (`add_ad_hoc_line()`, `delete_line()` in `payroll_service.py`) — Issue 1 is a UI/wiring regression, not a backend logic problem, unless the console-error investigation in step 5 above reveals otherwise.
- Do not remove Department/Bank columns from the Run Detail modal — only from the Step 2 wizard preview table.
- Do not touch `EmployeeCompensationPlanDB`, the compensation-sync fix, or the dual-funding-account work from prior plans.
