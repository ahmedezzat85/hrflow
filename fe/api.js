if (typeof window.HRFLOW_CONFIG === "undefined") {
  throw new Error(
    "HRFLOW_CONFIG is not defined. Did you forget to include config.js before api.js? Copy fe/config.example.js to fe/config.js and fill in your values, then add <script src='config.js'></script> before api.js."
  );
}

const API_BASE_URL = window.HRFLOW_CONFIG.API_BASE_URL;

const SessionInfo = {
  _portal: null,
  _roles: [],
  _employeeId: null,
  _name: null,
  _permissions: [],
  set(data) {
    this._portal = data.portal ?? 'employee';
    this._roles = Array.isArray(data.roles) ? data.roles : [];
    this._employeeId = data.employee_id ?? null;
    this._name = data.name ?? null;
    this._permissions = Array.isArray(data.permissions) ? data.permissions : [];
    window.dispatchEvent(new CustomEvent("hrflow:session-changed", { detail: data }));
  },
  clear() {
    this._portal = null;
    this._roles = [];
    this._employeeId = null;
    this._name = null;
    this._permissions = [];
    window.dispatchEvent(new CustomEvent("hrflow:session-changed", { detail: null }));
  },
  getPortal() { return this._portal; },
  getRoles() { return this._roles; },
  getEmployeeId() { return this._employeeId; },
  getName() { return this._name; },
  getPermissions() { return this._permissions; },
  hasPermission(key) {
    return this._permissions.includes(key);
  },
  isKnown() { return this._portal !== null; },
};

let _sessionExpiredHandled = false;

function forceSessionExpiredLogout() {
  if (typeof window !== 'undefined' && window.location && window.location.search.includes('mock=')) return;
  if (_sessionExpiredHandled) return;
  // A 401 with no session known in this page load is a first visit, not an expiry.
  if (!SessionInfo.isKnown()) return;
  _sessionExpiredHandled = true;

  SessionInfo.clear();

  const evt = new CustomEvent("hrflow:session-expired", { cancelable: true });
  const handledByListener = !window.dispatchEvent(evt);

  if (!handledByListener) {
    setTimeout(() => { window.location.reload(); }, 50);
  } else {
    setTimeout(() => { _sessionExpiredHandled = false; }, 500);
  }
}

let _lastCorrelationId = null;

