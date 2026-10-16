# App UI Restyle v3: Fixes Plan (close the remaining mock gaps)

Status: draft for owner approval. Type: frontend only (no backend, schema or migrations).
Branch: `feature/app-ui-restyle-v3-fixes-plan` (continue here; one commit per slice, prefix `ui(v3):`).
Input: `docs/finance-module/restyle-v3-audit/DIFF-REPORT-2026-10-16.md` (the difference list; item ids such as ED7, RS3 and P2 below refer to it). Mocks: `docs/finance-module/mocks/restyle-v3/` (HTML = spec, PNG = reference).
Parent plans still apply unless this file says otherwise: `app-ui-restyle-v3-conformance-plan.md` (rules R1-R17, decisions D1-D10) and `app-ui-restyle-v3-implementation-plan.md`.

## 0. Owner decisions recorded here

| ID | Decision | Applied how |
|---|---|---|
| F1 | The **View** button in table rows is useless and is removed on purpose. Later, every other row "View" button in every table will also be removed and the row name link will open the record. | Never re-add a View button to match a mock. Employees E1 in the report is **closed as intentional**. Wherever a mock shows a View button (Employees, Roles for Super-Admin), skip it. The Roles "View" for the built-in Super-Admin role is the only read-only entry to that role today, so it stays until the row link exists (see F1 follow-up in section 7). Every table that has a View button must keep its row name as the working link; do not remove a View button on a table where the name is not yet a link. |
| F2 | Everything else the conformance plan already decided stays (D2 mock wording default, D3 static arrows only, D4/D5 controls, D7 native date inputs, D8 mock-mode fixtures may follow the mock, D9 no search icon, D10 area colours). | Items the report tags **[C]** (per-page selector, native dates, ISO-versus-text dates caused by native inputs) are not work items. |
| F3 | Wording: "Benefits & records" (D-014) stays `kept`. Portal titles and sidebar labels follow the mock (sentence case) unless a test or decision says otherwise; list each exception in the slice handoff. | Slice 5 label table. |

Decisions on the draft's open questions (answered by the owner):
| ID | Decision | Applied how |
|---|---|---|
| F4 (Q1) | Keep the real-only "Medical insurance consumption" card and "Notes and performance tracking" on employee detail. | Restyle in the same system and place after the mock sections (Slice 2 step 7). |
| F5 (Q2) | Keep the bonus chips and "+" button on payroll Review pay; do not build the mock's inline select and amount input. | Restyle only (Slice 4 step 3). Keep the existing bonus filter, restyled; no new behaviour. |
| F6 (Q3) | Salary payment docs: light restyle that **keeps the month grouping**. A full redesign comes later. The mock's Download button is not used: each generated doc row gets the existing Preview, offered as the doc name link plus a small outlined Preview button (same function as today's "Preview PDF"). | Slice 6 Salary payment docs bullet. |

## 1. Rules for the implementing agent

Same as the conformance plan section 2. Restated because they cause most failures:
- Preserve every DOM id, `data-*` hook, onclick target, route and function name used by JS or tests (R2). Behaviour is frozen (R3).
- No colour literals in partials, `app-v3.css`, `hr-v3.css`, `payroll-v3.css` or JS; use tokens. Run `npm run lint:finance-tokens` in `fe/` (R5). Forbidden dark values: `#0f1117 #171a24 #1d2130 #2a2e3d #23273a` (R10).
- Do not touch the login page, `login.css`, `be/`, migrations or `docs/project-context/` (R1).
- Light and dark both checked at 1440 px for every slice (R10).
- `npm run build` in `fe/` before every Playwright run; targeted specs per slice; full suite only at the end of Slice 8 (AGENTS.md token rules). Never poll background tasks.
- Update a spec only where it asserts wording or markup this plan changes on purpose; say so in the handoff (R11).
- Save screenshots outside the repo (R13).
- Per slice: write a spec sheet (conformance plan section 3) in the PR notes, implement, build, run named specs, run the visual check script (section 3 below), commit, push, hand off in 5 lines.

## 2. Slice order and dependencies

