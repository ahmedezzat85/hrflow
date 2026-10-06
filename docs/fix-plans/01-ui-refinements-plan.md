# HRFlow UI refinements plan (approved designs of 2026-10-06)

**Status:** Scope and designs approved by the owner on 2026-10-06. Each slice still needs the owner's go-ahead before coding.
**Created:** 2026-10-06
**Source:** live read-only audit of the running app on 2026-10-06 (Super-Admin, about 1646px wide, dark and light), followed by owner review of mockups.
**Scope:** frontend presentation and interaction only. Correctness, security and backend items from the same audit are tracked in `docs/REVIEW.md` section 10, not here.
**Relation to earlier plans:** `docs/UI-UX-FIX-PLAN.md` (U1 to U9) is implemented on this branch and is not reopened. This plan adds what the owner approved afterwards.

---

## 1. Goal

Apply the four approved screens and the two message fixes without changing the app's structure, navigation, fonts or colour language.

The owner's standing design decisions for this plan:

| # | Decision |
| :-- | :--- |
| 1 | The app is not being redesigned. Layout, dual-rail navigation, Sora and Inter, the blue accent and the dark-first look stay. |
| 2 | **Colour stays.** Internal salaries are blue, external salaries green, warnings orange, tax purple. Do not reduce the palette. Each colour must mean the same thing wherever it appears. |
| 3 | **The Google sign-in button is not touched.** `#googleSignInButton`, `initGoogleSignIn` and the rendered Google button keep their current code and styling. |
| 4 | The "session expired" toast on the login screen is removed. |
| 5 | One button set and one set of form controls are used everywhere. |
| 6 | Both themes must match the mockups. |

## 2. Reference material

All in `docs/fix-plans/mockups/`. Open the HTML files in a browser.

| File | Shows |
| :--- | :--- |
| `01-login-dark.html`, `01-login-light.html` | Login page |
| `02-finance-overview-dark.html`, `02-finance-overview-light.html` | Finance Overview, top half |
| `03-payroll-step5-dark.html`, `03-payroll-step5-light.html` | Payroll run, step 5 |
| `04-controls-dark.html`, `04-controls-light.html` | Buttons, form controls, messages, status badges |
| `00-button-evidence-current-app.png` | Five crops of today's buttons, labelled A to E |

How to read the mockups:

- They are **visual references, not code to copy.** They use inline styles and literal colours for portability. The implementation uses `fe/src/styles/tokens.css` and shared classes.
- Amounts and names are samples.
- The grey box labelled "Existing Google sign-in button, unchanged" marks where the real Google button stays.
- "[VOYANCE HEALTH LOGO]" marks where the existing `voyance-health-logo.png` goes.
- Where a mockup and this plan differ, **this plan wins**.

## 3. Branch and baseline

| Item | Value |
| :--- | :--- |
| Working branch | `fix/review-ui-fixes` unless the owner names another at intake |
| HEAD when this plan was written | `745ee1f` |
| Merge-base with `main` | `a967a1a37d` |
| Note | Through a linked shell the working tree shows hundreds of files as modified with equal insertions and deletions. That is line-ending noise. Do not commit line-ending changes. |

Every slice starts with a branch-intake block: branch, HEAD, merge-base with `main`, slice id, files in scope.

## 4. Ground rules

The ground rules of `docs/UI-UX-FIX-PLAN.md` section 3 apply unchanged. The ones that matter most here:

1. One slice per pull request (or per commit group the owner approves). Stop after each slice.
2. Frontend only. No change under `be/`. If a slice needs a backend change, stop and report it.
3. Vanilla HTML, CSS and JS. No framework, no new dependency.
4. Do not rename or remove element ids, `data-page` values or global function names. The Playwright specs depend on them.
5. Tokens only: no new hex colour outside `tokens.css`, no new inline `style=`. If a mockup colour has no token, add a token in `tokens.css` for light and dark and use it. Run `node fe/scripts/check-css-vars.js`.
6. Use the shared `escapeHtml` for any data placed in a template string.
7. Terminology is fixed: "Employee bank account", "Company bank account" or "Company funding account", "Salary payment doc(s)", "Sales invoice".
8. Do not decide open questions in `docs/project-context/06-open-questions.md`. Do not edit `docs/project-context/*` or `docs/REVIEW.md`.
9. Mock mode keeps working.
10. Do not change which numbers the app computes or stores. This plan changes how things look and read.

