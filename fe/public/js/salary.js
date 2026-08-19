function fmtDelta(amount, pct){
  const sign = amount >= 0 ? '+' : '';
  return `${sign}${fmtUSD(amount)} (${sign}${pct.toFixed(1)}%)`;
}
function computeRowDeltas(prevInternal, prevExternal, newInternal, newExternal){
  const prevTotal = prevInternal + prevExternal;
  const newTotal = newInternal + newExternal;
  const internalAmt = newInternal - prevInternal;
  const internalPct = prevInternal > 0 ? (internalAmt / prevInternal * 100) : 0;
  const externalAmt = newExternal - prevExternal;
  const externalPct = prevExternal > 0 ? (externalAmt / prevExternal * 100) : 0;
  const totalAmt = newTotal - prevTotal;
  const totalPct = prevTotal > 0 ? (totalAmt / prevTotal * 100) : 0;
  return { internalAmt, internalPct, externalAmt, externalPct, totalAmt, totalPct };
}
function renderSalaryPage(filter=''){
  const f = filter.toLowerCase();
  const totalPayroll = employees.reduce((s,e)=>s+e.salary,0);
  document.getElementById('statPayroll').textContent = fmtMoney(totalPayroll);
  const allRaises = employees.flatMap(e=>e.salaryHistory.map(h=>({...h, emp:e.name, empId:e.id})));
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
  histBody.innerHTML = sortedHist.map((h, idx) => {
    const olderSameEmp = sortedHist.slice(idx+1).find(o => o.empId === h.empId);
    const prevInternal = olderSameEmp ? Number(olderSameEmp.newInternal || 0) : Number(h.prevInternal || 0);
    const prevExternal = olderSameEmp ? Number(olderSameEmp.newExternal || 0) : Number(h.prevExternal || 0);
    const newInternal = Number(h.newInternal || 0);
    const newExternal = Number(h.newExternal || 0);
    const d = computeRowDeltas(prevInternal, prevExternal, newInternal, newExternal);
    return `<tr><td class="tname"><div class="avatar">${initials(h.emp)}</div>${h.emp}</td><td>${h.date}</td><td>${fmtUSD(newInternal)}</td><td>${fmtUSD(newExternal)}</td><td>${fmtUSD(newInternal+newExternal)}</td><td>${fmtDelta(d.internalAmt, d.internalPct)}</td><td>${fmtDelta(d.externalAmt, d.externalPct)}</td><td><span class="badge-pill pill-success">${fmtDelta(d.totalAmt, d.totalPct)}</span></td><td>${h.reason}</td></tr>`;
  }).join('') || `<tr><td colspan="9"><div class="empty-state"><i class="fa-solid fa-sack-dollar"></i><p>No raises recorded yet.</p></div></td></tr>`;
}
document.getElementById('salarySearch').addEventListener('input', e=>renderSalaryPage(e.target.value));
function openRaiseModal(empId=null){
  const sel = document.getElementById('rEmpSelect');
  sel.innerHTML = employees.map(e=>`<option value="${e.id}">${e.name} — ${e.job_role || e.role}</option>`).join('');
  if(empId) sel.value = empId;
  document.getElementById('rNewInternal').value = '';
  document.getElementById('rNewExternal').value = '';
  document.getElementById('rDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('rReason').value = 'Annual performance raise';
  onRaiseEmployeeChange();
  document.getElementById('raiseModal').classList.add('active');
}
function onRaiseEmployeeChange(){
  const empId = Number(document.getElementById('rEmpSelect').value);
  const emp = employees.find(e=>e.id===empId);
  document.getElementById('rvCurrentInternal').value = emp ? fmtUSD(emp.internalSalaryUsd || 0) : '—';
  document.getElementById('rvCurrentExternal').value = emp ? fmtUSD(emp.externalSalaryUsd || 0) : '—';
  updateRaisePreview();
}
function updateRaisePreview(){
  const empId = Number(document.getElementById('rEmpSelect').value);
  const emp = employees.find(e=>e.id===empId);
  const preview = document.getElementById('raisePreview');
  const internalVal = document.getElementById('rNewInternal').value;
  const externalVal = document.getElementById('rNewExternal').value;
  if(!emp || internalVal === '' || externalVal === ''){ preview.classList.remove('show'); return; }
  const newInternal = Number(internalVal);
  const newExternal = Number(externalVal);
  if(isNaN(newInternal) || isNaN(newExternal)){ preview.classList.remove('show'); return; }
  const currentInternal = Number(emp.internalSalaryUsd || 0);
  const currentExternal = Number(emp.externalSalaryUsd || 0);
  const d = computeRowDeltas(currentInternal, currentExternal, newInternal, newExternal);
  document.getElementById('rvInternalDelta').textContent = fmtDelta(d.internalAmt, d.internalPct);
  document.getElementById('rvExternalDelta').textContent = fmtDelta(d.externalAmt, d.externalPct);
  document.getElementById('rvCurrent').textContent = fmtUSD(currentInternal + currentExternal);
  document.getElementById('rvNew').textContent = fmtUSD(newInternal + newExternal);
  document.getElementById('rvIncrease').textContent = fmtDelta(d.totalAmt, d.totalPct);
  preview.classList.add('show');
}
async function applyRaise(){
  const empId = Number(document.getElementById('rEmpSelect').value);
  const emp = employees.find(e=>e.id===empId);
  const date = document.getElementById('rDate').value;
  const reason = document.getElementById('rReason').value;
  const internalVal = document.getElementById('rNewInternal').value;
  const externalVal = document.getElementById('rNewExternal').value;
  if(!emp || !date || internalVal === '' || externalVal === ''){ toast('Please complete all fields.','fa-solid fa-triangle-exclamation'); return; }

  const payload = {
    employee_id: empId,
    new_internal_salary_usd: Number(internalVal),
    new_external_salary_usd: Number(externalVal),
    effective_date: date,
    reason,
  };

  try{
    const result = await Api.applyRaise(payload);
    closeModal('raiseModal');
    const pctStr = (result.total_delta_pct>=0?'+':'') + result.total_delta_pct.toFixed(1) + '%';
    toast(`Raise applied to ${emp.name}: ${pctStr} → ${fmtUSD(result.new_internal_salary_usd + result.new_external_salary_usd)}.`);
    await loadAdminData();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
function updateSalaryChart(){ const emp = employees.find(e=>e.id===window.LOGGED_IN_EMPLOYEE_ID) || currentLoggedInEmployee; const ch = window._charts.salary; if(!ch) return; ch.data.labels = emp.salaryHistory.map(s=>s.date.slice(0,7)); ch.data.datasets[0].data = emp.salaryHistory.map(s=>s.next); ch.update(); }