/**
 * vacations.js — Vacation balances, utilization tracking & time off request workflow
 */

let vacationBalanceSearchQuery = '';

function filterVacationBalances() {
  const searchInput = document.getElementById('vacBalanceSearch');
  vacationBalanceSearchQuery = searchInput ? searchInput.value.trim().toLowerCase() : '';
  renderVacationBalances();
}

function renderVacationBalances() {
  const body = document.getElementById('vacationBalanceBody');
  if (!body) return;

  const totalAllotted = employees.reduce((s, e) => s + (e.vacTotal || 21), 0);
  const totalUsed = employees.reduce((s, e) => s + (e.vacUsed || 0), 0);
  const usedPct = totalAllotted ? Math.round((totalUsed / totalAllotted) * 100) : 0;
  const onLeaveCount = employees.filter(e => e.status === 'On Leave').length;

  const elAllotted = document.getElementById('statVacAllotted');
  const elUsed = document.getElementById('statVacUsed');
  const elUsedPct = document.getElementById('statVacUsedPct');
  const elOnLeave = document.getElementById('statEmployeesOnLeave');
  const elDashOnLeave = document.getElementById('statOnLeave');

  if (elAllotted) elAllotted.textContent = totalAllotted.toLocaleString();
  if (elUsed) elUsed.textContent = totalUsed.toLocaleString();
  if (elUsedPct) elUsedPct.textContent = `· ${usedPct}%`;
  const elUsedBar = document.getElementById('statVacUsedBar');
  if (elUsedBar) elUsedBar.style.width = `${Math.min(usedPct, 100)}%`;

  const elAllottedSub = document.getElementById('statVacAllottedSub');
  if (elAllottedSub) {
    const avgDays = employees.length ? Math.round(totalAllotted / employees.length) : 21;
    elAllottedSub.textContent = `${employees.length} employees · ${avgDays} days each`;
  }

  if (elOnLeave) elOnLeave.textContent = onLeaveCount;
  if (elDashOnLeave) elDashOnLeave.textContent = onLeaveCount;
  const elOnLeaveSub = document.getElementById('statEmployeesOnLeaveSub');
  if (elOnLeaveSub) {
    const onLeaveEmps = employees.filter(e => e.status === 'On Leave');
    const waitingReqs = (typeof requests !== 'undefined' && Array.isArray(requests)) ? requests.filter(r => r.status === 'Pending').length : 0;
    if (onLeaveEmps.length > 0) {
      elOnLeaveSub.textContent = `${onLeaveEmps.map(e => e.name).join(', ')}${waitingReqs ? ` · ${waitingReqs} request${waitingReqs === 1 ? '' : 's'} waiting` : ''}`;
    } else {
      elOnLeaveSub.textContent = 'None on leave';
    }
  }

  const deptFilter = document.getElementById('vacDeptFilter');
  if (deptFilter && deptFilter.options.length <= 1) {
    const depts = Array.from(new Set(employees.map(e => e.dept || e.department).filter(Boolean))).sort();
    depts.forEach(d => {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = d;
      deptFilter.appendChild(opt);
    });
  }
  const selectedDept = deptFilter ? deptFilter.value : '';

  let filtered = employees;
  if (selectedDept) {
    filtered = filtered.filter(e => (e.dept || e.department) === selectedDept);
  }
  if (vacationBalanceSearchQuery) {
    filtered = filtered.filter(e => 
      (e.name && e.name.toLowerCase().includes(vacationBalanceSearchQuery)) ||
      ((e.dept || e.department) && (e.dept || e.department).toLowerCase().includes(vacationBalanceSearchQuery)) ||
      ((e.job_role || e.role) && (e.job_role || e.role).toLowerCase().includes(vacationBalanceSearchQuery))
    );
  }

  if (!filtered.length) {
    body.innerHTML = renderEmptyTableRow(6, vacationBalanceSearchQuery ? `No employee balances match "${vacationBalanceSearchQuery}".` : 'No employee vacation balances recorded yet.', 'fa-solid fa-user-xmark');
    return;
  }

  body.innerHTML = filtered.map(e => {
    const total = e.vacTotal || 21;
    const used = e.vacUsed || 0;
    const remaining = total - used;
    const pct = total ? Math.round((used / total) * 100) : 0;
    const onLeaveBadge = e.status === 'On Leave'
      ? `<span class="badge-pill pill-info" style="margin-left:6px;font-size:11px;">On leave today</span>`
      : '';
    const roleDept = [e.job_role || e.role, e.dept || e.department].filter(Boolean).join(' · ');

    return `
      <tr>
        <td class="tname">
          <div class="avatar">${initials(e.name)}</div>
          <div>
            <div style="display:flex;align-items:center;gap:6px;">
              <span class="vac-emp-link" onclick="viewProfile('${escapeHtml(e.id)}')">${escapeHtml(e.name)}</span>
              ${onLeaveBadge}
            </div>
            <div class="hv-sub-line">${escapeHtml(roleDept)}</div>
          </div>
        </td>
        <td class="hv-right" style="font-weight:600;font-variant-numeric:tabular-nums;">${total}</td>
        <td class="hv-right" style="font-weight:600;font-variant-numeric:tabular-nums;">${used}</td>
        <td class="hv-right" style="font-weight:700;font-variant-numeric:tabular-nums;color:var(--ink-strong);">${remaining}</td>
        <td style="width:240px;">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="flex:1;height:6px;border-radius:999px;background:var(--surface2);overflow:hidden;">
              <div style="height:6px;border-radius:999px;background:var(--id-teal);width:${Math.min(pct, 100)}%;"></div>
            </div>
            <span style="width:34px;font-size:12.5px;color:var(--ink-label);text-align:right;">${pct}%</span>
          </div>
        </td>
        <td class="hv-right" style="white-space:nowrap;">
          <button type="button" class="btn btn-outline btn-xs" onclick="openBehalfVacationModal('${escapeHtml(e.id)}')">Record leave</button>
          <button type="button" class="icon-action" aria-label="Open profile of ${escapeHtml(e.name)}" onclick="viewProfile('${escapeHtml(e.id)}')"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle></svg></button>
        </td>
      </tr>
    `;
  }).join('');

  const countEl = document.getElementById('vacTableFootCount');
  if (countEl) countEl.textContent = `Showing 1–${filtered.length} of ${filtered.length} employees`;
}