| Slice | Scope | Report items | Depends on |
|---|---|---|---|
| 1 | Shared dialog system | Section 6 (all dialogs) | none |
| 2 | Employee detail | ED1-ED10 | 1 (its dialogs) |
| 3 | Shared button, table and text polish | SA2, V3, I3, I2, SA3, V1, V2, E4-E5, R5 | none (can run beside 1) |
| 4 | Payroll runs, settings and run steps | Section 3 | 1 (confirm/revert dialogs) |
| 5 | Portal (employee) pages and shell labels | S5-S8, P1-P7 | 3 |
| 6 | HR pages: Requests, Salary, Salary docs (light restyle), Insurance, Vacations, Documents, Dashboard, System | Section 2 and 4 | 3 |
| 7 | Mock-mode fixtures and text/date formatting | all [D] and [T] items | 2, 5, 6 |
| 8 | Full regression, dark pass, report close-out | all | 1-7 |

Slices 1 and 3 touch different files and may be done in either order. Two writers never edit the same file at the same time.

## 3. Verification tooling (outside the repo)

Reuse the capture approach from the audit pass: a Playwright script in the scratchpad that opens `?mock=admin|employee`, clicks `a.nav-item[data-page=...]` (rails: `#payrollRailBtn`, `#systemRailBtn`), screenshots at 1440x900 and builds a mock-LEFT/app-RIGHT composite with PIL. Re-run it after every slice and confirm the listed report items are gone. For payroll steps, drive the run by calling the stepper's own step buttons and check the step title in the DOM before each screenshot (the audit pass clicked by index and landed on the wrong steps).

## 4. Slice 1: shared dialog system (Dlg-* mocks)

Goal: every dialog matches the mock frame, so each per-dialog change is only fields and copy.

Frame: measured on 2026-10-16 with animations off, the app frame already equals the mock (widths 480-700 via `fv-dialog--w*`, radius 18, title 17 px Sora 700, label 12.5/600, input 36, footer buttons 34). The first audit pass reported otherwise by mistake (scaled screenshots), so no width, title or button-height work is needed. Remaining shared work:
1. Remove the required `*` markers from labels (`.req` spans); keep `required` and `aria-required` on inputs (accessibility and validation unchanged). Measured stars: Employee 2, Vacation 2, Claim 2, Category 2, Company doc 3, Role 1, External user 2, Pay plan 4, Social insurance 2, Bank 2, Employee doc 2.
2. Add-on fields (EGP, USD) render the prefix inside the input group: fix Claim and Category (prefix currently sits above the input); check Raise and Pay plan.
3. Assign role dialog labels use unstyled 16 px/400 text and 16 px inputs: bring to the dialog label and checkbox style.
4. Dialog body scrolls while header and footer stay visible, for dialogs taller than the viewport (Employee 810 px).
5. Section headings (Employee: "Basic details", "Pay and employment") are structure only, not uppercase labels (R6).

Per-dialog changes (field set, labels and copy follow the mock; the real field ids stay):

| Dialog | Changes |
|---|---|
| Raise | Employee select with "Name · Role", tiles "Internal now / External now", New internal / New external as right-aligned number fields with USD, Reason as a select (keep a free-text path only if the real flow needs it: check `raise-modal.html` and `salary.js`; if the select would drop data, keep the text field and report it). |
| Employee | Sections and field order per mock, USD add-ons, Status and Employment selects, "Vacation days a year", "Salary payment docs" panel with Doc ID 01-99 and two address lines. Title "Add employee", button "Save employee". |
| Role | Name and description side by side; "N selected" count; filter with the search icon inside the field (fix overlapping placeholder). |
| Vacation (behalf) | Title "Record leave · {name}", fields Type, Status, Start, End, Days, Record date optional, button "Record leave". |
| Claim (behalf) | Category, Provider, Amount with EGP add-on, Status, Record date, taller dashed drop zone with the 14 px bold text, button "Record claim". |
| Category | EGP add-on inside, amount formatted with thousands separator and 2 decimals on blur. |
| Pay plan (comp plan) | Real content stays; restyle to mock structure: current parts table (Part, Amount, Basis, From) on top, "Add a change" form (Part, New amount, Salary basis, Effective from, Notes), buttons "Close" and "Add change". Rename "Employee Compensation Plan" to "Pay plan · {name}". Keep the existing history table below the form (R8). |
| Social insurance | Title with name, "Covered by social insurance" in a tinted bar, EGP add-on for Insured base, Effective from, buttons "Cancel / Save". Keep the validation helper texts (compact). |
| Employee bank account | Title "Employee bank account · {name}", subtitle "Where this employee is paid. Not a company account.", masking note box, button "Save bank details". Keep the reveal control (security feature, R3). |
| Company document | Name and Category side by side, large drop zone, "Publish document". |
| External user | Preselect nothing (placeholder "Select a role..." stays, since choosing a default role would be behaviour); otherwise match the frame. |
| Regenerate | Frame only; sub line "{name} · {month}". |
| Assign role, Employee document, Confirm, Record paid, Revert run, Salary docs | Spec sheet from the mock HTML first (the audit pass did not measure these 4+2); then frame plus copy. Confirm dialog z-index stays 9999 (AGENTS.md). |

