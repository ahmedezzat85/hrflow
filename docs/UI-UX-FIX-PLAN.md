# HRFlow UI/UX fix plan and coding-agent handoff

**Status:** Proposed, awaiting owner approval per slice
**Created:** 2026-10-04
**Source of findings:** `docs/REVIEW.md` (sections 3.4, 3.5, 3.6 and 8A). Finding IDs below (UX-nn, FE-nn, LIVE-nn, SEC-nn) refer to that file.
**Scope:** frontend presentation and interaction only. Backend, security and payroll-calculation fixes are separate work (REVIEW.md section 6, Phases 0–2).

---

## 1. Goal

Make HRFlow look and behave like one consistent, trustworthy application before the remaining backend work: one component language across HR, Finance and Payroll, truthful screens, working URLs, predictable forms and feedback, and usable phone layouts for everyday pages.

Target outcome: the scored areas in REVIEW.md section 3.6 for navigation, visual consistency, trust cues and mobile move from 4–6 to 8 or above.

## 2. Branch and baseline

| Item | Value |
| :--- | :--- |
| Working branch | `ui/ux-fixes` (owner creates it) |
| Required base | A commit that contains the RBAC work (`feature/rbac` @ `98d40dd` or later). The System pages, permission-gated navigation and `session.js` changes live there. If `main` does not yet contain it, branch from `feature/rbac`, not from `main`. |
| Review baseline | `feature/rbac` @ `98d40dd3768bd99a7f3ed6b34a16f0011ceab244` |

Every slice starts with a branch-intake block: branch, HEAD, merge-base with `main`, slice id, files in scope.

## 3. Ground rules for the coding agent

1. **One slice per pull request.** Do not start the next slice until the owner approves the previous one.
2. **Before coding each slice:** post the intake block, the verified current behaviour, the exact file list, and the acceptance criteria copied from this plan. Wait for the owner's go-ahead.
3. **Frontend only.** No changes under `be/` except where a slice explicitly says so (none currently do). If a UI fix needs a backend change, stop and report it.
4. **Stay vanilla.** No framework, no new runtime dependency, no change to the Vite build shape in these slices. (Build restructuring is a separate decision; see REVIEW.md section 5.)
5. **Do not rename or remove element ids, `data-page` values or global function names** unless the slice says so. The 64 Playwright specs and inline handlers depend on them.
6. **Use tokens.** Colours, radii, spacing and shadows come from `fe/src/styles/tokens.css`. No new hex colours and no new inline `style=` attributes. Run `node fe/scripts/check-css-vars.js`.
7. **Escape everything you touch.** Any template string you edit that interpolates data must use the shared escape helper introduced in slice U1. Do not add new inline `onclick` handlers that embed data in a string; use `data-*` attributes and a listener.
8. **Terminology (fixed):** "Salary payment doc(s)" for the HR document; "Sales invoice" for Finance; "Employee bank account" and "Company bank account", never a bare "Bank account".
9. **Do not decide open questions** in `docs/project-context/06-open-questions.md`. Do not edit `docs/project-context/*` without owner approval.
10. **Mock mode stays working** in these slices (the tests depend on it). Its removal from production builds is a separate slice (REVIEW.md FE-01).
11. **`fe/finance-api.js` is generated.** Edit `fe/api/finance/*.js` and run `npm run bundle:finance-api`.
12. **End every slice with a handoff:** outcome, files changed, tests run with exact results, anything unverified, follow-ups.

## 4. Verification for every slice

Run from `fe/`:

| Step | Command | Pass condition |
| :--- | :--- | :--- |
| Baseline (once, before U1) | `npx playwright test --reporter=line` | Record the list of failing specs. Local artefacts from 2026-10-03 suggest 17 tests were already failing; that list is the baseline, not a target. |
| CSS variables | `node scripts/check-css-vars.js` | No undefined variables |
| Build | `npm run build` | Succeeds; no "Missing partial" warnings |
| Regression | `npx playwright test --reporter=line` | No spec fails that passed in the baseline |
| New checks | the spec(s) named in the slice | Pass |
| Visual | screenshots at 1440px and 390px, light and dark, of every page the slice touches | Attached to the pull request |

Manual checks against the real backend are listed per slice; mock-mode tests alone are not sufficient evidence for slices U3, U6 and U8.

