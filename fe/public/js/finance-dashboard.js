// ==========================================
// 1. Dashboard Overview & Trustworthy KPIs (Story 2.1)
// ==========================================
const FinanceDashboardState = {
  status: "idle", // 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'stale'
  lastUpdated: null,
  errorMessage: null,
};

const CONTEXT_STORAGE_KEY = "hrflow_finance_dashboard_context";

function getFinanceContext() {
  try {
    const raw = localStorage.getItem(CONTEXT_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Failed to parse stored finance context", e);
  }
  return {
    entity: "all",
    period: "MTD",
    basis: "cash",
    currency: "USD",
  };
}

function setFinanceContext(ctx) {
  try {
    localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(ctx));
  } catch (e) {
    console.warn("Failed to persist finance context", e);
  }
}

function syncContextControls(ctx) {
  const ent = document.getElementById("financeContextEntity");
  const per = document.getElementById("financeContextPeriod");
  const bas = document.getElementById("financeContextBasis");
  const cur = document.getElementById("financeContextCurrency");

  if (ent && ctx.entity) ent.value = ctx.entity;
  if (per && ctx.period) per.value = ctx.period;
  if (bas && ctx.basis) bas.value = ctx.basis;
  if (cur && ctx.currency) cur.value = ctx.currency;
}

function onFinanceContextChanged() {
  const ent = document.getElementById("financeContextEntity")?.value || "all";
  const per = document.getElementById("financeContextPeriod")?.value || "MTD";
  const bas = document.getElementById("financeContextBasis")?.value || "cash";
  const cur = document.getElementById("financeContextCurrency")?.value || "USD";

  const ctx = { entity: ent, period: per, basis: bas, currency: cur };
  setFinanceContext(ctx);
  loadFinanceDashboard({ isRefresh: true });
}

function resetFinanceContext() {
  const defaults = { entity: "all", period: "MTD", basis: "cash", currency: "USD" };
  setFinanceContext(defaults);
  syncContextControls(defaults);
  loadFinanceDashboard({ isRefresh: true });
}

function _showDashboardSkeletons() {
  ["statFinanceBalance", "statFinanceRevenue", "statFinanceCost", "statFinanceNet"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '<span class="finance-skeleton">—</span>';
  });
}

function _showDashboardErrorPlaceholders() {
  ["statFinanceBalance", "statFinanceRevenue", "statFinanceCost", "statFinanceNet"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = "—";
  });
}

async function loadFinanceDashboard(options = {}) {
  const isRefresh = !!options.isRefresh;
  const errorEl = document.getElementById("financeDashboardErrorState");
  const staleEl = document.getElementById("financeDashboardStaleBadge");
  const lastUpdatedEl = document.getElementById("financeDashboardLastUpdated");
  const refreshBtn = document.getElementById("btnRefreshFinanceDashboard");

  const ctx = getFinanceContext();
  syncContextControls(ctx);

  const hasExistingData = !!FinanceState.summary;

  if (!hasExistingData) {
    _showDashboardSkeletons();
  }

  FinanceDashboardState.status = "loading";
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Refreshing...';
  }

  try {
    const summary = await FinanceApi.getFinanceSummary(ctx);
    FinanceState.summary = summary;
    FinanceDashboardState.status = "success";
    FinanceDashboardState.lastUpdated = summary.generated_at ? new Date(summary.generated_at) : new Date();
    FinanceDashboardState.errorMessage = null;

    if (errorEl) errorEl.style.display = "none";
    if (staleEl) staleEl.style.display = "none";

    if (lastUpdatedEl) {
      const timeStr = FinanceDashboardState.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      lastUpdatedEl.textContent = `Last updated: ${timeStr}`;
    }

    renderFinanceDashboard(summary, ctx);
    await loadFinanceAttentionQueue();
    if (isRefresh) {
      showToast("Finance dashboard refreshed", "success");
    }
  } catch (err) {
    window._lastDashboardError = err ? (err.message + " | " + err.stack) : "unknown error";
    console.error("Failed to load finance summary:", err);
    FinanceDashboardState.errorMessage = err.message || "Unable to load finance overview";

    if (errorEl) {
      const msgEl = document.getElementById("financeDashboardErrorMessage");
      if (msgEl) msgEl.textContent = FinanceDashboardState.errorMessage;
      errorEl.style.display = "block";
    }

    if (hasExistingData) {
      FinanceDashboardState.status = "stale";
      if (staleEl) {
        staleEl.style.display = "inline-flex";
        if (FinanceDashboardState.lastUpdated) {
          const timeStr = FinanceDashboardState.lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
          staleEl.title = `Previous data from ${timeStr} could not be updated`;
        }
      }
    } else {
      FinanceDashboardState.status = "error";
      _showDashboardErrorPlaceholders();
    }

    if (isRefresh) {
      showToast(FinanceDashboardState.errorMessage, "error");
    }
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i> Refresh';
    }
  }
}

