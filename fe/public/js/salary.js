function renderSalaryPage(filter=''){
  const f = filter.toLowerCase();
  const totalPayroll = employees.reduce((s,e)=>s+e.salary,0);
  document.getElementById('statPayroll').textContent = fmtMoney(totalPayroll);
  const allRaises = employees.flatMap(e=>e.salaryHistory.map(h=>({...h, emp:e.name})));
  const thisYearRaises = allRaises.filter(h=>h.date.startsWith('2026'));
  document.getElementById('statRaisesYtd').textContent = thisYearRaises.length;
  const avgPct = thisYearRaises.length ? (thisYearRaises.reduce((s,h)=>s+parseFloat(h.pct),0)/thisYearRaises.length) : 0;
  document.getElementById('statAvgRaise').textContent = (avgPct>=0?'+':'') + avgPct.toFixed(1) + '%';
  const now = new Date();
  const qEnd = new Date(now); qEnd.setMonth(qEnd.getMonth()+3);
  const upcoming = employees.filter(e=>{ const d=new Date(e.nextRaise); return d>=now && d<=qEnd; });
  document.getElementById('statUpcomingQ').textContent = upcoming.length;
  const body = document.getElementById('salaryTableBody');
  body.innerHTML = employees.filter(e=>e.name.toLowerCase().includes(f) || e.dept.toLowerCase().includes(f)).map(e=>{ const last = e.salaryHistory.length ? e.salaryHistory[e.salaryHistory.length-1] : null; return `<tr><td class="tname"><div class="avatar">${initials(e.name)}</div>${e.name}</td><td>${e.dept}</td><td>${fmtMoney(e.salary)}</td><td>${e.nextRaise}</td><td>${last ? `${last.date} (${last.pct})` : '<span style="color:var(--text3);">No history</span>'}</td><td><button class="btn btn-sm btn-fill" onclick="openRaiseModal(${e.id})"><i class="fa-solid fa-arrow-trend-up"></i> Raise</button></td></tr>`; }).join('');
  const histBody = document.getElementById('companyRaiseHistoryBody');
  const sortedHist = allRaises.slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
  histBody.innerHTML = sortedHist.map(h=>`<tr><td class="tname"><div class="avatar">${initials(h.emp)}</div>${h.emp}</td><td>${h.date}</td><td>${fmtMoney(h.prev)}</td><td>${fmtMoney(h.next)}</td><td><span class="badge-pill pill-success">${h.pct}</span></td><td>${h.reason}</td></tr>`).join('') || `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-sack-dollar"></i><p>No raises recorded yet.</p></div></td></tr>`;
}
document.getElementById('salarySearch').addEventListener('input', e=>renderSalaryPage(e.target.value));
function openRaiseModal(empId=null){
  const sel = document.getElementById('rEmpSelect');
  sel.innerHTML = employees.map(e=>`<option value="${e.id}">${e.name} — ${e.job_role || e.role}</option>`).join('');
  if(empId) sel.value = empId;
  document.getElementById('rTarget').value='both';
  document.getElementById('rMode').value='pct'; document.getElementById('rValue').value=''; document.getElementById('rNewInternal').value=''; document.getElementById('rNewExternal').value='';
  document.getElementById('rDate').value = new Date().toISOString().slice(0, 10); document.getElementById('rReason').value='Annual performance raise';
  onRaiseTargetChange();
  document.getElementById('raisePreview').classList.remove('show');
  document.getElementById('raiseModal').classList.add('active');
}
function onRaiseEmployeeChange(){ updateRaisePreview(); }
function isBothNewMode(){
  return document.getElementById('rTarget').value === 'both' && document.getElementById('rMode').value === 'new';
}
function onRaiseTargetChange(){
  onRaiseModeChange();
}
function onRaiseModeChange(){
  const mode = document.getElementById('rMode').value;
  const bothNew = isBothNewMode();
  document.getElementById('rValueWrap').style.display = bothNew ? 'none' : '';
  document.getElementById('rNewInternalWrap').style.display = bothNew ? '' : 'none';
  document.getElementById('rNewExternalWrap').style.display = bothNew ? '' : 'none';
  const label = document.getElementById('rValueLabel');
  label.textContent = mode==='pct' ? 'Percentage (%)' : (mode==='amount' ? 'Increase Amount (USD)' : 'New Salary (USD)');
  updateRaisePreview();
}
function applyMode(current, mode, value){
  if(mode==='pct') return Math.round((current * (1 + value/100)) * 100) / 100;
  if(mode==='amount') return Math.round((current + value) * 100) / 100;
  return Math.round(value * 100) / 100;
}
function computeRaisePreviewValues(emp){
  const target = document.getElementById('rTarget').value;
  const mode = document.getElementById('rMode').value;
  const currentInternal = Number(emp.internalSalaryUsd || 0);
  const currentExternal = Number(emp.externalSalaryUsd || 0);
  let newInternal = currentInternal, newExternal = currentExternal;
  if(target === 'both' && mode === 'new'){
    const ni = Number(document.getElementById('rNewInternal').value);
    const ne = Number(document.getElementById('rNewExternal').value);
    if(document.getElementById('rNewInternal').value === '' || document.getElementById('rNewExternal').value === '') return null;
    newInternal = ni; newExternal = ne;
  } else {
    const value = Number(document.getElementById('rValue').value);
    if(document.getElementById('rValue').value === '' || isNaN(value)) return null;
    if(target === 'both'){
      newInternal = applyMode(currentInternal, mode, value);
      newExternal = applyMode(currentExternal, mode, value);
    } else if(target === 'internal'){
      newInternal = applyMode(currentInternal, mode, value);
    } else {
      newExternal = applyMode(currentExternal, mode, value);
    }
  }
  return { currentInternal, currentExternal, newInternal, newExternal };
}
function updateRaisePreview(){
  const empId = Number(document.getElementById('rEmpSelect').value);
  const emp = employees.find(e=>e.id===empId);
  const preview = document.getElementById('raisePreview');
  if(!emp){ preview.classList.remove('show'); return; }
  const vals = computeRaisePreviewValues(emp);
  if(!vals){ preview.classList.remove('show'); return; }
  const { currentInternal, currentExternal, newInternal, newExternal } = vals;
  const currentTotal = currentInternal + currentExternal;
  const newTotal = newInternal + newExternal;
  const pct = currentTotal > 0 ? ((newTotal-currentTotal)/currentTotal*100) : 0;
  document.getElementById('rvCurrentInternal').textContent = fmtUSD(currentInternal);
  document.getElementById('rvNewInternal').textContent = fmtUSD(newInternal);
  document.getElementById('rvCurrentExternal').textContent = fmtUSD(currentExternal);
  document.getElementById('rvNewExternal').textContent = fmtUSD(newExternal);
  document.getElementById('rvCurrent').textContent = fmtUSD(currentTotal);
  document.getElementById('rvNew').textContent = fmtUSD(newTotal);
  document.getElementById('rvIncrease').textContent = (pct>=0?'+':'') + pct.toFixed(1) + '% (' + fmtUSD(newTotal-currentTotal) + ')';
  preview.classList.add('show');
}
async function applyRaise(){
  const empId = Number(document.getElementById('rEmpSelect').value);
  const emp = employees.find(e=>e.id===empId);
  const target = document.getElementById('rTarget').value;
  const mode = document.getElementById('rMode').value;
  const date = document.getElementById('rDate').value;
  const reason = document.getElementById('rReason').value;
  if(!emp || !date){ toast('Please complete all fields.','fa-solid fa-triangle-exclamation'); return; }

  const payload = { employee_id: empId, mode, target, effective_date: date, reason };
  if(target === 'both' && mode === 'new'){
    const internalVal = document.getElementById('rNewInternal').value;
    const externalVal = document.getElementById('rNewExternal').value;
    if(internalVal === '' || externalVal === ''){ toast('Please enter both new salary values.','fa-solid fa-triangle-exclamation'); return; }
    payload.internal_value = Number(internalVal);
    payload.external_value = Number(externalVal);
  } else {
    const value = document.getElementById('rValue').value;
    if(value === ''){ toast('Please enter a value.','fa-solid fa-triangle-exclamation'); return; }
    payload.value = Number(value);
  }

  try{
    const result = await Api.applyRaise(payload);
    closeModal('raiseModal');
    const pctStr = (result.pct_change>=0?'+':'') + result.pct_change.toFixed(1) + '%';
    toast(`Raise applied to ${emp.name}: ${pctStr} → ${fmtUSD(result.new_internal_salary_usd + result.new_external_salary_usd)}.`);
    await loadAdminData();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
function updateSalaryChart(){ const emp = employees.find(e=>e.id===window.LOGGED_IN_EMPLOYEE_ID) || currentLoggedInEmployee; const ch = window._charts.salary; if(!ch) return; ch.data.labels = emp.salaryHistory.map(s=>s.date.slice(0,7)); ch.data.datasets[0].data = emp.salaryHistory.map(s=>s.next); ch.update(); }