Acceptance: composite check for each dialog shows width, title, labels, field heights and footer matching; no `*` in any label; footer visible at 1440x900 for Employee; add-on prefixes inside fields; `npm run lint:finance-tokens` clean.
Specs: existing dialog specs plus a new `fe/tests/ui/v3-dialog-frame.spec.js` asserting (a) width within 2 px of mock for 4 representative dialogs, (b) no `*` text in `.fv-dialog label`, (c) footer inside viewport, (d) add-on prefix is a child of the input group for Claim, Category and Raise.

## 5. Slice 2: employee detail (HR-EmployeeDetail)

Order and content follow the mock; real-only blocks follow (R8).
1. Header card: avatar 52 px; name 20 px with Active and Full-time pills (fix "Full-Time" to "Full-time"); sub line "EMP001 · Engineering Lead · Engineering · email" (add the id, move "Joined" to the Details card where it already appears); buttons "Leave on behalf", "Claim on behalf", "Edit employee" unchanged. (ED1)
2. KPI strip, 5 cells with sub lines: Monthly total "per month, USD", Internal USD cash "paid locally", External USD "US transfer", Next raise "in N days", Vacation left "13 / 21" with "days, N used in YEAR". Remove "See compensation details" link or restyle it as the cell sub line if a test needs it (check `employee-compensation.spec.js`). (ED2)
3. Compensation and raises: columns Effective, Internal, External, Total, Change, Reason; row 56 px with wrapped reason; first row change pill "Starting pay" when the change is zero (display rule only: no calculation change; confirm with the data function first). Buttons "Edit plan" and "Apply raise". (ED3)
4. Leave history and Insurance claims: compact list cards with header meta ("13 of 21 days left", "EGP 180 this year"); rows type + dates, status pill right. Keep the existing empty state text style for empty data. (ED4)
5. Employee documents: row with file icon, name, "PDF · uploaded 15 Jan 2023", Preview, download, delete; header button "Upload document". (ED6)
6. Right column in mock order: Details (Email, Joined, Payment doc ID, Address; "Not set" instead of dash), Employee bank account (Missing pill, dashed alert box "No bank details on file. Payroll can still be prepared and paid; the run flags this employee.", button "Add bank details"; when details exist show the masked bank/IBAN/SWIFT; the "Not loaded" pill is replaced by Missing/Saved based on the data already loaded: if the app currently cannot know without a permissioned fetch, keep "Not loaded" and report it), Social insurance (Covered, Insured base, "Edit" link), Payroll and payments (Latest run, Salary payment docs, link "Payroll runs"). (ED7, ED8)
7. After the mock sections: Medical insurance consumption and Notes and performance tracking (F4). Restyle headings and tiles only. (ED5, ED9)
8. Card titles 13 px, icon tiles 24 px to match the mock. (ED10)

Preserve ids: every id in `employee-detail.html` and every `onclick` (`openCompPlanModal`, `openRaiseModal`, `openBankAccountModal`, `openSocialInsuranceModal`, `openEmployeeDocumentModal`, `saveEmployeeNote`).
Specs: `employee-compensation.spec.js`, existing employee detail specs, new conformance assertions (id and sub line text, KPI sub lines, bank card Missing state in mock mode).

## 6. Slice 3: shared button, table and text polish

1. Primary header actions solid blue where the mock is solid: "Apply raise" (SA2), "Record leave" (V3), "Approve" in Requests and Insurance (R5, I3); outlined only where the mock is outlined. Reject is a red icon button; attachment icon (paperclip) replaces the "—" placeholder in claims rows when an attachment exists. Do not restyle global `.btn`; add scoped classes in `hr-v3.css`.
2. Name cells everywhere: name 13 px/600 on line one, sub line 12 px muted on line two (Salary SA3, Vacations V2). Entitled/Remaining weights per mock: Remaining bold, Entitled normal (V1).
3. Table card footer: remove the extra "Showing ... Page 1 of 1" from tables where the mock has none (Salary current pay, Vacations, Salary raise history); keep it where the mock has it (Employees, Requests, Documents, Users, Payroll runs). Fix the Insurance categories and claims footers that overflow and run text together (I2). Per-page selector stays out (F2).
4. Header row height and padding on all tables per the T1 spec (12/600 `#4b5c92` token, row 41 px). Employees table sits ~8 px lower than the mock (E5): align the filter row height.
5. Text-only: status "On Leave" to "On leave" (E4), "Medical insurance" tab to "Medical claims" in Requests (R1) if no test depends on it, "Work From Home" to "Work from home", "WFH" to "Work from home" in tables, "Partially Reconciled" to "Partly reconciled", "Statutory not recorded" to "Not recorded", "Salaries paid" to "Paid" on the runs list.
6. Row link behaviour (F1): do not add or restore View buttons. If a table row name is not already a link, do not change that in this plan.
Specs: updated wording assertions in the specs that reference these strings (list them in the handoff).

