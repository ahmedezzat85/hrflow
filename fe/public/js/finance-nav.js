// ==========================================
// 8. Navigation & Hook Integration (Story 1.1)
// ==========================================
let _currentSettingsSubTab = "categories";

function switchFinanceSettingsSubTab(subTab, btn) {
  _currentSettingsSubTab = subTab;
  const nav = document.getElementById("financeSettingsSubNav");
  if (nav) {
    nav.querySelectorAll(".filter-tab").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
      b.setAttribute("tabindex", "-1");
    });
  }
  const activeBtn = btn || document.querySelector(`[data-settings-tab="${subTab}"]`);
  if (activeBtn) {
    activeBtn.classList.add("active");
    activeBtn.setAttribute("aria-selected", "true");
    activeBtn.setAttribute("tabindex", "0");
  }

  const paneCategories = document.getElementById("financeSettingsPaneCategories");
  const panePaymentTypes = document.getElementById("financeSettingsPanePaymentTypes");
  const paneDisplay = document.getElementById("financeSettingsPaneDisplay");

  if (paneCategories) paneCategories.style.display = subTab === "categories" ? "block" : "none";
  if (panePaymentTypes) panePaymentTypes.style.display = subTab === "payment_types" ? "block" : "none";
  if (paneDisplay) paneDisplay.style.display = subTab === "display" ? "block" : "none";

  if (subTab === "payment_types") {
    loadFinancePaymentTypes();
  } else if (subTab === "display") {
    loadFinanceDisplaySettings();
  } else {
    loadFinanceCategories();
  }
}

function loadFinanceDisplaySettings() {
  if (typeof FinanceTable !== "undefined" && typeof FinanceTable.renderDensityControl === "function") {
    FinanceTable.renderDensityControl("financeGlobalDensityControl");
  }
}

async function updateFinanceBadges() {
  try {
    const summary = typeof FinanceApi.getFinanceSummary === "function"
      ? await FinanceApi.getFinanceSummary()
      : (typeof FinanceApi.getDashboardSummary === "function" ? await FinanceApi.getDashboardSummary() : null);
    if (!summary) return;

    // 1. Sales badge (open / unpaid customer invoices)
    const salesBadge = document.getElementById("financeSalesBadge");
    if (salesBadge) {
      const openInvoices = summary.open_invoices_count || 0;
      if (openInvoices > 0) {
        salesBadge.textContent = openInvoices;
        salesBadge.setAttribute("aria-label", `${openInvoices} open sales invoices`);
        salesBadge.style.display = "inline-flex";
      } else {
        salesBadge.style.display = "none";
      }
    }

    // 2. Spend badge (unpaid vendor bills)
    const spendBadge = document.getElementById("financeSpendBadge");
    if (spendBadge) {
      const unpaidBills = summary.unpaid_bills_count || 0;
      if (unpaidBills > 0) {
        spendBadge.textContent = unpaidBills;
        spendBadge.setAttribute("aria-label", `${unpaidBills} unpaid vendor bills`);
        spendBadge.style.display = "inline-flex";
      } else {
        spendBadge.style.display = "none";
      }
    }

    // 3. Banking badge (actionable banking items)
    const bankingBadge = document.getElementById("financeBankingBadge");
    if (bankingBadge) {
      const pendingTransfers = (FinanceState.transfers || []).filter((t) => t.status === "pending").length;
      if (pendingTransfers > 0) {
        bankingBadge.textContent = pendingTransfers;
        bankingBadge.setAttribute("aria-label", `${pendingTransfers} pending bank transfers`);
        bankingBadge.style.display = "inline-flex";
      } else {
        bankingBadge.style.display = "none";
      }
    }
  } catch (err) {
    console.warn("Could not update finance badges:", err);
  }
}

function updateFinanceNavVisibility() {
  const group = document.getElementById("adminFinanceNavGroup");
  if (!group) return;

  const role = SessionInfo.getRole();
  const perms = typeof SessionInfo.getPermissions === "function" ? SessionInfo.getPermissions() : [];
  const hasFinancePerm = perms.some((p) => p.startsWith("finance."));

  if (role === "admin" || role === "system_admin" || hasFinancePerm) {
    group.style.display = "block";
    updateFinanceBadges();
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
    } else if (targetPage === "a-finance-sales" || targetPage === "a-finance-invoices") {
      loadFinanceInvoices();
    } else if (targetPage === "a-finance-spend" || targetPage === "a-finance-bills") {
      loadFinanceBills();
    } else if (targetPage === "a-finance-payroll") {
      loadFinancePayroll();
    } else if (targetPage === "a-finance-banking" || targetPage === "a-finance-accounts") {
      if (typeof _currentFinanceSubTab !== "undefined" && _currentFinanceSubTab === "statements") {
        loadFinanceStatements();
      } else if (typeof _currentFinanceSubTab !== "undefined" && _currentFinanceSubTab === "cheques") {
        loadFinanceCheques();
      } else if (typeof _currentFinanceSubTab !== "undefined" && _currentFinanceSubTab === "transfers") {
        loadFinanceTransfers();
      } else {
        loadFinanceAccounts();
      }
    } else if (targetPage === "a-finance-subscriptions") {
      loadFinanceSubscriptions();
    } else if (targetPage === "a-finance-statutory") {
      loadFinanceStatutory();
    } else if (targetPage === "a-finance-reports") {
      loadFinanceReports();
    } else if (targetPage === "a-finance-settings") {
      switchFinanceSettingsSubTab(_currentSettingsSubTab);
    } else if (targetPage === "e-payslips") {
      loadMyPayslips();
    }

    if (targetPage && targetPage.startsWith("a-finance-") && typeof FinanceTable !== "undefined" && typeof FinanceTable.initAllTablesDensity === "function") {
      FinanceTable.initAllTablesDensity();
    }
  });

  updateFinanceNavVisibility();
  window.addEventListener("hrflow:session-changed", updateFinanceNavVisibility);
});

// Global exposures
window.updateFinanceNavVisibility = updateFinanceNavVisibility;
window.updateFinanceBadges = updateFinanceBadges;
window.switchFinanceSettingsSubTab = switchFinanceSettingsSubTab;
window.loadFinanceDisplaySettings = loadFinanceDisplaySettings;

