function renderSalaryPage(filter=''){
  const f = filter.toLowerCase();
  const totalPayroll = employees.reduce((s,e)=>s+e.salary,0);
  document.getElementById('statPayroll').textContent = fmtMoney(totalPayroll);
  const allRaises = employees.flatMap(e=>e.salaryHistory.map(h=>({...h, emp:e.name})));
  const thisYearRaises = allRaises.filter(h=>h.date.startsWith(String(new Date().getFullYear())));
  document.getElementById('statRaisesYtd').textContent = thisYearRaises.length;
  const avgPct = thisYearRaises.length ? (thisYearRaises.reduce((s,h)=>s+parseFloat(h.pct),0)/thisYearRaises.length) : 0;
  document.getElementById('statAvgRaise').textContent = (avgPct>=0?'+':'') + avgPct.toFixed(1) + '%';
  const now = new Date();
  const qEnd = new Date(now); qEnd.setMonth(qEnd.getMonth()+3);
  const upcoming = employees.filter(e=>{ const d=new Date(e.nextRaise); return d>=now && d<=qEnd; });
  document.getElementById('statUpcomingQ').textContent = upcoming.length;
  const body = document.getElementById('salaryTableBody');
  body.innerHTML = employees.filter(e=>e.name.toLowerCase().includes(f) || e.dept.toLowerCase().includes(f)).map(e=>{ const last = e.salaryHistory.length ? e.salaryHistory[e.salaryHistory.length-1] : null; return `<tr><td class="tname"><div class="avatar">${initials(e.name)}</div>${e.name}</td><td>${e.dept}</td><td>${fmtMoney(e.salary)} <span style="color:var(--text3);font-size:11px;">(Int: ${fmtMoney(e.internalSalary)} / Ext: ${fmtMoney(e.externalSalary)})</span></td><td>${e.nextRaise}</td><td>${last ? `${last.date} (${last.pct})` : '<span style="color:var(--text3);">No history</span>'}</td><td><button class="btn btn-sm btn-fill" onclick="openRaiseModal(${e.id})"><i class="fa-solid fa-arrow-trend-up"></i> Raise</button></td></tr>`; }).join('');
  const histBody = document.getElementById('companyRaiseHistoryBody');
  const sortedHist = allRaises.slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
  histBody.innerHTML = sortedHist.map(h=>`<tr><td class="tname"><div class="avatar">${initials(h.emp)}</div>${h.emp}</td><td>${h.date}</td><td>${fmtMoney(h.prev)}</td><td>${fmtMoney(h.next)}</td><td><span class="badge-pill pill-success">${h.pct}</span></td><td>${h.reason}</td></tr>`).join('') || `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-sack-dollar"></i><p>No raises recorded yet.</p></div></td></tr>`;
}
document.getElementById('salarySearch').addEventListener('input', e=>renderSalaryPage(e.target.value));

function openRaiseModal(empId=null){
  const sel = document.getElementById('rEmpSelect');
  sel.innerHTML = employees.map(e=>`<option value="${e.id}">${e.name} — ${e.job_role || e.role}</option>`).join('');
  if(empId) sel.value = empId;
  const emp = employees.find(e=>e.id===Number(sel.value));
  document.getElementById('rNewInternal').value = emp ? emp.internalSalary : '';
  document.getElementById('rNewExternal').value = emp ? emp.externalSalary : '';
  document.getElementById('rDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('rReason').value='Annual performance raise';
  updateRaisePreview();
  document.getElementById('raiseModal').classList.add('active');
}

function onRaiseEmployeeChange(){
  const emp = employees.find(e=>e.id===Number(document.getElementById('rEmpSelect').value));
  if(emp){
    document.getElementById('rNewInternal').value = emp.internalSalary;
    document.getElementById('rNewExternal').value = emp.externalSalary;
  }
  updateRaisePreview();
}

function updateRaisePreview(){
  const empId = Number(document.getElementById('rEmpSelect').value);
  const emp = employees.find(e=>e.id===empId);
  const preview = document.getElementById('raisePreview');
  const newInternalStr = document.getElementById('rNewInternal').value;
  const newExternalStr = document.getElementById('rNewExternal').value;

  if(!emp || newInternalStr === '' || newExternalStr === ''){ preview.classList.remove('show'); return; }

  const newInternal = Number(newInternalStr);
  const newExternal = Number(newExternalStr);
  const currentTotal = emp.internalSalary + emp.externalSalary;
  const newTotal = newInternal + newExternal;
  const pct = currentTotal > 0 ? ((newTotal-currentTotal)/currentTotal*100) : 0;

  document.getElementById('rvCurrent').textContent = `${fmtMoney(currentTotal)} (Int: ${fmtMoney(emp.internalSalary)} / Ext: ${fmtMoney(emp.externalSalary)})`;
  document.getElementById('rvNew').textContent = `${fmtMoney(newTotal)} (Int: ${fmtMoney(newInternal)} / Ext: ${fmtMoney(newExternal)})`;
  document.getElementById('rvIncrease').textContent = (pct>=0?'+':'') + pct.toFixed(1) + '% (' + fmtMoney(newTotal-currentTotal) + ')';
  preview.classList.add('show');
}

async function applyRaise(){
  const empId = Number(document.getElementById('rEmpSelect').value);
  const emp = employees.find(e=>e.id===empId);
  const date = document.getElementById('rDate').value;
  const reason = document.getElementById('rReason').value;
  const newInternalStr = document.getElementById('rNewInternal').value;
  const newExternalStr = document.getElementById('rNewExternal').value;

  if(!emp || !date){ toast('Please complete all fields.','fa-solid fa-triangle-exclamation'); return; }
  if(newInternalStr === '' || newExternalStr === ''){
    toast('Please enter both the new Internal and new External salary (0 is allowed).','fa-solid fa-triangle-exclamation');
    return;
  }

  const payload = {
    employee_id: empId,
    new_internal_usd: Number(newInternalStr),
    new_external_usd: Number(newExternalStr),
    effective_date: date,
    reason,
  };

  try{
    const result = await Api.applyRaise(payload);
    closeModal('raiseModal');
    const pctStr = (result.pct_change>=0?'+':'') + result.pct_change.toFixed(1);
    toast(`Raise applied to ${emp.name}: ${pctStr}% (total ${fmtMoney(result.new_salary)}).`);
    await loadAdminData();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
function updateSalaryChart(){ const emp = employees.find(e=>e.id===window.LOGGED_IN_EMPLOYEE_ID) || currentLoggedInEmployee; const ch = window._charts.salary; if(!ch) return; ch.data.labels = emp.salaryHistory.map(s=>s.date.slice(0,7)); ch.data.datasets[0].data = emp.salaryHistory.map(s=>s.next); ch.update(); }