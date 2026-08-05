/* =====================================================================
   api.js
   Integration layer connecting the HRFlow HTML prototype to the FastAPI
   backend, using "Sign in with Google" as the ONLY authentication method.

   HOW TO USE:
   1. Set API_BASE_URL and GOOGLE_CLIENT_ID below.
   2. Include this file in the HTML prototype BEFORE its inline <script>:
        <script src="https://accounts.google.com/gsi/client" async defer></script>
        <script src="api.js"></script>
   3. Add a container div where the Google button should render:
        <div id="googleSignInButton"></div>
      (see INTEGRATION NOTES at the bottom for exact placement in the
      existing login screen markup)
   ===================================================================== */

const API_BASE_URL = "http://localhost:5000"; // change to your deployed backend URL later
const GOOGLE_CLIENT_ID = "SECRET.apps.googleusercontent.com"; // must match backend .env GOOGLE_OAUTH_CLIENT_ID

/* ---------------------------------------------------------------------
   Token storage helpers
   --------------------------------------------------------------------- */
const TokenStore = {
  get() { return localStorage.getItem("hrflow_token"); },
  set(token) { localStorage.setItem("hrflow_token", token); },
  clear() { localStorage.removeItem("hrflow_token"); },
  getRole() { return localStorage.getItem("hrflow_role"); },
  setRole(role) { localStorage.setItem("hrflow_role", role); },
  getEmployeeId() { return localStorage.getItem("hrflow_employee_id"); },
  setEmployeeId(id) { localStorage.setItem("hrflow_employee_id", id); },
  getName() { return localStorage.getItem("hrflow_name"); },
  setName(name) { localStorage.setItem("hrflow_name", name); },
  clearAll() {
    localStorage.removeItem("hrflow_token");
    localStorage.removeItem("hrflow_role");
    localStorage.removeItem("hrflow_employee_id");
    localStorage.removeItem("hrflow_name");
  }
};

/* ---------------------------------------------------------------------
   Core request wrapper - adds Authorization header automatically and
   normalizes error handling so callers just get a rejected Promise with
   a readable message on failure.
   --------------------------------------------------------------------- */
async function apiRequest(method, path, body = null, auth = true) {
  const headers = { "Content-Type": "application/json" };
  if (auth) {
    const token = TokenStore.get();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }
  const opts = { method, headers };
  if (body !== null) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, opts);
  } catch (networkErr) {
    throw new Error("Network error - is the backend server running?");
  }

  if (res.status === 401) {
    TokenStore.clearAll();
    throw new Error("Session expired. Please sign in with Google again.");
  }

  let data = null;
  try { data = await res.json(); } catch (_) { /* empty body is fine */ }

  if (!res.ok) {
    const detail = (data && (data.detail || data.error)) || `Request failed (${res.status})`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

/* ---------------------------------------------------------------------
   Google Sign-In wiring
   --------------------------------------------------------------------- */
let _onGoogleLoginSuccess = null; // set by initGoogleSignIn(callback)
let _onGoogleLoginError = null;

function handleGoogleCredentialResponse(response) {
  // `response.credential` is the signed Google ID token JWT
  Api.loginWithGoogle(response.credential)
    .then(data => { if (_onGoogleLoginSuccess) _onGoogleLoginSuccess(data); })
    .catch(err => { if (_onGoogleLoginError) _onGoogleLoginError(err); });
}

/**
 * Call this once the page has loaded to render the official Google
 * Sign-In button inside the given container element id.
 * onSuccess(data) receives { token, role, employee_id, name }.
 * onError(err) receives an Error with a readable .message.
 */
function initGoogleSignIn(containerId, onSuccess, onError) {
  _onGoogleLoginSuccess = onSuccess;
  _onGoogleLoginError = onError;

  if (!window.google || !window.google.accounts) {
    console.error("Google Identity Services script not loaded yet. Make sure https://accounts.google.com/gsi/client is included before api.js.");
    return;
  }

  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredentialResponse,
  });

  google.accounts.id.renderButton(
    document.getElementById(containerId),
    { type: "standard", size: "large", theme: "outline", text: "signin_with", shape: "rectangular", logo_alignment: "left", width: 320 }
  );
}

/* ---------------------------------------------------------------------
   Api - one function per backend endpoint. Mirrors main.py exactly.
   --------------------------------------------------------------------- */
