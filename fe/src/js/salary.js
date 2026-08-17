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
  document.getElementById('rTarget').value = 'both';
  document.getElementById('rMode').value='pct';
  document.getElementById('rValue').value='';
  document.getElementById('rInternalValue').value='';
  document.getElementById('rExternalValue').value='';
  document.getElementById('rDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('rReason').value='Annual performance raise';
  onRaiseTargetChange();
  document.getElementById('raisePreview').classList.remove('show');
  document.getElementById('raiseModal').classList.add('active');
}
function onRaiseEmployeeChange(){ updateRaisePreview(); }

// Whether the current (target, mode) combination requires the two
// separate internal_value/external_value inputs instead of the single
// `value` input - mirrors be/routers/salary.py::_validate_raise_payload.
function raiseNeedsSplitValues(){
  return document.getElementById('rTarget').value === 'both' && document.getElementById('rMode').value === 'new';
}

function onRaiseModeChange(){
  const mode = document.getElementById('rMode').value;
  const label = document.getElementById('rValueLabel');
  label.textContent = mode==='pct' ? 'Percentage (%)' : (mode==='amount' ? 'Increase Amount (USD)' : 'New Salary (USD)');
  updateRaiseFieldVisibility();
  updateRaisePreview();
}
function onRaiseTargetChange(){
  updateRaiseFieldVisibility();
  updateRaisePreview();
}
function updateRaiseFieldVisibility(){
  const splitMode = raiseNeedsSplitValues();
  document.getElementById('rValueField').style.display = splitMode ? 'none' : '';
  document.getElementById('rInternalValueField').style.display = splitMode ? '' : 'none';
  document.getElementById('rExternalValueField').style.display = splitMode ? '' : 'none';
}

function applyModeToComponent(current, mode, value){
  if(mode==='pct') return Math.round((current * (1 + value/100)) * 100) / 100;
  if(mode==='amount') return Math.round((current + value) * 100) / 100;
  return Math.round(value * 100) / 100; // mode === 'new'
}

// Computes { newInternal, newExternal } for the current modal state,
// mirroring be/routers/salary.py::apply_raise exactly - same rule per
// (target, mode) combination, including the target=both+mode=new case
// requiring two explicit values with the total always derived.
function computeRaiseResult(emp, target, mode, value, internalValue, externalValue){
  let newInternal, newExternal;
  if(target === 'both' && mode === 'new'){
    newInternal = internalValue;
    newExternal = externalValue;
  } else if(target === 'both'){
    newInternal = applyModeToComponent(emp.internalSalary, mode, value);
    newExternal = applyModeToComponent(emp.externalSalary, mode, value);
  } else if(target === 'internal'){
    newInternal = applyModeToComponent(emp.internalSalary, mode, value);
    newExternal = emp.externalSalary;
  } else { // target === 'external'
    newInternal = emp.internalSalary;
    newExternal = applyModeToComponent(emp.externalSalary, mode, value);
  }
  return { newInternal, newExternal };
}

function updateRaisePreview(){
  const empId = Number(document.getElementById('rEmpSelect').value);
  const emp = employees.find(e=>e.id===empId);
  const target = document.getElementById('rTarget').value;
  const mode = document.getElementById('rMode').value;
  const splitMode = raiseNeedsSplitValues();
  const value = Number(document.getElementById('rValue').value);
  const internalValue = Number(document.getElementById('rInternalValue').value);
  const externalValue = Number(document.getElementById('rExternalValue').value);
  const preview = document.getElementById('raisePreview');

  const hasRequiredInput = splitMode
    ? (document.getElementById('rInternalValue').value !== '' && document.getElementById('rExternalValue').value !== '')
    : document.getElementById('rValue').value !== '';

  if(!emp || !hasRequiredInput){ preview.classList.remove('show'); return; }

  const { newInternal, newExternal } = computeRaiseResult(emp, target, mode, value, internalValue, externalValue);
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
  const target = document.getElementById('rTarget').value;
  const mode = document.getElementById('rMode').value;
  const date = document.getElementById('rDate').value;
  const reason = document.getElementById('rReason').value;
  const splitMode = raiseNeedsSplitValues();

  if(!emp || !date){ toast('Please complete all fields.','fa-solid fa-triangle-exclamation'); return; }

  const payload = { employee_id: empId, mode, target, effective_date: date, reason };
  if(splitMode){
    const internalValueStr = document.getElementById('rInternalValue').value;
    const externalValueStr = document.getElementById('rExternalValue').value;
    if(internalValueStr === '' || externalValueStr === ''){
      toast('Please enter both the new Internal and new External salary (0 is allowed).','fa-solid fa-triangle-exclamation');
      return;
    }
    payload.internal_value = Number(internalValueStr);
    payload.external_value = Number(externalValueStr);
  } else {
    const valueStr = document.getElementById('rValue').value;
    if(valueStr === ''){ toast('Please enter a value.','fa-solid fa-triangle-exclamation'); return; }
    payload.value = Number(valueStr);
  }

  try{
    const result = await Api.applyRaise(payload);
    closeModal('raiseModal');
    const pctStr = (result.pct_change>=0?'+':'') + result.pct_change.toFixed(1);
    toast(`Raise applied to ${emp.name}: ${pctStr}% (total ${fmtMoney(result.new_salary)}).`);
    await loadAdminData();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}
function updateSalaryChart(){ const emp = employees.find(e=>e.id===window.LOGGED_IN_EMPLOYEE_ID) || currentLoggedInEmployee; const ch = window._charts.salary; if(!ch) return; ch.data.labels = emp.salaryHistory.map(s=>s.date.slice(0,7)); ch.data.datasets[0].data = emp.salaryHistory.map(s=>s.next); ch.update(); }