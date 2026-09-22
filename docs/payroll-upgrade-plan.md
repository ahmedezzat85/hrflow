# Payroll Module Upgrade — Implementation Plan

> **Branch:** `feature/payroll`
> **Last updated:** 2026-09-21
> **Status:** Awaiting review

---

## Context

The existing `finance-payroll.html` + its JS counterpart implement a functional 4-step Net-Payment Runner wizard and a Run Detail workspace. This plan documents the incremental upgrades agreed upon, the exact files touched per phase, and the acceptance criteria for each.

---

## What Changes vs. Baseline

| # | Change | Baseline State | Target State |
|---|---|---|---|
| 1 | **Bonus/Commission 3-way split** | Single "Commission" type in add modal | Distinct: **Bonus**, **Sales Commission**, **Support Commission** — separate columns in Step 2 table, Run Detail table, and Step 4 summary |
| 2 | **INT / EXT source per line** | Route set globally at setup (External Bank / Internal Cash) | Each line in Step 2 and Run Detail shows an **INT / EXT chip** that is individually selectable |
| 3 | **Per-account live totals in Step 4** | Static outflow breakdown | Recomputes in real-time as per-line INT/EXT assignments change |
| 4 | **Fake seed data** | UI empty without a live API | 12-employee roster + 6 historical runs covering all lifecycle states, seeded on JS load |
| 5 | **Step 2 table column expansion** | Recipient, Dept, Route, Destination, Final Amount, Readiness, Action | + Base Salary, Bonus, Sales Comm., Support Comm., Net Total; Route replaced by **INT/EXT chip** |
| 6 | **Run Detail table column expansion** | Recipient, Route, Dept, Net Payment, Destination, Status, Actions | Same additions as Step 2 + per-row INT/EXT selector |
| 7 | **KPI cards wired to seed data** | Zeroes until real API responds | Driven by seed dataset on section activation |
| 8 | **Dead code cleanup** | Hidden `#wizardFundingAccount` select present | Removed; consolidated CSS; a11y audit pass |

---

## Phases

### Phase 0 — Seed Data Layer *(JS only)*

**Goal:** Self-contained, deterministic seed dataset so every wizard step and modal is fully interactive without a running backend.

**Seed roster — 12 employees:**

| # | Name | Department | Base Salary (USD) | Default Route |
|---|---|---|---|---|
| 1 | Sarah Connor | Engineering | 4,200 | EXT |
| 2 | John Reese | Engineering | 3,900 | EXT |
| 3 | Marcus Wright | Engineering | 3,600 | INT |
| 4 | Diana Prince | Product | 4,500 | EXT |
| 5 | Bruce Banner | Product | 3,800 | EXT |
| 6 | Natasha Romanoff | Operations | 3,200 | INT |
| 7 | Sam Wilson | Operations | 3,000 | INT |
| 8 | James Rhodes | Operations | 3,100 | EXT |
| 9 | Pepper Potts | Finance | 4,000 | EXT |
| 10 | Nick Fury | Finance | 4,800 | EXT |
| 11 | Maria Hill | Finance | 3,500 | INT |
| 12 | Wanda Maximoff | HR | 3,300 | INT |

**Seed historical runs — 6 runs, all statuses covered:**

| Period | Status | Net Total | Notes |
|---|---|---|---|
| 2026-08 | `paid` | $46,200 | Includes Sales Comm. for 3 employees |
| 2026-07 | `paid` | $44,800 | Base only |
| 2026-06 | `partially_paid` | $43,100 | 2 lines failed disbursement |
| 2026-05 | `approved` | $42,900 | Awaiting finalization |
| 2026-04 | `submitted` | $41,600 | Pending approval |
| 2026-03 | `draft` | $40,200 | In-progress |

**Data model additions:**

```js
// Per payroll line
{
  employeeId: string,
  baseSalary: number,
  bonus: number,           // Discretionary Bonus
  commSales: number,       // Sales Commission
  commSupport: number,     // Support Commission
  netTotal: number,        // derived: baseSalary + bonus + commSales + commSupport
  source: 'INT' | 'EXT',  // per-line funding source
  destination: string,     // bank/cash destination label
  status: 'ready' | 'issue' | 'paid' | 'failed',
}
```

