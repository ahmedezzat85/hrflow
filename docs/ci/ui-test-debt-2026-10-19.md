# Frontend UI test debt (decision list)

Measured 2026-10-19 on `main` plus the CI fix work (since merged into `main`), run locally
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
- New `finance-payroll-inline-additions.spec.js` (3 tests: Sales/Support commission and bonus, INT/EXT source, reason tags, totals, remove, zero-amount error, read-only after approval) replaced `finance-payroll-runner-adjustments` and `finance-payroll-commission-bonus`, which are deleted. It found a real bug (fixed): on a finalized run the bonus remove buttons stayed visible and `deleteBonus` had no lock guard.
- Deleted `finance-guided-payroll.spec.js` (2 tests) and `finance-payroll-split.spec.js` (1 test): they drove the removed wizard modal, and the six-screen journey specs cover the same behaviour (lifecycle submit/approve/finalize/disburse/journal: `finance-payroll-table-cycle` TC-3/5/16 and `payroll-journey`; FX override/reset: TC-2; External + Internal = Total per employee and FX chip: `payroll-step5`).
- **Real bugs found by the tests and fixed:** Annual Matrix report called a missing `FinanceApi.getMatrixReport` (report never loaded); the statement reconcile "create entry" dialog called missing `listCategories` / `listPaymentTypes` (dropdowns stayed empty, errors swallowed); dashboard "Review" button used the removed `btn-primary`.

## 3. Still open - needs your decision (33 tests)
| Group | Tests | What it is | Recommended action |
|---|---|---|---|
| Restyle v3 parity | 30 | See section 1 | Finish the slices (F); then confirm kept labels (U) |
| component-language | 2 | Paid badge differs between vocabularies (payroll pill 12px / radius vs HR 11px / 9999px); table cell padding differs (payroll runs 10px 16px, 13.5px vs HR 9px 16px). The principle "one component language" still holds, but the payroll mock uses different values. | Decide which wins: align payroll CSS to HR, or relax the test for payroll |
| shell-foundations R3-3 | 1 | Payroll runs page shows 2 solid primary buttons (row buttons "Continue" and "Reconcile"), the rule says one. The Pay-Runs mock has per-row actions. | Decide: make row buttons secondary, or allow one solid button per row |

## 4. Local flakiness (not code)
Running the suite on this PC adds random `page.goto` timeouts (topbar-account-menu, statements, subscriptions, reports) because pages load fonts and scripts from CDNs and your DNS drops requests. They pass on retry and on GitHub. Not counted above.

Local runs: use `PW_PORT=8081 npx playwright test ...` so a second checkout does not reuse your dev server on 8080.

## 5. Backend (GitHub run 39171913489: 650 passed, 2 failed, 5 errors)
- 5 errors fixed: `test_db_config.py` reloaded the config module and left a PostgreSQL `Config` for later tests (connection refused on localhost:5432). Now restored after each test.
- `test_cookie_secure_flag_is_reflected_in_production_response` fixed: the login route resolves the access context from the database right after setting the cookie; the test returned no real user, so it got 401. The test now supplies a fixed context and still asserts `Secure` and `HttpOnly`.
- **Decided and fixed:** in the payable-status report, the per-employee insurance flow counted the employer's own social insurance cost (`employer_cost_extra`, 282.22 in the test) as something the employee owes, so the single-employee view showed `pending`. It now counts only the employee's deducted share (`deductions_total`), so an employee who owes nothing shows `settled`. The employee breakdown table uses the same figures, so its per-employee insurance amounts no longer include the employer share.
- `test_repositories.py::test_employee_repository_crud` was only passing while a leaked PostgreSQL config made the SQL read fail; it is now in-memory only.

## 6. Resolved with the owner, 2026-10-19 (all 33 design items)

All 18 distinct issues were decided one by one and applied; the full local frontend run is 674 passed, 1 failed (finance-revenue, passes alone, local timeout), 2 skipped.

- Parity map (`fe/tests/ui/helpers/parity-map.js`): each page keeps its owner-approved differences as `accepted` values per theme and `keptLabels`; they stay enforced. Width/height compare rendered layout sizes (offsetWidth/Height), not computed content-box sizes.
- App changes: dashboard chart cards match the mock; Employee detail mock view shows documents (Preview) and the Missing bank warning card, 'Starting pay' hire row; requests list Pending first; bare edit/eye icons in the Salary and Vacations tables; Vacations Remaining bold; one status badge size for every screen (12px, semibold, 1px border); Payroll runs table on the shared 9px/13.5px scale.
- Rules kept by decision: Payroll runs next-step buttons (Continue, Reconcile) are solid as in the mock; the Review worksheet keeps its 8px rows (Pay-Run-Review mock).
- Not built (owner decision): sidebar search box, dashboard top-bar icon/breadcrumb, mock's flat Generated docs list, 'Average raise' tile change, categories header row removal, file size line.
