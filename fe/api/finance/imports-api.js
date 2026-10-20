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
    const seenCheques = new Set();
    table.slice(1).forEach((cells, i) => {
      const v = {};
      headers.forEach((h, idx) => { v[h] = String(cells[idx] || "").trim(); });
      const findings = [];
      if (!v.row_ref) findings.push(_finding("error", "row_ref_missing", "row_ref is required"));
      else if (seenRefs.has(v.row_ref)) findings.push(_finding("duplicate", "duplicate_row_ref", `row_ref '${v.row_ref}' is already used`));
      seenRefs.add(v.row_ref);
      if (v.review_flags) findings.push(_finding("warning", "review_flagged", `Flagged for review: ${v.review_flags}`));
      if (kind === "cheques") {
        const acct = (FinanceMockState.accounts || []).find((a) => String(a.account_name || "").toLowerCase() === v.account.toLowerCase() || String(a.id) === v.account);
        if (!v.account) findings.push(_finding("error", "account_missing", "account is required"));
        else if (!acct) findings.push(_finding("error", "account_unknown", `Account '${v.account}' does not exist (use its exact name or id)`));
        else if (acct.account_type !== "bank") findings.push(_finding("error", "account_not_bank", `Cheques must be drawn from a bank account; '${acct.account_name}' is a ${acct.account_type} account`));
        const blank = ["amount", "cheque_number", "issue_date"].filter((f) => !v[f]);
        if (blank.length && v.review_flags) findings.push(_finding("error", "required_blank_flagged", `${blank.join(", ")} blank (flagged: ${v.review_flags}). A cheque cannot be saved without them: enter this one by hand from the scan`));
        else if (blank.length) findings.push(_finding("error", "required_missing", `${blank.join(", ")} is required for a cheque; leave the row out or flag it in review_flags`));
        if (v.issue_date && !_isoDate(v.issue_date)) findings.push(_finding("error", "issue_date_invalid", `issue_date: '${v.issue_date}' is not an ISO date (YYYY-MM-DD)`));
        if (v.amount && !(Number(v.amount) > 0)) findings.push(_finding("error", "amount_not_positive", "amount must be greater than 0"));
        if (!v.payee) findings.push(_finding("error", "payee_required", "payee is required"));
        if (v.confidence !== "" && Number(v.confidence) < LIMITS.low_confidence_threshold) findings.push(_finding("warning", "low_confidence", `Confidence ${Number(v.confidence)} is below ${LIMITS.low_confidence_threshold}: compare this row with the scan`));
        if (!v.source_file) findings.push(_finding("warning", "no_scan", "No source file: the cheque will be flagged as scan missing"));
        if (acct && v.cheque_number) {
          const key = `${acct.id}:${v.cheque_number}`;
          const existing = (FinanceMockState.cheques || []).find((c) => c.account_id === acct.id && c.cheque_number === v.cheque_number);
          if (existing) findings.push(_finding("duplicate", "duplicate_existing", `Cheque ${v.cheque_number} already exists on ${acct.account_name} as cheque #${existing.id}`));
          else if (seenCheques.has(key)) findings.push(_finding("duplicate", "duplicate_in_manifest", "Same account and cheque number as an earlier line"));
          seenCheques.add(key);
        }
      }
      if (kind === "invoices") {
        const cust = (FinanceMockState.customers || []).find((c) => String(c.name || "").toLowerCase() === v.customer_name.toLowerCase());
        const blank = ["customer_name", "invoice_number", "issue_date", "due_date"].filter((f) => !v[f]);
        if (blank.length) findings.push(_finding("error", "required_missing", `${blank.join(", ")} is required for a sales invoice`));
        else if (!cust) findings.push(_finding("error", "customer_unknown", `Customer '${v.customer_name}' does not exist; customers are never created by an import`));
        ["issue_date", "due_date"].forEach((f) => { if (v[f] && !_isoDate(v[f])) findings.push(_finding("error", `${f}_invalid`, `${f}: '${v[f]}' is not an ISO date (YYYY-MM-DD)`)); });
        if (v.issue_date && v.due_date && v.due_date < v.issue_date) findings.push(_finding("error", "due_before_issue", "due_date cannot precede issue_date"));
        if (v.amount && !(Number(v.amount) > 0)) findings.push(_finding("error", "amount_not_positive", "amount must be greater than 0"));
        if (!v.amount) findings.push(_finding("warning", "amount_missing", "amount is blank: the Draft has no lines. Add them in the Draft"));
        if (!v.source_file) findings.push(_finding("warning", "no_scan", "No source file: the Draft has no scan attached"));
        const existing = (FinanceMockState.invoices || []).find((i) => i.invoice_number === v.invoice_number);
        if (existing && cust && existing.customer_id === cust.id) findings.push(_finding("duplicate", "duplicate_existing", `Invoice ${v.invoice_number} already exists for this customer as invoice #${existing.id}`));
        else if (existing) findings.push(_finding("error", "invoice_number_in_use", `Invoice number '${v.invoice_number}' is already used by invoice #${existing.id} (another customer)`));
      }
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
        duplicate_of: (() => { const m = ((findings.find((f) => f.code === "duplicate_existing") || {}).message || "").match(/#(\d+)/); return m ? Number(m[1]) : null; })(),
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
          } else if (kind === "cheques") {
            const src = table.slice(1)[r.row_number - 1];
            const v = {};
            headers.forEach((h, k) => { v[h] = String(src[k] || "").trim(); });
            const acct = (FinanceMockState.accounts || []).find((a) => String(a.account_name || "").toLowerCase() === v.account.toLowerCase() || String(a.id) === v.account);
            const id = Math.max(0, ...(FinanceMockState.cheques || []).map((c) => c.id)) + 1;
            if (!FinanceMockState.cheques) FinanceMockState.cheques = [];
            FinanceMockState.cheques.unshift({
              id, cheque_number: v.cheque_number, account_id: acct.id, account_name: acct.account_name, issue_date: v.issue_date,
              amount: Number(v.amount), currency: v.currency || acct.currency, payee: v.payee, purpose_type: "other", status: "draft",
              posting_policy: "at_issue", fiscal_year: Number(v.issue_date.slice(0, 4)), import_batch_id: batchId,
              notes: `Imported (batch ${batchId}, row ${v.row_ref}).`, created_at: new Date().toISOString(), created_by: "admin@voyance.health",
              attachments: v.source_file ? [{ id: id * 10, cheque_id: id, file_name: v.source_file, file_size: 0, mime_type: "application/pdf", uploaded_by: "admin@voyance.health" }] : [],
            });
            r.created_id = id;
          } else if (kind === "invoices") {
            const src = table.slice(1)[r.row_number - 1];
            const v = {};
            headers.forEach((h, k) => { v[h] = String(src[k] || "").trim(); });
            const cust = (FinanceMockState.customers || []).find((c) => String(c.name || "").toLowerCase() === v.customer_name.toLowerCase());
            const id = Math.max(0, ...(FinanceMockState.invoices || []).map((i) => i.id)) + 1;
            const amount = Number(v.amount) || 0;
            if (!FinanceMockState.invoices) FinanceMockState.invoices = [];
            FinanceMockState.invoices.push({
              id, customer_id: cust.id, customer_name: cust.name, invoice_number: v.invoice_number, issue_date: v.issue_date, due_date: v.due_date,
              status: "draft", currency: v.currency || cust.default_currency || "USD", subtotal: amount, vat_rate: 0, tax_amount: 0, total: amount,
              amount_paid: 0, balance: amount, import_batch_id: batchId, has_scan: !!v.source_file, attachment_count: v.source_file ? 1 : 0,
              notes: `Imported (batch ${batchId}, row ${v.row_ref}).`, created_at: new Date().toISOString(),
              lines: amount ? [{ id: id * 10, invoice_id: id, description: v.description || "Invoice total", quantity: 1, unit_price: amount, line_total: amount }] : [],
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
