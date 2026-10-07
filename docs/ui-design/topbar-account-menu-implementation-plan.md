# Top Bar, Account Menu and Navigation Polish — Implementation Plan

**Status:** Approved scope (owner, 2026-10-05) — ready for autonomous implementation
**Branch:** `fix/review-ui-fixes` @ `10e7d66` (merge-base with `main`: `a967a1a`; branch is 35 commits ahead, 0 behind)
**Portals in scope:** Admin (dual-rail shell) **and** Employee
**Frontend root:** `fe/` (vanilla HTML/CSS/JS, Vite). No backend, schema, RBAC or API change.
**Visual reference:** the owner-reviewed mockup "HRFlow Sidebar Redesign" (before/after). Where this plan and the mockup differ, **this plan wins**.

Status labels used below: **Implemented / Partial / Planned / Open / Unknown**.

---

## 1. Purpose

1. Remove the duplicated user identity (two "AE" avatars) and the heavy logo footer from the sidebar.
2. Move the account menu to the top-right of the top bar (works on desktop and phone).
3. Make the top bar compact (~56 px) with an elegant, title-only page header.
4. Show a notification bell again (placeholder behavior until notifications exist).
5. Polish the admin navigation panel (labels, icons, active indicator, collapse chevron).

## 2. Verified baseline (read-only review, 2026-10-05)

| # | Fact | Status | Where |
|---|---|---|---|
| B1 | Admin shell is a dual rail: `#adminSidebar.dual-rail` = `.rail` (module buttons + avatar `#adminRailUserAvatar` + logout button) and `.nav-panel` (title, nav groups, `.sidebar-footer` with `.user-mini` and `.sidebar-brand-footer` logo images). | Implemented | `fe/src/partials/admin/sidebar.html` |
| B2 | Admin and employee top bars exist (`.topbar`): hamburger, `h1` title, `.sub` subtitle, `.top-actions` (admin: Add Transaction (Finance only), Export, Search, Theme toggle; employee: Search, Theme toggle). | Implemented | `fe/src/partials/{admin,employee}/topbar.html` |
| B3 | Employee sidebar has its own `.sidebar-footer`: `.user-mini` (`#empUserAvatar/#empUserName/#empUserRole`), `.logout-btn`, `.sidebar-brand-footer`. | Implemented | `fe/src/partials/employee/sidebar.html` |
| B4 | User identity is written by `app.js` (admin ~L43-48; employee ~L68-70) **without null guards** (`document.getElementById('adminUserName').textContent = …`) and by `session.js` mock data (admin ~L131-138; employee ~L180-185, null-guarded). Removing or renaming these IDs without replacement **will throw**. | Implemented (risk) | `fe/public/js/app.js`, `fe/public/js/session.js` |
| B5 | `logout()` is global (`session.js` ~L310) and is invoked via inline `onclick="logout()"`. | Implemented | `fe/public/js/session.js` |
| B6 | Theme: `applyTheme(theme)` sets `data-theme` on `<html>`, stores `localStorage['hrflow-theme']`, and syncs the moon/sun icon of `.theme-fab i, #adminThemeToggle i, #empThemeToggle i`. Click handlers are bound by ID to `loginThemeToggle`, `adminThemeToggle`, `empThemeToggle`. | Implemented | `fe/public/js/ui.js` ~L328-340 |
| B7 | Page subtitle is written by `showSection`: `document.getElementById(portal==='admin'?'adminPageSub':'empPageSub').textContent = t[1]` (titles map `[title, subtitle]`). Employee subtitle markup is hard-coded "Welcome back, Ahmed…". | Implemented | `fe/public/js/ui.js` ~L209-296; topbar partials |
| B8 | One existing test asserts the subtitle: `#adminPageSub` text on the employee-detail page. | Implemented (must be updated) | `fe/tests/ui/frontend-consistency-phase-a.spec.js` ~L97 |
| B9 | Mobile: drawer mode at `max-width: 768px` (admin: `admin-nav.css`; employee: `components.css`); `.hamburger` shown only ≤768; `toggleSidebar`, `closeAllSidebars`, `syncSidebarInert` exist. | Implemented | `ui.js`, `admin-nav.css` ~L393, `components.css` ~L849-915 |
| B10 | Top bar CSS: `padding: 14px 32px`; `.icon-btn` 42 px circle with border + shadow + hover lift; `.topbar h1` 20 px / 700 (`--font-head`); `.topbar .sub` 12.5 px. Estimated height ≈ 70 px (**estimate, measure in S0**). | Implemented | `fe/src/styles/layout.css` ~L406-495 |
| B11 | `.icon-btn .dot` (unread dot) CSS already exists. | Implemented | `layout.css` ~L490 |
| B12 | Design tokens: `--accent`, `--accent-soft`, `--accent-text`, `--bg`, `--surface`, `--surface2`, `--border`, `--border2`, `--text`, `--text2`, `--font-head`, `--shadow`, `--shadow-lg`. | Implemented | `docs/ui-design/tokens.md` |
| B13 | Logo images are copied to `dist/` by `vite.config.js` (casing fix `Voyance-health-logo.png` → `voyance-health-logo.png`). Keep that copy rule untouched. | Implemented | `fe/vite.config.js` |
| B14 | Repo files use **CRLF**. `git status` reports ~551 modified files that have **no content difference** once line endings are ignored (line-ending noise, not real changes). | Implemented (hazard) | working tree |
| B15 | Playwright: `fe/playwright.config.js` (`testDir: ./tests/ui`, baseURL `http://localhost:8080`, webServer `npm run dev -- --port 8080`, `channel: chrome`). Specs relevant to this work: `admin-dual-rail.spec.js`, `sanity.spec.js`, `routing.spec.js`, `frontend-consistency-phase-a.spec.js`. | Implemented | `fe/tests/ui/` |
| B16 | Collapse chevron (`.collapse-btn` in `.nav-panel`) may be clipped at the panel edge. | **Unknown** (inspect in S0/S6) | `admin-nav.css` |
| B17 | `#reqBadge` ("Pending Requests" count) already exists. | Implemented | `admin/sidebar.html` |