## 5. Slices

Sizes: S under a day, M 1–3 days, L more.

### U1 — Shell and foundations (M)

**Covers:** UX-01, UX-02, UX-03, UX-04, LIVE-07, part of SEC-02 (helper only).

| Change | Files |
| :--- | :--- |
| Show the page title. Remove the `display:none` on `.topbar h2, .topbar .sub`, and place title and subtitle at the left of the topbar on every page in both portals. Exactly one `h1` per view. | `fe/src/styles/layout.css:406-422`; `fe/src/partials/admin/topbar.html`; `fe/src/partials/employee/topbar.html`; `fe/public/js/ui.js` (`showSection` titles map) |
| Topbar no longer overlaps content: give it a solid surface background and bottom border (or make it non-sticky). | `fe/src/styles/layout.css` |
| Define the classes that are used but have no CSS: `btn-outline`, `hide-mobile`, and the `badge badge-*` family (`approved`, `pending`, `rejected`, `info`, `grey`, `warning`, `danger`, `success`, `neutral`, `primary`, `indigo`, `secondary`) plus `status-badge status-*`, all mapped to tokens. | `fe/src/styles/components.css`; reference `fe/public/js/finance-core.js:200-274` for the class names in use |
| Stop payroll CSS leaking: prefix every unscoped generic selector in the payroll stylesheet (`.btn`, `.btn:hover`, `.btn.sm`, `.btn-fill`, `.footer`, `.tag`, `.toggle`, `.muted`, `.external`, `.internal`, `.expand`, `.plus`, `.si`, `.tax`, and the rest) with `#a-finance-payroll`. Delete payroll's `.btn*` overrides so payroll uses the shared button. | `fe/src/styles/modules/payroll.css` (starts at `:434`) |
| "Add Transaction" in the topbar is shown only in the Finance module. | `fe/src/partials/admin/topbar.html`; `fe/public/js/admin-nav.js` |
| Add one shared helper `escapeHtml(value)` (escapes `& < > " '`) and `setText(el, value)` in `ui.js`. Make `FinanceFormat.escapeHtml`, `escapeHtml` in `finance-statements.js`, `_esc` in `finance-reports.js` and `escHtml` in `system-access.js` delegate to it. No call-site changes yet. | `fe/public/js/ui.js`; the four files named |

**Acceptance criteria**

1. Every admin and employee page shows its title in the topbar at 1440px and 390px, with the nav panel open or collapsed.
2. Scrolling any long page never shows content behind the topbar controls.
3. `document.styleSheets` contains rules for `.btn-outline`, `.hide-mobile` and every `badge-*` class listed. Finance Settings status renders as a coloured pill.
4. A button on HR Employees and a button on Payroll have identical computed radius, font size and padding for the same variant.
5. No selector in `payroll.css` matches an element outside `#a-finance-payroll` (check by temporarily loading only that file against an HR page).
6. "Add Transaction" is absent from the HR, Payroll and System topbars and present in Finance.
7. Only one `escapeHtml` implementation exists; the others call it.

**Tests:** new `fe/tests/ui/shell-foundations.spec.js` covering 1, 3, 4 and 6.

### U2 — One component language (M–L)

**Covers:** UX-24 (in part), UX-11 visual part, section 3.6 "visual polish".

| Change | Files |
| :--- | :--- |
| One primary button name. Keep `btn btn-fill` as primary; replace `btn-primary` and bare `btn-fill` uses. Document variants (primary, outline, ghost, danger, small) at the top of `components.css`. | `fe/src/partials/**`, `fe/public/js/*.js` (search `btn-primary`, `btn-fill`) |
| One badge vocabulary. Keep `badge-pill pill-*` for status across HR, Finance and Payroll; make `badge badge-*`, `status-badge`, `p-badge b-*`, `stage-badge`, `settings-pill` aliases with identical styling, then migrate call sites file by file. | `components.css`; `payroll.css`; `finance-core.js` (`statusBadge` helpers); `payroll-table.js`; `finance-payroll.js` |
| One table style. Same header typography, row height, hover and empty-row style for HR, Finance, Payroll and System tables. | `components.css`; `employees.css`; `payroll.css` |
| Type scale tokens: add `--fs-xs` to `--fs-2xl` to `tokens.css` and replace the 25 ad-hoc pixel sizes in the files touched by this slice. | `tokens.css`; touched CSS files |
| Remove inline `style=` and hard-coded hex colours from the three worst partials only: `finance-dashboard.html`, `finance-accounts.html`, `finance-reports.html`. Move them to classes. | those partials; a new `fe/src/styles/modules/finance.css` imported in `styles.css` |
| Dark theme: style native `select` elements; provide a light-on-dark variant for the Voyance logo; remove the horizontal scrollbar in the New Vendor Bill modal (LIVE-11). | `base.css`; `components.css`; `modals.css`; logo usage in sidebars |

