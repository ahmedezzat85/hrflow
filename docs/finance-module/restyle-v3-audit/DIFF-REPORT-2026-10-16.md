# Restyle v3: visual differences, app vs mocks (fresh pass)

Date: 2026-10-16. Branch `feature/app-ui-restyle-v3-fixes-plan` (HEAD dddbc70). No code changed.
Method: app run in `?mock=admin` / `?mock=employee` at 1440 px (dev server), screenshotted and compared side by side with `docs/finance-module/mocks/restyle-v3/*.png`. Replaces the stale `GAP-REPORT.md` (HEAD 98ab9ca).
Legend: **[S]** structure/layout, **[V]** visual/CSS, **[T]** text/copy, **[D]** mock-mode data (fixture, not CSS), **[C]** compatibility note (decision/limitation, may be intentional).
Coverage: 19 page shots, employee detail, payroll steps 1 (see caveat), 14 of 18 dialogs. Not captured: Dlg-Confirm, Dlg-RecordPaid, Dlg-RevertRun, Dlg-SalaryDocs, Pay-Run steps 3-6 aligned to the mocks, Nav-Variants, Rail-Options, Shell-System.

## 1. Shell (all pages)
Largely matched now (outline icons, tinted tiles, rail badge, bottom Collapse, 52 px bar, sentence-case labels, breadcrumb titles).
| # | Mock | App |
|---|---|---|
| S1 | Greeting "Good morning" | "Good afternoon" (time based) [D] |
| S2 | Sidebar group label "Benefits and records" | "Benefits & records" [T] (decision D-014) |
| S3 | Panel groups start ~12 px higher; nav rows tighter; Collapse button sits ~at content bottom | Groups/rows ~8-15 px lower; app sidebar heading block 4 px different |
| S4 | Top bar right: export + bell + avatar | Same, but export icon missing on System pages in mock (mock has none there) [V] minor |
| S5 | Page title row: titles in sentence case ("My dashboard", "Salary and raises", "My payslips", "Document hub", "Medical insurance") | Portal pages still Title Case: "My Dashboard", "Salary & Raises", "My Payslips", "Document Hub", "Medical Insurance" [T] |
| S6 | Portal sidebar: "Salary and raises", "My payslips", "Document hub" | "My salary", "Payslips", "Document hub" [T] |
| S7 | Breadcrumb sub text "My workspace" | "Workspace" [T] |
| S8 | Portal panel group label "Workspace" 4 px above first item | ~6 px lower [V] |

## 2. HR pages
**Dashboard**
- D1 [S] Hero card and KPI tiles: mock tiles are 92 px tall starting at y=80; app tiles start y=68 and cards are ~8 px taller/less padded. Grid row gap and card heights differ slightly.
- D2 [S] Requests-by-month chart: mock has value labels on top of each bar (1,1,2,1,2,4) and no y-axis; app shows y-axis ticks 0-4 and no labels.
- D3 [S] Request types: mock shows 3 bars with "5 · 50%" and a footer "8 requests in 6 months · 2 waiting"; app shows "5 · 45%", footer "11 requests ... 3 waiting" [D]. Bar track looks thinner in the app.
- D4 [V] Upcoming raises: mock has first date coloured amber and "in 44 days" under; app matches in structure but dates differ (29 Nov vs 24 Nov) [D].
- D5 [T] "Waiting for a decision": mock dates "7 Oct 2026" with "1 day" sub line, request type "Work from home"; app "2026-10-07" ISO, "Work From Home" capitalisation [T].
- D6 [V] Insurance strip: mock rows have progress bars full-width under label; app bars are shorter and labels wrap differently; mock button "Medical insurance" same.
- D7 [T] Time-range "Last 6 months" pill (top right of page) present in mock, absent in app [S].

