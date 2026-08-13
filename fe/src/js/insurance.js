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
  return `<div class="card" style="padding:16px;">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;gap:8px;">
      <b style="font-size:13px;">${cat.category}</b>${insuranceStatusBadge(cat.status)}
    </div>
    <div style="font-size:12.5px;color:var(--text2);margin-bottom:8px;">${fmtMoney(cat.consumed)} of ${fmtMoney(cat.limit)}</div>
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
  container.innerHTML = agg.map(renderCategoryChip).join('') || '<p style="color:var(--text2);font-size:13px;">No insurance data yet.</p>';
}
function renderAdminInsuranceHighlights(){
  const container = document.getElementById('adminInsuranceCategoryHighlights');
  if(!container) return;
  const agg = aggregateCompanyConsumption();
  container.innerHTML = agg.map(renderCategoryChip).join('') || '<p style="color:var(--text2);font-size:13px;">No insurance data yet.</p>';
}
function renderCategoriesTable(){
  const body = document.getElementById('categoriesTableBody');
  if(!body) return;
  body.innerHTML = insuranceCategories.map(c=>`<tr><td>${c.name}</td><td>${fmtMoney(c.annual_limit)}</td><td style="display:flex;gap:6px;"><button class="icon-action" onclick="openCategoryModal(${c.id})"><i class="fa-solid fa-pen"></i></button><button class="icon-action" onclick="deleteCategory(${c.id})"><i class="fa-solid fa-trash"></i></button></td></tr>`).join('') || `<tr><td colspan="3"><div class="empty-state"><i class="fa-solid fa-list"></i><p>No categories configured yet.</p></div></td></tr>`;
}
function openCategoryModal(id=null){
  currentEditCategoryId = id;
  document.getElementById('categoryModalTitle').textContent = id ? 'Edit Category' : 'Add Category';
  if(id){ const c = insuranceCategories.find(x=>String(x.id)===String(id)); document.getElementById('fCatName').value = c.name; document.getElementById('fCatLimit').value = c.annual_limit; }
  else { document.getElementById('fCatName').value = ''; document.getElementById('fCatLimit').value = ''; }
  document.getElementById('categoryModal').classList.add('active');
}
async function saveCategory(){
  const name = document.getElementById('fCatName').value.trim();
  const limit = Number(document.getElementById('fCatLimit').value);
  if(!name || !limit){ toast('Please fill in category name and annual limit.','fa-solid fa-triangle-exclamation'); return; }
  try{
    if(currentEditCategoryId){ await Api.updateInsuranceCategory(currentEditCategoryId, {name, annual_limit: limit}); toast('Category updated.'); }
    else { await Api.createInsuranceCategory({name, annual_limit: limit}); toast('Category added.'); }
    closeModal('categoryModal');
    await loadAdminData();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
async function deleteCategory(id){
  try{ await Api.deleteInsuranceCategory(id); toast('Category removed.', 'fa-solid fa-trash'); await loadAdminData(); }
  catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
function populateClaimCategoryOptions(){
  const sel = document.getElementById('claimCategory');
  if(!sel) return;
  const current = sel.value;
  sel.innerHTML = insuranceCategories.map(c=>`<option value="${c.name}">${c.name}</option>`).join('');
  if(current) sel.value = current;
}
function renderInsuranceTable(){
  const body = document.getElementById('insuranceTableBody');
  body.innerHTML = insuranceClaims.map(c=>`<tr><td class="tname"><div class="avatar">${initials(c.employee_name)}</div>${c.employee_name}</td><td>${c.category}</td><td>${c.provider}</td><td>${fmtMoney(c.amount)}</td><td>${c.date}</td><td>${statusPill(c.status)}</td><td style="display:flex;gap:6px;">${c.status==='Pending' ? `<button class="btn btn-sm btn-success-outline" onclick="actionClaim(${c.id},'Approved')"><i class="fa-solid fa-check"></i></button><button class="btn btn-sm btn-danger-outline" onclick="actionClaim(${c.id},'Rejected')"><i class="fa-solid fa-xmark"></i></button>` : `<span style="color:var(--text3);font-size:12px;">—</span>`}</td></tr>`).join('');
  document.getElementById('statClaimsYtd').textContent = insuranceClaims.length;
  document.getElementById('statClaimsApproved').textContent = insuranceClaims.filter(c=>c.status==='Approved').length;
  document.getElementById('statClaimsPending').textContent = insuranceClaims.filter(c=>c.status==='Pending').length;
  document.getElementById('statClaimsReimbursed').textContent = fmtMoney(insuranceClaims.filter(c=>c.status==='Approved').reduce((s,c)=>s+Number(c.amount),0));
  document.getElementById('statOpenClaims').textContent = insuranceClaims.filter(c=>c.status==='Pending').length;
  document.getElementById('statClaimsTotal').innerHTML = `<i class="fa-solid fa-arrow-down"></i> ${fmtMoney(insuranceClaims.filter(c=>c.status==='Approved').reduce((s,c)=>s+Number(c.amount),0))} total`;
}
async function actionClaim(claimId, status){
  try{ await Api.actionInsuranceClaim(claimId, status); toast(`Claim ${status.toLowerCase()}.`); await loadAdminData(); }
  catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
function renderEmployeeInsuranceHighlights(){
  const consumption = insuranceConsumption.find(c=>String(c.employee_id)===String(window.LOGGED_IN_EMPLOYEE_ID));
  const dashGrid = document.getElementById('empDashInsuranceCategoryChips');
  const pageGrid = document.getElementById('empInsuranceCategoryGrid');
  const totalEl = document.getElementById('empInsuranceTotalConsumed');
  if(!consumption){ if(dashGrid) dashGrid.innerHTML = '<p style="color:var(--text2);font-size:13px;">No insurance data yet.</p>'; if(pageGrid) pageGrid.innerHTML = '<p style="color:var(--text2);font-size:13px;">No insurance data yet.</p>'; return; }
  const chips = consumption.categories.map(renderCategoryChip).join('');
  if(dashGrid) dashGrid.innerHTML = chips;
  if(pageGrid) pageGrid.innerHTML = chips;
  if(totalEl) totalEl.textContent = `${fmtMoney(consumption.total_consumed)} of ${fmtMoney(consumption.total_limit)}`;
}
async function submitClaim(){
  const category = document.getElementById('claimCategory').value;
  const amount = Number(document.getElementById('claimAmount').value);
  const fileInput = document.getElementById('claimDocument');
  if(!category){ toast('Please select an insurance category.','fa-solid fa-triangle-exclamation'); return; }
  if(!amount){ toast('Please enter a claim amount.','fa-solid fa-triangle-exclamation'); return; }
  let documentUrl = '';
  const file = fileInput && fileInput.files[0];
  if(file){
    if(file.size > 2*1024*1024){ toast('Supporting document must be under 2MB.','fa-solid fa-triangle-exclamation'); return; }
    try{ documentUrl = await readFileAsDataUrl(file); }
    catch(e){ toast('Could not read the selected file.','fa-solid fa-triangle-exclamation'); return; }
  }
  try{
    await Api.submitInsuranceClaim({ employee_name: currentLoggedInEmployee.name, category, provider: '—', amount, document_url: documentUrl });
    toast('Insurance claim submitted.');
    document.getElementById('claimAmount').value='';
    if(fileInput) fileInput.value='';
    await loadEmployeeData();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
