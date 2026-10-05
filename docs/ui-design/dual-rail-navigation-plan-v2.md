# HRFlow Admin Dual-Rail Navigation — Implementation Plan v2

**Status:** Proposed. Supersedes `dual-rail-navigation-implementation-plan.md` (v1) and the amendments in `dual-rail-plan-review-and-amendments.md`.  
**Working branch:** `ui/dual-rail-nav`  
**Plan date:** September 30, 2026  
**Nature of work:** Admin-portal navigation shell (frontend only). High-risk per `AGENTS.md` because it touches finance and payroll navigation.  
**Authorization state:** Plan only. No repository change is authorized until the owner approves a specific slice.

> **Update 2026-10-05:** the rail bottom no longer holds an avatar or logout button; identity, theme and Sign out moved to the top-bar account menu. See `topbar-account-menu-implementation-plan.md` and decision D-014.

---

## 1. Branch intake (verified Sept 30, 2026 via LocalFS)

| Item | Value |
|---|---|
| Branch | `ui/dual-rail-nav` |
| HEAD | `ec780a88b8` — "Merge pull request #22 from ahmedezzat85/feature/payroll-deductions" |
| Relation to `main` | 0 commits ahead, 0 files changed (branch tip equals `main` tip) |
| Merge-base | Same as HEAD (identical tips) |
| Working tree | Clean, 0 uncommitted changes |
| Tracked files | about 505 |
| Payroll-deductions branch | Already merged into this base, so payroll code here is post-merge |

Notes for the agent:
- `docs/project-context/00-project-start-here.md` still cites `main` at `9d6394ae…` and says D-006 conflicts with the implementation. That file predates the PR #22 merge and may be stale. Do **not** edit it without owner approval, and do not treat D-006 status as known.
- Before coding, read `docs/project-context/06-open-questions.md` and record whether Q-001–Q-005 touch navigation. None was read during planning.
- Permissions are explicitly **out of scope** (owner decision): a clean roles-and-permissions feature comes next. This plan must not change or extend the permission model.

---

## 2. Final product decisions

| ID | Decision |
|---|---|
| N-1 | One application, one shell. Not two apps. Admin portal only. The Employee sidebar is untouched. |
| N-2 | Navigation is a **dual rail**: a slim module rail plus a contextual page panel. The panel collapses; the rail never disappears. |
| N-3 | Modules: **HR**, **Finance**, **Payroll**. Payroll is a navigation module only; it stays Finance-owned in code and domain. |
| N-4 | Finance panel has six pages: Overview, Sales, Spend, Banking, Reports & Export, Finance Settings. |
| N-5 | In-page tabs carry the detail. Sales: Sales Invoices, Customers. Spend: Vendor Bills, Vendors, Subscriptions, Statutory. Banking: the five existing tabs. Finance Settings: Categories, Payment Types, Display. Reports keeps its existing tabs. |
| N-6 | HR page "Invoices" is renamed **Salary Payment Docs** (label, tooltip/title, page title, tests, command palette). |
| N-7 | Finance panel label "Settings" becomes **Finance Settings**. Payroll's own entry is **Payroll Settings**. |
| N-8 | Only the panel collapsed/expanded state is persisted. The active module is derived from the current page. |
| N-9 | Existing visibility rule for Finance (admin, system_admin, or any `finance.*` permission) is reused **unchanged**, wrapped in one function so the future permissions feature has a single plug-in point. |
| N-10 | Story 1.1's "7 finance domains" acceptance test is intentionally superseded in Slice 3, when Payroll leaves the Finance panel. This must be recorded in the decision log (with owner approval). |

### What differs from the prototype (answer to the owner's Q1)

The prototype showed exactly N-4/N-5: six Finance rows with tabs for the detail. The finding that changed the plan is that **the tabs in the prototype were placeholders, not real**. In the actual app:
- Sales and Banking already have the tab bars shown in N-5.
- Spend does not: Vendor Bills/Vendors are tabs, but Subscriptions and Statutory are separate pages with no tab bar.

So N-4/N-5 requires one small new piece of UI: two extra tabs (Subscriptions, Statutory) added to the Spend tab bar, on all three Spend pages. The earlier alternative was an eight-row Finance panel (Bills, Subscriptions and Statutory as separate rows). It avoids that new piece but looks different from the prototype and keeps Finance longer. This plan keeps the prototype's look, with a stated fallback (section 5, Slice 2, "Fallback").

