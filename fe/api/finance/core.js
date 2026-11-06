/**
 * fe/api/finance/core.js
 * Finance API - Core configuration, shared helpers, base mock state and observability.
 */
(function (root) {
  const _isMock = () => typeof window !== "undefined" && window.location && window.location.search.includes("mock=");
  root._isMock = _isMock;

  // List endpoints cap one response (limit default 50 to 100, max 100 to 500), and the pages filter, sort and
  // paginate on the client. Reading only the first response silently dropped every row after the cap.
  // This follows limit/offset until a short page. A caller that sets its own limit or offset gets exactly that page.
  async function _getAllPages(path, params, pageSize) {
    const base = { ...(params || {}) };
    const urlFor = (p) => { const qs = new URLSearchParams(p).toString(); return qs ? `${path}?${qs}` : path; };
    if (base.limit !== undefined || base.offset !== undefined) return apiRequest("GET", urlFor(base));
    const all = [];
    for (let page = 0; page < 200; page++) { // 200 pages is a runaway guard, far above any real list
      const rows = await apiRequest("GET", urlFor({ ...base, limit: pageSize, offset: page * pageSize }));
      if (!Array.isArray(rows)) return rows;
      all.push(...rows);
      if (rows.length < pageSize) break;
    }
    return all;
  }
  root._getAllPages = _getAllPages;

  function round(val, decimals = 2) {
    return Math.round((Number(val || 0) + Number.EPSILON) * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }
  root.round = round;

  function _getIdempHeaders(explicitKey = null) {
    const key = explicitKey || (typeof FinanceCommand !== "undefined" && FinanceCommand.generateIdempotencyKey ? FinanceCommand.generateIdempotencyKey() : null);
    return key ? { "Idempotency-Key": key } : {};
  }
  root._getIdempHeaders = _getIdempHeaders;

  const FinanceMockState = root.FinanceMockState || (root.FinanceMockState = {});
  if (!FinanceMockState.featureFlags) {
    FinanceMockState.featureFlags = {
    phase1_navigation: true,
    phase2_dashboard_kpis: true,
    phase3_sales_invoicing: true,
    phase4_vendor_payables: true,
    phase5_banking_workspace: true,
    phase6_reconciliation: true,
    phase7_financial_reports: true,
    phase8_guided_payroll: true,
    mobile_priority_ui: true,
  };
  }

  const CoreApi = {
async getFeatureFlags() {
    if (_isMock()) {
      const flags = FinanceMockState.featureFlags || {};
      return {
        status: "success",
        flags: { ...flags },
        rollout_stage: Object.values(flags).every(Boolean) ? "general_availability" : "pilot",
        active_count: Object.values(flags).filter(Boolean).length,
        total_count: Object.keys(flags).length,
      };
    }
    return apiRequest("GET", "/api/finance/feature-flags");
  },

  async updateFeatureFlags(flags) {
    if (_isMock()) {
      FinanceMockState.featureFlags = { ...(FinanceMockState.featureFlags || {}), ...flags };
      return {
        status: "success",
        flags: { ...FinanceMockState.featureFlags },
        message: `Updated ${Object.keys(flags).length} feature flag(s) safely`,
      };
    }
    return apiRequest("PATCH", "/api/finance/feature-flags", { flags });
  },

  async isFeatureEnabled(flagKey) {
    try {
      const res = await this.getFeatureFlags();
      return !!(res && res.flags && res.flags[flagKey]);
    } catch (_) {
      return true;
    }
  },

  async getObservabilityMetrics() {
    if (_isMock()) {
      return {
        status: "success",
        uptime_seconds: 3600.0,
        total_commands: 42,
        failed_commands: 0,
        idempotency_hits: 5,
        avg_latency_ms: 18.5,
        reconciliation_throughput_items_per_sec: 120.0,
        timestamp: new Date().toISOString(),
      };
    }
    return apiRequest("GET", "/api/finance/observability/metrics");
  }
  };

  root.FinanceCoreApi = CoreApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, CoreApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = CoreApi;
  }
})(typeof window !== "undefined" ? window : globalThis);

// Adds the page's book view (X2, D-028) to report params; an explicit params.book wins.
function _withBook(params, page) {
  const p = Object.assign({}, params || {});
  if (!p.book && typeof FinanceBookView !== "undefined") p.book = FinanceBookView.get(page);
  return p;
}
if (typeof window !== "undefined") window._withBook = _withBook;

