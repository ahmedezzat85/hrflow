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

  // Subscriptions v2 (X5, D-031): proof tracking and a paying account on the seeded subscriptions
  (FinanceMockState.subscriptions || []).forEach((s) => {
    if (s.proof_source === undefined) Object.assign(s, { billing_email: "billing@" + String(s.vendor_name || "vendor").toLowerCase().replace(/[^a-z]/g, "") + ".com", proof_source: "email_inbox", proof_expected: true });
    if (s.payment_account_id === undefined || s.payment_account_id === null) s.payment_account_id = 1;
  });

  if (!FinanceMockState.subscriptionCharges) {
    FinanceMockState.subscriptionCharges = [
    { id: 1, subscription_id: 1, subscription_name: "AWS Cloud Infrastructure", vendor_name: "Amazon Web Services", billing_date: "2026-09-01", amount: 4200.0, currency: "USD", linked_transaction_id: null, linked_bill_id: 1, variance_amount: 0.0, variance_reason: null, note: "Monthly cloud compute charges", created_at: "2026-09-01T08:00:00", attachments: [] },
    { id: 2, subscription_id: 2, subscription_name: "Slack Business+", vendor_name: "Slack Technologies", billing_date: "2026-09-03", amount: 320.0, currency: "USD", linked_transaction_id: null, linked_bill_id: 2, variance_amount: 0.0, variance_reason: null, note: "40 user licenses renewal", created_at: "2026-09-03T09:00:00", attachments: [] },
    { id: 3, subscription_id: 2, billing_date: "2026-10-03", amount: 320.0, expected_amount: 320.0, currency: "USD", linked_transaction_id: null, linked_bill_id: null, variance_amount: 0.0, variance_reason: null, note: "", created_at: "2026-10-03T00:00:00", attachments: [], status: "expected" },
  ];
  FinanceMockState.subscriptionCharges.forEach((c) => {
    if (!c.status) Object.assign(c, { status: "settled", proof_status: c.attachments && c.attachments.length ? "attached" : "pending" });
    if (!c.proof_status) c.proof_status = "pending";
  });
  }

  const _addMonths = (iso, months) => {
    const d = new Date(iso + "T00:00:00Z");
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, last));
    return d.toISOString().split("T")[0];
  };
  const _cycleMonths = { monthly: 1, quarterly: 3, yearly: 12 };
  const _accountOf = (sub) => (FinanceMockState.accounts || []).find((a) => a.id === sub.payment_account_id);
  const _chargeView = (c) => {
    const sub = (FinanceMockState.subscriptions || []).find((s) => s.id === c.subscription_id) || {};
    const acc = _accountOf(sub);
    return { ...c, subscription_name: sub.name, vendor_name: sub.vendor_name, proof_expected: !!sub.proof_expected, proof_source: sub.proof_source, payment_account_id: sub.payment_account_id || null, payment_account_name: acc ? acc.account_name : null, book_code: acc ? acc.book_code : "local" };
  };
  const _advanceRenewal = (c) => {
    const sub = (FinanceMockState.subscriptions || []).find((s) => s.id === c.subscription_id);
    if (!sub) return;
    const nxt = _addMonths(c.billing_date, _cycleMonths[sub.billing_cycle || "monthly"] || 1);
    if (nxt > sub.next_renewal_date) sub.next_renewal_date = nxt;
  };

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
        const acc = _accountOf(s);
        const charges = (FinanceMockState.subscriptionCharges || []).filter((c) => c.subscription_id === s.id);
        return {
          ...s,
          notice_deadline_date: noticeDeadline,
          is_renewal_imminent: isRenewalImminent,
          payment_account_name: acc ? acc.account_name : null,
          book_code: acc ? acc.book_code : "local",
          expected_charges_count: charges.filter((c) => c.status === "expected").length,
          proofs_missing_count: charges.filter((c) => s.proof_expected && c.proof_status === "pending" && c.status !== "skipped").length,
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
  // ---- Subscriptions v2 (X5, D-031)
  async getSubscriptionChargesV2(params = {}) {
    if (_isMock()) {
      let list = [...(FinanceMockState.subscriptionCharges || [])];
      if (params.status) list = list.filter((c) => c.status === params.status);
      if (params.subscription_id) list = list.filter((c) => c.subscription_id === parseInt(params.subscription_id, 10));
      if (params.proofs_missing === true || params.proofs_missing === "true") {
        list = list.filter((c) => c.proof_status === "pending" && c.status !== "skipped" && (FinanceMockState.subscriptions || []).some((s) => s.id === c.subscription_id && s.proof_expected));
      }
      let out = list.map(_chargeView);
      if (params.book && params.book !== "consolidated") out = out.filter((c) => c.book_code === params.book);
      return out.sort((a, b) => b.billing_date.localeCompare(a.billing_date) || b.id - a.id);
    }
    const qs = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ""))).toString();
    return apiRequest("GET", `/api/finance/subscriptions/charges${qs ? "?" + qs : ""}`);
  },
  async generateSubscriptionCharges() {
    if (_isMock()) return { created: 0, subscriptions_checked: (FinanceMockState.subscriptions || []).length };
    return apiRequest("POST", "/api/finance/subscriptions/generate-charges");
  },
  async settleSubscriptionCharge(id, payload) {
    if (_isMock()) {
      const c = (FinanceMockState.subscriptionCharges || []).find((x) => x.id === parseInt(id, 10));
      if (!c) throw new Error("Subscription charge not found");
      if (c.status !== "expected") throw new Error(`Only an expected charge can be settled or skipped; this one is ${c.status}.`);
      let actual;
      if (payload.mode === "link_ledger") {
        const tx = (FinanceMockState.transactions || []).find((t) => t.id === Number(payload.ledger_transaction_id));
        if (!tx) throw new Error("Ledger transaction not found");
        if (tx.direction !== "out") throw new Error("Only a payment (money out) can settle a subscription charge");
        if ((FinanceMockState.subscriptionCharges || []).some((x) => x.linked_transaction_id === tx.id)) throw new Error("This payment is already linked to another subscription charge");
        actual = Number(tx.amount);
        c.linked_transaction_id = tx.id;
      } else if (payload.mode === "already_paid_bill") {
        const sub = (FinanceMockState.subscriptions || []).find((s) => s.id === c.subscription_id);
        const accId = payload.bank_account_id || (sub && sub.payment_account_id);
        const acc = (FinanceMockState.accounts || []).find((a) => a.id === Number(accId));
        if (!acc) throw new Error("bank_account_id is required: the subscription has no paying account");
        actual = Number(payload.amount != null ? payload.amount : (c.expected_amount != null ? c.expected_amount : c.amount));
        if (Number(acc.current_balance || 0) < actual) throw new Error(`Account '${acc.account_name}' balance is below the payment.`);
        acc.current_balance = round(Number(acc.current_balance) - actual, 2);
        c.linked_bill_id = Math.max(0, ...(FinanceMockState.bills || []).map((b) => b.id)) + 1;
      } else {
        throw new Error("mode must be link_ledger or already_paid_bill");
      }
      const expected = c.expected_amount != null ? c.expected_amount : c.amount;
      Object.assign(c, { amount: actual, variance_amount: round(actual - expected, 2), variance_reason: payload.variance_reason || null, status: "settled", settled_at: new Date().toISOString() });
      _advanceRenewal(c);
      return _chargeView(c);
    }
    return apiRequest("POST", `/api/finance/subscriptions/charges/${id}/settle`, payload);
  },
  async skipSubscriptionCharge(id, payload) {
    if (_isMock()) {
      const c = (FinanceMockState.subscriptionCharges || []).find((x) => x.id === parseInt(id, 10));
      if (!c) throw new Error("Subscription charge not found");
      if (c.status !== "expected") throw new Error(`Only an expected charge can be settled or skipped; this one is ${c.status}.`);
      if (!String(payload.reason || "").trim()) throw new Error("A reason is required to skip a charge");
      Object.assign(c, { status: "skipped", skipped_reason: payload.reason.trim() });
      _advanceRenewal(c);
      return _chargeView(c);
    }
    return apiRequest("POST", `/api/finance/subscriptions/charges/${id}/skip`, payload);
  },
  async setSubscriptionChargeProof(id, payload) {
    if (_isMock()) {
      const c = (FinanceMockState.subscriptionCharges || []).find((x) => x.id === parseInt(id, 10));
      if (!c) throw new Error("Subscription charge not found");
      if (payload.proof_status === "unavailable" && !String(payload.proof_note || "").trim()) throw new Error("A reason is required when the proof is unavailable");
      if (payload.proof_status === "attached" && !(c.attachments || []).length) throw new Error("Upload the proof file to mark it attached");
      Object.assign(c, { proof_status: payload.proof_status, proof_note: payload.proof_note || null });
      return _chargeView(c);
    }
    return apiRequest("PATCH", `/api/finance/subscriptions/charges/${id}/proof`, payload);
  },
  async uploadSubscriptionChargeProof(id, file) {
    if (_isMock()) {
      const c = (FinanceMockState.subscriptionCharges || []).find((x) => x.id === parseInt(id, 10));
      if (!c) throw new Error("Subscription charge not found");
      c.attachments = c.attachments || [];
      c.attachments.push({ id: Date.now(), file_name: (file && file.name) || "proof.pdf", file_size: (file && file.size) || 0, mime_type: (file && file.type) || "application/pdf" });
      Object.assign(c, { proof_status: "attached", proof_note: null });
      return _chargeView(c);
    }
    const formData = new FormData();
    formData.append("file", file);
    return apiRequest("POST", `/api/finance/subscriptions/charges/${id}/proof-file`, formData);
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
        billing_email: payload.billing_email || null,
        proof_source: payload.proof_source || "none",
        proof_expected: payload.proof_expected !== false,
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
          status: "approved",
          approval_status: "auto",
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
