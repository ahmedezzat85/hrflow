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
  const subEl = document.getElementById('dashInsuranceSub');
  if(!container) return;
  const agg = aggregateCompanyConsumption();
  const claimsList = Array.isArray(insuranceClaims) ? insuranceClaims : [];
  const totalClaims = claimsList.length;
  const claimedAmt = claimsList.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const approvedAmt = claimsList.filter(c => c.status === 'Approved').reduce((s, c) => s + (Number(c.amount) || 0), 0);
  if (subEl) {
    subEl.textContent = `${totalClaims} claim${totalClaims === 1 ? '' : 's'} · EGP ${claimedAmt.toLocaleString()} claimed · EGP ${approvedAmt.toLocaleString()} reimbursed`;
  }
  container.innerHTML = agg.slice(0, 3).map(cat => {
    const pct = Math.min(Math.max(cat.pct_used || 0, 0), 100);
    return `<div class="hv-dash-ins-tile">
      <div class="hv-dash-ins-meta">
        <span class="hv-dash-ins-cat">${escapeHtml(cat.category)}</span>
        <span class="hv-dash-ins-val">EGP ${cat.consumed.toLocaleString()}</span>
      </div>
      <span class="hv-dash-ins-track"><span class="hv-dash-ins-fill" style="width:${pct}%;"></span></span>
    </div>`;
  }).join('') || getEmptyStateHtml('No insurance data available yet.', 'fa-solid fa-briefcase-medical');
}
function renderAdminInsuranceHighlights(){
  const container = document.getElementById('adminInsuranceCategoryHighlights');
  if(!container) return;
  const agg = aggregateCompanyConsumption();
  container.innerHTML = agg.map(cat => {
    const pct = Math.min(Math.max(cat.pct_used || 0, 0), 100);
    return `<div class="insurance-limit-item">
      <div class="insurance-limit-meta">
        <span class="insurance-limit-name">${escapeHtml(cat.category)}</span>
        <span class="insurance-limit-val">${fmtMoney(cat.consumed)} of ${fmtMoney(cat.limit)}</span>
      </div>
      <div class="insurance-limit-track"><span class="insurance-limit-fill" style="width:${pct}%;"></span></div>
    </div>`;
  }).join('') || getEmptyStateHtml('No insurance data available yet.', 'fa-solid fa-briefcase-medical');
}

