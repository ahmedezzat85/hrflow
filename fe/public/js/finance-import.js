/**
 * fe/public/js/finance-import.js
 * Finance Settings > Import: bulk / historical import (D-033, plan 25).
 * Steps: choose kind -> choose manifest + ZIP -> dry run (nothing is saved) -> review the report -> create Drafts.
 * The files stay in memory between the dry run and the commit; the commit re-validates them on the server.
 * Frontend visibility is not authorization: the backend enforces the permission for every kind.
 */

// Kinds the screen offers. Each slice enables its kind here once its importer exists on the backend.
const FINANCE_IMPORT_ENABLED_KINDS = ["bills"];
const FINANCE_IMPORT_LABELS = { bills: "Vendor bills", cheques: "Cheques", invoices: "Sales invoices" };
const FINANCE_IMPORT_DRAWER_TYPES = { bills: "bill", cheques: "cheque", invoices: "invoice" };
const FINANCE_IMPORT_STATUS = {
  ok: { label: "Ready", group: "settled" },
  warning: { label: "Warning", group: "waiting" },
  error: { label: "Error", group: "problem" },
  duplicate: { label: "Duplicate", group: "closed" },
};

const FinanceImportState = {
  report: null,
  filter: "all",
  limits: null,
  busy: false,
};

function _financeImportCan(key) {
  return typeof SessionInfo === "undefined" || typeof SessionInfo.hasPermission !== "function" || SessionInfo.hasPermission(key);
}

function _financeImportKinds() {
  return FINANCE_IMPORT_ENABLED_KINDS.filter((k) => _financeImportCan(FinanceApi.importPermission(k)));
}

// Shows the Import tab only to users who may import at least one kind. Returns whether it is visible.
function applyFinanceImportVisibility() {
  const visible = _financeImportKinds().length > 0;
  const tab = document.getElementById("subtabSettingsImport");
  if (tab) tab.hidden = !visible;
  return visible;
}

async function loadFinanceImport() {
  if (!applyFinanceImportVisibility()) {
    switchFinanceSettingsSubTab("categories");
    return;
  }
  const select = document.getElementById("financeImportKind");
  if (select && !select.options.length) {
    _financeImportKinds().forEach((k) => select.add(new Option(FINANCE_IMPORT_LABELS[k] || k, k)));
  }
  try {
    FinanceImportState.limits = await FinanceApi.getImportLimits();
  } catch (e) {
    FinanceImportState.limits = null;
  }
  const lim = FinanceImportState.limits;
  const el = document.getElementById("financeImportLimits");
  if (el && lim) {
    el.textContent = `Up to ${lim.max_documents_per_run} documents and ${Math.round(lim.max_request_bytes / 1048576)} MB per run, ${Math.round(lim.max_file_bytes / 1048576)} MB per file. Accepted files: ${lim.allowed_extensions.join(" ")}. Larger packages must be split or compressed.`;
  }
  _financeImportRefreshButtons();
}

function _financeImportFiles() {
  const m = document.getElementById("financeImportManifest");
  const a = document.getElementById("financeImportArchive");
  return { manifest: m && m.files && m.files[0], archive: a && a.files && a.files[0] };
}

function _financeImportKind() {
  const select = document.getElementById("financeImportKind");
  return (select && select.value) || "bills";
}

function _financeImportRefreshButtons() {
  const { manifest, archive } = _financeImportFiles();
  const dry = document.getElementById("financeImportDryRunBtn");
  if (dry) dry.disabled = FinanceImportState.busy || !(manifest && archive);
  const commit = document.getElementById("financeImportCommitBtn");
  const r = FinanceImportState.report;
  const importable = r && r.dry_run && !(r.file_errors || []).length ? (r.rows_ok || 0) + (r.rows_warning || 0) : 0;
  if (commit) {
    commit.disabled = FinanceImportState.busy || importable === 0;
    commit.textContent = importable ? `Create ${importable} draft${importable === 1 ? "" : "s"}` : "Create drafts";
  }
  const dl = document.getElementById("financeImportDownloadReportBtn");
  if (dl) dl.disabled = !r;
}

function onFinanceImportKindChange() {
  _financeImportClearReport();
  _financeImportRefreshButtons();
}

