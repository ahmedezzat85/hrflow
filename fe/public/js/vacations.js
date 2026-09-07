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

  const totalAllotted = employees.reduce((s, e) => s + (e.vacTotal || 0), 0);
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
  if (elUsedPct) elUsedPct.innerHTML = `<i class="fa-solid fa-chart-pie"></i> ${usedPct}% consumed`;
  if (elOnLeave) elOnLeave.textContent = onLeaveCount;
  if (elDashOnLeave) elDashOnLeave.textContent = onLeaveCount;

  let filtered = employees;
  if (vacationBalanceSearchQuery) {
    filtered = employees.filter(e => 
      (e.name && e.name.toLowerCase().includes(vacationBalanceSearchQuery)) ||
      (e.dept && e.dept.toLowerCase().includes(vacationBalanceSearchQuery)) ||
      (e.role && e.role.toLowerCase().includes(vacationBalanceSearchQuery))
    );
  }

  if (!filtered.length) {
    body.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-user-xmark"></i><p>No employee balances match "${vacationBalanceSearchQuery}".</p></div></td></tr>`;
    return;
  }

  body.innerHTML = filtered.map(e => {
    const total = e.vacTotal || 0;
    const used = e.vacUsed || 0;
    const remaining = total - used;
    const pct = total ? Math.round((used / total) * 100) : 0;
    const progClass = pct > 85 ? 'progress-danger' : (pct > 60 ? 'progress-warning' : 'progress-accent');

    return `
      <tr>
        <td class="tname">
          <div class="avatar">${initials(e.name)}</div>
          <div>
            <div class="vac-emp-link" onclick="viewProfile(${e.id})">${e.name}</div>
            <div style="font-size:11.5px;color:var(--text2);margin-top:1px;">${e.role || 'Employee'}</div>
          </div>
        </td>
        <td>
          <span class="badge-pill pill-neutral">${e.dept || 'General'}</span>
        </td>
        <td style="font-weight:600;font-variant-numeric:tabular-nums;">${total}</td>
        <td style="color:var(--warning);font-weight:600;font-variant-numeric:tabular-nums;">${used}</td>
        <td style="color:${remaining <= 0 ? 'var(--danger)' : 'var(--success)'};font-weight:700;font-variant-numeric:tabular-nums;">${remaining}</td>
        <td style="min-width:180px;">
          <div class="vac-progress-cell">
            <div class="progress-bar ${progClass}">
              <span style="width:${Math.min(pct, 100)}%;"></span>
            </div>
            <span class="vac-progress-pct">${pct}%</span>
          </div>
        </td>
      </tr>
    `;
  }).join('');
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

  if (!start) {
    toast('Please select a start date.', 'fa-solid fa-triangle-exclamation');
    return;
  }

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