**Acceptance criteria**

1. `grep -r "btn-primary" fe/src fe/public/js` returns nothing.
2. A "Paid" status looks the same on Bills, Sales invoices, Salary payment docs and Payroll.
3. Inline `style=` count: `finance-dashboard.html`, `finance-accounts.html` and `finance-reports.html` each below 20 (from 177, 184 and 441).
4. No hex colour outside `tokens.css` in files changed by this slice.
5. Dark theme: no white native controls on Finance Overview; logo legible; no horizontal scrollbar in the bill modal at 1440px.
6. Before/after screenshots for every page, light and dark.

### U3 — Truthful screens (M)

**Covers:** UX-08, UX-15, UX-23, UX-26, LIVE-01, LIVE-02 (display only), LIVE-03, LIVE-04, LIVE-05, LIVE-08, LIVE-10, LIVE-12.

| Change | Files |
| :--- | :--- |
| Remove hard-coded sample values from the employee portal ("Mar 2027", "+8%", "7 of 12 months", "Annual Bonus EGP 63,000", "Premium Family Care / Allianz Egypt") and the placeholder numbers in admin Insurance. Bind to data or show a neutral empty state. | `fe/src/partials/employee/sections/dashboard.html:18-28`; `salary.html:10-18`; `insurance.html:14-20`; `fe/src/partials/admin/sections/insurance.html:11-23`; `fe/public/js/app.js` |
| Salary and Raises "Total monthly payroll" uses the same currency as the rows (USD). | `fe/public/js/salary.js`; `fe/src/partials/admin/sections/salary.html` |
| EGP is displayed as "EGP 34,877.00", never a bare "£". One money formatter: route `fmtMoney`, `fmtUSD`, `FinanceFormat.formatMoney` and the local `formatCurrency` copies through a single function in `finance-core.js`. | `fe/public/js/finance-core.js:1374`; `finance-statements.js:16`; `finance-reports.js:2076,2156,2251,2326`; `finance-statutory.js:72,117`; `ui.js` |
| Payroll Runs list shows the saved status and saved net total of each run. | `fe/public/js/finance-payroll.js` (runs list render); `fe/api/finance/payroll-api.js` |
| Payroll screens 2, 4 and 5: the totals row and stat cards are computed from the same line values shown in the rows. Label net and gross explicitly where both appear. | `fe/public/js/finance-payroll.js`; `payroll-table.js` |
| A finalized or paid run is read-only on every step: the lock banner stays, completed steps stay marked complete, and Save Draft, Submit & Approve and add-bonus controls are hidden or disabled. | `fe/public/js/finance-payroll.js`; `payroll-cycle.js` |
| Replace internal wording: "Missing Bank Details (D-006)" → "Missing bank details"; "Warning (non-blocking D-006): … MISSING_BANK_DETAILS" → "Warning: bank details missing for N employee(s). Payment can still be recorded."; "INTERNAL RAIL" / "EXTERNAL RAIL" → "Internal salaries" / "External salaries". | `finance-payroll.js`; `payroll-table.js`; `finance-payroll.html` |
| Reword copy that claims capabilities that do not exist: "Confirm & Disburse Payroll" → "Confirm and record as paid"; "Funds released" → "Payroll recorded as paid"; "Clears domestic EGP net pay directly…" and "Overrides automatic market rate lookup" → neutral text about a manual rate; "Auto-generate Vendor Bill… on each renewal" and "Schedule Report Delivery" hidden or labelled "not yet available". | `finance-payroll.html:648,697`; `finance-payroll.js:1436,1476`; `finance-subscriptions.html:137`; `finance-report-modals.html:83` |
| Remove the "Visualizations in development" panel from Finance Overview. | `finance-dashboard.html` |
| Notification bell: remove from both topbars (wire-up is a later feature). | `admin/topbar.html`; `employee/topbar.html` |
| "Pending Requests Queue": default filter is Pending, or rename the heading to "Requests". Users role filter options come from the roles API. Add Employee internal salary starts empty. | `requests.html`; `requests.js`; `system-users.html:24-27`; `system-access.js`; `employee-modal.html` |

