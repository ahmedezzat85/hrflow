// ==========================================
// 10. Financial Reports & Excel Export (Phase 8) & Story 7.1 Report Library & Shell
// ==========================================
let _currentReportsTab = "category-summary";
let _currentMatrixPeriodGroup = "month";
let _reportTxSearchDebounceTimer = null;
let _reportLibrary = [];
let _activeDomainFilter = "all";
let _activeReportKey = "category-summary";
let _currentSavedViews = [];
let _activeSavedViewId = null;
let _currentDrilldownRecords = [];
let _currentDrilldownContext = {};

// ----------------------------------------------------------------------
// Report Library Directory View & Domain Filtering
// ----------------------------------------------------------------------
async function loadReportLibrary() {
  try {
    const data = await FinanceApi.getReportLibrary();
    _reportLibrary = (data && data.reports) || [];
    renderReportLibraryCatalog();
  } catch (err) {
    console.error("Failed to load report library catalog:", err);
  }
}

function filterReportLibraryByDomain(domain, btn) {
  _activeDomainFilter = domain;
  const container = document.getElementById("reportLibraryCategoryPills");
  if (container) {
    container.querySelectorAll(".filter-tab").forEach((b) => b.classList.remove("active"));
  }
  if (btn) btn.classList.add("active");
  renderReportLibraryCatalog();
}

function filterReportLibraryCatalog() {
  renderReportLibraryCatalog();
}

function renderReportLibraryCatalog() {
  const grid = document.getElementById("reportLibraryGrid");
  if (!grid) return;
  const q = (document.getElementById("reportLibrarySearch")?.value || "").toLowerCase().trim();

  const filtered = (_reportLibrary || []).filter((r) => {
    const matchesDomain = _activeDomainFilter === "all" || r.category === _activeDomainFilter;
    const matchesSearch =
      !q ||
      r.title.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q) ||
      (r.business_question || "").toLowerCase().includes(q) ||
      (r.description || "").toLowerCase().includes(q);
    return matchesDomain && matchesSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1 / -1; padding:40px; text-align:center;">
        <i class="fa-solid fa-magnifying-glass" style="font-size:2rem; color:var(--text-muted); margin-bottom:12px;"></i>
        <p style="color:var(--text-muted);">No reports found matching "${q}".</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered
    .map((r) => {
      const basisList = (r.supported_basis || [])
        .map((b) => b.charAt(0).toUpperCase() + b.slice(1))
        .join(" & ");
      return `
      <div class="card report-catalog-card" style="padding:20px; display:flex; flex-direction:column; justify-content:space-between; border-top:3px solid var(--primary, #2563EB); transition:transform 0.15s ease, box-shadow 0.15s ease;">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:10px;">
            <div style="width:40px; height:40px; border-radius:8px; background:rgba(37,99,235,0.1); color:var(--primary, #2563EB); display:flex; align-items:center; justify-content:center; font-size:1.2rem;">
              <i class="${r.icon || 'fa-solid fa-chart-pie'}"></i>
            </div>
            <span class="badge badge-info" style="font-size:0.75rem;">${r.category}</span>
          </div>
          <h3 style="font-size:1.1rem; font-weight:700; color:var(--text-main); margin-bottom:6px;">${r.title}</h3>
          <p style="font-size:0.85rem; color:var(--text-muted); line-height:1.4; margin-bottom:12px;">${r.description}</p>
          <div style="background:var(--bg-secondary, #F8FAFC); border-left:3px solid var(--primary, #2563EB); padding:8px 12px; border-radius:4px; font-size:0.82rem; color:var(--text-main); margin-bottom:14px; font-style:italic;">
            <i class="fa-solid fa-circle-question" style="color:var(--primary, #2563EB); margin-right:4px;"></i> Answers: "${r.business_question}"
          </div>
        </div>
        <div style="display:flex; justify-content:space-between; align-items:center; padding-top:10px; border-top:1px solid var(--border-color, #E2E8F0); margin-top:10px;">
          <span class="badge badge-neutral" style="font-size:0.75rem;">${basisList || 'Cash & Accrual'}</span>
          <button class="btn btn-sm btn-primary" onclick="openReportFromLibrary('${r.key}')">
            <i class="fa-solid fa-arrow-right"></i> Open Report
          </button>
        </div>
      </div>
    `;
    })
    .join("");
}

// ----------------------------------------------------------------------
// Shared Report Shell Navigation & Setup
// ----------------------------------------------------------------------
function backToReportLibrary() {
  const dirView = document.getElementById("reportLibraryDirectoryView");
  const shell = document.getElementById("reportShellContainer");
  if (dirView) dirView.style.display = "block";
  if (shell) shell.style.display = "none";
}

async function openReportFromLibrary(reportKey) {
  _activeReportKey = reportKey;
  const dirView = document.getElementById("reportLibraryDirectoryView");
  const shell = document.getElementById("reportShellContainer");
  if (dirView) dirView.style.display = "none";
  if (shell) shell.style.display = "block";

  // Find metadata
  const meta = (_reportLibrary || []).find((r) => r.key === reportKey);
  const titleEl = document.getElementById("reportShellTitle");
  const catBadge = document.getElementById("reportShellCategoryBadge");
  const basisBadge = document.getElementById("reportShellBasisBadge");
  const qEl = document.getElementById("reportShellQuestion");

  if (titleEl && meta) {
    titleEl.innerHTML = `<i class="${meta.icon || 'fa-solid fa-chart-pie'}"></i> ${meta.title}`;
  }
  if (catBadge && meta) catBadge.textContent = meta.category;
  if (basisBadge && meta) {
    basisBadge.textContent =
      (meta.supported_basis || [])
        .map((b) => b.charAt(0).toUpperCase() + b.slice(1))
        .join(" & ") || "Cash & Accrual";
  }
  if (qEl && meta) {
    qEl.innerHTML = `<strong>Answers:</strong> ${meta.business_question}`;
  }

  // Load saved views for this report
  await loadSavedReportViews(reportKey);

  // Switch to inner pane
  const validTabs = [
    "category-summary",
    "matrix",
    "balances",
    "profit-and-loss",
    "balance-sheet",
    "trial-balance",
    "cash-flow",
    "ar-aging",
    "ap-aging",
    "transactions",
    "cheques",
    "compensation-summary",
    "statutory-remitted",
    "payable-status",
  ];
  const subnav = document.getElementById("financeReportsSubNav");
  const placeholder = document.getElementById("reportPanePlaceholder");

  if (validTabs.includes(reportKey)) {
    if (placeholder) placeholder.style.display = "none";
    if (subnav) subnav.style.display = "flex";
    switchFinanceReportsTab(reportKey);
  } else {
    // Hide standard panes, show placeholder with details
    validTabs.forEach((t) => {
      const pane = document.getElementById(
        {
          "category-summary": "reportPaneCategorySummary",
          matrix: "reportPaneMatrix",
          balances: "reportPaneBalances",
          "profit-and-loss": "reportPaneProfitAndLoss",
          "balance-sheet": "reportPaneBalanceSheet",
          "trial-balance": "reportPaneTrialBalance",
          "cash-flow": "reportPaneCashFlow",
          "ar-aging": "reportPaneArAging",
          "ap-aging": "reportPaneApAging",
          transactions: "reportPaneTransactions",
          cheques: "reportPaneCheques",
          "compensation-summary": "reportPaneCompensationSummary",
          "statutory-remitted": "reportPaneStatutoryRemitted",
          "payable-status": "reportPanePayableStatus",
        }[t]
      );
      if (pane) pane.style.display = "none";
    });
    if (subnav) subnav.style.display = "none";
    if (placeholder) {
      placeholder.style.display = "block";
      const pTitle = document.getElementById("reportPlaceholderTitle");
      const pDesc = document.getElementById("reportPlaceholderDesc");
      const pIcon = document.getElementById("reportPlaceholderIcon");
      if (pTitle && meta) pTitle.textContent = meta.title;
      if (pDesc && meta)
        pDesc.textContent =
          meta.description + " Underlying transactions and documents can be inspected below.";
      if (pIcon && meta) pIcon.className = meta.icon || "fa-solid fa-chart-line";
    }
  }
}

function switchFinanceReportsTab(tabName, btn) {
  _currentReportsTab = tabName;
  _activeReportKey = tabName;

  // Update tabs
  const subnav = document.getElementById("financeReportsSubNav");
  if (subnav) {
    subnav.querySelectorAll(".filter-tab").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
      b.setAttribute("tabindex", "-1");
    });
  }
  const activeBtn = btn || (subnav ? subnav.querySelector(`[data-report-tab="${tabName}"]`) : null);
  if (activeBtn) {
    activeBtn.classList.add("active");
    activeBtn.setAttribute("aria-selected", "true");
    activeBtn.setAttribute("tabindex", "0");
  }

  // Toggle panes
  const panes = {
    "category-summary": "reportPaneCategorySummary",
    matrix: "reportPaneMatrix",
    balances: "reportPaneBalances",
    "profit-and-loss": "reportPaneProfitAndLoss",
    "balance-sheet": "reportPaneBalanceSheet",
    "trial-balance": "reportPaneTrialBalance",
    "cash-flow": "reportPaneCashFlow",
    "ar-aging": "reportPaneArAging",
    "ap-aging": "reportPaneApAging",
    transactions: "reportPaneTransactions",
    cheques: "reportPaneCheques",
    "compensation-summary": "reportPaneCompensationSummary",
    "statutory-remitted": "reportPaneStatutoryRemitted",
    "payable-status": "reportPanePayableStatus",
  };

  const placeholder = document.getElementById("reportPanePlaceholder");
  if (placeholder) placeholder.style.display = "none";

  Object.entries(panes).forEach(([k, paneId]) => {
    const el = document.getElementById(paneId);
    if (el) {
      el.style.display = k === tabName ? "block" : "none";
    }
  });

  // Sync shell top bar title with active tab
  const meta = (_reportLibrary || []).find((r) => r.key === tabName);
  if (meta) {
    const titleEl = document.getElementById("reportShellTitle");
    const catBadge = document.getElementById("reportShellCategoryBadge");
    const basisBadge = document.getElementById("reportShellBasisBadge");
    const qEl = document.getElementById("reportShellQuestion");
    if (titleEl) titleEl.innerHTML = `<i class="${meta.icon || 'fa-solid fa-chart-pie'}"></i> ${meta.title}`;
    if (catBadge) catBadge.textContent = meta.category;
    if (basisBadge) {
      basisBadge.textContent =
        (meta.supported_basis || [])
          .map((b) => b.charAt(0).toUpperCase() + b.slice(1))
          .join(" & ") || "Cash & Accrual";
    }
    if (qEl) qEl.innerHTML = `<strong>Answers:</strong> ${meta.business_question}`;
  }

  // Load active tab data
  if (tabName === "category-summary") {
    loadReportCategorySummary();
  } else if (tabName === "matrix") {
    loadReportMatrix();
  } else if (tabName === "balances") {
    loadReportBalances();
  } else if (tabName === "profit-and-loss") {
    loadReportProfitAndLoss();
  } else if (tabName === "balance-sheet") {
    loadReportBalanceSheet();
  } else if (tabName === "trial-balance") {
    loadReportTrialBalance();
  } else if (tabName === "cash-flow") {
    loadReportCashFlow();
  } else if (tabName === "ar-aging") {
    loadReportArAging();
  } else if (tabName === "ap-aging") {
    loadReportApAging();
  } else if (tabName === "transactions") {
    loadReportTransactions();
  } else if (tabName === "cheques") {
    loadReportCheques();
  } else if (tabName === "compensation-summary") {
    loadCompensationSummaryReport();
  } else if (tabName === "statutory-remitted") {
    loadStatutoryRemittedReport();
  } else if (tabName === "payable-status") {
    loadPayableStatusReport();
  }
}

async function loadFinanceReports() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const today = `${yyyy}-${mm}-${dd}`;
  const firstOfMonth = `${yyyy}-${mm}-01`;

  const sFrom = document.getElementById("reportShellDateFrom");
  const sTo = document.getElementById("reportShellDateTo");
  if (sFrom && !sFrom.value) sFrom.value = firstOfMonth;
  if (sTo && !sTo.value) sTo.value = today;

  const dFrom1 = document.getElementById("reportCatSumDateFrom");
  const dTo1 = document.getElementById("reportCatSumDateTo");
  if (dFrom1 && !dFrom1.value) dFrom1.value = firstOfMonth;
  if (dTo1 && !dTo1.value) dTo1.value = today;

  const dAsOf = document.getElementById("reportBalancesAsOfDate");
  if (dAsOf && !dAsOf.value) dAsOf.value = today;

  const dFromTx = document.getElementById("reportTxDateFrom");
  const dToTx = document.getElementById("reportTxDateTo");
  if (dFromTx && !dFromTx.value) dFromTx.value = firstOfMonth;
  if (dToTx && !dToTx.value) dToTx.value = today;

  // Populate account & category dropdowns in transactions pane
  populateReportFilters();

  // Load catalog
  await loadReportLibrary();
}

