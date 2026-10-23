/**
 * fe/api/analytics-api.js
 * Analytics API client (employee pay analytics). Inlined into index.html by vite.config.js.
 *
 *   AnalyticsApi.getEmployeePay(empId, { startDate, endDate, groupBy, currency })
 *   AnalyticsApi.exportEmployeePay(empId, { format, dataset, startDate, endDate, groupBy, currency }) -> { blob, filename }
 *
 * Mock mode (?mock=...) answers from fixtures that follow the viewer's permissions: `plan` only with
 * hr.salary.read, `payments` only with finance.report.read. Tests pick a scenario with
 * `window.__payFixture = 'empty' | 'two-currencies'` (default: full history for employee 1, none for others).
 */
(function (root) {
  const isMock = () => typeof window !== 'undefined' && window.location && window.location.search.includes('mock=');
  const hasPerm = (key) => typeof SessionInfo !== 'undefined' && SessionInfo.hasPermission(key);

  function query(params) {
    const q = new URLSearchParams();
    Object.keys(params).forEach((k) => { if (params[k] != null && params[k] !== '') q.set(k, params[k]); });
    return q.toString();
  }
  function filters(f) {
    return { start_date: f.startDate, end_date: f.endDate, group_by: f.groupBy || 'month', currency: f.currency || 'USD' };
  }

  // ---- fixtures -------------------------------------------------------------------------------
  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTH_ROWS = (() => {
    const rows = [];
    const commission = { '2026-03': 420, '2026-07': 610, '2026-09': 380 };
    const bonus = { '2025-12': 1000 };
    for (let i = 0; i < 12; i++) {
      const y = i < 2 ? 2025 : 2026;
      const m = i < 2 ? 11 + i : i - 1;
      const key = `${y}-${String(m).padStart(2, '0')}`;
      if (key === '2026-02') continue; // no payroll that month: a gap, not a zero bar
      const raised = key >= '2026-06';
      const status = key === '2026-10' ? 'draft' : key === '2026-09' ? 'pending' : 'paid';
      rows.push({
        bucket: key, label: `${MONTH_NAMES[m - 1]} ${y}`,
        base_internal: raised ? 5500 : 5000, base_external: raised ? 8250 : 7500,
        commission: commission[key] || 0, bonus: bonus[key] || 0,
        payment_status: status, paid_at: status === 'paid' ? `${key}-28` : null, runs: 1,
      });
    }
    return rows;
  })();
  const PLAN_CHANGES = [
    { date: '2025-01-15', previous_total: 11000, new_total: 12500, new_internal: 5000, new_external: 7500, pct_change: 13.6, reason: 'Annual performance raise' },
    { date: '2026-06-01', previous_total: 12500, new_total: 13750, new_internal: 5500, new_external: 8250, pct_change: 10.0, reason: 'Promotion to Lead' },
  ];
  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

  function bucketKey(row, groupBy) {
    if (groupBy !== 'quarter') return { bucket: row.bucket, label: row.label };
    const [y, m] = row.bucket.split('-').map(Number);
    const q = Math.ceil(m / 3);
    return { bucket: `${y}-Q${q}`, label: `Q${q} ${y}` };
  }
  function aggregate(rows, groupBy) {
    const out = new Map();
    rows.forEach((r) => {
      const k = bucketKey(r, groupBy);
      const b = out.get(k.bucket) || { ...k, base_external: 0, base_internal: 0, commission: 0, bonus: 0, statuses: new Set(), paid_at: null };
      b.base_external += r.base_external; b.base_internal += r.base_internal; b.commission += r.commission; b.bonus += r.bonus;
      b.statuses.add(r.payment_status);
      if (r.paid_at && (!b.paid_at || r.paid_at > b.paid_at)) b.paid_at = r.paid_at;
      out.set(k.bucket, b);
    });
    return Array.from(out.values()).map((b) => {
      const st = b.statuses.size === 1 ? Array.from(b.statuses)[0] : 'mixed';
      return {
        bucket: b.bucket, label: b.label, base_external: b.base_external, base_internal: b.base_internal,
        commission: b.commission, bonus: b.bonus,
        total: b.base_external + b.base_internal + b.commission + b.bonus,
        payment_status: st, paid_at: st === 'paid' ? b.paid_at : null,
      };
    });
  }

  function mockPay(empId, f) {
    const scenario = (typeof window !== 'undefined' && window.__payFixture) || '';
    const emp = (typeof employees !== 'undefined' ? employees : []).find((e) => String(e.id) === String(empId));
    const hasHistory = scenario !== 'empty' && String(empId) === '1';
    const currency = f.currency || 'USD';
    const res = {
      employee: { id: Number(empId), name: emp ? emp.name : 'Employee', department: emp ? emp.dept : '' },
      period: { start_date: f.startDate, end_date: f.endDate, group_by: f.groupBy || 'month', currency },
      generated_at: new Date().toISOString(),
    };
    if (hasPerm('finance.report.read')) {
      const twoCur = scenario === 'two-currencies';
      res.currencies_available = twoCur ? ['USD', 'EGP'] : ['USD'];
      let rows = hasHistory && (currency === 'USD' || !twoCur) ? MONTH_ROWS : [];
      if (hasHistory && twoCur && currency === 'EGP') {
        rows = MONTH_ROWS.map((r) => ({ ...r, base_internal: r.base_internal * 48, base_external: 0, commission: r.commission * 48, bonus: r.bonus * 48 }));
      }
      rows = rows.filter((r) => r.bucket + '-01' <= f.endDate && r.bucket + '-31' >= f.startDate);
      const series = aggregate(rows, f.groupBy);
      const sum = (k) => round2(series.reduce((s, b) => s + b[k], 0));
      res.payments = {
        totals: {
          base_external: sum('base_external'), base_internal: sum('base_internal'), commission: sum('commission'), bonus: sum('bonus'), total: sum('total'),
          cycles: rows.length, buckets_with_commission: series.filter((b) => b.commission > 0).length,
        },
        series,
      };
    }
    if (hasPerm('hr.salary.read')) {
      res.plan = hasHistory
        ? { current: { internal: 5500, external: 8250, total: 13750, effective_date: '2026-06-01' }, changes: PLAN_CHANGES.map((c) => ({ ...c })) }
        : { current: null, changes: [] };
    }
    return res;
  }

  const CSV_HEAD = {
    monthly: ['Period', 'Base external', 'Base internal', 'Commission', 'Bonus', 'Total', 'Payment status'],
    raises: ['Date', 'Previous total', 'New total', 'Change %', 'Reason'],
  };
  function mockExport(empId, o) {
    const data = mockPay(empId, o);
    const dataset = o.dataset === 'raises' ? 'raises' : 'monthly';
    const rows = dataset === 'raises'
      ? ((data.plan && data.plan.changes) || []).map((c) => [c.date, c.previous_total, c.new_total, c.pct_change, c.reason])
      : ((data.payments && data.payments.series) || []).map((b) => [b.label, b.base_external, b.base_internal, b.commission, b.bonus, b.total, b.payment_status]);
    const csv = [CSV_HEAD[dataset]].concat(rows).map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const xlsx = o.format === 'xlsx';
    // Mock only: the xlsx bytes are CSV text under the xlsx media type; the real file comes from the backend.
    const type = xlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';
    return { blob: new Blob([csv], { type }), filename: `pay-${empId}-${dataset}.${xlsx ? 'xlsx' : 'csv'}` };
  }

  // ---- client ---------------------------------------------------------------------------------
  const AnalyticsApi = {
    async getEmployeePay(empId, f) {
      if (isMock()) return mockPay(empId, f);
      return apiRequest('GET', `/api/analytics/employees/${encodeURIComponent(empId)}/pay?${query(filters(f))}`);
    },

    async exportEmployeePay(empId, o) {
      if (isMock()) return mockExport(empId, o);
      const qs = query({ format: o.format, dataset: o.dataset, ...filters(o) });
      const res = await fetch(`${API_BASE_URL}/api/analytics/employees/${encodeURIComponent(empId)}/pay/export?${qs}`, { credentials: 'include' });
      if (res.status === 401) {
        forceSessionExpiredLogout();
        throw new Error('Session expired. Please sign in again.');
      }
      if (!res.ok) {
        let detail = res.status === 403 ? 'You do not have access to export this data.' : res.status === 404 ? 'Employee not found.' : `Export failed (${res.status})`;
        try { const d = await res.json(); if (typeof (d.detail || d.error) === 'string') detail = d.detail || d.error; } catch (_) { /* keep default */ }
        throw new Error(detail);
      }
      const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('Content-Disposition') || '');
      const fallback = `pay-${empId}-${o.dataset}.${o.format}`;
      return { blob: await res.blob(), filename: m ? decodeURIComponent(m[1]) : fallback };
    },
  };

  root.AnalyticsApi = AnalyticsApi;
})(window);