**Employees** (closest match)
- E1 [S] Row action: mock keeps an outlined **View** button before the 3 icons; app removed it (commit dddbc70 "View button removal") [C].
- E2 [S] Footer: mock has "10 per page" selector + "Page 1 of 1"; app has only "Page 1 of 1" [C: D3 static arrow decision].
- E3 [D] Next raise dates (29 Nov / 29 Dec / 02 Feb vs 24 Nov / 24 Dec / 28 Jan).
- E4 [T] Status pill "On Leave" vs mock "On leave".
- E5 [V] Table header row ~8 px taller in the app (header y=102 vs 94) and first row starts lower; overall table is ~10 px lower on the page because the filter row is taller.
- E6 [V] Dark: same structure; table card border in app has a visible brighter outline at header edge; otherwise matches.

**Employee detail** (largest structural gap in HR)
- ED1 [S] Header card: mock puts name, Active + Full-time pills, then "EMP001 · Engineering Lead · Engineering · email" and 3 buttons; app shows "Joined 15 Jan 2023" in the sub line, pill text "Full-Time", and no ID.
- ED2 [S] KPI strip: mock 5 cells with sub lines ("per month, USD", "paid locally", "US transfer", "in 44 days", "days, 8 used in 2026"); app has "Monthly Compensation / month total", extra link "See compensation details", no sub lines on 3 cells, "13 / 21 days".
- ED3 [S] Compensation table: mock columns Effective / Internal / External / Total / Change / Reason with 56 px rows and wrapped reason; app similar but "+$0 (+0.0%)" instead of "Starting pay" pill on the first row [D], row height smaller.
- ED4 [S] Leave history and Insurance claims: mock = compact list cards (type, dates, status pill; header meta "13 of 21 days left", "EGP 180 this year"); app = empty "No ... in mock view" states with icon [D]; header icon tiles larger.
- ED5 [S] Mock has no "Medical insurance consumption" card; app shows it (real feature, R8) and it sits between Leave and Documents.
- ED6 [S] Employee documents: mock rows with Preview/download/delete and "Upload document" outline button; app empty state, button "Upload" with icon [T].
- ED7 [S] Right column: mock cards Details, Employee bank account (red "Missing" pill + dashed alert box + "Add bank details" button), Social insurance (Covered Yes, Insured base EGP 9,400, "Edit" link), Payroll and payments ("Latest run", "Salary payment docs"). App: bank card shows "Not loaded" pill with Bank/IBAN/SWIFT dashes and "Masked by default" note, no alert state or action button; Social insurance shows "Not loaded" + dashes; Payroll card has different rows ("Doc INV-2026-001 2026-10", "Latest payroll No lines").
- ED8 [T] Details card: "Payment doc ID / Address" show "—"; mock "Not set".
- ED9 [S] Notes & Performance Tracking card (real-only, R8): large form below documents, not in mock.
- ED10 [V] Card padding/heading sizes: app card titles ~13 px bold with 28 px tile icons vs mock 12.5 px with 24 px tiles.

**Pending requests**
- R1 [S] Mock tab "Medical claims" ; app "Medical insurance" [T]. Tab counts differ (Vacation 5/WFH 3 vs 5/1) [D].
- R2 [S] Columns: mock Employee / Request (dot + type + dates "7 Oct 2026 · 1 day") / Reason / Submitted ↓ / Status / actions. App: Employee / Type / Details & reason / Submitted / Status / **Actions** header; type text only, no date range sub line, Submitted in ISO, "WFH" abbreviations.
- R3 [T] Reason text "No reason given" vs app "No details provided".
- R4 [S] Row order: mock sorts by Submitted desc (pending first by date); app sorts oldest-first style (Sarah 2026-10-04 first) [D].
- R5 [V] Approve button in mock is 28 px, app 32 px; reject x same.
- R6 [V] Rows: mock 40 px, app ~39 px; avatar tint for Sarah is blue vs mock blue; ok.