## 3. Owner decisions (2026-10-05)

| ID | Decision | Overrides |
|---|---|---|
| OD-1 | The account menu lives in the **top-right of the top bar** in both portals. | Rail avatar, rail logout, panel user card (admin); sidebar user card + logout button (employee). |
| OD-2 | The **light/dark toggle moves into the account menu** as a two-option Light/Dark control. The login screen keeps its own toggle (`loginThemeToggle`). | Top-bar theme icon buttons. |
| OD-3 | **Notification bell is visible** in both top bars. It opens a small popover with the empty state "No notifications yet". No unread dot until notifications exist. | **Supersedes `docs/UI-UX-FIX-PLAN.md` item "Notification bell: remove from both topbars (owner decision; notifications are a later feature)".** |
| OD-4 | **No page subtitle.** The top bar shows the **title only**; the title must look elegant. | **Supersedes `docs/UI-UX-FIX-PLAN.md` item "show title and subtitle on every page".** The "title on every page" part still holds. |
| OD-5 | Top bar is compact (~56 px). | — |
| OD-6 | Avatar shows **initials, not bold**, on a soft tinted background; built as a component that can later host a user picture. | — |
| OD-7 | The **brand footer is removed from both sidebars** ("HRFlow by Voyance Health" line and logo images). Identity stays in the rail/brand mark, login page and page title. | — |
| OD-8 | **Employee portal is included.** | **Amends D-010 (N-1/N-2: "Employee portal sidebar remains completely untouched").** |
| OD-9 | Nav polish is included: group labels "People" and "Benefits & records"; distinct salary icons; active indicator merged into the active pill; fix the chevron if clipped. | — |
| OD-10 | The "Profile" menu item is **not** shipped until a target page exists. | — |

D-010 items that **still hold**: the module rail stays permanently visible; only the contextual panel collapses; independent collapse keys (`hrflow.admin.navPanelCollapsed`, `hrflow-sidebar-collapsed`); `AdminNav.canSeeModule` gating is untouched.