**Acceptance criteria**

1. Signed in as an employee with no data, the portal shows no invented figures or plan names.
2. No "£" appears anywhere; `grep -rn "£" fe/public/js fe/src fe/api` returns nothing.
3. For run 2026-09 on the real backend: the list shows "Finalized" and the same total the API returns; on screens 4 and 5 the totals equal the sum of the rows.
4. Opening step 2 of a finalized run shows the lock banner and no active edit or submit controls.
5. None of these strings appear in the UI: "D-006", "MISSING_BANK_DETAILS", "RAIL", "Funds released", "market rate lookup", "in development".
6. Only one money-formatting function is defined; the others call it.

**Manual check on the real backend is required** for criteria 3 and 4.
**Note:** this slice fixes how payroll figures are displayed. The underlying calculation defects (REVIEW.md FIN-01, FIN-02, FIN-09) remain until the backend payroll slices.

### U4 — Terminology (S)

**Covers:** UX-10, UX-11.

| Change | Files |
| :--- | :--- |
| HR page body, row action, modals and command palette say "Salary payment doc(s)", "Doc #", "Generate salary payment docs", "Regenerate doc". Export dataset label becomes "Salary payment docs". Employee field "Invoice ID" becomes "Payment doc ID". | `fe/src/partials/admin/sections/invoices.html:19,55,56,65`; `fe/public/js/invoices.js`; `ui.js:141`; `employees.js:20`; `fe/src/partials/modals/*invoice*` (HR ones: regenerate, bulk, period); `export-modal.html:24`; `employee-modal.html:95` |
| "Bank Account" labels gain "Employee" or "Company". | `employee-detail.html:122`; `bank-account-modal.html:6`; `bill-modal.html:290`; `finance-payroll.html:348,375`; `finance-statutory.html:159` |

**Acceptance criteria**

1. On the HR Salary payment docs page and its modals the word "Invoice" does not appear.
2. Every visible "bank account" label in the app is preceded by "Employee" or "Company" (Finance "Bank & Cash Accounts" tab becomes "Company bank & cash accounts").
3. Element ids and API field names are unchanged.

**Out of scope:** the backend export label in `be/routers/export.py:48` ("Contractor Invoices"). Report it as a follow-up.

### U5 — Forms and feedback (M)

**Covers:** UX-12, UX-13, UX-14, FE-03, FE-04 (button lock only), SEC-02 (call sites in files touched).

| Change | Files |
| :--- | :--- |
| Move the HR and System modals onto `FinanceForm` (inline field errors plus an error summary): employee, raise, compensation plan, bank account, on-behalf claim, on-behalf vacation, category, employee vacation request, employee claim, external user. Associate every label with its input (`for`/`id`). Use `type="email"`, `inputmode="decimal"`, `min="0"` where they apply. | `fe/src/partials/modals/employee-modal.html`, `raise-modal.html`, `compensation-plan-modal.html`, `bank-account-modal.html`, `behalf-*.html`, `category-modal.html`; `fe/src/partials/employee/sections/vacations.html`, `insurance.html`; `employees.js`; `salary.js`; `vacations.js`; `insurance.js`; `system-access.js` |
| Every destructive or irreversible action goes through `confirmModal` or `FinanceCommand.confirmAction`: delete employee document, delete note, delete insurance category, approve or reject claim, reject request (capture a reason), delete role, archive user, discard statement, delete rule. Replace all native `confirm()`, `prompt()` and `alert()`. | `employees.js:264,576`; `insurance.js:74,104`; `requests.js:104`; `system-access.js:492,719`; `finance-reports.js:592,932`; `finance-statements.js:2025,2037`; `finance-bills.js:1476`; `finance-accounts.js:2977`; `finance-payroll.js:919,1767,2186` |
| Toasts: set text with `textContent`; `role="status"` for success and `role="alert"` for errors; distinct error styling; errors stay until dismissed and have a close button. Payroll error banners do not auto-hide. `getEmptyStateHtml` escapes its message. | `ui.js:34,267-274`; `finance-core.js:8-16`; `finance-payroll.js:2153`; `components.css` |
| Shared `withSubmitLock(button, fn)`: disables the button and shows progress while the request runs. Apply to every save handler that lacks it, including bill payment, invoice payment, bill approval, bill schedule, vendor payment instruction, save report view, schedule report. | `ui.js` or `finance-core.js` (`FinanceCommand.lockSubmitButton` exists and is unused); `finance-bills.js:1284,1399,1452,1709`; `finance-invoices.js:647`; `finance-reports.js:550,805` |
| Employee document Preview button: replace the inline `onclick` that embeds `JSON.stringify` with `data-*` attributes and a delegated listener. Same for company documents and the regenerate button. | `employees.js:375`; `dochub.js:101,117`; `invoices.js:222,562` |
| Dropzones become real buttons or get `role="button"`, `tabindex="0"` and key handling. | `employee-document-modal.html`; `company-document-modal.html`; related JS |

