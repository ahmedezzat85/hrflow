function normalizeEmployee(e, salaryHistoryForEmp){
  return { ...e, role: e.job_role, join: e.join_date, vacTotal: Number(e.vac_total), vacUsed: Number(e.vac_used),
    nextRaise: e.next_raise, salary: Number(e.salary),
    salaryHistory: (salaryHistoryForEmp || []).map(h=>({ date: h.date, prev: Number(h.previous_salary), next: Number(h.new_salary), pct: h.pct_change, reason: h.reason })) };
}
function normalizeRequest(r){ return { ...r, emp: r.employee_name }; }
function normalizeClaim(c){ return { ...c, emp: c.employee_name }; }

async function loadAdminData(){
  showTableSkeleton('employeesTableBody', 8, 5);
  showSectionLoadingBar('empTableLoadingBar');
  try{
    const [rawEmployees, rawRequests, rawClaims, rawSalaryHistory, rawCategories, rawConsumption] = await Promise.all([
      Api.getEmployees(), Api.getRequests(), Api.getInsuranceClaims(), Api.getSalaryHistory(), Api.getInsuranceCategories(), Api.getInsuranceConsumption()
    ]);
    allSalaryHistory = rawSalaryHistory;
    employees = rawEmployees.map(e => normalizeEmployee(e, rawSalaryHistory.filter(h=>String(h.employee_id)===String(e.id))));
    requests = rawRequests.map(normalizeRequest);
    insuranceClaims = rawClaims.map(normalizeClaim);
    insuranceCategories = rawCategories;
    insuranceConsumption = rawConsumption;
    const myAdminId = TokenStore.getEmployeeId();
    const adminUser = employees.find(e => String(e.id) === String(myAdminId)) || employees.find(e => e.role && e.role.toLowerCase().includes('admin')) || employees[0];
    if(adminUser){
      document.getElementById('adminUserAvatar').textContent = getInitials(adminUser.name);
      document.getElementById('adminUserName').textContent = adminUser.name;
      document.getElementById('adminUserRole').textContent = adminUser.role || 'HR Administrator';
    }
    renderAdminPortal();
    await loadCompanyDocuments();
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
  hideSectionLoadingBar('empTableLoadingBar');
}
async function loadEmployeeData(){
  try{
    const myId = TokenStore.getEmployeeId();
    const [rawEmployees, rawSalaryHistory, rawVacHistory, rawClaims, rawCategories, rawConsumption] = await Promise.all([
      Api.getEmployees(), Api.getSalaryHistory(myId), Api.getVacationHistory(), Api.getInsuranceClaims(), Api.getInsuranceCategories(), Api.getInsuranceConsumption()
    ]);
    employees = rawEmployees.map(e => normalizeEmployee(e, rawSalaryHistory.filter(h=>String(h.employee_id)===String(e.id))));
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
  } catch(err){ toast(err.message, 'fa-solid fa-triangle-exclamation'); }
}

function renderAdminPortal(){
  document.getElementById('statEmployees').textContent = 248;
  const pendingCount = requests.filter(r=>r.status==='Pending').length;
  document.getElementById('statPending').textContent = pendingCount;
  document.getElementById('reqBadge').textContent = pendingCount;
  const raisesList = document.getElementById('upcomingRaisesList');
  raisesList.innerHTML = employees.slice().sort((a,b)=>new Date(a.nextRaise)-new Date(b.nextRaise)).slice(0,5).map(e=>`<li><div class="ic" style="background:var(--accent-soft);color:var(--accent);"><i class="fa-solid fa-arrow-trend-up"></i></div><div class="txt"><strong>${e.name}</strong><p>${e.role} • Raise due ${e.nextRaise}</p></div></li>`).join('');
  const dashBody = document.getElementById('dashPendingBody');
  dashBody.innerHTML = requests.filter(r=>r.status==='Pending').slice(0,5).map(r=>`<tr><td class="tname"><div class="avatar">${initials(r.employee_name)}</div>${r.employee_name}</td><td>${r.type}</td><td>${r.date}</td><td>${statusPill(r.status)}</td><td><button class="icon-action" onclick="showSection('a-requests','admin')"><i class="fa-solid fa-arrow-right"></i></button></td></tr>`).join('');
  renderEmployeesTable(); renderRequestsTable('all'); renderVacationBalances(); renderInsuranceTable(); renderCategoriesTable(); renderAdminInsuranceHighlights(); renderDashboardInsuranceHighlights(); renderSalaryPage();
}

function renderEmployeePortal(){
  const emp = employees.find(e=>e.id===window.LOGGED_IN_EMPLOYEE_ID) || currentLoggedInEmployee;
  document.getElementById('empDashSalary').textContent = fmtMoney(emp.salary);
  document.getElementById('empPkgBase').textContent = fmtMoney(emp.salary) + ' / mo';
  document.getElementById('empPkgTotal').textContent = fmtMoney(emp.salary*12 + Math.round(emp.salary*1.5));
  const timeline = document.getElementById('empTimeline');
  timeline.innerHTML = [
    {ic:'fa-solid fa-umbrella-beach',c:'accent',t:'Vacation request submitted',d:'Aug 10 - Aug 14 • Pending approval'},
    {ic:'fa-solid fa-briefcase-medical',c:'warning',t:'Medical insurance claim',d:'Pending review'},
    {ic:'fa-solid fa-sack-dollar',c:'success',t:'Annual raise applied',d: emp.salaryHistory.length ? `${emp.salaryHistory[emp.salaryHistory.length-1].pct} • ${emp.salaryHistory[emp.salaryHistory.length-1].date}` : 'No raises yet'},
    {ic:'fa-solid fa-house-laptop',c:'info',t:'Work from home approved',d:'May 20 - May 21, 2026'},
  ].map(x=>`<li><div class="ic" style="background:var(--${x.c==='accent'?'accent-soft':'surface2'});color:var(--${x.c});"><i class="${x.ic}"></i></div><div class="txt"><strong>${x.t}</strong><p>${x.d}</p></div></li>`).join('');
  document.getElementById('salaryHistoryBody').innerHTML = emp.salaryHistory.slice().reverse().map(s=>`<tr><td>${s.date}</td><td>${fmtMoney(s.prev)}</td><td>${fmtMoney(s.next)}</td><td><span class="badge-pill pill-success">${s.pct}</span></td><td>${s.reason}</td></tr>`).join('') || `<tr><td colspan="5"><div class="empty-state"><i class="fa-solid fa-sack-dollar"></i><p>No raise history yet.</p></div></td></tr>`;
  document.getElementById('empVacationBody').innerHTML = empVacationHistory.map(v=>`<tr><td>${v.type}</td><td>${v.dates}</td><td>${v.days}</td><td>${statusPill(v.status)}</td></tr>`).join('');
  document.getElementById('empInsuranceBody').innerHTML = empInsuranceHistory.map(c=>`<tr><td>${c.category}</td><td>${c.provider}</td><td>${fmtMoney(c.amount)}</td><td>${c.date}</td><td>${statusPill(c.status)}</td><td>${c.document_url ? `<a href="${c.document_url}" target="_blank" class="icon-action" style="display:inline-flex;" title="View supporting document"><i class="fa-solid fa-paperclip"></i></a>` : '<span style="color:var(--text3);">—</span>'}</td></tr>`).join('');
  renderEmployeeInsuranceHighlights();
}