function populateReportFilters() {
  const accSel = document.getElementById("reportTxAccount");
  if (accSel && accSel.options.length <= 1) {
    (FinanceState.accounts || []).forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `${a.account_name} (${a.currency})`;
      accSel.appendChild(opt);
    });
  }

  const catSel = document.getElementById("reportTxCategory");
  if (catSel && catSel.options.length <= 1) {
    (FinanceState.categories || []).forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      catSel.appendChild(opt);
    });
  }
}

// ----------------------------------------------------------------------
// Period Presets & Filter Bar Synchronization
// ----------------------------------------------------------------------
function onReportShellPeriodPresetChanged(preset) {
  const dFrom = document.getElementById("reportShellDateFrom");
  const dTo = document.getElementById("reportShellDateTo");
  if (!dFrom || !dTo) return;

  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth(); // 0-indexed

  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;

  if (preset === "this_month") {
    dFrom.value = `${y}-${pad(m + 1)}-01`;
    dTo.value = fmt(now);
  } else if (preset === "last_month") {
    const firstLastM = new Date(y, m - 1, 1);
    const lastLastM = new Date(y, m, 0);
    dFrom.value = fmt(firstLastM);
    dTo.value = fmt(lastLastM);
  } else if (preset === "this_quarter") {
    const qStartMonth = Math.floor(m / 3) * 3;
    dFrom.value = `${y}-${pad(qStartMonth + 1)}-01`;
    dTo.value = fmt(now);
  } else if (preset === "ytd") {
    dFrom.value = `${y}-01-01`;
    dTo.value = fmt(now);
  } else if (preset === "trailing_12m") {
    const t12 = new Date(y - 1, m, now.getDate());
    dFrom.value = fmt(t12);
    dTo.value = fmt(now);
  }
  onReportShellFilterChanged();
}

function onReportShellFilterChanged() {
  const dFrom = document.getElementById("reportShellDateFrom")?.value || "";
  const dTo = document.getElementById("reportShellDateTo")?.value || "";
  const curr = document.getElementById("reportShellCurrency")?.value || "";

  // Propagate to active panes
  const cFrom = document.getElementById("reportCatSumDateFrom");
  const cTo = document.getElementById("reportCatSumDateTo");
  const cCurr = document.getElementById("reportCatSumCurrency");
  if (cFrom && dFrom) cFrom.value = dFrom;
  if (cTo && dTo) cTo.value = dTo;
  if (cCurr) cCurr.value = curr;

  const bAsOf = document.getElementById("reportBalancesAsOfDate");
  if (bAsOf && dTo) bAsOf.value = dTo;

  const txFrom = document.getElementById("reportTxDateFrom");
  const txTo = document.getElementById("reportTxDateTo");
  if (txFrom && dFrom) txFrom.value = dFrom;
  if (txTo && dTo) txTo.value = dTo;

  refreshActiveReport();
}

function refreshActiveReport() {
  const freshness = document.getElementById("reportShellFreshness");
  if (freshness) {
    const timeStr = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    freshness.innerHTML = `<i class="fa-solid fa-clock"></i> Fresh as of: ${timeStr}`;
  }

  if (_currentReportsTab === "category-summary") {
    loadReportCategorySummary();
  } else if (_currentReportsTab === "matrix") {
    loadReportMatrix();
  } else if (_currentReportsTab === "balances") {
    loadReportBalances();
  } else if (_currentReportsTab === "profit-and-loss") {
    loadReportProfitAndLoss();
  } else if (_currentReportsTab === "balance-sheet") {
    loadReportBalanceSheet();
  } else if (_currentReportsTab === "trial-balance") {
    loadReportTrialBalance();
  } else if (_currentReportsTab === "cash-flow") {
    loadReportCashFlow();
  } else if (_currentReportsTab === "ar-aging") {
    loadReportArAging();
  } else if (_currentReportsTab === "ap-aging") {
    loadReportApAging();
  } else if (_currentReportsTab === "transactions") {
    loadReportTransactions();
  } else if (_currentReportsTab === "cheques") {
    loadReportCheques();
  } else if (_currentReportsTab === "compensation-summary") {
    loadCompensationSummaryReport();
  } else if (_currentReportsTab === "statutory-remitted") {
    loadStatutoryRemittedReport();
  } else if (_currentReportsTab === "payable-status") {
    loadPayableStatusReport();
  }
}

// ----------------------------------------------------------------------
// Saved Views CRUD Management
// ----------------------------------------------------------------------
async function loadSavedReportViews(reportKey) {
  try {
    const views = await FinanceApi.getSavedReportViews(reportKey);
    _currentSavedViews = views || [];
    const sel = document.getElementById("reportShellSavedViews");
    const delBtn = document.getElementById("reportShellDeleteViewBtn");
    if (delBtn) delBtn.style.display = "none";
    if (!sel) return;

    sel.innerHTML = '<option value="">Standard View</option>';
    let defaultView = null;
    _currentSavedViews.forEach((v) => {
      const opt = document.createElement("option");
      opt.value = v.id;
      opt.textContent = v.view_name + (v.is_default ? " (Default)" : "");
      sel.appendChild(opt);
      if (v.is_default) defaultView = v;
    });

    if (defaultView) {
      sel.value = defaultView.id;
      applySelectedSavedView(defaultView.id, false);
    }
  } catch (err) {
    console.error("Failed to load saved report views:", err);
  }
}

function applySelectedSavedView(viewId, triggerReload = true) {
  const delBtn = document.getElementById("reportShellDeleteViewBtn");
  if (!viewId) {
    _activeSavedViewId = null;
    if (delBtn) delBtn.style.display = "none";
    if (triggerReload) onReportShellFilterChanged();
    return;
  }

  _activeSavedViewId = parseInt(viewId, 10);
  if (delBtn) delBtn.style.display = "inline-flex";

  const v = _currentSavedViews.find((x) => x.id === _activeSavedViewId);
  if (!v || !v.filters) return;

  const f = v.filters;
  if (f.preset) {
    const pSel = document.getElementById("reportShellPeriodPreset");
    if (pSel) pSel.value = f.preset;
  }
  if (f.date_from) {
    const dF = document.getElementById("reportShellDateFrom");
    if (dF) dF.value = f.date_from;
  }
  if (f.date_to) {
    const dT = document.getElementById("reportShellDateTo");
    if (dT) dT.value = f.date_to;
  }
  if (f.basis) {
    const bSel = document.getElementById("reportShellBasis");
    if (bSel) bSel.value = f.basis;
  }
  if (f.currency !== undefined) {
    const cSel = document.getElementById("reportShellCurrency");
    if (cSel) cSel.value = f.currency;
  }
  if (f.comparison) {
    const cmpSel = document.getElementById("reportShellComparison");
    if (cmpSel) cmpSel.value = f.comparison;
  }
  if (f.entity) {
    const eSel = document.getElementById("reportShellEntity");
    if (eSel) eSel.value = f.entity;
  }

  if (triggerReload) onReportShellFilterChanged();
}

function openSaveReportViewModal() {
  const m = document.getElementById("saveReportViewModal");
  if (!m) return;
  const nameInput = document.getElementById("saveReportViewName");
  const defCheck = document.getElementById("saveReportViewIsDefault");
  if (nameInput) nameInput.value = "";
  if (defCheck) defCheck.checked = false;
  m.style.display = "flex";
}

function closeSaveReportViewModal() {
  const m = document.getElementById("saveReportViewModal");
  if (m) m.style.display = "none";
}

async function submitSaveReportView() {
  const nameInput = document.getElementById("saveReportViewName");
  const defCheck = document.getElementById("saveReportViewIsDefault");
  const viewName = nameInput?.value?.trim();
  if (!viewName) {
    showToast("Please enter a name for this view", "error");
    return;
  }

  const payload = {
    report_key: _activeReportKey,
    view_name: viewName,
    is_default: !!defCheck?.checked,
    filters: {
      preset: document.getElementById("reportShellPeriodPreset")?.value || "custom",
      date_from: document.getElementById("reportShellDateFrom")?.value || "",
      date_to: document.getElementById("reportShellDateTo")?.value || "",
      basis: document.getElementById("reportShellBasis")?.value || "cash",
      currency: document.getElementById("reportShellCurrency")?.value || "",
      comparison: document.getElementById("reportShellComparison")?.value || "none",
      entity: document.getElementById("reportShellEntity")?.value || "all",
    },
  };

  try {
    const saved = await FinanceApi.createSavedReportView(payload);
    closeSaveReportViewModal();
    showToast(`Saved view "${saved.view_name}" created`, "success");
    await loadSavedReportViews(_activeReportKey);
    const sel = document.getElementById("reportShellSavedViews");
    if (sel && saved.id) {
      sel.value = saved.id;
      applySelectedSavedView(saved.id, false);
    }
  } catch (err) {
    console.error("Failed to save report view:", err);
    showToast(err.message || "Failed to save report view", "error");
  }
}

async function deleteActiveReportView() {
  if (!_activeSavedViewId) return;
  if (!confirm("Are you sure you want to delete this saved view?")) return;

  try {
    await FinanceApi.deleteSavedReportView(_activeSavedViewId);
    showToast("Saved view deleted", "success");
    _activeSavedViewId = null;
    await loadSavedReportViews(_activeReportKey);
  } catch (err) {
    console.error("Failed to delete view:", err);
    showToast(err.message || "Failed to delete saved view", "error");
  }
}

