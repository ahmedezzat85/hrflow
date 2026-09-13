async function handleLoginSuccess(data){
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('loginThemeToggle').style.display = 'none';
  document.getElementById('loginErr').style.display = 'none';
  showAppLoader('Signing you in', 'Loading your HR workspace...');
  try{
    if(data.role === 'admin' || data.role === 'system_admin'){
      currentPortal = 'admin';
      document.getElementById('admin-app').classList.add('active');
      if (typeof updateFinanceNavVisibility === 'function') updateFinanceNavVisibility();
      await loadAdminData();
    } else {
      currentPortal = 'employee';
      document.getElementById('employee-app').classList.add('active');
      if (typeof updateFinanceNavVisibility === 'function') updateFinanceNavVisibility();
      await loadEmployeeData();
    }
  } catch(err){
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    try { initCharts(); } catch(chartErr){ console.error('Chart init failed:', chartErr); }
    hideAppLoader();
  }
}

function handleLoginError(err){
  hideAppLoader();
  const errBox = document.getElementById('loginErr');
  if(errBox){
    errBox.style.display = 'flex';
    const span = errBox.querySelector('span');
    if(span) span.textContent = err.message || 'Sign-in failed. Please try again.';
  }
}

function initMockAdminData(){
  const today = new Date();
  const getPastDate = (monthsAgo, day = 15) => {
    const d = new Date(today.getFullYear(), today.getMonth() - monthsAgo, day);
    return d.toISOString().slice(0, 10);
  };
  const getFutureDate = (daysAhead) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + daysAhead);
    return d.toISOString().slice(0, 10);
  };

  employees = [
    { id: 'EMP001', name: 'Sarah Connor', email: 'sarah@voyance.com', role: 'Engineering Lead', department: 'Engineering', dept: 'Engineering', status: 'Active', hireDate: '2023-01-15', salary: 12500, phone: '+1 555-0101', nextRaise: getFutureDate(45), salaryHistory: [{ date: '2023-01-15', salary: 11000 }, { date: '2024-01-15', salary: 12500 }] },
    { id: 'EMP002', name: 'John Doe', email: 'john@voyance.com', role: 'Product Designer', department: 'Design', dept: 'Design', status: 'Active', hireDate: '2023-04-10', salary: 9800, phone: '+1 555-0102', nextRaise: getFutureDate(75), salaryHistory: [] },
    { id: 'EMP003', name: 'Alex Rivera', email: 'alex@voyance.com', role: 'QA Analyst', department: 'Engineering', dept: 'Engineering', status: 'Active', hireDate: '2023-08-01', salary: 8200, phone: '+1 555-0103', nextRaise: getFutureDate(110), salaryHistory: [] },
    { id: 'EMP004', name: 'Elena Rostova', email: 'elena@voyance.com', role: 'Operations Manager', department: 'Operations', dept: 'Operations', status: 'Active', hireDate: '2022-11-20', salary: 11500, phone: '+1 555-0104', salaryHistory: [] },
    { id: 'EMP005', name: 'Marcus Vance', email: 'marcus@voyance.com', role: 'Frontend Engineer', department: 'Engineering', dept: 'Engineering', status: 'On Leave', hireDate: '2024-02-01', salary: 9000, phone: '+1 555-0105', salaryHistory: [] }
  ];

  requests = [
    { id: 'REQ-101', employee_id: 'EMP001', employee_name: 'Sarah Connor', type: 'Vacation', status: 'Approved', date: getPastDate(0, 5), startDate: getPastDate(0, 2), endDate: getFutureDate(3), days: 5 },
    { id: 'REQ-102', employee_id: 'EMP002', employee_name: 'John Doe', type: 'Work From Home', status: 'Pending', date: getPastDate(0, 8), startDate: getFutureDate(1), endDate: getFutureDate(2), days: 2 },
    { id: 'REQ-103', employee_id: 'EMP003', employee_name: 'Alex Rivera', type: 'Vacation', status: 'Pending', date: getPastDate(0, 10), startDate: getFutureDate(5), endDate: getFutureDate(10), days: 5 },
    { id: 'REQ-104', employee_id: 'EMP004', employee_name: 'Elena Rostova', type: 'WFH', status: 'Approved', date: getPastDate(1, 12), days: 1 },
    { id: 'REQ-105', employee_id: 'EMP001', employee_name: 'Sarah Connor', type: 'Vacation', status: 'Approved', date: getPastDate(2, 14), days: 3 },
    { id: 'REQ-106', employee_id: 'EMP002', employee_name: 'John Doe', type: 'Vacation', status: 'Approved', date: getPastDate(3, 20), days: 4 },
    { id: 'REQ-107', employee_id: 'EMP005', employee_name: 'Marcus Vance', type: 'WFH', status: 'Approved', date: getPastDate(4, 18), days: 2 },
    { id: 'REQ-108', employee_id: 'EMP003', employee_name: 'Alex Rivera', type: 'Vacation', status: 'Approved', date: getPastDate(5, 22), days: 2 }
  ];

  insuranceClaims = [
    { id: 'CLM-201', employee_id: 'EMP001', employee_name: 'Sarah Connor', service: 'Dental Routine Checkup', category: 'Dental', amount: 180, status: 'Pending', date: getPastDate(0, 7) },
    { id: 'CLM-202', employee_id: 'EMP004', employee_name: 'Elena Rostova', service: 'Optical Exam & Glasses', category: 'Optical', amount: 350, status: 'Approved', date: getPastDate(1, 15) },
    { id: 'CLM-203', employee_id: 'EMP002', employee_name: 'John Doe', service: 'Physiotherapy', category: 'Physical Therapy', amount: 240, status: 'Approved', date: getPastDate(3, 10) }
  ];

  const adminUser = employees[0];
  const avatarEl = document.getElementById('adminUserAvatar');
  if (avatarEl) avatarEl.textContent = getInitials(adminUser.name);
  const nameEl = document.getElementById('adminUserName');
  if (nameEl) nameEl.textContent = adminUser.name;
  const roleEl = document.getElementById('adminUserRole');
  if (roleEl) roleEl.textContent = adminUser.role;

  renderAdminPortal();
  initCharts();
}