**Acceptance criteria**

1. Saving an empty Add Employee form shows inline errors on name and email and a summary; no toast-only validation remains in the listed modals.
2. `grep -rnE "\b(confirm|prompt|alert)\(" fe/public/js` returns nothing.
3. A toast containing `<b>x</b>` shows the literal text.
4. Double-clicking Save Payment sends one request (check the network log).
5. Preview works for a document named `O'Brien "scan".pdf`.
6. Automated accessibility check (axe) on each changed modal reports no "form elements must have labels" violations.

**Tests:** new `fe/tests/ui/forms-feedback.spec.js`.

### U6 — URLs and navigation (M)

**Covers:** UX-05, UX-22, FE-12 (single navigation entry point).

| Change | Files |
| :--- | :--- |
| Hash routing `#/<module>/<page>[/<id>][/<step>]`. `showSection` becomes the single navigation entry point and updates the hash; a `hashchange`/`popstate` listener restores module, page, employee profile, account workspace, report, payroll run and step. Existing `#detail=type:id` drawer links keep working. | `ui.js` (`showSection`); `admin-nav.js:158-171`; `finance-nav.js:114-173`; `employees.js` (profile); `finance-accounts.js` (workspace); `finance-reports.js`; `finance-payroll.js` (`openRun`, step) |
| Remove the duplicate click handlers so one click triggers one loader. Add a sequence guard so a slower earlier load cannot overwrite a later one. | `ui.js:122-127`; `finance-nav.js:167-173`; `admin-nav.js` |
| Unknown or forbidden route: land on the first page the user may see, with a short message. | `ui.js`; `admin-nav.js` (`canSeeModule`) |
| Command palette: goes through `ModalController`; lists pages the user may open; Finance actions gated by permission; employee search hidden in the employee portal. | `search.js`; `command-palette-modal.html` |
| Employee sidebar links become buttons or get `href`. | `employee/sidebar.html` |

**Acceptance criteria**

1. Reload on any page, an employee profile, a report, and payroll run step 4 returns to the same place.
2. Browser Back and Forward move between visited pages inside the app.
3. A copied URL opened in a new tab (signed in) lands on the same page.
4. One navigation click produces one set of API calls (network log).
5. Existing specs that click `[data-page]` elements still pass.

**Tests:** new `fe/tests/ui/routing.spec.js`. Manual check on the real backend for criterion 1.

### U7 — HR tables and cross-links (M)

**Covers:** UX-20, UX-21, UX-09 (frontend part).

| Change | Files |
| :--- | :--- |
| Employees, Salary and Raises, Vacations, Insurance claims, Requests and Document Hub use `FinanceTable` for sort, filter chips and paging. Employee search really covers department. | `employees.js:9`; `salary.js`; `vacations.js`; `insurance.js`; `requests.js`; `dochub.js`; matching partials |
| Employee profile gains a "Payroll and payments" card: current compensation plan (link to the plan modal), salary payment docs for this employee, latest payroll lines when the viewer has payroll read permission. | `employee-detail.html`; `employees.js`; `salary.js` |
| Employee names in payroll rows link to the profile; the "missing bank details" badge links to that employee's bank section. | `payroll-table.js`; `finance-payroll.js` |
| Admin claim rows get a "View receipt" action using the existing document preview modal when a receipt exists. | `insurance.js:85-96`; `requests.js` |

