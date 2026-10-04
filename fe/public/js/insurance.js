function insuranceStatusBadge(status){
  if(status==='limit_reached') return '<span class="badge-pill pill-danger"><i class="fa-solid fa-triangle-exclamation"></i> Limit reached</span>';
  if(status==='approaching') return '<span class="badge-pill pill-warning"><i class="fa-solid fa-clock"></i> Approaching limit</span>';
  return '<span class="badge-pill pill-success"><i class="fa-solid fa-check"></i> OK</span>';
}
function insuranceProgressColor(status){
  if(status==='limit_reached') return 'var(--danger)';
  if(status==='approaching') return 'var(--warning)';
  return 'var(--accent)';
}
function renderCategoryChip(cat){
  return `<div class="insurance-chip">
    <div class="chip-top">
      <b>${escapeHtml(cat.category)}</b>${insuranceStatusBadge(cat.status)}
    </div>
    <div class="chip-amount">${fmtMoney(cat.consumed)} of ${fmtMoney(cat.limit)}</div>
    <div class="progress-bar"><span style="width:${Math.min(cat.pct_used,100)}%;background:${insuranceProgressColor(cat.status)};"></span></div>
  </div>`;
}
function aggregateCompanyConsumption(){
  const byCat = {};
  insuranceConsumption.forEach(emp=>{
    emp.categories.forEach(cat=>{
      if(!byCat[cat.category]) byCat[cat.category] = {category:cat.category, consumed:0, limit:0};
      byCat[cat.category].consumed += cat.consumed;
      byCat[cat.category].limit += cat.limit;
    });
  });
  return Object.values(byCat).map(c=>{
    const pct = c.limit>0 ? Math.round((c.consumed/c.limit)*1000)/10 : 0;
    const status = (c.limit>0 && c.consumed>=c.limit) ? 'limit_reached' : ((c.limit>0 && pct>=80) ? 'approaching' : 'ok');
    return {...c, pct_used: pct, status};
  });
}
function renderDashboardInsuranceHighlights(){
  const container = document.getElementById('dashInsuranceCategoryChips');
  if(!container) return;
  const agg = aggregateCompanyConsumption();
  container.innerHTML = agg.map(renderCategoryChip).join('') || getEmptyStateHtml('No insurance data available yet.', 'fa-solid fa-briefcase-medical');
}
function renderAdminInsuranceHighlights(){
  const container = document.getElementById('adminInsuranceCategoryHighlights');
  if(!container) return;
  const agg = aggregateCompanyConsumption();
  container.innerHTML = agg.map(renderCategoryChip).join('') || getEmptyStateHtml('No insurance data available yet.', 'fa-solid fa-briefcase-medical');
}

