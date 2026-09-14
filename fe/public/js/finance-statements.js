// ==========================================
// 9. Bank Statement Imports & Reconciliation (Phase 7)
// ==========================================
// Safe HTML escaping helper
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// Fallback currency formatter
function formatCurrency(amount, currency = "USD") {
  if (typeof FinanceFormat !== "undefined" && typeof FinanceFormat.formatMoney === "function") {
    return FinanceFormat.formatMoney(amount, currency);
  }
  const n = Number(amount) || 0;
  return n.toLocaleString("en-US", { style: "currency", currency: currency || "USD" });
}

function onStatementAccountSelected() {
  const accSel = document.getElementById("stmtUploadAccountId");
  if (!accSel) return;
  // Trigger template filter or reload templates if account specific
  if (typeof loadStatementTemplates === "function") {
    loadStatementTemplates(accSel.value);
  }
}

let _allFinanceStatements = [];
let _currentReconcileImport = null;
let _currentReconcileLines = [];
let _currentReconcileFilter = "all";

async function loadFinanceStatements() {
  const bar = document.getElementById("financeStatementsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const accFilter = document.getElementById("financeStatementAccountFilter");
    const monthFilter = document.getElementById("financeStatementMonthFilter");
    const monthSelect = document.getElementById("financeStatementMonthFilterSelect");
    const yearSelect = document.getElementById("financeStatementYearFilterSelect");

    const accountId = accFilter ? accFilter.value : "";
    let periodMonth = "";
    if (monthFilter && monthFilter.value) {
      periodMonth = monthFilter.value;
    } else if (monthSelect && yearSelect && yearSelect.value && monthSelect.value) {
      periodMonth = `${yearSelect.value}-${monthSelect.value}`;
    }

    // Populate bank account dropdown if empty
    if (accFilter && accFilter.options.length <= 1) {
      try {
        let accounts = [];
        if (typeof FinanceApi.listAccounts === "function") {
          accounts = await FinanceApi.listAccounts();
        } else if (typeof FinanceApi.getAccounts === "function") {
          accounts = await FinanceApi.getAccounts();
        } else if (FinanceState && FinanceState.accounts) {
          accounts = FinanceState.accounts;
        }
        const currentVal = accFilter.value;
        accFilter.innerHTML = '<option value="">All Bank Accounts</option>';
        accounts.forEach((a) => {
          if (a.is_active !== false && (a.account_type || "").toLowerCase() !== "cash") {
            const opt = document.createElement("option");
            opt.value = a.id;
            opt.textContent = `${a.account_name} (${a.currency || "USD"})`;
            accFilter.appendChild(opt);
          }
        });
        accFilter.value = currentVal;
      } catch (e) {
        console.warn("Could not load accounts for statement filter", e);
      }
    }

    _allFinanceStatements = await FinanceApi.listAccountStatements(accountId, periodMonth);
    renderFinanceStatementsTable(_allFinanceStatements);
  } catch (err) {
    console.error("Failed to load statements", err);
    showToast(err.message || "Failed to load bank statements", "error");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function onStatementFilterSelectChange() {
  const monthSelect = document.getElementById("financeStatementMonthFilterSelect");
  const yearSelect = document.getElementById("financeStatementYearFilterSelect");
  const monthFilter = document.getElementById("financeStatementMonthFilter");

  if (!monthFilter) return;

  const m = monthSelect ? monthSelect.value : "";
  const y = yearSelect ? yearSelect.value : "";

  if (y && m) {
    monthFilter.value = `${y}-${m}`;
  } else if (y && !m) {
    monthFilter.value = `${y}`;
  } else if (!y && m) {
    const currentYear = new Date().getFullYear();
    monthFilter.value = `${currentYear}-${m}`;
    if (yearSelect) yearSelect.value = String(currentYear);
  } else {
    monthFilter.value = "";
  }
  loadFinanceStatements();
}

function onStatementFilterChange(source) {
  if (source === "select") {
    onStatementFilterSelectChange();
  } else {
    const monthFilter = document.getElementById("financeStatementMonthFilter");
    const monthSelect = document.getElementById("financeStatementMonthFilterSelect");
    const yearSelect = document.getElementById("financeStatementYearFilterSelect");
    if (monthFilter && monthFilter.value && monthFilter.value.includes("-")) {
      const parts = monthFilter.value.split("-");
      if (yearSelect) yearSelect.value = parts[0];
      if (monthSelect) monthSelect.value = parts[1];
    }
    loadFinanceStatements();
  }
}

function filterFinanceStatements() {
  const query = (document.getElementById("financeStatementSearch")?.value || "").toLowerCase().trim();
  let filtered = _allFinanceStatements;
  if (query) {
    filtered = filtered.filter(
      (s) =>
        (s.account_name || "").toLowerCase().includes(query) ||
        (s.period_month || "").toLowerCase().includes(query) ||
        (s.status || "").toLowerCase().includes(query)
    );
  }
  renderFinanceStatementsTable(filtered);
}

function renderFinanceStatementsTable(statements) {
  const tbody = document.getElementById("statementImportsTableBody");
  const emptyState = document.getElementById("financeStatementsEmpty");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (!statements || statements.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    return;
  }
  if (emptyState) emptyState.style.display = "none";

  statements.forEach((stmt) => {
    const tr = document.createElement("tr");

    const statusBadge =
      stmt.status === "reconciled"
        ? '<span class="status-badge status-success"><i class="fa-solid fa-lock"></i> Reconciled</span>'
        : '<span class="status-badge status-warning"><i class="fa-solid fa-clock"></i> Needs Review</span>';

    const fmtBadge =
      stmt.file_type === "pdf"
        ? '<span class="status-badge status-danger" style="font-size:11px;">PDF</span>'
        : '<span class="status-badge status-info" style="font-size:11px;">CSV</span>';

    const progressPct = stmt.total_lines_count > 0 ? Math.round((stmt.matched_lines_count / stmt.total_lines_count) * 100) : 0;
    const progressText = `${stmt.matched_lines_count || 0} / ${stmt.total_lines_count || 0} (${progressPct}%)`;

    const uploadDate = stmt.created_at ? new Date(stmt.created_at).toLocaleDateString() : "—";

    tr.innerHTML = `
      <td style="font-weight:600;"><i class="fa-regular fa-calendar" style="margin-right:6px;color:var(--text-muted);"></i>${escapeHtml(stmt.period_month)}</td>
      <td style="font-weight:500;">${escapeHtml(stmt.account_name || 'Bank Account #' + stmt.account_id)}</td>
      <td style="text-align:center;">${fmtBadge}</td>
      <td style="text-align:center;">${stmt.total_lines_count || 0}</td>
      <td style="text-align:center;font-weight:600;color:${progressPct === 100 ? 'var(--color-success)' : 'inherit'};">${progressText}</td>
      <td style="text-align:center;">${statusBadge}</td>
      <td>${uploadDate}</td>
      <td style="text-align:center;">
        <button class="btn btn-sm btn-outline btn-review-statement" onclick="openReconciliationModal(${stmt.id})">
          <i class="fa-solid fa-scale-balanced"></i> Review &amp; Reconcile
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function syncStatementUploadPeriod(source) {
  const monthSel = document.getElementById("stmtUploadMonth");
  const yearSel = document.getElementById("stmtUploadYear");
  const periodInput = document.getElementById("stmtUploadPeriodMonth");
  if (!periodInput) return;

  if (source === "select") {
    const y = yearSel && yearSel.value ? yearSel.value : new Date().getFullYear();
    const m = monthSel && monthSel.value ? monthSel.value : String(new Date().getMonth() + 1).padStart(2, "0");
    periodInput.value = `${y}-${m}`;
  } else {
    if (periodInput.value && periodInput.value.includes("-")) {
      const parts = periodInput.value.split("-");
      if (yearSel && parts[0]) yearSel.value = parts[0];
      if (monthSel && parts[1]) monthSel.value = parts[1];
    }
  }
}

// Wizard State
let _activeWizardStep = 1;
let _wizardPreviewData = null;
let _wizardSavedTemplates = [];

function goToWizardStep(stepNum) {
  _activeWizardStep = stepNum;
  for (let s = 1; s <= 4; s++) {
    const pane = document.getElementById(`stmtWizardStep${s}`);
    const indicator = document.getElementById(`stmtStepIndicator${s}`);
    if (pane) pane.style.display = s === stepNum ? "block" : "none";
    if (indicator) {
      if (s === stepNum) {
        indicator.classList.add("active");
        indicator.style.fontWeight = "600";
        indicator.style.color = "var(--primary)";
        const num = indicator.querySelector(".step-num");
        if (num) {
          num.style.background = "var(--primary)";
          num.style.color = "#fff";
        }
      } else if (s < stepNum) {
        indicator.classList.remove("active");
        indicator.style.fontWeight = "500";
        indicator.style.color = "var(--success, #16a34a)";
        const num = indicator.querySelector(".step-num");
        if (num) {
          num.style.background = "var(--success, #16a34a)";
          num.style.color = "#fff";
        }
      } else {
        indicator.classList.remove("active");
        indicator.style.fontWeight = "500";
        indicator.style.color = "var(--text3)";
        const num = indicator.querySelector(".step-num");
        if (num) {
          num.style.background = "var(--bg3, #e2e8f0)";
          num.style.color = "var(--text2)";
        }
      }
    }
  }
}

async function openUploadStatementModal(presetAccountId) {
  _activeWizardStep = 1;
  _wizardPreviewData = null;

  const select = document.getElementById("stmtUploadAccountId");
  if (select) {
    try {
      let accounts = [];
      if (typeof FinanceApi.listAccounts === "function") {
        accounts = await FinanceApi.listAccounts();
      } else if (typeof FinanceApi.getAccounts === "function") {
        accounts = await FinanceApi.getAccounts();
      } else if (FinanceState && FinanceState.accounts) {
        accounts = FinanceState.accounts;
      }
      select.innerHTML = '<option value="">— Select company bank account —</option>';
      accounts.forEach((a) => {
        if (a.is_active !== false && (a.account_type || "").toLowerCase() !== "cash") {
          const opt = document.createElement("option");
          opt.value = a.id;
          opt.textContent = `${a.account_name} (${a.currency || "USD"}) — ${a.bank_name || "Bank"}`;
          if (presetAccountId && String(a.id) === String(presetAccountId)) {
            opt.selected = true;
          }
          select.appendChild(opt);
        }
      });
      if (presetAccountId) select.value = String(presetAccountId);
    } catch (e) {
      console.warn("Could not load accounts", e);
    }
  }

  // Pre-fill current month YYYY-MM
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const periodInput = document.getElementById("stmtUploadPeriodMonth");
  if (periodInput) periodInput.value = `${y}-${m}`;

  // Reset fields
  const fileInput = document.getElementById("stmtUploadFile");
  if (fileInput) fileInput.value = "";
  const openBal = document.getElementById("stmtOpeningBalance");
  if (openBal) openBal.value = "";
  const closeBal = document.getElementById("stmtClosingBalance");
  if (closeBal) closeBal.value = "";
  const allowDup = document.getElementById("stmtAllowDuplicateCheck");
  if (allowDup) allowDup.checked = false;
  const saveTmplCheck = document.getElementById("stmtSaveTemplateCheck");
  if (saveTmplCheck) saveTmplCheck.checked = false;
  const saveTmplName = document.getElementById("stmtSaveTemplateName");
  if (saveTmplName) {
    saveTmplName.value = "";
    saveTmplName.style.display = "none";
  }

  // Load reusable templates
  await loadStatementTemplates();

  goToWizardStep(1);
  openModal("financeStatementUploadModal");
}

function closeUploadStatementModal() {
  closeModal("financeStatementUploadModal");
  _wizardPreviewData = null;
}

async function loadStatementTemplates() {
  const tmplSelect = document.getElementById("stmtWizardTemplateSelect");
  if (!tmplSelect) return;
  tmplSelect.innerHTML = '<option value="">— Auto-detect from file —</option>';
  try {
    const templates = await FinanceApi.getStatementTemplates();
    _wizardSavedTemplates = templates || [];
    _wizardSavedTemplates.forEach((t) => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = `${t.template_name} (${t.bank_name || 'Bank'})`;
      tmplSelect.appendChild(opt);
    });
  } catch (err) {
    console.warn("Could not load mapping templates", err);
  }
}

function onStatementTemplateSelected() {
  const tmplSelect = document.getElementById("stmtWizardTemplateSelect");
  if (!tmplSelect) return;
  const tmplId = tmplSelect.value;
  if (!tmplId) return;

  const tmpl = _wizardSavedTemplates.find((t) => String(t.id) === String(tmplId));
  if (!tmpl) return;

  if (tmpl.date_format && document.getElementById("stmtDateFormat")) {
    document.getElementById("stmtDateFormat").value = tmpl.date_format;
  }
  if (tmpl.decimal_separator && document.getElementById("stmtDecimalSeparator")) {
    document.getElementById("stmtDecimalSeparator").value = tmpl.decimal_separator;
  }
  if (tmpl.encoding && document.getElementById("stmtEncoding")) {
    document.getElementById("stmtEncoding").value = tmpl.encoding;
  }
}

function onStatementFileTypeChange() {
  const type = document.getElementById("stmtUploadFileType")?.value;
  const fileInput = document.getElementById("stmtUploadFile");
  if (fileInput) {
    fileInput.accept = type === "pdf" ? ".pdf" : ".csv";
  }
  const mapContainer = document.getElementById("stmtWizardMappingContainer");
  if (mapContainer) {
    mapContainer.style.display = type === "pdf" ? "none" : "block";
  }
}

function onStatementFileSelected() {
  const fileInput = document.getElementById("stmtUploadFile");
  if (!fileInput || !fileInput.files || !fileInput.files[0]) return;
  const file = fileInput.files[0];
  const ext = file.name.split(".").pop().toLowerCase();
  const typeSel = document.getElementById("stmtUploadFileType");
  if (typeSel) {
    typeSel.value = ext === "pdf" ? "pdf" : "csv";
    onStatementFileTypeChange();
  }
}

function toggleSaveTemplateInput() {
  const check = document.getElementById("stmtSaveTemplateCheck");
  const input = document.getElementById("stmtSaveTemplateName");
  if (!check || !input) return;
  input.style.display = check.checked ? "inline-block" : "none";
}

async function executeStatementPreview() {
  const accountId = document.getElementById("stmtUploadAccountId")?.value;
  const periodMonth = document.getElementById("stmtUploadPeriodMonth")?.value;
  const fileInput = document.getElementById("stmtUploadFile");

  if (!accountId) {
    if (typeof showToast === "function") showToast("Please select a target bank account", "error");
    else if (typeof toast === "function") toast("Please select a target bank account", "fa-solid fa-triangle-exclamation");
    return;
  }
  if (!periodMonth) {
    if (typeof showToast === "function") showToast("Please specify the statement period month", "error");
    else if (typeof toast === "function") toast("Please specify the statement period month", "fa-solid fa-triangle-exclamation");
    return;
  }
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    if (typeof showToast === "function") showToast("Please choose a statement file to upload", "error");
    else if (typeof toast === "function") toast("Please choose a statement file to upload", "fa-solid fa-triangle-exclamation");
    return;
  }

  const openBalVal = document.getElementById("stmtOpeningBalance")?.value;
  const closeBalVal = document.getElementById("stmtClosingBalance")?.value;
  const encoding = document.getElementById("stmtEncoding")?.value || "utf-8";
  const dateFormat = document.getElementById("stmtDateFormat")?.value || "auto";
  const decimalSep = document.getElementById("stmtDecimalSeparator")?.value || ".";

  const formData = new FormData();
  formData.append("period_month", periodMonth);
  formData.append("file", fileInput.files[0]);
  formData.append("encoding", encoding);
  formData.append("date_format", dateFormat);
  formData.append("decimal_separator", decimalSep);
  if (openBalVal) formData.append("opening_balance", openBalVal);
  if (closeBalVal) formData.append("closing_balance", closeBalVal);

  const nextBtn = document.getElementById("btnStmtWizardStep1Next");
  if (nextBtn) {
    nextBtn.disabled = true;
    nextBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Parsing &amp; Validating...';
  }

  try {
    const preview = await FinanceApi.previewStatement(accountId, formData);
    _wizardPreviewData = preview;

    // 1. Populate Step 2 (Map & Preview)
    const fileNameEl = document.getElementById("stmtMetaFileName");
    if (fileNameEl) fileNameEl.innerText = fileInput.files[0].name;
    const formatEl = document.getElementById("stmtMetaFormat");
    if (formatEl) formatEl.innerText = (preview.detected_format || "CSV").toUpperCase();
    const totalFoundEl = document.getElementById("stmtMetaTotalFound");
    if (totalFoundEl) totalFoundEl.innerText = `${preview.validation_summary ? preview.validation_summary.total_rows : 0} rows found`;
    const fpEl = document.getElementById("stmtMetaFingerprint");
    if (fpEl) fpEl.innerText = (preview.file_fingerprint || "").slice(0, 16) + "...";

    // Duplicate File Warning Banner
    const dupWarn = document.getElementById("stmtWizardDuplicateWarning");
    if (dupWarn) dupWarn.style.display = preview.duplicate_file_detected ? "flex" : "none";

    // Populate Column Mapping selects
    populateMappingSelects(preview.detected_headers || [], preview.suggested_mapping || {});

    // Render preview table
    renderWizardPreviewRows(preview.preview_rows || []);

    // 2. Populate Step 3 (Validate & Check Balances)
    const summary = preview.validation_summary || {};
    const validEl = document.getElementById("stmtKpiValid");
    if (validEl) validEl.innerText = summary.valid_count || 0;
    const errEl = document.getElementById("stmtKpiErrors");
    if (errEl) errEl.innerText = summary.error_count || 0;
    const dupEl = document.getElementById("stmtKpiDuplicates");
    if (dupEl) dupEl.innerText = summary.duplicate_lines_count || 0;
    const netEl = document.getElementById("stmtKpiNetActivity");
    if (netEl) {
      const netVal = Number(summary.calculated_net || 0);
      netEl.innerHTML = `${netVal >= 0 ? '+' : '-'}$${Math.abs(netVal).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      netEl.style.color = netVal >= 0 ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)';
    }

    // Balance Math Check
    const openMath = document.getElementById("stmtMathOpening");
    if (openMath) openMath.innerText = summary.opening_balance != null ? `$${Number(summary.opening_balance).toFixed(2)}` : '—';
    const netMath = document.getElementById("stmtMathNet");
    if (netMath) netMath.innerText = `$${Number(summary.calculated_net || 0).toFixed(2)}`;
    const calcCloseMath = document.getElementById("stmtMathCalcClosing");
    if (calcCloseMath) calcCloseMath.innerText = summary.expected_closing_balance != null ? `$${Number(summary.expected_closing_balance).toFixed(2)}` : '—';
    const statedCloseMath = document.getElementById("stmtMathStatedClosing");
    if (statedCloseMath) statedCloseMath.innerText = summary.closing_balance != null ? `$${Number(summary.closing_balance).toFixed(2)}` : '—';

    const statusBadge = document.getElementById("stmtBalanceStatusBadge");
    const deltaRow = document.getElementById("stmtMathDeltaRow");
    const deltaVal = document.getElementById("stmtMathDeltaVal");

    if (summary.opening_balance != null && summary.closing_balance != null) {
      if (summary.balance_matches) {
        if (statusBadge) {
          statusBadge.className = "badge badge-approved";
          statusBadge.innerText = "Balanced";
        }
        if (deltaRow) deltaRow.style.display = "none";
      } else {
        if (statusBadge) {
          statusBadge.className = "badge badge-rejected";
          statusBadge.innerText = "Difference";
        }
        if (deltaRow) {
          deltaRow.style.display = "block";
          if (deltaVal) deltaVal.innerText = `$${Number(summary.balance_delta || 0).toFixed(2)}`;
        }
      }
    } else {
      if (statusBadge) {
        statusBadge.className = "badge badge-pending";
        statusBadge.innerText = "Unverified (No Balances)";
      }
      if (deltaRow) deltaRow.style.display = "none";
    }

    // Malformed row errors diagnosis
    const errors = preview.errors || [];
    const errorsBox = document.getElementById("stmtErrorsContainer");
    const errorsTbody = document.getElementById("stmtErrorsTbody");
    if (errorsBox && errorsTbody) {
      if (errors.length > 0) {
        errorsBox.style.display = "block";
        errorsTbody.innerHTML = errors.map((e) => `
          <tr>
            <td><strong>#${e.row_index}</strong></td>
            <td><code>${e.column}</code></td>
            <td style="color:var(--danger);font-family:monospace;">${e.value || '—'}</td>
            <td>
              <div>${e.message}</div>
              ${e.correction_path ? `<div style="font-size:11px;color:var(--text3);margin-top:2px;"><i class="fa-solid fa-wrench"></i> ${e.correction_path}</div>` : ''}
            </td>
          </tr>
        `).join("");
      } else {
        errorsBox.style.display = "none";
        errorsTbody.innerHTML = "";
      }
    }

    // PDF alert
    const pdfAlert = document.getElementById("stmtPdfReviewAlert");
    if (pdfAlert) pdfAlert.style.display = preview.is_review_required ? "flex" : "none";

    // 3. Populate Step 4 (Confirm)
    const accSelect = document.getElementById("stmtUploadAccountId");
    const confirmAcc = document.getElementById("stmtConfirmAccountName");
    if (confirmAcc) confirmAcc.innerText = accSelect ? accSelect.selectedOptions[0]?.text || "Bank Account" : "Bank Account";
    const confirmPeriod = document.getElementById("stmtConfirmPeriod");
    if (confirmPeriod) confirmPeriod.innerText = periodMonth;
    const confirmLines = document.getElementById("stmtConfirmLinesCount");
    if (confirmLines) confirmLines.innerText = summary.valid_count || 0;

    goToWizardStep(2);
  } catch (err) {
    console.error("Preview failed:", err);
    if (typeof showToast === "function") showToast(err.message || "Failed to preview statement file", "error");
    else if (typeof toast === "function") toast("Preview failed: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (nextBtn) {
      nextBtn.disabled = false;
      nextBtn.innerHTML = '<i class="fa-solid fa-arrow-right"></i> Next: Upload &amp; Preview';
    }
  }
}

function populateMappingSelects(headers, suggested) {
  const fields = [
    { id: "wizardMapDateCol", key: "date_col", required: true },
    { id: "wizardMapDescCol", key: "description_col", required: true },
    { id: "wizardMapRefCol", key: "reference_col", required: false },
    { id: "wizardMapDebitCol", key: "debit_col", required: false },
    { id: "wizardMapCreditCol", key: "credit_col", required: false },
    { id: "wizardMapAmountCol", key: "amount_col", required: false },
  ];

  fields.forEach(({ id, key, required }) => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">— None / Auto —</option>' +
      headers.map((h) => `<option value="${h}">${h}</option>`).join("");
    
    if (suggested && suggested[key]) {
      sel.value = suggested[key];
    }
  });
}

function renderWizardPreviewRows(rows) {
  const tbody = document.getElementById("stmtWizardPreviewTbody");
  if (!tbody) return;
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:14px;">No rows could be parsed. Check column mapping.</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map((r) => {
    const isCredit = r.direction === "in";
    const dirBadge = isCredit
      ? '<span class="badge" style="background:#f0fdf4; color:#16a34a; font-weight:600;"><i class="fa-solid fa-arrow-down"></i> Inflow</span>'
      : '<span class="badge" style="background:#fef2f2; color:#dc2626; font-weight:600;"><i class="fa-solid fa-arrow-up"></i> Outflow</span>';
    const amtColor = isCredit ? '#16a34a' : 'inherit';

    return `
      <tr>
        <td style="color:var(--text3); font-family:monospace;">#${r.row_index}</td>
        <td style="font-family:monospace;">${r.raw_date}</td>
        <td>${r.raw_description}</td>
        <td style="font-family:monospace;font-size:11px;">${r.raw_reference || '—'}</td>
        <td style="text-align:center;">${dirBadge}</td>
        <td style="text-align:right; font-weight:600; color:${amtColor};">$${Number(r.raw_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
      </tr>
    `;
  }).join("");
}

