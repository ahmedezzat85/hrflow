# HRFlow Frontend Consistency Audit and Fix Plan

**Audited:** working tree of branch `ui/dual-rail-nav`, HEAD `9b77abbad8` ("style(payroll): redesign Payroll Settings..."), 0 uncommitted changes
**Date:** September 30, 2026
**Method:** static reading and code search through LocalFS (HTML partials, CSS, `fe/public/js`, `vite.config.js`, docs). Nothing was run in a browser or a test runner.
**Status:** findings and a proposed plan only. No repository change has been made or is authorized.

Evidence tags: **[code]** read directly; **[screenshot]** seen in the Payroll Settings screenshot; **[inferred]** follows from the code but not observed at runtime; **[verify]** needs a browser or test check before fixing.

---

## 1. Limits of this audit

- The code search tool caps results (60 in the widest search), so counts below are minimums, not totals. Phase 0 produces exact counts.
- Not checked: duplicate element IDs across partials, JavaScript business logic, the Employee portal beyond its sidebar, backend code, test quality, performance, right-to-left behavior.
- Visual claims come from source and one screenshot. Anything marked [verify] should be confirmed in the browser in light and dark themes.

---

## 2. Findings

### High severity

**F1 - Design tokens used but never defined [code]**
`tokens.css` defines `--accent`, `--text2`, `--surface2`, `--border` and others. The code also uses `--primary`, `--text-muted`, `--text-main`, `--text-primary`, `--bg-secondary` and `--border-color`. No definition of `--primary`, `--text-muted` or `--text-primary` exists anywhere in `fe/`.
- `--primary` appears at least 60 times across JS templates (`finance-reports.js`, `payroll-table.js`, `finance-invoices.js`, `finance-statements.js`), HTML partials (`finance-dashboard.html`, `finance-reports.html`, `bill-modal.html`, `finance-transfer-modal.html`, `finance-statement-upload-modal.html`) and `payroll.css:1361`.
- Where a fallback exists, the page shows a hard-coded blue (`#2563EB` in some files, `#3b82f6` in others). Neither is the brand accent `#2056e8`, and neither is theme-aware.
- Where no fallback exists, the declaration is invalid and silently drops. Examples: the statement wizard step number (`background: var(--primary); color:#fff`) gets no background; the bill modal alert (`border: 1px solid var(--primary)`) loses its border; `color: var(--text-muted)` inherits the body colour.

**F2 - Payroll section ignores the dark theme [code, inferred]**
`payroll.css` opens with `#a-finance-payroll { --accent:#2056e8; --bg:#f7f8fb; --surface:#fff; --text:#141e30; ... }`, re-declaring the light palette on the section element. Custom properties set on an element override inherited ones, so `[data-theme="dark"]` values from `tokens.css` never reach anything inside Payroll. No `[data-theme="dark"] #a-finance-payroll` override was found. Component-level dark rules such as `[data-theme="dark"] .payroll-settings-grid { background: var(--bg) }` resolve `--bg` to the light value. [verify] by toggling dark mode on the Payroll screens.

**F3 - Payroll settings field text is oversized [code, screenshot]**
`#a-finance-payroll input, #a-finance-payroll select { padding:7px 9px; border-radius:8px; font: inherit; ... }` has ID specificity, so it beats `.funding-form input` and `.month-form input`. The intended 13.5px text, 9px 13px padding and 10px radius never apply; text inherits about 16px.

**F4 - Module stylesheets leak into the whole app [code]**
All CSS is imported into one bundle (`styles.css`), and several module rules are unscoped:
- `payroll.css:113` redefines `.section-title` (17px, gap 9px) after `components.css:24` defines it (18px, gap 10px). `payroll.css` loads later, so every page using `.section-title` gets the payroll version. `payroll.css:354` adds a third variant.
- `payroll.css` has a bare `label` rule (10.5px, uppercase, bold) plus `.field label`.
- `payroll.css:1590` defines `.btn-ghost` globally, plus unscoped `.form`, `.form.two`, `.stats`, `.grid`, `.title-row`.
- `login.css:177` defines `.btn-primary` globally, so a login rule styles Payroll buttons (Payroll then re-overrides it under `#a-finance-payroll .btn-primary`).

