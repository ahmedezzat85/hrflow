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
      fillAccountIdentity('admin', { name: adminUser.name, role: adminUser.role || 'HR Administrator' });
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
    empVacationHistory = rawVacHistory.map(v => ({ type: v.type, dates: fmtDateRange(v.start_date, v.end_date), days: v.days, status: v.status }));
    empInsuranceHistory = rawClaims.map(c => ({ category: c.category, provider: c.provider, amount: Number(c.amount), date: c.date, status: c.status, document_url: c.document_url }));
    insuranceCategories = rawCategories;
    insuranceConsumption = rawConsumption;
    fillAccountIdentity('emp', { name: currentLoggedInEmployee.name, role: currentLoggedInEmployee.role, department: currentLoggedInEmployee.department });
    populateClaimCategoryOptions();
    renderEmployeePortal();
    await loadCompanyDocuments();
  } catch (err) { toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}

function renderAdminPortal() {
  const greetEl = document.getElementById('hrDashGreeting');
  if (greetEl) {
    const now = new Date();
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const h = now.getHours();
    const hello = h < 12 ? "Good morning" : (h < 18 ? "Good afternoon" : "Good evening");
    let name = '';
    const myAdminId = typeof SessionInfo !== 'undefined' ? SessionInfo.getEmployeeId() : null;
    const adminUser = (typeof employees !== 'undefined' && Array.isArray(employees))
      ? (employees.find(e => String(e.id) === String(myAdminId)) || employees[0])
      : null;
    if (adminUser && adminUser.name) {
      name = `, ${adminUser.name.split(' ')[0]}`;
    }
    greetEl.innerHTML = `${hello}${name}. Here is <strong class="hv-text-brand">${months[now.getMonth()]} ${now.getFullYear()}</strong> so far`;
  }

  // 1. Headcount: Total active employees
  const activeCount = employees.filter(e => e.status === 'Active').length;
  const onLeaveCount = employees.filter(e => e.status === 'On Leave').length;
  const elEmp = document.getElementById('statEmployees');
  if (elEmp) elEmp.textContent = activeCount;
  const elEmpSub = document.getElementById('statEmployeesSub');
  if (elEmpSub) elEmpSub.textContent = onLeaveCount > 0 ? `${onLeaveCount} more on leave` : 'All staff active';

  // 2. Pending Approvals: Leave/vacation/wfh requests + insurance claims awaiting action
  const pendingRequests = requests.filter(r => r.status === 'Pending').length;
  const pendingClaims = insuranceClaims.filter(c => c.status === 'Pending').length;
  const totalPending = pendingRequests + pendingClaims;
  const elPending = document.getElementById('statPending');
  if (elPending) elPending.textContent = totalPending;
  const elPendingSub = document.getElementById('statPendingSub');
  if (elPendingSub) {
    elPendingSub.textContent = (pendingRequests || pendingClaims)
      ? `${pendingRequests} leave · ${pendingClaims} claim`
      : 'None waiting';
  }
  const elReqBadge = document.getElementById('reqBadge');
  if (elReqBadge) elReqBadge.textContent = totalPending;

  // 3. Currently On Leave
  const elOnLeave = document.getElementById('statOnLeave');
  if (elOnLeave) elOnLeave.textContent = onLeaveCount;
  const elOnLeaveSub = document.getElementById('statOnLeaveSub');
  if (elOnLeaveSub) {
    const onLeaveEmps = employees.filter(e => e.status === 'On Leave');
    elOnLeaveSub.textContent = onLeaveEmps.length
      ? onLeaveEmps.map(e => e.name).join(', ')
      : 'None today';
  }

  // 4. Open Insurance Claims
  const elClaims = document.getElementById('statOpenClaims');
  if (elClaims) elClaims.textContent = pendingClaims;
  const pendingClaimsList = insuranceClaims.filter(c => c.status === 'Pending');
  const pendingAmt = pendingClaimsList.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const elClaimsSub = document.getElementById('statOpenClaimsSub');
  if (elClaimsSub) {
    elClaimsSub.textContent = pendingClaimsList.length
      ? `EGP ${pendingAmt.toLocaleString()} waiting`
      : 'None waiting';
  }

  // 5. Upcoming Annual Raises (sorted by nearest valid nextRaise)
  const raisesList = document.getElementById('upcomingRaisesList');
  if (raisesList) {
    const upcoming = employees
      .filter(e => e.nextRaise && e.nextRaise !== '—' && !isNaN(new Date(e.nextRaise).getTime()))
      .sort((a, b) => new Date(a.nextRaise) - new Date(b.nextRaise))
      .slice(0, 5);
    raisesList.innerHTML = upcoming.length ? upcoming.map(e => {
      const target = new Date(e.nextRaise);
      const diffMs = target.getTime() - Date.now();
      const diffDays = Math.max(0, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      const relStr = diffDays === 0 ? 'today' : `in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
      const isSoon = diffDays <= 60;
      return `
      <li class="hv-raise-item">
        <span class="avatar">${initials(e.name)}</span>
        <span class="txt">
          <strong>${escapeHtml(e.name)}</strong>
          <p>${escapeHtml(e.role || 'Employee')}</p>
        </span>
        <span class="hv-raise-meta">
          <span class="hv-raise-date">${fmtDateShort(e.nextRaise)}</span>
          <span class="hv-raise-rel"${isSoon ? ' style="color:var(--warning);font-weight:600;"' : ''}>${relStr}</span>
        </span>
      </li>`;
    }).join('') : `<li><div class="txt" style="color:var(--ink-muted);font-size:13px;padding:8px 0;">No upcoming raises scheduled.</div></li>`;
  }

  // 6. Pending Requests Queue Preview Table
  const dashBody = document.getElementById('dashPendingBody');
  if (dashBody) {
    const pendingList = requests.filter(r => r.status === 'Pending').slice(0, 5);
    dashBody.innerHTML = pendingList.length ? pendingList.map(r => `
      <tr>
        <td data-label="Employee" class="tname">
          <span class="avatar">${initials(r.employee_name)}</span>
          <span>
            <strong style="font-weight:600;color:var(--ink-strong);">${escapeHtml(r.employee_name)}</strong>
          </span>
        </td>
        <td data-label="Request">${typeof getRequestTypeBadge === 'function' ? getRequestTypeBadge(r.type) : r.type}</td>
        <td data-label="Dates">
          <div style="font-size:12.5px;color:var(--ink-strong);font-weight:500;">
            ${escapeHtml(fmtDateRange(r.startDate || r.start_date || r.date, r.endDate || r.end_date || r.startDate || r.start_date || r.date) || r.dates || '—')}
            ${r.days ? `<div style="font-size:12px;color:var(--ink-muted);font-weight:400;">${r.days} day${r.days === 1 ? '' : 's'}</div>` : ''}
          </div>
        </td>
        <td data-label="Actions" class="col-actions hv-right">
          <button class="btn btn-sm btn-primary" onclick="showSection('a-requests','admin')" title="Review in Pending Requests Queue">
            Review
          </button>
        </td>
      </tr>`).join('') : renderEmptyTableRow(4, 'No pending requests awaiting approval.', 'fa-solid fa-inbox');
  }

  renderEmployeesTable();
  renderRequestsTable('all');
  renderVacationBalances();
  renderInsuranceTable();
  renderCategoriesTable();
  renderAdminInsuranceHighlights();
  renderDashboardInsuranceHighlights();
  renderRequestTypeBars();
  renderSalaryPage();

  try { initCharts(); } catch (e) { console.error('Dashboard charts update error:', e); }
}

function renderRequestTypeBars() {
  const container = document.getElementById('requestTypeBars');
  const summaryEl = document.getElementById('requestTypeSummary');
  if (!container) return;
  const reqList = Array.isArray(requests) ? requests : [];
  const claimList = Array.isArray(insuranceClaims) ? insuranceClaims : [];
  const vacCount = reqList.filter(r => r.type === 'Vacation' || r.type === 'Annual Leave').length;
  const wfhCount = reqList.filter(r => r.type === 'Work From Home' || r.type === 'WFH').length;
  const claimCount = claimList.length + reqList.filter(r => r.type === 'Medical Insurance').length;
  const total = vacCount + wfhCount + claimCount;
  const vacPct = total ? Math.round((vacCount / total) * 100) : 0;
  const wfhPct = total ? Math.round((wfhCount / total) * 100) : 0;
  const claimPct = total ? Math.round((claimCount / total) * 100) : 0;

  container.innerHTML = `
    <div class="hv-req-bar-item">
      <span class="hv-req-bar-meta"><span class="hv-req-bar-label">Vacation</span><span class="hv-req-bar-val">${vacCount} · ${vacPct}%</span></span>
      <span class="hv-req-bar-track"><span class="hv-req-bar-fill hv-bar-teal" style="width:${vacPct}%;"></span></span>
    </div>
    <div class="hv-req-bar-item">
      <span class="hv-req-bar-meta"><span class="hv-req-bar-label">Work from home</span><span class="hv-req-bar-val">${wfhCount} · ${wfhPct}%</span></span>
      <span class="hv-req-bar-track"><span class="hv-req-bar-fill hv-bar-sky" style="width:${wfhPct}%;"></span></span>
    </div>
    <div class="hv-req-bar-item">
      <span class="hv-req-bar-meta"><span class="hv-req-bar-label">Medical claim</span><span class="hv-req-bar-val">${claimCount} · ${claimPct}%</span></span>
      <span class="hv-req-bar-track"><span class="hv-req-bar-fill hv-bar-pink" style="width:${claimPct}%;"></span></span>
    </div>
  `;
  if (summaryEl) {
    const pendingCount = reqList.filter(r => r.status === 'Pending').length + claimList.filter(c => c.status === 'Pending').length;
    summaryEl.textContent = `${total} requests in 6 months · ${pendingCount} waiting for a decision`;
  }
}


function renderEmployeePortal() {
  const emp = employees.find(e => e.id === window.LOGGED_IN_EMPLOYEE_ID) || currentLoggedInEmployee;
  if (!emp) return;

  // Greeting
  const elGreeting = document.getElementById('empDashGreeting');
  if (elGreeting) {
    const firstName = (emp.name || '').split(' ')[0] || 'there';
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    elGreeting.textContent = `${greet}, ${firstName}`;
  }

  const totalMonthlyUsd = (emp.internalSalaryUsd || 0) + (emp.externalSalaryUsd || 0) || emp.salary || 0;
  const elSalary = document.getElementById('empDashSalary');
  if (elSalary) elSalary.textContent = fmtUSD(totalMonthlyUsd);

  const elPkgBase = document.getElementById('empPkgBase');
  if (elPkgBase) elPkgBase.textContent = fmtUSD(totalMonthlyUsd) + ' / mo';
  const elPkgTotal = document.getElementById('empPkgTotal');
  if (elPkgTotal) elPkgTotal.textContent = fmtUSD(totalMonthlyUsd * 12);

  // Next salary raise: real date or an honest empty state
  const elRaise = document.getElementById('empNextRaiseDate');
  const elRaiseNote = document.getElementById('empNextRaiseNote');
  const hasRaise = emp.nextRaise && emp.nextRaise !== '—' && !isNaN(new Date(emp.nextRaise).getTime());
  if (elRaise) elRaise.textContent = hasRaise ? fmtDateShort(emp.nextRaise) : '—';
  if (elRaiseNote) {
    if (hasRaise) {
      const diffMs = new Date(emp.nextRaise) - new Date();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      const inDays = diffDays > 0 ? `in ${diffDays} days` : diffDays === 0 ? 'today' : `${Math.abs(diffDays)} days ago`;
      const prevRaise = (emp.salaryHistory || []).slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
      const prevNote = prevRaise && prevRaise.date ? ` · last raise on ${fmtDateShort(prevRaise.date)}${prevRaise.pct ? ', ' + prevRaise.pct : ''}` : '';
      elRaiseNote.textContent = `${inDays}${prevNote}`;
    } else {
      elRaiseNote.textContent = 'No raise date scheduled yet.';
    }
  }

  // Dynamic Vacation Days Left
  const vacTotal = emp.vacTotal || 21;
  const vacUsed = emp.vacUsed || 0;
  const vacLeft = Math.max(0, vacTotal - vacUsed);
  const elVacDays = document.getElementById('empDashVacDays');
  if (elVacDays) elVacDays.textContent = vacLeft;
  const elVacTotal = document.getElementById('empDashVacTotal');
  if (elVacTotal) elVacTotal.textContent = `of ${vacTotal}`;
  const elVacFoot = document.getElementById('empDashVacUsedFoot');
  if (elVacFoot) elVacFoot.textContent = `${vacUsed} days used in ${new Date().getFullYear()}`;

  // Dynamic WFH Count
  const wfhCount = empVacationHistory.filter(v => v.type === 'Work From Home' || v.type === 'WFH').length;
  const elWfh = document.getElementById('empDashWfh');
  if (elWfh) elWfh.textContent = wfhCount;
  const elWfhFoot = document.getElementById('empDashWfhFoot');
  if (elWfhFoot) {
    const curMonth = new Intl.DateTimeFormat('en-US', { month: 'long' }).format(new Date());
    elWfhFoot.textContent = `days in ${curMonth}`;
  }

  // Dynamic Pending Claims
  const pendingClaims = empInsuranceHistory.filter(c => c.status === 'Pending' || c.status === 'Waiting');
  const pendingClaimsCount = pendingClaims.length;
  const elEmpClaims = document.getElementById('empDashClaims');
  if (elEmpClaims) elEmpClaims.textContent = pendingClaimsCount;
  const elClaimsFoot = document.getElementById('empDashClaimsFoot');
  if (elClaimsFoot) {
    const pendingTotal = pendingClaims.reduce((s, c) => s + (Number(c.amount) || 0), 0);
    elClaimsFoot.textContent = pendingClaimsCount > 0 ? `${fmtMoney(pendingTotal)} waiting` : 'Waiting for review';
  }

  // Timeline entries from real data
  const timeline = document.getElementById('empTimeline');
  if (timeline) {
    const entries = [];
    empVacationHistory.slice(0, 3).forEach(v => {
      const datesStr = (v.startDate && v.endDate ? fmtDateRange(v.startDate, v.endDate) : v.dates || (v.start_date && v.end_date ? fmtDateRange(v.start_date, v.end_date) : v.date || ''));
      entries.push({
        type: 'vacation',
        title: `${escapeHtml(v.type)} · ${v.days} day${v.days === 1 ? '' : 's'}`,
        sub: datesStr,
        status: v.status
      });
    });
    empInsuranceHistory.slice(0, 2).forEach(c => {
      entries.push({
        type: 'insurance',
        title: `${escapeHtml(c.category || 'Medical')} claim · ${fmtMoney(c.amount)}`,
        sub: c.date ? `submitted ${fmtDateShort(c.date)}` : '',
        status: c.status
      });
    });
    if (!entries.length) {
      timeline.innerHTML = '<div style="padding: 16px; color: var(--ink-muted); font-size: 13px;">No recent activity recorded.</div>';
    } else {
      timeline.innerHTML = entries.map(x => {
        const isApp = x.status === 'Approved';
        const isWait = x.status === 'Pending' || x.status === 'Waiting';
        const pillBg = isApp ? '#e3f5ec' : isWait ? '#fdf0e1' : 'var(--fv-surface-soft)';
        const pillColor = isApp ? '#06703f' : isWait ? '#9c5000' : 'var(--ink-muted)';
        const label = isWait ? 'Waiting' : escapeHtml(x.status);
        const iconSvg = x.type === 'insurance'
          ? '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-8-5.2-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 14.8 12 20 12 20z"></path></svg>'
          : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9M12 12v7a2 2 0 0 0 4 0"></path></svg>';
        return `
          <div style="display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--fv-line);">
            <span style="width: 32px; height: 32px; flex: none; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; background: var(--fv-area-teal-bg, #e0f4f1); color: var(--id-teal-ink, #0b7a6d);">${iconSvg}</span>
            <span style="flex: 1; min-width: 0;">
              <span style="display: block; font-weight: 600; color: var(--ink-strong); font-size: 13.5px;">${x.title}</span>
              <span style="font-size: 12px; color: var(--ink-muted);">${x.sub}</span>
            </span>
            <span style="padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; color: ${pillColor}; background: ${pillBg};">${label}</span>
          </div>
        `;
      }).join('');
    }
  }

  // Salary Page KPI cards
  const elSalaryMonthly = document.getElementById('empSalaryMonthly');
  if (elSalaryMonthly) elSalaryMonthly.textContent = fmtUSD(totalMonthlyUsd);
  const elSalaryExternal = document.getElementById('empSalaryExternal');
  if (elSalaryExternal) elSalaryExternal.textContent = fmtUSD(emp.externalSalaryUsd || 0);
  const elSalaryInternal = document.getElementById('empSalaryInternal');
  if (elSalaryInternal) elSalaryInternal.textContent = fmtUSD(emp.internalSalaryUsd || 0);
  const elSalaryNextRaise = document.getElementById('empSalaryNextRaise');
  if (elSalaryNextRaise) elSalaryNextRaise.textContent = hasRaise ? fmtDateShort(emp.nextRaise) : '—';
  const elSalaryNextRaiseSub = document.getElementById('empSalaryNextRaiseSub');
  if (elSalaryNextRaiseSub) {
    if (hasRaise) {
      const diffMs = new Date(emp.nextRaise) - new Date();
      const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      elSalaryNextRaiseSub.textContent = diffDays > 0 ? `in ${diffDays} days` : diffDays === 0 ? 'today' : `${Math.abs(diffDays)} days ago`;
    } else {
      elSalaryNextRaiseSub.textContent = 'None scheduled';
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
      const changePill = d.totalAmt > 0
        ? `<span style="display:inline-flex; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #06703f; background: #e3f5ec; white-space: nowrap;">+${fmtUSD(d.totalAmt)} · ${fmtDelta(0, d.totalPct)}</span>`
        : `<span style="display:inline-flex; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #4b5c92; background: #eef1f8; white-space: nowrap;">Starting pay</span>`;
      return `
        <tr>
          <td data-label="Effective" style="padding: 9px 16px; border-bottom: 1px solid var(--fv-line); font-weight: 600; color: var(--ink-strong);">${s.date}</td>
          <td data-label="Internal USD" style="padding: 9px 12px; border-bottom: 1px solid var(--fv-line); text-align: right; color: var(--ink-body);">${fmtUSD(s.newInternal)}</td>
          <td data-label="External USD" style="padding: 9px 12px; border-bottom: 1px solid var(--fv-line); text-align: right; color: var(--ink-body);">${fmtUSD(s.newExternal)}</td>
          <td data-label="Monthly total" style="padding: 9px 12px; border-bottom: 1px solid var(--fv-line); text-align: right; font-weight: 700; color: var(--ink-strong);">${fmtUSD(s.newInternal + s.newExternal)}</td>
          <td data-label="Change" style="padding: 9px 12px; border-bottom: 1px solid var(--fv-line);">${changePill}</td>
          <td data-label="Reason" style="padding: 9px 16px; border-bottom: 1px solid var(--fv-line); color: var(--ink-body);">${escapeHtml(s.reason)}</td>
        </tr>
      `;
    }).join('') || renderEmptyTableRow(6, 'No raise history yet.', 'fa-solid fa-sack-dollar');
  }
  const vacTbody = document.getElementById('empVacationBody');
  if (vacTbody) {
    vacTbody.innerHTML = empVacationHistory.map(v => {
      const datesStr = (v.startDate && v.endDate ? fmtDateRange(v.startDate, v.endDate) : v.dates || (v.start_date && v.end_date ? fmtDateRange(v.start_date, v.end_date) : v.date || '—'));
      const isWfh = v.type === 'Work from home' || v.type === 'Work From Home' || v.type === 'WFH';
      const dotBg = isWfh ? '#3f98d0' : '#1f9d8e';
      const isApp = v.status === 'Approved';
      const pillBg = isApp ? '#e3f5ec' : 'var(--fv-surface-soft)';
      const pillColor = isApp ? '#06703f' : 'var(--ink-muted)';
      return `
        <tr>
          <td data-label="Type" style="padding: 10px 16px; border-bottom: 1px solid var(--fv-line);">
            <span style="display: inline-flex; align-items: center; gap: 7px; font-weight: 600; color: var(--ink-strong);">
              <span style="width: 8px; height: 8px; border-radius: 3px; display: inline-block; background: ${dotBg};"></span>
              ${escapeHtml(v.type)}
            </span>
          </td>
          <td data-label="Dates" style="padding: 10px 12px; border-bottom: 1px solid var(--fv-line); white-space: nowrap; color: var(--ink-body);">${datesStr}</td>
          <td data-label="Days" style="padding: 10px 12px; border-bottom: 1px solid var(--fv-line); text-align: right; color: var(--ink-strong);">${v.days}</td>
          <td data-label="Status" style="padding: 10px 16px; border-bottom: 1px solid var(--fv-line);">
            <span class="badge" style="display: inline-flex; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: ${pillColor}; background: ${pillBg};">${escapeHtml(v.status)}</span>
          </td>
        </tr>
      `;
    }).join('') || renderEmptyTableRow(4, 'No vacation history yet.', 'fa-solid fa-umbrella-beach');
  }
  
  // Dynamic employee vacation stat cards
  const vacEntitlement = emp.vacTotal || 21;
  const vacRemaining = Math.max(0, vacEntitlement - vacUsed);
  const elEnt = document.getElementById('empStatVacEntitlement');
  const elUsed = document.getElementById('empStatVacUsed');
  const elRem = document.getElementById('empStatVacRemaining');
  const elProgress = document.getElementById('empVacUsedProgress');
  if (elEnt) elEnt.textContent = `${vacEntitlement} days`;
  if (elUsed) elUsed.textContent = `${vacUsed} days`;
  if (elRem) elRem.textContent = `${vacRemaining} days`;
  if (elProgress) {
    const pct = vacEntitlement ? Math.min(Math.round((vacUsed / vacEntitlement) * 100), 100) : 0;
    elProgress.style.width = `${pct}%`;
  }

  const elInsBody = document.getElementById('empInsuranceBody');
  if (elInsBody) {
    elInsBody.innerHTML = empInsuranceHistory.map((c, idx) => `<tr>
      <td data-label="Category" style="padding: 10px 16px; font-weight: 600; color: var(--ink-strong);">${escapeHtml(c.category)}</td>
      <td data-label="Provider" style="padding: 10px 12px; color: var(--ink-muted);">${escapeHtml(c.provider || 'Not given')}</td>
      <td data-label="Date" style="padding: 10px 12px; color: var(--ink-strong);">${escapeHtml(fmtDateShort(c.date))}</td>
      <td data-label="Status" style="padding: 10px 12px;">${statusPill(c.status === 'Pending' ? 'Waiting' : c.status)}</td>
      <td data-label="Amount" style="padding: 10px 12px; text-align: right; font-weight: 700; color: var(--ink-strong);">${fmtMoney(c.amount)}</td>
      <td data-label="Receipt" style="padding: 10px 16px; text-align: right;">${c.document_url ? `<button type="button" class="icon-action" title="View supporting document" data-action="view-own-claim-receipt" data-index="${idx}" aria-label="View receipt" style="width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: var(--ink-muted); display: inline-flex; align-items: center; justify-content: center;"><i class="fa-solid fa-paperclip"></i></button>` : '<span style="color:var(--ink-muted);">—</span>'}</td>
    </tr>`).join('') || renderEmptyTableRow(6, 'No insurance claims yet.', 'fa-solid fa-briefcase-medical');
  }
  renderEmployeeInsuranceHighlights();
}