**Acceptance criteria**

1. Each listed table sorts by clicking a header and pages beyond 10 rows.
2. Searching "Engineering" on Employees returns the Engineering staff.
3. From payroll screen 4, one click on a missing-bank row opens that employee's profile at the bank section, and Back returns to the run (needs U6).
4. An admin can open the receipt of a claim that has one.

**Dependency:** U6. **Backend note:** the receipt is currently stored as a data URL in the claim record (REVIEW.md SEC-12). Display it as it is; do not change storage in this slice.

### U8 — Payroll journey (M)

**Covers:** UX-06, UX-07, UX-17, FIN-10 (frontend part).

| Change | Files |
| :--- | :--- |
| "Export CSV" button on screens 4 and 5 calling `GET /api/finance/payroll/runs/{id}/export` through the authenticated download helper. Add the API client method. Delete the unused `payroll-cycle-bar.html` and the `exportToExcel`/`exportToPDF` code that targets it. | `finance-payroll.html`; `finance-payroll.js`; `fe/api/finance/payroll-api.js`; `fe/src/partials/admin/sections/payroll-cycle-bar.html`; `export.js:242,345` |
| Confirmation before recording payment: dialog shows totals, number of recipients and number with missing bank details. The action no longer silently submits, approves and finalizes; if the run is not finalized, the button is disabled with an explanation. | `finance-payroll.js:1441-1476` |
| "Submit & Approve" becomes two visible steps. Self-approval is sent only when the user ticks an explicit "I am approving my own submission" box, shown only to users holding both permissions. | `finance-payroll.js` (calls to `approvePayrollRun(id, true)`); `finance-payroll.html:204` |
| Bonus and commission entry uses inline validation, not `alert()`. `payrollRevertModal` goes through `ModalController`. | `finance-payroll.js:919`; `finance-payroll.html` |
| Phone layout: compact stepper ("Step 2 of 6" with a menu); runs list and the review and preview tables use card rows below 768px. | `payroll.css`; `payroll-table.js`; `finance-payroll.js` |

**Acceptance criteria**

1. From screen 4 of a run, Export downloads a CSV with one row per employee.
2. Recording payment always shows the confirmation; cancelling changes nothing (network log shows no POST).
3. A user without both permissions never sends `allow_self_approval=true`.
4. At 390px the runs list and screens 2 and 4 have no horizontal scroll and the worksheet starts within the first screen and a half.

**Manual check on the real backend is required** for 1–3, on a test run, not on a real period.
**Known limitation to state in the handoff:** the CSV totals double-count adjustments until backend fix FIN-02 lands.

### U9 — Phone layouts, touch targets, contrast and accessibility (M)

**Covers:** UX-16, UX-18, UX-19, UX-25, LIVE-09, section 8A corrections.

| Change | Files |
| :--- | :--- |
| Card layout below 768px for the tables that still scroll sideways: Salary and Raises (both tables), Salary payment docs, Document Hub, Insurance categories, Finance Overview tables. | `responsive.css`; matching partials (`responsive-card-table`, `data-label`) |
| Desktop: Sales and Banking tables fit their card at 1440px or scroll inside it; the Actions column is never clipped. | `finance-invoices.html`; `finance-accounts.html`; `components.css` |
| Touch targets at least 44px below 768px on Finance pages (Sales, Spend, Settings, Overview) and Salary. | `responsive.css`; `components.css` |
| Contrast: adjust `--text2`, `--text3` and the soft pill text colours so body and label text reach 4.5:1 in light and dark. | `tokens.css` |
| Statutory page: currency is a select defaulting to EGP; period uses `type="month"`; summary cards use the money formatter. One shared Spend tab bar partial instead of three copies. | `finance-statutory.html:213,225`; `finance-statutory.js`; `finance-bills.html`; `finance-subscriptions.html` |
| Delete dead duplicate panes and duplicate ids. | `finance-accounts.html:318-420,427-514`; `finance-accounts.js:870` |
| Focus-visible style on inputs; the closed mobile drawer is `inert`; breakpoints reduced to 640, 768, 1024 and 1280 in files touched. | `base.css`; `admin-nav.css`; `responsive.css` |

**Acceptance criteria**

