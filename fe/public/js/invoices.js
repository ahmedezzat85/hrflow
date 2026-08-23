/**
 * public/js/invoices.js
 * External-salary "Consultant Fees" invoice generation UI
 * (docs/analysis/invoice-autopay-plan.md). Admin-only screen (section id
 * "a-invoices", added to the existing #adminSidebar nav-item/data-page
 * pattern). Lets HR preview eligibility, generate invoices in bulk
 * or per-employee for a selected payment month, regenerate existing invoices
 * with confirmation modal, and browse invoice history.
 *
 * Depends on globals already defined elsewhere: Api, employees, toast,
 * showSection, initials, fmtUSD, setButtonLoading, closeModal.
 */

let _invoiceEligiblePreview = [];
let _activeRegenTarget = null;

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

/**
 * Called when the Invoices nav-item/section becomes active.
 */
function initInvoicesPage(){
  const { year, month } = _currentInvoicePeriod();
  const yearInput = document.getElementById('invPaymentYear');
  const monthSelect = document.getElementById('invPaymentMonth');
  if(yearInput && !yearInput.value) yearInput.value = year;
  if(monthSelect) monthSelect.value = month;
  renderInvoiceResultsPlaceholder();
  loadInvoiceHistory();
}

function renderInvoiceResultsPlaceholder(){
  const body = document.getElementById('invoiceResultsBody');
  if(!body) return;
  body.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="fa-solid fa-file-invoice-dollar"></i><p>Click "Preview Eligible Employees" to see who will be invoiced for the selected month.</p></div></td></tr>`;
}

function _getInvoicePeriodInputs(){
  const year = Number(document.getElementById('invPaymentYear').value);
  const month = Number(document.getElementById('invPaymentMonth').value);
  return { year, month };
}

async function previewInvoiceEligibility(evt){
  const btn = (evt && evt.currentTarget) || document.querySelector('#a-invoices .toolbar + .card .btn');
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
    body.innerHTML = `<tr><td colspan="4"><div class="empty-state"><i class="fa-solid fa-file-invoice-dollar"></i><p>No employees found.</p></div></td></tr>`;
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
    <td>${r.drive_web_url ? `<a href="${r.drive_web_url}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> View</a>` : '—'}</td>
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

async function loadInvoiceHistory(){
  const body = document.getElementById('invoiceHistoryBody');
  if(!body) return;
  try{
    const invoices = await Api.listInvoices();
    if(!invoices.length){
      body.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i><p>No invoices generated yet.</p></div></td></tr>`;
      return;
    }
    body.innerHTML = invoices.map(inv => `<tr>
      <td class="tname"><div class="avatar">${initials(inv.employee_name)}</div>${inv.employee_name}</td>
      <td><strong>${inv.invoice_number}</strong></td>
      <td>${_invoicePeriodLabel(Number(inv.payment_year), Number(inv.payment_month))}</td>
      <td>${fmtUSD(Number(inv.amount_usd))}</td>
      <td><span class="badge-pill ${_invoiceStatusPill(inv.status)}">${inv.status}</span></td>
      <td>${inv.drive_web_url ? `<a href="${inv.drive_web_url}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> View</a>` : '—'}</td>
      <td>
        <button class="btn btn-sm btn-outline" style="font-size:11.5px;padding:4px 8px;" title="Regenerate this invoice" onclick="openRegenerateInvoiceModal(${inv.employee_id}, '${_escapeAttr(inv.employee_name)}', ${inv.payment_year}, ${inv.payment_month}, '${_escapeAttr(inv.invoice_number)}')">
          <i class="fa-solid fa-arrows-rotate"></i> Regenerate
        </button>
      </td>
    </tr>`).join('');
  } catch(err){
    body.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Could not load invoice history: ${err.message}</p></div></td></tr>`;
  }
}
