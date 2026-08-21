function renderEmployeesTable(filter = '') {
  const body = document.getElementById('employeesTableBody');
  const f = filter.toLowerCase();
  body.innerHTML = employees.filter(e => e.name.toLowerCase().includes(f) || e.role.toLowerCase().includes(f) || (e.employment_state || "").toLowerCase().includes(f)).map(e => `<tr>
    <td>${e.id}</td>
    <td class="tname"><div class="avatar">${initials(e.name)}</div><div><div>${e.name}</div><div style="font-size:11.5px;color:var(--text2);font-weight:400;">${e.email}</div></div></td>
    <td>${e.role}</td>
    <td>${e.employment_state || 'Full-Time'}</td>
    <td style="display:none;">${fmtUSD(e.salary)}</td>
    <td>${e.nextRaise}</td>
    <td>${statusPill(e.status)}</td>
    <td style="display:flex;gap:6px;">
      <button class="icon-action" onclick="viewProfile(${e.id})"><i class="fa-solid fa-eye"></i></button>
      <button class="icon-action" onclick="openEmployeeModal(${e.id})"><i class="fa-solid fa-pen"></i></button>
      <button class="icon-action" title="Generate Invoice" onclick="showSection('a-invoices','admin'); generateSingleInvoice(${e.id})"><i class="fa-solid fa-file-invoice"></i></button>
      <button class="icon-action" onclick="askDelete(${e.id})"><i class="fa-solid fa-trash"></i></button>
    </td></tr>`).join('') || `<tr><td colspan="7"><div class="empty-state"><i class="fa-solid fa-user-slash"></i><p>No employees found.</p></div></td></tr>`;
}
document.getElementById('empSearch').addEventListener('input', e => renderEmployeesTable(e.target.value));

function openEmployeeModal(id = null) {
  currentEditId = id;
  document.getElementById('empModalTitle').textContent = id ? 'Edit Employee' : 'Add Employee';
  if (id) {
    const e = employees.find(x => x.id === id);
    fEmpName.value = e.name; fEmpEmail.value = e.email; fEmpDept.value = e.dept; fEmpRole.value = e.role;
    document.getElementById('fEmpInternalSalary').value = e.internalSalaryUsd || 0;
    document.getElementById('fEmpExternalSalary').value = e.externalSalaryUsd || 0;
    document.getElementById('fEmpInvoiceId').value = e.invoice_id || '';
    document.getElementById('fEmpAddressLine1').value = e.address_line_1 || '';
    document.getElementById('fEmpAddressLine2').value = e.address_line_2 || '';
    fEmpJoin.value = e.join; fEmpStatus.value = e.status; fEmpVac.value = e.vacTotal - e.vacUsed;
    document.getElementById('fEmpEmploymentState').value = e.employment_state || 'Full-Time';
  } else {
    ['fEmpName', 'fEmpEmail', 'fEmpRole'].forEach(id => document.getElementById(id).value = '');
    document.getElementById('fEmpInternalSalary').value = '';
    document.getElementById('fEmpExternalSalary').value = '';
    document.getElementById('fEmpInvoiceId').value = '';
    document.getElementById('fEmpAddressLine1').value = '';
    document.getElementById('fEmpAddressLine2').value = '';
    fEmpJoin.value = ''; fEmpVac.value = 21; fEmpStatus.value = 'Active'; fEmpDept.value = 'Engineering';
    document.getElementById('fEmpEmploymentState').value = 'Full-Time';
  }
  document.getElementById('employeeModal').classList.add('active');
}

