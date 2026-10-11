# App-wide UI Restyle v3 (HR, Payroll, System, Employee Portal, App Shell)

Status: proposed, visual direction approved by owner 2026-10-11. Follows D-027 (Finance v2). Proposed decision: D-028.
Type: frontend only. No backend plan is needed (see section 9).

## 1. Intake (agent must restate at start)
Branch name, HEAD, merge-base with main, scope, docs read. Baseline: main @ 151e285 or later. If a different baseline, report and stop.
Read first: docs/project-context/01, 02, 04 (D-010, D-014, D-015, D-027), 05, 06; docs/finance-module restyle docs; docs/UI-UX-FIX-PLAN.md (U3).
Visual reference (source of truth for look): `docs/finance-module/mocks/restyle-v3/` (PNG + HTML). If this folder does not exist, STOP and ask the owner. Interim reference: review canvas "HR, Payroll & Settings Review" (v77).

## 2. Goal and hard limits
Apply the Finance v2 look to HR, Payroll, System and the employee portal, with one new app shell (module rail, sidebar, top bar) shared by every module including Finance.
Visual restyle only. Not allowed: changing any workflow, field, permission, API call, route, DOM id used by JS, or copy that carries meaning.
OUT OF SCOPE, must be byte-for-byte unchanged: login/sign-in page and `login.css`.
Keep: Bills UX; payroll policy (estimates vs portal-confirmed vs paid vs variance stay separate); missing employee bank details = visible flag, never blocks; "Employee bank account" vs "Company account" wording; row actions = one text button + up to three icon buttons, no "..." menu; D-010/D-015 (rail always visible, click opens landing page); D-014 (account menu top right with theme and sign out, visible bell, HR groups "People" and "Benefits & records"); UI-UX-FIX-PLAN U3 (My payslips = coming-soon state).

## 3. Approved design decisions
1. Rail, light theme: SOFT BLUE. bg `#e9eefc`, border-right `1px solid rgba(32,86,232,.10)`, idle icon/label `#4b5c92`, active tile bg `#ffffff` + color `#1a46bd` + shadow `0 1px 3px rgba(20,50,120,.10)`. Width 68, tile 56x54, radius 13.
2. Dark theme: NAVY, never near-black. Palette (map onto `[data-theme="dark"]` in tokens.css; keep the existing dark identity hues):
   page `#0b1634`; surface/sidebar `#101d44`; raised/input `#15275a`; subtle `#1b2f66`; line `#26396f`; rail bg `#0f1c42`, rail active `#1c3068` with `#9db8ff`; muted text `#9fb0dc`; group label `#7f90c0`; item `#c9d2e8`; title `#e9eeff`; brand `#3566ef` (active fill `rgba(53,102,239,.22)`, active text `#9db8ff`).
   The old values `#0f1117 #171a24 #1d2130 #2a2e3d #23273a` must not remain in dark rules of migrated screens. Finance dark mode adopts the same navy.
3. Sidebar/top bar/page chrome/dialogs/tables/pills/buttons: exactly the Finance v2 system (.fv): brand `#2056e8/#1a46bd/#e8eeff`; ink `#16245e #2b3a5c #4b5c92 #5d6b8f #8f9cc2`; canvas `#f4f6fd`; page buttons 32px, row buttons 28px with 30px borderless icons, dialog fields 36, dialog footer 34, top-bar icon 30. Sentence-case headers (no uppercase labels).
4. Topic colour of the area tile in the title (inside D-014 groups): people blue, salary green, leave and insurance teal, documents ochre, payroll runs violet, access pink, settings slate.
5. Employee portal: same shell, single "Me" module in the rail (plus admin modules for users who have them).
6. Styles move from the Finance-only `.fv` scope to an app-wide layer (`fe/src/styles/`), with ZERO visual change to Finance (pixel check against current Finance pages).

## 4. Screen inventory (mock names in the mocks folder)
Shell: Nav (light/dark), Nav-Variants, Shell-System, Rail-Options (reference only).
HR (9): HR-Dashboard, HR-Employees, HR-EmployeeDetail, HR-Requests, HR-Salary, HR-SalaryDocs, HR-Vacations, HR-Insurance, HR-Documents. Dark reference: HR-Employees-Dark.
Payroll (8): Pay-Runs, Pay-Run-Setup (1), Pay-Run-Review/Processing (2-3), Pay-Run-Preview (4), Pay-Run-Confirm (5), Pay-Run-Statutory (6), Pay-Settings. Note: file names Review/Processing map to the real screens in finance-payroll.html; follow the REAL screen content, never the mock's data.
System (2): Sys-Roles, Sys-Users.
Portal (6): ESS-Dashboard, ESS-Salary, ESS-Payslips (coming soon), ESS-Vacations, ESS-Insurance, ESS-Documents.
Dialogs (18): Dlg-*.
CONTENT RULE: mocks are a styling reference. Where a mock differs from the real page content, the real page wins. Known case: payroll step 5 contains only title + status badges, Internal/External salary cards, exceptions strip, Export CSV + Confirm and record as paid, and the results table only after disbursement. No employee table, no ledger table.

