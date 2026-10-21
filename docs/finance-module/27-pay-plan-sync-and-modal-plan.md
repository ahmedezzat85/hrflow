# 27 — Pay Plan Sync and Pay Plan Modal: Plan (P1–P3)

**Status:** **Approved by owner, October 21, 2026** (six decisions, recorded as D-034). Not implemented yet.
**Baseline:** `main` at `071cdd7`. The compensation code listed below was verified identical on `main` and on `feature/bulk-import` (`39aff4d`). **Re-verify in the branch-intake step.**
**Scope in one line:** make every salary change reach the compensation plan that payroll reads, make zero a valid way to end a component, and replace the multi-step "Pay plan" dialog with one form.
**No schema change, no migration.** Closing a component uses the existing `effective_end_date`.

---

## 1. Why: verified findings (October 20–21, 2026)

Two salary stores exist and only one feeds payroll.

| Store | Table | Written by | Read by |
|---|---|---|---|
| Compensation plan (effective-dated rows) | `finance_employee_compensation_plans` | `CompensationPlanService.set_component` | **Payroll** (`get_components_for_period`) |
| Raise history (log) | `salary_history` | `SalaryRepository.apply_raise` | Profile "Raise history", exports |

Characterization tests in `be/tests/test_salary_history_data_entry_checks.py` (11 tests; 10 pass, 1 fails on current code) established:

| # | Finding | State | Test |
|---|---|---|---|
| F1 | Salary typed in the create modal is written through to the plan, effective on the **Join date** (today if missing) | Implemented | `test_creation_with_salary_creates_plan_rows_at_join_date` |
| F2 | Both salary fields at 0 on create: no plan rows | Implemented | `test_creation_with_zero_salary_creates_no_plan_rows` |
| F3 | Old Join date + current salary records that salary as effective since the Join date | Implemented (risk) | `test_old_join_date_stamps_latest_salary_as_effective_since_join` |
| F4 | Plan history is forward-only: earlier start rejected (400); same start overwrites in place; later start closes the old row the day before | Implemented | `test_plan_history_is_forward_only` |
| F5 | Dates on or before the latest finalized/paid/partially paid payroll period end are rejected | Implemented | `test_finalized_payroll_period_locks_plan_dates` |
| F6 | Re-saving the employee edit modal with unchanged salaries adds a duplicate plan row dated today | **Bug** | `test_edit_modal_resave_splits_plan_row_at_today` |
| F7 | A backdated raise logs history only; its "previous salary" is taken from the current salary, so previous/% are wrong | **Bug** | `test_backdated_raise_previous_salary_is_taken_from_current_salary` |
| F8 | A raise dated today updates the employee fields and history but **not the plan**, so payroll keeps the old amount | **Bug** | `test_todays_raise_updates_employee_fields_and_plan_together` (fails) |
| F9 | `set_component` rejects amount ≤ 0 and nothing closes a component, so a switch to single-component cannot be expressed; the Raise modal accepts 0 | **Gap** | — |

Other code facts: `set_component` commits internally (it cannot join a larger transaction as written); the plan permission is `finance.payroll.prepare`, the raise permission is `hr.salary.write`; the current Pay plan dialog (`fe/src/partials/modals/compensation-plan-modal.html`, `fe/public/js/salary.js`) saves one component per request through a dropdown.

## 2. Decisions (D-034, accepted October 21, 2026)

1. **Zero closes a component.** Either component may be 0, never both. A 0 ends the active row the day before the effective date; history is kept. Both at 0 is rejected: "At least one component must be above 0". A 0 for a component with no active row writes nothing.
2. **The Pay plan modal writes plan rows only.** It does not add Raise history. The Raise modal is the raise event: plan + raise history + next-raise date.
3. **Raise dates:** a raise dated **today or earlier** applies to the plan if the plan guards pass; a **future** date or a guard failure is rejected with a clear message and nothing is written.
4. **Q-008 interim treatment extended:** raises update the plan through the service under `hr.salary.write`, as employee create/update already do under `hr.employee.write`. Q-008 stays **Open**.
5. **One atomic endpoint** saves both components (single transaction, single audit entry).
6. **P3 is included** as the last slice.