async function saveEmployee(evt) {
  const btn = (evt && evt.currentTarget) || document.querySelector('#employeeModal .btn-fill');
  const name = document.getElementById('fEmpName').value.trim();
  if (!name) { toast('Please enter employee name.', 'fa-solid fa-triangle-exclamation'); return; }
  const vacTotal = Number(fEmpVac.value) || 21;
  const internal_salary_usd = Number(document.getElementById('fEmpInternalSalary').value) || 0;
  const external_salary_usd = Number(document.getElementById('fEmpExternalSalary').value) || 0;
  const invoice_id = document.getElementById('fEmpInvoiceId').value.trim();
  const address_line_1 = document.getElementById('fEmpAddressLine1').value.trim();
  const address_line_2 = document.getElementById('fEmpAddressLine2').value.trim();
  if (invoice_id && !/^\d{1,2}$/.test(invoice_id)) {
    toast('Invoice ID must be a number between 01 and 99.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  setButtonLoading(btn, true, 'Saving...');
  try {
    if (currentEditId) {
      const updates = { name, email: fEmpEmail.value, dept: fEmpDept.value, job_role: fEmpRole.value, internal_salary_usd, external_salary_usd, join_date: fEmpJoin.value, status: fEmpStatus.value, vac_total: vacTotal, employment_state: document.getElementById('fEmpEmploymentState').value, invoice_id, address_line_1, address_line_2 };
      await Api.updateEmployee(currentEditId, updates);
      toast('Employee updated successfully.');
    } else {
      const payload = { name, email: fEmpEmail.value, dept: fEmpDept.value, job_role: fEmpRole.value, internal_salary_usd, external_salary_usd, join_date: fEmpJoin.value, status: fEmpStatus.value, vac_total: vacTotal, next_raise: '2027-01-01', employment_state: document.getElementById('fEmpEmploymentState').value, invoice_id, address_line_1, address_line_2 };
      await Api.createEmployee(payload);
      toast('New employee added.');
    }
    closeModal('employeeModal');
    await loadAdminData();
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}

function askDelete(id) {
  currentDeleteId = id;
  document.getElementById('delEmpName').textContent = employees.find(e => e.id === id).name;
  document.getElementById('confirmModal').classList.add('active');
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

function escRow(icon, label, valueHtml, opts = {}) {
  const { wrap = false, title = '' } = opts;
  return `<div class="esc-row${wrap ? ' wrap' : ''}">
    <span class="esc-k"><i class="fa-solid ${icon}"></i> ${label}</span>
    <span class="esc-v"${title ? ` title="${title}"` : ''}>${valueHtml}</span>
  </div>`;
}

async function viewProfile(id) {
  currentDetailEmployeeId = id;
  showSection('a-employee-detail', 'admin');
  const e = employees.find(x => x.id === id);
  if (!e) return;

  const internalUsd = Number(e.internalSalaryUsd || 0);
  const externalUsd = Number(e.externalSalaryUsd || 0);
  const vacRemaining = (e.vacTotal || 21) - (e.vacUsed || 0);
  const address = [e.address_line_1, e.address_line_2].filter(Boolean).join(', ') || '—';

  document.getElementById('detailProfileHead').innerHTML = `
    <div class="esc-head">
      <div class="esc-avatar">${initials(e.name)}</div>
      <div class="esc-identity">
        <h4>${e.name}</h4>
        <div class="esc-meta">
          <span>${e.role}</span><span class="esc-dot"></span>
          <span>${e.dept}</span>${e.join ? `<span class="esc-dot"></span><span>Joined ${fmtDateShort(e.join)}</span>` : ''}
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
          <span class="esc-amount">${fmtUSD(internalUsd + externalUsd)}</span>
          <span class="esc-unit">/ month total</span>
        </div>
        <div class="esc-comp-breakdown">
          <div class="esc-comp-piece">
            <div class="esc-k"><i class="fa-solid fa-building"></i> Internal</div>
            <div class="esc-v">${fmtUSD(internalUsd)}</div>
          </div>
          <div class="esc-comp-piece">
            <div class="esc-k"><i class="fa-solid fa-file-invoice-dollar"></i> External</div>
            <div class="esc-v">${fmtUSD(externalUsd)}</div>
          </div>
          <div class="esc-comp-piece">
            <div class="esc-k"><i class="fa-solid fa-arrow-trend-up"></i> Next Raise</div>
            <div class="esc-v" style="font-size:14px">${fmtDateShort(e.nextRaise)}</div>
          </div>
        </div>
      </div>
      <div class="esc-meta-zone">
        <div class="esc-zone-label">Employee Details</div>
        ${escRow('fa-envelope', 'Email', e.email, { title: e.email })}
        ${escRow('fa-umbrella-beach', 'Vacation', `${vacRemaining} / ${e.vacTotal || 21} days`)}
        ${escRow('fa-hashtag', 'Invoice ID', e.invoice_id || '—')}
        ${escRow('fa-location-dot', 'Address', address, { wrap: true, title: address })}
      </div>
    </div>`;
  const consumption = insuranceConsumption.find(c => String(c.employee_id) === String(id));
  document.getElementById('detailInsuranceGrid').innerHTML = consumption && consumption.categories.length ? consumption.categories.map(renderCategoryChip).join('') : '<p style="color:var(--text2);font-size:13px;">No insurance consumption data available.</p>';
  document.getElementById('detailInsuranceTotal').innerHTML = consumption ? `${fmtMoney(consumption.total_consumed)} <span style="font-size:12px;color:var(--text2);font-weight:500">of ${fmtMoney(consumption.total_limit)}</span>` : '—';
  showTableSkeleton('detailVacationBody', 4, 3);
  showTableSkeleton('detailClaimsBody', 4, 3);
  showTableSkeleton('detailDocumentsBody', 3, 2);
  try {
    const [vacHistory, claims, notes] = await Promise.all([
      Api.getVacationHistory(id),
      Api.getInsuranceClaims(),
      Api.getEmployeeNotes(id),
    ]);
    document.getElementById('detailVacationBody').innerHTML = vacHistory.map(v => `<tr><td>${v.type}</td><td>${v.start_date} to ${v.end_date}</td><td>${v.days}</td><td>${statusPill(v.status)}</td></tr>`).join('') || `<tr><td colspan="4"><div class="empty-state"><i class="fa-solid fa-umbrella-beach"></i><p>No vacation records yet.</p></div></td></tr>`;
    const empClaims = claims.filter(c => String(c.employee_id) === String(id));
    document.getElementById('detailClaimsBody').innerHTML = empClaims.map(c => `<tr><td>${c.category}</td><td>${fmtMoney(c.amount)}</td><td>${c.date}</td><td>${statusPill(c.status)}</td></tr>`).join('') || `<tr><td colspan="4"><div class="empty-state"><i class="fa-solid fa-briefcase-medical"></i><p>No insurance claims yet.</p></div></td></tr>`;
    renderNotesList(notes);
    await loadEmployeeDocuments(id);
    await loadBankAccountStatus(id);
  } catch (err) { toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}

function renderNotesList(notes) {
  const list = document.getElementById('detailNotesList');
  const catIcons = { General: 'fa-solid fa-note-sticky', Performance: 'fa-solid fa-chart-line', Incident: 'fa-solid fa-triangle-exclamation', Achievement: 'fa-solid fa-trophy', Attendance: 'fa-solid fa-calendar-check', Warning: 'fa-solid fa-flag' };
  const catColors = { General: 'accent', Performance: 'success', Incident: 'danger', Achievement: 'success', Attendance: 'info', Warning: 'warning' };
  list.innerHTML = notes.map(n => {
    const color = catColors[n.category] || 'accent';
    return `<li><div class="ic" style="background:rgba(32,86,232,.12);color:var(--${color});"><i class="${catIcons[n.category] || 'fa-solid fa-note-sticky'}"></i></div><div class="txt" style="flex:1;"><strong>${n.category} • ${n.date}</strong><p>${n.note}</p><p style="font-size:11px;color:var(--text3);margin-top:2px;">By ${n.created_by}</p></div><button class="icon-action" onclick="deleteEmployeeNote(${n.id})"><i class="fa-solid fa-trash"></i></button></li>`;
  }).join('') || `<li><div class="empty-state"><i class="fa-solid fa-note-sticky"></i><p>No notes recorded yet.</p></div></li>`;
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
  try {
    await Api.deleteEmployeeNote(noteId);
    toast('Note deleted.', 'fa-solid fa-trash');
    const notes = await Api.getEmployeeNotes(currentDetailEmployeeId);
    renderNotesList(notes);
  } catch (err) { toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}

async function openBehalfVacationModal() {
  document.getElementById('bvType').value = 'Annual Leave';
  document.getElementById('bvStart').value = '';
  document.getElementById('bvEnd').value = '';
  document.getElementById('bvDays').value = 1;
  document.getElementById('bvStatus').value = 'Approved';
  document.getElementById('bvRecordDate').value = '';
  document.getElementById('behalfVacationModal').classList.add('active');
}
async function submitBehalfVacation(evt) {
  const btn = (evt && evt.currentTarget) || document.querySelector('#behalfVacationModal .btn-fill');
  const emp = employees.find(e => e.id === currentDetailEmployeeId);
  const leave_type = document.getElementById('bvType').value;
  const start_date = document.getElementById('bvStart').value;
  const end_date = document.getElementById('bvEnd').value || start_date;
  const days = Number(document.getElementById('bvDays').value) || 1;
  const status = document.getElementById('bvStatus').value;
  const record_date = document.getElementById('bvRecordDate').value || null;
  if (!start_date) { toast('Please select a start date.', 'fa-solid fa-triangle-exclamation'); return; }
  setButtonLoading(btn, true, 'Submitting...');
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

function openBehalfClaimModal() {
  const sel = document.getElementById('bcCategory');
  sel.innerHTML = insuranceCategories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
  document.getElementById('bcProvider').value = '';
  document.getElementById('bcAmount').value = '';
  document.getElementById('bcStatus').value = 'Approved';
  document.getElementById('bcRecordDate').value = '';
  const fileInput = document.getElementById('bcDocument');
  if (fileInput) fileInput.value = '';
  document.getElementById('behalfClaimModal').classList.add('active');
}
async function submitBehalfClaim(evt) {
  const btn = (evt && evt.currentTarget) || document.querySelector('#behalfClaimModal .btn-fill');
  const emp = employees.find(e => e.id === currentDetailEmployeeId);
  const category = document.getElementById('bcCategory').value;
  const provider = document.getElementById('bcProvider').value;
  const amount = Number(document.getElementById('bcAmount').value);
  const status = document.getElementById('bcStatus').value;
  const record_date = document.getElementById('bcRecordDate').value || null;
  const fileInput = document.getElementById('bcDocument');
  if (!category) { toast('Please select an insurance category.', 'fa-solid fa-triangle-exclamation'); return; }
  if (!amount) { toast('Please enter a claim amount.', 'fa-solid fa-triangle-exclamation'); return; }
  let documentUrl;
  const file = fileInput && fileInput.files[0];
  if (file) {
    if (file.size > 2 * 1024 * 1024) { toast('Supporting document must be under 2MB.', 'fa-solid fa-triangle-exclamation'); return; }
    try { documentUrl = await readFileAsDataUrl(file); }
    catch (e) { toast('Could not read the selected file.', 'fa-solid fa-triangle-exclamation'); return; }
  }
  setButtonLoading(btn, true, 'Submitting...');
  try {
    await Api.submitInsuranceClaim({ employee_name: emp.name, employee_id: emp.id, category, provider, amount, document_url: documentUrl, status, record_date });
    closeModal('behalfClaimModal');
    toast(`Insurance claim added for ${emp.name}.`);
    await loadAdminData();
    await viewProfile(currentDetailEmployeeId);
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}

async function loadEmployeeDocuments(empId) {
  try {
    const docs = await Api.getEmployeeDocuments(empId);
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
    <td><div class="doc-name-cell"><div class="doc-type-icon ${d.file_type === 'image' ? 'image' : 'pdf'}">${docTypeIcon(d.file_type)}</div><span class="doc-name-text">${d.name}</span></div></td>
    <td>${d.uploaded_at}</td>
    <td style="display:flex;gap:6px;justify-content:flex-end;">
      <button class="icon-action" title="Preview" onclick="previewEmployeeDocument(${d.id}, ${JSON.stringify(String(d.name).replace(/`/g, ''))}, ${JSON.stringify(d.file_type)})"><i class="fa-solid fa-eye"></i></button>
      <button class="icon-action" title="Download" onclick="downloadEmployeeDocument(${d.id})"><i class="fa-solid fa-download"></i></button>
      <button class="icon-action" title="Delete" onclick="deleteEmployeeDocument(${d.id})"><i class="fa-solid fa-trash"></i></button>
    </td></tr>`).join('') : `<tr><td colspan="3"><div class="empty-state"><i class="fa-solid fa-folder-open"></i><p>No documents uploaded yet.</p></div></td></tr>`;
}

function previewEmployeeDocument(docId, name, fileType) {
  const container = document.getElementById('docPreviewContainer');
  document.getElementById('docPreviewTitle').textContent = name || 'Document Preview';
  const downloadBtn = document.getElementById('docPreviewDownloadBtn');
  downloadBtn.onclick = (e) => {
    e.preventDefault();
    Api.downloadEmployeeDocumentFile(docId, name).catch(err => toast(err.message, 'fa-solid fa-triangle-exclamation'));
  };
  container.innerHTML = '<div style="color:#9ca3af;font-size:13px;">Loading preview...</div>';
  document.getElementById('documentPreviewModal').classList.add('active');
  Api.getDocumentPreviewBlobUrl(docId).then(url => {
    if (fileType === 'image') {
      container.innerHTML = `<img src="${url}" style="max-width:100%;max-height:100%;object-fit:contain;">`;
    } else {
      container.innerHTML = `<iframe src="${url}" style="width:100%;height:75vh;border:none;background:#fff;"></iframe>`;
    }
  }).catch(err => {
    container.innerHTML = `<div style="color:#f87171;font-size:13px;padding:20px;text-align:center;">${err.message}</div>`;
  });
}

function closeDocumentPreview() {
  document.getElementById('documentPreviewModal').classList.remove('active');
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
  document.getElementById('employeeDocumentModal').classList.add('active');
}

function clearDocFileSelection() {
  docSelectedFile = null;
  const fileInput = document.getElementById('docFileInput');
  if (fileInput) fileInput.value = '';
  document.getElementById('docDropZoneEmpty').style.display = '';
  document.getElementById('docDropZoneFile').style.display = 'none';
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
    uploadBtn.disabled = true;
    cancelBtn.disabled = true;
    uploadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading...';
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
    uploadBtn.disabled = false;
    cancelBtn.disabled = false;
    uploadBtn.innerHTML = '<i class="fa-solid fa-check"></i> Upload';
  }
}
document.addEventListener('DOMContentLoaded', initDocDropZoneListeners);
if (document.readyState !== 'loading') initDocDropZoneListeners();

async function deleteEmployeeDocument(docId) {
  try {
    await Api.deleteEmployeeDocument(docId);
    toast('Document deleted.', 'fa-solid fa-trash');
    await loadEmployeeDocuments(currentDetailEmployeeId);
  } catch (err) { toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
let _bankAccountHasDetails = false;
let _bankIbanRevealed = false;
async function loadBankAccountStatus(empId) {
  const pill = document.getElementById('bankAccountPill');
  const btn = document.getElementById('bankAccountActionBtn');
  const nameEl = document.getElementById('bankDetailName');
  const ibanEl = document.getElementById('bankDetailIban');
  const swiftEl = document.getElementById('bankDetailSwift');
  if (!pill) return;
  pill.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Loading...';
  pill.style.cssText = 'background:var(--surface2);color:var(--text2);';
  if (nameEl) nameEl.textContent = '—';
  if (ibanEl) ibanEl.textContent = '—';
  if (swiftEl) swiftEl.textContent = '—';
  try {
    const data = await Api.getBankAccount(empId);
    _bankAccountHasDetails = !!data.has_details;
    if (_bankAccountHasDetails) {
      pill.innerHTML = '<i class="fa-solid fa-circle-check"></i> On file';
      pill.style.cssText = 'background:#e6f9f1;color:var(--success);';
      if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-pen"></i>';
        btn.title = 'Edit Bank Details';
      }
      if (nameEl) nameEl.textContent = data.bank_name || '—';
      if (ibanEl) ibanEl.textContent = data.iban || '—';
      if (swiftEl) swiftEl.textContent = data.swift_code || '—';
    } else {
      pill.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Missing';
      pill.style.cssText = 'background:var(--surface2);color:var(--text2);';
      if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-plus"></i>';
        btn.title = 'Add Bank Details';
      }
      if (nameEl) nameEl.textContent = 'Not configured';
      if (ibanEl) ibanEl.textContent = 'Not configured';
      if (swiftEl) swiftEl.textContent = 'Not configured';
    }
  } catch (err) {
    pill.innerHTML = '<i class="fa-solid fa-circle-xmark"></i> Could not load';
    pill.style.cssText = 'background:var(--surface2);color:var(--text2);';
  }
}
async function openBankAccountModal() {
  _bankIbanRevealed = false;
  const ibanInput = document.getElementById('fBankIban');
  const revealBtn = document.getElementById('bankRevealBtn');
  const titleEl = document.getElementById('bankAccountModalTitle');
  document.getElementById('fBankName').value = '';
  ibanInput.value = '';
  ibanInput.readOnly = false;
  document.getElementById('fBankSwift').value = '';
  revealBtn.innerHTML = '<i class="fa-solid fa-eye"></i>';
  titleEl.textContent = _bankAccountHasDetails ? 'Edit Bank Account' : 'Add Bank Account';
  if (_bankAccountHasDetails) {
    try {
      const data = await Api.getBankAccount(currentDetailEmployeeId);
      document.getElementById('fBankName').value = data.bank_name || '';
      ibanInput.value = data.iban || '';  // masked
      ibanInput.readOnly = true;                 // masked — read-only until revealed
      document.getElementById('fBankSwift').value = data.swift_code || '';
    } catch (err) { toast(err.message, 'fa-solid fa-triangle-exclamation'); }
  }
  document.getElementById('bankAccountModal').classList.add('active');
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
  const btn = (evt && evt.currentTarget) || document.querySelector('#bankAccountModal .btn-fill');
  const bank_name = document.getElementById('fBankName').value.trim();
  const iban = document.getElementById('fBankIban').value.trim();
  const swift_code = document.getElementById('fBankSwift').value.trim() || null;
  if (!bank_name) { toast('Bank Name is required.', 'fa-solid fa-triangle-exclamation'); return; }
  if (!iban) { toast('IBAN is required.', 'fa-solid fa-triangle-exclamation'); return; }
  if (iban.startsWith('****')) {
    toast('Please reveal the IBAN before editing, or enter a new IBAN.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  setButtonLoading(btn, true, 'Saving...');
  try {
    await Api.upsertBankAccount(currentDetailEmployeeId, { bank_name, iban, swift_code });
    toast('Bank account saved.');
    closeModal('bankAccountModal');
    await loadBankAccountStatus(currentDetailEmployeeId);
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}
