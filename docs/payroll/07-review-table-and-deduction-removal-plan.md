# Payroll Review Table Redesign & Deduction Removal — Execution Plan

Related: `docs/payroll/06-bank-warning-and-compensation-sync-fix-plan.md`, `docs/payroll/02-fux-417-payroll-run-compensation-split-fx.md`, `docs/payroll/00-payroll-module-overview.md` (scope decision: HRFlow does not calculate Egyptian tax/insurance).

Three changes, all scoped tightly to avoid re-opening FUX-416/417/418's core design:

1. Collapse the wizard Step 2 review table from two rows per employee (External row + Internal row) to one row per employee, with External/Internal as columns.
2. Remove the leftover 5%/12% deduction calculation entirely — this was never supposed to survive the "strip statutory calculation" decision from the original design conversation.
3. Introduce a funding-account setting so the External portion draws from the US-based account and the Internal portion draws from the Cash USD account at ledger-posting time.

## Fix 1 — One row per employee in the Step 2 review table

**Why:** `preview_run()` currently returns one `PayrollLineDB`-shaped dict per compensation component (external_usd and internal_usd_cash are separate line objects), and the wizard table renders one `<tr>` per line — so an employee with both components shows as two rows. This is correct for the underlying data model (line-item granularity is needed for FX/tax/reporting), but wrong for the review UI, which should present one row per person.

**Do not change the backend response shape or `PayrollLineDB`.** This is a frontend-only aggregation fix: group the existing `lines` array by `employee_id` before rendering.

**File:** `fe/public/js/finance-payroll.js`
**Function:** `populateWizardData()` — specifically the block that builds `empTableBody.innerHTML` from `preview.lines`

**Exact change:** replace the `.map(line => ...)` render (one row per line) with a group-then-render pattern:

