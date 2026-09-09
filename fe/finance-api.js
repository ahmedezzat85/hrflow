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
  getAccounts() {
    return apiRequest("GET", "/api/finance/accounts");
  },
  getSubscriptions() {
    return apiRequest("GET", "/api/finance/subscriptions");
  },
  getFinanceSummary() {
    return apiRequest("GET", "/api/finance/reports/summary");
  },
};

window.FinanceApi = FinanceApi;
