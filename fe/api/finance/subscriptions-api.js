/**
 * fe/api/finance/subscriptions-api.js
 * Finance API - Subscriptions domain client and mock handlers.
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

  if (!FinanceMockState.subscriptions) {
    FinanceMockState.subscriptions = [
    { id: 1, vendor_id: 1, vendor_name: "Amazon Web Services", name: "AWS Cloud Infrastructure", amount: 4200.0, currency: "USD", billing_cycle: "monthly", next_renewal_date: "2026-10-01", contract_start_date: "2025-10-01", contract_end_date: "2026-10-01", notice_period_days: 30, owner: "Sarah Connor", department: "Engineering", payment_method: "card", seats_count: null, monthly_equivalent_amount: 4200.0, auto_generate_bill: false, is_active: true, charges_count: 1, last_charge_date: "2026-09-01", last_charge_amount: 4200.0 },
    { id: 2, vendor_id: 2, vendor_name: "Slack Technologies", name: "Slack Business+", amount: 320.0, currency: "USD", billing_cycle: "monthly", next_renewal_date: "2026-09-20", contract_start_date: "2025-09-20", contract_end_date: "2026-09-20", notice_period_days: 15, owner: "John DevOps", department: "Operations", payment_method: "card", seats_count: 40, monthly_equivalent_amount: 320.0, auto_generate_bill: false, is_active: true, charges_count: 1, last_charge_date: "2026-09-03", last_charge_amount: 320.0 },
  ];
  }

  if (!FinanceMockState.subscriptionCharges) {
    FinanceMockState.subscriptionCharges = [
    { id: 1, subscription_id: 1, subscription_name: "AWS Cloud Infrastructure", vendor_name: "Amazon Web Services", billing_date: "2026-09-01", amount: 4200.0, currency: "USD", linked_transaction_id: null, linked_bill_id: 1, variance_amount: 0.0, variance_reason: null, note: "Monthly cloud compute charges", created_at: "2026-09-01T08:00:00", attachments: [] },
    { id: 2, subscription_id: 2, subscription_name: "Slack Business+", vendor_name: "Slack Technologies", billing_date: "2026-09-03", amount: 320.0, currency: "USD", linked_transaction_id: null, linked_bill_id: 2, variance_amount: 0.0, variance_reason: null, note: "40 user licenses renewal", created_at: "2026-09-03T09:00:00", attachments: [] },
  ];
  }

  const FinanceSubscriptionsApi = {
// Subscriptions & Charges (Phase 6)
  async getSubscriptions(params) {
    if (_isMock()) {
      let list = [...(FinanceMockState.subscriptions || [])];
      const now = new Date();
      list = list.map((s) => {
        let noticeDeadline = null;
        let isRenewalImminent = false;
        if (s.next_renewal_date) {
          const renDate = new Date(s.next_renewal_date);
          const noticeDays = s.notice_period_days != null ? s.notice_period_days : 30;
          renDate.setDate(renDate.getDate() - noticeDays);
          noticeDeadline = renDate.toISOString().split("T")[0];
          isRenewalImminent = now >= renDate;
        }
        return {
          ...s,
          notice_deadline_date: noticeDeadline,
          is_renewal_imminent: isRenewalImminent,
        };
      });
      if (params && params.is_active !== undefined) {
        const act = String(params.is_active) === "true";
        list = list.filter((s) => s.is_active === act);
      }
      if (params && params.vendor_id) {
        list = list.filter((s) => s.vendor_id === parseInt(params.vendor_id, 10));
      }
      return list;
    }
    const q = new URLSearchParams(params || {}).toString();
    return apiRequest("GET", `/api/finance/subscriptions${q ? `?${q}` : ""}`);
  },
  async getSubscription(id) {
    if (_isMock()) {
      const s = (FinanceMockState.subscriptions || []).find((item) => item.id === parseInt(id, 10));
      if (!s) throw new Error("Subscription not found");
      return s;
    }
    return apiRequest("GET", `/api/finance/subscriptions/${id}`);
  },
  async createSubscription(payload) {
    if (_isMock()) {
      const vendor = (FinanceMockState.vendors || []).find((v) => v.id === parseInt(payload.vendor_id, 10));
      const amount = Number(payload.amount);
      const cycle = payload.billing_cycle || "monthly";
      const monthlyEquiv = cycle === "yearly" ? round(amount / 12, 2) : (cycle === "quarterly" ? round(amount / 3, 2) : amount);
      const newSub = {
        id: (FinanceMockState.subscriptions || []).length + 1,
        vendor_id: parseInt(payload.vendor_id, 10),
        vendor_name: vendor ? vendor.name : "Custom Vendor",
        name: payload.name,
        amount,
        currency: (payload.currency || "USD").toUpperCase(),
        billing_cycle: cycle,
        next_renewal_date: payload.next_renewal_date,
        contract_start_date: payload.contract_start_date || null,
        contract_end_date: payload.contract_end_date || null,
        notice_period_days: payload.notice_period_days !== undefined ? payload.notice_period_days : 30,
        owner: payload.owner || null,
        department: payload.department || null,
        payment_method: payload.payment_method || "card",
        payment_account_id: payload.payment_account_id || null,
        seats_count: payload.seats_count || null,
        monthly_equivalent_amount: monthlyEquiv,
        auto_generate_bill: Boolean(payload.auto_generate_bill),
        is_active: true,
        charges_count: 0,
        last_charge_date: null,
        last_charge_amount: null,
        created_at: new Date().toISOString(),
      };
      if (!FinanceMockState.subscriptions) FinanceMockState.subscriptions = [];
      FinanceMockState.subscriptions.push(newSub);
      return newSub;
    }
    return apiRequest("POST", "/api/finance/subscriptions", payload);
  },
  async updateSubscription(id, payload) {
    if (_isMock()) {
      const s = (FinanceMockState.subscriptions || []).find((item) => item.id === parseInt(id, 10));
      if (!s) throw new Error("Subscription not found");
      Object.assign(s, payload);
      if (payload.amount !== undefined || payload.billing_cycle !== undefined) {
        const amount = Number(s.amount);
        const cycle = s.billing_cycle || "monthly";
        s.monthly_equivalent_amount = cycle === "yearly" ? round(amount / 12, 2) : (cycle === "quarterly" ? round(amount / 3, 2) : amount);
      }
      return s;
    }
    return apiRequest("PATCH", `/api/finance/subscriptions/${id}`, payload);
  },
  async getSubscriptionCharges(subscriptionId) {
    if (_isMock()) {
      let list = [...(FinanceMockState.subscriptionCharges || [])];
      if (subscriptionId) {
        list = list.filter((c) => c.subscription_id === parseInt(subscriptionId, 10));
      }
      return list;
    }
    const url = subscriptionId ? `/api/finance/subscriptions/${subscriptionId}/charges` : "/api/finance/subscriptions";
    return apiRequest("GET", url);
  },
  async logSubscriptionCharge(subscriptionId, data) {
    if (_isMock()) {
      const sub = (FinanceMockState.subscriptions || []).find((s) => s.id === parseInt(subscriptionId, 10));
      const amount = Number(data instanceof FormData ? data.get("amount") : data.amount);
      const billingDate = (data instanceof FormData ? data.get("billing_date") : data.billing_date) || new Date().toISOString().split("T")[0];
      const currency = (data instanceof FormData ? data.get("currency") : data.currency) || (sub ? sub.currency : "USD");
      const note = (data instanceof FormData ? data.get("note") : data.note) || "";
      const bankId = (data instanceof FormData ? data.get("bank_account_id") : data.bank_account_id);
      const createBill = data instanceof FormData ? (data.get("create_bill") === "true" || data.get("create_bill") === "1") : Boolean(data.create_bill);
      const varianceReason = (data instanceof FormData ? data.get("variance_reason") : data.variance_reason) || null;

      const baseRate = sub ? Number(sub.amount || 0) : amount;
      const varianceAmount = round(amount - baseRate, 2);

      let linkedBillId = null;
      if (createBill || (sub && sub.auto_generate_bill)) {
        linkedBillId = (FinanceMockState.bills || []).length + 1;
        const newBill = {
          id: linkedBillId,
          vendor_id: sub ? sub.vendor_id : 1,
          vendor_name: sub ? sub.vendor_name : "Vendor",
          bill_number: `SUB-${sub ? sub.id : 1}-${billingDate.replace(/-/g, "")}`,
          category: "SaaS",
          department: sub ? sub.department || "Operations" : "Operations",
          legal_entity: "Voyance Health Inc",
          issue_date: billingDate,
          due_date: billingDate,
          status: "ready_to_pay",
          currency,
          subtotal: amount,
          tax_amount: 0.0,
          total: amount,
          amount_paid: 0.0,
          notes: `Recurring charge for subscription: ${sub ? sub.name : "Subscription"}`,
          created_at: new Date().toISOString(),
          created_by: "system",
          lines: [{ id: 1, bill_id: linkedBillId, description: `Subscription: ${sub ? sub.name : ""}`, quantity: 1, unit_price: amount, line_total: amount }],
        };
        if (!FinanceMockState.bills) FinanceMockState.bills = [];
        FinanceMockState.bills.unshift(newBill);
      }

      const attachments = [];
      if (data instanceof FormData && data.get("file")) {
        const fileObj = data.get("file");
        if (fileObj && fileObj.name) {
          attachments.push({
            id: Date.now(),
            file_name: fileObj.name,
            file_size: fileObj.size || 1024,
            mime_type: fileObj.type || "application/pdf",
            storage_ref: "/mock-storage/" + fileObj.name,
            uploaded_at: new Date().toISOString(),
          });
        }
      }

      const newCharge = {
        id: (FinanceMockState.subscriptionCharges || []).length + 1,
        subscription_id: parseInt(subscriptionId, 10),
        subscription_name: sub ? sub.name : "Subscription",
        vendor_name: sub ? sub.vendor_name : "Vendor",
        billing_date: billingDate,
        amount,
        currency,
        create_bill: Boolean(linkedBillId),
        linked_transaction_id: bankId ? Date.now() : null,
        linked_bill_id: linkedBillId,
        variance_amount: varianceAmount,
        variance_reason: varianceReason,
        note,
        created_at: new Date().toISOString(),
        attachments,
      };

      if (!FinanceMockState.subscriptionCharges) FinanceMockState.subscriptionCharges = [];
      FinanceMockState.subscriptionCharges.unshift(newCharge);

      if (sub) {
        sub.charges_count = (sub.charges_count || 0) + 1;
        sub.last_charge_date = billingDate;
        sub.last_charge_amount = amount;
      }

      if (bankId) {
        const bank = (FinanceMockState.accounts || []).find((a) => a.id === parseInt(bankId, 10));
        if (bank) bank.current_balance = round(bank.current_balance - amount, 2);
      }

      return newCharge;
    }

    if (data instanceof FormData) {
      let res;
      try {
        res = await fetch(`${API_BASE_URL}/api/finance/subscriptions/${subscriptionId}/charges`, {
          method: "POST",
          body: data,
          credentials: "include",
        });
      } catch (networkErr) {
        throw new Error("Network error - is the backend server running?");
      }
      if (res.status === 401) {
        if (typeof forceSessionExpiredLogout === "function") forceSessionExpiredLogout();
        throw new Error("Session expired. Please sign in again.");
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed with status ${res.status}`);
      }
      return res.json();
    }
    return apiRequest("POST", `/api/finance/subscriptions/${subscriptionId}/charges`, data);
  },

  // ==========================================
  };

  root.FinanceSubscriptionsApi = FinanceSubscriptionsApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceSubscriptionsApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceSubscriptionsApi;
  }
})(typeof window !== "undefined" ? window : globalThis);
