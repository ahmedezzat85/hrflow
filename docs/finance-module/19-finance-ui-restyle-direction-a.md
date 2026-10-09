# 19. Finance UI restyle, direction A "Clean Table" (Bills first)

Status: IMPLEMENTED (D-021, 2026-10-09; branch feature/finance-ui-restyle-a, Bills page only). Visual restyle only; bill workflow (D-016 to D-020) is unchanged.

Visual reference (direction A and the real "Today" screenshots): https://claude.ai/artifact/VRNNo1BR7vVJpBa258bwoC
Other directions explored and not chosen: B Compact Ledger, C Soft Cards, D Structured Workbench (same canvas).

## Owner decisions (all closed, 2026-10-09)
1. Direction A "Clean Table".
2. Replace FUX-414's pill + "Change view" layout with an always-visible status pill row (explicit owner override of FUX-414's "exact and only approved layout").
3. Keep the FUX-415 density setting; Regular stays the default; the three density class definitions are not changed.
4. No icons on in-page tabs and text buttons. Icons stay in the sidebar, search box, filter button and row "more" menu.
5. Status pill row below about 1300 px wide: wrap to a second line.
6. Scope: Bills only. Sales invoices are out of scope (no invoice restyle, no invoice acceptance criteria). Shared CSS is used by invoices too, so scope changes to Bills selectors where practical and check the invoices page once for regressions only.
7. Keep the year in table dates (e.g. "30 Sep 2026").
8. Two solid blue primaries (top bar "Add transaction" and page-level "Record bill") are accepted. Do not change the top bar.
9. Work in the owner's current working directory: **no git worktrees and no separate clone**. Start from `main` with a clean tree (stop and ask if it has uncommitted changes), then create and switch to a new branch `feature/finance-ui-restyle-a` in that same directory.
10. Order (added 2026-10-09): start only after bill slice **B5** (`18-bill-workflow-v2.md`) is merged into `main`. B1 to B5 build the bill behaviour in today's visual style (statuses, approval actions, payment fields, drafts, status filter values); this restyle then changes only the look of those screens. The status filter is therefore built once in B5 and restyled once here.

## Code map (verified read-only on 2026-10-09 at `main` 6aa8289)
- Markup: `fe/src/partials/admin/sections/finance-bills.html`. Header actions `#financeAddVendorBtn`, `#financeCaptureBillBtn`, `#financeRecordBillBtn`; search `#financeBillSearch`; filter `#financeBillFilterToggleBtn`. FUX-414: `#financeBillStatusToggleBar`, `#financeBillActiveStatusPill`, `#financeBillActiveStatusLabel`, `#financeBillActiveStatusCount`, `#financeBillViewResultCount`, `#financeBillChangeViewBtn`, hidden panel `#financeBillStatusPanel` containing `#financeBillWorkQueueTabs` with tabs `#tabBillQueue{All,Draft,PendingApproval,Rejected,Approved,Scheduled,PartiallyPaid,Paid,Void}` and badges `#badgeBillQueue*`. Inline styles and Font Awesome icons are used throughout.
- Behaviour: `fe/public/js/finance-bills.js` (`setBillWorkQueue(...)`), `finance-core.js`.
- Styles: `fe/src/styles/tokens.css`, `components.css` (density classes `.density-compact|regular|spacious` near line 1317), `modules/finance.css`, `modules/invoices.css`.
- Specs (`fe/tests/ui/`): `finance-bill-status-tab-bar`, `finance-bill-collapsible-filters`, `finance-density-settings`, `finance-table`, `finance-bills-inbox`, `finance-bills-approval`, `finance`, also `component-language`, `finance-dialogs-forms`, `finance-drawer`, `finance-context-kpis`.
- Related docs: 16 (FUX-414), 17 (FUX-415), 18 (bill workflow v2).
- Unverified, confirm in Slice 0: what renders table rows and pills (likely `finance-bills.js`), whether an Overdue control exists, dark-theme token usage, exact spec selectors, whether specs assert the hidden state of `#financeBillStatusPanel`.