## 4. Assumptions and open items

| ID | Item | Status |
|---|---|---|
| A-1 | Bell popover copy is "Notifications" / "No notifications yet". | Assumption (owner may change wording) |
| A-2 | At phone widths (≤560 px) the **Export** button moves from the top bar into the admin account panel as an "Export data" item (calls `openExportModal()`), so the title is not squeezed out. Desktop keeps the icon button. | Assumption |
| A-3 | New popover/menu JS goes into `fe/public/js/ui.js` and new CSS into `fe/src/styles/layout.css` (no new script or stylesheet plumbing). | Assumption (revisit in S0 if trivial to add files) |
| A-4 | Font Awesome icons named below exist in the loaded FA version. | Unknown — verify in S0 (check the FA version loaded in `fe/src/index.html`). |
| O-1 | Profile page target for a future "Profile" item. | Open (out of scope) |
| O-2 | Decision-log number for the new entry. | Open — use the next free `D-0xx` in `docs/project-context/04-decision-log.md`. |

## 5. Design specification

### 5.1 Top bar (both portals)
- `.topbar`: `min-height: 56px`; padding `8px 24px` (≥769 px), `8px 16px` (≤768 px); keep `position: sticky; top: 0; z-index: 20;` solid `var(--bg)` background and `1px solid var(--border)` bottom border.
- Left: `.hamburger` (existing, ≤768 only) + title. **Remove the `.sub` element and every write to it.**
- Right (`.top-actions`, `gap: 8px`), in this order:
  `[Add Transaction — Finance only, admin]  [Export — admin]  [Search]  [Bell]  [Account avatar]`.
  The theme icon button is **removed** (moved into the account menu, OD-2).
- Scope the compact button style to `.topbar .icon-btn` and `.topbar .hamburger` so other uses of `.icon-btn` in the app do not change.

### 5.2 Title typography ("elegant")
- `font-family: var(--font-head)`; `font-size: 19px` (≥769 px) / `17px` (≤768 px); `font-weight: 600`; `letter-spacing: -0.012em`; `line-height: 1.25`; `color: var(--text)`; single line with `text-overflow: ellipsis`. No breadcrumb, icon or subtitle. Exactly one `h1` per view (keep `#adminPageTitle`, `#empPageTitle`).

### 5.3 Icon buttons (top bar)
- Desktop/mouse: 36×36 px circle, transparent background, `1px solid transparent` border, **no shadow, no hover lift**; hover: `background: var(--surface2)`, `border-color: var(--border)`, `color: var(--accent-text)`; icon 15 px; color `var(--text2)`.
- Touch targets: `@media (pointer: coarse), (max-width: 768px)` → 44×44 px (also hamburger).
- `:focus-visible` → `outline: 2px solid var(--accent); outline-offset: 2px`.

### 5.4 Account avatar component
- New class `.account-avatar` (do not reuse the old bold `.avatar` rules). Sizes: default 32 px (trigger), `--lg` 40 px (menu header). Circle; `background: var(--accent-soft)`; `color: var(--accent-text)` (verify ≥ 4.5:1 in light **and** dark; if it fails use `var(--accent)` text or a darker tint); `font-weight: 500`; `font-size: 12.5px` (default) / `14px` (lg); `letter-spacing: .02em`; `1px solid var(--border)` ring.
- Structure: `<span class="account-avatar"><span class="account-avatar__initials">AE</span></span>`. A future user picture is an `<img class="account-avatar__img">` inside the same wrapper that covers the initials. **Do not build the image feature now.**
- Initials come from the existing `getInitials(name)` (`ui.js`).

