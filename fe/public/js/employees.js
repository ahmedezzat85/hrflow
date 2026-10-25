let currentEmpStatusFilter = 'all';

function updateEmployeeStatusCounts() {
  const allCount = (typeof employees !== 'undefined' && employees) ? employees.length : 0;
  const activeCount = (typeof employees !== 'undefined' && employees) ? employees.filter(e => (e.status || '').toLowerCase() === 'active').length : 0;
  const leaveCount = (typeof employees !== 'undefined' && employees) ? employees.filter(e => (e.status || '').toLowerCase() === 'on leave').length : 0;
  const inactiveCount = (typeof employees !== 'undefined' && employees) ? employees.filter(e => (e.status || '').toLowerCase() === 'inactive').length : 0;
  const elAll = document.getElementById('empCountAll');
  const elActive = document.getElementById('empCountActive');
  const elLeave = document.getElementById('empCountOnLeave');
  const elInactive = document.getElementById('empCountInactive');
  if (elAll) elAll.textContent = allCount;
  if (elActive) elActive.textContent = activeCount;
  if (elLeave) elLeave.textContent = leaveCount;
  if (elInactive) elInactive.textContent = inactiveCount;
}

function filterEmployeesByStatus(status) {
  currentEmpStatusFilter = status;
  const group = document.getElementById('employeeStatusFilterGroup');
  if (group) {
    group.querySelectorAll('.filter-tab').forEach(btn => {
      const isMatch = btn.getAttribute('data-emp-status') === status;
      btn.classList.toggle('active', isMatch);
      btn.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
    });
  }
  const searchInput = document.getElementById('empSearch');
  renderEmployeesTable(searchInput ? searchInput.value : '');
}

function renderEmployeesTable(filter = '') {
  const body = document.getElementById('employeesTableBody');
  const addBtn = document.getElementById('btnAddEmployee');
  const canWrite = typeof SessionInfo !== 'undefined' ? SessionInfo.hasPermission('hr.employee.write') : true;
  if (addBtn) {
    addBtn.style.display = canWrite ? '' : 'none';
  }
  updateEmployeeStatusCounts();
  const f = filter.toLowerCase();
  let list = employees.filter(e => (e.name || '').toLowerCase().includes(f) || (e.role || '').toLowerCase().includes(f) || (e.dept || e.department || '').toLowerCase().includes(f) || (e.email || '').toLowerCase().includes(f) || (e.employment_state || "").toLowerCase().includes(f));
  if (currentEmpStatusFilter && currentEmpStatusFilter !== 'all') {
    list = list.filter(e => (e.status || '').toLowerCase() === currentEmpStatusFilter.toLowerCase());
  }
  body.innerHTML = list.map(e => `<tr>
    <td data-label="Employee" class="tname"><div class="avatar">${initials(e.name)}</div><div><div><a href="#" class="hv-name-link" onclick="viewProfile('${e.id}'); return false;">${escapeHtml(e.name)}</a></div><div class="hv-sub-line">${e.id ? `${/^\d+$/.test(String(e.id)) ? 'EMP' + String(e.id).padStart(3, '0') : escapeHtml(String(e.id))} · ` : ''}${escapeHtml(e.email)}</div></div></td>
    <td data-label="Role"><div class="hv-role-line">${escapeHtml(e.role)}</div>${(e.dept || e.department) ? `<div class="hv-sub-line">${escapeHtml(e.dept || e.department)}</div>` : ''}</td>
    <td data-label="Employment">${e.employment_state || 'Full-time'}</td>
    <td style="display:none;">${fmtUSD(e.salary)}</td>
    <td data-label="Next Raise">${(e.nextRaise && e.nextRaise !== 'undefined' && e.nextRaise !== '—') ? escapeHtml(fmtDateShort(e.nextRaise) || e.nextRaise) : '<span class="hv-muted">Not scheduled</span>'}</td>
    <td data-label="Status">${statusPill(e.status)}</td>
    <td data-label="Actions" class="col-actions hv-right" style="white-space:nowrap;">
      ${canWrite ? `<button class="icon-action" onclick="openEmployeeModal('${e.id}')" title="Edit" aria-label="Edit ${escapeHtml(e.name)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"></path></svg></button>` : ''}
      <button class="icon-action" title="Generate salary payment doc" aria-label="Generate salary payment doc for ${escapeHtml(e.name)}" onclick="showSection('a-invoices','admin'); generateSingleInvoice('${e.id}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6"></path></svg></button>
      ${canWrite ? `<button class="icon-action" onclick="askDelete('${e.id}')" title="Delete" aria-label="Remove ${escapeHtml(e.name)}"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg></button>` : ''}
    </td></tr>`).join('') || renderEmptyTableRow(6, 'No employees found.', 'fa-solid fa-user-slash');
  setTableFoot('employeesTableBody', list.length, 'employees');
}
document.getElementById('empSearch').addEventListener('input', e => renderEmployeesTable(e.target.value));

// Personal details (D-036) -------------------------------------------------------------------
let empNameTouched = false;
// What the server already holds for the ID, so an untouched ID is never re-sent.
let empPersonalLoaded = { has_id: false, id_type: '', masked: '' };

function canWritePersonal() { return typeof SessionInfo === 'undefined' || SessionInfo.hasPermission('hr.employee_personal.write'); }
function canReadPersonal() { return typeof SessionInfo === 'undefined' || SessionInfo.hasPermission('hr.employee_personal.read'); }
function canRevealPersonalId() { return typeof SessionInfo === 'undefined' || SessionInfo.hasPermission('hr.employee_personal.reveal'); }

// First and last word of the legal name, as a starting point for the display name.
function suggestDisplayName(legal) {
  const words = String(legal || '').trim().split(/\s+/).filter(Boolean);
  if (words.length <= 2) return words.join(' ');
  return `${words[0]} ${words[words.length - 1]}`;
}

function updateEmpNameHint() {
  const words = fEmpName.value.trim().split(/\s+/).filter(Boolean);
  document.getElementById('fEmpNameHint').style.display = fEmpName.value.trim() && words.length < 2 ? '' : 'none';
}

function syncEmpDisplayName() {
  if (!empNameTouched) {
    fEmpName.value = suggestDisplayName(document.getElementById('fEmpLegalName').value);
  }
  updateEmpNameHint();
}

function updateEmpIdFields() {
  const type = document.getElementById('fEmpIdType').value;
  const field = document.getElementById('fEmpIdNumberField');
  const input = document.getElementById('fEmpIdNumber');
  const keepHint = document.getElementById('fEmpIdKeepHint');
  field.style.display = type ? '' : 'none';
  document.getElementById('fEmpIdNumberLabel').textContent = type === 'passport' ? 'Passport number' : 'National ID number';
  input.placeholder = type === 'passport' ? 'Letters and digits, 6-12 characters' : '14 digits';
  input.inputMode = type === 'passport' ? 'text' : 'numeric';
  const sameAsSaved = empPersonalLoaded.has_id && empPersonalLoaded.id_type === type;
  keepHint.style.display = sameAsSaved ? '' : 'none';
  keepHint.textContent = sameAsSaved ? `Saved as ${empPersonalLoaded.masked}. Leave blank to keep it.` : '';
}

// Returns the id_type/id_number to send, or null to leave the saved ID alone. Throws a message on bad input.
function readEmpIdFields() {
  const type = document.getElementById('fEmpIdType').value;
  const raw = document.getElementById('fEmpIdNumber').value.trim();
  if (!type) return empPersonalLoaded.has_id ? { id_type: null, id_number: null } : null; // clearing a saved ID
  if (!raw) {
    if (empPersonalLoaded.has_id && empPersonalLoaded.id_type === type) return null;      // unchanged
    throw new Error(type === 'passport' ? 'Enter the passport number.' : 'Enter the national ID number.');
  }
  const compact = raw.replace(/\s+/g, '');
  if (type === 'national_id' && !/^\d{14}$/.test(compact)) throw new Error('A national ID must be exactly 14 digits.');
  if (type === 'passport' && !/^[A-Za-z0-9]{6,12}$/.test(compact)) throw new Error('A passport number must be 6-12 letters or digits.');
  return { id_type: type, id_number: type === 'passport' ? compact.toUpperCase() : compact };
}

function isValidPhone(v) {
  const cleaned = String(v || '').replace(/[\s\-().]/g, '');
  return /^\+?\d{7,15}$/.test(cleaned);
}

async function loadEmployeePersonalIntoModal(id) {
  try {
    const p = await Api.getEmployeePersonal(id);
    if (String(currentEditId) !== String(id)) return;
    document.getElementById('fEmpLegalName').value = p.legal_name || '';
    document.getElementById('fEmpPhone').value = p.phone || '';
    document.getElementById('fEmpAddressLine1').value = p.address_line_1 || '';
    document.getElementById('fEmpAddressLine2').value = p.address_line_2 || '';
    empPersonalLoaded = { has_id: !!p.has_id, id_type: p.id_type || '', masked: p.id_number_masked || '' };
    document.getElementById('fEmpIdType').value = empPersonalLoaded.id_type;
    document.getElementById('fEmpIdNumber').value = '';
    updateEmpIdFields();
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  }
}