**Salary and raises**
- SA1 [D] "+0.0%" average raise tile vs "+13.6%"; sub line "last review in January 2024" vs "one raise in January 2024"; "Raises applied" ok.
- SA2 [T] "Apply raise" button: mock solid blue primary; app outlined/white [V].
- SA3 [S] Name cell: mock two-line (name + dept grey); app both bold (department same weight).
- SA4 [T] Next raise / Effective dates ISO vs "24 Nov 2026".
- SA5 [S] Table footer "Showing 1-5 of 5 employees / Page 1 of 1" exists in app only (not in mock).
- SA6 [D] Raise history: mock "Starting pay" pill for first row; app "+$0 (+0.0%)" green pill. Employee avatar tint wrong on second row (orange vs blue) [V].
- SA7 [V] Raise history header "All years" select: mock native select; app custom chevron.

**Salary payment docs** (still a different layout)
- SD1 [S] Mock toolbar: month select + helper text + "Preview employees" + "Generate 2 docs". App: same toolbar but button label "Generate docs" and "Preview employees" present.
- SD2 [S] Mock main card "October 2026 · who gets a doc" lists employees with Ready/Generated/Needs a doc ID/Skipped pills and per-row Generate/Regenerate/Edit employee. App card "Who gets a doc" is empty until preview ("Click Preview Eligible Employees...") [D].
- SD3 [S] Mock "Generated docs" is a flat list of file rows with Download + refresh icon, sorted by "Newest month first". App is a grouped accordion by month with Name / Doc # / Expand All buttons, table with Preview PDF / Regenerate buttons and `generated` lower-case pill.
- SD4 [T] Doc IDs: mock "SPD-2026-10-03" vs app "INV-2026-001" [D].

**Vacations**
- V1 [V] Remaining column: mock bold numbers in right-aligned Remaining, Entitled normal; app bolds Entitled instead and un-bolds Remaining.
- V2 [V] Name cell: mock sub line grey; app subtitle bold (same weight as name).
- V3 [V] "Record leave" header button: mock solid blue; app outlined [V].
- V4 [S] Footer "Showing 1-5 of 5 employees" in app only.
- V5 [T] On-leave tile sub line "1 request waiting" vs "2 requests waiting" [D].

**Medical insurance**
- I1 [S] Categories card: mock a list (dot, name, limit, edit/delete) with no header row; app a table with Category / Annual limit header.
- I2 [V] Footer "Showing 1-3 of 3 categories Page 1 of 1" overflows the card and runs together without spacing (bug, also under Claims) .
- I3 [S] Claims: mock Approve is solid blue 28 px and reject is a red x; app Approve is outlined white and reject grey x; attachment paperclip icons in the mock replaced by "—" in the app.
- I4 [T] Dates "6 Oct 2026 / 14 Sep 2026 / 9 Jul 2026" vs "06 Oct 2026 / 14 Sept 2026 / 09 Jul 2026".
- I5 [V] Use-against-limits card: mock bars thinner with label/value on same line; app taller card with extra bottom padding.

**Document hub**
- H1 [S] Filter pills: mock shows "Announcement 0" but greyed; app same.
- H2 [S] Rows: mock sub line "PDF · 240 KB" and sentence-case titles ("Leave and remote work policy"); app "PDF" only, Title Case [D/T].
- H3 [D] Dates differ.