### 5.5 Account menu (disclosure popover, not `role="menu"`)
- Trigger: `<button class="account-trigger" id="adminAccountBtn|empAccountBtn" aria-label="Account menu" aria-haspopup="true" aria-expanded="false" aria-controls="…">` containing the avatar. Target ≥ 36 px (44 px on touch).
- Panel: `<div class="account-panel" id="…" hidden>` right-aligned under the trigger (`position: absolute; top: calc(100% + 8px); right: 0; width: 264px; max-width: calc(100vw - 24px)`), `background: var(--surface)`, `1px solid var(--border2)`, `border-radius: 14px`, `box-shadow: var(--shadow-lg)`, padding 8 px. Must stack above page content and the sticky top bar; verify against the command palette and modals.
- Contents, in order: (1) header — avatar `--lg`, name, role; (2) divider; (3) "Appearance" row with a **segmented Light | Dark control** (two `<button>`s with `aria-pressed`, `data-theme-choice="light|dark"`); (4) admin only, **≤560 px only**: "Export data" row (A-2); (5) divider; (6) "Sign out" button → `logout()` (danger-tinted text, ≥ 44 px row height).
- Behavior: click trigger toggles; **Escape closes and returns focus to the trigger**; click outside closes; opening one top-bar popover closes the other; closes on navigation (outside click is sufficient) and before `logout()`. `aria-expanded` kept in sync. Natural Tab order; no focus trap. Short fade (≤120 ms) allowed; honor `prefers-reduced-motion`.
- Identity text: the elements that hold name/role/initials keep the IDs the existing code writes (`adminUserName`, `adminUserRole`, `adminUserAvatar`, `empUserName`, `empUserRole`, `empUserAvatar`). If the avatar appears twice (trigger + header), introduce one small helper in `ui.js` (e.g. `fillAccountIdentity(portal, {name, role})`) and call it from the four existing fill sites so both copies are populated.

### 5.6 Theme control
- `applyTheme(theme)` additionally syncs `aria-pressed` on all `[data-theme-choice]` buttons. Segmented buttons call `applyTheme('light'|'dark')`.
- Remove `#adminThemeToggle` / `#empThemeToggle` from the partials and from the `['loginThemeToggle','adminThemeToggle','empThemeToggle']` binding and the icon-sync selector (keep `.theme-fab` / `loginThemeToggle`). Keep storage key `hrflow-theme`. Do not change theme tokens or chart code.

### 5.7 Bell
- `<button class="icon-btn" id="adminNotifBtn|empNotifBtn" aria-label="Notifications" aria-haspopup="true" aria-expanded="false"><i class="fa-solid fa-bell"></i></button>` placed between Search and the avatar, **visible** (not `hidden`). Popover (same open/close behavior as 5.5, narrower, `width: 280px`): heading "Notifications" and a muted empty state "No notifications yet". No unread dot, no counters, no API calls. Keep the existing `.icon-btn .dot` CSS untouched for the future.

### 5.8 Responsive rules (use the existing 768 px breakpoint; add a 560 px rule only for A-2)
- ≥769 px: full top bar as above.
- ≤768 px: hamburger + title (ellipsis) + actions, 44 px touch targets, 16 px side padding. Drawer behavior unchanged (rail + panel, no account items inside the drawer).
- ≤560 px: Export button hidden in the bar and available in the account panel (A-2).
- No horizontal page scroll at 360, 390, 768, 1024, 1440 px.

## 6. Slices

Rules for every slice: small commits (one per slice), explicit file staging, preserve CRLF, run the checks in §8 before moving on, stop on the conditions in §9.

### S0 — Baseline and discovery (read-only; no repo edits)
1. Confirm branch `fix/review-ui-fixes`, HEAD, clean content state (ignore EOL noise).
2. `cd fe && npm ci` only if `node_modules` is missing; run `npm run build`; run the Playwright specs listed in B15 and then the full `npm test`. **Record exact pass/fail counts and the names of any pre-existing failures.** Do not fix unrelated failures.
3. Measure the current top-bar height at 1440×900 and 390×844 (admin and employee).
4. Grep: `adminPageSub|empPageSub|ThemeToggle|adminRailUserAvatar|adminUserAvatar|adminUserName|adminUserRole|empUser|user-mini|sidebar-brand-footer|logout-btn|rail-btn.logout|sidebar-footer|Workspace|Modules` across `fe/public`, `fe/src`, `fe/tests`; list every test assertion that touches a thing this plan removes or renames.
5. Inspect `.collapse-btn` placement (B16) and the rail active-indicator CSS; note findings.
6. Verify Font Awesome version and the icons used in S6 (A-4).
7. Capture "before" screenshots (admin and employee × 1440, 1024, 768, 390 × light, dark) **outside the repo or in a git-ignored folder**.
**Done when:** a short baseline note (in the final report) lists results, measurements and test impacts.