function openEmployeeModal(id = null) {
  const numId = id !== null ? Number(id) : null;
  currentEditId = (numId !== null && !isNaN(numId)) ? numId : id;
  document.getElementById('empModalTitle').textContent = id ? 'Edit employee' : 'Add employee';
  empPersonalLoaded = { has_id: false, id_type: '', masked: '' };
  ['fEmpLegalName', 'fEmpPhone', 'fEmpAddressLine1', 'fEmpAddressLine2', 'fEmpIdNumber'].forEach(fid => { document.getElementById(fid).value = ''; });
  document.getElementById('fEmpIdType').value = '';
  document.getElementById('fEmpPersonalSection').style.display = canWritePersonal() ? '' : 'none';
  updateEmpIdFields();
  if (id) {
    const e = employees.find(x => String(x.id) === String(id));
    if (!e) return;
    empNameTouched = true;
    fEmpName.value = e.name || ''; fEmpEmail.value = e.email || ''; fEmpDept.value = e.dept || e.department || ''; fEmpRole.value = e.role || '';
    document.getElementById('fEmpInvoiceId').value = e.invoice_id || '';
    if (canWritePersonal()) loadEmployeePersonalIntoModal(id);
    fEmpJoin.value = e.join || ''; fEmpStatus.value = e.status || 'Active'; fEmpVac.value = (e.vacTotal || 21) - (e.vacUsed || 0);
    document.getElementById('fEmpEmploymentState').value = e.employment_state || 'Full-Time';
  } else {
    empNameTouched = false;
    ['fEmpName', 'fEmpEmail', 'fEmpRole'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('fEmpInvoiceId').value = '';
    fEmpJoin.value = ''; fEmpVac.value = 21; fEmpStatus.value = 'Active'; fEmpDept.value = 'Engineering';
    document.getElementById('fEmpEmploymentState').value = 'Full-Time';
  }
  updateEmpNameHint();
  // openModal resets the inline display that closeModal sets, so the dialog can reopen in the same page load
  openModal('employeeModal');
}

async function saveEmployee(evt) {
  const btn = (evt && evt.currentTarget) || document.getElementById('empModalSaveBtn') || document.querySelector('#employeeModal .btn-fill');
  const name = document.getElementById('fEmpName').value.trim();
  const empEmailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const withPersonal = canWritePersonal();
  const rules = [
    { id: 'fEmpName', message: 'Enter the employee\'s display name.' },
    { id: 'fEmpEmail', message: 'Enter a valid email address.', check: (v) => empEmailRe.test(v) },
  ];
  if (withPersonal) {
    rules.push(
      { id: 'fEmpLegalName', message: 'Enter the legal full name.' },
      { id: 'fEmpPhone', message: 'Enter a valid phone number (7-15 digits, optional leading +).', check: isValidPhone },
      { id: 'fEmpAddressLine1', message: 'Enter address line 1.' },
    );
  }
  if (!FinanceForm.validateRequiredFields('employeeModal', rules)) return;
  let idFields = null;
  if (withPersonal) {
    try { idFields = readEmpIdFields(); }
    catch (err) {
      FinanceForm.showErrorSummary('employeeModal', [{ fieldId: 'fEmpIdNumber', message: err.message }]);
      return;
    }
  }
  const vacTotal = Number(fEmpVac.value) || 21;
  const invoice_id = document.getElementById('fEmpInvoiceId').value.trim();
  const personal = withPersonal ? {
    legal_name: document.getElementById('fEmpLegalName').value.trim(),
    phone: document.getElementById('fEmpPhone').value.trim(),
    address_line_1: document.getElementById('fEmpAddressLine1').value.trim(),
    address_line_2: document.getElementById('fEmpAddressLine2').value.trim(),
  } : {};
  if (invoice_id && !/^\d{1,2}$/.test(invoice_id)) {
    FinanceForm.showErrorSummary('employeeModal', [{ fieldId: 'fEmpInvoiceId', message: 'Payment doc ID must be a number between 01 and 99.' }]);
    return;
  }
  setButtonLoading(btn, true, 'Saving…');
  let created = null;
  try {
    if (currentEditId) {
      const updates = { name, email: fEmpEmail.value, dept: fEmpDept.value, job_role: fEmpRole.value, join_date: fEmpJoin.value, status: fEmpStatus.value, vac_total: vacTotal, employment_state: document.getElementById('fEmpEmploymentState').value, invoice_id };
      await Api.updateEmployee(currentEditId, updates);
      if (withPersonal) await Api.updateEmployeePersonal(currentEditId, { ...personal, ...(idFields || {}) });
      toast('Employee updated successfully.');
    } else {
      const payload = { name, email: fEmpEmail.value, dept: fEmpDept.value, job_role: fEmpRole.value, join_date: fEmpJoin.value, status: fEmpStatus.value, vac_total: vacTotal, next_raise: '2027-01-01', employment_state: document.getElementById('fEmpEmploymentState').value, invoice_id, ...personal, ...(idFields || {}) };
      created = await Api.createEmployee(payload);
      toast('New employee added. Set their pay plan next, or skip it for now.');
    }
    closeModal('employeeModal');
    await loadAdminData();
    // D-036: pay is set in the Pay plan, so a new employee goes straight to it (Cancel = set it later).
    if (created && created.id != null && employees.some(x => String(x.id) === String(created.id)) && typeof openCompPlanModal === 'function' && canWritePayPlan()) {
      openCompPlanModal(created.id);
    }
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}

function askDelete(id) {
  currentDeleteId = id;
  const emp = employees.find(e => String(e.id) === String(id));
  document.getElementById('delEmpName').textContent = emp ? emp.name : 'this employee';
  openModal('confirmModal');
}
async function confirmDelete(evt) {
  const btn = (evt && evt.currentTarget) || document.querySelector('#confirmModal .btn-danger-outline');
  setButtonLoading(btn, true, 'Deleting...');
  try {
    await Api.deleteEmployee(currentDeleteId);
    closeModal('confirmModal');
    toast('Employee removed.', 'fa-solid fa-trash');
    await loadAdminData();
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}

function canReadSalary() { return typeof SessionInfo === 'undefined' || SessionInfo.hasPermission('hr.salary.read'); }
function canWriteSalary() { return typeof SessionInfo === 'undefined' || SessionInfo.hasPermission('hr.salary.write'); }
// D-038: the Pay plan routes accept the finance key or the matching HR salary key.
function canWritePayPlan() { return typeof SessionInfo === 'undefined' || SessionInfo.hasPermission('finance.payroll.prepare') || SessionInfo.hasPermission('hr.salary.write'); }

// Profile head, left zone: monthly total only. The split, raises and actions live in the Compensation card.
function compZoneInnerHtml(e) {
  if (!canReadSalary()) {
    return `<div class="ed-kpi-k">Monthly total</div>
      <div class="ed-kpi-s">Not available for your role.</div>`;
  }
  const total = Number(e.internalSalaryUsd || 0) + Number(e.externalSalaryUsd || 0);
  if (total <= 0) {
    return `<div class="ed-kpi-k">Monthly total</div>
    <div class="ed-kpi-v ed-kpi-v--brand">Not set</div>
    <div class="ed-kpi-s">no pay plan yet</div>`;
  }
  return `<div class="ed-kpi-k">Monthly total</div>
    <div class="ed-kpi-v ed-kpi-v--brand">${fmtUSD(total)}</div>
    <div class="ed-kpi-s">per month, USD</div>`;
}

// "EMP001" style code shown on the profile header (same format as the Employees table)
function empCodeLabel(id) {
  if (id === undefined || id === null || id === '') return '';
  return /^\d+$/.test(String(id)) ? 'EMP' + String(id).padStart(3, '0') : String(id);
}

// "Full-Time" becomes "Full-time" for pills (the stored value is unchanged)
function sentenceCase(s) {
  const v = String(s || '');
  return v ? v.charAt(0).toUpperCase() + v.slice(1).toLowerCase() : v;
}

// Compensation card on the employee profile: split, next and last raise, and this employee's raise history.
function renderCompensationCard(e) {
  const card = document.getElementById('employeeCompensationCard');
  if (!card) return;
  card.hidden = !canReadSalary() || !e;
  if (card.hidden) return;
  const actions = document.getElementById('employeeCompensationActions');
  const editPlanBtn = document.getElementById('compEditPlanBtn');
  const raiseBtn = document.getElementById('compApplyRaiseBtn');
  if (editPlanBtn) editPlanBtn.hidden = !canWritePayPlan();
  if (raiseBtn) raiseBtn.hidden = !canWriteSalary(); // Apply raise calls /api/salary/raise (hr.salary.write)
  if (actions) actions.hidden = !canWritePayPlan() && !canWriteSalary();

  const internalUsd = Number(e.internalSalaryUsd || 0);
  const externalUsd = Number(e.externalSalaryUsd || 0);
  const history = (e.salaryHistory || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  const rows = history.map((h, idx) => {
    const older = history[idx + 1];
    const prevInternal = older ? Number(older.newInternal || 0) : Number(h.prevInternal || 0);
    const prevExternal = older ? Number(older.newExternal || 0) : Number(h.prevExternal || 0);
    const newInternal = Number(h.newInternal || 0);
    const newExternal = Number(h.newExternal || 0);
    const d = computeRowDeltas(prevInternal, prevExternal, newInternal, newExternal);
    const change = (prevInternal + prevExternal) > 0
      ? `<span class="badge-pill pill-success">${fmtDelta(d.totalAmt, d.totalPct)}</span>`
      : '<span class="badge-pill pill-neutral">Starting pay</span>';
    return { h, d, html: `<tr>
      <td data-label="Effective">${escapeHtml(fmtDateShort(h.date))}</td>
      <td data-label="Internal">${fmtUSD(newInternal)}</td>
      <td data-label="External">${fmtUSD(newExternal)}</td>
      <td data-label="Total">${fmtUSD(newInternal + newExternal)}</td>
      <td data-label="Change">${change}</td>
      <td data-label="Reason">${escapeHtml(h.reason || '—')}</td>
    </tr>` };
  });
  const last = rows[0];
  const lastHtml = last
    ? `${escapeHtml(fmtDateShort(last.h.date))}<div class="compensation-sub">${fmtDelta(last.d.totalAmt, last.d.totalPct)}</div>`
    : '—<div class="compensation-sub">No raises yet</div>';

  document.getElementById('employeeCompensationBody').innerHTML = `
    <div class="compensation-metrics">
      <div class="compensation-metric"><div class="compensation-k">Internal USD cash</div><div class="compensation-v compensation-internal" id="compInternalVal">${fmtUSD(internalUsd)}</div></div>
      <div class="compensation-metric"><div class="compensation-k">External USD</div><div class="compensation-v compensation-external" id="compExternalVal">${fmtUSD(externalUsd)}</div></div>
      <div class="compensation-metric"><div class="compensation-k">Total / month</div><div class="compensation-v" id="compTotalVal">${fmtUSD(internalUsd + externalUsd)}</div></div>
      <div class="compensation-metric"><div class="compensation-k">Next raise</div><div class="compensation-v compensation-date" id="compNextRaiseVal">${escapeHtml(fmtDateShort(e.nextRaise))}</div></div>
      <div class="compensation-metric"><div class="compensation-k">Last raise</div><div class="compensation-v compensation-date" id="compLastRaiseVal">${lastHtml}</div></div>
    </div>
    <div class="compensation-history-label">Raise history</div>
    <table class="responsive-card-table" id="compensationHistoryTable">
      <thead><tr><th>Effective</th><th>Internal</th><th>External</th><th>Total</th><th>Change</th><th>Reason</th></tr></thead>
      <tbody id="compensationHistoryBody">${rows.map(r => r.html).join('') || renderEmptyTableRow(6, 'No raises recorded yet.', 'fa-solid fa-sack-dollar')}</tbody>
    </table>`;
}

// After a raise or plan change: re-render the open profile's compensation views from the reloaded data.
function refreshProfileCompensation() {
  const page = document.getElementById('a-employee-detail');
  if (!page || !page.classList.contains('active') || currentDetailEmployeeId == null) return;
  const e = employees.find(x => String(x.id) === String(currentDetailEmployeeId));
  if (!e) return;
  renderCompensationCard(e);
  const zone = document.getElementById('detailCompZone');
  if (zone) zone.innerHTML = compZoneInnerHtml(e);
  loadPayrollPaymentsCard(currentDetailEmployeeId);
}

// Personal details rows on the employee page (D-036); the ID is masked until revealed.
async function loadPersonalRows(id, revealId = false) {
  const host = document.getElementById('detailPersonalRows');
  if (!host) return;
  if (!canReadPersonal()) { host.innerHTML = ''; return; }
  try {
    const p = await Api.getEmployeePersonal(id, revealId);
    if (String(currentDetailEmployeeId) !== String(id)) return;
    const unset = '<span class="ed-unset">Not set</span>';
    const address = [p.address_line_1, p.address_line_2].filter(Boolean).join(', ');
    let idHtml = unset;
    if (p.has_id) {
      const label = p.id_type === 'passport' ? 'Passport' : 'National ID';
      const shown = revealId ? escapeHtml(p.id_number || '') : escapeHtml(p.id_number_masked || '');
      const toggle = canRevealPersonalId()
        ? ` <button type="button" class="btn btn-sm btn-outline" id="detailIdToggleBtn" onclick="loadPersonalRows('${id}', ${revealId ? 'false' : 'true'})">${revealId ? 'Hide' : 'Reveal'}</button>`
        : '';
      idHtml = `${label} <span id="detailIdValue">${shown}</span>${toggle}`;
    }
    host.innerHTML = `
      ${escRow('fa-id-card', 'Legal name', p.legal_name ? escapeHtml(p.legal_name) : unset, { wrap: true })}
      ${escRow('fa-phone', 'Phone', p.phone ? escapeHtml(p.phone) : unset)}
      ${escRow('fa-location-dot', 'Address', address ? escapeHtml(address) : unset, { wrap: true, title: escapeHtml(address) })}
      ${escRow('fa-passport', 'ID', idHtml, { wrap: true })}`;
  } catch (err) {
    host.innerHTML = escRow('fa-id-card', 'Personal details', '<span class="ed-unset">Could not load</span>');
  }
}

function escRow(icon, label, valueHtml, opts = {}) {
  const { wrap = false, title = '' } = opts;
  return `<div class="esc-row${wrap ? ' wrap' : ''}">
    <span class="esc-k"><i class="fa-solid ${icon}"></i> ${label}</span>
    <span class="esc-v"${title ? ` title="${title}"` : ''}>${valueHtml}</span>
  </div>`;
}

async function viewProfile(id, section) {
  const numId = Number(id);
  currentDetailEmployeeId = !isNaN(numId) ? numId : id;
  showSection('a-employee-detail', 'admin', section ? [id, section] : [id]);
  loadPayrollPaymentsCard(id);
  if (window.EmployeePayAnalytics) EmployeePayAnalytics.onEmployee(id);
  const e = employees.find(x => String(x.id) === String(id));
  if (!e) return;
  const titleEl = document.getElementById('adminPageTitle');
  if (titleEl && e.name) titleEl.textContent = `Employees / ${e.name}`;
  if (section === 'bank' || section === 'social' || section === 'compensation') {
    const targetId = { bank: 'bankAccountCard', social: 'socialInsuranceCard', compensation: 'employeeCompensationCard' }[section];
    setTimeout(() => { const card = document.getElementById(targetId); if (card) card.scrollIntoView({ block: 'center' }); }, 200);
  }

  renderCompensationCard(e);
  const vacRemaining = (e.vacTotal || 21) - (e.vacUsed || 0);

  const canWriteEmp = typeof SessionInfo !== 'undefined' ? SessionInfo.hasPermission('hr.employee.write') : true;
  document.getElementById('detailProfileHead').innerHTML = `
    <div class="esc-head">
      <div class="esc-avatar">${initials(e.name)}</div>
      <div class="esc-identity">
        <div class="ed-name">
          <h4>${escapeHtml(e.name)}</h4>
          ${statusPill(e.status)}
          <span class="badge-pill pill-neutral">${escapeHtml(sentenceCase(e.employment_state || 'Full-Time'))}</span>
        </div>
        <div class="esc-meta">
          ${empCodeLabel(e.id) ? `<span>${escapeHtml(empCodeLabel(e.id))}</span><span class="esc-dot"></span>` : ''}<span>${escapeHtml(e.role)}</span><span class="esc-dot"></span>
          <span>${escapeHtml(e.dept)}</span>${e.email ? `<span class="esc-dot"></span><span>${escapeHtml(e.email)}</span>` : ''}
        </div>
      </div>
      <div class="ed-actions">
        <button type="button" class="btn btn-sm btn-outline" id="edBehalfVacationBtn" onclick="openBehalfVacationModal()">Leave on behalf</button>
        <button type="button" class="btn btn-sm btn-outline" id="edBehalfClaimBtn" onclick="openBehalfClaimModal()">Claim on behalf</button>
        ${canWriteEmp ? `<button type="button" class="btn btn-sm btn-fill" id="edEditEmployeeBtn" onclick="openEmployeeModal('${e.id}')">Edit employee</button>` : ''}
      </div>
    </div>`;

  const nextRaiseDays = (() => {
    if (!e.nextRaise || e.nextRaise === '\u2014') return '';
    const d = new Date(e.nextRaise); if (isNaN(d)) return '';
    const n = Math.round((d - new Date()) / 86400000);
    return n >= 0 ? `in ${n} days` : '';
  })();
  const kpi = (label, valueHtml, sub) => `<div class="ed-kpi"><div class="ed-kpi-k">${label}</div><div class="ed-kpi-v">${valueHtml}</div>${sub ? `<div class="ed-kpi-s">${sub}</div>` : ''}</div>`;
  document.getElementById('detailInfoGrid').innerHTML = `
    <div class="esc-body ed-kpis">
      <div class="ed-kpi ed-kpi--total" id="detailCompZone">${compZoneInnerHtml(e)}</div>
      ${canReadSalary() ? kpi('Internal USD cash', fmtUSD(Number(e.internalSalaryUsd || 0)), 'paid locally') + kpi('External USD', fmtUSD(Number(e.externalSalaryUsd || 0)), 'US transfer') + kpi('Next raise', escapeHtml(fmtDateShort(e.nextRaise)), nextRaiseDays) : ''}
      ${kpi('Vacation left', `<span id="detailVacRemaining">${vacRemaining} / ${e.vacTotal || 21}</span>`, `<span id="detailVacUsedSub">days, ${e.vacUsed || 0} used in ${new Date().getFullYear()}</span>`)}
    </div>`;
  document.getElementById('detailMetaBody').innerHTML = `
    ${escRow('fa-envelope', 'Email', e.email, { title: e.email })}
    ${e.join ? escRow('fa-calendar', 'Joined', fmtDateShort(e.join)) : ''}
    ${escRow('fa-hashtag', 'Payment doc ID', e.invoice_id ? escapeHtml(String(e.invoice_id)) : '<span class="ed-unset">Not set</span>')}
    <div id="detailPersonalRows"></div>`;
    loadPersonalRows(id);
    const consumption = insuranceConsumption.find(c => String(c.employee_id) === String(id));
    document.getElementById('detailInsuranceGrid').innerHTML = consumption && consumption.categories.length ? consumption.categories.map(renderCategoryChip).join('') : '<p class="ed-empty-note">No insurance consumption data available.</p>';
    document.getElementById('detailInsuranceTotal').innerHTML = consumption ? `${fmtMoney(consumption.total_consumed)} <span class="ed-total-of">of ${fmtMoney(consumption.total_limit)}</span>` : '—';
    showTableSkeleton('detailVacationBody', 2, 3);
    showTableSkeleton('detailClaimsBody', 2, 3);
    showTableSkeleton('detailDocumentsBody', 2, 2);
    if (window.location && window.location.search && window.location.search.includes('mock=')) {
      document.getElementById('detailVacationBody').innerHTML = renderEmptyTableRow(2, 'No vacation records in mock view.');
      document.getElementById('detailClaimsBody').innerHTML = renderEmptyTableRow(2, 'No insurance claims in mock view.');
      // Documents and bank status have mock data, so the mock view shows their real states (Preview buttons, Missing bank card)
      await loadEmployeeDocuments(id);
      await loadBankAccountStatus(id);
      await loadTaxMethodStatus(id);
      return;
    }
    try {
      const [vacHistory, claims, notes, freshConsumption] = await Promise.all([
        Api.getVacationHistory(id),
        Api.getInsuranceClaims(),
        Api.getEmployeeNotes(id),
        Api.getInsuranceConsumption(),
      ]);
      // Sequence guard: a slower earlier profile load must not overwrite a later one
      if (String(currentDetailEmployeeId) !== String(id)) return;
      const usedVacDays = vacHistory
        .filter(v => v.status === 'Approved' && (v.type === 'Annual Leave' || !v.type))
        .reduce((sum, v) => sum + (Number(v.days) || 0), 0);
      const totalVacDays = e.vacTotal || 21;
      const remainingVacDays = Math.max(0, totalVacDays - usedVacDays);
      const leaveMetaEl = document.getElementById('detailLeaveMeta');
      if (leaveMetaEl) leaveMetaEl.textContent = `${remainingVacDays} of ${totalVacDays} days left`;
      const vacRemainingEl = document.getElementById('detailVacRemaining');
      if (vacRemainingEl) {
        vacRemainingEl.textContent = `${remainingVacDays} / ${totalVacDays}`;
      }
      const vacUsedSubEl = document.getElementById('detailVacUsedSub');
      if (vacUsedSubEl) vacUsedSubEl.textContent = `days, ${totalVacDays - remainingVacDays} used in ${new Date().getFullYear()}`;

      if (freshConsumption) {
        if (Array.isArray(freshConsumption)) {
          insuranceConsumption = freshConsumption;
          const empConsumption = freshConsumption.find(c => String(c.employee_id) === String(id) || (e.name && (c.employee_name || '').toLowerCase() === e.name.toLowerCase())) || (freshConsumption.length === 1 ? freshConsumption[0] : null);
          if (empConsumption) {
            document.getElementById('detailInsuranceGrid').innerHTML = empConsumption.categories && empConsumption.categories.length ? empConsumption.categories.map(renderCategoryChip).join('') : '<p class="ed-empty-note">No insurance consumption data available.</p>';
            document.getElementById('detailInsuranceTotal').innerHTML = `${fmtMoney(empConsumption.total_consumed)} <span class="ed-total-of">of ${fmtMoney(empConsumption.total_limit)}</span>`;
          }
        }
      }

      document.getElementById('detailVacationBody').innerHTML = vacHistory.map(v => `<tr><td data-label="Type"><div class="ed-title">${escapeHtml(v.type)} \u00b7 ${v.days}</div><div class="ed-sub">${v.start_date} to ${v.end_date}</div></td><td data-label="Status" class="ed-status">${statusPill(v.status)}</td></tr>`).join('') || renderEmptyTableRow(2, 'No vacation records yet.', 'fa-solid fa-umbrella-beach');
      const empClaims = claims.filter(c => String(c.employee_id || c.Employee_Id || c.employeeId) === String(id) || (e.name && (c.employee_name || c.Employee_Name || '').toLowerCase() === e.name.toLowerCase()));
      document.getElementById('detailClaimsBody').innerHTML = empClaims.map(c => {
        const cat = c.category || c.Category || c.claim_category || c.type || '—';
        const amt = c.amount !== undefined ? c.amount : (c.Amount || 0);
        const dt = c.date || c.Date || '—';
        const st = c.status || c.Status || 'Pending';
        return `<tr><td data-label="Category"><div class="ed-title">${cat} \u00b7 ${fmtMoney(amt)}</div><div class="ed-sub">${dt}</div></td><td data-label="Status" class="ed-status">${statusPill(st)}</td></tr>`;
      }).join('') || renderEmptyTableRow(2, 'No insurance claims yet.', 'fa-solid fa-briefcase-medical');
      const claimsMetaEl = document.getElementById('detailClaimsMeta');
      if (claimsMetaEl) {
        const yr = String(new Date().getFullYear());
        const claimedThisYear = empClaims
          .filter(c => String(c.date || c.Date || '').startsWith(yr))
          .reduce((s, c) => s + (Number(c.amount !== undefined ? c.amount : c.Amount) || 0), 0);
        claimsMetaEl.textContent = empClaims.length ? `${fmtMoney(claimedThisYear)} this year` : '';
      }
      renderNotesList(notes);
      await loadEmployeeDocuments(id);
      await loadBankAccountStatus(id);
      await loadSocialInsuranceStatus(id);
      await loadTaxMethodStatus(id);
    } catch (err) { toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}

function renderNotesList(notes) {
  const list = document.getElementById('detailNotesList');
  const catIcons = { General: 'fa-solid fa-note-sticky', Performance: 'fa-solid fa-chart-line', Incident: 'fa-solid fa-triangle-exclamation', Achievement: 'fa-solid fa-trophy', Attendance: 'fa-solid fa-calendar-check', Warning: 'fa-solid fa-flag' };
  const catColors = { General: 'accent', Performance: 'success', Incident: 'danger', Achievement: 'success', Attendance: 'info', Warning: 'warning' };
  list.innerHTML = notes.map(n => {
    const color = catColors[n.category] || 'accent';
    return `<li><div class="ic ic--${color}"><i class="${catIcons[n.category] || 'fa-solid fa-note-sticky'}"></i></div><div class="txt"><strong>${escapeHtml(n.category)} • ${n.date}</strong><p>${escapeHtml(n.note)}</p><p class="ed-note-by">By ${escapeHtml(n.created_by)}</p></div><button class="icon-action" onclick="deleteEmployeeNote(${n.id})"><i class="fa-solid fa-trash"></i></button></li>`;
  }).join('') || `<li>${getEmptyStateHtml('No notes recorded yet.', 'fa-solid fa-note-sticky')}</li>`;
}

async function saveEmployeeNote(evt) {
  const btn = (evt && evt.currentTarget) || document.querySelector('#a-employee-detail .btn-fill');
  const date = document.getElementById('fNoteDate').value;
  const category = document.getElementById('fNoteCategory').value;
  const note = document.getElementById('fNoteText').value.trim();
  if (!note) { toast('Please enter a note.', 'fa-solid fa-triangle-exclamation'); return; }
  setButtonLoading(btn, true, 'Adding...');
  try {
    await Api.createEmployeeNote(currentDetailEmployeeId, { date: date || null, category, note });
    toast('Note added.');
    document.getElementById('fNoteText').value = '';
    const notes = await Api.getEmployeeNotes(currentDetailEmployeeId);
    renderNotesList(notes);
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function deleteEmployeeNote(noteId) {
  const ok = await FinanceCommand.confirmAction({
    title: 'Delete note',
    consequence: 'Delete this note? This cannot be undone.',
    actionLabel: 'Delete note',
  });
  if (!ok.confirmed) return;
  try {
    await Api.deleteEmployeeNote(noteId);
    toast('Note deleted.', 'fa-solid fa-trash');
    const notes = await Api.getEmployeeNotes(currentDetailEmployeeId);
    renderNotesList(notes);
  } catch (err) { toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}

function openBehalfVacationModal(empId = null) {
  if (empId) {
    currentDetailEmployeeId = empId;
  }
  const emp = currentDetailEmployeeId ? employees.find(e => String(e.id) === String(currentDetailEmployeeId)) : null;
  const titleEl = document.querySelector('#behalfVacationModal .modal-head-text h3');
  if (titleEl) titleEl.textContent = emp ? `Record leave · ${emp.name}` : 'Record leave on behalf';

  document.getElementById('bvType').value = 'Annual Leave';
  document.getElementById('bvStart').value = '';
  document.getElementById('bvEnd').value = '';
  document.getElementById('bvDays').value = '1';
  document.getElementById('bvStatus').value = 'Approved';
  document.getElementById('bvRecordDate').value = '';
  openModal('behalfVacationModal');
}
async function submitBehalfVacation(evt) {
  const btn = (evt && evt.currentTarget) || document.getElementById('behalfVacationSaveBtn') || document.querySelector('#behalfVacationModal .btn-fill');
  const emp = employees.find(e => String(e.id) === String(currentDetailEmployeeId));
  const leave_type = document.getElementById('bvType').value;
  const start_date = document.getElementById('bvStart').value;
  const end_date = document.getElementById('bvEnd').value || start_date;
  const days = Number(document.getElementById('bvDays').value) || 1;
  const status = document.getElementById('bvStatus').value;
  const record_date = document.getElementById('bvRecordDate').value || null;
  if (!FinanceForm.validateRequiredFields('behalfVacationModal', [{ id: 'bvStart', message: 'Select a start date.' }])) return;
  setButtonLoading(btn, true, 'Submitting…');
  try {
    await Api.requestVacation({ employee_name: emp.name, employee_id: emp.id, leave_type, start_date, end_date, days, status, record_date });
    closeModal('behalfVacationModal');
    toast(`Vacation/WFH record added for ${emp.name}.`);
    await loadAdminData();
    await viewProfile(currentDetailEmployeeId);
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function openBehalfClaimModal(empId = null) {
  if (empId) {
    currentDetailEmployeeId = empId;
  } else if (!currentDetailEmployeeId && typeof employees !== 'undefined' && employees && employees.length > 0) {
    currentDetailEmployeeId = employees[0].id;
  }
  const emp = (typeof employees !== 'undefined' && employees) ? employees.find(e => String(e.id) === String(currentDetailEmployeeId)) : null;
  const titleEl = document.getElementById('behalfClaimModalTitle');
  if (titleEl) {
    titleEl.textContent = emp ? `Record claim · ${emp.name}` : 'Record claim';
  }
  if (!insuranceCategories || insuranceCategories.length === 0) {
    try {
      insuranceCategories = await Api.getInsuranceCategories();
    } catch (e) {}
  }
  const sel = document.getElementById('bcCategory');
  sel.innerHTML = (insuranceCategories || []).map(c => {
    const name = c.name || c.category || c.Name || c.Category;
    return name ? `<option value="${name}">${name}</option>` : '';
  }).filter(Boolean).join('');
  document.getElementById('bcProvider').value = '';
  document.getElementById('bcAmount').value = '';
  document.getElementById('bcStatus').value = 'Approved';
  document.getElementById('bcRecordDate').value = '';
  clearBcDocFileSelection();
  openModal('behalfClaimModal');
}
async function submitBehalfClaim(evt) {
  const btn = (evt && evt.currentTarget) || document.getElementById('behalfClaimSaveBtn') || document.querySelector('#behalfClaimModal .btn-fill');
  const emp = (typeof employees !== 'undefined' && employees) ? employees.find(e => String(e.id) === String(currentDetailEmployeeId)) : null;
  if (!emp) {
    toast('Select an employee for this claim.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  const category = document.getElementById('bcCategory').value;
  const provider = document.getElementById('bcProvider').value;
  const amount = Number(document.getElementById('bcAmount').value);
  const status = document.getElementById('bcStatus').value;
  const record_date = document.getElementById('bcRecordDate').value || null;
  const fileInput = document.getElementById('bcDocument');
  if (!FinanceForm.validateRequiredFields('behalfClaimModal', [
    { id: 'bcCategory', message: 'Select an insurance category.', check: (v) => !!v && v !== 'undefined' },
    { id: 'bcAmount', message: 'Enter a claim amount greater than 0.', check: (v) => Number(v) > 0 },
  ])) return;
  let documentUrl;
  const file = fileInput && fileInput.files[0];
  if (file) {
    if (file.size > 2 * 1024 * 1024) { toast('Supporting document must be under 2MB.', 'fa-solid fa-triangle-exclamation'); return; }
    try { documentUrl = await readFileAsDataUrl(file); }
    catch (e) { toast('Could not read the selected file.', 'fa-solid fa-triangle-exclamation'); return; }
  }
  setButtonLoading(btn, true, 'Submitting…');
  try {
    await Api.submitInsuranceClaim({ employee_name: emp.name, employee_id: emp.id, category, provider, amount, document_url: documentUrl, status, record_date });
    closeModal('behalfClaimModal');
    toast(`Insurance claim added for ${emp.name}.`);
    await loadAdminData();
    if (document.getElementById('a-employee-detail') && document.getElementById('a-employee-detail').classList.contains('active')) {
      await viewProfile(currentDetailEmployeeId);
    }
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function loadEmployeeDocuments(empId) {
  try {
    const docs = await Api.getEmployeeDocuments(empId);
    if (String(currentDetailEmployeeId) !== String(empId)) return;
    employeeDocuments = docs;
    renderEmployeeDocuments(docs);
  } catch (err) { toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}

function docTypeIcon(fileType) {
  return fileType === 'image' ? '<i class="fa-solid fa-image"></i>' : '<i class="fa-solid fa-file-pdf"></i>';
}

function renderEmployeeDocuments(docs) {
  const body = document.getElementById('detailDocumentsBody');
  if (!body) return;
  body.innerHTML = docs.length ? docs.map(d => `<tr>
    <td data-label="Document"><div class="doc-name-cell"><div class="doc-type-icon ${d.file_type === 'image' ? 'image' : 'pdf'}">${docTypeIcon(d.file_type)}</div><div><div class="ed-title doc-name-text">${escapeHtml(d.name)}</div><div class="ed-sub">${d.uploaded_at}</div></div></div></td>
    <td data-label="Actions" class="col-actions">
      <button class="btn btn-sm btn-outline" title="Preview" data-action="preview-employee-doc" data-id="${escapeHtml(d.id)}" data-name="${escapeHtml(d.name)}" data-type="${escapeHtml(d.file_type || '')}">Preview</button>
      <button class="icon-action" title="Download" onclick="downloadEmployeeDocument(${d.id})"><i class="fa-solid fa-download"></i></button>
      <button class="icon-action" title="Delete" onclick="deleteEmployeeDocument(${d.id})"><i class="fa-solid fa-trash"></i></button>
    </td></tr>`).join('') : renderEmptyTableRow(2, 'No documents uploaded yet.', 'fa-solid fa-folder-open');
}

function previewEmployeeDocument(docId, name, fileType) {
  const container = document.getElementById('docPreviewContainer');
  document.getElementById('docPreviewTitle').textContent = name || 'Document Preview';
  const downloadBtn = document.getElementById('docPreviewDownloadBtn');
  downloadBtn.onclick = (e) => {
    e.preventDefault();
    Api.downloadEmployeeDocumentFile(docId, name).catch(err => toast(err.message, 'fa-solid fa-triangle-exclamation'));
  };
  renderLoadingState(container, 'Loading preview...');
  openModal('documentPreviewModal');
  Api.getDocumentPreviewBlobUrl(docId).then(url => {
    if (fileType === 'image') {
      container.innerHTML = `<img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;">`;
    } else {
      container.innerHTML = `<iframe src="${url}" style="width:100%;height:75vh;border:none;background:var(--surface);"></iframe>`;
    }
  }).catch(err => {
    container.innerHTML = `<div style="color:var(--danger);font-size:13px;padding:20px;text-align:center;">${err.message}</div>`;
  });
}

function closeDocumentPreview() {
  closeModal('documentPreviewModal');
  document.getElementById('docPreviewContainer').innerHTML = '';
}

function downloadEmployeeDocument(docId) {
  Api.downloadEmployeeDocumentFile(docId).catch(err => toast(err.message, 'fa-solid fa-triangle-exclamation'));
}

function detectDocFileType(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return 'pdf';
  return 'image';
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function openEmployeeDocumentModal() {
  document.getElementById('docName').value = '';
  clearDocFileSelection();
  document.getElementById('docUploadProgressWrap').style.display = 'none';
  document.getElementById('docUploadProgressFill').style.width = '0%';
  document.getElementById('docUploadBtn').disabled = false;
  document.getElementById('docCancelBtn').disabled = false;
  openModal('employeeDocumentModal');
}

function clearDocFileSelection() {
  docSelectedFile = null;
  const fileInput = document.getElementById('docFileInput');
  if (fileInput) fileInput.value = '';
  document.getElementById('docDropZoneEmpty').style.display = '';
  document.getElementById('docDropZoneFile').style.display = 'none';
}

function clearBcDocFileSelection() {
  bcDocSelectedFile = null;
  const fileInput = document.getElementById('bcDocument');
  if (fileInput) fileInput.value = '';
  const emptyEl = document.getElementById('bcDocDropZoneEmpty');
  const fileEl = document.getElementById('bcDocDropZoneFile');
  if (emptyEl) emptyEl.style.display = '';
  if (fileEl) fileEl.style.display = 'none';
}

function handleDocFileSelected(file) {
  if (!file) return;
  if (file.size > 4 * 1024 * 1024) { toast('File must be under 4MB.', 'fa-solid fa-triangle-exclamation'); return; }
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(file.name);
  if (!isPdf && !isImage) { toast('Only PDF and image files (JPG, PNG) are supported.', 'fa-solid fa-triangle-exclamation'); return; }
  docSelectedFile = file;
  const fileType = detectDocFileType(file);
  document.getElementById('docDropZoneEmpty').style.display = 'none';
  document.getElementById('docDropZoneFile').style.display = 'flex';
  document.getElementById('docFileName').textContent = file.name;
  document.getElementById('docFileSize').textContent = formatFileSize(file.size);
  const iconWrap = document.getElementById('docFileIconWrap');
  iconWrap.className = 'doc-file-icon ' + (fileType === 'image' ? 'image' : 'pdf');
  iconWrap.innerHTML = fileType === 'image' ? '<i class="fa-solid fa-image"></i>' : '<i class="fa-solid fa-file-pdf"></i>';
  if (!document.getElementById('docName').value.trim()) {
    document.getElementById('docName').value = file.name.replace(/\.[^.]+$/, '');
  }
}

function handleBcDocFileSelected(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    toast('Supporting document must be under 2MB.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png)$/i.test(file.name);
  if (!isPdf && !isImage) {
    toast('Only PDF and image files (JPG, PNG) are supported.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  bcDocSelectedFile = file;
  const fileType = detectDocFileType(file);
  const emptyEl = document.getElementById('bcDocDropZoneEmpty');
  const fileEl = document.getElementById('bcDocDropZoneFile');
  const nameEl = document.getElementById('bcDocFileName');
  const sizeEl = document.getElementById('bcDocFileSize');
  const iconWrap = document.getElementById('bcDocFileIconWrap');
  if (emptyEl) emptyEl.style.display = 'none';
  if (fileEl) fileEl.style.display = 'flex';
  if (nameEl) nameEl.textContent = file.name;
  if (sizeEl) sizeEl.textContent = formatFileSize(file.size);
  if (iconWrap) {
    iconWrap.className = 'doc-file-icon ' + (fileType === 'image' ? 'image' : 'pdf');
    iconWrap.innerHTML = fileType === 'image' ? '<i class="fa-solid fa-image"></i>' : '<i class="fa-solid fa-file-pdf"></i>';
  }
}

function initDocDropZoneListeners() {
  const zone = document.getElementById('docDropZone');
  const input = document.getElementById('docFileInput');
  if (!zone || zone.dataset.bound) return;
  zone.dataset.bound = '1';
  input.addEventListener('change', () => { if (input.files[0]) handleDocFileSelected(input.files[0]); });
  ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.remove('drag-over'); }));
  zone.addEventListener('drop', e => {
    const f = e.dataTransfer.files[0];
    if (f) handleDocFileSelected(f);
  });
}

function initBcDocDropZoneListeners() {
  const zone = document.getElementById('bcDocDropZone');
  const input = document.getElementById('bcDocument');
  if (!zone || !input || zone.dataset.bound) return;
  zone.dataset.bound = '1';
  input.addEventListener('change', () => { if (input.files[0]) handleBcDocFileSelected(input.files[0]); });
  ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.remove('drag-over'); }));
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer.files[0];
    if (f) {
      input.files = e.dataTransfer.files;
      handleBcDocFileSelected(f);
    }
  });
}

async function submitEmployeeDocument() {
  const name = document.getElementById('docName').value.trim();
  const file = docSelectedFile;
  if (!name) { toast('Please enter a document name.', 'fa-solid fa-triangle-exclamation'); return; }
  if (!file) { toast('Please choose a file to upload.', 'fa-solid fa-triangle-exclamation'); return; }
  if (file.size > 4 * 1024 * 1024) { toast('File must be under 4MB.', 'fa-solid fa-triangle-exclamation'); return; }
  const fileType = detectDocFileType(file);
  const progressWrap = document.getElementById('docUploadProgressWrap');
  const progressFill = document.getElementById('docUploadProgressFill');
  const progressPct = document.getElementById('docUploadProgressPct');
  const progressText = document.getElementById('docUploadProgressText');
  const uploadBtn = document.getElementById('docUploadBtn');
  const cancelBtn = document.getElementById('docCancelBtn');
  try {
    progressWrap.style.display = 'block';
    progressFill.style.width = '0%';
    progressPct.textContent = '0%';
    progressText.textContent = 'Preparing file...';
    if (cancelBtn) cancelBtn.disabled = true;
    setButtonLoading(uploadBtn, true, 'Uploading…');
    const dataUrl = await readFileAsDataUrl(file);
    progressText.textContent = 'Uploading...';
    await Api.uploadEmployeeDocumentWithProgress(currentDetailEmployeeId, { name, file_type: fileType, data_url: dataUrl }, (pct) => {
      progressFill.style.width = pct + '%';
      progressPct.textContent = pct + '%';
      if (pct >= 100) { progressText.textContent = 'Finishing up...'; }
    });
    progressFill.style.width = '100%';
    progressPct.textContent = '100%';
    progressText.textContent = 'Done';
    toast('Document uploaded.');
    closeModal('employeeDocumentModal');
    await loadEmployeeDocuments(currentDetailEmployeeId);
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    progressWrap.style.display = 'none';
    if (cancelBtn) cancelBtn.disabled = false;
    setButtonLoading(uploadBtn, false);
  }
}
document.addEventListener('DOMContentLoaded', initDocDropZoneListeners);
if (document.readyState !== 'loading') initDocDropZoneListeners();
document.addEventListener('DOMContentLoaded', initBcDocDropZoneListeners);
if (document.readyState !== 'loading') initBcDocDropZoneListeners();

async function deleteEmployeeDocument(docId) {
  const ok = await FinanceCommand.confirmAction({
    title: 'Delete document',
    consequence: 'Delete this employee document? This cannot be undone.',
    actionLabel: 'Delete document',
  });
  if (!ok.confirmed) return;
  try {
    await Api.deleteEmployeeDocument(docId);
    toast('Document deleted.', 'fa-solid fa-trash');
    await loadEmployeeDocuments(currentDetailEmployeeId);
  } catch (err) { toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
let _bankAccountHasDetails = false;
let _bankIbanRevealed = false;
// "Payroll and payments" card on the employee profile: compensation plan, salary payment docs,
// and the latest payroll lines (only for viewers with payroll read access).
async function openEmployeeBankSection(id) {
  await viewProfile(id, 'bank');
}

async function loadPayrollPaymentsCard(empId) {
  const body = document.getElementById('payrollPaymentsBody');
  if (!body) return;
  const isCurrent = () => String(currentDetailEmployeeId) === String(empId);
  const sections = [];
  try {
    const emp = employees.find(e => String(e.id) === String(empId));
    if (canReadSalary()) {
      const monthly = (emp ? (Number(emp.internalSalaryUsd || 0) + Number(emp.externalSalaryUsd || 0)) : 0);
      sections.push(`<div class="iban-row"><span class="k">Monthly total</span><span class="v">${fmtUSD(monthly)} / month</span></div>`);
    }
  } catch (e) { /* plan summary is best-effort */ }
  if (isCurrent()) body.innerHTML = sections.join('');

  try {
    const docs = (await Api.listInvoices()) || [];
    const mine = docs.filter(d => String(d.employee_id) === String(empId)).slice(0, 3);
    sections.push(`<div class="iban-row"><span class="k">Salary payment docs</span><span class="v">${mine.length ? '' : 'None yet'}</span></div>` + mine.map(d =>
      `<div class="iban-row"><span class="k">Doc ${escapeHtml(d.invoice_number || d.id)}</span><span class="v">${escapeHtml(d.payment_year)}-${escapeHtml(String(d.payment_month).padStart(2, '0'))}
        <button type="button" class="icon-action" title="Preview PDF salary payment doc" data-action="preview-salary-doc" data-id="${escapeHtml(d.id)}" data-number="${escapeHtml(d.invoice_number || '')}"><i class="fa-solid fa-eye"></i></button></span></div>`).join(''));
  } catch (e) { sections.push('<div class="iban-row"><span class="k">Salary payment docs</span><span class="v">Unavailable</span></div>'); }

  const canPayroll = typeof SessionInfo === 'undefined' || SessionInfo.hasPermission('finance.payroll.read');
  if (canPayroll && typeof FinanceApi !== 'undefined' && typeof FinanceApi.getPayrollRuns === 'function') {
    try {
      const runs = (await FinanceApi.getPayrollRuns()) || [];
      const latest = [...runs].sort((a, b) => String(b.period_label).localeCompare(String(a.period_label)))[0];
      if (latest) {
        const full = latest.lines ? latest : await FinanceApi.getPayrollRun(latest.id);
        const lines = ((full && full.lines) || []).filter(l => String(l.employee_id) === String(empId));
        const net = lines.reduce((s, l) => s + Number(l.net_pay || l.amount || 0), 0);
        sections.push(`<div class="iban-row"><span class="k">Latest payroll (${escapeHtml(latest.period_label)})</span><span class="v">${lines.length ? fmtUSD(net) : 'No lines'}</span></div>`);
      }
    } catch (e) { /* payroll lines are optional */ }
  }
  if (!isCurrent()) return;
  body.innerHTML = sections.join('');
}

// Tone for a card status pill; the shared .pill-* classes carry the light and dark colours.
function setPillTone(pill, tone) {
  pill.classList.remove('pill-success', 'pill-warning', 'pill-danger', 'pill-info', 'pill-neutral');
  pill.classList.add('pill-' + tone);
}

// Status-line action ("Set up" / "Try again") shown beside a card's status pill; pass no label to hide it.
function setCardStatusAction(btnId, label, onClick) {
  const b = document.getElementById(btnId);
  if (!b) return;
  b.hidden = !label;
  b.textContent = label || '';
  b.onclick = label ? onClick : null;
}

async function loadBankAccountStatus(empId) {
  setCardStatusAction('bankAccountStatusActionBtn', null);
  const pill = document.getElementById('bankAccountPill');
  const btn = document.getElementById('bankAccountActionBtn');
  const nameEl = document.getElementById('bankDetailName');
  const ibanEl = document.getElementById('bankDetailIban');
  const swiftEl = document.getElementById('bankDetailSwift');
  const statusLine = document.getElementById('bankAccountStatusLine');
  const statusText = document.getElementById('bankAccountStatusText');
  const detailsBody = document.getElementById('bankAccountDetailsBody');
  if (statusText) statusText.hidden = true;
  if (btn) btn.hidden = false;
  if (statusLine) statusLine.classList.remove('is-missing');
  const bankCard = document.getElementById('bankAccountCard');
  if (bankCard) bankCard.classList.remove('is-missing');
  if (detailsBody) detailsBody.hidden = false;
  if (!pill) return;
  pill.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
  setPillTone(pill, 'neutral');
  if (nameEl) nameEl.textContent = '—';
  if (ibanEl) ibanEl.textContent = '—';
  if (swiftEl) swiftEl.textContent = '—';
  try {
    const data = await Api.getBankAccount(empId);
    _bankAccountHasDetails = !!data.has_details;
    if (_bankAccountHasDetails) {
      pill.innerHTML = '<i class="fa-solid fa-circle-check"></i> On file';
      setPillTone(pill, 'success');
      if (btn) {
        btn.textContent = 'Edit';
        btn.title = 'Edit bank details';
      }
      if (nameEl) nameEl.textContent = data.bank_name || '—';
      if (ibanEl) ibanEl.textContent = data.iban || '—';
      if (swiftEl) swiftEl.textContent = data.swift_code || '—';
    } else {
      // Missing bank details are a visible flag only; payroll is never blocked (payroll policy R4)
      pill.innerHTML = '<span class="hv-dot"></span> Missing';
      setPillTone(pill, 'warning');
      setCardStatusAction('bankAccountStatusActionBtn', 'Add bank details', () => openBankAccountModal());
      if (statusText) statusText.hidden = false;
      if (statusLine) statusLine.classList.add('is-missing');
      if (bankCard) bankCard.classList.add('is-missing'); // warning-style card: orange hairline, plain text and action
      if (detailsBody) detailsBody.hidden = true;
      if (btn) {
        btn.textContent = 'Add';
        btn.title = 'Add bank details';
        btn.hidden = true; // the alert below carries the action
      }
      if (nameEl) nameEl.textContent = 'Not configured';
      if (ibanEl) ibanEl.textContent = 'Not configured';
      if (swiftEl) swiftEl.textContent = 'Not configured';
    }
  } catch (err) {
    pill.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Could not load';
    setPillTone(pill, 'neutral');
    setCardStatusAction('bankAccountStatusActionBtn', 'Try again', () => loadBankAccountStatus(empId));
  }
}
async function openBankAccountModal(evt) {
  const trigger = (evt && evt.currentTarget) || document.getElementById('bankAccountActionBtn');
  _bankIbanRevealed = false;
  const ibanInput = document.getElementById('fBankIban');
  const revealBtn = document.getElementById('bankRevealBtn');
  const titleEl = document.getElementById('bankAccountModalTitle');
  document.getElementById('fBankName').value = '';
  ibanInput.value = '';
  ibanInput.readOnly = false;
  document.getElementById('fBankSwift').value = '';
  const canRevealBank = typeof SessionInfo !== 'undefined' ? SessionInfo.hasPermission('hr.employee_bank_account.reveal') : true;
  if (revealBtn) {
    revealBtn.style.display = canRevealBank ? '' : 'none';
    revealBtn.innerHTML = '<i class="fa-solid fa-eye"></i>';
  }
  const bankEmp = (typeof employees !== 'undefined' ? employees : []).find(x => String(x.id) === String(currentDetailEmployeeId));
  titleEl.textContent = bankEmp && bankEmp.name ? `Employee bank account · ${bankEmp.name}` : 'Employee bank account';
  if (_bankAccountHasDetails) {
    try {
      const data = await Api.getBankAccount(currentDetailEmployeeId);
      document.getElementById('fBankName').value = data.bank_name || '';
      ibanInput.value = data.iban || '';  // masked
      ibanInput.readOnly = true;                 // masked — read-only until revealed
      document.getElementById('fBankSwift').value = data.swift_code || '';
    } catch (err) { toast(err.message, 'fa-solid fa-triangle-exclamation'); }
  }
  openModal('bankAccountModal', trigger);
}
async function toggleBankIbanReveal() {
  const ibanInput = document.getElementById('fBankIban');
  const btn = document.getElementById('bankRevealBtn');
  if (_bankIbanRevealed) {
    try {
      const data = await Api.getBankAccount(currentDetailEmployeeId);
      ibanInput.value = data.iban || '';
      ibanInput.readOnly = true;
      _bankIbanRevealed = false;
      btn.innerHTML = '<i class="fa-solid fa-eye"></i>';
    } catch (err) { toast(err.message, 'fa-solid fa-triangle-exclamation'); }
  } else {
    try {
      btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      const data = await Api.getBankAccountRevealed(currentDetailEmployeeId);
      ibanInput.value = data.iban || '';
      ibanInput.readOnly = false;
      _bankIbanRevealed = true;
      btn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
    } catch (err) {
      btn.innerHTML = '<i class="fa-solid fa-eye"></i>';
      toast(err.message, 'fa-solid fa-triangle-exclamation');
    }
  }
}
async function saveBankAccount(evt) {
  const btn = (evt && evt.currentTarget) || document.getElementById('bankAccountSaveBtn') || document.querySelector('#bankAccountModal .btn-fill');
  const bank_name = document.getElementById('fBankName').value.trim();
  const iban = document.getElementById('fBankIban').value.trim();
  const swift_code = document.getElementById('fBankSwift').value.trim() || null;
  if (!FinanceForm.validateRequiredFields('bankAccountModal', [
    { id: 'fBankName', message: 'Bank name is required.' },
    { id: 'fBankIban', message: 'IBAN is required.' },
  ])) return;
  if (iban.startsWith('****')) {
    FinanceForm.showErrorSummary('bankAccountModal', [{ fieldId: 'fBankIban', message: 'Reveal the IBAN before editing, or enter a new IBAN.' }]);
    return;
  }
  setButtonLoading(btn, true, 'Saving…');
  try {
    await Api.upsertBankAccount(currentDetailEmployeeId, { bank_name, iban, swift_code });
    toast('Employee bank account saved.');
    closeModal('bankAccountModal');
    await loadBankAccountStatus(currentDetailEmployeeId);
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}

let _socialInsuranceConfig = null;

async function loadSocialInsuranceStatus(empId) {
  setCardStatusAction('socialInsuranceStatusActionBtn', null);
  const pill = document.getElementById('socialInsurancePill');
  const btn = document.getElementById('socialInsuranceActionBtn');
  const covEl = document.getElementById('socialInsCoverage');
  const baseEl = document.getElementById('socialInsBase');
  const effEl = document.getElementById('socialInsEffectiveDate');
  if (!pill) return;
  pill.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
  setPillTone(pill, 'neutral');
  if (covEl) covEl.textContent = '—';
  if (baseEl) baseEl.textContent = '—';
  if (effEl) effEl.textContent = '—';

  try {
    const data = await Api.getSocialInsurance(empId);
    _socialInsuranceConfig = data;
    if (!data) {
      // The request succeeded and there is no record yet: not an error.
      pill.innerHTML = '<i class="fa-solid fa-circle-minus"></i> Not set up';
      setPillTone(pill, 'neutral');
      if (covEl) covEl.textContent = 'Not set up';
      setCardStatusAction('socialInsuranceStatusActionBtn', 'Set up', () => openSocialInsuranceModal());
      return;
    }
    const isCovered = !!data.insured_flag;
    const baseAmt = data.insured_base !== null && data.insured_base !== undefined ? Number(data.insured_base) : null;
    const effDate = data.effective_start_date ? String(data.effective_start_date).slice(0, 10) : '—';
    const curr = (data.currency || 'EGP').toUpperCase();
    const isLegacyUSD = isCovered && curr === 'USD';

    if (btn) {
      btn.textContent = 'Edit';
      btn.title = 'Edit social insurance';
    }

    if (isLegacyUSD) {
      pill.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Legacy USD Config';
      setPillTone(pill, 'danger');
      if (covEl) covEl.textContent = 'Covered (Update Required)';
      if (baseEl) baseEl.textContent = `${baseAmt !== null ? '$' + Number(baseAmt).toLocaleString() : '—'} USD (Needs EGP conversion)`;
      if (effEl) effEl.textContent = effDate;
    } else if (isCovered) {
      if (baseAmt === null || baseAmt <= 0) {
        pill.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Missing Base';
        setPillTone(pill, 'warning');
        if (covEl) covEl.textContent = 'Covered (Action Required)';
        if (baseEl) baseEl.textContent = 'Not set (blocking)';
      } else {
        pill.innerHTML = '<i class="fa-solid fa-circle-check"></i> Covered';
        setPillTone(pill, 'success');
        if (covEl) covEl.textContent = 'Covered';
        if (baseEl) baseEl.textContent = `${Number(baseAmt).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})} EGP (Internal Estimate)`;
      }
      if (effEl) effEl.textContent = effDate;
    } else {
      pill.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Not Covered';
      setPillTone(pill, 'neutral');
      if (covEl) covEl.textContent = 'Not Covered';
      if (baseEl) baseEl.textContent = '—';
      if (effEl) effEl.textContent = effDate !== '—' ? effDate : '—';
    }
  } catch (err) {
    pill.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Could not load';
    setPillTone(pill, 'neutral');
    setCardStatusAction('socialInsuranceStatusActionBtn', 'Try again', () => loadSocialInsuranceStatus(empId));
  }
}

async function openSocialInsuranceModal() {
  const flagInput = document.getElementById('fSocialInsFlag');
  const baseInput = document.getElementById('fSocialInsBase');
  const effInput = document.getElementById('fSocialInsEffectiveDate');

  const siEmp = (typeof employees !== 'undefined' ? employees : []).find(x => String(x.id) === String(currentDetailEmployeeId));
  const siTitle = document.getElementById('socialInsuranceModalTitle');
  if (siTitle) siTitle.textContent = siEmp && siEmp.name ? `Social insurance · ${siEmp.name}` : 'Social insurance';

  flagInput.checked = false;
  baseInput.value = '';
  const todayStr = new Date().toISOString().slice(0, 10);
  effInput.value = todayStr;

  if (_socialInsuranceConfig) {
    flagInput.checked = !!_socialInsuranceConfig.insured_flag;
    if (_socialInsuranceConfig.insured_base !== null && _socialInsuranceConfig.insured_base !== undefined) {
      baseInput.value = _socialInsuranceConfig.insured_base;
    }
    if (_socialInsuranceConfig.effective_start_date) {
      effInput.value = String(_socialInsuranceConfig.effective_start_date).slice(0, 10);
    }
  }

  openModal('socialInsuranceModal');
}

async function saveSocialInsurance(evt) {
  const btn = (evt && evt.currentTarget) || document.getElementById('socialInsuranceSaveBtn') || document.querySelector('#socialInsuranceModal .btn-fill');
  const flag = document.getElementById('fSocialInsFlag').checked;
  const baseVal = document.getElementById('fSocialInsBase').value.trim();
  const effDate = document.getElementById('fSocialInsEffectiveDate').value.trim();

  if (!effDate) {
    toast('Effective Date is required.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  const todayStr = new Date().toISOString().slice(0, 10);
  if (effDate > todayStr) {
    toast('Future pre-staging is not permitted. Effective date must be on or before today.', 'fa-solid fa-triangle-exclamation');
    return;
  }

  let insuredBase = null;
  if (flag) {
    if (!baseVal || Number(baseVal) <= 0) {
      toast('Insured Base Amount is required when employee is covered.', 'fa-solid fa-triangle-exclamation');
      return;
    }
    insuredBase = Number(baseVal);
  } else if (baseVal) {
    insuredBase = Number(baseVal);
  }

  setButtonLoading(btn, true, 'Saving…');
  try {
    await Api.upsertSocialInsurance(currentDetailEmployeeId, {
      insured_flag: flag,
      insured_base: insuredBase,
      effective_start_date: effDate
    });
    toast('Social insurance configuration saved.');
    closeModal('socialInsuranceModal');
    await loadSocialInsuranceStatus(currentDetailEmployeeId);
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}

let _taxMethodConfig = null;

function fmtTaxRate(rate) {
  const pct = Math.round(Number(rate) * 10000) / 100;
  return `${pct}%`;
}

function taxMethodLabel(row) {
  if (!row) return 'Normal (progressive)';
  return row.method === 'flat' ? `Flat ${fmtTaxRate(row.flat_rate)}` : 'Normal (progressive)';
}

function renderTaxMethodHistory(history) {
  const wrap = document.getElementById('taxMethodHistory');
  const body = document.getElementById('taxMethodHistoryBody');
  if (!wrap || !body) return;
  const rows = (history || []).slice().sort((a, b) => String(b.effective_start_date).localeCompare(String(a.effective_start_date)) || b.id - a.id);
  wrap.hidden = rows.length === 0;
  body.innerHTML = rows.map(r => `<tr><td data-label="From">${escapeHtml(String(r.effective_start_date).slice(0, 10))}</td><td data-label="To">${r.effective_end_date ? escapeHtml(String(r.effective_end_date).slice(0, 10)) : 'Present'}</td><td data-label="Method">${escapeHtml(taxMethodLabel(r))}</td></tr>`).join('');
}

async function loadTaxMethodStatus(empId) {
  setCardStatusAction('taxMethodStatusActionBtn', null);
  const pill = document.getElementById('taxMethodPill');
  const btn = document.getElementById('taxMethodActionBtn');
  const nameEl = document.getElementById('taxMethodName');
  const rateEl = document.getElementById('taxMethodRate');
  const effEl = document.getElementById('taxMethodEffectiveDate');
  if (!pill) return;
  const canEdit = canWriteSalary();
  if (btn) btn.hidden = !canEdit;
  pill.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
  setPillTone(pill, 'neutral');
  if (nameEl) nameEl.textContent = '—';
  if (rateEl) rateEl.textContent = '—';
  if (effEl) effEl.textContent = '—';
  renderTaxMethodHistory([]);

  try {
    const [data, history] = await Promise.all([Api.getTaxMethod(empId), Api.getTaxMethodHistory(empId)]);
    _taxMethodConfig = data;
    renderTaxMethodHistory(history);
    if (!data) {
      pill.innerHTML = '<i class="fa-solid fa-circle-minus"></i> Normal (default)';
      setPillTone(pill, 'neutral');
      if (nameEl) nameEl.textContent = 'Normal (progressive)';
      if (rateEl) rateEl.textContent = 'Brackets from payroll settings';
      if (canEdit) setCardStatusAction('taxMethodStatusActionBtn', 'Set up', () => openTaxMethodModal());
      return;
    }
    const effDate = data.effective_start_date ? String(data.effective_start_date).slice(0, 10) : '—';
    if (data.method === 'flat') {
      pill.innerHTML = `<i class="fa-solid fa-percent"></i> Flat ${escapeHtml(fmtTaxRate(data.flat_rate))}`;
      setPillTone(pill, 'warning');
      if (nameEl) nameEl.textContent = 'Flat rate';
      if (rateEl) rateEl.textContent = `${fmtTaxRate(data.flat_rate)} of taxable gross, no exemption`;
    } else {
      pill.innerHTML = '<i class="fa-solid fa-circle-check"></i> Normal';
      setPillTone(pill, 'success');
      if (nameEl) nameEl.textContent = 'Normal (progressive)';
      if (rateEl) rateEl.textContent = 'Brackets from payroll settings';
    }
    if (effEl) effEl.textContent = effDate;
  } catch (err) {
    pill.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Could not load';
    setPillTone(pill, 'neutral');
    setCardStatusAction('taxMethodStatusActionBtn', 'Try again', () => loadTaxMethodStatus(empId));
  }
}

function syncTaxMethodRateField() {
  const flat = document.getElementById('fTaxMethodFlat');
  const box = document.getElementById('fTaxRateContainer');
  if (box) box.hidden = !(flat && flat.checked);
}

async function openTaxMethodModal() {
  if (!canWriteSalary()) return;
  const flatRadio = document.getElementById('fTaxMethodFlat');
  const progRadio = document.getElementById('fTaxMethodProgressive');
  const rateInput = document.getElementById('fTaxMethodRate');
  const effInput = document.getElementById('fTaxMethodEffectiveDate');
  const notesInput = document.getElementById('fTaxMethodNotes');

  const emp = (typeof employees !== 'undefined' ? employees : []).find(x => String(x.id) === String(currentDetailEmployeeId));
  const title = document.getElementById('taxMethodModalTitle');
  if (title) title.textContent = emp && emp.name ? `Tax method · ${emp.name}` : 'Tax method';

  progRadio.checked = true;
  flatRadio.checked = false;
  rateInput.value = '';
  notesInput.value = '';
  effInput.value = new Date().toISOString().slice(0, 10);

  if (_taxMethodConfig) {
    const isFlat = _taxMethodConfig.method === 'flat';
    flatRadio.checked = isFlat;
    progRadio.checked = !isFlat;
    if (isFlat && _taxMethodConfig.flat_rate !== null && _taxMethodConfig.flat_rate !== undefined) {
      rateInput.value = Math.round(Number(_taxMethodConfig.flat_rate) * 10000) / 100;
    }
    if (_taxMethodConfig.effective_start_date) effInput.value = String(_taxMethodConfig.effective_start_date).slice(0, 10);
    notesInput.value = _taxMethodConfig.notes || '';
  }
  syncTaxMethodRateField();
  openModal('taxMethodModal');
}

async function saveTaxMethod(evt) {
  const btn = (evt && evt.currentTarget) || document.getElementById('taxMethodSaveBtn');
  const isFlat = document.getElementById('fTaxMethodFlat').checked;
  const rateVal = document.getElementById('fTaxMethodRate').value.trim();
  const effDate = document.getElementById('fTaxMethodEffectiveDate').value.trim();
  const notes = document.getElementById('fTaxMethodNotes').value.trim();

  if (!effDate) {
    toast('Effective Date is required.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  if (effDate > new Date().toISOString().slice(0, 10)) {
    toast('Future pre-staging is not permitted. Effective date must be on or before today.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  let flatRate = null;
  if (isFlat) {
    const pct = Number(rateVal);
    if (!rateVal || !(pct > 0 && pct <= 100)) {
      toast('Enter a flat rate above 0% and up to 100%.', 'fa-solid fa-triangle-exclamation');
      return;
    }
    flatRate = Math.round(pct * 100) / 10000; // percent in the form, fraction stored
  }

  setButtonLoading(btn, true, 'Saving…');
  try {
    await Api.upsertTaxMethod(currentDetailEmployeeId, {
      method: isFlat ? 'flat' : 'progressive',
      flat_rate: flatRate,
      effective_start_date: effDate,
      notes
    });
    toast('Tax method saved.');
    closeModal('taxMethodModal');
    await loadTaxMethodStatus(currentDetailEmployeeId);
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}