function renderFinanceDashboard(summary, ctx = {}) {
  if (!summary) return;
  const balanceEl = document.getElementById("statFinanceBalance");
  const revEl = document.getElementById("statFinanceRevenue");
  const costEl = document.getElementById("statFinanceCost");
  const netEl = document.getElementById("statFinanceNet");

  const currency = summary.currency || summary.base_currency || "USD";
  const fmt = (n) => FinanceFormat.formatMoney(n, currency);

  if (balanceEl) balanceEl.textContent = fmt(summary.balance);
  if (revEl) revEl.textContent = fmt(summary.revenue_mtd);
  if (costEl) costEl.textContent = fmt(summary.cost_mtd);
  if (netEl) netEl.textContent = fmt(summary.net_mtd);

  // Labels & Subtexts
  const labelRev = document.getElementById("labelKpiRevenue");
  if (labelRev) labelRev.textContent = `Revenue (${summary.period || "MTD"})`;

  const labelCost = document.getElementById("labelKpiCost");
  if (labelCost) labelCost.textContent = `Operating Expenses (${summary.period || "MTD"})`;

  const labelNet = document.getElementById("labelKpiNet");
  if (labelNet) labelNet.textContent = `Net Operating Result (${summary.period || "MTD"})`;

  const revSub = document.getElementById("statFinanceRevenueSubtext");
  if (revSub) {
    revSub.innerHTML = summary.basis === "accrual"
      ? '<i class="fa-solid fa-file-invoice"></i> Recognized Invoices'
      : '<i class="fa-solid fa-chart-line"></i> Cash Inflows';
  }

  const costSub = document.getElementById("statFinanceCostSubtext");
  if (costSub) {
    costSub.innerHTML = summary.basis === "accrual"
      ? '<i class="fa-solid fa-receipt"></i> Recognized Bills'
      : '<i class="fa-solid fa-arrow-trend-down"></i> Cash Outflows';
  }

  // Margin Badge
  const marginBadge = document.getElementById("statFinanceMarginBadge");
  if (marginBadge) {
    if (summary.margin_valid && summary.margin_pct !== null && summary.margin_pct !== undefined) {
      marginBadge.style.display = "inline-flex";
      const isPos = summary.margin_pct >= 0;
      marginBadge.className = isPos ? "badge badge-success" : "badge badge-danger";
      marginBadge.innerHTML = `<i class="fa-solid fa-percent"></i> Margin: ${summary.margin_pct}%`;
      marginBadge.title = `Operating Margin: ${summary.margin_pct}% (Net Result / Revenue)`;
    } else {
      marginBadge.style.display = "inline-flex";
      marginBadge.className = "badge badge-grey";
      marginBadge.innerHTML = `<i class="fa-solid fa-circle-minus"></i> Margin: N/A`;
      marginBadge.title = "Margin undefined when revenue is zero or negative";
    }
  }

  // Top header badges
  const currBadge = document.getElementById("financeDashboardCurrencyBadge");
  if (currBadge) currBadge.innerHTML = `<i class="fa-solid fa-coins"></i> Currency: ${currency}`;

  const periodBadge = document.getElementById("financeDashboardPeriodBadge");
  if (periodBadge && summary.period) periodBadge.innerHTML = `<i class="fa-solid fa-calendar"></i> Period: ${summary.period}`;

  const basisBadge = document.getElementById("financeDashboardBasisBadge");
  if (basisBadge && summary.basis) {
    basisBadge.innerHTML = `<i class="fa-solid fa-scale-balanced"></i> Basis: ${summary.basis === "accrual" ? "Accrual" : "Cash"}`;
  }

  const scopeBadge = document.getElementById("financeDashboardScopeBadge");
  if (scopeBadge) {
    const ent = summary.entity && summary.entity !== "all" ? summary.entity : "All Accounts";
    scopeBadge.innerHTML = `<i class="fa-solid fa-building-columns"></i> Scope: ${ent}`;
  }

  // Multi-currency conversion policy notice
  const policyEl = document.getElementById("financeContextPolicyNotice");
  const policyText = document.getElementById("financeContextPolicyText");
  if (policyEl && policyText) {
    if ((summary.currency === "ALL" || ctx.currency === "all") && summary.conversion_policy) {
      policyText.textContent = summary.conversion_policy;
      policyEl.style.display = "block";
    } else {
      policyEl.style.display = "none";
    }
  }

  // Update drilldown links text/direction
  const drillRev = document.getElementById("drilldownKpiRevenue");
  if (drillRev) {
    drillRev.innerHTML = summary.basis === "accrual" ? 'View Invoices <i class="fa-solid fa-arrow-right"></i>' : 'View Transactions <i class="fa-solid fa-arrow-right"></i>';
  }
  const drillCost = document.getElementById("drilldownKpiCost");
  if (drillCost) {
    drillCost.innerHTML = summary.basis === "accrual" ? 'View Bills <i class="fa-solid fa-arrow-right"></i>' : 'View Transactions <i class="fa-solid fa-arrow-right"></i>';
  }
}