---

## 3. Verified baseline and the coupling contract

All facts below were read from the current code. The agent must preserve them unless a slice explicitly changes them.

| # | Fact | Where | Constraint for the work |
|---|---|---|---|
| C1 | `showSection(pageId, portal)` is the single page switcher. It maps aliases (`a-finance-sales`→`a-finance-invoices`, `-spend`→`-bills`, `-banking`→`-accounts`, `-payroll-runs`/`-settings`→`a-finance-payroll`), toggles `.page-section.active`, sets active nav item, sets title/subtitle from the `titles` map. | `fe/public/js/ui.js` | Keep the function and its signature. Extend; do not fork. |
| C2 | Nav clicks are bound **once at script load**: `querySelectorAll('#admin-app .nav-item[data-page]')`. | `ui.js` lines ~117–119 | Nav items must exist in static HTML. Anything `.nav-item[data-page]` calls `showSection`. Rail module buttons must **not** use `.nav-item` or `data-page`. |
| C3 | Data loaders (`loadFinanceInvoices()`, `loadFinanceBills()`, …) fire from one **delegated click handler** on `[data-page]`. Programmatic `showSection` calls do not run loaders. | `finance-nav.js` (~lines 112–160) | Extract the loader if/else chain into a function used by the click handler and by the new `AdminNav.go()`. Do not run loaders from `showSection`, or existing programmatic callers (finance-dashboard.js 262–500) would double-load. |
| C4 | Programmatic callers of `showSection`: `app.js:135`, `employees.js:15,115` (incl. `a-employee-detail`, which has no nav item), `finance-dashboard.js:287,484` (targets such as `a-finance-transfers`, `-cheques`, `-statements` that are not nav items). | as listed | The page→module map must resolve every page ID, including pages with no nav item; unknown IDs keep the current module. |
| C5 | Payroll highlighting is hard-wired: `PayrollApp.showPage()` toggles `#payrollNavList` / `#payrollNavSettings` and force-adds `active` to `#adminSidebar a[data-page="a-finance-payroll"]`. Sidebar items call `PayrollApp.showPage(...)` through inline `onclick`. | `finance-payroll.js` ~2068–2085; `sidebar.html` lines ~41–44 | Slice 3 changes this deliberately. Until then keep all IDs and handlers. |
| C6 | `updateFinanceNavVisibility()` sets inline `style.display = "block"` or `"none"` on `#adminFinanceNavGroup`. It runs on DOMContentLoaded and on `hrflow:session-changed`. | `finance-nav.js` | Inline display overrides any module-hiding CSS. Change it to toggle a class or the `hidden` attribute. |
| C7 | Sidebar collapse: `toggleSidebarCollapse(id)` writes one shared key `hrflow-sidebar-collapsed` and **syncs both `adminSidebar` and `empSidebar`**. `applySavedSidebarCollapse()` applies it to both. | `ui.js` lines ~71–92 | Admin gets its own key. The Employee sidebar must keep exact current behavior. |
| C8 | Mobile drawer: hamburger calls `toggleSidebar('adminSidebar')` (toggles `.open` plus `#adminSidebarBackdrop`); `closeAllSidebars()` runs after every `showSection`. | `ui.js`, `topbar.html`, `index.html` | Keep `#adminSidebar` as the outermost element that receives `.open`; keep the backdrop element and IDs. |
| C9 | Both portals use the `.sidebar` class. Collapsed rules are duplicated in `layout.css` and `components.css`. | `fe/src/styles/` | Do **not** edit base `.sidebar` rules. Scope all new CSS under `#adminSidebar.dual-rail`. |
| C10 | Scripts are **classic scripts concatenated into one inline `<script>`** in the order listed in `APP_SCRIPT_ORDER`. Partials are inlined at build time via `<!-- @include -->`. Top-level `let`/`const` names from different files share one scope. | `fe/vite.config.js`; `fe/src/index.html` | A new JS file must be added to `APP_SCRIPT_ORDER`, wrapped in an IIFE, with a single `window.AdminNav` export and unique names. |
| C11 | Finance badges: `#reqBadge`, `#financeSalesBadge`, `#financeSpendBadge`, `#financeBankingBadge` are updated by id. Finance badges sit on the **parent** rows (Sales, Spend, Banking). | `sidebar.html`, `finance-nav.js` | Keep IDs and `role="status"` / `aria-label` behavior (asserted by tests). |
| C12 | Page title and subtitle live in the existing topbar (`adminPageTitle`, `adminPageSub`), filled from the `titles` map. `titles['a-invoices']` currently reads "Invoices / Generate and manage external-salary invoices." | `ui.js`, `topbar.html` | The topbar is unchanged. Update the `titles` entry for the rename. |
| C13 | Nav anchors are `<a class="nav-item" data-page=…>` **without `href`**, so they are not keyboard-focusable today. | `sidebar.html` | Add `href="#"` with `preventDefault` inside the existing click paths; do not switch to `<button>`. |
| C14 | `#adminUserAvatar`, `#adminUserName`, `#adminUserRole` are filled by session code. | `sidebar.html`; setter not yet located | Locate the setter before coding; keep these IDs; any rail avatar needs a new unique ID updated by the same code. |
| C15 | A command palette partial exists: `partials/modals/command-palette-modal.html`. | `index.html` | Out of scope except: check it for labels/targets affected by the renames. |
| C16 | Test contract: many specs click `#adminSidebar a[data-page="…"]` (at least 15 files, including `a-finance-bills`, `-invoices`, `-accounts`, `-dashboard`, `-payroll`, `a-employees`). `finance-payroll-table-cycle.spec.js` clicks `#payrollNavList`. `employee-social-insurance.spec.js:190` reads `#adminSidebar .sidebar-nav`. `finance-navigation.spec.js` asserts the 7 domains, parent highlighting via legacy routes, and badge visibility. | `fe/tests/ui/` | Slice 0 builds the safety net for this. The exact file list is produced by grep in intake and recorded. |
| C17 | Existing tab bars: Sales page (`#financeInvoiceSubNav`): Sales Invoices, Customers. Bills page (`#financeBillSubNav`): Vendor Bills, Vendors. Banking page (`#financeAccountsSubNav`): Bank & Cash Accounts, Continuous Ledger, Statements & Reconciliation, Cheque Register, Account Transfers. Settings (`#financeSettingsSubNav`): Categories, Payment Types, Display. Reports (`#financeReportsSubNav`): 14 tabs. Subscriptions and Statutory pages: no tab bar. | `partials/admin/sections/finance-*.html` | Tab button IDs are used by tests; do not rename them. |

