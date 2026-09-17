# FUX-412 — Collapsible bill list filters

Related: `docs/finance-module/05-finance-ux-implementation-plan.md` (FUX-102 shared finance table), Finance → Spend → Bills page

**User story:** As a bills user, I want the filter panel hidden by default and expandable on demand, so the Bills toolbar stays compact and I am not forced to look at a full filter bar every time I just want to scan or search the list.

## Context

The Bills page currently renders its filter controls (status tabs, vendor/date/amount filters) inline in the toolbar as permanently visible elements, with no collapse/expand affordance. This is inconsistent with the collapsible filter-chip pattern already planned for the shared finance table in FUX-102, and it consumes vertical space on every visit regardless of whether the user needs to filter. Free-text search is used far more frequently than the secondary filters and should remain independently accessible.

## High-level scope

1. Collapse the secondary filter controls (status/date/vendor/amount filters and any filter chips) into a single disclosure panel, collapsed by default.
2. Keep the free-text search box always visible outside the collapsible region.
3. Show a compact toggle control with an active-filter count badge so users know filters are applied even while the panel is collapsed.
4. Persist the user's last collapsed/expanded preference across visits.
5. Automatically expand the panel when the page is reached with a non-default filter already applied (e.g., a deep link from the Needs-Attention queue), so an active filter is never hidden without the user's knowledge.

## Implementation level

- Wrap the existing filter controls in a collapsible container using the same disclosure/accordion pattern already used elsewhere in Finance (e.g., statement import steps), for consistent keyboard and ARIA behavior.
- Add a "Filters" toggle button adjacent to the search box; the button label shows an active-count badge, e.g. "Filters (2)", when one or more non-default filters are set.
- Wire `aria-expanded` on the toggle and `aria-controls`/`id` linking the toggle to the filter panel; ensure the panel is reachable and dismissible via keyboard (Enter/Space to toggle, panel content remains in normal tab order when expanded).
- Store the collapsed/expanded preference in local storage, scoped per user/browser; this is a UI preference only and does not require a backend change.
- On page load, read any incoming filter query params/deep-link state; if any filter differs from its default, force-expand the panel regardless of the stored preference.
- Ensure toggling the panel does not re-fetch or reset the currently applied filters or the list's scroll/sort/pagination state.

## Acceptance criteria

- Filters are collapsed by default on first visit and occupy a single compact row (toggle button + badge) instead of the current full filter bar.
- Clicking the toggle expands/collapses the panel without reloading the list or losing currently applied filter values.
- The toggle visibly indicates an active-filter count whenever one or more filters are non-default, even while collapsed.
- The toggle is operable via keyboard (Tab to focus, Enter/Space to activate) and announces its expanded/collapsed state to assistive technology.
- Deep links or navigation that arrive with filters pre-applied (e.g., from the Needs-Attention queue) show the panel expanded automatically on load.

## Verification plan

- Load the Bills page fresh (no stored preference): confirm filters render collapsed and the list shows the default view.
- Expand the panel, apply a filter, collapse the panel: confirm the toggle badge reflects the active filter count and the list remains filtered.
- Reload the page: confirm the collapsed/expanded preference persists and the active filter is still applied.
- Navigate to Bills via a Needs-Attention queue link carrying a filter parameter: confirm the panel auto-expands on arrival.
- Keyboard-only pass: tab to the toggle, activate with keyboard, confirm focus remains logical and the ARIA expanded state updates correctly.
- Run the existing Bills Playwright suite (`finance-bills-inbox.spec.js`, `finance-bills-approval.spec.js`) to confirm no regression in existing filter-dependent assertions after the layout change.