**Files touched:**
- `fe/src/js/admin/finance-payroll.js` — add `PAYROLL_SEED` constant block at top of file, guard with `if (!window._payrollApiEnabled)` flag so real API takes priority when available.

**Acceptance criteria:**
- [ ] Section loads with 4 KPI cards showing non-zero values derived from seed data
- [ ] Runs history table shows all 6 seed runs with correct statuses and amounts
- [ ] Clicking any run opens the Run Detail modal with its 12 lines
- [ ] "Prepare Payroll" wizard pre-fills employee list from seed roster in Step 2

---

### Phase 1 — Step 2 Table Column Expansion

**Goal:** Replace the flat "Final Amount" single column with the full breakdown: Base Salary, Bonus, Sales Comm., Support Comm., Net Total. Replace the "Payment Route" text column with a compact **INT / EXT** chip that is clickable to toggle the per-line source assignment.

**New Step 2 `<thead>` column order:**

| Recipient | Dept | Base Salary | Bonus | Sales Comm. | Support Comm. | Net Total | Source | Destination | Readiness | Action |
|---|---|---|---|---|---|---|---|---|---|---|

**INT/EXT chip design:**
```html
<!-- EXT selected -->
<button class="source-chip source-chip--ext" data-line-id="..." onclick="toggleLineSource(this)">EXT</button>

<!-- INT selected -->
<button class="source-chip source-chip--int" data-line-id="..." onclick="toggleLineSource(this)">INT</button>
```
- EXT chip: blue border + blue text
- INT chip: teal border + teal text
- Toggling updates `wizardPreviewLines[id].source` and triggers Step 4 outflow recompute

**Files touched:**
- `fe/src/partials/admin/sections/finance-payroll.html` — `wizardEmployeesPreviewTableBody` thead + row template
- `fe/src/js/admin/finance-payroll.js` — `renderWizardPreviewRow()`, `toggleLineSource()`

**Acceptance criteria:**
- [ ] All 5 amount columns render with correct USD formatting
- [ ] NET TOTAL = Base + Bonus + Sales Comm. + Support Comm.
- [ ] Clicking INT chip switches to EXT and vice-versa
- [ ] Step 4 outflow totals update immediately on each toggle
- [ ] Column headers are right-aligned for all amount columns
- [ ] Table scrolls horizontally on mobile without breaking layout

---

### Phase 2 — Step 4 Live Per-Account Outflow Recompute

**Goal:** The "Funding Account Outflow Breakdown" cards in Step 4 must recompute live whenever a per-line source assignment changes (from Phase 1 toggles).

**Logic:**
```
extTotal = sum(line.netTotal for line where line.source === 'EXT')
intTotal = sum(line.netTotal for line where line.source === 'INT')
grandTotal = extTotal + intTotal
```

**Files touched:**
- `fe/src/js/admin/finance-payroll.js` — new `recomputeWizardStep4Outflow()` called from `toggleLineSource()` and `navigateWizardStep()`

**Acceptance criteria:**
- [ ] Toggling any line source in Step 2 and then navigating to Step 4 shows updated totals
- [ ] Grand total always equals sum of EXT + INT totals
- [ ] No flash / layout shift during recompute

---

### Phase 3 — Run Detail Modal Column Expansion

**Goal:** Mirror Phase 1 changes in the Run Detail modal table. For `paid` / `partially_paid` runs, the INT/EXT chip is read-only (display badge, not button).

**New Run Detail `<thead>` column order:**

| Recipient | Dept | Base Salary | Bonus | Sales Comm. | Support Comm. | Net Total | Source | Destination | Status | Actions |
|---|---|---|---|---|---|---|---|---|---|---|

**Files touched:**
- `fe/src/partials/admin/sections/finance-payroll.html` — `runDetailLinesTableBody` thead
- `fe/src/js/admin/finance-payroll.js` — `renderRunDetailLine()`

