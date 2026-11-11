# UI token audit (static)

Scope: `fe/src/styles/**`, `fe/src/partials/**`, `fe/public/js/*.js` compared with `fe/src/styles/tokens.css`.
Method: static scan only (no pixel diff). The existing `lint:finance-tokens` checks only `finance-v2.css` and the lines added on the current branch, so everything below passes it today.

## A. The two screenshots

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Import tab (Finance > Settings): the two file inputs render as raw browser controls, with Arabic "تصفح..." button text and "لم تُحدد أي ملفات" | `finance-settings.html:188,193` use `class="fv-input"`, and **no CSS rule for `.fv-input` exists anywhere**. The only `::file-selector-button` rule is scoped to `#e-insurance` (`hr-v3.css:973-980`). The button text follows the browser locale, not the app. | Add one shared file-input style (dashed `--fv-outline` box, `--fv-surface-soft`, `::file-selector-button` in `--brand-ink`) and apply it to every file input. Set `lang="en"` on the field, or hide the native input behind a styled label, so the text is English. |
| 2 | Date inputs: the popup (blue day, red Sun/Sat, "Clear") is Chrome's native picker | The popup cannot be styled with CSS. Only the input box can, and its padding/height/border differ per module (see C). | Style the input boxes consistently, and `color-scheme` already follows the theme (`base.css:54-58`). To change the popup itself you need a custom datepicker, a product decision. |

## B. Systemic findings

1. **Colour literals outside `tokens.css`: 166 lines of CSS, 128 of JS and 85 of partials.** Worst CSS files: `components.css` 35, `login.css` 28, `payroll.css` 20, `finance.css` 15, `app-v3.css` 12, `admin-nav.css` 9, `dashboard.css` 8, `vacations.css` 7.
2. **Tailwind-palette colours in JS and partials that match no token** (counts): `#ef4444` 34, `#10b981` 26, `#e2e8f0` 24, `#2563eb` 19, `#f8fafc` 14, `#16a34a` 10, `#f59e0b` 9, `#dc2626` 7, `#d97706` 6, `#7c3aed` 6. They are not the token values (`--danger #b92424`, `--success #06703f`, `--warning #8f4a00`, `--purple #6d3fd0`). They also ignore dark mode.
   - `finance-reports.js` has 66 literal lines, `finance-statements.js` 18, `payroll-table.js` 16, `system-access.js` 11, `charts.js` 11.
   - `finance-cheque-modal.html` has hard-coded amber, red, green and violet callouts (`#fffbeb`, `#fef2f2`, `#f0fdf4`, `#f5f3ff`) instead of the existing `.fv-callout` variants.
   - `finance-reconciliation-modal.html` and `finance-statement-upload-modal.html` have the same problem.
   - `document-preview-modal.html:9` has `#1a1a1a`.
3. **Fallback-hidden literals.** `var(--x, #hex)` fallbacks are harmless while the token exists, but they hide drift. They appear in `payroll-table.js`, `finance-statements.js`, `bill-modal.html` and `responsive.css:410-413`.
4. **1,131 inline `style="` attributes in partials.** The largest are `finance-payroll.html` 180, `finance-reconciliation-modal.html` 129, `finance-statement-upload-modal.html` 101, `finance-report-modals.html` 68, `bill-modal.html` 57 and `finance-transfer-modal.html` 55. They carry raw px/rem sizes, radii (4, 6, 8, 12 px) and colours. No inline style can respond to the theme.
5. **Undefined or unstyled classes.** 135 classes are used in markup or JS and defined in no stylesheet. Most are JS hooks. These need a styling decision:
   - `fv-input` (A1)
   - `alert`, `alert-box`, `alert-info|warning|danger`, `alert-content`
   - `btn-success`, `btn-warning` (variants that do not exist)
   - `form-label`, `modal-title`, `modal-subtitle`, `modal-md`, `modal-v2-box`
   - `wizard-step`, `wizard-steps-bar`, `wizard-pane`, `step-num`
   - `card-header`, `card-footer`, `filter-group`, `warning-callout`, `pill-primary`
   - `text-primary`, `text-success`, `badge-role`, `badge-status`, `export-format-card`
6. **Per-module copies of the input style.** Height 36 / radius 9 / `--fv-input-border` is re-declared in `payroll-v3.css:76`, `hr-v3.css:142,968,972`, `finance.css:1050`. Finance reports use height 32 / radius 8 (`finance-v2.css:2303`) and employee pay analytics use height 36 / radius 8 with `--fv-line-strong` (`employee-pay-analytics.css:24`). That is why date and select boxes look different between pages.
7. **Unstyled native file inputs elsewhere:**
   - `finance-subscriptions.html:261` (`class="form-control"`) and `:378`
   - `finance-payment-type-modal.html:189`
   - `finance-statement-upload-modal.html:106` (inline padding only)
   - `finance-cheque-modal.html:125,258` (`fv-scan-input`, to verify)

## C. Type, radius and spacing
Not fully measured. Raw `px`/`rem` font sizes and radii (4, 6, 8, 9, 12, 14 px) sit beside `--fs-*` and `--radius-*`. The scale has no 9 px or 36 px control height, yet 9 px radius and 36 px height are repeated in many files. This needs either new tokens (`--control-h`, `--radius-input`) or consolidation onto the existing ones.

## D. Recommended closing plan
1. Add `.fv-file` / `input[type=file]` shared style and `--control-h`, `--radius-input`; fix `.fv-input` (fixes A1 and B6, B7).
2. Add token-based `.fv-callout` / badge variants and map JS and partial literals to them (B1-B4).
3. Define or remove the undefined classes in B5.
4. Extend `lint-finance-tokens.mjs` into a whole-repo lint (CSS, JS, partials, inline styles) with a ratcheting baseline, so new drift fails CI and the count can only fall. This is what closes the problem permanently.
5. Optionally verify visually with a Playwright pass over `?mock=admin` and `?mock=employee`, in light and dark.

Nothing here has been changed in code yet.

## Status (after PRs 140 and 141)
Done: date filters, file inputs, Finance colour literals, shared `.alert-box` / `.alert`, `btn-success` / `btn-warning`, `pill-primary`, `text-primary`, `text-success`, drift lint with baseline.
Left on purpose: classes that are fully styled inline and render correctly (`form-label`, `modal-title`, `modal-subtitle`, `modal-md`, `modal-v2-box`, `wizard-*`, `export-format-card`, `warning-callout`) and pure script hooks (`btn-*-rule`, `gt-*`, `payroll-*`). Convert them to shared classes only when those screens are next touched, with a visual check.
Open: about 1,100 inline `style=""` attributes; canvas chart palettes (`charts.js`); Arabic file-button text is browser-controlled.
