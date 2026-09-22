# HRFlow Payroll Module — Implementation Plan
**Repository:** ahmedezzat85/hrflow  
**Date:** September 21, 2026  
**Status:** Planning  

---

## 1. Executive Summary

This plan covers the full implementation of the redesigned Payroll module inside HRFlow,
replacing the current prototype stage (`prototype/payroll-v1-hrflow-native` &
`prototype/payroll-v2-modern-ux`) with a production-ready feature branch that merges the
best decisions from both directions into the existing codebase architecture.

The existing architecture is a **static-first SPA**: an HTML/CSS/JS frontend served from
`fe/`, a Nunjucks partial system for section templates (`fe/src/partials/admin/sections/`),
and a flat JS module set in `fe/public/js/`. All payroll logic lives in
`finance-payroll.js` (73 KB) and the template in `finance-payroll.html` (56 KB).

---

## 2. Goals

| # | Goal |
|---|------|
| 1 | Editable payroll table with inline cell editing for Bonus, Sales Commission, Support Commission |
| 2 | INT / EXT source selector per employee row |
| 3 | Per-account totals row pinned to the bottom of each account group |
| 4 | All required columns: Employee, Base Salary, Overtime, Bonus, Sales Comm., Support Comm., Source, Deductions, Net Pay |
| 5 | Full payroll cycle: Draft → Review → Approved → Paid |
| 6 | Export to Excel/PDF (extend existing `export.js`) |
| 7 | Dark-mode compatible, matching HRFlow’s existing visual design tokens |
| 8 | Mobile-responsive at 375 px |

---

## 3. Scope — Files to Change

### 3.1 Modified Files

| File | Change |
|------|--------|
| `fe/src/partials/admin/sections/finance-payroll.html` | Full restructure of table layout; add group headers, editable cells, source selector, totals row, cycle status bar |
| `fe/public/js/finance-payroll.js` | Refactor data model; add inline editing controller, INT/EXT toggle, per-account aggregation, cycle state machine |
| `fe/public/js/export.js` | Extend `exportToExcel()` and `exportToPDF()` to support new payroll table shape |
| `fe/public/js/finance-core.js` | Expose shared `formatCurrency()` and `sumColumn()` helpers used by payroll module |

### 3.2 New Files

| File | Purpose |
|------|----------|
| `fe/public/js/payroll-table.js` | Self-contained table controller (init, render, editCell, commitCell, computeTotals) |
| `fe/public/js/payroll-cycle.js` | Cycle state machine: DRAFT → REVIEW → APPROVED → PAID + event bus |
| `fe/src/partials/admin/sections/payroll-cycle-bar.html` | Nunjucks partial for the status/progress bar at the top of the payroll page |

---

## 4. Architecture — Data Model

```js
// Payroll Row (per employee)
{
  id:              String,        // employee ID
  name:            String,
  department:      String,
  account:         String,        // groups rows into account sections
  source:          'INT' | 'EXT', // editable
  baseSalary:      Number,        // read-only
  overtime:        Number,        // read-only (from attendance)
  bonus:           Number,        // editable
  salesComm:       Number,        // editable
  supportComm:     Number,        // editable
  deductions:      Number,        // read-only (from statutory)
  netPay:          Number         // computed: base + overtime + bonus + salesComm + supportComm - deductions
}

// Payroll Cycle
{
  id:     String,   // e.g. "2026-09"
  month:  String,
  status: 'DRAFT' | 'REVIEW' | 'APPROVED' | 'PAID',
  rows:   PayrollRow[],
  lockedAt: Date | null
}
```

---

## 5. UI Specification

### 5.1 Page Layout

```
┌─────────────────────────────────────────────────────┐
│  CYCLE STATUS BAR   [Draft] → [Review] → [Approved] → [Paid]   [Export ▾]  │
├─────────────────────────────────────────────────────┤
│  FILTERS: Month | Department | Source (INT/EXT/All) | Search               │
├─────────────────────────────────────────────────────┤
│  ── Account Group: Operations ──────────────────    │
│  [ Employee | Base | OT | Bonus | SalesComm | SuppComm | Source | Ded | Net ]│
│  Row × N                                            │
│  ── TOTAL ──────────── $x  $x   $x    $x     $x          $x  $x  │
│                                                     │
│  ── Account Group: Engineering ─────────────────   │
│  ...                                                │
└─────────────────────────────────────────────────────┘
```

### 5.2 Inline Editing Rules

