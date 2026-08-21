# Employee Detail Card — Two-Zone Redesign — Implementation Plan

**Target:** `#a-employee-detail` section of HRFlow, specifically the card that currently wraps `#detailProfileHead` and `#detailInfoGrid`.

**Reference design:** self-contained prototype `employee-card-variant-b.html` (first/main variant in that file — the two-zone "Compensation" + "Employee Details" card). Open that file in a browser to see the exact visual target before making any changes.

**Files touched:**
1. `fe/src/styles.css` — append new CSS (additive only, nothing removed).
2. `fe/public/js/employees.js` — replace the body of the `viewProfile()` function's two `innerHTML` assignments.
3. `fe/src/index.html` — verify (do not blindly re-add) the wrapper `<div>` class.

No backend, API, or data-model changes are required. This is a pure frontend rendering change.

---

## 0. Read this before touching anything (lessons from a previous failed attempt)

A prior implementation of a similar redesign failed twice for the same root cause: **a CSS class was added to the wrong `<div>`**, or **left on a leftover empty `<div>`** instead of the actual card that wraps the dynamic content. The class must end up on the exact element that is the ancestor of `#detailProfileHead` and `#detailInfoGrid` — no sibling divs, no duplicate wrapper divs.

Before writing any code, locate this block in `fe/src/index.html` inside `<section class="page-section" id="a-employee-detail">`:

```html
<button class="btn btn-sm" style="margin-bottom:18px" onclick="showSection('a-employees','admin')">
  <i class="fa-solid fa-arrow-left"></i> Back to Employees
</button>
<div class="card ??? " style="margin-bottom:20px">
  <div class="profile-head" id="detailProfileHead"></div>
  <div class="info-grid" id="detailInfoGrid"></div>
</div>
```

There must be **exactly one** `<div class="card ...">` here, and it must be the direct parent of both `#detailProfileHead` and `#detailInfoGrid`. If you find an empty `<div class="card ..."></div>` anywhere near this block with nothing inside it, **delete that empty div entirely** — it is leftover debris from a previous edit and must not exist in the final file.

---

## 1. CSS — append to `fe/src/styles.css`

Add this block at the end of the file. It is fully additive; no existing rule is modified or removed. All colors/spacing reuse existing CSS variables (`--accent`, `--border`, `--text2`, etc.) so dark theme continues to work automatically without extra rules.

