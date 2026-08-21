# Employee Detail Card — Variant A Implementation Pack

Ready-to-apply changes for the `ux-enhance` branch. Three small edits: one CSS append, one HTML class change, one JS renderer replacement. Estimated apply time: 10 minutes.

The redesign: removes all grey `.info-item` boxes, compresses the header (48px avatar, one-line subtitle), moves Status/Employment State into header pills, lays fields out as hairline-divided label/value rows in a responsive grid, keeps every value on one line (ellipsis + tooltip; address allowed to wrap), and fixes the Monthly Salary display from `EGP 3,000` to `$3,000` as part of the new renderer.

---

## Step 1 — Append to `fe/src/styles.css`

Purely additive. Nothing existing is modified, so `.info-item` / `.info-grid` keep working on the other screens that use them (insurance plan, etc.). All rules are scoped under `.emp-summary-card` and use existing CSS variables, so dark theme works automatically.

```css
/* ===== Employee summary card (Variant A) ===== */
.emp-summary-card{padding:20px 24px}
.emp-summary-card .esc-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding-bottom:16px;border-bottom:1px solid var(--border)}
.emp-summary-card .esc-avatar{width:48px;height:48px;border-radius:50%;flex-shrink:0;background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;font-family:var(--font-head)}
.emp-summary-card .esc-identity{flex:1;min-width:200px}
.emp-summary-card .esc-identity h4{font-size:17px;font-weight:700;font-family:var(--font-head);line-height:1.25}
.emp-summary-card .esc-identity p{font-size:13px;color:var(--text2);margin-top:2px}
.emp-summary-card .esc-head-actions{display:flex;gap:8px;align-items:center;margin-left:auto;flex-wrap:wrap}
.emp-summary-card .esc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));column-gap:32px;padding-top:4px}
.emp-summary-card .esc-item{display:flex;flex-direction:column;gap:3px;padding:10px 0;border-bottom:1px solid var(--border);min-width:0}
.emp-summary-card .esc-label{display:flex;align-items:center;gap:6px;font-size:10.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--text3)}
.emp-summary-card .esc-label i{font-size:11px;color:var(--text2);width:14px;text-align:center}
.emp-summary-card .esc-value{font-size:14px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}
.emp-summary-card .esc-value .sub{font-weight:500;color:var(--text2);font-size:12px}
.emp-summary-card .esc-item.wrap .esc-value{white-space:normal;line-height:1.45}
.emp-summary-card .esc-salary{font-size:15px;font-weight:800;font-family:var(--font-head);color:var(--accent)}
@media (max-width:760px){
  .emp-summary-card{padding:16px}
  .emp-summary-card .esc-head-actions{margin-left:0;width:100%}
  .emp-summary-card .esc-grid{grid-template-columns:1fr 1fr;column-gap:20px}
}
@media (max-width:520px){
  .emp-summary-card .esc-grid{grid-template-columns:1fr}
}
```

---

## Step 2 — One class change in `fe/src/index.html`

In section `#a-employee-detail`, find the summary card wrapper (the card containing `detailProfileHead` and `detailInfoGrid`):

```html
<!-- BEFORE -->
<div class="card" style="margin-bottom:20px">
  <div class="profile-head" id="detailProfileHead"></div>
  <div class="info-grid" id="detailInfoGrid"></div>
</div>

<!-- AFTER: only the wrapper class changes; keep both inner IDs untouched -->
<div class="card emp-summary-card" style="margin-bottom:20px">
  <div class="profile-head" id="detailProfileHead"></div>
  <div class="info-grid" id="detailInfoGrid"></div>
</div>
```

---

## Step 3 — Replace the detail-card renderer in `fe/src/index.html`

In the inline script, find the code that sets `detailProfileHead.innerHTML` and `detailInfoGrid.innerHTML` (search for `detailInfoGrid`). Replace both assignments with the code below.

**Only the field-mapping block may need adjustment** — align the accessors with your employee object's actual key names (the fallback chains cover the common variants).

