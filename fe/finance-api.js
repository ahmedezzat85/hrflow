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
};

const FinanceApi = {
  getInvoices() {
    return apiRequest("GET", "/api/finance/invoices");
  },
  getBills() {
    return apiRequest("GET", "/api/finance/bills");
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
};

window.FinanceApi = FinanceApi;