---

## 4. Design principles that prevent the known failure modes

1. **One registry, one place.** A single `AdminNav` module holds: modules, which pages belong to each, alias/parent rules, and the page→module map. Active-state rules for parents/children come from it, replacing scattered special cases in `showSection` and `finance-payroll.js` only when a slice says so.
2. **One new navigation path.** `AdminNav.go(pageId)` = `showSection(pageId,'admin')` + the extracted loader + `PayrollApp.showPage` where applicable. Used only by new callers (rail, tabs). Existing callers are unchanged (C3/C4).
3. **Static markup.** Panels are static HTML, shown/hidden with the `hidden` attribute. No `innerHTML` regeneration (C2).
4. **Module follows page.** `showSection` ends with a cheap, idempotent `AdminNav.syncFromPage(pageId)` that sets the active module and rail state. Pages with no nav item keep the current module (C4).
5. **Scoped CSS.** New stylesheet `fe/src/styles/admin-nav.css`, imported from `fe/src/styles.css`, every selector under `#adminSidebar.dual-rail` (C9). Tokens only (`tokens.css`); no hard-coded colors; dark theme must work.
6. **Isolated gating.** `AdminNav.canSeeModule(id)` returns the existing Finance rule for Finance/Payroll and true for HR. The future permissions feature replaces this function body only (N-9).
7. **No duplicate IDs, no global leaks.** IIFE, one `window.AdminNav`.
8. **Every slice leaves every page reachable** and every previously passing spec passing or intentionally updated.

---

## 5. Delivery slices

Each slice is a separate commit series on `ui/dual-rail-nav`, needs its own owner approval, and ends with the handoff report required by `AGENTS.md` and the project thread protocol. No commit or push without explicit owner approval (overrides the auto-commit text in `AGENTS.md`).

### Slice 0 — Safety net (no visual or behavior change)

**Goal:** make later navigation changes cheap and detectable.

