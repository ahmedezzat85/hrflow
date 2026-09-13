// ==========================================
// 8. Navigation & Hook Integration
// ==========================================
function updateFinanceNavVisibility() {
  const group = document.getElementById("adminFinanceNavGroup");
  if (!group) return;

  const role = SessionInfo.getRole();
  const perms = typeof SessionInfo.getPermissions === "function" ? SessionInfo.getPermissions() : [];
  const hasFinancePerm = perms.some((p) => p.startsWith("finance."));

  if (role === "admin" || role === "system_admin" || hasFinancePerm) {
    group.style.display = "block";
  } else {
    group.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.addEventListener("click", (e) => {
    const navItem = e.target.closest("[data-page]");
    if (!navItem) return;

    const targetPage = navItem.getAttribute("data-page");
    if (targetPage === "a-finance-dashboard") {
      loadFinanceDashboard();
    } else if (targetPage === "a-finance-invoices") {
      loadFinanceInvoices();
    } else if (targetPage === "a-finance-bills") {
      loadFinanceBills();
    } else if (targetPage === "a-finance-payroll") {
      loadFinancePayroll();
    } else if (targetPage === "a-finance-accounts") {
      if (_currentFinanceSubTab === "statements") {
        loadFinanceStatements();
      } else if (_currentFinanceSubTab === "cheques") {
        loadFinanceCheques();
      } else if (_currentFinanceSubTab === "transfers") {
        loadFinanceTransfers();
      } else if (_currentFinanceSubTab === "categories") {
        loadFinanceCategories();
      } else if (_currentFinanceSubTab === "payment_types") {
        loadFinancePaymentTypes();
      } else {
        loadFinanceAccounts();
      }
    } else if (targetPage === "a-finance-subscriptions") {
      loadFinanceSubscriptions();
    } else if (targetPage === "a-finance-reports") {
      loadFinanceReports();
    } else if (targetPage === "e-payslips") {
      loadMyPayslips();
    }
  });

  updateFinanceNavVisibility();
  window.addEventListener("hrflow:session-changed", updateFinanceNavVisibility);
});


window.updateFinanceNavVisibility = updateFinanceNavVisibility;
