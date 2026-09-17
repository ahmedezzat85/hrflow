# FUX-415 — Move table row density to a single global setting; remove per-page density controls

Related: `docs/finance-module/05-finance-ux-implementation-plan.md` (FUX-102 shared finance table — originally introduced the per-page Compact/Regular/Spacious control), every Finance list page currently rendering the density switcher (Bills, Invoices, Transactions, Vendors, Customers, and any other shared-table page)

**Confirmed direction:** Fully remove the per-page density switcher UI everywhere it currently appears, replacing it with exactly one control located in Finance Settings, as shown in the reviewed prototype (`bills-toolbar-prototype.html`, the "Density control" section below the variant switcher). Do not keep a per-page toggle "in addition to" the global one — the per-page control is deleted, not duplicated.

**User story:** As a finance user, I do not want a Compact/Regular/Spacious switcher cluttering every table's toolbar; I want to set my preferred row density once and have it apply consistently to every finance list in the app.

## Scope clarification

This story removes UI, it does not remove functionality: row density itself (compact/regular/spacious row height and padding) still exists and still works — only its *control surface* moves from N separate per-page toggles to exactly one setting. Any page currently rendering a density switcher in its toolbar (Bills, Invoices, Transactions, Vendors, Customers, and any others using the shared finance table component) must have that switcher deleted from its markup as part of this story, not just visually hidden.

## Exact specification

1. **Remove:** Delete the Compact/Regular/Spacious control from every page toolbar that currently renders it. Do not leave the markup present-but-hidden — remove it from the per-page template/component entirely.
2. **Add:** Add exactly one new control in **Finance → Settings → Display** (create this Display subsection if it does not already exist in Finance Settings), consisting of a single labeled row: "Table row density" with a 3-option segmented control (Regular / Compact / Spacious), matching the style shown in the prototype's `.segmented` control.
3. **Apply globally:** The selected density value must be read by every finance list page (Bills, Invoices, Transactions, Vendors, Customers, and any other shared-table consumer) at render time and applied as the row-height/padding class already used today (the existing compact/regular/spacious CSS classes are reused as-is — only the source of truth for which class is applied changes, not the classes themselves).
4. **Persistence:** The chosen density is a per-user preference, stored the same way other persisted user-level display preferences are already stored in this codebase (reuse the existing preference-storage mechanism; do not introduce a new storage pattern). It must survive page reloads and apply immediately on every finance list without requiring a full app reload once changed.
5. **Default:** If no preference has been set yet, default to "Regular", matching current default behavior.

## Implementation-level detail (fixed, not open to interpretation)

- Do not add a way to override the global density on a specific page (e.g., no "reset to page default" or per-page exception). One setting, applied everywhere, with no per-page override mechanism.
- Do not change the visual definition of compact/regular/spacious (row padding/font-size values) — reuse the existing CSS exactly as already defined; this story only relocates the control, not the visual design of the density levels themselves.
- The settings-page control must update all currently-open/rendered finance tables live if the user changes it and then navigates to another finance list in the same session — i.e., every table reads the current global value on its own render, rather than caching a stale value from when the session started.
- If any page-level component currently stores density as local component state, that state must be removed and replaced with a read from the shared/global preference source described above — do not leave two competing sources of truth for density.
- Accessibility: the segmented control in Settings must be operable via keyboard and expose the selected option via `aria-pressed` or equivalent selected-state semantics, consistent with other segmented controls already in the codebase.

## Acceptance criteria

- No Finance list page (Bills, Invoices, Transactions, Vendors, Customers, or any other shared-table page) renders a Compact/Regular/Spacious control in its own toolbar anymore.
- Finance → Settings → Display contains exactly one "Table row density" control with three options: Regular, Compact, Spacious.
- Changing the setting updates row density on every finance list page that uses the shared table component, not just the page the setting happens to be changed from.
- The chosen density persists across page reloads and across navigating between different finance pages in the same session.
- A user who has never changed the setting sees "Regular" density everywhere, matching current default behavior.
- No finance list page contains leftover dead code, hidden markup, or unused local density state after the per-page controls are removed.

## Verification plan

- Visually inspect Bills, Invoices, Transactions, Vendors, and Customers pages: confirm no density switcher appears in any toolbar.
- Open Finance → Settings → Display: confirm the single segmented density control is present and functional.
- Set density to "Compact" from Settings, then navigate to Bills, Invoices, and Transactions in the same session: confirm all three render with compact row height without further interaction.
- Reload the browser after setting "Spacious": confirm the preference persists and all finance lists still render spaciously after reload.
- Search the codebase for the removed per-page density control's markup/handlers to confirm no dead code remains on any page after removal.
- Run/update existing shared-table Playwright coverage (`finance-table.spec.js`) to assert density is read from the global setting rather than a per-page control, and add a new settings-page test confirming the control changes rendering on at least two different finance list pages within one test session.
