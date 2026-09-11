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

const FinanceMockState = {
  accounts: [
    { id: 1, account_name: "Voyance Operating USD", account_type: "bank", bank_name: "JPMorgan Chase", account_number: "******4821", currency: "USD", opening_balance: 150000.0, current_balance: 150000.0, is_active: true },
    { id: 2, account_name: "Voyance Treasury Reserve", account_type: "bank", bank_name: "Silicon Valley Bank", account_number: "******9102", currency: "USD", opening_balance: 500000.0, current_balance: 500000.0, is_active: true },
    { id: 3, account_name: "CIB EGP Operating", account_type: "bank", bank_name: "Commercial International Bank", account_number: "******3319", currency: "EGP", opening_balance: 450000.0, current_balance: 450000.0, is_active: true },
    { id: 4, account_name: "Cairo Office Petty Cash Drawer", account_type: "cash", bank_name: null, account_number: "CASH-CAIRO-01", currency: "EGP", opening_balance: 20000.0, current_balance: 20000.0, is_active: true },
  ],
  customers: [
    { id: 1, name: "Apex Health Partners", contact_email: "billing@apexhealth.com", contact_phone: "+1 555-0120", tax_id: "US-88992211", notes: "Enterprise client", is_active: true },
    { id: 2, name: "BioCare Diagnostics", contact_email: "ap@biocare.org", contact_phone: "+1 555-0144", tax_id: "US-33441199", notes: "Monthly billing", is_active: true },
  ],
  vendors: [
    { id: 1, name: "Amazon Web Services", category: "Infrastructure", contact_email: "aws-receivables@amazon.com", contact_phone: "+1 800-555-0199", tax_id: "VAT-1294819", notes: "Hosting & compute", is_active: true },
    { id: 2, name: "Slack Technologies", category: "SaaS", contact_email: "billing@slack.com", contact_phone: "+1 800-555-0188", tax_id: "VAT-9988112", notes: "Team communication", is_active: true },
  ],
  invoices: [
    { id: 1, customer_id: 1, customer_name: "Apex Health Partners", invoice_number: "INV-2026-001", issue_date: "2026-09-01", due_date: "2026-09-30", status: "sent", currency: "USD", expected_bank_account_id: 1, expected_bank_account_name: "Voyance Operating USD", revenue_channel: "overseas_usd", has_bank_discrepancy: false, subtotal: 12500.0, tax_amount: 0.0, total: 12500.0, notes: "Q3 PACS Integration Services", created_at: "2026-09-01T08:00:00", lines: [{ id: 1, invoice_id: 1, description: "PACS Integration", quantity: 1, unit_price: 12500.0, line_total: 12500.0 }] },
    { id: 2, customer_id: 2, customer_name: "BioCare Diagnostics", invoice_number: "INV-2026-002", issue_date: "2026-09-05", due_date: "2026-10-05", status: "draft", currency: "USD", expected_bank_account_id: 2, expected_bank_account_name: "Voyance Treasury Reserve", revenue_channel: "intercompany_transfer_us", has_bank_discrepancy: false, subtotal: 8400.0, tax_amount: 0.0, total: 8400.0, notes: "Monthly DICOM utility SaaS", created_at: "2026-09-05T09:00:00", lines: [{ id: 2, invoice_id: 2, description: "DICOM SaaS", quantity: 6, unit_price: 1400.0, line_total: 8400.0 }] },
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
};

const FinanceApi = {
  // Invoices
  async getInvoices(params) {
    if (_isMock()) {
      let list = [...FinanceMockState.invoices];
      if (params && params.status) list = list.filter((i) => i.status === params.status);
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
  async voidInvoice(id) {
    if (_isMock()) {
      const inv = FinanceMockState.invoices.find((i) => i.id === parseInt(id, 10));
      if (!inv) throw new Error("Invoice not found");
      inv.status = "void";
      return inv;
    }
    return apiRequest("DELETE", `/api/finance/invoices/${id}`);
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
        created_at: new Date().toISOString(),
      };
      FinanceMockState.payments.push(newPayment);
      if (inv) {
        const totalPaid = FinanceMockState.payments
          .filter((p) => p.related_invoice_id === inv.id)
          .reduce((s, p) => s + (p.amount || 0), 0);
        if (totalPaid >= inv.total) {
          inv.status = "paid";
        }
      }
      return newPayment;
    }
    return apiRequest("POST", `/api/finance/invoices/${invoiceId}/payments`, payload);
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
  async voidBill(id) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");
      bill.status = "void";
      return bill;
    }
    return apiRequest("DELETE", `/api/finance/bills/${id}`);
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
  getFinanceSummary() {
    return apiRequest("GET", "/api/finance/reports/summary");
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

  async deleteTransaction(id) {
    if (_isMock()) {
      const idx = (FinanceMockState.transactions || []).findIndex((t) => t.id === parseInt(id, 10));
      if (idx === -1) throw new Error("Transaction not found");
      const tx = FinanceMockState.transactions[idx];
      if (tx.source !== "manual") throw new Error("Only manual transactions can be deleted");
      FinanceMockState.transactions.splice(idx, 1);
      return { message: "Transaction deleted successfully", id: parseInt(id, 10) };
    }
    return apiRequest("DELETE", `/api/finance/transactions/${id}`);
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
      const res = await fetch(`/api/finance/subscriptions/${subscriptionId}/charges`, {
        method: "POST",
        body: data,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Request failed with status ${res.status}`);
      }
      return res.json();
    }
    return apiRequest("POST", `/api/finance/subscriptions/${subscriptionId}/charges`, data);
  },
};

window.FinanceApi = FinanceApi;

