/**
 * public/js/invoices.js
 * External-salary "Consultant Fees" invoice generation UI
 * (docs/analysis/invoice-autopay-plan.md). Admin-only screen (section id
 * "a-invoices", added to the existing #adminSidebar nav-item/data-page
 * pattern). Lets HR preview eligibility, generate invoices in bulk
 * or per-employee for a selected payment month, regenerate existing invoices
 * with confirmation modal, preview PDF invoices in-app, and browse grouped &
 * sortable invoice history.
 *
 * Depends on globals already defined elsewhere: Api, employees, toast,
 * showSection, initials, fmtUSD, setButtonLoading, closeModal.
 */

let _invoiceEligiblePreview = [];
let _activeRegenTarget = null;
let _rawInvoiceHistory = [];
let _invoiceSortField = 'name'; // 'name' | 'number'
let _invoiceSortDir = 'asc';    // 'asc' | 'desc'
let _expandedInvoiceMonths = new Set();
let _popoverSelectedYear = new Date().getFullYear();
let _popoverSelectedMonth = new Date().getMonth() + 1;

function _currentInvoicePeriod(){
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function _invoicePeriodLabel(year, month){
  const names = ["", "January", "February", "March", "April", "May", "June",
                 "July", "August", "September", "October", "November", "December"];
  return `${names[month]} ${year}`;
}

function _escapeAttr(str){
  return String(str || '').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updateInvoicePeriodLabel(year, month){
  const lbl = document.getElementById('invPeriodBtnLabel');
  if(lbl){
    const names = ["", "January", "February", "March", "April", "May", "June",
                   "July", "August", "September", "October", "November", "December"];
    lbl.textContent = `${names[month] || 'Month'} ${year || ''}`;
  }
}

function openInvoicePeriodModal(){
  const yearInput = document.getElementById('invPaymentYear');
  const monthInput = document.getElementById('invPaymentMonth');
  _popoverSelectedYear = (yearInput && Number(yearInput.value)) || new Date().getFullYear();
  _popoverSelectedMonth = (monthInput && Number(monthInput.value)) || (new Date().getMonth() + 1);
  renderInvoicePeriodModal();
  const modal = document.getElementById('invoicePeriodModal');
  if(modal) modal.classList.add('active');
}

function renderInvoicePeriodModal(){
  const yearLbl = document.getElementById('invPopoverYearLabel');
  if(yearLbl) yearLbl.textContent = _popoverSelectedYear;

  const monthGrid = document.getElementById('invPopoverMonthGrid');
  if(!monthGrid) return;
  const monthNames = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  monthGrid.innerHTML = monthNames.slice(1).map((name, idx) => {
    const mNum = idx + 1;
    const isActive = mNum === _popoverSelectedMonth;
    return `<button type="button" class="inv-month-btn ${isActive ? 'active' : ''}" onclick="selectInvoicePopoverMonth(${mNum})">${name}</button>`;
  }).join('');
}

function changeInvoicePopoverYear(delta){
  _popoverSelectedYear += delta;
  renderInvoicePeriodModal();
}

function selectInvoicePopoverMonth(monthNum){
  _popoverSelectedMonth = monthNum;
  renderInvoicePeriodModal();
  applyInvoicePeriodSelection();
}

function applyInvoicePeriodSelection(){
  const yearInput = document.getElementById('invPaymentYear');
  const monthInput = document.getElementById('invPaymentMonth');
  if(yearInput) yearInput.value = _popoverSelectedYear;
  if(monthInput) monthInput.value = _popoverSelectedMonth;
  updateInvoicePeriodLabel(_popoverSelectedYear, _popoverSelectedMonth);
  closeModal('invoicePeriodModal');
}

/**
 * Called when the Invoices nav-item/section becomes active.
 */
function initInvoicesPage(){
  const { year, month } = _currentInvoicePeriod();
  const yearInput = document.getElementById('invPaymentYear');
  const monthInput = document.getElementById('invPaymentMonth');
  if(yearInput && !yearInput.value) yearInput.value = year;
  if(monthInput && !monthInput.value) monthInput.value = month;
  const activeYear = (yearInput && yearInput.value) ? Number(yearInput.value) : year;
  const activeMonth = (monthInput && monthInput.value) ? Number(monthInput.value) : month;
  updateInvoicePeriodLabel(activeYear, activeMonth);
  renderInvoiceResultsPlaceholder();
  loadInvoiceHistory();
}

function setupDefaultInvoicePeriod(){
  const { year, month } = _currentInvoicePeriod();
  const yearInput = document.getElementById('invPaymentYear');
  const monthInput = document.getElementById('invPaymentMonth');
  if(yearInput) yearInput.value = year;
  if(monthInput) monthInput.value = month;
  updateInvoicePeriodLabel(year, month);
}
if(typeof window !== 'undefined'){
  window.addEventListener('DOMContentLoaded', setupDefaultInvoicePeriod);
}

function renderInvoiceResultsPlaceholder(){
  const body = document.getElementById('invoiceResultsBody');
  if(!body) return;
  body.innerHTML = renderEmptyTableRow(4, 'Click "Preview Eligible Employees" to see who will be invoiced for the selected month.', 'fa-solid fa-file-invoice-dollar');
}

function _getInvoicePeriodInputs(){
  const yearInput = document.getElementById('invPaymentYear');
  const monthInput = document.getElementById('invPaymentMonth');
  const year = yearInput ? Number(yearInput.value) : new Date().getFullYear();
  const month = monthInput ? Number(monthInput.value) : (new Date().getMonth() + 1);
  return { year, month };
}

async function previewInvoiceEligibility(evt){
  const btn = (evt && evt.currentTarget) || document.querySelector('#a-invoices .invoice-toolbar-actions .btn');
  const { year, month } = _getInvoicePeriodInputs();
  if(!year || !month || month < 1 || month > 12){
    toast('Please select a valid payment year and month.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  setButtonLoading(btn, true, 'Loading...');
  try{
    const data = await Api.previewEligibleInvoices(year, month);
    _invoiceEligiblePreview = data.results || [];
    renderInvoicePreviewResults(_invoiceEligiblePreview, year, month);
  } catch(err){
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}

function _invoiceStatusPill(status){
  const map = {
    eligible: 'pill-success',
    already_exists: 'pill-info',
    skipped: 'pill-warning',
    generated: 'pill-success',
    failed: 'pill-danger',
  };
  return map[status] || 'pill-info';
}

function renderInvoicePreviewResults(results, year, month){
  const body = document.getElementById('invoiceResultsBody');
  if(!body) return;
  document.getElementById('invoiceResultsTitle').textContent =
    `Eligibility Preview — ${_invoicePeriodLabel(year, month)}`;
  if(!results.length){
    body.innerHTML = renderEmptyTableRow(4, 'No eligible employees found for this period.', 'fa-solid fa-file-invoice-dollar');
    return;
  }
  body.innerHTML = results.map(r => {
    let actionBtn = '—';
    if (r.status === 'eligible') {
      actionBtn = `<button class="btn btn-sm btn-fill" onclick="generateSingleInvoice(${r.employee_id})"><i class="fa-solid fa-file-invoice"></i> Generate</button>`;
    } else if (r.status === 'already_exists') {
      actionBtn = `<button class="btn btn-sm btn-outline-warning" style="color:var(--warning, #eab308);border-color:rgba(234,179,8,0.4);" onclick="openRegenerateInvoiceModal(${r.employee_id}, '${_escapeAttr(r.employee_name)}', ${year}, ${month}, '${_escapeAttr(r.invoice_number || '')}')"><i class="fa-solid fa-arrows-rotate"></i> Regenerate</button>`;
    }
    return `<tr>
      <td class="tname"><div class="avatar">${initials(r.employee_name)}</div>${r.employee_name}</td>
      <td><span class="badge-pill ${_invoiceStatusPill(r.status)}">${r.status.replace('_',' ')}</span></td>
      <td>${r.reason || r.invoice_number || '—'}</td>
      <td>${actionBtn}</td>
    </tr>`;
  }).join('');
}

function generateBulkInvoices(evt){
  const { year, month } = _getInvoicePeriodInputs();
  if(!year || !month || month < 1 || month > 12){
    toast('Please select a valid payment year and month.', 'fa-solid fa-triangle-exclamation');
    return;
  }

  const periodLabel = _invoicePeriodLabel(year, month);
  const modalPeriod = document.getElementById('bulkModalPeriod');
  if (modalPeriod) modalPeriod.textContent = periodLabel;

  const eligibleCount = _invoiceEligiblePreview.filter(r => r.status === 'eligible').length;
  const existingCount = _invoiceEligiblePreview.filter(r => r.status === 'already_exists').length;

  const elCount = document.getElementById('bulkEligibleCount');
  const exCount = document.getElementById('bulkExistingCount');
  if (elCount) elCount.textContent = eligibleCount;
  if (exCount) exCount.textContent = existingCount;

  const chk = document.getElementById('bulkRegenerateExisting');
  if (chk) chk.checked = false;

  const modal = document.getElementById('bulkInvoiceModal');
  if (modal) modal.classList.add('active');
}

async function executeBulkGenerateInvoices(evt){
  const btn = (evt && evt.currentTarget) || document.getElementById('btnConfirmBulkGenerate');
  const { year, month } = _getInvoicePeriodInputs();
  const chk = document.getElementById('bulkRegenerateExisting');
  const regenerateExisting = chk ? chk.checked : false;

  setButtonLoading(btn, true, 'Generating...');
  try{
    const result = await Api.generateInvoices({
      payment_year: year,
      payment_month: month,
      skip_existing: !regenerateExisting,
    });
    closeModal('bulkInvoiceModal');
    renderInvoiceBatchResults(result, year, month);
    toast(`Batch complete: ${result.summary.generated} generated, ${result.summary.already_exists} already existed, ${result.summary.skipped} skipped, ${result.summary.failed} failed.`);
    await loadInvoiceHistory();
    if (_invoiceEligiblePreview.length) {
      await previewInvoiceEligibility();
    }
  } catch(err){
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}

function renderInvoiceBatchResults(result, year, month){
  const body = document.getElementById('invoiceResultsBody');
  if(!body) return;
  document.getElementById('invoiceResultsTitle').textContent =
    `Generation Results — ${_invoicePeriodLabel(year, month)}`;
  body.innerHTML = result.results.map(r => `<tr>
    <td class="tname"><div class="avatar">${initials(r.employee_name)}</div>${r.employee_name}</td>
    <td><span class="badge-pill ${_invoiceStatusPill(r.status)}">${r.status.replace('_',' ')}</span></td>
    <td>${r.reason || r.invoice_number || '—'}</td>
    <td>
      <div style="display:flex;gap:6px;align-items:center;">
        ${r.drive_web_url ? `<a href="${r.drive_web_url}" target="_blank" rel="noopener" class="btn btn-sm btn-outline" style="font-size:11.5px;padding:3px 8px;"><i class="fa-solid fa-file-word"></i> Word</a>` : ''}
      </div>
    </td>
  </tr>`).join('');
}

function openRegenerateInvoiceModal(employeeId, employeeName, year, month, invoiceNumber){
  _activeRegenTarget = { employeeId, employeeName, year, month, invoiceNumber };

  const empEl = document.getElementById('regenEmpName');
  const periodEl = document.getElementById('regenPeriod');
  const invEl = document.getElementById('regenInvoiceNumber');

  if (empEl) empEl.textContent = employeeName;
  if (periodEl) periodEl.textContent = _invoicePeriodLabel(year, month);
  if (invEl) invEl.textContent = invoiceNumber || '—';

  const modal = document.getElementById('regenerateInvoiceModal');
  if (modal) modal.classList.add('active');
}

async function executeRegenerateInvoice(evt){
  if (!_activeRegenTarget) return;
  const btn = (evt && evt.currentTarget) || document.getElementById('btnConfirmRegenerate');
  const { employeeId, employeeName, year, month } = _activeRegenTarget;

  setButtonLoading(btn, true, 'Regenerating...');
  try{
    const result = await Api.generateInvoiceForEmployee(employeeId, {
      payment_year: year,
      payment_month: month,
      skip_existing: false,
    });
    closeModal('regenerateInvoiceModal');
    toast(`Invoice ${result.invoice_number || ''} regenerated successfully for ${employeeName}.`);
    await loadInvoiceHistory();
    if (_invoiceEligiblePreview.length) {
      await previewInvoiceEligibility();
    }
  } catch(err){
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
    _activeRegenTarget = null;
  }
}

async function generateSingleInvoice(employeeId, evt){
  const btn = (evt && evt.currentTarget) || (window.event && window.event.currentTarget);
  const { year, month } = _getInvoicePeriodInputs();
  const emp = employees.find(e => e.id === employeeId);
  const label = _invoicePeriodLabel(year, month);

  if (btn) setButtonLoading(btn, true, 'Generating...');
  try{
    const result = await Api.generateInvoiceForEmployee(employeeId, {
      payment_year: year,
      payment_month: month,
      skip_existing: true,
    });
    if(result.status === 'generated'){
      toast(`Invoice ${result.invoice_number} generated for ${emp ? emp.name : ''}.`);
    } else {
      toast(`Invoice ${result.invoice_number} already exists for this period.`, 'fa-solid fa-circle-info');
    }
    await loadInvoiceHistory();
    if(_invoiceEligiblePreview.length){
      await previewInvoiceEligibility();
    }
  } catch(err){
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    if (btn) setButtonLoading(btn, false);
  }
}

function previewInvoicePdf(invoiceId, invoiceNumber){
  const container = document.getElementById('docPreviewContainer');
  const modal = document.getElementById('documentPreviewModal');
  const titleEl = document.getElementById('docPreviewTitle');
  const downloadBtn = document.getElementById('docPreviewDownloadBtn');

  if (titleEl) titleEl.textContent = `Invoice ${invoiceNumber || ''} (PDF Preview)`;
  if (downloadBtn) {
    downloadBtn.onclick = (e) => {
      e.preventDefault();
      Api.downloadInvoiceFile(invoiceId, `Invoice_${invoiceNumber || 'file'}.pdf`)
        .catch(err => toast(err.message, 'fa-solid fa-triangle-exclamation'));
    };
  }
  if (container) renderLoadingState(container, 'Loading PDF preview...');
  if (modal) modal.classList.add('active');

  Api.getInvoicePreviewBlobUrl(invoiceId).then(url => {
    if (container) {
      container.innerHTML = `<iframe src="${url}" style="width:100%;height:75vh;border:none;background:#fff;"></iframe>`;
    }
  }).catch(err => {
    if (container) {
      container.innerHTML = `<div style="color:#f87171;font-size:13px;padding:20px;text-align:center;">${err.message}</div>`;
    }
  });
}

function toggleInvoiceSort(field){
  if(_invoiceSortField === field){
    _invoiceSortDir = (_invoiceSortDir === 'asc' ? 'desc' : 'asc');
  } else {
    _invoiceSortField = field;
    _invoiceSortDir = 'asc';
  }
  renderGroupedInvoiceHistory();
}

function toggleInvoiceMonth(monthKey){
  if(_expandedInvoiceMonths.has(monthKey)){
    _expandedInvoiceMonths.delete(monthKey);
  } else {
    _expandedInvoiceMonths.add(monthKey);
  }
  const card = document.getElementById(`monthCard-${monthKey}`);
  if(card){
    card.classList.toggle('collapsed', !_expandedInvoiceMonths.has(monthKey));
  }
  _updateToggleAllMonthsButton();
}

function toggleAllInvoiceMonths(){
  // Gather all available month keys
  const monthKeys = new Set();
  _rawInvoiceHistory.forEach(inv => {
    const key = `${inv.payment_year}-${String(inv.payment_month).padStart(2, '0')}`;
    monthKeys.add(key);
  });

  const allExpanded = monthKeys.size > 0 && Array.from(monthKeys).every(k => _expandedInvoiceMonths.has(k));
  if(allExpanded){
    _expandedInvoiceMonths.clear();
  } else {
    monthKeys.forEach(k => _expandedInvoiceMonths.add(k));
  }
  renderGroupedInvoiceHistory();
}

function _updateToggleAllMonthsButton(){
  const btnText = document.getElementById('toggleAllMonthsText');
  if(!btnText) return;
  const monthKeys = new Set();
  _rawInvoiceHistory.forEach(inv => {
    const key = `${inv.payment_year}-${String(inv.payment_month).padStart(2, '0')}`;
    monthKeys.add(key);
  });
  const allExpanded = monthKeys.size > 0 && Array.from(monthKeys).every(k => _expandedInvoiceMonths.has(k));
  btnText.textContent = allExpanded ? 'Collapse All' : 'Expand All';
}

function _sortInvoicesList(list){
  return [...list].sort((a, b) => {
    let cmp = 0;
    if(_invoiceSortField === 'number'){
      const numA = String(a.invoice_number || '');
      const numB = String(b.invoice_number || '');
      cmp = numA.localeCompare(numB, undefined, { numeric: true, sensitivity: 'base' });
    } else {
      const nameA = String(a.employee_name || '');
      const nameB = String(b.employee_name || '');
      cmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
    }
    return _invoiceSortDir === 'desc' ? -cmp : cmp;
  });
}

function renderGroupedInvoiceHistory(){
  const container = document.getElementById('invoiceHistoryContainer');
  const badgeEl = document.getElementById('invoiceHistoryTotalBadge');
  if(!container) return;

  if(!_rawInvoiceHistory.length){
    if(badgeEl) badgeEl.style.display = 'none';
    renderEmptyState(container, 'No invoices generated yet.', 'fa-solid fa-clock-rotate-left');
    return;
  }

  // Update badge with totals
  const totalCount = _rawInvoiceHistory.length;
  const totalAmount = _rawInvoiceHistory.reduce((sum, inv) => sum + Number(inv.amount_usd || 0), 0);
  if(badgeEl){
    badgeEl.textContent = `${totalCount} Invoices • ${fmtUSD(totalAmount)}`;
    badgeEl.style.display = 'inline-block';
  }

  // Update Toolbar Sort Button states & icons
  const btnSortName = document.getElementById('sortByNameBtn');
  const btnSortNumber = document.getElementById('sortByNumberBtn');
  const iconSortName = document.getElementById('sortNameIcon');
  const iconSortNumber = document.getElementById('sortNumberIcon');

  if(btnSortName){
    btnSortName.classList.toggle('active', _invoiceSortField === 'name');
  }
  if(btnSortNumber){
    btnSortNumber.classList.toggle('active', _invoiceSortField === 'number');
  }
  if(iconSortName){
    iconSortName.className = _invoiceSortField === 'name'
      ? (_invoiceSortDir === 'asc' ? 'fa-solid fa-arrow-up-a-z' : 'fa-solid fa-arrow-down-z-a')
      : 'fa-solid fa-sort';
  }
  if(iconSortNumber){
    iconSortNumber.className = _invoiceSortField === 'number'
      ? (_invoiceSortDir === 'asc' ? 'fa-solid fa-arrow-up-1-9' : 'fa-solid fa-arrow-down-9-1')
      : 'fa-solid fa-sort';
  }

  // Group invoices by period (year-month)
  const groups = {};
  _rawInvoiceHistory.forEach(inv => {
    const key = `${inv.payment_year}-${String(inv.payment_month).padStart(2, '0')}`;
    if(!groups[key]) {
      groups[key] = {
        year: Number(inv.payment_year),
        month: Number(inv.payment_month),
        invoices: [],
      };
    }
    groups[key].invoices.push(inv);
  });

  // Sort groups descending (newest month first)
  const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));

  // Default to expanding the newest month if set is empty
  if(_expandedInvoiceMonths.size === 0 && sortedKeys.length > 0){
    _expandedInvoiceMonths.add(sortedKeys[0]);
  }
  _updateToggleAllMonthsButton();

  // Render collapsible cards for each month
  container.innerHTML = sortedKeys.map(key => {
    const group = groups[key];
    const isExpanded = _expandedInvoiceMonths.has(key);
    const sortedInvoices = _sortInvoicesList(group.invoices);
    const monthTotal = group.invoices.reduce((sum, inv) => sum + Number(inv.amount_usd || 0), 0);
    const periodName = _invoicePeriodLabel(group.year, group.month);

    const nameSortIcon = _invoiceSortField === 'name'
      ? (_invoiceSortDir === 'asc' ? 'fa-solid fa-arrow-up-a-z' : 'fa-solid fa-arrow-down-z-a')
      : 'fa-solid fa-sort';

    const numSortIcon = _invoiceSortField === 'number'
      ? (_invoiceSortDir === 'asc' ? 'fa-solid fa-arrow-up-1-9' : 'fa-solid fa-arrow-down-9-1')
      : 'fa-solid fa-sort';

    const rowsHtml = sortedInvoices.map(inv => `<tr>
      <td class="tname"><div class="avatar">${initials(inv.employee_name)}</div>${inv.employee_name}</td>
      <td><strong>${inv.invoice_number}</strong></td>
      <td>${fmtUSD(Number(inv.amount_usd))}</td>
      <td><span class="badge-pill ${_invoiceStatusPill(inv.status)}">${inv.status}</span></td>
      <td>
        ${inv.drive_web_url ? `<a href="${inv.drive_web_url}" target="_blank" rel="noopener" style="font-size:12px;"><i class="fa-solid fa-file-word"></i> Word</a>` : '—'}
      </td>
      <td>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="btn btn-sm btn-fill" style="font-size:11.5px;padding:4px 8px;" title="Preview PDF invoice" onclick="previewInvoicePdf(${inv.id}, '${_escapeAttr(inv.invoice_number)}')">
            <i class="fa-solid fa-file-pdf"></i> Preview PDF
          </button>
          <button class="btn btn-sm btn-outline" style="font-size:11.5px;padding:4px 8px;" title="Regenerate this invoice" onclick="openRegenerateInvoiceModal(${inv.employee_id}, '${_escapeAttr(inv.employee_name)}', ${inv.payment_year}, ${inv.payment_month}, '${_escapeAttr(inv.invoice_number)}')">
            <i class="fa-solid fa-arrows-rotate"></i> Regenerate
          </button>
        </div>
      </td>
    </tr>`).join('');

    return `<div class="invoice-month-card ${isExpanded ? '' : 'collapsed'}" id="monthCard-${key}">
      <div class="invoice-month-header" onclick="toggleInvoiceMonth('${key}')">
        <div class="invoice-month-title">
          <i class="fa-solid fa-chevron-down toggle-caret"></i>
          <span>${periodName}</span>
          <span class="badge-pill pill-info" style="font-size:11.5px;">${group.invoices.length} ${group.invoices.length === 1 ? 'Invoice' : 'Invoices'}</span>
        </div>
        <div class="invoice-month-summary">
          <span class="invoice-month-total">${fmtUSD(monthTotal)}</span>
        </div>
      </div>
      <div class="invoice-month-content">
        <table>
          <thead>
            <tr>
              <th class="th-sortable ${_invoiceSortField === 'name' ? 'active' : ''}" onclick="toggleInvoiceSort('name')">
                Employee <i class="${nameSortIcon}"></i>
              </th>
              <th class="th-sortable ${_invoiceSortField === 'number' ? 'active' : ''}" onclick="toggleInvoiceSort('number')">
                Invoice # <i class="${numSortIcon}"></i>
              </th>
              <th>Amount</th>
              <th>Status</th>
              <th>Document</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    </div>`;
  }).join('');
}

async function loadInvoiceHistory(){
  const container = document.getElementById('invoiceHistoryContainer');
  try{
    _rawInvoiceHistory = await Api.listInvoices();
    renderGroupedInvoiceHistory();
  } catch(err){
    if(container){
      renderEmptyState(container, `Could not load invoice history: ${err.message}`, 'fa-solid fa-triangle-exclamation');
    }
  }
}
