/**
 * fe/api/finance/cheques-api.js
 * Finance API - Cheques domain client and mock handlers.
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

  if (!FinanceMockState.cheques) {
    FinanceMockState.cheques = [
    {
      id: 1,
      cheque_number: "001011",
      account_id: 1,
      account_name: "Voyance Operating USD",
      issue_date: "2026-09-02",
      amount: 4200.0,
      currency: "USD",
      payee: "Amazon Web Services",
      purpose_type: "vendor_payment",
      linked_bill_id: 1,
      status: "cleared",
      clear_date: "2026-09-05",
      fiscal_year: 2026,
      notes: "AWS cloud hosting payment",
      created_at: "2026-09-02T10:00:00",
    },
    {
      id: 2,
      cheque_number: "001012",
      account_id: 1,
      account_name: "Voyance Operating USD",
      issue_date: "2026-09-06",
      amount: 15000.0,
      currency: "USD",
      payee: "Voyance Health (Cash Drawer)",
      purpose_type: "cash_withdrawal",
      destination_cash_account_id: 2,
      destination_cash_account_name: "Voyance Treasury Reserve",
      status: "issued",
      clear_date: null,
      fiscal_year: 2026,
      notes: "Petty cash replenishment",
      created_at: "2026-09-06T11:00:00",
    },
  ];
  }

  const FinanceChequesApi = {
// Cheques (Phase 5)
  async getCheques(params) {
    if (_isMock()) {
      let list = [...(FinanceMockState.cheques || [])];
      if (params) {
        if (params.fiscal_year) list = list.filter((c) => c.fiscal_year === parseInt(params.fiscal_year, 10));
        if (params.status) list = list.filter((c) => c.status === params.status);
        if (params.account_id) list = list.filter((c) => c.account_id === parseInt(params.account_id, 10));
        if (params.payee) list = list.filter((c) => (c.payee || "").toLowerCase().includes(params.payee.toLowerCase()));
        if (params.search) {
          const s = params.search.toLowerCase();
          list = list.filter((c) => (c.cheque_number || "").toLowerCase().includes(s) || (c.payee || "").toLowerCase().includes(s) || (c.notes || "").toLowerCase().includes(s));
        }
      }
      return list;
    }
    let url = "/api/finance/cheques";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async getCheque(id) {
    if (_isMock()) {
      const c = (FinanceMockState.cheques || []).find((item) => item.id === parseInt(id, 10));
      if (!c) throw new Error("Cheque not found");
      return c;
    }
    return apiRequest("GET", `/api/finance/cheques/${id}`);
  },
  async createCheque(payload) {
    if (_isMock()) {
      const bank = (FinanceMockState.accounts || []).find((a) => a.id === parseInt(payload.account_id, 10));
      const destCash = payload.destination_cash_account_id ? (FinanceMockState.accounts || []).find((a) => a.id === parseInt(payload.destination_cash_account_id, 10)) : null;
      const yr = payload.fiscal_year || (payload.issue_date ? parseInt(payload.issue_date.split("-")[0], 10) : new Date().getFullYear());
      const st = payload.status || "issued";
      const policy = payload.posting_policy || "at_issue";
      const diffDays = Math.floor((new Date() - new Date(payload.issue_date)) / (1000 * 60 * 60 * 24));
      const isStale = diffDays > 180;
      const newCheque = {
        id: (FinanceMockState.cheques || []).length + 1,
        ...payload,
        account_id: parseInt(payload.account_id, 10),
        account_name: bank ? bank.account_name : null,
        destination_cash_account_name: destCash ? destCash.account_name : null,
        status: st,
        posting_policy: policy,
        signer_name: payload.signer_name || null,
        is_stale: isStale,
        stale_warning: isStale ? `Cheque is stale-dated (${diffDays} days old, exceeding standard 180-day validity).` : null,
        clear_date: null,
        fiscal_year: yr,
        created_at: new Date().toISOString(),
      };
      if (!FinanceMockState.cheques) FinanceMockState.cheques = [];
      FinanceMockState.cheques.unshift(newCheque);

      // Deduct balance from bank only if issued and at_issue
      if (st === "issued" && policy === "at_issue") {
        if (bank) bank.current_balance = round(bank.current_balance - Number(payload.amount), 2);
        if (destCash && payload.purpose_type === "cash_withdrawal") {
          destCash.current_balance = round(destCash.current_balance + Number(payload.amount), 2);
        }
        if (payload.linked_bill_id) {
          const bill = (FinanceMockState.bills || []).find((b) => b.id === parseInt(payload.linked_bill_id, 10));
          if (bill) bill.status = "paid";
        }
      }
      return newCheque;
    }
    return apiRequest("POST", "/api/finance/cheques", payload);
  },
  async updateChequeStatus(id, payload) {
    if (_isMock()) {
      const c = (FinanceMockState.cheques || []).find((item) => item.id === parseInt(id, 10));
      if (!c) throw new Error("Cheque not found");
      const oldStatus = c.status;
      c.status = payload.status;
      if (payload.reason) c.exception_reason = payload.reason;
      if (payload.evidence) c.exception_evidence = payload.evidence;

      const bank = (FinanceMockState.accounts || []).find((a) => a.id === c.account_id);
      const cash = c.destination_cash_account_id ? (FinanceMockState.accounts || []).find((a) => a.id === c.destination_cash_account_id) : null;

      if (payload.status === "cleared") {
        c.clear_date = payload.clear_date || new Date().toISOString().split("T")[0];
        if (c.posting_policy === "at_clearing") {
          if (bank) bank.current_balance = round(bank.current_balance - Number(c.amount), 2);
          if (cash && c.purpose_type === "cash_withdrawal") {
            cash.current_balance = round(cash.current_balance + Number(c.amount), 2);
          }
          if (c.linked_bill_id) {
            const bill = (FinanceMockState.bills || []).find((b) => b.id === c.linked_bill_id);
            if (bill) bill.status = "paid";
          }
        }
      } else if (payload.status === "issued" && oldStatus === "draft") {
        if (c.posting_policy === "at_issue") {
          if (bank) bank.current_balance = round(bank.current_balance - Number(c.amount), 2);
          if (cash && c.purpose_type === "cash_withdrawal") {
            cash.current_balance = round(cash.current_balance + Number(c.amount), 2);
          }
        }
      } else if (["bounced", "stopped", "voided", "replaced"].includes(payload.status)) {
        // Reverse if previously deducted
        const wasDeducted = (oldStatus === "issued" && c.posting_policy === "at_issue") ||
                            (oldStatus === "outstanding" && c.posting_policy === "at_issue") ||
                            (oldStatus === "cleared");
        if (wasDeducted) {
          if (bank) bank.current_balance = round(bank.current_balance + Number(c.amount), 2);
          if (cash && c.purpose_type === "cash_withdrawal") {
            cash.current_balance = round(cash.current_balance - Number(c.amount), 2);
          }
          if (c.linked_bill_id) {
            const bill = (FinanceMockState.bills || []).find((b) => b.id === c.linked_bill_id);
            if (bill) bill.status = "unpaid";
          }
        }
      }
      return c;
    }
    return apiRequest("PATCH", `/api/finance/cheques/${id}/status`, payload);
  },
  async replaceCheque(id, payload) {
    if (_isMock()) {
      const oldCheque = (FinanceMockState.cheques || []).find((item) => item.id === parseInt(id, 10));
      if (!oldCheque) throw new Error("Cheque not found");

      // Reverse old cheque balance impact
      const wasDeducted = oldCheque.status === "issued" || oldCheque.status === "outstanding" || oldCheque.status === "cleared";
      const bank = (FinanceMockState.accounts || []).find((a) => a.id === oldCheque.account_id);
      const cash = oldCheque.destination_cash_account_id ? (FinanceMockState.accounts || []).find((a) => a.id === oldCheque.destination_cash_account_id) : null;

      if (wasDeducted) {
        if (bank) bank.current_balance = round(bank.current_balance + Number(oldCheque.amount), 2);
        if (cash && oldCheque.purpose_type === "cash_withdrawal") {
          cash.current_balance = round(cash.current_balance - Number(oldCheque.amount), 2);
        }
      }

      oldCheque.status = "replaced";
      oldCheque.exception_reason = payload.reason;
      if (payload.evidence) oldCheque.exception_evidence = payload.evidence;

      // Issue new replacement cheque
      const newCheque = {
        id: (FinanceMockState.cheques || []).length + 1,
        account_id: oldCheque.account_id,
        account_name: oldCheque.account_name,
        cheque_number: payload.new_cheque_number,
        issue_date: payload.new_issue_date,
        amount: oldCheque.amount,
        currency: oldCheque.currency,
        payee: oldCheque.payee,
        purpose_type: oldCheque.purpose_type,
        destination_cash_account_id: oldCheque.destination_cash_account_id,
        destination_cash_account_name: oldCheque.destination_cash_account_name,
        linked_bill_id: oldCheque.linked_bill_id,
        status: "issued",
        posting_policy: oldCheque.posting_policy || "at_issue",
        signer_name: payload.signer_name || oldCheque.signer_name,
        replaced_cheque_id: oldCheque.id,
        clear_date: null,
        fiscal_year: parseInt(payload.new_issue_date.split("-")[0], 10),
        notes: `Replacement for Cheque #${oldCheque.cheque_number}. ${payload.notes || ''}`.trim(),
        created_at: new Date().toISOString(),
      };

      oldCheque.replacement_cheque_id = newCheque.id;
      FinanceMockState.cheques.unshift(newCheque);

      if (newCheque.posting_policy === "at_issue") {
        if (bank) bank.current_balance = round(bank.current_balance - Number(newCheque.amount), 2);
        if (cash && newCheque.purpose_type === "cash_withdrawal") {
          cash.current_balance = round(cash.current_balance + Number(newCheque.amount), 2);
        }
      }
      return newCheque;
    }
    return apiRequest("POST", `/api/finance/cheques/${id}/replace`, payload);
  }
  };

  root.FinanceChequesApi = FinanceChequesApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceChequesApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceChequesApi;
  }
})(typeof window !== "undefined" ? window : globalThis);