function recalculatePreviewWithMapping() {
  // Triggers re-preview with updated custom mapping
  executeStatementPreview();
}

function exportStatementRejectedRows() {
  if (!_wizardPreviewData || !_wizardPreviewData.errors || !_wizardPreviewData.errors.length) {
    if (typeof showToast === "function") showToast("No rejected lines to export.", "info");
    return;
  }

  const errors = _wizardPreviewData.errors;
  const headers = ["Row Index", "Column", "Value", "Error Diagnostic", "Correction Path"];
  const csvRows = [headers.join(",")];

  errors.forEach((e) => {
    const safeVal = `"${String(e.value || '').replace(/"/g, '""')}"`;
    const safeMsg = `"${String(e.message || '').replace(/"/g, '""')}"`;
    const safePath = `"${String(e.correction_path || '').replace(/"/g, '""')}"`;
    csvRows.push([e.row_index, e.column, safeVal, safeMsg, safePath].join(","));
  });

  const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `statement_rejected_rows_${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function commitStatementImport(reviewState = "needs_review") {
  const accountId = document.getElementById("stmtUploadAccountId")?.value;
  const periodMonth = document.getElementById("stmtUploadPeriodMonth")?.value;
  const fileInput = document.getElementById("stmtUploadFile");

  if (!accountId || !periodMonth || !fileInput || !fileInput.files || !fileInput.files[0]) {
    if (typeof showToast === "function") showToast("Missing statement file or parameters.", "error");
    return;
  }

  const openBalVal = document.getElementById("stmtOpeningBalance")?.value;
  const closeBalVal = document.getElementById("stmtClosingBalance")?.value;
  const encoding = document.getElementById("stmtEncoding")?.value || "utf-8";
  const dateFormat = document.getElementById("stmtDateFormat")?.value || "auto";
  const decimalSep = document.getElementById("stmtDecimalSeparator")?.value || ".";
  const allowDup = document.getElementById("stmtAllowDuplicateCheck")?.checked || false;

  const mapping = {};
  const dateCol = document.getElementById("wizardMapDateCol")?.value;
  const descCol = document.getElementById("wizardMapDescCol")?.value;
  const debitCol = document.getElementById("wizardMapDebitCol")?.value;
  const creditCol = document.getElementById("wizardMapCreditCol")?.value;
  const amountCol = document.getElementById("wizardMapAmountCol")?.value;
  const refCol = document.getElementById("wizardMapRefCol")?.value;

  if (dateCol) mapping.date_col = dateCol;
  if (descCol) mapping.description_col = descCol;
  if (debitCol) mapping.debit_col = debitCol;
  if (creditCol) mapping.credit_col = creditCol;
  if (amountCol) mapping.amount_col = amountCol;
  if (refCol) mapping.reference_col = refCol;

  const formData = new FormData();
  formData.append("period_month", periodMonth);
  formData.append("file", fileInput.files[0]);
  formData.append("encoding", encoding);
  formData.append("date_format", dateFormat);
  formData.append("decimal_separator", decimalSep);
  formData.append("allow_duplicate", allowDup ? "true" : "false");
  formData.append("review_state", reviewState);
  if (openBalVal) formData.append("opening_balance", openBalVal);
  if (closeBalVal) formData.append("closing_balance", closeBalVal);
  if (Object.keys(mapping).length > 0) {
    formData.append("column_mapping", JSON.stringify(mapping));
  }

  // Save template if user requested
  const saveTmpl = document.getElementById("stmtSaveTemplateCheck")?.checked;
  const tmplName = (document.getElementById("stmtSaveTemplateName")?.value || "").trim();
  if (saveTmpl && tmplName) {
    try {
      await FinanceApi.saveStatementTemplate({
        template_name: tmplName,
        account_id: parseInt(accountId, 10),
        ...mapping,
        date_format: dateFormat,
        decimal_separator: decimalSep,
        encoding,
      });
    } catch (e) {
      console.warn("Failed to save template:", e);
    }
  }

  const commitBtn = document.getElementById("btnConfirmCommitStatement");
  if (commitBtn) {
    commitBtn.disabled = true;
    commitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Committing Statement...';
  }

  try {
    const result = await FinanceApi.uploadStatement(accountId, formData);
    const msg = reviewState === "resumable"
      ? `Statement saved as draft (${result.total_lines_count || 0} lines).`
      : `Statement imported successfully (${result.total_lines_count || 0} lines).`;
    if (typeof showToast === "function") showToast(msg, "success");
    else if (typeof toast === "function") toast(msg, "fa-solid fa-circle-check");

    closeUploadStatementModal();
    await loadFinanceStatements();

    if (result && result.id && typeof openReconciliationModal === "function") {
      openReconciliationModal(result.id);
    }
  } catch (err) {
    console.error("Statement commit failed:", err);
    if (typeof showToast === "function") showToast(err.message || "Failed to commit statement import", "error");
    else if (typeof toast === "function") toast("Failed: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (commitBtn) {
      commitBtn.disabled = false;
      commitBtn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Confirm &amp; Commit Import';
    }
  }
}

// Reconciliation Review Modal
async function openReconciliationModal(importId) {
  const loading = document.getElementById("reconcileLoadingBar");
  if (loading) loading.style.display = "block";
  openModal("financeReconciliationModal");

  try {
    const [imp, lines, summary] = await Promise.all([
      FinanceApi.getStatement(importId),
      FinanceApi.getStatementLines(importId),
      FinanceApi.getStatementSummary ? FinanceApi.getStatementSummary(importId) : null,
    ]);

    _currentReconcileImport = imp;
    _currentReconcileLines = lines;
    _currentReconcileFilter = "all";

    updateReconciliationHeader(imp, summary);
    renderReconciliationLinesTable(lines);
  } catch (err) {
    console.error("Failed to load reconciliation details", err);
    showToast(err.message || "Failed to load statement reconciliation details", "error");
    closeReconciliationModal();
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function closeReconciliationModal() {
  closeModal("financeReconciliationModal");
  _currentReconcileImport = null;
  _currentReconcileLines = [];
}

async function refreshReconciliationWorkspace() {
  if (!_currentReconcileImport) return;
  try {
    const [imp, lines, summary] = await Promise.all([
      FinanceApi.getStatement(_currentReconcileImport.id),
      FinanceApi.getStatementLines(_currentReconcileImport.id),
      FinanceApi.getStatementSummary ? FinanceApi.getStatementSummary(_currentReconcileImport.id) : null,
    ]);
    _currentReconcileImport = imp;
    _currentReconcileLines = lines;
    updateReconciliationHeader(imp, summary);
    filterReconciliationLines(_currentReconcileFilter);
    await loadFinanceStatements();
  } catch (err) {
    console.warn("Failed refreshing reconciliation workspace", err);
  }
}

function updateReconciliationHeader(imp, summary = null) {
  if (!imp) return;
  const pEl = document.getElementById("reconcileSummaryPeriod");
  const aEl = document.getElementById("reconcileSummaryAccount");
  const prEl = document.getElementById("reconcileSummaryProgress");
  const stEl = document.getElementById("reconcileSummaryStatus");
  const btnFinal = document.getElementById("btnFinalizeReconciliation");

  if (pEl) pEl.textContent = imp.period_month || "Period";
  if (aEl) aEl.textContent = imp.account_name || "Account";
  if (prEl) prEl.textContent = `${imp.matched_lines_count || 0} / ${imp.total_lines_count || 0} Resolved`;

  _currentReconcileSummary = summary;
  const isClosed = imp.status === "closed";
  const isReconciled = imp.status === "reconciled" || isClosed;
  const isReopened = imp.status === "reopened";

  if (stEl) {
    if (isClosed) {
      stEl.textContent = "Closed";
      stEl.className = "status-badge status-neutral";
    } else if (imp.status === "reconciled") {
      stEl.textContent = "Reconciled";
      stEl.className = "status-badge status-success";
    } else if (isReopened) {
      stEl.textContent = "Reopened";
      stEl.className = "status-badge status-warning";
    } else {
      stEl.textContent = "Needs Review";
      stEl.className = "status-badge status-warning";
    }
  }

  // Update Live KPI Bar
  const closeValEl = document.getElementById("reconcileStatementClosingVal");
  const bookValEl = document.getElementById("reconcileBookBalanceVal");
  const diffValEl = document.getElementById("reconcileDifferenceVal");
  const resAmtEl = document.getElementById("reconcileResolvedAmountVal");
  const remCountEl = document.getElementById("reconcileRemainingCountVal");

  if (closeValEl) {
    closeValEl.textContent = imp.closing_balance !== null && imp.closing_balance !== undefined
      ? formatCurrency(imp.closing_balance)
      : "Not set";
  }

  if (summary) {
    if (bookValEl) bookValEl.textContent = formatCurrency(summary.book_balance || 0);
    if (diffValEl) {
      if (summary.difference !== null && summary.difference !== undefined) {
        const diff = summary.difference;
        diffValEl.textContent = formatCurrency(diff);
        if (Math.abs(diff) < 0.01) {
          diffValEl.style.color = "var(--color-success, #16a34a)";
        } else {
          diffValEl.style.color = "var(--color-danger, #ef4444)";
        }
      } else {
        diffValEl.textContent = "—";
        diffValEl.style.color = "inherit";
      }
    }
    if (resAmtEl) resAmtEl.textContent = formatCurrency(summary.resolved_amount || 0);
    if (remCountEl) remCountEl.textContent = String(summary.unmatched_lines_count || 0);
  } else {
    // Fallback calculation from lines
    const active = _currentReconcileLines.filter((l) => l.status !== "split");
    const resolvedLines = active.filter((l) => ["matched", "created", "ignored"].includes(l.status));
    const unmatchedLines = active.filter((l) => l.status === "unmatched");
    const resAmt = resolvedLines.reduce((s, l) => s + (l.raw_amount || 0), 0);
    if (resAmtEl) resAmtEl.textContent = formatCurrency(resAmt);
    if (remCountEl) remCountEl.textContent = String(unmatchedLines.length);
  }

  const btnReopen = document.getElementById("reconcileReopenPeriodBtn");
  if (btnFinal) {
    if (isClosed) {
      btnFinal.style.display = "none";
    } else {
      btnFinal.style.display = "inline-flex";
      btnFinal.disabled = false;
      btnFinal.innerHTML = '<i class="fa-solid fa-lock"></i> Close Period';
    }
  }
  if (btnReopen) {
    btnReopen.style.display = isClosed ? "inline-flex" : "none";
  }
}

function filterReconciliationLines(filterType, btn) {
  _currentReconcileFilter = filterType;
  const tabs = document.querySelectorAll("#reconcileLineFilterTabs .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");

  let filtered = _currentReconcileLines;
  if (filterType === "unmatched") {
    filtered = filtered.filter((l) => l.status === "unmatched");
  } else if (filterType === "matched") {
    filtered = filtered.filter((l) => ["matched", "created", "split"].includes(l.status));
  } else if (filterType === "ignored") {
    filtered = filtered.filter((l) => l.status === "ignored");
  }

  const countEl = document.getElementById("reconcileFilterCount");
  if (countEl) {
    countEl.textContent = `Showing ${filtered.length} of ${_currentReconcileLines.length} lines`;
  }
  renderReconciliationLinesTable(filtered);
}

function renderReconciliationLinesTable(lines) {
  const tbody = document.getElementById("reconciliationLinesBody");
  const emptyState = document.getElementById("reconcileEmptyState");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (!lines || lines.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    return;
  }
  if (emptyState) emptyState.style.display = "none";

  const isStmtReconciled = _currentReconcileImport && _currentReconcileImport.status === "reconciled";

  lines.forEach((line) => {
    const tr = document.createElement("tr");
    tr.id = `stmtLineRow_${line.id}`;

    const isCredit = line.direction === "in";
    const amountClass = isCredit ? "text-success" : "text-danger";
    const amountPrefix = isCredit ? "+" : "-";
    const formattedAmount = `${amountPrefix}${formatCurrency(line.raw_amount)}`;

    // Status Badge
    let statusBadge = "";
    if (line.status === "matched") {
      statusBadge = '<span class="status-badge status-success" style="font-size:11px;"><i class="fa-solid fa-check"></i> Matched</span>';
    } else if (line.status === "created") {
      statusBadge = '<span class="status-badge status-primary" style="font-size:11px;"><i class="fa-solid fa-plus"></i> Created</span>';
    } else if (line.status === "ignored") {
      statusBadge = '<span class="status-badge status-neutral" style="font-size:11px;"><i class="fa-solid fa-ban"></i> Ignored</span>';
    } else if (line.status === "split") {
      statusBadge = '<span class="status-badge" style="background:#f5f3ff;color:#7c3aed;font-size:11px;"><i class="fa-solid fa-arrows-split-up-and-left"></i> Split</span>';
    } else {
      statusBadge = '<span class="status-badge status-warning" style="font-size:11px;"><i class="fa-solid fa-circle-exclamation"></i> Unmatched</span>';
    }

    // Side-by-side: Left side is statement detail
    const statementDetailHtml = `
      <div style="display:flex;flex-direction:column;gap:3px;">
        <div style="display:flex;align-items:center;gap:6px;">
          <span style="font-weight:600;font-size:12px;font-family:monospace;">${escapeHtml(line.raw_date)}</span>
          <span class="status-badge" style="font-size:10px;padding:1px 6px;">#${line.id}</span>
        </div>
        <div style="font-weight:600;font-size:13px;color:var(--text-primary);">${escapeHtml(line.raw_description || 'Bank transaction')}</div>
        ${line.raw_reference ? `<div style="font-size:11px;color:var(--text-muted);"><i class="fa-solid fa-hashtag"></i> Ref: <span style="font-family:monospace;">${escapeHtml(line.raw_reference)}</span></div>` : ''}
        ${line.notes ? `<div style="font-size:11px;font-style:italic;color:var(--text-muted);"><i class="fa-solid fa-comment-dots"></i> ${escapeHtml(line.notes)}</div>` : ''}
      </div>
    `;

    // Side-by-side: Right side is ranked candidate matches with explanation rationale
    let matchColContent = "";
    if (line.status === "unmatched") {
      const suggestions = line.suggested_matches || [];
      if (suggestions.length > 0) {
        matchColContent = `
          <div style="display:flex;flex-direction:column;gap:6px;">
            <select id="lineMatchSelect_${line.id}" class="form-control" style="width:100%;font-size:12px;padding:4px 8px;height:34px;" onchange="onReconcileMatchSelectChange(${line.id})">
              ${suggestions
                .map(
                  (s, idx) => `
                <option value="${s.transaction_id || ''}" data-cheque="${s.cheque_id || ''}" data-score="${s.score}" data-reason="${escapeHtml(s.reason)}" ${idx === 0 ? 'selected' : ''}>
                  ${s.match_type === 'cheque' ? 'Cheque' : 'Ledger Tx'} [${Math.round(s.score * 100)}%] ${escapeHtml(s.description)} (${formatCurrency(s.amount)})
                </option>
              `
                )
                .join("")}
            </select>
            <div id="matchRationaleText_${line.id}" style="font-size:11px;color:var(--primary, #2563eb);background:rgba(37,99,235,0.06);padding:4px 8px;border-radius:4px;display:flex;align-items:center;gap:5px;">
              <i class="fa-solid fa-wand-magic-sparkles"></i> <span>${escapeHtml(suggestions[0].reason || 'Candidate match')}</span>
            </div>
          </div>
        `;
      } else {
        matchColContent = '<span style="color:var(--text-muted);font-size:12px;font-style:italic;"><i class="fa-solid fa-circle-question"></i> No automated ledger or cheque candidate found</span>';
      }
    } else if (line.status === "matched") {
      if (line.matched_cheque_id) {
        matchColContent = `
          <div style="font-size:12px;color:var(--color-success);">
            <strong><i class="fa-solid fa-money-check"></i> Linked Issued Cheque #${line.matched_cheque_id}</strong>
            <div style="font-size:11px;color:var(--text-muted);">Status auto-updated to Cleared on ${escapeHtml(line.raw_date)}</div>
          </div>
        `;
      } else {
        matchColContent = `
          <div style="font-size:12px;color:var(--color-success);">
            <strong><i class="fa-solid fa-link"></i> Linked to Continuous Ledger Tx #${line.matched_transaction_id}</strong>
          </div>
        `;
      }
    } else if (line.status === "created") {
      matchColContent = `<span style="color:var(--color-primary);font-size:12px;font-weight:600;"><i class="fa-solid fa-receipt"></i> Created Continuous Ledger Entry</span>`;
    } else if (line.status === "ignored") {
      matchColContent = `
        <div style="font-size:12px;color:var(--text-muted);">
          <div><i class="fa-solid fa-ban"></i> <em>Excluded from continuous cash book</em></div>
          <div style="font-size:11px;font-weight:500;">Audit Reason: ${escapeHtml(line.notes || 'Documented')}</div>
        </div>
      `;
    } else if (line.status === "split") {
      const children = line.child_lines || [];
      matchColContent = `
        <div style="font-size:12px;">
          <div style="font-weight:600;color:#7c3aed;"><i class="fa-solid fa-arrows-split-up-and-left"></i> Split into ${children.length || 'multiple'} ledger portions</div>
          ${children.map((c) => `<div style="font-size:11px;color:var(--text-muted);">· ${escapeHtml(c.raw_description)}: ${formatCurrency(c.raw_amount)}</div>`).join("")}
        </div>
      `;
    }

    // Actions Column: 1-Click Match, Create, Split, Ignore-with-reason
    let actionButtons = "";
    if (!isStmtReconciled && line.status === "unmatched") {
      const hasMatches = (line.suggested_matches || []).length > 0;
      actionButtons = `
        <div style="display:flex;gap:5px;justify-content:center;flex-wrap:wrap;">
          ${
            hasMatches
              ? `<button class="btn btn-sm btn-fill btn-success btn-confirm-match" style="padding:4px 8px;font-size:11px;" onclick="confirmLineMatch(${line.id})" title="Confirm this candidate match"><i class="fa-solid fa-check"></i> Match</button>`
              : ""
          }
          <button class="btn btn-sm btn-outline btn-create-entry" style="padding:4px 8px;font-size:11px;" onclick="openCreateEntryForLine(${line.id})" title="Post new ledger entry"><i class="fa-solid fa-plus"></i> Create</button>
          <button class="btn btn-sm btn-outline btn-split-line" style="padding:4px 8px;font-size:11px;color:#7c3aed;" onclick="openSplitModalForLine(${line.id})" title="Split into multiple allocations"><i class="fa-solid fa-arrows-split-up-and-left"></i> Split</button>
          <button class="btn btn-sm btn-outline btn-ignore-line" style="padding:4px 8px;font-size:11px;color:var(--color-danger, #ef4444);" onclick="openIgnoreModalForLine(${line.id})" title="Exclude line with audit reason"><i class="fa-solid fa-ban"></i></button>
        </div>
      `;
    } else {
      actionButtons = `<span style="font-size:11px;color:var(--text-muted);">${escapeHtml(line.notes || 'Resolved')}</span>`;
    }

    tr.innerHTML = `
      <td>${statementDetailHtml}</td>
      <td style="text-align:right;font-weight:700;font-size:13px;" class="${amountClass}">${formattedAmount}</td>
      <td style="text-align:center;">${statusBadge}</td>
      <td>${matchColContent}</td>
      <td style="text-align:center;">${actionButtons}</td>
    `;
    tbody.appendChild(tr);
  });
}

function onReconcileMatchSelectChange(lineId) {
  const sel = document.getElementById(`lineMatchSelect_${lineId}`);
  const rationaleEl = document.getElementById(`matchRationaleText_${lineId}`);
  if (!sel || !rationaleEl) return;
  const opt = sel.selectedOptions && sel.selectedOptions[0];
  if (opt) {
    const reason = opt.getAttribute("data-reason") || "Candidate match";
    rationaleEl.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> <span>${escapeHtml(reason)}</span>`;
  }
}

