if (typeof window.HRFLOW_CONFIG === "undefined") {
  throw new Error(
    "HRFLOW_CONFIG is not defined. Did you forget to include config.js before api.js? Copy fe/config.example.js to fe/config.js and fill in your values, then add <script src='config.js'></script> before api.js."
  );
}

const API_BASE_URL = window.HRFLOW_CONFIG.API_BASE_URL;
const GOOGLE_CLIENT_ID = window.HRFLOW_CONFIG.GOOGLE_CLIENT_ID;

// Session state (role/employee_id/name) is kept in memory only, populated
// from the response of /api/auth/google or /api/auth/me. The session
// token itself is NEVER handled by JavaScript at all - it lives only in
// an HttpOnly cookie that the browser attaches automatically on every
// request to API_BASE_URL. This closes two issues from the Phase 1
// security pass (see docs/analysis/security-analysis-plan.md):
//   - SEC-04: a JWT in localStorage is fully readable by any script,
//     including an attacker's script in an XSS scenario. An HttpOnly
//     cookie cannot be read by JavaScript at all.
//   - SEC-01: document preview/download links previously carried the
//     token as a URL query parameter (leaking into logs/history/Referer).
//     They no longer need to - the browser sends the cookie on its own.
const SessionInfo = {
  _role: null,
  _employeeId: null,
  _name: null,
  set(data) {
    this._role = data.role ?? null;
    this._employeeId = data.employee_id ?? null;
    this._name = data.name ?? null;
  },
  clear() {
    this._role = null;
    this._employeeId = null;
    this._name = null;
  },
  getRole() { return this._role; },
  getEmployeeId() { return this._employeeId; },
  getName() { return this._name; },
  isKnown() { return this._role !== null; },
};

// Guards against a burst of parallel 401s (e.g. the several Promise.all()
// calls fired together on page load) triggering the forced-logout/reload
// flow more than once.
let _sessionExpiredHandled = false;

// Called whenever an authenticated request comes back 401 (session
// expired or otherwise invalid). Ensures the user is never left staring
// at a logged-in-looking screen with a dead session and endlessly
// failing requests - instead they're guaranteed to land back on the
// Sign-In screen so they can simply log in again.
//
// Emits a 'hrflow:session-expired' event on window first, so the host
// page (index.html) can react gracefully (e.g. show a toast, tear down
// in-memory state, then re-render the login screen) without a hard
// reload. If nothing calls event.preventDefault() on that event within
// one tick, we fall back to reloading the page.
function forceSessionExpiredLogout() {
  if (_sessionExpiredHandled) return;
  _sessionExpiredHandled = true;

  SessionInfo.clear();
  if (window.google && window.google.accounts && window.google.accounts.id) {
    try { google.accounts.id.disableAutoSelect(); } catch (_) {}
  }

  const evt = new CustomEvent("hrflow:session-expired", { cancelable: true });
  const handledByListener = !window.dispatchEvent(evt); // dispatchEvent returns false if preventDefault() was called

  if (!handledByListener) {
    setTimeout(() => { window.location.reload(); }, 50);
  } else {
    // A listener took over recovery; allow future 401s to be handled again
    // once the current one has been dealt with.
    setTimeout(() => { _sessionExpiredHandled = false; }, 500);
  }
}

