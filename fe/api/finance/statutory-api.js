/**
 * fe/api/finance/statutory-api.js
 * Finance API - Statutory Obligations domain client and mock handlers.
 */
(function (root) {
  const _isMock = () => (typeof root._isMock === "function" ? root._isMock() : typeof window !== "undefined" && window.location && window.location.search.includes("mock="));
  const round = root.round || function (val, decimals = 2) {
    return Math.round((Number(val || 0) + Number.EPSILON) * Math.pow(10, decimals)) / Math.pow(10, decimals);
  };
  const _getIdempHeaders = root._getIdempHeaders || function (explicitKey = null) {
    const key = explicitKey || (typeof FinanceCommand !== "undefined" && FinanceCommand.generateIdempotencyKey ? FinanceCommand.generateIdempotencyKey() : null);
    return key ? { "Idempotency-Key": key } : {};
  };

  const FinanceMockState = root.FinanceMockState || (root.FinanceMockState = {});

  if (!FinanceMockState.statutoryObligations) {
    FinanceMockState.statutoryObligations = [
    {
      id: 1,
      obligation_type: "social_insurance_employee",
      period: "2026-08",
      amount_estimated: 1250.0,
      amount_accrued: 1250.0,
      amount_remitted: 0.0,
      remaining_balance: 1250.0,
      variance_amount: 0.0,
      variance_note: null,
      currency: "USD",
      status: "estimated",
      due_date: "2026-09-15",
      source_type: "payroll_run",
      source_id: 1,
      notes: "August payroll social insurance employee portion",
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T10:00:00Z",
    },
    {
      id: 2,
      obligation_type: "social_insurance_employer",
      period: "2026-08",
      amount_estimated: 3000.0,
      amount_accrued: 3000.0,
      amount_remitted: 0.0,
      remaining_balance: 3000.0,
      variance_amount: 0.0,
      variance_note: null,
      currency: "USD",
      status: "estimated",
      due_date: "2026-09-15",
      source_type: "payroll_run",
      source_id: 1,
      notes: "August payroll social insurance employer contribution",
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T10:00:00Z",
    },
    {
      id: 3,
      obligation_type: "income_tax",
      period: "2026-08",
      amount_estimated: 2500.0,
      amount_accrued: 2500.0,
      amount_remitted: 0.0,
      remaining_balance: 2500.0,
      variance_amount: 0.0,
      variance_note: null,
      currency: "USD",
      status: "estimated",
      due_date: "2026-09-15",
      source_type: "payroll_run",
      source_id: 1,
      notes: "August payroll salary income tax withheld",
      created_at: "2026-09-01T10:00:00Z",
      updated_at: "2026-09-01T10:00:00Z",
    },
    {
      id: 4,
      obligation_type: "sales_tax",
      period: "2026-08",
      amount_estimated: null,
      amount_accrued: 4500.0,
      amount_remitted: 4500.0,
      remaining_balance: 0.0,
      variance_amount: 0.0,
      variance_note: null,
      currency: "USD",
      status: "remitted",
      due_date: "2026-09-10",
      source_type: "invoice_tax_line",
      source_id: null,
      notes: "August sales tax / VAT remittance",
      created_at: "2026-08-31T15:00:00Z",
      updated_at: "2026-09-05T11:00:00Z",
    },
    {
      id: 5,
      obligation_type: "withholding_tax",
      period: "2026-08",
      amount_estimated: null,
      amount_accrued: 850.0,
      amount_remitted: 0.0,
      remaining_balance: 850.0,
      variance_amount: 0.0,
      variance_note: null,
      currency: "USD",
      status: "accrued",
      due_date: "2026-09-25",
      source_type: "bill_tax_line",
      source_id: null,
      notes: "August vendor withholding tax",
      created_at: "2026-08-31T16:00:00Z",
      updated_at: "2026-08-31T16:00:00Z",
    },
  ];
  }

  const FinanceStatutoryApi = {
// Statutory Obligations (FUX-410)
  async listStatutoryObligations(params) {
    if (_isMock()) {
      let list = [...(FinanceMockState.statutoryObligations || [])];
      if (params) {
        if (params.obligation_type && params.obligation_type !== "all") {
          list = list.filter((o) => o.obligation_type === params.obligation_type);
        }
        if (params.status && params.status !== "all") {
          list = list.filter((o) => o.status === params.status);
        }
        if (params.period) {
          list = list.filter((o) => o.period.includes(params.period));
        }
        if (params.search) {
          const s = params.search.toLowerCase();
          list = list.filter((o) =>
            o.obligation_type.toLowerCase().includes(s) ||
            o.period.toLowerCase().includes(s) ||
            (o.notes && o.notes.toLowerCase().includes(s))
          );
        }
      }
      return list.map((o) => ({
        ...o,
        remaining_balance: Math.max(0, round(o.amount_accrued - (o.amount_remitted || 0))),
      }));
    }
    let url = "/api/finance/statutory-obligations";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },

  async getStatutoryObligation(id) {
    if (_isMock()) {
      const obl = (FinanceMockState.statutoryObligations || []).find((o) => o.id === Number(id));
      if (!obl) throw new Error(`Statutory obligation #${id} not found`);
      return {
        ...obl,
        remaining_balance: Math.max(0, round(obl.amount_accrued - (obl.amount_remitted || 0))),
      };
    }
    return apiRequest("GET", `/api/finance/statutory-obligations/${id}`);
  },

  async createStatutoryObligation(data) {
    if (_isMock()) {
      const newId = Math.max(0, ...(FinanceMockState.statutoryObligations || []).map((o) => o.id)) + 1;
      const accrued = Number(data.amount_accrued || 0);
      const obl = {
        id: newId,
        obligation_type: data.obligation_type,
        period: data.period,
        amount_estimated: null,
        amount_accrued: accrued,
        amount_remitted: 0.0,
        remaining_balance: accrued,
        variance_amount: 0.0,
        variance_note: null,
        currency: data.currency || "USD",
        status: "accrued",
        due_date: data.due_date || null,
        source_type: "manual",
        source_id: null,
        notes: data.notes || "",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      FinanceMockState.statutoryObligations.push(obl);
      return obl;
    }
    return apiRequest("POST", "/api/finance/statutory-obligations", data);
  },

  async confirmOrAdjustStatutoryObligation(id, data) {
    if (_isMock()) {
      const obl = (FinanceMockState.statutoryObligations || []).find((o) => o.id === Number(id));
      if (!obl) throw new Error(`Statutory obligation #${id} not found`);
      if (obl.status !== "estimated") throw new Error("Only estimated obligations can be confirmed or adjusted");

      const newAccrued = Number(data.amount_accrued);
      const est = obl.amount_estimated !== null && obl.amount_estimated !== undefined ? obl.amount_estimated : obl.amount_accrued;
      const variance = round(newAccrued - est);

      obl.amount_accrued = newAccrued;
      obl.variance_amount = variance;
      obl.variance_note = data.variance_note || null;
      obl.status = "accrued";
      obl.remaining_balance = Math.max(0, round(obl.amount_accrued - (obl.amount_remitted || 0)));
      obl.updated_at = new Date().toISOString();
      return obl;
    }
    return apiRequest("POST", `/api/finance/statutory-obligations/${id}/confirm`, data);
  },

  async settleStatutoryObligation(id, data) {
    if (_isMock()) {
      const obl = (FinanceMockState.statutoryObligations || []).find((o) => o.id === Number(id));
      if (!obl) throw new Error(`Statutory obligation #${id} not found`);
      if (obl.status === "estimated") throw new Error("Statutory obligation must be confirmed into accrued status before settlement");
      if (obl.status === "remitted") throw new Error("Statutory obligation is already fully remitted");

      const settleAmt = Number(data.amount);
      const remaining = Math.max(0, round(obl.amount_accrued - (obl.amount_remitted || 0)));
      if (settleAmt > remaining + 0.001) {
        throw new Error(`Payment amount ($${settleAmt.toFixed(2)}) exceeds remaining balance ($${remaining.toFixed(2)}).`);
      }

      const bankAcc = (FinanceMockState.accounts || []).find((a) => a.id === Number(data.bank_account_id));
      if (bankAcc) {
        bankAcc.current_balance = round(bankAcc.current_balance - settleAmt);
      }

      obl.amount_remitted = round((obl.amount_remitted || 0) + settleAmt);
      if (obl.amount_remitted >= obl.amount_accrued - 0.001) {
        obl.status = "remitted";
      } else {
        obl.status = "partially_remitted";
      }
      obl.remaining_balance = Math.max(0, round(obl.amount_accrued - obl.amount_remitted));
      obl.updated_at = new Date().toISOString();
      return obl;
    }
    return apiRequest("POST", `/api/finance/statutory-obligations/${id}/settle`, data);
  },

  async updateStatutoryObligation(id, data) {
    if (_isMock()) {
      if (data && data.status) {
        throw new Error("Direct status manipulation is forbidden. Status transitions occur only via confirm/adjust or settlement actions.");
      }
      const obl = (FinanceMockState.statutoryObligations || []).find((o) => o.id === Number(id));
      if (!obl) throw new Error(`Statutory obligation #${id} not found`);
      if (data.due_date !== undefined) obl.due_date = data.due_date;
      if (data.notes !== undefined) obl.notes = data.notes;
      obl.updated_at = new Date().toISOString();
      return obl;
    }
    return apiRequest("PATCH", `/api/finance/statutory-obligations/${id}`, data);
  }
  };

  root.FinanceStatutoryApi = FinanceStatutoryApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceStatutoryApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceStatutoryApi;
  }
})(typeof window !== "undefined" ? window : globalThis);