## 3. Payroll
**Runs list**: close. Differences: banner net pay "-$371.00" and "8 employees eligible" vs "$29,000.00 / 2" [D]; banner is ~6 px shorter text spacing; status "Salaries paid" vs mock "Paid" [T]; "Partially Reconciled" vs "Partly reconciled" [T]; "Statutory not recorded" vs "Not recorded" [T]; download icon missing from each row [S].
**Settings**
- PS1 [S] Native date inputs in app (month/date pickers) vs mock text-style inputs "September 2026 / 30 Sep 2026" [C: D7 accepted].
- PS2 [S] Funding accounts rendered as text-input look instead of a select with chevron ("Voyance Operating USD (USD •••• 4821)" vs "Voyance Operating USD · ••4821").
- PS3 [V] Income tax card: tax limit shows "20000" unformatted vs "20,000" and the add-on "EGP a year"; "Effective from" is a month picker with calendar icon vs plain text.
- PS4 [S] Cards ~8 px lower; top-bar title row lacks the mock's export-less bar (export icon shown).
**Run page / steps** (compared with caveat: my step navigation landed on different states, so only Setup is a clean comparison)
- RS1 [S] A yellow banner "This run is finalized..." sits above the stepper on finalized runs in the app; the mock shows an "Approved" pill and "Revert to draft" button in the top bar, no banner.
- RS2 [S] Setup: mock has amber strip "1 employee has no bank details" and text inputs for dates; app has no strip and native date inputs [C].
- RS3 [S] Review pay: mock has inline "No variable pay" select + amount input per row and a totals row; app shows chips + "+" button per row, a search field instead of the "All variable pay" select, and a totals row with only $3,390.
- RS4 [S] Statutory (3): mock table without ID rows beyond 2 employees; app rows show "Employee" sub line instead of the job title and all zero figures [D].
- RS5 [S] Payment preview (4): mock tile "1 of 2 flagged"; app "5 of 8 flagged" [D]. Missing-bank pill in the app shows a double dot "● ● Missing bank details" [V bug].
- RS6 [S] Confirm (5): mock has amber strip naming the employee and "Back / Export CSV / hint / Confirm" footer; app has no amber strip and a second "Back / Next: Statutory payments" footer card below.
- RS7 [S] Statutory payments (6): not clean-captured; mock shows two cards (Social insurance, Salary income tax) with tiles and an obligations table.
- RS8 [V] Heading above stepper: app shows a "Payment confirmation" heading (not in mock).

## 4. System
- SY1 [D] Users per role (HR-Admin 1, Financial-Admin 1, Employee 0 vs mock 2/1).
- SY2 [T] Role descriptions differ ("HR domain administration..." etc.).
- SY3 [S] Users: mock pills "All 6 / Active 6 / Archived 0" with counts; app shows a single "All" box without counts and without Active/Archived [S].
- SY4 [S] Mock role filter is a native select "All roles"; app custom field "All Roles" [T].
- SY5 [V] Roles: Edit/View buttons same; lock icon dimmer.
- SY6 [V] Sarah's "Change role" in the app is disabled-grey; mock shows it enabled.

## 5. Portal (employee)
- P1 [S] Dashboard: hero card "21 of 21 / 0 days used" vs mock "13 of 21 / 8 days used" [D]; "Next raise" card shows "—" and "No raise date scheduled yet" vs "24 Nov 2026" with last-raise text [D]; recent requests have ISO date ranges ("2026-10-01 to 2026-09-26" - end before start, data bug) vs "4-6 Oct 2026"; insurance strip empty state vs bars [D]; the strip is a taller card with larger empty icon.
- P2 [S] Salary: app uses a line chart with y-axis 0-1.0 and ISO x labels and $0 tiles; mock uses stacked bars with value labels "Jan 2023 / Jan 2024 / Today"; raise history rows show $0 [D]; "Next raise" tile "None scheduled" vs "24 Nov 2026 / in 44 days".
- P3 [S] Vacations: app layout compresses into narrow 3-column row (tiles narrower, request form half width) vs mock tiles spanning with form (556 px) + history; segmented "Full days / Half day" replaced by a text "Full Day(s)" field; Leave type shows "Annual Leave" as a field not a select; native date inputs; history has no Status column and uses ISO date ranges; usage bar missing colour fill.
- P4 [S] Insurance: app shows empty-state card (no limits bars) [D]; Category select is empty; claims row shows "—" where mock has paperclip; status "Pending" vs mock "Waiting" [T].
- P5 [S] Documents: app rows lack the file icon tile, category dots, "PDF · 240 KB" sub line; mock has them; app shows "PDF" inline after the title.
- P6 [S] Payslips: matches (coming soon). Mock has a small grey note line under the card ("Owner decision in docs/UI-UX-FIX-PLAN.md...") which is a mock annotation, not UI.
- P7 [T] Greeting and page titles as in section 1.