function calculateVacationDays(start, end, durationType) {
  if (!start) return 0;
  if (durationType === 'Half Day') return 0.5;
  const s = new Date(start);
  const e = new Date(end || start);
  const diffTime = e - s;
  if (diffTime < 0) return 0;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
}

function onVacationDatesChange() {
  const startEl = document.getElementById('vacStart');
  const endEl = document.getElementById('vacEnd');
  const durEl = document.getElementById('vacDuration');
  const badgeEl = document.getElementById('vacComputedDays');

  if (!startEl || !endEl || !durEl || !badgeEl) return;

  const start = startEl.value;
  let end = endEl.value;
  const durationType = durEl.value;

  if (start && end && new Date(end) < new Date(start)) {
    endEl.value = start;
    end = start;
  }

  const days = calculateVacationDays(start, end, durationType);
  badgeEl.textContent = days === 1 ? '1 day' : `${days} days`;
}

async function submitVacation() {
  const type = document.getElementById('vacType').value;
  const startEl = document.getElementById('vacStart');
  const endEl = document.getElementById('vacEnd');
  const durEl = document.getElementById('vacDuration');
  const reasonEl = document.getElementById('vacReason');
  const btn = document.getElementById('btnSubmitVacation');

  const start = startEl ? startEl.value : '';
  const end = endEl ? endEl.value : '';
  const durationType = durEl ? durEl.value : 'Full Day(s)';
  const reason = reasonEl ? reasonEl.value.trim() : '';

  if (!FinanceForm.validateRequiredFields('empVacationForm', [{ id: 'vacStart', message: 'Select a start date.' }])) return;

  const computedDays = calculateVacationDays(start, end, durationType);
  if (computedDays <= 0) {
    toast('End date cannot be earlier than start date.', 'fa-solid fa-triangle-exclamation');
    return;
  }

  if (btn) setButtonLoading(btn, true, 'Submitting...');

  try {
    const payload = {
      employee_name: currentLoggedInEmployee ? currentLoggedInEmployee.name : '',
      leave_type: reason ? `${type} (${reason})` : type,
      start_date: start,
      end_date: end || start,
      days: computedDays
    };

    await Api.requestVacation(payload);
    toast('Vacation request submitted for approval.', 'fa-solid fa-circle-check');

    // Reset inputs
    if (startEl) startEl.value = '';
    if (endEl) endEl.value = '';
    if (reasonEl) reasonEl.value = '';
    const badgeEl = document.getElementById('vacComputedDays');
    if (badgeEl) badgeEl.textContent = '0 days';

    await loadEmployeeData();
  } catch (err) {
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    if (btn) setButtonLoading(btn, false);
  }
}
