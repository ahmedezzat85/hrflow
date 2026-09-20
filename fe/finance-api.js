/**
 * fe/finance-api.js
 *
 * Aggregated Finance API client bundled from domain modules in fe/api/finance/:
 *   - fe/api/finance/core.js
 *   - fe/api/finance/invoices-api.js
 *   - fe/api/finance/bills-api.js
 *   - fe/api/finance/accounts-api.js
 *   - fe/api/finance/cheques-api.js
 *   - fe/api/finance/subscriptions-api.js
 *   - fe/api/finance/statements-api.js
 *   - fe/api/finance/reports-api.js
 *   - fe/api/finance/dashboard-api.js
 *   - fe/api/finance/payroll-api.js
 *   - fe/api/finance/statutory-api.js
 *
 * DO NOT EDIT THIS BUNDLED FILE DIRECTLY.
 * Make changes inside the corresponding domain file in fe/api/finance/.
 */

/**
 * fe/api/finance/core.js
 * Finance API - Core configuration, shared helpers, base mock state and observability.
 */
(function (root) {
  const _isMock = () => typeof window !== "undefined" && window.location && window.location.search.includes("mock=");
  root._isMock = _isMock;

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


/**
 * fe/api/finance/invoices-api.js
 * Finance API - Invoices & Receivables domain client and mock handlers.
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

  if (!FinanceMockState.customers) {
    FinanceMockState.customers = [
    { id: 1, name: "Apex Health Partners", legal_name: "Apex Healthcare Systems LLC", contact_email: "billing@apexhealth.com", contact_phone: "+1 555-0120", tax_id: "US-88992211", billing_address: "100 Medical Center Blvd", country: "United States", default_currency: "USD", payment_terms_days: 30, owner: "Sarah Connor", notes: "Enterprise client", is_active: true },
    { id: 2, name: "BioCare Diagnostics", legal_name: "BioCare International Inc", contact_email: "ap@biocare.org", contact_phone: "+1 555-0144", tax_id: "US-33441199", billing_address: "450 Lab Parkway", country: "United States", default_currency: "USD", payment_terms_days: 30, owner: "Sarah Connor", notes: "Monthly billing", is_active: true },
    { id: 3, name: "CareFirst Health", legal_name: "CareFirst Regional Health Corp", contact_email: "ap@carefirst.org", contact_phone: "+1 555-0199", tax_id: "US-77889900", billing_address: "770 Care Ave", country: "United States", default_currency: "USD", payment_terms_days: 15, owner: "Sarah Connor", notes: "Overdue account", is_active: true },
    { id: 4, name: "Delta Medical", legal_name: "Delta Medical Equipment Ltd", contact_email: "finance@deltamed.com", contact_phone: "+1 555-0177", tax_id: "US-55443322", billing_address: "12 Nile St, Maadi", country: "Egypt", default_currency: "USD", payment_terms_days: 45, owner: "Sarah Connor", notes: "Consulting client", is_active: true },
    { id: 5, name: "Echo Clinics", legal_name: "Echo Clinics Network SAE", contact_email: "billing@echoclinics.com", contact_phone: "+1 555-0155", tax_id: "EG-11223344", billing_address: "5 Tahrir Sq, Cairo", country: "Egypt", default_currency: "USD", payment_terms_days: 30, owner: "Sarah Connor", notes: "Clinical partner", is_active: true },
    { id: 6, name: "Frontier Labs", legal_name: "Frontier Diagnostics Research", contact_email: "info@frontierlabs.com", contact_phone: "+1 555-0111", tax_id: "US-99887766", billing_address: "88 Science Park", country: "United States", default_currency: "USD", payment_terms_days: 60, owner: "Sarah Connor", notes: "Research lab", is_active: true },
  ];
  }

  if (!FinanceMockState.invoices) {
    FinanceMockState.invoices = [
    { id: 1, customer_id: 1, customer_name: "Apex Health Partners", invoice_number: "INV-2026-001", issue_date: "2026-09-01", due_date: "2026-09-30", status: "sent", currency: "USD", expected_bank_account_id: 1, expected_bank_account_name: "Voyance Operating USD", revenue_channel: "overseas_usd", has_bank_discrepancy: false, subtotal: 12500.0, tax_amount: 0.0, total: 12500.0, amount_paid: 0.0, balance: 12500.0, is_overdue: false, days_overdue: 0, next_action: "Awaiting Due Date / Payment", notes: "Q3 PACS Integration Services", created_at: "2026-09-01T08:00:00", lines: [{ id: 1, invoice_id: 1, description: "PACS Integration", quantity: 1, unit_price: 12500.0, line_total: 12500.0 }] },
    { id: 2, customer_id: 2, customer_name: "BioCare Diagnostics", invoice_number: "INV-2026-002", issue_date: "2026-09-05", due_date: "2026-10-05", status: "draft", currency: "USD", expected_bank_account_id: 2, expected_bank_account_name: "Voyance Treasury Reserve", revenue_channel: "intercompany_transfer_us", has_bank_discrepancy: false, subtotal: 8400.0, tax_amount: 0.0, total: 8400.0, amount_paid: 0.0, balance: 8400.0, is_overdue: false, days_overdue: 0, next_action: "Review & Send to Customer", notes: "Monthly DICOM utility SaaS", created_at: "2026-09-05T09:00:00", lines: [{ id: 2, invoice_id: 2, description: "DICOM SaaS", quantity: 6, unit_price: 1400.0, line_total: 8400.0 }] },
    { id: 3, customer_id: 3, customer_name: "CareFirst Health", invoice_number: "INV-2026-003", issue_date: "2026-08-01", due_date: "2026-08-15", status: "sent", currency: "USD", expected_bank_account_id: 1, expected_bank_account_name: "Voyance Operating USD", revenue_channel: "overseas_usd", has_bank_discrepancy: false, subtotal: 10000.0, tax_amount: 0.0, total: 10000.0, amount_paid: 0.0, balance: 10000.0, is_overdue: true, days_overdue: 29, next_action: "Send Payment Reminder (29d overdue)", notes: "Prior cycle maintenance", created_at: "2026-08-01T08:00:00", lines: [{ id: 3, invoice_id: 3, description: "System Maintenance", quantity: 1, unit_price: 10000.0, line_total: 10000.0 }] },
    { id: 4, customer_id: 4, customer_name: "Delta Medical", invoice_number: "INV-2026-004", issue_date: "2026-09-02", due_date: "2026-09-25", status: "sent", currency: "USD", expected_bank_account_id: 1, expected_bank_account_name: "Voyance Operating USD", revenue_channel: "intercompany_transfer_us", has_bank_discrepancy: false, subtotal: 11000.0, tax_amount: 0.0, total: 11000.0, amount_paid: 4000.0, balance: 7000.0, is_overdue: false, days_overdue: 0, next_action: "Collect Remaining Balance", notes: "Consulting Retainer Q3", created_at: "2026-09-02T09:00:00", lines: [{ id: 4, invoice_id: 4, description: "Consulting Hours", quantity: 10, unit_price: 1100.0, line_total: 11000.0 }] },
    { id: 5, customer_id: 5, customer_name: "Echo Clinics", invoice_number: "INV-2026-005", issue_date: "2026-08-10", due_date: "2026-09-10", status: "paid", currency: "USD", expected_bank_account_id: 1, expected_bank_account_name: "Voyance Operating USD", revenue_channel: "overseas_usd", has_bank_discrepancy: false, subtotal: 20000.0, tax_amount: 0.0, total: 20000.0, amount_paid: 20000.0, balance: 0.0, is_overdue: false, days_overdue: 0, next_action: "Completed (Paid in Full)", notes: "Setup & Onboarding", created_at: "2026-08-10T10:00:00", lines: [{ id: 5, invoice_id: 5, description: "Setup Fee", quantity: 1, unit_price: 20000.0, line_total: 20000.0 }] },
    { id: 6, customer_id: 6, customer_name: "Frontier Labs", invoice_number: "INV-2026-006", issue_date: "2026-08-20", due_date: "2026-09-20", status: "void", currency: "USD", expected_bank_account_id: 2, expected_bank_account_name: "Voyance Treasury Reserve", revenue_channel: "other", has_bank_discrepancy: false, subtotal: 25000.0, tax_amount: 0.0, total: 25000.0, amount_paid: 0.0, balance: 0.0, is_overdue: false, days_overdue: 0, next_action: "Archived (Voided)", notes: "Canceled service request", created_at: "2026-08-20T11:00:00", lines: [{ id: 6, invoice_id: 6, description: "Canceled item", quantity: 1, unit_price: 25000.0, line_total: 25000.0 }] },
  ];
  }

  if (!FinanceMockState.payments) {
    FinanceMockState.payments = [];
  }

  const FinanceInvoicesApi = {
// Customers
  async getCustomers(params) {
    if (_isMock()) {
      let list = [...(FinanceMockState.customers || [])];
      if (params && params.is_active !== undefined) {
        list = list.filter((c) => c.is_active === params.is_active);
      }
      if (params && params.search) {
        const s = params.search.toLowerCase();
        list = list.filter((c) => (c.name && c.name.toLowerCase().includes(s)) || (c.contact_email && c.contact_email.toLowerCase().includes(s)));
      }
      return list;
    }
    let url = "/api/finance/customers";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },

  // Invoices
  async getInvoices(params) {
    if (_isMock()) {
      let list = [...FinanceMockState.invoices];
      if (params && params.status) {
        const st = params.status.toLowerCase().trim();
        if (st === "open") {
          list = list.filter((i) => i.status !== "paid" && i.status !== "void");
        } else if (st === "awaiting_payment") {
          list = list.filter((i) => (i.status === "sent" || i.status === "awaiting_payment") && !i.is_overdue && (i.balance === undefined || i.balance > 0));
        } else if (st === "overdue") {
          list = list.filter((i) => i.status === "overdue" || i.is_overdue);
        } else if (st !== "all") {
          list = list.filter((i) => i.status === st);
        }
      }
      if (params && params.customer_id) list = list.filter((i) => i.customer_id === parseInt(params.customer_id, 10));
      if (params && params.search) {
        const s = params.search.toLowerCase();
        list = list.filter((i) => i.invoice_number.toLowerCase().includes(s) || (i.customer_name || "").toLowerCase().includes(s));
      }
      return list;
    }
    let url = "/api/finance/invoices";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async getInvoice(id) {
    if (_isMock()) {
      const inv = FinanceMockState.invoices.find((i) => i.id === parseInt(id, 10));
      if (!inv) throw new Error("Invoice not found");
      return inv;
    }
    return apiRequest("GET", `/api/finance/invoices/${id}`);
  },
  async createInvoice(payload) {
    if (_isMock()) {
      const customers = FinanceMockState.customers;
      const cust = customers.find((c) => c.id === parseInt(payload.customer_id, 10));
      const bank = payload.expected_bank_account_id ? (FinanceMockState.accounts || []).find((b) => b.id === parseInt(payload.expected_bank_account_id, 10)) : null;
      const lines = (payload.lines || []).map((ln, i) => ({
        id: Date.now() + i, invoice_id: FinanceMockState.invoices.length + 1,
        ...ln, line_total: ln.line_total || (ln.quantity * ln.unit_price),
      }));
      const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
      const newInv = {
        id: FinanceMockState.invoices.length + 1,
        ...payload,
        customer_name: cust ? cust.name : null,
        expected_bank_account_name: bank ? bank.account_name : null,
        has_bank_discrepancy: false,
        subtotal, tax_amount: 0, total: subtotal,
        created_at: new Date().toISOString(),
        lines,
      };
      FinanceMockState.invoices.push(newInv);
      return newInv;
    }
    return apiRequest("POST", "/api/finance/invoices", payload);
  },
  async updateInvoice(id, payload) {
    if (_isMock()) {
      const inv = FinanceMockState.invoices.find((i) => i.id === parseInt(id, 10));
      if (!inv) throw new Error("Invoice not found");
      Object.assign(inv, payload);
      if (payload.expected_bank_account_id !== undefined) {
        const bank = payload.expected_bank_account_id ? (FinanceMockState.accounts || []).find((b) => b.id === parseInt(payload.expected_bank_account_id, 10)) : null;
        inv.expected_bank_account_name = bank ? bank.account_name : null;
      }
      if (payload.lines) {
        inv.subtotal = payload.lines.reduce((s, l) => s + (l.line_total || l.quantity * l.unit_price), 0);
        inv.total = inv.subtotal;
      }
      return inv;
    }
    return apiRequest("PUT", `/api/finance/invoices/${id}`, payload);
  },
  async sendInvoice(id) {
    if (_isMock()) {
      const inv = FinanceMockState.invoices.find((i) => i.id === parseInt(id, 10));
      if (!inv) throw new Error("Invoice not found");
      inv.status = "sent";
      return inv;
    }
    return apiRequest("POST", `/api/finance/invoices/${id}/send`);
  },
  async voidInvoice(id, reason = null) {
    if (_isMock()) {
      const inv = FinanceMockState.invoices.find((i) => i.id === parseInt(id, 10));
      if (!inv) throw new Error("Invoice not found");
      inv.status = "void";
      if (reason) inv.notes = `${inv.notes || ""}\n[Void reason: ${reason}]`.trim();
      return inv;
    }
    const q = reason ? `?reason=${encodeURIComponent(reason)}` : "";
    return apiRequest("DELETE", `/api/finance/invoices/${id}${q}`, null, true, _getIdempHeaders());
  },
  async getInvoicePayments(invoiceId) {
    if (_isMock()) return FinanceMockState.payments.filter((p) => p.related_invoice_id === parseInt(invoiceId, 10));
    return apiRequest("GET", `/api/finance/invoices/${invoiceId}/payments`);
  },
  async recordInvoicePayment(invoiceId, payload) {
    if (_isMock()) {
      const inv = FinanceMockState.invoices.find((i) => i.id === parseInt(invoiceId, 10));
      let account_discrepancy = false;
      let exp_id = null;
      let exp_name = null;
      const bankId = parseInt(payload.bank_account_id, 10);

      // Duplicate reference check
      if (payload.reference && payload.reference.trim()) {
        const refTrim = payload.reference.trim();
        const dup = FinanceMockState.payments.find((p) => p.reference === refTrim && !p.is_reversed);
        if (dup) throw new Error(`Duplicate payment reference '${refTrim}' detected. Please review.`);
      }

      // Overpayment check
      if (inv) {
        const currentPaid = FinanceMockState.payments
          .filter((p) => p.related_invoice_id === inv.id && !p.is_reversed)
          .reduce((s, p) => s + (p.amount || 0), 0);
        const remaining = Math.max(0, (inv.total || 0) - currentPaid);
        if (payload.amount > remaining + 0.001) {
          throw new Error(`Payment amount (${payload.amount}) exceeds remaining balance (${remaining}). Overpayment is prevented.`);
        }
      }

      if (inv && inv.expected_bank_account_id) {
        exp_id = inv.expected_bank_account_id;
        exp_name = inv.expected_bank_account_name;
        if (bankId && bankId !== exp_id) {
          account_discrepancy = true;
          inv.has_bank_discrepancy = true;
        }
      }
      const bank = (FinanceMockState.accounts || []).find((b) => b.id === bankId);
      const newPayment = {
        id: FinanceMockState.payments.length + 1,
        ...payload,
        bank_account_id: bankId,
        bank_account_name: bank ? bank.account_name : null,
        account_discrepancy,
        expected_bank_account_id: exp_id,
        expected_bank_account_name: exp_name,
        related_invoice_id: parseInt(invoiceId, 10),
        is_reversed: false,
        created_at: new Date().toISOString(),
      };
      FinanceMockState.payments.push(newPayment);
      if (inv) {
        const totalPaid = FinanceMockState.payments
          .filter((p) => p.related_invoice_id === inv.id && !p.is_reversed)
          .reduce((s, p) => s + (p.amount || 0), 0);
        inv.amount_paid = totalPaid;
        inv.balance = Math.max(0, inv.total - totalPaid);
        if (totalPaid >= inv.total) {
          inv.status = "paid";
        }
      }
      return newPayment;
    }
    return apiRequest("POST", `/api/finance/invoices/${invoiceId}/payments`, payload);
  },
  async reverseInvoicePayment(invoiceId, paymentId, reason = null) {
    if (_isMock()) {
      const payment = FinanceMockState.payments.find((p) => p.id === parseInt(paymentId, 10));
      if (!payment) throw new Error("Payment not found");
      if (payment.is_reversed) throw new Error("Payment already reversed");
      payment.is_reversed = true;
      const inv = FinanceMockState.invoices.find((i) => i.id === parseInt(invoiceId, 10));
      if (inv) {
        const totalPaid = FinanceMockState.payments
          .filter((p) => p.related_invoice_id === inv.id && !p.is_reversed)
          .reduce((s, p) => s + (p.amount || 0), 0);
        inv.amount_paid = totalPaid;
        inv.balance = Math.max(0, inv.total - totalPaid);
        if (inv.status === "paid" && totalPaid < inv.total) {
          inv.status = "sent";
        }
      }
      return payment;
    }
    return apiRequest("POST", `/api/finance/invoices/${invoiceId}/payments/${paymentId}/reverse${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`);
  },
  async sendInvoiceReminder(invoiceId) {
    if (_isMock()) {
      const inv = FinanceMockState.invoices.find((i) => i.id === parseInt(invoiceId, 10));
      if (!inv) throw new Error("Invoice not found");
      if (inv.status === "paid" || inv.status === "void") {
        throw new Error(`Cannot send reminder for an invoice in '${inv.status}' status`);
      }
      const cust = (FinanceMockState.customers || []).find((c) => c.id === inv.customer_id);
      const email = (cust && cust.contact_email) || inv.customer_email || "";
      if (!email.trim()) {
        throw new Error("Customer has no contact email address on file. Please add an email address to the customer record before sending reminders.");
      }
      return {
        success: true,
        message: `Payment reminder successfully dispatched to ${email.trim()}`,
        recipient: email.trim(),
        invoice_number: inv.invoice_number,
      };
    }
    return apiRequest("POST", `/api/finance/invoices/${invoiceId}/remind`);
  },

// Customers
  async getCustomers(params) {
    if (_isMock()) {
      let list = [...FinanceMockState.customers];
      if (params && params.is_active !== undefined) {
        list = list.filter((c) => c.is_active === (params.is_active === "true" || params.is_active === true));
      }
      return list;
    }
    let url = "/api/finance/customers";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async getCustomer(id) {
    if (_isMock()) {
      const cust = FinanceMockState.customers.find((c) => c.id === parseInt(id, 10));
      if (!cust) throw new Error("Customer not found");
      return cust;
    }
    return apiRequest("GET", `/api/finance/customers/${id}`);
  },
  async createCustomer(payload) {
    if (_isMock()) {
      const newCust = {
        id: FinanceMockState.customers.length + 1,
        ...payload,
        is_active: true,
      };
      FinanceMockState.customers.push(newCust);
      return newCust;
    }
    return apiRequest("POST", "/api/finance/customers", payload);
  },
  async updateCustomer(id, payload) {
    if (_isMock()) {
      const cust = FinanceMockState.customers.find((c) => c.id === parseInt(id, 10));
      if (!cust) throw new Error("Customer not found");
      Object.assign(cust, payload);
      return cust;
    }
    return apiRequest("PUT", `/api/finance/customers/${id}`, payload);
  },
  async deleteCustomer(id) {
    if (_isMock()) {
      const cust = FinanceMockState.customers.find((c) => c.id === parseInt(id, 10));
      if (!cust) throw new Error("Customer not found");
      cust.is_active = false;
      return cust;
    }
    return apiRequest("DELETE", `/api/finance/customers/${id}`);
  },
  async checkDuplicateCustomers(payload) {
    if (_isMock()) {
      const cleanStr = (v) => {
        if (!v) return "";
        let s = String(v).toLowerCase().trim();
        const sfxs = [/\binc\b/g, /\bllc\b/g, /\bcorp\b/g, /\bcorporation\b/g, /\bltd\b/g, /\blimited\b/g, /\bco\b/g, /\bpartners\b/g];
        sfxs.forEach((rx) => { s = s.replace(rx, ""); });
        return s.replace(/[^a-z0-9]/g, "");
      };
      const cleanTax = (v) => (!v ? "" : String(v).toLowerCase().replace(/[^a-z0-9]/g, ""));
      const normName = cleanStr(payload.name);
      const normLegal = cleanStr(payload.legal_name);
      const normTax = cleanTax(payload.tax_id);
      const normEmail = (payload.contact_email || "").toLowerCase().trim();

      const candidates = [];
      const seen = new Set();
      for (const c of FinanceMockState.customers) {
        if (payload.exclude_id && c.id === parseInt(payload.exclude_id, 10)) continue;
        const cName = cleanStr(c.name);
        const cLegal = cleanStr(c.legal_name);
        const cTax = cleanTax(c.tax_id);
        const cEmail = (c.contact_email || "").toLowerCase().trim();

        let matched_field = null;
        if (normName && (normName === cName || (cLegal && normName === cLegal))) matched_field = "name";
        else if (normLegal && ((cLegal && normLegal === cLegal) || normLegal === cName)) matched_field = "legal_name";
        else if (normTax && cTax && normTax === cTax) matched_field = "tax_id";
        else if (normEmail && cEmail && normEmail === cEmail) matched_field = "contact_email";

        if (matched_field && !seen.has(c.id)) {
          seen.add(c.id);
          candidates.push({
            id: c.id,
            name: c.name,
            legal_name: c.legal_name,
            tax_id: c.tax_id,
            contact_email: c.contact_email,
            matched_field,
            is_active: c.is_active,
          });
        }
      }
      return { candidates };
    }
    return apiRequest("POST", "/api/finance/customers/check-duplicate", payload);
  },
  async getCustomer360(id) {
    if (_isMock()) {
      const cust = FinanceMockState.customers.find((c) => c.id === parseInt(id, 10));
      if (!cust) throw new Error("Customer not found");

      const invoices = (FinanceMockState.invoices || []).filter((i) => i.customer_id === cust.id);
      let total_invoiced = 0.0;
      let total_paid = 0.0;
      let outstanding_balance = 0.0;
      let overdue_balance = 0.0;
      let open_invoices_count = 0;
      let overdue_invoices_count = 0;
      const today = new Date().toISOString().slice(0, 10);
      const daysToPay = [];
      const invList = [];
      const timeline = [];

      for (const inv of invoices) {
        const isVoid = inv.status === "void";
        const payments = (FinanceMockState.payments || []).filter((p) => p.related_invoice_id === inv.id && !p.is_reversed);
        const paid = payments.reduce((s, p) => s + (p.amount || 0), 0);
        const bal = isVoid ? 0 : Math.max(0, (inv.total || 0) - paid);
        const isOverdue = !isVoid && bal > 0.001 && inv.due_date && inv.due_date < today;

        if (!isVoid) {
          total_invoiced += (inv.total || 0);
          total_paid += paid;
          outstanding_balance += bal;
          if (isOverdue) {
            overdue_balance += bal;
            overdue_invoices_count++;
          }
          if (bal > 0.001) open_invoices_count++;
          if (bal <= 0.001 && paid > 0 && payments.length > 0) {
            const lastP = payments[payments.length - 1];
            if (lastP.payment_date && inv.issue_date) {
              const diff = Math.round((new Date(lastP.payment_date) - new Date(inv.issue_date)) / (86400000));
              if (diff >= 0) daysToPay.push(diff);
            }
          }
        }

        const derivedStatus = isVoid ? "void" : (bal <= 0.001 && inv.total > 0 ? "paid" : (isOverdue ? "overdue" : (inv.status || "sent")));
        invList.push({
          id: inv.id,
          invoice_number: inv.invoice_number,
          issue_date: inv.issue_date,
          due_date: inv.due_date,
          currency: inv.currency || "USD",
          total: inv.total,
          amount_paid: paid,
          balance: bal,
          status: derivedStatus,
          is_overdue: isOverdue,
        });

        timeline.push({
          event_type: "invoice_created",
          date: inv.issue_date || inv.created_at,
          description: `Invoice ${inv.invoice_number} created for ${inv.currency || "USD"} ${(inv.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
          invoice_id: inv.id,
        });

        for (const p of payments) {
          timeline.push({
            event_type: "payment_received",
            date: p.payment_date || p.created_at,
            description: `Payment of ${p.currency || "USD"} ${(p.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} recorded (Ref: ${p.reference || "N/A"})`,
            invoice_id: inv.id,
          });
        }
      }

      timeline.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      const avgDays = daysToPay.length > 0 ? Math.round((daysToPay.reduce((s, d) => s + d, 0) / daysToPay.length) * 10) / 10 : null;

      return {
        customer: cust,
        total_invoiced,
        total_paid,
        outstanding_balance,
        overdue_balance,
        open_invoices_count,
        overdue_invoices_count,
        average_days_to_pay: avgDays,
        invoices: invList,
        timeline,
      };
    }
    return apiRequest("GET", `/api/finance/customers/${id}/360`);
  }
  };

  root.FinanceInvoicesApi = FinanceInvoicesApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceInvoicesApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceInvoicesApi;
  }
})(typeof window !== "undefined" ? window : globalThis);


/**
 * fe/api/finance/bills-api.js
 * Finance API - Bills & Payables domain client and mock handlers.
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

  if (!FinanceMockState.vendors) {
    FinanceMockState.vendors = [
    { id: 1, name: "Amazon Web Services", legal_name: "Amazon Web Services Inc", category: "Infrastructure", default_category_id: 8, contact_name: "AWS Accounts Team", contact_email: "aws-receivables@amazon.com", contact_phone: "+1 800-555-0199", tax_id: "VAT-1294819", remit_address: "410 Terry Ave N, Seattle WA", country: "United States", payment_terms_days: 30, default_currency: "USD", default_department: "Engineering", tax_treatment: "standard", onboarding_status: "active", notes: "Hosting & compute", is_active: true },
    { id: 2, name: "Slack Technologies", legal_name: "Slack Technologies LLC", category: "SaaS", default_category_id: 9, contact_name: "Sales Billing", contact_email: "billing@slack.com", contact_phone: "+1 800-555-0188", tax_id: "VAT-9988112", remit_address: "500 Howard St, San Francisco CA", country: "United States", payment_terms_days: 15, default_currency: "USD", default_department: "Operations", tax_treatment: "standard", onboarding_status: "active", notes: "Team communication", is_active: true },
    { id: 3, name: "Google Workspace", legal_name: "Google LLC", category: "Software", default_category_id: null, contact_name: "Google Cloud Sales", contact_email: "billing@google.com", contact_phone: "+1 800-555-0100", tax_id: "VAT-5544332", remit_address: "1600 Amphitheatre Pkwy, Mountain View CA", country: "United States", payment_terms_days: 30, default_currency: "USD", default_department: "Engineering", tax_treatment: "standard", onboarding_status: "active", notes: "Productivity suite", is_active: true },
  ];
  }

  if (!FinanceMockState.vendorPaymentInstructions) {
    FinanceMockState.vendorPaymentInstructions = [
    { id: 1, vendor_id: 1, payment_method: "bank_transfer", bank_name: "JPMorgan Chase Bank", account_holder_name: "Amazon Web Services Inc", account_number: "98765432104821", routing_number: "021000021", swift_code: "CHASUS33", iban: "US99CHAS021000021987654321", verification_status: "verified", verified_by: "admin@hrflow.test", verified_at: "2026-09-01T10:00:00", is_active: true, effective_date: "2026-01-01", notes: "Direct ACH Wire Instructions" },
    { id: 2, vendor_id: 2, payment_method: "bank_transfer", bank_name: "Silicon Valley Bank", account_holder_name: "Slack Technologies LLC", account_number: "12345678901122", routing_number: "121140399", swift_code: "SVBKUS6S", iban: "US44SVBK121140399123456789", verification_status: "unverified", verified_by: null, verified_at: null, is_active: true, effective_date: "2026-01-01", notes: "Pending vendor bank verification" },
  ];
  }

  if (!FinanceMockState.bills) {
    FinanceMockState.bills = [
    { id: 1, vendor_id: 1, vendor_name: "Amazon Web Services", bill_number: "BILL-2026-001", category_id: 8, category: "Infrastructure", department: "Engineering", legal_entity: "Voyance Health Inc", issue_date: "2026-09-01", due_date: "2026-09-30", status: "ready_to_pay", currency: "USD", subtotal: 4200.0, tax_amount: 0.0, total: 4200.0, amount_paid: 0.0, requires_approval: false, capture_source: "manual", extraction_confidence: 1.0, is_reviewed: true, notes: "September cloud hosting", created_at: "2026-09-01T08:00:00", created_by: "ap@voyance.health", lines: [{ id: 1, bill_id: 1, description: "EC2 + S3 usage", quantity: 1, unit_price: 4200.0, line_total: 4200.0 }] },
    { id: 2, vendor_id: 2, vendor_name: "Slack Technologies", bill_number: "BILL-2026-002", category_id: 9, category: "SaaS", department: "Operations", legal_entity: "Voyance Health Inc", issue_date: "2026-09-03", due_date: "2026-09-18", status: "paid", currency: "USD", subtotal: 320.0, tax_amount: 0.0, total: 320.0, amount_paid: 320.0, requires_approval: false, capture_source: "manual", extraction_confidence: 1.0, is_reviewed: true, notes: "Team plan renewal", created_at: "2026-09-03T09:00:00", created_by: "ap@voyance.health", lines: [{ id: 2, bill_id: 2, description: "Slack Business+ (40 seats)", quantity: 40, unit_price: 8.0, line_total: 320.0 }] },
    { id: 3, vendor_id: 1, vendor_name: "Amazon Web Services", bill_number: "BILL-2026-003", category_id: null, category: "", department: "", legal_entity: "Voyance Health Inc", issue_date: "2026-09-08", due_date: "2026-10-08", status: "inbox", currency: "USD", subtotal: 1850.0, tax_amount: 0.0, total: 1850.0, amount_paid: 0.0, requires_approval: false, capture_source: "upload", extraction_confidence: 0.82, missing_fields: "category,department", is_reviewed: false, file_fingerprint: "sha256-aws-oct", attachment_name: "aws_september_invoice.pdf", attachment_url: "/api/finance/bills/3/attachment", notes: "Scanned PDF invoice awaiting coding", created_at: "2026-09-08T11:00:00", created_by: "ap@voyance.health", lines: [{ id: 3, bill_id: 3, description: "Database Aurora Serverless", quantity: 1, unit_price: 1850.0, line_total: 1850.0 }] },
    { id: 4, vendor_id: 2, vendor_name: "Slack Technologies", bill_number: "BILL-2026-004", category_id: 9, category: "SaaS", department: "Engineering", legal_entity: "Voyance Health Inc", issue_date: "2026-09-05", due_date: "2026-09-25", status: "needs_coding", currency: "USD", subtotal: 750.0, tax_amount: 0.0, total: 750.0, amount_paid: 0.0, requires_approval: false, capture_source: "upload", extraction_confidence: 0.94, missing_fields: "cost_center", is_reviewed: false, notes: "Needs cost center assignment", created_at: "2026-09-05T09:30:00", created_by: "ap@voyance.health", lines: [{ id: 4, bill_id: 4, description: "Slack Enterprise Grid Add-on", quantity: 1, unit_price: 750.0, line_total: 750.0 }] },
    { id: 5, vendor_id: 1, vendor_name: "Amazon Web Services", bill_number: "BILL-2026-005", category_id: 8, category: "Infrastructure", department: "Engineering", legal_entity: "Voyance Health Inc", issue_date: "2026-09-09", due_date: "2026-10-09", status: "needs_approval", currency: "USD", subtotal: 8900.0, tax_amount: 0.0, total: 8900.0, amount_paid: 0.0, requires_approval: true, approval_status: "pending", capture_source: "manual", extraction_confidence: 1.0, is_reviewed: true, notes: "Requires VP approval for >$5k", created_at: "2026-09-09T14:00:00", created_by: "creator@voyance.health", lines: [{ id: 5, bill_id: 5, description: "Direct Connect 10G link", quantity: 1, unit_price: 8900.0, line_total: 8900.0 }] },
    { id: 6, vendor_id: 2, vendor_name: "Slack Technologies", bill_number: "BILL-2026-006", category_id: 9, category: "SaaS", department: "Operations", legal_entity: "Voyance Health Inc", issue_date: "2026-09-03", due_date: "2026-09-18", status: "exceptions", currency: "USD", subtotal: 320.0, tax_amount: 0.0, total: 320.0, amount_paid: 0.0, requires_approval: false, capture_source: "upload", extraction_confidence: 0.70, file_fingerprint: "sha256-slack-dup-10", attachment_name: "slack_renewal_receipt.pdf", attachment_url: "/api/finance/bills/6/attachment", is_reviewed: false, notes: "Suspected duplicate of BILL-2026-002", created_at: "2026-09-03T10:00:00", created_by: "ap@voyance.health", lines: [{ id: 6, bill_id: 6, description: "Slack duplicate upload", quantity: 1, unit_price: 320.0, line_total: 320.0 }] },
  ];
  }

  if (!FinanceMockState.billPayments) {
    FinanceMockState.billPayments = [
    { id: 1, related_bill_id: 2, amount: 320.0, currency: "USD", payment_date: "2026-09-04", bank_account_id: 1, method: "bank_transfer", reference: "ACH-SLACK-01", is_reversed: false, created_at: "2026-09-04T10:00:00" },
  ];
  }

  const FinanceBillsApi = {
// Vendor Bills
  async getBills(params) {
    if (_isMock()) {
      let list = [...FinanceMockState.bills];
      if (params && params.queue) {
        const q = params.queue.toLowerCase().trim();
        if (q === "inbox") list = list.filter((b) => b.status === "inbox");
        else if (q === "needs_coding") list = list.filter((b) => b.status === "needs_coding");
        else if (q === "needs_approval") list = list.filter((b) => b.status === "needs_approval");
        else if (q === "ready_to_pay") list = list.filter((b) => b.status === "ready_to_pay" || b.status === "unpaid");
        else if (q === "scheduled") list = list.filter((b) => b.status === "scheduled");
        else if (q === "paid") list = list.filter((b) => b.status === "paid");
        else if (q === "exceptions") list = list.filter((b) => b.status === "exceptions");
        else if (q === "all") list = list.filter((b) => b.status !== "void");
      } else if (params && params.status) {
        list = list.filter((b) => b.status === params.status);
      }
      if (params && params.vendor_id) list = list.filter((b) => b.vendor_id === parseInt(params.vendor_id, 10));
      if (params && params.has_attachment !== undefined && params.has_attachment !== null && params.has_attachment !== "") {
        const hasAtt = String(params.has_attachment).toLowerCase() === "true" || params.has_attachment === true;
        list = list.filter((b) => hasAtt ? !!(b.attachment_name || b.attachment_url) : !(b.attachment_name || b.attachment_url));
      }
      if (params && params.search) {
        const s = params.search.toLowerCase();
        list = list.filter((b) => (b.bill_number && b.bill_number.toLowerCase().includes(s)) || (b.vendor_name || "").toLowerCase().includes(s) || (b.department || "").toLowerCase().includes(s) || (b.category || "").toLowerCase().includes(s));
      }
      return list;
    }
    let url = "/api/finance/bills";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async getBillQueueCounts(params) {
    if (_isMock()) {
      let list = FinanceMockState.bills || [];
      if (params && params.vendor_id) list = list.filter((b) => b.vendor_id === parseInt(params.vendor_id, 10));
      const counts = {
        inbox: 0,
        needs_coding: 0,
        needs_approval: 0,
        ready_to_pay: 0,
        scheduled: 0,
        paid: 0,
        exceptions: 0,
        all: 0,
      };
      for (const b of list) {
        if (b.status === "void") continue;
        counts.all++;
        const st = (b.status || "").toLowerCase();
        if (st in counts) counts[st]++;
        else if (st === "unpaid") counts.ready_to_pay++;
      }
      return counts;
    }
    let url = "/api/finance/bills/queue-counts";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async checkDuplicateBills(payload) {
    if (_isMock()) {
      const candidates = [];
      const cleanNum = (v) => (!v ? "" : String(v).toLowerCase().replace(/[^a-z0-9]/g, ""));
      const normNum = cleanNum(payload.bill_number);
      const targetVend = payload.vendor_id ? parseInt(payload.vendor_id, 10) : null;
      const targetTotal = payload.total !== undefined && payload.total !== null ? parseFloat(payload.total) : null;

      for (const b of FinanceMockState.bills) {
        if (payload.exclude_id && b.id === parseInt(payload.exclude_id, 10)) continue;
        if (b.status === "void") continue;

        let matched_field = null;
        let matching_val = "";

        if (payload.file_fingerprint && b.file_fingerprint && payload.file_fingerprint === b.file_fingerprint) {
          matched_field = "file_fingerprint";
          matching_val = payload.file_fingerprint.slice(0, 16) + "...";
        } else if (targetVend && b.vendor_id === targetVend && normNum && normNum === cleanNum(b.bill_number)) {
          matched_field = "bill_number";
          matching_val = b.bill_number;
        } else if (targetVend && b.vendor_id === targetVend && targetTotal !== null && Math.abs((b.total || 0) - targetTotal) < 0.01 && payload.issue_date && b.issue_date === payload.issue_date) {
          matched_field = "amount_and_date";
          matching_val = `$${b.total.toFixed(2)} on ${b.issue_date}`;
        }

        if (matched_field) {
          candidates.push({
            id: b.id,
            bill_number: b.bill_number,
            vendor_id: b.vendor_id,
            vendor_name: b.vendor_name,
            issue_date: b.issue_date,
            total: b.total,
            status: b.status,
            matched_field,
            matching_value: matching_val,
            match_reason: matched_field === "bill_number" ? "Same bill number for vendor" : (matched_field === "file_fingerprint" ? "Exact file content match" : "Same vendor, total, and issue date"),
          });
        }
      }
      return { has_duplicate: candidates.length > 0, candidates };
    }
    return apiRequest("POST", "/api/finance/bills/check-duplicate", payload);
  },
  async getBill(id) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");
      return bill;
    }
    return apiRequest("GET", `/api/finance/bills/${id}`);
  },
  async getBillCategoryQualityReport() {
    if (_isMock()) {
      const unmatched = FinanceMockState.bills
        .filter((b) => !b.category_id || b.category === "Other")
        .map((b) => ({
          id: b.id,
          bill_number: b.bill_number,
          vendor_name: b.vendor_name,
          category_string: b.category || null,
          issue_date: b.issue_date,
          total: b.total,
          status: b.status,
        }));
      return {
        unmatched_count: unmatched.length,
        unmatched_bills: unmatched,
      };
    }
    return apiRequest("GET", "/api/finance/bills/category-quality-report");
  },
  async createBill(payload) {
    if (_isMock()) {
      const vend = FinanceMockState.vendors.find((v) => v.id === parseInt(payload.vendor_id, 10));
      const lines = (payload.lines || []).map((ln, i) => ({
        id: Date.now() + i, bill_id: FinanceMockState.bills.length + 1,
        ...ln, line_total: ln.line_total || (ln.quantity * ln.unit_price),
      }));
      const subtotal = lines.reduce((s, l) => s + l.line_total, 0);

      // Check duplicate
      const dupRes = await this.checkDuplicateBills({
        vendor_id: payload.vendor_id,
        bill_number: payload.bill_number,
        issue_date: payload.issue_date,
        total: subtotal,
        file_fingerprint: payload.file_fingerprint,
      });
      const candidates = dupRes?.candidates || [];
      if (candidates.length > 0 && !payload.is_duplicate_override) {
        throw new Error(`Potential duplicate bill detected (${candidates[0].matched_field}: ${candidates[0].matching_value}). Authorized override required.`);
      }
      if (payload.is_duplicate_override && !payload.duplicate_override_reason?.trim()) {
        throw new Error("A valid reason is required when overriding a duplicate bill detection.");
      }

      // FUX-408: Integrity guard
      if ((payload.status === "paid" || payload.status === "partially_paid") && !payload.is_paid_now) {
        throw new Error("Paid or partially paid status cannot be set directly. It is derived from recorded settlements.");
      }

      if (payload.is_paid_now) {
        if (!payload.payment) {
          throw new Error("Payment details (bank account, payment date) are required when 'is_paid_now' is True.");
        }
        if (payload.requires_approval && payload.approval_status !== "approved") {
          throw new Error("Bill requires approval before payment can be recorded.");
        }
      }

      let st = payload.status || "inbox";
      let isRev = payload.is_reviewed !== undefined ? !!payload.is_reviewed : true;
      if (!isRev && (st === "ready_to_pay" || st === "paid")) {
        throw new Error("Unreviewed bills cannot be marked Ready to Pay or Paid.");
      }
      if (payload.is_paid_now) {
        st = "ready_to_pay";
      }

      const newBill = {
        id: FinanceMockState.bills.length + 1,
        ...payload,
        status: st,
        amount_paid: 0.0,
        is_reviewed: isRev,
        vendor_name: vend ? vend.name : null,
        subtotal, tax_amount: 0, total: subtotal,
        created_at: new Date().toISOString(),
        lines,
      };
      FinanceMockState.bills.push(newBill);

      // FUX-408: Record settlement if is_paid_now is True
      if (payload.is_paid_now && payload.payment) {
        await this.recordBillPayment(newBill.id, {
          bank_account_id: payload.payment.bank_account_id,
          payment_date: payload.payment.payment_date,
          amount: payload.payment.amount !== null && payload.payment.amount !== undefined ? payload.payment.amount : newBill.total,
          method: payload.payment.method || "bank_transfer",
          reference: payload.payment.reference || newBill.bill_number,
        });
      }

      return newBill;
    }
    return apiRequest("POST", "/api/finance/bills", payload);
  },
  async updateBill(id, payload) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");

      // FUX-408: Integrity guard
      if (payload.status === "paid" || payload.status === "partially_paid") {
        throw new Error("Bill status cannot be directly updated to paid or partially paid. Record a payment via settlement instead.");
      }

      const targetStatus = payload.status || bill.status;
      const isRev = payload.is_reviewed !== undefined ? payload.is_reviewed : bill.is_reviewed;
      if ((targetStatus === "ready_to_pay" || targetStatus === "paid") && !isRev) {
        throw new Error("Uploaded bills must be reviewed and coded before moving to ready_to_pay or paid status.");
      }

      Object.assign(bill, payload);
      if (payload.lines) {
        bill.subtotal = payload.lines.reduce((s, l) => s + (l.line_total || l.quantity * l.unit_price), 0);
        bill.total = bill.subtotal;
      }
      return bill;
    }
    return apiRequest("PUT", `/api/finance/bills/${id}`, payload);
  },
  async voidBill(id, reason = null) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");
      bill.status = "void";
      if (reason) bill.notes = `${bill.notes || ""}\n[Void reason: ${reason}]`.trim();
      return bill;
    }
    const q = reason ? `?reason=${encodeURIComponent(reason)}` : "";
    return apiRequest("DELETE", `/api/finance/bills/${id}${q}`, null, true, _getIdempHeaders());
  },
  async getBillPayments(billId) {
    if (_isMock()) return FinanceMockState.billPayments.filter((p) => p.related_bill_id === parseInt(billId, 10));
    return apiRequest("GET", `/api/finance/bills/${billId}/payments`);
  },
  async approveBill(id, payload) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");
      const decision = payload.decision || "approve";
      const approverEmail = payload.approver_email || "admin@voyance.health";
      if (bill.created_by && bill.created_by.toLowerCase() === approverEmail.toLowerCase()) {
        throw new Error("Segregation of duties: Creator cannot approve their own bill.");
      }
      if (payload.approver_limit !== undefined && payload.approver_limit !== null && bill.total > payload.approver_limit) {
        throw new Error(`Bill total ($${bill.total.toFixed(2)}) exceeds approver authorization limit ($${payload.approver_limit.toFixed(2)}). Escalation required.`);
      }
      if (decision === "approve") {
        bill.requires_approval = true;
        bill.approval_status = "approved";
        bill.approved_by = approverEmail;
        bill.approved_at = new Date().toISOString();
        bill.approval_comment = payload.comment || null;
        if (bill.status === "needs_approval") {
          bill.status = "ready_to_pay";
        }
      } else if (decision === "reject") {
        bill.requires_approval = true;
        bill.approval_status = "rejected";
        bill.approved_by = approverEmail;
        bill.approved_at = new Date().toISOString();
        bill.approval_comment = payload.comment || null;
        bill.status = "exceptions";
      }
      return bill;
    }
    return apiRequest("POST", `/api/finance/bills/${id}/approve`, payload);
  },
  async scheduleBill(id, payload) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");
      if (bill.requires_approval && bill.approval_status !== "approved") {
        throw new Error("Bill must be approved before scheduling payment.");
      }
      bill.scheduled_payment_date = payload.scheduled_payment_date;
      if (payload.notes) {
        bill.notes = `${bill.notes || ""}\n[Scheduled notes: ${payload.notes}]`.trim();
      }
      if (bill.status !== "paid" && bill.status !== "partially_paid") {
        bill.status = "scheduled";
      }
      return bill;
    }
    return apiRequest("POST", `/api/finance/bills/${id}/schedule`, payload);
  },
  async recordBillPayment(billId, payload) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(billId, 10));
      if (!bill) throw new Error("Bill not found");
      if (bill.status === "void") throw new Error("Cannot pay a void bill");
      if (bill.requires_approval && bill.approval_status !== "approved") {
        throw new Error("Bill requires approval before payment can be recorded.");
      }
      const existingPayments = (FinanceMockState.billPayments || []).filter(
        (p) => p.related_bill_id === bill.id && !p.is_reversed
      );
      const paidSoFar = existingPayments.reduce((s, p) => s + (p.amount || 0), 0);
      const remaining = round(bill.total - paidSoFar, 2);
      const pAmt = parseFloat(payload.amount);
      if (pAmt > remaining + 0.01) {
        throw new Error(`Payment amount ($${pAmt.toFixed(2)}) exceeds remaining balance ($${remaining.toFixed(2)}).`);
      }
      const newPayment = {
        id: FinanceMockState.billPayments.length + 1,
        ...payload,
        amount: pAmt,
        related_bill_id: parseInt(billId, 10),
        is_reversed: false,
        created_at: new Date().toISOString(),
      };
      FinanceMockState.billPayments.push(newPayment);
      bill.amount_paid = round(paidSoFar + pAmt, 2);
      if (bill.amount_paid >= bill.total - 0.01) {
        bill.status = "paid";
      } else if (["ready_to_pay", "scheduled", "partially_paid", "unpaid"].includes(bill.status)) {
        bill.status = "partially_paid";
      }
      return newPayment;
    }
    return apiRequest("POST", `/api/finance/bills/${billId}/payments`, payload);
  },
  async reverseBillPayment(billId, paymentId, payload) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(billId, 10));
      if (!bill) throw new Error("Bill not found");
      const payment = (FinanceMockState.billPayments || []).find(
        (p) => p.id === parseInt(paymentId, 10) && p.related_bill_id === bill.id
      );
      if (!payment) throw new Error("Payment not found");
      if (payment.is_reversed) throw new Error("Payment has already been reversed");
      payment.is_reversed = true;
      payment.reversed_at = new Date().toISOString();
      payment.reversed_by = "admin@voyance.health";
      payment.reversal_reason = (payload.reason || "").trim();

      const remainingPayments = (FinanceMockState.billPayments || []).filter(
        (p) => p.related_bill_id === bill.id && !p.is_reversed
      );
      const remainingPaid = remainingPayments.reduce((s, p) => s + (p.amount || 0), 0);
      bill.amount_paid = round(remainingPaid, 2);
      if (bill.amount_paid <= 0.001) {
        bill.amount_paid = 0.0;
        bill.status = bill.scheduled_payment_date ? "scheduled" : "ready_to_pay";
      } else if (bill.amount_paid < bill.total - 0.01) {
        bill.status = "partially_paid";
      } else {
        bill.status = "paid";
      }
      return payment;
    }
    return apiRequest("POST", `/api/finance/bills/${billId}/payments/${paymentId}/reverse`, payload);
  },

  async uploadBillAttachment(billId, file) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(billId, 10));
      if (!bill) throw new Error("Bill not found");
      const filename = file?.name || "uploaded_bill.pdf";
      bill.attachment_name = filename;
      bill.attachment_url = `/api/finance/bills/${bill.id}/attachment`;
      bill.file_fingerprint = "sha256-mock-" + Date.now();
      return bill;
    }
    const formData = new FormData();
    formData.append("file", file);
    return apiRequest("POST", `/api/finance/bills/${billId}/attachment`, formData);
  },

  async deleteBillAttachment(billId) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(billId, 10));
      if (!bill) throw new Error("Bill not found");
      bill.attachment_name = null;
      bill.attachment_url = null;
      bill.file_fingerprint = null;
      return bill;
    }
    return apiRequest("DELETE", `/api/finance/bills/${billId}/attachment`);
  },

  async getBillAttachmentBlobUrl(billId) {
    if (_isMock()) {
      // Create a mock sample text/pdf blob URL
      const sampleContent = `%PDF-1.4\n% Mock bill attachment document for bill #${billId}\n1 0 obj\n<< /Title (Bill ${billId}) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`;
      const blob = new Blob([sampleContent], { type: "application/pdf" });
      return URL.createObjectURL(blob);
    }
    const token = typeof TokenStore !== "undefined" ? TokenStore.get() : null;
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`/api/finance/bills/${billId}/attachment`, { headers, credentials: "include" });
    if (!res.ok) throw new Error(`Failed to load attachment: ${res.statusText}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  async extractBillDocument(file) {
    if (!file) throw new Error("A file is required for extraction");
    if (_isMock()) {
      const fileName = file.name || "document.pdf";
      const isUnreadable =
        fileName.toLowerCase().includes("unreadable") ||
        fileName.toLowerCase().includes("scanned") ||
        fileName.toLowerCase().includes("blank") ||
        fileName.toLowerCase().includes("raster");

      if (fileName.toLowerCase().includes("corrupt")) {
        throw new Error("Invalid or corrupted PDF document");
      }

      if (isUnreadable) {
        return {
          is_readable: false,
          unreadable_reason: "No machine-readable text layer was detected in this file (scanned image or raster PDF). Manual entry required.",
          extraction_confidence: 0.0,
          field_confidence: {},
          missing_fields: ["vendor", "bill_number", "issue_date", "due_date", "total", "line_items", "department", "category"],
          vendor_id: null,
          vendor_name: null,
          bill_number: null,
          issue_date: null,
          due_date: null,
          currency: "USD",
          subtotal: null,
          tax_amount: null,
          total: null,
          lines: [],
          file_fingerprint: "sha256-mock-unreadable-" + Date.now(),
          raw_text_snippet: null,
        };
      }

      // Try reading text if available (e.g. from Blob or text file created in tests)
      let textContent = "";
      try {
        if (typeof file.text === "function") {
          textContent = await file.text();
        }
      } catch (_) {}

      let vendorName = null;
      let vendorId = null;
      let billNumber = null;
      let issueDate = null;
      let dueDate = null;
      let total = null;
      let currency = "USD";
      const lines = [];

      if (textContent && textContent.length > 20) {
        const vMatch = textContent.match(/(?:Vendor|From|Supplier):\s*([^\r\n]+)/i);
        if (vMatch) {
          vendorName = vMatch[1].trim();
          const matchV = (FinanceMockState.vendors || []).find((v) =>
            v.name.toLowerCase().includes(vendorName.toLowerCase()) || vendorName.toLowerCase().includes(v.name.toLowerCase())
          );
          if (matchV) {
            vendorId = matchV.id;
            vendorName = matchV.name;
          }
        }
        const bMatch = textContent.match(/(?:Invoice\s*Number|Bill\s*#?|Invoice\s*#?):\s*([A-Za-z0-9\-_]+)/i);
        if (bMatch) billNumber = bMatch[1].trim();
        const dMatch = textContent.match(/(?:Date|Issue\s*Date):\s*(\d{4}-\d{2}-\d{2})/i);
        if (dMatch) issueDate = dMatch[1];
        const ddMatch = textContent.match(/(?:Due\s*Date):\s*(\d{4}-\d{2}-\d{2})/i);
        if (ddMatch) dueDate = ddMatch[1];
        const tMatch = textContent.match(/(?:Total):\s*(?:[$€£])?\s*([\d,]+(?:\.\d{2})?)/i);
        if (tMatch) total = parseFloat(tMatch[1].replace(/,/g, ""));
      }

      if (!vendorName && !vendorId) {
        vendorId = 1;
        vendorName = "Amazon Web Services";
      }
      if (!billNumber) {
        billNumber = "INV-2026-991";
      }
      if (!issueDate) {
        issueDate = "2026-09-10";
      }
      if (!dueDate) {
        dueDate = "2026-10-10";
      }
      if (!total) {
        total = 450.0;
      }
      if (lines.length === 0) {
        lines.push({
          description: "Cloud Hosting & Compute Services",
          quantity: 1,
          unit_price: total,
          line_total: total,
        });
      }

      const isLow = fileName.toLowerCase().includes("blur") || fileName.toLowerCase().includes("low");
      const confidence = isLow ? 0.68 : 0.94;

      return {
        is_readable: true,
        unreadable_reason: null,
        extraction_confidence: confidence,
        field_confidence: {
          vendor: 0.95,
          bill_number: 0.95,
          issue_date: 0.90,
          due_date: 0.85,
          total: 0.95,
        },
        missing_fields: ["category", "department"],
        vendor_id: vendorId,
        vendor_name: vendorName,
        bill_number: billNumber,
        issue_date: issueDate,
        due_date: dueDate,
        currency: currency,
        subtotal: total,
        tax_amount: 0.0,
        total: total,
        lines: lines,
        file_fingerprint: "sha256-mock-" + Date.now(),
        raw_text_snippet: textContent.slice(0, 300) || "Sample readable PDF invoice text...",
      };
    }

    const formData = new FormData();
    formData.append("file", file);
    return apiRequest("POST", "/api/finance/bills/extract", formData);
  },

  getPayrollRuns() {
    return apiRequest("GET", "/api/finance/payroll/runs");
  },
  getMyPayslips() {
    return apiRequest("GET", "/api/finance/payroll/payslips/my");
  },
  getSubscriptions() {
    return apiRequest("GET", "/api/finance/subscriptions");
  },

// Vendors
  async getVendors(params) {
    if (_isMock()) {
      let list = [...FinanceMockState.vendors];
      if (params && params.is_active !== undefined) {
        list = list.filter((v) => v.is_active === (params.is_active === "true" || params.is_active === true));
      }
      return list;
    }
    let url = "/api/finance/vendors";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async getVendor(id) {
    if (_isMock()) {
      const vend = FinanceMockState.vendors.find((v) => v.id === parseInt(id, 10));
      if (!vend) throw new Error("Vendor not found");
      return vend;
    }
    return apiRequest("GET", `/api/finance/vendors/${id}`);
  },
  async createVendor(payload) {
    if (_isMock()) {
      const newVend = {
        id: FinanceMockState.vendors.length + 1,
        ...payload,
        is_active: true,
      };
      FinanceMockState.vendors.push(newVend);
      return newVend;
    }
    return apiRequest("POST", "/api/finance/vendors", payload);
  },
  async updateVendor(id, payload) {
    if (_isMock()) {
      const vend = FinanceMockState.vendors.find((v) => v.id === parseInt(id, 10));
      if (!vend) throw new Error("Vendor not found");
      Object.assign(vend, payload);
      return vend;
    }
    return apiRequest("PUT", `/api/finance/vendors/${id}`, payload);
  },
  async deleteVendor(id) {
    if (_isMock()) {
      const vend = FinanceMockState.vendors.find((v) => v.id === parseInt(id, 10));
      if (!vend) throw new Error("Vendor not found");
      vend.is_active = false;
      return vend;
    }
    return apiRequest("DELETE", `/api/finance/vendors/${id}`);
  },
  async checkVendorDuplicate(payload) {
    if (_isMock()) {
      const results = [];
      const norm = (s) => (s || "").toLowerCase().replace(/^(the\s+)/, "").replace(/[\s,.-]+(llc|inc|corp|corporation|ltd|limited|co|company)$/, "").replace(/[^a-z0-9]/g, "");
      const normName = payload.name ? norm(payload.name) : "";
      const normTax = payload.tax_id ? norm(payload.tax_id) : "";
      const email = (payload.contact_email || "").trim().toLowerCase();

      for (const v of FinanceMockState.vendors) {
        if (normName && norm(v.name) === normName) {
          results.push({ id: v.id, name: v.name, tax_id: v.tax_id, contact_email: v.contact_email, matched_field: "name", confidence: 0.95 });
        } else if (normTax && v.tax_id && norm(v.tax_id) === normTax) {
          results.push({ id: v.id, name: v.name, tax_id: v.tax_id, contact_email: v.contact_email, matched_field: "tax_id", confidence: 1.0 });
        } else if (email && v.contact_email && v.contact_email.toLowerCase() === email) {
          results.push({ id: v.id, name: v.name, tax_id: v.tax_id, contact_email: v.contact_email, matched_field: "contact_email", confidence: 0.9 });
        }
      }
      return results;
    }
    return apiRequest("POST", "/api/finance/vendors/check-duplicate", payload);
  },
  async getVendor360(id, reveal = false) {
    if (_isMock()) {
      const vend = FinanceMockState.vendors.find((v) => v.id === parseInt(id, 10));
      if (!vend) throw new Error("Vendor not found");
      const instructions = (FinanceMockState.vendorPaymentInstructions || []).filter((pi) => pi.vendor_id === vend.id).map((pi) => {
        if (!reveal && pi.account_number && pi.account_number.length > 4) {
          return { ...pi, account_number: "******" + pi.account_number.slice(-4), iban: pi.iban ? "******" + pi.iban.slice(-4) : null };
        }
        return { ...pi };
      });
      const bills = (FinanceMockState.bills || []).filter((b) => b.vendor_id === vend.id);
      const paidBills = bills.filter((b) => b.status === "paid");
      const totalSpend = paidBills.reduce((acc, b) => acc + (b.total || 0), 0);
      const openBills = bills.filter((b) => b.status !== "paid" && b.status !== "void");
      const openTotal = openBills.reduce((acc, b) => acc + (b.total || 0), 0);
      return {
        vendor: vend,
        payment_instructions: instructions,
        metrics: {
          total_spend: totalSpend,
          open_bills_count: openBills.length,
          open_bills_total: openTotal,
          last_payment_date: paidBills.length ? paidBills[0].due_date : null,
          last_payment_amount: paidBills.length ? paidBills[0].total : null,
          active_subscriptions_count: 1,
        },
        recent_bills: bills.slice(0, 10),
      };
    }
    return apiRequest("GET", `/api/finance/vendors/${id}/360${reveal ? "?reveal=true" : ""}`);
  },
  async getVendorPaymentInstructions(vendorId, reveal = false) {
    if (_isMock()) {
      const list = (FinanceMockState.vendorPaymentInstructions || []).filter((pi) => pi.vendor_id === parseInt(vendorId, 10));
      return list.map((pi) => {
        if (!reveal && pi.account_number && pi.account_number.length > 4) {
          return { ...pi, account_number: "******" + pi.account_number.slice(-4), iban: pi.iban ? "******" + pi.iban.slice(-4) : null };
        }
        return { ...pi };
      });
    }
    return apiRequest("GET", `/api/finance/vendors/${vendorId}/payment-instructions${reveal ? "?reveal=true" : ""}`);
  },
  async createVendorPaymentInstruction(vendorId, payload) {
    if (_isMock()) {
      const newInst = {
        id: (FinanceMockState.vendorPaymentInstructions || []).length + 1,
        vendor_id: parseInt(vendorId, 10),
        ...payload,
        verification_status: "unverified",
        verified_by: null,
        verified_at: null,
        is_active: true,
      };
      FinanceMockState.vendorPaymentInstructions.push(newInst);
      return { ...newInst, account_number: "******" + (newInst.account_number ? newInst.account_number.slice(-4) : "0000") };
    }
    return apiRequest("POST", `/api/finance/vendors/${vendorId}/payment-instructions`, payload);
  },
  async updateVendorPaymentInstruction(vendorId, instructionId, payload) {
    if (_isMock()) {
      const inst = (FinanceMockState.vendorPaymentInstructions || []).find((pi) => pi.id === parseInt(instructionId, 10));
      if (!inst) throw new Error("Payment instruction not found");
      Object.assign(inst, payload);
      inst.verification_status = "unverified";
      inst.verified_by = null;
      inst.verified_at = null;
      return { ...inst, account_number: "******" + (inst.account_number ? inst.account_number.slice(-4) : "0000") };
    }
    return apiRequest("PUT", `/api/finance/vendors/${vendorId}/payment-instructions/${instructionId}`, payload);
  },
  async verifyVendorPaymentInstruction(vendorId, instructionId, payload) {
    if (_isMock()) {
      const inst = (FinanceMockState.vendorPaymentInstructions || []).find((pi) => pi.id === parseInt(instructionId, 10));
      if (!inst) throw new Error("Payment instruction not found");
      inst.verification_status = payload.decision || "verified";
      inst.verified_by = "admin@hrflow.test";
      inst.verified_at = new Date().toISOString();
      return { ...inst, account_number: "******" + (inst.account_number ? inst.account_number.slice(-4) : "0000") };
    }
    return apiRequest("POST", `/api/finance/vendors/${vendorId}/payment-instructions/${instructionId}/verify`, payload);
  }
  };

  root.FinanceBillsApi = FinanceBillsApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceBillsApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceBillsApi;
  }
})(typeof window !== "undefined" ? window : globalThis);


/**
 * fe/api/finance/accounts-api.js
 * Finance API - Accounts & Banking domain client and mock handlers.
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

  if (!FinanceMockState.accounts) {
    FinanceMockState.accounts = [
    { id: 1, account_name: "Voyance Operating USD", account_type: "bank", bank_name: "JPMorgan Chase", account_number: "******4821", raw_account_number: "12345678904821", country: "United States", currency: "USD", opening_balance: 150000.0, opening_balance_date: "2025-01-01", current_balance: 150000.0, is_active: true },
    { id: 2, account_name: "Voyance Treasury Reserve", account_type: "bank", bank_name: "Silicon Valley Bank", account_number: "******9102", raw_account_number: "98765432109102", country: "United States", currency: "USD", opening_balance: 500000.0, opening_balance_date: "2025-01-01", current_balance: 500000.0, is_active: true },
    { id: 3, account_name: "CIB EGP Operating", account_type: "bank", bank_name: "Commercial International Bank", account_number: "******3319", raw_account_number: "55443322113319", country: "Egypt", currency: "EGP", opening_balance: 450000.0, opening_balance_date: "2025-01-01", current_balance: 450000.0, is_active: true },
    { id: 4, account_name: "Cairo Office Petty Cash Drawer", account_type: "cash", bank_name: null, account_number: "CASH-CAIRO-01", raw_account_number: "CASH-CAIRO-01", country: "Egypt", currency: "EGP", opening_balance: 20000.0, opening_balance_date: "2025-01-01", current_balance: 20000.0, is_active: true },
  ];
  }

  if (!FinanceMockState.categories) {
    FinanceMockState.categories = [
    { id: 1, name: "Revenue", kind: "revenue", is_active: true, sort_order: 1, is_petty: false },
    { id: 2, name: "Salaries", kind: "cost", is_active: true, sort_order: 2, is_petty: false },
    { id: 3, name: "Medical Insurance", kind: "cost", is_active: true, sort_order: 3, is_petty: false },
    { id: 4, name: "Kitchen Supplies", kind: "cost", is_active: true, sort_order: 4, is_petty: true },
    { id: 5, name: "Transportation", kind: "cost", is_active: true, sort_order: 5, is_petty: true },
    { id: 6, name: "Rent", kind: "cost", is_active: true, sort_order: 6, is_petty: false },
    { id: 7, name: "Bank Fees", kind: "cost", is_active: true, sort_order: 7, is_petty: false },
    { id: 8, name: "Infrastructure", kind: "cost", is_active: true, sort_order: 8, is_petty: false },
    { id: 9, name: "SaaS", kind: "cost", is_active: true, sort_order: 9, is_petty: false },
    { id: 10, name: "Facilities & Maintenance", kind: "cost", is_active: true, sort_order: 10, is_petty: false },
    { id: 11, name: "Electricity", kind: "cost", is_active: true, sort_order: 11, is_petty: false },
    { id: 12, name: "Internet", kind: "cost", is_active: true, sort_order: 12, is_petty: false },
    { id: 13, name: "Operating Expense", kind: "cost", is_active: true, sort_order: 13, is_petty: false },
    { id: 14, name: "Other", kind: "other", is_active: true, sort_order: 99, is_petty: false },
  ];
  }

  if (!FinanceMockState.paymentTypes) {
    FinanceMockState.paymentTypes = [
    { id: 1, name: "Cash Payment", code: "CASH", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 2, name: "ATM Withdrawal", code: "CASHWITHDRAW", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 3, name: "Check Payment", code: "CHK", requires_cheque_number: true, requires_bank_fee_flag: false, is_active: true },
    { id: 4, name: "Internal Transfer", code: "INTTRANS", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 5, name: "Incoming Transfer", code: "INBOUND_TRANS", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 6, name: "Outgoing Transfer", code: "OUTBOUND_TRANS", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 7, name: "Currency Exchange", code: "USDTOEGP", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 8, name: "Debit Card Payment", code: "DEBIT_CARD", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 9, name: "Bank Fee", code: "BANK_FEES", requires_cheque_number: false, requires_bank_fee_flag: true, is_active: true },
  ];
  }

  if (!FinanceMockState.transactions) {
    FinanceMockState.transactions = [
    {
      id: 1,
      account_id: 1,
      date: "2026-09-02",
      direction: "out",
      amount: 4200.0,
      currency: "USD",
      category_id: 2,
      category_name: "Infrastructure",
      payment_type_id: 3,
      payment_type_code: "OUTBOUND_TRANS",
      payment_type_name: "Outbound Transfer",
      reference: "AWS-SEPT-01",
      description: "Payment for AWS Cloud Hosting",
      source: "manual",
      running_balance: 145800.0,
      created_at: "2026-09-02T10:00:00"
    },
    {
      id: 2,
      account_id: 4,
      date: "2026-09-03",
      direction: "out",
      amount: 150.0,
      currency: "EGP",
      category_id: 4,
      category_name: "Kitchen Supplies",
      payment_type_id: 1,
      payment_type_code: "CASH",
      payment_type_name: "Cash Payment",
      reference: "CSH-001",
      description: "Office coffee and tea supplies",
      source: "manual",
      running_balance: 19850.0,
      created_at: "2026-09-03T11:00:00"
    }
  ];
  }

  if (!FinanceMockState.transfers) {
    FinanceMockState.transfers = [];
  }

  const FinanceAccountsApi = {
// Bank Accounts
  async getAccounts(params) {
    if (_isMock()) {
      let list = [...FinanceMockState.accounts].map((a) => {
        const book = Number(a.current_balance || a.opening_balance || 0);
        const hasPostings = (FinanceMockState.transactions || []).some((t) => t.account_id === a.id) || (FinanceMockState.cheques || []).some((c) => c.account_id === a.id);
        const uncleared = (FinanceMockState.cheques || [])
          .filter((c) => c.account_id === a.id && (c.status === "issued" || c.status === "outstanding"))
          .reduce((sum, c) => sum + Number(c.amount || 0), 0);
        const available = book;
        return {
          ...a,
          book_balance: book,
          bank_balance: Math.round((book + uncleared) * 100) / 100,
          available_balance: available,
          reconciled_balance: book,
          unreconciled_count: 0,
          last_reconciled_date: "2026-09-01",
          last_import_date: "2026-09-05",
          has_postings: hasPostings,
          balance_definitions: {
            book_balance: "Current posted ledger balance reflecting all recorded accounting inflows and outflows.",
            bank_balance: "Reported bank statement balance as of the latest statement upload or sync.",
            available_balance: "Liquid balance immediately available for disbursement (Book balance minus uncleared issued cheques).",
            reconciled_balance: "Portion of the ledger verified and reconciled against official bank statements."
          },
          balance_as_of: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC"
        };
      });
      if (params && params.is_active !== undefined) {
        list = list.filter((a) => a.is_active === (params.is_active === "true" || params.is_active === true));
      }
      return list;
    }
    let url = "/api/finance/accounts";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async listAccounts(params) {
    return this.getAccounts(params);
  },
  async getAccount(id, params) {
    if (_isMock()) {
      const acc = FinanceMockState.accounts.find((a) => a.id === parseInt(id, 10));
      if (!acc) throw new Error("Account not found");
      const isReveal = params && (params.reveal === true || params.reveal === "true");
      let acctNum = acc.account_number;
      if (!isReveal) {
        acctNum = `******${(acc.account_number || "").slice(-4)}`;
      } else {
        acctNum = acc.raw_account_number || acc.account_number.replace(/\*/g, "9");
      }
      const book = Number(acc.current_balance || acc.opening_balance || 0);
      const hasPostings = (FinanceMockState.transactions || []).some((t) => t.account_id === acc.id) || (FinanceMockState.cheques || []).some((c) => c.account_id === acc.id);
      const uncleared = (FinanceMockState.cheques || [])
        .filter((c) => c.account_id === acc.id && (c.status === "issued" || c.status === "outstanding"))
        .reduce((sum, c) => sum + Number(c.amount || 0), 0);
      return {
        ...acc,
        account_number: acctNum,
        book_balance: book,
        bank_balance: Math.round((book + uncleared) * 100) / 100,
        available_balance: book,
        reconciled_balance: book,
        unreconciled_count: 0,
        last_reconciled_date: "2026-09-01",
        last_import_date: "2026-09-05",
        has_postings: hasPostings,
        balance_definitions: {
          book_balance: "Current posted ledger balance reflecting all recorded accounting inflows and outflows.",
          bank_balance: "Reported bank statement balance as of the latest statement upload or sync.",
          available_balance: "Liquid balance immediately available for disbursement (Book balance minus uncleared issued cheques).",
          reconciled_balance: "Portion of the ledger verified and reconciled against official bank statements."
        },
        balance_as_of: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC"
      };
    }
    const q = params ? `?${new URLSearchParams(params).toString()}` : "";
    return apiRequest("GET", `/api/finance/accounts/${id}${q}`);
  },
  async createAccount(payload) {
    if (_isMock()) {
      const rawNum = payload.account_number || "";
      const newAcc = {
        id: FinanceMockState.accounts.length + 1,
        ...payload,
        current_balance: payload.opening_balance || 0,
        raw_account_number: rawNum,
        account_number: `******${rawNum.slice(-4)}`,
        country: payload.country || "Egypt",
        opening_balance_date: payload.opening_balance_date || null,
        is_active: true,
      };
      FinanceMockState.accounts.push(newAcc);
      return newAcc;
    }
    return apiRequest("POST", "/api/finance/accounts", payload);
  },
  async updateAccount(id, payload) {
    if (_isMock()) {
      const acc = FinanceMockState.accounts.find((a) => a.id === parseInt(id, 10));
      if (!acc) throw new Error("Account not found");
      if (payload.currency && payload.currency.toUpperCase() !== (acc.currency || "").toUpperCase()) {
        const hasPostings = (FinanceMockState.transactions || []).some((t) => t.account_id === acc.id) || (FinanceMockState.cheques || []).some((c) => c.account_id === acc.id);
        if (hasPostings) {
          throw new Error("Currency cannot be modified after transactions have been posted to this account.");
        }
      }
      Object.assign(acc, payload);
      return acc;
    }
    return apiRequest("PUT", `/api/finance/accounts/${id}`, payload);
  },
  async deleteAccount(id) {
    if (_isMock()) {
      const acc = FinanceMockState.accounts.find((a) => a.id === parseInt(id, 10));
      if (!acc) throw new Error("Account not found");
      acc.is_active = false;
      return acc;
    }
    return apiRequest("DELETE", `/api/finance/accounts/${id}`);
  },

