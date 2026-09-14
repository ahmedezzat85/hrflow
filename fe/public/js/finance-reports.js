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
  const validTabs = ["category-summary", "matrix", "balances", "transactions", "cheques"];
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
          transactions: "reportPaneTransactions",
          cheques: "reportPaneCheques",
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
    transactions: "reportPaneTransactions",
    cheques: "reportPaneCheques",
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
  } else if (tabName === "transactions") {
    loadReportTransactions();
  } else if (tabName === "cheques") {
    loadReportCheques();
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
  } else if (_currentReportsTab === "transactions") {
    loadReportTransactions();
  } else if (_currentReportsTab === "cheques") {
    loadReportCheques();
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

function exportActiveReport(format) {
  const menu = document.getElementById("reportShellExportMenu");
  if (menu) menu.style.display = "none";

  if (format === "excel") {
    if (_currentReportsTab === "category-summary") exportCategorySummaryExcel();
    else if (_currentReportsTab === "matrix") exportMatrixExcel();
    else if (_currentReportsTab === "balances") exportBalancesExcel();
    else if (_currentReportsTab === "transactions") exportTransactionsExcel();
    else if (_currentReportsTab === "cheques") exportChequesExcel();
    else showToast("Excel export prepared for " + _activeReportKey, "info");
  } else if (format === "csv") {
    showToast("Generating CSV export for active report...", "info");
    if (_currentReportsTab === "transactions") exportTransactionsExcel();
    else exportCategorySummaryExcel();
  } else if (format === "pdf") {
    window.print();
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

  try {
    const report = await FinanceApi.getCategorySummaryReport({
      date_from: dateFrom,
      date_to: dateTo,
      currency: currency || undefined,
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

  try {
    const report = await FinanceApi.getMatrixReport({
      year: parseInt(year, 10),
      period_group: _currentMatrixPeriodGroup,
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
        <td><code style="font-size:0.85rem;">${acc.account_number}</code></td>
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

      tr.innerHTML = `
        <td>${FinanceFormat.formatFinanceDate(tx.transaction_date)}</td>
        <td><strong>${tx.account_name}</strong></td>
        <td><span class="badge badge-neutral">${tx.category_name}</span></td>
        <td>${tx.payee_or_source || "—"}</td>
        <td style="font-size:0.85rem; max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${tx.description || "—"}</td>
        <td style="text-align:center;">
          <span class="badge ${isOut ? 'badge-danger' : 'badge-success'}">
            <i class="fa-solid ${isOut ? 'fa-arrow-up' : 'fa-arrow-down'}"></i> ${tx.direction.toUpperCase()}
          </span>
        </td>
        <td class="cell-money" style="text-align:right; font-weight:600; color:${isOut ? '#EF4444' : '#10B981'};">
          ${isOut ? '-' : '+'}${FinanceFormat.formatMoney(amt, tx.currency)}
        </td>
        <td>${FinanceFormat.formatStatusBadge("transaction", tx.status)}</td>
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
window.loadReportTransactions = loadReportTransactions;
window.debounceReportTxSearch = debounceReportTxSearch;
window.exportTransactionsExcel = exportTransactionsExcel;
window.loadReportCheques = loadReportCheques;
window.exportChequesExcel = exportChequesExcel;
window.triggerExcelDownload = triggerExcelDownload;