Steps:
1. Record the baseline: run `npm run build` in `fe/`, then the specs that reference `#adminSidebar` (grep gives the list) and `finance-payroll-table-cycle.spec.js`. Save exact pass/fail results so pre-existing failures are not blamed on this work.
2. Add `fe/tests/ui/helpers/admin-nav.js` exporting `openAdminPage(page, pageId)` and `openAdminModule(page, moduleId)`. In Slice 0 they simply click the existing selector (`#adminSidebar a[data-page="…"]`); later slices change only this helper.
3. Migrate every spec that clicks `#adminSidebar a[data-page=…]` to the helper. Mechanical edit only; no assertion changes.
4. Extract the loader chain from the `finance-nav.js` click handler into `runFinanceLoader(pageId)` (pure refactor; the handler calls it; behavior identical). Keep the `FinanceTable.initAllTablesDensity` and `e-payslips` branches working.

Acceptance:
- Build passes; migrated specs produce the same results as the baseline.
- `git diff --stat` shows only spec files, the new helper, and `finance-nav.js`.

### Slice 1 — Dual-rail shell, HR panel, Finance panel unchanged

Scope:
- New markup in `partials/admin/sidebar.html`: `<aside class="sidebar dual-rail" id="adminSidebar">` containing `.rail` (logo mark; HR button; Finance button; bottom avatar and logout) and `.nav-panel` (header with module name; `.sidebar-nav` with one static group per module; panel footer with `user-mini` and brand logo).
- HR group: Dashboard, Employees, Pending Requests, Salary & Raises, Vacations, Medical Insurance, Document Hub, Salary Payment Docs. Keep every existing `data-page` value. Section labels as in the prototype (People / Time & benefits / Documents) are optional polish.
- Finance group: the **current** Finance markup moved as-is into the Finance panel (including child rows and Payroll rows). `#adminFinanceNavGroup` stays the container.
- Rail buttons are `button.rail-btn[data-module]`, each with visible text label, `aria-label`, and `aria-current="true"` when active. Logout and avatar get `aria-label` and `title`. No custom tooltip component is needed because module labels are always visible.
- `AdminNav`: registry, `moduleOf(pageId)`, `setModule`, `syncFromPage`, `togglePanel`, `go`, `syncBadges`. Add `admin-nav.js` to `APP_SCRIPT_ORDER` after `ui.js` and before `finance-nav.js`.
- `showSection` calls `AdminNav.syncFromPage` at the end (guarded: `if (window.AdminNav)` and admin portal only).
- Panel collapse: new key `hrflow.admin.navPanelCollapsed`. Change `toggleSidebarCollapse` so the admin case no longer writes or syncs the shared key, and the employee case no longer touches the admin sidebar. Update `applySavedSidebarCollapse` the same way. Old key continues to serve the Employee sidebar only.
- `updateFinanceNavVisibility`: toggle a class/`hidden` instead of inline display; also show/hide the Finance rail button via `AdminNav.canSeeModule`.
- Pending Requests dot on the HR rail button: `AdminNav.syncBadges()` reads `#reqBadge` and is driven by a `MutationObserver` on it, so it follows whichever code updates the badge. Hide the badge and dot when the count is 0.
- Rename HR "Invoices" → "Salary Payment Docs": label, `title`, `titles['a-invoices'][0]`, and any test or palette text found by grep. The page ID `a-invoices` and `initInvoicesPage` hook do not change.
- Mobile: rail and panel form one drawer under `.open`; panel-collapsed state is ignored in drawer mode. Read `responsive.css` first and reuse its existing breakpoint; do not invent one.
- Give nav anchors `href="#"` and prevent default inside the existing handler path (C13).

Acceptance criteria (mock admin):
1. At load, the rail shows HR and Finance; HR is active; the panel lists exactly the eight HR pages; the panel needs no vertical scroll at 1440×900.
2. Clicking the Finance rail button shows the current Finance group and hides HR; clicking any Finance item loads its page and data exactly as before.
3. Calling `showSection('a-finance-bills','admin')` from the console switches the rail to Finance and highlights the correct item.
4. Collapsing hides the panel only; the rail stays; reload restores the state; the Employee portal's collapse behavior is unchanged in both directions.
5. `a-employee-detail` and `a-finance-transfers` (no nav items) do not reset or break the rail.
6. Exactly one nav item is active at a time within the visible panel for HR pages.
7. The HR rail dot matches `#reqBadge` and is absent at 0.
8. Keyboard: Tab reaches rail buttons and nav items; Enter activates them; Escape closes the mobile drawer and returns focus to the hamburger.
9. Light and dark themes render with tokens only.
10. `?mock=employee` still shows the unchanged Employee sidebar.