## Rules for the implementer
- Visual restyle only. No API, schema, backend, permission or workflow change.
- Preserve every element ID, handler name and `role`/`aria-*` contract unless a slice says otherwise. Prefer moving inline styles into classes in `finance.css` without renaming IDs.
- Use tokens from `tokens.css`; light and dark must both work. Every text/background pair at least 4.5:1 (Void status uses `--text2`, not `--text3`).
- Do not change the FUX-415 density class definitions; rows must still respond to the Density setting.
- One slice per commit, each shippable alone. Run the Bills-related specs after each slice. Stop and ask the owner on any unresolved product question; check `docs/project-context/06-open-questions.md` first.

## Slices

**Slice 0, intake (no UI change).** Confirm B5 is merged into `main`; if not, stop and tell the owner. In the current working directory, update `main` (`git pull --ff-only`) and create the branch with `git switch -c feature/finance-ui-restyle-a` (no worktree). Run the Bills-related specs and the full UI suite; record exact baseline results. List the JS that renders rows, pills, flags and the status filter, and the selectors each affected spec uses. Capture before-screenshots of the Bills page (light, dark, three densities).

**Slice 1, status pills and flags.** Pills: tinted background, dot, label; Draft dashed outline; Void muted. Flags beside the status as outlined tags: Overdue ("N days late"), Vendor to confirm, Auto-approved. Overdue flag only on owed statuses (Approved, Scheduled, Partially paid); check how overdue is derived today and report any mismatch rather than changing logic. Acceptance: status labels unchanged; colours keep D-016 meaning; contrast at least 4.5:1 in light and dark; pill text never wraps; existing specs pass.

**Slice 2, bills table.** Flat table, single hairline. Cells: vendor over bill number and bill date; category over department; due date with relative note ("8 days late", "Due today") beneath; amount right-aligned with tabular numerals and currency; status cell (pill + flag); one primary row action (Record payment / View / Continue / Review as today) plus the "more" menu. Dates keep the year. Acceptance: first row about 53 px at Regular, about 41 at Compact, about 65 at Spacious (a few px tolerance); no horizontal scroll at 1440 px; the Density setting still switches all three levels; `finance-table` and `finance-density-settings` specs pass.

**Slice 3, status filter row (supersedes FUX-414).** Remove the toggle-bar pill and Change view button from the layout. Show the nine status tabs plus an "Overdue only" control as an always-visible row with counts above the table. Reuse the existing tab IDs and `setBillWorkQueue` behaviour; do not re-implement filtering. Wrap to a second line when narrow. Selected state via `aria-selected`/active class as today; keyboard operable. Keep `#financeBillViewResultCount`. Acceptance: each status returns the same set as today; counts update as today; wraps cleanly at 1100, 1300 and 1440 px; no hidden panel remains; `finance-bill-status-tab-bar` and `finance-bill-collapsible-filters` specs rewritten for the new layout (allowed by the override), other specs unchanged.

**Slice 4, header and toolbar.** Underline sub-nav tabs (Vendor bills, Vendors, Subscriptions, Statutory); text buttons without icons ("Add vendor", capture/upload bills, solid "Record bill"); search and filter keep their icons. Top bar unchanged. Acceptance: no Font Awesome icon in the three action buttons or the sub-nav tabs; wraps cleanly when narrow; handlers and IDs unchanged.

**Slice 5, summary cards and dialog.** Restyle only: card surface, label/value hierarchy, spacing; dialog header, sectioned fields, footer actions. Field set, order, validation and "Add another after saving" unchanged. Acceptance: `finance-dialogs-forms` and bill dialog specs pass; focus trap and Escape unchanged.

**Slice 6, dark theme and regression.** Verify every slice in dark; run the full UI suite; open the Sales invoices page once to confirm nothing broke (no restyle). Compare after-screenshots with the canvas direction A boards.

**Slice 7, docs.** Already done on 2026-10-09: decision D-021 added to the decision log, Q-014 recorded as resolved in the open questions, docs 16 and 18 and the roadmap row updated. At the end of implementation only change this doc's status to IMPLEMENTED and confirm the other docs still match.

## Handoff the implementer must produce
Outcome per slice; files changed; tests run with exact results (baseline vs final); confirmed facts vs assumptions; any selector or spec that had to change; before/after screenshots; remaining open questions.
