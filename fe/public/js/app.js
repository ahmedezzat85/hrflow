function normalizeEmployee(e, salaryHistoryForEmp) {
  return {
    ...e, role: e.job_role, join: e.join_date, vacTotal: Number(e.vac_total), vacUsed: Number(e.vac_used),
    nextRaise: e.next_raise, salary: Number(e.salary),
    internalSalaryUsd: Number(e.internal_salary_usd || 0), externalSalaryUsd: Number(e.external_salary_usd || 0),
    salaryHistory: (salaryHistoryForEmp || []).map(h => ({
      date: h.date, prev: Number(h.previous_salary), next: Number(h.new_salary), pct: h.pct_change, reason: h.reason,
      newInternal: Number(h.new_internal_usd || 0), newExternal: Number(h.new_external_usd || 0),
      prevInternal: Number(h.previous_internal_usd || 0), prevExternal: Number(h.previous_external_usd || 0),
    }))
  };
}
function normalizeRequest(r) { return { ...r, emp: r.employee_name || r.Employee_Name || '' }; }
function normalizeClaim(c) {
  return {
    ...c,
    category: c.category || c.Category || c.name || '',
    amount: Number(c.amount !== undefined ? c.amount : (c.Amount || 0)),
    date: c.date || c.Date || '',
    status: c.status || c.Status || 'Pending',
    emp: c.employee_name || c.Employee_Name || '',
    employee_name: c.employee_name || c.Employee_Name || '',
    employee_id: c.employee_id || c.Employee_Id || c.employeeId
  };
}