function renderCategoriesTable(){
  const body = document.getElementById('categoriesTableBody');
  if(!body) return;
  body.innerHTML = insuranceCategories.map(c=>`<tr><td>${escapeHtml(c.name)}</td><td>${fmtMoney(c.annual_limit)}</td><td style="display:flex;gap:6px;"><button class="icon-action" onclick="openCategoryModal(${c.id})"><i class="fa-solid fa-pen"></i></button><button class="icon-action" onclick="deleteCategory(${c.id})"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('') || renderEmptyTableRow(3, 'No categories configured yet.', 'fa-solid fa-list');
}
function openCategoryModal(id=null){
  currentEditCategoryId = id;
  document.getElementById('categoryModalTitle').textContent = id ? 'Edit Category' : 'Add Category';
  if(id){ const c = insuranceCategories.find(x=>String(x.id)===String(id)); document.getElementById('fCatName').value = c.name; document.getElementById('fCatLimit').value = c.annual_limit; }
  else { document.getElementById('fCatName').value = ''; document.getElementById('fCatLimit').value = ''; }
  document.getElementById('categoryModal').classList.add('active');
}
async function saveCategory(evt){
  const btn = (evt && evt.currentTarget) || document.getElementById('categoryModalSaveBtn') || document.querySelector('#categoryModal .btn-fill');
  const name = document.getElementById('fCatName').value.trim();
  const limit = Number(document.getElementById('fCatLimit').value);
  if (!FinanceForm.validateRequiredFields('categoryModal', [
    { id: 'fCatName', message: 'Enter a category name.' },
    { id: 'fCatLimit', message: 'Enter an annual limit greater than 0.', check: (v) => Number(v) > 0 },
  ])) return;
  setButtonLoading(btn, true, 'Saving…');
  try{
    if(currentEditCategoryId){ await Api.updateInsuranceCategory(currentEditCategoryId, {name, annual_limit: limit}); toast('Category updated.'); }
    else { await Api.createInsuranceCategory({name, annual_limit: limit}); toast('Category added.'); }
    closeModal('categoryModal');
    await loadAdminData();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
  finally { setButtonLoading(btn, false); }
}
async function deleteCategory(id){
  const ok = await FinanceCommand.confirmAction({
    title: 'Delete insurance category',
    consequence: 'Delete this insurance category? Existing claims keep their category name.',
    actionLabel: 'Delete category',
  });
  if (!ok.confirmed) return;
  try{ await Api.deleteInsuranceCategory(id); toast('Category removed.', 'fa-solid fa-trash'); await loadAdminData(); }
  catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
function populateClaimCategoryOptions(){
  const sel = document.getElementById('claimCategory');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = insuranceCategories.map(c=>`<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)}</option>`).join('');
  if(current) sel.value = current;
}
// Admin claim receipts: shown in the existing document preview modal. The receipt is stored as a
// data URL in the claim record, so it is displayed as-is (no storage change here).
function viewClaimReceipt(claimId){
  showReceiptPreview(insuranceClaims.find(c => String(c.id) === String(claimId)));
}
function showReceiptPreview(claim){
  if (!claim || !claim.document_url) { toast('This claim has no receipt.', 'fa-solid fa-circle-info'); return; }
  const url = String(claim.document_url);
  const container = document.getElementById('docPreviewContainer');
  const downloadBtn = document.getElementById('docPreviewDownloadBtn');
  document.getElementById('docPreviewTitle').textContent = `Receipt — ${claim.employee_name || 'claim'} (${claim.category || ''})`;
  const isImage = /^data:image\//i.test(url);
  container.textContent = '';
  const node = document.createElement(isImage ? 'img' : 'iframe');
  node.src = url;
  node.setAttribute('title', 'Claim receipt');
  node.className = isImage ? 'doc-preview-image' : 'doc-preview-frame';
  container.appendChild(node);
  if (downloadBtn) {
    downloadBtn.onclick = (e) => {
      e.preventDefault();
      const a = document.createElement('a');
      a.href = url;
      a.download = `claim-${claim.id}-receipt`;
      document.body.appendChild(a); a.click(); a.remove();
    };
  }
  document.getElementById('documentPreviewModal').classList.add('active');
}
function renderInsuranceTable(){
  const body = document.getElementById('insuranceTableBody');
  if(!body) return;
  body.innerHTML = insuranceClaims.map(c=>`<tr>
    <td data-label="Employee" class="tname"><div class="avatar">${initials(c.employee_name)}</div>${escapeHtml(c.employee_name)}</td>
    <td data-label="Category">${escapeHtml(c.category)}</td>
    <td data-label="Provider">${escapeHtml(c.provider)}</td>
    <td data-label="Amount">${fmtMoney(c.amount)}</td>
    <td data-label="Date">${c.date}</td>
    <td data-label="Status">${statusPill(c.status)}</td>
    <td data-label="Actions" class="col-actions">${c.document_url ? `<button class="icon-action" title="View receipt" data-action="view-claim-receipt" data-id="${escapeHtml(c.id)}"><i class="fa-solid fa-paperclip"></i></button>` : ''}${c.status==='Pending' ? `<button class="btn btn-sm btn-success-outline" onclick="actionClaim(${c.id},'Approved')"><i class="fa-solid fa-check"></i> Approve</button><button class="btn btn-sm btn-danger-outline" onclick="actionClaim(${c.id},'Rejected')"><i class="fa-solid fa-xmark"></i> Reject</button>` : `<span style="color:var(--text3);font-size:12px;">—</span>`}</td>
  </tr>`).join('') || renderEmptyTableRow(7, 'No insurance claims recorded yet.', 'fa-solid fa-briefcase-medical');
  document.getElementById('statClaimsYtd').textContent = insuranceClaims.length;
  document.getElementById('statClaimsApproved').textContent = insuranceClaims.filter(c=>c.status==='Approved').length;
  document.getElementById('statClaimsPending').textContent = insuranceClaims.filter(c=>c.status==='Pending').length;
  document.getElementById('statClaimsReimbursed').textContent = fmtMoney(insuranceClaims.filter(c=>c.status==='Approved').reduce((s,c)=>s+Number(c.amount),0));
  document.getElementById('statOpenClaims').textContent = insuranceClaims.filter(c=>c.status==='Pending').length;
  document.getElementById('statClaimsTotal').innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${fmtMoney(insuranceClaims.filter(c=>c.status==='Approved').reduce((s,c)=>s+Number(c.amount),0))} total`;
}
async function actionClaim(claimId, status){
  const approving = status === 'Approved';
  const ok = await FinanceCommand.confirmAction({
    title: approving ? 'Approve claim' : 'Reject claim',
    consequence: approving
      ? 'Approve this claim for reimbursement?'
      : 'Reject this claim? The employee will see it as rejected.',
    actionLabel: approving ? 'Approve claim' : 'Reject claim',
    actionClass: approving ? 'btn btn-fill' : 'btn btn-danger',
    severity: approving ? 'warning' : undefined,
  });
  if (!ok.confirmed) return;
  try{ await Api.actionInsuranceClaim(claimId, status); toast(`Claim ${status.toLowerCase()}.`); await loadAdminData(); }
  catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
function renderEmployeeInsuranceHighlights(){
  const consumption = insuranceConsumption.find(c=>String(c.employee_id)===String(window.LOGGED_IN_EMPLOYEE_ID));
  const dashGrid = document.getElementById('empDashInsuranceCategoryChips');
  const pageGrid = document.getElementById('empInsuranceCategoryGrid');
  const totalEl = document.getElementById('empInsuranceTotalConsumed');
  if(!consumption){
    if(dashGrid) dashGrid.innerHTML = getEmptyStateHtml('No insurance data available yet.', 'fa-solid fa-briefcase-medical');
    if(pageGrid) pageGrid.innerHTML = getEmptyStateHtml('No insurance data available yet.', 'fa-solid fa-briefcase-medical');
    return;
  }
  const chips = consumption.categories.map(renderCategoryChip).join('');
  if(dashGrid) dashGrid.innerHTML = chips;
  if(pageGrid) pageGrid.innerHTML = chips;
  if(totalEl) totalEl.textContent = `${fmtMoney(consumption.total_consumed)} of ${fmtMoney(consumption.total_limit)}`;
}
async function submitClaim(evt){
  const btn = (evt && evt.currentTarget) || document.querySelector('#e-insurance .btn-fill');
  const category = document.getElementById('claimCategory').value;
  const amount = Number(document.getElementById('claimAmount').value);
  const fileInput = document.getElementById('claimDocument');
  if (!FinanceForm.validateRequiredFields('empClaimForm', [
    { id: 'claimCategory', message: 'Select an insurance category.' },
    { id: 'claimAmount', message: 'Enter a claim amount greater than 0.', check: (v) => Number(v) > 0 },
  ])) return;
  let documentUrl = '';
  const file = fileInput && fileInput.files[0];
  if(file){
    if(file.size > 2*1024*1024){ toast('Supporting document must be under 2MB.','fa-solid fa-triangle-exclamation'); return; }
    try{ documentUrl = await readFileAsDataUrl(file); }
    catch(e){ toast('Could not read the selected file.','fa-solid fa-triangle-exclamation'); return; }
  }
  setButtonLoading(btn, true, 'Submitting…');
  try{
    await Api.submitInsuranceClaim({ employee_name: currentLoggedInEmployee.name, category, provider: '—', amount, document_url: documentUrl });
    toast('Insurance claim submitted for approval.');
    document.getElementById('claimAmount').value = '';
    if(fileInput) fileInput.value = '';
    await loadEmployeeData();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
  finally { setButtonLoading(btn, false); }
}

// Employee portal: open the receipt attached to one of the signed-in user's own claims.
function viewOwnClaimReceipt(index){
  showReceiptPreview(empInsuranceHistory[index]);
}
