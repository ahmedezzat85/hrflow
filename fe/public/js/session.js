const MOCK_PERMISSIONS_HR = [
  "hr.employee.read", "hr.employee.write",
  "hr.salary.read", "hr.salary.write",
  "hr.employee_bank_account.read", "hr.employee_bank_account.write", "hr.employee_bank_account.reveal",
  "hr.employee_document.read", "hr.employee_document.write",
  "hr.company_document.read", "hr.company_document.write",
  "hr.salary_payment_doc.read", "hr.salary_payment_doc.write",
  "hr.vacation.read", "hr.vacation.write",
  "hr.request.read", "hr.request.write",
  "hr.insurance.read", "hr.insurance.write",
  "hr.export.run",
];

const MOCK_PERMISSIONS_FINANCE = [
  "finance.customer.read", "finance.customer.write",
  "finance.invoice.read", "finance.invoice.write",
  "finance.vendor.read", "finance.vendor.write",
  "finance.vendor_payment.manage", "finance.vendor_payment.verify", "finance.vendor_payment.reveal",
  "finance.bill.read", "finance.bill.write",
  "finance.subscription.read", "finance.subscription.write",
  "finance.statutory.read", "finance.statutory.write",
  "finance.account.read", "finance.account.write",
  "finance.bank_account.reveal", "finance.adjustment.manage",
  "finance.report.read",
  "finance.settings.read", "finance.settings.write",
  "finance.payroll.read", "finance.payroll.approve", "finance.payroll.pay",
  "finance.payroll_tax.read", "finance.payroll_tax.write",
];

const MOCK_PERMISSIONS_PAYROLL = [
  "finance.payroll.read",
  "finance.payroll.prepare",
];

const MOCK_PERMISSIONS_EMPLOYEE = [
  "self.profile.read",
  "self.payslip.read",
  "self.requests.read", "self.requests.write",
  "self.salary.read",
  "self.vacation.read", "self.vacation.write",
  "self.claim.read", "self.claim.write",
  "self.bank_account.read",
  "self.document.read", "self.document.write",
  "hr.company_document.read",
];

const MOCK_PERMISSIONS_ALL = [
  "system.users.manage", "system.roles.manage", "system.audit.read",
  ...MOCK_PERMISSIONS_HR,
  ...MOCK_PERMISSIONS_EMPLOYEE.filter(k => !MOCK_PERMISSIONS_HR.includes(k)),
  ...MOCK_PERMISSIONS_FINANCE,
  "finance.payroll.prepare",
];