// Choosing other files makes the previous report stale: it must not be committable.
function onFinanceImportFilesChanged() {
  _financeImportClearReport();
  _financeImportRefreshButtons();
}

function _financeImportClearReport() {
  FinanceImportState.report = null;
  FinanceImportState.filter = "all";
  const panel = document.getElementById("financeImportReport");
  if (panel) panel.style.display = "none";
  const result = document.getElementById("financeImportResult");
  if (result) { result.style.display = "none"; result.textContent = ""; }
}

function downloadFinanceImportTemplate() {
  const kind = _financeImportKind();
  _financeImportDownload(`import-template-${kind}.csv`, FinanceApi.getImportTemplateCsv(kind));
}

function _financeImportDownload(filename, text) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Spreadsheet formula characters at the start of a cell are neutralised so the report is safe to open in Excel
function _financeImportCsvCell(value) {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
}

function financeImportReportCsv(report) {
  const head = ["line", "row_ref", "source_file", "status", "messages", "created_id", "duplicate_of"];
  const lines = [head.map(_financeImportCsvCell).join(",")];
  (report.rows || []).forEach((r) => {
    const msgs = (r.findings || []).map((f) => `${f.level}: ${f.message}`).join(" | ");
    lines.push([r.line, r.row_ref, r.source_file, r.status, msgs, r.created_id, r.duplicate_of].map(_financeImportCsvCell).join(","));
  });
  return "﻿" + lines.join("\r\n") + "\r\n";
}

function downloadFinanceImportReport() {
  const r = FinanceImportState.report;
  if (!r) return;
  _financeImportDownload(`import-report-${r.kind}${r.batch_id ? "-batch" + r.batch_id : "-dry-run"}.csv`, financeImportReportCsv(r));
}

async function runFinanceImportDryRun() {
  const { manifest, archive } = _financeImportFiles();
  if (!manifest || !archive || FinanceImportState.busy) return;
  await _financeImportRun(false, manifest, archive);
}

async function _financeImportRun(commit, manifest, archive) {
  FinanceImportState.busy = true;
  _financeImportRefreshButtons();
  const kind = _financeImportKind();
  try {
    const report = commit
      ? await FinanceApi.commitImport(kind, manifest, archive)
      : await FinanceApi.dryRunImport(kind, manifest, archive);
    FinanceImportState.report = report;
    FinanceImportState.filter = "all";
    renderFinanceImportReport();
  } catch (e) {
    // Request-level refusals (over the size limit, no permission) have no report: show them as a file error
    FinanceImportState.report = {
      kind, dry_run: !commit, committed: false, rows: [], rows_total: 0, rows_ok: 0, rows_warning: 0, rows_error: 0, rows_duplicate: 0,
      file_errors: [(e && e.message) || "The import could not be completed."], file_warnings: [], unreferenced_files: [],
    };
    renderFinanceImportReport();
  } finally {
    FinanceImportState.busy = false;
    _financeImportRefreshButtons();
  }
}

async function commitFinanceImport() {
  const r = FinanceImportState.report;
  const { manifest, archive } = _financeImportFiles();
  if (!r || !r.dry_run || !manifest || !archive || FinanceImportState.busy) return;
  const n = (r.rows_ok || 0) + (r.rows_warning || 0);
  const answer = await FinanceCommand.confirmAction({
    title: "Create drafts",
    summary: `<strong>${FinanceUI.esc(FINANCE_IMPORT_LABELS[r.kind] || r.kind)}</strong> · ${n} document${n === 1 ? "" : "s"}`,
    consequence: `${n} Draft${n === 1 ? "" : "s"} will be created with their documents attached. Rows with errors or duplicates are skipped. Nothing is approved, paid or posted to the ledger.`,
    actionLabel: "Create drafts",
    actionClass: "btn btn-fill",
    requireReason: false,
    severity: "warning",
  });
  if (!answer || !answer.confirmed) return;
  await _financeImportRun(true, manifest, archive);
  const done = FinanceImportState.report;
  const result = document.getElementById("financeImportResult");
  if (result && done) {
    if (done.committed) {
      result.textContent = `Batch #${done.batch_id}: ${done.rows_created} draft${done.rows_created === 1 ? "" : "s"} created, ${done.rows_failed} row${done.rows_failed === 1 ? "" : "s"} not created. Review the Drafts before submitting them.`;
    } else {
      result.textContent = "Nothing was created.";
    }
    result.style.display = "block";
  }
}