// ----------------------------------------------------------------------
// Contextual Drill-Down Modal & Records Export
// ----------------------------------------------------------------------
async function openReportDrilldown(drilldownType, targetId, title) {
  const m = document.getElementById("reportDrilldownModal");
  if (!m) return;
  m.style.display = "flex";

  const tEl = document.getElementById("reportDrilldownTitle");
  const subEl = document.getElementById("reportDrilldownSubtitle");
  const ctxText = document.getElementById("reportDrilldownContextText");
  const countEl = document.getElementById("reportDrilldownRecordCount");
  const sumEl = document.getElementById("reportDrilldownTotalSum");
  const tbody = document.getElementById("reportDrilldownTableBody");
  const empty = document.getElementById("reportDrilldownEmpty");
  const loading = document.getElementById("reportDrilldownLoadingBar");

  if (tEl) tEl.innerHTML = `<i class="fa-solid fa-search-dollar"></i> ${title || 'Transaction Drill-Down'}`;
  if (subEl) subEl.textContent = `Granular ledger transactions for ${title || 'selected item'}`;
  if (ctxText) ctxText.textContent = `${(drilldownType || '').toUpperCase()}: ${title || targetId}`;
  if (tbody) tbody.innerHTML = "";
  if (empty) empty.style.display = "none";
  if (loading) loading.style.display = "block";

  const dateFrom = document.getElementById("reportShellDateFrom")?.value || "";
  const dateTo = document.getElementById("reportShellDateTo")?.value || "";
  const currency = document.getElementById("reportShellCurrency")?.value || "";

  _currentDrilldownContext = { drilldownType, targetId, title, dateFrom, dateTo, currency };

  try {
    const res = await FinanceApi.getReportDrilldown({
      report_key: _activeReportKey,
      drilldown_type: drilldownType,
      target_id: targetId,
      date_from: dateFrom,
      date_to: dateTo,
      currency: currency || undefined,
    });

    _currentDrilldownRecords = res.records || [];
    if (countEl) countEl.textContent = res.total_records || _currentDrilldownRecords.length;
    if (sumEl) sumEl.textContent = FinanceFormat.formatMoney(res.total_amount || 0, res.currency || currency || "USD");

    if (_currentDrilldownRecords.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }

    _currentDrilldownRecords.forEach((r) => {
      const tr = document.createElement("tr");
      const isOut = (r.direction || "out") === "out";
      tr.innerHTML = `
        <td>${FinanceFormat.formatFinanceDate(r.date)}</td>
        <td><span class="badge ${isOut ? 'badge-danger' : 'badge-success'}">${(r.type || 'expense').toUpperCase()}</span></td>
        <td><code>${r.reference || '—'}</code></td>
        <td><strong>${r.description || '—'}</strong></td>
        <td>${r.account || '—'}</td>
        <td style="text-align:center;"><span class="badge ${isOut ? 'badge-danger' : 'badge-success'}">${(r.direction || 'out').toUpperCase()}</span></td>
        <td class="cell-money" style="text-align:right; font-weight:600; color:${isOut ? '#EF4444' : '#10B981'};">
          ${isOut ? '-' : '+'}${FinanceFormat.formatMoney(r.amount || 0, r.currency || 'USD')}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load drilldown data:", err);
    showToast(err.message || "Failed to load drilldown details", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function closeReportDrilldownModal() {
  const m = document.getElementById("reportDrilldownModal");
  if (m) m.style.display = "none";
}

function exportDrilldownData() {
  if (!_currentDrilldownRecords || _currentDrilldownRecords.length === 0) {
    showToast("No records available to export", "info");
    return;
  }
  const headers = ["Date", "Type", "Reference", "Description", "Account", "Direction", "Amount", "Currency"];
  const rows = _currentDrilldownRecords.map((r) => [
    `"${r.date || ''}"`,
    `"${r.type || ''}"`,
    `"${r.reference || ''}"`,
    `"${(r.description || '').replace(/"/g, '""')}"`,
    `"${(r.account || '').replace(/"/g, '""')}"`,
    `"${r.direction || ''}"`,
    r.amount || 0,
    `"${r.currency || 'USD'}"`,
  ]);
  const csvContent = [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `drilldown_${_currentDrilldownContext.drilldownType || 'records'}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Drilldown records exported to CSV", "success");
}

// ----------------------------------------------------------------------
// Export Menu & Handlers
// ----------------------------------------------------------------------
function toggleReportExportMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById("reportShellExportMenu");
  if (menu) {
    menu.style.display = menu.style.display === "block" ? "none" : "block";
  }
}

document.addEventListener("click", () => {
  const menu = document.getElementById("reportShellExportMenu");
  if (menu) menu.style.display = "none";
});

function getActiveReportFilters() {
  return {
    preset: document.getElementById("reportShellPeriodPreset")?.value || "custom",
    date_from: document.getElementById("reportShellDateFrom")?.value || "",
    date_to: document.getElementById("reportShellDateTo")?.value || "",
    basis: document.getElementById("reportShellBasis")?.value || "cash",
    currency: document.getElementById("reportShellCurrency")?.value || "",
    comparison: document.getElementById("reportShellComparison")?.value || "none",
    entity: document.getElementById("reportShellEntity")?.value || "all",
  };
}

function _escapeHtmlText(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function exportActiveReport(format) {
  const menu = document.getElementById("reportShellExportMenu");
  if (menu) menu.style.display = "none";

  const normFormat = (format === "excel" ? "xlsx" : format || "xlsx").toLowerCase();
  const reportKey = _activeReportKey || _currentReportsTab || "profit-and-loss";
  const filters = getActiveReportFilters();

  try {
    showToast(`Generating ${normFormat.toUpperCase()} export for ${reportKey}...`, "info");
    await FinanceApi.exportReport({
      report_key: reportKey,
      format: normFormat,
      filters: filters,
    });
    showToast(`${normFormat.toUpperCase()} export completed`, "success");
  } catch (err) {
    console.error("Export failed:", err);
    showToast(err.message || "Failed to generate report export", "error");
  }
}

// ----------------------------------------------------------------------
// Scheduled Delivery & Export Audits (Story 7.3)
// ----------------------------------------------------------------------
function openScheduleReportModal() {
  const modal = document.getElementById("scheduleReportExportModal");
  if (!modal) return;
  const menu = document.getElementById("reportShellExportMenu");
  if (menu) menu.style.display = "none";

  const reportKey = _activeReportKey || _currentReportsTab || "profit-and-loss";
  const meta = (_reportLibrary || []).find((r) => r.key === reportKey);
  const title = meta ? meta.title : reportKey.replace(/-/g, " ").toUpperCase();

  const titleEl = document.getElementById("scheduleReportTargetTitle");
  if (titleEl) titleEl.value = `${title} (${reportKey})`;

  const infoEl = document.getElementById("scheduleReportFilterInfo");
  const filters = getActiveReportFilters();
  if (infoEl) {
    infoEl.textContent = `Basis: ${filters.basis.toUpperCase()}, Currency: ${filters.currency || "USD"}, Period: ${filters.preset}`;
  }

  const recEl = document.getElementById("scheduleReportRecipients");
  if (recEl) recEl.value = "";

  modal.style.display = "flex";
}

function closeScheduleReportModal() {
  const modal = document.getElementById("scheduleReportExportModal");
  if (modal) modal.style.display = "none";
}

async function submitScheduleReport() {
  const reportKey = _activeReportKey || _currentReportsTab || "profit-and-loss";
  const meta = (_reportLibrary || []).find((r) => r.key === reportKey);
  const title = meta ? meta.title : reportKey.replace(/-/g, " ").toUpperCase();
  const frequency = document.getElementById("scheduleReportFrequency")?.value || "monthly";
  const format = document.getElementById("scheduleReportFormat")?.value || "xlsx";
  const rawRecipients = document.getElementById("scheduleReportRecipients")?.value?.trim() || "";

  if (!rawRecipients) {
    showToast("Please enter at least one recipient email", "error");
    return;
  }

  const recipients = rawRecipients
    .split(/[\n,]+/)
    .map((e) => e.trim())
    .filter((e) => Boolean(e) && e.includes("@"));

  if (recipients.length === 0) {
    showToast("Please provide valid email address(es)", "error");
    return;
  }

  const payload = {
    report_key: reportKey,
    report_title: title,
    frequency,
    recipients,
    export_format: format,
    filters: getActiveReportFilters(),
  };

  try {
    const created = await FinanceApi.createReportSchedule(payload);
    closeScheduleReportModal();
    showToast(`Automated delivery scheduled for ${title} (${frequency})`, "success");
    loadReportSchedules();
  } catch (err) {
    console.error("Failed to create report schedule:", err);
    showToast(err.message || "Failed to schedule report delivery", "error");
  }
}

let _currentDeliveriesModalTab = "schedules";

function openScheduledDeliveriesModal() {
  const modal = document.getElementById("reportDeliveriesAndAuditsModal");
  if (!modal) return;
  const menu = document.getElementById("reportShellExportMenu");
  if (menu) menu.style.display = "none";

  modal.style.display = "flex";
  switchDeliveriesModalTab("schedules");
  loadReportSchedules();
  loadReportExportAudits();
}

function closeScheduledDeliveriesModal() {
  const modal = document.getElementById("reportDeliveriesAndAuditsModal");
  if (modal) modal.style.display = "none";
}

function switchDeliveriesModalTab(tab) {
  _currentDeliveriesModalTab = tab;
  const btnSched = document.getElementById("btnTabReportSchedules");
  const btnAudits = document.getElementById("btnTabExportAudits");
  const tabSched = document.getElementById("tabContentReportSchedules");
  const tabAudits = document.getElementById("tabContentExportAudits");

  if (tab === "schedules") {
    if (btnSched) btnSched.classList.add("active");
    if (btnAudits) btnAudits.classList.remove("active");
    if (tabSched) tabSched.style.display = "block";
    if (tabAudits) tabAudits.style.display = "none";
  } else {
    if (btnSched) btnSched.classList.remove("active");
    if (btnAudits) btnAudits.classList.add("active");
    if (tabSched) tabSched.style.display = "none";
    if (tabAudits) tabAudits.style.display = "block";
  }
}

async function loadReportSchedules() {
  const tbody = document.getElementById("reportSchedulesTableBody");
  const empty = document.getElementById("reportSchedulesEmpty");
  const countEl = document.getElementById("countReportSchedules");

  try {
    const schedules = await FinanceApi.getReportSchedules();
    if (countEl) countEl.textContent = (schedules || []).length;

    if (!tbody) return;
    tbody.innerHTML = "";

    if (!schedules || schedules.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    tbody.innerHTML = schedules
      .map((s) => {
        const recipientsList = Array.isArray(s.recipients) ? s.recipients.join(", ") : (s.recipients || "—");
        const freqBadge = `<span class="badge badge-info" style="text-transform:capitalize;">${s.frequency}</span>`;
        const fmtBadge = `<span class="badge badge-neutral" style="text-transform:uppercase;">${s.export_format}</span>`;
        return `
          <tr data-schedule-id="${s.id}">
            <td><strong>${_escapeHtmlText(s.report_title || s.report_key)}</strong></td>
            <td>${freqBadge}</td>
            <td>${fmtBadge}</td>
            <td style="max-width:240px; word-break:break-all; font-size:0.85rem;">${_escapeHtmlText(recipientsList)}</td>
            <td style="font-size:0.85rem; color:var(--text-muted);">${_escapeHtmlText(s.created_by || "system")}</td>
            <td style="text-align:center;">
              <button class="btn btn-sm btn-outline delete-schedule-btn" style="color:#EF4444; padding:3px 8px;" onclick="deleteReportSchedule(${s.id})" title="Cancel Delivery Schedule">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    console.error("Failed to load report schedules:", err);
  }
}

async function deleteReportSchedule(scheduleId) {
  if (!confirm("Are you sure you want to cancel this automated delivery schedule?")) return;
  try {
    await FinanceApi.deleteReportSchedule(scheduleId);
    showToast("Delivery schedule cancelled", "success");
    await loadReportSchedules();
  } catch (err) {
    console.error("Failed to delete schedule:", err);
    showToast(err.message || "Failed to cancel schedule", "error");
  }
}

