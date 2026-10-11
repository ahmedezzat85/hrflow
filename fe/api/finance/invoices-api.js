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

  // D-024: withholding is on the net subtotal; received plus withheld settles the invoice
  const _refreshWithholding = (inv) => {
    inv.withholding_tax_rate = Number(inv.withholding_tax_rate || 0);
    inv.withholding_amount = round((inv.subtotal || 0) * inv.withholding_tax_rate / 100, 2);
    inv.expected_to_receive = round((inv.total || 0) - inv.withholding_amount, 2);
  };
  const _liveReceipts = (invId) => FinanceMockState.payments.filter((p) => p.related_invoice_id === invId && !p.is_reversed);
  const _refreshSettlement = (inv) => {
    const live = _liveReceipts(inv.id);
    const cash = live.reduce((s, p) => s + (p.amount || 0), 0);
    const withheld = live.reduce((s, p) => s + (p.withheld_amount || 0), 0);
    inv.amount_paid = round(cash, 2);
    inv.withheld_total = round(withheld, 2);
    inv.balance = Math.max(0, round((inv.total || 0) - cash - withheld, 2));
    return { cash, withheld, settled: cash + withheld };
  };

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
    { id: 4, customer_id: 4, customer_name: "Delta Medical", invoice_number: "INV-2026-004", issue_date: "2026-09-02", due_date: "2026-09-25", status: "partially_paid", currency: "USD", expected_bank_account_id: 1, expected_bank_account_name: "Voyance Operating USD", revenue_channel: "intercompany_transfer_us", has_bank_discrepancy: false, subtotal: 11000.0, tax_amount: 0.0, total: 11000.0, amount_paid: 4000.0, balance: 7000.0, is_overdue: false, days_overdue: 0, next_action: "Collect Remaining Balance", notes: "Consulting Retainer Q3", created_at: "2026-09-02T09:00:00", lines: [{ id: 4, invoice_id: 4, description: "Consulting Hours", quantity: 10, unit_price: 1100.0, line_total: 11000.0 }] },
    { id: 5, customer_id: 5, customer_name: "Echo Clinics", invoice_number: "INV-2026-005", issue_date: "2026-08-10", due_date: "2026-09-10", status: "paid", currency: "USD", expected_bank_account_id: 1, expected_bank_account_name: "Voyance Operating USD", revenue_channel: "overseas_usd", has_bank_discrepancy: false, subtotal: 20000.0, tax_amount: 0.0, total: 20000.0, amount_paid: 20000.0, balance: 0.0, is_overdue: false, days_overdue: 0, next_action: "Completed (Paid in Full)", notes: "Setup & Onboarding", created_at: "2026-08-10T10:00:00", lines: [{ id: 5, invoice_id: 5, description: "Setup Fee", quantity: 1, unit_price: 20000.0, line_total: 20000.0 }] },
    { id: 6, customer_id: 6, customer_name: "Frontier Labs", invoice_number: "INV-2026-006", issue_date: "2026-08-20", due_date: "2026-09-20", status: "void", currency: "USD", expected_bank_account_id: 2, expected_bank_account_name: "Voyance Treasury Reserve", revenue_channel: "other", has_bank_discrepancy: false, subtotal: 25000.0, tax_amount: 0.0, total: 25000.0, amount_paid: 0.0, balance: 0.0, is_overdue: false, days_overdue: 0, next_action: "Archived (Voided)", notes: "Canceled service request", created_at: "2026-08-20T11:00:00", lines: [{ id: 6, invoice_id: 6, description: "Canceled item", quantity: 1, unit_price: 25000.0, line_total: 25000.0 }] },
  ];
  }

  if (!FinanceMockState.payments) {
    FinanceMockState.payments = [];
  }

  // BE-2 (doc 22): open receivables per currency (sent and partially paid invoices).
  const _withReceivables = (c) => {
    const byCurrency = {};
    (FinanceMockState.invoices || []).filter((i) => i.customer_id === c.id && ["sent", "partially_paid"].includes(i.status)).forEach((i) => {
      const cur = i.currency || "USD";
      const row = byCurrency[cur] || (byCurrency[cur] = { currency: cur, open_amount: 0, open_count: 0, overdue_count: 0, max_days_overdue: 0 });
      const balance = i.balance !== undefined ? i.balance : Math.max(0, (i.total || 0) - (i.amount_paid || 0));
      row.open_amount = Math.round((row.open_amount + balance) * 100) / 100;
      row.open_count += 1;
      if (i.is_overdue) {
        row.overdue_count += 1;
        row.max_days_overdue = Math.max(row.max_days_overdue, i.days_overdue || 0);
      }
    });
    return { ...c, receivables: Object.values(byCurrency) };
  };

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
          list = list.filter((i) => (i.status === "sent" || i.status === "partially_paid") && !i.is_overdue);
        } else if (st === "overdue") {
          list = list.filter((i) => (i.status === "sent" || i.status === "partially_paid") && i.is_overdue);
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
      if (payload && "status" in payload) throw new Error("status cannot be set by the client; set by the server through invoice actions");
      const customers = FinanceMockState.customers;
      const cust = customers.find((c) => c.id === parseInt(payload.customer_id, 10));
      const bank = payload.expected_bank_account_id ? (FinanceMockState.accounts || []).find((b) => b.id === parseInt(payload.expected_bank_account_id, 10)) : null;
      const lines = (payload.lines || []).map((ln, i) => ({
        id: Date.now() + i, invoice_id: FinanceMockState.invoices.length + 1,
        ...ln, line_total: ln.line_total || (ln.quantity * ln.unit_price),
      }));
      const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
      const vatRate = payload.vat_rate !== undefined && payload.vat_rate !== null ? Number(payload.vat_rate) : (String(payload.currency || "USD").toUpperCase() === "EGP" ? 14 : 0);
      const taxAmount = round(subtotal * vatRate / 100, 2);
      const newInv = {
        id: FinanceMockState.invoices.length + 1,
        ...payload,
        status: "draft",
        amount_paid: 0, balance: subtotal, is_overdue: false, days_overdue: 0,
        next_action: "Review & Send to Customer",
        customer_name: cust ? cust.name : null,
        expected_bank_account_name: bank ? bank.account_name : null,
        has_bank_discrepancy: false,
        subtotal, vat_rate: vatRate, tax_amount: taxAmount, total: round(subtotal + taxAmount, 4),
        balance: round(subtotal + taxAmount, 4), withheld_total: 0,
        withholding_tax_rate: payload.withholding_tax_rate !== undefined && payload.withholding_tax_rate !== null
          ? Number(payload.withholding_tax_rate)
          : Number((cust && cust.withholding_tax_rate) || 0),
        created_at: new Date().toISOString(),
        lines,
      };
      _refreshWithholding(newInv);
      FinanceMockState.invoices.push(newInv);
      return newInv;
    }
    return apiRequest("POST", "/api/finance/invoices", payload);
  },
  async updateInvoice(id, payload) {
    if (_isMock()) {
      const inv = FinanceMockState.invoices.find((i) => i.id === parseInt(id, 10));
      if (!inv) throw new Error("Invoice not found");
      if (payload && "status" in payload) throw new Error("status cannot be set by the client; set by the server through invoice actions");
      if (inv.status === "void") throw new Error("invoice_void: Cannot update a voided invoice");
      if (inv.status !== "draft") {
        // D-022: customer, currency, lines and number are locked once issued; unchanged values may be resent
        const changed = [];
        if (payload.customer_id !== undefined && parseInt(payload.customer_id, 10) !== inv.customer_id) changed.push("customer_id");
        if (payload.currency !== undefined && payload.currency !== inv.currency) changed.push("currency");
        if (payload.invoice_number !== undefined && payload.invoice_number !== inv.invoice_number) changed.push("invoice_number");
        if (payload.issue_date !== undefined && payload.issue_date !== inv.issue_date) changed.push("issue_date");
        if (payload.vat_rate !== undefined && Number(payload.vat_rate) !== Number(inv.vat_rate || 0)) changed.push("vat_rate");
        if (payload.withholding_tax_rate !== undefined && Number(payload.withholding_tax_rate) !== Number(inv.withholding_tax_rate || 0)) changed.push("withholding_tax_rate");
        if (payload.lines) {
          const norm = (rows) => JSON.stringify((rows || []).map((l) => [String(l.description).trim(), Number(l.quantity), Number(l.unit_price)]).sort());
          if (norm(payload.lines) !== norm(inv.lines)) changed.push("lines");
        }
        if (changed.length) throw new Error(`invoice_locked: ${changed.join(", ")} cannot be changed once an invoice is issued. Void and reissue to correct.`);
        payload = { ...payload };
        ["customer_id", "currency", "invoice_number", "issue_date", "vat_rate", "withholding_tax_rate", "lines"].forEach((k) => delete payload[k]);
      }
      Object.assign(inv, payload);
      if (payload.expected_bank_account_id !== undefined) {
        const bank = payload.expected_bank_account_id ? (FinanceMockState.accounts || []).find((b) => b.id === parseInt(payload.expected_bank_account_id, 10)) : null;
        inv.expected_bank_account_name = bank ? bank.account_name : null;
      }
      if (payload.lines || payload.vat_rate !== undefined) {
        if (payload.lines) inv.subtotal = payload.lines.reduce((s, l) => s + (l.line_total || l.quantity * l.unit_price), 0);
        inv.tax_amount = round(inv.subtotal * Number(inv.vat_rate || 0) / 100, 2);
        inv.total = round(inv.subtotal + inv.tax_amount, 4);
        inv.balance = inv.total;
      }
      _refreshWithholding(inv);
      return inv;
    }
    return apiRequest("PUT", `/api/finance/invoices/${id}`, payload);
  },
  async sendInvoice(id) {
    if (_isMock()) {
      const inv = FinanceMockState.invoices.find((i) => i.id === parseInt(id, 10));
      if (!inv) throw new Error("Invoice not found");
      if (inv.status !== "draft") throw new Error(`invalid_transition: Cannot send an invoice in '${inv.status}' status`);
      inv.status = "sent";
      inv.next_action = "Awaiting Due Date / Payment";
      return inv;
    }
    return apiRequest("POST", `/api/finance/invoices/${id}/send`);
  },
  async voidInvoice(id, reason = null) {
    if (_isMock()) {
      const inv = FinanceMockState.invoices.find((i) => i.id === parseInt(id, 10));
      if (!inv) throw new Error("Invoice not found");
      const live = FinanceMockState.payments.filter((p) => p.related_invoice_id === inv.id && !p.is_reversed);
      if (live.length > 0 || inv.status === "paid" || inv.status === "partially_paid") {
        throw new Error("has_unreversed_receipts: Cannot void an invoice that has unreversed receipts. Reverse the receipts first.");
      }
      if (inv.status === "void") throw new Error("invalid_transition: Cannot void an invoice in 'void' status");
      inv.status = "void";
      inv.void_reason = reason || null;
      inv.voided_by = "admin@voyancemed.com";
      inv.voided_at = new Date().toISOString();
      inv.is_overdue = false;
      inv.next_action = "Archived (Voided)";
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

      if (inv && inv.status !== "sent" && inv.status !== "partially_paid") {
        throw new Error(`invalid_transition: Cannot receive an invoice in '${inv.status}' status`);
      }
      const recvAccount = (FinanceMockState.accounts || []).find((b) => b.id === bankId);
      if (inv && recvAccount && (recvAccount.currency || "").toUpperCase() !== (inv.currency || "").toUpperCase()) {
        throw new Error(`currency_mismatch: Account currency (${recvAccount.currency}) differs from the invoice currency (${inv.currency}). Receive into a ${inv.currency} account.`);
      }

      // Duplicate reference check
      if (payload.reference && payload.reference.trim()) {
        const refTrim = payload.reference.trim();
        const dup = FinanceMockState.payments.find((p) => p.reference === refTrim && !p.is_reversed);
        if (dup) throw new Error(`Duplicate payment reference '${refTrim}' detected. Please review.`);
      }

      // Overpayment check: received plus withheld may not exceed the open balance
      const withheldNow = Number(payload.withheld_amount || 0);
      if (inv) {
        _refreshWithholding(inv);
        const { withheld: withheldSoFar, settled } = _refreshSettlement(inv);
        const remaining = Math.max(0, (inv.total || 0) - settled);
        if (payload.amount + withheldNow > remaining + 0.001) {
          throw new Error(`Payment amount (${payload.amount + withheldNow}) exceeds remaining balance (${remaining}). Overpayment is prevented.`);
        }
        if (withheldNow > 0 && withheldSoFar + withheldNow > inv.withholding_amount + 0.01) {
          throw new Error(`withheld_exceeds_expected: Withheld tax (${withheldSoFar + withheldNow}) exceeds the withholding expected on this invoice (${inv.withholding_amount}).`);
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
        withheld_amount: withheldNow,
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
        const { settled: totalPaid } = _refreshSettlement(inv);
        inv.status = totalPaid >= inv.total - 0.001 ? "paid" : "partially_paid";
        inv.is_overdue = inv.status === "partially_paid" && !!inv.due_date && inv.due_date < new Date().toISOString().slice(0, 10);
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
      payment.reversed_at = new Date().toISOString();
      payment.reversal_reason = reason || null;
      const inv = FinanceMockState.invoices.find((i) => i.id === parseInt(invoiceId, 10));
      if (inv) {
        const { settled: totalPaid } = _refreshSettlement(inv);
        if (inv.status !== "void") {
          inv.status = totalPaid >= inv.total - 0.001 ? "paid" : (totalPaid > 0.001 ? "partially_paid" : "sent");
          inv.is_overdue = (inv.status === "sent" || inv.status === "partially_paid") && !!inv.due_date && inv.due_date < new Date().toISOString().slice(0, 10);
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
      if (inv.status !== "sent" && inv.status !== "partially_paid") {
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
      return list.map(_withReceivables);
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
      return _withReceivables(cust);
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

        const derivedStatus = isVoid ? "void" : (bal <= 0.001 && inv.total > 0 ? "paid" : (inv.status || "sent"));
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
