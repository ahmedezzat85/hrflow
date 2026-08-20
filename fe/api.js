if (typeof window.HRFLOW_CONFIG === "undefined") {
  throw new Error(
    "HRFLOW_CONFIG is not defined. Did you forget to include config.js before api.js? Copy fe/config.example.js to fe/config.js and fill in your values, then add <script src='config.js'></script> before api.js."
  );
}

const API_BASE_URL = window.HRFLOW_CONFIG.API_BASE_URL;
const GOOGLE_CLIENT_ID = window.HRFLOW_CONFIG.GOOGLE_CLIENT_ID;

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

let _sessionExpiredHandled = false;

function forceSessionExpiredLogout() {
  if (_sessionExpiredHandled) return;
  _sessionExpiredHandled = true;

  SessionInfo.clear();
  if (window.google && window.google.accounts && window.google.accounts.id) {
    try { google.accounts.id.disableAutoSelect(); } catch (_) { }
  }

  const evt = new CustomEvent("hrflow:session-expired", { cancelable: true });
  const handledByListener = !window.dispatchEvent(evt);

  if (!handledByListener) {
    setTimeout(() => { window.location.reload(); }, 50);
  } else {
    setTimeout(() => { _sessionExpiredHandled = false; }, 500);
  }
}

async function apiRequest(method, path, body = null, auth = true) {
  const headers = { "Content-Type": "application/json" };
  const opts = { method, headers, credentials: "include" };
  if (body !== null) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, opts);
  } catch (networkErr) {
    throw new Error("Network error - is the backend server running?");
  }

  if (res.status === 401) {
    if (auth) {
      forceSessionExpiredLogout();
    } else {
      SessionInfo.clear();
    }
    throw new Error("Session expired. Please sign in again.");
  }

  let data = null;
  try { data = await res.json(); } catch (_) { }

  if (!res.ok) {
    const detail = (data && (data.detail || data.error)) || `Request failed (${res.status})`;
    throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return data;
}

function apiRequestWithProgress(method, path, body, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${API_BASE_URL}${path}`, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.withCredentials = true;

    xhr.upload.onprogress = (evt) => {
      if (onProgress && evt.lengthComputable) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    };

    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (_) { }
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

// Fetches a document's bytes as a Blob, sending the session cookie via
// fetch() (which DOES include SameSite=Lax cookies, unlike a passive
// <img src>/<iframe src> load - those are treated as cross-site
// background requests and never carry a Lax cookie, even though
// frontend and backend are same-site). Returns a local blob: URL that
// <img>/<iframe> can safely point to, and revokes the previous one if
// given, to avoid leaking blob URLs as the user previews multiple
// documents in a session.
let _lastPreviewBlobUrl = null;
async function _fetchDocumentAsBlobUrl(path) {
  const res = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" });
  if (res.status === 401) {
    forceSessionExpiredLogout();
    throw new Error("Session expired. Please sign in again.");
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try { const data = await res.json(); detail = data.detail || data.error || detail; } catch (_) { }
    throw new Error(detail);
  }
  const blob = await res.blob();
  if (_lastPreviewBlobUrl) { URL.revokeObjectURL(_lastPreviewBlobUrl); }
  _lastPreviewBlobUrl = URL.createObjectURL(blob);
  return _lastPreviewBlobUrl;
}

// Triggers a real file download (Content-Disposition: attachment) by
// fetching the bytes with credentials, then simulating a click on a
// temporary <a download> pointed at the resulting blob: URL. A plain
// `<a href="backendUrl" download>` click does NOT reliably send the
// session cookie either (browsers vary), so this uses the same
// authenticated-fetch pattern as preview.
async function _downloadDocumentViaFetch(path, suggestedName) {
  const res = await fetch(`${API_BASE_URL}${path}`, { credentials: "include" });
  if (res.status === 401) {
    forceSessionExpiredLogout();
    throw new Error("Session expired. Please sign in again.");
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try { const data = await res.json(); detail = data.detail || data.error || detail; } catch (_) { }
    throw new Error(detail);
  }
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = blobUrl;
  a.download = suggestedName || "document";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
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

const EMPLOYMENT_STATES = ["Full-Time", "Part-Time", "Freelance", "Occasional"];

const Api = {
  async loginWithGoogle(credential) {
    const data = await apiRequest("POST", "/api/auth/google", { credential }, false);
    SessionInfo.set(data);
    return data;
  },
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
    try { await apiRequest("POST", "/api/auth/logout", null, false); } catch (_) { }
    SessionInfo.clear();
    if (window.google && window.google.accounts) {
      google.accounts.id.disableAutoSelect();
    }
  },
  isLoggedIn() { return SessionInfo.isKnown(); },
  getEmployees() { return apiRequest("GET", "/api/employees"); },
  getEmployee(empId) { return apiRequest("GET", `/api/employees/${empId}`); },
  createEmployee(payload) { return apiRequest("POST", "/api/employees", payload); },
  updateEmployee(empId, payload) { return apiRequest("PUT", `/api/employees/${empId}`, payload); },
  deleteEmployee(empId) { return apiRequest("DELETE", `/api/employees/${empId}`); },

  getEmployeeNotes(empId) { return apiRequest("GET", `/api/employees/${empId}/notes`); },
  createEmployeeNote(empId, payload) { return apiRequest("POST", `/api/employees/${empId}/notes`, payload); },
  deleteEmployeeNote(noteId) { return apiRequest("DELETE", `/api/employees/notes/${noteId}`); },

  getEmployeeDocuments(empId) { return apiRequest("GET", `/api/employees/${empId}/documents`); },
  uploadEmployeeDocument(empId, payload) { return apiRequest("POST", `/api/employees/${empId}/documents`, payload); },
  uploadEmployeeDocumentWithProgress(empId, payload, onProgress) {
    return apiRequestWithProgress("POST", `/api/employees/${empId}/documents`, payload, onProgress);
  },
  deleteEmployeeDocument(docId) { return apiRequest("DELETE", `/api/employees/documents/${docId}`); },

  // Returns a blob: URL suitable for direct use as an <img src> or
  // <iframe src> - fetches the document with credentials first, since a
  // plain <img src="backendUrl">/<iframe src="backendUrl"> would be a
  // cross-context resource load that does NOT send a SameSite=Lax
  // session cookie (see docs/analysis/security-analysis-plan.md).
  getDocumentPreviewBlobUrl(docId) {
    return _fetchDocumentAsBlobUrl(`/api/employees/documents/${docId}/stream`);
  },
  downloadEmployeeDocumentFile(docId, suggestedName) {
    return _downloadDocumentViaFetch(`/api/employees/documents/${docId}/stream?download=true`, suggestedName);
  },

  // ---------- DOCUMENT HUB (company-wide documents/policies) ----------
  getCompanyDocuments() { return apiRequest("GET", "/api/company-documents"); },
  uploadCompanyDocument(payload) { return apiRequest("POST", "/api/company-documents", payload); },
  uploadCompanyDocumentWithProgress(payload, onProgress) {
    return apiRequestWithProgress("POST", "/api/company-documents", payload, onProgress);
  },
  deleteCompanyDocument(docId) { return apiRequest("DELETE", `/api/company-documents/${docId}`); },
  getCompanyDocumentPreviewBlobUrl(docId) {
    return _fetchDocumentAsBlobUrl(`/api/company-documents/${docId}/stream`);
  },
  downloadCompanyDocumentFile(docId, suggestedName) {
    return _downloadDocumentViaFetch(`/api/company-documents/${docId}/stream?download=true`, suggestedName);
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
