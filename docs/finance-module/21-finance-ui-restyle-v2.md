# 21. Finance UI restyle v2: colour direction on every Finance page (UI only)

Status: **APPROVED by the owner on 10 Oct 2026 (D-027). Not implemented.**
Work type: frontend only (`fe/`). No API, schema, migration, permission or workflow change in this plan.
Companion backend plan (run in parallel by a separate agent): [22-finance-restyle-v2-backend.md](22-finance-restyle-v2-backend.md).
Builds on: [19-finance-ui-restyle-direction-a.md](19-finance-ui-restyle-direction-a.md) (Bills direction A, implemented) and [20-finance-review-round-2.md](20-finance-review-round-2.md) (F1 to F6, implemented).

---

## 0. Read this first: how to follow this plan without drifting

The previous restyle (doc 19) drifted from the approved design in places. This plan is written so that does not happen again. Rules 0.1 to 0.6 are mandatory.

**0.1 The approved design is in the repository.** Folder `docs/finance-module/mocks/restyle-v2/`:

| File | What it is |
| :--- | :--- |
| `Colour-System.html` / `.png` | Colour rules, tokens and identity colours (the "why") |
| `Color-<Page>.html` / `.png` | One approved screen per Finance page (14 files) |
| `Modal-<Name>.html` / `.png` | One approved dialog each (10 files) |

