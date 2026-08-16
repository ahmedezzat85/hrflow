function renderSalaryPage(filter=''){
  const f = filter.toLowerCase();
  const totalPayroll = employees.reduce((s,e)=>s+e.salary,0);
  document.getElementById('statPayroll').textContent = fmtMoney(totalPayroll);
  const allRaises = employees.flatMap(e=>e.salaryHistory.map(h=>({...h, emp:e.name})));
  const thisYearRaises = allRaises.filter(h=>h.date.startsWith('2026'));
  document.getElementById('statRaisesYtd').textContent = thisYearRaises.length;
  const avgPct = thisYearRaises.length ? (thisYearRaises.reduce((s,h)=>s+parseFloat(h.pct),0)/thisYearRaises.length) : 0;
  document.getElementById('statAvgRaise').textContent = (avgPct>=0?'+':'') + avgPct.toFixed(1) + '%';
  const now = new Date(); // dynamic - was hardcoded to a fixed date (see docs/analysis/security-analysis-plan.md, finding #12)
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
  document.getElementById('rMode').value='pct'; document.getElementById('rValue').value=''; document.getElementById('rDate').value = new Date().toISOString().slice(0, 10); // dynamic - was hardcoded document.getElementById('rReason').value='Annual performance raise';
  onRaiseModeChange();
  document.getElementById('raisePreview').classList.remove('show');
  document.getElementById('raiseModal').classList.add('active');
}
function onRaiseEmployeeChange(){ updateRaisePreview(); }
function onRaiseModeChange(){
  const mode = document.getElementById('rMode').value;
  const label = document.getElementById('rValueLabel');
  label.textContent = mode==='pct' ? 'Percentage (%)' : (mode==='amount' ? 'Increase Amount (EGP)' : 'New Salary (EGP)');
  updateRaisePreview();
}
function computeNewSalary(current, mode, value){
  if(mode==='pct') return Math.round(current * (1 + value/100));
  if(mode==='amount') return Math.round(current + value);
  return Math.round(value);
}
function updateRaisePreview(){
  const empId = Number(document.getElementById('rEmpSelect').value);
  const emp = employees.find(e=>e.id===empId);
  const mode = document.getElementById('rMode').value;
  const value = Number(document.getElementById('rValue').value);
  const preview = document.getElementById('raisePreview');
  if(!emp || !value){ preview.classList.remove('show'); return; }
  const newSalary = computeNewSalary(emp.salary, mode, value);
  const pct = ((newSalary-emp.salary)/emp.salary*100);
  document.getElementById('rvCurrent').textContent = fmtMoney(emp.salary);
  document.getElementById('rvNew').textContent = fmtMoney(newSalary);
  document.getElementById('rvIncrease').textContent = (pct>=0?'+':'') + pct.toFixed(1) + '% (' + fmtMoney(newSalary-emp.salary) + ')';
  preview.classList.add('show');
}
async function applyRaise(){
  const empId = Number(document.getElementById('rEmpSelect').value);
  const emp = employees.find(e=>e.id===empId);
  const mode = document.getElementById('rMode').value;
  const value = Number(document.getElementById('rValue').value);
  const date = document.getElementById('rDate').value;
  const reason = document.getElementById('rReason').value;
  if(!emp || !value || !date){ toast('Please complete all fields.','fa-solid fa-triangle-exclamation'); return; }
  try{
    const result = await Api.applyRaise({ employee_id: empId, mode, value, effective_date: date, reason });
    closeModal('raiseModal');
    const pctStr = (result.pct_change>=0?'+':'') + result.pct_change.toFixed(1);
    toast(`Raise applied to ${emp.name}: ${pctStr}% (${fmtMoney(result.new_salary)}).`);
    await loadAdminData();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
function updateSalaryChart(){ const emp = employees.find(e=>e.id===window.LOGGED_IN_EMPLOYEE_ID) || currentLoggedInEmployee; const ch = window._charts.salary; if(!ch) return; ch.data.labels = emp.salaryHistory.map(s=>s.date.slice(0,7)); ch.data.datasets[0].data = emp.salaryHistory.map(s=>s.next); ch.update(); }