```javascript
const linesByEmployee = {};
(preview.lines || []).forEach(line => {
  if (!linesByEmployee[line.employee_id]) {
    linesByEmployee[line.employee_id] = {
      employee_name: line.employee_name,
      department: line.department,
      bank_name: line.bank_name,
      bank_account_masked: line.bank_account_masked,
      external: 0,
      internal: 0,
      commission: 0,
      bonus: 0,
      net_pay: 0,
    };
  }
  const row = linesByEmployee[line.employee_id];
  const amt = Number(line.base_salary || 0);
  if (line.compensation_type === "external_usd") row.external += amt;
  else if (line.compensation_type === "internal_usd_cash") row.internal += amt;
  else if (line.compensation_type && line.compensation_type.startsWith("commission")) row.commission += amt;
  else if (line.compensation_type === "bonus") row.bonus += amt;
  row.net_pay += Number(line.net_pay || 0);
});

empTableBody.innerHTML = Object.values(linesByEmployee).map(row => `
  <tr style="font-size:0.8rem;">
    <td><strong>${row.employee_name}</strong></td>
    <td>${row.department}</td>
    <td style="text-align:right;">$${row.external.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
    <td style="text-align:right;">$${row.internal.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
    <td style="text-align:right; font-weight:700; color:var(--primary, #2563EB);">$${row.net_pay.toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
    <td>${row.bank_name ? `${row.bank_name} (${row.bank_account_masked})` : '<span style="color:#EF4444;">Missing</span>'}</td>
  </tr>
`).join("");
```

Only include `commission`/`bonus` columns in the table markup if you want them visible in this specific review step; per the user's instruction to keep it minimal, EXT/INT plus Net Pay plus Bank is enough for Step 2. If ad hoc commission/bonus lines exist for the period, they can be folded into `net_pay` as already computed by the backend, without needing their own columns here (they still show correctly on the full Run Detail modal's per-line table, which is unaffected by this change).

**File:** `fe/src/partials/admin/sections/finance-payroll.html`
**Section:** the Step 2 (`wizardStep2`) preview table header

**Exact change:** replace the current `<thead>` row (`Employee / Component / Department / Amount / Deductions / Tax / Net Pay / Bank Wire Target`) with:

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

Also add `style="font-size:0.8rem;"` (or apply a CSS class) to the table itself if not already compact, per the user's "small font to fit the page" request.

**Do not touch:** the Run Detail modal's per-line table (`#runDetailLinesTableBody`) — that one intentionally stays line-item granular with type badges (External USD / Internal USD Cash / Sales Commission / etc.) since it's the detailed audit view, not the quick review step. Only Step 2 of the wizard changes.

## Fix 2 — Remove the leftover 5%/12% deduction calculation entirely

**Why:** The original design decision (see `docs/payroll/00-payroll-module-overview.md`) was that HRFlow does not calculate Egyptian tax/social insurance — those come from the ETA/NOSI portals and are tracked manually via the Statutory Obligations page (FUX-410). The 5% deduction / 10% tax / 12% employer-cost formulas in `preview_run()` and `add_ad_hoc_line()` were leftover placeholder math from before that decision was finalized and should never have survived into FUX-417/418. They are what's producing the deduction figures the user says "should be omitted."

**File:** `be/finance/services/payroll_service.py`
**Functions to change:** `preview_run()`, `generate_run_from_compensation_plans()`, `add_ad_hoc_line()`, and `_recalculate_run_aggregates()` — all four currently compute `deductions_total`/`tax_amount`/`employer_cost_extra` via hardcoded percentages on insurable/taxable lines.

**Exact change, applied consistently in all four functions:** replace every instance of:
```python
deductions = round(amount * 0.05, 2) if is_insurable else 0.0
tax_amt = round(amount * 0.10, 2) if is_taxable else 0.0
employer_extra = round(amount * 0.12, 2) if is_insurable else 0.0
net = round(amount - deductions - tax_amt, 2)
```
with:
```python
deductions = 0.0
tax_amt = 0.0
employer_extra = 0.0
net = round(amount, 2)
```

Net pay becomes equal to gross for every line, since there is no in-system deduction anymore — exactly matching the agreed design (net salary tracking only; tax/insurance handled separately and manually via Statutory Obligations once you have the real portal-confirmed figures).

**Do not remove the `is_taxable_local`/`is_insurable` fields or flags.** Keep them on `PayrollLineDB` and keep setting them correctly (`false` for `external_usd`, `true` for `internal_usd_cash`/commission/bonus) — they are still needed as the classification that feeds the *manual* Statutory Obligations entries later (per the FUX-410 design), even though they no longer drive an automatic percentage calculation. Only the calculation itself is removed, not the classification.

**Consequence to verify:** `finalize_run()`'s statutory-obligation auto-generation (from FUX-410/417) reads `liabilities_summary_json`, which is built from `deductions_total`/`tax_amount`/`employer_cost_extra` across lines. With this fix, those will now all compute to `0.0`, so the auto-generated `StatutoryObligationDB` rows will have `amount_estimated = 0.0`. This is expected and correct per the "estimate, then confirm/adjust against the real portal figure" workflow already built in FUX-410 — you will manually enter the real accrued amount via the Confirm/Adjust action on the Statutory Obligations page once you have it, rather than trusting a fabricated estimate. No code change needed there; just be aware the "estimated" starting value will now be zero instead of a fake percentage-based guess, which is more honest than a wrong non-zero placeholder.

**Column removal in the UI (both Step 2 preview and Run Detail modal):** remove the "Deductions" and "Tax" columns/cells entirely from both tables per the user's explicit instruction (not just zero them out — omit the columns). In `finance-payroll.html`, remove the `<th>Deductions</th>` / `<th>Tax</th>` (or equivalent) header cells and their corresponding `<td>` cells in the JS render functions (`populateWizardData()` for Step 2, `renderPayrollRunDetail()` for the Run Detail modal's lines table).

**Test to update:** `be/tests/test_finance_payroll_split_fx.py` and `be/tests/test_finance_payroll_commission_bonus.py` both have hardcoded assertions expecting the old 5%/10%/12% math (e.g. `assert int_line["tax_amount"] == 150.0`). Update these assertions to expect `0.0` for `deductions_total`, `tax_amount`, `employer_cost_extra`, and `net_pay == base_salary`, consistent with the new behavior.

## Fix 3 — Configurable funding account per compensation type

**Why:** External-USD amounts should post from the company's US-based bank account; Internal-USD-Cash amounts should post from the Cash USD account. Today, `PayrollRunDB.bank_account_id` is a single field — one account for the whole run — which cannot represent "external draws from Account A, internal draws from Account B" simultaneously.

**Do not remove `PayrollRunDB.bank_account_id`.** Keep it as the default/fallback funding account (e.g. for ad hoc commission/bonus lines that don't have their own designation). Add two new, more specific fields alongside it.

**File:** `be/finance/models.py`
**Model:** `PayrollRunDB`

**Exact change:** add two nullable FK columns:
```python
external_funding_account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="SET NULL"), nullable=True)
internal_funding_account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="SET NULL"), nullable=True)
```

**New migration:** `be/migrations/versions/0020_fux_420_payroll_dual_funding_accounts.py` (follow the exact idempotent `if column not in columns` pattern used in `0018`/`0019`), adding these two columns to `finance_payroll_runs`.

**File:** `be/finance/services/payroll_service.py`
**Function:** wherever the payroll run's GL journal / ledger posting happens at finalization/disbursement (the function that currently debits `run.bank_account_id` for the net payable amount — locate by searching for the literal string `bank_account_id` combined with `LedgerTransactionDB` or `credit`/`debit`, do not read the whole file)

**Exact change:** split the single ledger credit/debit against `run.bank_account_id` into two entries:
- Credit `run.external_funding_account_id` (fallback to `run.bank_account_id` if not set) for the sum of all `external_usd` line net pays in the run.
- Credit `run.internal_funding_account_id` (fallback to `run.bank_account_id` if not set) for the sum of all `internal_usd_cash` + `commission_*` + `bonus` line net pays in the run.

**File:** `fe/src/partials/admin/sections/finance-payroll.html` + `fe/public/js/finance-payroll.js`
**Section:** Wizard Step 1 (where `wizardFundingAccount` already exists as a single selector)

**Exact change:** replace the single "Funding Bank Account" selector with two: "External Funding Account (US)" and "Internal Funding Account (Cash USD)", both populated from the same existing bank-accounts list used today. Pass both as `external_funding_account_id` / `internal_funding_account_id` in the `generatePayrollRun()`/`createPayrollRun()` request payload, alongside the existing `bank_account_id` (kept as a fallback default, can default to whichever of the two is picked first, or left as a third optional "Default/Other" selector — whichever requires the smaller UI change).

**Test to add:** one new test confirming that finalizing/disbursing a run with distinct external/internal funding accounts produces two separate ledger transactions against the two correct accounts, with correct summed amounts per account.

## Execution order

1. Fix 2 (remove deductions) first — it's the most isolated change and unblocks the "why are there still deductions" confusion immediately.
2. Fix 1 (one row per employee) second — pure frontend, depends on nothing else, and looks better once Fix 2 has also removed the now-empty Deductions/Tax columns.
3. Fix 3 (dual funding accounts) last — it's the most structurally different change (schema + ledger logic + two new UI selectors) and should be done once the simpler display fixes are confirmed working.

## Explicit non-goals (do not implement)

- Do not reintroduce any tax/insurance percentage calculation, even as a "placeholder" — the agreed design is manual entry via Statutory Obligations only.
- Do not change `EmployeeCompensationPlanDB`, FUX-416 sync logic, or the backfill script from the prior fix plan.
- Do not change the Run Detail modal's line-item granularity (still one row per compensation type there) — only Step 2 of the wizard becomes one-row-per-employee.