async function confirmLineMatch(lineId) {
  if (!_currentReconcileImport) return;
  const select = document.getElementById(`lineMatchSelect_${lineId}`);
  let txId = null;
  let chqId = null;

  if (select && select.selectedOptions && select.selectedOptions[0]) {
    const opt = select.selectedOptions[0];
    txId = opt.value ? parseInt(opt.value, 10) : null;
    chqId = opt.getAttribute("data-cheque") ? parseInt(opt.getAttribute("data-cheque"), 10) : null;
  }

  try {
    const updated = await FinanceApi.resolveStatementLine(_currentReconcileImport.id, lineId, {
      action: "match",
      matched_transaction_id: txId,
      matched_cheque_id: chqId,
      notes: chqId ? `Matched with issued Cheque #${chqId}` : `Matched with Ledger Tx #${txId}`,
    });

    showToast("Statement line matched successfully", "success");
    await refreshReconciliationWorkspace();
  } catch (err) {
    console.error("Match resolution failed", err);
    showToast(err.message || "Failed to confirm match", "error");
  }
}

function openIgnoreModalForLine(lineId) {
  const line = _currentReconcileLines.find((l) => l.id === lineId);
  if (!line) return;

  const idEl = document.getElementById("reconcileIgnoreLineId");
  const summaryEl = document.getElementById("reconcileIgnoreSummaryLine");
  const reasonEl = document.getElementById("reconcileIgnoreReason");

  if (idEl) idEl.value = line.id;
  if (reasonEl) reasonEl.value = "";
  if (summaryEl) {
    summaryEl.innerHTML = `
      <strong>${escapeHtml(line.raw_date)}</strong> · <span>${escapeHtml(line.raw_description)}</span> · <strong class="${line.direction === 'in' ? 'text-success' : 'text-danger'}">${line.direction === 'in' ? '+' : '-'}${formatCurrency(line.raw_amount)}</strong>
    `;
  }
  openModal("reconcileIgnoreModal");
}