## 5. Verification for every slice

Run from `fe/`:

| Step | Command | Pass condition |
| :--- | :--- | :--- |
| Baseline (once, before R1) | `npx playwright test --reporter=line` | Record the failing specs. That list is the baseline, not a target. |
| CSS variables | `node scripts/check-css-vars.js` | No undefined variables |
| Build | `npm run build` | Succeeds; no "Missing partial" warnings |
| Regression | `npx playwright test --reporter=line` | No spec fails that passed in the baseline |
| New checks | the spec named in the slice | Pass |
| Visual | screenshots at 1440px and 390px, light and dark, of every page touched, beside the matching mockup | Attached to the handoff |

**Before R1, confirm the running app is a fresh build of the branch HEAD.** The audit may have looked at an older build. If any item in this plan is already fixed at HEAD, say so in the intake and skip it.

## 6. Slices

Sizes: S under a day, M 1 to 3 days.

### R1. Messages (S)

**Mockup:** `04-controls-*.html`, "Messages" panel; `01-login-*.html`, the quiet line under the sign-in button.

| Change | Files |
| :--- | :--- |
| Remove the "Your session expired. Please sign in again." toast. | `fe/public/js/session.js:330` (handler for `hrflow:session-expired`, lines 318 to 332) |
| Show a quiet inline notice inside the login card instead, only when the user had a signed-in session in this page load. A first visit, a visit with no cookie, and a deliberate sign-out show nothing. Text: "You were signed out after a period of inactivity. Sign in to continue." Not a toast, not red, `role="status"`. | `fe/api.js:45-60` (`forceSessionExpiredLogout`) and `:96-101`; `fe/public/js/session.js` (`bootstrapAppFromSession`, the handler above, `logout`); `fe/src/partials/shell/login-screen.html`; `fe/src/styles/modules/login.css` |
| Employee profile, Social Insurance card and the other card that uses the same pill: when the request succeeds with no record, show "Not set up" with a "Set up" action. Keep "Could not load" only for a failed request, with a "Try again" action. | `fe/public/js/employees.js:692,829`; `fe/src/partials/admin/sections/employee-detail.html` |
| Error toasts name what failed. Replace bare server text such as "Not Found" with a sentence that names the screen or record, for the toasts raised by the Finance loaders touched in this slice. | `fe/public/js/finance-statements.js:67-68`; other `showToast(err.message` call sites in `fe/public/js/finance-*.js` (list them at intake; change only those where `err.message` can be a bare status text) |
| An error toast does not follow the user to another page: clear open error toasts on navigation. | `fe/public/js/ui.js:399` (`toast`), `showSection` |

**Verify first:** find out why a first visit dispatches `hrflow:session-expired`. The likely path is the bootstrap session probe returning 401 with `auth` true. Report the cause at intake.

**Acceptance criteria**

1. Opening the app in a fresh tab with no session shows the login screen with no toast and no notice.
2. Signing out with the menu shows the login screen with no notice.
3. Forcing a 401 on an authenticated request while signed in returns to the login screen with the quiet notice and no toast.
4. An employee with no social insurance record shows "Not set up"; a simulated 500 shows "Could not load" with "Try again".
5. A failed Statements load shows a message that names bank statements.
6. After an error toast appears, navigating to another page removes it.

**Tests:** new `fe/tests/ui/messages.spec.js` covering 1 to 4 and 6.

### R2. One set of form controls (M)

**Mockup:** `04-controls-*.html`, "Record statutory obligation" panel; `02-finance-overview-*.html`, filter bar.

The canonical control is the existing shared one (`select.form-control` and its input equivalents in `fe/src/styles/components.css:520-570`). Confirm the canonical class names at intake.