## 7. Slice 4: payroll

Runs list (small): add the download icon button per row (D4: only if an existing export/download function exists for a run; otherwise skip and report), fix labels from Slice 3. Banner values come from fixtures (Slice 7).
Settings: select look for funding accounts (PS2) keeping the real option text format "Name · ••4821"; thousands formatting for exemption "20,000" (PS3, display only); native month/date inputs stay (F2); card spacing (PS4).
Run page:
1. Top bar for a run: status pill ("Draft", "Approved", "Finalized · not paid yet", "Salaries paid") and, when approved, "Revert to draft" button in the bar; remove the in-page "This run is finalized" banner (it duplicates the pill and "Finalized snapshot" strip) unless a test requires it. FX rate text "1 USD = 50.0000 EGP · fallback rate" in the bar (RS1).
2. Setup: amber strip "N employee(s) have no bank details. The run continues; the payment preview flags the row." shown from existing missing-bank data (R4: flag, never block) (RS2).
3. Review pay: card title "Review pay" + sub line, totals row with all columns, info strip, footer "Back / Save draft / Submit for approval". F5: bonus controls keep chips and "+", restyled only (RS3).
4. Statutory (3): title "Statutory processing" with "Estimates" pill, rows show job title as sub line, footer note "Estimates only. The government portals stay authoritative." (RS4).
5. Payment preview (4): fix the double dot in the missing-bank pill (RS5); tiles and card title as mock; flagged tile amber outline.
6. Confirm (5): remove the extra "Payment confirmation" heading, add the amber strip naming each flagged employee, single footer "Back / Export CSV / hint / Confirm and record as paid"; remove the second "Back / Next: Statutory payments" footer card or fold it into the correct step (RS6, RS8). Note: check first whether that second footer is the step 6 navigation; keep the function, move the button.
7. Statutory payments (6): follow the mock structure (two cards, three tiles each, account and settlement date, obligations table "Obligation / Period / Accrued / Remitted / Status / Notes") (RS7). Re-capture this step properly before editing.
Also: Dlg-RecordPaid, Dlg-RevertRun from Slice 1.
Payroll policy R4 unchanged: estimate, portal-confirmed, paid and variance stay separate and labelled.
Specs: `finance-payroll*.spec.js` plus new assertions per step (title, strip presence, footer buttons).

## 8. Slice 5: portal and shell labels

1. Labels: titles "My dashboard", "Salary and raises", "My payslips", "Vacations", "Medical insurance", "Document hub"; sidebar "Salary and raises", "My payslips", "Document hub"; breadcrumb sub "My workspace" (S5-S7).
2. Dashboard: structure already close; fix the recent requests date range format and the invalid range data in fixtures (Slice 7); empty insurance strip uses the compact strip style.
3. Salary: stacked bar chart "Monthly pay over time" with value labels and x labels (Jan 2023, Jan 2024, Today); replace the line chart for this page only (implement in `charts.js` as a new function; do not change existing chart helpers other pages use). Raise history table per mock (P2).
4. Vacations: three compact tiles across, request form card (556 px) with segmented "Full days / Half day" control (this is a styling of the existing duration option; map to the same values the current select sends), leave history with status column (P3).
5. Insurance: "My use this year" card with limit bars, Submit a claim card with EGP add-on and drop zone, claims table with attachment icon and "Waiting" label for pending (P4).
6. Documents: file icon tile, category dot, sub line "PDF · 240 KB" (size only where the data has it), Preview and download (P5).
7. Shell: S8 portal group spacing.
Specs: portal specs (`employee-*.spec.js`) with wording updates.

## 9. Slice 6: HR pages