function closeReconcileIgnoreModal() {
  closeModal("reconcileIgnoreModal");
}

async function handleReconcileIgnoreSubmit(e) {
  e.preventDefault();
  if (!_currentReconcileImport) return;

  const lineId = parseInt(document.getElementById("reconcileIgnoreLineId").value, 10);
  const reason = (document.getElementById("reconcileIgnoreReason").value || "").trim();

  if (!reason) {
    showToast("A mandatory audit reason is required to exclude a statement line.", "error");
    return;
  }

  try {
    await FinanceApi.resolveStatementLine(_currentReconcileImport.id, lineId, {
      action: "ignore",
      notes: reason,
    });

    showToast("Statement line excluded with audit reason", "info");
    closeReconcileIgnoreModal();
    await refreshReconciliationWorkspace();
  } catch (err) {
    console.error("Ignore failed", err);
    showToast(err.message || "Failed to ignore line", "error");
  }
}

// Split statement line functionality
let _activeSplitSourceLine = null;

function openSplitModalForLine(lineId) {
  const line = _currentReconcileLines.find((l) => l.id === lineId);
  if (!line) return;

  _activeSplitSourceLine = line;
  const idEl = document.getElementById("reconcileSplitLineId");
  const srcAmtEl = document.getElementById("reconcileSplitSourceAmountVal");

  if (idEl) idEl.value = line.id;
  if (srcAmtEl) srcAmtEl.textContent = formatCurrency(line.raw_amount);

  const container = document.getElementById("reconcileSplitPortionsList");
  if (container) {
    container.innerHTML = "";
    // Default to two split portions
    const half = (line.raw_amount / 2).toFixed(2);
    const rest = (line.raw_amount - parseFloat(half)).toFixed(2);
    addReconcileSplitRow(half, `${line.raw_description} (Part 1)`);
    addReconcileSplitRow(rest, `${line.raw_description} (Part 2)`);
  }
  updateReconcileSplitDiff();
  openModal("reconcileSplitModal");
}

