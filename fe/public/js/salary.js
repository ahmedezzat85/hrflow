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
  const allRaises = employees.flatMap(e=>(e.salaryHistory || []).map(h=>({...h, emp:e.name, empId:e.id})));
  const thisYearRaises = allRaises.filter(h=>h.date && h.date.startsWith('2026'));
  document.getElementById('statRaisesYtd').textContent = thisYearRaises.length;
  const avgPct = thisYearRaises.length ? (thisYearRaises.reduce((s,h)=>s+parseFloat(h.pct || 0),0)/thisYearRaises.length) : 0;
  document.getElementById('statAvgRaise').textContent = (avgPct>=0?'+':'') + avgPct.toFixed(1) + '%';
  const now = new Date();
  const qEnd = new Date(now); qEnd.setMonth(qEnd.getMonth()+3);
  const upcoming = employees.filter(e=>{ if (!e.nextRaise || isNaN(new Date(e.nextRaise).getTime())) return false; const d=new Date(e.nextRaise); return d>=now && d<=qEnd; });
  document.getElementById('statUpcomingQ').textContent = upcoming.length;
  const body = document.getElementById('salaryTableBody');
  body.innerHTML = employees.filter(e=>e.name.toLowerCase().includes(f) || (e.dept || e.department || '').toLowerCase().includes(f)).map(e=>{
    const last = (e.salaryHistory && e.salaryHistory.length) ? e.salaryHistory[e.salaryHistory.length-1] : null;
    const ext = Number(e.externalSalaryUsd || 0);
    const intCash = Number(e.internalSalaryUsd || 0);
    const total = ext + intCash;
    return `<tr>
      <td class="tname"><div class="avatar">${initials(e.name)}</div>${e.name}</td>
      <td>${e.dept || e.department || '—'}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="comp-val-external">${fmtUSD(ext)}</span>
          <button class="action-btn btn-comp-ext" title="Edit External USD" onclick="openCompPlanModal('${e.id}', 'external_usd')"><i class="fa-solid fa-pen"></i></button>
        </div>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <span class="comp-val-internal">${fmtUSD(intCash)}</span>
          <button class="action-btn btn-comp-int" title="Edit Internal USD Cash" onclick="openCompPlanModal('${e.id}', 'internal_usd_cash')"><i class="fa-solid fa-pen"></i></button>
        </div>
      </td>
      <td><strong>${fmtUSD(total)}</strong></td>
      <td>${e.nextRaise || '—'}</td>
      <td>${last ? `${last.date} (${last.pct || ''})` : '<span style="color:var(--text3);">No history</span>'}</td>
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <button class="btn btn-sm btn-fill" onclick="openRaiseModal('${e.id}')"><i class="fa-solid fa-arrow-trend-up"></i> Raise</button>
          <button class="btn btn-sm btn-comp-plan" onclick="openCompPlanModal('${e.id}')"><i class="fa-solid fa-file-contract"></i> Plan</button>
        </div>
      </td>
    </tr>`;

  }).join('') || renderEmptyTableRow(8, f ? `No employees match "${f}".` : 'No employee records found.', 'fa-solid fa-user-slash');

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
  }).join('') || renderEmptyTableRow(9, 'No raises recorded yet.', 'fa-solid fa-sack-dollar');
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
async function applyRaise(evt){
  const btn = (evt && evt.currentTarget) || document.getElementById('raiseModalSaveBtn') || document.querySelector('#raiseModal .btn-fill');
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

  setButtonLoading(btn, true, 'Applying…');
  try{
    const result = await Api.applyRaise(payload);
    closeModal('raiseModal');
    const pctStr = (result.total_delta_pct>=0?'+':'') + result.total_delta_pct.toFixed(1) + '%';
    toast(`Raise applied to ${emp.name}: ${pctStr} → ${fmtUSD(result.new_internal_salary_usd + result.new_external_salary_usd)}.`);
    await loadAdminData();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
  finally { setButtonLoading(btn, false); }
}
function updateSalaryChart(){ const emp = employees.find(e=>e.id===window.LOGGED_IN_EMPLOYEE_ID) || currentLoggedInEmployee; const ch = window._charts.salary; if(!ch) return; ch.data.labels = emp.salaryHistory.map(s=>s.date.slice(0,7)); ch.data.datasets[0].data = emp.salaryHistory.map(s=>s.next); ch.update(); }

// ==========================================
// Employee Compensation Plan (FUX-416)
// ==========================================
let currentCompPlanEmpId = null;

async function openCompPlanModal(empId, preselectType = null) {
  currentCompPlanEmpId = String(empId);
  const emp = employees.find(e => String(e.id) === currentCompPlanEmpId);
  if (!emp) return;

  document.getElementById('compPlanEmpName').textContent = `${emp.name} — ${emp.job_role || emp.role || ''}`;
  document.getElementById('compPlanActiveExternal').textContent = fmtUSD(emp.externalSalaryUsd || 0);
  document.getElementById('compPlanActiveInternal').textContent = fmtUSD(emp.internalSalaryUsd || 0);
  document.getElementById('compPlanTotalBadge').textContent = `${fmtUSD((emp.externalSalaryUsd || 0) + (emp.internalSalaryUsd || 0))} / month`;

  const typeSelect = document.getElementById('compPlanComponentType');
  if (preselectType) {
    typeSelect.value = preselectType;
  }
  onCompPlanTypeChange();

  const today = new Date().toISOString().slice(0, 10);
  document.getElementById('compPlanStartDate').value = today;
  document.getElementById('compPlanNotes').value = '';

  openModal('compensationPlanModal');

  await reloadCompPlanData(currentCompPlanEmpId);
}


function onCompPlanTypeChange() {
  const type = document.getElementById('compPlanComponentType').value;
  const emp = employees.find(e => String(e.id) === currentCompPlanEmpId);
  const amtInput = document.getElementById('compPlanAmount');
  const basisContainer = document.getElementById('compPlanSalaryBasisContainer');
  if (basisContainer) {
    basisContainer.style.display = type === 'internal_usd_cash' ? 'block' : 'none';
  }
  if (emp) {
    if (type === 'external_usd') {
      amtInput.value = emp.externalSalaryUsd || '';
    } else {
      amtInput.value = emp.internalSalaryUsd || '';
    }
  }
}

async function reloadCompPlanData(empId) {
  const histTbody = document.getElementById('compPlanHistoryBody');
  if (!histTbody) return;
  histTbody.innerHTML = renderEmptyTableRow(7, 'Loading history...', 'fa-solid fa-spinner fa-spin');
  try {
    const [plan, history] = await Promise.all([
      FinanceApi.getEmployeeCompensationPlan(empId),
      FinanceApi.getEmployeeCompensationPlanHistory(empId)
    ]);

    if (plan) {
      if (plan.external_usd) {
        document.getElementById('compPlanActiveExternal').textContent = fmtUSD(plan.external_usd.amount);
        document.getElementById('compPlanExtEffective').textContent = `Effective: ${plan.external_usd.effective_start_date}`;
      } else {
        document.getElementById('compPlanActiveExternal').textContent = '$0.00';
        document.getElementById('compPlanExtEffective').textContent = 'No active plan';
      }

      if (plan.internal_usd_cash) {
        const basisLabel = (plan.internal_usd_cash.salary_basis || 'NET').toUpperCase();
        document.getElementById('compPlanActiveInternal').textContent = `${fmtUSD(plan.internal_usd_cash.amount)} (${basisLabel})`;
        document.getElementById('compPlanIntEffective').textContent = `Effective: ${plan.internal_usd_cash.effective_start_date}`;
        const basisSelect = document.getElementById('compPlanSalaryBasis');
        if (basisSelect) basisSelect.value = basisLabel;
      } else {
        document.getElementById('compPlanActiveInternal').textContent = '$0.00';
        document.getElementById('compPlanIntEffective').textContent = 'No active plan';
      }

      document.getElementById('compPlanTotalBadge').textContent = `${fmtUSD(plan.total_monthly_usd || 0)} / month`;
    }

    if (history && history.length > 0) {
      histTbody.innerHTML = history.map(h => {
        const isExternal = h.component_type === 'external_usd';
        const typeBadge = isExternal
          ? '<span class="badge-pill pill-primary"><i class="fa-solid fa-building-columns"></i> External USD</span>'
          : '<span class="badge-pill pill-success"><i class="fa-solid fa-money-bill-wave"></i> Internal USD Cash</span>';
        const statusBadge = !h.effective_end_date
          ? '<span class="badge-pill pill-success">Active</span>'
          : '<span class="badge-pill pill-neutral">Closed</span>';
        const basisText = isExternal ? 'NET' : (h.salary_basis || 'NET');
        return `<tr>
          <td>${typeBadge}</td>
          <td><span class="badge-pill pill-neutral">${basisText}</span></td>
          <td><strong>${fmtUSD(h.amount)}</strong></td>
          <td>${h.effective_start_date}</td>
          <td>${h.effective_end_date || '—'}</td>
          <td>${statusBadge}</td>
          <td>${h.notes || '—'}</td>
        </tr>`;
      }).join('');
    } else {
      histTbody.innerHTML = renderEmptyTableRow(7, 'No compensation history recorded yet.', 'fa-solid fa-clock');
    }
  } catch (err) {
    console.warn('Failed to load compensation plan details:', err);
    histTbody.innerHTML = renderEmptyTableRow(7, 'Could not load history.', 'fa-solid fa-triangle-exclamation');
  }
}

async function saveCompPlanComponent(evt) {
  const btn = (evt && evt.currentTarget) || document.getElementById('compPlanSaveBtn');
  const type = document.getElementById('compPlanComponentType').value;
  const amountVal = document.getElementById('compPlanAmount').value;
  const startDate = document.getElementById('compPlanStartDate').value;
  const notes = document.getElementById('compPlanNotes').value;
  const salaryBasis = type === 'internal_usd_cash' ? (document.getElementById('compPlanSalaryBasis')?.value || 'NET') : 'NET';

  if (!amountVal || Number(amountVal) <= 0) {
    toast('Please specify a valid amount greater than 0.', 'fa-solid fa-triangle-exclamation');
    return;
  }
  if (!startDate) {
    toast('Please specify an effective start date.', 'fa-solid fa-triangle-exclamation');
    return;
  }

  setButtonLoading(btn, true, 'Saving…');
  try {
    const payload = {
      amount: Number(amountVal),
      effective_start_date: startDate,
      notes: notes
    };
    if (type === 'internal_usd_cash') {
      payload.salary_basis = salaryBasis;
    }

    await FinanceApi.setEmployeeCompensationPlanComponent(currentCompPlanEmpId, type, payload);

    toast('Compensation component updated successfully.', 'fa-solid fa-check');

    const emp = employees.find(e => String(e.id) === String(currentCompPlanEmpId));
    if (emp) {
      if (type === 'external_usd') emp.externalSalaryUsd = Number(amountVal);
      if (type === 'internal_usd_cash') emp.internalSalaryUsd = Number(amountVal);
      emp.salary = (emp.externalSalaryUsd || 0) + (emp.internalSalaryUsd || 0);
    }

    await reloadCompPlanData(currentCompPlanEmpId);
    renderSalaryPage(document.getElementById('salarySearch')?.value || '');
  } catch (err) {
    toast(err.message || 'Failed to update component', 'fa-solid fa-triangle-exclamation');
  } finally {
    setButtonLoading(btn, false);
  }
}