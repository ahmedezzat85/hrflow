/**
 * fe/api/finance/commissions-api.js
 * Finance API - Sales commissions: salespeople and the quarterly commission report, with mock handlers.
 * Mock mode reproduces the visible states (list, create, update, validation, a quarter report); it does not
 * validate backend-only behaviour (accrual on a paid invoice, reversal voiding), which backend tests cover.
 */
(function (root) {
  const _isMock = () => (typeof root._isMock === "function" ? root._isMock() : typeof window !== "undefined" && window.location && window.location.search.includes("mock="));

  const FinanceMockState = root.FinanceMockState || (root.FinanceMockState = {});

  if (!FinanceMockState.salespeople) {
    FinanceMockState.salespeople = [
      { id: 1, name: "Sarah Connor", email: "sarah@example.com", employee_id: null, employee_name: null, notes: null, is_active: true, customer_count: 2 },
      { id: 2, name: "Omar Khaled", email: null, employee_id: 7, employee_name: "Omar Khaled", notes: "On staff", is_active: true, customer_count: 1 },
      { id: 3, name: "Retired Rep", email: null, employee_id: null, employee_name: null, notes: null, is_active: false, customer_count: 0 },
    ];
  }
  if (!FinanceMockState.commissions) {
    FinanceMockState.commissions = [
      { id: 1, salesperson_id: 1, salesperson_name: "Sarah Connor", customer_id: 1, customer_name: "Apex Health Partners", invoice_id: 101, invoice_number: "INV-2026-101", currency: "USD", base_amount: 10000, rate: 5, amount: 500, earned_date: "2026-08-20", status: "accrued", void_reason: null },
      { id: 2, salesperson_id: 1, salesperson_name: "Sarah Connor", customer_id: 2, customer_name: "Nile Diagnostics", invoice_id: 102, invoice_number: "INV-2026-102", currency: "EGP", base_amount: 200000, rate: 3, amount: 6000, earned_date: "2026-09-02", status: "accrued", void_reason: null },
      { id: 3, salesperson_id: 2, salesperson_name: "Omar Khaled", customer_id: 3, customer_name: "Delta Imaging", invoice_id: 103, invoice_number: "INV-2026-103", currency: "USD", base_amount: 4000, rate: 2.5, amount: 100, earned_date: "2026-07-15", status: "accrued", void_reason: null },
    ];
  }

  const _round = (n) => Math.round(n * 100) / 100;
  const _name = (id) => { const s = id ? FinanceMockState.salespeople.find((x) => x.id === Number(id)) : null; return s ? s.name : null; };

  const _quarterBounds = (year, quarter) => {
    if (![1, 2, 3, 4].includes(quarter)) throw new Error("quarter must be 1, 2, 3 or 4");
    const m1 = (quarter - 1) * 3 + 1;
    const lastDay = new Date(Date.UTC(year, m1 + 2, 0)).getUTCDate();
    const pad = (n) => String(n).padStart(2, "0");
    return [`${year}-${pad(m1)}-01`, `${year}-${pad(m1 + 2)}-${pad(lastDay)}`];
  };

  const _totals = (lines) => {
    const acc = {};
    lines.forEach((l) => {
      const t = acc[l.currency] || (acc[l.currency] = { currency: l.currency, count: 0, base_amount: 0, amount: 0 });
      t.count += 1; t.base_amount = _round(t.base_amount + l.base_amount); t.amount = _round(t.amount + l.amount);
    });
    return Object.values(acc).sort((a, b) => a.currency.localeCompare(b.currency));
  };

  const FinanceCommissionsApi = {
    async getSalespeople(params) {
      if (_isMock()) {
        let list = [...FinanceMockState.salespeople];
        if (params && params.is_active !== undefined && params.is_active !== "") {
          const want = params.is_active === true || params.is_active === "true";
          list = list.filter((s) => s.is_active === want);
        }
        return list.sort((a, b) => a.name.localeCompare(b.name));
      }
      let url = "/api/finance/salespeople";
      if (params) {
        const qs = new URLSearchParams(params).toString();
        if (qs) url += `?${qs}`;
      }
      return apiRequest("GET", url);
    },
    async createSalesperson(payload) {
      if (_isMock()) {
        const name = String(payload.name || "").trim();
        if (FinanceMockState.salespeople.some((s) => s.name.toLowerCase() === name.toLowerCase())) throw new Error(`A salesperson named '${name}' already exists`);
        const s = { id: Math.max(0, ...FinanceMockState.salespeople.map((x) => x.id)) + 1, name, email: payload.email || null, employee_id: payload.employee_id || null, employee_name: null, notes: payload.notes || null, is_active: true, customer_count: 0 };
        FinanceMockState.salespeople.push(s);
        return s;
      }
      return apiRequest("POST", "/api/finance/salespeople", payload);
    },
    async updateSalesperson(id, payload) {
      if (_isMock()) {
        const s = FinanceMockState.salespeople.find((x) => x.id === parseInt(id, 10));
        if (!s) throw new Error("Salesperson not found");
        if (payload.name && FinanceMockState.salespeople.some((x) => x.id !== s.id && x.name.toLowerCase() === String(payload.name).trim().toLowerCase())) throw new Error(`A salesperson named '${payload.name}' already exists`);
        Object.assign(s, payload);
        return s;
      }
      return apiRequest("PATCH", `/api/finance/salespeople/${id}`, payload);
    },
    async getCommissionReport(params = {}) {
      if (_isMock()) {
        const year = Number(params.year) || new Date().getFullYear();
        const quarter = Number(params.quarter) || Math.floor(new Date().getMonth() / 3) + 1;
        const [start, end] = _quarterBounds(year, quarter);
        const lines = FinanceMockState.commissions
          .filter((c) => c.status === "accrued" && c.earned_date >= start && c.earned_date <= end)
          .filter((c) => !params.salesperson_id || c.salesperson_id === Number(params.salesperson_id))
          .sort((a, b) => a.salesperson_name.localeCompare(b.salesperson_name) || a.earned_date.localeCompare(b.earned_date));
        const grouped = {};
        lines.forEach((l) => { (grouped[l.salesperson_id] || (grouped[l.salesperson_id] = [])).push(l); });
        const salespeople = Object.values(grouped).map((g) => ({ salesperson_id: g[0].salesperson_id, salesperson_name: g[0].salesperson_name, totals: _totals(g), lines: g }));
        return { year, quarter, period_start: start, period_end: end, salespeople, grand_totals: _totals(lines) };
      }
      const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""))).toString();
      return apiRequest("GET", `/api/finance/commissions/report${qs ? "?" + qs : ""}`);
    },
    _salespersonName: _name,
  };

  root.FinanceCommissionsApi = FinanceCommissionsApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceCommissionsApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceCommissionsApi;
  }
})(typeof window !== "undefined" ? window : globalThis);