## 6. Dialogs (mock = ~560 px wide, 17 px Sora title, 34 px buttons, selects with native chevrons, add-on prefixes)
Correction (2026-10-16, measured with animations off): the first pass claimed dialogs were narrower with smaller titles and buttons. That was a screenshot scaling artifact (mock PNGs are 1140 px wide, app captures 1440 px). Measured computed values match the mocks: widths (480-700), radius 18, title 17 px Sora 700, label 12.5/600, input height 36, footer buttons 34. The real shared gaps are: required `*` markers in labels (mock has none), add-on prefixes (EGP/USD) not rendered inside the field, no section headings in some dialogs, native date/select controls where the mock shows text/select (native dates accepted, D7), and several dialogs that are taller than the mock because of extra fields (Employee 810 vs 738 px, Role 718 vs 630, Pay plan 769 vs 548).

| Dialog | Differences |
|---|---|
| Raise | Mock: Employee select, "Internal now / External now" tiles, New internal/external as right-aligned numbers prefilled, text date "24 Nov 2026", Reason as select. App: Employee shows a text-like field with " — ", placeholders "e.g. 550", native date, Reason as text field, extra gap between employee and tiles. |
| Employee | Mock: sections "Basic details", "Pay and employment" with USD add-on fields, Join date, selects for Status/Employment, "Vacation days a year", "Salary payment docs" panel. App: no section headings, fields labelled "Full Name/Email/Department/Role Title/Internal Salary USD/External Salary", native date, Status/Employment as text fields, "Vacation Balance days", no add-on, taller dialog that scrolls and cuts off the footer at 900 px. |
| Role | Mock: name + description side by side, permissions "4 selected" with search icon filter, rows with checked state. App: stacked fields, "0 selected", filter without icon (placeholder overlaps icon), no gap between header areas. |
| Vacation | Title: mock "Record leave · Sarah Connor" / App "Record leave on behalf". Mock fields: Type select, Status select, Start/End text dates, Days, Record date; App: stacked Type, Start/End native date, Days Count, Status, Record date; button "Submit" vs "Record leave". |
| Claim | Mock: Category select, Provider, Amount with EGP add-on, Status, Record date, dashed bigger receipt drop zone with 14 px bold text. App: category/status as text fields, Amount label with "EGP" above the input (add-on broken), native date, small drop zone. |
| Category | Mock add-on "EGP" prefix inside field; app puts "EGP" text above the input (add-on not rendered) and value "1500" vs "1,500.00". |
| Comp plan (Pay plan) | Different content: mock = table of current parts + "Add a change" (Part, New amount, Salary basis, Effective from, Notes) with "Add change" button; app = title "Employee Compensation Plan", header summary card ($0 / month, $0.00 tiles), component form + "Save Component" and an empty history table, "Close" only. [S][T][D] |
| Social insurance | Mock title "Social insurance · Sarah Connor", checkbox row in a tinted bar, EGP add-on and text date; app plain title, unchecked small checkbox, helper texts, native date. |
| Bank account | Mock title "Employee bank account · Sarah Connor", subtitle "Where this employee is paid. Not a company account.", footer note about masking, button "Save bank details"; app title "Add employee bank account", eye reveal button, "Save". |
| Company doc | Mock Document name + Category side by side, large drop zone; app stacked, small drop zone. |
| External user | Same copy; app role placeholder "Select a role…" vs preselected; dialog narrower. |
| Regenerate | Matches closely; app title block is smaller and body copy sits 6 px tighter. |
| Assign role / Employee document | Captured, not reviewed line by line (same common deltas expected). |

## 7. What is already aligned
Shell icons/rail/Collapse/52 px bar, status pills and filter pills shape, card radius/shadow, dark palette (Employees dark), payroll runs table and banner structure, payslips page, Regenerate dialog, document hub structure, vacations structure.