function closeReconcileSplitModal() {
  closeModal("reconcileSplitModal");
  _activeSplitSourceLine = null;
}

function addReconcileSplitRow(presetAmount = "", presetDesc = "") {
  const container = document.getElementById("reconcileSplitPortionsList");
  if (!container) return;

  const rowId = "splitRow_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
  const div = document.createElement("div");
  div.id = rowId;
  div.className = "split-portion-row";
  div.style.cssText = "display:grid; grid-template-columns: 110px 1fr auto; gap:8px; align-items:center; background:var(--bg-card); padding:8px; border:1px solid var(--border-color); border-radius:6px;";

  div.innerHTML = `
    <div>
      <label style="font-size:10px;text-transform:uppercase;color:var(--text-muted);display:block;margin-bottom:2px;">Amount</label>
      <input type="number" step="0.01" min="0.01" class="form-control split-amount-input" value="${presetAmount}" required oninput="updateReconcileSplitDiff()" style="height:32px;font-size:13px;font-weight:600;">
    </div>
    <div>
      <label style="font-size:10px;text-transform:uppercase;color:var(--text-muted);display:block;margin-bottom:2px;">Description</label>
      <input type="text" class="form-control split-desc-input" value="${escapeHtml(presetDesc)}" required placeholder="Allocation description" style="height:32px;font-size:12px;">
    </div>
    <div style="padding-top:14px;">
      <button type="button" class="btn btn-sm btn-outline" style="color:var(--color-danger);height:32px;padding:0 8px;" onclick="removeReconcileSplitRow('${rowId}')" title="Remove portion"><i class="fa-solid fa-trash"></i></button>
    </div>
  `;
  container.appendChild(div);
  updateReconcileSplitDiff();
}

function removeReconcileSplitRow(rowId) {
  const container = document.getElementById("reconcileSplitPortionsList");
  if (!container) return;
  if (container.children.length <= 2) {
    showToast("A split requires at least two portions.", "info");
    return;
  }
  const el = document.getElementById(rowId);
  if (el) el.remove();
  updateReconcileSplitDiff();
}

function updateReconcileSplitDiff() {
  if (!_activeSplitSourceLine) return;
  const inputs = document.querySelectorAll(".split-amount-input");
  let sum = 0;
  inputs.forEach((inp) => {
    const v = parseFloat(inp.value);
    if (!isNaN(v)) sum += v;
  });

  const sumEl = document.getElementById("reconcileSplitSumVal");
  const diffEl = document.getElementById("reconcileSplitDiffBadge");
  const btn = document.getElementById("btnConfirmSplitPortions");

  const target = _activeSplitSourceLine.raw_amount;
  const diff = Math.round((target - sum) * 100) / 100;

  if (sumEl) sumEl.textContent = formatCurrency(sum);
  if (diffEl) {
    if (Math.abs(diff) < 0.01) {
      diffEl.textContent = "Balanced ($0.00)";
      diffEl.className = "status-badge status-success";
      if (btn) btn.disabled = false;
    } else {
      diffEl.textContent = `Diff: ${diff > 0 ? "+" : ""}${formatCurrency(diff)}`;
      diffEl.className = "status-badge status-danger";
      if (btn) btn.disabled = true;
    }
  }
}