async function loadReportExportAudits() {
  const tbody = document.getElementById("reportExportAuditsTableBody");
  const empty = document.getElementById("reportExportAuditsEmpty");
  const countEl = document.getElementById("countExportAudits");

  try {
    const audits = await FinanceApi.getExportAudits(null, 50);
    if (countEl) countEl.textContent = (audits || []).length;

    if (!tbody) return;
    tbody.innerHTML = "";

    if (!audits || audits.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    tbody.innerHTML = audits
      .map((a) => {
        const dateStr = a.created_at ? new Date(a.created_at).toLocaleString() : "—";
        const fmtBadge = `<span class="badge badge-neutral" style="text-transform:uppercase;">${a.export_format}</span>`;
        return `
          <tr>
            <td style="font-size:0.82rem; white-space:nowrap;">${dateStr}</td>
            <td><strong>${_escapeHtmlText(a.report_key)}</strong></td>
            <td>${fmtBadge}</td>
            <td style="text-align:right; font-weight:600;">${a.row_count || 0}</td>
            <td style="font-family:monospace; font-size:0.82rem; color:var(--text-muted);">${_escapeHtmlText(a.file_name || "—")}</td>
            <td style="font-size:0.85rem;">${_escapeHtmlText(a.user_email || "system")}</td>
          </tr>
        `;
      })
      .join("");
  } catch (err) {
    console.error("Failed to load export audits:", err);
  }
}

// ----------------------------------------------------------------------
// Category Spend Rollup
// ----------------------------------------------------------------------
async function loadReportCategorySummary() {
  const loading = document.getElementById("reportCatSumLoadingBar");
  if (loading) loading.style.display = "block";

  const dateFrom = document.getElementById("reportCatSumDateFrom")?.value || "";
  const dateTo = document.getElementById("reportCatSumDateTo")?.value || "";
  const currency = document.getElementById("reportCatSumCurrency")?.value || "";
  const includeInternal = document.getElementById("reportShellIncludeInternal") ? document.getElementById("reportShellIncludeInternal").checked : true;

  try {
    const report = await FinanceApi.getCategorySummaryReport({
      date_from: dateFrom,
      date_to: dateTo,
      currency: currency || undefined,
      include_internal: includeInternal,
    });

    const totSpentEl = document.getElementById("reportCatSumTotalSpent");
    const catCountEl = document.getElementById("reportCatSumCategoryCount");
    const tbody = document.getElementById("reportCategorySummaryTableBody");
    const empty = document.getElementById("reportCatSumEmpty");

    const total = Number(report.total_spent || 0);
    const reportCurr = currency || report.currency || "USD";
    if (totSpentEl) totSpentEl.textContent = FinanceFormat.formatMoney(total, reportCurr);
    if (catCountEl) catCountEl.textContent = (report.categories || []).length;

    if (!tbody) return;
    tbody.innerHTML = "";

    if (!report.categories || report.categories.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    report.categories.forEach((cat) => {
      const tr = document.createElement("tr");
      const amt = Number(cat.total_amount || 0);
      const pct = Number(cat.percentage || 0);

      tr.style.cursor = "pointer";
      tr.title = "Click to drill down into underlying transactions";
      tr.onclick = () => openReportDrilldown("category", cat.category_id || cat.category_name, cat.category_name);

      tr.innerHTML = `
        <td><strong style="color:var(--primary, #2563EB);">${cat.category_name} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.75rem; margin-left:4px;"></i></strong></td>
        <td><span class="badge ${cat.kind === 'cost' ? 'badge-danger' : 'badge-neutral'}">${(cat.kind || 'cost').toUpperCase()}</span></td>
        <td style="text-align:center;">${cat.transaction_count || 0}</td>
        <td class="cell-money" style="text-align:right; font-weight:600;">${FinanceFormat.renderMoneyHtml(amt, reportCurr)}</td>
        <td>
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="flex:1; height:8px; background:var(--border-color, #E2E8F0); border-radius:4px; overflow:hidden;">
              <div style="width:${Math.min(pct, 100)}%; height:100%; background:#EF4444; border-radius:4px;"></div>
            </div>
            <span style="font-size:0.85rem; font-weight:600; min-width:48px; text-align:right;">${pct.toFixed(1)}%</span>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load category summary:", err);
    showToast(err.message || "Failed to load category spend rollup", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportCategorySummaryExcel() {
  const dateFrom = document.getElementById("reportCatSumDateFrom")?.value || "";
  const dateTo = document.getElementById("reportCatSumDateTo")?.value || "";
  const currency = document.getElementById("reportCatSumCurrency")?.value || "";

  const params = { date_from: dateFrom, date_to: dateTo };
  if (currency) params.currency = currency;

  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/category-summary", params);
  triggerExcelDownload(url, `category_spend_rollup_${dateFrom || 'start'}_to_${dateTo || 'end'}.xlsx`);
}

// ----------------------------------------------------------------------
// Annual Spend Matrix (Month/Quarter Cross-tab)
// ----------------------------------------------------------------------
function setMatrixPeriodGroup(group, btn) {
  _currentMatrixPeriodGroup = group;
  const container = document.getElementById("reportMatrixPeriodTabs");
  if (container) {
    container.querySelectorAll(".filter-tab").forEach((b) => b.classList.remove("active"));
  }
  if (btn) btn.classList.add("active");
  loadReportMatrix();
}

async function loadReportMatrix() {
  const loading = document.getElementById("reportMatrixLoadingBar");
  if (loading) loading.style.display = "block";

  const year = document.getElementById("reportMatrixYear")?.value || "2026";
  const thead = document.getElementById("reportMatrixTableHead");
  const tbody = document.getElementById("reportMatrixTableBody");
  const tfoot = document.getElementById("reportMatrixTableFoot");
  const empty = document.getElementById("reportMatrixEmpty");

  const includeInternal = document.getElementById("reportShellIncludeInternal") ? document.getElementById("reportShellIncludeInternal").checked : true;

  try {
    const report = await FinanceApi.getMatrixReport({
      year: parseInt(year, 10),
      period_group: _currentMatrixPeriodGroup,
      include_internal: includeInternal,
    });

    if (!thead || !tbody) return;
    thead.innerHTML = "";
    tbody.innerHTML = "";
    if (tfoot) tfoot.innerHTML = "";

    const periods = report.periods || [];
    const rows = report.rows || [];

    if (rows.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    // Build Header
    let hHtml = `<tr><th style="min-width:180px;">Category</th>`;
    periods.forEach((p) => {
      hHtml += `<th class="cell-money" style="text-align:right;">${p}</th>`;
    });
    hHtml += `<th class="cell-money" style="text-align:right; min-width:110px;">Total Spent</th></tr>`;
    thead.innerHTML = hHtml;

    // Build Body Rows
    rows.forEach((r) => {
      let rHtml = `<tr><td><strong>${r.category_name}</strong></td>`;
      periods.forEach((p) => {
        const val = Number((r.period_values && r.period_values[p]) || 0);
        rHtml += `<td class="cell-money" style="text-align:right; ${val > 0 ? 'font-weight:600;' : 'color:var(--text-muted);'}">
          ${val > 0 ? FinanceFormat.renderMoneyHtml(val, "USD") : "—"}
        </td>`;
      });
      const rTot = Number(r.total || 0);
      rHtml += `<td class="cell-money" style="text-align:right; font-weight:700;">${FinanceFormat.renderMoneyHtml(rTot, "USD")}</td></tr>`;
      const tr = document.createElement("tr");
      tr.innerHTML = rHtml;
      tbody.appendChild(tr);
    });

    // Build Footer Totals
    if (tfoot) {
      let fHtml = `<tr><td>TOTAL</td>`;
      periods.forEach((p) => {
        const pTot = Number((report.period_totals && report.period_totals[p]) || 0);
        fHtml += `<td class="cell-money" style="text-align:right; color:var(--text-main); font-weight:700;">
          ${FinanceFormat.renderMoneyHtml(pTot, "USD")}
        </td>`;
      });
      const gTot = Number(report.grand_total || 0);
      fHtml += `<td class="cell-money" style="text-align:right; font-weight:800; font-size:1.05rem; color:#EF4444;">
        ${FinanceFormat.renderMoneyHtml(gTot, "USD")}
      </td></tr>`;
      tfoot.innerHTML = fHtml;
    }
  } catch (err) {
    console.error("Failed to load matrix report:", err);
    showToast(err.message || "Failed to load annual spend matrix", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportMatrixExcel() {
  const year = document.getElementById("reportMatrixYear")?.value || "2026";
  const params = { year: parseInt(year, 10), period_group: _currentMatrixPeriodGroup };
  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/matrix", params);
  triggerExcelDownload(url, `spend_matrix_${year}_${_currentMatrixPeriodGroup}.xlsx`);
}

// ----------------------------------------------------------------------
// Point-in-Time Balances
// ----------------------------------------------------------------------
async function loadReportBalances() {
  const loading = document.getElementById("reportBalancesLoadingBar");
  if (loading) loading.style.display = "block";

  const asOfDate = document.getElementById("reportBalancesAsOfDate")?.value || "";

  try {
    const report = await FinanceApi.getBalancesReport({ as_of_date: asOfDate });

    // Render currency rollup summary cards
    const cardsContainer = document.getElementById("reportBalancesCurrencyCards");
    if (cardsContainer) {
      cardsContainer.innerHTML = "";
      Object.entries(report.currency_totals || {}).forEach(([curr, total]) => {
        const cVal = Number(total || 0);
        const card = document.createElement("div");
        card.className = "card";
        card.style.padding = "16px";
        card.style.borderLeft = curr === "USD" ? "4px solid #10B981" : "4px solid #3B82F6";
        card.innerHTML = `
          <div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Total ${curr} Liquidity</div>
          <div style="font-size:1.4rem; font-weight:700; color:var(--text-main); margin-top:4px;">
            ${FinanceFormat.formatMoney(cVal, curr)}
          </div>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">As of ${FinanceFormat.formatFinanceDate(report.as_of_date)}</div>
        `;
        cardsContainer.appendChild(card);
      });
    }

    const tbody = document.getElementById("reportBalancesTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    (report.accounts || []).forEach((acc) => {
      const tr = document.createElement("tr");
      const op = Number(acc.opening_balance || 0);
      const bal = Number(acc.balance_as_of_date || 0);
      const isBank = acc.account_type === "bank";

      tr.style.cursor = "pointer";
      tr.title = "Click to drill down into account transactions";
      tr.onclick = () => openReportDrilldown("account", acc.account_id, acc.account_name);

      tr.innerHTML = `
        <td>
          <div style="font-weight:600; color:var(--primary, #2563EB);">${acc.account_name} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:0.75rem; margin-left:4px;"></i></div>
        </td>
        <td>
          <span class="badge ${isBank ? 'badge-neutral' : 'badge-info'}">
            <i class="fa-solid ${isBank ? 'fa-building-columns' : 'fa-wallet'}"></i> ${acc.account_type.toUpperCase()}
          </span>
        </td>
        <td>${acc.bank_name || "—"}</td>
        <td><code style="font-size:0.85rem;">${FinanceFormat.formatMaskedAccountNumber(acc.account_number, !isBank)}</code></td>
        <td>${acc.country || "—"}</td>
        <td><strong>${acc.currency}</strong></td>
        <td class="cell-money" style="text-align:right; color:var(--text-muted);">${FinanceFormat.renderMoneyHtml(op, acc.currency)}</td>
        <td class="cell-money" style="text-align:right; font-weight:700; font-size:1rem;">
          ${FinanceFormat.renderMoneyHtml(bal, acc.currency)}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load balances report:", err);
    showToast(err.message || "Failed to load point-in-time balances", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportBalancesExcel() {
  const asOfDate = document.getElementById("reportBalancesAsOfDate")?.value || "";
  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/balances", { as_of_date: asOfDate });
  triggerExcelDownload(url, `account_balances_as_of_${asOfDate || 'today'}.xlsx`);
}

// ----------------------------------------------------------------------
// Transactions Ledger Report
// ----------------------------------------------------------------------
function debounceReportTxSearch() {
  clearTimeout(_reportTxSearchDebounceTimer);
  _reportTxSearchDebounceTimer = setTimeout(() => {
    loadReportTransactions();
  }, 350);
}

async function loadReportTransactions() {
  const loading = document.getElementById("reportTxLoadingBar");
  if (loading) loading.style.display = "block";

  const dateFrom = document.getElementById("reportTxDateFrom")?.value || "";
  const dateTo = document.getElementById("reportTxDateTo")?.value || "";
  const accId = document.getElementById("reportTxAccount")?.value || "";
  const catId = document.getElementById("reportTxCategory")?.value || "";
  const dir = document.getElementById("reportTxDirection")?.value || "";
  const search = document.getElementById("reportTxSearch")?.value || "";

  const params = { limit: 200, offset: 0 };
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  if (accId) params.account_id = parseInt(accId, 10);
  if (catId) params.category_id = parseInt(catId, 10);
  if (dir) params.direction = dir;
  if (search) params.search = search;
  params.include_internal = document.getElementById("reportShellIncludeInternal") ? document.getElementById("reportShellIncludeInternal").checked : true;

  try {
    const report = await FinanceApi.getTransactionsReport(params);
    const tbody = document.getElementById("reportTxTableBody");
    const empty = document.getElementById("reportTxEmpty");

    if (!tbody) return;
    tbody.innerHTML = "";

    const txs = report.transactions || [];
    if (txs.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    txs.forEach((tx) => {
      const tr = document.createElement("tr");
      const amt = Number(tx.amount || 0);
      const isOut = tx.direction === "out";
      const payeeName = tx.payee_name || tx.counterparty || tx.payee_or_source || "—";
      const isInternal = tx.payee_type === "employee";
      const payeeBadge = isInternal
        ? ` <span class="badge badge-info" style="font-size:10px; margin-left:4px;" title="Internal Employee Payment"><i class="fa-solid fa-user"></i> Internal</span>`
        : "";

      tr.innerHTML = `
        <td>${FinanceFormat.formatFinanceDate(tx.transaction_date || tx.date)}</td>
        <td><strong>${tx.account_name}</strong></td>
        <td><span class="badge badge-neutral">${tx.category_name}</span></td>
        <td>${payeeName}${payeeBadge}</td>
        <td style="font-size:0.85rem; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${tx.description || "—"}</td>
        <td style="text-align:center;">
          <span class="badge ${isOut ? 'badge-danger' : 'badge-success'}">
            <i class="fa-solid ${isOut ? 'fa-arrow-up' : 'fa-arrow-down'}"></i> ${tx.direction.toUpperCase()}
          </span>
        </td>
        <td class="cell-money" style="text-align:right; font-weight:600; color:${isOut ? '#EF4444' : '#10B981'};">
          ${isOut ? '-' : '+'}${FinanceFormat.formatMoney(amt, tx.currency)}
        </td>
        <td>${FinanceFormat.formatStatusBadge("transaction", tx.status || "posted")}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load transactions report:", err);
    showToast(err.message || "Failed to load transaction ledger", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportTransactionsExcel() {
  const dateFrom = document.getElementById("reportTxDateFrom")?.value || "";
  const dateTo = document.getElementById("reportTxDateTo")?.value || "";
  const accId = document.getElementById("reportTxAccount")?.value || "";
  const catId = document.getElementById("reportTxCategory")?.value || "";
  const dir = document.getElementById("reportTxDirection")?.value || "";
  const search = document.getElementById("reportTxSearch")?.value || "";

  const params = {};
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  if (accId) params.account_id = parseInt(accId, 10);
  if (catId) params.category_id = parseInt(catId, 10);
  if (dir) params.direction = dir;
  if (search) params.search = search;
  params.include_internal = document.getElementById("reportShellIncludeInternal") ? document.getElementById("reportShellIncludeInternal").checked : true;

  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/transactions", params);
  triggerExcelDownload(url, `transaction_ledger_${dateFrom || 'start'}_to_${dateTo || 'end'}.xlsx`);
}

// ----------------------------------------------------------------------
// Cheque Register Report
// ----------------------------------------------------------------------
async function loadReportCheques() {
  const loading = document.getElementById("reportChequesLoadingBar");
  if (loading) loading.style.display = "block";

  const yr = document.getElementById("reportChequesFiscalYear")?.value || "2026";
  const st = document.getElementById("reportChequesStatus")?.value || "";

  const params = { fiscal_year: yr };
  if (st) params.status = st;

  try {
    const report = await FinanceApi.getChequesReport(params);

    // Update KPI Breakdown Cards
    const tCount = document.getElementById("reportChequesTotalCount");
    const tAmt = document.getElementById("reportChequesTotalAmount");
    const iCount = document.getElementById("reportChequesIssuedCount");
    const iAmt = document.getElementById("reportChequesIssuedAmount");
    const cCount = document.getElementById("reportChequesClearedCount");
    const cAmt = document.getElementById("reportChequesClearedAmount");
    const bvCount = document.getElementById("reportChequesBouncedVoidedCount");
    const bvAmt = document.getElementById("reportChequesBouncedVoidedAmount");

    const sum = report.summary || {};
    if (tCount) tCount.textContent = sum.total_count || 0;
    if (tAmt) tAmt.textContent = FinanceFormat.formatMoney(sum.total_amount || 0, "USD");

    const bySt = sum.by_status || {};
    const iss = bySt.issued || { count: 0, amount: 0 };
    const clr = bySt.cleared || { count: 0, amount: 0 };
    const bnc = bySt.bounced || { count: 0, amount: 0 };
    const voi = bySt.voided || { count: 0, amount: 0 };

    if (iCount) iCount.textContent = iss.count;
    if (iAmt) iAmt.textContent = FinanceFormat.formatMoney(iss.amount, "USD");

    if (cCount) cCount.textContent = clr.count;
    if (cAmt) cAmt.textContent = FinanceFormat.formatMoney(clr.amount, "USD");

    const bvTotCount = (bnc.count || 0) + (voi.count || 0);
    const bvTotAmt = (bnc.amount || 0) + (voi.amount || 0);
    if (bvCount) bvCount.textContent = bvTotCount;
    if (bvAmt) bvAmt.textContent = FinanceFormat.formatMoney(bvTotAmt, "USD");

    const tbody = document.getElementById("reportChequesTableBody");
    const empty = document.getElementById("reportChequesEmpty");

    if (!tbody) return;
    tbody.innerHTML = "";

    const chks = report.cheques || [];
    if (chks.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    chks.forEach((chk) => {
      const tr = document.createElement("tr");
      const amt = Number(chk.amount || 0);

      tr.innerHTML = `
        <td><strong><i class="fa-solid fa-money-check"></i> ${chk.cheque_number}</strong></td>
        <td>${FinanceFormat.formatFinanceDate(chk.issue_date)}</td>
        <td>${FinanceFormat.formatFinanceDate(chk.clear_date)}</td>
        <td>${chk.account_name}</td>
        <td><strong>${chk.payee}</strong></td>
        <td><span style="font-size:0.85rem; color:var(--text-muted);">${(chk.purpose_type || 'other').replace('_', ' ')}</span></td>
        <td class="cell-money" style="text-align:right; font-weight:700;">${FinanceFormat.renderMoneyHtml(amt, chk.currency || "USD")}</td>
        <td>${FinanceFormat.formatStatusBadge("cheque", chk.status)}</td>
        <td style="font-size:0.85rem; color:var(--text-muted);">${chk.notes || "—"}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load cheques report:", err);
    showToast(err.message || "Failed to load cheques report", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportChequesExcel() {
  const yr = document.getElementById("reportChequesFiscalYear")?.value || "2026";
  const st = document.getElementById("reportChequesStatus")?.value || "";
  const params = { fiscal_year: yr };
  if (st) params.status = st;

  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/cheques", params);
  triggerExcelDownload(url, `cheque_register_FY${yr}.xlsx`);
}

function triggerExcelDownload(url, filename) {
  if (typeof _isMock === "function" && _isMock()) {
    showToast(`Excel workbook "${filename}" ready for download!`, "success");
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function _esc(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ----------------------------------------------------------------------
// Core Accounting & Aging Report Loaders (Story 7.2)
// ----------------------------------------------------------------------

async function loadReportProfitAndLoss() {
  const dateFrom = document.getElementById("reportShellDateFrom")?.value || "";
  const dateTo = document.getElementById("reportShellDateTo")?.value || "";
  const basis = document.getElementById("reportShellBasis")?.value || "cash";
  const currency = document.getElementById("reportShellCurrency")?.value || "USD";
  const comparison = document.getElementById("reportShellComparison")?.value || "none";
  const entity = document.getElementById("reportShellEntity")?.value || "all";

  try {
    const data = await FinanceApi.getProfitAndLossReport({
      date_from: dateFrom,
      date_to: dateTo,
      basis,
      currency: currency || undefined,
      comparison,
      entity,
    });

    const curr = data.currency || currency || "USD";
    const revEl = document.getElementById("reportPnlTotalRevenue");
    const expEl = document.getElementById("reportPnlTotalExpenses");
    const netEl = document.getElementById("reportPnlNetIncome");
    const marEl = document.getElementById("reportPnlNetMargin");
    const revSubEl = document.getElementById("reportPnlRevenueSubtotalBadge");
    const expSubEl = document.getElementById("reportPnlExpenseSubtotalBadge");

    if (revEl) revEl.textContent = FinanceFormat.formatMoney(data.total_revenue || 0, curr);
    if (expEl) expEl.textContent = FinanceFormat.formatMoney(data.total_expenses || 0, curr);
    if (netEl) {
      netEl.textContent = FinanceFormat.formatMoney(data.net_income || 0, curr);
      netEl.style.color = (data.net_income || 0) >= 0 ? "#10B981" : "#EF4444";
    }
    if (marEl) marEl.textContent = `${(data.net_margin_pct || 0).toFixed(1)}%`;
    if (revSubEl) revSubEl.textContent = FinanceFormat.formatMoney(data.total_revenue || 0, curr);
    if (expSubEl) expSubEl.textContent = FinanceFormat.formatMoney(data.total_expenses || 0, curr);

    // Revenue table
    const revTbody = document.getElementById("reportPnlRevenueTableBody");
    if (revTbody) {
      if (!data.revenue_items || data.revenue_items.length === 0) {
        revTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:16px;">No revenue recorded for this period.</td></tr>`;
      } else {
        revTbody.innerHTML = data.revenue_items.map((it) => `
          <tr>
            <td style="font-weight:600;"><i class="fa-solid fa-layer-group" style="color:#10B981; margin-right:6px;"></i> ${_esc(it.category_name)}</td>
            <td class="cell-money" style="text-align:right; font-weight:700; color:#10B981;">${FinanceFormat.formatMoney(it.amount, curr)}</td>
            <td>
              <div style="display:flex; align-items:center; gap:8px;">
                <div style="flex:1; height:6px; border-radius:3px; background:#E2E8F0; overflow:hidden;">
                  <div style="width:${Math.min(100, Math.max(0, it.percentage))}%; height:100%; background:#10B981;"></div>
                </div>
                <span style="font-size:0.8rem; color:var(--text-muted); width:45px; text-align:right;">${it.percentage.toFixed(1)}%</span>
              </div>
            </td>
            <td style="text-align:center;">
              <button class="btn btn-sm btn-outline" onclick="openReportDrilldown('category', '${_esc(it.category_name)}', '${_esc(it.category_name)}')">
                <i class="fa-solid fa-search"></i>
              </button>
            </td>
          </tr>
        `).join("");
      }
    }

    // Expense table
    const expTbody = document.getElementById("reportPnlExpenseTableBody");
    if (expTbody) {
      if (!data.expense_items || data.expense_items.length === 0) {
        expTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted); padding:16px;">No expenses recorded for this period.</td></tr>`;
      } else {
        expTbody.innerHTML = data.expense_items.map((it) => `
          <tr>
            <td style="font-weight:600;"><i class="fa-solid fa-tag" style="color:#EF4444; margin-right:6px;"></i> ${_esc(it.category_name)}</td>
            <td class="cell-money" style="text-align:right; font-weight:700; color:#EF4444;">${FinanceFormat.formatMoney(it.amount, curr)}</td>
            <td>
              <div style="display:flex; align-items:center; gap:8px;">
                <div style="flex:1; height:6px; border-radius:3px; background:#E2E8F0; overflow:hidden;">
                  <div style="width:${Math.min(100, Math.max(0, it.percentage))}%; height:100%; background:#EF4444;"></div>
                </div>
                <span style="font-size:0.8rem; color:var(--text-muted); width:45px; text-align:right;">${it.percentage.toFixed(1)}%</span>
              </div>
            </td>
            <td style="text-align:center;">
              <button class="btn btn-sm btn-outline" onclick="openReportDrilldown('category', '${_esc(it.category_name)}', '${_esc(it.category_name)}')">
                <i class="fa-solid fa-search"></i>
              </button>
            </td>
          </tr>
        `).join("");
      }
    }
  } catch (err) {
    console.error("Failed to load Profit & Loss report:", err);
    showToast(err.message || "Failed to load Profit & Loss report", "error");
  }
}

async function loadReportBalanceSheet() {
  const asOfDate = document.getElementById("reportShellDateTo")?.value || "";
  const currency = document.getElementById("reportShellCurrency")?.value || "USD";
  const basis = document.getElementById("reportShellBasis")?.value || "accrual";
  const entity = document.getElementById("reportShellEntity")?.value || "all";

  try {
    const data = await FinanceApi.getBalanceSheetReport({
      as_of_date: asOfDate,
      currency: currency || undefined,
      basis,
      entity,
    });

    const curr = data.currency || currency || "USD";
    const aEl = document.getElementById("reportBsTotalAssets");
    const lEl = document.getElementById("reportBsTotalLiabilities");
    const eEl = document.getElementById("reportBsTotalEquity");
    const badge = document.getElementById("reportBsBalancedBadge");
    const aSub = document.getElementById("reportBsAssetsSubtotal");
    const lSub = document.getElementById("reportBsLiabilitiesSubtotal");
    const eSub = document.getElementById("reportBsEquitySubtotal");

    if (aEl) aEl.textContent = FinanceFormat.formatMoney(data.total_assets || 0, curr);
    if (lEl) lEl.textContent = FinanceFormat.formatMoney((data.liabilities && data.liabilities.total) || 0, curr);
    if (eEl) eEl.textContent = FinanceFormat.formatMoney((data.equity && data.equity.total) || 0, curr);

    if (badge) {
      if (data.is_balanced) {
        badge.innerHTML = `<span style="color:#10B981;"><i class="fa-solid fa-circle-check"></i> BALANCED ✓</span>`;
      } else {
        badge.innerHTML = `<span style="color:#EF4444;"><i class="fa-solid fa-triangle-exclamation"></i> VARIANCE: ${FinanceFormat.formatMoney(data.variance || 0, curr)}</span>`;
      }
    }

    if (aSub) aSub.textContent = FinanceFormat.formatMoney((data.assets && data.assets.total) || 0, curr);
    if (lSub) lSub.textContent = FinanceFormat.formatMoney((data.liabilities && data.liabilities.total) || 0, curr);
    if (eSub) eSub.textContent = FinanceFormat.formatMoney((data.equity && data.equity.total) || 0, curr);

    // Assets table
    const aTbody = document.getElementById("reportBsAssetsTableBody");
    if (aTbody) {
      const items = (data.assets && data.assets.items) || [];
      if (items.length === 0) {
        aTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:14px;">No asset records.</td></tr>`;
      } else {
        aTbody.innerHTML = items.map((x) => `
          <tr>
            <td style="font-weight:600;"><i class="fa-solid fa-building-columns" style="color:#2563EB; margin-right:6px;"></i> ${_esc(x.name)}</td>
            <td style="color:var(--text-muted); font-size:0.85rem;">${_esc(x.note || "")}</td>
            <td class="cell-money" style="text-align:right; font-weight:600;">${FinanceFormat.formatMoney(x.amount, curr)}</td>
          </tr>
        `).join("");
      }
    }

    // Liabilities table
    const lTbody = document.getElementById("reportBsLiabilitiesTableBody");
    if (lTbody) {
      const items = (data.liabilities && data.liabilities.items) || [];
      if (items.length === 0) {
        lTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:14px;">No liability records.</td></tr>`;
      } else {
        lTbody.innerHTML = items.map((x) => `
          <tr>
            <td style="font-weight:600;"><i class="fa-solid fa-receipt" style="color:#F59E0B; margin-right:6px;"></i> ${_esc(x.name)}</td>
            <td style="color:var(--text-muted); font-size:0.85rem;">${_esc(x.note || "")}</td>
            <td class="cell-money" style="text-align:right; font-weight:600;">${FinanceFormat.formatMoney(x.amount, curr)}</td>
          </tr>
        `).join("");
      }
    }

    // Equity table
    const eTbody = document.getElementById("reportBsEquityTableBody");
    if (eTbody) {
      const items = (data.equity && data.equity.items) || [];
      if (items.length === 0) {
        eTbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted); padding:14px;">No equity records.</td></tr>`;
      } else {
        eTbody.innerHTML = items.map((x) => `
          <tr>
            <td style="font-weight:600;"><i class="fa-solid fa-coins" style="color:#10B981; margin-right:6px;"></i> ${_esc(x.name)}</td>
            <td style="color:var(--text-muted); font-size:0.85rem;">${_esc(x.note || "")}</td>
            <td class="cell-money" style="text-align:right; font-weight:600;">${FinanceFormat.formatMoney(x.amount, curr)}</td>
          </tr>
        `).join("");
      }
    }
  } catch (err) {
    console.error("Failed to load Balance Sheet:", err);
    showToast(err.message || "Failed to load Balance Sheet", "error");
  }
}

async function loadReportTrialBalance() {
  const asOfDate = document.getElementById("reportShellDateTo")?.value || "";
  const currency = document.getElementById("reportShellCurrency")?.value || "USD";
  const entity = document.getElementById("reportShellEntity")?.value || "all";

  try {
    const data = await FinanceApi.getTrialBalanceReport({
      as_of_date: asOfDate,
      currency: currency || undefined,
      entity,
    });

    const curr = data.currency || currency || "USD";
    const dEl = document.getElementById("reportTbTotalDebits");
    const cEl = document.getElementById("reportTbTotalCredits");
    const vEl = document.getElementById("reportTbVariance");
    const bEl = document.getElementById("reportTbBalancedBadge");

    if (dEl) dEl.textContent = FinanceFormat.formatMoney(data.total_debits || 0, curr);
    if (cEl) cEl.textContent = FinanceFormat.formatMoney(data.total_credits || 0, curr);
    if (vEl) vEl.textContent = FinanceFormat.formatMoney(data.variance || 0, curr);
    if (bEl) {
      if (data.is_balanced) {
        bEl.innerHTML = `<span style="color:#10B981;"><i class="fa-solid fa-circle-check"></i> DEBITS = CREDITS ✓</span>`;
      } else {
        bEl.innerHTML = `<span style="color:#EF4444;"><i class="fa-solid fa-triangle-exclamation"></i> UNBALANCED</span>`;
      }
    }

    const tbody = document.getElementById("reportTbTableBody");
    const tfoot = document.getElementById("reportTbTableFoot");

    if (tbody) {
      const lines = data.lines || [];
      if (lines.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted); padding:16px;">No ledger lines found.</td></tr>`;
      } else {
        tbody.innerHTML = lines.map((l) => `
          <tr>
            <td style="font-family:monospace; font-size:0.85rem; font-weight:600;">${_esc(l.code)}</td>
            <td style="font-weight:600;">${_esc(l.name)}</td>
            <td><span class="badge badge-neutral" style="text-transform:capitalize; font-size:0.75rem;">${_esc(l.type)}</span></td>
            <td class="cell-money" style="text-align:right; color:#2563EB;">${l.debit > 0 ? FinanceFormat.formatMoney(l.debit, curr) : "-"}</td>
            <td class="cell-money" style="text-align:right; color:#8B5CF6;">${l.credit > 0 ? FinanceFormat.formatMoney(l.credit, curr) : "-"}</td>
          </tr>
        `).join("");
      }
    }

    if (tfoot) {
      tfoot.innerHTML = `
        <tr>
          <td colspan="3" style="text-align:right; font-weight:700;">TOTALS:</td>
          <td class="cell-money" style="text-align:right; color:#2563EB; font-weight:700;">${FinanceFormat.formatMoney(data.total_debits || 0, curr)}</td>
          <td class="cell-money" style="text-align:right; color:#8B5CF6; font-weight:700;">${FinanceFormat.formatMoney(data.total_credits || 0, curr)}</td>
        </tr>
      `;
    }
  } catch (err) {
    console.error("Failed to load Trial Balance:", err);
    showToast(err.message || "Failed to load Trial Balance", "error");
  }
}

async function loadReportCashFlow() {
  const dateFrom = document.getElementById("reportShellDateFrom")?.value || "";
  const dateTo = document.getElementById("reportShellDateTo")?.value || "";
  const currency = document.getElementById("reportShellCurrency")?.value || "USD";
  const entity = document.getElementById("reportShellEntity")?.value || "all";

  try {
    const data = await FinanceApi.getCashFlowReport({
      date_from: dateFrom,
      date_to: dateTo,
      currency: currency || undefined,
      entity,
    });

    const curr = data.currency || currency || "USD";
    const begEl = document.getElementById("reportCfBeginningCash");
    const opEl = document.getElementById("reportCfOperatingCash");
    const netEl = document.getElementById("reportCfNetChange");
    const endEl = document.getElementById("reportCfEndingCash");

    if (begEl) begEl.textContent = FinanceFormat.formatMoney(data.beginning_cash_balance || 0, curr);
    if (opEl) opEl.textContent = FinanceFormat.formatMoney(data.net_cash_operating || 0, curr);
    if (netEl) netEl.textContent = FinanceFormat.formatMoney(data.net_change_in_cash || 0, curr);
    if (endEl) endEl.textContent = FinanceFormat.formatMoney(data.ending_cash_balance || 0, curr);

    const tbody = document.getElementById("reportCfTableBody");
    if (tbody) {
      let rowsHtml = `
        <tr style="background:var(--bg-secondary, #F8FAFC); font-weight:700;">
          <td><i class="fa-solid fa-hourglass-start" style="color:var(--text-muted); margin-right:8px;"></i> Cash & Cash Equivalents at Beginning of Period</td>
          <td class="cell-money" style="text-align:right;">${FinanceFormat.formatMoney(data.beginning_cash_balance || 0, curr)}</td>
        </tr>
        <tr style="background:rgba(37,99,235,0.05); font-weight:700; border-top:2px solid var(--border-color, #E2E8F0);">
          <td colspan="2"><i class="fa-solid fa-circle-chevron-right" style="color:#2563EB; margin-right:6px;"></i> Cash Flows from Operating Activities</td>
        </tr>
      `;

      const opItems = data.operating_activities || [];
      if (opItems.length === 0) {
        rowsHtml += `<tr><td colspan="2" style="padding-left:32px; color:var(--text-muted); font-size:0.9rem;">No operational flows in period.</td></tr>`;
      } else {
        opItems.forEach((x) => {
          const color = x.amount >= 0 ? "#10B981" : "#EF4444";
          rowsHtml += `
            <tr>
              <td style="padding-left:32px;"><i class="fa-solid fa-caret-right" style="color:var(--text-muted); margin-right:6px;"></i> ${_esc(x.name)}</td>
              <td class="cell-money" style="text-align:right; font-weight:600; color:${color};">${FinanceFormat.formatMoney(x.amount, curr)}</td>
            </tr>
          `;
        });
      }

      rowsHtml += `
        <tr style="font-weight:700; background:var(--bg-secondary, #F8FAFC);">
          <td style="padding-left:32px;">Net Cash Generated by Operating Activities</td>
          <td class="cell-money" style="text-align:right; color:#10B981;">${FinanceFormat.formatMoney(data.net_cash_operating || 0, curr)}</td>
        </tr>
        <tr style="background:rgba(37,99,235,0.05); font-weight:700; border-top:2px solid var(--border-color, #E2E8F0);">
          <td colspan="2"><i class="fa-solid fa-circle-chevron-right" style="color:#2563EB; margin-right:6px;"></i> Cash Flows from Investing Activities</td>
        </tr>
      `;

      const invItems = data.investing_activities || [];
      if (invItems.length === 0) {
        rowsHtml += `<tr><td colspan="2" style="padding-left:32px; color:var(--text-muted); font-size:0.9rem;">No capital expenditures or investment activities in period.</td></tr>`;
      } else {
        invItems.forEach((x) => {
          rowsHtml += `
            <tr>
              <td style="padding-left:32px;">${_esc(x.name)}</td>
              <td class="cell-money" style="text-align:right;">${FinanceFormat.formatMoney(x.amount, curr)}</td>
            </tr>
          `;
        });
      }

      rowsHtml += `
        <tr style="background:rgba(37,99,235,0.05); font-weight:700; border-top:2px solid var(--border-color, #E2E8F0);">
          <td colspan="2"><i class="fa-solid fa-circle-chevron-right" style="color:#2563EB; margin-right:6px;"></i> Cash Flows from Financing Activities</td>
        </tr>
      `;

      const finItems = data.financing_activities || [];
      if (finItems.length === 0) {
        rowsHtml += `<tr><td colspan="2" style="padding-left:32px; color:var(--text-muted); font-size:0.9rem;">No debt or equity financing transactions in period.</td></tr>`;
      } else {
        finItems.forEach((x) => {
          rowsHtml += `
            <tr>
              <td style="padding-left:32px;">${_esc(x.name)}</td>
              <td class="cell-money" style="text-align:right;">${FinanceFormat.formatMoney(x.amount, curr)}</td>
            </tr>
          `;
        });
      }

      rowsHtml += `
        <tr style="font-weight:700; background:rgba(37,99,235,0.08); border-top:2px solid #2563EB;">
          <td>Net Increase / (Decrease) in Cash and Cash Equivalents</td>
          <td class="cell-money" style="text-align:right; font-size:1.05rem; color:#2563EB;">${FinanceFormat.formatMoney(data.net_change_in_cash || 0, curr)}</td>
        </tr>
        <tr style="font-weight:700; background:rgba(16,185,129,0.12); border-top:2px solid #10B981;">
          <td><i class="fa-solid fa-flag-checkered" style="color:#059669; margin-right:8px;"></i> Cash & Cash Equivalents at End of Period</td>
          <td class="cell-money" style="text-align:right; font-size:1.15rem; color:#059669;">${FinanceFormat.formatMoney(data.ending_cash_balance || 0, curr)}</td>
        </tr>
      `;

      tbody.innerHTML = rowsHtml;
    }
  } catch (err) {
    console.error("Failed to load Cash Flow report:", err);
    showToast(err.message || "Failed to load Cash Flow report", "error");
  }
}

async function loadReportArAging() {
  const asOfDate = document.getElementById("reportShellDateTo")?.value || "";
  const currency = document.getElementById("reportShellCurrency")?.value || "USD";
  const entity = document.getElementById("reportShellEntity")?.value || "all";

  try {
    const data = await FinanceApi.getArAgingReport({
      as_of_date: asOfDate,
      currency: currency || undefined,
      entity,
    });

    const curr = data.currency || currency || "USD";
    const t = data.totals || { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0, total: 0 };

    const elTot = document.getElementById("reportArTotalOutstanding");
    const elCur = document.getElementById("reportArCurrent");
    const el130 = document.getElementById("reportArDays130");
    const el3160 = document.getElementById("reportArDays3160");
    const el6190 = document.getElementById("reportArDays6190");
    const el90 = document.getElementById("reportArDaysOver90");

    if (elTot) elTot.textContent = FinanceFormat.formatMoney(t.total, curr);
    if (elCur) elCur.textContent = FinanceFormat.formatMoney(t.current, curr);
    if (el130) el130.textContent = FinanceFormat.formatMoney(t.days_1_30, curr);
    if (el3160) el3160.textContent = FinanceFormat.formatMoney(t.days_31_60, curr);
    if (el6190) el6190.textContent = FinanceFormat.formatMoney(t.days_61_90, curr);
    if (el90) el90.textContent = FinanceFormat.formatMoney(t.days_over_90, curr);

    const tbody = document.getElementById("reportArAgingTableBody");
    const tfoot = document.getElementById("reportArAgingTableFoot");

    if (tbody) {
      const rows = data.rows || [];
      if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:16px;">No outstanding customer receivables as of this date.</td></tr>`;
      } else {
        tbody.innerHTML = rows.map((r) => `
          <tr>
            <td style="font-weight:600;"><i class="fa-solid fa-hospital-user" style="color:#2563EB; margin-right:6px;"></i> ${_esc(r.name)}</td>
            <td style="text-align:center;"><span class="badge badge-neutral">${r.outstanding_count}</span></td>
            <td class="cell-money" style="text-align:right;">${FinanceFormat.formatMoney(r.buckets.current, curr)}</td>
            <td class="cell-money" style="text-align:right;">${FinanceFormat.formatMoney(r.buckets.days_1_30, curr)}</td>
            <td class="cell-money" style="text-align:right;">${FinanceFormat.formatMoney(r.buckets.days_31_60, curr)}</td>
            <td class="cell-money" style="text-align:right;">${FinanceFormat.formatMoney(r.buckets.days_61_90, curr)}</td>
            <td class="cell-money" style="text-align:right; color:#DC2626; font-weight:600;">${FinanceFormat.formatMoney(r.buckets.days_over_90, curr)}</td>
            <td class="cell-money" style="text-align:right; font-weight:700; color:#2563EB;">${FinanceFormat.formatMoney(r.buckets.total, curr)}</td>
            <td style="text-align:center;">
              <button class="btn btn-sm btn-outline" onclick="openReportDrilldown('entity', '${r.id}', '${_esc(r.name)}')">
                <i class="fa-solid fa-search"></i>
              </button>
            </td>
          </tr>
        `).join("");
      }
    }

    if (tfoot) {
      tfoot.innerHTML = `
        <tr>
          <td colspan="2" style="text-align:right; font-weight:700;">TOTAL RECEIVABLES:</td>
          <td class="cell-money" style="text-align:right; font-weight:700;">${FinanceFormat.formatMoney(t.current, curr)}</td>
          <td class="cell-money" style="text-align:right; font-weight:700;">${FinanceFormat.formatMoney(t.days_1_30, curr)}</td>
          <td class="cell-money" style="text-align:right; font-weight:700;">${FinanceFormat.formatMoney(t.days_31_60, curr)}</td>
          <td class="cell-money" style="text-align:right; font-weight:700;">${FinanceFormat.formatMoney(t.days_61_90, curr)}</td>
          <td class="cell-money" style="text-align:right; font-weight:700; color:#DC2626;">${FinanceFormat.formatMoney(t.days_over_90, curr)}</td>
          <td class="cell-money" style="text-align:right; font-weight:700; color:#2563EB;">${FinanceFormat.formatMoney(t.total, curr)}</td>
          <td></td>
        </tr>
      `;
    }
  } catch (err) {
    console.error("Failed to load AR Aging report:", err);
    showToast(err.message || "Failed to load AR Aging report", "error");
  }
}

async function loadReportApAging() {
  const asOfDate = document.getElementById("reportShellDateTo")?.value || "";
  const currency = document.getElementById("reportShellCurrency")?.value || "USD";
  const entity = document.getElementById("reportShellEntity")?.value || "all";

  try {
    const data = await FinanceApi.getApAgingReport({
      as_of_date: asOfDate,
      currency: currency || undefined,
      entity,
    });

    const curr = data.currency || currency || "USD";
    const t = data.totals || { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_over_90: 0, total: 0 };

    const elTot = document.getElementById("reportApTotalOutstanding");
    const elCur = document.getElementById("reportApCurrent");
    const el130 = document.getElementById("reportApDays130");
    const el3160 = document.getElementById("reportApDays3160");
    const el6190 = document.getElementById("reportApDays6190");
    const el90 = document.getElementById("reportApDaysOver90");

    if (elTot) elTot.textContent = FinanceFormat.formatMoney(t.total, curr);
    if (elCur) elCur.textContent = FinanceFormat.formatMoney(t.current, curr);
    if (el130) el130.textContent = FinanceFormat.formatMoney(t.days_1_30, curr);
    if (el3160) el3160.textContent = FinanceFormat.formatMoney(t.days_31_60, curr);
    if (el6190) el6190.textContent = FinanceFormat.formatMoney(t.days_61_90, curr);
    if (el90) el90.textContent = FinanceFormat.formatMoney(t.days_over_90, curr);

    const tbody = document.getElementById("reportApAgingTableBody");
    const tfoot = document.getElementById("reportApAgingTableFoot");

    if (tbody) {
      const rows = data.rows || [];
      if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; color:var(--text-muted); padding:16px;">No outstanding vendor payables as of this date.</td></tr>`;
      } else {
        tbody.innerHTML = rows.map((r) => `
          <tr>
            <td style="font-weight:600;"><i class="fa-solid fa-building" style="color:#EF4444; margin-right:6px;"></i> ${_esc(r.name)}</td>
            <td style="text-align:center;"><span class="badge badge-neutral">${r.outstanding_count}</span></td>
            <td class="cell-money" style="text-align:right;">${FinanceFormat.formatMoney(r.buckets.current, curr)}</td>
            <td class="cell-money" style="text-align:right;">${FinanceFormat.formatMoney(r.buckets.days_1_30, curr)}</td>
            <td class="cell-money" style="text-align:right;">${FinanceFormat.formatMoney(r.buckets.days_31_60, curr)}</td>
            <td class="cell-money" style="text-align:right;">${FinanceFormat.formatMoney(r.buckets.days_61_90, curr)}</td>
            <td class="cell-money" style="text-align:right; color:#DC2626; font-weight:600;">${FinanceFormat.formatMoney(r.buckets.days_over_90, curr)}</td>
            <td class="cell-money" style="text-align:right; font-weight:700; color:#EF4444;">${FinanceFormat.formatMoney(r.buckets.total, curr)}</td>
            <td style="text-align:center;">
              <button class="btn btn-sm btn-outline" onclick="openReportDrilldown('entity', '${r.id}', '${_esc(r.name)}')">
                <i class="fa-solid fa-search"></i>
              </button>
            </td>
          </tr>
        `).join("");
      }
    }

    if (tfoot) {
      tfoot.innerHTML = `
        <tr>
          <td colspan="2" style="text-align:right; font-weight:700;">TOTAL PAYABLES:</td>
          <td class="cell-money" style="text-align:right; font-weight:700;">${FinanceFormat.formatMoney(t.current, curr)}</td>
          <td class="cell-money" style="text-align:right; font-weight:700;">${FinanceFormat.formatMoney(t.days_1_30, curr)}</td>
          <td class="cell-money" style="text-align:right; font-weight:700;">${FinanceFormat.formatMoney(t.days_31_60, curr)}</td>
          <td class="cell-money" style="text-align:right; font-weight:700;">${FinanceFormat.formatMoney(t.days_61_90, curr)}</td>
          <td class="cell-money" style="text-align:right; font-weight:700; color:#DC2626;">${FinanceFormat.formatMoney(t.days_over_90, curr)}</td>
          <td class="cell-money" style="text-align:right; font-weight:700; color:#EF4444;">${FinanceFormat.formatMoney(t.total, curr)}</td>
          <td></td>
        </tr>
      `;
    }
  } catch (err) {
    console.error("Failed to load AP Aging report:", err);
    showToast(err.message || "Failed to load AP Aging report", "error");
  }
}

// Window exports
window.switchFinanceReportsTab = switchFinanceReportsTab;
window.loadFinanceReports = loadFinanceReports;
window.loadReportLibrary = loadReportLibrary;
window.filterReportLibraryByDomain = filterReportLibraryByDomain;
window.filterReportLibraryCatalog = filterReportLibraryCatalog;
window.openReportFromLibrary = openReportFromLibrary;
window.backToReportLibrary = backToReportLibrary;
window.onReportShellPeriodPresetChanged = onReportShellPeriodPresetChanged;
window.onReportShellFilterChanged = onReportShellFilterChanged;
window.refreshActiveReport = refreshActiveReport;
window.loadSavedReportViews = loadSavedReportViews;
window.applySelectedSavedView = applySelectedSavedView;
window.openSaveReportViewModal = openSaveReportViewModal;
window.closeSaveReportViewModal = closeSaveReportViewModal;
window.submitSaveReportView = submitSaveReportView;
window.deleteActiveReportView = deleteActiveReportView;
window.openReportDrilldown = openReportDrilldown;
window.closeReportDrilldownModal = closeReportDrilldownModal;
window.exportDrilldownData = exportDrilldownData;
window.toggleReportExportMenu = toggleReportExportMenu;
window.exportActiveReport = exportActiveReport;
window.loadReportCategorySummary = loadReportCategorySummary;
window.exportCategorySummaryExcel = exportCategorySummaryExcel;
window.setMatrixPeriodGroup = setMatrixPeriodGroup;
window.loadReportMatrix = loadReportMatrix;
window.exportMatrixExcel = exportMatrixExcel;
window.loadReportBalances = loadReportBalances;
window.exportBalancesExcel = exportBalancesExcel;
window.loadReportProfitAndLoss = loadReportProfitAndLoss;
window.loadReportBalanceSheet = loadReportBalanceSheet;
window.loadReportTrialBalance = loadReportTrialBalance;
window.loadReportCashFlow = loadReportCashFlow;
window.loadReportArAging = loadReportArAging;
window.loadReportApAging = loadReportApAging;
window.loadReportTransactions = loadReportTransactions;
window.debounceReportTxSearch = debounceReportTxSearch;
window.exportTransactionsExcel = exportTransactionsExcel;
window.loadReportCheques = loadReportCheques;
window.exportChequesExcel = exportChequesExcel;
window.triggerExcelDownload = triggerExcelDownload;
window.getActiveReportFilters = getActiveReportFilters;
window.openScheduleReportModal = openScheduleReportModal;
window.closeScheduleReportModal = closeScheduleReportModal;
window.submitScheduleReport = submitScheduleReport;
window.openScheduledDeliveriesModal = openScheduledDeliveriesModal;
window.closeScheduledDeliveriesModal = closeScheduledDeliveriesModal;
window.switchDeliveriesModalTab = switchDeliveriesModalTab;
window.loadReportSchedules = loadReportSchedules;
window.deleteReportSchedule = deleteReportSchedule;
window.loadReportExportAudits = loadReportExportAudits;

// =========================================================================
// FUX-419: Compensation Spend & Variance Reporting
// =========================================================================
let _compensationViewMode = "company"; // company | employee
let _selectedCompensationEmployeeId = null;
let _cachedCompanyEmployees = [];

async function loadCompensationSummaryReport() {
  const dFrom = document.getElementById("reportShellDateFrom")?.value || "";
  const dTo = document.getElementById("reportShellDateTo")?.value || "";
  const currency = document.getElementById("reportShellCurrency")?.value || "USD";

  if (_compensationViewMode === "employee" && _selectedCompensationEmployeeId) {
    await loadEmployeeCompensationReport(_selectedCompensationEmployeeId, dFrom, dTo, currency);
  } else {
    await loadCompanyCompensationReport(dFrom, dTo, currency);
  }
}

async function loadCompanyCompensationReport(dFrom, dTo, currency) {
  try {
    const data = await FinanceApi.getCompanyCompensationReport({
      start_date: dFrom || undefined,
      end_date: dTo || undefined,
      currency: currency || undefined,
      breakdown_employees: true,
    });

    const formatCurrency = (amt) => "$" + Number(amt || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const totSpendEl = document.getElementById("reportCompTotalSpend");
    const extEl = document.getElementById("reportCompExternal");
    const intEl = document.getElementById("reportCompInternal");
    const commBonusEl = document.getElementById("reportCompCommBonus");
    const headcountEl = document.getElementById("reportCompHeadcount");

    if (totSpendEl) totSpendEl.textContent = formatCurrency(data.grand_total);
    if (extEl) extEl.textContent = formatCurrency(data.total_external);
    if (intEl) intEl.textContent = formatCurrency(data.total_internal);
    if (commBonusEl) commBonusEl.textContent = formatCurrency((data.total_commission || 0) + (data.total_bonus || 0));
    if (headcountEl) headcountEl.textContent = String(data.total_headcount || 0);

    // Populate employee selector dropdown
    _cachedCompanyEmployees = data.employees || [];
    const empSelect = document.getElementById("reportCompEmployeeSelect");
    if (empSelect) {
      empSelect.innerHTML = '<option value="">Choose Employee for Drilldown...</option>' +
        _cachedCompanyEmployees.map(e => `<option value="${e.employee_id}">${e.employee_name} (${e.department || 'General'})</option>`).join("");
    }

    // Render Company Spend Table
    const tbody = document.getElementById("reportCompanySpendTableBody");
    const tfoot = document.getElementById("reportCompanySpendTableFoot");
    const emptyState = document.getElementById("reportCompanySpendEmpty");

    if (!tbody) return;

    if (!_cachedCompanyEmployees.length) {
      tbody.innerHTML = "";
      if (tfoot) tfoot.innerHTML = "";
      if (emptyState) emptyState.style.display = "block";
      return;
    }
    if (emptyState) emptyState.style.display = "none";

    tbody.innerHTML = _cachedCompanyEmployees.map(e => `
      <tr>
        <td><strong>${e.employee_name}</strong></td>
        <td><span class="badge badge-neutral">${e.department || 'General'}</span></td>
        <td style="text-align:right;">${formatCurrency(e.total_external)}</td>
        <td style="text-align:right;">${formatCurrency(e.total_internal)}</td>
        <td style="text-align:right;">${formatCurrency(e.total_commission)}</td>
        <td style="text-align:right;">${formatCurrency(e.total_bonus)}</td>
        <td style="text-align:right; font-weight:700;">${formatCurrency(e.grand_total)}</td>
        <td style="text-align:center;">
          <button class="btn btn-sm btn-outline" onclick="onCompensationEmployeeChanged(${e.employee_id})" title="Drill into employee lines">
            <i class="fa-solid fa-magnifying-glass"></i> Drilldown
          </button>
        </td>
      </tr>
    `).join("");

    if (tfoot) {
      tfoot.innerHTML = `
        <tr>
          <td>Company Totals (${data.total_headcount || 0} staff)</td>
          <td></td>
          <td style="text-align:right;">${formatCurrency(data.total_external)}</td>
          <td style="text-align:right;">${formatCurrency(data.total_internal)}</td>
          <td style="text-align:right;">${formatCurrency(data.total_commission)}</td>
          <td style="text-align:right;">${formatCurrency(data.total_bonus)}</td>
          <td style="text-align:right; font-weight:700; color:var(--primary, #2563EB);">${formatCurrency(data.grand_total)}</td>
          <td></td>
        </tr>
      `;
    }
  } catch (err) {
    console.error("Failed to load company compensation report:", err);
  }
}

async function loadEmployeeCompensationReport(empId, dFrom, dTo, currency) {
  try {
    const data = await FinanceApi.getEmployeeCompensationReport(empId, {
      start_date: dFrom || undefined,
      end_date: dTo || undefined,
      currency: currency || undefined,
    });

    const formatCurrency = (amt) => "$" + Number(amt || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const titleEl = document.getElementById("reportEmployeeSpendTitle");
    if (titleEl) {
      titleEl.innerHTML = `<i class="fa-solid fa-user"></i> ${data.employee_name} <span class="badge badge-info" style="font-size:0.75rem; font-weight:normal; margin-left:8px;">${data.department || 'General'}</span> — Total Spend: <strong>${formatCurrency(data.grand_total)}</strong>`;
    }

    const tbody = document.getElementById("reportEmployeeSpendTableBody");
    const tfoot = document.getElementById("reportEmployeeSpendTableFoot");
    if (!tbody) return;

    const lines = data.lines || [];
    tbody.innerHTML = lines.map(l => {
      const typeLabel = (l.compensation_type || "internal_usd_cash")
        .replace(/_/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
      const isPaid = l.payment_status === "paid";
      const statusBadge = isPaid
        ? '<span class="badge badge-success">Settled</span>'
        : '<span class="badge badge-warning">Pending</span>';

      return `
        <tr>
          <td><strong>${l.period_label || 'Current'}</strong></td>
          <td>${typeLabel}</td>
          <td style="text-align:right;">${formatCurrency(l.base_salary)}</td>
          <td style="text-align:right; color:#EF4444;">${formatCurrency((l.tax_amount || 0) + (l.deductions_total || 0))}</td>
          <td style="text-align:right; font-weight:700;">${formatCurrency(l.net_pay)}</td>
          <td style="text-align:center;">${statusBadge}</td>
          <td style="font-size:0.82rem; color:var(--text-muted);">${l.paid_at ? new Date(l.paid_at).toLocaleDateString() : '—'}</td>
        </tr>
      `;
    }).join("");

    if (tfoot) {
      tfoot.innerHTML = `
        <tr>
          <td>Total (${lines.length} lines across ${data.payroll_runs_count || 0} cycles)</td>
          <td></td>
          <td style="text-align:right;">${formatCurrency(data.grand_total)}</td>
          <td style="text-align:right;"></td>
          <td style="text-align:right; font-weight:700; color:var(--primary, #2563EB);">${formatCurrency(data.grand_total)}</td>
          <td colspan="2"></td>
        </tr>
      `;
    }
  } catch (err) {
    console.error("Failed to load employee compensation report:", err);
  }
}

function onCompensationViewModeChanged(mode) {
  _compensationViewMode = mode;
  const vSelect = document.getElementById("reportCompViewMode");
  if (vSelect) vSelect.value = mode;

  const grp = document.getElementById("reportCompEmployeeSelectGroup");
  const compCard = document.getElementById("reportCompanySpendCard");
  const empCard = document.getElementById("reportEmployeeSpendCard");

  if (mode === "employee") {
    if (grp) grp.style.display = "inline-flex";
    if (compCard) compCard.style.display = "none";
    if (empCard) empCard.style.display = "block";
    if (!_selectedCompensationEmployeeId && _cachedCompanyEmployees.length) {
      _selectedCompensationEmployeeId = _cachedCompanyEmployees[0].employee_id;
      const empSelect = document.getElementById("reportCompEmployeeSelect");
      if (empSelect) empSelect.value = _selectedCompensationEmployeeId;
    }
  } else {
    if (grp) grp.style.display = "none";
    if (compCard) compCard.style.display = "block";
    if (empCard) empCard.style.display = "none";
  }

  loadCompensationSummaryReport();
}

function onCompensationEmployeeChanged(empId) {
  if (!empId) return;
  _selectedCompensationEmployeeId = parseInt(empId, 10);
  onCompensationViewModeChanged("employee");
}

async function loadStatutoryRemittedReport() {
  const dFrom = document.getElementById("reportShellDateFrom")?.value || "";
  const dTo = document.getElementById("reportShellDateTo")?.value || "";
  const currency = document.getElementById("reportShellCurrency")?.value || "USD";

  try {
    const data = await FinanceApi.getStatutoryRemittedReport({
      start_date: dFrom || undefined,
      end_date: dTo || undefined,
      currency: currency || undefined,
    });

    const formatCurrency = (amt) => "$" + Number(amt || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const totEl = document.getElementById("reportStatTotalRemitted");
    const taxEl = document.getElementById("reportStatTaxRemitted");
    const insEl = document.getElementById("reportStatInsRemitted");
    const countEl = document.getElementById("reportStatRemittedCount");

    if (totEl) totEl.textContent = formatCurrency(data.total_remitted);
    const byType = data.by_obligation_type || {};
    const taxSum = (byType["income_tax"] || 0) + (byType["withholding_tax"] || 0) + (byType["sales_tax"] || 0);
    const insSum = (byType["social_insurance_employee"] || 0) + (byType["social_insurance_employer"] || 0) + (byType["health_insurance"] || 0);

    if (taxEl) taxEl.textContent = formatCurrency(taxSum);
    if (insEl) insEl.textContent = formatCurrency(insSum);
    if (countEl) countEl.textContent = String(data.obligations_count || 0);

    const tbody = document.getElementById("reportStatutoryRemittedTableBody");
    const tfoot = document.getElementById("reportStatutoryRemittedTableFoot");
    const emptyState = document.getElementById("reportStatutoryRemittedEmpty");

    if (!tbody) return;
    const items = data.items || [];
    if (!items.length) {
      tbody.innerHTML = "";
      if (tfoot) tfoot.innerHTML = "";
      if (emptyState) emptyState.style.display = "block";
      return;
    }
    if (emptyState) emptyState.style.display = "none";

    tbody.innerHTML = items.map(it => {
      const typeLabel = (it.obligation_type || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, c => c.toUpperCase());
      return `
        <tr>
          <td><strong>${it.period}</strong></td>
          <td><span class="badge badge-neutral">${typeLabel}</span></td>
          <td>${it.notes || '—'}</td>
          <td style="text-align:right; font-weight:700; color:#10B981;">${formatCurrency(it.amount_remitted)}</td>
          <td style="text-align:right; color:var(--text-muted);">${formatCurrency(it.amount_accrued)}</td>
          <td style="text-align:center;"><span class="badge badge-success">Settled</span></td>
          <td style="font-size:0.85rem;">${it.due_date || '—'}</td>
        </tr>
      `;
    }).join("");

    if (tfoot) {
      tfoot.innerHTML = `
        <tr>
          <td colspan="3">Total Remitted to Authorities</td>
          <td style="text-align:right; font-weight:700; color:#10B981;">${formatCurrency(data.total_remitted)}</td>
          <td colspan="3"></td>
        </tr>
      `;
    }
  } catch (err) {
    console.error("Failed to load statutory remitted report:", err);
  }
}

let _selectedPayableEmployeeId = "";

async function loadPayableStatusReport() {
  const dFrom = document.getElementById("reportShellDateFrom")?.value || "";
  const dTo = document.getElementById("reportShellDateTo")?.value || "";
  const currency = document.getElementById("reportShellCurrency")?.value || "USD";

  try {
    const data = await FinanceApi.getPayableStatusReport({
      start_date: dFrom || undefined,
      end_date: dTo || undefined,
      employee_id: _selectedPayableEmployeeId || undefined,
      currency: currency || undefined,
    });

    const formatCurrency = (amt) => "$" + Number(amt || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const flows = data.flows || [];
    const flowMap = {};
    flows.forEach(f => { flowMap[f.flow_type] = f; });

    const updateCard = (prefix, f) => {
      const bEl = document.getElementById(`badgeFlow${prefix}`);
      const sEl = document.getElementById(`amtFlow${prefix}Settled`);
      const pEl = document.getElementById(`amtFlow${prefix}Pending`);
      const tEl = document.getElementById(`amtFlow${prefix}Total`);
      if (!f) return;

      if (bEl) {
        bEl.textContent = f.status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
        bEl.className = f.status === "settled" ? "badge badge-success" : (f.status === "pending" ? "badge badge-danger" : "badge badge-warning");
      }
      if (sEl) sEl.textContent = formatCurrency(f.settled_amount);
      if (pEl) pEl.textContent = formatCurrency(f.pending_amount);
      if (tEl) tEl.textContent = formatCurrency(f.total_amount);
    };

    updateCard("External", flowMap["external_transfer"]);
    updateCard("Internal", flowMap["internal_cash"]);
    updateCard("Tax", flowMap["tax_obligation"]);
    updateCard("Insurance", flowMap["insurance_obligation"]);

    // Render Summary Table
    const tbody = document.getElementById("reportPayableStatusTableBody");
    const tfoot = document.getElementById("reportPayableStatusTableFoot");
    if (tbody) {
      tbody.innerHTML = flows.map(f => {
        const badgeClass = f.status === "settled" ? "badge badge-success" : (f.status === "pending" ? "badge badge-danger" : "badge badge-warning");
        return `
          <tr>
            <td><strong>${f.label}</strong></td>
            <td style="text-align:right; color:#10B981; font-weight:600;">${formatCurrency(f.settled_amount)}</td>
            <td style="text-align:right; color:#EF4444; font-weight:600;">${formatCurrency(f.pending_amount)}</td>
            <td style="text-align:right; font-weight:700;">${formatCurrency(f.total_amount)}</td>
            <td style="text-align:center;"><span class="${badgeClass}">${f.status.replace(/_/g, " ").toUpperCase()}</span></td>
          </tr>
        `;
      }).join("");

      if (tfoot) {
        tfoot.innerHTML = `
          <tr>
            <td>Total Net Outflow Status</td>
            <td style="text-align:right; color:#10B981; font-weight:700;">${formatCurrency(data.total_settled)}</td>
            <td style="text-align:right; color:#EF4444; font-weight:700;">${formatCurrency(data.total_pending)}</td>
            <td style="text-align:right; font-weight:700; color:var(--primary, #2563EB);">${formatCurrency(data.grand_total)}</td>
            <td style="text-align:center;">${data.total_pending === 0 ? '<span class="badge badge-success">FULLY SETTLED</span>' : '<span class="badge badge-warning">ACTION REQUIRED</span>'}</td>
          </tr>
        `;
      }
    }

    // Render Employee Breakdown Table (if available)
    const breakdownCard = document.getElementById("reportPayableEmployeeBreakdownCard");
    const breakdownBody = document.getElementById("reportPayableEmployeeBreakdownTableBody");
    const breakdownFoot = document.getElementById("reportPayableEmployeeBreakdownTableFoot");

    if (data.employee_breakdown && data.employee_breakdown.length && breakdownCard && breakdownBody) {
      breakdownCard.style.display = "block";

      // Populate employee scope dropdown if not already populated
      const scopeSel = document.getElementById("reportPayableEmployeeSelect");
      if (scopeSel && scopeSel.options.length <= 1) {
        data.employee_breakdown.forEach(e => {
          const opt = document.createElement("option");
          opt.value = e.employee_id;
          opt.textContent = `${e.employee_name} (${e.department || 'General'})`;
          scopeSel.appendChild(opt);
        });
      }

      breakdownBody.innerHTML = data.employee_breakdown.map(e => `
        <tr>
          <td><strong>${e.employee_name}</strong></td>
          <td><span class="badge badge-neutral">${e.department || 'General'}</span></td>
          <td style="text-align:right; color:#10B981;">${formatCurrency(e.external_settled)}</td>
          <td style="text-align:right; color:#EF4444;">${formatCurrency(e.external_pending)}</td>
          <td style="text-align:right; color:#10B981;">${formatCurrency(e.internal_settled)}</td>
          <td style="text-align:right; color:#EF4444;">${formatCurrency(e.internal_pending)}</td>
          <td style="text-align:right; font-size:0.85rem;">
            <span style="color:#10B981;">${formatCurrency(e.tax_settled)}</span> / <span style="color:#EF4444;">${formatCurrency(e.tax_pending)}</span>
          </td>
          <td style="text-align:right; font-size:0.85rem;">
            <span style="color:#10B981;">${formatCurrency(e.insurance_settled)}</span> / <span style="color:#EF4444;">${formatCurrency(e.insurance_pending)}</span>
          </td>
          <td style="text-align:right; font-weight:700;">${formatCurrency((e.total_settled || 0) + (e.total_pending || 0))}</td>
        </tr>
      `).join("");

      if (breakdownFoot) {
        breakdownFoot.innerHTML = `
          <tr>
            <td colspan="8">Grand Total (Settled: ${formatCurrency(data.total_settled)} | Pending: ${formatCurrency(data.total_pending)})</td>
            <td style="text-align:right; font-weight:700; color:var(--primary, #2563EB);">${formatCurrency(data.grand_total)}</td>
          </tr>
        `;
      }
    } else if (breakdownCard) {
      breakdownCard.style.display = "none";
    }
  } catch (err) {
    console.error("Failed to load payable status report:", err);
  }
}

function onPayableStatusScopeChanged(val) {
  _selectedPayableEmployeeId = val ? parseInt(val, 10) : "";
  loadPayableStatusReport();
}

window.loadCompensationSummaryReport = loadCompensationSummaryReport;
window.onCompensationViewModeChanged = onCompensationViewModeChanged;
window.onCompensationEmployeeChanged = onCompensationEmployeeChanged;
window.loadStatutoryRemittedReport = loadStatutoryRemittedReport;
window.loadPayableStatusReport = loadPayableStatusReport;
window.onPayableStatusScopeChanged = onPayableStatusScopeChanged;