**Acceptance criteria:**
- [ ] All amount columns display correctly for all 6 seed runs
- [ ] INT/EXT chip is a toggle button for `draft` / `submitted` runs; a static badge for `approved` / `finalized` / `paid` / `partially_paid`
- [ ] Summary tiles above the table show correct EXT wire outflow and INT cash outflow

---

### Phase 4 — KPI Cards Wired to Seed Data

**Goal:** On section activation (`initFinancePayroll()` or equivalent), compute and render KPI values from seed data.

| Card | Computation |
|---|---|
| Last Run Net Payment | `max(run.paymentDate)` run's `netTotal` |
| Active Staff Headcount | `PAYROLL_SEED.employees.length` |
| Pending Runs | count of runs with status in `['draft','submitted','approved']` |
| YTD Net Disbursed | sum of `netTotal` for runs with `paymentDate` in current fiscal year and status `paid` or `partially_paid` |

**Files touched:**
- `fe/src/js/admin/finance-payroll.js` — `renderFinancePayrollKPIs()`

**Acceptance criteria:**
- [ ] All 4 KPI cards show non-zero values on first load
- [ ] Values are correctly formatted (USD with comma separators, integer for headcount)

---

### Phase 5 — Add Commission/Bonus Modal — Three-Type UI

**Goal:** The "Add Commission / Bonus" modal (Modal 4 and Modal 5) currently surfaces three types as plain `<select>` options. Upgrade to a **segmented button group** so the three types are visually distinct and the form label/placeholder updates contextually.

**Three types:**
- 💰 **Bonus** — grey/neutral chip
- 📈 **Sales Commission** — green chip
- 🎧 **Support Commission** — blue chip

**Files touched:**
- `fe/src/partials/admin/sections/finance-payroll.html` — Modals 4 and 5 form body

**Acceptance criteria:**
- [ ] Selecting each type highlights the correct chip
- [ ] Underlying hidden input value matches `bonus` / `commission_sales` / `commission_support`
- [ ] Form still submits the correct value to `handleWizardAdjustmentSubmit()` and `submitAddPayrollBonus()`

---

### Phase 6 — Cleanup

**Goal:** Remove dead code, consolidate inline styles to CSS classes, and pass a basic a11y audit.

**Items:**
- Remove hidden `<select id="wizardFundingAccount">` (replaced by separate EXT/INT selects)
- Extract all repeated `border-left: 4px solid` card styles into `.kpi-card--primary`, `.kpi-card--success`, etc.
- Add `aria-label` to all icon-only action buttons in payroll tables
- Verify heading hierarchy inside modals (`h3` → `h4` → `h5` only, no skips)
- Remove commented-out legacy code blocks

**Files touched:**
- `fe/src/partials/admin/sections/finance-payroll.html`
- `fe/src/js/admin/finance-payroll.js`

**Acceptance criteria:**
- [ ] No `<select id="wizardFundingAccount">` in HTML
- [ ] All icon-only buttons have `aria-label`
- [ ] No inline `border-left` color styles on KPI cards (CSS classes used instead)
- [ ] Zero console errors or warnings on section load

---

## File Map

```
fe/src/partials/admin/sections/
  └── finance-payroll.html          ← HTML: phases 1, 3, 5, 6

fe/src/js/admin/
  └── finance-payroll.js            ← JS: all phases
```

---

## Branch & PR Strategy

All phases are committed to `feature/payroll`. Each phase is a separate commit with a conventional commit message:

```
feat(payroll): phase 0 — seed data layer
feat(payroll): phase 1 — step 2 column expansion + INT/EXT chip
feat(payroll): phase 2 — step 4 live outflow recompute
feat(payroll): phase 3 — run detail column expansion
feat(payroll): phase 4 — KPI cards wired to seed data
feat(payroll): phase 5 — add bonus/commission segmented type selector
chore(payroll): phase 6 — cleanup, dead code removal, a11y pass
```

PR to `main` opened after all phases pass acceptance criteria.
