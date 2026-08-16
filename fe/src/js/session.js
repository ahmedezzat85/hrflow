async function handleLoginSuccess(data){
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('loginThemeToggle').style.display = 'none';
  document.getElementById('loginErr').style.display = 'none';
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

// On page load, the session itself lives only in an HttpOnly cookie set
// by the backend (see be/main.py: /api/auth/google, /api/auth/logout).
// The frontend never stores or reads the token directly - it just asks
// the backend "who am I?" via /api/auth/me, which succeeds if the
// browser's cookie is still valid and fails (401) otherwise. This
// replaces the previous localStorage + manually-mirrored-cookie flow
// (see docs/analysis/security-analysis-plan.md, Phase 1 - SEC-04).
async function bootstrapAppFromSession(){
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
    if(session.role === 'admin'){
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
