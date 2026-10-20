/**
 * fe/api/finance/imports-api.js
 * Finance API - Bulk / historical import client and mock handlers (D-033, slices I1-I4).
 *
 * The real endpoints are POST /api/finance/imports/{kind}/dry-run and POST /api/finance/imports/{kind}
 * (multipart: manifest + archive). Mock mode reads the manifest text only; it cannot open the ZIP, so it
 * assumes every source_file is present. Mock mode does NOT validate backend-only behaviour (permissions,
 * magic bytes, duplicate fingerprints, storage); those are covered by backend tests.
 */
(function (root) {
  const _isMock = () => (typeof root._isMock === "function" ? root._isMock() : typeof window !== "undefined" && window.location && window.location.search.includes("mock="));

  const FinanceMockState = root.FinanceMockState || (root.FinanceMockState = {});
  if (!FinanceMockState.importBatches) FinanceMockState.importBatches = [];

  // Column lists mirror be/finance/import_manifest.py (plan 25, section 5)
  const COMMON = ["row_ref", "source_file", "confidence", "review_flags", "notes"];
  const KIND_COLUMNS = {
    bills: ["vendor_name", "bill_number", "issue_date", "due_date", "currency", "category", "total_amount", "description"],
    cheques: ["account", "cheque_number", "payee", "amount", "currency", "issue_date"],
    invoices: ["customer_name", "invoice_number", "issue_date", "due_date", "currency", "description", "amount", "vat_rate"],
  };
  const IMPORT_PERMISSIONS = { bills: "finance.bill.write", cheques: "finance.account.write", invoices: "finance.invoice.write" };
  const LIMITS = {
    max_documents_per_run: 50,
    max_request_bytes: 24 * 1024 * 1024,
    max_file_bytes: 10 * 1024 * 1024,
    allowed_extensions: [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".heic"],
    low_confidence_threshold: 0.8,
  };

  // Minimal quote-aware CSV reader (mock mode only; the backend does the real parsing)
  const _parseCsv = (text) => {
    const rows = [];
    let row = [], cell = "", quoted = false;
    const src = String(text || "").replace(/^﻿/, "");
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (quoted) {
        if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && src[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        rows.push(row); row = [];
      } else cell += ch;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  };

  const _isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
  const _finding = (level, code, message) => ({ level, code, message });
  const _statusOf = (findings) => {
    const levels = findings.map((f) => f.level);
    if (levels.includes("error")) return "error";
    if (levels.includes("duplicate")) return "duplicate";
    if (levels.includes("warning")) return "warning";
    return "ok";
  };

  const _mockReport = async (kind, manifestFile, archiveFile, commit) => {
    const report = {
      kind, dry_run: !commit, committed: false, manifest_name: manifestFile && manifestFile.name, archive_name: archiveFile && archiveFile.name,
      batch_id: null, rows_total: 0, rows_ok: 0, rows_warning: 0, rows_error: 0, rows_duplicate: 0, rows_created: 0, rows_failed: 0,
      file_errors: [], file_warnings: [], unreferenced_files: [], rows: [],
    };
    if (!/\.zip$/i.test((archiveFile && archiveFile.name) || "")) { report.file_errors.push("The archive is not a ZIP file."); return report; }
    const table = _parseCsv(await manifestFile.text()).filter((r) => r.some((c) => String(c).trim()));
    if (!table.length) { report.file_errors.push("The manifest has no header row."); return report; }
    const headers = table[0].map((h) => h.trim());
    const required = COMMON.concat(KIND_COLUMNS[kind] || []).filter((c) => !["source_file", "confidence", "review_flags", "notes", "vat_rate"].includes(c));
    const missing = required.filter((c) => !headers.includes(c));
    if (missing.length) { report.file_errors.push(`The manifest is missing required column(s) for '${kind}': ${missing.join(", ")}.`); return report; }
    if (table.length === 1) { report.file_errors.push("The manifest has a header but no document rows."); return report; }
    if (table.length - 1 > LIMITS.max_documents_per_run) { report.file_errors.push(`The manifest has more than ${LIMITS.max_documents_per_run} documents. Split the batch into smaller runs or compress the PDF copies further, then try again.`); return report; }

    const vendors = (FinanceMockState.vendors || []).map((v) => String(v.name || "").toLowerCase());
    const seenRefs = new Set();
    table.slice(1).forEach((cells, i) => {
      const v = {};
      headers.forEach((h, idx) => { v[h] = String(cells[idx] || "").trim(); });
      const findings = [];
      if (!v.row_ref) findings.push(_finding("error", "row_ref_missing", "row_ref is required"));
      else if (seenRefs.has(v.row_ref)) findings.push(_finding("duplicate", "duplicate_row_ref", `row_ref '${v.row_ref}' is already used`));
      seenRefs.add(v.row_ref);
      if (v.review_flags) findings.push(_finding("warning", "review_flagged", `Flagged for review: ${v.review_flags}`));
      if (kind === "bills") {
        ["issue_date", "due_date"].forEach((f) => { if (v[f] && !_isoDate(v[f])) findings.push(_finding("error", `${f}_invalid`, `${f}: '${v[f]}' is not an ISO date (YYYY-MM-DD)`)); });
        if (v.total_amount && !(Number(v.total_amount) > 0)) findings.push(_finding("error", "total_not_positive", "total_amount must be greater than 0"));
        const known = v.vendor_name && vendors.includes(v.vendor_name.toLowerCase());
        if (!known) {
          if (!v.source_file) findings.push(_finding("error", "vendor_or_file_required", "A Draft needs a known vendor or a source file"));
          else findings.push(_finding("warning", "vendor_unknown", `Vendor '${v.vendor_name}' does not exist; it was not created. Choose a vendor in the Draft`));
        }
        if (/^DUP/i.test(v.bill_number)) findings.push(_finding("duplicate", "duplicate_existing", "Vendor and bill number already exist as bill #3"));
      }
      report.rows.push({
        row_number: i + 1, line: i + 2, row_ref: v.row_ref, source_file: v.source_file || null,
        status: _statusOf(findings), findings, created_id: null,
        duplicate_of: findings.some((f) => f.code === "duplicate_existing") ? 3 : null,
      });
    });

    const count = (s) => report.rows.filter((r) => r.status === s).length;
    if (commit) {
      const importable = report.rows.filter((r) => r.status === "ok" || r.status === "warning");
      if (importable.length) {
        const batchId = FinanceMockState.importBatches.length + 1;
        FinanceMockState.importBatches.push({ id: batchId, kind, rows_created: importable.length });
        report.committed = true;
        report.batch_id = batchId;
        importable.forEach((r, idx) => {
          if (kind === "bills") {
            const src = table.slice(1)[r.row_number - 1];
            const v = {};
            headers.forEach((h, k) => { v[h] = String(src[k] || "").trim(); });
            const id = Math.max(0, ...FinanceMockState.bills.map((b) => b.id)) + 1;
            const vendor = (FinanceMockState.vendors || []).find((x) => String(x.name || "").toLowerCase() === v.vendor_name.toLowerCase());
            FinanceMockState.bills.push({
              id, vendor_id: vendor ? vendor.id : null, vendor_name: vendor ? vendor.name : null, vendor_to_confirm: !vendor,
              suggested_vendor_name: vendor ? null : v.vendor_name || null, bill_number: v.bill_number || null,
              issue_date: v.issue_date || null, due_date: v.due_date || null, status: "draft", currency: v.currency || "EGP",
              subtotal: Number(v.total_amount) || 0, tax_amount: 0, total: Number(v.total_amount) || 0, amount_paid: 0,
              capture_source: "import", is_reviewed: false, import_batch_id: batchId,
              attachment_name: v.source_file || null, notes: `Imported (batch ${batchId}, row ${v.row_ref}).`,
              created_by: "admin@voyance.health", created_at: new Date().toISOString(), lines: [],
            });
            r.created_id = id;
          } else {
            r.created_id = 9000 + idx;
          }
        });
        report.rows_created = importable.length;
      }
    }
    report.rows_total = report.rows.length;
    report.rows_ok = count("ok");
    report.rows_warning = count("warning");
    report.rows_error = count("error");
    report.rows_duplicate = count("duplicate");
    report.rows_failed = report.rows_error + report.rows_duplicate;
    return report;
  };

  const _post = (kind, suffix, manifestFile, archiveFile) => {
    const formData = new FormData();
    formData.append("manifest", manifestFile);
    formData.append("archive", archiveFile);
    return apiRequest("POST", `/api/finance/imports/${encodeURIComponent(kind)}${suffix}`, formData);
  };

  const FinanceImportsApi = {
    importKinds() { return Object.keys(KIND_COLUMNS); },
    importPermission(kind) { return IMPORT_PERMISSIONS[kind]; },
    async getImportLimits() {
      if (_isMock()) {
        const can = (k) => typeof SessionInfo === "undefined" || typeof SessionInfo.hasPermission !== "function" || SessionInfo.hasPermission(k);
        return { kinds: Object.keys(IMPORT_PERMISSIONS).filter((k) => can(IMPORT_PERMISSIONS[k])), ...LIMITS };
      }
      return apiRequest("GET", "/api/finance/imports/limits");
    },
    // Template manifest: header row only (no sample data), built in the browser
    getImportTemplateCsv(kind) {
      const cols = COMMON.concat(KIND_COLUMNS[kind] || []);
      return "﻿" + cols.join(",") + "\r\n";
    },
    async dryRunImport(kind, manifestFile, archiveFile) {
      if (_isMock()) return _mockReport(kind, manifestFile, archiveFile, false);
      return _post(kind, "/dry-run", manifestFile, archiveFile);
    },
    async commitImport(kind, manifestFile, archiveFile) {
      if (_isMock()) return _mockReport(kind, manifestFile, archiveFile, true);
      return _post(kind, "", manifestFile, archiveFile);
    },
  };

  root.FinanceImportsApi = FinanceImportsApi;
  root.FinanceApi = root.FinanceApi || {};
  Object.assign(root.FinanceApi, FinanceImportsApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceImportsApi;
  }
})(typeof window !== "undefined" ? window : globalThis);