## 3. Design

### 3.1 Shared service method (P1)
Add `CompensationPlanService.apply_pay_change(employee_id, internal_amount, external_amount, internal_basis, effective_start_date, notes, actor_email)` (name is a suggestion; follow repository convention). Both amounts are required and ≥ 0 (explicit 0 = "none").

Per component, in order:
1. Amount and basis equal to the active row → `unchanged`, write nothing.
2. Amount > 0 and an active row exists → existing `set_component` semantics: same start date overwrites in place; later date closes the old row (`end = start − 1 day`) and creates the new one; earlier date rejected (400).
3. Amount > 0 and **no** active row → create. **New guard:** the effective date must be after the latest closed row's end date for that component (prevents overlapping rows after a close/re-add).
4. Amount = 0 and an active row exists → close it with `end = effective_date − 1 day`. **The effective date must be strictly after the active row's start date** (otherwise 400 with a message to pick a later date). Set the matching `EmployeeDB` field to 0.
5. Amount = 0 and no active row → `unchanged`.

Whole-call rules: the resulting total must be > 0 (checked **before** any write); the finalized-period guard applies to every changed component, including closes; all writes happen in **one transaction** (refactor the inner logic so it flushes and only the public wrappers commit; keep `set_component`'s public behaviour and tests unchanged); one audit entry (`employee.compensation_plan.updated`) with before/after of both components; `EmployeeDB.internal_salary_usd`, `external_salary_usd` and `salary` stay synchronized. `external_usd` basis is always NET.

### 3.2 Raise (P1)
In `SalaryRepository.apply_raise` (SQL implementation), inside the same session/transaction:
1. Reject `effective_date` later than today (400).
2. Call `apply_pay_change` with the new absolute amounts (0 allowed) and the raise's effective date. Any guard failure aborts the whole raise (no history row).
3. Insert the `salary_history` row (previous values taken from the employee fields before the change, which is now correct because the change applies immediately) and set `next_raise = effective_date + 365 days`.
4. Remove the "backdated = history only" branch.

The router permission stays `hr.salary.write`. The Sheets/dual repository path is unchanged (export-only shadow).

### 3.3 Employee create/update (P1)
- **Update:** route salary fields through `apply_pay_change`; unchanged values write nothing (fixes F6); 0 closes (decision 1). Effective date stays "today, or the day after the latest finalized period".
- **Create:** unchanged in P1 (both 0 = no plan; otherwise effective on Join date). P3 adds an explicit effective date.

### 3.4 Atomic endpoint (P2)
`PUT /api/finance/employees/{employee_id}/compensation-plan`, permission `finance.payroll.prepare`:

```json
{
  "effective_start_date": "2026-11-01",
  "internal_usd_cash": 1200.0,
  "external_usd": 2500.0,
  "internal_salary_basis": "NET",
  "notes": "optional"
}
```
Both amounts required, ≥ 0. Response: the active plan (same shape as `GET /compensation-plan`) plus `changes: [{component_type, action: created|updated|closed|unchanged, previous_amount, new_amount}]`. `GET /compensation-plan` gains `earliest_effective_date` (day after the latest finalized period end, or null) for the UI hint. The existing per-component `PUT /{component_type}` stays as is (still rejects 0; closing is only through the new endpoint and the raise). Wrapper in `fe/api/finance/payroll-api.js`, mock handler in `fe/finance-api.js`.

### 3.5 Pay plan modal (P2)
One form replaces "Add a change" (dropdown + single amount). Keep the current-plan summary and move the history table into a collapsed section.

```
┌ Pay plan · {employee} ────────────────────── $3,000 / month ┐
│ Current                                                       │
│  Internal USD cash  $1,000 · Net · since 2026-01-01           │
│  External USD       $2,000 · Net · since 2026-01-01           │
│                                                               │
│ Change pay                                                    │
│  Internal USD cash  [ 1,200 ]  ( Net | Gross )  +$200 (+20%)  │
│  External USD       [ 2,500 ]                   +$500 (+25%)  │
│  New total: $3,700 / month  (+$700, +23.3%)                   │
│                                                               │
│  Effective from  [ 2026-11-01 ]   Earliest allowed: 2026-10-01│
│  Note (optional) [ ______________________________ ]           │
│  ▸ History (4 rows)                                           │
│                              [ Cancel ]  [ Save pay change ]  │
└───────────────────────────────────────────────────────────────┘
```
Behaviour: fields prefilled with the current amounts; live per-field delta and new total; unchanged fields are not written; Net/Gross toggle on the internal field only; a field set to 0 shows "Ends this part on {date − 1}"; both at 0 shows an inline error and disables Save; **no plan yet** → title "Set up pay plan", empty fields, no deltas (this is the provisioning case); "Earliest allowed" is advisory (the server is authoritative) and is the later of `earliest_effective_date` and the start date of any changed active component. Errors from the server appear in the dialog's error summary (`FinanceForm`). D-027 `.fv` styling, no colour literals.

### 3.6 Employee modals (P3)
- **Create modal:** add "Pay effective from" (default: Join date). `EmployeeCreate` gains an optional `pay_effective_from`; the write-through uses it (fallback: Join date, then today). Fixes F3 without the zero-salary workaround.
- **Edit modal:** salary fields become read-only text with an "Edit pay plan" button that opens the Pay plan modal. The UI no longer sends salary fields on edit; the API keeps accepting them (P1 behaviour).

## 4. Slices (strict order)

Branch `feature/pay-plan-sync` from `main`. Commit prefix per slice (`P1:` …). Full backend suite green at the end of each slice.

### P1 — Backend fixes
Scope: §3.1, §3.2, §3.3. Convert `test_salary_history_data_entry_checks.py` into regression tests (flip the three "risk" tests; remove the `xfail` on F8).
**Acceptance:** F6 re-save writes no new rows; F8 raise updates the plan and employee fields together; a raise to 0 on one component closes that row and payroll preview for the next open period excludes it; both-zero rejected with the documented message and **no partial write**; internal-only → external-only switch in one call closes one row and keeps the other; close with an effective date ≤ the active start is rejected; re-adding a closed component with an overlapping date is rejected; future-dated raise rejected; raise blocked by a finalized period writes no history row; audit entry written once per call; all existing `test_finance_compensation_plan*`, `test_employee_salary_split`, `test_salary_logic`, payroll tests still pass.

### P2 — Pay plan modal
Scope: §3.4, §3.5. **Acceptance:** `npm run build` clean; `npm run lint:finance-tokens` clean; endpoint tests (atomicity: a failing second component leaves the first untouched; permission 401/403; `changes` array; `earliest_effective_date`); Playwright: provisioning an empty plan, a raise-style change with deltas, a switch via 0, both-zero error, server rejection shown; mock mode updated; existing specs touching this modal updated (`employee-compensation`, `finance-compensation-plan`, `payroll-journey` ~L191, `forms-feedback`).

### P3 — Employee modals
Scope: §3.6. **Acceptance:** create with an old Join date and "Pay effective from" 2026-01-01 yields rows starting 2026-01-01; edit modal shows read-only pay and the button opens the Pay plan modal; saving other fields never touches the plan; Playwright covers both; existing employee specs pass.

## 5. Out of scope (not decided, do not build)

- Pre-plan history inside the compensation plan (it stays forward-only). After P1 a raise dated before the active plan row fails the guards, so older raise-history entries cannot be added through the Raise modal either.
- History-only "record a past raise" with explicit previous values.
- Future-dated / scheduled pay changes.
- Resolving Q-008 (ownership of compensation plans).
- Payroll calculation, tax/social-insurance logic, Sheets export.

## 6. Interim data-entry procedure (until P1–P3 are merged)

Do not use the Raise modal or the employee edit modal for real salary changes. Create employees with the correct Join date and **both salary fields at 0** unless the pay really starts on the Join date; then set pay through the Pay plan dialog with the real effective date, oldest change first.

## 7. Documentation updates

- `04-decision-log.md`: D-034 (Accepted, October 21, 2026).
- `06-open-questions.md`: Q-008 stays Open; add the October 21 interim extension to its known context.
- `05-roadmap-and-next-slices.md`: section 3G for P1–P3.
- `docs/finance-module/`: this plan as 27, the handoff as 28.
