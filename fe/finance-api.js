/**
 * fe/finance-api.js
 * API client for Finance module endpoints (/api/finance/*).
 * Mirrors fe/api.js conventions and uses the shared apiRequest helper.
 * Includes graceful mock-mode fallback when ?mock=admin is in URL.
 */
const _isMock = () => typeof window !== "undefined" && window.location && window.location.search.includes("mock=");
function round(val, decimals = 2) {
  return Math.round((Number(val || 0) + Number.EPSILON) * Math.pow(10, decimals)) / Math.pow(10, decimals);
}
window.round = round;

function _getIdempHeaders(explicitKey = null) {
  const key = explicitKey || (typeof FinanceCommand !== "undefined" && FinanceCommand.generateIdempotencyKey ? FinanceCommand.generateIdempotencyKey() : null);
  return key ? { "Idempotency-Key": key } : {};
}

const FinanceMockState = {
  accounts: [
    { id: 1, account_name: "Voyance Operating USD", account_type: "bank", bank_name: "JPMorgan Chase", account_number: "******4821", currency: "USD", opening_balance: 150000.0, current_balance: 150000.0, is_active: true },
    { id: 2, account_name: "Voyance Treasury Reserve", account_type: "bank", bank_name: "Silicon Valley Bank", account_number: "******9102", currency: "USD", opening_balance: 500000.0, current_balance: 500000.0, is_active: true },
    { id: 3, account_name: "CIB EGP Operating", account_type: "bank", bank_name: "Commercial International Bank", account_number: "******3319", currency: "EGP", opening_balance: 450000.0, current_balance: 450000.0, is_active: true },
    { id: 4, account_name: "Cairo Office Petty Cash Drawer", account_type: "cash", bank_name: null, account_number: "CASH-CAIRO-01", currency: "EGP", opening_balance: 20000.0, current_balance: 20000.0, is_active: true },
  ],
  customers: [
    { id: 1, name: "Apex Health Partners", legal_name: "Apex Healthcare Systems LLC", contact_email: "billing@apexhealth.com", contact_phone: "+1 555-0120", tax_id: "US-88992211", billing_address: "100 Medical Center Blvd", country: "United States", default_currency: "USD", payment_terms_days: 30, owner: "Sarah Connor", notes: "Enterprise client", is_active: true },
    { id: 2, name: "BioCare Diagnostics", legal_name: "BioCare International Inc", contact_email: "ap@biocare.org", contact_phone: "+1 555-0144", tax_id: "US-33441199", billing_address: "450 Lab Parkway", country: "United States", default_currency: "USD", payment_terms_days: 30, owner: "Sarah Connor", notes: "Monthly billing", is_active: true },
    { id: 3, name: "CareFirst Health", legal_name: "CareFirst Regional Health Corp", contact_email: "ap@carefirst.org", contact_phone: "+1 555-0199", tax_id: "US-77889900", billing_address: "770 Care Ave", country: "United States", default_currency: "USD", payment_terms_days: 15, owner: "Sarah Connor", notes: "Overdue account", is_active: true },
    { id: 4, name: "Delta Medical", legal_name: "Delta Medical Equipment Ltd", contact_email: "finance@deltamed.com", contact_phone: "+1 555-0177", tax_id: "US-55443322", billing_address: "12 Nile St, Maadi", country: "Egypt", default_currency: "USD", payment_terms_days: 45, owner: "Sarah Connor", notes: "Consulting client", is_active: true },
    { id: 5, name: "Echo Clinics", legal_name: "Echo Clinics Network SAE", contact_email: "billing@echoclinics.com", contact_phone: "+1 555-0155", tax_id: "EG-11223344", billing_address: "5 Tahrir Sq, Cairo", country: "Egypt", default_currency: "USD", payment_terms_days: 30, owner: "Sarah Connor", notes: "Clinical partner", is_active: true },
    { id: 6, name: "Frontier Labs", legal_name: "Frontier Diagnostics Research", contact_email: "info@frontierlabs.com", contact_phone: "+1 555-0111", tax_id: "US-99887766", billing_address: "88 Science Park", country: "United States", default_currency: "USD", payment_terms_days: 60, owner: "Sarah Connor", notes: "Research lab", is_active: true },
  ],
  vendors: [
    { id: 1, name: "Amazon Web Services", category: "Infrastructure", contact_email: "aws-receivables@amazon.com", contact_phone: "+1 800-555-0199", tax_id: "VAT-1294819", notes: "Hosting & compute", is_active: true },
    { id: 2, name: "Slack Technologies", category: "SaaS", contact_email: "billing@slack.com", contact_phone: "+1 800-555-0188", tax_id: "VAT-9988112", notes: "Team communication", is_active: true },
  ],
  invoices: [
    { id: 1, customer_id: 1, customer_name: "Apex Health Partners", invoice_number: "INV-2026-001", issue_date: "2026-09-01", due_date: "2026-09-30", status: "sent", currency: "USD", expected_bank_account_id: 1, expected_bank_account_name: "Voyance Operating USD", revenue_channel: "overseas_usd", has_bank_discrepancy: false, subtotal: 12500.0, tax_amount: 0.0, total: 12500.0, amount_paid: 0.0, balance: 12500.0, is_overdue: false, days_overdue: 0, next_action: "Awaiting Due Date / Payment", notes: "Q3 PACS Integration Services", created_at: "2026-09-01T08:00:00", lines: [{ id: 1, invoice_id: 1, description: "PACS Integration", quantity: 1, unit_price: 12500.0, line_total: 12500.0 }] },
    { id: 2, customer_id: 2, customer_name: "BioCare Diagnostics", invoice_number: "INV-2026-002", issue_date: "2026-09-05", due_date: "2026-10-05", status: "draft", currency: "USD", expected_bank_account_id: 2, expected_bank_account_name: "Voyance Treasury Reserve", revenue_channel: "intercompany_transfer_us", has_bank_discrepancy: false, subtotal: 8400.0, tax_amount: 0.0, total: 8400.0, amount_paid: 0.0, balance: 8400.0, is_overdue: false, days_overdue: 0, next_action: "Review & Send to Customer", notes: "Monthly DICOM utility SaaS", created_at: "2026-09-05T09:00:00", lines: [{ id: 2, invoice_id: 2, description: "DICOM SaaS", quantity: 6, unit_price: 1400.0, line_total: 8400.0 }] },
    { id: 3, customer_id: 3, customer_name: "CareFirst Health", invoice_number: "INV-2026-003", issue_date: "2026-08-01", due_date: "2026-08-15", status: "sent", currency: "USD", expected_bank_account_id: 1, expected_bank_account_name: "Voyance Operating USD", revenue_channel: "overseas_usd", has_bank_discrepancy: false, subtotal: 10000.0, tax_amount: 0.0, total: 10000.0, amount_paid: 0.0, balance: 10000.0, is_overdue: true, days_overdue: 29, next_action: "Send Payment Reminder (29d overdue)", notes: "Prior cycle maintenance", created_at: "2026-08-01T08:00:00", lines: [{ id: 3, invoice_id: 3, description: "System Maintenance", quantity: 1, unit_price: 10000.0, line_total: 10000.0 }] },
    { id: 4, customer_id: 4, customer_name: "Delta Medical", invoice_number: "INV-2026-004", issue_date: "2026-09-02", due_date: "2026-09-25", status: "sent", currency: "USD", expected_bank_account_id: 1, expected_bank_account_name: "Voyance Operating USD", revenue_channel: "intercompany_transfer_us", has_bank_discrepancy: false, subtotal: 11000.0, tax_amount: 0.0, total: 11000.0, amount_paid: 4000.0, balance: 7000.0, is_overdue: false, days_overdue: 0, next_action: "Collect Remaining Balance", notes: "Consulting Retainer Q3", created_at: "2026-09-02T09:00:00", lines: [{ id: 4, invoice_id: 4, description: "Consulting Hours", quantity: 10, unit_price: 1100.0, line_total: 11000.0 }] },
    { id: 5, customer_id: 5, customer_name: "Echo Clinics", invoice_number: "INV-2026-005", issue_date: "2026-08-10", due_date: "2026-09-10", status: "paid", currency: "USD", expected_bank_account_id: 1, expected_bank_account_name: "Voyance Operating USD", revenue_channel: "overseas_usd", has_bank_discrepancy: false, subtotal: 20000.0, tax_amount: 0.0, total: 20000.0, amount_paid: 20000.0, balance: 0.0, is_overdue: false, days_overdue: 0, next_action: "Completed (Paid in Full)", notes: "Setup & Onboarding", created_at: "2026-08-10T10:00:00", lines: [{ id: 5, invoice_id: 5, description: "Setup Fee", quantity: 1, unit_price: 20000.0, line_total: 20000.0 }] },
    { id: 6, customer_id: 6, customer_name: "Frontier Labs", invoice_number: "INV-2026-006", issue_date: "2026-08-20", due_date: "2026-09-20", status: "void", currency: "USD", expected_bank_account_id: 2, expected_bank_account_name: "Voyance Treasury Reserve", revenue_channel: "other", has_bank_discrepancy: false, subtotal: 25000.0, tax_amount: 0.0, total: 25000.0, amount_paid: 0.0, balance: 0.0, is_overdue: false, days_overdue: 0, next_action: "Archived (Voided)", notes: "Canceled service request", created_at: "2026-08-20T11:00:00", lines: [{ id: 6, invoice_id: 6, description: "Canceled item", quantity: 1, unit_price: 25000.0, line_total: 25000.0 }] },
  ],
  bills: [
    { id: 1, vendor_id: 1, vendor_name: "Amazon Web Services", bill_number: "BILL-2026-001", category: "Infrastructure", issue_date: "2026-09-01", due_date: "2026-09-30", status: "unpaid", currency: "USD", subtotal: 4200.0, tax_amount: 0.0, total: 4200.0, notes: "September cloud hosting", created_at: "2026-09-01T08:00:00", lines: [{ id: 1, bill_id: 1, description: "EC2 + S3 usage", quantity: 1, unit_price: 4200.0, line_total: 4200.0 }] },
    { id: 2, vendor_id: 2, vendor_name: "Slack Technologies", bill_number: "BILL-2026-002", category: "SaaS", issue_date: "2026-09-03", due_date: "2026-09-18", status: "paid", currency: "USD", subtotal: 320.0, tax_amount: 0.0, total: 320.0, notes: "Team plan renewal", created_at: "2026-09-03T09:00:00", lines: [{ id: 2, bill_id: 2, description: "Slack Business+ (40 seats)", quantity: 40, unit_price: 8.0, line_total: 320.0 }] },
  ],
  payments: [],
  billPayments: [],
  categories: [
    { id: 1, name: "Revenue", kind: "revenue", is_active: true, sort_order: 1, is_petty: false },
    { id: 2, name: "Salaries", kind: "cost", is_active: true, sort_order: 2, is_petty: false },
    { id: 3, name: "Medical Insurance", kind: "cost", is_active: true, sort_order: 3, is_petty: false },
    { id: 4, name: "Kitchen Supplies", kind: "cost", is_active: true, sort_order: 4, is_petty: true },
    { id: 5, name: "Transportation", kind: "cost", is_active: true, sort_order: 5, is_petty: true },
    { id: 6, name: "Rent", kind: "cost", is_active: true, sort_order: 6, is_petty: false },
    { id: 7, name: "Other", kind: "other", is_active: true, sort_order: 99, is_petty: false },
  ],
  paymentTypes: [
    { id: 1, name: "Cash", code: "CASH", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 2, name: "Cheque", code: "CHEQUE", requires_cheque_number: true, requires_bank_fee_flag: false, is_active: true },
    { id: 3, name: "Incoming Wire / Transfer", code: "INCOMING_WIRE", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 4, name: "Internal Transfer", code: "INTERNAL_TRANS", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 5, name: "Outbound Transfer", code: "OUTBOUND_TRANS", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 6, name: "USD to EGP Conversion", code: "USDTOEGP", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 7, name: "Debit Card", code: "DEBIT_CARD", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 8, name: "Bank Fees", code: "BANK_FEES", requires_cheque_number: false, requires_bank_fee_flag: true, is_active: true },
  ],
  transfers: [],
  cheques: [
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
  ],
  subscriptions: [
    { id: 1, vendor_id: 1, vendor_name: "Amazon Web Services", name: "AWS Cloud Infrastructure", amount: 4200.0, currency: "USD", billing_cycle: "monthly", next_renewal_date: "2026-10-01", auto_generate_bill: true, is_active: true, charges_count: 1, last_charge_date: "2026-09-01", last_charge_amount: 4200.0 },
    { id: 2, vendor_id: 2, vendor_name: "Slack Technologies", name: "Slack Business+", amount: 320.0, currency: "USD", billing_cycle: "monthly", next_renewal_date: "2026-09-20", auto_generate_bill: true, is_active: true, charges_count: 1, last_charge_date: "2026-09-03", last_charge_amount: 320.0 },
  ],
  subscriptionCharges: [
    { id: 1, subscription_id: 1, subscription_name: "AWS Cloud Infrastructure", vendor_name: "Amazon Web Services", billing_date: "2026-09-01", amount: 4200.0, currency: "USD", linked_transaction_id: null, note: "Monthly cloud compute charges", created_at: "2026-09-01T08:00:00", attachments: [] },
    { id: 2, subscription_id: 2, subscription_name: "Slack Business+", vendor_name: "Slack Technologies", billing_date: "2026-09-03", amount: 320.0, currency: "USD", linked_transaction_id: null, note: "40 user licenses renewal", created_at: "2026-09-03T09:00:00", attachments: [] },
  ],
  statementImports: [
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
  ],
  statementLines: [
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
          transaction_id: 1,
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
  ],
  attentionReviewed: new Set(),
};

