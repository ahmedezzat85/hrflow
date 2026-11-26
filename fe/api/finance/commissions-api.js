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
      { id: 1, name: "Sarah Connor", email: "sarah@example.com", employee_id: null, employee_name: null, notes: null, settlement_frequency: "quarterly", is_active: true, customer_count: 2 },
      { id: 2, name: "Omar Khaled", email: null, employee_id: 7, employee_name: "Omar Khaled", notes: "On staff", settlement_frequency: "monthly", is_active: true, customer_count: 1 },
      { id: 3, name: "Retired Rep", email: null, employee_id: null, employee_name: null, notes: null, settlement_frequency: "quarterly", is_active: false, customer_count: 0 },
    ];
  }
  if (!FinanceMockState.commissions) {
    FinanceMockState.commissions = [
      { id: 1, salesperson_id: 1, salesperson_name: "Sarah Connor", customer_id: 1, customer_name: "Apex Health Partners", invoice_id: 101, invoice_number: "INV-2026-101", currency: "USD", base_amount: 10000, rate: 5, amount: 500, earned_date: "2026-08-20", status: "accrued", void_reason: null },
      { id: 2, salesperson_id: 1, salesperson_name: "Sarah Connor", customer_id: 2, customer_name: "Nile Diagnostics", invoice_id: 102, invoice_number: "INV-2026-102", currency: "EGP", base_amount: 200000, rate: 3, amount: 6000, earned_date: "2026-09-02", status: "accrued", void_reason: null },
      { id: 3, salesperson_id: 2, salesperson_name: "Omar Khaled", customer_id: 3, customer_name: "Delta Imaging", invoice_id: 103, invoice_number: "INV-2026-103", currency: "USD", base_amount: 4000, rate: 2.5, amount: 100, earned_date: "2026-07-15", status: "accrued", void_reason: null },
    ];
  }

  if (!FinanceMockState.commissionSettlements) FinanceMockState.commissionSettlements = [];

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
        const s = { id: Math.max(0, ...FinanceMockState.salespeople.map((x) => x.id)) + 1, name, email: payload.email || null, employee_id: payload.employee_id || null, employee_name: null, notes: payload.notes || null, settlement_frequency: payload.settlement_frequency || (payload.employee_id ? "monthly" : "quarterly"), is_active: true, customer_count: 0 };
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
        const salespeople = Object.values(grouped).map((g) => {
          const sid = g[0].salesperson_id;
          const freq = (FinanceMockState.salespeople.find((s) => s.id === sid) || {}).settlement_frequency || "quarterly";
          const byPeriod = {};
          g.forEach((l) => {
            const key = freq === "monthly" ? l.earned_date.slice(0, 7) : "q";
            (byPeriod[key] || (byPeriod[key] = [])).push(l);
          });
          const periods = Object.keys(byPeriod).sort().map((key) => {
            const plines = byPeriod[key];
            let ps = start, pe = end, label = `Q${quarter} ${year}`;
            if (freq === "monthly") {
              const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7));
              ps = `${key}-01`; pe = `${key}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
              label = `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${y}`;
            }
            const sts = FinanceMockState.commissionSettlements.filter((s) => s.status === "settled" && s.salesperson_id === sid && s.period_start === ps && s.period_end === pe);
            return { period_start: ps, period_end: pe, label, totals: _totals(plines), lines: plines, unsettled_count: plines.filter((l) => !l.settlement_id).length, settlements: sts };
          });
          return { salesperson_id: sid, salesperson_name: g[0].salesperson_name, settlement_frequency: freq, totals: _totals(g), lines: g, periods };
        });
        return { year, quarter, period_start: start, period_end: end, salespeople, grand_totals: _totals(lines) };
      }
      const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""))).toString();
      return apiRequest("GET", `/api/finance/commissions/report${qs ? "?" + qs : ""}`);
    },
    async settleCommissions(payload) {
      if (_isMock()) {
        const sp = FinanceMockState.salespeople.find((s) => s.id === Number(payload.salesperson_id));
        if (!sp) throw new Error("Salesperson not found");
        const lines = FinanceMockState.commissions.filter((c) => c.salesperson_id === sp.id && c.status === "accrued" && !c.settlement_id && c.earned_date >= payload.period_start && c.earned_date <= payload.period_end);
        if (!lines.length) throw new Error("Nothing to settle: no unsettled commissions in this period");
        const st = { id: Math.max(0, ...FinanceMockState.commissionSettlements.map((x) => x.id)) + 1, salesperson_id: sp.id, period_start: payload.period_start, period_end: payload.period_end, settled_date: payload.settled_date, reference: payload.reference || null, notes: payload.notes || null, settled_by: "admin@hrflow.test", status: "settled", line_count: lines.length, totals: _totals(lines) };
        FinanceMockState.commissionSettlements.push(st);
        lines.forEach((l) => { l.settlement_id = st.id; });
        return st;
      }
      return apiRequest("POST", "/api/finance/commissions/settlements", payload, true, (root._intentHeaders ? root._intentHeaders("/api/finance/commissions/settlements", payload) : {}));
    },
    async undoCommissionSettlement(id) {
      if (_isMock()) {
        const st = FinanceMockState.commissionSettlements.find((x) => x.id === Number(id));
        if (!st) throw new Error("Settlement not found");
        if (st.status !== "settled") throw new Error("This settlement was already undone");
        st.status = "undone";
        FinanceMockState.commissions.forEach((l) => { if (l.settlement_id === st.id) l.settlement_id = null; });
        return st;
      }
      return apiRequest("POST", `/api/finance/commissions/settlements/${id}/undo`, null, true, (root._intentHeaders ? root._intentHeaders(`/api/finance/commissions/settlements/${id}/undo`, null) : {}));
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