### S1 — Compact top bar, title only (both portals)
Files: `fe/src/styles/layout.css`, `fe/src/styles/components.css` (768 px block), `fe/src/partials/admin/topbar.html`, `fe/src/partials/employee/topbar.html`, `fe/public/js/ui.js`, `fe/tests/ui/frontend-consistency-phase-a.spec.js`.
1. Remove the `.sub` elements and the `adminPageSub`/`empPageSub` write in `showSection` (leave the second values of the `titles` map untouched; mention them as dead data in the report).
2. Apply §5.1–5.3 styles (scoped to `.topbar`).
3. Update the test at ~L97: assert `#adminPageTitle` is "Employee Profile" and that `#adminPageSub` does not exist.
**Acceptance:** AC-1, AC-2, AC-3, AC-9.

### S2 — Account menu + theme control (both portals' top bars, built once, admin first)
Files: both `topbar.html`, `layout.css`, `ui.js`.
1. Add avatar component, trigger and panel (§5.4–5.6) to the admin top bar; remove `#adminThemeToggle`; update `applyTheme` and the theme binding.
2. Implement popover open/close behavior once, reusable for the bell (§5.7) and both portals.
3. Keep `logout()` unchanged.
**Acceptance:** AC-4, AC-5, AC-6, AC-10.

### S3 — Bell (both portals)
Files: both `topbar.html`, `layout.css`, `ui.js`.
Add the visible bell and empty-state popover (§5.7).
**Acceptance:** AC-7.

### S4 — Remove old admin locations
Files: `fe/src/partials/admin/sidebar.html`, `fe/src/styles/admin-nav.css`, `fe/public/js/app.js`, `fe/public/js/session.js`.
1. Remove `#adminRailUserAvatar`, the rail logout button, the entire `.sidebar-footer` (user card + logo images) and the now-unused `.rail-sp` spacer if nothing depends on it.
2. Remove the `adminRailUserAvatar` fill code in `app.js` and `session.js`; make sure every remaining ID write targets an element that exists (use the S2 helper).
3. Delete only the **admin-nav.css** rules proven unused by grep (`.rail .avatar`, `.rail-btn.logout*`, `.sidebar-footer`, `.user-mini*`, `.sidebar-brand-footer*` scoped to `#adminSidebar.dual-rail`). Shared rules in `layout.css`/`components.css` stay until S5.
4. Confirm the nav list still fits without vertical scroll at 1440×900 and the panel nav can scroll on short viewports.
**Acceptance:** AC-8, AC-11.

### S5 — Employee portal
Files: `fe/src/partials/employee/sidebar.html`, `employee/topbar.html`, `layout.css`, `components.css`, `app.js`.
1. Employee top bar gets the same account menu and bell (IDs `emp*`). Keep the sidebar brand row and collapse button.
2. Remove the employee sidebar `.sidebar-footer` (user card, logout button, brand footer) and then the now-orphaned shared CSS (`.user-mini*`, `.logout-btn*`, `.sidebar-brand-footer*`, including the `.sidebar.collapsed …` and ≤768 variants) after grep confirms no other users.
3. Preserve the independent collapse key `hrflow-sidebar-collapsed`.
**Acceptance:** AC-12.

### S6 — Navigation polish (admin; apply the same icon to the employee portal for identical labels)
Files: `admin/sidebar.html`, `admin-nav.css`, `employee/sidebar.html`.
1. HR panel group labels: "Workspace" → "People", "Modules" → "Benefits & records" (update any test text that depends on them).
2. Icons: Salary & Raises → `fa-arrow-trend-up`; Salary Payment Docs → `fa-file-lines` (must stay visually distinct from Finance Sales `fa-file-invoice-dollar`). If an icon is missing in the loaded FA version, pick the closest distinct one and report it.
3. Active indicator: render the accent bar **inside** the active pill's left edge (not at the screen edge) for rail buttons; keep the active pill background.
4. Fix `.collapse-btn` clipping if S0 confirmed it; otherwise report "no change needed".
**Acceptance:** AC-13.