async function handleReconcileSplitSubmit(e) {
  e.preventDefault();
  if (!_currentReconcileImport || !_activeSplitSourceLine) return;

  const rows = document.querySelectorAll(".split-portion-row");
  if (rows.length < 2) {
    showToast("At least two portions are required to split a line.", "error");
    return;
  }

  const portions = [];
  rows.forEach((row) => {
    const amt = parseFloat(row.querySelector(".split-amount-input")?.value);
    const desc = (row.querySelector(".split-desc-input")?.value || "").trim();
    if (!isNaN(amt) && amt > 0) {
      portions.push({ amount: amt, description: desc });
    }
  });

  const total = portions.reduce((s, p) => s + p.amount, 0);
  if (Math.abs(total - _activeSplitSourceLine.raw_amount) > 0.01) {
    showToast("Split portions total must equal source amount within precision.", "error");
    return;
  }

  const btn = document.getElementById("btnConfirmSplitPortions");
  if (btn) btn.disabled = true;

  try {
    await FinanceApi.resolveStatementLine(_currentReconcileImport.id, _activeSplitSourceLine.id, {
      action: "split",
      splits: portions,
    });

    showToast("Statement line split into allocated portions", "success");
    closeReconcileSplitModal();
    await refreshReconciliationWorkspace();
  } catch (err) {
    console.error("Split failed:", err);
    showToast(err.message || "Failed to split statement line", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function openCreateEntryForLine(lineId) {
  const line = _currentReconcileLines.find((l) => l.id === lineId);
  if (!line) return;

  document.getElementById("reconcileLineId").value = line.id;
  document.getElementById("reconcileLineDate").value = line.raw_date;
  document.getElementById("reconcileLineAmount").value = `${line.direction === "in" ? "+" : "-"}${formatCurrency(line.raw_amount)}`;
  document.getElementById("reconcileEntryDesc").value = line.raw_description || "Statement Line Outflow";
  document.getElementById("reconcileEntryRef").value = line.raw_reference || "STMT-AUTOCREATE";

  // Populate Categories and Payment Types dropdowns
  const catSel = document.getElementById("reconcileEntryCategory");
  const ptSel = document.getElementById("reconcileEntryPaymentType");
  if (catSel && catSel.options.length <= 1) {
    try {
      const cats = await FinanceApi.listCategories();
      catSel.innerHTML = '<option value="">— Select Category —</option>';
      cats.forEach((c) => {
        if (c.is_active) {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = `${c.name} (${c.kind})`;
          catSel.appendChild(opt);
        }
      });
    } catch (e) {}
  }
  if (ptSel && ptSel.options.length <= 1) {
    try {
      const pts = await FinanceApi.listPaymentTypes();
      ptSel.innerHTML = '<option value="">— Select Payment Type —</option>';
      pts.forEach((p) => {
        if (p.is_active) {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = `${p.name} (${p.code})`;
          ptSel.appendChild(opt);
        }
      });
    } catch (e) {}
  }

  openModal("reconcileCreateEntryModal");
}

function closeReconcileCreateEntryModal() {
  closeModal("reconcileCreateEntryModal");
}

async function handleReconcileCreateEntrySubmit(e) {
  e.preventDefault();
  if (!_currentReconcileImport) return;

  const lineId = parseInt(document.getElementById("reconcileLineId").value, 10);
  const desc = document.getElementById("reconcileEntryDesc").value.trim();
  const catId = document.getElementById("reconcileEntryCategory").value;
  const ptId = document.getElementById("reconcileEntryPaymentType").value;
  const ref = document.getElementById("reconcileEntryRef").value.trim();

  try {
    const updated = await FinanceApi.resolveStatementLine(_currentReconcileImport.id, lineId, {
      action: "create",
      description: desc,
      category_id: catId ? parseInt(catId, 10) : null,
      payment_type_id: ptId ? parseInt(ptId, 10) : null,
      reference: ref,
      notes: "Auto-created continuous ledger entry from statement line",
    });

    showToast("Ledger entry created and statement line matched", "success");
    closeReconcileCreateEntryModal();

    const idx = _currentReconcileLines.findIndex((l) => l.id === lineId);
    if (idx >= 0) _currentReconcileLines[idx] = updated;

    _currentReconcileImport.matched_lines_count = _currentReconcileLines.filter((l) =>
      ["matched", "created", "ignored"].includes(l.status)
    ).length;

    updateReconciliationHeader(_currentReconcileImport);
    filterReconciliationLines(_currentReconcileFilter);
    await loadFinanceStatements();
  } catch (err) {
    console.error("Create entry failed", err);
    showToast(err.message || "Failed to create ledger entry", "error");
  }
}

async function finalizeStatementReconciliation() {
  // Alias to openReconciliationCloseModal
  openReconciliationCloseModal();
}

// =========================================================================
// Story 6.4: Period Close, Reopen & Completion Report Handlers
// =========================================================================

function openReconciliationCloseModal() {
  if (!_currentReconcileImport) return;
  const imp = _currentReconcileImport;
  const summary = _currentReconcileSummary;

  const stmtBalEl = document.getElementById("closeModalStatementBal");
  const bookBalEl = document.getElementById("closeModalBookBal");
  const diffEl = document.getElementById("closeModalDiff");
  const balancedBanner = document.getElementById("closeModalBalancedBanner");
  const varianceWarning = document.getElementById("closeModalVarianceWarning");
  const overrideSection = document.getElementById("closeModalOverrideSection");
  const overrideCheckbox = document.getElementById("closeExceptionOverrideCheckbox");
  const overrideReasonContainer = document.getElementById("closeExceptionReasonContainer");
  const overrideReasonInput = document.getElementById("closeExceptionOverrideReason");
  const notesInput = document.getElementById("closePeriodNotes");

  const closingBal = imp.closing_balance !== null && imp.closing_balance !== undefined ? imp.closing_balance : 0;
  const bookBal = summary ? (summary.book_balance || 0) : 0;
  const diff = summary && summary.difference !== null && summary.difference !== undefined
    ? summary.difference
    : Math.round((closingBal - bookBal) * 100) / 100;
  const unmatchedCount = summary ? (summary.unmatched_lines_count || 0) : 0;
  const isZeroDiff = Math.abs(diff) <= 0.01 && unmatchedCount === 0;

  if (stmtBalEl) stmtBalEl.textContent = formatCurrency(closingBal);
  if (bookBalEl) bookBalEl.textContent = formatCurrency(bookBal);
  if (diffEl) {
    diffEl.textContent = formatCurrency(diff);
    diffEl.style.color = isZeroDiff ? "var(--color-success, #16a34a)" : "var(--color-danger, #ef4444)";
  }

  if (balancedBanner) balancedBanner.style.display = isZeroDiff ? "block" : "none";
  if (varianceWarning) varianceWarning.style.display = isZeroDiff ? "none" : "block";
  if (overrideSection) overrideSection.style.display = isZeroDiff ? "none" : "block";
  if (overrideCheckbox) overrideCheckbox.checked = false;
  if (overrideReasonContainer) overrideReasonContainer.style.display = "none";
  if (overrideReasonInput) overrideReasonInput.value = "";
  if (notesInput) notesInput.value = "";

  openModal("reconcileCloseModal");
}

function closeReconciliationCloseModal() {
  closeModal("reconcileCloseModal");
}

function toggleCloseOverrideReasonRequirement() {
  const checkbox = document.getElementById("closeExceptionOverrideCheckbox");
  const container = document.getElementById("closeExceptionReasonContainer");
  const textarea = document.getElementById("closeExceptionOverrideReason");
  if (!checkbox || !container) return;
  const isChecked = checkbox.checked;
  container.style.display = isChecked ? "block" : "none";
  if (isChecked && textarea) {
    textarea.focus();
  }
}

async function submitReconciliationClose(e) {
  e.preventDefault();
  if (!_currentReconcileImport) return;

  const btn = document.getElementById("btnConfirmClosePeriod");
  const notes = (document.getElementById("closePeriodNotes")?.value || "").trim();
  const overrideCheckbox = document.getElementById("closeExceptionOverrideCheckbox");
  const overrideReason = (document.getElementById("closeExceptionOverrideReason")?.value || "").trim();
  const isOverride = overrideCheckbox ? overrideCheckbox.checked : false;

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Closing Period...';
  }

  try {
    const closed = await FinanceApi.closeStatementPeriod(_currentReconcileImport.id, {
      closing_notes: notes,
      is_exception_override: isOverride,
      exception_override_reason: overrideReason,
    });
    _currentReconcileImport = closed;
    showToast(`Period ${closed.period_month} successfully closed and locked!`, "success");
    closeReconciliationCloseModal();
    await refreshReconciliationWorkspace();
    await loadFinanceStatements();
  } catch (err) {
    console.error("Close period failed:", err);
    showToast(err.message || "Failed to close period", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-lock"></i> Finalize &amp; Close Period';
    }
  }
}

function openReconciliationReopenModal() {
  if (!_currentReconcileImport) return;
  const reasonInput = document.getElementById("reopenPeriodReason");
  if (reasonInput) reasonInput.value = "";
  openModal("reconcileReopenModal");
}

function closeReconciliationReopenModal() {
  closeModal("reconcileReopenModal");
}

async function submitReconciliationReopen(e) {
  e.preventDefault();
  if (!_currentReconcileImport) return;

  const btn = document.getElementById("btnConfirmReopenPeriod");
  const reason = (document.getElementById("reopenPeriodReason")?.value || "").trim();

  if (!reason || reason.length < 5) {
    showToast("A documented audit reason of at least 5 characters is required.", "error");
    return;
  }

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Reopening Period...';
  }

  try {
    const reopened = await FinanceApi.reopenStatementPeriod(_currentReconcileImport.id, {
      reopen_reason: reason,
    });
    _currentReconcileImport = reopened;
    showToast(`Period ${reopened.period_month} reopened. Posting lock removed.`, "warning");
    closeReconciliationReopenModal();
    await refreshReconciliationWorkspace();
    await loadFinanceStatements();
  } catch (err) {
    console.error("Reopen period failed:", err);
    showToast(err.message || "Failed to reopen period", "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-lock-open"></i> Confirm Reopen';
    }
  }
}

async function openReconciliationCompletionReportModal() {
  if (!_currentReconcileImport) return;
  const printArea = document.getElementById("completionReportPrintArea");
  if (printArea) {
    printArea.innerHTML = `
      <div style="text-align:center; padding:40px; color:var(--text-muted);">
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size:24px;"></i>
        <p style="margin-top:8px;">Generating Completion Report...</p>
      </div>
    `;
  }
  openModal("reconciliationCompletionReportModal");

  try {
    const report = await FinanceApi.getStatementCompletionReport(_currentReconcileImport.id);
    renderCompletionReport(report);
  } catch (err) {
    console.error("Failed to load completion report:", err);
    if (printArea) {
      printArea.innerHTML = `
        <div class="empty-state" style="padding:30px;">
          <i class="fa-solid fa-triangle-exclamation" style="color:var(--color-danger);font-size:32px;"></i>
          <p style="margin-top:10px;">${escapeHtml(err.message || "Failed to generate completion report")}</p>
        </div>
      `;
    }
  }
}

function closeReconciliationCompletionReportModal() {
  closeModal("reconciliationCompletionReportModal");
}

function renderCompletionReport(r) {
  const container = document.getElementById("completionReportPrintArea");
  if (!container) return;

  const isBalanced = r.is_balanced;
  const statusBadge = r.status === "closed"
    ? '<span class="status-badge status-neutral"><i class="fa-solid fa-lock"></i> Closed</span>'
    : r.status === "reopened"
    ? '<span class="status-badge status-warning"><i class="fa-solid fa-lock-open"></i> Reopened</span>'
    : '<span class="status-badge status-success"><i class="fa-solid fa-check"></i> Reconciled</span>';

  const balancePill = isBalanced
    ? '<span style="background:rgba(22,163,74,0.15);color:#15803d;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;"><i class="fa-solid fa-check"></i> Balanced ($0.00)</span>'
    : r.is_exception_override
    ? '<span style="background:rgba(245,158,11,0.15);color:#b45309;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;"><i class="fa-solid fa-triangle-exclamation"></i> Exception Override</span>'
    : '<span style="background:rgba(239,68,68,0.15);color:#b91c1c;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;"><i class="fa-solid fa-xmark"></i> Unbalanced</span>';

  let ignoredTableHtml = '';
  if (r.ignored_lines_details && r.ignored_lines_details.length > 0) {
    ignoredTableHtml = `
      <div style="margin-top:20px;">
        <h4 style="font-size:13px; font-weight:700; margin-bottom:8px; text-transform:uppercase; color:var(--text-muted);">
          Excluded / Ignored Lines Audit Justification (${r.ignored_lines_details.length})
        </h4>
        <table class="responsive-card-table" style="width:100%; font-size:12px; border:1px solid var(--border-color);">
          <thead style="background:var(--bg-card-subtle);">
            <tr>
              <th style="padding:6px 10px; width:90px;">Date</th>
              <th style="padding:6px 10px; width:100px; text-align:right;">Amount</th>
              <th style="padding:6px 10px;">Statement Description</th>
              <th style="padding:6px 10px;">Mandatory Audit Reason</th>
            </tr>
          </thead>
          <tbody>
            ${r.ignored_lines_details.map(item => `
              <tr style="border-bottom:1px solid var(--border-color);">
                <td style="padding:6px 10px; font-family:monospace;">${escapeHtml(item.date)}</td>
                <td style="padding:6px 10px; text-align:right; font-weight:600;">${formatCurrency(item.amount)}</td>
                <td style="padding:6px 10px;">${escapeHtml(item.description)}</td>
                <td style="padding:6px 10px; font-style:italic; color:var(--text-primary); font-weight:500;">${escapeHtml(item.audit_reason || '—')}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  container.innerHTML = `
    <div style="padding:4px 0 16px 0; border-bottom:2px solid var(--border-color); display:flex; justify-content:space-between; align-items:flex-start;">
      <div>
        <h2 style="margin:0; font-size:18px; font-weight:800; color:var(--text-primary);">Bank Reconciliation Completion Report</h2>
        <div style="font-size:13px; color:var(--text-muted); margin-top:3px;">
          Account: <strong>${escapeHtml(r.account_name)}</strong> · Period: <strong>${escapeHtml(r.period_month)}</strong> · Currency: <strong>${escapeHtml(r.currency)}</strong>
        </div>
      </div>
      <div style="text-align:right;">
        ${statusBadge}
        <div style="font-size:11px; color:var(--text-muted); margin-top:4px;">Report Generated: ${new Date(r.generated_at).toLocaleString()}</div>
      </div>
    </div>

    <!-- 4-Card Balance Grid -->
    <div style="display:grid; grid-template-columns: repeat(4, 1fr); gap:12px; margin:16px 0;">
      <div style="background:var(--bg-card-subtle); padding:10px 14px; border-radius:6px; border:1px solid var(--border-color);">
        <div style="font-size:11px; text-transform:uppercase; color:var(--text-muted); font-weight:600;">Opening Balance</div>
        <div style="font-size:15px; font-weight:700; font-family:monospace; margin-top:3px;">${formatCurrency(r.opening_balance)}</div>
      </div>
      <div style="background:var(--bg-card-subtle); padding:10px 14px; border-radius:6px; border:1px solid var(--border-color);">
        <div style="font-size:11px; text-transform:uppercase; color:var(--text-muted); font-weight:600;">Statement Closing</div>
        <div style="font-size:15px; font-weight:700; font-family:monospace; margin-top:3px;">${formatCurrency(r.closing_balance)}</div>
      </div>
      <div style="background:var(--bg-card-subtle); padding:10px 14px; border-radius:6px; border:1px solid var(--border-color);">
        <div style="font-size:11px; text-transform:uppercase; color:var(--text-muted); font-weight:600;">Continuous Book Bal.</div>
        <div style="font-size:15px; font-weight:700; font-family:monospace; margin-top:3px;">${formatCurrency(r.book_balance)}</div>
      </div>
      <div style="background:var(--bg-card-subtle); padding:10px 14px; border-radius:6px; border:1px solid var(--border-color);">
        <div style="font-size:11px; text-transform:uppercase; color:var(--text-muted); font-weight:600;">Balance Difference</div>
        <div style="font-size:15px; font-weight:700; font-family:monospace; margin-top:3px; color:${isBalanced ? 'var(--color-success, #16a34a)' : 'var(--color-danger, #ef4444)'};">
          ${formatCurrency(r.balance_difference)} ${balancePill}
        </div>
      </div>
    </div>

    <!-- Metrics Breakdown Table -->
    <div style="margin-top:16px;">
      <h4 style="font-size:13px; font-weight:700; margin-bottom:8px; text-transform:uppercase; color:var(--text-muted);">
        Reconciliation Line Resolution Summary
      </h4>
      <table class="responsive-card-table" style="width:100%; font-size:12px; border:1px solid var(--border-color);">
        <thead style="background:var(--bg-card-subtle);">
          <tr>
            <th style="padding:6px 10px;">Classification Category</th>
            <th style="padding:6px 10px; text-align:center;">Count</th>
            <th style="padding:6px 10px; text-align:right;">Total Amount</th>
            <th style="padding:6px 10px;">Audit Status</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid var(--border-color);">
            <td style="padding:6px 10px;"><strong>Matched Existing Ledger Entries / Cheques</strong></td>
            <td style="padding:6px 10px; text-align:center;">${r.matched_lines_count}</td>
            <td style="padding:6px 10px; text-align:right; font-family:monospace;">${formatCurrency(r.matched_lines_amount)}</td>
            <td style="padding:6px 10px; color:var(--color-success);"><i class="fa-solid fa-check"></i> Cleared &amp; Verified</td>
          </tr>
          <tr style="border-bottom:1px solid var(--border-color);">
            <td style="padding:6px 10px;"><strong>Auto-Created Continuous Ledger Entries</strong></td>
            <td style="padding:6px 10px; text-align:center;">${r.created_entries_count}</td>
            <td style="padding:6px 10px; text-align:right; font-family:monospace;">${formatCurrency(r.created_entries_amount)}</td>
            <td style="padding:6px 10px; color:var(--color-primary);"><i class="fa-solid fa-plus"></i> Posted to Ledger</td>
          </tr>
          <tr style="border-bottom:1px solid var(--border-color);">
            <td style="padding:6px 10px;"><strong>Excluded / Ignored Statement Lines</strong></td>
            <td style="padding:6px 10px; text-align:center;">${r.ignored_lines_count}</td>
            <td style="padding:6px 10px; text-align:right; font-family:monospace;">${formatCurrency(r.ignored_lines_amount)}</td>
            <td style="padding:6px 10px; color:var(--text-muted);"><i class="fa-solid fa-ban"></i> Documented Exception</td>
          </tr>
          <tr style="border-bottom:1px solid var(--border-color);">
            <td style="padding:6px 10px;"><strong>Uncleared Continuous Ledger Transactions</strong></td>
            <td style="padding:6px 10px; text-align:center;">${r.uncleared_ledger_transactions_count}</td>
            <td style="padding:6px 10px; text-align:right; font-family:monospace;">${formatCurrency(r.uncleared_ledger_transactions_amount)}</td>
            <td style="padding:6px 10px; color:var(--color-warning);"><i class="fa-solid fa-clock"></i> Outstanding in Transit</td>
          </tr>
          <tr>
            <td style="padding:6px 10px;"><strong>Uncleared Outstanding Issued Cheques</strong></td>
            <td style="padding:6px 10px; text-align:center;">${r.uncleared_cheques_count}</td>
            <td style="padding:6px 10px; text-align:right; font-family:monospace;">${formatCurrency(r.uncleared_cheques_amount)}</td>
            <td style="padding:6px 10px; color:var(--color-warning);"><i class="fa-solid fa-clock"></i> Awaiting Bank Presentment</td>
          </tr>
        </tbody>
      </table>
    </div>

    ${ignoredTableHtml}

    <!-- Audit Sign-Off Block -->
    <div style="margin-top:20px; padding:12px; background:var(--bg-card-subtle); border-radius:6px; border:1px solid var(--border-color); font-size:12px;">
      <div style="font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:6px;">Sign-Off &amp; Audit Trail</div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
        <div>Closed By: <strong>${escapeHtml(r.closed_by || '—')}</strong></div>
        <div>Closed Date: <strong>${r.closed_at ? new Date(r.closed_at).toLocaleString() : '—'}</strong></div>
        ${r.closing_notes ? `<div style="grid-column: span 2;">Closing Comments: <em>${escapeHtml(r.closing_notes)}</em></div>` : ''}
        ${r.is_exception_override ? `<div style="grid-column: span 2; color:#b45309;"><strong>Exception Override Justification:</strong> ${escapeHtml(r.exception_override_reason || '—')}</div>` : ''}
        ${r.reopened_at ? `
          <div style="grid-column: span 2; border-top:1px dashed var(--border-color); padding-top:6px; margin-top:4px; color:#d97706;">
            Reopened By: <strong>${escapeHtml(r.reopened_by || '—')}</strong> on ${new Date(r.reopened_at).toLocaleString()}<br>
            <strong>Reopen Audit Reason:</strong> ${escapeHtml(r.reopen_reason || '—')}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

function printCompletionReport() {
  window.print();
}

// =========================================================================
// Story 6.3: Reconciliation Rules Engine Controller
// =========================================================================
let _cachedRules = [];
let _currentRulesFilter = "all";

async function openReconciliationRulesModal() {
  await loadAndRenderRulesTable();
  openModal("financeReconciliationRulesModal");
}

function closeReconciliationRulesModal() {
  closeModal("financeReconciliationRulesModal");
}

async function loadAndRenderRulesTable() {
  try {
    _cachedRules = await FinanceApi.getReconciliationRules();
    renderRulesTable(_cachedRules);
  } catch (err) {
    console.error("Failed to load rules:", err);
    showToast(err.message || "Failed to load rules", "error");
  }
}

function filterRulesTable(filterType, tabBtn) {
  _currentRulesFilter = filterType;
  const container = document.getElementById("rulesFilterTabs");
  if (container) {
    container.querySelectorAll(".filter-tab").forEach((btn) => btn.classList.remove("active"));
  }
  if (tabBtn) tabBtn.classList.add("active");

  let filtered = _cachedRules;
  if (filterType === "suggestion") {
    filtered = _cachedRules.filter((r) => r.mode === "suggestion");
  } else if (filterType === "auto_apply") {
    filtered = _cachedRules.filter((r) => r.mode === "auto_apply");
  }
  renderRulesTable(filtered);
}

function renderRulesTable(rules) {
  const tbody = document.getElementById("reconciliationRulesTableBody");
  const empty = document.getElementById("rulesEmptyState");
  const countLabel = document.getElementById("rulesCountLabel");

  if (countLabel) countLabel.innerText = `${rules.length} rule${rules.length === 1 ? '' : 's'} configured`;
  if (!tbody) return;

  if (!rules || rules.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = rules.map((r) => {
    const isAuto = r.mode === "auto_apply";
    const modeBadge = isAuto
      ? `<span class="status-badge status-primary" style="font-size:11px;"><i class="fa-solid fa-bolt"></i> Auto-Apply ${r.is_approved ? '<i class="fa-solid fa-check-double" title="Approved"></i>' : '<span style="color:var(--color-danger);">(Pending Approval)</span>'}</span>`
      : `<span class="status-badge status-neutral" style="font-size:11px;"><i class="fa-solid fa-lightbulb"></i> Suggestion</span>`;

    const conditionPills = [];
    if (r.description_pattern) conditionPills.push(`<code>${escapeHtml(r.description_pattern)}</code>`);
    if (r.direction) conditionPills.push(`<span class="badge" style="font-size:10px;">${r.direction.toUpperCase()}</span>`);
    if (r.min_amount != null || r.max_amount != null) {
      conditionPills.push(`<span class="badge" style="font-size:10px;">$${r.min_amount || 0} - ${r.max_amount ? '$' + r.max_amount : 'Any'}</span>`);
    }
    if (r.counterparty) conditionPills.push(`<span class="badge" style="font-size:10px;">Party: ${escapeHtml(r.counterparty)}</span>`);

    let actionDesc = "";
    if (r.action === "suggest_category") actionDesc = `Category: <strong>${escapeHtml(r.target_category || 'Uncategorized')}</strong>`;
    else if (r.action === "auto_create") actionDesc = `<span style="color:var(--color-primary);font-weight:600;"><i class="fa-solid fa-plus"></i> Auto-create Entry</span>`;
    else if (r.action === "auto_ignore") actionDesc = `<span style="color:var(--color-danger);font-weight:600;"><i class="fa-solid fa-ban"></i> Auto-ignore (${escapeHtml(r.audit_reason || 'Documented')})</span>`;

    return `
      <tr id="ruleRow_${r.id}" style="${!r.is_active ? 'opacity:0.6;background:var(--bg-card-subtle);' : ''}">
        <td><span class="status-badge" style="font-size:11px;font-weight:700;">#${r.priority}</span></td>
        <td>
          <div style="font-weight:600;font-size:13px;color:var(--text-primary);">${escapeHtml(r.name)}</div>
          ${r.description ? `<div style="font-size:11px;color:var(--text-muted);">${escapeHtml(r.description)}</div>` : ''}
        </td>
        <td>${modeBadge}</td>
        <td><div style="display:flex;flex-wrap:wrap;gap:4px;">${conditionPills.join("") || '<em style="color:var(--text-muted);font-size:11px;">Any line</em>'}</div></td>
        <td><div style="font-size:12px;">${actionDesc}</div></td>
        <td style="text-align:center;">
          <div style="font-weight:700;font-size:13px;">${r.times_applied || 0}</div>
          <div style="font-size:10px;color:var(--text-muted);">${r.last_used_at ? r.last_used_at.substring(0, 10) : 'Never'}</div>
        </td>
        <td style="text-align:center;">
          <div style="display:flex;gap:4px;justify-content:center;align-items:center;">
            <button type="button" class="btn btn-sm btn-outline btn-toggle-rule" onclick="toggleRuleActive(${r.id}, ${!r.is_active})" title="${r.is_active ? 'Deactivate' : 'Activate'}" style="padding:2px 6px;font-size:11px;">
              <i class="fa-solid ${r.is_active ? 'fa-toggle-on text-success' : 'fa-toggle-off text-muted'}"></i>
            </button>
            <button type="button" class="btn btn-sm btn-outline btn-edit-rule" onclick="editRule(${r.id})" title="Edit rule" style="padding:2px 6px;font-size:11px;">
              <i class="fa-solid fa-pen"></i>
            </button>
            ${isAuto && (r.times_applied > 0) ? `
              <button type="button" class="btn btn-sm btn-outline btn-revert-rule" onclick="revertRuleById(${r.id})" title="Revert auto-applied lines" style="padding:2px 6px;font-size:11px;color:var(--color-warning);">
                <i class="fa-solid fa-rotate-left"></i>
              </button>
            ` : ''}
            <button type="button" class="btn btn-sm btn-outline btn-delete-rule" onclick="deleteRuleById(${r.id})" title="Delete rule" style="padding:2px 6px;font-size:11px;color:var(--color-danger);">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function openCreateRuleModal() {
  const form = document.getElementById("financeRuleForm");
  if (form) form.reset();
  const idEl = document.getElementById("ruleEditId");
  if (idEl) idEl.value = "";
  const title = document.getElementById("ruleModalTitleText");
  if (title) title.innerText = "Create Reconciliation Rule";
  const previewBox = document.getElementById("rulePreviewResultsContainer");
  if (previewBox) previewBox.style.display = "none";
  onRuleModeChange();
  onRuleActionChange();
  openModal("financeRuleEditModal");
}

function editRule(ruleId) {
  const rule = _cachedRules.find((r) => r.id === parseInt(ruleId, 10));
  if (!rule) return;

  const idEl = document.getElementById("ruleEditId");
  if (idEl) idEl.value = rule.id;
  const title = document.getElementById("ruleModalTitleText");
  if (title) title.innerText = `Edit Rule #${rule.id}`;

  const setVal = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val !== null && val !== undefined ? val : "";
  };

  setVal("ruleFormName", rule.name);
  setVal("ruleFormPriority", rule.priority);
  setVal("ruleFormDescription", rule.description);
  setVal("ruleFormMode", rule.mode);
  setVal("ruleFormDescPattern", rule.description_pattern);
  setVal("ruleFormDirection", rule.direction);
  setVal("ruleFormMinAmount", rule.min_amount);
  setVal("ruleFormMaxAmount", rule.max_amount);
  setVal("ruleFormAction", rule.action);
  setVal("ruleFormTargetCategory", rule.target_category);
  setVal("ruleFormAuditReason", rule.audit_reason);

  const isAppr = document.getElementById("ruleFormIsApproved");
  if (isAppr) isAppr.checked = Boolean(rule.is_approved);

  const previewBox = document.getElementById("rulePreviewResultsContainer");
  if (previewBox) previewBox.style.display = "none";

  onRuleModeChange();
  onRuleActionChange();
  openModal("financeRuleEditModal");
}

function closeRuleEditModal() {
  closeModal("financeRuleEditModal");
}

function onRuleModeChange() {
  const mode = document.getElementById("ruleFormMode")?.value;
  const container = document.getElementById("ruleApprovalContainer");
  if (container) {
    container.style.display = mode === "auto_apply" ? "block" : "none";
  }
}

function onRuleActionChange() {
  const action = document.getElementById("ruleFormAction")?.value;
  const catField = document.getElementById("ruleCategoryField");
  const auditField = document.getElementById("ruleAuditReasonField");

  if (action === "auto_ignore") {
    if (catField) catField.style.display = "none";
    if (auditField) auditField.style.display = "block";
  } else {
    if (catField) catField.style.display = "block";
    if (auditField) auditField.style.display = "none";
  }
}

function collectRuleFormData() {
  const name = (document.getElementById("ruleFormName")?.value || "").trim();
  const priority = parseInt(document.getElementById("ruleFormPriority")?.value || "10", 10);
  const description = (document.getElementById("ruleFormDescription")?.value || "").trim();
  const mode = document.getElementById("ruleFormMode")?.value || "suggestion";
  const isApproved = Boolean(document.getElementById("ruleFormIsApproved")?.checked);
  const descPattern = (document.getElementById("ruleFormDescPattern")?.value || "").trim();
  const direction = document.getElementById("ruleFormDirection")?.value || null;
  const minAmt = document.getElementById("ruleFormMinAmount")?.value ? parseFloat(document.getElementById("ruleFormMinAmount").value) : null;
  const maxAmt = document.getElementById("ruleFormMaxAmount")?.value ? parseFloat(document.getElementById("ruleFormMaxAmount").value) : null;
  const action = document.getElementById("ruleFormAction")?.value || "suggest_category";
  const targetCat = (document.getElementById("ruleFormTargetCategory")?.value || "").trim() || null;
  const auditReason = (document.getElementById("ruleFormAuditReason")?.value || "").trim() || null;

  return {
    name,
    priority,
    description,
    mode,
    is_approved: isApproved,
    description_pattern: descPattern || null,
    direction: direction || null,
    min_amount: minAmt,
    max_amount: maxAmt,
    action,
    target_category: targetCat,
    audit_reason: auditReason,
  };
}

async function triggerRuleDryRunPreview() {
  const candidate = collectRuleFormData();
  if (!candidate.name) {
    showToast("Rule name is required to run a preview test.", "info");
    return;
  }

  const container = document.getElementById("rulePreviewResultsContainer");
  const summaryEl = document.getElementById("rulePreviewSummaryText");
  const conflictsEl = document.getElementById("rulePreviewConflictsAlert");
  const listEl = document.getElementById("rulePreviewMatchedLinesList");

  try {
    const res = await FinanceApi.previewReconciliationRule({
      rule: candidate,
      statement_id: _currentReconcileImport ? _currentReconcileImport.id : null,
    });

    if (container) container.style.display = "block";
    if (summaryEl) summaryEl.innerText = res.summary;

    if (conflictsEl) {
      if (res.conflicts && res.conflicts.length > 0) {
        conflictsEl.style.display = "block";
        conflictsEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>${res.conflicts.length} conflict(s) detected:</strong><br>` +
          res.conflicts.map((c) => `· Line #${c.line_id}: ${escapeHtml(c.conflict_reason)}`).join("<br>");
      } else {
        conflictsEl.style.display = "none";
      }
    }

    if (listEl) {
      if (res.sample_matched_lines && res.sample_matched_lines.length > 0) {
        listEl.innerHTML = res.sample_matched_lines.map((l) => `
          <div style="background:var(--bg-card);padding:4px 8px;border-radius:4px;border:1px solid var(--border-color);">
            #${l.id} · ${l.raw_date} · ${escapeHtml(l.raw_description)} · ${formatCurrency(l.raw_amount)} (${l.direction.toUpperCase()})
          </div>
        `).join("");
      } else {
        listEl.innerHTML = '<div style="color:var(--text-muted);font-style:italic;">No unmatched statement lines match these conditions.</div>';
      }
    }
  } catch (err) {
    console.error("Preview failed:", err);
    showToast(err.message || "Failed to run dry-run preview", "error");
  }
}

async function handleRuleFormSubmit(e) {
  e.preventDefault();
  const editId = document.getElementById("ruleEditId")?.value;
  const payload = collectRuleFormData();

  if (payload.action === "auto_ignore" && !payload.audit_reason) {
    showToast("A mandatory audit reason is required for auto-ignore rules.", "error");
    return;
  }

  const btn = document.getElementById("btnSaveReconciliationRule");
  if (btn) btn.disabled = true;

  try {
    if (editId) {
      await FinanceApi.updateReconciliationRule(editId, payload);
      showToast(`Reconciliation rule updated`, "success");
    } else {
      await FinanceApi.createReconciliationRule(payload);
      showToast(`Reconciliation rule created`, "success");
    }
    closeRuleEditModal();
    await loadAndRenderRulesTable();
  } catch (err) {
    console.error("Save rule failed:", err);
    showToast(err.message || "Failed to save rule", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function toggleRuleActive(ruleId, newStatus) {
  try {
    await FinanceApi.updateReconciliationRule(ruleId, { is_active: newStatus });
    showToast(`Rule ${newStatus ? 'activated' : 'deactivated'}`, "info");
    await loadAndRenderRulesTable();
  } catch (err) {
    console.error("Toggle rule failed:", err);
    showToast(err.message || "Failed to update rule status", "error");
  }
}

async function deleteRuleById(ruleId) {
  if (!confirm(`Delete reconciliation rule #${ruleId}? Historical reconciliations will remain intact.`)) return;
  try {
    await FinanceApi.deleteReconciliationRule(ruleId);
    showToast("Rule deleted successfully", "info");
    await loadAndRenderRulesTable();
  } catch (err) {
    console.error("Delete rule failed:", err);
    showToast(err.message || "Failed to delete rule", "error");
  }
}

async function revertRuleById(ruleId) {
  if (!confirm(`Revert all auto-applied line resolutions for rule #${ruleId}? Any auto-created ledger entries will be removed.`)) return;
  try {
    const res = await FinanceApi.revertRule(ruleId);
    showToast(res.message || "Rule resolutions reverted", "success");
    await loadAndRenderRulesTable();
    await refreshReconciliationWorkspace();
  } catch (err) {
    console.error("Revert rule failed:", err);
    showToast(err.message || "Failed to revert rule", "error");
  }
}

async function openApplyRulesDialog() {
  if (!_currentReconcileImport) return;

  const container = document.getElementById("applyRulesStatsSummary");
  if (container) {
    container.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Simulating rule evaluations...';
  }
  openModal("financeApplyRulesConfirmModal");

  try {
    const sim = await FinanceApi.applyRulesToStatement(_currentReconcileImport.id, true);
    if (container) {
      container.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;">
          <div>Evaluated Unmatched Lines: <strong>${sim.evaluated_lines_count}</strong></div>
          <div>Projected Suggestions: <strong class="text-primary">${sim.suggestions_count}</strong></div>
          <div>Projected Auto-Applied: <strong class="text-success">${sim.auto_applied_count}</strong></div>
          <div>Conflicts Detected: <strong class="${sim.conflicts.length ? 'text-warning' : 'text-muted'}">${sim.conflicts.length}</strong></div>
        </div>
      `;
    }
  } catch (err) {
    if (container) container.innerHTML = `<span style="color:var(--color-danger);">${escapeHtml(err.message || 'Simulation failed')}</span>`;
  }
}

function closeApplyRulesDialog() {
  closeModal("financeApplyRulesConfirmModal");
}

async function confirmExecuteStatementRules() {
  if (!_currentReconcileImport) return;
  const btn = document.getElementById("btnConfirmExecuteRules");
  if (btn) btn.disabled = true;

  try {
    const res = await FinanceApi.applyRulesToStatement(_currentReconcileImport.id, false);
    showToast(`Rules applied: ${res.suggestions_count} suggestions, ${res.auto_applied_count} auto-resolved`, "success");
    closeApplyRulesDialog();
    await refreshReconciliationWorkspace();
    await loadFinanceStatements();
  } catch (err) {
    console.error("Execute rules failed:", err);
    showToast(err.message || "Failed to execute rules", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Window exports
window.loadFinanceStatements = loadFinanceStatements;
window.filterFinanceStatements = filterFinanceStatements;
window.openUploadStatementModal = openUploadStatementModal;
window.closeUploadStatementModal = closeUploadStatementModal;
window.goToWizardStep = goToWizardStep;
window.executeStatementPreview = executeStatementPreview;
window.recalculatePreviewWithMapping = recalculatePreviewWithMapping;
window.exportStatementRejectedRows = exportStatementRejectedRows;
window.commitStatementImport = commitStatementImport;
window.onStatementFileSelected = onStatementFileSelected;
window.onStatementTemplateSelected = onStatementTemplateSelected;
window.toggleSaveTemplateInput = toggleSaveTemplateInput;
window.onStatementFileTypeChange = onStatementFileTypeChange;
window.openReconciliationModal = openReconciliationModal;
window.closeReconciliationModal = closeReconciliationModal;
window.filterReconciliationLines = filterReconciliationLines;
window.confirmLineMatch = confirmLineMatch;
window.ignoreStatementLine = openIgnoreModalForLine;
window.openIgnoreModalForLine = openIgnoreModalForLine;
window.closeReconcileIgnoreModal = closeReconcileIgnoreModal;
window.handleReconcileIgnoreSubmit = handleReconcileIgnoreSubmit;
window.openSplitModalForLine = openSplitModalForLine;
window.closeReconcileSplitModal = closeReconcileSplitModal;
window.addReconcileSplitRow = addReconcileSplitRow;
window.removeReconcileSplitRow = removeReconcileSplitRow;
window.updateReconcileSplitDiff = updateReconcileSplitDiff;
window.handleReconcileSplitSubmit = handleReconcileSplitSubmit;
window.onReconcileMatchSelectChange = onReconcileMatchSelectChange;
window.openCreateEntryForLine = openCreateEntryForLine;
window.closeReconcileCreateEntryModal = closeReconcileCreateEntryModal;
window.handleReconcileCreateEntrySubmit = handleReconcileCreateEntrySubmit;
window.finalizeStatementReconciliation = finalizeStatementReconciliation;
window.syncStatementUploadPeriod = syncStatementUploadPeriod;
window.onStatementFilterSelectChange = onStatementFilterSelectChange;
window.onStatementFilterChange = onStatementFilterChange;
window.onStatementAccountSelected = onStatementAccountSelected;

// Story 6.3 Rules Engine Window Exports
window.openReconciliationRulesModal = openReconciliationRulesModal;
window.closeReconciliationRulesModal = closeReconciliationRulesModal;
window.filterRulesTable = filterRulesTable;
window.openCreateRuleModal = openCreateRuleModal;
window.editRule = editRule;
window.closeRuleEditModal = closeRuleEditModal;
window.onRuleModeChange = onRuleModeChange;
window.onRuleActionChange = onRuleActionChange;
window.triggerRuleDryRunPreview = triggerRuleDryRunPreview;
window.handleRuleFormSubmit = handleRuleFormSubmit;
window.toggleRuleActive = toggleRuleActive;
window.deleteRuleById = deleteRuleById;
window.revertRuleById = revertRuleById;
window.openApplyRulesDialog = openApplyRulesDialog;
window.closeApplyRulesDialog = closeApplyRulesDialog;
window.confirmExecuteStatementRules = confirmExecuteStatementRules;

// Story 6.4 exports
window.openReconciliationCloseModal = openReconciliationCloseModal;
window.closeReconciliationCloseModal = closeReconciliationCloseModal;
window.toggleCloseOverrideReasonRequirement = toggleCloseOverrideReasonRequirement;
window.submitReconciliationClose = submitReconciliationClose;
window.openReconciliationReopenModal = openReconciliationReopenModal;
window.closeReconciliationReopenModal = closeReconciliationReopenModal;
window.submitReconciliationReopen = submitReconciliationReopen;
window.openReconciliationCompletionReportModal = openReconciliationCompletionReportModal;
window.closeReconciliationCompletionReportModal = closeReconciliationCompletionReportModal;
window.printCompletionReport = printCompletionReport;



