/**
 * fe/finance-api.js
 * API client for Finance module endpoints (/api/finance/*).
 * Mirrors fe/api.js conventions and uses the shared apiRequest helper.
 */
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
  getAccounts(params) {
    let url = "/api/finance/accounts";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  getAccount(id) {
    return apiRequest("GET", `/api/finance/accounts/${id}`);
  },
  createAccount(payload) {
    return apiRequest("POST", "/api/finance/accounts", payload);
  },
  updateAccount(id, payload) {
    return apiRequest("PUT", `/api/finance/accounts/${id}`, payload);
  },
  deleteAccount(id) {
    return apiRequest("DELETE", `/api/finance/accounts/${id}`);
  },
  getSubscriptions() {
    return apiRequest("GET", "/api/finance/subscriptions");
  },
  getFinanceSummary() {
    return apiRequest("GET", "/api/finance/reports/summary");
  },
};

window.FinanceApi = FinanceApi;