**F5 - Icon that cannot render [code, screenshot]**
`finance-payroll.html:668` uses `fa-shield-check`, which is not in Font Awesome Free 6.5.1 (the version loaded in `index.html`) as far as I know. The blue callout in the screenshot shows no icon, which fits. `fa-shield-halved` is used elsewhere in the same file.

**F6 - Attention-queue links to pages that do not exist [code, verify]**
The API/mock layer emits `target_route: "a-finance-transfers"` (`finance-api.js:5094`, `api/finance/dashboard-api.js:263`), and `finance-dashboard.js:494-498` also handles `a-finance-cheques` and `a-finance-statements`. No `.page-section` has those IDs (transfers, cheques and statements are panes inside `a-finance-accounts`). `showSection` only switches sections that exist, so the click may run the loader without changing the visible page. The new `ui.js:191` maps `a-finance-transfers` to `a-finance-banking`, which may partly address the highlight. [verify] by clicking a Transfers attention item in mock admin mode.

### Medium severity

**F7 - Missing page title [code]**
The `titles` map in `ui.js` has no entry for `a-employee-detail`, so navigating there leaves the previous page's title and subtitle in the topbar.

**F8 - Two visual dialects for forms and buttons [code]**
- Forms: `.form-field` / `.form-control` / `.filter-select` (modals and toolbars; 13-13.5px controls, 38-40px height) versus payroll's `.field` inside `.funding-form` / `.month-form` (42px height, 1px border versus the modals' 1.5px).
- Buttons: `btn-fill` and `btn-outline` across the app versus `btn-primary` and `btn-ghost` in Payroll and Login.

**F9 - Hard-coded colors that bypass theming [code]**
`payroll.css` `.p-banner-blue/green/red`, `.exception-row-flag { background:#fef2f2 !important }`, `.retry-btn { background:#fff }` and modal fallbacks use fixed light colors. Purple (`#9333ea`, `#7c3aed`) is used for the tax card with no token. JS templates use `rgba(37,99,235,...)` and `#F8FAFC` literals.

**F10 - Inline styles and inline handlers are pervasive [code]**
Partials and JS templates carry large `style="..."` blocks (for example `bill-modal.html`, `finance-reports.js`, `payroll-table.js`) and `onclick=` attributes, including `href="javascript:void(0)"` (`finance-dashboard.js:830`). Theming cannot reach them, styles drift between copies, and a strict Content-Security-Policy would be impossible.

**F11 - Accessibility gaps in the topbar [code]**
In `topbar.html`, the notification bell and theme toggle have no accessible name, the export and search buttons rely on `title` only, and the hamburger has no `aria-label`. The bell always shows a red dot regardless of unread state.

### Low severity

**F12 - Duplicated and dead CSS [code]**
- `.sidebar.collapsed` rules exist in both `layout.css` (~293-395) and `components.css` (~785-875); only the Employee sidebar still needs them.
- `.payroll-hidden` is defined twice at the end of `payroll.css`, with duplicated `@media (max-width: 640px)` blocks.
- Prototype-era classes such as `.payroll-topbar`, `.payroll-nav-links`, `.payroll-brand` likely have no remaining users. [verify] with a usage grep.

**F13 - Breakpoint sprawl [code]**
Media queries use 640, 768, 900, 940 and 1200px (plus the new nav CSS at 900px), with no shared documentation of which is which.

**F14 - Generated file is tracked [code, inferred]**
`fe/finance-api.js` (about 322 KB) is assembled from `fe/api/finance/*.js` by `scripts/assemble-finance-api.js` every time the Vite config loads, yet it is tracked (`fe/.gitignore` lists only `config.js`, `node_modules/`, `dist/`, `test-results/`, `playwright-report/`). The same code exists in two places (`target_route` appears in both). This invites drift and noisy diffs after a build.

**F15 - Documentation contradicts the code and itself [code]**
- `AGENTS.md` says Google Sheets is the data store and Google Sign-In the identity source; the project documents say SQL is the persistence layer and Sheets is export-only.
- `00-project-start-here.md` still cites an older `main` commit and describes D-006 as an open conflict; PR #22 has since merged.
- A comment in `vite.config.js` says it inlines "11 classic app scripts" while `APP_SCRIPT_ORDER` lists roughly 30.

---

## 3. Fix plan

Each phase is an independent commit series, needs owner approval before starting, and follows the branch-intake and reporting rules already in force. No commit or push without approval.

### Phase 0 - Baselines (no code change)