## 8. Priorities (suggested order)
1. Dialogs: shared width/title size/button height, remove required asterisks, fix add-on prefix (EGP/USD), use native select look (Raise, Claim, Category, Employee, Vacation).
2. Employee detail rebuild (header sub line, KPI sub lines, bank/social cards with Missing/Covered states).
3. Payroll run steps 2, 5, 6 structure; settings field styling.
4. Portal pages: Vacations/Salary/Insurance/Documents layout and Title→sentence case; dashboard fixtures.
5. HR: Requests columns, Salary docs layout, Insurance categories list, button variants (solid vs outlined) on Apply raise/Record leave/Approve.
6. Text/date formatting ("24 Nov 2026", sentence case) and mock-mode fixtures.

## 9. Status after the fixes plan (2026-10-16, slices 1-8)
Commits on `feature/app-ui-restyle-v3-fixes-plan`: slice 1 `9a42b5f` + `7f86cbe` (dialogs), slice 2 `15faad6` (employee detail), slice 3 `79795c8`, slice 4 `4d1ac51`, slice 5 `d735ff4`, slice 6 `17fb75b`, slice 7 (fixtures) and close-out in the latest commit.

**Fixed**: dialog markers, add-ons, chevrons, field order and headings (all HR/System dialogs incl. Pay plan, Salary docs, Raise, Confirm icon, Assign role); employee detail header, KPI strip, bank Missing state, text links; solid primary buttons, name cell sub lines, footers removed where the mocks have none, insurance footer overflow; portal titles, Vacations and Insurance layout (legacy grid rules removed), documents rows, salary stacked chart with totals; request columns (Request, Reason, Submitted), "Medical claims" tab; dashboard bar totals; dates now "7 Oct 2026" and ranges "4-6 Oct 2026"; funding account labels and select chevrons; mock-mode fixtures (below).

**Intentional, not changed (existing owner decisions or tests)**: View buttons removed (F1); native date inputs (D7); no sort or per-page controls (D3); payroll finalized lock banner and hidden top-bar FX strip (tests require them); payroll status chips "Salaries paid" and "Statutory not recorded" (payroll-step5 spec); Confirm dialog keeps title, longer body and close X (parity map `keptLabels`); social insurance wording "Not set up" (messages spec); portal sidebar labels "My salary" and "Payslips" (conformance spec); users page keeps the All/Employees/External/Archived select (filter kinds differ from the mock pills); Medical insurance consumption and Notes cards kept (F4); bonus chips kept on Review pay (F5).

**Deferred**: payroll mock fixtures (8 payroll employees, -$371 draft total) because 6+ payroll specs are written against them; dashboard "Last 6 months" control (new behaviour); per-row "Raise history" starting-pay pill is data driven; Raise dialog Reason stays free text; bank dialog title stays JS-set.

**Mock-mode fixture changes (session.js)**: requests now carry start and end dates derived from `days`; REQ-101..103 date ranges made consistent with `days`; employee-portal Sarah Connor now has internal 5000 and external 7500 USD, 8 of 21 vacation days used, next raise in 45 days and the two-step salary history; portal vacation history ends after it starts; portal insurance categories and consumption added (Dental 180 of 2,000, Optical, Physical therapy).

**Test status**: no regression attributable to these changes. Failures present before and after: 30 `restyle-v3-parity` cases, `frontend-consistency-phase-a/b/c`, `mobile-a11y` (2), `forms-feedback` (accessible names), `finance-compensation-plan` (2), `finance-guided-payroll`, `finance-payroll-commission-bonus`, `finance-payroll-runner-adjustments`, `finance-payroll-split`, `reports` (4), `finance-restyle-v2-contrast` (dark), `component-language` (btn-primary on the dashboard Review buttons), `employee-table-layout`, `shell-foundations` R3-3 (payroll runs list shows two solid buttons). A baseline run of the failing files on the pre-change commit failed 108 tests (many timeouts on the dev server); the current full run failed 72 with 15 flaky, and all the "new" ones re-passed in isolation.