Tests: add `fe/tests/ui/admin-dual-rail.spec.js` for the above. Update the helper so `openAdminPage` clicks the owning module's rail button first when the target item is not visible (the helper uses `window.AdminNav.moduleOf` via `page.evaluate`). Update `finance-navigation.spec.js` `beforeEach`/AC1/AC4 to open the Finance module before asserting visibility of the Finance group and badges.

### Slice 2 — Finance simplification (Spend tabs, remove child rows)

Scope:
- Inspect the top of `finance-subscriptions.html` and `finance-statutory.html` before editing; note any existing toolbar.
- Extend the Spend tab bar: in `finance-bills.html` add two buttons to `#financeBillSubNav`: Subscriptions (`id="tabFinanceSubscriptions"`) and Statutory (`id="tabFinanceStatutory"`). Existing IDs `tabFinanceBills` and `tabFinanceVendors` stay.
- In `finance-subscriptions.html` and `finance-statutory.html` add a matching tab bar with all four buttons (static HTML, same labels and order, the correct one active). Vendor Bills/Vendors buttons call `AdminNav.go('a-finance-bills')` then `switchBillSubTab(...)`; Subscriptions/Statutory call `AdminNav.go(...)`.
- Remove child rows from the Finance panel: Sales→Invoices, Spend→Bills/Subscriptions/Statutory, Banking→Bank Accounts. The parent rows (`a-finance-sales`, `-spend`, `-banking`) remain and keep their badges and IDs.
- Active-state rules move into the registry: `a-finance-invoices`→Sales; `a-finance-bills`, `-subscriptions`, `-statutory`→Spend; `a-finance-accounts`→Banking. Legacy IDs remain valid routes for programmatic callers.
- Rename the last Finance row label to Finance Settings; update its `titles` entry only if the current text is ambiguous.
- Payroll rows remain in the Finance panel in this slice (Payroll, Runs, Settings), unchanged.
- The Finance panel now has the 7 Story 1.1 domains, satisfying that story's AC1 exactly.

Acceptance criteria:
1. Finance panel shows exactly: Overview, Sales, Spend, Banking, Payroll (with its Runs/Settings rows), Reports & Export, Finance Settings.
2. Each removed child page stays reachable through tabs or parent, and loads its data.
3. Sales shows Sales Invoices and Customers; Spend shows Vendor Bills, Vendors, Subscriptions, Statutory; Banking shows its five tabs — all functional.
4. `showSection` on any legacy ID highlights the right parent (Story 1.1 AC2 still passes).
5. Badges on Sales, Spend and Banking appear only when greater than zero, keep `role="status"` and `aria-label` (Story 1.1 AC4 still passes).
6. The Spend tab bar is identical (labels, order) on all three Spend pages; a test asserts this.

Test changes: update the helper's mapping so child IDs open through their parent (and through the tab for Subscriptions/Statutory). Existing specs should need no edits beyond the helper.

Fallback: if the Spend tab bar proves larger than expected (for example, the two pages have toolbars that conflict), stop and ask the owner; the agreed fallback is to keep Subscriptions and Statutory as two indented rows under Spend, with the rest of the slice unchanged.

### Slice 3 — Payroll module

Scope:
- Add the Payroll rail button (gated with `canSeeModule`, same rule as Finance).
- Payroll panel: Runs and Settings only. Keep `id="payrollNavList"` on Runs and `id="payrollNavSettings"` on Settings, and their `onclick` calls to `PayrollApp.showPage('list' | 'settings')`. Remove the Payroll parent row and the Payroll rows from the Finance panel.
- Decide and document that the page ID `a-finance-payroll` resolves to the Runs item. Remove the force-`active` line in `finance-payroll.js` (~line 2083) and the payroll special cases in `showSection`; replace them with registry-driven active resolution. `PayrollApp.showPage('run')` keeps Runs active.
- Rename labels: "Runs" stays "Payroll Runs" in the panel; "Settings" becomes "Payroll Settings".
- `PayrollApp.showPage` called directly (from existing code) must still switch the rail to Payroll via `syncFromPage`.
- Finance panel is now six pages; update `finance-navigation.spec.js` AC1 accordingly and record N-10.

