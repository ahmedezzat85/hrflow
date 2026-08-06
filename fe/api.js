if (typeof window.HRFLOW_CONFIG === "undefined") {
  throw new Error(
    "HRFLOW_CONFIG is not defined. Did you forget to include config.js before api.js? Copy fe/config.example.js to fe/config.js and fill in your values, then add <script src='config.js'></script> before api.js."
  );
}

const API_BASE_URL = window.HRFLOW_CONFIG.API_BASE_URL;
const GOOGLE_CLIENT_ID = window.HRFLOW_CONFIG.GOOGLE_CLIENT_ID;

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
    throw new Error("Session expired. Please sign in again.");
  }

  let data = null;
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) {
    const detail = (data && (data.detail || data.error)) || `Request failed (${res.status})`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

let _onGoogleLoginSuccess = null;
let _onGoogleLoginError = null;

function handleGoogleCredentialResponse(response) {
  Api.loginWithGoogle(response.credential)
    .then(data => { if (_onGoogleLoginSuccess) _onGoogleLoginSuccess(data); })
    .catch(err => { if (_onGoogleLoginError) _onGoogleLoginError(err); });
}

function _renderGoogleButton(containerId) {
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredentialResponse,
  });
  google.accounts.id.renderButton(
    document.getElementById(containerId),
    { type: "standard", size: "large", theme: "outline", text: "signin_with", shape: "rectangular", logo_alignment: "left", width: 320 }
  );
}

function initGoogleSignIn(containerId, onSuccess, onError) {
  _onGoogleLoginSuccess = onSuccess;
  _onGoogleLoginError = onError;

  const maxWaitMs = 10000;
  const intervalMs = 100;
  let waited = 0;

  const tryRender = () => {
    if (window.google && window.google.accounts && window.google.accounts.id) {
      _renderGoogleButton(containerId);
      return;
    }
    waited += intervalMs;
    if (waited >= maxWaitMs) {
      console.error("Google Identity Services failed to load within 10s.");
      const container = document.getElementById(containerId);
      if (container) {
        container.innerHTML = '<p style="color:#888; font-size:13px; text-align:center;">Google Sign-In unavailable - please use the email/password form below, or refresh the page.</p>';
      }
      return;
    }
    setTimeout(tryRender, intervalMs);
  };

  tryRender();
}

const Api = {
  async loginWithGoogle(credential) {
    const data = await apiRequest("POST", "/api/auth/google", { credential }, false);
    TokenStore.set(data.token);
    TokenStore.setRole(data.role);
    TokenStore.setEmployeeId(data.employee_id);
    TokenStore.setName(data.name || "");
    return data;
  },
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
  isLoggedIn() { return !!TokenStore.get(); },
  getEmployees() { return apiRequest("GET", "/api/employees"); },
  createEmployee(payload) { return apiRequest("POST", "/api/employees", payload); },
  updateEmployee(empId, payload) { return apiRequest("PUT", `/api/employees/${empId}`, payload); },
  deleteEmployee(empId) { return apiRequest("DELETE", `/api/employees/${empId}`); },
  getRequests(type = "all") {
    const q = type && type !== "all" ? `?type=${encodeURIComponent(type)}` : "";
    return apiRequest("GET", `/api/requests${q}`);
  },
  createRequest(payload) { return apiRequest("POST", "/api/requests", payload); },
  actionRequest(reqId, status) { return apiRequest("POST", `/api/requests/${reqId}/action`, { status }); },
  getVacationHistory() { return apiRequest("GET", "/api/vacations/history"); },
  requestVacation(payload) { return apiRequest("POST", "/api/vacations/request", payload); },

  getInsuranceCategories() { return apiRequest("GET", "/api/insurance/categories"); },
  createInsuranceCategory(payload) { return apiRequest("POST", "/api/insurance/categories", payload); },
  updateInsuranceCategory(catId, payload) { return apiRequest("PUT", `/api/insurance/categories/${catId}`, payload); },
  deleteInsuranceCategory(catId) { return apiRequest("DELETE", `/api/insurance/categories/${catId}`); },
  getInsuranceConsumption(employeeId = null) {
    const q = employeeId ? `?employee_id=${employeeId}` : "";
    return apiRequest("GET", `/api/insurance/consumption${q}`);
  },

  getInsuranceClaims() { return apiRequest("GET", "/api/insurance/claims"); },
  submitInsuranceClaim(payload) { return apiRequest("POST", "/api/insurance/claims", payload); },
  actionInsuranceClaim(claimId, status) { return apiRequest("POST", `/api/insurance/claims/${claimId}/action`, { status }); },
  getSalaryHistory(employeeId = null) {
    const q = employeeId ? `?employee_id=${employeeId}` : "";
    return apiRequest("GET", `/api/salary/history${q}`);
  },
  applyRaise(payload) { return apiRequest("POST", "/api/salary/raise", payload); },
  health() { return apiRequest("GET", "/api/health", null, false); },
};
