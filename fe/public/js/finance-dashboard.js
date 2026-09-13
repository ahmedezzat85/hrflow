// ==========================================
// 1. Dashboard Overview
// ==========================================
const FinanceDashboardState = {
  status: "idle", // 'idle' | 'loading' | 'success' | 'empty' | 'error' | 'stale'
  lastUpdated: null,
  errorMessage: null,
};

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
    const summary = await FinanceApi.getFinanceSummary();
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

    renderFinanceDashboard(summary);
    if (isRefresh) {
      showToast("Finance dashboard refreshed", "success");
    }
  } catch (err) {
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

function renderFinanceDashboard(summary) {
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

  const currBadge = document.getElementById("financeDashboardCurrencyBadge");
  if (currBadge) currBadge.innerHTML = `<i class="fa-solid fa-coins"></i> Currency: ${currency}`;

  const periodBadge = document.getElementById("financeDashboardPeriodBadge");
  if (periodBadge && summary.period) periodBadge.innerHTML = `<i class="fa-solid fa-calendar"></i> Period: ${summary.period}`;

  const scopeBadge = document.getElementById("financeDashboardScopeBadge");
  if (scopeBadge && summary.data_scope) {
    scopeBadge.innerHTML = `<i class="fa-solid fa-building-columns"></i> Scope: ${summary.data_scope === "all_accounts" ? "All Accounts" : summary.data_scope}`;
  }
}

function refreshFinanceDashboard() {
  return loadFinanceDashboard({ isRefresh: true });
}


// Window exports for Finance Dashboard
window.FinanceDashboardState = FinanceDashboardState;
window.loadFinanceDashboard = loadFinanceDashboard;
window.refreshFinanceDashboard = refreshFinanceDashboard;
