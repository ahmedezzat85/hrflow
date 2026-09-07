# 06 — UX Next-Level Implementation Plan

**Status:** Ready for implementation
**Branch:** `ui-ux-improve`
**Depends on:** `docs/ui-design/tokens.md` (added in commit `16d06a4`, "Vacations Page and requests are improved") — read that file first, every item below should use its tokens rather than introducing new ad hoc values.
**Companion doc:** `docs/roadmap/02-ux-ui-redesign-plan.md` (high-level backlog/ranking). This document is the granular, sequenced execution plan for the "next level" comments — implement from here, not from `02-...` directly.

## How to use this document

Each numbered item below is an independent unit of work with its own scope, target files, and acceptance criteria. **Complete and verify one item fully before starting the next** — do not batch multiple items into a single change. If an item turns out to require touching a file outside its listed scope, stop and reassess before proceeding, rather than expanding scope silently.

---

## 1. Token audit and backfill (do this first — everything else depends on it)

**Why first:** `docs/ui-design/tokens.md` was extracted from the vacations/requests redesign. The three earlier-redesigned modules (`employees`, `insurance`, `dochub`) predate the tokens file and were never verified against it. If later items build on top of inconsistent tokens, the inconsistency compounds.

**Scope:**
- Read `docs/ui-design/tokens.md` in full.
- Audit `fe/public/js/employees.js`, `fe/public/js/insurance.js`, `fe/public/js/dochub.js`, and their corresponding sections in `fe/src/index.html` and `fe/src/styles.css`.
- Identify hardcoded colors, spacing, font sizes, or border-radius values in these three modules that duplicate a value already defined in `tokens.md`.
- Replace each hardcoded duplicate with the corresponding token/CSS custom property.

**Out of scope:** Do not change layout, structure, or behavior of these three modules — this is a token-substitution pass only, not a redesign.

**Acceptance criteria:**
- No hardcoded color/spacing/radius value remains in the audited files that has an exact or near-exact match in `tokens.md`.
- Visual output is unchanged (this is a refactor, not a redesign — a side-by-side screenshot before/after should look identical).
- Existing tests continue to pass unchanged.

---

## 2. Dashboard / charts.js overhaul

**Why:** `charts.js` (2.5KB) is the least-developed frontend module relative to how central a dashboard is to daily HR use. This is the highest-visibility, highest-impact item in this plan.

**Scope:**
- Target file: `fe/public/js/charts.js`, plus its rendering target(s) in `fe/src/index.html` and `fe/src/styles.css`.
- Build a dashboard/home view summarizing, at minimum:
  - Headcount (total active employees)
  - Pending approvals count (leave/vacation requests + insurance claims awaiting action) — pull from `requests.js`/`vacations.js`/`insurance.js` data sources already in use by those modules, do not duplicate data-fetching logic
  - Upcoming leave (next 7–14 days) if data is available from the vacations domain
- Use existing tokens from `docs/ui-design/tokens.md` for all styling — no new color/spacing values.
- Reuse the existing modal/card visual language already established in `employees.js`/`insurance.js`, do not invent a new visual style for this view.

**Out of scope:** Do not build new backend endpoints in this pass. If a needed aggregate isn't available from existing API responses, note it and stop — flag it as a backend dependency rather than adding new routes.

**Acceptance criteria:**
- Dashboard renders real data from existing API responses, not placeholder/mock data.
- No new hardcoded design values introduced.
- Page load performance is not materially degraded (no new synchronous blocking calls beyond what other pages already do).

---

## 3. Empty and loading state standardization

**Why:** Nine independently-evolved domain modules likely each implemented "no data" and "loading" states slightly differently. This is low-cost to fix and disproportionately affects perceived polish.

**Scope:**
- Audit `employees.js`, `insurance.js`, `invoices.js`, `vacations.js`, `requests.js`, `dochub.js`, `salary.js` for how each currently renders:
  - A loading/spinner state while data is being fetched
  - An empty state when a list/table has zero results
- Extract or confirm a single shared implementation in `fe/public/js/ui.js` (which already centralizes shared UI helpers) for both states — e.g. `renderLoadingState(container)` and `renderEmptyState(container, message)`.
- Replace each module's bespoke loading/empty markup with a call to the shared helper, passing a module-specific message where relevant (e.g., "No leave requests yet" vs. "No employees found").

**Out of scope:** Do not change the data-fetching logic itself, only the rendering of these two states.

**Acceptance criteria:**
- All seven modules listed above use the same shared helper functions from `ui.js` for loading and empty states.
- Each module's empty-state message is contextually appropriate (not a generic "No data" everywhere).
- No visual regression in any module's normal (non-empty, non-loading) rendering.

