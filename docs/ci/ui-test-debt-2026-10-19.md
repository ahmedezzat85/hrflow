# Frontend UI test debt (decision list)

Measured 2026-10-19 on `main` + `fix/ci-workflows`, run locally against this worktree
(`PW_PORT=8081`, Playwright, 2 workers, 1 retry): **56 failed, 597 passed, 2 skipped**.
Objective bugs already fixed on this branch: 8 undefined CSS variables, dark-theme contrast,
phone touch targets (44px), accessible names on the raise modal.

Every spec stays blocking. Nothing below has been edited or skipped. Each group needs a decision:
**U** = update the test to the new design, **F** = finish the app (design not done yet), **B** = real bug, fix the app.

## 1. Restyle v3 parity (30 tests, `restyle-v3-parity.spec.js`) - mostly F
The loop compares each page against `docs/finance-module/mocks/restyle-v3`. Pages S1.3-S3.9 do not match yet.

| Slice | What differs | Likely action |
|---|---|---|
| S1.3 tables/cards | body font 13.5px vs mock 14px; table border colour; "View" button and "Search employees" label missing | F or U (owner removed the View button) |
| S1.4 pills/stat tiles | stat value element missing in mock; extra "Actions" label | U |
| S2.1-S2.4 shell | "Search Ctrl K" missing, extra "HR" / "General Dashboard"; sidebar panel padding 0 vs 18/12px; active dashboard item missing | F |
| S3.1 HR dashboard | hero card 261x133 vs 225x101; requests chart card not in mock; 3 hero card texts missing | F |
| S3.2 Employees | table font 16px vs 14px, header height 42 vs 17, row height 59 vs 41 | F |
| S3.3 Employee detail | details card missing; bank card padding/height; extra Notes + insurance consumption cards | F / U (kept features) |
| S3.4 Requests | tabs and status pills missing | F |
| S3.5 Salary and raises | stats grid and raise-history shell missing | F |
| S3.6 Salary payment docs | table font/height; extra columns text | F / U |
| S3.7 Vacations | stat tiles 352x100 vs 314x87; usage progress missing in app and mock | F |
| S3.8 Medical insurance | limits card missing; claims shell 535px wide vs 1082px | F |
| S3.9 Document hub | filters missing; first cell padding/height | F |

Wording differences (`TEXT-CHANGES.md` policy: the app keeps its own words) must be listed per slice in
`helpers/parity-map.js` `keptLabels`; the unlisted ones fail today. That is a mechanical U once you confirm the list.

## 2. Old design constants (U unless you want the old value back)
| Spec | Old expectation | Now |
|---|---|---|
| frontend-consistency-phase-a A1 | token alias `#7a8ea8` | `#556983` |
| phase-a A2 | payroll dark background `#0f1117` | `#0b1634` (navy theme) |
| phase-b AC2 | field radius 10px | 9px |
| phase-b AC4 | dark settings card `rgb(23,26,36)` | `rgb(16,29,68)` |
| phase-c AC1 | `.section-title` 17px | 15px |
| phase-c AC4 | stepper weight 700 | 600 |
| component-language (3) | one Paid badge look; shared table style; type scale tokens | restyle changed these |
| shell-foundations R3-3 | one primary button on Payroll runs | now 2 |
| employee-table-layout | compact action-button row | View button removed |
| finance-bills-table-restyle | bills columns | columns changed |
| finance-semantics AC5 | `getDerivedInvoiceStatus` returns `overdue` | D-016/D-022: overdue is a server flag, not a status |

## 3. Payroll and reports UI changed (U, or B if the screens regressed)
Selectors the tests use no longer exist or never become visible:
`#kpiLastRunNet` (finance-guided-payroll), `.payroll-settings-header .section-title-group` and
`.settings-card-callout.callout-blue i` (phase-a/b), `#financeReportsSubNav` (reports, 4 tests),
`#a-salary table thead` text and the GROSS salary-basis control (finance-compensation-plan, 2),
and click timeouts in finance-payroll-split, finance-payroll-runner-adjustments and
finance-payroll-commission-bonus (the payroll wizard buttons moved or were renamed).
These need a quick look in the browser: if the screen still works, update the selector; if a control disappeared, it is a bug.