| Change | Files |
| :--- | :--- |
| Finance Overview filters (Entity, Period, Basis, Currency) and the Needs Attention filters and search render as standard controls. Today they compute to 16px high, Arial 13px, no padding, square corners. | `fe/src/partials/admin/sections/finance-dashboard.html:28,38,48,56,178,185`; `fe/src/styles/modules/finance.css:58-78` (`.fd-u11` to `.fd-u14`, `.fd-u38`, `.fd-u39`) |
| Record Statutory Obligation modal uses standard labels, inputs, selects and textarea. Today its controls are bare browser defaults. | `fe/src/partials/admin/sections/finance-statutory.html:185` onward |
| Report filter date inputs match other inputs (font, border, height). | `fe/src/partials/admin/sections/finance-reports.html:101,103,295` (`.fr-u25`, `.fr-u63`) |
| Dark theme: remove the zigzag texture on native selects (seen on the Notes category select on the employee profile and the Bills page-size select). Light theme is already clean. | find the rule at intake; `fe/src/styles/base.css`, `components.css` |
| Checkbox and its label sit together and click as one (Upload and Capture Vendor Bill modal: "Mark verified and reviewed" and "Bill is already paid" are detached from their boxes). | `fe/src/partials/modals/bill-modal.html` |

**Acceptance criteria**

1. On Finance Overview, each of the six selects and the search input has the same computed height, font family, border radius and padding as a select on the Reports filter bar, in light and dark.
2. Every control in the Record Statutory Obligation modal has the same computed font family, height and radius as the matching control in the Add Employee modal.
3. No native select in dark theme shows a background pattern.
4. Clicking the text of each of the two bill-modal checkboxes toggles its box.
5. Element ids and `onchange` handlers are unchanged.

**Tests:** new `fe/tests/ui/form-controls.spec.js` covering 1, 2 and 4.

### R3. One button set (M)

**Mockup:** `04-controls-*.html`, "Buttons" panel. Evidence of today's variation: `00-button-evidence-current-app.png`.

| Variant | Use | Look |
| :--- | :--- | :--- |
| Primary (`btn btn-fill`) | The main action of a screen or dialog. One per screen. | Solid accent, white text, **no glow** |
| Secondary (`btn btn-outline`) | Refresh, Export, Cancel, Preview, and row actions | Transparent, 1px border |
| Quiet | Low-stakes toolbar actions such as Reset | Text only, accent colour |
| Destructive (`btn-danger-outline`) | Delete, Archive | Red outline; always confirms |
| Disabled | Any of the above | Grey surface and grey text, never a faded accent |
| Small (`btn-sm`) | Inside table rows | Same shapes, 32px high |

| Change | Files |
| :--- | :--- |
| Remove the glow from the primary button. | `fe/src/styles/components.css:395-405` (`.btn-fill` `box-shadow`) |
| One corner radius for all buttons. Remove fully rounded pills on "Add Transaction" (topbar), "Reset Defaults", "Preview PDF" and similar. | `components.css` (`border-radius: 999px` rules near `:1071`, `:1384`); `fe/src/partials/admin/topbar.html`; the partials named at intake |
| Row actions are secondary by default. "Raise" in Salary and Raises, "Preview PDF" and "Generate" in Salary payment docs become secondary small buttons, so the page keeps one primary. | `fe/public/js/salary.js`; `fe/public/js/invoices.js`; matching partials |
| "Refresh" (filled dark) and "Reset Defaults" (outlined pill) use secondary and quiet. | `finance-dashboard.html` |
| Disabled primary looks disabled (Payroll step 6 "Confirm & Remit Payment" is a faded blue today). | `fe/src/styles/modules/payroll.css`; `components.css:387-393` |
| Document the variants in the comment at the top of `components.css`. | `components.css` |

**Acceptance criteria**

1. No button in the app has a box-shadow at rest.
2. All buttons of one size share one computed border radius (script check over every `data-page` route).
3. Salary and Raises, Salary payment docs, Finance Overview and Payroll Runs each show exactly one primary button at rest.
4. A disabled primary button's computed background is the neutral surface token, not the accent.
5. Screenshots of the five places in the evidence image, before and after.

**Tests:** extend `fe/tests/ui/shell-foundations.spec.js` with 1, 2 and 4.

### R4. Login page (S)

**Mockup:** `01-login-dark.html`, `01-login-light.html`.

