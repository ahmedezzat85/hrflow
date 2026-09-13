// ==========================================
// 9. Bank Statement Imports & Reconciliation (Phase 7)
// ==========================================
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

async function openUploadStatementModal(presetAccountId) {
  const form = document.getElementById("financeStatementUploadForm");
  if (form) form.reset();

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
      if (presetAccountId) {
        select.value = String(presetAccountId);
      }
    } catch (e) {
      console.warn("Could not load accounts", e);
      if (FinanceState && FinanceState.accounts) {
        select.innerHTML = '<option value="">— Select company bank account —</option>';
        FinanceState.accounts.forEach((a) => {
          if (a.is_active !== false && (a.account_type || "").toLowerCase() !== "cash") {
            const opt = document.createElement("option");
            opt.value = a.id;
            opt.textContent = `${a.account_name} (${a.currency || "USD"}) — ${a.bank_name || "Bank"}`;
            select.appendChild(opt);
          }
        });
        if (presetAccountId) select.value = String(presetAccountId);
      }
    }
  }

  // Pre-fill current month YYYY-MM and sync selects
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, "0");

  const monthSel = document.getElementById("stmtUploadMonth");
  const yearSel = document.getElementById("stmtUploadYear");
  if (monthSel) monthSel.value = m;
  if (yearSel) yearSel.value = y;

  const periodInput = document.getElementById("stmtUploadPeriodMonth");
  if (periodInput) {
    periodInput.value = `${y}-${m}`;
  }

  const mappingFields = document.getElementById("stmtCsvMappingFields");
  if (mappingFields) mappingFields.style.display = "none";

  openModal("financeStatementUploadModal");
}

function closeUploadStatementModal() {
  closeModal("financeStatementUploadModal");
}

function toggleCsvMappingFields() {
  const el = document.getElementById("stmtCsvMappingFields");
  const chevron = document.getElementById("stmtCsvMappingChevron");
  if (!el) return;
  const isHidden = el.style.display === "none";
  el.style.display = isHidden ? "block" : "none";
  if (chevron) chevron.style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
}

function onStatementFileTypeChange() {
  const type = document.getElementById("stmtUploadFileType")?.value;
  const fileInput = document.getElementById("stmtUploadFile");
  const mappingSec = document.getElementById("stmtCsvMappingSection");
  if (fileInput) {
    fileInput.accept = type === "pdf" ? ".pdf" : ".csv";
  }
  if (mappingSec) {
    mappingSec.style.display = type === "pdf" ? "none" : "block";
  }
}

async function handleStatementUploadSubmit(e) {
  e.preventDefault();
  const accountId = document.getElementById("stmtUploadAccountId")?.value;
  const periodMonth = document.getElementById("stmtUploadPeriodMonth")?.value;
  const fileInput = document.getElementById("stmtUploadFile");

  if (!accountId) {
    showToast("Please select a target bank account", "error");
    return;
  }
  if (!periodMonth) {
    showToast("Please specify the statement period month", "error");
    return;
  }
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showToast("Please choose a statement file to upload", "error");
    return;
  }

  const formData = new FormData();
  formData.append("period_month", periodMonth);
  formData.append("file", fileInput.files[0]);

  // Optional custom mapping
  const dateCol = document.getElementById("mapDateCol")?.value.trim();
  const descCol = document.getElementById("mapDescCol")?.value.trim();
  const debitCol = document.getElementById("mapDebitCol")?.value.trim();
  const creditCol = document.getElementById("mapCreditCol")?.value.trim();
  if (dateCol || descCol || debitCol || creditCol) {
    const mapping = {};
    if (dateCol) mapping.date_col = dateCol;
    if (descCol) mapping.description_col = descCol;
    if (debitCol) mapping.debit_col = debitCol;
    if (creditCol) mapping.credit_col = creditCol;
    formData.append("column_mapping", JSON.stringify(mapping));
  }

  const submitBtn = document.getElementById("btnSubmitStatementUpload");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading &amp; Parsing...';
  }

  try {
    const result = await FinanceApi.uploadStatement(accountId, formData);
    showToast(`Statement uploaded successfully (${result.total_lines_count || 0} lines parsed)`, "success");
    closeUploadStatementModal();
    await loadFinanceStatements();

    // Open reconciliation modal immediately
    if (result && result.id) {
      openReconciliationModal(result.id);
    }
  } catch (err) {
    console.error("Statement upload failed", err);
    showToast(err.message || "Failed to upload bank statement", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload &amp; Parse';
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
window.toggleCsvMappingFields = toggleCsvMappingFields;
window.onStatementFileTypeChange = onStatementFileTypeChange;
window.handleStatementUploadSubmit = handleStatementUploadSubmit;
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

