/**
 * fe/finance-api.js
 * API client for Finance module endpoints (/api/finance/*).
 * Mirrors fe/api.js conventions and uses the shared apiRequest helper.
 * Includes graceful mock-mode fallback when ?mock=admin is in URL.
 */
const _isMock = () => typeof window !== "undefined" && window.location && window.location.search.includes("mock=");

const FinanceMockState = {
  accounts: [
    { id: 1, account_name: "Voyance Operating USD", bank_name: "JPMorgan Chase", account_number: "******4821", currency: "USD", opening_balance: 150000.0, current_balance: 150000.0, is_active: true },
    { id: 2, account_name: "Voyance Treasury Reserve", bank_name: "Silicon Valley Bank", account_number: "******9102", currency: "USD", opening_balance: 500000.0, current_balance: 500000.0, is_active: true },
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
    { id: 1, customer_id: 1, customer_name: "Apex Health Partners", invoice_number: "INV-2026-001", issue_date: "2026-09-01", due_date: "2026-09-30", status: "sent", currency: "USD", subtotal: 12500.0, tax_amount: 0.0, total: 12500.0, notes: "Q3 PACS Integration Services", created_at: "2026-09-01T08:00:00", lines: [{ id: 1, invoice_id: 1, description: "PACS Integration", quantity: 1, unit_price: 12500.0, line_total: 12500.0 }] },
    { id: 2, customer_id: 2, customer_name: "BioCare Diagnostics", invoice_number: "INV-2026-002", issue_date: "2026-09-05", due_date: "2026-10-05", status: "draft", currency: "USD", subtotal: 8400.0, tax_amount: 0.0, total: 8400.0, notes: "Monthly DICOM utility SaaS", created_at: "2026-09-05T09:00:00", lines: [{ id: 2, invoice_id: 2, description: "DICOM SaaS", quantity: 6, unit_price: 1400.0, line_total: 8400.0 }] },
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
    { id: 2, name: "Cash Withdrawal", code: "CASHWITHDRAW", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 3, name: "Cheque", code: "CHK", requires_cheque_number: true, requires_bank_fee_flag: false, is_active: true },
    { id: 4, name: "Inbound Transfer", code: "INBOUND_TRANS", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 5, name: "Outbound Transfer", code: "OUTBOUND_TRANS", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 6, name: "USD to EGP Conversion", code: "USDTOEGP", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 7, name: "Debit Card", code: "DEBIT_CARD", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 8, name: "Bank Fees", code: "BANK_FEES", requires_cheque_number: false, requires_bank_fee_flag: true, is_active: true },
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
      const lines = (payload.lines || []).map((ln, i) => ({
        id: Date.now() + i, invoice_id: FinanceMockState.invoices.length + 1,
        ...ln, line_total: ln.line_total || (ln.quantity * ln.unit_price),
      }));
      const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
      const newInv = {
        id: FinanceMockState.invoices.length + 1,
        ...payload,
        customer_name: cust ? cust.name : null,
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
      const newPayment = {
        id: FinanceMockState.payments.length + 1,
        ...payload,
        related_invoice_id: parseInt(invoiceId, 10),
        created_at: new Date().toISOString(),
      };
      FinanceMockState.payments.push(newPayment);
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
        source: "manual",
        running_balance: acc ? acc.current_balance : amount,
        created_at: new Date().toISOString(),
      };
      FinanceMockState.transactions.unshift(newTx);
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
};

window.FinanceApi = FinanceApi;
