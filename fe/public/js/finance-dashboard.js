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
    refreshBtn.textContent = "Refreshing...";
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
    await loadFinanceCashForecast();
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
      refreshBtn.textContent = "Refresh";
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

  if (currency === "ALL") {
    // D-026: currencies are never added together; show one figure per currency side by side
    const perCurrency = (key) => (summary.by_currency || []).map((c) => FinanceUI.moneyHtml(c[key], c.currency)).join(" &middot; ") || "—";
    if (balanceEl) balanceEl.innerHTML = perCurrency("balance");
    if (revEl) revEl.innerHTML = perCurrency("revenue");
    if (costEl) costEl.innerHTML = perCurrency("cost");
    if (netEl) netEl.innerHTML = perCurrency("net");
  } else {
    if (balanceEl) balanceEl.innerHTML = FinanceUI.moneyHtml(summary.balance, currency);
    if (revEl) revEl.innerHTML = FinanceUI.moneyHtml(summary.revenue_mtd, currency);
    if (costEl) costEl.innerHTML = FinanceUI.moneyHtml(summary.cost_mtd, currency);
    if (netEl) netEl.innerHTML = FinanceUI.moneyHtml(summary.net_mtd, currency);
  }

  // Labels & Subtexts
  // Sentence-case labels. The cash card names the accounts its figure covers, so a USD total is never
  // labelled as all accounts.
  const periodWords = { MTD: "month to date", QTD: "quarter to date", YTD: "year to date" }[summary.period || "MTD"] || String(summary.period).toLowerCase();
  const labelBal = document.getElementById("labelKpiBalance");
  if (labelBal) {
    labelBal.textContent = currency === "ALL" ? "Cash balance, all currencies" : `Cash balance, ${currency} accounts`;
  }
  const labelRev = document.getElementById("labelKpiRevenue");
  if (labelRev) labelRev.textContent = `Revenue, ${periodWords}`;

  const labelCost = document.getElementById("labelKpiCost");
  if (labelCost) labelCost.textContent = `Operating expenses, ${periodWords}`;

  const labelNet = document.getElementById("labelKpiNet");
  if (labelNet) labelNet.textContent = `Net operating result, ${periodWords}`;

  const revSub = document.getElementById("statFinanceRevenueSubtext");
  if (revSub) {
    revSub.textContent = summary.basis === "accrual" ? "Recognized Invoices" : "Cash Inflows";
  }

  const costSub = document.getElementById("statFinanceCostSubtext");
  if (costSub) {
    costSub.textContent = summary.basis === "accrual" ? "Recognized Bills" : "Cash Outflows";
  }

  // Margin sits in the net card's note line
  const marginBadge = document.getElementById("statFinanceMarginBadge");
  if (marginBadge) {
    if (summary.margin_valid && summary.margin_pct !== null && summary.margin_pct !== undefined) {
      marginBadge.textContent = `Margin: ${summary.margin_pct}%`;
      marginBadge.title = `Operating Margin: ${summary.margin_pct}% (Net Result / Revenue)`;
    } else {
      marginBadge.textContent = "Margin: N/A";
      marginBadge.title = "Margin undefined when revenue is zero or negative";
    }
  }

  // Greeting line: the period in words, in brand blue
  const word = document.getElementById("financeDashboardPeriodWord");
  const greet = document.getElementById("financeDashboardGreeting");
  if (word) {
    const now = new Date();
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const p = summary.period || "MTD";
    word.textContent = p === "MTD" ? `${months[now.getMonth()]} ${now.getFullYear()}`
      : p === "QTD" ? `Q${Math.floor(now.getMonth() / 3) + 1} ${now.getFullYear()}`
      : p === "YTD" ? String(now.getFullYear()) : "all time";
    if (greet) {
      const h = now.getHours();
      const hello = h < 12 ? "Good morning" : (h < 18 ? "Good afternoon" : "Good evening");
      greet.innerHTML = `${hello}. Here is <b class="fv-brand-text" id="financeDashboardPeriodWord">${FinanceUI.esc(word.textContent)}</b>${p === "all" ? "" : " so far"}`;
    }
  }

  // Top header badges
  const currBadge = document.getElementById("financeDashboardCurrencyBadge");
  if (currBadge) currBadge.textContent = `Currency: ${currency}`;

  const periodBadge = document.getElementById("financeDashboardPeriodBadge");
  if (periodBadge && summary.period) periodBadge.textContent = `Period: ${summary.period}`;

  const basisBadge = document.getElementById("financeDashboardBasisBadge");
  if (basisBadge && summary.basis) {
    basisBadge.textContent = `Basis: ${summary.basis === "accrual" ? "Accrual" : "Cash"}${summary.basis_note ? ` (${summary.basis_note})` : ""}`;
  }

  const scopeBadge = document.getElementById("financeDashboardScopeBadge");
  if (scopeBadge) {
    const ent = summary.entity && summary.entity !== "all" ? summary.entity : "All entities";
    scopeBadge.textContent = `Scope: ${ent}`;
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
    drillRev.innerHTML = summary.basis === "accrual" ? "Invoices &rsaquo;" : "Transactions &rsaquo;";
  }
  const drillCost = document.getElementById("drilldownKpiCost");
  if (drillCost) {
    drillCost.innerHTML = summary.basis === "accrual" ? "Bills &rsaquo;" : "Transactions &rsaquo;";
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
  if (btnRefresh) btnRefresh.classList.add("is-busy");

  try {
    const data = await FinanceApi.getAttentionQueue({ severity, item_type, search });
    FinanceDashboardState.attentionQueue = data;
    renderFinanceAttentionQueue(data);
  } catch (err) {
    console.error("Failed to load attention queue:", err);
    if (listEl) {
      listEl.innerHTML = `
        <div class="fv-callout fv-callout--danger fv-callout--row">
          <span>Unable to load attention items.</span>
          <button class="btn btn-sm btn-outline" onclick="loadFinanceAttentionQueue()">Retry</button>
        </div>
      `;
      listEl.style.display = "block";
    }
  } finally {
    if (skelEl) skelEl.style.display = "none";
    if (btnRefresh) btnRefresh.classList.remove("is-busy");
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

// The severity pills drive the existing severity select (same ID, values and change handler).
function setAttentionSeverity(severity) {
  const sel = document.getElementById("filterAttentionSeverity");
  if (sel) sel.value = severity;
  onAttentionFilterChanged();
}

// Area of a queue item from its target route (doc 21 section 3.3): Sales teal, Spend orange, Banking sky, Reports violet.
function _attentionArea(it) {
  const route = String(it.target_route || "");
  if (/invoice|customer|sales/.test(route)) return "sales";
  if (/bill|vendor|subscription|statutory|spend/.test(route)) return "spend";
  if (/report/.test(route)) return "reports";
  if (/setting/.test(route)) return "settings";
  return "banking";
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

  if (totalBadge) totalBadge.innerHTML = `All <span class="fv-pill__count">${totalCount}</span>`;
  const sevSel = document.getElementById("filterAttentionSeverity");
  const activeSev = sevSel ? sevSel.value : "all";
  document.querySelectorAll("#attentionSeverityPills .fv-pill").forEach((pill) => {
    const on = pill.dataset.severity === activeSev;
    pill.classList.toggle("active", on);
    pill.setAttribute("aria-pressed", on ? "true" : "false");
  });
  if (urgentBadge) {
    urgentBadge.style.display = urgentCount > 0 || activeSev === "urgent" ? "inline-flex" : "none";
    if (urgentText) urgentText.innerHTML = `Urgent <span class="fv-pill__count">${urgentCount}</span>`;
  }
  if (warningBadge) {
    warningBadge.style.display = warningCount > 0 || activeSev === "warning" ? "inline-flex" : "none";
    if (warningText) warningText.innerHTML = `Warning <span class="fv-pill__count">${warningCount}</span>`;
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
      const group = it.severity === "urgent" ? "problem" : (it.severity === "warning" ? "waiting" : "open");
      const area = _attentionArea(it);
      const areaMeta = FinanceUI.AREAS[area] || FinanceUI.AREAS.banking;
      const amountFormatted = it.amount !== null && it.amount !== undefined
        ? FinanceUI.moneyHtml(it.amount, it.currency || "USD")
        : "";
      const targetFilterStr = it.target_filter ? encodeURIComponent(JSON.stringify(it.target_filter)) : "";
      const icon = { sales: "fa-arrow-down", spend: "fa-arrow-up", banking: "fa-building-columns", reports: "fa-chart-column", settings: "fa-sliders" }[area] || "fa-building-columns";

      return `
        <div class="finance-attention-row fv-attn ${it.is_reviewed ? 'reviewed' : ''}" data-key="${_escapeHtml(it.deduplication_key)}" data-id="${_escapeHtml(it.id)}" data-type="${_escapeHtml(it.type)}" data-severity="${_escapeHtml(it.severity)}">
          <span class="fv-tile fv-hue-${areaMeta.hue}" aria-hidden="true"><i class="fa-solid ${icon}"></i></span>
          <div class="fv-attn__main">
            <div class="fv-attn__title">
              <strong>${_escapeHtml(it.title)}</strong>
              ${FinanceUI.statusPill(group, it.severity_label, `aria-label="Severity: ${_escapeHtml(it.severity_label)}"`, "badge")}
            </div>
            <div class="fv-sub">${_escapeHtml(it.description)}
              <span class="due-chip fv-note ${it.due_state === "overdue" ? "fv-note--late" : "fv-note--info"}" aria-label="Due status: ${_escapeHtml(it.due_state_label)}">${_escapeHtml(it.due_state_label)}</span>
              &middot; <b class="fv-sub__area">${_escapeHtml(areaMeta.name)}</b></div>
          </div>
          <div class="fv-attn__amount fv-amount__value">${amountFormatted}</div>
          <div class="fv-attn__date">${it.due_date ? _escapeHtml(FinanceUI.formatDate(it.due_date)) : ""}</div>
          <div class="finance-attention-actions fv-row-actions">
            <button type="button" class="btn btn-sm btn-attention-resolve btn-outline" onclick="openAttentionItem('${_escapeHtml(it.target_route)}', ${it.target_id || 'null'}, '${targetFilterStr}')">Resolve</button>
            <button type="button" class="fv-icon-btn btn-attention-review" onclick="markAttentionItemReviewed('${_escapeHtml(it.deduplication_key)}')" title="Mark as reviewed" aria-label="Mark as reviewed"><i class="fa-solid fa-check"></i></button>
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

  // Check if target is a banking sub-pane
  let bankingTab = null;
  if (target === "a-finance-transfers") {
    bankingTab = "transfers";
  } else if (target === "a-finance-cheques") {
    bankingTab = "cheques";
  } else if (target === "a-finance-statements") {
    bankingTab = "statements";
  }

  // Navigate to target section
  if (typeof window.showSection === "function") {
    window.showSection(target, "admin");
  }

  if (bankingTab && typeof switchFinanceAccountsSubTab === "function") {
    switchFinanceAccountsSubTab(bankingTab);
  }

  // Domain loader triggers
  if (target === "a-finance-invoices") {
    if (typeof loadFinanceInvoices === "function") loadFinanceInvoices();
  } else if (target === "a-finance-bills") {
    if (typeof loadFinanceBills === "function") loadFinanceBills(filter);
  } else if (target === "a-finance-transfers" || bankingTab === "transfers") {
    if (typeof loadFinanceTransfers === "function") loadFinanceTransfers();
  } else if (target === "a-finance-cheques" || bankingTab === "cheques") {
    if (typeof loadFinanceCheques === "function") loadFinanceCheques();
  } else if (target === "a-finance-statements" || bankingTab === "statements") {
    if (typeof loadFinanceStatements === "function") loadFinanceStatements();
  } else if (target === "a-finance-accounts") {
    if (typeof loadFinanceAccounts === "function") loadFinanceAccounts();
  } else if (target === "a-finance-payroll") {
    if (typeof loadFinancePayroll === "function") loadFinancePayroll();
  }
}

// ==========================================
// 3. Cash Position and Forecast (Story 2.3)
// ==========================================
const CashForecastState = {
  horizon: 90,
  includeExpected: true,
  obligationsFilter: "all", // 'all' | 'inflow' | 'outflow'
  data: null,
  loading: false,
};

function _formatAmount(amt, curr) {
  if (amt === null || amt === undefined) return "—";
  if (typeof FinanceFormat !== "undefined" && typeof FinanceFormat.formatMoney === "function") {
    return FinanceFormat.formatMoney(amt, curr || "USD");
  }
  if (typeof window.formatMoney === "function") {
    return window.formatMoney(amt, curr || "USD");
  }
  return `${amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${curr || "USD"}`;
}

async function loadFinanceCashForecast() {
  const skelEl = document.getElementById("financeCashForecastSkeleton");
  const contentEl = document.getElementById("financeCashForecastContent");
  const asOfEl = document.getElementById("badgeForecastAsOf");
  const fxNoticeEl = document.getElementById("financeForecastFxWarning");
  const fxTextEl = document.getElementById("textForecastFxWarning");

  if (skelEl) skelEl.style.display = "block";
  if (contentEl) contentEl.style.display = "none";
  CashForecastState.loading = true;

  try {
    const ctx = getFinanceContext();
    const params = {
      currency: ctx.currency || "USD",
      horizon_days: CashForecastState.horizon,
      include_expected: CashForecastState.includeExpected,
    };

    const data = await FinanceApi.getCashForecast(params);
    CashForecastState.data = data;

    if (asOfEl && data.as_of_date) {
      asOfEl.textContent = `As of ${data.as_of_date}`;
    }

    // FX Warning banner
    if (fxNoticeEl) {
      if (data.fx_warnings && data.fx_warnings.length > 0) {
        if (fxTextEl) fxTextEl.textContent = data.fx_warnings[0];
        fxNoticeEl.style.display = "block";
      } else {
        fxNoticeEl.style.display = "none";
      }
    }

    renderCashForecast(data);
  } catch (err) {
    console.error("Failed to load cash forecast:", err);
    if (contentEl) {
      contentEl.innerHTML = `
        <div class="fv-callout fv-callout--danger fv-section__notice">
          Unable to load cash forecast: ${_escapeHtml(err.message || "Unknown error")}
        </div>
      `;
    }
  } finally {
    CashForecastState.loading = false;
    if (skelEl) skelEl.style.display = "none";
    if (contentEl) contentEl.style.display = "block";
  }
}

function setForecastHorizon(days) {
  CashForecastState.horizon = days;
  const active = days === 30 ? "btnForecastHorizon30" : (days === 60 ? "btnForecastHorizon60" : "btnForecastHorizon90");
  ["btnForecastHorizon30", "btnForecastHorizon60", "btnForecastHorizon90"].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle("active", id === active);
    btn.setAttribute("aria-pressed", id === active ? "true" : "false");
  });

  loadFinanceCashForecast();
}

function toggleForecastExpected(include) {
  CashForecastState.includeExpected = !!include;
  loadFinanceCashForecast();
}

function renderCashForecast(data) {
  if (!data) return;
  const curr = data.currency !== "ALL" ? data.currency : "USD";
  const horizons = data.horizons || {};

  // Render 30, 60, 90 Days Horizon Cards
  const hMeta = [
    { key: "30_days", valCash: "valProjectedCash30", inFlow: "valInflows30", inSplit: "valInflowsSplit30", outFlow: "valOutflows30", outSplit: "valOutflowsSplit30", net: "valNetFlow30", badge: "badgeConfidence30" },
    { key: "60_days", valCash: "valProjectedCash60", inFlow: "valInflows60", inSplit: "valInflowsSplit60", outFlow: "valOutflows60", outSplit: "valOutflowsSplit60", net: "valNetFlow60", badge: "badgeConfidence60" },
    { key: "90_days", valCash: "valProjectedCash90", inFlow: "valInflows90", inSplit: "valInflowsSplit90", outFlow: "valOutflows90", outSplit: "valOutflowsSplit90", net: "valNetFlow90", badge: "badgeConfidence90" },
  ];

  hMeta.forEach((m) => {
    const h = horizons[m.key] || {};
    const cashEl = document.getElementById(m.valCash);
    const inEl = document.getElementById(m.inFlow);
    const inSplitEl = document.getElementById(m.inSplit);
    const outEl = document.getElementById(m.outFlow);
    const outSplitEl = document.getElementById(m.outSplit);
    const netEl = document.getElementById(m.net);
    const badgeEl = document.getElementById(m.badge);

    if (cashEl) cashEl.textContent = _formatAmount(h.projected_ending_cash, curr);
    if (inEl) inEl.textContent = _formatAmount(h.total_inflows, curr);
    if (inSplitEl) {
      inSplitEl.textContent = `${_formatAmount(h.confirmed_inflows, curr)} conf / ${_formatAmount(h.expected_inflows, curr)} exp`;
    }
    if (outEl) outEl.textContent = _formatAmount(h.total_outflows, curr);
    if (outSplitEl) {
      outSplitEl.textContent = `${_formatAmount(h.confirmed_outflows, curr)} conf / ${_formatAmount(h.expected_outflows, curr)} exp`;
    }
    if (netEl) {
      const netVal = h.net_cash_flow || 0;
      netEl.textContent = `${netVal >= 0 ? "+" : ""}${_formatAmount(netVal, curr)}`;
    }

    if (badgeEl) {
      const conf = (h.confidence || "high").toLowerCase();
      const group = conf === "high" ? "settled" : (conf === "medium" ? "open" : "waiting");
      badgeEl.className = `fv-status fv-status--${group}`;
      badgeEl.innerHTML = `<span class="fv-status__dot" aria-hidden="true"></span>${conf === "high" ? "High" : (conf === "medium" ? "Medium" : "Low")}`;
    }
  });

  // Render Multi-Account Cash Visibility Table
  renderCashAccountsTable(data.accounts || []);

  // Render Material Obligations Table
  renderObligationsTable(data.material_obligations || []);

  // Render Assumptions List
  const listEl = document.getElementById("listForecastAssumptions");
  if (listEl && data.assumptions && Array.isArray(data.assumptions)) {
    listEl.innerHTML = data.assumptions.map((a) => `<li>${_escapeHtml(a)}</li>`).join("");
  }
}

function renderCashAccountsTable(accounts) {
  const tbody = document.getElementById("tbodyCashAccounts");
  if (!tbody) return;

  if (!accounts || accounts.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="fv-empty-cell">
          No active bank or cash accounts found for this currency scope.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = accounts
    .map((acc, i) => {
      const book = acc.book_balance || 0;
      const uncleared = acc.uncleared_cheques_amount || 0;
      const pending = acc.pending_transfers_amount || 0;
      const available = acc.available_balance || 0;
      const reconciled = acc.reconciled_balance;
      const curr = acc.currency || "USD";
      const hue = FinanceUI.hueForId(acc.account_id || acc.id || i + 1);

      return `
        <tr>
          <td><div class="fv-cell-main">${FinanceUI.avatar(acc.account_name || "Account", hue)}<div class="fv-cell-main__text"><span class="fv-cell-main__name">${_escapeHtml(acc.account_name || "Account")}</span><span class="fv-sub">${_escapeHtml(acc.account_type || "bank")}</span></div></div></td>
          <td>${_escapeHtml(acc.bank_name || "—")}</td>
          <td>${_escapeHtml(curr)}</td>
          <td class="fv-num">${_formatAmount(book, curr)}</td>
          <td class="fv-num ${uncleared > 0 ? "" : "fv-muted"}">${uncleared > 0 ? `-${_formatAmount(uncleared, curr)}` : "–"}</td>
          <td class="fv-num ${pending > 0 ? "" : "fv-muted"}">${pending > 0 ? `-${_formatAmount(pending, curr)}` : "–"}</td>
          <td class="fv-num"><span class="fv-amount__value">${_formatAmount(available, curr)}</span></td>
          <td class="fv-num ${reconciled !== null && reconciled !== undefined ? "" : "fv-muted"}">${reconciled !== null && reconciled !== undefined ? _formatAmount(reconciled, curr) : "Pending stmt"}</td>
        </tr>
      `;
    })
    .join("");
}

function filterObligationsTable(filterType) {
  CashForecastState.obligationsFilter = filterType;
  const active = filterType === "inflow" ? "btnObligationsFilterInflows" : (filterType === "outflow" ? "btnObligationsFilterOutflows" : "btnObligationsFilterAll");
  ["btnObligationsFilterAll", "btnObligationsFilterInflows", "btnObligationsFilterOutflows"].forEach((id) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.classList.toggle("active", id === active);
    b.setAttribute("aria-pressed", id === active ? "true" : "false");
  });

  if (CashForecastState.data) {
    renderObligationsTable(CashForecastState.data.material_obligations || []);
  }
}

function renderObligationsTable(obligations) {
  const tbody = document.getElementById("tbodyForecastObligations");
  const countAll = document.getElementById("countObligationsAll");
  const countIn = document.getElementById("countObligationsInflows");
  const countOut = document.getElementById("countObligationsOutflows");

  if (!tbody) return;

  const totalCount = obligations.length;
  const inCount = obligations.filter((o) => o.type === "inflow").length;
  const outCount = obligations.filter((o) => o.type === "outflow").length;

  if (countAll) countAll.textContent = totalCount;
  if (countIn) countIn.textContent = inCount;
  if (countOut) countOut.textContent = outCount;

  const filter = CashForecastState.obligationsFilter || "all";
  const filtered = obligations.filter((o) => {
    if (filter === "inflow") return o.type === "inflow";
    if (filter === "outflow") return o.type === "outflow";
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" class="fv-empty-cell">
          No obligations found matching the current filter.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered
    .map((ob) => {
      const isInflow = ob.type === "inflow";
      const flowBadge = `<span class="fv-flow fv-flow--${isInflow ? "in" : "out"}">${isInflow ? "Inflow" : "Outflow"}</span>`;

      const cert = (ob.certainty || "contractual").toLowerCase();
      const certBadge = cert === "overdue" ? FinanceUI.statusPill("problem", "Overdue")
        : (cert === "estimated" ? FinanceUI.statusPill("waiting", "Estimated") : FinanceUI.statusPill("closed", "Contractual"));

      const isConfirmed = (ob.status || "").toLowerCase() === "confirmed";
      const statusBadge = isConfirmed ? FinanceUI.statusPill("settled", "Confirmed") : FinanceUI.statusPill("open", "Expected");
      const sign = isInflow ? "+" : "-";
      const route = _escapeHtml(ob.target_route || "a-finance-invoices");

      return `
        <tr>
          <td>${_escapeHtml(ob.due_date ? FinanceUI.formatDate(ob.due_date) : "—")}</td>
          <td>${flowBadge}</td>
          <td><a href="javascript:void(0)" class="fv-link" onclick="openAttentionItem('${route}', ${ob.entity_id || 0})">${_escapeHtml(ob.reference || "Obligation")}</a></td>
          <td>${_escapeHtml(ob.counterparty || "—")}</td>
          <td>${certBadge}</td>
          <td>${statusBadge}</td>
          <td class="fv-num"><span class="fv-amount__value">${sign}${_formatAmount(ob.amount, ob.currency)}</span></td>
          <td class="col-actions">${FinanceUI.rowActions({ icons: [{ icon: "fa-arrow-up-right-from-square", label: "Inspect source record", onclick: `openAttentionItem('${route}', ${ob.entity_id || 0})` }] })}</td>
        </tr>
      `;
    })
    .join("");
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
window.setAttentionSeverity = setAttentionSeverity;
window.onAttentionSearchInput = onAttentionSearchInput;
window.openAttentionItem = openAttentionItem;
window.markAttentionItemReviewed = markAttentionItemReviewed;

// Story 2.3 Window Exports
window.CashForecastState = CashForecastState;
window.loadFinanceCashForecast = loadFinanceCashForecast;
window.setForecastHorizon = setForecastHorizon;
window.toggleForecastExpected = toggleForecastExpected;
window.renderCashForecast = renderCashForecast;
window.renderCashAccountsTable = renderCashAccountsTable;
window.renderObligationsTable = renderObligationsTable;
window.filterObligationsTable = filterObligationsTable;