1. Run `cd fe && npm run build`, then the full UI suite once; save results outside the repo.
2. Produce exact counts: undefined CSS variables, inline `style=` occurrences, `!important` occurrences, `onclick=` occurrences, unscoped selectors in `payroll.css` and `login.css`.
3. Capture light and dark screenshots as the before-set: Payroll (all three views), Finance dashboard, Reports, Bill modal, Statement wizard, Finance Settings.

### Phase A - Tokens and safe fixes (highest value, lowest risk)

- **A1** Add alias tokens in `tokens.css` `:root`: `--primary: var(--accent)`, `--text-muted: var(--text2)`, `--text-main: var(--text)`, `--text-primary: var(--text)`, `--bg-secondary: var(--surface2)`, `--border-color: var(--border)`. Every existing usage then resolves to the brand palette in both themes. Expected visible effect: fallback blues shift to the brand blue, and previously invalid declarations start applying. Review the Phase 0 screen list.
- **A2** Delete the hard-coded token block on `#a-finance-payroll`. Its light values equal `tokens.css`; confirm no token in it differs before removing.
- **A3** Replace `fa-shield-check` with `fa-shield-halved` (or another Free icon).
- **A4** Add a `titles['a-employee-detail']` entry.
- **A5** Add a guard script, for example `fe/scripts/check-css-vars.js`, that lists variables used but not defined and fails the build. This prevents F1 from recurring.

Acceptance: the guard reports zero undefined variables; Payroll renders correctly in dark mode; the screen list is visually reviewed in both themes; targeted specs pass.

### Phase B - Payroll Settings form and header (already specified)

- Scope corrective rules to `#a-finance-payroll .funding-form` / `.month-form` inputs and selects: 13.5px text, 9-10px 13px padding, 10px radius, 40px height, same border weight as the modals.
- Replace the hero with the standard `.section-title-group`; drop the Configuration pill and the "Back to payroll runs" button; keep a single Save/Cancel bar.
- Show masked account numbers as last four digits.

Acceptance: settings inputs match modal inputs in size in both themes; other payroll screens are visually unchanged.

### Phase C - Stop CSS leaking

- Scope payroll's `.section-title`, `label`, `.field label`, `.form`, `.grid`, `.stats`, `.title-row` and `.btn-ghost` under `#a-finance-payroll`, or rename them with a `payroll-` prefix.
- Scope login's `.btn-primary` under the login container.
- Owner decision: keep `btn-fill`/`btn-outline` as the shared button vocabulary and migrate Payroll and Login to it, or promote `btn-primary`/`btn-ghost` to shared components. Recommendation: keep `btn-fill`/`btn-outline`.

Acceptance: pages outside Payroll and Login look identical before and after, except where the leak was the cause (for example the Finance Settings title size).

### Phase D - Accessibility and dead links

- Give the bell, theme toggle, export, search and hamburger buttons `aria-label`; bind the bell dot to real state or remove it.
- Resolve F6: make attention-item routes for transfers, cheques and statements open the Banking page on the matching tab, and add a spec for it.

### Phase E - Debt reduction (schedule separately)

- Remove duplicate `.sidebar.collapsed` rules once Employee sidebar behavior is confirmed unaffected; dedupe the `payroll.css` tail; remove confirmed-dead prototype classes.
- Adopt a rule: no new inline `style=` or `onclick=` in new code; migrate the worst files first (`finance-reports.js`, `bill-modal.html`, `payroll-table.js`).
- Add a purple/tax-authority token and use it instead of literals.
- Document the breakpoint set and reduce it if possible.
- Decide whether `fe/finance-api.js` stays tracked; if not, ignore it and generate it in the build.
- Update `AGENTS.md` and `00-project-start-here.md` (only with approval).

---

## 4. Recommended order

1. Phase 0, then Phase A. It fixes the largest inconsistency (F1, F2) with a few lines and adds a guard.
2. Phase B, since the design is already agreed.
3. Phase C, then D.
4. Phase E as background work.

## 5. Decisions needed from the owner

1. Accept that the brand accent (`#2056e8`) replaces the two fallback blues everywhere (Phase A1).
2. Choose the shared button vocabulary (Phase C).
3. Decide whether `fe/finance-api.js` remains a tracked file (Phase E).
4. Confirm whether the documentation updates in Phase E may be made.