function drilldownFinanceKPI(kpiKey) {
  const summary = FinanceState.summary;
  const kpi = summary?.kpis?.[kpiKey];
  let target = kpi?.drilldown_section || "";
  if (!target.startsWith("a-")) {
    target = "a-" + target;
  }
  if (kpiKey === "total_cash" || target === "a-finance-accounts") {
    target = "a-finance-accounts";
    if (typeof loadFinanceAccounts === "function") loadFinanceAccounts();
  } else if (kpiKey === "revenue") {
    target = summary?.basis === "accrual" ? "a-finance-invoices" : "a-finance-accounts";
    if (summary?.basis === "accrual") {
      if (typeof loadFinanceInvoices === "function") loadFinanceInvoices();
    } else {
      if (typeof loadFinanceAccounts === "function") loadFinanceAccounts();
      if (typeof switchFinanceAccountsSubTab === "function") switchFinanceAccountsSubTab("ledger");
    }
  } else if (kpiKey === "operating_spend") {
    target = summary?.basis === "accrual" ? "a-finance-bills" : "a-finance-accounts";
    if (summary?.basis === "accrual") {
      if (typeof loadFinanceBills === "function") loadFinanceBills();
    } else {
      if (typeof loadFinanceAccounts === "function") loadFinanceAccounts();
      if (typeof switchFinanceAccountsSubTab === "function") switchFinanceAccountsSubTab("ledger");
    }
  } else if (kpiKey === "net_result" || target === "a-finance-reports") {
    target = "a-finance-reports";
    if (typeof loadFinanceReports === "function") loadFinanceReports();
  }

  if (typeof window.showSection === "function") {
    window.showSection(target, "admin");
  }
}

function showKpiDefinition(kpiKey) {
  const summary = FinanceState.summary;
  const kpi = summary?.kpis?.[kpiKey];
  if (kpi) {
    showToast(`<strong>${kpi.label}</strong><br>${kpi.definition}<br><small style="opacity:0.85;">Formula: ${kpi.formula}</small>`, "info", 5000);
  }
}

function refreshFinanceDashboard() {
  return loadFinanceDashboard({ isRefresh: true });
}

let _attentionSearchTimer = null;