| Change | Files |
| :--- | :--- |
| Left side: brand, the heading "People, finance and payroll operations in one place.", and three rows naming HR, Finance and Payroll with one line each. Remove the three feature tiles (`.visual-stats`) and the gradient and circle decoration. | `fe/src/partials/shell/login-screen.html`; `fe/src/styles/modules/login.css` |
| Right side: Voyance Health logo at the top, "Sign in", "Use your Voyance Health Google account.", then the existing Google button, then the notice slot from R1, then the existing "No access yet?" help line at readable contrast. | same |
| The page fills the viewport as two columns that stack on a phone. | `login.css`; `fe/src/styles/responsive.css` |
| Page title no longer says "HR Management System". Proposed: "HRFlow | Voyance Health". | `fe/src/index.html` |

**Must not change:** `#googleSignInButton` and its inline layout, `initGoogleSignIn`, `handleLoginSuccess`, `handleLoginError`, `#loginErr`, `#loginThemeToggle`, `#login-screen`.

**Acceptance criteria**

1. The login screen matches the mockups at 1440px and 390px in light and dark, except the Google button, which is pixel-identical to before.
2. `git diff` shows no change to the Google sign-in code paths.
3. Sign-in works against the real backend.
4. The strings "beautifully simplified", "Real-time Approvals" and "HR workspace" no longer appear.
5. Text on the page reaches 4.5:1 contrast.

**Manual check on the real backend is required** for 3.

### R5. Finance Overview (S to M)

**Mockup:** `02-finance-overview-dark.html`, `02-finance-overview-light.html`. Depends on R2 and R3.

| Change | Files |
| :--- | :--- |
| The cash card names its scope. With a currency selected it reads "Cash balance, USD accounts" and shows the other currency's total on a second line. It no longer says "All Accounts" over a figure that excludes EGP accounts. | `fe/src/partials/admin/sections/finance-dashboard.html`; `fe/public/js/finance-dashboard.js`; `fe/src/styles/modules/finance.css` |
| KPI card labels are sentence case, not all capitals, and the icon tile no longer overlaps the info icon ("Operating Expenses (MTD)"). Keep each card's colour. | same |
| Filter bar and Needs Attention row laid out as in the mockup (labels above controls, actions right-aligned). | same |

**Data rule:** use totals the page already loads (the accounts table on the same page lists per-account balances with currency). Do not add or change an API. If the per-currency totals cannot be derived from data already on the page, stop and report.

**Acceptance criteria**

1. With Currency = USD, the card label contains "USD accounts", and the EGP total shown equals the sum of the EGP rows in Banking.
2. No "All Accounts" label sits above a single-currency figure.
3. No overlap between any KPI icon tile and its label at 1280px, 1440px and 1646px.
4. Matches the mockup in light and dark.

### R6. Payroll step 5 (M)

**Mockup:** `03-payroll-step5-dark.html`, `03-payroll-step5-light.html`. Depends on R3.

| Change | Files |
| :--- | :--- |
| The two funding rows are labelled "Company funding account", not "Employee bank account". The placeholder values "Treasury Cash Vault" and "Operating Bank Wire Account" become a dash until data loads. | `fe/src/partials/admin/sections/finance-payroll.html:359,386` (and `#p5IntAccount`, `#p5ExtAccount` defaults) |
| The payments table shows one row per employee with External, Internal and Total paid side by side, plus an "Employee bank details" column. Today each employee appears twice with no label on which component a row is. Column headings and totals use the same blue and green as the cards. | `fe/public/js/finance-payroll.js` (step 5 render); `fe/public/js/payroll-table.js`; `fe/src/styles/modules/payroll.css` |
| Header statuses read as two plain chips: "Salaries paid" and "Statutory not recorded". Today the header shows "PAID" beside an unexplained "Not Recorded". Apply the same wording to the Payroll Runs list chip. | `finance-payroll.js`; `finance-payroll.html` |
| "Recorded as paid" on a paid run is a disabled button that states the date, not an active-looking primary. | `finance-payroll.js` |
| The lock banner reads "This run is finalized. Compensation and additions are read-only." | `finance-payroll.html` |
| The FX chip shows the rate and its source in one phrase. | `finance-payroll.js:2150-2170` |