- The **PNG** shows what the screen must look like. Open it with your image Read tool before you touch a page.
- The **HTML** holds the exact values (every colour, size, radius, padding and font weight is an inline style). When a number is not in this plan, read it from the HTML. Do not guess.
- Both were exported from the owner-approved design canvas (private; only the owner can open it: https://claude.ai/artifact/EnZ9wWfyHMyfPbrXtkeZdW, "Prototype tour"). You cannot open that link; do not try. The repository files are the reference.
- The mock screens are drawn at **1140 px wide**, i.e. the main content area without the left sidebar. Compare at a browser width where the main area is about 1140 px (a 1440 px viewport with the sidebar open).
- Mock data (names, amounts, dates, "Teleradiology reads", "[SIGNER NAME]", "[CHECK]") is illustrative. Never hard-code it.
- Fonts: the PNGs were rendered without the Sora webfont, so headings in the PNGs use a fallback face. The app keeps Sora for headings (`--font-head`). Trust the HTML for fonts.

**0.2 Precedence when sources disagree.**
1. This plan's explicit rules and the per-page "Keep / Change" lists (§6, §7).
2. The reference PNG/HTML.
3. The existing code's behaviour, element IDs, handlers and `aria-*`.
If a reference shows a control that has no behaviour today, do not build new behaviour: keep the existing control in that place, styled like the reference, and report it. If the code has a control the reference does not show, keep it, style it with the nearest reference pattern, and report it.

**0.3 Never invent design.** No new colours, shadows, gradients, radii, font sizes, icons-in-buttons, uppercase text, borders or copy that are not in the references or this plan. Do not "improve" the design. If something looks wrong, stop and ask the owner.

**0.4 Visual check per page (mandatory, every slice).**
1. Before coding: Read the page's PNG; copy its "Must match" checklist (§6/§7) into your slice notes.
2. After coding: `npm run build`, open `/?mock=admin`, navigate to the page, take a screenshot of the main area at the reference width (and one in dark theme). Save screenshots in a gitignored temp folder (for example `fe/test-results/restyle-v2/`), never commit them.
3. Put your screenshot next to the reference PNG and tick each checklist item. List every remaining difference in the slice report with a reason. Unexplained differences are defects.

**0.5 Mechanical guards (mandatory, every slice).**
- Token lint: no raw colour literals in Finance JS or partials and none in `finance-v2.css` outside the token block. Run, from `fe/`:
  `git diff main --unified=0 -- public/js/finance-*.js src/partials src/styles/modules/finance-v2.css | grep -E "^\+" | grep -E "#[0-9a-fA-F]{3,8}\b|rgba?\(" `
  Any hit outside `tokens.css` must be removed (use a token or a `fv-` class).
- Structural spec: `fe/tests/ui/finance-restyle-v2.spec.js` (created in Slice 1, extended every slice) asserts computed styles for each restyled page (§5). It must pass before each commit.

**0.6 Mistakes seen in the last restyle. Do not repeat them.**
- Stacking new CSS on top of old rules so two definitions fight (doc 19 left duplicate `.bill-*` and `#tabBillQueue*` blocks). Replace, do not layer.
- Restyling global classes (`.btn`, `.badge`, `.card`, `.filter-tab`) and changing HR or Payroll screens by accident. Everything new lives under the `.fv` scope (§4).
- A grey table header. The header row is **white** (owner decision, this plan).
- Pure black (`--text #141e30`) for names and amounts. Use `--ink-strong` (navy).
- Icons inside text buttons and tabs; uppercase or letter-spaced headers; sort icons on every column.
- Changing Bills' approved UX (column order, button places, inline icon actions). Bills gets new colours and sizes only.
- Moving element IDs or renaming handlers, which broke specs.

---

## 1. Decisions in this plan (owner, 10 Oct 2026, D-027)

1. Colour direction approved for **all six Finance sidebar items** (Overview, Sales, Spend, Banking, Reports & Export, Finance Settings), their tabs, dialogs and drawers.
2. Navy ink replaces black: the darkest text is the deep end of the login gradient.
3. Brand blue is the colour of anything clickable or identifying: record IDs, active tab, sorted header, selected filter pill, card links, outline buttons, footer counts.
4. Eight identity colours, fixed order, validated for colour-blind separation in light and dark (§3.3). Used for avatars (vendors, customers, accounts), category dots, area icons and, later, chart series.
5. One area colour per Finance area: Overview blue, Sales teal, Spend orange, Banking sky, Reports violet, Settings blue-slate.
6. Table header row is white on every Finance table (Bills changes from its tinted header).
7. Summary cards use direction C "soft cards" (label + coloured icon tile, 26 px number, one line + link). The login gradient appears on at most one card per page (Overview "Cash balance").
8. **Bills keeps its approved UX** (doc 19 §12): same column order, button places, inline icon row actions, switch. Only colours, sizes and the header colour change.
9. **Row actions everywhere follow Bills:** at most one text button (only when an action is needed) plus up to three small icon buttons. No "⋯" menus. The exported references already show this.
10. Button sizes inside Finance: page and toolbar buttons 32 px, table-row buttons 28 px, dialog footer buttons 34 px, dialog fields 36 px, top-bar "Add transaction" 30 px.
11. Payroll Runs and Payroll Settings are **out of scope** (separate plan later).
12. Light theme is approved as drawn; dark theme uses the dark values in §3 and must pass contrast checks.
13. Prototype-only behaviour is not built: clicking a page title to go back to Overview (the real app has the sidebar), the tour bar.

---

## 2. Scope

**In scope** (section roots, all in `fe/src/partials/admin/sections/`):

| Area | Section(s) | Reference |
| :--- | :--- | :--- |
| Overview | `#a-finance-dashboard` (finance-dashboard.html) | `Color-Overview` |
| Sales | `#a-finance-invoices` invoices view and customers view, customer 360 drawer | `Color-Invoices`, `Color-Customers` |
| Spend | `#a-finance-bills` (bills + vendors views), `#a-finance-subscriptions`, `#a-finance-statutory` | `Color-Bills`, `Color-Vendors`, `Color-Subscriptions`, `Color-Statutory` |
| Banking | `#a-finance-accounts` (accounts, ledger workspace, statements, reconciliation workspace, cheques, transfers) | `Color-Accounts`, `Color-Ledger`, `Color-Statements`, `Color-Cheques`, `Color-Transfers` |
| Reports | `#a-finance-reports` (library and report pages) | `Color-Reports` |
| Settings | `#a-finance-settings` (categories, payment types, display) | `Color-Settings` |
| Top bar | `#adminPageTitle` area only, on Finance pages | every `Color-*` |

**Dialogs and drawers in scope** (`fe/src/partials/modals/` unless noted). Mocked ones are matched to their reference; all others follow the dialog rules in §3.6 and the nearest reference named here:

| Dialog / drawer | Reference |
| :--- | :--- |
| `#billModal` (new/edit bill) | `Modal-NewBill` |
| `#billApprovalModal` | `Modal-BillApproval` |
| `#billPaymentModal` | `Modal-PayBill` |
| `#billVoidModal` | `Modal-VoidBill` |
| `#billScheduleModal` | rules; nearest `Modal-PayBill` |
| `#invoiceModal` | `Modal-NewInvoice` |
| `#invoicePaymentModal` (title becomes "Record receipt") | `Modal-Receipt` |
| `#financeTransactionModal` | `Modal-Transaction` |
| `#financeTransferModal` | `Modal-Transfer` |
| `#financeChequeModal` | `Modal-Cheque` |
| `#financeChequeActionModal`, `#financeChequeReplaceModal`, `#financeWithdrawCashModal` | rules; nearest `Modal-Cheque` / `Modal-VoidBill` (exceptions) |
| `#statutorySettleModal` (finance-statutory.html) | `Modal-Remittance` |
| `#statutoryConfirmModal`, `#statutoryRecordModal` | rules; nearest `Modal-Remittance` |
| `#subscriptionModal`, `#subscriptionChargeModal`, `#subscriptionHistoryModal` (finance-subscriptions.html) | rules; nearest `Modal-PayBill` |
| `#vendorModal`, `#customerModal`, `#companyBankAccountModal`, `#financeCategoryModal`, `#financePaymentTypeModal` | rules; nearest `Modal-NewBill` (two-column form) |
| `#financeStatementUploadModal`, `#financeReconciliationModal` and its sub-dialogs | rules; tables inside follow §3.5 |
| `#financeConfirmModal` | rules; nearest `Modal-VoidBill` |
| report modals (`#reportDrilldownModal`, `#saveReportViewModal`, `#scheduleReportExportModal`, `#reportDeliveriesAndAuditsModal`) | rules |
| `#financeDetailDrawer` (finance-detail-drawer.html), customer 360 drawer | rules: drawer head like a dialog head, body cards like the record summary card |

**Out of scope:** Payroll (`#a-finance-payroll`, `payroll.css`, payroll modals), all HR pages and HR "salary payment docs" (`invoices.js`, `bulk-invoice-modal`, `invoice-period-modal`, `regenerate-invoice-modal`), the sidebar and module rail, login, the global export modal and command palette, global classes outside `.fv`, any backend file.

---

## 3. Design specification (exact values)

All values below are already in the reference HTML. Implement them as tokens and `fv-` classes; never as inline styles in JS.

### 3.1 Tokens to add to `fe/src/styles/tokens.css`

Add these new variables in the light `:root` block and in the existing dark block (same selectors the file already uses for dark). Do **not** change existing tokens (`--text`, `--accent`, etc.): HR and Payroll still use them.

| Token | Light | Dark | Use |
| :--- | :--- | :--- | :--- |
| `--ink-strong` | `#16245e` | `#e9eeff` | titles, names, amounts, numbers |
| `--ink-body` | `#2b3a5c` | `#c9d2e8` | normal text |
| `--ink-label` | `#4b5c92` | `#a9b6dc` | table headers, field labels, inactive tabs, secondary text in buttons |
| `--ink-muted` | `#5d6b8f` | `#8f9ab1` | second lines, hints, footers |
| `--ink-faint` | `#8f9cc2` | `#6b7891` | "–" placeholders, dashed draft border, zero-state dots (never for text that must be read) |
| `--fv-canvas` | `#f4f6fd` | `#0f1117` | Finance page background |
| `--fv-surface` | `#ffffff` | `#171a24` | cards, tables, dialogs |
| `--fv-surface-soft` | `#f7f9ff` | `#1d2130` | record summary cards, impact tiles, attach row, hover row |
| `--fv-dialog-foot` | `#fbfcff` | `#1a1e2b` | dialog footer |
| `--fv-line` | `rgba(32,86,232,.10)` | `rgba(160,180,230,.12)` | card and table borders |
| `--fv-line-strong` | `rgba(32,86,232,.12)` | `rgba(160,180,230,.18)` | header rule, tab rule |
| `--fv-line-row` | `rgba(32,86,232,.07)` | `rgba(160,180,230,.08)` | row separators |
| `--fv-input-border` | `rgba(32,86,232,.18)` | `rgba(160,180,230,.22)` | inputs, selects |
| `--fv-outline` | `rgba(32,86,232,.22)` | `rgba(143,176,255,.35)` | outline buttons |
| `--brand` | `#2056e8` | `#3566ef` | primary buttons, selected pill, active tab line |
| `--brand-ink` | `#1a46bd` | `#9db8ff` | text on brand tint, outline button text |
| `--brand-text` | `#2056e8` | `#8fb0ff` | links, IDs, active tab text, sorted header |
| `--brand-tint` | `#e8eeff` | `rgba(53,102,239,.22)` | approved/sent pills, selected choice |
| `--brand-wash` | `rgba(32,86,232,.08)` | `rgba(53,102,239,.14)` | outcome banners |
| `--fv-scrim` | `rgba(22,36,94,.42)` | `rgba(5,8,20,.6)` | dialog backdrop |
| `--fv-shadow-card` | `0 1px 3px rgba(20,50,120,.05)` | `0 1px 3px rgba(0,0,0,.3)` | cards, tables |
| `--fv-shadow-dialog` | `0 24px 60px rgba(16,30,80,.28)` | `0 10px 40px rgba(0,0,0,.55)` | dialogs |
| `--fv-shadow-pill` | `0 2px 6px rgba(32,86,232,.25)` | `none` | selected filter pill |
| `--brand-gradient` | `linear-gradient(155deg,#2a5df0 0%,#2056e8 38%,#1a2f9c 100%)` | `linear-gradient(155deg,#1f48c4 0%,#1a38a0 38%,#101b5c 100%)` | Overview hero card only (same stops as `#login-screen`) |

### 3.2 Status colours (existing meaning, new pairs)

Status pills keep the D-016/D-022 meaning. Text colour on its tint (light / dark):

| Group | Statuses | Text | Background |
| :--- | :--- | :--- | :--- |
| Draft | draft | `--ink-label` | `--fv-surface` with `1px dashed var(--ink-faint)`, dot `--ink-faint` |
| Waiting | pending approval, estimated, needs review, awaiting second leg, notice due | `--warning` | `--warning-soft` (light `#fdf0e1`) |
| Open | approved, sent, issued, accrued | `--brand-ink` | `--brand-tint` |
| Planned | scheduled | violet ink | violet tint |
| Part-settled | partially paid | teal ink | teal tint |
| Settled | paid, cleared, remitted, reconciled, active | `--success` | `--success-soft` (light `#e3f5ec`) |
| Problem | rejected, bounced, urgent | `--danger` | `--danger-soft` (light `#fde8e8`) |
| Closed | void, inactive, closed, stopped | `--ink-label` | light `#eef1f8` / dark `rgba(160,176,198,.15)` |

Every pill has a 7 px dot in its text colour before the label. Contrast of text on background must be at least 4.5:1 in light and dark (extend `finance-bills-contrast.spec.js` to the new pages).

### 3.3 Identity colours (8, fixed order)

Use for vendor/customer/account avatars, category dots, area tiles and future chart series. **Never** for status meaning. Never cycle past slot 8 in charts (fold into "Other"); avatars may reuse by `id` modulo 8.

| Slot | Name | Light mark | Light ink (text on tint) | Dark mark | Dark ink | Token names |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | blue | `#2056e8` | `#1a46bd` | `#4f80f2` | `#9db8ff` | `--id-blue`, `--id-blue-ink` |
| 2 | orange | `#e0701f` | `#b2560f` | `#d6742b` | `#f3a467` | `--id-orange`, `--id-orange-ink` |
| 3 | teal | `#0f9d8c` | `#0b7a6d` | `#1f9d8e` | `#5fd0c0` | `--id-teal`, `--id-teal-ink` |
| 4 | violet | `#7c4ddb` | `#6236c0` | `#8f6fe8` | `#b9a2ff` | `--id-violet`, `--id-violet-ink` |
| 5 | green | `#3f9a3c` | `#2f7a2d` | `#4fa24c` | `#7ccf78` | `--id-green`, `--id-green-ink` |
| 6 | pink | `#d14d86` | `#ad3469` | `#d55f92` | `#f394bc` | `--id-pink`, `--id-pink-ink` |
| 7 | sky | `#1b8fd0` | `#146fa3` | `#3f98d0` | `#7cc6f2` | `--id-sky`, `--id-sky-ink` |
| 8 | ochre | `#b98000` | `#8a6000` | `#b98a22` | `#e3bd5a` | `--id-ochre`, `--id-ochre-ink` |

Tint = the mark at 14% opacity in light (`color-mix(in srgb, var(--id-x) 14%, transparent)`) and 18% in dark. Light and dark sets both pass the colour-blind validator (adjacent pairs ΔE ≥ 8, lightness band, 3:1 against the surface).

Assignment:
- **Vendors, customers, accounts:** `slot = ((id - 1) mod 8) + 1` (stable per record). A helper does this (§4.2); never pick colours by hand.
- **Categories:** use `category.color` when the backend provides it (doc 22, BE-1); otherwise fall back to `slot = (index of the category in sort order mod 8) + 1`. "Other" and inactive categories use `--ink-faint`.
- **Areas:** Overview blue, Sales teal, Spend orange, Banking sky, Reports violet, Settings uses `--ink-label` on `rgba(75,92,146,.12)`.
- **Statutory source tile:** payroll = sky, sales VAT = teal, bill WHT = orange (initials PR / VT / WH).

### 3.4 Type, spacing and sizes

| Element | Spec |
| :--- | :--- |
| Page background | `--fv-canvas`; page padding `16px 28px`; vertical gap between blocks `14px` |
| Top bar (Finance pages only) | Keep every existing top-bar button. Before `#adminPageTitle` show the area tile (30×30, radius 9, area tint, area ink, 16 px icon); title Sora 16/700 `--ink-strong`; after it the area name 12.5 px `--ink-muted`. "Add transaction" (`#adminQuickAddTxBtn`) height 30, radius 8, 12.5/600, no icon on Finance pages |
| Sub-nav tabs | Underline tabs, no icons. Item padding `9px 12px`, 14 px. Active 600 `--brand-text` with 2 px `--brand` bottom border; inactive 500 `--ink-label`. Row has a 1 px `--fv-line-strong` bottom rule. Header controls sit on the same row, right-aligned, `padding-bottom: 8px` |
| Header controls | Height **32**, radius 8, 13 px/600. Primary: `--brand` bg, white text, padding `0 14px`. Outline: `--fv-surface` bg, `1px solid var(--fv-outline)`, `--brand-ink` text, padding `0 12px`. Search: 32 high, 14 px icon, `--fv-input-border`, placeholder `--ink-muted`. Selects 32 high. **One primary per page view** |
| Filter pills | Height **28**, radius 999, padding `0 11px`, 12.5/600, gap 6, 7 px dot, count 500 at 75% opacity. Selected pill: `--brand` fill, white text, count in a capsule `rgba(255,255,255,.22)`, `--fv-shadow-pill`. Unselected: status tint/ink (status filters) or `--fv-surface` + `1px solid var(--fv-input-border)` + `--ink-label` (non-status filters). Zero count: 55% opacity, still clickable. Toggles ("Overdue only", "Notice due only", "Petty spend only") sit at the right end of the pill row; count badge 11.5/700 in the matching status tint |
| Summary card (C) | Padding `16px 18px`, radius 14, `1px solid var(--fv-line)`, `--fv-shadow-card`, gap 10. Row 1: label 12.5/600 `--ink-label` + tile 30×30 radius 9 (identity tint/ink, 16 px icon). Row 2: value Sora 26/700 `--ink-strong`, tabular numbers; non-dollar currency prefix 14/600 `--ink-muted` (for example `EGP 470,000.00`). Row 3: note 12.5 `--ink-muted` left, link 12.5/600 `--brand-text` "Label ›" right. Whole card is the link. Grid of 4 with gap 14 |
| Hero card | Overview "Cash balance" only: `--brand-gradient`, white text (labels at 88% opacity), tile `rgba(255,255,255,.18)`, shadow `0 8px 22px -10px rgba(32,86,232,.65)` |

### 3.5 Tables

| Part | Spec |
| :--- | :--- |
| Card | `--fv-surface`, `1px solid var(--fv-line)`, radius 14, `--fv-shadow-card`, `overflow:hidden` |
| Header row | **White** (`--fv-surface`), 12/600 `--ink-label`, padding `12px 16px` first cell, `12px` others, bottom `1px solid var(--fv-line-strong)`. No uppercase, no letter-spacing. Sort arrow (↓/↑) only on the sorted column, which is `--brand-text`. Actions header is visually hidden text "Actions" |
| Rows | Padding 9 to 11 px vertical (Regular density ≈ 52 to 56 px row with a two-line cell); bottom `1px solid var(--fv-line-row)`; hover `--fv-surface-soft`. FUX-415 density still applies |
| Primary cell | Avatar 32×32 radius 10 (identity tint, ink initials 12/700) + line 1 name 600 `--ink-strong` + line 2 12 px: record ID as `--brand-text` 600 link, or descriptor in `--ink-muted` |
| Text cells | 14 px `--ink-body`; second line 12 px `--ink-muted` |
| Category | 8×8 radius 3 dot (category colour) + name |
| Dates | `1 Sep 2026` (keep the year). Note line 12/600: late = `--danger` ("10 days late"), warning = `--warning` ("Notice due", "Low confidence 70%"), info = `--ink-muted` ("Due in 41 days") |
| Amounts | Right-aligned, 700 `--ink-strong`, tabular numbers, never green or red. Non-dollar currency as a muted 12/600 prefix. Optional line 2 12 px `--ink-muted` ("of $11,000.00") with a 44×5 progress bar (teal fill on `--brand-tint`) for part-paid. Outflows in ledgers use a minus sign `−4,200.00`, still `--ink-strong` |
| Status cell | Status pill (§3.2) at padding `3px 10px`, 12/600 |
| Row actions | Right-aligned, no wrap. At most one text button, height **28**, radius 8, 12.5/600 (filled `--brand` when it moves the record forward: Pay, Approve, Submit, Record receipt, Confirm, Remit, Reconcile, Mark cleared, Log charge; outline otherwise). Then up to three icon buttons 30×30, radius 8, transparent, `--ink-muted`, 15 px icon, hover background `--fv-line`. Rows with nothing to do show icons only. **No "⋯" menu.** Actions that do not fit stay reachable from the record's detail drawer or dialog |
| Footer | Padding `10px 16px`, 12.5 `--ink-muted`: "Showing **1–7** of **7** bills" (numbers 700 `--brand-text`), page-size select 28 high on the right. Optional totals in 700 `--ink-strong`. Only one record count per table (no extra count above the table) |
| Empty state | One line `--ink-muted` plus the page's primary action button |

### 3.6 Dialogs and drawers

| Part | Spec |
| :--- | :--- |
| Backdrop | `--fv-scrim` |
| Panel | `--fv-surface`, radius 18, `--fv-shadow-dialog`. Width: 520 (confirm, void, danger), 600 to 620 (single-record actions), 680 to 760 (forms) |
| Head | Padding `16px 22px`, bottom `1px solid var(--fv-line)`. Tile 36×36 radius 11 in the **area** colour (red danger tile `--danger-soft`/`--danger` for void/delete), 18 px icon. Title Sora 17/700 `--ink-strong`; subtitle 12.5 `--ink-muted`. Close button 32×32, `--ink-label` |
| Body | Padding `16px 22px`, gap 14 to 16. Section title 13/700 `--ink-strong`, no icon, no rule line |
| Fields | Label 12.5/600 `--ink-label`, gap 5. Inputs/selects height **36**, radius 9, `1px solid var(--fv-input-border)`, 14 px `--ink-strong`. Grid 2 columns, gap `12px 16px` (3 columns for dense header rows such as the invoice). Amount = currency select/label (78 px, `--fv-surface-soft`) joined to a right-aligned 600 amount input |
| Record summary card | Padding 14, radius 14, `--fv-surface-soft`, `1px solid var(--fv-line)`: avatar 40 radius 12, name + ID line, amount on the right (Sora 22/700) with its status pill or "late" note |
| Choice bar | Replaces radios and two-or-three-way selects where the reference shows it: buttons 36 high, radius 9 to 10; selected = `1.5px solid` hue + tint + hue ink (brand by default; orange for "Money out" / "Pay a vendor bill"; green for "Approve"); unselected = `--fv-surface`, `--fv-input-border`, `--ink-label`. Keep the underlying inputs, IDs and handlers (same technique as `.bill-seg`) |
| Impact tiles | Three tiles ("Account now" / "This payment" / "After"), radius 12, `--fv-surface-soft`; middle tile uses the direction tint. Only when the balance is already known on the client; otherwise omit |
| Outcome banner | Padding `9px 12px`, radius 11, `--brand-wash` (teal wash on receipts), 13 px `--ink-strong`, with the resulting status pill inline ("Saves as **Paid** and posts …") |
| Footer | Padding `12px 22px`, top `1px solid var(--fv-line)`, `--fv-dialog-foot` background. Left: secondary actions (outline, 34 high) and checkboxes. Right: Cancel (text button, `--ink-label`) then the primary (34 high, padding `0 16px`, radius 9). Danger primary uses `--danger` background |
| Drawers | Same head as dialogs; body sections are record summary cards and §3.5 tables |

### 3.7 Icons

Font Awesome stays the icon set (the references use simple SVG lookalikes). Map: bank `fa-building-columns`, money in `fa-arrow-down`, money out `fa-arrow-up`, net result `fa-chart-column`, waiting `fa-clock`, document `fa-file-lines`, done `fa-check`, variance `fa-plus-minus`, transfer `fa-right-left`, reconcile `fa-square-check`, overview `fa-grip`, settings `fa-sliders`, cheque `fa-money-check`, attach `fa-paperclip`, edit `fa-pen`, view `fa-eye`, deactivate `fa-power-off`, approval `fa-shield-halved`, void `fa-ban`, history `fa-clock-rotate-left`. No icons in tabs or text buttons (D-021 stays).

---

## 4. Engineering rules

**4.1 One scoped component layer.**
- New file `fe/src/styles/modules/finance-v2.css`, imported in `fe/src/styles.css` right after `finance.css`.
- Add the class `fv` to the root of every in-scope section (`#a-finance-dashboard`, `#a-finance-invoices`, `#a-finance-bills`, `#a-finance-subscriptions`, `#a-finance-statutory`, `#a-finance-accounts`, `#a-finance-reports`, `#a-finance-settings`) and to the overlay root of every in-scope dialog and drawer (§2). Never to `#a-finance-payroll`.
- Every new selector starts with `.fv` and uses `fv-` class names. Suggested components: `fv-subnav`, `fv-head-actions`, `fv-pills`, `fv-pill`, `fv-toggle`, `fv-card`, `fv-card--hero`, `fv-cards`, `fv-table-card`, `fv-table`, `fv-cell-main`, `fv-avatar`, `fv-sub`, `fv-dot`, `fv-status`, `fv-amount`, `fv-row-actions`, `fv-icon-btn`, `fv-foot`, `fv-dialog`, `fv-dialog-head`, `fv-tile`, `fv-field`, `fv-choice`, `fv-summary`, `fv-impact`, `fv-outcome`.
- Button sizes are set inside `.fv` only (`.fv .btn` 32, `.fv .btn-sm` and `.fv-row-actions .btn` 28, `.fv-dialog .modal-footer .btn` 34). Do not edit the global `.btn` rules.
- When a page moves to `fv` classes, **delete** the old page-specific rules it no longer uses (for Bills: the `.bill-*`, `.clean-table-card`, `.bill-status-tabs`, `#tabBillQueue*` overrides that `fv` replaces). Keep rules that other pages still use. No duplicate definitions.

**4.2 One JS helper set.** Add `FinanceUI` to `fe/public/js/finance-core.js` (next to `FinanceFormat`) and use it in every renderer instead of inline style strings:
- `FinanceUI.hueForId(id)` → `"blue" | "orange" | …` (§3.3 rule); `FinanceUI.hueForCategory(category, sortedCategories)`.
- `FinanceUI.initials(name)` → two letters.
- `FinanceUI.avatar(name, hue)`, `FinanceUI.dot(hue)`, `FinanceUI.statusPill(group, label)`, `FinanceUI.areaTile(area, iconClass)`.
- `FinanceUI.dateCell(date, note, tone)`, `FinanceUI.amountCell(amount, currency, subText)`.
- `FinanceUI.rowActions({ primary, icons })` returning the §3.5 markup.
All of them return class-based markup, escape text with `FinanceFormat.escapeHtml`, and contain no colour literals.

**4.3 Keep behaviour.** Preserve element IDs, `onclick` handler names, `role`/`aria-*`, data attributes and filtering logic. Restyle by changing classes and markup structure around the same elements. Behaviour changes are limited to the "Change" items listed per page in §6 and §7 (all of them are UI-level: control type, layout, client-side counts or sums). If a change would need a new API field, use the doc 22 contract (§8) with a fallback.

**4.4 Mock mode.** Update `fe/api/finance/*.js` and rebuild `fe/finance-api.js` (`npm run build`) so mock mode shows every restyled state, including the doc 22 fields (§8). Fix mock data that contradicts itself (the Voyance Operating USD account says 150,000.00 while its ledger runs to 145,800.00 after a 4,200.00 payment).

**4.5 Tests.** Update existing specs only where a selector or text legitimately changed, and say which ones in the slice report. Extend `finance-restyle-v2.spec.js` with checks per page:
- header row `background-color` = surface white (light) and `text-transform: none`;
- a page primary button height 32 and a row button height 28;
- amounts use `--ink-strong`;
- a selected filter pill uses `--brand`;
- no `.fa` inside `.fv-subnav` or inside text buttons;
- dialog field height 36 and footer button height 34;
- the token lint of §0.5 (as a script or an npm task).
Run `finance-bills-contrast.spec.js`, extended to every new page, in light and dark.

**4.6 Git workflow (owner rule).** One branch for the whole plan: `feature/finance-ui-restyle-v2`, created from an up-to-date `main` **in the current working directory** (no worktrees, no second clone). Slices run back to back; after each slice: targeted specs pass, `git add` only relevant files, one commit `feat(finance-ui): S<n> <summary> (D-027)`, `git push`. Open a draft PR into `main` after the first push and keep it updated. Do not merge. Never commit screenshots, test output or `implementation_plan.md`.

---

## 5. Slices (run in order, one commit and push each)

| Slice | Content | Pages / dialogs |
| :--- | :--- | :--- |
| S0 | Intake: branch, baseline tests, before-screenshots, code map | none |
| S1 | Foundations: tokens, `finance-v2.css`, `FinanceUI` helpers, `fv` scope, top-bar area tile, button sizes, structural spec skeleton | all Finance pages get the canvas background and top bar only |
| S2 | Spend I: Bills, Vendors and the bill dialogs | `Color-Bills`, `Color-Vendors`, `Modal-NewBill`, `Modal-BillApproval`, `Modal-PayBill`, `Modal-VoidBill`, schedule, vendor dialog |
| S3 | Spend II: Subscriptions, Statutory and their dialogs | `Color-Subscriptions`, `Color-Statutory`, `Modal-Remittance`, statutory confirm/record, subscription dialogs |
| S4 | Sales: Invoices, Customers, customer 360 drawer, invoice and receipt dialogs, customer dialog | `Color-Invoices`, `Color-Customers`, `Modal-NewInvoice`, `Modal-Receipt` |
| S5 | Banking I: Accounts, Ledger workspace, transaction and account dialogs | `Color-Accounts`, `Color-Ledger`, `Modal-Transaction` |
| S6 | Banking II: Transfers, Cheques, Statements, reconciliation workspace, statement upload, cheque and transfer dialogs | `Color-Transfers`, `Color-Cheques`, `Color-Statements`, `Modal-Transfer`, `Modal-Cheque` |
| S7 | Overview | `Color-Overview` |
| S8 | Reports (library and report pages) and Settings (all three tabs, category and payment-type dialogs) | `Color-Reports`, `Color-Settings` |
| S9 | Sweep: detail drawer, confirm and report dialogs, dark theme pass on every page, contrast spec, cleanup of dead CSS, full regression, docs | all |

**S0 intake (no code change, nothing to commit).**
1. `git status --short` must be clean on `main` (if many files show as modified but `git diff --ignore-all-space --stat` is empty, it is the Windows line-ending artefact: report and continue). Otherwise stop and ask.
2. `git pull --ff-only`, then `git switch -c feature/finance-ui-restyle-v2`.
3. `npm run build`; run the Finance UI specs once and record the exact baseline (pass/fail per spec; some fail today, e.g. `finance-bills-approval`).
4. Before-screenshots of every in-scope page (light and dark) into the gitignored temp folder.
5. Write `implementation_plan.md` (scratch, not committed): for each page the renderer function(s) and partial lines, the specs touching it, and the doc 22 fields it will read. **Show it to the owner and wait for approval** (AGENTS.md High-Risk step 2), then run S1 to S9 back to back without further stops unless §10 applies.

**S1 foundations.** Tokens (§3.1 to §3.3, light and dark), `finance-v2.css` with all `fv-` components from §3.4 to §3.6 (built once, used by S2 onwards), `FinanceUI` helpers (§4.2), `fv` class on in-scope roots, `--fv-canvas` background on Finance pages, top-bar area tile + area name + 30 px "Add transaction" without icon on Finance pages (set by the existing page-title code in `ui.js`; HR pages unchanged), structural spec skeleton and token lint. Acceptance: no visual change on HR or Payroll pages (compare screenshots); Finance pages show the new background and top bar; all baseline specs unchanged.

**S2 to S8.** For each page and dialog listed: follow §0.4, the page's "Must match / Keep / Change" list (§6, §7) and §3. Acceptance per slice: every checklist item ticked or explained; structural spec and contrast spec pass for the slice's pages in light and dark; the specs listed for those pages in S0 pass (or match the baseline); token lint clean; no change to Payroll/HR screenshots.

**S9 sweep.** Remaining drawers and dialogs by rule; dark-theme screenshot of every page and mocked dialog; remove CSS rules made dead by `fv` (search each selector before deleting); full Finance UI suite once; update docs (§9).

---

## 6. Pages: what to match, keep and change

For every page also apply §3 in full. "Ref" is the file in `mocks/restyle-v2/`.

### 6.1 Overview `#a-finance-dashboard`, ref `Color-Overview`
- Must match: no in-page title block and no scope/period/basis/currency chips; one row with the greeting line on the left ("Good morning/afternoon/evening. Here is **<Month YYYY>** so far · updated HH:MM", month in `--brand-text`) and the entity, period, basis and currency selects plus Refresh (outline) on the right; the filter card with the blue left border is gone; 4 summary cards, the first the gradient hero; "Needs attention" card with severity pills (All / Urgent / Warning with counts) in its header; rows: area tile (32, area colour of the record: bills = Spend, invoices = Sales, accounts/transfers/statements = Banking), title 600 + severity pill, one muted line ending with the area name, amount, date, one outline text action, one icon; "Cash forecast" as a table (Window, In with a teal ↓, Out with an orange ↑, Ending cash, Confidence pill) with the "Include subscriptions" checkbox in its header; "Bank vs book" table with account avatars and the formula line under it.
- Keep: all existing data, the severity filter behaviour (the select becomes pills over the same values), the category filter and search of the attention list (place them in the attention card header, left of the pills, 32 px) and the actions Resolve (text button) and Reviewed (check icon). The action labels in the reference ("Transfer", "Pay"…) are illustrative.
- Change: greeting text; forecast cards → table (same numbers); hero card.

### 6.2 Sales invoices (invoices view), ref `Color-Invoices`
- Must match: Sales sub-nav "Invoices / Customers" as underline tabs with search and "New invoice" on the right; one pill row with the F1 statuses (All, Draft, Sent, Partially paid, Paid, Void) and an "Overdue only" toggle with count on the right; columns Invoice (customer avatar, name, invoice number link), Issued, Due (late note), Route (channel, receiving account muted), Status, Balance (bold + "of total" + progress bar), actions; row action "Record receipt" + icons; footer with outstanding total.
- Keep: invoice filtering logic and IDs (`#financeInvoiceSubNav` etc.); every row action that exists today stays reachable (up to 3 icons, the rest from the invoice view/edit dialog).
- Change: remove the "Open (Active)" dropdown and the "Filters: Status" chip row (the pill row replaces both; default selection All; "Open", "Awaiting payment" and "Overdue" stop being tabs); rename the row action "Pay" to "Record receipt"; outstanding total computed client-side **per currency** from the loaded rows, never summed across currencies.

### 6.3 Customers (Sales, customers view), ref `Color-Customers`
- Must match: same tabs (Customers active), "Add customer" primary; pills All / Active / Inactive / With late invoices; columns Customer (avatar, name, legal name), Contact (email link, phone), Terms (Net N, tax ID muted), Status, Open balance (bold amount + note: "1 open invoice", "1 late, 29 days" in danger, "No open invoices" muted with `–`); action "Invoices" (opens the existing customer 360 drawer) + icons.
- Keep: customer 360 drawer and its handler `openCustomer360Drawer`; no underlined names; no "View 360" button.
- Change: open balance and late counts come from doc 22 BE-2 fields; until they exist show `–` and hide the "With late invoices" pill (feature-detect the field).

### 6.4 Vendor bills (Spend, bills view), ref `Color-Bills`
- **Bills UX is frozen** (doc 19 §12). Keep column order (Bill, Bill date, Category, Status, Amount, Actions), the inline icon actions (edit, attachment) plus one text button, row click opens details, the header buttons Add vendor / Upload bills / Record bill in that order, the status tags and the Overdue only switch in their current places.
- Change only: palette and tokens; white header row; vendor avatar in the Bill cell; bill number as a `--brand-text` link line; category dot; button heights 32 / 28; selected status pill uses the brand fill; remove the "Showing 7 of 7 bills" text above the table (the footer count stays); Spend sub-nav in `fv` style.

### 6.5 Vendors (Spend, vendors view), ref `Color-Vendors`
- Must match: "Add vendor" is the primary on this view, "Upload bills" outline; columns Vendor (avatar, name, legal name; "PROTECTED" outlined flag on the Miscellaneous vendor), Category (dot), Contact, Tax ID, Open bills (amount + count); action "Bills" (outline) + icons.
- Change: the category becomes a dot + text (no tinted chip); open bills from doc 22 BE-3 (fallback `–`); "Bills" opens the bills view filtered to that vendor using the existing search/filter (if no such filter exists, it opens the vendor 360 view; report which).

### 6.6 Subscriptions `#a-finance-subscriptions`, ref `Color-Subscriptions`
- Must match: Spend tabs (Subscriptions active), search and "Add subscription"; pills All / Active / Inactive + "Notice due only" toggle; columns Subscription (vendor avatar, name, vendor), Owner (name, department), Next renewal (date + "Notice due" warning note), Billing ("Monthly · manual/auto", "Last charged <date>"), Status, Rate; footer count and monthly run rate.
- Keep: row primary action is the existing **"Log charge"** (the reference label "Create bill" is illustrative); History becomes an icon.
- Change: uppercase cycle chips and "Manual" chips become plain text; the monthly run rate is shown only if a monthly-equivalent value already exists in the data or code; otherwise omit it and report.

### 6.7 Statutory `#a-finance-statutory`, ref `Color-Statutory`
- Must match: Spend tabs; header search, "Generate VAT estimate" (outline), "Record obligation" (primary) on one row; 4 summary cards (Estimated amber/clock, Accrued blue/document, Remitted green/check, Variance slate/plus-minus) with `EGP` prefix; pills All / Estimated / Accrued / Remitted + Type select + Period select ("Aug 2026"); columns Obligation (source tile PR/VT/WH, type, "Payroll run · Aug 2026"), Due, Estimated (muted), Accrued, Remitted, Remaining (bold), Status, actions (Confirm or Remit + icons); footer "Amounts in EGP · showing…" and the period variance.
- Change: the native date input becomes a Period select (same filter value); **fix the variance currency bug** (it prints `$0.00` on EGP rows; use the obligation currency); amounts never wrap (`white-space: nowrap`), the currency is shown once in the footer, not on every cell.

### 6.8 Bank and cash accounts `#a-finance-accounts` (accounts view), ref `Color-Accounts`
- Must match: Banking sub-nav **Accounts / Ledger / Statements / Cheques / Transfers** as underline tabs (shortened labels); header "Transfer" and "Withdraw cash" (outline), "Add account" (primary); 4 cards: one per currency present (sum of account balances in that currency, never mixed) plus "Uncleared cheques" and "Statement lines to match"; pills All / Active / Inactive + currency select; columns Account (avatar, name, bank · country), Type ("Bank · ••4821" plain text), Reconciled (date or "N lines to match" in warning), Balance (currency prefix + bold amount, "Available …" line only when it differs); action "Open ledger" + icons.
- Keep: existing account fields `available_balance`, `reconciled_balance`, `last_reconciled_date`, `unreconciled_count` (the reference's "Last statement" column maps to these).
- Change: the three identical green balance columns become one Balance column; "Upload statement" moves to the Statements view; card numbers computed client-side from the loaded accounts and cheques.

### 6.9 Account ledger (accounts workspace), ref `Color-Ledger`
- Must match: Banking tabs stay visible with "Ledger" active; an account select and "Record transaction" (primary) on the tab row; 3 cards (Balance sky, In teal, Out orange for the selected period); pills All / In / Out with counts, "Petty spend only" toggle, Period, Category and Payment type selects; columns Date, Details (direction tile, description, reference as a link), Category (dot), Payment type, Amount (signed, navy), Balance (muted); footer "amounts in <currency>".
- Keep: the existing account workspace IDs; the "Back to Accounts" behaviour is replaced by the Accounts tab (keep the element in the DOM, hidden, if a spec depends on it, and report it).
- Change: **remove the Rate / Equiv column** (D-019: ledger rows are always in the account currency); the two date inputs move behind the Period select ("This month", "Last month", "Custom…" shows the existing date inputs).

### 6.10 Transfers (accounts, transfers view), ref `Color-Transfers`
- Must match: Banking tabs; account select and "Record transfer" (primary); pills All / Internal / Same-bank FX / External + "Awaiting second leg" (warning); columns Date, From → To (two account avatars and an arrow, transfer reference link), Type, Status (legs as a status pill), Out / in (amount, second line for the other leg or "In: not confirmed"); action "Confirm leg" when a leg is open + icons; empty state with the "Record transfer" button.
- Change: the uppercase nine-column table becomes this layout; leg badges become status pills.

### 6.11 Cheques (accounts, cheques view), ref `Color-Cheques`
- Must match: Banking tabs; search, "Withdraw cash" (outline), "Issue cheque" (primary); pills for statuses that have at least one cheque, plus a dashed "More · …" pill that reveals the rest in the same row; FY select; columns Payee (avatar, payee, "Cheque 001011" as a link line), Issued, From account, Purpose (plain text + linked bill), Status (+ clear date), Amount (navy, no minus, no red); actions "Mark cleared" when issued + icons.
- Change: fix the Purpose cell rendered as highlighted text; monospace numbers and ISO dates go.

### 6.12 Statements (accounts, statements view), ref `Color-Statements`
- Must match: Banking tabs; account select, Period select, "Upload statement" (primary); pills All / Needs review / Reconciled / Closed; columns Period (account avatar, "Sep 2026", account), File (format, line count), Matching (violet progress bar + "1 of 3", "2 lines to match"), Status, Uploaded (date), action "Reconcile" (opens the existing reconciliation workspace) + icons.
- Change: month and year selects become one Period select listing the periods present (same filtering); the US date "9/10/2026" format goes.

### 6.13 Reports `#a-finance-reports`, ref `Color-Reports`
- Must match: no title block; domain pills (All + each domain in its identity colour, with counts) and search on one row; a single table: Report (violet-tinted chart tile per domain colour, name, one-line description), Domain (dot + name), Basis, "Open" (outline 28).
- Keep: the existing report list, domain filter values and open handlers. Report pages opened from the list follow §3.4/§3.5 (header row, cards, tables).
- Change: the card grid becomes the table. Check each report's basis label against D-026 and write the real value; the reference shows `[CHECK]` where it was unknown.

### 6.14 Finance settings `#a-finance-settings`, ref `Color-Settings`
- Must match: underline tabs Transaction categories / Payment types / Display with "Add category" (primary) on the row; pills All / Active / Inactive / Petty spend + Kind select; columns Code (muted), Category (colour dot + name 600), Kind (teal ↓ Revenue, orange ↑ Cost, · Other, as plain text), Spend type ("Petty / recurring" or "Standard"), Status, "Edit" (outline) + deactivate icon; footer note "Each category keeps its colour everywhere…".
- Change: REVENUE/COST/ACTIVE chips become text and pills; category colours come from doc 22 BE-1 (fallback §3.3). In `#financeCategoryModal` add a colour choice of 8 swatches (radio inputs, 28 px circles with a 2 px ring when selected) **only when the API returns `color`**; hide it otherwise. Payment types and Display tabs follow the same table and form rules.

---

## 7. Dialogs: what to match, keep and change

All dialogs: §3.6. Keep every field, ID, validation and handler.

| Dialog | Ref | Must match | Keep / map |
| :--- | :--- | :--- | :--- |
| `#billModal` | `Modal-NewBill` | Spend tile; slim attach row with "Browse"; Bill details grid; Payment choice bar Not paid yet / Already paid; paid section card; "Saves as" banner; "More fields" toggle; footer Save as draft + Add another (left), Cancel + primary (right) | Already the C modal (doc 19). Change only tokens, field height 36, footer 34, tile colour orange. Keep the existing "More details (optional)" control and its auto-open rules |
| `#billApprovalModal` | `Modal-BillApproval` | Amber shield tile; record summary card; "View attached bill" link; Decision choice bar Approve (green) / Reject; comment field; outcome banner; primary "Approve bill" | The choice bar sits over the existing decision input; keep the "Approver authorization limit" field (place it under the decision); primary label follows the chosen decision |
| `#billPaymentModal` | `Modal-PayBill` | Record summary with balance due; 2-column fields; impact tiles; outcome banner | Impact tiles only when the account balance is known client-side; cheque number field keeps its existing show/hide |
| `#billVoidModal` | `Modal-VoidBill` | 520 width, red tile, warning text block, reason select, note, red primary | Keep the existing reason options and the D-016 void guard message |
| `#invoiceModal` | `Modal-NewInvoice` | 760 width, teal tile, 3-column header grid (customer with avatar, number, dates, currency, receiving account, channel, VAT %, WHT %), lines table with "Add line" and totals bar, notes, footer Save as draft (left) | Keep the existing status/save controls and the F1 locked-fields note; do not invent "Save & send" if the code has another save flow; place the existing controls where the reference shows buttons |
| `#invoicePaymentModal` | `Modal-Receipt` | Title "Record receipt", teal tile, summary card with progress, fields, teal-wash outcome banner, primary "Record receipt" | Keep the D-024 withholding default and same-currency account rule (D-022) |
| `#financeTransactionModal` | `Modal-Transaction` | Sky tile; account with avatar; Direction choice bar (Money out orange / Money in); amount with locked account currency; Category with dot; Payment type; "Paid to" pills (Nobody specific / Vendor / Employee / Customer); reference, VAT, description; impact tiles | Direction maps to the existing adjustment-effect/transaction-type input; payee pills sit over the existing payee-type select; the vendor/bill/customer/invoice/employee link fields keep their show/hide logic |
| `#financeTransferModal` | `Modal-Transfer` | From card (orange edge, "↑ FROM") → To card (teal edge, "↓ TO"); amounts; "Same currency, no exchange rate" or the rate field when currencies differ; fee and dates; "Post now" choice bar (3 options) | Choice bar over the existing settlement-posting select; keep FX logic unchanged |
| `#financeChequeModal` | `Modal-Cheque` | Sky tile; Purpose choice bar (3); bill with avatar; payee; account; amount; cheque number; dates; signer; "Money leaves the account" choice bar; outcome banner; footer link to teller withdrawal | Choice bars over the existing purpose-type and posting-policy selects; the teller link opens `#financeWithdrawCashModal` |
| `#statutorySettleModal` | `Modal-Remittance` | Orange tile; summary card with accrued amount; fields with EGP; account select limited to the obligation currency; outcome banner | Keep D-024 same-currency rule and variance handling |

---

## 8. Dependency on the backend plan (doc 22)

The UI must work **before and after** the backend changes land. Feature-detect each field; never block a slice on doc 22.

| Contract (doc 22) | UI use | Fallback when absent |
| :--- | :--- | :--- |
| BE-1 `color` on every category from `/api/finance/categories` (`"blue"`, `"orange"`, `"teal"`, `"violet"`, `"green"`, `"pink"`, `"sky"`, `"ochre"`); accepted on create and update | category dots everywhere; colour choice in `#financeCategoryModal` | index rule §3.3; hide the colour choice |
| BE-2 `receivables` on each customer from `GET /api/finance/customers`: list of `{ currency, open_amount, open_count, overdue_count, max_days_overdue }` | Customers "Open balance" column (one line per currency) and the "With late invoices" pill | `–` and hide the pill |
| BE-3 `payables` on each vendor from `GET /api/finance/vendors`: list of `{ currency, open_amount, open_count, overdue_count }` | Vendors "Open bills" column (one line per currency) | `–` |

The UI agent adds these fields to the mock API (`fe/api/finance/*.js`) so mock mode shows the final state. The backend agent never edits `fe/`.

---

## 9. Docs to update in S9

- This doc: status → IMPLEMENTED with the branch name.
- `docs/project-context/04-decision-log.md` D-027: mark "Implemented on `feature/finance-ui-restyle-v2`".
- `docs/project-context/05-roadmap-and-next-slices.md` section 3D: tick the slices.
- Doc 19: add one line under the status: "Superseded for colours and sizes by doc 21 (D-027); Bills UX unchanged."

## 10. Stop and ask the owner when

- A page has a control, column or state that neither the reference nor §6/§7 covers and it is not a minor variant of a covered pattern.
- Matching the reference would change behaviour, a calculation, filtering semantics, permissions or an API call.
- A spec can only pass by weakening a check, or a selector change would ripple into HR or Payroll.
- Contrast below 4.5:1 cannot be fixed with the tokens in §3.

## 11. Final report (per slice, and once at the end)

1. Slice, commit hash, push status, draft PR link.
2. Files changed (`git diff --stat`).
3. Tests run with exact results against the S0 baseline.
4. The §0.4 checklist per page with any remaining difference and its reason.
5. Mappings used (§0.2) and anything reported for the owner.
