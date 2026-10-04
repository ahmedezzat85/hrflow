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
  const canSee = window.AdminNav && typeof window.AdminNav.canSeeModule === "function"
    ? window.AdminNav.canSeeModule("finance")
    : (() => {
        const perms = typeof SessionInfo.getPermissions === "function" ? SessionInfo.getPermissions() : [];
        return perms.some((p) => p.startsWith("finance."));
      })();

  if (group) {
    const isFinanceActive = window.AdminNav && typeof window.AdminNav.getActiveModule === "function"
      ? window.AdminNav.getActiveModule() === "finance"
      : false;

    if (canSee) {
      if (isFinanceActive) {
        group.removeAttribute("hidden");
      }
      updateFinanceBadges();
    } else {
      group.setAttribute("hidden", "until-found");
    }
  }

  if (window.AdminNav && typeof window.AdminNav.syncModuleVisibility === "function") {
    window.AdminNav.syncModuleVisibility();
  }
}


function runFinanceLoader(pageId) {
  if (!pageId) return undefined;
  let loading;

  if (pageId === "a-finance-dashboard") {
    loading = loadFinanceDashboard();
  } else if (pageId === "a-finance-sales" || pageId === "a-finance-invoices") {
    loading = loadFinanceInvoices();
  } else if (pageId === "a-finance-spend" || pageId === "a-finance-bills") {
    loading = loadFinanceBills();
  } else if (pageId === "a-finance-payroll" || pageId === "a-finance-payroll-runs") {
    loading = loadFinancePayroll("list");
  } else if (pageId === "a-finance-payroll-settings") {
    loading = loadFinancePayroll("settings");
  } else if (pageId === "a-finance-banking" || pageId === "a-finance-accounts") {
    if (typeof _currentFinanceSubTab !== "undefined" && _currentFinanceSubTab === "statements") {
      loading = loadFinanceStatements();
    } else if (typeof _currentFinanceSubTab !== "undefined" && _currentFinanceSubTab === "cheques") {
      loading = loadFinanceCheques();
    } else if (typeof _currentFinanceSubTab !== "undefined" && _currentFinanceSubTab === "transfers") {
      loading = loadFinanceTransfers();
    } else {
      loading = loadFinanceAccounts();
    }
  } else if (pageId === "a-finance-subscriptions") {
    loading = loadFinanceSubscriptions();
  } else if (pageId === "a-finance-statutory") {
    loading = loadFinanceStatutory();
  } else if (pageId === "a-finance-reports") {
    loading = loadFinanceReports();
  } else if (pageId === "a-finance-settings") {
    loading = switchFinanceSettingsSubTab(_currentSettingsSubTab);
  } else if (pageId === "e-payslips") {
    loading = loadMyPayslips();
  }

  if (pageId && pageId.startsWith("a-finance-") && typeof FinanceTable !== "undefined" && typeof FinanceTable.initAllTablesDensity === "function") {
    FinanceTable.initAllTablesDensity();
  }

  return loading;
}

document.addEventListener("DOMContentLoaded", () => {
  updateFinanceNavVisibility();
  window.addEventListener("hrflow:session-changed", updateFinanceNavVisibility);
});

// Global exposures
window.runFinanceLoader = runFinanceLoader;
window.updateFinanceNavVisibility = updateFinanceNavVisibility;
window.updateFinanceBadges = updateFinanceBadges;
window.switchFinanceSettingsSubTab = switchFinanceSettingsSubTab;
window.loadFinanceDisplaySettings = loadFinanceDisplaySettings;




// ============================================================================
// SpendTabs: the one Spend tab bar (Vendor Bills / Vendors / Subscriptions / Statutory)
// shown on the three Spend pages. Ids per page are kept for existing links and tests.
// ============================================================================
const SpendTabs = {
  TABS: [
    { key: 'bills', icon: 'fa-receipt', label: 'Vendor Bills', page: 'a-finance-bills', sub: 'bills' },
    { key: 'vendors', icon: 'fa-truck-field', label: 'Vendors', page: 'a-finance-bills', sub: 'vendors' },
    { key: 'subscriptions', icon: 'fa-repeat', label: 'Subscriptions', page: 'a-finance-subscriptions' },
    { key: 'statutory', icon: 'fa-landmark', label: 'Statutory', page: 'a-finance-statutory' },
  ],
  BARS: [
    { container: 'financeBillSubNav', page: 'a-finance-bills', active: 'bills', ids: { bills: 'tabFinanceBills', vendors: 'tabFinanceVendors', subscriptions: 'tabFinanceSubscriptions', statutory: 'tabFinanceStatutory' } },
    { container: 'financeSpendSubNavSubscriptions', page: 'a-finance-subscriptions', active: 'subscriptions', ids: { bills: 'subtabSpendSubBills', vendors: 'subtabSpendSubVendors', subscriptions: 'subtabSpendSubSubscriptions', statutory: 'subtabSpendSubStatutory' } },
    { container: 'financeSpendSubNavStatutory', page: 'a-finance-statutory', active: 'statutory', ids: { bills: 'subtabSpendStatBills', vendors: 'subtabSpendStatVendors', subscriptions: 'subtabSpendStatSubscriptions', statutory: 'subtabSpendStatStatutory' } },
  ],
  render() {
    this.BARS.forEach((bar) => {
      const el = document.getElementById(bar.container);
      if (!el) return;
      el.innerHTML = this.TABS.map((t) => {
        const active = t.key === bar.active;
        let action = '';
        if (t.key === 'bills' || t.key === 'vendors') {
          action = bar.page === 'a-finance-bills'
            ? `switchBillSubTab('${t.sub}')`
            : `if(window.AdminNav){AdminNav.go('a-finance-bills');if(typeof switchBillSubTab==='function')switchBillSubTab('${t.sub}');}`;
        } else if (!active) {
          action = `if(window.AdminNav)AdminNav.go('${t.page}')`;
        }
        return `<button class="filter-tab${active ? ' active' : ''}" id="${bar.ids[t.key]}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}"${action ? ` onclick="${action}"` : ''}><i class="fa-solid ${t.icon}"></i> ${t.label}</button>`;
      }).join('');
      if (typeof initAccessibleTablist === 'function') initAccessibleTablist(el);
    });
  },
};
window.SpendTabs = SpendTabs;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => SpendTabs.render());
else SpendTabs.render();
