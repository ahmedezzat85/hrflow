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
function isSalaryWriteAllowed() {
  if (typeof canWriteSalary === 'function') return canWriteSalary();
  return typeof SessionInfo === 'undefined' || SessionInfo.hasPermission('hr.salary.write');
}

function renderSalaryPage(filter=''){
  const f = filter.toLowerCase();
  const canWrite = isSalaryWriteAllowed();
  const btnApply = document.getElementById('btnApplyRaise');
  if (btnApply) btnApply.hidden = !canWrite;

  const totalPayroll = employees.reduce((s,e)=>s+Number(e.salary || (Number(e.externalSalaryUsd || 0) + Number(e.internalSalaryUsd || 0))), 0);
  document.getElementById('statPayroll').textContent = fmtUSD(totalPayroll);
  const allRaises = employees.flatMap(e=>(e.salaryHistory || []).map(h=>({...h, emp:e.name, empId:e.id})));
  const thisYear = String(new Date().getFullYear());
  const thisYearRaises = allRaises.filter(h=>h.date && h.date.startsWith(thisYear));
  document.getElementById('statRaisesYtd').textContent = thisYearRaises.length;
  const ytdSub = document.getElementById('statRaisesYtdSub');
  if (ytdSub) ytdSub.textContent = `since 1 Jan ${thisYear}`;

  const avgPct = thisYearRaises.length ? (thisYearRaises.reduce((s,h)=>s+parseFloat(h.pct || 0),0)/thisYearRaises.length) : 0;
  document.getElementById('statAvgRaise').textContent = (avgPct>=0?'+':'') + avgPct.toFixed(1) + '%';
  const avgSub = document.getElementById('statAvgRaiseSub');
  if (avgSub) {
    if (thisYearRaises.length > 0) {
      avgSub.textContent = `${thisYearRaises.length} raise${thisYearRaises.length === 1 ? '' : 's'} this year`;
    } else {
      const sortedAll = allRaises.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
      if (sortedAll.length > 0 && sortedAll[0].date) {
        const d = new Date(sortedAll[0].date);
        const mStr = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        avgSub.textContent = `last review in ${mStr}`;
      } else {
        avgSub.textContent = 'No raises yet';
      }
    }
  }

  const now = new Date();
  const qEnd = new Date(now); qEnd.setMonth(qEnd.getMonth()+3);
  const upcoming = employees.filter(e=>{ if (!e.nextRaise || isNaN(new Date(e.nextRaise).getTime())) return false; const d=new Date(e.nextRaise); return d>=now && d<=qEnd; });
  document.getElementById('statUpcomingQ').textContent = upcoming.length;
  const upSub = document.getElementById('statUpcomingQSub');
  if (upSub) {
    if (upcoming.length > 0) {
      upSub.textContent = upcoming.slice(0, 2).map(e => e.name).join(', ') + (upcoming.length > 2 ? ` +${upcoming.length - 2} more` : '');
    } else {
      upSub.textContent = 'None scheduled';
    }
  }

  const filteredEmps = employees.filter(e=>e.name.toLowerCase().includes(f) || (e.dept || e.department || '').toLowerCase().includes(f));
  const body = document.getElementById('salaryTableBody');
  body.innerHTML = filteredEmps.map(e=>{
    const last = (e.salaryHistory || []).slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0] || null;
    const ext = Number(e.externalSalaryUsd || 0);
    const intCash = Number(e.internalSalaryUsd || 0);
    const total = ext + intCash;
    const profileHref = Router.hrefFor('a-employee-detail', 'admin').replace(/\/?$/, '') + '/' + encodeURIComponent(e.id);
    const lastStr = last ? `${fmtDateShort(last.date)} · ${last.pct || ''}` : '<span style="color:var(--ink-muted);">No raise yet</span>';
    const nextStr = (e.nextRaise && e.nextRaise !== '—' ? fmtDateShort(e.nextRaise) : '') || '<span style="color:var(--ink-muted);">Not scheduled</span>';
    const actionsHtml = canWrite ? `
      <button type="button" class="btn btn-outline btn-xs" onclick="openRaiseModal('${escapeHtml(e.id)}')">Raise</button>
      <button type="button" class="icon-action" aria-label="Edit pay plan for ${escapeHtml(e.name)}" onclick="openCompPlanModal('${escapeHtml(e.id)}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"></path></svg></button>
    ` : '';

    return `<tr class="salary-row" data-employee-id="${escapeHtml(e.id)}">
      <td class="tname"><div class="avatar">${initials(e.name)}</div><div><a class="salary-emp-link" href="${profileHref}" data-action="open-employee-profile" data-employee-id="${escapeHtml(e.id)}">${escapeHtml(e.name)}</a><div class="hv-sub-line">${escapeHtml(e.dept || e.department || '')}</div></div></td>
      <td class="hv-right" style="font-variant-numeric:tabular-nums;"><span class="comp-val-external">${fmtUSD(ext)}</span></td>
      <td class="hv-right" style="font-variant-numeric:tabular-nums;"><span class="comp-val-internal">${fmtUSD(intCash)}</span></td>
      <td class="hv-right" style="font-variant-numeric:tabular-nums;">${total > 0 ? `<strong style="color:var(--ink-strong);">${fmtUSD(total)}</strong>` : '<span style="color:var(--ink-muted);">Not set</span>'}</td>
      <td>${nextStr}</td>
      <td>${lastStr}</td>
      <td class="hv-right" style="white-space:nowrap;">${actionsHtml}</td>
    </tr>`;
  }).join('') || renderEmptyTableRow(7, f ? `No employees match "${f}".` : 'No employee records found.', 'fa-solid fa-user-slash');

  const histBody = document.getElementById('companyRaiseHistoryBody');
  const yearFilter = document.getElementById('raiseHistoryYearFilter');
  if (yearFilter && yearFilter.options.length <= 1) {
    const years = Array.from(new Set(allRaises.map(h => (h.date || '').slice(0, 4)).filter(Boolean))).sort().reverse();
    years.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      yearFilter.appendChild(opt);
    });
    yearFilter.addEventListener('change', () => renderSalaryPage(document.getElementById('salarySearch').value));
  }
  const selectedYear = yearFilter ? yearFilter.value : '';

  const sortedHist = allRaises.slice().sort((a,b)=>new Date(b.date)-new Date(a.date));
  const filteredHist = selectedYear ? sortedHist.filter(h => h.date && h.date.startsWith(selectedYear)) : sortedHist;

  histBody.innerHTML = filteredHist.map((h, idx) => {
    const olderSameEmp = sortedHist.slice(idx+1).find(o => o.empId === h.empId);
    const prevInternal = olderSameEmp ? Number(olderSameEmp.newInternal || 0) : Number(h.prevInternal || 0);
    const prevExternal = olderSameEmp ? Number(olderSameEmp.newExternal || 0) : Number(h.prevExternal || 0);
    const newInternal = Number(h.newInternal || 0);
    const newExternal = Number(h.newExternal || 0);
    const isStarting = !olderSameEmp && (!h.prevInternal && !h.prevExternal);
    const d = computeRowDeltas(prevInternal, prevExternal, newInternal, newExternal);
    const intSub = isStarting ? 'starting pay' : fmtDelta(d.internalAmt, d.internalPct);
    const extSub = isStarting ? 'starting pay' : fmtDelta(d.externalAmt, d.externalPct);
    const changePill = isStarting
      ? '<span class="badge-pill pill-neutral">Starting pay</span>'
      : `<span class="badge-pill pill-success">${fmtDelta(d.totalAmt, d.totalPct)}</span>`;

    return `<tr>
      <td class="tname"><div class="avatar">${initials(h.emp)}</div><span>${escapeHtml(h.emp)}</span></td>
      <td>${escapeHtml(fmtDateShort(h.date))}</td>
      <td class="hv-right" style="font-variant-numeric:tabular-nums;">${fmtUSD(newInternal)}<div class="hv-sub-line">${intSub}</div></td>
      <td class="hv-right" style="font-variant-numeric:tabular-nums;">${fmtUSD(newExternal)}<div class="hv-sub-line">${extSub}</div></td>
      <td class="hv-right" style="font-variant-numeric:tabular-nums;"><strong style="color:var(--ink-strong);">${fmtUSD(newInternal+newExternal)}</strong></td>
      <td>${changePill}</td>
      <td>${escapeHtml(h.reason || '—')}</td>
    </tr>`;
  }).join('') || renderEmptyTableRow(7, 'No raises recorded yet.', 'fa-solid fa-sack-dollar');

  const histCountEl = document.getElementById('raiseHistoryFooter');
}
document.getElementById('salarySearch').addEventListener('input', e=>renderSalaryPage(e.target.value));
// Overview only: a row click opens the employee's profile, where pay is changed (links and buttons keep their own click handlers)
document.getElementById('salaryTableBody').addEventListener('click', e=>{
  if (e.target.closest('a, button')) return;
  const row = e.target.closest('tr[data-employee-id]');
  if (row) viewProfile(row.dataset.employeeId);
});
function openRaiseModal(empId=null){
  const sel = document.getElementById('rEmpSelect');
  sel.innerHTML = employees.filter(e=>!e.archived).map(e=>`<option value="${e.id}">${escapeHtml(e.name)} — ${e.job_role || e.role}</option>`).join('');
  if(empId) sel.value = empId;
  // Opened for one employee (profile): show the name read-only instead of a dropdown
  const nameField = document.getElementById('rEmpName');
  const fixedEmp = empId ? employees.find(e=>String(e.id)===String(empId)) : null;
  sel.hidden = !!fixedEmp;
  if (nameField) {
    nameField.hidden = !fixedEmp;
    nameField.value = fixedEmp ? `${fixedEmp.name} — ${fixedEmp.job_role || fixedEmp.role || ''}` : '';
  }
  document.getElementById('rNewInternal').value = '';
  document.getElementById('rNewExternal').value = '';
  document.getElementById('rDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('rReason').value = 'Annual performance raise';
  onRaiseEmployeeChange();
  openModal('raiseModal');
}
function onRaiseEmployeeChange(){
  const emp = employees.find(e=>String(e.id)===String(document.getElementById('rEmpSelect').value));
  const intVal = emp ? fmtUSD(emp.internalSalaryUsd || 0) : '—';
  const extVal = emp ? fmtUSD(emp.externalSalaryUsd || 0) : '—';
  const elInt = document.getElementById('rvCurrentInternal');
  if (elInt) { if ('value' in elInt) elInt.value = intVal; elInt.textContent = intVal; }
  const elExt = document.getElementById('rvCurrentExternal');
  if (elExt) { if ('value' in elExt) elExt.value = extVal; elExt.textContent = extVal; }
  const tileInt = document.getElementById('rvCurrentInternalTile');
  if (tileInt) tileInt.textContent = intVal;
  const tileExt = document.getElementById('rvCurrentExternalTile');
  if (tileExt) tileExt.textContent = extVal;
  updateRaisePreview();
}
function updateRaisePreview(){
  const emp = employees.find(e=>String(e.id)===String(document.getElementById('rEmpSelect').value));
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
  const emp = employees.find(e=>String(e.id)===String(document.getElementById('rEmpSelect').value));
  const date = document.getElementById('rDate').value;
  const reason = document.getElementById('rReason').value;
  const internalVal = document.getElementById('rNewInternal').value;
  const externalVal = document.getElementById('rNewExternal').value;
  if (!FinanceForm.validateRequiredFields('raiseModal', [
    { id: 'rEmpSelect', message: 'Select an employee.' },
    { id: 'rNewInternal', message: 'Enter the new internal salary (0 if none).', check: (v) => v !== '' && Number(v) >= 0 },
    { id: 'rNewExternal', message: 'Enter the new external salary (0 if none).', check: (v) => v !== '' && Number(v) >= 0 },
    { id: 'rDate', message: 'Select an effective date.' },
  ])) return;

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
    if (typeof refreshProfileCompensation === 'function') refreshProfileCompensation();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
  finally { setButtonLoading(btn, false); }
}
function updateSalaryChart(){ const emp = employees.find(e=>e.id===window.LOGGED_IN_EMPLOYEE_ID) || currentLoggedInEmployee; const ch = window._charts.salary; if(!ch) return; ch.data.labels = emp.salaryHistory.map(s=>s.date.slice(0,7)); ch.data.datasets[0].data = emp.salaryHistory.map(s=>s.next); ch.update(); }

// ==========================================
// Employee Compensation Plan (FUX-416)
// ==========================================
let currentCompPlanEmpId = null;
let compPlanState = { internal: 0, external: 0, intStart: null, extStart: null, hasPlan: false, earliest: null, touched: false };

function compPlanNum(id) {
  const v = parseFloat(document.getElementById(id)?.value);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
}

function compPlanDayBefore(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  if (isNaN(d.getTime())) return '';
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function openCompPlanModal(empId) {
  if (typeof canWritePayPlan === 'function' && !canWritePayPlan()) return;
  currentCompPlanEmpId = String(empId);
  const emp = employees.find(e => String(e.id) === currentCompPlanEmpId);
  if (!emp) return;

  compPlanState = { internal: 0, external: 0, intStart: null, extStart: null, hasPlan: false, earliest: null, touched: false };
  document.getElementById('compPlanEmpName').textContent = `${emp.name} — ${emp.job_role || emp.role || ''}`;
  document.getElementById('compPlanModalTitle').textContent = `Pay plan · ${emp.name}`;
  document.getElementById('compPlanActiveExternal').textContent = fmtUSD(emp.externalSalaryUsd || 0);
  document.getElementById('compPlanActiveInternal').textContent = fmtUSD(emp.internalSalaryUsd || 0);
  document.getElementById('compPlanTotalBadge').textContent = `${fmtUSD((emp.externalSalaryUsd || 0) + (emp.internalSalaryUsd || 0))} / month`;
  document.getElementById('compPlanNotes').value = '';
  const details = document.getElementById('compPlanHistoryDetails');
  if (details) details.open = false;
  FinanceForm.clearErrors('compensationPlanModal');

  openModal('compensationPlanModal');
  await reloadCompPlanData(currentCompPlanEmpId, true);
}

function onCompPlanInput() {
  compPlanState.touched = true;
  renderCompPlanDeltas();
}

function compPlanDeltaText(cur, next, startDate) {
  if (!compPlanState.hasPlan) return { text: '', cls: '' };
  if (next === cur) return { text: cur > 0 ? 'No change' : '', cls: '' };
  if (next === 0) {
    const end = compPlanDayBefore(startDate);
    return { text: end ? `Ends this part on ${end}` : 'Ends this part', cls: 'fv-delta-down' };
  }
  if (cur === 0) return { text: 'New part', cls: 'fv-delta-up' };
  const diff = Math.round((next - cur) * 100) / 100;
  const pct = (diff / cur) * 100;
  const sign = diff > 0 ? '+' : '−';
  return {
    text: `${sign}${fmtUSD(Math.abs(diff))} (${sign}${Math.abs(pct).toFixed(1)}%)`,
    cls: diff > 0 ? 'fv-delta-up' : 'fv-delta-down',
  };
}

function renderCompPlanDeltas() {
  const intNew = compPlanNum('compPlanInternalAmount');
  const extNew = compPlanNum('compPlanExternalAmount');
  const start = document.getElementById('compPlanStartDate').value;
  const st = compPlanState;

  const setHint = (id, d) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = d.text;
    el.classList.remove('fv-delta-up', 'fv-delta-down');
    if (d.cls) el.classList.add(d.cls);
  };
  setHint('compPlanInternalDelta', compPlanDeltaText(st.internal, intNew, start));
  setHint('compPlanExternalDelta', compPlanDeltaText(st.external, extNew, start));

  const newTotal = Math.round((intNew + extNew) * 100) / 100;
  const curTotal = Math.round((st.internal + st.external) * 100) / 100;
  let totalText = `New total: ${fmtUSD(newTotal)} / month`;
  if (st.hasPlan && curTotal > 0 && newTotal !== curTotal) {
    const diff = Math.round((newTotal - curTotal) * 100) / 100;
    const sign = diff > 0 ? '+' : '−';
    totalText += ` (${sign}${fmtUSD(Math.abs(diff))}, ${sign}${Math.abs((diff / curTotal) * 100).toFixed(1)}%)`;
  }
  document.getElementById('compPlanNewTotal').textContent = totalText;

  // Advisory earliest date: later of the finalized-period lock and the start of any changed active part.
  let earliest = st.earliest || '';
  if (intNew !== st.internal && st.intStart && st.intStart > earliest) earliest = st.intStart;
  if (extNew !== st.external && st.extStart && st.extStart > earliest) earliest = st.extStart;
  document.getElementById('compPlanEarliestHint').textContent = earliest ? `Earliest allowed: ${earliest}` : '';

  const bothZero = intNew === 0 && extNew === 0;
  const err = document.getElementById('compPlanBothZeroError');
  err.style.display = bothZero && (st.hasPlan || st.touched) ? 'block' : 'none';
  const saveBtn = document.getElementById('compPlanSaveBtn');
  if (saveBtn) saveBtn.disabled = bothZero;
}

// Pay history: one row per change, internal and external as columns (D-036).
function renderCompPlanHistory(history) {
  const histTbody = document.getElementById('compPlanHistoryBody');
  const summary = document.getElementById('compPlanHistorySummary');
  if (summary) summary.textContent = `History (${history ? history.length : 0} ${history && history.length === 1 ? 'change' : 'changes'})`;
  if (history && history.length > 0) {
    histTbody.innerHTML = history.map(h => {
      const prevInt = Number(h.previous_internal_usd || 0);
      const prevExt = Number(h.previous_external_usd || 0);
      const newInt = Number(h.new_internal_usd || 0);
      const newExt = Number(h.new_external_usd || 0);
      const d = computeRowDeltas(prevInt, prevExt, newInt, newExt);
      const change = (prevInt + prevExt) > 0
        ? `<span class="badge-pill ${d.totalAmt >= 0 ? 'pill-success' : 'pill-neutral'}">${fmtDelta(d.totalAmt, d.totalPct)}</span>`
        : '<span class="badge-pill pill-neutral">Starting pay</span>';
      return `<tr>
        <td data-label="Effective">${escapeHtml(fmtDateShort(h.date))}</td>
        <td data-label="Internal">${fmtUSD(newInt)}</td>
        <td data-label="External">${fmtUSD(newExt)}</td>
        <td data-label="Total"><strong>${fmtUSD(newInt + newExt)}</strong></td>
        <td data-label="Change">${change}</td>
        <td data-label="Reason">${escapeHtml(h.reason || '—')}</td>
      </tr>`;
    }).join('');
  } else {
    histTbody.innerHTML = renderEmptyTableRow(6, 'No pay changes recorded yet.', 'fa-solid fa-clock');
  }
}

// Keep the in-memory profile history in step with what the server now holds.
function syncEmployeeSalaryHistory(empId, history) {
  const emp = employees.find(e => String(e.id) === String(empId));
  if (!emp) return;
  emp.salaryHistory = (history || []).map(h => ({
    date: h.date,
    prev: Number(h.previous_internal_usd || 0) + Number(h.previous_external_usd || 0),
    next: Number(h.new_internal_usd || 0) + Number(h.new_external_usd || 0),
    pct: h.pct_change || '',
    reason: h.reason || '',
    newInternal: Number(h.new_internal_usd || 0), newExternal: Number(h.new_external_usd || 0),
    prevInternal: Number(h.previous_internal_usd || 0), prevExternal: Number(h.previous_external_usd || 0),
  }));
}

async function reloadCompPlanData(empId, prefill) {
  const histTbody = document.getElementById('compPlanHistoryBody');
  if (!histTbody) return;
  histTbody.innerHTML = renderEmptyTableRow(6, 'Loading history...', 'fa-solid fa-spinner fa-spin');
  try {
    const [plan, history] = await Promise.all([
      FinanceApi.getEmployeeCompensationPlan(empId),
      FinanceApi.getEmployeePayHistory(empId)
    ]);

    const ext = plan && plan.external_usd;
    const intc = plan && plan.internal_usd_cash;
    document.getElementById('compPlanActiveExternal').textContent = fmtUSD(ext ? ext.amount : 0);
    document.getElementById('compPlanExtEffective').textContent = ext ? fmtDateShort(ext.effective_start_date) : '—';
    document.getElementById('compPlanActiveInternal').textContent = fmtUSD(intc ? intc.amount : 0);
    const basisLabel = ((intc && intc.salary_basis) || 'NET').toUpperCase();
    document.getElementById('compPlanIntBasis').textContent = basisLabel === 'GROSS' ? 'Gross' : 'Net';
    document.getElementById('compPlanIntEffective').textContent = intc ? fmtDateShort(intc.effective_start_date) : '—';
    document.getElementById('compPlanTotalBadge').textContent = `${fmtUSD((plan && plan.total_monthly_usd) || 0)} / month`;

    compPlanState = {
      internal: intc ? Number(intc.amount) : 0,
      external: ext ? Number(ext.amount) : 0,
      intStart: intc ? intc.effective_start_date : null,
      extStart: ext ? ext.effective_start_date : null,
      hasPlan: !!(ext || intc),
      earliest: (plan && plan.earliest_effective_date) || null,
      touched: false,
    };

    const emp = employees.find(e => String(e.id) === String(empId));
    document.getElementById('compPlanModalTitle').textContent =
      `${compPlanState.hasPlan ? 'Pay plan' : 'Set up pay plan'} · ${emp ? emp.name : ''}`;
    document.getElementById('compPlanChangeTitle').textContent = compPlanState.hasPlan ? 'Change pay' : 'Set up pay';

    if (prefill) {
      document.getElementById('compPlanInternalAmount').value = compPlanState.internal || '';
      document.getElementById('compPlanExternalAmount').value = compPlanState.external || '';
      document.getElementById('compPlanSalaryBasis').value = intc ? basisLabel : 'NET';
      const today = new Date().toISOString().slice(0, 10);
      document.getElementById('compPlanStartDate').value =
        compPlanState.earliest && compPlanState.earliest > today ? compPlanState.earliest : today;
    }
    syncEmployeeSalaryHistory(empId, history);
    renderCompPlanHistory(history);
    renderCompPlanDeltas();
  } catch (err) {
    console.warn('Failed to load compensation plan details:', err);
    histTbody.innerHTML = renderEmptyTableRow(6, 'Could not load history.', 'fa-solid fa-triangle-exclamation');
  }
}

async function saveCompPlanComponent(evt) {
  const btn = (evt && evt.currentTarget) || document.getElementById('compPlanSaveBtn');
  const internal = compPlanNum('compPlanInternalAmount');
  const external = compPlanNum('compPlanExternalAmount');
  const startDate = document.getElementById('compPlanStartDate').value;

  if (!FinanceForm.validateRequiredFields('compensationPlanModal', [
    { id: 'compPlanStartDate', message: 'Select an effective start date.' },
  ])) return;
  if (internal === 0 && external === 0) {
    FinanceForm.showErrorSummary('compensationPlanModal', [
      { fieldId: 'compPlanInternalAmount', message: 'At least one component must be above 0.' },
    ]);
    return;
  }

  setButtonLoading(btn, true, 'Saving…');
  try {
    const result = await FinanceApi.setEmployeeCompensationPlan(currentCompPlanEmpId, {
      effective_start_date: startDate,
      internal_usd_cash: internal,
      external_usd: external,
      internal_salary_basis: document.getElementById('compPlanSalaryBasis')?.value || 'NET',
      notes: document.getElementById('compPlanNotes').value,
    });
    FinanceForm.clearErrors('compensationPlanModal');
    const changed = (result.changes || []).filter(c => c.action !== 'unchanged');
    toast(changed.length ? 'Pay plan updated.' : 'No changes to save.', 'fa-solid fa-check');

    const emp = employees.find(e => String(e.id) === String(currentCompPlanEmpId));
    if (emp) {
      emp.externalSalaryUsd = result.external_usd ? Number(result.external_usd.amount) : 0;
      emp.internalSalaryUsd = result.internal_usd_cash ? Number(result.internal_usd_cash.amount) : 0;
      emp.salary = (emp.externalSalaryUsd || 0) + (emp.internalSalaryUsd || 0);
    }

    await reloadCompPlanData(currentCompPlanEmpId, true);
    renderSalaryPage(document.getElementById('salarySearch')?.value || '');
    if (typeof refreshProfileCompensation === 'function') refreshProfileCompensation();
  } catch (err) {
    FinanceForm.showErrorSummary('compensationPlanModal', [
      { message: err.message || 'Failed to update the pay plan' },
    ]);
  } finally {
    setButtonLoading(btn, false);
    renderCompPlanDeltas();
  }
}