const FinanceApi = {
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

  // Vendor Bills
  async getBills(params) {
    if (_isMock()) {
      let list = [...FinanceMockState.bills];
      if (params && params.status) list = list.filter((b) => b.status === params.status);
      if (params && params.vendor_id) list = list.filter((b) => b.vendor_id === parseInt(params.vendor_id, 10));
      if (params && params.search) {
        const s = params.search.toLowerCase();
        list = list.filter((b) => b.bill_number.toLowerCase().includes(s) || (b.vendor_name || "").toLowerCase().includes(s));
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
  async getBill(id) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");
      return bill;
    }
    return apiRequest("GET", `/api/finance/bills/${id}`);
  },
  async createBill(payload) {
    if (_isMock()) {
      const vend = FinanceMockState.vendors.find((v) => v.id === parseInt(payload.vendor_id, 10));
      const lines = (payload.lines || []).map((ln, i) => ({
        id: Date.now() + i, bill_id: FinanceMockState.bills.length + 1,
        ...ln, line_total: ln.line_total || (ln.quantity * ln.unit_price),
      }));
      const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
      const newBill = {
        id: FinanceMockState.bills.length + 1,
        ...payload,
        vendor_name: vend ? vend.name : null,
        subtotal, tax_amount: 0, total: subtotal,
        created_at: new Date().toISOString(),
        lines,
      };
      FinanceMockState.bills.push(newBill);
      return newBill;
    }
    return apiRequest("POST", "/api/finance/bills", payload);
  },
  async updateBill(id, payload) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");
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
  async recordBillPayment(billId, payload) {
    if (_isMock()) {
      const newPayment = {
        id: FinanceMockState.billPayments.length + 1,
        ...payload,
        related_bill_id: parseInt(billId, 10),
        created_at: new Date().toISOString(),
      };
      FinanceMockState.billPayments.push(newPayment);
      return newPayment;
    }
    return apiRequest("POST", `/api/finance/bills/${billId}/payments`, payload);
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

  // Bank Accounts
  async getAccounts(params) {
    if (_isMock()) {
      let list = [...FinanceMockState.accounts];
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
  async getAccount(id) {
    if (_isMock()) {
      const acc = FinanceMockState.accounts.find((a) => a.id === parseInt(id, 10));
      if (!acc) throw new Error("Account not found");
      return acc;
    }
    return apiRequest("GET", `/api/finance/accounts/${id}`);
  },
  async createAccount(payload) {
    if (_isMock()) {
      const newAcc = {
        id: FinanceMockState.accounts.length + 1,
        ...payload,
        current_balance: payload.opening_balance || 0,
        account_number: `******${(payload.account_number || "").slice(-4)}`,
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
      const direction = payload.direction;

      if (acc) {
        if (direction === "in") acc.current_balance = round(acc.current_balance + amount, 2);
        else acc.current_balance = round(acc.current_balance - amount, 2);
      }

      const cat = FinanceMockState.categories.find((c) => c.id === parseInt(payload.category_id, 10));
      const pt = FinanceMockState.paymentTypes.find((p) => p.id === parseInt(payload.payment_type_id, 10));

      const newTx = {
        id: FinanceMockState.transactions.length + 1,
        account_id: parseInt(accountId, 10),
        date: payload.date,
        amount,
        direction,
        currency: payload.currency || (acc ? acc.currency : "USD"),
        category_id: payload.category_id ? parseInt(payload.category_id, 10) : null,
        payment_type_id: payload.payment_type_id ? parseInt(payload.payment_type_id, 10) : null,
        category_name: cat ? cat.name : null,
        payment_type_code: pt ? pt.code : null,
        payment_type_name: pt ? pt.name : null,
        reference: payload.reference || "",
        description: payload.description || "",
        fx_rate: payload.fx_rate ? parseFloat(payload.fx_rate) : null,
        fx_equivalent: payload.fx_rate ? round(amount * parseFloat(payload.fx_rate), 2) : null,
        destination_cash_account_id: payload.destination_cash_account_id ? parseInt(payload.destination_cash_account_id, 10) : null,
        cheque_number: payload.cheque_number || null,
        source: "manual",
        running_balance: acc ? acc.current_balance : amount,
        created_at: new Date().toISOString(),
      };
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
        confirmed_leg: payload.confirmed_leg || "both",
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
      const newCheque = {
        id: (FinanceMockState.cheques || []).length + 1,
        ...payload,
        account_id: parseInt(payload.account_id, 10),
        account_name: bank ? bank.account_name : null,
        destination_cash_account_name: destCash ? destCash.account_name : null,
        status: "issued",
        clear_date: null,
        fiscal_year: yr,
        created_at: new Date().toISOString(),
      };
      if (!FinanceMockState.cheques) FinanceMockState.cheques = [];
      FinanceMockState.cheques.unshift(newCheque);

      // Deduct balance from bank
      if (bank) bank.current_balance = round(bank.current_balance - Number(payload.amount), 2);
      if (destCash && payload.purpose_type === "cash_withdrawal") {
        destCash.current_balance = round(destCash.current_balance + Number(payload.amount), 2);
      }
      if (payload.linked_bill_id) {
        const bill = (FinanceMockState.bills || []).find((b) => b.id === parseInt(payload.linked_bill_id, 10));
        if (bill) bill.status = "paid";
      }
      return newCheque;
    }
    return apiRequest("POST", "/api/finance/cheques", payload);
  },
  async updateChequeStatus(id, payload) {
    if (_isMock()) {
      const c = (FinanceMockState.cheques || []).find((item) => item.id === parseInt(id, 10));
      if (!c) throw new Error("Cheque not found");
      c.status = payload.status;
      if (payload.status === "cleared") {
        c.clear_date = payload.clear_date || new Date().toISOString().split("T")[0];
      } else if (payload.status === "bounced" || payload.status === "voided") {
        const bank = (FinanceMockState.accounts || []).find((a) => a.id === c.account_id);
        if (bank) bank.current_balance = round(bank.current_balance + Number(c.amount), 2);
        if (c.destination_cash_account_id) {
          const cash = (FinanceMockState.accounts || []).find((a) => a.id === c.destination_cash_account_id);
          if (cash) cash.current_balance = round(cash.current_balance - Number(c.amount), 2);
        }
        if (c.linked_bill_id) {
          const bill = (FinanceMockState.bills || []).find((b) => b.id === c.linked_bill_id);
          if (bill) bill.status = "unpaid";
        }
      }
      return c;
    }
    return apiRequest("PATCH", `/api/finance/cheques/${id}/status`, payload);
  },

  // Subscriptions & Charges (Phase 6)
  async getSubscriptions(params) {
    if (_isMock()) {
      let list = [...(FinanceMockState.subscriptions || [])];
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
      const newSub = {
        id: (FinanceMockState.subscriptions || []).length + 1,
        vendor_id: parseInt(payload.vendor_id, 10),
        vendor_name: vendor ? vendor.name : "Custom Vendor",
        name: payload.name,
        amount: Number(payload.amount),
        currency: (payload.currency || "USD").toUpperCase(),
        billing_cycle: payload.billing_cycle || "monthly",
        next_renewal_date: payload.next_renewal_date,
        auto_generate_bill: payload.auto_generate_bill !== undefined ? Boolean(payload.auto_generate_bill) : true,
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
        linked_transaction_id: bankId ? Date.now() : null,
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
  // Bank Statement Imports & Reconciliation (Phase 7)
  // ==========================================
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

  async resolveStatementLine(statementId, lineId, payload) {
    if (_isMock()) {
      const line = (FinanceMockState.statementLines || []).find((l) => l.id === parseInt(lineId, 10));
      if (!line) throw new Error("Statement line not found");

      if (payload.action === "match") {
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
        line.status = "ignored";
      }
      if (payload.notes) line.notes = payload.notes;

      // Update import matched count
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10));
      if (imp) {
        const resolvedCount = (FinanceMockState.statementLines || []).filter(
          (l) => l.import_id === imp.id && ["matched", "created", "ignored"].includes(l.status)
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

  // ==========================================
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
              { label: "Due Date", value: bill.due_date || "—" },
              { label: "Vendor Tax ID", value: vendor.tax_id || "VAT-1294819" },
            ],
          },
          related_records: [
            {
              entity_type: "vendor",
              entity_id: vendor.id || 1,
              title: vendor.name,
              badge: "Vendor Payables",
              amount: null,
              currency: null,
              date: null,
            },
            {
              entity_type: "transaction",
              entity_id: 2,
              title: "Outflow Entry TXN-0002",
              badge: "Ledger Outflow",
              amount: bill.total,
              currency: bill.currency || "USD",
              date: bill.issue_date,
            },
          ],
          attachments: [
            {
              id: 2,
              file_name: `${bill.bill_number}_receipt.pdf`,
              file_size: 154800,
              mime_type: "application/pdf",
              storage_ref: "gdrive://bills/bill.pdf",
              uploaded_at: bill.created_at || "2026-09-01T08:00:00Z",
              uploaded_by: "ap@voyancemed.com",
            },
          ],
          timeline: [
            {
              id: `bill-${bill.id}-created`,
              timestamp: bill.created_at || `${bill.issue_date} 08:00:00`,
              event: "created",
              plain_text: `Vendor bill ${bill.bill_number} received from ${bill.vendor_name || vendor.name}`,
              actor: "ap@voyancemed.com",
              state_transition: { from_state: null, to_state: "unpaid" },
            },
          ],
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
};

window.FinanceApi = FinanceApi;