- Cells: Bonus, Sales Commission, Support Commission, Source — click to activate
- On click: cell becomes `<input type="number">` (or `<select>` for Source)
- On blur / Enter: commit value, recompute Net Pay, recompute group total
- On Escape: revert to previous value
- Editing is disabled when cycle status is `APPROVED` or `PAID`
- Changed cells get a subtle highlight (`--color-primary-highlight`) until the cycle is saved

### 5.3 Account Totals Row

- Pinned after the last employee row of each account group
- Displays: sum of Base, OT, Bonus, SalesComm, SuppComm, Deductions, Net for the group
- Formatted with `tabular-nums` and right-aligned
- Updates live on every cell commit

### 5.4 INT / EXT Source Selector

- Rendered as a compact `<select>` or toggle pill in the Source column
- INT = internal payroll (processed by HRFlow)
- EXT = external (outsourced / contractor) — row is visually muted
- Filterable from the page-level filter bar

### 5.5 Cycle Status Bar

- Horizontal stepper with four states
- Buttons: “Submit for Review”, “Approve”, “Mark as Paid”, “Reopen Draft”
- Each transition triggers a confirmation modal
- “Approve” and “Mark as Paid” require admin-level permission (role check via `session.js`)

---

## 6. Phase Plan

### Phase 1 — Foundation (Week 1)
- [ ] Create `feature/payroll-redesign` branch from `main`
- [ ] Merge all relevant commits from `feature/payroll` into new branch
- [ ] Refactor `finance-payroll.js`: extract data layer into `payroll-table.js`
- [ ] Write data model, seed fake data for 15 employees across 3 account groups
- [ ] Unit-test `computeTotals()` and `netPay` formula in isolation

### Phase 2 — Table UI (Week 2)
- [ ] Restructure `finance-payroll.html`: account group headers, column set
- [ ] Implement inline editing for Bonus, Sales Commission, Support Commission
- [ ] INT/EXT source selector with filter integration
- [ ] Per-account totals row (live recompute)
- [ ] Keyboard navigation: Tab between editable cells, Enter to commit

### Phase 3 — Cycle Workflow (Week 3)
- [ ] Build `payroll-cycle.js` state machine
- [ ] Build `payroll-cycle-bar.html` partial and wire to JS
- [ ] Lock table on APPROVED/PAID status
- [ ] Confirmation modals for status transitions
- [ ] Role check integration (`session.js → currentUser.role`)

### Phase 4 — Export & Polish (Week 4)
- [ ] Extend `export.js` for new table shape (Excel: grouped rows + totals; PDF: one account group per page)
- [ ] Accessibility pass: keyboard nav, ARIA labels, focus rings
- [ ] Mobile responsive pass at 375 px
- [ ] Dark mode verification
- [ ] Cross-browser test (Chrome, Firefox, Safari)
- [ ] Code review + PR to `main`

---

## 7. Key Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Keep static JS architecture | No build-tool migration in scope; consistent with rest of codebase |
| Split payroll logic into `payroll-table.js` + `payroll-cycle.js` | `finance-payroll.js` at 73 KB is already large; separation improves testability |
| Live Net Pay recomputation in-browser | No round-trip needed; all inputs are available locally |
| Partial lock on APPROVED/PAID | Prevents accidental edits after approval; mirrors standard payroll software behaviour |
| Export extends existing `export.js` | Avoids adding a new library dependency |

---

## 8. Definition of Done

- [ ] All Phase 1–4 tasks checked off
- [ ] Inline editing works for Bonus, Sales Comm., Support Comm.
- [ ] INT/EXT source selector works with filter
- [ ] Per-account totals update live
- [ ] Cycle: Draft → Review → Approved → Paid transitions work with role check
- [ ] Export (Excel + PDF) produces correctly grouped output
- [ ] No regressions in other finance sections
- [ ] Passes WCAG AA contrast check
- [ ] Mobile layout verified at 375 px
- [ ] PR approved and merged to `main`

---

## 9. Branch & Prototype Cleanup

The two prototype branches created during the design exploration phase should be deleted
before starting Phase 1:

```bash
git push origin --delete prototype/payroll-v1-hrflow-native
git push origin --delete prototype/payroll-v2-modern-ux
```

Or via GitHub UI:  
**Repository → Branches → prototype/payroll-v1-hrflow-native → Delete**  
**Repository → Branches → prototype/payroll-v2-modern-ux → Delete**

---

*End of plan — HRFlow Payroll Redesign v1.0*