function generateCorrelationId() {
  return (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function getLastCorrelationId() {
  if (!_lastCorrelationId) {
    _lastCorrelationId = generateCorrelationId();
  }
  return _lastCorrelationId;
}

// Mock-mode personal details (?mock=admin), seeded from the mock employee list.
function _mockPersonalRecord(empId) {
  window._mockPersonalStore = window._mockPersonalStore || {};
  const key = String(empId);
  if (!window._mockPersonalStore[key]) {
    const e = (typeof employees !== "undefined" && Array.isArray(employees) && employees.find((x) => String(x.id) === key)) || {};
    window._mockPersonalStore[key] = {
      legal_name: e.legal_name || e.name || "",
      phone: e.phone || "",
      address_line_1: e.address_line_1 || "1 Mock Street",
      address_line_2: e.address_line_2 || "Cairo",
      id_type: key === "EMP001" ? "national_id" : "",
      id_number: key === "EMP001" ? "12345678901234" : "",
    };
  }
  return window._mockPersonalStore[key];
}
function _mockPersonalView(empId, reveal) {
  const rec = _mockPersonalRecord(empId);
  const n = rec.id_number || "";
  const view = {
    employee_id: empId,
    legal_name: rec.legal_name, phone: rec.phone,
    address_line_1: rec.address_line_1, address_line_2: rec.address_line_2,
    id_type: rec.id_type, has_id: !!n,
    id_number_masked: n.length > 4 ? "*".repeat(n.length - 4) + n.slice(-4) : "*".repeat(n.length),
  };
  if (reveal) view.id_number = n;
  return view;
}

async function apiRequest(method, path, body = null, auth = true, extraHeaders = {}) {
  const correlationId = (extraHeaders && extraHeaders["X-Correlation-ID"]) || generateCorrelationId();
  _lastCorrelationId = correlationId;
  // A FormData body is sent as multipart: the browser must set Content-Type (with the boundary).
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const headers = {
    ...(isForm ? {} : { "Content-Type": "application/json" }),
    "X-Correlation-ID": correlationId,
    ...(extraHeaders || {})
  };
  const opts = { method, headers, credentials: "include" };
  if (body !== null) opts.body = isForm ? body : JSON.stringify(body);

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
    const err = new Error(typeof detail === "string" ? detail : (detail && !Array.isArray(detail) && detail.message) || JSON.stringify(detail));
    if (detail && typeof detail === "object") { err.detail = detail; err.status = res.status; }
    throw err;
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
        reject(new Error(typeof detail === "string" ? detail : (detail && !Array.isArray(detail) && detail.message) || JSON.stringify(detail)));
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

// Google sign-in is a full-page redirect handled by the backend (OAuth authorization-code flow): the button
// below only navigates to /api/auth/google/start. Google sends the browser back to the backend, which sets the
// session cookie and redirects here, so the page boots with a session (restoreSession) or with ?login_error=<code>.
const LOGIN_ERROR_MESSAGES = {
  not_registered: "This Google account is not registered in HRFlow. Ask your HR admin to add you as an employee first.",
  archived: "This user account is archived. Contact your administrator.",
  no_access: "No access assigned. Contact your administrator.",
  unverified: "Your Google email address is not verified.",
  denied: "Sign-in was cancelled. Try again when you are ready.",
  unavailable: "Could not reach Google. Check your connection and try again.",
  not_configured: "Google sign-in is not set up on this server. Contact your administrator.",
  failed: "Sign-in failed. Please try again.",
};

const GOOGLE_G_LOGO = '<svg class="login-google-logo" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">'
  + '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>'
  + '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>'
  + '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>'
  + '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

function _googleSignInUrl() {
  return `${API_BASE_URL}/api/auth/google/start?return_to=${encodeURIComponent(window.location.origin)}`;
}

// Shows the reason of a refused sign-in carried back in ?login_error=, once, and removes it from the address bar.
function _consumeLoginError(onError) {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("login_error");
  if (!code) return;
  params.delete("login_error");
  const rest = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash);
  if (typeof onError === "function") onError(new Error(LOGIN_ERROR_MESSAGES[code] || LOGIN_ERROR_MESSAGES.failed));
}

// onSuccess is unused (the page reloads after Google redirects back); the argument is kept for the call sites.
function initGoogleSignIn(containerId, onSuccess, onError) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";
  const link = document.createElement("a");
  link.className = "login-google-btn";
  link.href = _googleSignInUrl();
  link.innerHTML = `${GOOGLE_G_LOGO}<span>Sign in with Google</span>`;
  container.appendChild(link);
  _consumeLoginError(onError);
}

const EMPLOYMENT_STATES = ["Full-Time", "Part-Time", "Freelance", "Occasional"];

const Api = {
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
  },
  isLoggedIn() { return SessionInfo.isKnown(); },
  getEmployees() { return apiRequest("GET", "/api/employees"); },
  getEmployee(empId) { return apiRequest("GET", `/api/employees/${empId}`); },
  createEmployee(payload) { return apiRequest("POST", "/api/employees", payload); },
  updateEmployee(empId, payload) { return apiRequest("PUT", `/api/employees/${empId}`, payload); },
  // Personal details (D-036): legal name, phone, address, ID. HR-admin only; the ID is masked unless revealed.
  getEmployeePersonal(empId, revealId = false) {
    if (typeof _isMock === "function" && _isMock()) return Promise.resolve(_mockPersonalView(empId, revealId));
    return apiRequest("GET", `/api/employees/${empId}/personal${revealId ? "?reveal_id=true" : ""}`);
  },
  updateEmployeePersonal(empId, payload) {
    if (typeof _isMock === "function" && _isMock()) {
      const rec = _mockPersonalRecord(empId);
      Object.keys(payload).forEach((k) => { rec[k] = payload[k] == null ? "" : payload[k]; });
      return Promise.resolve(_mockPersonalView(empId, false));
    }
    return apiRequest("PUT", `/api/employees/${empId}/personal`, payload);
  },
  deleteEmployee(empId) { return apiRequest("DELETE", `/api/employees/${empId}`); },
  archiveEmployee(empId, leftDate) { return apiRequest("POST", `/api/employees/${empId}/archive`, leftDate ? { left_date: leftDate } : undefined); },
  unarchiveEmployee(empId) { return apiRequest("POST", `/api/employees/${empId}/unarchive`); },

  getEmployeeNotes(empId) { return apiRequest("GET", `/api/employees/${empId}/notes`); },
  createEmployeeNote(empId, payload) { return apiRequest("POST", `/api/employees/${empId}/notes`, payload); },
  deleteEmployeeNote(noteId) { return apiRequest("DELETE", `/api/employees/notes/${noteId}`); },

  getEmployeeDocuments(empId) {
    if (typeof _isMock === "function" && _isMock()) {
      return Promise.resolve([
        { id: 1, name: "Employment contract", file_type: "pdf", uploaded_at: "PDF · uploaded 15 Jan 2023" },
        { id: 2, name: "National ID copy", file_type: "pdf", uploaded_at: "PDF · uploaded 15 Jan 2023" }
      ]);
    }
    return apiRequest("GET", `/api/employees/${empId}/documents`);
  },
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

  // Official holidays. Mock mode keeps a small in-memory list so the page and the leave preview can be exercised.
  getHolidays(year) {
    if (typeof _isMock === "function" && _isMock()) {
      window._mockHolidays = window._mockHolidays || [
        { id: 1, name: "New Year's Day", start_date: "2026-01-01", end_date: "2026-01-01" },
        { id: 2, name: "Labour Day", start_date: "2026-05-01", end_date: "2026-05-01" },
        { id: 3, name: "Eid al-Adha", start_date: "2026-05-26", end_date: "2026-05-29" },
      ];
      return Promise.resolve(window._mockHolidays
        .filter(h => h.start_date <= `${year}-12-31` && h.end_date >= `${year}-01-01`)
        .sort((a, b) => a.start_date.localeCompare(b.start_date)));
    }
    return apiRequest("GET", `/api/holidays?year=${encodeURIComponent(year)}`);
  },
  createHoliday(payload) {
    if (typeof _isMock === "function" && _isMock()) {
      return this.getHolidays(0).then(() => {
        const id = Math.max(0, ...window._mockHolidays.map(h => h.id)) + 1;
        window._mockHolidays.push({ id, name: payload.name, start_date: payload.start_date, end_date: payload.end_date || payload.start_date });
        return { message: "Holiday added", id };
      });
    }
    return apiRequest("POST", "/api/holidays", payload);
  },
  updateHoliday(id, payload) {
    if (typeof _isMock === "function" && _isMock()) {
      return this.getHolidays(0).then(() => {
        const h = window._mockHolidays.find(x => x.id === id);
        if (h) Object.assign(h, { name: payload.name, start_date: payload.start_date, end_date: payload.end_date || payload.start_date });
        return { message: "Holiday updated" };
      });
    }
    return apiRequest("PUT", `/api/holidays/${id}`, payload);
  },
  deleteHoliday(id) {
    if (typeof _isMock === "function" && _isMock()) {
      return this.getHolidays(0).then(() => {
        window._mockHolidays = window._mockHolidays.filter(x => x.id !== id);
        return { message: "Holiday deleted" };
      });
    }
    return apiRequest("DELETE", `/api/holidays/${id}`);
  },

  // Historical leave staged from old emails and scans (D-051). A person reviews each item here; accepting creates the leave.
  // Mock mode keeps three batches in memory: a clean one, one with a conflict and a low-confidence read, and one blocked by existing leave.
  _mockHistoryImport() {
    if (!window._mockHistoryImport) {
      const item = (id, batch_id, employee_name, leave_type, start_date, end_date, days, decision, source_kind, source_ref, evidence, confidence, extra = {}) => ({
        id, batch_id, employee_id: id, employee_name, leave_type, start_date, end_date, days, decision, decided_by: "Mona Adel",
        decided_on: start_date, source_kind, source_ref, evidence_excerpt: evidence, confidence, notes: "", status: "staged",
        reviewed_by: "", reviewed_at: null, reject_reason: "", result_vacation_id: null, warnings: [], blocked_by: [], ...extra,
      });
      window._mockHistoryImport = [
        { id: 1, label: "2023 leave emails", created_at: "2026-11-03T09:00:00", items: [
          item(1, 1, "Ahmed Hassan", "Annual Leave", "2023-03-05", "2023-03-09", 5, "Approved", "email", "Re: leave 5-9 March, 2023-02-20", "Approved, enjoy your leave.", "high"),
          item(2, 1, "Sara Ali", "Work From Home", "2023-04-02", "2023-04-02", 1, "Approved", "email", "WFH Sunday, 2023-03-30", "OK for Sunday.", "high"),
        ] },
        { id: 2, label: "Scanned forms 2022", created_at: "2026-11-03T09:30:00", items: [
          item(3, 2, "Omar Khaled", "Sick Leave", "2022-06-12", "2022-06-14", 3, "Approved", "scan", "form-2022-06-omar.pdf", "Sick leave 3 days, signed by manager.", "low",
            { warnings: ["Conflicts with staged item 4: Annual Leave 2022-06-13 to 2022-06-13 from Re: leave 13 June."] }),
          item(4, 2, "Omar Khaled", "Annual Leave", "2022-06-13", "2022-06-13", 1, "Approved", "email", "Re: leave 13 June", "Fine for the 13th.", "medium",
            { warnings: ["Conflicts with staged item 3: Sick Leave 2022-06-12 to 2022-06-14 from form-2022-06-omar.pdf."] }),
        ] },
        { id: 3, label: "Overlap check", created_at: "2026-11-03T10:00:00", items: [
          item(5, 3, "Nour Samir", "Annual Leave", "2026-02-01", "2026-02-03", 3, "Approved", "manual", "HR note", "", "medium",
            { blocked_by: ["Overlaps an existing record: Annual Leave 2026-02-01 to 2026-02-02 (Approved)."] }),
        ] },
      ];
    }
    return window._mockHistoryImport;
  },
  _mockHistoryItem(id) {
    for (const b of this._mockHistoryImport()) {
      const found = b.items.find(i => i.id === id);
      if (found) return found;
    }
    return null;
  },
  getHistoryImportBatches() {
    if (typeof _isMock === "function" && _isMock()) {
      return Promise.resolve(this._mockHistoryImport().map(b => {
        const counts = { staged: 0, accepted: 0, rejected: 0 };
        b.items.forEach(i => { counts[i.status] += 1; });
        return { id: b.id, label: b.label, created_at: b.created_at, counts, item_count: b.items.length };
      }).reverse());
    }
    return apiRequest("GET", "/api/history-import/batches");
  },
  getHistoryImportBatch(id) {
    if (typeof _isMock === "function" && _isMock()) {
      const b = this._mockHistoryImport().find(x => x.id === id);
      return b ? Promise.resolve(JSON.parse(JSON.stringify(b))) : Promise.reject(new Error("Batch not found."));
    }
    return apiRequest("GET", `/api/history-import/batches/${id}`);
  },
  editHistoryImportItem(id, payload) {
    if (typeof _isMock === "function" && _isMock()) {
      const it = this._mockHistoryItem(id);
      if (!it || it.status !== "staged") return Promise.reject(new Error("Only staged items can be edited."));
      if (payload.end_date && payload.start_date && payload.end_date < payload.start_date) return Promise.reject(new Error("End date cannot be earlier than start date."));
      Object.assign(it, payload, { blocked_by: [] });
      it.end_date = payload.end_date || payload.start_date || it.end_date;
      it.days = Math.max(1, Math.round((new Date(it.end_date) - new Date(it.start_date)) / 86400000) + 1);
      return Promise.resolve(it);
    }
    return apiRequest("PATCH", `/api/history-import/items/${id}`, payload);
  },
  acceptHistoryImportItem(id) {
    if (typeof _isMock === "function" && _isMock()) {
      const it = this._mockHistoryItem(id);
      if (!it || it.status !== "staged") return Promise.reject(new Error("Only staged items can be accepted."));
      if (it.blocked_by.length) return Promise.reject(new Error(it.blocked_by[0]));
      it.status = "accepted"; it.reviewed_by = "admin@hrflow.test"; it.result_vacation_id = 900 + id;
      return Promise.resolve(it);
    }
    return apiRequest("POST", `/api/history-import/items/${id}/accept`);
  },
  rejectHistoryImportItem(id, reason) {
    if (typeof _isMock === "function" && _isMock()) {
      const it = this._mockHistoryItem(id);
      if (!it || it.status !== "staged") return Promise.reject(new Error("Only staged items can be rejected."));
      it.status = "rejected"; it.reviewed_by = "admin@hrflow.test"; it.reject_reason = reason || "";
      return Promise.resolve(it);
    }
    return apiRequest("POST", `/api/history-import/items/${id}/reject`, { reason: reason || "" });
  },

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

  // ---------- INVOICES (external-salary autopay / consultant fee invoices) ----------
  previewEligibleInvoices(paymentYear, paymentMonth) {
    if (typeof _isMock === "function" && _isMock()) {
      return Promise.resolve([
        { employee_id: "EMP001", employee_name: "Sarah Connor", status: "eligible", amount: 7500 },
        { employee_id: "EMP002", employee_name: "John Doe", status: "eligible", amount: 4500 },
        { employee_id: "EMP003", employee_name: "Alex Rivera", status: "skipped", reason: "No external USD salary" }
      ]);
    }
    return apiRequest("GET", `/api/invoices/eligible?payment_year=${encodeURIComponent(paymentYear)}&payment_month=${encodeURIComponent(paymentMonth)}`);
  },
  generateInvoices(payload) {
    if (typeof _isMock === "function" && _isMock()) {
      return Promise.resolve({
        summary: { generated: 2, already_exists: 0, skipped: 1, failed: 0 },
        results: [
          { employee_id: "EMP001", employee_name: "Sarah Connor", status: "generated", invoice_number: "INV-2026-001" },
          { employee_id: "EMP002", employee_name: "John Doe", status: "generated", invoice_number: "INV-2026-002" }
        ]
      });
    }
    return apiRequest("POST", "/api/invoices/generate", payload);
  },
  generateInvoiceForEmployee(employeeId, payload) {
    if (typeof _isMock === "function" && _isMock()) {
      return Promise.resolve({
        employee_id: employeeId,
        invoice_number: `INV-2026-${String(employeeId).slice(-3)}`,
        status: "generated"
      });
    }
    return apiRequest("POST", `/api/invoices/generate/${encodeURIComponent(employeeId)}`, payload);
  },
  listInvoices(params = {}) {
    if (typeof _isMock === "function" && _isMock()) {
      window._mockInvoices = window._mockInvoices || [
        {
          id: "INV-2026-001",
          invoice_number: "INV-2026-001",
          employee_id: "EMP001",
          employee_name: "Sarah Connor",
          payment_year: 2026,
          payment_month: 10,
          amount_usd: 7500,
          status: "generated",
          created_at: "2026-10-01T10:00:00Z"
        },
        {
          id: "INV-2026-002",
          invoice_number: "INV-2026-002",
          employee_id: "EMP002",
          employee_name: "John Doe",
          payment_year: 2026,
          payment_month: 9,
          amount_usd: 4500,
          status: "generated",
          created_at: "2026-09-01T10:00:00Z"
        }
      ];
      let res = window._mockInvoices;
      if (params && params.employee_id) {
        res = res.filter(inv => String(inv.employee_id) === String(params.employee_id));
      }
      return Promise.resolve(res);
    }
    const q = new URLSearchParams();
    if (params && params.employee_id) q.set("employee_id", params.employee_id);
    if (params && params.payment_year) q.set("payment_year", params.payment_year);
    if (params && params.payment_month) q.set("payment_month", params.payment_month);
    if (params && params.status) q.set("status", params.status);
    const qs = q.toString() ? `?${q.toString()}` : "";
    return apiRequest("GET", `/api/invoices${qs}`);
  },
  getInvoice(invoiceId) {
    if (typeof _isMock === "function" && _isMock()) {
      const inv = (window._mockInvoices || []).find(i => String(i.id) === String(invoiceId)) || {
        id: invoiceId,
        invoice_number: invoiceId,
        amount_usd: 5000,
        status: "generated"
      };
      return Promise.resolve(inv);
    }
    return apiRequest("GET", `/api/invoices/${encodeURIComponent(invoiceId)}`);
  },
  getInvoicePreviewBlobUrl(invoiceId) {
    if (typeof _isMock === "function" && _isMock()) {
      const dummyPdfBlob = new Blob(["%PDF-1.4 Mock PDF content"], { type: "application/pdf" });
      return Promise.resolve(URL.createObjectURL(dummyPdfBlob));
    }
    return _fetchDocumentAsBlobUrl(`/api/invoices/${encodeURIComponent(invoiceId)}/stream`);
  },
  downloadInvoiceFile(invoiceId, suggestedName) {
    if (typeof _isMock === "function" && _isMock()) {
      return Promise.resolve();
    }
    return _downloadDocumentViaFetch(`/api/invoices/${encodeURIComponent(invoiceId)}/stream?download=true`, suggestedName);
  },


  getBankAccount(empId) {
    // Mock mode shows the "Missing" state so the warning card is visible
    if (typeof _isMock === "function" && _isMock()) return Promise.resolve({ has_details: false, bank_name: "", iban: "", swift_code: "" });
    return apiRequest("GET", `/api/employees/${encodeURIComponent(empId)}/bank-account`);
  },
  getBankAccountRevealed(empId) {
    return apiRequest("GET", `/api/employees/${encodeURIComponent(empId)}/bank-account?reveal=true`);
  },
  upsertBankAccount(empId, payload) {
    return apiRequest("PUT", `/api/employees/${encodeURIComponent(empId)}/bank-account`, payload);
  },
  getSocialInsurance(empId) {
    if (typeof _isMock === "function" && _isMock()) {
      window._mockSocialInsurance = window._mockSocialInsurance || {};
      const record = window._mockSocialInsurance[empId] || {
        insured_flag: false,
        insured_base: null,
        currency: "EGP",
        effective_start_date: null
      };
      return Promise.resolve(record);
    }
    return apiRequest("GET", `/api/employees/${encodeURIComponent(empId)}/social-insurance`);
  },
  upsertSocialInsurance(empId, payload) {
    if (typeof _isMock === "function" && _isMock()) {
      window._mockSocialInsurance = window._mockSocialInsurance || {};
      const record = {
        id: 1,
        employee_id: empId,
        insured_flag: !!payload.insured_flag,
        insured_base: payload.insured_base !== null && payload.insured_base !== undefined ? Number(payload.insured_base) : null,
        currency: "EGP",
        effective_start_date: payload.effective_start_date,
        effective_end_date: null,
        created_at: new Date().toISOString()
      };
      window._mockSocialInsurance[empId] = record;
      window._mockSocialInsuranceHistory = window._mockSocialInsuranceHistory || {};
      const hist = window._mockSocialInsuranceHistory[empId] = window._mockSocialInsuranceHistory[empId] || [];
      const active = hist.find(r => !r.effective_end_date);
      if (active && active.effective_start_date === record.effective_start_date) {
        Object.assign(active, record, { id: active.id });
      } else {
        if (active) {
          const d = new Date(record.effective_start_date + "T00:00:00Z");
          d.setUTCDate(d.getUTCDate() - 1);
          active.effective_end_date = d.toISOString().slice(0, 10);
        }
        hist.push({ ...record, id: hist.length + 1 });
      }
      return Promise.resolve(record);
    }
    return apiRequest("PUT", `/api/employees/${encodeURIComponent(empId)}/social-insurance`, payload);
  },
  getSocialInsuranceHistory(empId) {
    if (typeof _isMock === "function" && _isMock()) {
      const rows = (window._mockSocialInsuranceHistory && window._mockSocialInsuranceHistory[empId]) || [];
      return Promise.resolve(rows.slice());
    }
    return apiRequest("GET", `/api/employees/${encodeURIComponent(empId)}/social-insurance/history`);
  },
  // Tax method (progressive | flat rate), effective-dated. Mock mode mirrors the backend guards.
  getTaxMethod(empId) {
    if (typeof _isMock === "function" && _isMock()) {
      const rows = (window._mockTaxMethod && window._mockTaxMethod[empId]) || [];
      return Promise.resolve(rows.find(r => !r.effective_end_date) || null);
    }
    return apiRequest("GET", `/api/employees/${encodeURIComponent(empId)}/tax-method`);
  },
  getTaxMethodHistory(empId) {
    if (typeof _isMock === "function" && _isMock()) {
      const rows = (window._mockTaxMethod && window._mockTaxMethod[empId]) || [];
      return Promise.resolve(rows.slice().sort((a, b) => (b.effective_start_date + b.id).localeCompare(a.effective_start_date + a.id)));
    }
    return apiRequest("GET", `/api/employees/${encodeURIComponent(empId)}/tax-method/history`);
  },
  upsertTaxMethod(empId, payload) {
    if (typeof _isMock === "function" && _isMock()) {
      window._mockTaxMethod = window._mockTaxMethod || {};
      const rows = window._mockTaxMethod[empId] = window._mockTaxMethod[empId] || [];
      const fail = (msg) => Promise.reject(new Error(msg));
      const start = payload.effective_start_date;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start || "")) return fail("effective_start_date must be in YYYY-MM-DD format");
      if (payload.method !== "progressive" && payload.method !== "flat") return fail("method must be one of: progressive, flat");
      let rate = null;
      if (payload.method === "flat") {
        if (payload.flat_rate === null || payload.flat_rate === undefined) return fail("flat_rate is required when the tax method is flat");
        rate = Number(payload.flat_rate);
        if (!(rate > 0 && rate <= 1)) return fail("flat_rate must be greater than 0 and at most 1 (for example 0.10 for 10%)");
      }
      const today = new Date().toISOString().slice(0, 10);
      if (start > today) return fail(`effective_start_date (${start}) cannot be in the future (today is ${today}). Future pre-staging is not permitted.`);
      const active = rows.find(r => !r.effective_end_date);
      if (active && start === active.effective_start_date) {
        active.method = payload.method;
        active.flat_rate = rate;
        active.notes = payload.notes || "";
        return Promise.resolve({ ...active });
      }
      if (active && start < active.effective_start_date) {
        return fail(`New effective_start_date (${start}) must be strictly after the current record start date (${active.effective_start_date})`);
      }
      if (active) {
        const d = new Date(start + "T00:00:00Z");
        d.setUTCDate(d.getUTCDate() - 1);
        active.effective_end_date = d.toISOString().slice(0, 10);
      }
      const rec = {
        id: rows.length + 1, employee_id: empId, method: payload.method, flat_rate: rate,
        effective_start_date: start, effective_end_date: null, notes: payload.notes || "",
        created_by: "mock", created_at: new Date().toISOString()
      };
      rows.push(rec);
      return Promise.resolve({ ...rec });
    }
    return apiRequest("PUT", `/api/employees/${encodeURIComponent(empId)}/tax-method`, payload);
  },
  getExportStatus() {
    return apiRequest("GET", "/api/export/status");
  },
  exportToGoogleSheets(dataset, payload = {}) {
    return apiRequest("POST", `/api/export/${encodeURIComponent(dataset)}/sheets`, payload);
  },
  downloadExportCsv(dataset, params = {}) {
    const q = new URLSearchParams();
    if (params && params.year) q.set("year", params.year);
    if (params && params.month) q.set("month", params.month);
    if (params && params.start_date) q.set("start_date", params.start_date);
    if (params && params.end_date) q.set("end_date", params.end_date);
    if (params && params.status) q.set("status", params.status);
    if (params && params.payment_year) q.set("payment_year", params.payment_year);
    if (params && params.payment_month) q.set("payment_month", params.payment_month);
    const qs = q.toString() ? `?${q.toString()}` : "";
    const filename = `${dataset}_export_${new Date().toISOString().slice(0, 10)}.csv`;
    return _downloadDocumentViaFetch(`/api/export/${encodeURIComponent(dataset)}/csv${qs}`, filename);
  },
  // RBAC Access & Identity
  getPermissionCatalog() { return apiRequest("GET", "/api/access/catalog"); },
  getRoles() { return apiRequest("GET", "/api/access/roles"); },
  createRole(payload) { return apiRequest("POST", "/api/access/roles", payload); },
  updateRole(roleId, payload) { return apiRequest("PUT", `/api/access/roles/${encodeURIComponent(roleId)}`, payload); },
  deleteRole(roleId) { return apiRequest("DELETE", `/api/access/roles/${encodeURIComponent(roleId)}`); },
  getUsers(params) {
    const q = new URLSearchParams();
    if (params && params.filter && params.filter !== "all") q.set("filter", params.filter);
    if (params && params.search) q.set("search", params.search);
    return apiRequest("GET", `/api/access/users${q.toString() ? `?${q.toString()}` : ""}`);
  },
  createExternalUser(payload) { return apiRequest("POST", "/api/access/users", payload); },
  // One assigned role per user. roleId null clears it (linked employees only; Employee access is derived).
  setUserRole(userId, roleId) {
    return apiRequest("PUT", `/api/access/users/${encodeURIComponent(userId)}/role`, { role_id: roleId ?? null });
  },
  archiveUser(userId) { return apiRequest("POST", `/api/access/users/${encodeURIComponent(userId)}/archive`); },

  health() { return apiRequest("GET", "/api/health", null, false); },
  getLastCorrelationId() { return _lastCorrelationId; },
};