async function apiRequest(method, path, body = null, auth = true) {
  const headers = { "Content-Type": "application/json" };
  const opts = { method, headers, credentials: "include" }; // send/receive the HttpOnly session cookie
  if (body !== null) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, opts);
  } catch (networkErr) {
    throw new Error("Network error - is the backend server running?");
  }

  if (res.status === 401) {
    // Only treat this as a session-expiry event for requests that were
    // actually expected to be authenticated. Public/login calls
    // (auth=false, e.g. /api/auth/google) returning 401 means "bad
    // credential", not "your session died" - those should NOT force a
    // page reload.
    if (auth) {
      forceSessionExpiredLogout();
    } else {
      SessionInfo.clear();
    }
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

// XHR-based request that reports upload progress (0-100). fetch() cannot
// report upload progress natively, so document uploads use this instead
// of apiRequest() to drive a visual progress bar in the UI.
function apiRequestWithProgress(method, path, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${API_BASE_URL}${path}`, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.withCredentials = true; // send/receive the HttpOnly session cookie

    xhr.upload.onprogress = (evt) => {
      if (onProgress && evt.lengthComputable) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };

    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (_) {}
      if (xhr.status === 401) {
        forceSessionExpiredLogout();
        reject(new Error("Session expired. Please sign in again."));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(data);
      } else {
        const detail = (data && (data.detail || data.error)) || `Request failed (${xhr.status})`;
        reject(new Error(typeof detail === "string" ? detail : JSON.stringify(detail)));
      }
    };
    xhr.onerror = () => reject(new Error("Network error - is the backend server running?"));
    xhr.send(JSON.stringify(body));
  });
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
        container.innerHTML = '<p style="color:#888; font-size:13px; text-align:center;">Google Sign-In unavailable - please refresh the page and try again.</p>';
      }
      return;
    }
    setTimeout(tryRender, intervalMs);
  };

  tryRender();
}

// Valid values for the employee's employment state (mirrors the backend
// EmploymentState enum in be/models.py).
const EMPLOYMENT_STATES = ["Full-Time", "Part-Time", "Freelance", "Occasional"];

const Api = {
  async loginWithGoogle(credential) {
    const data = await apiRequest("POST", "/api/auth/google", { credential }, false);
    SessionInfo.set(data);
    return data;
  },
  // Re-establishes who's signed in (e.g. after a page reload) by asking
  // the backend to validate the HttpOnly session cookie. Returns null if
  // there is no valid session, instead of throwing, so callers can treat
  // "not logged in" as a normal state on first load.
  async restoreSession() {
    try {
      const data = await apiRequest("GET", "/api/auth/me", null, false);
      SessionInfo.set(data);
      return data;
    } catch (_) {
      SessionInfo.clear();
      return null;
    }
  },
  async logout() {
    try { await apiRequest("POST", "/api/auth/logout", null, false); } catch (_) {}
    SessionInfo.clear();
    if (window.google && window.google.accounts) {
      google.accounts.id.disableAutoSelect();
    }
  },
  isLoggedIn() { return SessionInfo.isKnown(); },
  getEmployees() { return apiRequest("GET", "/api/employees"); },
  getEmployee(empId) { return apiRequest("GET", `/api/employees/${empId}`); },
  // payload may include employment_state ("Full-Time" | "Part-Time" | "Freelance" | "Occasional")
  createEmployee(payload) { return apiRequest("POST", "/api/employees", payload); },
  updateEmployee(empId, payload) { return apiRequest("PUT", `/api/employees/${empId}`, payload); },
  deleteEmployee(empId) { return apiRequest("DELETE", `/api/employees/${empId}`); },

  getEmployeeNotes(empId) { return apiRequest("GET", `/api/employees/${empId}/notes`); },
  createEmployeeNote(empId, payload) { return apiRequest("POST", `/api/employees/${empId}/notes`, payload); },
  deleteEmployeeNote(noteId) { return apiRequest("DELETE", `/api/employees/notes/${noteId}`); },

  getEmployeeDocuments(empId) { return apiRequest("GET", `/api/employees/${empId}/documents`); },
  uploadEmployeeDocument(empId, payload) { return apiRequest("POST", `/api/employees/${empId}/documents`, payload); },
  // Same endpoint as uploadEmployeeDocument, but reports upload progress
  // via onProgress(pct) so the UI can render a real progress bar instead
  // of an indeterminate spinner.
  uploadEmployeeDocumentWithProgress(empId, payload, onProgress) {
    return apiRequestWithProgress("POST", `/api/employees/${empId}/documents`, payload, onProgress);
  },
  deleteEmployeeDocument(docId) { return apiRequest("DELETE", `/api/employees/documents/${docId}`); },

  // Preview/download URLs stream bytes through our own backend (service
  // account's Drive access). They no longer carry any token - the
  // browser sends the HttpOnly session cookie automatically for these
  // direct navigations (<a target="_blank">, <iframe>, download click),
  // since the cookie is scoped to API_BASE_URL's site regardless of how
  // the request was triggered.
  getDocumentPreviewUrl(docId) {
    return `${API_BASE_URL}/api/employees/documents/${docId}/stream`;
  },
  getDocumentDownloadUrl(docId) {
    return `${API_BASE_URL}/api/employees/documents/${docId}/stream?download=true`;
  },

  // ---------- DOCUMENT HUB (company-wide documents/policies) ----------
  // Any signed-in user (admin or employee) may list/preview/download.
  // Only admins may upload or delete (enforced server-side too).
  getCompanyDocuments() { return apiRequest("GET", "/api/company-documents"); },
  uploadCompanyDocument(payload) { return apiRequest("POST", "/api/company-documents", payload); },
  uploadCompanyDocumentWithProgress(payload, onProgress) {
    return apiRequestWithProgress("POST", "/api/company-documents", payload, onProgress);
  },
  deleteCompanyDocument(docId) { return apiRequest("DELETE", `/api/company-documents/${docId}`); },
  getCompanyDocumentPreviewUrl(docId) {
    return `${API_BASE_URL}/api/company-documents/${docId}/stream`;
  },
  getCompanyDocumentDownloadUrl(docId) {
    return `${API_BASE_URL}/api/company-documents/${docId}/stream?download=true`;
  },

  getRequests(type = "all") {
    const q = type && type !== "all" ? `?type=${encodeURIComponent(type)}` : "";
    return apiRequest("GET", `/api/requests${q}`);
  },
  createRequest(payload) { return apiRequest("POST", "/api/requests", payload); },
  actionRequest(reqId, status) { return apiRequest("POST", `/api/requests/${reqId}/action`, { status }); },
  getVacationHistory(employeeId = null) {
    const q = employeeId ? `?employee_id=${employeeId}` : "";
    return apiRequest("GET", `/api/vacations/history${q}`);
  },
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