function initMockEmployeeData(){
  const today = new Date();
  const getPastDate = (monthsAgo, day = 15) => {
    const d = new Date(today.getFullYear(), today.getMonth() - monthsAgo, day);
    return d.toISOString().slice(0, 10);
  };

  currentLoggedInEmployee = {
    id: 'EMP001',
    name: 'Sarah Connor',
    email: 'sarah@voyance.com',
    role: 'Engineering Lead',
    department: 'Engineering',
    status: 'Active',
    hireDate: '2023-01-15',
    salary: 12500,
    phone: '+1 555-0101',
    annualLeaveBalance: 16,
    annualLeaveTotal: 21,
    salaryHistory: [
      { date: '2023-01-15', salary: 11000 },
      { date: '2023-07-01', salary: 11800 },
      { date: '2024-01-15', salary: 12500 }
    ]
  };
  window.LOGGED_IN_EMPLOYEE_ID = currentLoggedInEmployee.id;

  empVacationHistory = [
    { id: 'REQ-101', type: 'Vacation', status: 'Approved', startDate: getPastDate(0, 2), endDate: getPastDate(0, -3), days: 5 },
    { id: 'REQ-105', type: 'Vacation', status: 'Approved', startDate: getPastDate(2, 14), endDate: getPastDate(2, 17), days: 3 }
  ];

  empInsuranceHistory = [
    { id: 'CLM-201', category: 'Dental', service: 'Dental Routine Checkup', amount: 180, status: 'Pending', date: getPastDate(0, 7) }
  ];

  const avatarEl = document.getElementById('empUserAvatar');
  if (avatarEl) avatarEl.textContent = getInitials(currentLoggedInEmployee.name);
  const nameEl = document.getElementById('empUserName');
  if (nameEl) nameEl.textContent = currentLoggedInEmployee.name;
  const roleEl = document.getElementById('empUserRole');
  if (roleEl) roleEl.textContent = currentLoggedInEmployee.role;

  renderEmployeePortal();
  initCharts();
}