1. At 375px no page has a table wider than the viewport (script check over all `data-page` routes).
2. At 375px fewer than 5% of visible controls are under 44px on any page.
3. All text token pairs pass 4.5:1 (list the computed ratios in the pull request).
4. `document.querySelectorAll('[id]')` has no duplicate ids on any page.
5. axe run on each page reports no "color-contrast" or "duplicate-id" violations.

## 6. Order and dependencies

| Order | Slice | Depends on | Size |
| :-- | :--- | :--- | :-- |
| 1 | U1 Shell and foundations | — | M |
| 2 | U4 Terminology | — | S |
| 3 | U3 Truthful screens | U1 | M |
| 4 | U2 One component language | U1 | M–L |
| 5 | U5 Forms and feedback | U1 | M |
| 6 | U6 URLs and navigation | U1 | M |
| 7 | U8 Payroll journey | U3, U5 | M |
| 8 | U7 HR tables and cross-links | U6 | M |
| 9 | U9 Phone, contrast, accessibility | U2 | M |

U4 and U3 come early because they are small and remove the most visible trust problems.

## 7. Out of scope here (tracked in REVIEW.md)

- Backend security, payroll calculation and ledger fixes (Phases 0–2).
- Removing mock mode from production builds and per-environment `config.js` (FE-01, FE-02).
- Build restructuring or any framework change (section 5 of REVIEW.md).
- Employee payslips page (roadmap Slice 4; FE-06). Until it is built, hide the "My Payslips" nav item in U3 if the owner agrees.
- Role-aware bootstrap for Finance-only and Payroll-only users (FE-05).
- Escaping every remaining `innerHTML` call site not touched by these slices (SEC-02); track the remaining count at the end of U5.

## 8. Owner decisions needed

| # | Decision | Affects |
| :-- | :--- | :--- |
| 1 | Base branch: `main` after merging `feature/rbac`, or `feature/rbac` directly | all slices |
| 2 | Hide "My Payslips" until it is built? | U3 |
| 3 | Remove the notification bell, or keep it as a later feature? | U3 |
| 4 | Final wording for the payroll payment action ("Confirm and record as paid" proposed) | U3, U8 |
| 5 | Should "Submit" and "Approve" be two separate clicks for a user who holds both permissions? | U8 |
| 6 | "Add Transaction" in the topbar: Finance only (proposed), or everywhere? | U1 |

## 9. Handoff prompt for the coding agent

Paste this at the start of each slice, replacing the slice id:

> You are implementing slice **U?** of `docs/UI-UX-FIX-PLAN.md` in the HRFlow repository (FastAPI backend in `be/`, vanilla HTML/CSS/JS frontend in `fe/` built by Vite). Read `AGENTS.md`, `docs/project-context/00-project-start-here.md`, section 3 of the plan (ground rules), section 4 (verification) and the slice itself. The findings behind the slice are in `docs/REVIEW.md` under the IDs the slice lists.
>
> First reply with: (1) a branch-intake block — branch, HEAD, merge-base with `main`; (2) the current behaviour you verified in code for each change in the slice, with file and line; (3) the exact list of files you will change; (4) the acceptance criteria copied from the plan; (5) anything in the slice that is unclear or would need a backend change. Then stop and wait for approval.
>
> After approval: implement only this slice. Frontend only. Do not rename ids, `data-page` values or global functions. Use tokens, no new inline styles or hex colours, no new dependencies, no framework. Edit `fe/api/finance/*.js`, not the generated `fe/finance-api.js`. Keep mock mode working. Use the shared `escapeHtml` for any data you interpolate.
>
> Finish with: outcome per acceptance criterion (met, not met, unverified), files changed, commands run with exact results (baseline versus now for Playwright), screenshots at 1440px and 390px in light and dark for each page touched, anything you could not verify, and follow-ups. Do not merge; open a pull request for the owner to review.

## 10. Definition of done for the whole plan

- All nine slices merged, each with its acceptance criteria met or an explicit owner waiver.
- No Playwright spec fails that passed in the baseline; the four new specs pass.
- A live walk-through as Super-Admin on the real backend at 1440px and 390px, light and dark, finds none of UX-01 to UX-26 or LIVE-01 to LIVE-12 still present (except items listed in section 7).
- REVIEW.md section 3.5 and 8A are annotated with the slice that closed each finding.