### S7 — Docs (on this branch only)
1. Add decision-log entry (next free `D-0xx`) recording OD-1…OD-10, explicitly **superseding** the two `UI-UX-FIX-PLAN.md` items and **amending D-010 N-1/N-2**; status "Accepted by owner 2026-10-05; pending merge".
2. Annotate the two superseded lines in `docs/UI-UX-FIX-PLAN.md` ("superseded by D-0xx").
3. Add a one-line note to `docs/ui-design/dual-rail-navigation-plan-v2.md` pointing to this plan (rail bottom no longer holds avatar/logout).
4. Do not edit `05-roadmap-and-next-slices.md` or `06-open-questions.md` unless a real conflict appears; if so, report instead of editing. Add O-1 (profile page target) to the report as a suggested open question.
**Acceptance:** AC-14.

## 7. Acceptance criteria

| ID | Criterion |
|---|---|
| AC-1 | Top bar height is ≈56 px (±2) at ≥769 px in both portals, measured in the browser. |
| AC-2 | No subtitle element exists in either top bar on any page; the title is present on every page. |
| AC-3 | Title style matches §5.2 and truncates with an ellipsis instead of wrapping. |
| AC-4 | The avatar trigger shows initials (not bold) at the top right in both portals; menu header shows avatar, name and role. |
| AC-5 | Menu opens/closes by click; closes with Escape (focus returns to trigger) and on outside click; `aria-expanded` is correct; fully keyboard-operable. |
| AC-6 | Segmented Light/Dark control switches the theme, persists across reload (`hrflow-theme`), and reflects state via `aria-pressed`. Login-screen toggle still works. No top-bar theme icon remains. |
| AC-7 | Bell is visible in both top bars (no `hidden`), opens/closes the empty-state popover, no unread dot, no console errors; only one top-bar popover open at a time. |
| AC-8 | The admin shell shows exactly one avatar (top bar); the rail has no avatar or logout; the panel has no footer, no logo images. |
| AC-9 | No horizontal scroll at 360, 390, 768, 1024, 1440 px in either portal; touch targets ≥44 px at ≤768 px. |
| AC-10 | "Sign out" works from the menu and returns to the login screen; no console errors during login/logout/session-expiry flows. |
| AC-11 | Admin nav fits at 1440×900 without a vertical scrollbar (existing dual-rail AC 1 still passes). |
| AC-12 | Employee portal: same top bar/menu/bell; sidebar has no user card, logout button or brand footer; collapse state persists independently. |
| AC-13 | Labels, icons, active-pill indicator and chevron are as specified; existing rail-switching tests still pass. |
| AC-14 | Decision-log entry and annotations written; no unrelated doc edits. |
| AC-15 | Contrast ≥4.5:1 for initials, menu text and muted text in light and dark themes (spot-check with computed colors). |
| AC-16 | After all slices: `npm run build` passes and `npm test` has **no new failures** versus the S0 baseline; new specs pass. |

## 8. Test plan and verification

- **New specs** (follow existing patterns in `admin-dual-rail.spec.js` for login/mock setup): `fe/tests/ui/topbar-account-menu.spec.js` covering AC-1…AC-10 and AC-12 for admin and employee, at 1440×900 and 390×844, including: height, no subtitle, menu open/close/Escape/outside-click, theme switch + persistence, bell popover, sign out, no console errors, no horizontal overflow.
- **Updated specs:** `frontend-consistency-phase-a.spec.js` (subtitle assertion); any test S0 flags that depends on removed elements or renamed labels (change only what is necessary and say so).
- **Regression:** `admin-dual-rail.spec.js`, `sanity.spec.js`, `routing.spec.js`, then the full suite.
- **Per slice:** `cd fe && npm run build`, run the touched specs, then the full suite after S5 and S7.
- **Visual:** "after" screenshots in the same matrix as S0; compare, and describe differences in the report. Do not commit screenshots.
- Report exact commands and exact results (counts, names of failures).