// On page load, the session itself lives only in an HttpOnly cookie set
// by the backend (see be/main.py: /api/auth/google, /api/auth/logout).
// The frontend never stores or reads the token directly - it just asks
// the backend "who am I?" via /api/auth/me, which succeeds if the
// browser's cookie is still valid and fails (401) otherwise. This
// replaces the previous localStorage + manually-mirrored-cookie flow
// (see docs/analysis/security-analysis-plan.md, Phase 1 - SEC-04).
async function bootstrapAppFromSession(){
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('mock') === 'admin') {
    SessionInfo.set({ role: 'admin', employee_id: 1, name: 'Sarah Connor' });
    hideAppLoader();
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('loginThemeToggle').style.display = 'none';
    document.getElementById('admin-app').classList.add('active');
    currentPortal = 'admin';
    initMockAdminData();
    if (typeof updateFinanceNavVisibility === 'function') updateFinanceNavVisibility();
    return;
  } else if (urlParams.get('mock') === 'employee') {
    SessionInfo.set({ role: 'employee', employee_id: 2, name: 'John Doe' });
    hideAppLoader();
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('loginThemeToggle').style.display = 'none';
    document.getElementById('employee-app').classList.add('active');
    currentPortal = 'employee';
    initMockEmployeeData();
    if (typeof updateFinanceNavVisibility === 'function') updateFinanceNavVisibility();
    return;
  }

  showAppLoader('Reconnecting to HRFlow', 'Loading your data...');
  const session = await Api.restoreSession();
  if(!session){
    hideAppLoader();
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('loginThemeToggle').style.display = 'flex';
    initGoogleSignIn('googleSignInButton', handleLoginSuccess, handleLoginError);
    return;
  }
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('loginThemeToggle').style.display = 'none';
  document.getElementById('loginErr').style.display = 'none';
  try{
    if(session.role === 'admin' || session.role === 'system_admin'){
      currentPortal = 'admin';
      document.getElementById('admin-app').classList.add('active');
      if (typeof updateFinanceNavVisibility === 'function') updateFinanceNavVisibility();
      await loadAdminData();
    } else {
      currentPortal = 'employee';
      document.getElementById('employee-app').classList.add('active');
      if (typeof updateFinanceNavVisibility === 'function') updateFinanceNavVisibility();
      await loadEmployeeData();
    }
  } catch(err){
    toast(err.message, 'fa-solid fa-triangle-exclamation');
    await Api.logout();
    document.getElementById('admin-app').classList.remove('active');
    document.getElementById('employee-app').classList.remove('active');
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('loginThemeToggle').style.display = 'flex';
    initGoogleSignIn('googleSignInButton', handleLoginSuccess, handleLoginError);
    hideAppLoader();
    return;
  }
  try { initCharts(); } catch(chartErr){ console.error('Chart init failed:', chartErr); }
  hideAppLoader();
}

window.addEventListener('DOMContentLoaded', () => { applySavedSidebarCollapse(); bootstrapAppFromSession(); });

async function logout(){
  await Api.logout();
  employees = []; requests = []; insuranceClaims = []; empVacationHistory = []; empInsuranceHistory = []; currentLoggedInEmployee = null;
  insuranceCategories = []; insuranceConsumption = [];
  document.getElementById('admin-app').classList.remove('active');
  document.getElementById('employee-app').classList.remove('active');
  hideAppLoader();
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('loginThemeToggle').style.display = 'flex';
  document.getElementById('loginErr').style.display = 'none';
}

// Listens for the 'hrflow:session-expired' event dispatched by
// forceSessionExpiredLogout() in api.js when an authenticated request
// comes back 401. Since the session lives in an HttpOnly cookie (not
// localStorage), there is nothing for this handler to clear directly -
// the backend's /api/auth/logout (called by Api.logout() elsewhere, or
// simply the expired cookie itself) is what actually invalidates the
// session. This handler's job is purely to reset in-memory state and
// return the user to the Sign-In screen without a hard reload.
window.addEventListener('hrflow:session-expired', (e) => {
  e.preventDefault();
  employees = []; requests = []; insuranceClaims = []; empVacationHistory = []; empInsuranceHistory = []; currentLoggedInEmployee = null;
  insuranceCategories = []; insuranceConsumption = [];
  document.getElementById('admin-app').classList.remove('active');
  document.getElementById('employee-app').classList.remove('active');
  hideAppLoader();
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('loginThemeToggle').style.display = 'flex';
  document.getElementById('loginErr').style.display = 'none';
  toast('Your session expired. Please sign in again.', 'fa-solid fa-triangle-exclamation');
  initGoogleSignIn('googleSignInButton', handleLoginSuccess, handleLoginError);
});
