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

// Window exports for Finance Dashboard
window.FinanceDashboardState = FinanceDashboardState;
window.loadFinanceDashboard = loadFinanceDashboard;
window.refreshFinanceDashboard = refreshFinanceDashboard;
window.onFinanceContextChanged = onFinanceContextChanged;
window.resetFinanceContext = resetFinanceContext;
window.drilldownFinanceKPI = drilldownFinanceKPI;
window.showKpiDefinition = showKpiDefinition;