## 9. Guardrails, risks and stop conditions

**Guardrails**
- Work on the current branch `fix/review-ui-fixes`. No new branch, no push, no PR, no merge, no force operations, no history edits.
- One commit per slice, staged by **explicit paths** (never `git add -A` / `git add .`). Before each commit confirm `git diff --cached --stat` lists only intended files and that no file shows a whole-file rewrite (line-ending noise). Preserve each file's existing line endings (CRLF).
- If `.git/index.lock` exists as a 0-byte file and no git process is running, it is a stale lock from a read-only review session; remove it.
- No new dependencies, no formatter or linter run across files, no refactors beyond this plan, no backend/schema/RBAC/API changes, no changes to `vite.config.js`.
- Respect repository rules in `AGENTS.md` and the source-of-truth hierarchy in the project instructions. Keep HR vs Finance terminology (HR "Salary Payment Docs" ≠ Finance "Sales Invoices").
- Branch-only decisions stay on this branch until reviewed and merged (branch-awareness rule).

**Risks**
- Unguarded `getElementById(...).textContent` writes (B4) → keep or replace every ID before removing markup.
- Theme wiring by ID (B6) → update binding and icon-sync together.
- Shared CSS between portals (`layout.css`/`components.css`) → delete only after grep proves no other user.
- Top bar crowding on phones (A-2) → verify at 360 px with Finance's Add Transaction visible.
- Popover stacking vs sticky top bar, drawer (z-index 55/60), command palette and modals.
- Line-ending noise → explicit staging and diff checks.

**Stop and report (do not guess) if**
- The build or baseline tests fail in a way that blocks verification, or more than a handful of unrelated tests already fail.
- A requirement here conflicts with current code in a way that needs a product decision (check `docs/project-context/06-open-questions.md` first).
- A slice would need a backend change, a new dependency or a change outside `fe/` and the docs listed.
- Theme, identity or logout wiring differs materially from §2.

## 10. Out of scope
User picture upload; real notification data/API; a Profile page; changes to Finance/Payroll/System page content; panel auto-collapse on tablet; backend or RBAC; dark-mode variant of the Voyance logo (the footer logo is being removed); fixing unrelated test failures.

## 11. Final report format (end of work)
1. Outcome (per slice: done / partial / skipped, with reason).
2. Files changed (grouped by slice) and commits created (hash + subject).
3. Tests run with exact commands and exact results; baseline vs final comparison.
4. Measurements: top-bar height before/after; screenshots location.
5. Confirmed facts vs assumptions vs unanswered questions.
6. Decision-log / roadmap / open-question updates made or still needed.
7. Concise handoff summary for the next thread.

## Appendix A — Draft decision-log entry (adapt wording and number in S7)

> ### D-0xx — Top-Bar Account Menu, Title-Only Header and Visible Bell
> - **Status:** Accepted by owner 2026-10-05 (pending merge of `fix/review-ui-fixes`).
> - **Decision:** The account menu (identity, Light/Dark control, Sign out) lives in the top-right of the top bar in the Admin and Employee portals; avatar/logout leave the rail and sidebars; the brand footer is removed from both sidebars; the top bar is compact (~56 px) and shows the page title only; the notification bell is visible with a "No notifications yet" popover until notifications exist.
> - **Supersedes:** `UI-UX-FIX-PLAN.md` items "Notification bell: remove from both topbars" and "title and subtitle on every page".
> - **Amends:** D-010 N-1/N-2 — the Employee portal shell now receives the same top bar and account menu. All other D-010 rules remain.
> - **Rationale:** One identity location, mobile-friendly and conventional; less sidebar clutter; compact elegant header.
> - **Implementation plan:** `docs/ui-design/topbar-account-menu-implementation-plan.md`.
