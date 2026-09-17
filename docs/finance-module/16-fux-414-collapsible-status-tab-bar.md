# FUX-414 — Collapse the Bills status tab bar into a status pill + on-demand panel

Related: `docs/finance-module/14-fux-412-collapsible-bill-filters.md` (secondary filter panel — already implemented, different control), FUX-401 AP inbox and capture (status queues: Inbox, Needs Coding, Needs Approval, Ready to Pay, Scheduled, Paid, Exceptions), Bills page toolbar

**Confirmed direction:** Variant A from the reviewed prototype (`bills-toolbar-prototype.html`, variant `#variant-a`). This is the exact and only approved layout — do not substitute the dropdown-select or horizontal-scroll variants shown as alternatives in that prototype.

**User story:** As a bills user, I want the row of status tabs (Inbox, Needs Coding, Needs Approval, Ready to Pay, Scheduled, Paid, Exceptions, All) hidden by default and shown only when I ask for it, so the page does not permanently show a wide tab bar I am not using.

## Scope clarification (do not confuse with FUX-412)

This story is about the **status tab bar only** — the row of pill buttons that switches between bill lifecycle views (Inbox/Needs Coding/Needs Approval/etc.). It is a separate control from the secondary filter panel (search/date/vendor filters) already collapsed under FUX-412, which is already implemented and must not be modified by this story. After this story ships, the Bills page will have two independent collapsible regions: the FUX-412 filter panel (unchanged) and the new status panel described here.

## Exact layout specification

Replace the current always-visible status tab row with exactly this two-part structure, stacked vertically, directly below the page toolbar and above the FUX-412 filter panel:

1. **Status toggle bar** (always visible, single row, ~40px tall):
   - Left side: a single pill showing the currently active status name and its live count, e.g. `Needs Approval  6`. This pill is not clickable/interactive — it is a label only.
   - Next to the pill: small muted text showing the result count for the current view, e.g. `Showing 6 of 34 bills`.
   - Right side: a single text button reading `Change view` with a small chevron icon, right-aligned. This is the only clickable control in this row responsible for expanding/collapsing the panel below.
2. **Status tabs panel** (hidden by default, toggled by "Change view"):
   - A horizontal row of pill buttons, one per status, each showing the status name and its live count exactly as they appear today (Inbox, Needs Coding, Needs Approval, Ready to Pay, Scheduled, Paid, Exceptions, All).
   - The currently active status tab is visually highlighted (existing active-tab style, unchanged).
   - Clicking any tab: (a) switches the active list view to that status exactly as today's tab-click behavior already does, (b) updates the status pill and count text in the toggle bar above to reflect the new selection, and (c) collapses the panel back to hidden state automatically after the click.
   - Clicking "Change view" again re-opens the panel without changing the current selection.

## Implementation-level detail (fixed, not open to interpretation)

- Do not remove, rename, or change the behavior of any existing status filter logic, counts, or API calls — this story only changes how the status tabs are *displayed and revealed*, not how filtering works.
- The panel's open/closed state is local UI state only (e.g., a boolean toggled on click); it does **not** need to persist across page reloads or be remembered per user — every fresh page load starts with the panel collapsed.
- Do not auto-expand the status panel on page load under any condition, including deep links. (This differs intentionally from FUX-412's filter panel, which does auto-expand on deep links — the status panel always starts collapsed because the active pill already communicates the current view.)
- Toggle interaction: clicking "Change view" toggles panel visibility with no animation requirement beyond a simple show/hide (a CSS transition is optional polish, not required for acceptance).
- Accessibility: the "Change view" button must have `aria-expanded` reflecting panel state and `aria-controls` pointing to the panel's element id. The panel itself needs no additional ARIA role beyond being a normal focusable region; tab buttons inside it keep their existing accessible names/counts.
- The status pill in the toggle bar must update immediately (no page reload, no flicker) the moment a tab selection changes, using the same count data already used to render the tab buttons — do not introduce a second/duplicate data source for the count.
- Visual styling (colors, spacing, pill shape) should reuse existing shared badge/pill and button styles already defined in the codebase's component stylesheet; do not introduce new one-off CSS classes duplicating existing pill/badge styles.
- Do not add a settings/preference to remember collapsed vs. expanded state for this panel — explicitly out of scope, unlike FUX-412's persisted preference.

## Acceptance criteria

- On page load, the status panel is collapsed; only the status toggle bar (active pill + count + "Change view") is visible.
- The active-status pill always shows the currently selected status name and its correct live count, matching what the corresponding tab would show if the panel were open.
- Clicking "Change view" reveals the full status tab row with all statuses and their counts; clicking it again hides the row without changing the current selection.
- Selecting a different status tab from the open panel: switches the list to that status, updates the pill/count in the toggle bar to match, and automatically collapses the panel.
- No existing status-filtering behavior, API calls, or counts change as a result of this story — only visibility/layout changes.
- The FUX-412 filter panel (search/date/vendor filters) continues to function exactly as before, unaffected by this change.
- "Change view" is keyboard-operable (Tab to focus, Enter/Space to activate) and exposes `aria-expanded`/`aria-controls` correctly.

## Verification plan

- Load the Bills page fresh: confirm only the toggle bar is visible (no full tab row), and the pill shows the correct default active status and count.
- Click "Change view": confirm the full tab row appears with all statuses and correct counts, matching current pre-change values exactly.
- Click a different status tab (e.g., switch from "Needs Approval" to "Paid"): confirm the list updates to that status, the toggle-bar pill updates to "Paid" with the correct count, and the panel auto-collapses.
- Click "Change view" again without selecting a tab: confirm the panel closes without changing the active status.
- Keyboard-only pass: Tab to "Change view", activate with Enter, Tab through the revealed tab buttons, activate one with Enter/Space, confirm the same behavior as a mouse click.
- Confirm the FUX-412 filter panel (independent of this change) still opens, closes, and filters correctly on the same page.
- Run/extend existing Bills Playwright suites (`finance-bills-inbox.spec.js`, `finance-bills-approval.spec.js`) to assert the new toggle-bar/panel structure instead of a permanently visible tab row, without changing any assertions about underlying filter/status logic.
