# Frontend UI test debt (decision list)

Measured 2026-10-19 on `main` + `fix/ci-workflows`, run locally against this worktree
(`PW_PORT=8081`, Playwright, 2 workers, 1 retry): **56 failed, 597 passed, 2 skipped**; after the fixes below, 38 deterministic failures remain.
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

## 2. Done on this branch (no decision needed)
- Old design constants updated to restyle v3 (phase A/B/C, employee table, bills table, compensation plan wording, settings callouts, payroll settings intro, semantics: overdue is a server flag D-016/D-022).
- Reports spec updated for the library flow.
- **Real bugs found by the tests and fixed:** Annual Matrix report called a missing `FinanceApi.getMatrixReport` (report never loaded); the statement reconcile "create entry" dialog called missing `listCategories` / `listPaymentTypes` (dropdowns stayed empty, errors swallowed); dashboard "Review" button used the removed `btn-primary`.

## 3. Still open - needs your decision (38 tests)
| Group | Tests | What it is | Recommended action |
|---|---|---|---|
| Restyle v3 parity | 30 | See section 1 | Finish the slices (F); then confirm kept labels (U) |
| Old payroll wizard specs | 5 | `finance-guided-payroll` (2), `finance-payroll-split`, `finance-payroll-runner-adjustments`, `finance-payroll-commission-bonus` drive a UI that no longer exists (`#btnRunPayrollWizard`, `#runPayrollWizardModal`, `#kpiLastRunNet`, `#wizardStep1..4`, `#payrollRunDetailModal` are gone from the app). The 6-step journey replaced it. | Delete or rewrite against the new journey; `payroll-journey`, `payroll-step5`, `payroll-table-cycle` specs already cover the new flow. Check they cover Split/FX and Commission/Bonus first. |
| component-language | 2 | Paid badge differs between vocabularies (payroll pill 12px / radius vs HR 11px / 9999px); table cell padding differs (payroll runs 10px 16px, 13.5px vs HR 9px 16px). The principle "one component language" still holds, but the payroll mock uses different values. | Decide which wins: align payroll CSS to HR, or relax the test for payroll |
| shell-foundations R3-3 | 1 | Payroll runs page shows 2 solid primary buttons (row buttons "Continue" and "Reconcile"), the rule says one. The Pay-Runs mock has per-row actions. | Decide: make row buttons secondary, or allow one solid button per row |

## 4. Local flakiness (not code)
Running the suite on this PC adds random `page.goto` timeouts (topbar-account-menu, statements, subscriptions, reports) because pages load fonts and scripts from CDNs and your DNS drops requests. They pass on retry and on GitHub. Not counted above.

Local runs: use `PW_PORT=8081 npx playwright test ...` so a second checkout does not reuse your dev server on 8080.