```js
// --- Variant A renderer helpers (add once, near the detail render code) ---
function escItem(icon, label, valueHtml, opts = {}) {
  const { wrap = false, title = '' } = opts;
  return `<div class="esc-item${wrap ? ' wrap' : ''}">
    <span class="esc-label"><i class="fa-solid ${icon}"></i> ${label}</span>
    <span class="esc-value"${title ? ` title="${title}"` : ''}>${valueHtml}</span>
  </div>`;
}
const fmtUsd = n => '$' + Number(n || 0).toLocaleString('en-US');
const fmtDateShort = d => {
  if (!d) return '—';
  const dt = new Date(String(d).slice(0, 10) + 'T00:00:00');
  return isNaN(dt) ? d : dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// --- Replacement renderer (call it where the detail card is currently populated) ---
function renderEmployeeSummaryCard(emp) {
  // Field mapping — adjust accessor names here only, if needed:
  const name        = emp.name ?? '';
  const role        = emp.role ?? emp.role_title ?? '';
  const department  = emp.department ?? '';
  const email       = emp.email ?? '';
  const status      = emp.status ?? '';
  const empState    = emp.employment_state ?? emp.employmentState ?? '';
  const joinDate    = emp.join_date ?? emp.joinDate ?? '';
  const internalUsd = Number(emp.internal_salary ?? emp.internalSalary ?? 0);
  const externalUsd = Number(emp.external_salary ?? emp.externalSalary ?? 0);
  const invoiceId   = emp.invoice_id ?? emp.invoiceId ?? '—';
  const address     = [emp.address_line1 ?? emp.addressLine1, emp.address_line2 ?? emp.addressLine2]
                        .filter(Boolean).join(', ') || '—';
  const vacUsed     = emp.vacation_balance ?? emp.vacationBalance ?? '—';   // remaining days, e.g. 18
  const vacTotal    = emp.vacation_total ?? emp.vacationTotal ?? 21;
  const nextRaise   = emp.next_raise_date ?? emp.nextRaiseDate ?? '';

  const initials = name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '–';
  const monthlyTotal = internalUsd + externalUsd;   // USD total — replaces the old "EGP …" rendering
  const statusPill = status === 'Active' ? 'pill-success' : status === 'On Leave' ? 'pill-warning' : 'pill-neutral';
  const subtitle = [role, department, joinDate && 'Joined ' + fmtDateShort(joinDate)].filter(Boolean).join(' · ');

  const head = document.getElementById('detailProfileHead');
  head.className = 'esc-head';
  head.innerHTML = `
    <div class="esc-avatar">${initials}</div>
    <div class="esc-identity">
      <h4>${name}</h4>
      <p>${subtitle}</p>
    </div>
    <div class="esc-head-actions">
      <span class="badge-pill ${statusPill}"><i class="fa-solid fa-circle" style="font-size:7px"></i> ${status}</span>
      <span class="badge-pill pill-neutral">${empState}</span>
    </div>`;

  const grid = document.getElementById('detailInfoGrid');
  grid.className = 'esc-grid';
  grid.innerHTML = `
    ${escItem('fa-envelope', 'Email', email, { title: email })}
    ${escItem('fa-sack-dollar', 'Monthly Salary', `<span class="esc-salary">${fmtUsd(monthlyTotal)}</span> <span class="sub">/ mo</span>`)}
    ${escItem('fa-building', 'Internal Salary (USD)', fmtUsd(internalUsd))}
    ${escItem('fa-file-invoice-dollar', 'External Salary (USD)', fmtUsd(externalUsd))}
    ${escItem('fa-arrow-trend-up', 'Next Raise Date', fmtDateShort(nextRaise))}
    ${escItem('fa-umbrella-beach', 'Vacation Balance', `${vacUsed} / ${vacTotal} days`)}
    ${escItem('fa-hashtag', 'Invoice ID', String(invoiceId))}
    ${escItem('fa-location-dot', 'Address', address, { wrap: true, title: address })}`;
}
```

Notes:
- If the existing code is a function like `renderEmployeeDetail(emp)` that populates these divs plus other sections (vacation history, documents, etc.), keep everything else in it and swap only the two `innerHTML` blocks for a call to `renderEmployeeSummaryCard(emp)`.
- The old `EGP`-prefixed Monthly Salary line disappears with the old renderer — the USD fix is built in. `fmtUsd` is reusable for the other salary displays later.
- Optional: add an Edit button inside `.esc-head-actions` — `<button class="btn btn-sm" onclick="openEmployeeModal(currentDetailEmployeeId)"><i class="fa-solid fa-pen"></i> Edit</button>` — verify `openEmployeeModal` accepts an employee id for edit mode before enabling.
- All icons used already appear elsewhere in the app (Font Awesome 6.5.1 free solid).

---

## Step 4 — Verify, commit, push

```bash
git checkout ux-enhance
# apply the three edits, then:
# - open an employee detail page: no grey boxes, one-line values, $ monthly total
# - resize to ~760px and ~520px: grid collapses 2-col → 1-col cleanly
# - toggle dark theme: dividers/labels stay readable (all colors are CSS vars)
# - long email truncates with ellipsis; hover shows full address/email via tooltip
git add fe/src/index.html fe/src/styles.css
git commit -m "Redesign employee detail summary card (Variant A): compact hairline grid, header pills, USD salary fix"
git push origin ux-enhance
```

Regression check: confirm the insurance "My Insurance Plan" panel and other `.info-item` users are visually unchanged (their styles were not touched).