function setFinanceImportFilter(filter) {
  FinanceImportState.filter = filter;
  renderFinanceImportReport();
}

function renderFinanceImportReport() {
  const r = FinanceImportState.report;
  const panel = document.getElementById("financeImportReport");
  if (!r || !panel) return;
  panel.style.display = "block";
  const esc = FinanceUI.esc.bind(FinanceUI);

  const errBox = document.getElementById("financeImportFileErrors");
  const errs = r.file_errors || [];
  errBox.style.display = errs.length ? "block" : "none";
  errBox.innerHTML = errs.length ? `<div class="fv-callout__title">The package cannot be used</div>${errs.map((m) => `<div>${esc(m)}</div>`).join("")}` : "";

  const warnBox = document.getElementById("financeImportFileWarnings");
  const warns = (r.file_warnings || []).slice();
  warnBox.style.display = warns.length ? "block" : "none";
  warnBox.innerHTML = warns.map((m) => `<div>${esc(m)}</div>`).join("");

  const counts = { all: (r.rows || []).length, ok: r.rows_ok || 0, warning: r.rows_warning || 0, error: r.rows_error || 0, duplicate: r.rows_duplicate || 0 };
  const pills = [["all", "All"], ["ok", "Ready"], ["warning", "Warnings"], ["error", "Errors"], ["duplicate", "Duplicates"]];
  document.getElementById("financeImportStatusPills").innerHTML = pills
    .map(([key, label]) => {
      const active = FinanceImportState.filter === key;
      return `<button type="button" class="filter-tab fv-pill${active ? " active" : ""}" aria-pressed="${active}" data-filter="${key}" onclick="setFinanceImportFilter('${key}')">${label} <span class="fv-pill__count">${counts[key]}</span></button>`;
    })
    .join("");

  const drawerType = FINANCE_IMPORT_DRAWER_TYPES[r.kind];
  const rows = (r.rows || []).filter((row) => FinanceImportState.filter === "all" || row.status === FinanceImportState.filter);
  document.getElementById("financeImportReportBody").innerHTML = rows
    .map((row) => {
      const st = FINANCE_IMPORT_STATUS[row.status] || FINANCE_IMPORT_STATUS.error;
      const msgs = (row.findings || [])
        .map((f) => `<div class="fv-import-msg fv-import-msg--${esc(f.level)}"><span class="fv-import-msg__code">${esc(f.code)}</span> ${esc(f.message)}</div>`)
        .join("");
      const created = row.created_id
        ? `<button type="button" class="btn btn-outline btn-import-open" onclick="FinanceDrawer.open('${drawerType}', ${Number(row.created_id)}, this)">Open draft</button>`
        : "";
      return `<tr data-row-ref="${esc(row.row_ref)}" data-status="${esc(row.status)}">
        <td data-label="Line">${esc(row.line)}</td>
        <td data-label="Row">${esc(row.row_ref)}</td>
        <td data-label="File">${esc(row.source_file || "")}</td>
        <td data-label="Result">${FinanceUI.statusPill(st.group, st.label)}</td>
        <td data-label="Messages">${msgs}</td>
        <td class="col-actions">${created}</td>
      </tr>`;
    })
    .join("");
  _financeImportRefreshButtons();
}

window.applyFinanceImportVisibility = applyFinanceImportVisibility;
window.loadFinanceImport = loadFinanceImport;
window.onFinanceImportKindChange = onFinanceImportKindChange;
window.onFinanceImportFilesChanged = onFinanceImportFilesChanged;
window.downloadFinanceImportTemplate = downloadFinanceImportTemplate;
window.downloadFinanceImportReport = downloadFinanceImportReport;
window.runFinanceImportDryRun = runFinanceImportDryRun;
window.commitFinanceImport = commitFinanceImport;
window.setFinanceImportFilter = setFinanceImportFilter;
window.financeImportReportCsv = financeImportReportCsv;
window.renderFinanceImportReport = renderFinanceImportReport;
window.FinanceImportState = FinanceImportState;
