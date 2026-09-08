# 07 — UX Verification Checklist (Doubtful Items)

**Purpose:** This document lists items from the wide UI/UX review (2026-09-08) that could not be confirmed from commit metadata/file-size deltas alone, because the reviewing tool has no direct source-code read access to this repository (structural/statistical inference only — see note at bottom). Each item below is written as a mechanical, checkable question. Run through this with direct repo access (local clone, IDE, or a coding agent) and mark each Yes/No/Partial with the evidence found.

**How to use:** For each item, open the listed file(s), search for the listed pattern/evidence, and record the answer plus a one-line note (e.g., a line number, a counter-example, or "confirmed"). Do not skip an item because it "seems likely" — that's exactly the assumption this checklist exists to remove.

---

## 1. Token audit (Item 1 of `06-ux-next-level-implementation-plan.md`)

**Question:** Do `employees.js`, `insurance.js`, and `dochub.js` (plus their sections in `index.html`/`styles.css`) use tokens from `docs/ui-design/tokens.md`, or do they still contain hardcoded color/spacing/radius values that duplicate a token?

**How to check:**
- [ ] Open `docs/ui-design/tokens.md` and list every defined token (colors, spacing scale, radius, font sizes).
- [ ] Search `fe/public/js/employees.js` for hex codes (`#[0-9a-fA-F]{3,6}`) or inline style strings — flag any that match a token's value but aren't written as a `var(--token-name)`.
- [ ] Repeat for `fe/public/js/insurance.js` and `fe/public/js/dochub.js`.
- [ ] Search the corresponding CSS rules in `fe/src/styles.css` (selectors related to employee cards, insurance claims, document hub) for the same pattern.

**Answer:** [ ] Yes, fully tokenized  [ ] Partial — list files/rules still hardcoded  [ ] No

---

## 2. Mobile responsiveness (Item 5 of `06-ux-next-level-implementation-plan.md`)

**Question:** Does `fe/src/styles.css` contain `@media` breakpoints (e.g., around 768px or 375px) that adjust the navigation, employee table/list, and modals for narrow viewports?

**How to check:**
- [ ] Search `fe/src/styles.css` for `@media` — count how many exist and what breakpoints they target.
- [ ] For each of the three flows (employee detail view, leave request submit/approve, insurance claim view), open the app at a 375px-wide viewport (browser dev tools device toolbar) and check for horizontal scrolling or clipped/overlapping elements.
- [ ] Check whether the main nav/sidebar collapses to a hamburger or bottom-nav pattern below the breakpoint, or just shrinks/overflows.

**Answer:** [ ] Yes, responsive and verified at 375px  [ ] Partial — some flows work, list which don't  [ ] No `@media` rules found

---

## 3. Motion/transition layer (Item 6 of `06-ux-next-level-implementation-plan.md`)

**Question:** Do modal open/close and approve/reject status changes have a CSS transition (150–250ms), and is `prefers-reduced-motion` respected?

**How to check:**
- [ ] Search `fe/src/styles.css` for `transition:` properties on modal-related classes (search for `.modal`, `.overlay`, or whatever class the centralized modal system uses).
- [ ] Search for `prefers-reduced-motion` in `fe/src/styles.css` — confirm it exists and actually wraps/disables the new transitions, not just present decoratively.
- [ ] Manually open/close three different modals (Add Employee, Insurance Claim, Document Hub) and visually confirm a consistent transition, not just on one.

**Answer:** [ ] Yes, present and consistent  [ ] Partial — present on some modals only  [ ] No transitions found

---

## 4. Empty/loading state standardization (Item 3 of `06-ux-next-level-implementation-plan.md`)

**Question:** Do all seven modules (`employees.js`, `insurance.js`, `invoices.js`, `vacations.js`, `requests.js`, `dochub.js`, `salary.js`) call the same shared helper function(s) in `ui.js` for loading/empty states, rather than each rendering bespoke markup?

**How to check:**
- [ ] Open `fe/public/js/ui.js` and confirm a shared function exists (e.g., `renderLoadingState`, `renderEmptyState`, or equivalently named).
- [ ] Search each of the seven module files for a call to that shared function.
- [ ] Flag any module that instead has its own inline loading/empty markup (e.g., a hardcoded "Loading..." string or spinner div not routed through the shared helper).