## 5. Slices (one branch, committed and pushed back to back, draft PR allowed; no worktrees)
Each slice: small, tests green, light AND dark checked, Finance unchanged. Commit message prefix `ui(v3):`.
- S1 Tokens and base layer: navy dark tokens, promote .fv rules to app-wide layer without Finance change. Evidence: Finance screenshots before/after identical in light; dark now navy.
- S2 App shell: rail (soft/navy dark), single sidebar component for all modules, top bar, area tile + group name in title. Files: `fe/src/partials/shell`, `admin/sidebar.html`, `admin/topbar.html`, `admin-nav.css`, `layout.css`, `admin-nav.js`, `finance-nav.js` (merge behaviour, do not change routing). Employee partials get the shell too. Login untouched.
- S3 HR part 1: dashboard, employees list, employee detail (+ their dialogs).
- S4 HR part 2: requests, salary and raises, salary payment docs, vacations, insurance, document hub (+ dialogs).
- S5 Payroll: runs list, six steps, settings (+ dialogs). Preserve all ids used by `payroll-cycle.js`, `finance-payroll.js`, `payroll-table.js`.
- S6 System: roles, users (+ dialogs).
- S7 Employee portal: six pages, coming-soon payslips.
- S8 Cleanup and docs: remove dead legacy CSS only if proven unused (grep + build + tests), update docs below.

## 6. Bugs fixed inside the slices (frontend only, minimal)
- `loadMyPayslips()` undefined -> replaced by coming-soon state (S7).
- Employees list prints "undefined" for next raise -> show "Not scheduled" (S3).
- Portal request timeline shows "undefined • 5 days" -> use the leave dates already in the data (S7).
- Salary payment doc history call unmocked in mock mode -> add mock response (S4).
- Monospace font in profile "Payroll and payments" card -> inherit app font (S3).
- User roles look selected (underlined highlighted links) -> plain role pills (S6).

## 7. Open items: do NOT fix, do NOT decide; report with evidence
1. Vacations balances show 0 entitled while profile shows 21 days.
2. Draft run total -$371.00 (mock data or sign error?).
3. Portal says no raise date while admin shows 24 Nov 2026.
4. Salary & Raises shows $0 rows.
5. Insurance categories empty while claims have categories.
If an item turns out to need a backend change, STOP and report; it becomes a separate plan.

## 8. Acceptance criteria and tests
- Every inventory screen and dialog visually matches its mock at 1440 width in light and dark (screenshots in `?mock=admin` and `?mock=employee`, saved under the PR notes, not committed unless asked).
- Login page diff is empty (`git diff main -- fe/src/partials/shell/login* fe/src/styles/modules/login.css`; confirm actual login file names first).
- No change to JS behaviour: diff of `fe/public/js` limited to nav files and the six bug fixes in section 6.
- No uppercase section labels; no "..." row menus; max 3 icons + 1 text button per row.
- Missing bank flag still visible and non-blocking.
- Run the existing backend and frontend test suites and the Vite build; report exact commands and results. Add or update a frontend test only where one already exists for the touched code.
- Dark: grep dark rules for the forbidden near-black values; none left.

## 9. Backend decision
No schema, API, permission or migration change is required: the work is CSS, HTML partials and minimal JS. No backend plan is produced. If any slice appears to need backend work, stop and ask.

## 10. Documentation updates (owner commits; agent drafts and shows diff, does not commit docs unless told)
- Decision log D-028 (draft below). Roadmap: new section "3E. App-wide UI Restyle v3" with S1-S8 and status. Open questions: add section 7 items 1-5. Handoff summary at the end of each slice and of the task.

D-028 draft:
"D-028 (2026-10-11): Apply the Finance v2 visual system app-wide (HR, Payroll, System, employee portal) with a new shared shell. Light rail is soft blue; dark theme uses navy variants, not black. Login unchanged. Visual restyle only; no backend change. Supersedes nothing; extends D-027; respects D-010, D-014, D-015."

## 11. Anti-drift rules for the implementing agent
1. Work only on this plan's branch; state branch, HEAD, merge-base first.
2. Do not add features, rename things, reorder menus, or change copy beyond what the mock shows.
3. Do not touch login, backend, migrations, or docs/project-context without being asked.
4. One slice at a time; after each: tests, light+dark check, commit, push, 5-line handoff.
5. If a mock and the real page disagree on content, keep real content and report it.
6. Any decision not written here: stop and ask; do not guess.