async function loadFinanceAttentionQueue() {
  const listEl = document.getElementById("financeAttentionQueueList");
  const emptyEl = document.getElementById("financeAttentionQueueEmpty");
  const skelEl = document.getElementById("financeAttentionQueueSkeleton");
  const btnRefresh = document.getElementById("btnRefreshAttentionQueue");

  const sevSelect = document.getElementById("filterAttentionSeverity");
  const typeSelect = document.getElementById("filterAttentionType");
  const searchInput = document.getElementById("inputAttentionSearch");

  const severity = sevSelect ? sevSelect.value : "all";
  const item_type = typeSelect ? typeSelect.value : "all";
  const search = searchInput ? searchInput.value.trim() : "";

  if (skelEl) skelEl.style.display = "block";
  if (listEl) listEl.style.display = "none";
  if (emptyEl) emptyEl.style.display = "none";
  if (btnRefresh) btnRefresh.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

  try {
    const data = await FinanceApi.getAttentionQueue({ severity, item_type, search });
    FinanceDashboardState.attentionQueue = data;
    renderFinanceAttentionQueue(data);
  } catch (err) {
    console.error("Failed to load attention queue:", err);
    if (listEl) {
      listEl.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--danger, #ef4444);">
          <i class="fa-solid fa-triangle-exclamation"></i> Unable to load attention items.
          <button class="btn btn-sm btn-outline" onclick="loadFinanceAttentionQueue()" style="margin-left: 8px;">Retry</button>
        </div>
      `;
      listEl.style.display = "block";
    }
  } finally {
    if (skelEl) skelEl.style.display = "none";
    if (btnRefresh) btnRefresh.innerHTML = '<i class="fa-solid fa-arrows-rotate"></i>';
  }
}

function _escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderFinanceAttentionQueue(data) {
  const listEl = document.getElementById("financeAttentionQueueList");
  const emptyEl = document.getElementById("financeAttentionQueueEmpty");

  const totalBadge = document.getElementById("badgeAttentionTotalCount");
  const urgentBadge = document.getElementById("badgeAttentionUrgentCount");
  const urgentText = document.getElementById("textAttentionUrgentCount");
  const warningBadge = document.getElementById("badgeAttentionWarningCount");
  const warningText = document.getElementById("textAttentionWarningCount");

  const totalCount = data?.total_count || 0;
  const urgentCount = data?.urgent_count || 0;
  const warningCount = data?.warning_count || 0;

  if (totalBadge) totalBadge.textContent = `${totalCount} ${totalCount === 1 ? 'item' : 'items'}`;
  if (urgentBadge) {
    urgentBadge.style.display = urgentCount > 0 ? "inline-flex" : "none";
    if (urgentText) urgentText.textContent = `${urgentCount} Urgent`;
  }
  if (warningBadge) {
    warningBadge.style.display = warningCount > 0 ? "inline-flex" : "none";
    if (warningText) warningText.textContent = `${warningCount} Warning`;
  }

  const items = data?.items || [];
  if (items.length === 0) {
    if (listEl) listEl.style.display = "none";
    if (emptyEl) emptyEl.style.display = "block";
    return;
  }

  if (emptyEl) emptyEl.style.display = "none";
  if (listEl) {
    listEl.style.display = "flex";
    listEl.innerHTML = items.map((it) => {
      const sevClass = it.severity === "urgent" ? "badge-danger" : (it.severity === "warning" ? "badge-warning" : "badge-info");
      const sevIcon = it.severity === "urgent" ? "fa-circle-exclamation" : (it.severity === "warning" ? "fa-triangle-exclamation" : "fa-circle-info");
      const dueChipClass = it.due_state || "due_soon";
      let dueIcon = "fa-clock";
      if (it.due_state === "overdue") dueIcon = "fa-calendar-xmark";
      else if (it.due_state === "due_today") dueIcon = "fa-calendar-day";
      else if (it.due_state === "immediate") dueIcon = "fa-triangle-exclamation";
      else if (it.due_state === "pending_review") dueIcon = "fa-hourglass-half";
      else if (it.due_state === "needs_reconciliation") dueIcon = "fa-code-compare";

      const amountFormatted = it.amount !== null && it.amount !== undefined
        ? (typeof FinanceFormat !== "undefined" ? FinanceFormat.formatMoney(it.amount, it.currency || "USD") : `$${Number(it.amount).toFixed(2)}`)
        : null;
      const targetFilterStr = it.target_filter ? encodeURIComponent(JSON.stringify(it.target_filter)) : "";

      return `
        <div class="finance-attention-row ${it.is_reviewed ? 'reviewed' : ''}" data-key="${_escapeHtml(it.deduplication_key)}" data-id="${_escapeHtml(it.id)}" data-type="${_escapeHtml(it.type)}" data-severity="${_escapeHtml(it.severity)}">
          <div class="finance-attention-main">
            <div class="finance-attention-badge-col">
              <span class="badge ${sevClass}" aria-label="Severity: ${_escapeHtml(it.severity_label)}">
                <i class="fa-solid ${sevIcon}"></i> ${_escapeHtml(it.severity_label)}
              </span>
            </div>
            <div class="finance-attention-info">
              <div class="finance-attention-title">
                <strong>${_escapeHtml(it.title)}</strong>
                ${it.counterparty ? `<span class="badge" style="font-size:11px;background:var(--surface2);color:var(--text2);">${_escapeHtml(it.counterparty)}</span>` : ""}
              </div>
              <div class="finance-attention-desc">${_escapeHtml(it.description)}</div>
              <div class="finance-attention-meta">
                <span class="due-chip ${dueChipClass}" aria-label="Due status: ${_escapeHtml(it.due_state_label)}">
                  <i class="fa-solid ${dueIcon}"></i> ${_escapeHtml(it.due_state_label)}
                </span>
                ${amountFormatted ? `
                  <span class="amount-chip">
                    <i class="fa-solid fa-coins"></i> ${amountFormatted}
                  </span>
                ` : ""}
                ${it.due_date ? `<span style="color:var(--text3);"><i class="fa-regular fa-calendar"></i> ${_escapeHtml(it.due_date)}</span>` : ""}
              </div>
            </div>
          </div>
          <div class="finance-attention-actions">
            <button type="button" class="btn btn-sm btn-primary btn-attention-resolve" onclick="openAttentionItem('${_escapeHtml(it.target_route)}', ${it.target_id || 'null'}, '${targetFilterStr}')">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> Resolve
            </button>
            <button type="button" class="btn btn-sm btn-outline btn-attention-review" onclick="markAttentionItemReviewed('${_escapeHtml(it.deduplication_key)}')" title="Mark as reviewed">
              <i class="fa-solid fa-check"></i> Reviewed
            </button>
          </div>
        </div>
      `;
    }).join("");
  }
}

function onAttentionFilterChanged() {
  loadFinanceAttentionQueue();
}

function onAttentionSearchInput(event) {
  clearTimeout(_attentionSearchTimer);
  _attentionSearchTimer = setTimeout(() => {
    loadFinanceAttentionQueue();
  }, 250);
}

async function markAttentionItemReviewed(itemKey) {
  try {
    const res = await FinanceApi.reviewAttentionItem(itemKey, { status: "reviewed" });
    showToast("Item marked as reviewed", "success");
    loadFinanceAttentionQueue();
  } catch (err) {
    console.error("Failed to mark reviewed:", err);
    showToast("Failed to mark item reviewed: " + (err.message || "Unknown error"), "error");
  }
}

function openAttentionItem(targetRoute, targetId, targetFilterEncoded) {
  let target = targetRoute;
  if (target && !target.startsWith("a-")) {
    target = `a-${target}`;
  }

  // Parse filter if provided
  let filter = {};
  if (targetFilterEncoded) {
    try {
      filter = JSON.parse(decodeURIComponent(targetFilterEncoded));
    } catch (e) {}
  }

  // Navigate to target section
  if (typeof window.showSection === "function") {
    window.showSection(target, "admin");
  }

  // Domain loader triggers
  if (target === "a-finance-invoices") {
    if (typeof loadFinanceInvoices === "function") loadFinanceInvoices();
  } else if (target === "a-finance-bills") {
    if (typeof loadFinanceBills === "function") loadFinanceBills();
  } else if (target === "a-finance-accounts") {
    if (typeof loadFinanceAccounts === "function") loadFinanceAccounts();
  } else if (target === "a-finance-transfers") {
    if (typeof loadFinanceTransfers === "function") loadFinanceTransfers();
  } else if (target === "a-finance-cheques") {
    if (typeof loadFinanceCheques === "function") loadFinanceCheques();
  } else if (target === "a-finance-statements") {
    if (typeof loadFinanceStatements === "function") loadFinanceStatements();
  } else if (target === "a-finance-payroll") {
    if (typeof loadFinancePayroll === "function") loadFinancePayroll();
  }
}

// Window exports for Finance Dashboard
window.FinanceDashboardState = FinanceDashboardState;
window.loadFinanceDashboard = loadFinanceDashboard;
window.refreshFinanceDashboard = refreshFinanceDashboard;
window.onFinanceContextChanged = onFinanceContextChanged;
window.resetFinanceContext = resetFinanceContext;
window.drilldownFinanceKPI = drilldownFinanceKPI;
window.showKpiDefinition = showKpiDefinition;
window.loadFinanceAttentionQueue = loadFinanceAttentionQueue;
window.renderFinanceAttentionQueue = renderFinanceAttentionQueue;
window.onAttentionFilterChanged = onAttentionFilterChanged;
window.onAttentionSearchInput = onAttentionSearchInput;
window.openAttentionItem = openAttentionItem;
window.markAttentionItemReviewed = markAttentionItemReviewed;
