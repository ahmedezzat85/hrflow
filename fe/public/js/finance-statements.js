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
    const [imp, lines] = await Promise.all([
      FinanceApi.getStatement(importId),
      FinanceApi.getStatementLines(importId),
    ]);

    _currentReconcileImport = imp;
    _currentReconcileLines = lines;
    _currentReconcileFilter = "all";

    updateReconciliationHeader(imp);
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

function updateReconciliationHeader(imp) {
  if (!imp) return;
  const pEl = document.getElementById("reconcileSummaryPeriod");
  const aEl = document.getElementById("reconcileSummaryAccount");
  const prEl = document.getElementById("reconcileSummaryProgress");
  const stEl = document.getElementById("reconcileSummaryStatus");
  const btnFinal = document.getElementById("btnFinalizeReconciliation");

  if (pEl) pEl.textContent = imp.period_month || "Period";
  if (aEl) aEl.textContent = imp.account_name || "Account";
  if (prEl) prEl.textContent = `${imp.matched_lines_count || 0} / ${imp.total_lines_count || 0} Resolved`;

  const isReconciled = imp.status === "reconciled";
  if (stEl) {
    stEl.textContent = isReconciled ? "Reconciled" : "Needs Review";
    stEl.className = isReconciled ? "status-badge status-success" : "status-badge status-warning";
  }

  const allResolved = imp.total_lines_count > 0 && imp.matched_lines_count === imp.total_lines_count;
  if (btnFinal) {
    if (isReconciled) {
      btnFinal.disabled = true;
      btnFinal.innerHTML = '<i class="fa-solid fa-check-double"></i> Period Reconciled';
    } else {
      btnFinal.disabled = !allResolved;
      btnFinal.innerHTML = '<i class="fa-solid fa-lock"></i> Reconcile &amp; Close Period';
    }
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
    filtered = filtered.filter((l) => ["matched", "created"].includes(l.status));
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
    } else {
      statusBadge = '<span class="status-badge status-warning" style="font-size:11px;"><i class="fa-solid fa-circle-exclamation"></i> Unmatched</span>';
    }

    // Suggested Matches Column
    let matchColContent = "";
    if (line.status === "unmatched") {
      const suggestions = line.suggested_matches || [];
      if (suggestions.length > 0) {
        matchColContent = `
          <select id="lineMatchSelect_${line.id}" class="form-control" style="width:100%;font-size:12px;padding:3px 8px;height:32px;">
            ${suggestions
              .map(
                (s, idx) => `
              <option value="${s.transaction_id || ''}" data-cheque="${s.cheque_id || ''}" ${idx === 0 ? 'selected' : ''}>
                ${s.match_type === 'cheque' ? 'Cheque' : 'Tx'} [${Math.round(s.score * 100)}%] ${escapeHtml(s.description)} (${formatCurrency(s.amount)})
              </option>
            `
              )
              .join("")}
          </select>
        `;
      } else {
        matchColContent = '<span style="color:var(--text-muted);font-size:12px;">No automated match found</span>';
      }
    } else if (line.status === "matched") {
      if (line.matched_cheque_id) {
        matchColContent = `<span style="color:var(--color-success);font-size:12px;"><i class="fa-solid fa-money-check"></i> Linked Cheque #${line.matched_cheque_id} (Auto-cleared)</span>`;
      } else {
        matchColContent = `<span style="color:var(--color-success);font-size:12px;"><i class="fa-solid fa-link"></i> Linked to Ledger Tx #${line.matched_transaction_id}</span>`;
      }
    } else if (line.status === "created") {
      matchColContent = `<span style="color:var(--color-primary);font-size:12px;"><i class="fa-solid fa-receipt"></i> Created Continuous Ledger Entry</span>`;
    } else if (line.status === "ignored") {
      matchColContent = '<span style="color:var(--text-muted);font-size:12px;">Excluded from reconciliation</span>';
    }

    // Actions Column
    let actionButtons = "";
    if (!isStmtReconciled && line.status === "unmatched") {
      const hasMatches = (line.suggested_matches || []).length > 0;
      actionButtons = `
        <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">
          ${
            hasMatches
              ? `<button class="btn btn-sm btn-fill btn-success" style="padding:4px 8px;font-size:11px;" onclick="confirmLineMatch(${line.id})"><i class="fa-solid fa-check"></i> Match</button>`
              : ""
          }
          <button class="btn btn-sm btn-outline" style="padding:4px 8px;font-size:11px;" onclick="openCreateEntryForLine(${line.id})"><i class="fa-solid fa-plus"></i> Create</button>
          <button class="btn btn-sm btn-outline" style="padding:4px 8px;font-size:11px;color:var(--text-muted);" onclick="ignoreStatementLine(${line.id})"><i class="fa-solid fa-ban"></i></button>
        </div>
      `;
    } else {
      actionButtons = `<span style="font-size:11px;color:var(--text-muted);">${escapeHtml(line.notes || 'Resolved')}</span>`;
    }

    tr.innerHTML = `
      <td style="font-weight:600;font-size:12px;">${escapeHtml(line.raw_date)}</td>
      <td>
        <div style="font-weight:500;font-size:12px;">${escapeHtml(line.raw_description)}</div>
        ${line.raw_reference ? `<div style="font-size:11px;color:var(--text-muted);">Ref: ${escapeHtml(line.raw_reference)}</div>` : ''}
      </td>
      <td style="text-align:right;font-weight:600;font-size:13px;" class="${amountClass}">${formattedAmount}</td>
      <td style="text-align:center;">${statusBadge}</td>
      <td>${matchColContent}</td>
      <td style="text-align:center;">${actionButtons}</td>
    `;
    tbody.appendChild(tr);
  });
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
    // Update local state and re-render
    const idx = _currentReconcileLines.findIndex((l) => l.id === lineId);
    if (idx >= 0) _currentReconcileLines[idx] = updated;

    _currentReconcileImport.matched_lines_count = _currentReconcileLines.filter((l) =>
      ["matched", "created", "ignored"].includes(l.status)
    ).length;

    updateReconciliationHeader(_currentReconcileImport);
    filterReconciliationLines(_currentReconcileFilter);
    await loadFinanceStatements();
  } catch (err) {
    console.error("Match resolution failed", err);
    showToast(err.message || "Failed to confirm match", "error");
  }
}