```css
/* ===== Employee summary card — Two-Zone redesign ===== */
.emp-summary-card{padding:0;overflow:hidden}

.emp-summary-card .esc-head{
  display:flex;align-items:center;gap:16px;flex-wrap:wrap;
  padding:22px 26px;border-bottom:1px solid var(--border);
}
.emp-summary-card .esc-avatar{
  width:50px;height:50px;border-radius:50%;flex-shrink:0;
  background:linear-gradient(135deg,var(--accent),var(--accent2));
  color:#fff;display:flex;align-items:center;justify-content:center;
  font-weight:700;font-size:17px;font-family:var(--font-head);
  box-shadow:0 4px 12px rgba(32,86,232,.28);
}
.emp-summary-card .esc-identity{flex:1;min-width:200px}
.emp-summary-card .esc-identity h4{font-size:17px;font-weight:700;font-family:var(--font-head);line-height:1.3;color:var(--text)}
.emp-summary-card .esc-identity .esc-meta{
  font-size:13px;color:var(--text2);margin-top:3px;
  display:flex;gap:6px;align-items:center;flex-wrap:wrap;
}
.emp-summary-card .esc-identity .esc-meta .esc-dot{width:3px;height:3px;border-radius:50%;background:var(--text3);flex-shrink:0}

.emp-summary-card .esc-badges{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-left:auto}

.emp-summary-card .esc-body{display:grid;grid-template-columns:1.3fr 1fr}
@media (max-width:820px){
  .emp-summary-card .esc-body{grid-template-columns:1fr}
}

/* Left zone: compensation */
.emp-summary-card .esc-comp-zone{
  padding:22px 26px;
  background:linear-gradient(165deg, rgba(32,86,232,.035), rgba(32,86,232,0) 60%);
  border-right:1px solid var(--border);
}
@media (max-width:820px){
  .emp-summary-card .esc-comp-zone{border-right:none;border-bottom:1px solid var(--border)}
}
.emp-summary-card .esc-zone-label{
  font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:var(--text3);margin-bottom:14px;
}
.emp-summary-card .esc-comp-total{display:flex;align-items:baseline;gap:8px;margin-bottom:18px}
.emp-summary-card .esc-comp-total .esc-amount{
  font-family:var(--font-head);font-size:32px;font-weight:800;color:var(--accent);
  font-variant-numeric:tabular-nums;
}
.emp-summary-card .esc-comp-total .esc-unit{font-size:13px;color:var(--text2);font-weight:600}

.emp-summary-card .esc-comp-breakdown{display:flex;gap:24px;flex-wrap:wrap}
.emp-summary-card .esc-comp-piece{flex:1;min-width:120px}
.emp-summary-card .esc-comp-piece .esc-k{
  font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
  color:var(--text3);display:flex;align-items:center;gap:5px;margin-bottom:4px;
}
.emp-summary-card .esc-comp-piece .esc-k i{font-size:10px}
.emp-summary-card .esc-comp-piece .esc-v{font-size:15px;font-weight:700;font-family:var(--font-head);font-variant-numeric:tabular-nums;color:var(--text)}

/* Right zone: administrative fields */
.emp-summary-card .esc-meta-zone{padding:22px 26px}
.emp-summary-card .esc-row{
  display:flex;align-items:baseline;justify-content:space-between;gap:16px;
  padding:9px 0;border-bottom:1px solid var(--border);
}
.emp-summary-card .esc-row:last-child{border-bottom:none}
.emp-summary-card .esc-row .esc-k{
  font-size:12.5px;color:var(--text2);display:flex;align-items:center;gap:7px;flex-shrink:0;
}
.emp-summary-card .esc-row .esc-k i{font-size:11px;color:var(--text3);width:13px;text-align:center}
.emp-summary-card .esc-row .esc-v{
  font-size:13px;font-weight:600;color:var(--text);text-align:right;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;
}
.emp-summary-card .esc-row.wrap{align-items:flex-start}
.emp-summary-card .esc-row.wrap .esc-v{white-space:normal;line-height:1.45;text-align:right}

.emp-summary-card .esc-pill{
  padding:5px 12px;border-radius:20px;font-size:11.5px;font-weight:700;
  display:inline-flex;align-items:center;gap:6px;white-space:nowrap;
}
.emp-summary-card .esc-pill-active{background:#e6f9f1;color:var(--success)}
.emp-summary-card .esc-pill-neutral{background:var(--surface2);color:var(--text2)}
.emp-summary-card .esc-pill i{font-size:7px}

.emp-summary-card .esc-edit-btn{
  width:36px;height:36px;border-radius:10px;border:1px solid var(--border);
  background:var(--surface);color:var(--text2);display:flex;align-items:center;justify-content:center;
  cursor:pointer;transition:.15s;font-size:13px;flex-shrink:0;
}
.emp-summary-card .esc-edit-btn:hover{border-color:var(--accent);color:var(--accent)}
```

---

## 2. JavaScript — replace the render logic in `fe/public/js/employees.js`

### 2.1 Locate the current code

Search the file for `detailProfileHead`. You will find, inside `async function viewProfile(id){ ... }`, two consecutive lines similar to:

```js
document.getElementById('detailProfileHead').innerHTML = `...`;
document.getElementById('detailInfoGrid').innerHTML = `...`;
```

The exact contents of the template strings may differ slightly depending on which iteration of the app you're on (they may already reference `fmtUSD`, `invoice_id`, `address_line_1/2`, etc.). **Do not guess-replace based on old content** — locate these two lines by their `getElementById` target (`detailProfileHead` and `detailInfoGrid`), read whatever is currently between the backticks to confirm the field names being used (see step 2.2), then replace only those two `innerHTML` assignments with the new markup in step 2.3.