function renderCategoriesTable(){
  const body = document.getElementById('categoriesTableBody');
  if(!body) return;
  body.innerHTML = insuranceCategories.map(c=>`<tr>
    <td><div class="category-name-cell"><span class="category-dot"></span><span class="category-title">${escapeHtml(c.name)}</span></div></td>
    <td><span class="category-limit-cell">${fmtMoney(c.annual_limit)} a year</span></td>
    <td class="col-actions">
      <button type="button" class="icon-action" title="Edit ${escapeHtml(c.name)}" onclick="openCategoryModal(${c.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"></path></svg></button>
      <button type="button" class="icon-action" title="Remove ${escapeHtml(c.name)}" onclick="deleteCategory(${c.id})"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"></path></svg></button>
    </td>
  </tr>`).join('') || renderEmptyTableRow(3, 'No categories configured yet.', 'fa-solid fa-list');
}
function openCategoryModal(id=null){
  currentEditCategoryId = id;
  document.getElementById('categoryModalTitle').textContent = id ? 'Edit category' : 'Add category';
  if(id){ const c = insuranceCategories.find(x=>String(x.id)===String(id)); document.getElementById('fCatName').value = c.name; document.getElementById('fCatLimit').value = c.annual_limit; }
  else { document.getElementById('fCatName').value = ''; document.getElementById('fCatLimit').value = ''; }
  openModal('categoryModal');
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
  openModal('documentPreviewModal');
}
function renderInsuranceTable(){
  const body = document.getElementById('insuranceTableBody');
  if(!body) return;
  body.innerHTML = insuranceClaims.map(c=>{
    const hasReceipt = !!c.document_url;
    const isPending = c.status === 'Pending';
    const rowClass = isPending ? 'hv-row-pending' : '';
    const dateFormatted = fmtDateShort(c.date) || c.date;
    const providerText = (!c.provider || c.provider === '—' || c.provider === '-') ? '<span style="color:var(--ink-muted);">Not given</span>' : escapeHtml(c.provider);
    const receiptBtn = hasReceipt ? `<button type="button" class="icon-action" title="View receipt for ${escapeHtml(c.employee_name)}" data-action="view-claim-receipt" data-id="${escapeHtml(c.id)}" onclick="viewClaimReceipt('${escapeHtml(c.id)}')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.5 12.6 20.9a5.5 5.5 0 0 1-7.8-7.8l8.5-8.5a3.7 3.7 0 0 1 5.2 5.2l-8.5 8.5a1.8 1.8 0 0 1-2.6-2.6l7.8-7.8"></path></svg></button>` : '';
    const actionBtns = isPending
      ? `<button type="button" class="btn btn-sm btn-fill" onclick="actionClaim(${c.id},'Approved')">Approve</button><button type="button" class="icon-action text-danger" title="Reject claim from ${escapeHtml(c.employee_name)}" onclick="actionClaim(${c.id},'Rejected')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg></button>${receiptBtn}`
      : (receiptBtn || '<span style="color:var(--ink-muted);font-size:12px;">—</span>');
    return `<tr class="${rowClass}">
      <td data-label="Employee" class="tname"><div class="avatar">${initials(c.employee_name)}</div><span>${escapeHtml(c.employee_name)}</span></td>
      <td data-label="Category">${escapeHtml(c.category)}</td>
      <td data-label="Provider">${providerText}</td>
      <td data-label="Date" style="white-space:nowrap;">${dateFormatted}</td>
      <td data-label="Status">${statusPill(c.status)}</td>
      <td data-label="Amount" class="hv-right hv-tabular hv-bold" style="color:var(--ink-strong);">${fmtMoney(c.amount)}</td>
      <td data-label="Actions" class="col-actions hv-right" style="white-space:nowrap;">${actionBtns}</td>
    </tr>`;
  }).join('') || renderEmptyTableRow(7, 'No insurance claims recorded yet.', 'fa-solid fa-briefcase-medical');

  const totalClaimed = insuranceClaims.reduce((s, c) => s + Number(c.amount || 0), 0);
  const approvedClaims = insuranceClaims.filter(c => c.status === 'Approved');
  const approvedTotal = approvedClaims.reduce((s, c) => s + Number(c.amount || 0), 0);
  const pendingClaims = insuranceClaims.filter(c => c.status === 'Pending');
  const pendingTotal = pendingClaims.reduce((s, c) => s + Number(c.amount || 0), 0);
  const firstPending = pendingClaims[0];

  const elYtd = document.getElementById('statClaimsYtd');
  if (elYtd) elYtd.textContent = insuranceClaims.length;
  const subYtd = document.getElementById('statClaimsYtdSub');
  if (subYtd) subYtd.textContent = `${fmtMoney(totalClaimed)} claimed`;

  const elAppr = document.getElementById('statClaimsApproved');
  if (elAppr) elAppr.textContent = approvedClaims.length;
  const subAppr = document.getElementById('statClaimsApprovedSub');
  if (subAppr) subAppr.textContent = fmtMoney(approvedTotal);

  const elPend = document.getElementById('statClaimsPending');
  if (elPend) elPend.textContent = pendingClaims.length;
  const subPend = document.getElementById('statClaimsPendingSub');
  if (subPend) {
    subPend.textContent = pendingClaims.length > 0
      ? `${fmtMoney(pendingTotal)}${firstPending && firstPending.employee_name ? ' · ' + firstPending.employee_name : ''}`
      : 'All claims reviewed';
  }

  const elReimb = document.getElementById('statClaimsReimbursed');
  if (elReimb) elReimb.textContent = fmtMoney(approvedTotal);

  const elOpen = document.getElementById('statOpenClaims');
  if (elOpen) elOpen.textContent = pendingClaims.length;
  const elTot = document.getElementById('statClaimsTotal');
  if (elTot) elTot.innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${fmtMoney(approvedTotal)} total`;

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
  const dashSub = document.getElementById('empDashInsuranceSub');
  if(!consumption){
    if(dashGrid) dashGrid.innerHTML = getEmptyStateHtml('No insurance data available yet.', 'fa-solid fa-briefcase-medical');
    if(pageGrid) pageGrid.innerHTML = getEmptyStateHtml('No insurance data available yet.', 'fa-solid fa-briefcase-medical');
    return;
  }
  if (dashSub) {
    const pendingList = (typeof empInsuranceHistory !== 'undefined' && Array.isArray(empInsuranceHistory)) ? empInsuranceHistory.filter(c => c.status === 'Pending' || c.status === 'Waiting') : [];
    dashSub.textContent = `EGP ${consumption.total_consumed.toLocaleString()} used in ${new Date().getFullYear()} · ${pendingList.length} claim${pendingList.length === 1 ? '' : 's'} waiting`;
  }
  const dashChips = consumption.categories.map(cat => {
    const pct = cat.limit > 0 ? Math.min(Math.round((cat.consumed / cat.limit) * 100), 100) : 0;
    return `
      <div style="padding: 10px 12px; border-radius: 12px; background: var(--fv-surface-soft);">
        <div style="display: flex; justify-content: space-between; font-size: 12.5px; margin-bottom: 7px;">
          <span style="color: var(--ink-label); font-weight: 600;">${escapeHtml(cat.category)}</span>
          <span style="color: var(--ink-strong); font-weight: 700;">EGP ${cat.consumed.toLocaleString()} of ${cat.limit.toLocaleString()}</span>
        </div>
        <span style="height: 6px; border-radius: 999px; background: var(--fv-line); display: block; overflow: hidden;">
          <span style="display: block; height: 6px; border-radius: 999px; background: #1f9d8e; width: ${pct}%;"></span>
        </span>
      </div>
    `;
  }).join('');
  if(dashGrid) dashGrid.innerHTML = dashChips;
  if(pageGrid) pageGrid.innerHTML = consumption.categories.map(renderCategoryChip).join('');
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
