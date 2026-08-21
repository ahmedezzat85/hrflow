# Employee Detail Page Redesign — Implementation Plan

**Status:** Approved design.

**Reference preview:** `employee-detail-page-redesign.html` (the approved full-page redesign prototype). This plan implements the page structure shown in that prototype: a main content column plus a right sidebar, purpose-based sections, a full-width sidebar bank card, and a separate quick-actions card.

**Target page:** Admin employee detail section: `#a-employee-detail` in `fe/src/index.html`.

**Current branch baseline:** `ux-enhance` at commit `7e151c51f60f678a87be607f55b246ecbb4c927b` — “Fix rendering issue in employee info card.” This follows the employee-summary-card two-zone redesign and its associated rendering-width fix.

---

## 1. Goals and non-goals

### Goals

- Replace the current arbitrary sequence of full-width and `g-2-1`/`g2` card rows with a coherent page layout.
- Group cards by purpose so administrators can scan the employee record naturally:
  1. Profile and compensation.
  2. Time off and benefits.
  3. Documents and notes.
  4. Sensitive bank details and administrative actions.
- Move **Bank Account Details** to a full-width right sidebar card; it must no longer be squeezed into the narrow 1/3 column beside Employee Documents.
- Move **Submit on Behalf** actions into a dedicated **Quick Actions** sidebar card; it must no longer be paired visually with Medical Insurance Consumption.
- Keep existing element IDs and existing JavaScript behavior intact unless a listed code update is required.
- Use the existing visual language: white surfaces, low-contrast borders, blue accent, existing CSS variables, rounded cards, compact typography, and no unnecessary grey field backgrounds.
- Preserve responsive behavior: desktop uses main column + sidebar; narrow screens stack into one column.

### Non-goals

- Do not change backend endpoints, employee data fields, bank-data security behavior, document upload behavior, insurance calculations, vacation calculations, or action-handler semantics.
- Do not change the approved two-zone employee summary card implementation in this task.
- Do not make global changes to `.card`, `.grid`, `.g2`, `.g-2-1`, `.info-grid`, or existing generic classes; all new styling must be scoped under the employee-detail page wrapper.
- Do not rewrite unrelated pages.

---

## 2. Current structure audit

The existing `#a-employee-detail` page currently contains this order:

1. Back to Employees button.
2. Employee summary card (`.card.emp-summary-card`) containing `#detailProfileHead` and `#detailInfoGrid`.
3. `grid g-2-1`: Medical Insurance Consumption + Submit on Behalf.
4. `grid g2`: Vacation History + Insurance Claims.
5. `grid g-2-1`: Employee Documents + Bank Account Details (`#bankAccountCard`).
6. Full-width Notes & Performance Tracking card.

### Problems to solve

- **Purpose mismatch:** Submit on Behalf is an action launcher, not insurance-consumption data; it should not share a row with that data.
- **Bank card width:** The bank account card has compact sensitive data but is constrained to the narrow 1/3 side of a `g-2-1` grid.
- **Weak information hierarchy:** Page sections are arranged by earlier implementation chronology, not by user task or data type.
- **Notes isolation:** Notes are a record-management task but sit disconnected at the bottom with no association to Documents.
- **No page-level grouping:** The page is one undifferentiated sequence of cards; there are no visual labels such as “Time Off & Benefits” or “Documents & Notes.”

---

## 3. Approved target architecture

Implement this desktop hierarchy:

```text
Back to Employees
Employee Summary Card (existing approved two-zone card)

Employee Detail Workspace
├── Main Column
│   ├── Time Off & Benefits
│   │   ├── Vacation History
│   │   ├── Insurance Claims
│   │   └── Medical Insurance Consumption
│   └── Documents & Notes
│       ├── Employee Documents
│       └── Notes & Performance Tracking
└── Sidebar
    ├── Sensitive Data
    │   └── Bank Account Details
    └── Quick Actions
        ├── Vacation / WFH Request
        ├── Medical Insurance Claim
        └── Apply Salary Raise
```

### Desktop behavior

