/**
 * public/js/invoices.js
 * External-salary "Consultant Fees" invoice generation UI
 * (docs/analysis/invoice-autopay-plan.md). Admin-only screen (section id
 * "a-invoices", added to the existing #adminSidebar nav-item/data-page
 * pattern - see docs/analysis/invoice-autopay-html-snippet.html for the
 * exact markup). Lets HR preview eligibility, generate invoices in bulk
 * or per-employee for a selected payment month, and browse invoice
 * history. Kept as its own module (classic script, same pattern as
 * insurance.js/vacations.js) so it can be added to index.html's script
 * list without touching the existing salary.js/employees.js internals.
 *
 * Depends on globals already defined elsewhere: Api, employees, toast,
 * showSection, initials, fmtUSD.
 */

let _invoiceEligiblePreview = [];

function _currentInvoicePeriod(){
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function _invoicePeriodLabel(year, month){
  const names = ["", "January", "February", "March", "April", "May", "June",
                 "July", "August", "September", "October", "November", "December"];
  return `${names[month]} ${year}`;
}

/**
 * Called when the Invoices nav-item/section becomes active. Wire this
 * from the same place other sections initialize on show (e.g. alongside
 * loadAdminData()'s per-section setup, or via a data-page click listener
 * check for 'a-invoices'), consistent with how the app already
 * initializes a-salary/a-vacations content on first view.
 */
function initInvoicesPage(){
  const { year, month } = _currentInvoicePeriod();
  const yearInput = document.getElementById('invPaymentYear');
  const monthSelect = document.getElementById('invPaymentMonth');
  // Always initialise to today's period on first entry; year input uses the
  // empty-check guard so a user's typed value isn't clobbered on re-visit,
  // but a <select> always has a non-empty .value (first option), so we must
  // set it unconditionally the first time.
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

async function previewInvoiceEligibility(){
  const { year, month } = _getInvoicePeriodInputs();
  if(!year || !month || month < 1 || month > 12){
    toast('Please select a valid payment year and month.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  try{
    const data = await Api.previewEligibleInvoices(year, month);
    _invoiceEligiblePreview = data.results || [];
    renderInvoicePreviewResults(_invoiceEligiblePreview, year, month);
  } catch(err){
    toast(err.message, 'fa-solid fa-triangle-exclamation');
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
  body.innerHTML = results.map(r => `<tr>
    <td class="tname"><div class="avatar">${initials(r.employee_name)}</div>${r.employee_name}</td>
    <td><span class="badge-pill ${_invoiceStatusPill(r.status)}">${r.status.replace('_',' ')}</span></td>
    <td>${r.reason || r.invoice_number || '—'}</td>
    <td>${r.status === 'eligible' ? `<button class="btn btn-sm btn-fill" onclick="generateSingleInvoice(${r.employee_id})"><i class="fa-solid fa-file-invoice"></i> Generate</button>` : '—'}</td>
  </tr>`).join('');
}

async function generateBulkInvoices(){
  const { year, month } = _getInvoicePeriodInputs();
  if(!year || !month || month < 1 || month > 12){
    toast('Please select a valid payment year and month.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  const label = _invoicePeriodLabel(year, month);
  if(!confirm(`Generate invoices for all eligible employees for ${label}? This cannot be undone for already-generated invoices.`)) return;

  try{
    const result = await Api.generateInvoices({ payment_year: year, payment_month: month, skip_existing: true });
    renderInvoiceBatchResults(result, year, month);
    toast(`Batch complete: ${result.summary.generated} generated, ${result.summary.already_exists} already existed, ${result.summary.skipped} skipped, ${result.summary.failed} failed.`);
    loadInvoiceHistory();
  } catch(err){
    toast(err.message, 'fa-solid fa-triangle-exclamation');
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

async function generateSingleInvoice(employeeId){
  const { year, month } = _getInvoicePeriodInputs();
  const emp = employees.find(e => e.id === employeeId);
  const label = _invoicePeriodLabel(year, month);
  if(!confirm(`Generate a ${label} invoice for ${emp ? emp.name : 'this employee'}?`)) return;

  try{
    const result = await Api.generateInvoiceForEmployee(employeeId, {
      payment_year: year, payment_month: month, skip_existing: true,
    });
    if(result.status === 'generated'){
      toast(`Invoice ${result.invoice_number} generated for ${emp ? emp.name : ''}.`);
    } else if(result.status === 'already_exists'){
      toast(`Invoice ${result.invoice_number} already exists for this period.`, 'fa-solid fa-circle-info');
    }
    if(_invoiceEligiblePreview.length) await previewInvoiceEligibility();
    loadInvoiceHistory();
  } catch(err){
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  }
}

async function loadInvoiceHistory(){
  const body = document.getElementById('invoiceHistoryBody');
  if(!body) return;
  try{
    const invoices = await Api.listInvoices();
    if(!invoices.length){
      body.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i><p>No invoices generated yet.</p></div></td></tr>`;
      return;
    }
    body.innerHTML = invoices.map(inv => `<tr>
      <td class="tname"><div class="avatar">${initials(inv.employee_name)}</div>${inv.employee_name}</td>
      <td>${inv.invoice_number}</td>
      <td>${_invoicePeriodLabel(Number(inv.payment_year), Number(inv.payment_month))}</td>
      <td>${fmtUSD(Number(inv.amount_usd))}</td>
      <td><span class="badge-pill ${_invoiceStatusPill(inv.status)}">${inv.status}</span></td>
      <td>${inv.drive_web_url ? `<a href="${inv.drive_web_url}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> View</a>` : '—'}</td>
    </tr>`).join('');
  } catch(err){
    body.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-triangle-exclamation"></i><p>Could not load invoice history: ${err.message}</p></div></td></tr>`;
  }
}