const Api = {

  // ---------- AUTH ----------
  async loginWithGoogle(credential) {
    const data = await apiRequest("POST", "/api/auth/google", { credential }, false);
    TokenStore.set(data.token);
    TokenStore.setRole(data.role);
    TokenStore.setEmployeeId(data.employee_id);
    TokenStore.setName(data.name || "");
    return data; // { token, role, employee_id, name }
  },

  // DUMMY / TEST-ONLY login path - email + shared test password (see backend auth.py TEST_PASSWORD).
  // Use this for local testing/demos before Google OAuth is fully configured.
  async loginWithPassword(email, password) {
    const data = await apiRequest("POST", "/api/auth/login", { email, password }, false);
    TokenStore.set(data.token);
    TokenStore.setRole(data.role);
    TokenStore.setEmployeeId(data.employee_id);
    TokenStore.setName(data.name || "");
    return data;
  },

  logout() {
    TokenStore.clearAll();
    if (window.google && window.google.accounts) {
      google.accounts.id.disableAutoSelect();
    }
  },

  isLoggedIn() {
    return !!TokenStore.get();
  },

  // ---------- EMPLOYEES ----------
  getEmployees() {
    return apiRequest("GET", "/api/employees");
  },
  createEmployee(payload) {
    // payload: { name, email, dept, job_role, salary, join_date, status, vac_total, next_raise }
    // email MUST be the employee's real Google Workspace address - that's how they'll sign in.
    return apiRequest("POST", "/api/employees", payload);
  },
  updateEmployee(empId, payload) {
    return apiRequest("PUT", `/api/employees/${empId}`, payload);
  },
  deleteEmployee(empId) {
    return apiRequest("DELETE", `/api/employees/${empId}`);
  },

  // ---------- REQUESTS (pending approvals feed) ----------
  getRequests(type = "all") {
    const q = type && type !== "all" ? `?type=${encodeURIComponent(type)}` : "";
    return apiRequest("GET", `/api/requests${q}`);
  },
  createRequest(payload) {
    return apiRequest("POST", "/api/requests", payload);
  },
  actionRequest(reqId, status) {
    return apiRequest("POST", `/api/requests/${reqId}/action`, { status });
  },

  // ---------- VACATIONS ----------
  getVacationHistory() {
    return apiRequest("GET", "/api/vacations/history");
  },
  requestVacation(payload) {
    return apiRequest("POST", "/api/vacations/request", payload);
  },

  // ---------- INSURANCE ----------
  getInsuranceClaims() {
    return apiRequest("GET", "/api/insurance/claims");
  },
  submitInsuranceClaim(payload) {
    return apiRequest("POST", "/api/insurance/claims", payload);
  },
  actionInsuranceClaim(claimId, status) {
    return apiRequest("POST", `/api/insurance/claims/${claimId}/action`, { status });
  },

  // ---------- SALARY & RAISES ----------
  getSalaryHistory(employeeId = null) {
    const q = employeeId ? `?employee_id=${employeeId}` : "";
    return apiRequest("GET", `/api/salary/history${q}`);
  },
  applyRaise(payload) {
    return apiRequest("POST", "/api/salary/raise", payload);
  },

  // ---------- HEALTH ----------
  health() {
    return apiRequest("GET", "/api/health", null, false);
  },
};

/* =====================================================================
   INTEGRATION NOTES

   1. In the HTML <head>, add BEFORE api.js:
        <script src="https://accounts.google.com/gsi/client" async defer></script>

   2. In the login screen markup, keep BOTH sign-in options visible:
        <div id="googleSignInButton" style="display:flex; justify-content:center; margin:20px 0;"></div>
        <div class="divider">or sign in with email</div>
        <form id="loginForm"> ... email + password fields ... </form>

   3. After the page loads, call:
        initGoogleSignIn('googleSignInButton',
          (data) => handleLoginSuccess(data),
          (err) => handleLoginError(err)
        );

      And wire the password form's submit handler to:
        Api.loginWithPassword(email, password)
          .then(handleLoginSuccess)
          .catch(handleLoginError);

      Where handleLoginSuccess/handleLoginError route to the admin/employee
      portal or show the error box, same as the Google flow.

   4. Employees must already exist in the Employees/Users tabs (created by
      an admin via "Add Employee") BEFORE they can sign in with either
      method - the backend rejects any account with no matching row.

   5. The password login is a DUMMY/TEST-ONLY mechanism (single shared
      password, no per-user password storage) - see backend auth.py
      TEST_PASSWORD constant. It exists so the app is usable without fully
      configuring Google OAuth first. Google Sign-In remains the
      recommended production method and additionally enforces the
      Workspace domain restriction via the "hd" claim.
   ===================================================================== */
