function setCookie(name, value, days){
  const d = new Date();
  d.setTime(d.getTime() + (days*24*60*60*1000));
  document.cookie = name + '=' + encodeURIComponent(value) + ';expires=' + d.toUTCString() + ';path=/';
}
function getCookie(name){
  const ca = document.cookie.split(';');
  for(let c of ca){
    c = c.trim();
    if(c.startsWith(name + '=')) return decodeURIComponent(c.substring(name.length+1));
  }
  return null;
}
function clearCookie(name){ setCookie(name, '', -1); }

function persistSessionToCookies(){
  const token = TokenStore.get();
  const role = TokenStore.getRole();
  const empId = TokenStore.getEmployeeId();
  const name = TokenStore.getName();
  if(!token || !role || !empId) return;
  setCookie('hrflow_token', token, 7);
  setCookie('hrflow_role', role, 7);
  setCookie('hrflow_employee_id', empId, 7);
  setCookie('hrflow_name', name || '', 7);
}

function restoreSessionFromCookies(){
  if(TokenStore.get()) return;
  const token = getCookie('hrflow_token');
  const role = getCookie('hrflow_role');
  const empId = getCookie('hrflow_employee_id');
  const name = getCookie('hrflow_name');
  if(token && role && empId){
    TokenStore.set(token);
    TokenStore.setRole(role);
    TokenStore.setEmployeeId(empId);
    TokenStore.setName(name || '');
  }
}

function clearSessionCookies(){
  ['hrflow_token','hrflow_role','hrflow_employee_id','hrflow_name'].forEach(clearCookie);
}

async function handleLoginSuccess(data){
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('loginThemeToggle').style.display = 'none';
  document.getElementById('loginErr').style.display = 'none';
  persistSessionToCookies();
  showAppLoader('Signing you in', 'Loading your HR workspace...');
  try{
    if(data.role === 'admin'){
      currentPortal = 'admin';
      document.getElementById('admin-app').classList.add('active');
      await loadAdminData();
    } else {
      currentPortal = 'employee';
      document.getElementById('employee-app').classList.add('active');
      await loadEmployeeData();
    }
  } catch(err){
    toast(err.message, 'fa-solid fa-triangle-exclamation');
  }
  try { initCharts(); } catch(chartErr){ console.error('Chart init failed:', chartErr); }
  hideAppLoader();
}

function handleLoginError(err){
  const errBox = document.getElementById('loginErr');
  errBox.style.display = 'flex';
  errBox.querySelector('span').textContent = err.message || 'Sign-in failed. Please try again.';
}

async function bootstrapAppFromSession(){
  restoreSessionFromCookies();
  if(!TokenStore.get()){
    initGoogleSignIn('googleSignInButton', handleLoginSuccess, handleLoginError);
    return;
  }
  const role = TokenStore.getRole();
  const empId = TokenStore.getEmployeeId();
  if(!role || !empId){
    TokenStore.clearAll();
    clearSessionCookies();
    initGoogleSignIn('googleSignInButton', handleLoginSuccess, handleLoginError);
    return;
  }
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('loginThemeToggle').style.display = 'none';
  document.getElementById('loginErr').style.display = 'none';
  showAppLoader('Reconnecting to HRFlow', 'Loading your data...');
  try{
    if(role === 'admin'){
      currentPortal = 'admin';
      document.getElementById('admin-app').classList.add('active');
      await loadAdminData();
    } else {
      currentPortal = 'employee';
      document.getElementById('employee-app').classList.add('active');
      await loadEmployeeData();
    }
  } catch(err){
    toast(err.message, 'fa-solid fa-triangle-exclamation');
    TokenStore.clearAll();
    clearSessionCookies();
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

function logout(){
  Api.logout();
  clearSessionCookies();
  employees = []; requests = []; insuranceClaims = []; empVacationHistory = []; empInsuranceHistory = []; currentLoggedInEmployee = null;
  insuranceCategories = []; insuranceConsumption = [];
  document.getElementById('admin-app').classList.remove('active');
  document.getElementById('employee-app').classList.remove('active');
  hideAppLoader();
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('loginThemeToggle').style.display = 'flex';
  document.getElementById('loginErr').style.display = 'none';
}