- Use a two-column workspace: **main column `minmax(0, 1fr)` + 300px sidebar**.
- Main-column history cards (Vacation History and Insurance Claims) sit in equal columns.
- Medical Insurance Consumption spans the main-column width below those two history cards.
- Documents and Notes each span the main-column width, in that order.
- Sidebar is top-aligned with the first `Time Off & Benefits` section after the employee summary card.
- Bank Account sits above Quick Actions in the sidebar.

### Responsive behavior

- At viewport widths `<= 960px`, workspace becomes one column.
- Main content remains first; sidebar content follows after Documents & Notes.
- At viewport widths `<= 680px`, Vacation History and Insurance Claims stack one above another.
- Do not use a fixed height for any card. Tables remain horizontally scrollable under the existing table-responsive behavior.

---

## 4. HTML restructuring

**File:** `fe/src/index.html`

### 4.1 Preserve the existing summary card

Do not alter the existing summary-card wrapper or its dynamic targets:

```html
<div class="card emp-summary-card" style="margin-bottom:20px">
  <div class="profile-head" id="detailProfileHead"></div>
  <div id="detailInfoGrid"></div>
</div>
```

The exact class/value of `#detailInfoGrid` may differ after the width-rendering fix. Preserve its current state; do not restore the old legacy `info-grid` class if it was removed.

### 4.2 Create a workspace wrapper

Immediately after the summary card, replace all remaining detail-page card blocks (Medical Insurance Consumption through Notes & Performance Tracking) with this high-level structure:

```html
<div class="employee-detail-workspace">
  <main class="employee-detail-main">
    <!-- Time Off & Benefits section -->
    <!-- Documents & Notes section -->
  </main>

  <aside class="employee-detail-sidebar">
    <!-- Sensitive Data / Bank Account -->
    <!-- Quick Actions -->
  </aside>
</div>
```

### 4.3 Add section labels

Use this reusable markup before each logical group:

```html
<div class="employee-detail-section-label">
  <span>Time Off &amp; Benefits</span>
  <span class="employee-detail-section-line"></span>
</div>
```

Create these labels:

- `Time Off & Benefits` — before Vacation History / Insurance Claims.
- `Documents & Notes` — before Employee Documents.
- `Sensitive Data` — before Bank Account Details in sidebar.
- `Quick Actions` — before action buttons in sidebar.

### 4.4 Time Off & Benefits markup

Move Vacation History and Insurance Claims into a new equal-width child grid:

```html
<div class="employee-detail-history-grid">
  <div class="card">
    <!-- Keep existing Vacation History card head/table/ID: detailVacationBody -->
  </div>
  <div class="card">
    <!-- Keep existing Insurance Claims card head/table/ID: detailClaimsBody -->
  </div>
</div>
```

Below the history grid, move the current **Medical Insurance Consumption** card unchanged in content but with a new optional class:

```html
<div class="card employee-insurance-summary-card">
  <!-- Preserve #detailInsuranceTotal and #detailInsuranceGrid exactly -->
</div>
```

Do not rename or duplicate these dynamic IDs:

- `detailInsuranceTotal`
- `detailInsuranceGrid`
- `detailVacationBody`
- `detailClaimsBody`

### 4.5 Documents & Notes markup

Move the existing Employee Documents card under `Documents & Notes` in the main column. Preserve:

- `detailDocumentsBody`
- `openEmployeeDocumentModal()` handler
- All existing upload button behavior.

Move the existing Notes & Performance Tracking card directly below Employee Documents. Preserve:

- `fNoteDate`
- `fNoteCategory`
- `fNoteText`
- `detailNotesList`
- `saveEmployeeNote()` handler.

Do not turn Notes into a modal or collapse it by default; the inline composer and timeline are appropriate for this employee-record context.

### 4.6 Bank Account sidebar markup

Move the exact existing `#bankAccountCard` card into the sidebar under `Sensitive Data`.

Add the scoped class `employee-bank-card` to it:

```html
<div class="card employee-bank-card" id="bankAccountCard">
```

Preserve all existing IDs/handlers/data-security controls unchanged:

- `bankAccountActionBtn`
- `bankAccountStatus`
- `bankAccountPill`
- `openBankAccountModal(event)`
- Masked/revealed IBAN behavior.

Do not place any sensitive IBAN value directly in static HTML.

### 4.7 Quick Actions sidebar markup

Replace the old Submit on Behalf card with a `card employee-quick-actions-card` under the sidebar `Quick Actions` label.

Move these exact existing actions into it, preserving existing handlers and `currentDetailEmployeeId` behavior:

```html
<button class="employee-quick-action" onclick="openBehalfVacationModal()">
  <i class="fa-solid fa-umbrella-beach"></i>
  <span>Vacation / WFH Request</span>
</button>

<button class="employee-quick-action" onclick="openBehalfClaimModal()">
  <i class="fa-solid fa-briefcase-medical"></i>
  <span>Medical Insurance Claim</span>
</button>

<button class="employee-quick-action employee-quick-action-primary" onclick="openRaiseModal(currentDetailEmployeeId)">
  <i class="fa-solid fa-arrow-trend-up"></i>
  <span>Apply Salary Raise</span>
</button>
```

Do not change the modal handlers or their existing loading-state behavior.

### 4.8 Required HTML validation before commit

After restructuring:

- Search each dynamic ID in the entire file and confirm it occurs exactly once.
- Confirm `#bankAccountCard` occurs exactly once.
- Confirm `#detailVacationBody`, `#detailClaimsBody`, `#detailInsuranceGrid`, `#detailDocumentsBody`, and `#detailNotesList` each occur exactly once.
- Confirm there are no blank `<div class="card"></div>` leftovers from moved blocks.
- Confirm every opened `<main>`, `<aside>`, and `<div>` is correctly closed before the end of `#a-employee-detail`.

---

## 5. Scoped CSS implementation

**File:** `fe/src/styles.css`

Append a new scoped CSS section after existing employee-detail / summary-card rules. Do not modify global card or generic-grid styling.

```css
/* ===== Employee detail page workspace redesign ===== */
.employee-detail-workspace{
  display:grid;
  grid-template-columns:minmax(0,1fr) 300px;
  gap:20px;
  align-items:start;
}
.employee-detail-main,
.employee-detail-sidebar{
  min-width:0;
  display:flex;
  flex-direction:column;
  gap:20px;
}

.employee-detail-section-label{
  display:flex;
  align-items:center;
  gap:8px;
  margin:4px 0 -2px 4px;
  font-size:11px;
  font-weight:700;
  letter-spacing:.07em;
  text-transform:uppercase;
  color:var(--text3);
}
.employee-detail-section-line{
  flex:1;
  height:1px;
  background:var(--border);
}

.employee-detail-history-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:20px;
}

.employee-bank-card .card-head h3{
  display:flex;
  align-items:center;
  gap:8px;
}
.employee-bank-card .card-head h3 i{
  color:var(--accent);
}
.employee-bank-card #bankAccountStatus{
  padding:4px 0;
}
.employee-bank-card #bankAccountPill{
  width:fit-content;
}

.employee-quick-actions-card{
  padding:16px;
}
.employee-quick-action{
  width:100%;
  display:flex;
  align-items:center;
  gap:10px;
  padding:11px 14px;
  margin-bottom:10px;
  border:1px solid var(--border);
  border-radius:12px;
  background:var(--surface);
  color:var(--text);
  font-family:inherit;
  font-size:13px;
  font-weight:600;
  text-align:left;
  cursor:pointer;
  transition:.15s;
}
.employee-quick-action:last-child{
  margin-bottom:0;
}
.employee-quick-action i{
  width:16px;
  color:var(--accent);
  text-align:center;
}
.employee-quick-action:hover{
  border-color:var(--accent);
  background:var(--accent-soft);
}
.employee-quick-action-primary{
  border:none;
  background:linear-gradient(135deg,var(--accent),var(--accent2));
  color:#fff;
  box-shadow:0 6px 16px rgba(32,86,232,.25);
}
.employee-quick-action-primary i{
  color:#fff;
}
.employee-quick-action-primary:hover{
  color:#fff;
  background:linear-gradient(135deg,var(--accent),var(--accent2));
  transform:translateY(-1px);
}

@media(max-width:960px){
  .employee-detail-workspace{
    grid-template-columns:1fr;
  }
}
@media(max-width:680px){
  .employee-detail-history-grid{
    grid-template-columns:1fr;
  }
  .employee-detail-section-label{
    margin-left:0;
  }
}
```