**Answer:** [ ] Yes, all 7 modules use the shared helper  [ ] Partial — list which modules don't  [ ] No shared helper found

---

## 5. Typography scale in tokens

**Question:** Does `docs/ui-design/tokens.md` define a deliberate typography scale (font sizes/weights for headings, body text, captions, labels), or only color/spacing tokens?

**How to check:**
- [ ] Open `docs/ui-design/tokens.md` and check for a section on font sizes, font weights, or line heights.
- [ ] If present, check whether `fe/src/styles.css` heading/body/caption rules actually reference those values (as CSS custom properties) rather than ad hoc `font-size` declarations.

**Answer:** [ ] Yes, full typographic scale defined and used  [ ] Partial — defined but not consistently applied  [ ] No typography tokens exist

---

## 6. Dark mode support

**Question:** Is there any dark mode implementation (a `data-theme` attribute, a `prefers-color-scheme` media query, or a theme toggle)?

**How to check:**
- [ ] Search `fe/src/styles.css` for `prefers-color-scheme` or `[data-theme`.
- [ ] Search `fe/public/js/` for any theme-toggle logic.

**Answer:** [ ] Yes, dark mode exists  [ ] No dark mode found

---

## 7. Accessibility (a11y) baseline

**Question:** Does the centralized modal system include ARIA attributes, focus-trap, and Escape-to-close behavior?

**How to check:**
- [ ] Search `fe/src/index.html` modal markup for `role="dialog"`, `aria-modal`, `aria-labelledby`.
- [ ] Search the modal JS (likely in `ui.js` or `app.js`) for focus-trap logic (focus moved into the modal on open, returned to the trigger on close) and an `Escape` keydown listener.
- [ ] Tab through a modal with keyboard only — confirm focus doesn't escape to background page content while the modal is open.

**Answer:** [ ] Yes, ARIA + focus-trap + Escape all present  [ ] Partial — list what's missing  [ ] No a11y attributes found

---

## 8. Toast/notification consistency

**Question:** Do success/error messages (e.g., "Invoice generated," "Employee updated," validation errors) across all nine domains render through one shared toast/banner component, or does each module implement its own?

**How to check:**
- [ ] Search `fe/public/js/ui.js` for a shared notification/toast function.
- [ ] Search each domain module for direct DOM manipulation that shows a message (e.g., `innerHTML =` with a success/error string) instead of calling the shared function.

**Answer:** [ ] Yes, single shared pattern  [ ] Partial — list modules with their own implementation  [ ] No shared pattern exists

---

## 9. Print stylesheet for invoices/documents

**Question:** Is there a `@media print` rule set tailored to invoice or document views, separate from the normal screen styles?

**How to check:**
- [ ] Search `fe/src/styles.css` for `@media print`.
- [ ] If absent, confirm whether invoices are only ever viewed as generated PDFs (in which case a print stylesheet may be genuinely unnecessary) rather than also rendered for in-browser printing.

**Answer:** [ ] Yes, print styles exist  [ ] Not applicable — PDF-only, no in-browser print view  [ ] No print styles, but an in-browser print view exists without them

---

## 10. Single-file frontend architecture strain

**Question:** Has `index.html` (currently ~90KB) or `styles.css` (currently ~73.6KB) begun causing merge conflicts, slow editor performance, or difficulty locating styles/markup during recent work?

**How to check:** This one is a judgment call from whoever has been actively editing these files, not a grep — answer from direct development experience: has editing `styles.css` or `index.html` felt noticeably slower or more error-prone over the last few redesign passes?

**Answer:** [ ] No noticeable strain yet  [ ] Some friction, not yet worth restructuring  [ ] Yes, worth splitting into partials now

---

## Note on how this checklist was produced

This document was generated from GitHub commit metadata and file-size deltas (via directory listings and per-commit diff stats), not from reading the actual file contents — the connector used for this review returns file existence/size/SHA and commit-level statistics reliably, but does not return inlined source text for this repository. Every item above is phrased as a concrete, checkable question specifically because it could not be confirmed by inference alone, and needs someone with direct file access to answer conclusively.