### 2.2 Confirm field names before writing replacement code

Before writing the replacement, identify the actual property names on the `e` (employee) object used by the *existing* code you just found. Common/expected properties based on this codebase:

| Field | Likely property |
|---|---|
| Full name | `e.name` |
| Role/title | `e.role` |
| Department | `e.dept` |
| Employment state | `e.employment_state` (fallback `'Full-Time'`) |
| Status | `e.status` |
| Join date | `e.join` |
| Monthly salary total | `e.salary` (formatted via existing `fmtMoney()`) |
| Internal salary (USD) | `e.internalSalaryUsd` (formatted via existing `fmtUSD()`) |
| External salary (USD) | `e.externalSalaryUsd` (formatted via existing `fmtUSD()`) |
| Next raise date | `e.nextRaise` |
| Vacation used/total | `e.vacUsed`, `e.vacTotal` |
| Invoice ID | `e.invoice_id` |
| Address lines | `e.address_line_1`, `e.address_line_2` |
| Email | `e.email` |

If the code you located uses different property names than this table (e.g., camelCase variants), use whatever the existing code actually uses — do not introduce new property names that don't exist on the employee object.

**Do not change the salary currency/format.** If the current code already fixed the EGP-vs-USD display bug (using `fmtMoney`/`fmtUSD` correctly), preserve that. If you still see a hardcoded `EGP` string anywhere in the block you're replacing, replace it with the appropriate `fmtMoney(...)` or `fmtUSD(...)` call consistent with the rest of the codebase — but this plan's scope is layout only, not currency logic.

### 2.3 Replacement code

Add these two small helper functions once, near the top of `employees.js` (or wherever other small helpers like `initials()` are defined) — only if they don't already exist:

```js
function escRow(icon, label, valueHtml, opts = {}) {
  const { wrap = false, title = '' } = opts;
  return `<div class="esc-row${wrap ? ' wrap' : ''}">
    <span class="esc-k"><i class="fa-solid ${icon}"></i> ${label}</span>
    <span class="esc-v"${title ? ` title="${title}"` : ''}>${valueHtml}</span>
  </div>`;
}
function escInitials(name) {
  return (name || '').split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '—';
}
```

If an `initials()` helper already exists and does the same thing, reuse it instead of adding `escInitials` — do not create a duplicate.

Then replace the two `innerHTML` assignment lines identified in step 2.1 with:

```js
document.getElementById('detailProfileHead').innerHTML = `
  <div class="esc-head">
    <div class="esc-avatar">${initials(e.name)}</div>
    <div class="esc-identity">
      <h4>${e.name}</h4>
      <div class="esc-meta">
        <span>${e.role}</span><span class="esc-dot"></span>
        <span>${e.dept}</span>${e.join ? `<span class="esc-dot"></span><span>Joined ${e.join}</span>` : ''}
      </div>
    </div>
    <div class="esc-badges">
      <span class="esc-pill ${e.status === 'Active' ? 'esc-pill-active' : 'esc-pill-neutral'}">
        <i class="fa-solid fa-circle"></i> ${e.status}
      </span>
      <span class="esc-pill esc-pill-neutral">${e.employment_state || 'Full-Time'}</span>
    </div>
  </div>`;

document.getElementById('detailInfoGrid').innerHTML = `
  <div class="esc-body">
    <div class="esc-comp-zone">
      <div class="esc-zone-label">Monthly Compensation</div>
      <div class="esc-comp-total">
        <span class="esc-amount">${fmtMoney(e.salary)}</span>
        <span class="esc-unit">/ month total</span>
      </div>
      <div class="esc-comp-breakdown">
        <div class="esc-comp-piece">
          <div class="esc-k"><i class="fa-solid fa-building"></i> Internal</div>
          <div class="esc-v">${fmtUSD(e.internalSalaryUsd)}</div>
        </div>
        <div class="esc-comp-piece">
          <div class="esc-k"><i class="fa-solid fa-file-invoice-dollar"></i> External</div>
          <div class="esc-v">${fmtUSD(e.externalSalaryUsd)}</div>
        </div>
        <div class="esc-comp-piece">
          <div class="esc-k"><i class="fa-solid fa-arrow-trend-up"></i> Next Raise</div>
          <div class="esc-v" style="font-size:14px">${e.nextRaise}</div>
        </div>
      </div>
    </div>
    <div class="esc-meta-zone">
      <div class="esc-zone-label">Employee Details</div>
      ${escRow('fa-envelope', 'Email', e.email, { title: e.email })}
      ${escRow('fa-umbrella-beach', 'Vacation', `${e.vacTotal - e.vacUsed} / ${e.vacTotal} days`)}
      ${escRow('fa-hashtag', 'Invoice ID', e.invoice_id || '—')}
      ${escRow('fa-location-dot', 'Address', [e.address_line_1, e.address_line_2].filter(Boolean).join(', ') || '—', { wrap: true })}
    </div>
  </div>`;
```