**Out of scope for this slice, tracked in `docs/REVIEW.md` section 10:** which FX rate a finalized run displays (AUD-01), which funding account is stored and shown (AUD-02), and the amounts themselves. Display whatever the app provides today. Do not change `fx_rate_source`, the preview call or the account ids.

**Acceptance criteria**

1. The string "Employee bank account" does not appear anywhere in the payroll run screens.
2. Step 5 lists each employee once; External + Internal = Total paid on every row; the totals row equals the column sums and the two card amounts.
3. The header never shows "PAID" and "Not Recorded" side by side.
4. The missing-bank-details warning still appears and still does not block (D-006).
5. Colours: internal blue, external green, warning orange, unchanged in hue from today.
6. Existing payroll specs still pass; element ids `p5IntTotal`, `p5ExtTotal`, `p5IntAccount`, `p5ExtAccount`, `p5IntPayDate`, `p5ExtPayDate` remain.

**Manual check on the real backend is required** for 2, on the existing paid run, read-only.

### R7. Seen-live residuals (optional; needs a separate go-ahead)

These were visible in the running app on 2026-10-06 although earlier slices targeted them. Verify each against a fresh build first; fix only what is still present.

| Item | Where | Earlier slice |
| :--- | :--- | :--- |
| Finalized run: date fields, FX rate field and "Apply" look editable on step 1 | Payroll run, step 1 | U3 |
| Step 2 footer says "Step 1 of 2: submit this run for approval." on a paid run | Payroll run, step 2 | U3 |
| Sales and Banking tables clip the Actions column at 1440px to 1646px; New Sales Invoice line items scroll sideways | Sales, Banking | U9 |
| Salary and Raises table clips the row buttons | Salary and Raises | U9 |
| Statutory summary cards stack full-width, four deep | Finance, Statutory | none |
| Report URL stays on the first report when switching report tabs | Reports | U6 |
| Bank account modal: focus stays on the page behind, Escape does not close | Employee profile | U5 |
| Three date formats (`2027-01-01`, `01 Jan 2027`, `mm/dd/yyyy`) and EGP with and without separators | app-wide | U3 |
| Wording that implies bank transfer execution, bank feeds, OCR, sending or an authoritative tax calculator: "External Bank Wire", "External wire account", "Confirm & Remit Payment", "Feed:", "Document capture & OCR", "Approve & Send", "Tax Authority" and "Law 148" badges, "auto / fallback" | Payroll, Banking, Bills, Sales, Payroll Settings | U3; final FX wording waits on Q-004 |
| Raw value "OUTBOUND_TRANS" shown as a payment method | Banking ledger | none |

## 7. Order and dependencies

| Order | Slice | Depends on | Size |
| :-- | :--- | :--- | :-- |
| 1 | R1 Messages | none | S |
| 2 | R2 Form controls | none | M |
| 3 | R3 Buttons | none | M |
| 4 | R4 Login | R1 | S |
| 5 | R5 Finance Overview | R2, R3 | S to M |
| 6 | R6 Payroll step 5 | R3 | M |
| 7 | R7 Residuals | owner go-ahead | M |

## 8. Out of scope

- Anything under `be/`.
- All findings in `docs/REVIEW.md`, including section 10.
- Changing the palette, fonts, navigation or page structure.
- The Google sign-in button.
- Restricted-role views and phone layouts beyond the pages each slice touches.

## 9. Owner decisions still open for this plan

| # | Decision | Affects |
| :-- | :--- | :--- |
| 1 | Branch: continue on `fix/review-ui-fixes` or a new branch from its HEAD | all |
| 2 | Page title text ("HRFlow | Voyance Health" proposed) | R4 |
| 3 | Whether to run R7 | R7 |

## 10. Definition of done

- R1 to R6 delivered, each with its acceptance criteria met or an explicit owner waiver.
- No Playwright spec fails that passed in the baseline; the two new specs pass.
- A walk-through as Super-Admin on the real backend at 1440px and 390px, light and dark, matches the eight mockups, with the Google button unchanged.