- **Requests**: add the date range and "· N days" sub line under the type in the Request cell, "Reason" header and "No reason given" text, remove the "Actions" header text (mock has no header over actions), sort Submitted descending with the static arrow (R1-R6).
- **Salary and raises**: change pill "Starting pay" for zero-change first row (display rule), avatar tint consistency, "All years" as the same select style (SA1, SA6, SA7).
- **Salary payment docs** (F6): keep the grouped month accordion and its controls; restyle to the v3 system: toolbar (month select, helper text, "Preview employees", "Generate N docs" only if the count exists before preview, else "Generate docs"), card titled "{Month} · who gets a doc" with status pills Ready / Generated / Needs a doc ID / Skipped and sub lines, per-row actions only where existing functions exist (D4), generated-docs groups with 56 px rows (doc name + sub line, amount right-aligned, status pill, Regenerate as a muted icon button). No Download button. Preview: doc name is a link that calls the existing preview function, plus a small outlined "Preview" button in the row (same function, same arguments). Lower-case pills (`generated`) become sentence case. (SD1-SD4; SD3 is closed as "grouping kept on purpose".)
- **Insurance**: categories as a list (dot, name, limit, edit, delete) without header row (I1); limits card thinner bars (I5); claims row actions per Slice 3.
- **Vacations**: tile sub lines, "On leave today" tile link "Requests" (V5).
- **Document hub**: row sub line with type and size, sentence-case titles are data (H2).
- **Dashboard**: time-range pill "Last 6 months" only if a real range control exists (otherwise skip, D3), bar chart value labels and no y-axis (D2), request types footer copy, tile row top spacing (D1), amber first date (D4), date formatting "7 Oct 2026" (D5), insurance strip bar widths (D6).
- **System**: Users filter pills "All / Active / Archived" with counts (SY3), role filter as native select look (SY4), Sarah's "Change role" enabled state per mock only if the guard allows it; otherwise keep disabled and report (SY6; permission guard is not to be weakened).
- **Roles**: the "View" button for the built-in Super-Admin role stays until row links exist (F1).
Specs: per-page UI specs; new conformance assertions for each page's key labels.

## 10. Slice 7: mock-mode fixtures and formatting (`FinanceMockState`, `finance-api.js`)

Mock-mode only (D8); list every changed fixture value in the handoff.
- Align employees' next raise dates (24 Nov 2026 / 24 Dec 2026 / 28 Jan 2027), vacation used/remaining, request tab counts and submitted dates, insurance categories and claims (EGP 180/350/240), documents (names, sizes, dates), role user counts, payroll run employee counts and projected net pay ($29,000, 2 employees; fix the -$371 draft total), salary docs rows and doc ids, employee detail leave/claims/documents lists, portal dashboard values and recent requests (fix end-before-start dates), portal salary history values.
- Date display helper: one shared formatter producing "7 Oct 2026" and "9-13 Oct 2026" used by the tables the mock formats this way (not native date inputs, F2).
- Greeting is time-based: not a defect.
- Do not copy mock data into real code paths (R9). Trace any open item (R4 policy) in real code and report, do not fix silently.

## 11. Slice 8: regression and close-out

1. `npm run build`, `npm run lint:finance-tokens`, `grep -rn` for the forbidden dark values.
2. Full Playwright suite once (`--reporter=line`).
3. Re-run the capture and composite for all pages and dialogs in light, plus dark for Employees, Dashboard, Payroll runs, Roles and three dialogs. Update `DIFF-REPORT-2026-10-16.md` with a status column (fixed, intentional, deferred).
4. Definition of Done per AGENTS.md: only intended files changed, tests added or updated, commit and push, report with commands and results.

## 12. Intentionally not in this plan
- Removing remaining View buttons and making the row name the link (F1: future work). Propose as its own task after this plan, covering Roles and any other table.
- Sorting, per-page selector, paging controls, inline bonus inputs (D3).
- Native date input text format (D7).
- Backend, permissions, schema.

## 13. Risks
- Wording changes break specs that assert old text (Slices 3, 5, 6): update only those strings.
- Dialog frame changes are global (Slice 1): run all dialog and finance specs after it; stacking context values (drawer 1050, preview 2000, confirm 9999) must not change.
- Employee detail and payroll steps are built by JS (`employees.js`, `payroll-cycle.js`, `finance-payroll.js`): D1 allows structure changes but ids and handlers must stay.
- Fixture changes can mask real-data bugs (report P1: end date before start in recent requests; check the real formatter before blaming fixtures).