async function loadAdminData() {
  showTableSkeleton('employeesTableBody', 8, 5);
  showSectionLoadingBar('empTableLoadingBar');
  try {
    const [rawEmployees, rawRequests, rawClaims, rawSalaryHistory, rawCategories, rawConsumption] = await Promise.all([
      Api.getEmployees(), Api.getRequests(), Api.getInsuranceClaims(), Api.getSalaryHistory(), Api.getInsuranceCategories(), Api.getInsuranceConsumption()
    ]);
    allSalaryHistory = rawSalaryHistory;
    employees = rawEmployees.map(e => normalizeEmployee(e, rawSalaryHistory.filter(h => String(h.employee_id) === String(e.id))));
    requests = rawRequests.map(normalizeRequest);
    insuranceClaims = rawClaims.map(normalizeClaim);
    insuranceCategories = rawCategories;
    insuranceConsumption = rawConsumption;
    const myAdminId = SessionInfo.getEmployeeId();
    const adminUser = employees.find(e => String(e.id) === String(myAdminId)) || employees.find(e => e.role && e.role.toLowerCase().includes('admin')) || employees[0];
    if (adminUser) {
      document.getElementById('adminUserAvatar').textContent = getInitials(adminUser.name);
      document.getElementById('adminUserName').textContent = adminUser.name;
      document.getElementById('adminUserRole').textContent = adminUser.role || 'HR Administrator';
    }
    renderAdminPortal();
    await loadCompanyDocuments();
  } catch (err) { toast(err.message, 'fa-solid fa-triangle-exclamation'); }
  hideSectionLoadingBar('empTableLoadingBar');
}
async function loadEmployeeData() {
  try {
    const myId = SessionInfo.getEmployeeId();
    const [rawEmployees, rawSalaryHistory, rawVacHistory, rawClaims, rawCategories, rawConsumption] = await Promise.all([
      Api.getEmployees(), Api.getSalaryHistory(myId), Api.getVacationHistory(), Api.getInsuranceClaims(), Api.getInsuranceCategories(), Api.getInsuranceConsumption()
    ]);
    employees = rawEmployees.map(e => normalizeEmployee(e, rawSalaryHistory.filter(h => String(h.employee_id) === String(e.id))));
    currentLoggedInEmployee = employees.find(e => String(e.id) === String(myId)) || employees[0];
    window.LOGGED_IN_EMPLOYEE_ID = currentLoggedInEmployee.id;
    empVacationHistory = rawVacHistory.map(v => ({ type: v.type, dates: `${v.start_date} to ${v.end_date}`, days: v.days, status: v.status }));
    empInsuranceHistory = rawClaims.map(c => ({ category: c.category, provider: c.provider, amount: Number(c.amount), date: c.date, status: c.status, document_url: c.document_url }));
    insuranceCategories = rawCategories;
    insuranceConsumption = rawConsumption;
    document.getElementById('empUserAvatar').textContent = getInitials(currentLoggedInEmployee.name);
    document.getElementById('empUserName').textContent = currentLoggedInEmployee.name;
    document.getElementById('empUserRole').textContent = currentLoggedInEmployee.role;
    populateClaimCategoryOptions();
    renderEmployeePortal();
    await loadCompanyDocuments();
  } catch (err) { toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}

function renderAdminPortal() {
  // 1. Headcount: Total active employees
  const activeCount = employees.filter(e => e.status === 'Active').length;
  const elEmp = document.getElementById('statEmployees');
  if (elEmp) elEmp.textContent = activeCount;

  // 2. Pending Approvals: Leave/vacation/wfh requests + insurance claims awaiting action
  const pendingRequests = requests.filter(r => r.status === 'Pending').length;
  const pendingClaims = insuranceClaims.filter(c => c.status === 'Pending').length;
  const totalPending = pendingRequests + pendingClaims;
  const elPending = document.getElementById('statPending');
  if (elPending) elPending.textContent = totalPending;
  const elReqBadge = document.getElementById('reqBadge');
  if (elReqBadge) elReqBadge.textContent = totalPending;

  // 3. Currently On Leave
  const onLeaveCount = employees.filter(e => e.status === 'On Leave').length;
  const elOnLeave = document.getElementById('statOnLeave');
  if (elOnLeave) elOnLeave.textContent = onLeaveCount;

  // 4. Open Insurance Claims
  const elClaims = document.getElementById('statOpenClaims');
  if (elClaims) elClaims.textContent = pendingClaims;

  // 5. Upcoming Annual Raises (sorted by nearest valid nextRaise)
  const raisesList = document.getElementById('upcomingRaisesList');
  if (raisesList) {
    const upcoming = employees
      .filter(e => e.nextRaise && e.nextRaise !== '—' && !isNaN(new Date(e.nextRaise).getTime()))
      .sort((a, b) => new Date(a.nextRaise) - new Date(b.nextRaise))
      .slice(0, 5);
    raisesList.innerHTML = upcoming.length ? upcoming.map(e => `
      <li>
        <div class="ic" style="background:var(--accent-soft);color:var(--accent);"><i class="fa-solid fa-arrow-trend-up"></i></div>
        <div class="txt">
          <strong>${e.name}</strong>
          <p>${e.role || 'Employee'} • Raise due ${fmtDateShort(e.nextRaise)}</p>
        </div>
      </li>`).join('') : `<li><div class="txt" style="color:var(--text2);font-size:13px;padding:8px 0;">No upcoming raises scheduled.</div></li>`;
  }

  // 6. Pending Requests Queue Preview Table
  const dashBody = document.getElementById('dashPendingBody');
  if (dashBody) {
    const pendingList = requests.filter(r => r.status === 'Pending').slice(0, 5);
    dashBody.innerHTML = pendingList.length ? pendingList.map(r => `
      <tr>
        <td data-label="Employee" class="tname">
          <div class="avatar">${initials(r.employee_name)}</div>
          <div>
            <div style="font-weight:600;color:var(--text);">${r.employee_name}</div>
          </div>
        </td>
        <td data-label="Type">${typeof getRequestTypeBadge === 'function' ? getRequestTypeBadge(r.type) : r.type}</td>
        <td data-label="Date">
          <div style="font-size:12.5px;color:var(--text2);display:inline-flex;align-items:center;gap:6px;">
            <i class="fa-regular fa-calendar" style="color:var(--text3);"></i> ${r.date || '—'}
          </div>
        </td>
        <td data-label="Status">${statusPill(r.status)}</td>
        <td data-label="Actions" class="col-actions">
          <button class="btn btn-sm btn-outline" onclick="showSection('a-requests','admin')" title="Review in Pending Requests Queue">
            Review <i class="fa-solid fa-arrow-right"></i>
          </button>
        </td>
      </tr>`).join('') : renderEmptyTableRow(5, 'No pending requests awaiting approval.', 'fa-solid fa-inbox');
  }

  renderEmployeesTable();
  renderRequestsTable('all');
  renderVacationBalances();
  renderInsuranceTable();
  renderCategoriesTable();
  renderAdminInsuranceHighlights();
  renderDashboardInsuranceHighlights();
  renderSalaryPage();

  try { initCharts(); } catch (e) { console.error('Dashboard charts update error:', e); }
}

function renderEmployeePortal() {
  const emp = employees.find(e => e.id === window.LOGGED_IN_EMPLOYEE_ID) || currentLoggedInEmployee;
  if (!emp) return;

  const totalMonthlyUsd = (emp.internalSalaryUsd || 0) + (emp.externalSalaryUsd || 0) || emp.salary || 0;
  const elSalary = document.getElementById('empDashSalary');
  if (elSalary) elSalary.textContent = fmtUSD(totalMonthlyUsd);

  const elPkgBase = document.getElementById('empPkgBase');
  if (elPkgBase) elPkgBase.textContent = fmtUSD(totalMonthlyUsd) + ' / mo';
  const elPkgTotal = document.getElementById('empPkgTotal');
  if (elPkgTotal) elPkgTotal.textContent = fmtUSD(totalMonthlyUsd * 12);

  // Dynamic Vacation Days Left
  const vacLeft = Math.max(0, (emp.vacTotal || 21) - (emp.vacUsed || 0));
  const elVacDays = document.getElementById('empDashVacDays');
  if (elVacDays) elVacDays.textContent = vacLeft;

  // Dynamic WFH Count
  const wfhCount = empVacationHistory.filter(v => v.type === 'Work From Home' || v.type === 'WFH').length;
  const elWfh = document.getElementById('empDashWfh');
  if (elWfh) elWfh.textContent = wfhCount;

  // Dynamic Pending Claims
  const pendingClaimsCount = empInsuranceHistory.filter(c => c.status === 'Pending').length;
  const elEmpClaims = document.getElementById('empDashClaims');
  if (elEmpClaims) elEmpClaims.textContent = pendingClaimsCount;

  // Timeline entries from real data
  const timeline = document.getElementById('empTimeline');
  if (timeline) {
    const entries = [];
    empVacationHistory.slice(0, 3).forEach(v => {
      entries.push({
        ic: 'fa-solid fa-umbrella-beach',
        c: 'accent',
        t: `${v.type} (${v.status})`,
        d: `${v.dates} • ${v.days} days`
      });
    });
    empInsuranceHistory.slice(0, 2).forEach(c => {
      entries.push({
        ic: 'fa-solid fa-briefcase-medical',
        c: 'warning',
        t: `Medical Claim: ${c.category}`,
        d: `${fmtMoney(c.amount)} • ${c.status}`
      });
    });
    if (!entries.length) {
      timeline.innerHTML = `<li><div class="txt" style="color:var(--text2);font-size:13px;padding:8px 0;">No recent activity recorded.</div></li>`;
    } else {
      timeline.innerHTML = entries.map(x => `
        <li>
          <div class="ic" style="background:var(--${x.c === 'accent' ? 'accent-soft' : 'surface2'});color:var(--${x.c});"><i class="${x.ic}"></i></div>
          <div class="txt"><strong>${x.t}</strong><p>${x.d}</p></div>
        </li>`).join('');
    }
  }

  const histSorted = (emp.salaryHistory || []).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const salBody = document.getElementById('salaryHistoryBody');
  if (salBody) {
    salBody.innerHTML = histSorted.map((s, idx) => {
      const older = histSorted[idx + 1];
      const prevInternal = older ? older.newInternal : (s.prevInternal || 0);
      const prevExternal = older ? older.newExternal : (s.prevExternal || 0);
      const d = computeRowDeltas(prevInternal, prevExternal, s.newInternal, s.newExternal);
      return `<tr><td data-label="Effective Date">${s.date}</td><td data-label="Internal">${fmtUSD(s.newInternal)}</td><td data-label="External">${fmtUSD(s.newExternal)}</td><td data-label="Total">${fmtUSD(s.newInternal + s.newExternal)}</td><td data-label="Internal Δ">${fmtDelta(d.internalAmt, d.internalPct)}</td><td data-label="External Δ">${fmtDelta(d.externalAmt, d.externalPct)}</td><td data-label="Total Δ"><span class="badge-pill pill-success">${fmtDelta(d.totalAmt, d.totalPct)}</span></td><td data-label="Reason">${s.reason}</td></tr>`;
    }).join('') || renderEmptyTableRow(8, 'No raise history yet.', 'fa-solid fa-sack-dollar');
  }
  document.getElementById('empVacationBody').innerHTML = empVacationHistory.map(v => `<tr><td data-label="Type">${v.type}</td><td data-label="Dates">${v.dates}</td><td data-label="Days">${v.days}</td><td data-label="Status">${statusPill(v.status)}</td></tr>`).join('') || renderEmptyTableRow(4, 'No vacation history yet.', 'fa-solid fa-umbrella-beach');
  
  // Dynamic employee vacation stat cards
  const vacEntitlement = emp.vacTotal || 21;
  const vacUsed = emp.vacUsed || 0;
  const vacRemaining = Math.max(0, vacEntitlement - vacUsed);
  const elEnt = document.getElementById('empStatVacEntitlement');
  const elUsed = document.getElementById('empStatVacUsed');
  const elRem = document.getElementById('empStatVacRemaining');
  const elTrend = document.getElementById('empStatVacUsedTrend');
  if (elEnt) elEnt.textContent = `${vacEntitlement} days`;
  if (elUsed) elUsed.textContent = `${vacUsed} days`;
  if (elRem) elRem.textContent = `${vacRemaining} days`;
  if (elTrend) {
    const pct = vacEntitlement ? Math.round((vacUsed / vacEntitlement) * 100) : 0;
    elTrend.innerHTML = `<i class="fa-solid fa-hourglass-half"></i> ${pct}% of quota`;
  }

  document.getElementById('empInsuranceBody').innerHTML = empInsuranceHistory.map(c => `<tr><td data-label="Category">${c.category}</td><td data-label="Provider">${c.provider}</td><td data-label="Amount">${fmtMoney(c.amount)}</td><td data-label="Date">${c.date}</td><td data-label="Status">${statusPill(c.status)}</td><td data-label="Document">${c.document_url ? `<a href="${c.document_url}" target="_blank" class="icon-action" style="display:inline-flex;" title="View supporting document"><i class="fa-solid fa-paperclip"></i></a>` : '<span style="color:var(--text3);">—</span>'}</td></tr>`).join('') || renderEmptyTableRow(6, 'No insurance claims yet.', 'fa-solid fa-briefcase-medical');
  renderEmployeeInsuranceHighlights();
}