// Categories (Phase 0)
  async getCategories(params) {
    if (_isMock()) {
      let list = [...FinanceMockState.categories];
      if (params && params.kind) list = list.filter((c) => c.kind === params.kind);
      if (params && params.is_active !== undefined) {
        list = list.filter((c) => c.is_active === (params.is_active === "true" || params.is_active === true));
      }
      return list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    }
    let url = "/api/finance/categories";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async getCategory(id) {
    if (_isMock()) {
      const cat = FinanceMockState.categories.find((c) => c.id === parseInt(id, 10));
      if (!cat) throw new Error("Category not found");
      return cat;
    }
    return apiRequest("GET", `/api/finance/categories/${id}`);
  },
  async createCategory(payload) {
    if (_isMock()) {
      const newCat = {
        id: FinanceMockState.categories.length + 1,
        ...payload,
        is_active: payload.is_active !== undefined ? payload.is_active : true,
        sort_order: payload.sort_order || 0,
        is_petty: Boolean(payload.is_petty),
      };
      FinanceMockState.categories.push(newCat);
      return newCat;
    }
    return apiRequest("POST", "/api/finance/categories", payload);
  },
  async updateCategory(id, payload) {
    if (_isMock()) {
      const cat = FinanceMockState.categories.find((c) => c.id === parseInt(id, 10));
      if (!cat) throw new Error("Category not found");
      Object.assign(cat, payload);
      return cat;
    }
    return apiRequest("PATCH", `/api/finance/categories/${id}`, payload);
  },
  async deleteCategory(id) {
    if (_isMock()) {
      const cat = FinanceMockState.categories.find((c) => c.id === parseInt(id, 10));
      if (!cat) throw new Error("Category not found");
      cat.is_active = false;
      return cat;
    }
    return apiRequest("DELETE", `/api/finance/categories/${id}`);
  },

  // Payment Types (Phase 0)
  async getPaymentTypes(params) {
    if (_isMock()) {
      let list = [...FinanceMockState.paymentTypes];
      if (params && params.is_active !== undefined) {
        list = list.filter((p) => p.is_active === (params.is_active === "true" || params.is_active === true));
      }
      return list;
    }
    let url = "/api/finance/payment-types";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async getPaymentType(id) {
    if (_isMock()) {
      const pt = FinanceMockState.paymentTypes.find((p) => p.id === parseInt(id, 10));
      if (!pt) throw new Error("Payment type not found");
      return pt;
    }
    return apiRequest("GET", `/api/finance/payment-types/${id}`);
  },
  async createPaymentType(payload) {
    if (_isMock()) {
      const newPt = {
        id: FinanceMockState.paymentTypes.length + 1,
        ...payload,
        code: payload.code.toUpperCase(),
        is_active: payload.is_active !== undefined ? payload.is_active : true,
      };
      FinanceMockState.paymentTypes.push(newPt);
      return newPt;
    }
    return apiRequest("POST", "/api/finance/payment-types", payload);
  },
  async updatePaymentType(id, payload) {
    if (_isMock()) {
      const pt = FinanceMockState.paymentTypes.find((p) => p.id === parseInt(id, 10));
      if (!pt) throw new Error("Payment type not found");
      Object.assign(pt, payload);
      return pt;
    }
    return apiRequest("PATCH", `/api/finance/payment-types/${id}`, payload);
  },
  async deletePaymentType(id) {
    if (_isMock()) {
      const pt = FinanceMockState.paymentTypes.find((p) => p.id === parseInt(id, 10));
      if (!pt) throw new Error("Payment type not found");
      pt.is_active = false;
      return pt;
    }
    return apiRequest("DELETE", `/api/finance/payment-types/${id}`);
  },

// Transactions & Continuous Ledger (Phase 2)
  async getAccountTransactions(accountId, params) {
    if (_isMock()) {
      let list = (FinanceMockState.transactions || []).filter((t) => t.account_id === parseInt(accountId, 10));
      if (params && params.direction) list = list.filter((t) => t.direction === params.direction);
      if (params && params.category_id) list = list.filter((t) => t.category_id === parseInt(params.category_id, 10));
      if (params && params.payment_type_id) list = list.filter((t) => t.payment_type_id === parseInt(params.payment_type_id, 10));
      if (params && params.date_from) list = list.filter((t) => t.date >= params.date_from);
      if (params && params.date_to) list = list.filter((t) => t.date <= params.date_to);
      if (params && params.is_petty !== undefined) {
        const pettyCatIds = new Set(FinanceMockState.categories.filter((c) => c.is_petty).map((c) => c.id));
        const wantPetty = params.is_petty === true || params.is_petty === "true";
        list = list.filter((t) => pettyCatIds.has(t.category_id) === wantPetty);
      }
      return list.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    }
    let url = `/api/finance/accounts/${accountId}/transactions`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },

  async createTransaction(accountId, payload) {
    return this.createAccountTransaction(accountId, payload);
  },

  async createAccountTransaction(accountId, payload) {
    if (_isMock()) {
      if (!FinanceMockState.transactions) FinanceMockState.transactions = [];
      const acc = FinanceMockState.accounts.find((a) => a.id === parseInt(accountId, 10));
      const amount = parseFloat(payload.amount);
      const entryType = (payload.entry_type || "standard").toLowerCase();
      let direction = payload.direction;
      if (entryType === "bank_fee") direction = "out";

      const txCurr = (payload.currency || (acc ? acc.currency : "USD")).toUpperCase();
      const acctCurr = (acc ? acc.currency : "USD").toUpperCase();

      if (txCurr !== acctCurr) {
        if (!payload.fx_rate || parseFloat(payload.fx_rate) <= 0) {
          throw new Error(`Currency mismatch between transaction (${txCurr}) and account (${acctCurr}). An exchange rate (fx_rate) is required.`);
        }
      }

      if (entryType === "adjustment") {
        if (!payload.reason || !payload.reason.trim()) {
          throw new Error("A specific reason is required when recording an adjustment.");
        }
      }

      const effectiveAmt = txCurr !== acctCurr && payload.fx_rate ? amount / parseFloat(payload.fx_rate) : amount;

      if (acc) {
        if (direction === "in") acc.current_balance = round(acc.current_balance + effectiveAmt, 2);
        else acc.current_balance = round(acc.current_balance - effectiveAmt, 2);
      }

      const cat = FinanceMockState.categories.find((c) => c.id === parseInt(payload.category_id, 10));
      const pt = FinanceMockState.paymentTypes.find((p) => p.id === parseInt(payload.payment_type_id, 10));

      const newTx = {
        id: FinanceMockState.transactions.length + 1,
        account_id: parseInt(accountId, 10),
        date: payload.date,
        amount,
        direction,
        currency: txCurr,
        entry_type: entryType,
        counterparty: payload.counterparty || null,
        tax_amount: parseFloat(payload.tax_amount || 0.0),
        base_amount: txCurr !== acctCurr && payload.fx_rate ? round(effectiveAmt, 2) : null,
        reason: payload.reason || null,
        category_id: payload.category_id ? parseInt(payload.category_id, 10) : null,
        payment_type_id: payload.payment_type_id ? parseInt(payload.payment_type_id, 10) : null,
        category_name: cat ? cat.name : null,
        payment_type_code: pt ? pt.code : null,
        payment_type_name: pt ? pt.name : null,
        reference: payload.reference || "",
        description: payload.description || "",
        fx_rate: payload.fx_rate ? parseFloat(payload.fx_rate) : null,
        fx_equivalent: payload.fx_rate ? round(effectiveAmt, 2) : null,
        destination_cash_account_id: payload.destination_cash_account_id ? parseInt(payload.destination_cash_account_id, 10) : null,
        cheque_number: payload.cheque_number || null,
        source: payload.linked_bill_id ? "bill_payment" : (payload.linked_invoice_id ? "invoice_payment" : "manual"),
        linked_bill_id: payload.linked_bill_id ? parseInt(payload.linked_bill_id, 10) : null,
        linked_invoice_id: payload.linked_invoice_id ? parseInt(payload.linked_invoice_id, 10) : null,
        running_balance: acc ? acc.current_balance : amount,
        created_at: new Date().toISOString(),
      };

      if (payload.linked_bill_id) {
        const bill = (FinanceMockState.bills || []).find((b) => b.id === newTx.linked_bill_id);
        if (bill) {
          bill.amount_paid = round((bill.amount_paid || 0) + amount, 2);
          if (bill.amount_paid >= (bill.total || 0) - 0.01) {
            bill.status = "paid";
          } else {
            bill.status = "partially_paid";
          }
          if (!FinanceMockState.billPayments) FinanceMockState.billPayments = [];
          FinanceMockState.billPayments.push({
            id: Date.now(),
            related_bill_id: bill.id,
            amount,
            currency: txCurr,
            payment_date: payload.date,
            bank_account_id: parseInt(accountId, 10),
            reference: payload.reference || bill.bill_number,
            method: "bank_transfer",
            is_reversed: false,
          });
        }
      } else if (payload.linked_invoice_id) {
        const inv = (FinanceMockState.invoices || []).find((i) => i.id === newTx.linked_invoice_id);
        if (inv) {
          const prevPaid = (FinanceMockState.payments || [])
            .filter((p) => p.related_invoice_id === inv.id && !p.is_reversed)
            .reduce((s, p) => s + (p.amount || 0), 0);
          if (prevPaid + amount >= (inv.total || 0) - 0.01) {
            inv.status = "paid";
          } else {
            inv.status = "partially_paid";
          }
          if (!FinanceMockState.payments) FinanceMockState.payments = [];
          FinanceMockState.payments.push({
            id: Date.now(),
            related_invoice_id: inv.id,
            amount,
            currency: txCurr,
            payment_date: payload.date,
            bank_account_id: parseInt(accountId, 10),
            reference: payload.reference || inv.invoice_number,
            method: "bank_transfer",
            is_reversed: false,
          });
        }
      }

      FinanceMockState.transactions.unshift(newTx);

      if (payload.destination_cash_account_id && direction === "out") {
        const destCash = FinanceMockState.accounts.find((a) => a.id === parseInt(payload.destination_cash_account_id, 10));
        if (destCash) {
          destCash.current_balance = round(destCash.current_balance + amount, 2);
          const pairedInflow = {
            id: FinanceMockState.transactions.length + 1,
            account_id: destCash.id,
            date: payload.date,
            amount,
            direction: "in",
            currency: destCash.currency,
            entry_type: "standard",
            category_id: payload.category_id ? parseInt(payload.category_id, 10) : null,
            payment_type_id: payload.payment_type_id ? parseInt(payload.payment_type_id, 10) : null,
            category_name: cat ? cat.name : null,
            payment_type_code: pt ? pt.code : "CASHWITHDRAW",
            payment_type_name: pt ? pt.name : "Cash Withdrawal",
            reference: payload.reference || "",
            description: `Cash deposit from teller withdrawal (${acc ? acc.account_name : 'Bank'})`,
            source: "transfer",
            running_balance: destCash.current_balance,
            created_at: new Date().toISOString(),
          };
          FinanceMockState.transactions.unshift(pairedInflow);
        }
      }

      return newTx;
    }
    return apiRequest("POST", `/api/finance/accounts/${accountId}/transactions`, payload);
  },

  async checkDuplicateSettlement(params) {
    if (_isMock()) {
      const pType = (params.payee_type || "").toLowerCase();
      const pId = parseInt(params.payee_id, 10);
      const amt = parseFloat(params.amount || 0);

      if (pType === "vendor" && pId) {
        const bills = (FinanceMockState.bills || []).filter((b) => b.vendor_id === pId && b.status !== "paid" && b.status !== "void");
        for (const bill of bills) {
          const paid = (bill.amount_paid || 0);
          const remaining = Math.max(0, (bill.total || 0) - paid);
          const tol = Math.max(1.0, remaining * 0.05);
          if (Math.abs(remaining - amt) <= tol || Math.abs(bill.total - amt) <= tol) {
            return {
              has_match: true,
              match_type: "bill",
              document_id: bill.id,
              document_number: bill.bill_number,
              document_total: bill.total,
              remaining_balance: remaining,
              currency: bill.currency,
              due_date: bill.due_date,
              message: `Matching open bill #${bill.bill_number} found with remaining balance of ${bill.currency} ${remaining.toFixed(2)} (Due: ${bill.due_date}).`,
            };
          }
        }
      } else if (pType === "customer" && pId) {
        const invoices = (FinanceMockState.invoices || []).filter((i) => i.customer_id === pId && i.status !== "paid" && i.status !== "void");
        for (const inv of invoices) {
          const prevPaid = (FinanceMockState.payments || [])
            .filter((p) => p.related_invoice_id === inv.id && !p.is_reversed)
            .reduce((s, p) => s + (p.amount || 0), 0);
          const remaining = Math.max(0, (inv.total || 0) - prevPaid);
          const tol = Math.max(1.0, remaining * 0.05);
          if (Math.abs(remaining - amt) <= tol || Math.abs(inv.total - amt) <= tol) {
            return {
              has_match: true,
              match_type: "invoice",
              document_id: inv.id,
              document_number: inv.invoice_number,
              document_total: inv.total,
              remaining_balance: remaining,
              currency: inv.currency,
              due_date: inv.due_date,
              message: `Matching open invoice #${inv.invoice_number} found with remaining balance of ${inv.currency} ${remaining.toFixed(2)} (Due: ${inv.due_date}).`,
            };
          }
        }
      }
      return { has_match: false };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/transactions/duplicate-settlement-check?${qs}`);
  },

  async getUnlinkedSettlementCandidates(limit = 20) {
    if (_isMock()) {
      return [];
    }
    return apiRequest("GET", `/api/finance/transactions/unlinked-settlement-candidates?limit=${limit}`);
  },

  async previewTransaction(accountId, payload) {
    if (_isMock()) {
      const acc = FinanceMockState.accounts.find((a) => a.id === parseInt(accountId, 10));
      if (!acc) throw new Error("Account not found");

      const amount = parseFloat(payload.amount || 0);
      const txCurr = (payload.currency || acc.currency || "USD").toUpperCase();
      const acctCurr = (acc.currency || "USD").toUpperCase();
      const fxRate = payload.fx_rate ? parseFloat(payload.fx_rate) : null;

      if (txCurr !== acctCurr) {
        if (!fxRate || fxRate <= 0) {
          throw new Error(`Currency mismatch between transaction (${txCurr}) and account (${acctCurr}). An exchange rate (fx_rate) is required.`);
        }
      }

      const effectiveAmt = txCurr !== acctCurr && fxRate ? round(amount / fxRate, 2) : amount;
      const curBal = Number(acc.current_balance || 0);
      const direction = payload.entry_type === "bank_fee" ? "out" : (payload.direction || "out");
      const projBal = direction === "in" ? round(curBal + effectiveAmt, 2) : round(curBal - effectiveAmt, 2);
      const effectWord = direction === "in" ? "increase" : "decrease";

      const sym = txCurr === "USD" ? "$" : (txCurr === "EGP" ? "E£" : txCurr);
      const acctSym = acctCurr === "USD" ? "$" : (acctCurr === "EGP" ? "E£" : acctCurr);

      let plain = `This will ${effectWord} the Book Balance of ${acc.account_name} by ${sym}${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${txCurr}.`;
      if (txCurr !== acctCurr) {
        plain += ` (Converted @ ${fxRate}: ${acctSym}${effectiveAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${acctCurr}).`;
      }
      plain += ` Projected Book Balance: ${acctSym}${projBal.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${acctCurr}.`;

      const journal = [];
      const acctLabel = `Cash / Bank: ${acc.account_name}`;
      if (direction === "in") {
        journal.append ? journal.append({}) : journal.push({ type: "debit", account: acctLabel, amount: effectiveAmt, currency: acctCurr });
        const offsetLabel = payload.entry_type === "money_in" ? "Revenue / Accounts Receivable" : "Retained Earnings (Adjustment)";
        journal.push({ type: "credit", account: offsetLabel, amount: effectiveAmt, currency: acctCurr });
      } else {
        const offsetLabel = payload.entry_type === "bank_fee" ? "Bank & Financing Fees Expense" : (payload.entry_type === "adjustment" ? "Retained Earnings / Variance Adjustment" : "Expense / Accounts Payable");
        journal.push({ type: "debit", account: offsetLabel, amount: effectiveAmt, currency: acctCurr });
        journal.push({ type: "credit", account: acctLabel, amount: effectiveAmt, currency: acctCurr });
      }

      return {
        account_id: acc.id,
        account_name: acc.account_name,
        account_currency: acctCurr,
        entry_type: payload.entry_type || "standard",
        direction,
        transaction_amount: amount,
        transaction_currency: txCurr,
        fx_rate: fxRate,
        converted_amount: effectiveAmt,
        current_book_balance: curBal,
        projected_book_balance: projBal,
        plain_description: plain,
        journal_preview: journal,
      };
    }
    return apiRequest("POST", `/api/finance/accounts/${accountId}/transactions/preview`, payload);
  },

  async getTransaction(id) {
    if (_isMock()) {
      const tx = (FinanceMockState.transactions || []).find((t) => t.id === parseInt(id, 10));
      if (!tx) throw new Error("Transaction not found");
      return tx;
    }
    return apiRequest("GET", `/api/finance/transactions/${id}`);
  },

  async updateTransaction(id, payload) {
    if (_isMock()) {
      const tx = (FinanceMockState.transactions || []).find((t) => t.id === parseInt(id, 10));
      if (!tx) throw new Error("Transaction not found");
      if (tx.source !== "manual") throw new Error("Only manual transactions can be edited directly");
      Object.assign(tx, payload);
      if (payload.amount) tx.amount = parseFloat(payload.amount);
      if (payload.category_id) {
        const cat = FinanceMockState.categories.find((c) => c.id === parseInt(payload.category_id, 10));
        tx.category_name = cat ? cat.name : null;
      }
      if (payload.payment_type_id) {
        const pt = FinanceMockState.paymentTypes.find((p) => p.id === parseInt(payload.payment_type_id, 10));
        tx.payment_type_code = pt ? pt.code : null;
        tx.payment_type_name = pt ? pt.name : null;
      }
      return tx;
    }
    return apiRequest("PATCH", `/api/finance/transactions/${id}`, payload);
  },

  async deleteTransaction(id, reason = null) {
    if (_isMock()) {
      const idx = (FinanceMockState.transactions || []).findIndex((t) => t.id === parseInt(id, 10));
      if (idx === -1) throw new Error("Transaction not found");
      const tx = FinanceMockState.transactions[idx];
      if (tx.source !== "manual") throw new Error("Only manual transactions can be deleted");
      FinanceMockState.transactions.splice(idx, 1);
      return { message: "Transaction deleted successfully", id: parseInt(id, 10), reason: reason || "" };
    }
    const q = reason ? `?reason=${encodeURIComponent(reason)}` : "";
    return apiRequest("DELETE", `/api/finance/transactions/${id}${q}`, null, true, _getIdempHeaders());
  },

  async getAccountPettySummary(accountId, params) {
    if (_isMock()) {
      const txs = await this.getAccountTransactions(accountId, { ...params, is_petty: true });
      const acc = FinanceMockState.accounts.find((a) => a.id === parseInt(accountId, 10));
      let total_in = 0.0;
      let total_out = 0.0;
      const by_cat = {};

      txs.forEach((t) => {
        if (t.direction === "in") total_in += t.amount;
        else total_out += t.amount;
        const catId = t.category_id || 0;
        if (!by_cat[catId]) {
          by_cat[catId] = {
            category_id: catId,
            category_name: t.category_name || "Uncategorized",
            count: 0,
            total_in: 0,
            total_out: 0,
            net_amount: 0,
          };
        }
        by_cat[catId].count++;
        if (t.direction === "in") by_cat[catId].total_in += t.amount;
        else by_cat[catId].total_out += t.amount;
        by_cat[catId].net_amount = by_cat[catId].total_in - by_cat[catId].total_out;
      });

      return {
        account_id: parseInt(accountId, 10),
        account_name: acc ? acc.account_name : "Account",
        currency: acc ? acc.currency : "USD",
        date_from: params?.date_from || null,
        date_to: params?.date_to || null,
        total_in,
        total_out,
        net_amount: total_in - total_out,
        by_category: Object.values(by_cat),
        transactions: txs,
      };
    }
    let url = `/api/finance/accounts/${accountId}/transactions/petty-summary`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },

// Transfers (Phase 3)
  async getTransfers(params) {
    if (_isMock()) {
      let list = [...(FinanceMockState.transfers || [])];
      if (params && params.account_id) {
        const aid = parseInt(params.account_id, 10);
        list = list.filter((t) => t.from_account_id === aid || t.to_account_id === aid);
      }
      if (params && params.transfer_type && params.transfer_type !== "all") {
        list = list.filter((t) => t.transfer_type === params.transfer_type);
      }
      if (params && params.date_from) list = list.filter((t) => t.date >= params.date_from);
      if (params && params.date_to) list = list.filter((t) => t.date <= params.date_to);
      return list.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    }
    let url = "/api/finance/transfers";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },

  async getTransfer(id) {
    if (_isMock()) {
      const transfer = (FinanceMockState.transfers || []).find((t) => t.id === parseInt(id, 10));
      if (!transfer) throw new Error("Transfer not found");
      return transfer;
    }
    return apiRequest("GET", `/api/finance/transfers/${id}`);
  },

  async createTransfer(payload) {
    if (_isMock()) {
      if (!FinanceMockState.transfers) FinanceMockState.transfers = [];
      if (!FinanceMockState.transactions) FinanceMockState.transactions = [];

      const fromAcc = payload.from_account_id
        ? FinanceMockState.accounts.find((a) => a.id === parseInt(payload.from_account_id, 10))
        : null;
      const toAcc = payload.to_account_id
        ? FinanceMockState.accounts.find((a) => a.id === parseInt(payload.to_account_id, 10))
        : null;

      const fromAmount = parseFloat(payload.from_amount);
      let toAmount = payload.to_amount ? parseFloat(payload.to_amount) : fromAmount;
      const fxRate = payload.fx_rate ? parseFloat(payload.fx_rate) : null;

      if (payload.transfer_type === "same_bank_fx" && fxRate && !payload.to_amount) {
        toAmount = round(fromAmount * fxRate, 2);
      }

      const transferId = FinanceMockState.transfers.length + 1;
      let outTxId = null;
      let inTxId = null;

      const postOutflow = payload.transfer_type !== "external_linked" || payload.confirmed_leg !== "to_only";
      const postInflow = payload.transfer_type !== "external_linked" || payload.confirmed_leg !== "from_only";

      if (postOutflow && fromAcc) {
        fromAcc.current_balance = round(fromAcc.current_balance - fromAmount, 2);
        outTxId = FinanceMockState.transactions.length + 1;
        FinanceMockState.transactions.unshift({
          id: outTxId,
          account_id: fromAcc.id,
          date: payload.date,
          amount: fromAmount,
          direction: "out",
          currency: payload.from_currency || fromAcc.currency,
          reference: payload.exchange_reference || `Transfer to ${toAcc ? toAcc.account_name : "External"}`,
          description: payload.note || `Transfer to ${toAcc ? toAcc.account_name : "External"}`,
          fx_rate: fxRate,
          source: "transfer",
          linked_transfer_id: transferId,
          running_balance: fromAcc.current_balance,
          created_at: new Date().toISOString(),
        });
      }

      if (postInflow && toAcc) {
        toAcc.current_balance = round(toAcc.current_balance + toAmount, 2);
        inTxId = FinanceMockState.transactions.length + 1;
        FinanceMockState.transactions.unshift({
          id: inTxId,
          account_id: toAcc.id,
          date: payload.date,
          amount: toAmount,
          direction: "in",
          currency: payload.to_currency || toAcc.currency,
          reference: payload.exchange_reference || `Transfer from ${fromAcc ? fromAcc.account_name : "External"}`,
          description: payload.note || `Transfer from ${fromAcc ? fromAcc.account_name : "External"}`,
          fx_rate: fxRate,
          source: "transfer",
          linked_transfer_id: transferId,
          running_balance: toAcc.current_balance,
          created_at: new Date().toISOString(),
        });
      }

      const confirmedLeg = payload.confirmed_leg || "both";
      let settlementStatus = payload.settlement_status;
      if (!settlementStatus) {
        if (confirmedLeg === "from_only") settlementStatus = "in_transit";
        else if (confirmedLeg === "to_only") settlementStatus = "awaiting_match";
        else settlementStatus = "settled";
      }

      const newTransfer = {
        id: transferId,
        from_account_id: fromAcc ? fromAcc.id : null,
        to_account_id: toAcc ? toAcc.id : null,
        from_account_name: fromAcc ? fromAcc.account_name : null,
        to_account_name: toAcc ? toAcc.account_name : null,
        date: payload.date,
        from_amount: fromAmount,
        from_currency: payload.from_currency || (fromAcc ? fromAcc.currency : "USD"),
        to_amount: toAmount,
        to_currency: payload.to_currency || (toAcc ? toAcc.currency : "USD"),
        fx_rate: fxRate,
        transfer_type: payload.transfer_type,
        exchange_reference: payload.exchange_reference || null,
        confirmed_leg: confirmedLeg,
        settlement_status: settlementStatus,
        fee: parseFloat(payload.fee) || 0.0,
        expected_date: payload.expected_date || null,
        note: payload.note || "",
        outflow_transaction_id: outTxId,
        inflow_transaction_id: inTxId,
        created_at: new Date().toISOString(),
      };
      FinanceMockState.transfers.unshift(newTransfer);
      return newTransfer;
    }
    return apiRequest("POST", "/api/finance/transfers", payload);
  },

  async previewTransfer(payload) {
    if (_isMock()) {
      const fromAcc = payload.from_account_id
        ? (FinanceMockState.accounts || []).find((a) => a.id === parseInt(payload.from_account_id, 10))
        : null;
      const toAcc = payload.to_account_id
        ? (FinanceMockState.accounts || []).find((a) => a.id === parseInt(payload.to_account_id, 10))
        : null;

      const fromName = fromAcc ? fromAcc.account_name : "External Account";
      const toName = toAcc ? toAcc.account_name : "External Account";
      const fromCurr = fromAcc ? fromAcc.currency : "USD";
      const toCurr = toAcc ? toAcc.currency : (payload.to_currency || fromCurr);
      const fromCurBal = fromAcc ? fromAcc.current_balance : 0.0;
      const toCurBal = toAcc ? toAcc.current_balance : (toAcc ? 0.0 : null);

      let isValid = true;
      let validationErr = null;

      if (payload.from_account_id && payload.to_account_id && parseInt(payload.from_account_id, 10) === parseInt(payload.to_account_id, 10)) {
        isValid = false;
        validationErr = "Source and target bank accounts cannot be the same";
      }

      const fromAmt = parseFloat(payload.from_amount) || 0;
      let toAmt = parseFloat(payload.to_amount) || null;
      let fxRate = parseFloat(payload.fx_rate) || null;
      const fee = parseFloat(payload.fee) || 0;

      let explicitFx = null;
      let impliedRate = 1.0;

      if (payload.transfer_type === "internal") {
        toAmt = fromAmt;
        fxRate = 1.0;
        explicitFx = `1 ${fromCurr} = 1.00 ${fromCurr}`;
        impliedRate = 1.0;
        if (fromAcc && toAcc && fromAcc.currency !== toAcc.currency) {
          isValid = false;
          validationErr = `Internal transfer requires same currency (${fromAcc.currency} != ${toAcc.currency}). Use Same-Bank FX.`;
        }
      } else if (payload.transfer_type === "same_bank_fx") {
        if (fxRate && fxRate > 0) {
          if (!toAmt || toAmt <= 0) toAmt = round(fromAmt * fxRate, 2);
        } else if (toAmt && toAmt > 0) {
          fxRate = fromAmt > 0 ? round(toAmt / fromAmt, 6) : null;
        }
        impliedRate = (toAmt && fromAmt > 0) ? round(toAmt / fromAmt, 4) : fxRate;
        explicitFx = fxRate ? `1 ${fromCurr} = ${fxRate.toFixed(4)} ${toCurr}` : null;
      } else {
        if (!toAmt) toAmt = (fxRate && fxRate > 0) ? round(fromAmt * fxRate, 2) : fromAmt;
        impliedRate = (toAmt && fromAmt > 0) ? round(toAmt / fromAmt, 4) : 1.0;
        explicitFx = (fromCurr !== toCurr) ? `1 ${fromCurr} = ${impliedRate.toFixed(4)} ${toCurr}` : null;
      }

      const fromProj = round(fromCurBal - fromAmt - fee, 2);
      const toProj = toCurBal !== null ? round(toCurBal + (toAmt || 0), 2) : null;

      let settlementStatus = "settled";
      if (payload.confirmed_leg === "from_only") settlementStatus = "in_transit";
      else if (payload.confirmed_leg === "to_only") settlementStatus = "awaiting_match";

      const journalPreview = [];
      if (payload.confirmed_leg !== "to_only" && fromAcc) {
        journalPreview.push({ account: `${fromName} (Asset)`, debit: null, credit: fromAmt, currency: fromCurr });
        if (fee > 0) {
          journalPreview.push({ account: `Transfer Fees / ${fromName}`, debit: fee, credit: null, currency: fromCurr });
        }
      }
      if (payload.confirmed_leg !== "from_only" && toAcc) {
        journalPreview.push({ account: `${toName} (Asset)`, debit: toAmt, credit: null, currency: toCurr });
      }

      const plainDesc = `Transfer ${fromAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${fromCurr} from ${fromName} to ${toName}`
        + (fromCurr !== toCurr && fxRate ? ` (${(toAmt || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${toCurr} at ${fxRate.toFixed(4)})` : "")
        + (fee > 0 ? ` with ${fee.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${fromCurr} fee` : "")
        + `. Projected source balance: ${fromProj.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${fromCurr}.`;

      return {
        from_account_name: fromName,
        from_currency: fromCurr,
        from_current_balance: fromCurBal,
        from_projected_balance: fromProj,
        to_account_name: toName,
        to_currency: toCurr,
        to_current_balance: toCurBal,
        to_projected_balance: toProj,
        explicit_fx_direction: explicitFx,
        implied_rate: impliedRate,
        settlement_status: settlementStatus,
        is_valid: isValid,
        validation_error: validationErr,
        plain_description: plainDesc,
        journal_preview: journalPreview,
      };
    }
    return apiRequest("POST", "/api/finance/transfers/preview", payload);
  },

  async matchTransfer(transferId, payload) {
    if (_isMock()) {
      const transfer = (FinanceMockState.transfers || []).find((t) => t.id === parseInt(transferId, 10));
      if (!transfer) throw new Error("Transfer not found");
      if (transfer.settlement_status === "settled") throw new Error("Transfer is already fully settled");

      const toAcc = (FinanceMockState.accounts || []).find((a) => a.id === parseInt(payload.target_account_id, 10));
      if (!toAcc) throw new Error("Target bank account not found");

      transfer.to_account_id = toAcc.id;
      transfer.to_account_name = toAcc.account_name;
      transfer.to_currency = toAcc.currency;
      if (payload.received_amount) transfer.to_amount = parseFloat(payload.received_amount);
      transfer.confirmed_leg = "both";
      transfer.settlement_status = "settled";
      if (payload.note) transfer.note = `${transfer.note} | Matched: ${payload.note}`.trim();

      toAcc.current_balance = round(toAcc.current_balance + transfer.to_amount, 2);
      const inTxId = (FinanceMockState.transactions || []).length + 1;
      FinanceMockState.transactions.unshift({
        id: inTxId,
        account_id: toAcc.id,
        date: payload.settled_date || transfer.date,
        amount: transfer.to_amount,
        direction: "in",
        currency: toAcc.currency,
        reference: transfer.exchange_reference || `Transfer from ${transfer.from_account_name || "External"}`,
        description: `Settled transfer from ${transfer.from_account_name || "External"} (Linked #${transfer.id})`,
        source: "transfer",
        linked_transfer_id: transfer.id,
        running_balance: toAcc.current_balance,
        created_at: new Date().toISOString(),
      });
      transfer.inflow_transaction_id = inTxId;
      return transfer;
    }
    return apiRequest("POST", `/api/finance/transfers/${transferId}/match`, payload);
  }
  };

  root.FinanceAccountsApi = FinanceAccountsApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceAccountsApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceAccountsApi;
  }
})(typeof window !== "undefined" ? window : globalThis);


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


/**
 * fe/api/finance/statements-api.js
 * Finance API - Bank Statements & Reconciliation domain client and mock handlers.
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

  if (!FinanceMockState.statementImports) {
    FinanceMockState.statementImports = [
    {
      id: 1,
      account_id: 1,
      account_name: "Voyance Operating USD",
      period_month: "2026-09",
      file_type: "csv",
      status: "needs_review",
      uploaded_file_ref: "uploads/finance_attachments/stmt_sept_sample.csv",
      total_lines_count: 3,
      matched_lines_count: 1,
      reconciled_at: null,
      reconciled_by: null,
      created_at: "2026-09-10T10:00:00",
      created_by: "admin@hrflow.test",
      attachments: [{ id: 1, file_name: "chase_sept_statement.csv", file_size: 4210, storage_ref: "uploads/..." }]
    }
  ];
  }

  if (!FinanceMockState.statementLines) {
    FinanceMockState.statementLines = [
    {
      id: 1,
      import_id: 1,
      raw_date: "2026-09-02",
      raw_amount: 4200.0,
      direction: "out",
      raw_description: "AMAZON WEB SERVICES AWS.AMAZON.CO WA",
      raw_reference: "AWS-BILL-01",
      status: "matched",
      notes: "Auto-matched with Bill BILL-2026-001 payment",
      matched_transaction_id: 1,
      matched_cheque_id: null,
      suggested_matches: []
    },
    {
      id: 2,
      import_id: 1,
      raw_date: "2026-09-08",
      raw_amount: 12500.0,
      direction: "in",
      raw_description: "INWARD WIRE APEX HEALTH PARTNERS",
      raw_reference: "WIRE-INV-001",
      status: "unmatched",
      notes: "",
      matched_transaction_id: null,
      matched_cheque_id: null,
      suggested_matches: [
        {
          transaction_id: 101,
          cheque_id: null,
          match_type: "exact_transaction",
          score: 0.95,
          date: "2026-09-08",
          amount: 12500.0,
          direction: "in",
          description: "Customer Invoice Settlement INV-2026-001",
          reference: "INV-2026-001",
          reason: "Exact amount match, date proximity"
        }
      ]
    },
    {
      id: 3,
      import_id: 1,
      raw_date: "2026-09-15",
      raw_amount: 15.0,
      direction: "out",
      raw_description: "MONTHLY SERVICE FEE CHASE BANK",
      raw_reference: "FEE-0926",
      status: "unmatched",
      notes: "",
      matched_transaction_id: null,
      matched_cheque_id: null,
      suggested_matches: []
    }
  ];
  }

  if (!FinanceMockState.reconciliationRules) {
    FinanceMockState.reconciliationRules = [
    {
      id: 1,
      name: "Auto-Categorize Cloud Services",
      description: "Suggest Hosting category for Amazon Web Services",
      priority: 10,
      is_active: true,
      mode: "suggestion",
      account_id: null,
      description_pattern: "AMAZON|AWS",
      direction: "out",
      min_amount: null,
      max_amount: null,
      counterparty: "Amazon",
      action: "suggest_category",
      target_category: "Hosting Cloud Infrastructure",
      target_vendor_id: 1,
      payment_method: "card",
      audit_reason: null,
      creator: "admin@hrflow.test",
      approved_by: null,
      is_approved: false,
      last_used_at: "2026-09-02T10:00:00",
      times_applied: 4,
      created_at: "2026-08-01T10:00:00",
      updated_at: "2026-08-01T10:00:00"
    },
    {
      id: 2,
      name: "Bank Monthly Maintenance Fees",
      description: "Auto-ignore routine monthly checking account service charges",
      priority: 5,
      is_active: true,
      mode: "auto_apply",
      account_id: null,
      description_pattern: "SERVICE FEE|MAINTENANCE",
      direction: "out",
      min_amount: 1.0,
      max_amount: 50.0,
      counterparty: "Chase",
      action: "auto_ignore",
      target_category: "Bank Charges",
      target_vendor_id: null,
      payment_method: "bank_transfer",
      audit_reason: "Standard recurring bank maintenance charge covered by corporate policy",
      creator: "admin@hrflow.test",
      approved_by: "controller@voyancehealth.com",
      is_approved: true,
      last_used_at: "2026-09-01T09:00:00",
      times_applied: 2,
      created_at: "2026-08-10T10:00:00",
      updated_at: "2026-08-10T10:00:00"
    }
  ];
  }

  const FinanceStatementsApi = {
// Bank Statement Imports & Reconciliation (Phase 7)
  // ==========================================
  async previewStatement(accountId, formData) {
    if (_isMock()) {
      const periodMonth = (formData.get ? formData.get("period_month") : null) || "2026-09";
      const fileObj = formData.get ? formData.get("file") : null;
      const fileName = fileObj && fileObj.name ? fileObj.name : "statement.csv";
      const ext = fileName.split(".").pop().toLowerCase();
      const detectedFormat = ext === "pdf" ? "pdf" : "csv";

      const openBal = formData.get && formData.get("opening_balance") ? parseFloat(formData.get("opening_balance")) : 5000.0;
      const closeBal = formData.get && formData.get("closing_balance") ? parseFloat(formData.get("closing_balance")) : 6700.0;

      // Mock file fingerprint
      const fileFp = `sha256-mock-${fileName}-${fileObj ? fileObj.size : 1024}`;
      const existing = (FinanceMockState.statementImports || []).find(
        (i) => i.account_id === parseInt(accountId, 10) && i.file_fingerprint === fileFp
      );

      const rows = [
        {
          row_index: 2,
          raw_date: `${periodMonth}-02`,
          raw_amount: 500.0,
          direction: "out",
          raw_description: "AWS CLOUD INFRASTRUCTURE INVOICE",
          raw_reference: "REF-001",
          line_fingerprint: "fp-line-1",
          is_duplicate: false,
          is_valid: true,
          error_message: null,
        },
        {
          row_index: 3,
          raw_date: `${periodMonth}-08`,
          raw_amount: 2200.0,
          direction: "in",
          raw_description: "HEALTHCARE SERVICES WIRE INWARD",
          raw_reference: "REF-002",
          line_fingerprint: "fp-line-2",
          is_duplicate: false,
          is_valid: true,
          error_message: null,
        },
      ];

      const totalDebit = 500.0;
      const totalCredit = 2200.0;
      const calculatedNet = round(totalCredit - totalDebit, 2); // +1700
      const expectedClosing = openBal !== null ? round(openBal + calculatedNet, 2) : null;
      const delta = closeBal !== null && expectedClosing !== null ? round(closeBal - expectedClosing, 2) : 0.0;
      const matches = Math.abs(delta) < 0.01;

      return {
        file_fingerprint: fileFp,
        duplicate_file_detected: Boolean(existing),
        duplicate_import_id: existing ? existing.id : null,
        detected_format: detectedFormat,
        detected_headers: ["Date", "Description", "Debit", "Credit", "Reference"],
        suggested_mapping: {
          date_col: "Date",
          description_col: "Description",
          debit_col: "Debit",
          credit_col: "Credit",
          amount_col: null,
          reference_col: "Reference",
        },
        preview_rows: rows,
        validation_summary: {
          total_rows: 2,
          valid_count: 2,
          error_count: 0,
          warning_count: 0,
          duplicate_lines_count: 0,
          opening_balance: openBal,
          closing_balance: closeBal,
          total_debit: totalDebit,
          total_credit: totalCredit,
          calculated_net: calculatedNet,
          expected_closing_balance: expectedClosing,
          balance_delta: delta,
          balance_matches: matches,
        },
        errors: [],
        is_review_required: detectedFormat === "pdf",
      };
    }

    let res;
    try {
      res = await fetch(`${API_BASE_URL}/api/finance/accounts/${accountId}/statements/preview`, {
        method: "POST",
        body: formData,
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
      throw new Error(err.detail || `Preview failed with status ${res.status}`);
    }
    return res.json();
  },

  async getStatementTemplates(accountId) {
    if (_isMock()) {
      let list = [...(FinanceMockState.statementTemplates || [])];
      if (accountId) {
        list = list.filter((t) => !t.account_id || t.account_id === parseInt(accountId, 10));
      }
      return list;
    }
    const q = account_id ? `?account_id=${accountId}` : "";
    return apiRequest("GET", `/api/finance/statements/templates${q}`);
  },

  async saveStatementTemplate(payload) {
    if (_isMock()) {
      if (!FinanceMockState.statementTemplates) FinanceMockState.statementTemplates = [];
      const newTmpl = {
        id: FinanceMockState.statementTemplates.length + 1,
        ...payload,
        created_at: new Date().toISOString(),
      };
      FinanceMockState.statementTemplates.push(newTmpl);
      return newTmpl;
    }
    return apiRequest("POST", "/api/finance/statements/templates", payload);
  },

  async deleteStatementTemplate(templateId) {
    if (_isMock()) {
      FinanceMockState.statementTemplates = (FinanceMockState.statementTemplates || []).filter(
        (t) => t.id !== parseInt(templateId, 10)
      );
      return { status: "deleted" };
    }
    return apiRequest("DELETE", `/api/finance/statements/templates/${templateId}`);
  },

  async discardStatement(statementId) {
    if (_isMock()) {
      FinanceMockState.statementImports = (FinanceMockState.statementImports || []).filter(
        (i) => i.id !== parseInt(statementId, 10)
      );
      FinanceMockState.statementLines = (FinanceMockState.statementLines || []).filter(
        (l) => l.import_id !== parseInt(statementId, 10)
      );
      return { status: "discarded", id: statementId };
    }
    return apiRequest("DELETE", `/api/finance/statements/${statementId}`);
  },
  async listAccountStatements(accountId, periodMonth) {
    if (_isMock()) {
      let list = [...(FinanceMockState.statementImports || [])];
      if (accountId) list = list.filter((i) => i.account_id === parseInt(accountId, 10));
      if (periodMonth) list = list.filter((i) => i.period_month === periodMonth);
      return list;
    }
    const params = [];
    if (periodMonth) params.push(`period_month=${encodeURIComponent(periodMonth)}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    return apiRequest("GET", `/api/finance/accounts/${accountId}/statements${qs}`);
  },

  async uploadStatement(accountId, formData) {
    if (_isMock()) {
      const periodMonth = formData.get ? formData.get("period_month") : "2026-09";
      const fileObj = formData.get ? formData.get("file") : null;
      const fileName = fileObj && fileObj.name ? fileObj.name : "statement.csv";
      const ext = fileName.split(".").pop().toLowerCase();
      const fileType = ext === "pdf" ? "pdf" : "csv";

      const acc = (FinanceMockState.accounts || []).find((a) => a.id === parseInt(accountId, 10));
      const newImport = {
        id: (FinanceMockState.statementImports || []).length + 1,
        account_id: parseInt(accountId, 10),
        account_name: acc ? acc.account_name : "Bank Account",
        period_month: periodMonth,
        file_type: fileType,
        status: "needs_review",
        uploaded_file_ref: `uploads/finance_attachments/${fileName}`,
        total_lines_count: 2,
        matched_lines_count: 0,
        reconciled_at: null,
        reconciled_by: null,
        created_at: new Date().toISOString(),
        created_by: "admin@hrflow.test",
        attachments: [{ id: Date.now(), file_name: fileName, file_size: 2048, storage_ref: `uploads/${fileName}` }]
      };

      if (!FinanceMockState.statementImports) FinanceMockState.statementImports = [];
      FinanceMockState.statementImports.unshift(newImport);

      // Create mock lines for the uploaded statement
      const newLines = [
        {
          id: (FinanceMockState.statementLines || []).length + 1,
          import_id: newImport.id,
          raw_date: `${periodMonth}-05`,
          raw_amount: 1500.0,
          direction: "out",
          raw_description: "DIRECT DISBURSEMENT WIRE",
          raw_reference: "WIRE-990",
          status: "unmatched",
          notes: "",
          matched_transaction_id: null,
          matched_cheque_id: null,
          suggested_matches: []
        },
        {
          id: (FinanceMockState.statementLines || []).length + 2,
          import_id: newImport.id,
          raw_date: `${periodMonth}-10`,
          raw_amount: 3200.0,
          direction: "in",
          raw_description: "CLIENT SETTLEMENT DIRECT DEPOSIT",
          raw_reference: "DEP-112",
          status: "unmatched",
          notes: "",
          matched_transaction_id: null,
          matched_cheque_id: null,
          suggested_matches: []
        }
      ];
      if (!FinanceMockState.statementLines) FinanceMockState.statementLines = [];
      FinanceMockState.statementLines.push(...newLines);

      return newImport;
    }

    let res;
    try {
      res = await fetch(`${API_BASE_URL}/api/finance/accounts/${accountId}/statements`, {
        method: "POST",
        body: formData,
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
      throw new Error(err.detail || `Upload failed with status ${res.status}`);
    }
    return res.json();
  },

  async getStatement(statementId) {
    if (_isMock()) {
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10));
      if (!imp) throw new Error("Statement import not found");
      return imp;
    }
    return apiRequest("GET", `/api/finance/statements/${statementId}`);
  },

  async getStatementLines(statementId) {
    if (_isMock()) {
      return (FinanceMockState.statementLines || []).filter((l) => l.import_id === parseInt(statementId, 10));
    }
    return apiRequest("GET", `/api/finance/statements/${statementId}/lines`);
  },

  async getStatementSummary(statementId) {
    if (_isMock()) {
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10));
      const allLines = (FinanceMockState.statementLines || []).filter((l) => l.import_id === parseInt(statementId, 10));
      const activeLines = allLines.filter((l) => l.status !== "split");
      const resolvedLines = activeLines.filter((l) => ["matched", "created", "ignored"].includes(l.status));
      const unmatchedLines = activeLines.filter((l) => l.status === "unmatched");

      const resolvedAmount = resolvedLines.reduce((s, l) => s + (l.raw_amount || 0), 0);
      const unresolvedAmount = unmatchedLines.reduce((s, l) => s + (l.raw_amount || 0), 0);

      const acc = (FinanceMockState.accounts || []).find((a) => a.id === (imp ? imp.account_id : null));
      const bookBalance = acc ? acc.current_balance : 0;
      const diff = imp && imp.closing_balance !== undefined ? imp.closing_balance - bookBalance : null;

      return {
        statement_id: parseInt(statementId, 10),
        account_id: imp ? imp.account_id : 1,
        account_name: imp ? imp.account_name || "Primary Checking" : "Primary Checking",
        currency: acc ? acc.currency || "USD" : "USD",
        period_month: imp ? imp.period_month : "2026-09",
        statement_opening_balance: imp ? imp.opening_balance : 10000.0,
        statement_closing_balance: imp ? imp.closing_balance : 10350.0,
        book_balance: bookBalance,
        difference: diff,
        total_lines_count: activeLines.length,
        resolved_lines_count: resolvedLines.length,
        unmatched_lines_count: unmatchedLines.length,
        resolved_amount: resolvedAmount,
        unresolved_amount: unresolvedAmount,
        status: imp ? imp.status : "needs_review",
      };
    }
    return apiRequest("GET", `/api/finance/statements/${statementId}/summary`);
  },

  async resolveStatementLine(statementId, lineId, payload) {
    if (_isMock()) {
      const line = (FinanceMockState.statementLines || []).find((l) => l.id === parseInt(lineId, 10));
      if (!line) throw new Error("Statement line not found");

      if (payload.action === "match") {
        if (payload.matched_transaction_id) {
          const already = (FinanceMockState.statementLines || []).find(
            (l) => l.id !== line.id && l.matched_transaction_id === payload.matched_transaction_id && ["matched", "created"].includes(l.status)
          );
          if (already) throw new Error(`Ledger Transaction #${payload.matched_transaction_id} is already matched to line #${already.id}`);
        }
        line.status = "matched";
        line.matched_transaction_id = payload.matched_transaction_id || null;
        line.matched_cheque_id = payload.matched_cheque_id || null;
        if (payload.matched_cheque_id) {
          const chq = (FinanceMockState.cheques || []).find((c) => c.id === parseInt(payload.matched_cheque_id, 10));
          if (chq) {
            chq.status = "cleared";
            chq.clear_date = line.raw_date;
          }
        }
      } else if (payload.action === "create") {
        line.status = "created";
        line.matched_transaction_id = Date.now();
      } else if (payload.action === "ignore") {
        if (!payload.notes || !payload.notes.trim()) {
          throw new Error("A documented reason is mandatory to ignore a statement line.");
        }
        line.status = "ignored";
        line.notes = payload.notes.trim();
      } else if (payload.action === "split") {
        if (!payload.splits || payload.splits.length < 2) {
          throw new Error("Split action requires at least two split portions.");
        }
        const totalSplit = payload.splits.reduce((s, p) => s + (p.amount || 0), 0);
        if (Math.abs(totalSplit - line.raw_amount) > 0.01) {
          throw new Error(`Split portions total (${totalSplit}) must equal line amount (${line.raw_amount}) within currency precision.`);
        }
        line.status = "split";
        line.child_lines = payload.splits.map((p, idx) => ({
          id: Date.now() + idx,
          import_id: line.import_id,
          parent_line_id: line.id,
          raw_date: line.raw_date,
          raw_amount: p.amount,
          direction: line.direction,
          raw_description: p.description || `${line.raw_description} (Split ${idx + 1})`,
          raw_reference: p.reference || line.raw_reference,
          status: "matched",
          notes: `Split ${idx + 1} from line #${line.id}`,
        }));
        (FinanceMockState.statementLines || []).push(...line.child_lines);
      }
      if (payload.notes && payload.action !== "ignore") line.notes = payload.notes;

      // Update import matched count
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10));
      if (imp) {
        const resolvedCount = (FinanceMockState.statementLines || []).filter(
          (l) => l.import_id === imp.id && ["matched", "created", "ignored", "split"].includes(l.status)
        ).length;
        imp.matched_lines_count = resolvedCount;
      }
      return line;
    }
    return apiRequest("POST", `/api/finance/statements/${statementId}/lines/${lineId}/resolve`, payload);
  },

  async reconcileStatement(statementId) {
    if (_isMock()) {
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10));
      if (!imp) throw new Error("Statement import not found");
      imp.status = "reconciled";
      imp.reconciled_at = new Date().toISOString();
      imp.reconciled_by = "admin@hrflow.test";
      return imp;
    }
    return apiRequest("POST", `/api/finance/statements/${statementId}/reconcile`);
  },

  async closeStatementPeriod(statementId, payload = {}) {
    if (_isMock()) {
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10));
      if (!imp) throw new Error("Statement import not found");
      const acc = (FinanceMockState.accounts || []).find((a) => a.id === imp.account_id);
      const bookBalance = acc ? acc.current_balance : 0;
      const diff = Math.round(((imp.closing_balance || 0) - bookBalance) * 100) / 100;
      const allLines = (FinanceMockState.statementLines || []).filter((l) => l.import_id === parseInt(statementId, 10));
      const unresolved = allLines.filter((l) => l.status === "unmatched");

      if ((Math.abs(diff) > 0.01 || unresolved.length > 0) && (!payload.is_exception_override || !payload.exception_override_reason?.trim())) {
        throw new Error(`Cannot close period: balance difference ($${diff.toFixed(2)}) is non-zero or ${unresolved.length} line(s) remain unresolved. A documented exception override reason is required.`);
      }

      imp.status = "closed";
      imp.closed_at = new Date().toISOString();
      imp.closed_by = "admin@hrflow.test";
      imp.closing_notes = payload.closing_notes || "";
      imp.is_exception_override = !!payload.is_exception_override;
      imp.exception_override_reason = payload.exception_override_reason || null;
      return imp;
    }
    return apiRequest("POST", `/api/finance/statements/${statementId}/close`, payload);
  },

  async reopenStatementPeriod(statementId, payload = {}) {
    if (_isMock()) {
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10));
      if (!imp) throw new Error("Statement import not found");
      if (!payload.reopen_reason?.trim()) {
        throw new Error("A documented reason is mandatory to reopen a closed reconciliation period.");
      }
      imp.status = "reopened";
      imp.reopened_at = new Date().toISOString();
      imp.reopened_by = "admin@hrflow.test";
      imp.reopen_reason = payload.reopen_reason.trim();
      return imp;
    }
    return apiRequest("POST", `/api/finance/statements/${statementId}/reopen`, payload);
  },

  async getStatementCompletionReport(statementId) {
    if (_isMock()) {
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10)) || {};
      const acc = (FinanceMockState.accounts || []).find((a) => a.id === imp.account_id);
      const bookBalance = acc ? acc.current_balance : 0;
      const closing = imp.closing_balance || 0;
      const diff = Math.round((closing - bookBalance) * 100) / 100;
      const allLines = (FinanceMockState.statementLines || []).filter((l) => l.import_id === parseInt(statementId, 10));
      const matched = allLines.filter((l) => l.status === "matched");
      const created = allLines.filter((l) => l.status === "created");
      const ignored = allLines.filter((l) => l.status === "ignored");

      return {
        statement_id: parseInt(statementId, 10),
        account_id: imp.account_id || 1,
        account_name: imp.account_name || "Primary Checking",
        period_month: imp.period_month || "2026-09",
        currency: acc ? acc.currency || "USD" : "USD",
        status: imp.status || "closed",
        opening_balance: imp.opening_balance || 0,
        closing_balance: closing,
        book_balance: bookBalance,
        balance_difference: diff,
        is_balanced: Math.abs(diff) <= 0.01,
        total_lines_count: allLines.filter((l) => l.status !== "split").length,
        matched_lines_count: matched.length,
        matched_lines_amount: matched.reduce((s, l) => s + (l.raw_amount || 0), 0),
        created_entries_count: created.length,
        created_entries_amount: created.reduce((s, l) => s + (l.raw_amount || 0), 0),
        ignored_lines_count: ignored.length,
        ignored_lines_amount: ignored.reduce((s, l) => s + (l.raw_amount || 0), 0),
        ignored_lines_details: ignored.map((l) => ({
          line_id: l.id,
          date: l.raw_date,
          amount: l.raw_amount,
          description: l.raw_description,
          audit_reason: l.notes || "",
        })),
        split_lines_count: allLines.filter((l) => l.status === "split").length,
        uncleared_ledger_transactions_count: 0,
        uncleared_ledger_transactions_amount: 0.0,
        uncleared_cheques_count: 0,
        uncleared_cheques_amount: 0.0,
        closed_at: imp.closed_at || null,
        closed_by: imp.closed_by || null,
        reopened_at: imp.reopened_at || null,
        reopened_by: imp.reopened_by || null,
        reopen_reason: imp.reopen_reason || null,
        is_exception_override: !!imp.is_exception_override,
        exception_override_reason: imp.exception_override_reason || null,
        closing_notes: imp.closing_notes || null,
        generated_at: new Date().toISOString(),
      };
    }
    return apiRequest("GET", `/api/finance/statements/${statementId}/completion-report`);
  },

  // ==========================================
  // Story 6.3: Reconciliation Rules
  // ==========================================
  async getReconciliationRules(params = {}) {
    if (_isMock()) {
      let rules = [...(FinanceMockState.reconciliationRules || [])];
      if (params.is_active !== undefined && params.is_active !== null) {
        const act = String(params.is_active) === "true";
        rules = rules.filter((r) => r.is_active === act);
      }
      if (params.account_id) {
        rules = rules.filter((r) => !r.account_id || r.account_id === parseInt(params.account_id, 10));
      }
      if (params.mode) {
        rules = rules.filter((r) => r.mode === params.mode);
      }
      return rules.sort((a, b) => a.priority - b.priority || a.id - b.id);
    }
    const q = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/rules${q ? `?${q}` : ""}`);
  },

  async createReconciliationRule(payload) {
    if (_isMock()) {
      const newRule = {
        id: Date.now(),
        name: payload.name,
        description: payload.description || "",
        priority: parseInt(payload.priority || 10, 10),
        is_active: payload.is_active !== false,
        mode: payload.mode || "suggestion",
        account_id: payload.account_id || null,
        description_pattern: payload.description_pattern || null,
        direction: payload.direction || null,
        min_amount: payload.min_amount ? parseFloat(payload.min_amount) : null,
        max_amount: payload.max_amount ? parseFloat(payload.max_amount) : null,
        counterparty: payload.counterparty || null,
        action: payload.action || "suggest_category",
        target_category: payload.target_category || null,
        target_vendor_id: payload.target_vendor_id || null,
        payment_method: payload.payment_method || "bank_transfer",
        audit_reason: payload.audit_reason || null,
        creator: "admin@hrflow.test",
        approved_by: payload.is_approved ? "controller@voyancehealth.com" : null,
        is_approved: Boolean(payload.is_approved),
        last_used_at: null,
        times_applied: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      (FinanceMockState.reconciliationRules = FinanceMockState.reconciliationRules || []).push(newRule);
      return newRule;
    }
    return apiRequest("POST", "/api/finance/rules", payload);
  },

  async updateReconciliationRule(ruleId, payload) {
    if (_isMock()) {
      const rule = (FinanceMockState.reconciliationRules || []).find((r) => r.id === parseInt(ruleId, 10));
      if (!rule) throw new Error("Reconciliation rule not found");
      Object.assign(rule, payload, { updated_at: new Date().toISOString() });
      return rule;
    }
    return apiRequest("PUT", `/api/finance/rules/${ruleId}`, payload);
  },

  async deleteReconciliationRule(ruleId) {
    if (_isMock()) {
      const idx = (FinanceMockState.reconciliationRules || []).findIndex((r) => r.id === parseInt(ruleId, 10));
      if (idx >= 0) FinanceMockState.reconciliationRules.splice(idx, 1);
      return { status: "success", message: `Rule #${ruleId} deleted` };
    }
    return apiRequest("DELETE", `/api/finance/rules/${ruleId}`);
  },

  async previewReconciliationRule(payload) {
    if (_isMock()) {
      const ruleCandidate = payload.rule;
      const unmatchedLines = (FinanceMockState.statementLines || []).filter((l) => l.status === "unmatched");
      const matched = unmatchedLines.filter((l) => {
        if (ruleCandidate.direction && l.direction !== ruleCandidate.direction) return false;
        if (ruleCandidate.min_amount && l.raw_amount < ruleCandidate.min_amount) return false;
        if (ruleCandidate.max_amount && l.raw_amount > ruleCandidate.max_amount) return false;
        if (ruleCandidate.description_pattern) {
          const pat = new RegExp(ruleCandidate.description_pattern, "i");
          if (!pat.test(l.raw_description || "") && !pat.test(l.raw_reference || "")) return false;
        }
        return true;
      });

      const conflicts = [];
      const activeRules = (FinanceMockState.reconciliationRules || []).filter((r) => r.is_active);
      matched.forEach((m) => {
        activeRules.forEach((ar) => {
          if (ar.id === ruleCandidate.id) return;
          const pat = new RegExp(ar.description_pattern || ".*", "i");
          if (pat.test(m.raw_description || "") || pat.test(m.raw_reference || "")) {
            conflicts.push({
              winning_rule_id: ruleCandidate.priority <= ar.priority ? 0 : ar.id,
              winning_rule_name: ruleCandidate.priority <= ar.priority ? ruleCandidate.name : ar.name,
              conflicting_rule_id: ruleCandidate.priority <= ar.priority ? ar.id : 0,
              conflicting_rule_name: ruleCandidate.priority <= ar.priority ? ar.name : ruleCandidate.name,
              line_id: m.id,
              conflict_reason: `Both rules match statement line #${m.id}. Higher priority (${Math.min(ruleCandidate.priority, ar.priority)}) wins.`,
            });
          }
        });
      });

      return {
        matched_lines_count: matched.length,
        sample_matched_lines: matched.slice(0, 5),
        conflicts: conflicts,
        mode: ruleCandidate.mode || "suggestion",
        is_approved: Boolean(ruleCandidate.is_approved),
        summary: `Matches ${matched.length} unmatched line(s) with ${conflicts.length} conflict(s) detected.`,
      };
    }
    return apiRequest("POST", "/api/finance/rules/preview", payload);
  },

  async applyRulesToStatement(statementId, dryRun = false) {
    if (_isMock()) {
      const activeRules = (FinanceMockState.reconciliationRules || []).filter((r) => r.is_active);
      const lines = (FinanceMockState.statementLines || []).filter(
        (l) => l.import_id === parseInt(statementId, 10) && l.status === "unmatched"
      );

      let suggestionsCount = 0;
      let autoAppliedCount = 0;
      const updatedLines = [];

      lines.forEach((line) => {
        for (const rule of activeRules) {
          if (rule.direction && line.direction !== rule.direction) continue;
          if (rule.min_amount && line.raw_amount < rule.min_amount) continue;
          if (rule.max_amount && line.raw_amount > rule.max_amount) continue;
          if (rule.description_pattern) {
            const pat = new RegExp(rule.description_pattern, "i");
            if (!pat.test(line.raw_description || "") && !pat.test(line.raw_reference || "")) continue;
          }

          // Matched winning rule
          if (dryRun) break;

          if (rule.mode === "suggestion") {
            line.notes = `[Rule: ${rule.name}] Suggests: ${rule.action} (${rule.target_category || ''})`;
            line.applied_rule_id = rule.id;
            line.is_auto_applied = false;
            suggestionsCount++;
            updatedLines.push(line);
          } else if (rule.mode === "auto_apply" && rule.is_approved) {
            if (rule.action === "auto_ignore") {
              line.status = "ignored";
              line.notes = rule.audit_reason || `Auto-ignored by rule ${rule.name}`;
              line.applied_rule_id = rule.id;
              line.is_auto_applied = true;
              autoAppliedCount++;
              updatedLines.push(line);
            } else if (rule.action === "auto_create") {
              line.status = "created";
              line.matched_transaction_id = Date.now();
              line.applied_rule_id = rule.id;
              line.is_auto_applied = true;
              autoAppliedCount++;
              updatedLines.push(line);
            }
            rule.times_applied = (rule.times_applied || 0) + 1;
            rule.last_used_at = new Date().toISOString();
          }
          break;
        }
      });

      return {
        statement_id: parseInt(statementId, 10),
        evaluated_lines_count: lines.length,
        suggestions_count: suggestionsCount,
        auto_applied_count: autoAppliedCount,
        conflicts: [],
        updated_lines: updatedLines,
      };
    }
    return apiRequest("POST", `/api/finance/statements/${statementId}/apply-rules?dry_run=${dryRun ? "true" : "false"}`);
  },

  async revertRule(ruleId) {
    if (_isMock()) {
      const id = parseInt(ruleId, 10);
      const lines = (FinanceMockState.statementLines || []).filter(
        (l) => l.applied_rule_id === id && l.is_auto_applied
      );
      lines.forEach((l) => {
        l.status = "unmatched";
        l.matched_transaction_id = null;
        l.applied_rule_id = null;
        l.is_auto_applied = false;
      });
      const rule = (FinanceMockState.reconciliationRules || []).find((r) => r.id === id);
      if (rule) rule.times_applied = Math.max(0, (rule.times_applied || 0) - lines.length);

      return {
        rule_id: id,
        reverted_lines_count: lines.length,
        status: "success",
        message: `Reverted ${lines.length} auto-applied line(s).`,
      };
    }
    return apiRequest("POST", `/api/finance/rules/${ruleId}/revert`);
  },


  // ==========================================
  };

  root.FinanceStatementsApi = FinanceStatementsApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceStatementsApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceStatementsApi;
  }
})(typeof window !== "undefined" ? window : globalThis);


/**
 * fe/api/finance/reports-api.js
 * Finance API - Reports & Analytics domain client and mock handlers.
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

  if (!FinanceMockState.reportExportAudits) {
    FinanceMockState.reportExportAudits = [
    {
      id: 1,
      report_key: "profit-and-loss",
      export_format: "xlsx",
      user_email: "admin@hrflow.test",
      row_count: 18,
      file_name: "profit_and_loss_2026-09-01_to_2026-09-30.xlsx",
      filters: { basis: "accrual", currency: "USD", period: "this_month" },
      created_at: "2026-09-14T08:30:00Z",
    },
    {
      id: 2,
      report_key: "balance-sheet",
      export_format: "csv",
      user_email: "admin@hrflow.test",
      row_count: 12,
      file_name: "balance_sheet_2026-09-14.csv",
      filters: { basis: "accrual", as_of_date: "2026-09-14" },
      created_at: "2026-09-14T09:00:00Z",
    },
  ];
  }

  if (!FinanceMockState.reportSchedules) {
    FinanceMockState.reportSchedules = [
    {
      id: 1,
      report_key: "profit-and-loss",
      report_title: "Profit & Loss Statement (P&L)",
      frequency: "monthly",
      recipients: ["finance-team@voyance.health", "cfo@voyance.health"],
      export_format: "xlsx",
      filters: { basis: "accrual", currency: "USD" },
      is_active: true,
      created_by: "admin@hrflow.test",
      created_at: "2026-09-01T08:00:00Z",
    },
    {
      id: 2,
      report_key: "ar-aging",
      report_title: "Accounts Receivable (AR) Aging",
      frequency: "weekly",
      recipients: ["collections@voyance.health"],
      export_format: "csv",
      filters: { currency: "USD" },
      is_active: true,
      created_by: "admin@hrflow.test",
      created_at: "2026-09-02T11:00:00Z",
    },
  ];
  }

  const FinanceReportsApi = {
// 10. Financial Reports & Excel Export (Phase 8)
  // ==========================================
  async getCategorySummaryReport(params = {}) {
    if (_isMock()) {
      return {
        date_from: params.date_from || "2026-09-01",
        date_to: params.date_to || "2026-09-30",
        currency: params.currency || null,
        total_spent: 42500.0,
        categories: [
          { category_id: 2, category_name: "Salaries", kind: "cost", transaction_count: 8, total_amount: 28000.0, percentage: 65.88 },
          { category_id: 1, category_name: "Hosting Cloud Infrastructure", kind: "cost", transaction_count: 4, total_amount: 6200.0, percentage: 14.59 },
          { category_id: 6, category_name: "Rent & Facilities", kind: "cost", transaction_count: 1, total_amount: 4500.0, percentage: 10.59 },
          { category_id: 3, category_name: "Medical Insurance", kind: "cost", transaction_count: 3, total_amount: 2500.0, percentage: 5.88 },
          { category_id: 4, category_name: "Kitchen Supplies", kind: "cost", transaction_count: 6, total_amount: 1300.0, percentage: 3.06 },
        ],
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/category-summary${qs ? "?" + qs : ""}`);
  },

  async getCategoryMatrixReport(params = {}) {
    const yr = params.year || 2026;
    const grp = params.period_group || "month";
    if (_isMock()) {
      const isQuarter = grp === "quarter";
      return {
        year: yr,
        period_group: grp,
        currency: params.currency || null,
        period_labels: isQuarter ? ["Q1", "Q2", "Q3", "Q4"] : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        year_total: 382400.0,
        period_totals: isQuarter
          ? { Q1: 92000.0, Q2: 96500.0, Q3: 98400.0, Q4: 95500.0 }
          : { Jan: 30000.0, Feb: 31000.0, Mar: 31000.0, Apr: 32000.0, May: 32000.0, Jun: 32500.0, Jul: 32500.0, Aug: 33000.0, Sep: 32900.0, Oct: 31500.0, Nov: 32000.0, Dec: 32000.0 },
        rows: [
          {
            category_id: 2,
            category_name: "Salaries",
            periods: isQuarter
              ? { Q1: 60000.0, Q2: 63000.0, Q3: 65000.0, Q4: 63000.0 }
              : { Jan: 20000.0, Feb: 20000.0, Mar: 20000.0, Apr: 21000.0, May: 21000.0, Jun: 21000.0, Jul: 21500.0, Aug: 21500.0, Sep: 22000.0, Oct: 21000.0, Nov: 21000.0, Dec: 21000.0 },
            total: 251000.0,
            percentage: 65.64,
          },
          {
            category_id: 1,
            category_name: "Hosting Cloud Infrastructure",
            periods: isQuarter
              ? { Q1: 15000.0, Q2: 16000.0, Q3: 16500.0, Q4: 16000.0 }
              : { Jan: 5000.0, Feb: 5000.0, Mar: 5000.0, Apr: 5200.0, May: 5300.0, Jun: 5500.0, Jul: 5400.0, Aug: 5500.0, Sep: 5600.0, Oct: 5300.0, Nov: 5300.0, Dec: 5400.0 },
            total: 63500.0,
            percentage: 16.61,
          },
          {
            category_id: 6,
            category_name: "Rent & Facilities",
            periods: isQuarter
              ? { Q1: 13500.0, Q2: 13500.0, Q3: 13500.0, Q4: 13500.0 }
              : { Jan: 4500.0, Feb: 4500.0, Mar: 4500.0, Apr: 4500.0, May: 4500.0, Jun: 4500.0, Jul: 4500.0, Aug: 4500.0, Sep: 4500.0, Oct: 4500.0, Nov: 4500.0, Dec: 4500.0 },
            total: 54000.0,
            percentage: 14.12,
          },
        ],
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/category-by-period-matrix${qs ? "?" + qs : ""}`);
  },

  async getBalancesReport(params = {}) {
    if (_isMock()) {
      return {
        as_of_date: params.as_of_date || new Date().toISOString().slice(0, 10),
        accounts: (FinanceMockState.accounts || []).map((a) => ({
          account_id: a.id,
          account_name: a.account_name,
          bank_name: a.bank_name || "—",
          account_number: a.account_number,
          currency: a.currency,
          account_type: a.account_type,
          country: a.country || "Egypt",
          opening_balance: a.opening_balance,
          balance_as_of_date: a.current_balance,
        })),
        currency_totals: {
          USD: 650000.0,
          EGP: 470000.0,
        },
        country_totals: {
          Egypt: { EGP: 470000.0 },
          "United States": { USD: 650000.0 },
        },
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/balances${qs ? "?" + qs : ""}`);
  },

  async getTransactionsReport(params = {}) {
    if (_isMock()) {
      return {
        date_from: params.date_from || "2026-09-01",
        date_to: params.date_to || "2026-09-30",
        count: 4,
        total_inflows: 20900.0,
        total_outflows: 4520.0,
        net_change: 16380.0,
        transactions: [
          {
            id: 1,
            date: "2026-09-01",
            account_name: "Voyance Operating USD",
            direction: "in",
            amount: 12500.0,
            currency: "USD",
            category_name: "Revenue",
            payment_type_name: "Incoming Wire",
            reference: "INV-2026-001",
            description: "Apex Health payment",
            cheque_number: "",
            running_balance: 162500.0,
          },
          {
            id: 2,
            date: "2026-09-02",
            account_name: "Voyance Operating USD",
            direction: "out",
            amount: 4200.0,
            currency: "USD",
            category_name: "Hosting Cloud Infrastructure",
            payment_type_name: "Cheque",
            reference: "BILL-2026-001",
            description: "AWS cloud hosting payment",
            cheque_number: "001011",
            running_balance: 158300.0,
          },
          {
            id: 3,
            date: "2026-09-03",
            account_name: "Voyance Operating USD",
            direction: "out",
            amount: 320.0,
            currency: "USD",
            category_name: "SaaS",
            payment_type_name: "Debit Card",
            reference: "BILL-2026-002",
            description: "Slack monthly renewal",
            cheque_number: "",
            running_balance: 157980.0,
          },
          {
            id: 4,
            date: "2026-09-05",
            account_name: "Voyance Treasury Reserve",
            direction: "in",
            amount: 8400.0,
            currency: "USD",
            category_name: "Revenue",
            payment_type_name: "Internal Transfer",
            reference: "INV-2026-002",
            description: "BioCare Diagnostics SaaS",
            cheque_number: "",
            running_balance: 508400.0,
          },
        ],
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/transactions${qs ? "?" + qs : ""}`);
  },

  async getChequesReport(params = {}) {
    if (_isMock()) {
      const fy = params.fiscal_year || 2026;
      const list = FinanceMockState.cheques || [];
      const totalAmt = list.reduce((acc, c) => acc + Number(c.amount || 0), 0);
      const cleared = list.filter((c) => c.status === "cleared");
      const issued = list.filter((c) => c.status === "issued");
      return {
        fiscal_year: fy,
        summary: {
          total_count: list.length,
          total_amount: totalAmt,
          by_status: {
            issued: { count: issued.length, amount: issued.reduce((acc, c) => acc + Number(c.amount || 0), 0) },
            cleared: { count: cleared.length, amount: cleared.reduce((acc, c) => acc + Number(c.amount || 0), 0) },
            bounced: { count: 0, amount: 0.0 },
            voided: { count: 0, amount: 0.0 },
          },
        },
        cheques: list,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/cheques${qs ? "?" + qs : ""}`);
  },

  downloadExcelUrl(endpoint, params = {}) {
    const p = { ...params, format: "xlsx" };
    const qs = new URLSearchParams(p).toString();
    return `${API_BASE_URL}${endpoint}?${qs}`;
  },

  // ==========================================
  // Story 7.1: Standard Report Library & Shell
  // ==========================================
  async getReportLibrary() {
    if (_isMock()) {
      return {
        categories: ["Performance", "Cash & Banking", "Sales & Receivables", "Spend & Payables", "Payroll", "Audit & Compliance"],
        reports: [
          {
            key: "category-summary",
            title: "Category Spend Rollup",
            category: "Performance",
            business_question: "Where are company operational outflows being spent across budget categories?",
            description: "Monthly expense aggregation and budget percentage allocation mirroring the SPENT block.",
            icon: "fa-solid fa-chart-pie",
            supported_basis: ["cash", "accrual"],
            supported_formats: ["json", "xlsx"],
            badge: "Core Spend",
          },
          {
            key: "matrix",
            title: "Annual Spend Matrix",
            category: "Performance",
            business_question: "How does category spend trend across months and fiscal quarters?",
            description: "Comprehensive cross-tabulation of category expenses across months or quarters with row totals.",
            icon: "fa-solid fa-table-cells",
            supported_basis: ["cash", "accrual"],
            supported_formats: ["json", "xlsx"],
            badge: "Trend Analysis",
          },
          {
            key: "balances",
            title: "Point-in-Time Balances",
            category: "Cash & Banking",
            business_question: "What was our cash and liquidity position on any specific historical date?",
            description: "Historical balance calculations for all active bank and cash accounts as of a cutoff date.",
            icon: "fa-solid fa-scale-balanced",
            supported_basis: ["cash"],
            supported_formats: ["json", "xlsx"],
            badge: "Liquidity",
          },
          {
            key: "cash-forecast",
            title: "Cash Position & 30/60/90-Day Forecast",
            category: "Cash & Banking",
            business_question: "What is our net projected cash flow and liquidity runway over the next 90 days?",
            description: "Forward-looking cash projections incorporating confirmed receivables, bills, and subscriptions.",
            icon: "fa-solid fa-chart-line",
            supported_basis: ["cash"],
            supported_formats: ["json"],
            badge: "Planning",
          },
          {
            key: "reconciliation-summary",
            title: "Bank Reconciliation Summary",
            category: "Cash & Banking",
            business_question: "Which bank accounts and monthly statement periods are reconciled, closed, or pending review?",
            description: "Overview of statement reconciliation completion status, book variances, and period locks.",
            icon: "fa-solid fa-file-invoice-dollar",
            supported_basis: ["cash"],
            supported_formats: ["json"],
            badge: "Control",
          },
          {
            key: "invoices-summary",
            title: "Customer Receivables & Sales Summary",
            category: "Sales & Receivables",
            business_question: "What is our revenue run rate and outstanding receivables exposure by customer?",
            description: "Sales invoice status breakdown, collections aging, and revenue channel distribution.",
            icon: "fa-solid fa-file-invoice",
            supported_basis: ["accrual", "cash"],
            supported_formats: ["json"],
            badge: "Revenue",
          },
          {
            key: "bills-summary",
            title: "Vendor Payables & Commitments Schedule",
            category: "Spend & Payables",
            business_question: "What vendor liabilities and upcoming disbursements are scheduled for payment?",
            description: "Vendor bill approval queues, payment readiness, and upcoming payment obligations.",
            icon: "fa-solid fa-receipt",
            supported_basis: ["accrual", "cash"],
            supported_formats: ["json"],
            badge: "Payables",
          },
          {
            key: "subscriptions-summary",
            title: "Recurring Spend & SaaS Commitments",
            category: "Spend & Payables",
            business_question: "What are our recurring software, cloud infrastructure, and tool commitments?",
            description: "Active subscription contracts, upcoming renewal dates, and monthly equivalent run rates.",
            icon: "fa-solid fa-repeat",
            supported_basis: ["accrual", "cash"],
            supported_formats: ["json"],
            badge: "Commitments",
          },
          {
            key: "payroll-summary",
            title: "Payroll Register & Compensation Outflows",
            category: "Payroll",
            business_question: "How much did net salaries, employee benefits, and payroll taxes cost per cycle?",
            description: "Monthly payroll register aggregation across active staff and department allocations.",
            icon: "fa-solid fa-users",
            supported_basis: ["cash", "accrual"],
            supported_formats: ["json"],
            badge: "Payroll",
          },
          {
            key: "compensation-summary",
            title: "Compensation Spend & Variance Report",
            category: "Payroll",
            business_question: "What is total company compensation spend across external, internal, commission, and bonus pay?",
            description: "Granular compensation reporting per employee and company-wide across flexible date ranges.",
            icon: "fa-solid fa-money-bill-wave",
            supported_basis: ["cash", "accrual"],
            supported_formats: ["json"],
            badge: "Spend",
          },
          {
            key: "statutory-remitted",
            title: "Statutory Obligations Remitted Report",
            category: "Payroll",
            business_question: "How much tax and social insurance has been officially paid and remitted to authorities?",
            description: "Summary of settled statutory obligations by period and tax/insurance obligation type.",
            icon: "fa-solid fa-landmark",
            supported_basis: ["cash"],
            supported_formats: ["json"],
            badge: "Compliance",
          },
          {
            key: "payable-status",
            title: "Payroll & Statutory Settlement Status",
            category: "Payroll",
            business_question: "What is the settlement status (pending vs settled) of employee payouts, taxes, and social insurance?",
            description: "Unified view tracking pending vs settled amounts for external wire, internal cash, tax, and insurance flows.",
            icon: "fa-solid fa-money-bill-transfer",
            supported_basis: ["cash", "accrual"],
            supported_formats: ["json"],
            badge: "Payables",
          },
          {
            key: "transactions",
            title: "Continuous Transaction Ledger",
            category: "Audit & Compliance",
            business_question: "What is the detailed, auditable transaction log across all accounts and categories?",
            description: "Filterable general ledger transaction journal with running balances and reference links.",
            icon: "fa-solid fa-list-check",
            supported_basis: ["cash", "accrual"],
            supported_formats: ["json", "xlsx"],
            badge: "General Ledger",
          },
          {
            key: "cheques",
            title: "Cheque Register & Clear Status",
            category: "Audit & Compliance",
            business_question: "What is the status, clearing trail, and presentment date of all company issued cheques?",
            description: "Cheque register filtered by fiscal year and account with status breakdown.",
            icon: "fa-solid fa-money-check",
            supported_basis: ["cash"],
            supported_formats: ["json", "xlsx"],
            badge: "Audit",
          },
          {
            key: "profit-and-loss",
            title: "Profit & Loss Statement (P&L)",
            category: "Performance",
            business_question: "What was the company's operating revenue, expense allocation, and net bottom line profit?",
            description: "Standard income statement categorizing operational revenues, cost outflows, and net margin %.",
            icon: "fa-solid fa-file-invoice-dollar",
            supported_basis: ["cash", "accrual"],
            supported_formats: ["json", "xlsx", "csv", "pdf"],
            badge: "Core Financial",
          },
          {
            key: "cash-flow",
            title: "Statement of Cash Flows",
            category: "Cash & Banking",
            business_question: "How did cash inflows and outflows reconcile between operating, investing, and financing activities?",
            description: "Comprehensive cash flow statement reconciling beginning to ending cash balances.",
            icon: "fa-solid fa-money-bill-trend-up",
            supported_basis: ["cash"],
            supported_formats: ["json", "xlsx", "csv", "pdf"],
            badge: "Cash Flow",
          },
          {
            key: "ar-aging",
            title: "Accounts Receivable (AR) Aging",
            category: "Sales & Receivables",
            business_question: "How overdue are client invoice balances partitioned across 30-day aging buckets?",
            description: "Customer invoice aging schedule categorized into current, 1-30, 31-60, 61-90, and 90+ day tiers.",
            icon: "fa-solid fa-user-clock",
            supported_basis: ["accrual"],
            supported_formats: ["json", "xlsx", "csv", "pdf"],
            badge: "Aging",
          },
          {
            key: "ap-aging",
            title: "Accounts Payable (AP) Aging",
            category: "Spend & Payables",
            business_question: "What vendor bills and disbursements are due or past due across 30-day aging buckets?",
            description: "Vendor bill aging schedule partitioned into current, 1-30, 31-60, 61-90, and 90+ day tiers.",
            icon: "fa-solid fa-receipt",
            supported_basis: ["accrual"],
            supported_formats: ["json", "xlsx", "csv", "pdf"],
            badge: "Aging",
          },
          {
            key: "balance-sheet",
            title: "Balance Sheet (Statement of Financial Position)",
            category: "Audit & Compliance",
            business_question: "What are company total assets, liabilities, and owners' equity balances as of a cutoff date?",
            description: "Core balance sheet statement enforcing the fundamental accounting equation Assets = Liabilities + Equity.",
            icon: "fa-solid fa-building-columns",
            supported_basis: ["accrual"],
            supported_formats: ["json", "xlsx", "csv", "pdf"],
            badge: "Core Financial",
          },
          {
            key: "trial-balance",
            title: "Trial Balance Ledger Audit",
            category: "Audit & Compliance",
            business_question: "Do total debit balances equal total credit balances across all active chart of accounts?",
            description: "Audit report verifying zero debit-credit variance across all posted ledger lines.",
            icon: "fa-solid fa-scale-unbalanced",
            supported_basis: ["accrual", "cash"],
            supported_formats: ["json", "xlsx", "csv", "pdf"],
            badge: "Audit",
          },
        ],
      };
    }
    return apiRequest("GET", "/api/finance/reports/library");
  },

  async getSavedReportViews(reportKey) {
    if (_isMock()) {
      let views = FinanceMockState.savedReportViews || [
        {
          id: 1,
          report_key: "category-summary",
          view_name: "Executive USD View",
          filters: { period: "QTD", basis: "accrual", currency: "USD" },
          is_default: true,
          created_by: "admin@hrflow.test",
          created_at: new Date().toISOString(),
        },
      ];
      if (reportKey) views = views.filter((v) => v.report_key === reportKey);
      return views;
    }
    const q = reportKey ? `?report_key=${encodeURIComponent(reportKey)}` : "";
    return apiRequest("GET", `/api/finance/reports/saved-views${q}`);
  },

  async createSavedReportView(payload) {
    if (_isMock()) {
      if (!FinanceMockState.savedReportViews) FinanceMockState.savedReportViews = [];
      if (payload.is_default) {
        FinanceMockState.savedReportViews.forEach((v) => {
          if (v.report_key === payload.report_key) v.is_default = false;
        });
      }
      const newV = {
        id: Date.now(),
        report_key: payload.report_key,
        view_name: payload.view_name,
        filters: payload.filters || {},
        is_default: !!payload.is_default,
        created_by: "admin@hrflow.test",
        created_at: new Date().toISOString(),
      };
      FinanceMockState.savedReportViews.push(newV);
      return newV;
    }
    return apiRequest("POST", "/api/finance/reports/saved-views", payload);
  },

  async deleteSavedReportView(viewId) {
    if (_isMock()) {
      if (FinanceMockState.savedReportViews) {
        FinanceMockState.savedReportViews = FinanceMockState.savedReportViews.filter((v) => v.id !== parseInt(viewId, 10));
      }
      return { success: true, id: viewId };
    }
    return apiRequest("DELETE", `/api/finance/reports/saved-views/${viewId}`);
  },

  async getReportDrilldown(params = {}) {
    if (_isMock()) {
      const isCat = params.drilldown_type === "category";
      return {
        report_key: params.report_key || "category-summary",
        drilldown_type: params.drilldown_type || "category",
        target_title: isCat ? "Category: Hosting Cloud Infrastructure" : "Account: Voyance Operating USD",
        total_records: 2,
        total_amount: 5400.0,
        currency: params.currency || "USD",
        records: [
          {
            id: 101,
            date: "2026-09-02",
            description: "AWS Cloud Compute Hosting",
            reference: "AWS-EC2-01",
            category: "Hosting Cloud Infrastructure",
            amount: 4200.0,
            currency: "USD",
            direction: "out",
          },
          {
            id: 102,
            date: "2026-09-04",
            description: "Cloudflare Enterprise Security",
            reference: "CF-INV-02",
            category: "Hosting Cloud Infrastructure",
            amount: 1200.0,
            currency: "USD",
            direction: "out",
          },
        ],
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/drilldown${qs ? "?" + qs : ""}`);
  },

  async getProfitAndLossReport(params = {}) {
    if (_isMock()) {
      const basis = params.basis || "cash";
      return {
        report_title: "Profit & Loss Statement",
        entity: params.entity || "Voyance Health (Consolidated)",
        basis,
        currency: params.currency || "USD",
        period_start: params.date_from || "2026-09-01",
        period_end: params.date_to || "2026-09-30",
        comparison_type: params.comparison || "none",
        revenue_items: [
          { category_name: "Diagnostic Imaging & PACS Software", amount: 95000.0, percentage: 76.0 },
          { category_name: "Maintenance & Platform Consulting", amount: 30000.0, percentage: 24.0 },
        ],
        total_revenue: 125000.0,
        prior_revenue: 110000.0,
        expense_items: [
          { category_name: "Cloud Hosting & AWS Compute Infrastructure", amount: 38000.0, percentage: 55.9 },
          { category_name: "Cairo & Dover Office Facilities", amount: 20000.0, percentage: 29.4 },
          { category_name: "Legal, Tax & Statutory Audit", amount: 10000.0, percentage: 14.7 },
        ],
        total_expenses: 68000.0,
        prior_expenses: 62000.0,
        net_income: 57000.0,
        prior_net_income: 48000.0,
        net_margin_pct: 45.6,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/profit-and-loss${qs ? "?" + qs : ""}`);
  },

  async getBalanceSheetReport(params = {}) {
    if (_isMock()) {
      return {
        report_title: "Balance Sheet",
        entity: params.entity || "Voyance Health (Consolidated)",
        as_of_date: params.as_of_date || "2026-09-14",
        currency: params.currency || "USD",
        basis: params.basis || "accrual",
        assets: {
          title: "Assets",
          items: [
            { name: "Chase Operating Primary (USD)", amount: 220000.0, note: "Liquid cash" },
            { name: "Accounts Receivable (Trade Debtors)", amount: 90000.0, note: "Open client receivables" },
          ],
          total: 310000.0,
        },
        liabilities: {
          title: "Liabilities",
          items: [
            { name: "Accounts Payable (Trade Creditors)", amount: 35000.0, note: "Open vendor bills" },
            { name: "Cheques Payable (Issued / In Transit)", amount: 10000.0, note: "Outstanding cheques" },
          ],
          total: 45000.0,
        },
        equity: {
          title: "Equity",
          items: [
            { name: "Retained Earnings & Cumulative Net Income", amount: 265000.0, note: "Balanced equity" },
          ],
          total: 265000.0,
        },
        total_assets: 310000.0,
        total_liabilities_and_equity: 310000.0,
        is_balanced: true,
        variance: 0.0,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/balance-sheet${qs ? "?" + qs : ""}`);
  },

  async getTrialBalanceReport(params = {}) {
    if (_isMock()) {
      return {
        report_title: "Trial Balance",
        entity: params.entity || "Voyance Health (Consolidated)",
        as_of_date: params.as_of_date || "2026-09-14",
        currency: params.currency || "USD",
        lines: [
          { code: "1000-01", name: "Chase Operating Primary (USD)", type: "asset", debit: 220000.0, credit: 0.0 },
          { code: "1100-AR", name: "Accounts Receivable (Trade)", type: "asset", debit: 90000.0, credit: 0.0 },
          { code: "2000-AP", name: "Accounts Payable (Trade)", type: "liability", debit: 0.0, credit: 35000.0 },
          { code: "2100-CP", name: "Cheques Payable", type: "liability", debit: 0.0, credit: 10000.0 },
          { code: "3000-EQ", name: "Retained Earnings / Owners' Equity", type: "equity", debit: 0.0, credit: 265000.0 },
        ],
        total_debits: 310000.0,
        total_credits: 310000.0,
        variance: 0.0,
        is_balanced: true,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/trial-balance${qs ? "?" + qs : ""}`);
  },

  async getCashFlowReport(params = {}) {
    if (_isMock()) {
      return {
        report_title: "Statement of Cash Flows",
        entity: params.entity || "Voyance Health (Consolidated)",
        currency: params.currency || "USD",
        date_from: params.date_from || "2026-09-01",
        date_to: params.date_to || "2026-09-30",
        operating_activities: [
          { name: "Cash Receipts from Customers & Operational Inflows", amount: 95000.0, activity_type: "operating" },
          { name: "Cash Payments for Suppliers & Operational Outflows", amount: -55000.0, activity_type: "operating" },
        ],
        net_cash_operating: 40000.0,
        investing_activities: [],
        net_cash_investing: 0.0,
        financing_activities: [],
        net_cash_financing: 0.0,
        net_change_in_cash: 40000.0,
        beginning_cash_balance: 180000.0,
        ending_cash_balance: 220000.0,
        is_reconciled: true,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/cash-flow${qs ? "?" + qs : ""}`);
  },

  async getArAgingReport(params = {}) {
    if (_isMock()) {
      return {
        report_title: "Accounts Receivable (AR) Aging",
        aging_type: "ar",
        entity: params.entity || "Voyance Health (Consolidated)",
        as_of_date: params.as_of_date || "2026-09-14",
        currency: params.currency || "USD",
        rows: [
          {
            id: 1,
            name: "Acme Health Systems",
            buckets: { current: 30000.0, days_1_30: 20000.0, days_31_60: 10000.0, days_61_90: 0.0, days_over_90: 0.0, total: 60000.0 },
            outstanding_count: 3,
          },
          {
            id: 2,
            name: "Apex Diagnostic Imaging",
            buckets: { current: 15000.0, days_1_30: 5000.0, days_31_60: 5000.0, days_61_90: 5000.0, days_over_90: 0.0, total: 30000.0 },
            outstanding_count: 2,
          },
        ],
        totals: { current: 45000.0, days_1_30: 25000.0, days_31_60: 15000.0, days_61_90: 5000.0, days_over_90: 0.0, total: 90000.0 },
        total_open_count: 5,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/ar-aging${qs ? "?" + qs : ""}`);
  },

  async getApAgingReport(params = {}) {
    if (_isMock()) {
      return {
        report_title: "Accounts Payable (AP) Aging",
        aging_type: "ap",
        entity: params.entity || "Voyance Health (Consolidated)",
        as_of_date: params.as_of_date || "2026-09-14",
        currency: params.currency || "USD",
        rows: [
          {
            id: 1,
            name: "Cloud Datacenter Inc",
            buckets: { current: 12000.0, days_1_30: 8000.0, days_31_60: 0.0, days_61_90: 0.0, days_over_90: 0.0, total: 20000.0 },
            outstanding_count: 2,
          },
          {
            id: 2,
            name: "Office Space Holdings",
            buckets: { current: 8000.0, days_1_30: 2000.0, days_31_60: 5000.0, days_61_90: 0.0, days_over_90: 0.0, total: 15000.0 },
            outstanding_count: 1,
          },
        ],
        totals: { current: 20000.0, days_1_30: 10000.0, days_31_60: 5000.0, days_61_90: 0.0, days_over_90: 0.0, total: 35000.0 },
        total_open_count: 3,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/ap-aging${qs ? "?" + qs : ""}`);
  },

  // ==========================================
  // Story 7.3: Controlled Exports & Scheduled Delivery
  // ==========================================
  async exportReport(payload) {
    if (_isMock()) {
      if (!FinanceMockState.reportExportAudits) FinanceMockState.reportExportAudits = [];
      const ext = payload.format === "xlsx" ? "xlsx" : (payload.format === "pdf" ? "pdf" : "csv");
      const fileName = `${payload.report_key}_export_${new Date().toISOString().slice(0, 10)}.${ext}`;
      const audit = {
        id: Date.now(),
        report_key: payload.report_key,
        export_format: payload.format,
        user_email: "admin@hrflow.test",
        row_count: 24,
        file_name: fileName,
        filters: payload.filters || {},
        created_at: new Date().toISOString(),
      };
      FinanceMockState.reportExportAudits.unshift(audit);

      const mime = ext === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : (ext === "pdf" ? "application/pdf" : "text/csv;charset=utf-8;");
      const dummyContent = ext === "csv"
        ? `# Report: ${payload.report_key}\n# Generated: ${new Date().toISOString()}\nAccount,Amount\nTotal,10000\n`
        : "HRFlow Mock Binary Export Content";
      const blob = new Blob([dummyContent], { type: mime });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      return { success: true, file_name: fileName };
    }

    const res = await fetch(`${API_BASE_URL}/api/finance/reports/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      if (typeof forceSessionExpiredLogout === "function") forceSessionExpiredLogout();
      throw new Error("Session expired. Please sign in again.");
    }
    if (!res.ok) {
      let detail = `Export failed (${res.status})`;
      try {
        const data = await res.json();
        detail = data.detail || data.error || detail;
      } catch (_) {}
      throw new Error(detail);
    }

    let fileName = `${payload.report_key}_export.${payload.format}`;
    const disp = res.headers.get("Content-Disposition");
    if (disp && disp.includes("filename=")) {
      const m = disp.match(/filename="?([^"]+)"?/);
      if (m && m[1]) fileName = m[1];
    }

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    return { success: true, file_name: fileName };
  },

  async getExportAudits(reportKey, limit = 50) {
    if (_isMock()) {
      let list = [...(FinanceMockState.reportExportAudits || [])];
      if (reportKey) list = list.filter((a) => a.report_key === reportKey);
      return list.slice(0, limit);
    }
    const params = new URLSearchParams();
    if (reportKey) params.set("report_key", reportKey);
    if (limit) params.set("limit", limit);
    return apiRequest("GET", `/api/finance/reports/export-audits?${params.toString()}`);
  },

  async getReportSchedules(reportKey) {
    if (_isMock()) {
      let list = [...(FinanceMockState.reportSchedules || [])];
      if (reportKey) list = list.filter((s) => s.report_key === reportKey);
      return list;
    }
    const qs = reportKey ? `?report_key=${encodeURIComponent(reportKey)}` : "";
    return apiRequest("GET", `/api/finance/reports/schedules${qs}`);
  },

  async createReportSchedule(payload) {
    if (_isMock()) {
      if (!FinanceMockState.reportSchedules) FinanceMockState.reportSchedules = [];
      const newSched = {
        id: Date.now(),
        report_key: payload.report_key,
        report_title: payload.report_title || payload.report_key,
        frequency: payload.frequency || "monthly",
        recipients: Array.isArray(payload.recipients) ? payload.recipients : (payload.recipients || "").split(",").map(e => e.trim()).filter(Boolean),
        export_format: payload.export_format || "xlsx",
        filters: payload.filters || {},
        is_active: true,
        created_by: "admin@hrflow.test",
        created_at: new Date().toISOString(),
      };
      FinanceMockState.reportSchedules.unshift(newSched);
      return newSched;
    }
    return apiRequest("POST", "/api/finance/reports/schedules", payload);
  },

  async deleteReportSchedule(scheduleId) {
    if (_isMock()) {
      if (FinanceMockState.reportSchedules) {
        FinanceMockState.reportSchedules = FinanceMockState.reportSchedules.filter(
          (s) => s.id !== parseInt(scheduleId, 10)
        );
      }
      return { success: true, id: scheduleId };
    }
    return apiRequest("DELETE", `/api/finance/reports/schedules/${scheduleId}`);
  },

  // ==========================================
  // FUX-419: Compensation Spend & Variance Reporting
  // ==========================================
  async getEmployeeCompensationReport(employeeId, params = {}) {
    if (_isMock()) {
      return {
        employee_id: employeeId,
        employee_name: "Sarah Jenkins",
        department: "Engineering",
        start_date: params.start_date || "2026-09-01",
        end_date: params.end_date || "2026-10-31",
        currency: params.currency || "USD",
        by_compensation_type: {
          external_usd: 6000.0,
          internal_usd_cash: 3000.0,
          commission_sales: 500.0,
          bonus: 200.0,
        },
        total_external: 6000.0,
        total_internal: 3000.0,
        total_commission: 500.0,
        total_bonus: 200.0,
        grand_total: 9700.0,
        payroll_runs_count: 2,
        lines: [
          { id: 101, payroll_run_id: 1, period_label: "2026-09", compensation_type: "external_usd", base_salary: 3000.0, allowances_total: 0.0, deductions_total: 0.0, tax_amount: 0.0, net_pay: 3000.0, employer_cost_extra: 0.0, payment_status: "paid", paid_at: "2026-09-30T10:00:00Z" },
          { id: 102, payroll_run_id: 1, period_label: "2026-09", compensation_type: "internal_usd_cash", base_salary: 1500.0, allowances_total: 0.0, deductions_total: 75.0, tax_amount: 150.0, net_pay: 1275.0, employer_cost_extra: 180.0, payment_status: "paid", paid_at: "2026-09-30T10:00:00Z" },
          { id: 103, payroll_run_id: 1, period_label: "2026-09", compensation_type: "commission_sales", base_salary: 500.0, allowances_total: 0.0, deductions_total: 25.0, tax_amount: 50.0, net_pay: 425.0, employer_cost_extra: 60.0, payment_status: "paid", paid_at: "2026-09-30T10:00:00Z" },
          { id: 104, payroll_run_id: 2, period_label: "2026-10", compensation_type: "external_usd", base_salary: 3000.0, allowances_total: 0.0, deductions_total: 0.0, tax_amount: 0.0, net_pay: 3000.0, employer_cost_extra: 0.0, payment_status: "pending", paid_at: null },
          { id: 105, payroll_run_id: 2, period_label: "2026-10", compensation_type: "internal_usd_cash", base_salary: 1500.0, allowances_total: 0.0, deductions_total: 75.0, tax_amount: 150.0, net_pay: 1275.0, employer_cost_extra: 180.0, payment_status: "pending", paid_at: null },
          { id: 106, payroll_run_id: 2, period_label: "2026-10", compensation_type: "bonus", base_salary: 200.0, allowances_total: 0.0, deductions_total: 10.0, tax_amount: 20.0, net_pay: 170.0, employer_cost_extra: 24.0, payment_status: "pending", paid_at: null },
        ],
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/compensation/employee/${employeeId}${qs ? "?" + qs : ""}`);
  },

  async getCompanyCompensationReport(params = {}) {
    if (_isMock()) {
      return {
        start_date: params.start_date || "2026-09-01",
        end_date: params.end_date || "2026-10-31",
        currency: params.currency || "USD",
        by_compensation_type: {
          external_usd: 12000.0,
          internal_usd_cash: 7000.0,
          commission_sales: 1500.0,
          bonus: 600.0,
        },
        total_external: 12000.0,
        total_internal: 7000.0,
        total_commission: 1500.0,
        total_bonus: 600.0,
        grand_total: 21100.0,
        total_headcount: 3,
        payroll_runs_count: 2,
        employees: [
          { employee_id: 1, employee_name: "Sarah Jenkins", department: "Engineering", by_compensation_type: { external_usd: 6000.0, internal_usd_cash: 3000.0, commission_sales: 500.0, bonus: 200.0 }, total_external: 6000.0, total_internal: 3000.0, total_commission: 500.0, total_bonus: 200.0, grand_total: 9700.0, lines_count: 6 },
          { employee_id: 2, employee_name: "Marcus Vance", department: "Sales", by_compensation_type: { external_usd: 4000.0, internal_usd_cash: 2000.0, commission_sales: 1000.0, bonus: 400.0 }, total_external: 4000.0, total_internal: 2000.0, total_commission: 1000.0, total_bonus: 400.0, grand_total: 7400.0, lines_count: 6 },
          { employee_id: 3, employee_name: "Elena Rostova", department: "Operations", by_compensation_type: { external_usd: 2000.0, internal_usd_cash: 2000.0 }, total_external: 2000.0, total_internal: 2000.0, total_commission: 0.0, total_bonus: 0.0, grand_total: 4000.0, lines_count: 4 },
        ],
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/compensation/company${qs ? "?" + qs : ""}`);
  },

  async getStatutoryRemittedReport(params = {}) {
    if (_isMock()) {
      return {
        start_date: params.start_date || "2026-09-01",
        end_date: params.end_date || "2026-10-31",
        currency: params.currency || "USD",
        total_remitted: 3450.0,
        by_obligation_type: {
          income_tax: 1500.0,
          social_insurance_employee: 750.0,
          social_insurance_employer: 1200.0,
        },
        by_period: {
          "2026-09": 3450.0,
        },
        items: [
          { id: 1, period: "2026-09", obligation_type: "income_tax", amount_remitted: 1500.0, amount_accrued: 1500.0, currency: "USD", status: "remitted", due_date: "2026-10-15", source_type: "payroll_run", source_id: 1, notes: "Payroll 2026-09 - Salary Income Tax Withheld" },
          { id: 2, period: "2026-09", obligation_type: "social_insurance_employee", amount_remitted: 750.0, amount_accrued: 750.0, currency: "USD", status: "remitted", due_date: "2026-10-15", source_type: "payroll_run", source_id: 1, notes: "Payroll 2026-09 - Employee Social Insurance" },
          { id: 3, period: "2026-09", obligation_type: "social_insurance_employer", amount_remitted: 1200.0, amount_accrued: 1200.0, currency: "USD", status: "remitted", due_date: "2026-10-15", source_type: "payroll_run", source_id: 1, notes: "Payroll 2026-09 - Employer Social Insurance" },
        ],
        obligations_count: 3,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/statutory/remitted${qs ? "?" + qs : ""}`);
  },

  async getPayableStatusReport(params = {}) {
    if (_isMock()) {
      return {
        period: params.period || "2026-09",
        start_date: params.start_date || null,
        end_date: params.end_date || null,
        employee_id: params.employee_id ? parseInt(params.employee_id, 10) : null,
        currency: params.currency || "USD",
        flows: [
          { flow_type: "external_transfer", label: "External Wire Transfers", pending_amount: 0.0, settled_amount: 6000.0, total_amount: 6000.0, status: "settled" },
          { flow_type: "internal_cash", label: "Internal Cash Payroll", pending_amount: 0.0, settled_amount: 3500.0, total_amount: 3500.0, status: "settled" },
          { flow_type: "tax_obligation", label: "Income Tax Obligations", pending_amount: 0.0, settled_amount: 1500.0, total_amount: 1500.0, status: "settled" },
          { flow_type: "insurance_obligation", label: "Social Insurance Obligations", pending_amount: 1950.0, settled_amount: 0.0, total_amount: 1950.0, status: "pending" },
        ],
        total_pending: 1950.0,
        total_settled: 11000.0,
        grand_total: 12950.0,
        employee_breakdown: [
          { employee_id: 1, employee_name: "Sarah Jenkins", department: "Engineering", external_pending: 0.0, external_settled: 3000.0, internal_pending: 0.0, internal_settled: 1700.0, tax_pending: 0.0, tax_settled: 200.0, insurance_pending: 289.0, insurance_settled: 0.0, total_pending: 289.0, total_settled: 4900.0 },
          { employee_id: 2, employee_name: "Marcus Vance", department: "Sales", external_pending: 0.0, external_settled: 2000.0, internal_pending: 0.0, internal_settled: 1100.0, tax_pending: 0.0, tax_settled: 140.0, insurance_pending: 202.0, insurance_settled: 0.0, total_pending: 202.0, total_settled: 3240.0 },
          { employee_id: 3, employee_name: "Elena Rostova", department: "Operations", external_pending: 0.0, external_settled: 1000.0, internal_pending: 0.0, internal_settled: 700.0, tax_pending: 0.0, tax_settled: 90.0, insurance_pending: 130.0, insurance_settled: 0.0, total_pending: 130.0, total_settled: 1790.0 },
        ],
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/payroll/payable-status${qs ? "?" + qs : ""}`);
  },


  // ==========================================
  };

  root.FinanceReportsApi = FinanceReportsApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceReportsApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceReportsApi;
  }
})(typeof window !== "undefined" ? window : globalThis);


/**
 * fe/api/finance/dashboard-api.js
 * Finance API - Dashboard & Activity domain client and mock handlers.
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

  if (!FinanceMockState.attentionReviewed) {
    FinanceMockState.attentionReviewed = new Set();
  }

  const FinanceDashboardApi = {
async getFinanceSummary(params = {}) {
    if (_isMock()) {
      const period = (params.period || "MTD").toUpperCase();
      const basis = (params.basis || "cash").toLowerCase();
      const currency = (params.currency || "USD").toUpperCase();
      const entity = (params.entity || "all").toLowerCase();

      let accounts = [...(FinanceMockState.accounts || [])];
      if (currency !== "ALL") {
        accounts = accounts.filter((a) => (a.currency || "USD").toUpperCase() === currency);
      }

      let balance = 245000.0;
      if (currency === "EGP") {
        balance = 470000.0;
      } else if (currency === "ALL") {
        balance = 715000.0;
      }

      let revenue = 0;
      let cost = 0;

      if (basis === "accrual") {
        let invs = [...(FinanceMockState.invoices || [])].filter((i) => i.status !== "void" && i.status !== "draft");
        if (currency !== "ALL") invs = invs.filter((i) => (i.currency || "USD").toUpperCase() === currency);
        revenue = invs.reduce((acc, i) => acc + (i.total || 0), 0) || 30000.0;

        let bills = [...(FinanceMockState.bills || [])].filter((b) => b.status !== "void");
        if (currency !== "ALL") bills = bills.filter((b) => (b.currency || "USD").toUpperCase() === currency);
        cost = bills.reduce((acc, b) => acc + (b.total || 0), 0) || 10000.0;
      } else {
        if (currency === "EGP") {
          revenue = 0.0;
          cost = 0.0;
        } else {
          revenue = 48200.0;
          cost = 31400.0;
        }
      }

      const net = Math.round((revenue - cost) * 100) / 100;
      const marginValid = revenue > 0;
      const marginPct = marginValid ? Math.round((net / revenue) * 1000) / 10 : null;
      const displayCurrency = currency !== "ALL" ? currency : "USD";

      return {
        balance: balance || 245000.0,
        revenue_mtd: revenue,
        cost_mtd: cost,
        net_mtd: net,
        margin_pct: marginPct,
        margin_valid: marginValid,
        currency: displayCurrency,
        base_currency: displayCurrency,
        period: period,
        basis: basis,
        entity: entity,
        conversion_policy: currency === "ALL"
          ? "Consolidated totals across currencies without conversion; select a specific currency for single-currency ledger reconciliation."
          : `Filtered strictly to ${currency} accounts and transactions (1:1 single currency).`,
        data_scope: `${entity}_${currency.toLowerCase()}`,
        open_invoices_count: (FinanceMockState.invoices || []).filter((i) => i.status === "sent" || i.status === "draft").length,
        unpaid_bills_count: (FinanceMockState.bills || []).filter((b) => b.status === "unpaid").length,
        active_subscriptions_count: (FinanceMockState.subscriptions || []).filter((s) => s.is_active).length,
        generated_at: new Date().toISOString(),
        kpis: {
          total_cash: {
            id: "statFinanceBalance",
            value: balance || 245000.0,
            currency: displayCurrency,
            label: "Total Cash Balance",
            period: "Current (Real-time)",
            definition: "Consolidated book cash balance across all active bank and cash accounts matching scope.",
            formula: "SUM(finance_bank_accounts.current_balance WHERE is_active=True)",
            source_coverage: `${accounts.length} active bank & cash accounts`,
            drilldown_section: "finance-accounts",
            drilldown_filter: { is_active: "true" },
          },
          revenue: {
            id: "statFinanceRevenue",
            value: revenue,
            currency: displayCurrency,
            label: `Revenue (${period})`,
            period: period,
            definition: basis === "cash" ? "Actual cash inflows received and categorized as revenue" : "Recognized revenue from all non-void sales invoices issued in period",
            formula: basis === "cash" ? "SUM(ledger_inflows WHERE source!='transfer')" : "SUM(sales_invoices.total WHERE status NOT IN ('void', 'draft'))",
            source_coverage: basis === "cash" ? "Bank & cash ledger transactions" : "Sales invoices register",
            drilldown_section: basis === "cash" ? "finance-transactions" : "finance-invoices",
            drilldown_filter: basis === "cash" ? { direction: "in" } : { status: "all" },
          },
          operating_spend: {
            id: "statFinanceCost",
            value: cost,
            currency: displayCurrency,
            label: `Operating Expenses (${period})`,
            period: period,
            definition: basis === "cash" ? "Actual cash outflows paid for expenses, bills, and charges" : "Recognized costs from all non-void vendor bills issued in period",
            formula: basis === "cash" ? "SUM(ledger_outflows WHERE source!='transfer')" : "SUM(bills.total WHERE status!='void')",
            source_coverage: basis === "cash" ? "Bank & cash ledger transactions" : "Vendor bills register",
            drilldown_section: basis === "cash" ? "finance-transactions" : "finance-bills",
            drilldown_filter: basis === "cash" ? { direction: "out" } : { status: "all" },
          },
          net_result: {
            id: "statFinanceNet",
            value: net,
            currency: displayCurrency,
            label: `Net Operating Result (${period})`,
            period: period,
            definition: "Net operating difference: Revenue minus Operating Expenses for the period.",
            formula: "Revenue - Operating Expenses",
            source_coverage: basis === "cash" ? "Ledger operating delta" : "Invoices minus Bills",
            drilldown_section: "finance-reports",
            drilldown_filter: {},
          },
          operating_margin: {
            id: "statFinanceMargin",
            value: marginPct,
            is_valid: marginValid,
            unit: "%",
            label: `Operating Margin (${period})`,
            period: period,
            definition: marginValid ? "Operating profitability percentage: (Net Result / Revenue) * 100." : "Margin is undefined when Revenue is zero or negative.",
            formula: "(Net Operating Result / Revenue) * 100",
            source_coverage: "Derived from Revenue and Spend",
            drilldown_section: "finance-reports",
            drilldown_filter: {},
          },
        },
      };
    }
    let url = "/api/finance/reports/summary";
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async getDashboardSummary(params = {}) {
    return this.getFinanceSummary(params);
  },

  async getAttentionQueue(params = {}) {
    if (_isMock()) {
      const severity = (params.severity || "all").toLowerCase();
      const itemType = (params.item_type || params.type || "all").toLowerCase();
      const search = (params.search || "").toLowerCase();
      const includeReviewed = params.include_reviewed === true || params.include_reviewed === "true";

      const reviewedSet = FinanceMockState.attentionReviewed || new Set();

      const allMockItems = [
        {
          id: "rec-inv-1",
          deduplication_key: "invoice:1:overdue",
          type: "overdue_receivable",
          severity: "urgent",
          severity_label: "Urgent",
          title: "Overdue Invoice: INV-2026-001",
          description: "Invoice INV-2026-001 to Apex Health Partners is overdue by 13 days. Outstanding balance: $12,500.00 USD.",
          counterparty: "Apex Health Partners",
          amount: 12500.0,
          currency: "USD",
          due_date: "2026-09-01",
          due_state: "overdue",
          due_state_label: "Overdue by 13d",
          owner: "billing@apexhealth.com",
          target_route: "a-finance-invoices",
          target_id: 1,
          target_filter: { status: "overdue", invoice_id: 1 },
          permission: "finance.invoice.read",
          priority_score: 95,
          can_resolve: true,
          can_mark_reviewed: true,
          is_reviewed: reviewedSet.has("invoice:1:overdue"),
          created_at: "2026-09-01T08:00:00",
        },
        {
          id: "bill-1",
          deduplication_key: "bill:1:due",
          type: "bill_due",
          severity: "urgent",
          severity_label: "Urgent",
          title: "Overdue Bill: BILL-2026-001",
          description: "Bill BILL-2026-001 from Amazon Web Services is overdue by 5 days. Payable balance: $4,200.00 USD.",
          counterparty: "Amazon Web Services",
          amount: 4200.0,
          currency: "USD",
          due_date: "2026-09-08",
          due_state: "overdue",
          due_state_label: "Overdue by 5d",
          owner: "aws-receivables@amazon.com",
          target_route: "a-finance-bills",
          target_id: 1,
          target_filter: { bill_id: 1 },
          permission: "finance.bill.read",
          priority_score: 88,
          can_resolve: true,
          can_mark_reviewed: true,
          is_reviewed: reviewedSet.has("bill:1:due"),
          created_at: "2026-09-01T08:00:00",
        },
        {
          id: "cash-acc-4",
          deduplication_key: "account:4:negative_balance",
          type: "negative_cash",
          severity: "urgent",
          severity_label: "Urgent",
          title: "Negative Balance: Cairo Office Petty Cash Drawer",
          description: "Petty cash drawer has an overdraft balance of 2,500.00 EGP. Replenishment transfer required.",
          counterparty: "Cairo Office Petty Cash",
          amount: 2500.0,
          currency: "EGP",
          due_date: "2026-09-13",
          due_state: "immediate",
          due_state_label: "Action Required (Overdraft)",
          owner: null,
          target_route: "a-finance-accounts",
          target_id: 4,
          target_filter: { is_active: "true" },
          permission: "finance.account.read",
          priority_score: 110,
          can_resolve: true,
          can_mark_reviewed: true,
          is_reviewed: reviewedSet.has("account:4:negative_balance"),
          created_at: "2026-09-10T12:00:00",
        },
        {
          id: "transfer-1",
          deduplication_key: "transfer:1:incomplete",
          type: "pending_approval",
          severity: "warning",
          severity_label: "Warning",
          title: "Incomplete Transfer #1",
          description: "Transfer of $50,000.00 USD from Voyance Operating USD to Voyance Treasury Reserve has confirmed leg 'from_only'. Second leg requires confirmation.",
          counterparty: "Voyance Operating USD → Treasury Reserve",
          amount: 50000.0,
          currency: "USD",
          due_date: "2026-09-12",
          due_state: "pending_review",
          due_state_label: "Pending Second Leg",
          owner: "finance.admin@example.com",
          target_route: "a-finance-transfers",
          target_id: 1,
          target_filter: { transfer_id: 1 },
          permission: "finance.transfer.read",
          priority_score: 75,
          can_resolve: true,
          can_mark_reviewed: true,
          is_reviewed: reviewedSet.has("transfer:1:incomplete"),
          created_at: "2026-09-12T15:30:00",
        },
        {
          id: "stmt-1",
          deduplication_key: "statement:1:unmatched",
          type: "unreconciled_statement",
          severity: "warning",
          severity_label: "Warning",
          title: "Unreconciled Statement: JPMorgan Chase (2026-08)",
          description: "Statement import for 2026-08 contains 3 unmatched statement lines requiring ledger matching.",
          counterparty: "JPMorgan Chase",
          amount: 3850.0,
          currency: "USD",
          due_date: "2026-09-01",
          due_state: "needs_reconciliation",
          due_state_label: "3 Unmatched Lines",
          owner: null,
          target_route: "a-finance-statements",
          target_id: 1,
          target_filter: { import_id: 1 },
          permission: "finance.statement.read",
          priority_score: 65,
          can_resolve: true,
          can_mark_reviewed: true,
          is_reviewed: reviewedSet.has("statement:1:unmatched"),
          created_at: "2026-09-01T14:00:00",
        },
      ];

      let filtered = allMockItems.filter((it) => {
        if (!includeReviewed && it.is_reviewed) return false;
        if (severity !== "all" && it.severity !== severity) return false;
        if (itemType !== "all" && it.type !== itemType) return false;
        if (search) {
          const s = search.toLowerCase();
          const match =
            it.title.toLowerCase().includes(s) ||
            it.description.toLowerCase().includes(s) ||
            (it.counterparty && it.counterparty.toLowerCase().includes(s));
          if (!match) return false;
        }
        return true;
      });

      filtered.sort((a, b) => b.priority_score - a.priority_score);

      const urgentCount = filtered.filter((i) => i.severity === "urgent").length;
      const warningCount = filtered.filter((i) => i.severity === "warning").length;
      const infoCount = filtered.filter((i) => i.severity === "info").length;

      const currencyTotals = {};
      filtered.forEach((it) => {
        if (it.amount && it.currency) {
          currencyTotals[it.currency] = round((currencyTotals[it.currency] || 0) + it.amount, 2);
        }
      });

      return {
        total_count: filtered.length,
        urgent_count: urgentCount,
        warning_count: warningCount,
        info_count: infoCount,
        total_amount_by_currency: currencyTotals,
        items: filtered,
        generated_at: new Date().toISOString(),
      };
    }

    let url = "/api/finance/reports/attention-queue";
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },

  async reviewAttentionItem(itemKey, payload = {}) {
    if (_isMock()) {
      if (!FinanceMockState.attentionReviewed) {
        FinanceMockState.attentionReviewed = new Set();
      }
      FinanceMockState.attentionReviewed.add(itemKey);
      return { success: true, deduplication_key: itemKey, status: payload.status || "reviewed" };
    }
    const encodedKey = encodeURIComponent(itemKey);
    return apiRequest("POST", `/api/finance/reports/attention-queue/${encodedKey}/review`, payload);
  },

  async getCashForecast(params = {}) {
    if (_isMock()) {
      const currency = (params.currency || "all").toUpperCase();
      const horizonDays = parseInt(params.horizon_days || "90", 10);
      const includeExpected = params.include_expected !== false && params.include_expected !== "false";

      let rawAccounts = FinanceMockState.accounts || [];
      if (currency !== "ALL") {
        rawAccounts = rawAccounts.filter((a) => (a.currency || "").toUpperCase() === currency);
      }

      const cheques = FinanceMockState.cheques || [];
      const transfers = FinanceMockState.transfers || [];

      let totalCurrentCash = 0;
      const currentCashByCurrency = {};

      const accounts = rawAccounts.map((acc) => {
        const bookBal = round(acc.current_balance || 0, 2);
        const curr = (acc.currency || "USD").toUpperCase();
        currentCashByCurrency[curr] = round((currentCashByCurrency[curr] || 0) + bookBal, 2);
        totalCurrentCash = round(totalCurrentCash + bookBal, 2);

        // Uncleared issued cheques
        let uncleared = 0;
        cheques.forEach((chq) => {
          if (chq.account_id === acc.id && chq.status === "issued") {
            uncleared += (chq.amount || 0);
          }
        });
        uncleared = round(uncleared, 2);

        // Pending outgoing transfers
        let pending = 0;
        transfers.forEach((tr) => {
          if (tr.from_account_id === acc.id && tr.confirmed_leg !== "both") {
            pending += (tr.from_amount || 0);
          }
        });
        pending = round(pending, 2);

        const availableBal = round(bookBal - uncleared - pending, 2);
        const reconciledBal = bookBal > 0 ? round(bookBal * 0.95, 2) : bookBal;

        return {
          account_id: acc.id,
          account_name: acc.account_name,
          bank_name: acc.bank_name,
          account_type: acc.account_type || "bank",
          currency: acc.currency,
          book_balance: bookBal,
          available_balance: availableBal,
          reconciled_balance: reconciledBal,
          uncleared_cheques_amount: uncleared,
          pending_transfers_amount: pending,
          is_active: acc.is_active,
        };
      });

      // Obligations
      const obligations = [];
      const todayStr = "2026-09-13";
      const today = new Date("2026-09-13T00:00:00");

      // (a) Invoices
      (FinanceMockState.invoices || []).forEach((inv) => {
        if (["void", "draft"].includes((inv.status || "").toLowerCase())) return;
        if (currency !== "ALL" && (inv.currency || "").toUpperCase() !== currency) return;
        const total = inv.total || 0;
        const paid = (inv.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
        const bal = round(total - paid, 2);
        if (bal <= 0) return;

        const isOverdue = inv.due_date && inv.due_date < todayStr;
        obligations.push({
          id: `inflow-inv-${inv.id}`,
          entity_type: "invoice",
          entity_id: inv.id,
          reference: inv.invoice_number,
          counterparty: inv.customer_name || "Customer",
          type: "inflow",
          amount: bal,
          currency: inv.currency,
          due_date: isOverdue ? todayStr : (inv.due_date || todayStr),
          status: isOverdue ? "expected" : "confirmed",
          certainty: isOverdue ? "overdue" : "contractual",
          target_route: "a-finance-invoices",
          notes: `Sales Invoice balance: ${bal.toLocaleString()} ${inv.currency}`,
        });
      });

      // (b) Bills
      (FinanceMockState.bills || []).forEach((bill) => {
        if (["void", "draft"].includes((bill.status || "").toLowerCase())) return;
        if (currency !== "ALL" && (bill.currency || "").toUpperCase() !== currency) return;
        const total = bill.total || 0;
        const paid = (bill.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
        const bal = round(total - paid, 2);
        if (bal <= 0) return;

        const isOverdue = bill.due_date && bill.due_date < todayStr;
        obligations.push({
          id: `outflow-bill-${bill.id}`,
          entity_type: "bill",
          entity_id: bill.id,
          reference: bill.bill_number,
          counterparty: bill.vendor_name || "Vendor",
          type: "outflow",
          amount: bal,
          currency: bill.currency,
          due_date: isOverdue ? todayStr : (bill.due_date || todayStr),
          status: "confirmed",
          certainty: isOverdue ? "overdue" : "contractual",
          target_route: "a-finance-bills",
          notes: `Vendor payable balance: ${bal.toLocaleString()} ${bill.currency}`,
        });
      });

      // (c) Subscriptions
      if (includeExpected) {
        (FinanceMockState.subscriptions || []).forEach((sub) => {
          if (!sub.is_active) return;
          if (currency !== "ALL" && (sub.currency || "").toUpperCase() !== currency) return;
          const amt = round(sub.amount || 0, 2);
          if (amt <= 0) return;

          [0, 1, 2].forEach((cycle) => {
            const d = new Date(today);
            d.setDate(d.getDate() + 15 + cycle * 30);
            const cycleDateStr = d.toISOString().split("T")[0];
            obligations.push({
              id: `outflow-sub-${sub.id}-c${cycle}`,
              entity_type: "subscription",
              entity_id: sub.id,
              reference: `${sub.name} (Renewal #${cycle + 1})`,
              counterparty: sub.vendor_name || sub.name,
              type: "outflow",
              amount: amt,
              currency: sub.currency,
              due_date: cycleDateStr,
              status: "expected",
              certainty: "estimated",
              target_route: "a-finance-spend",
              notes: `Recurring ${sub.billing_cycle || "monthly"} subscription charge`,
            });
          });
        });
      }

      // Horizons calculations
      const horizonsMeta = [
        { key: "30_days", days: 30, label: "Next 30 Days", minDays: 0, maxDays: 30 },
        { key: "60_days", days: 60, label: "31 - 60 Days", minDays: 31, maxDays: 60 },
        { key: "90_days", days: 90, label: "61 - 90 Days", minDays: 61, maxDays: 90 },
      ];

      let runningCash = totalCurrentCash;
      const horizons = {};

      horizonsMeta.forEach((h) => {
        let confIn = 0;
        let expIn = 0;
        let confOut = 0;
        let expOut = 0;

        obligations.forEach((ob) => {
          const obDate = new Date(ob.due_date + "T00:00:00");
          const diffDays = Math.round((obDate - today) / (1000 * 60 * 60 * 24));
          const inRange = (h.key === "30_days" && diffDays <= 30) || (diffDays >= h.minDays && diffDays <= h.maxDays);
          if (inRange) {
            if (ob.type === "inflow") {
              if (ob.status === "confirmed") confIn += ob.amount;
              else expIn += ob.amount;
            } else {
              if (ob.status === "confirmed") confOut += ob.amount;
              else expOut += ob.amount;
            }
          }
        });

        confIn = round(confIn, 2);
        expIn = round(expIn, 2);
        confOut = round(confOut, 2);
        expOut = round(expOut, 2);

        const totIn = round(confIn + expIn, 2);
        const totOut = round(confOut + expOut, 2);
        const netFlow = round(totIn - totOut, 2);
        runningCash = round(runningCash + netFlow, 2);

        horizons[h.key] = {
          period_label: h.label,
          days: h.days,
          confirmed_inflows: confIn,
          expected_inflows: expIn,
          total_inflows: totIn,
          confirmed_outflows: confOut,
          expected_outflows: expOut,
          total_outflows: totOut,
          net_cash_flow: netFlow,
          projected_ending_cash: runningCash,
          confidence: h.key === "30_days" ? "high" : (h.key === "60_days" ? "medium" : "low"),
        };
      });

      obligations.sort((a, b) => a.due_date.localeCompare(b.due_date));

      const fxWarnings = [];
      if (currency === "ALL") {
        fxWarnings.push("Multi-currency forecast aggregates values within native currencies. Cross-currency conversions are not fabricated without verified live exchange rates.");
      }

      return {
        as_of_date: todayStr,
        currency: currency,
        accounts: accounts,
        current_cash_by_currency: currentCashByCurrency,
        total_current_cash: totalCurrentCash,
        horizons: horizons,
        material_obligations: obligations.slice(0, 50),
        assumptions: [
          "Draft sales invoices and unapproved vendor bills are strictly excluded from cash projections.",
          "Contractual obligations with past-due dates are placed in the immediate 0-30 day horizon with an overdue status indicator.",
          "Active monthly subscriptions repeat every 30 days as estimated expected outflows.",
          "Book, available, and reconciled balances are tracked independently and never conflated.",
        ],
        fx_warnings: fxWarnings,
        generated_at: new Date().toISOString(),
      };
    }

    let url = "/api/finance/reports/cash-forecast";
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },

async getEntityActivity(entityType, entityId) {
    const norm = (entityType || "").toLowerCase().replace(/s$/, "");
    const id = parseInt(entityId, 10);
    if (_isMock()) {
      if (norm === "invoice") {
        const inv = (FinanceMockState.invoices || []).find((i) => i.id === id) || {
          id,
          invoice_number: `INV-2026-${id}`,
          customer_name: "Apex Health Partners",
          total: 12500.0,
          currency: "USD",
          status: "sent",
          issue_date: "2026-09-01",
          due_date: "2026-09-30",
          notes: "PACS Integration",
        };
        const cust = (FinanceMockState.customers || []).find((c) => c.id === inv.customer_id) || { name: inv.customer_name || "Apex Health Partners", tax_id: "US-88992211" };
        const amountPaid = inv.amount_paid !== undefined ? inv.amount_paid : (inv.status === "paid" ? inv.total : 0.0);
        const balance = inv.balance !== undefined ? inv.balance : Math.max(0, (inv.total || 0) - amountPaid);
        const isOverdue = inv.is_overdue || inv.status === "overdue";
        const nextAction = inv.next_action || (inv.status === "draft" ? "Review & Send to Customer" : (balance <= 0 ? "Completed (Paid in Full)" : (isOverdue ? "Send Payment Reminder" : "Awaiting Due Date / Payment")));
        const attrs = [
          { label: "Subtotal", value: `${(inv.subtotal || inv.total).toLocaleString()} ${inv.currency || "USD"}` },
          { label: "Amount Paid", value: `${amountPaid.toLocaleString()} ${inv.currency || "USD"}` },
          { label: "Outstanding Balance", value: `${balance.toLocaleString()} ${inv.currency || "USD"}` },
          { label: "Next Action", value: nextAction },
          { label: "Due Date", value: inv.due_date || "—" },
          { label: "Revenue Channel", value: inv.revenue_channel || "Overseas USD" },
          { label: "Customer Tax ID", value: cust.tax_id || "US-88992211" },
        ];
        if (isOverdue && inv.days_overdue) {
          attrs.splice(4, 0, { label: "Overdue State", value: `${inv.days_overdue} days overdue` });
        }

        return {
          entity_type: "invoice",
          entity_id: inv.id,
          title: `Invoice ${inv.invoice_number}`,
          status: isOverdue ? "overdue" : (balance <= 0 && inv.status !== "void" ? "paid" : inv.status || "draft"),
          summary: {
            reference: inv.invoice_number,
            counterparty: inv.customer_name || cust.name,
            amount: inv.total,
            currency: inv.currency || "USD",
            date: inv.issue_date,
            due_date: inv.due_date,
            status: isOverdue ? "overdue" : (balance <= 0 && inv.status !== "void" ? "paid" : inv.status || "draft"),
            notes: inv.notes || "",
            sensitive_masked: false,
            attributes: attrs,
          },
          related_records: [
            {
              entity_type: "customer",
              entity_id: cust.id || 1,
              title: cust.name,
              badge: "Customer Account",
              amount: null,
              currency: null,
              date: null,
            },
            {
              entity_type: "transaction",
              entity_id: 1,
              title: "Payment Inflow TXN-0001",
              badge: "Ledger Entry",
              amount: inv.total,
              currency: inv.currency || "USD",
              date: inv.issue_date,
            },
          ],
          attachments: [
            {
              id: 1,
              file_name: `${inv.invoice_number}_document.pdf`,
              file_size: 245760,
              mime_type: "application/pdf",
              storage_ref: "gdrive://invoices/inv.pdf",
              uploaded_at: inv.created_at || "2026-09-01T08:00:00Z",
              uploaded_by: "billing@voyancemed.com",
            },
          ],
          timeline: [
            {
              id: `inv-${inv.id}-created`,
              timestamp: inv.created_at || `${inv.issue_date} 08:00:00`,
              event: "created",
              plain_text: `Invoice ${inv.invoice_number} created with total ${(inv.total || 0).toLocaleString()} ${inv.currency || "USD"}`,
              actor: "admin@voyancemed.com",
              state_transition: { from_state: null, to_state: "draft" },
            },
            {
              id: `inv-${inv.id}-sent`,
              timestamp: `${inv.issue_date} 09:30:00`,
              event: "sent",
              plain_text: `Invoice ${inv.invoice_number} issued and sent to ${inv.customer_name}`,
              actor: "billing@voyancemed.com",
              state_transition: { from_state: "draft", to_state: "sent" },
            },
          ],
        };
      } else if (norm === "customer") {
        const cust = (FinanceMockState.customers || []).find((c) => c.id === id) || {
          id, name: "Customer", is_active: true
        };
        const invoices = (FinanceMockState.invoices || []).filter((i) => i.customer_id === cust.id);
        let total_invoiced = 0.0;
        let total_paid = 0.0;
        let outstanding_balance = 0.0;
        let overdue_balance = 0.0;
        const today = new Date().toISOString().slice(0, 10);
        const daysToPay = [];
        const related = [];
        const timeline = [];

        for (const inv of invoices) {
          const isVoid = inv.status === "void";
          const payments = (FinanceMockState.payments || []).filter((p) => p.related_invoice_id === inv.id && !p.is_reversed);
          const paid = payments.reduce((s, p) => s + (p.amount || 0), 0);
          const bal = isVoid ? 0 : Math.max(0, (inv.total || 0) - paid);
          const isOverdue = !isVoid && bal > 0.001 && inv.due_date && inv.due_date < today;

          if (!isVoid) {
            total_invoiced += (inv.total || 0);
            total_paid += paid;
            outstanding_balance += bal;
            if (isOverdue) overdue_balance += bal;
            if (bal <= 0.001 && paid > 0 && payments.length > 0) {
              const lastP = payments[payments.length - 1];
              if (lastP.payment_date && inv.issue_date) {
                const diff = Math.round((new Date(lastP.payment_date) - new Date(inv.issue_date)) / (86400000));
                if (diff >= 0) daysToPay.push(diff);
              }
            }
          }

          const derivedStatus = isVoid ? "void" : (bal <= 0.001 && inv.total > 0 ? "paid" : (isOverdue ? "overdue" : (inv.status || "sent")));
          related.push({
            entity_type: "invoice",
            entity_id: inv.id,
            title: `Invoice ${inv.invoice_number}`,
            badge: derivedStatus.toUpperCase(),
            amount: inv.total,
            currency: inv.currency || "USD",
            date: inv.issue_date,
          });

          timeline.push({
            id: `inv-${inv.id}-created`,
            timestamp: `${inv.issue_date || today} 09:00:00`,
            event: "invoice_issued",
            plain_text: `Invoice ${inv.invoice_number} issued for ${inv.currency || "USD"} ${(inv.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
            actor: "finance@voyance.health",
            state_transition: { from_state: "draft", to_state: derivedStatus },
          });

          for (const p of payments) {
            timeline.push({
              id: `pmt-${p.id}-received`,
              timestamp: `${p.payment_date || today} 14:00:00`,
              event: "payment_received",
              plain_text: `Payment of ${p.currency || "USD"} ${(p.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} recorded (Ref: ${p.reference || "N/A"})`,
              actor: "finance@voyance.health",
              state_transition: { from_state: "sent", to_state: "paid" },
            });
          }
        }

        const avgDays = daysToPay.length > 0 ? Math.round((daysToPay.reduce((s, d) => s + d, 0) / daysToPay.length) * 10) / 10 : null;

        const attrs = [
          { label: "Legal Name", value: cust.legal_name || "—" },
          { label: "Contact Email", value: cust.contact_email || "—" },
          { label: "Contact Phone", value: cust.contact_phone || "—" },
          { label: "Tax ID", value: cust.tax_id || "—" },
          { label: "Payment Terms", value: `${cust.payment_terms_days || 30} days` },
          { label: "Default Currency", value: cust.default_currency || "USD" },
          { label: "Country", value: cust.country || "Egypt" },
          { label: "Total Invoiced", value: `$${total_invoiced.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${cust.default_currency || "USD"}` },
          { label: "Total Paid", value: `$${total_paid.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${cust.default_currency || "USD"}` },
          { label: "Outstanding Balance", value: `$${outstanding_balance.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${cust.default_currency || "USD"}` },
          { label: "Overdue Balance", value: `$${overdue_balance.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${cust.default_currency || "USD"}` },
          { label: "Avg Days to Pay", value: avgDays ? `${avgDays} days` : "—" },
          { label: "Account Owner", value: cust.owner || "—" },
        ];

        return {
          entity_type: "customer",
          entity_id: cust.id,
          title: `Customer: ${cust.name}`,
          status: cust.is_active ? "active" : "inactive",
          summary: {
            reference: cust.name,
            counterparty: cust.legal_name || cust.name,
            amount: outstanding_balance,
            currency: cust.default_currency || "USD",
            date: cust.created_at,
            due_date: null,
            status: cust.is_active ? "active" : "inactive",
            notes: cust.notes || "",
            sensitive_masked: false,
            attributes: attrs,
          },
          related_records: related,
          attachments: [],
          timeline,
        };
      } else if (norm === "vendor") {
        const vend = (FinanceMockState.vendors || []).find((v) => v.id === id) || {
          id,
          name: "Amazon Web Services",
          category: "Infrastructure",
          contact_email: "aws-receivables@amazon.com",
          tax_id: "VAT-1294819",
          is_active: true,
        };
        const bills = (FinanceMockState.bills || []).filter((b) => b.vendor_id === vend.id);
        const paidBills = bills.filter((b) => b.status === "paid");
        const totalSpend = paidBills.reduce((acc, b) => acc + (b.total || 0), 0);
        const openBills = bills.filter((b) => b.status !== "paid" && b.status !== "void");
        const openTotal = openBills.reduce((acc, b) => acc + (b.total || 0), 0);

        const instructions = (FinanceMockState.vendorPaymentInstructions || []).filter((pi) => pi.vendor_id === vend.id);
        const piParts = instructions.map((pi) => `${pi.bank_name || 'Bank'}: ******${(pi.account_number || '').slice(-4)} (${pi.verification_status})`);

        const related = bills.map((b) => ({
          entity_type: "bill",
          entity_id: b.id,
          title: `Bill ${b.bill_number}`,
          badge: (b.status || "unpaid").toUpperCase(),
          amount: b.total,
          currency: b.currency || "USD",
          date: b.issue_date,
        }));

        const timeline = bills.map((b) => ({
          id: `bill-${b.id}-issued`,
          timestamp: `${b.issue_date || "2026-09-01"} 09:00:00`,
          event: "bill_received",
          plain_text: `Bill ${b.bill_number} recorded for ${b.currency || "USD"} ${(b.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
          actor: b.created_by || "finance@voyance.health",
          state_transition: { from_state: "inbox", to_state: b.status || "unpaid" },
        }));

        const attrs = [
          { label: "Legal Name", value: vend.legal_name || "—" },
          { label: "Category", value: vend.category || "General" },
          { label: "Contact Email", value: vend.contact_email || "—" },
          { label: "Contact Phone", value: vend.contact_phone || "—" },
          { label: "Tax ID", value: vend.tax_id || "—" },
          { label: "Payment Terms", value: `${vend.payment_terms_days || 30} days` },
          { label: "Default Currency", value: vend.default_currency || "USD" },
          { label: "Total Spend", value: `$${totalSpend.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${vend.default_currency || "USD"}` },
          { label: "Open Bills Count", value: String(openBills.length) },
          { label: "Open Bills Total", value: `$${openTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${vend.default_currency || "USD"}` },
          { label: "Payment Instructions", value: piParts.length ? piParts.join("; ") : "None recorded" },
        ];

        return {
          entity_type: "vendor",
          entity_id: vend.id,
          title: `Vendor: ${vend.name}`,
          status: vend.is_active ? "active" : "inactive",
          summary: {
            reference: vend.name,
            counterparty: vend.legal_name || vend.name,
            amount: openTotal,
            currency: vend.default_currency || "USD",
            date: vend.created_at,
            due_date: null,
            status: vend.is_active ? "active" : "inactive",
            notes: vend.notes || "",
            sensitive_masked: Boolean(instructions.length),
            attributes: attrs,
          },
          related_records: related,
          attachments: [],
          timeline,
        };
      } else if (norm === "bill") {
        const bill = (FinanceMockState.bills || []).find((b) => b.id === id) || {
          id,
          bill_number: `BILL-2026-${id}`,
          vendor_name: "Amazon Web Services",
          total: 4200.0,
          currency: "USD",
          status: "unpaid",
          issue_date: "2026-09-01",
          due_date: "2026-09-30",
          category: "Infrastructure",
        };
        const vendor = (FinanceMockState.vendors || []).find((v) => v.id === bill.vendor_id) || { name: bill.vendor_name || "Amazon Web Services", tax_id: "VAT-1294819" };
        const payments = (FinanceMockState.billPayments || []).filter((p) => p.related_bill_id === bill.id);
        const activePayments = payments.filter((p) => !p.is_reversed);
        const paidSoFar = activePayments.reduce((s, p) => s + (p.amount || 0), 0);
        const remaining = Math.max(0, (bill.total || 0) - paidSoFar);

        const timeline = [
          {
            id: `bill-${bill.id}-created`,
            timestamp: bill.created_at || `${bill.issue_date} 08:00:00`,
            event: "created",
            plain_text: `Vendor bill ${bill.bill_number} received from ${bill.vendor_name || vendor.name}`,
            actor: bill.created_by || "ap@voyance.health",
            state_transition: { from_state: null, to_state: bill.status || "unpaid" },
          },
        ];

        if (bill.approved_at) {
          timeline.push({
            id: `bill-${bill.id}-approved`,
            timestamp: bill.approved_at,
            event: "approved",
            plain_text: `Bill approval recorded: ${bill.approval_status} by ${bill.approved_by || "manager"}${bill.approval_comment ? ` ("${bill.approval_comment}")` : ""}`,
            actor: bill.approved_by || "manager",
            state_transition: { from_state: "needs_approval", to_state: bill.approval_status === "approved" ? "ready_to_pay" : "exceptions" },
          });
        }

        if (bill.scheduled_payment_date) {
          timeline.push({
            id: `bill-${bill.id}-scheduled`,
            timestamp: bill.created_at || `${bill.issue_date} 10:00:00`,
            event: "scheduled",
            plain_text: `Payment scheduled for ${bill.scheduled_payment_date}`,
            actor: "finance@voyance.health",
            state_transition: { from_state: "ready_to_pay", to_state: "scheduled" },
          });
        }

        for (const p of payments) {
          timeline.push({
            id: `bill-pay-${p.id}`,
            timestamp: `${p.payment_date || bill.issue_date} 12:00:00`,
            event: "payment",
            plain_text: `Payment of ${p.amount.toLocaleString()} ${p.currency || "USD"} recorded (Ref: ${p.reference || "N/A"})`,
            actor: "ap@voyance.health",
            state_transition: { from_state: "ready_to_pay", to_state: "partially_paid" },
          });
          if (p.is_reversed) {
            timeline.push({
              id: `bill-rev-${p.id}`,
              timestamp: p.reversed_at || new Date().toISOString(),
              event: "reversal",
              plain_text: `Payment #${p.id} reversed: ${p.reversal_reason || "Voided by user"}`,
              actor: p.reversed_by || "admin@voyance.health",
              state_transition: { from_state: "paid", to_state: "ready_to_pay" },
            });
          }
        }

        const related = [
          {
            entity_type: "vendor",
            entity_id: vendor.id || 1,
            title: vendor.name,
            badge: "Vendor Payables",
            amount: null,
            currency: null,
            date: null,
          },
          ...payments.map((p) => ({
            entity_type: "payment",
            entity_id: p.id,
            title: `Payment #${p.id} (${p.method || "transfer"})` + (p.is_reversed ? " [REVERSED]" : ""),
            badge: p.is_reversed ? "REVERSED" : "PAID",
            amount: p.amount,
            currency: p.currency || bill.currency || "USD",
            date: p.payment_date,
          })),
        ];

        return {
          entity_type: "bill",
          entity_id: bill.id,
          title: `Bill ${bill.bill_number}`,
          status: bill.status || "unpaid",
          summary: {
            reference: bill.bill_number,
            counterparty: bill.vendor_name || vendor.name,
            amount: bill.total,
            currency: bill.currency || "USD",
            date: bill.issue_date,
            due_date: bill.due_date,
            status: bill.status,
            notes: bill.notes || "",
            sensitive_masked: false,
            attributes: [
              { label: "Category", value: bill.category || "General" },
              { label: "Subtotal", value: `${(bill.subtotal || bill.total).toLocaleString()} ${bill.currency || "USD"}` },
              { label: "Amount Paid", value: `${paidSoFar.toLocaleString()} ${bill.currency || "USD"}` },
              { label: "Remaining Balance", value: `${remaining.toLocaleString()} ${bill.currency || "USD"}` },
              { label: "Approval Status", value: bill.approval_status ? bill.approval_status.toUpperCase() : (bill.requires_approval ? "PENDING" : "NOT REQUIRED") },
              { label: "Approved By", value: bill.approved_by || "—" },
              { label: "Scheduled Date", value: bill.scheduled_payment_date || "—" },
              { label: "Due Date", value: bill.due_date || "—" },
              { label: "Vendor Tax ID", value: vendor.tax_id || "VAT-1294819" },
            ],
          },
          related_records: related,
          attachments: (bill.attachment_name || bill.attachment_url) ? [
            {
              id: bill.id,
              file_name: bill.attachment_name || `${bill.bill_number}_receipt.pdf`,
              file_size: 154800,
              mime_type: "application/pdf",
              storage_ref: `/api/finance/bills/${bill.id}/attachment`,
              uploaded_at: bill.created_at || "2026-09-01T08:00:00Z",
              uploaded_by: bill.created_by || "ap@voyancemed.com",
            },
          ] : [],
          timeline,
        };
      } else if (norm === "transaction") {
        return {
          entity_type: "transaction",
          entity_id: id,
          title: `Transaction TXN-${String(id).padStart(4, "0")}`,
          status: "settled",
          summary: {
            reference: `TXN-${String(id).padStart(4, "0")}`,
            counterparty: "Voyance Operating USD",
            amount: 12500.0,
            currency: "USD",
            date: "2026-09-01",
            status: "settled",
            notes: "Apex Health Partners Q3 Payment",
            sensitive_masked: false,
            attributes: [
              { label: "Direction", value: "Inflow" },
              { label: "Account", value: "Voyance Operating USD" },
              { label: "Category", value: "Revenue" },
              { label: "Running Balance", value: "$162,500.00" },
            ],
          },
          related_records: [
            {
              entity_type: "invoice",
              entity_id: 1,
              title: "Invoice INV-2026-001",
              badge: "Settled Invoice",
              amount: 12500.0,
              currency: "USD",
              date: "2026-09-01",
            },
          ],
          attachments: [],
          timeline: [
            {
              id: `tx-${id}-posted`,
              timestamp: "2026-09-01 10:00:00",
              event: "posted",
              plain_text: `Transaction TXN-${String(id).padStart(4, "0")} posted: Inflow of $12,500.00 into Voyance Operating USD`,
              actor: "system@hrflow.internal",
              state_transition: { from_state: null, to_state: "settled" },
            },
          ],
        };
      }
    }
    return apiRequest("GET", `/api/finance/activity/${norm}/${id}`);
  },

  // ==========================================
  };

  root.FinanceDashboardApi = FinanceDashboardApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceDashboardApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceDashboardApi;
  }
})(typeof window !== "undefined" ? window : globalThis);


/**
 * fe/api/finance/payroll-api.js
 * Finance API - Net-Payment Payroll & Compensation domain client and mock handlers.
 * Conforms to docs/payroll/09-net-payment-runner-implementation-plan.md.
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

  if (!FinanceMockState.payrollRuns) {
    FinanceMockState.payrollRuns = [
      {
        id: 1,
        period_label: "2026-08",
        period_start: "2026-08-01",
        period_end: "2026-08-31",
        payment_date: "2026-08-31",
        status: "paid",
        total_net: 27000.0,
        total_payment_amount: 27000.0,
        headcount: 2,
        recipient_count: 2,
        payment_line_count: 4,
        currency: "USD",
        bank_account_id: 1,
        bank_account_name: "Voyance Operating USD",
        external_funding_account_id: 1,
        external_funding_account_name: "Voyance Operating USD",
        internal_funding_account_id: 2,
        internal_funding_account_name: "Voyance Cash USD Account",
        fx_rate_source: "first_of_month",
        fx_rate_value: 48.5,
        created_at: "2026-08-25T09:00:00Z",
        created_by: "payroll@voyance.health",
        submitted_at: "2026-08-26T10:00:00Z",
        submitted_by: "payroll@voyance.health",
        approved_at: "2026-08-28T10:00:00Z",
        approved_by: "cfo@voyance.health",
        finalized_at: "2026-08-29T11:00:00Z",
        finalized_by: "payroll@voyance.health",
        paid_at: "2026-08-31T14:30:00Z",
        paid_by: "payroll@voyance.health",
        journal_transaction_id: 101,
        has_blocking_exceptions: false,
        exceptions: [],
        variance_summary: {
          prior_period_label: "2026-07",
          headcount_delta: 0,
          net_delta: 0.0,
          pct_change: 0.0,
          joiners_count: 0,
          leavers_count: 0,
          raises_count: 0,
        },
        lines: [
          {
            id: 1,
            payroll_run_id: 1,
            employee_id: 1,
            employee_name: "Sarah Connor",
            department: "Engineering",
            compensation_type: "external_usd",
            net_pay: 10000.0,
            amount: 10000.0,
            currency: "USD",
            bank_name: "Chase",
            bank_account_masked: "••••4821",
            payment_status: "paid",
            failure_reason: null,
            snapshot_notes: "External bank wire - August",
            created_at: "2026-08-25T09:00:00Z",
            paid_at: "2026-08-31T14:30:00Z",
          },
          {
            id: 2,
            payroll_run_id: 1,
            employee_id: 1,
            employee_name: "Sarah Connor",
            department: "Engineering",
            compensation_type: "internal_usd_cash",
            net_pay: 5000.0,
            amount: 5000.0,
            currency: "USD",
            bank_name: "Chase",
            bank_account_masked: "••••4821",
            payment_status: "paid",
            failure_reason: null,
            snapshot_notes: "Internal cash payment - August",
            created_at: "2026-08-25T09:00:00Z",
            paid_at: "2026-08-31T14:30:00Z",
          },
          {
            id: 3,
            payroll_run_id: 1,
            employee_id: 2,
            employee_name: "John DevOps",
            department: "Operations",
            compensation_type: "external_usd",
            net_pay: 8000.0,
            amount: 8000.0,
            currency: "USD",
            bank_name: "SVB",
            bank_account_masked: "••••9102",
            payment_status: "paid",
            failure_reason: null,
            snapshot_notes: "External bank wire - August",
            created_at: "2026-08-25T09:00:00Z",
            paid_at: "2026-08-31T14:30:00Z",
          },
          {
            id: 4,
            payroll_run_id: 1,
            employee_id: 2,
            employee_name: "John DevOps",
            department: "Operations",
            compensation_type: "internal_usd_cash",
            net_pay: 4000.0,
            amount: 4000.0,
            currency: "USD",
            bank_name: "SVB",
            bank_account_masked: "••••9102",
            payment_status: "paid",
            failure_reason: null,
            snapshot_notes: "Internal cash payment - August",
            created_at: "2026-08-25T09:00:00Z",
            paid_at: "2026-08-31T14:30:00Z",
          },
        ],
      },
    ];
  }

  if (!FinanceMockState.compensationPlans) {
    FinanceMockState.compensationPlans = [
      {
        id: 1,
        employee_id: 1,
        component_type: "external_usd",
        amount: 10000.0,
        currency: "USD",
        effective_start_date: "2026-01-01",
        effective_end_date: null,
        notes: "US bank account wire",
        created_at: "2026-01-01T09:00:00Z",
        updated_at: "2026-01-01T09:00:00Z",
      },
      {
        id: 2,
        employee_id: 1,
        component_type: "internal_usd_cash",
        amount: 5000.0,
        currency: "USD",
        effective_start_date: "2026-01-01",
        effective_end_date: null,
        notes: "Cairo monthly cash payout",
        created_at: "2026-01-01T09:00:00Z",
        updated_at: "2026-01-01T09:00:00Z",
      },
      {
        id: 3,
        employee_id: 2,
        component_type: "external_usd",
        amount: 8000.0,
        currency: "USD",
        effective_start_date: "2026-01-01",
        effective_end_date: null,
        notes: "US account wire",
        created_at: "2026-01-01T09:00:00Z",
        updated_at: "2026-01-01T09:00:00Z",
      },
      {
        id: 4,
        employee_id: 2,
        component_type: "internal_usd_cash",
        amount: 4000.0,
        currency: "USD",
        effective_start_date: "2026-01-01",
        effective_end_date: null,
        notes: "Local cash component",
        created_at: "2026-01-01T09:00:00Z",
        updated_at: "2026-01-01T09:00:00Z",
      },
    ];
  }

  const FinancePayrollApi = {
    async getPayrollRuns(params = {}) {
      if (_isMock()) {
        let list = [...(FinanceMockState.payrollRuns || [])];
        if (params.status && params.status !== "all") {
          list = list.filter((r) => r.status === params.status);
        }
        if (params.search) {
          const s = params.search.toLowerCase();
          list = list.filter((r) => (r.period_label || "").toLowerCase().includes(s));
        }
        return list;
      }
      const qs = new URLSearchParams(params).toString();
      return apiRequest("GET", `/api/finance/payroll/runs${qs ? "?" + qs : ""}`);
    },

    async getPayrollRun(id) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(id, 10));
        if (!run) throw new Error(`Payroll run #${id} not found`);
        return run;
      }
      return apiRequest("GET", `/api/finance/payroll/runs/${id}`);
    },

    async previewPayrollRun(payload) {
      if (_isMock()) {
        const periodLabel = payload.period_label || "2026-10";
        const fxRateSource = payload.fx_rate_source || "first_of_month";
        const fxRateValue = payload.fx_rate_value || (fxRateSource === "payment_date" ? 49.5 : 48.5);

        const lines = [
          {
            id: 101,
            payroll_run_id: 0,
            employee_id: 1,
            employee_name: "Sarah Connor",
            department: "Engineering",
            compensation_type: "external_usd",
            net_pay: 10000.0,
            amount: 10000.0,
            currency: "USD",
            bank_name: "Chase",
            bank_account_masked: "••••4821",
            payment_status: "pending",
            failure_reason: null,
            snapshot_notes: "External bank payment - " + periodLabel,
            created_at: new Date().toISOString(),
            paid_at: null,
          },
          {
            id: 102,
            payroll_run_id: 0,
            employee_id: 1,
            employee_name: "Sarah Connor",
            department: "Engineering",
            compensation_type: "internal_usd_cash",
            net_pay: 5000.0,
            amount: 5000.0,
            currency: "USD",
            bank_name: "Chase",
            bank_account_masked: "••••4821",
            payment_status: "pending",
            failure_reason: null,
            snapshot_notes: "Internal cash payment - " + periodLabel,
            created_at: new Date().toISOString(),
            paid_at: null,
          },
          {
            id: 103,
            payroll_run_id: 0,
            employee_id: 2,
            employee_name: "John DevOps",
            department: "Operations",
            compensation_type: "internal_usd_cash",
            net_pay: 14000.0,
            amount: 14000.0,
            currency: "USD",
            bank_name: "SVB",
            bank_account_masked: "••••9102",
            payment_status: "pending",
            failure_reason: null,
            snapshot_notes: "Internal cash payment - " + periodLabel,
            created_at: new Date().toISOString(),
            paid_at: null,
          },
        ];

        const exceptions = [];
        let hasBlocking = false;

        if (payload.simulate_missing_bank) {
          hasBlocking = true;
          exceptions.push({
            id: "exc-bank-1",
            employee_id: 1,
            employee_name: "Sarah Connor",
            severity: "blocking",
            code: "MISSING_BANK_DETAILS",
            title: "Missing Bank Wire Details",
            description: "Sarah Connor is scheduled for external bank payment but does not have verified wire details on file.",
            correction_path: "/admin?section=employees&employee_id=1",
            is_resolved: false,
          });
        }

        const totalNet = lines.reduce((sum, l) => sum + l.net_pay, 0);

        return {
          preview_id: `PRV-${periodLabel.replace(/-/g, "")}-0042`,
          preview_version: 1,
          source_version: "src-mock-v1",
          generated_at: new Date().toISOString(),
          period_label: periodLabel,
          period_start: payload.period_start || `${periodLabel}-01`,
          period_end: payload.period_end || `${periodLabel}-30`,
          payment_date: payload.payment_date || payload.period_end || `${periodLabel}-30`,
          bank_account_id: payload.bank_account_id || 1,
          bank_account_name: "Voyance Operating USD",
          external_funding_account_id: payload.external_funding_account_id || 1,
          external_funding_account_name: "Voyance Operating USD",
          internal_funding_account_id: payload.internal_funding_account_id || 2,
          internal_funding_account_name: "Voyance Cash USD Account",
          fx_rate_source: fxRateSource,
          fx_rate_value: fxRateValue,
          headcount: 2,
          recipient_count: 2,
          payment_line_count: lines.length,
          total_net: totalNet,
          total_payment_amount: totalNet,
          prior_period_total: 27000.0,
          change_amount: round(totalNet - 27000.0),
          has_blocking_exceptions: hasBlocking,
          exceptions: exceptions,
          variance_summary: {
            prior_period_label: "2026-08",
            headcount_delta: 0,
            net_delta: round(totalNet - 27000.0),
            pct_change: round(((totalNet - 27000.0) / 27000.0) * 100, 1),
            joiners_count: 0,
            leavers_count: 0,
            raises_count: totalNet > 27000.0 ? 1 : 0,
          },
          lines: lines,
        };
      }
      return apiRequest("POST", "/api/finance/payroll/runs/preview", payload);
    },

    async generatePayrollRun(payload) {
      if (_isMock()) {
        const prev = await this.previewPayrollRun(payload);
        const newRun = {
          id: (FinanceMockState.payrollRuns || []).length + 1,
          period_label: payload.period_label,
          period_start: payload.period_start,
          period_end: payload.period_end,
          payment_date: payload.payment_date || payload.period_end,
          status: "draft",
          fx_rate_source: prev.fx_rate_source,
          fx_rate_value: prev.fx_rate_value,
          total_net: prev.total_net,
          total_payment_amount: prev.total_net,
          headcount: prev.headcount,
          recipient_count: prev.recipient_count,
          payment_line_count: prev.payment_line_count,
          currency: payload.currency || "USD",
          bank_account_id: prev.bank_account_id,
          bank_account_name: prev.bank_account_name,
          external_funding_account_id: prev.external_funding_account_id,
          external_funding_account_name: prev.external_funding_account_name,
          internal_funding_account_id: prev.internal_funding_account_id,
          internal_funding_account_name: prev.internal_funding_account_name,
          created_at: new Date().toISOString(),
          created_by: "admin@voyance.health",
          has_blocking_exceptions: prev.has_blocking_exceptions,
          exceptions: prev.exceptions,
          variance_summary: prev.variance_summary,
          lines: prev.lines.map((l, idx) => ({ ...l, id: idx + 1, payroll_run_id: (FinanceMockState.payrollRuns || []).length + 1 })),
        };
        (FinanceMockState.payrollRuns || (FinanceMockState.payrollRuns = [])).unshift(newRun);
        return newRun;
      }
      return apiRequest("POST", "/api/finance/payroll/runs/generate", payload);
    },

    async createPayrollRun(payload) {
      if (_isMock()) {
        if (payload.source_version === "simulate-stale") {
          throw new Error("Payroll source data has changed since this preview was generated. Please refresh preview.");
        }

        const prev = await this.previewPayrollRun(payload);
        const runId = (FinanceMockState.payrollRuns || []).length + 1;
        const submitForApproval = Boolean(payload.submit_for_approval);

        const newRun = {
          id: runId,
          period_label: payload.period_label,
          period_start: payload.period_start,
          period_end: payload.period_end,
          payment_date: payload.payment_date || payload.period_end,
          status: submitForApproval ? "submitted" : "draft",
          fx_rate_source: payload.fx_rate_source || "first_of_month",
          fx_rate_value: payload.fx_rate_value || prev.fx_rate_value,
          total_net: prev.total_net,
          total_payment_amount: prev.total_net,
          headcount: prev.headcount,
          recipient_count: prev.recipient_count,
          payment_line_count: prev.payment_line_count,
          currency: payload.currency || "USD",
          bank_account_id: payload.bank_account_id || prev.bank_account_id,
          bank_account_name: prev.bank_account_name,
          external_funding_account_id: payload.external_funding_account_id || prev.external_funding_account_id,
          external_funding_account_name: prev.external_funding_account_name,
          internal_funding_account_id: payload.internal_funding_account_id || prev.internal_funding_account_id,
          internal_funding_account_name: prev.internal_funding_account_name,
          preview_id: payload.preview_id || prev.preview_id,
          preview_version: payload.preview_version || prev.preview_version,
          source_version: payload.source_version || prev.source_version,
          created_at: new Date().toISOString(),
          created_by: "preparer@voyance.health",
          submitted_at: submitForApproval ? new Date().toISOString() : null,
          submitted_by: submitForApproval ? "preparer@voyance.health" : null,
          approved_at: null,
          approved_by: null,
          finalized_at: null,
          finalized_by: null,
          paid_at: null,
          paid_by: null,
          has_blocking_exceptions: prev.has_blocking_exceptions,
          exceptions: prev.exceptions,
          variance_summary: prev.variance_summary,
          lines: prev.lines.map((l, idx) => ({ ...l, id: idx + 10, payroll_run_id: runId })),
        };
        (FinanceMockState.payrollRuns || (FinanceMockState.payrollRuns = [])).unshift(newRun);
        return newRun;
      }
      return apiRequest("POST", "/api/finance/payroll/runs", payload);
    },

    async submitPayrollRun(runId) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        if (run.status !== "draft") {
          throw new Error(`Only draft runs can be submitted for approval. Current status: ${run.status}`);
        }
        run.status = "submitted";
        run.submitted_at = new Date().toISOString();
        run.submitted_by = "preparer@voyance.health";
        return run;
      }
      return apiRequest("POST", `/api/finance/payroll/runs/${runId}/submit`);
    },

    async approvePayrollRun(runId, allowSelfApproval = false) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        if (!["draft", "submitted"].includes(run.status)) {
          throw new Error(`Payroll run #${runId} is in status '${run.status}', only draft or submitted runs can be approved.`);
        }
        if (!allowSelfApproval && run.simulate_self_approval_error) {
          throw new Error("Maker-checker policy violation: The preparer or submitter cannot approve their own payroll run. An independent finance reviewer must approve.");
        }
        run.status = "approved";
        run.approved_at = new Date().toISOString();
        run.approved_by = "cfo@voyance.health";
        return run;
      }
      return apiRequest("POST", `/api/finance/payroll/runs/${runId}/approve`);
    },

    async finalizePayrollRun(runId) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        if (run.status !== "approved") {
          throw new Error(`Payroll run #${runId} must be approved before finalization. Current status: '${run.status}'.`);
        }
        run.status = "finalized";
        run.finalized_at = new Date().toISOString();
        run.finalized_by = "cfo@voyance.health";
        return run;
      }
      return apiRequest("POST", `/api/finance/payroll/runs/${runId}/finalize`);
    },

    async disbursePayrollRun(runId, retryFailedOnly = false, simulateFailures = null) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        const lines = run.lines || [];
        const now = new Date().toISOString();

        lines.forEach((l) => {
          if (retryFailedOnly && l.payment_status !== "failed") return;
          if (!retryFailedOnly && l.payment_status === "paid") return;

          if (simulateFailures && simulateFailures.includes(l.employee_id)) {
            l.payment_status = "failed";
            l.failure_reason = "Payment Gateway Reject: Account Routing Failure";
          } else {
            l.payment_status = "paid";
            l.paid_at = now;
            l.failure_reason = null;
          }
        });

        const hasFailed = lines.some((l) => l.payment_status === "failed");
        const hasPending = lines.some((l) => l.payment_status === "pending");

        if (hasFailed) {
          run.status = "partially_paid";
        } else if (!hasPending) {
          run.status = "paid";
          run.paid_at = now;
        }
        run.paid_by = "payroll@voyance.health";
        return run;
      }
      return apiRequest("POST", `/api/finance/payroll/runs/${runId}/pay`, {
        retry_failed_only: retryFailedOnly,
        simulate_partial_failure_ids: simulateFailures,
      });
    },

    async postPayrollJournal(runId) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        run.journal_transaction_id = 999;
        return {
          success: true,
          journal_transaction_id: 999,
          reference: `PAYROLL-${run.period_label}`,
          amount: run.total_net,
          date: new Date().toISOString().slice(0, 10),
          is_already_posted: false,
        };
      }
      return apiRequest("POST", `/api/finance/payroll/runs/${runId}/post-journal`);
    },

    async addPayrollLine(runId, payload) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        if (run.status !== "draft") {
          throw new Error(`Cannot add lines to payroll run #${runId}: Run is locked in status '${run.status}'.`);
        }

        const amt = round(Number(payload.amount || payload.base_salary || 0));
        const cType = payload.compensation_type || "internal_usd_cash";
        const empId = parseInt(payload.employee_id, 10);

        let empName = "Employee";
        let dept = "General";
        let bankName = "Commercial Bank";
        let bankAcc = "••••4821";

        const existingLine = (run.lines || []).find((l) => l.employee_id === empId);
        if (existingLine) {
          empName = existingLine.employee_name;
          dept = existingLine.department;
          bankName = existingLine.bank_name;
          bankAcc = existingLine.bank_account_masked;
        }

        const newLine = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          payroll_run_id: run.id,
          employee_id: empId,
          employee_name: empName,
          department: dept,
          compensation_type: cType,
          net_pay: amt,
          amount: amt,
          currency: run.currency || "USD",
          bank_name: bankName,
          bank_account_masked: bankAcc,
          payment_status: "pending",
          failure_reason: null,
          snapshot_notes: payload.notes || payload.snapshot_notes || `${cType.replace(/_/g, " ")} - ${run.period_label}`,
          created_at: new Date().toISOString(),
          paid_at: null,
        };

        if (!run.lines) run.lines = [];
        run.lines.push(newLine);

        run.total_net = round(run.lines.reduce((s, l) => s + Number(l.net_pay || 0), 0));
        run.total_payment_amount = run.total_net;
        run.headcount = new Set(run.lines.map((l) => l.employee_id)).size;
        run.recipient_count = run.headcount;
        run.payment_line_count = run.lines.length;

        return newLine;
      }
      return apiRequest("POST", `/api/finance/payroll/runs/${runId}/lines`, payload);
    },

    async deletePayrollLine(runId, lineId) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        if (run.status !== "draft") {
          throw new Error(`Cannot delete lines from payroll run #${runId}: Run is locked in status '${run.status}'.`);
        }

        const idx = (run.lines || []).findIndex((l) => l.id === parseInt(lineId, 10));
        if (idx === -1) throw new Error(`Payroll line #${lineId} not found in run #${runId}`);
        run.lines.splice(idx, 1);

        run.total_net = round(run.lines.reduce((s, l) => s + Number(l.net_pay || 0), 0));
        run.total_payment_amount = run.total_net;
        run.headcount = new Set(run.lines.map((l) => l.employee_id)).size;
        run.recipient_count = run.headcount;
        run.payment_line_count = run.lines.length;

        return { success: true };
      }
      return apiRequest("DELETE", `/api/finance/payroll/runs/${runId}/lines/${lineId}`);
    },

    async getMyPayslips() {
      if (_isMock()) {
        const runs = FinanceMockState.payrollRuns || [];
        const results = [];
        runs.forEach((r) => {
          (r.lines || []).forEach((l) => {
            results.push({
              id: l.id,
              payroll_run_id: r.id,
              employee_id: l.employee_id,
              employee_name: l.employee_name,
              department: l.department,
              period_label: r.period_label,
              period_start: r.period_start,
              period_end: r.period_end,
              currency: r.currency || "USD",
              net_pay: l.net_pay,
              amount: l.net_pay,
              payment_status: l.payment_status || "paid",
              bank_name: l.bank_name,
              bank_account_masked: l.bank_account_masked,
              compensation_type: l.compensation_type,
              paid_date: l.paid_at ? l.paid_at.slice(0, 10) : r.period_end,
            });
          });
        });
        return results;
      }
      return apiRequest("GET", "/api/finance/payroll/payslips/my");
    },

    async getEmployeePayslip(runId, employeeId) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        const empLines = (run.lines || []).filter((l) => l.employee_id === parseInt(employeeId, 10));
        if (empLines.length === 0) throw new Error(`Employee #${employeeId} not found in run #${runId}`);
        const line = empLines[0];
        const netPay = empLines.reduce((sum, l) => sum + Number(l.net_pay || 0), 0);
        return {
          id: line.id,
          payroll_run_id: run.id,
          employee_id: line.employee_id,
          employee_name: line.employee_name,
          department: line.department,
          period_label: run.period_label,
          period_start: run.period_start,
          period_end: run.period_end,
          currency: run.currency || "USD",
          net_pay: netPay,
          amount: netPay,
          status: line.payment_status || "paid",
          paid_date: line.paid_at ? line.paid_at.slice(0, 10) : run.period_end,
          bank_name: line.bank_name,
          bank_account_masked: line.bank_account_masked,
          compensation_type: line.compensation_type,
        };
      }
      return apiRequest("GET", `/api/finance/payroll/runs/${runId}/payslips/${employeeId}`);
    },

    // Employee Compensation Plans (FUX-416)
    async getEmployeeCompensationPlan(employeeId) {
      if (_isMock()) {
        const plans = (FinanceMockState.compensationPlans || []).filter(
          (p) => String(p.employee_id) === String(employeeId) && !p.effective_end_date
        );
        const ext = plans.find((p) => p.component_type === "external_usd") || null;
        const intCash = plans.find((p) => p.component_type === "internal_usd_cash") || null;
        const total = round((ext ? Number(ext.amount) : 0) + (intCash ? Number(intCash.amount) : 0));
        return {
          employee_id: employeeId,
          external_usd: ext,
          internal_usd_cash: intCash,
          total_monthly_usd: total,
        };
      }
      return apiRequest("GET", `/api/finance/employees/${employeeId}/compensation-plan`);
    },

    async getEmployeeCompensationPlanHistory(employeeId) {
      if (_isMock()) {
        const history = (FinanceMockState.compensationPlans || [])
          .filter((p) => String(p.employee_id) === String(employeeId))
          .sort((a, b) => new Date(b.effective_start_date) - new Date(a.effective_start_date) || b.id - a.id);
        return history;
      }
      return apiRequest("GET", `/api/finance/employees/${employeeId}/compensation-plan/history`);
    },

    async setEmployeeCompensationPlanComponent(employeeId, componentType, data) {
      if (_isMock()) {
        const amt = Number(data.amount);
        if (isNaN(amt) || amt <= 0) {
          throw new Error("Component amount must be greater than 0");
        }
        if (!data.effective_start_date) {
          throw new Error("effective_start_date is required");
        }
        if (!["external_usd", "internal_usd_cash"].includes(componentType)) {
          throw new Error(`Invalid component_type '${componentType}'`);
        }

        const plans = FinanceMockState.compensationPlans || [];
        const activeIdx = plans.findIndex(
          (p) => String(p.employee_id) === String(employeeId) && p.component_type === componentType && !p.effective_end_date
        );

        if (activeIdx >= 0) {
          const active = plans[activeIdx];
          if (data.effective_start_date <= active.effective_start_date) {
            throw new Error(`New effective_start_date must be strictly after current component start date (${active.effective_start_date})`);
          }
          const d = new Date(data.effective_start_date);
          d.setDate(d.getDate() - 1);
          active.effective_end_date = d.toISOString().slice(0, 10);
          active.updated_at = new Date().toISOString();
        }

        const newId = plans.length > 0 ? Math.max(...plans.map((p) => p.id)) + 1 : 1;
        const newRow = {
          id: newId,
          employee_id: employeeId,
          component_type: componentType,
          amount: round(amt),
          currency: "USD",
          effective_start_date: data.effective_start_date,
          effective_end_date: null,
          notes: data.notes || "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        plans.push(newRow);

        if (typeof employees !== "undefined" && Array.isArray(employees)) {
          const emp = employees.find((e) => String(e.id) === String(employeeId));
          if (emp) {
            if (componentType === "external_usd") emp.externalSalaryUsd = round(amt);
            if (componentType === "internal_usd_cash") emp.internalSalaryUsd = round(amt);
            emp.salary = round((emp.externalSalaryUsd || 0) + (emp.internalSalaryUsd || 0));
          }
        }

        return newRow;
      }
      return apiRequest("PUT", `/api/finance/employees/${employeeId}/compensation-plan/${componentType}`, data);
    },

    getLastCorrelationId() {
      return typeof window.Api !== "undefined" && window.Api.getLastCorrelationId
        ? window.Api.getLastCorrelationId()
        : (typeof _lastCorrelationId !== "undefined" && _lastCorrelationId ? _lastCorrelationId : `corr-${Date.now()}`);
    },

    generateCorrelationId() {
      return typeof window.Api !== "undefined" && window.Api.generateCorrelationId
        ? window.Api.generateCorrelationId()
        : `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    },
  };

  root.FinancePayrollApi = FinancePayrollApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinancePayrollApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinancePayrollApi;
  }
})(typeof window !== "undefined" ? window : globalThis);


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