async function ignoreStatementLine(lineId) {
  if (!_currentReconcileImport) return;
  try {
    const updated = await FinanceApi.resolveStatementLine(_currentReconcileImport.id, lineId, {
      action: "ignore",
      notes: "Ignored by user",
    });

    showToast("Line ignored", "info");
    const idx = _currentReconcileLines.findIndex((l) => l.id === lineId);
    if (idx >= 0) _currentReconcileLines[idx] = updated;

    _currentReconcileImport.matched_lines_count = _currentReconcileLines.filter((l) =>
      ["matched", "created", "ignored"].includes(l.status)
    ).length;

    updateReconciliationHeader(_currentReconcileImport);
    filterReconciliationLines(_currentReconcileFilter);
    await loadFinanceStatements();
  } catch (err) {
    console.error("Ignore failed", err);
    showToast(err.message || "Failed to ignore line", "error");
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
  if (!_currentReconcileImport) return;
  const btn = document.getElementById("btnFinalizeReconciliation");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Reconciling Period...';
  }

  try {
    const reconciled = await FinanceApi.reconcileStatement(_currentReconcileImport.id);
    _currentReconcileImport = reconciled;
    updateReconciliationHeader(reconciled);
    renderReconciliationLinesTable(_currentReconcileLines);
    showToast(`Statement period ${reconciled.period_month} successfully reconciled and closed!`, "success");
    await loadFinanceStatements();
  } catch (err) {
    console.error("Reconciliation finalization failed", err);
    showToast(err.message || "Failed to finalize reconciliation", "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-lock"></i> Reconcile &amp; Close Period';
    }
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
window.ignoreStatementLine = ignoreStatementLine;
window.openCreateEntryForLine = openCreateEntryForLine;
window.closeReconcileCreateEntryModal = closeReconcileCreateEntryModal;
window.handleReconcileCreateEntrySubmit = handleReconcileCreateEntrySubmit;
window.finalizeStatementReconciliation = finalizeStatementReconciliation;
window.syncStatementUploadPeriod = syncStatementUploadPeriod;
window.onStatementFilterSelectChange = onStatementFilterSelectChange;
window.onStatementFilterChange = onStatementFilterChange;
window.onStatementAccountSelected = onStatementAccountSelected;

