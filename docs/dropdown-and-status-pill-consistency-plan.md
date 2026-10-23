# Dropdown and status-pill consistency plan

Branch: `ui/dropdown-and-status-pill-consistency` (from `main`). Standard change: frontend only, no API, schema or permission changes.

## Problems confirmed

1. The open list of a native `<select>` is drawn by the OS, so it does not follow the app theme (light or dark).
2. Several status pills use hardcoded light-theme colours instead of the shared `badge-pill pill-*` system: the Users "Active" pill (`system-access.js`), dashboard pills and delta chips (`app.js`), and two Finance statement badges (`finance-statements.js`).
3. The employee detail page mixes two pill vocabularies (`esc-pill`, `hv-pill-neutral` against `badge-pill`), uses hardcoded `rgba` icon tiles with teal repeated for three sections, defines `.iban-row` in two stylesheets, and has inline-styled note and empty-state markup.

## Scope

In: items below. Out: the app-wide rollout to the remaining ~160 selects, extending `lint:finance-tokens` beyond Finance, and the `finance-reports.js` / `payroll-table.js` / modal colour literals (separate cleanup).

## Design: custom dropdown (`hv-dropdown`)

- Progressive enhancement of a real `<select>` marked `data-hv-dropdown`. The select stays in the DOM (visually hidden but still rendered, so `page.selectOption`, `.value`, `change` events and form behaviour keep working).
- New file `fe/public/js/dropdown.js` (loaded after `ui.js` in `vite.config.js`), styles in `fe/src/styles/components.css` using tokens only (`--surface`, `--border`, `--brand-wash`/`--accent-soft`, `--ink-*`), dark mode through tokens, no colour literals.
- Behaviour: trigger button shows the selected label and chevron; popup is a `role="listbox"` with `role="option"` items, `aria-selected`, check mark on the selected row; keyboard (Enter/Space/Arrows/Home/End/Escape/type-ahead); outside click closes; popup flips above the trigger when there is no room below; trigger keeps the select's width/height classes.
- Stays in sync: `MutationObserver` on the select's options (several are filled by JS), `change` listener, and a `value` setter hook so programmatic `select.value = x` updates the label.
- A single initialiser scans for `select[data-hv-dropdown]` on load and when sections inject markup (`HvDropdown.init(root)`).
- Applied to: `#systemUsersFilter`, `#systemUsersRoleFilter`, `#fEmpDept`, `#fEmpIdType`, `#fEmpStatus`, `#fEmpEmploymentState`, `#fNoteCategory`.

## Design: status pills

- Users "Active" and "Archived": use `statusPill`-style markup (`badge-pill pill-success` / `pill-neutral` with `hv-dot`).
- Dashboard pills and delta chips (`app.js`): map to `badge-pill` with `pill-success` / `pill-warning` / `pill-neutral`.
- Finance statements Outflow and Exception Override badges: `pill-danger` / `pill-warning`.
- Employee header and Employment pill: `statusPill()`; gains On leave and Suspended tones.
- `statusPill`: add `Inactive` (neutral tone with muted dot) so it matches the list filter.
- Bank and social-insurance cards: `hv-pill-neutral` becomes `pill-neutral`.

## Design: employee detail page

- Icon tiles: green and teal move to tokens; one tint per section (compensation green, leave teal, claims sky, insurance ochre, documents ochre-alt/blue as in the mocks) using the existing `--id-*` tokens.
- Remove duplicate `.iban-row` rules from `employees.css`; keep the `hr-v3.css` definitions; add the missing card spacing.
- Notes: replace inline icon colour strings with `.ed-note-ic--{tone}` classes; footer uses `--ink-muted` 12px.
- Employee list rows and the empty-state strings: replace inline styles with the existing `hv-sub-line` / muted classes.

## Compatibility and risk

- Element IDs and `value`/`change` semantics are preserved, so `rbac-system-pages.spec.js` and `truthful-screens.spec.js` keep working without changes to their selectors.
- `form-controls.spec.js` reads `getComputedStyle(#fEmpDept/#fNoteCategory)`; it will be updated to assert the new trigger instead of the native chevron.
- No backend change, no mock-state change (the pages already render in `?mock=admin`).

## Test plan

- New `fe/tests/ui/hv-dropdown.spec.js`: opens/closes, selects by click and keyboard, syncs label after `selectOption` and programmatic value, dynamic options (role filter), dark theme has no light background, Escape returns focus.
- Update `form-controls.spec.js` for the enhanced selects.
- Assert in specs that the Users Active pill and the employee header pill use `badge-pill pill-success` (no inline hex).
- `npm run build` in `fe/`, then targeted Playwright specs (system pages, truthful screens, form controls, employee detail/personal details, component-language, restyle-v3-conformance), then one final regression run.

## Steps

1. Branch and plan (this document).
2. Status pill fixes.
3. Dropdown component and styles.
4. Apply the dropdown to the listed selects.
5. Employee detail cleanup.
6. Specs, build and tests.
7. Commit and push.