async function handleLoginSuccess(data){
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('loginThemeToggle').style.display = 'none';
  document.getElementById('loginErr').style.display = 'none';
  showAppLoader('Signing you in', 'Loading your HR workspace...');
  try{
    const portal = data.portal || 'employee';
    if(portal === 'admin'){
      currentPortal = 'admin';
      document.getElementById('admin-app').classList.add('active');
      if (window.AdminNav && typeof window.AdminNav.syncModuleVisibility === 'function') window.AdminNav.syncModuleVisibility();
      if (typeof updateFinanceNavVisibility === 'function') updateFinanceNavVisibility();
      await loadAdminData();
    } else {
      currentPortal = 'employee';
      document.getElementById('employee-app').classList.add('active');
      if (window.AdminNav && typeof window.AdminNav.syncModuleVisibility === 'function') window.AdminNav.syncModuleVisibility();
      if (typeof updateFinanceNavVisibility === 'function') updateFinanceNavVisibility();
      await loadEmployeeData();
    }
  } catch(err){
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  } finally {
    try { initCharts(); } catch(chartErr){ console.error('Chart init failed:', chartErr); }
    hideAppLoader();
    if (window.Router) Router.boot();
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
  fillAccountIdentity('admin', { name: adminUser.name, role: adminUser.role });

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
  fillAccountIdentity('emp', { name: currentLoggedInEmployee.name, role: currentLoggedInEmployee.role });

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
  const mockParam = (urlParams.get('mock') || '').toLowerCase();
  if (mockParam) {
    if (mockParam === 'admin' || mockParam === 'super_admin') {
      SessionInfo.set({ portal: 'admin', roles: ['Super-Admin'], employee_id: 1, name: 'Sarah Connor', permissions: MOCK_PERMISSIONS_ALL });
      hideAppLoader();
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('loginThemeToggle').style.display = 'none';
      document.getElementById('admin-app').classList.add('active');
      currentPortal = 'admin';
      initMockAdminData();
      if (window.AdminNav && typeof window.AdminNav.syncModuleVisibility === 'function') window.AdminNav.syncModuleVisibility();
      if (typeof updateFinanceNavVisibility === 'function') updateFinanceNavVisibility();
      if (window.Router) Router.boot();
      return;
    } else if (mockParam === 'hr' || mockParam === 'hr_admin') {
      SessionInfo.set({ portal: 'admin', roles: ['HR-Admin'], employee_id: 1, name: 'Sarah Connor', permissions: MOCK_PERMISSIONS_HR });
      hideAppLoader();
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('loginThemeToggle').style.display = 'none';
      document.getElementById('admin-app').classList.add('active');
      currentPortal = 'admin';
      initMockAdminData();
      if (window.AdminNav && typeof window.AdminNav.syncModuleVisibility === 'function') window.AdminNav.syncModuleVisibility();
      if (typeof updateFinanceNavVisibility === 'function') updateFinanceNavVisibility();
      if (window.Router) Router.boot();
      return;
    } else if (mockParam === 'finance' || mockParam === 'financial_admin') {
      SessionInfo.set({ portal: 'admin', roles: ['Financial-Admin'], employee_id: 1, name: 'Sarah Connor', permissions: MOCK_PERMISSIONS_FINANCE });
      hideAppLoader();
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('loginThemeToggle').style.display = 'none';
      document.getElementById('admin-app').classList.add('active');
      currentPortal = 'admin';
      initMockAdminData();
      if (window.AdminNav && typeof window.AdminNav.syncModuleVisibility === 'function') window.AdminNav.syncModuleVisibility();
      if (typeof updateFinanceNavVisibility === 'function') updateFinanceNavVisibility();
      if (window.Router) Router.boot();
      return;
    } else if (mockParam === 'payroll' || mockParam === 'payroll_maker') {
      SessionInfo.set({ portal: 'admin', roles: ['Payroll-Maker'], employee_id: 1, name: 'Sarah Connor', permissions: MOCK_PERMISSIONS_PAYROLL });
      hideAppLoader();
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('loginThemeToggle').style.display = 'none';
      document.getElementById('admin-app').classList.add('active');
      currentPortal = 'admin';
      initMockAdminData();
      if (window.AdminNav && typeof window.AdminNav.syncModuleVisibility === 'function') window.AdminNav.syncModuleVisibility();
      if (typeof updateFinanceNavVisibility === 'function') updateFinanceNavVisibility();
      if (window.Router) Router.boot();
      return;
    } else if (mockParam === 'employee') {
      SessionInfo.set({ portal: 'employee', roles: [], employee_id: 2, name: 'John Doe', permissions: MOCK_PERMISSIONS_EMPLOYEE });
      hideAppLoader();
      document.getElementById('login-screen').style.display = 'none';
      document.getElementById('loginThemeToggle').style.display = 'none';
      document.getElementById('employee-app').classList.add('active');
      currentPortal = 'employee';
      initMockEmployeeData();
      if (window.AdminNav && typeof window.AdminNav.syncModuleVisibility === 'function') window.AdminNav.syncModuleVisibility();
      if (typeof updateFinanceNavVisibility === 'function') updateFinanceNavVisibility();
      if (window.Router) Router.boot();
      return;
    }
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
    const portal = session.portal || 'employee';
    if(portal === 'admin'){
      currentPortal = 'admin';
      document.getElementById('admin-app').classList.add('active');
      if (window.AdminNav && typeof window.AdminNav.syncModuleVisibility === 'function') window.AdminNav.syncModuleVisibility();
      if (typeof updateFinanceNavVisibility === 'function') updateFinanceNavVisibility();
      await loadAdminData();
    } else {
      currentPortal = 'employee';
      document.getElementById('employee-app').classList.add('active');
      if (window.AdminNav && typeof window.AdminNav.syncModuleVisibility === 'function') window.AdminNav.syncModuleVisibility();
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
  if (window.Router) await Router.boot();
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