**Do not add an edit button inside `.esc-badges` unless explicitly requested** — the prototype shows one, but wiring it to `openEmployeeModal()` correctly requires confirming that function accepts an employee ID for edit mode; treat that as a separate follow-up, not part of this layout change.

---

## 3. HTML — verify (not necessarily edit) `fe/src/index.html`

Locate this block inside `<section class="page-section" id="a-employee-detail">`:

```html
<div class="card emp-summary-card" style="margin-bottom:20px">
  <div class="profile-head" id="detailProfileHead"></div>
  <div class="info-grid" id="detailInfoGrid"></div>
</div>
```

If the wrapper already looks exactly like this (one card, `emp-summary-card` class present, no empty sibling `<div class="card emp-summary-card">` anywhere nearby), **no HTML change is needed** — the class is already correctly placed from the prior iteration.

If instead you find:
- An empty `<div class="card emp-summary-card"></div>` sitting next to a *separate* `<div class="card">` that contains `detailProfileHead`/`detailInfoGrid` — delete the empty div and move `emp-summary-card` onto the real card.
- The `info-grid` / `profile-head` classes still present on the inner divs — **leave them in place**. They are harmless legacy classes; the new JS-injected markup (`.esc-head`, `.esc-body`, etc.) renders *inside* these divs, and since none of the old `.info-grid`/`.profile-head` CSS rules use `display:grid` with a hardcoded fixed column count that would visually conflict with a single child, this does not need to be removed for the fix to work. If you want to clean this up cosmetically, it's optional, not required.

---

## 4. Verification checklist (perform all steps before considering this done)

1. Open the employee detail page for any employee in a browser.
2. Confirm the card renders as **two side-by-side zones** at desktop width: "Monthly Compensation" on the left with a large `$X,XXX` figure, "Employee Details" on the right with row-style fields.
3. Confirm the header shows: avatar circle with initials, name, role • department • joined-date subtitle, Active/Full-Time pills on the right.
4. Confirm **no grey filled boxes** appear anywhere in the card.
5. Confirm the email field truncates with `…` if long, and shows the full address on hover via the `title` attribute.
6. Confirm the Address field is the only one allowed to wrap to a second line.
7. Resize the browser to ~750px width: the two zones should stack vertically (comp zone on top, details below), not overlap or break.
8. Toggle dark theme (if applicable) and confirm text/border colors still read correctly — they should, since only CSS variables were used.
9. Open browser DevTools, inspect `#detailInfoGrid`, and confirm its child `.esc-body` has computed `display: grid` — if it computes to anything else, the CSS block from step 1 was not saved/loaded correctly (check for a typo in the class name `emp-summary-card` or a caching issue — hard refresh with Ctrl+Shift+R / Cmd+Shift+R).
10. Confirm no console errors appear (e.g., `fmtUSD is not defined` — if this occurs, locate the correct existing formatter name in the codebase and use that instead).

## 5. Rollback

If anything goes wrong, this change is isolated to:
- One appended CSS block (delete it to revert styling).
- Two `innerHTML` template strings inside `viewProfile()` (revert to whatever was there before, using version control history).

No other file, function, or data flow is touched.