---

## 4. Global search / command palette

**Why:** At nine domains of breadth, jumping between an employee record, an invoice, and a claim currently requires multiple clicks through navigation. A single quick-jump entry point is a high-value, moderate-effort addition.

**Scope:**
- New capability, most naturally added to `fe/public/js/ui.js` (shared UI layer) plus a new small module if warranted (e.g., `fe/public/js/search.js`) and wiring in `fe/src/index.html`.
- Keyboard shortcut: `Cmd+K` / `Ctrl+K` opens a modal-style palette (reuse the existing modal system from the `ux-enhance` work, do not build a new modal pattern).
- Minimum viable scope for v1: search by employee name (most common lookup), returning a list of matches that navigate to the employee detail page on selection.
- Design with future extensibility in mind (searching invoices, claims, etc. later) but **do not implement those in this pass** — ship employee search only, structured so additional search sources can be added later without restructuring.

**Out of scope:** Full-text search across all domains, fuzzy matching beyond simple substring matching, search history/recency.

**Acceptance criteria:**
- `Cmd+K`/`Ctrl+K` opens the palette from any page in the app.
- Typing an employee name filters results live and selecting a result navigates to that employee's detail page.
- Palette closes on Escape or on selection, consistent with existing modal behavior.
- No performance issue when the employee list is at realistic scale (test with the current real employee count, not a synthetic tiny dataset).

---

## 5. Mobile responsiveness pass

**Why:** Every redesign to date reads as desktop-first. This debt compounds with every new screen built without responsive rules, so it should be addressed before the dashboard (item 2) and search palette (item 4) ship, if sequencing allows — otherwise those two new surfaces inherit the same gap immediately.

**Scope:**
- Target: `fe/src/styles.css` — add responsive breakpoints (suggest a single breakpoint around 768px for tablet/mobile as a first pass, refine later if needed) for:
  - The main navigation/sidebar (likely needs to collapse to a hamburger or bottom-nav pattern on narrow screens)
  - The employee table/list views (likely need to switch from table layout to stacked cards below the breakpoint)
  - Modals (should already be reasonably responsive if using the centralized modal system — verify, don't assume)
- Test against the three most-used flows: viewing an employee, submitting/approving a leave request, viewing an insurance claim.

**Out of scope:** A dedicated mobile app or PWA packaging. This is responsive web layout only.

**Acceptance criteria:**
- At a 375px-wide viewport (common phone width), the three flows listed above are usable without horizontal scrolling and without overlapping/clipped UI elements.
- Existing desktop layout is visually unchanged above the breakpoint.

---

## 6. Motion/transition layer

**Why:** Lowest-effort, highest perceived-polish item — do this last, once the surfaces it touches (modals, tables, dashboard) are otherwise finalized, so transitions are added to stable UI rather than UI still in flux.

**Scope:**
- Target: `fe/src/styles.css`, and `fe/public/js/ui.js` if any JS-driven state toggling needs a transition hook (e.g., adding/removing a class rather than instant show/hide).
- Add consistent, short (150–250ms) CSS transitions for:
  - Modal open/close (fade + slight scale, using the centralized modal system so this is a one-place change)
  - Status changes on approve/reject actions (e.g., a brief highlight/color transition on the affected row)
  - Table row insertion/removal if lists update without a full page reload
- Respect `prefers-reduced-motion` — wrap new transitions in a media query so users who've opted out of motion aren't affected.

**Out of scope:** Complex choreographed animations, page-transition animations between routes.

**Acceptance criteria:**
- Modal open/close has a visible but subtle transition, consistent across every modal in the app (verified by checking at least three different modals, e.g. Add Employee, Insurance Claim, Document Hub).
- `prefers-reduced-motion: reduce` disables the new transitions.
- No transition introduces a perceptible input-response delay (i.e., nothing feels sluggish).

---

## Suggested execution order

1. Token audit and backfill (§1) — foundation for everything else.
2. Empty/loading state standardization (§3) — cheap, contained, immediately visible improvement.
3. Mobile responsiveness pass (§5) — do before adding new surfaces (§2, §4) so they inherit responsive behavior instead of needing a second pass.
4. Dashboard/charts.js overhaul (§2) — highest-impact new surface.
5. Global search/command palette (§4) — second new surface.
6. Motion/transition layer (§6) — polish pass once surfaces are stable.

Reorder based on priority if needed, but keep items independent and complete each fully (including its acceptance criteria) before moving to the next.