### Styling constraints

- Do not add grey background tiles to the employee summary card or quick action rows.
- Use `var(--surface)` / `var(--accent-soft)` and existing CSS variables; do not hardcode a new unthemed color system.
- Do not set a fixed width on Bank Account card; the sidebar owns the width.
- Do not use `position: sticky` for the sidebar in this first implementation. Evaluate sticky behavior only after real-world usage; a non-sticky sidebar is safer with long note/document sections.
- Do not add generic `table` overrides. Existing table styles should continue to apply.

---

## 6. JavaScript impact assessment

**Expected JavaScript changes:** none required for the layout refactor, provided all existing IDs are preserved exactly once.

### Verify these existing functions still locate their targets

- `viewProfile(id)`
- `loadBankAccountStatus(id)`
- `openBankAccountModal(event)`
- `openBehalfVacationModal()`
- `openBehalfClaimModal()`
- `openRaiseModal(currentDetailEmployeeId)`
- `openEmployeeDocumentModal()`
- `saveEmployeeNote()`
- `renderNotesList(notes)`
- `renderEmployeeDocuments(docs)`

### Do not change

- The employee summary-card DOM renderer in `viewProfile()`; it is handled by the approved two-zone summary-card implementation.
- Bank account API calls, masking, reveal handling, and permissions.
- Document upload/download/preview handlers.
- Modal markup, IDs, or close behavior.

---

## 7. Implementation sequence

1. Create a feature branch from current `ux-enhance` head, or work directly on `ux-enhance` if that is the established workflow.
2. Make a backup/commit checkpoint before moving HTML blocks.
3. Restructure only the HTML inside `#a-employee-detail` according to Section 4, preserving dynamic IDs.
4. Perform the unique-ID validation in Section 4.8 before changing CSS.
5. Append the scoped CSS from Section 5.
6. Run the application and open an employee detail page.
7. Verify every sidebar action opens the correct existing modal for the currently selected employee.
8. Verify bank status still loads when entering the employee detail page.
9. Verify document upload and note addition still update the correct lists.
10. Validate responsive breakpoints and dark theme.
11. Commit with a focused message, for example:

```text
refactor(ui): reorganize employee detail workspace and action sidebar
```

---

## 8. Acceptance criteria

### Visual

- Employee summary card remains first and uses the currently approved two-zone summary design.
- Desktop page displays a visibly balanced main column + 300px sidebar layout.
- Bank Account Details is readable at full sidebar width and is not squeezed into a leftover one-third grid column.
- Submit on Behalf no longer appears beside Medical Insurance Consumption.
- Vacation History and Insurance Claims are equal-width peer cards under `Time Off & Benefits`.
- Medical Insurance Consumption appears below the two history cards in the main content column.
- Documents and Notes are grouped under `Documents & Notes`.
- Section labels visually divide the page without adding bulky backgrounds or excess height.
- Quick action buttons are clear, compact, and visually distinct from read-only data cards.

### Functional

- Every pre-existing dynamic target ID appears exactly once.
- View employee, upload document, preview/download document, create note, create behalf vacation, create behalf claim, apply raise, add/edit bank details, and reveal IBAN all continue working.
- No browser-console errors are introduced.
- At `<= 960px`, the sidebar stacks below main content.
- At `<= 680px`, history cards stack one per row.
- Existing dark theme remains legible and correctly themed.

---

## 9. Rollback plan

This refactor changes only page structure and scoped CSS. If a regression is found:

1. Revert the dedicated page-refactor commit.
2. Confirm the existing summary-card design and all previous bank/document changes remain untouched.
3. Reapply only the isolated part needed after the regression cause is understood.

Avoid mixing this layout refactor with backend, salary-currency, or modal behavior changes in the same commit.