Acceptance criteria:
1. Payroll is reachable from its rail button; Runs and Settings both work; opening a run keeps Runs active.
2. Exactly one Payroll item is active at any time (the old double highlight is gone).
3. Finance panel lists exactly six pages.
4. `finance-payroll-table-cycle.spec.js` and `employee-social-insurance.spec.js` pass (helper maps `a-finance-payroll` to Runs).
5. `finance-dashboard` attention links that target `a-finance-payroll` land on Payroll Runs with the Payroll module active.
6. No change to payroll calculation, run states, bank-detail handling, or API calls.

### Slice 4 — Cleanup and polish (optional, separate approval)

- Remove admin-only dead CSS that supported the old page-icon rail (only if the Employee sidebar is proven unaffected).
- Update the command palette labels if grep shows stale names.
- Propose the decision-log and roadmap entries (not applied without approval).

---

## 6. Test and verification protocol

Follow `AGENTS.md` exactly:
- `cd fe && npm run build` before any UI test, whenever a frontend file changed.
- During a slice run only the single spec under work, `npx playwright test tests/ui/<spec>.spec.js --reporter=line`.
- Run the broader set once at the end of each slice: all specs that reference `#adminSidebar` (from grep), `finance-navigation`, `employee-social-insurance`, `finance-payroll-table-cycle`, the new `admin-dual-rail` spec, and an Employee-portal smoke (`/?mock=employee`).
- Never poll background commands; use compact reporters; use `git diff --stat`, not bare `git diff`.
- Record exact commands and results in each slice's report, and compare against the Slice 0 baseline.

Permissions and roles are not tested beyond existing behavior (Finance group hidden for the employee mock).

---

## 7. Risk register

| Risk | Mitigation |
|---|---|
| Specs fail because the target item sits in a hidden panel | Helper opens the owning module first (Slice 1) |
| Double data load or empty pages | Loader extracted once; only `AdminNav.go` and the click handler call it (C3) |
| Dead nav from dynamic rendering | Static markup only (C2) |
| Finance hidden for permitted users, or shown to others | Visibility goes through one function; employee-mock test kept |
| Employee sidebar regresses | Separate admin key; scoped CSS; employee smoke test |
| Duplicate IDs (avatar, badges) | New IDs for rail copies; grep for duplicates before commit |
| `showSection` overreach | Only a guarded `syncFromPage` call added; aliases preserved |
| Global name collisions after concatenation | IIFE, one `window.AdminNav` |
| Breakpoint mismatch | Read `responsive.css`; reuse, don't invent |
| Stale docs mislead the agent | Section 1 notes; no doc edits without approval |

Rollback: each slice is an independent commit series, so `git revert` of a slice restores the previous state without affecting earlier slices.

---

## 8. Prototype usage

The dual-rail prototype is a visual reference only. Match its layout, spacing rhythm, tokens, and interaction feel, not its code.
- Its tab names (Bills, Subscriptions, Statutory under Spend; four Banking tabs) were placeholders. Use section 3 (C17) and Slice 2 for the real ones.
- It omits the topbar page title/subtitle; keep the real topbar (C12).
- It rebuilds navigation with JavaScript; the real implementation must not (C2).
- Confirm Font Awesome 6.5.1 free icon names before use (`fa-people-group`, `fa-coins`, `fa-arrow-trend-up`, `fa-file-signature`, `fa-money-check-dollar`).

---

## 9. Agent operating rules for this work

1. State branch, HEAD, merge-base and scope at the start of each slice (branch-intake block).
2. Do not change permissions, RBAC, payroll calculations, bank-detail validation, or any backend file.
3. Preserve element IDs, semantic tokens and layout structures (`AGENTS.md`).
4. No commit, push, PR, or documentation edit without explicit owner approval, even though `AGENTS.md` describes auto-commit and push. Disregard its Google Sheets persistence text; it does not apply to this UI task.
5. End each slice with: outcome, files changed, exact test commands and results, confirmed facts versus assumptions, required decision-log/roadmap updates, and a short handoff.

---

## 10. Open items (none block Slice 0)

- Locate the code that fills `#adminUserAvatar`, `#adminUserName`, `#adminUserRole` (C14).
- Confirm the mobile breakpoint in `responsive.css`.
- Read `06-open-questions.md` and record the result.
- Produce the exact list of specs that reference `#adminSidebar` and the nav selectors (C16).
