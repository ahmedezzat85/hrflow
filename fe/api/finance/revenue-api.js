/**
 * fe/api/finance/revenue-api.js
 * Finance API - Revenue sources, revenue receipts and the revenue breakdown (X4, D-029/D-030).
 */
(function (root) {
  const _isMock = () => (typeof root._isMock === "function" ? root._isMock() : typeof window !== "undefined" && window.location && window.location.search.includes("mock="));
  const FinanceMockState = root.FinanceMockState || (root.FinanceMockState = {});

  if (!FinanceMockState.revenueSources) {
    FinanceMockState.revenueSources = [
      { id: 1, code: "invoice", name: "Invoice", sort_order: 1, is_active: true, is_system: true },
      { id: 2, code: "stripe_payout", name: "Stripe payout", sort_order: 2, is_active: true, is_system: false },
      { id: 3, code: "direct_transfer", name: "Direct transfer", sort_order: 3, is_active: true, is_system: false },
      { id: 4, code: "cash", name: "Cash", sort_order: 4, is_active: true, is_system: false },
      { id: 5, code: "other", name: "Other", sort_order: 5, is_active: true, is_system: false },
    ];
  }
  if (!FinanceMockState.revenueReceipts) {
    FinanceMockState.revenueReceipts = [
      { id: 9001, account_id: 5, account_name: "Voyance Overseas USD", book_code: "overseas", date: "2026-09-12", amount: 4000.0, currency: "USD", direction: "in", revenue_source_id: 2, revenue_source_name: "Stripe payout", product_id: 1, product_name: "HRFlow Cloud (SaaS)", customer_id: null, customer_name: null, period_start: "2026-09-01", period_end: "2026-09-30", memo_gross_amount: 4150.0, memo_fee_amount: 150.0, reference: "po_9001", description: "Revenue receipt: Stripe payout", is_reversal: false, has_attachment: false, attachment_name: null },
      { id: 9002, account_id: 5, account_name: "Voyance Overseas USD", book_code: "overseas", date: "2026-09-20", amount: 10000.0, currency: "USD", direction: "in", revenue_source_id: 3, revenue_source_name: "Direct transfer", product_id: 2, product_name: "Implementation Services", customer_id: null, customer_name: null, period_start: null, period_end: null, memo_gross_amount: null, memo_fee_amount: null, reference: "WIRE-77", description: "Revenue receipt: Direct transfer", is_reversal: false, has_attachment: false, attachment_name: null },
    ];
  }
  const _mockSource = (id) => FinanceMockState.revenueSources.find((s) => s.id === Number(id));

  const FinanceRevenueApi = {
    async getRevenueSources(params) {
      if (_isMock()) {
        let list = [...FinanceMockState.revenueSources];
        if (params && params.is_active !== undefined && params.is_active !== "") list = list.filter((s) => s.is_active === (params.is_active === true || params.is_active === "true"));
        return list.sort((a, b) => a.sort_order - b.sort_order);
      }
      let url = "/api/finance/revenue-sources";
      if (params) { const qs = new URLSearchParams(params).toString(); if (qs) url += `?${qs}`; }
      return apiRequest("GET", url);
    },
    async createRevenueSource(payload) {
      if (_isMock()) {
        const code = String(payload.code).trim().toLowerCase().replace(/ /g, "_");
        if (FinanceMockState.revenueSources.some((s) => s.code === code)) throw new Error(`Revenue source code '${code}' already exists`);
        const s = { id: Math.max(0, ...FinanceMockState.revenueSources.map((x) => x.id)) + 1, code, name: String(payload.name).trim(), sort_order: payload.sort_order || 0, is_active: payload.is_active !== false, is_system: false };
        FinanceMockState.revenueSources.push(s);
        return s;
      }
      return apiRequest("POST", "/api/finance/revenue-sources", payload);
    },
    async updateRevenueSource(id, payload) {
      if (_isMock()) {
        const s = _mockSource(id);
        if (!s) throw new Error("Revenue source not found");
        if (s.is_system && payload.is_active === false) throw new Error("The Invoice source is used by invoice receipts and cannot be deactivated");
        Object.assign(s, payload);
        return s;
      }
      return apiRequest("PATCH", `/api/finance/revenue-sources/${id}`, payload);
    },
    async getRevenueReceipts(params) {
      if (_isMock()) {
        let list = [...FinanceMockState.revenueReceipts];
        if (params && params.book && params.book !== "consolidated") list = list.filter((r) => r.book_code === params.book);
        return list.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
      }
      let url = "/api/finance/revenue-receipts";
      if (params) { const qs = new URLSearchParams(params).toString(); if (qs) url += `?${qs}`; }
      return apiRequest("GET", url);
    },
    async createRevenueReceipt(payload) {
      if (_isMock()) {
        const acc = (FinanceMockState.accounts || []).find((a) => a.id === Number(payload.account_id));
        if (!acc) throw new Error("Account not found");
        if (String(payload.currency || "").toUpperCase() !== acc.currency) throw new Error(`The receipt currency (${String(payload.currency).toUpperCase()}) must match the account currency (${acc.currency}). Use an FX transfer to exchange currencies.`);
        const src = _mockSource(payload.revenue_source_id);
        if (!src) throw new Error("Revenue source not found");
        if (src.code === "invoice") throw new Error("Invoice receipts are recorded against the invoice, not as a revenue receipt");
        if (payload.period_start && payload.period_end && payload.period_end < payload.period_start) throw new Error("period_end cannot precede period_start");
        const prod = payload.product_id ? (FinanceMockState.products || []).find((p) => p.id === Number(payload.product_id)) : null;
        acc.current_balance = Math.round((Number(acc.current_balance || 0) + Number(payload.amount)) * 100) / 100;
        const r = {
          id: Math.max(9000, ...FinanceMockState.revenueReceipts.map((x) => x.id)) + 1, account_id: acc.id, account_name: acc.account_name, book_code: acc.book_code,
          date: payload.date, amount: Number(payload.amount), currency: acc.currency, direction: "in", revenue_source_id: src.id, revenue_source_name: src.name,
          product_id: prod ? prod.id : null, product_name: prod ? prod.name : null, customer_id: payload.customer_id || null, customer_name: null,
          period_start: payload.period_start || null, period_end: payload.period_end || null, memo_gross_amount: payload.memo_gross_amount ?? null,
          memo_fee_amount: payload.memo_fee_amount ?? null, reference: payload.reference || "", description: payload.description || `Revenue receipt: ${src.name}`,
          is_reversal: false, has_attachment: false, attachment_name: null,
        };
        FinanceMockState.revenueReceipts.push(r);
        return r;
      }
      return apiRequest("POST", "/api/finance/revenue-receipts", payload);
    },
    async reverseRevenueReceipt(id, payload) {
      if (_isMock()) {
        const orig = FinanceMockState.revenueReceipts.find((r) => r.id === Number(id));
        if (!orig) throw new Error("Revenue receipt not found");
        if (orig.is_reversal) throw new Error("A reversal cannot be reversed");
        if (FinanceMockState.revenueReceipts.some((r) => r.reference === `REV-${orig.id}`)) throw new Error("This receipt has already been reversed");
        const acc = (FinanceMockState.accounts || []).find((a) => a.id === orig.account_id);
        if (acc) acc.current_balance = Math.round((Number(acc.current_balance || 0) - orig.amount) * 100) / 100;
        const rev = { ...orig, id: Math.max(9000, ...FinanceMockState.revenueReceipts.map((x) => x.id)) + 1, direction: "out", is_reversal: true, reference: `REV-${orig.id}`, description: `Reversal of revenue receipt #${orig.id}: ${payload.reason}` };
        FinanceMockState.revenueReceipts.push(rev);
        return rev;
      }
      return apiRequest("POST", `/api/finance/revenue-receipts/${id}/reverse`, payload);
    },
    async uploadRevenueReceiptAttachment(id, file) {
      if (_isMock()) {
        const r = FinanceMockState.revenueReceipts.find((x) => x.id === Number(id));
        if (!r) throw new Error("Revenue receipt not found");
        r.has_attachment = true;
        r.attachment_name = (file && file.name) || "receipt.pdf";
        return r;
      }
      const formData = new FormData();
      formData.append("file", file);
      return apiRequest("POST", `/api/finance/revenue-receipts/${id}/attachment`, formData);
    },
    async getRevenueBreakdown(params = {}) {
      params = _withBook(params, "revenue");
      if (_isMock()) {
        // Mirrors the backend: revenue receipts grouped by month, book, source, product and customer, per currency
        const rows = {};
        const add = (r, signed) => {
          if (params.book && params.book !== "consolidated" && r.book_code !== params.book) return;
          if (params.currency && String(params.currency).toUpperCase() !== "ALL" && r.currency !== String(params.currency).toUpperCase()) return;
          const product = r.product_name || "Untagged revenue";
          const key = [r.date.slice(0, 7), r.book_code, r.revenue_source_name, product, r.currency].join("|");
          rows[key] = rows[key] || { month: r.date.slice(0, 7), book_code: r.book_code, source: r.revenue_source_name, product_id: r.product_id, product_name: product, customer_name: r.customer_name || "No customer", currency: r.currency, amount: 0 };
          rows[key].amount = Math.round((rows[key].amount + signed) * 100) / 100;
        };
        FinanceMockState.revenueReceipts.forEach((r) => add(r, r.direction === "out" ? -r.amount : r.amount));
        // Invoice receipts from the sales invoices that are paid or partly paid (Local book, source Invoice)
        (FinanceMockState.invoices || []).filter((i) => Number(i.amount_paid || 0) > 0).forEach((i) => {
          const acc = (FinanceMockState.accounts || []).find((a) => a.id === i.expected_bank_account_id);
          const book = acc ? acc.book_code : "local";
          const lines = i.lines || [];
          const total = lines.reduce((s, l) => s + Number(l.line_total || 0), 0) || 1;
          if (lines.length) {
            lines.forEach((l) => add({ date: i.issue_date, book_code: book, revenue_source_name: "Invoice", product_id: l.product_id || null, product_name: l.product_name || null, customer_name: i.customer_name, currency: i.currency }, Number(i.amount_paid) * (Number(l.line_total || 0) / total)));
          }
        });
        const out = Object.values(rows).sort((a, b) => a.month.localeCompare(b.month) || a.book_code.localeCompare(b.book_code) || a.source.localeCompare(b.source) || a.product_name.localeCompare(b.product_name));
        const totals = {};
        const untagged = {};
        out.forEach((r) => {
          totals[r.currency] = Math.round(((totals[r.currency] || 0) + r.amount) * 100) / 100;
          if (r.product_name === "Untagged revenue") untagged[r.currency] = Math.round(((untagged[r.currency] || 0) + r.amount) * 100) / 100;
        });
        return { book: params.book || null, date_from: params.date_from || null, date_to: params.date_to || null, currency: (params.currency || "ALL").toUpperCase(), rows: out, totals_by_currency: totals, untagged_by_currency: untagged, conversion_policy: "One figure per currency. Currencies are never added together and no converted total is shown." };
      }
      const qs = new URLSearchParams(params).toString();
      return apiRequest("GET", `/api/finance/reports/revenue-breakdown${qs ? "?" + qs : ""}`);
    },
  };

  root.FinanceRevenueApi = FinanceRevenueApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceRevenueApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceRevenueApi;
  }
})(typeof window !== "undefined" ? window : globalThis);
