// ==========================================
// App-wide area chrome (restyle v3, D-028): top-bar area tile + name, page canvas.
// Shared across HR, Finance, Payroll, System, and Employee Portal.
// ==========================================
const APP_AREA_BY_PAGE = {
  // Finance areas
  "a-finance-dashboard": { name: "Overview", hue: "blue", icon: "fa-chart-pie" },
  "a-finance-sales": { name: "Sales", hue: "teal", icon: "fa-file-invoice-dollar" },
  "a-finance-invoices": { name: "Sales", hue: "teal", icon: "fa-file-invoice-dollar" },
  "a-finance-spend": { name: "Spend", hue: "orange", icon: "fa-receipt" },
  "a-finance-bills": { name: "Spend", hue: "orange", icon: "fa-receipt" },
  "a-finance-subscriptions": { name: "Spend", hue: "orange", icon: "fa-receipt" },
  "a-finance-statutory": { name: "Spend", hue: "orange", icon: "fa-receipt" },
  "a-finance-banking": { name: "Banking", hue: "sky", icon: "fa-building-columns" },
  "a-finance-accounts": { name: "Banking", hue: "sky", icon: "fa-building-columns" },
  "a-finance-transfers": { name: "Banking", hue: "sky", icon: "fa-building-columns" },
  "a-finance-cheques": { name: "Banking", hue: "sky", icon: "fa-building-columns" },
  "a-finance-statements": { name: "Banking", hue: "sky", icon: "fa-building-columns" },
  "a-finance-reports": { name: "Reports", hue: "violet", icon: "fa-file-excel" },
  "a-finance-settings": { name: "Settings", hue: "slate", icon: "fa-sliders" },

  // HR
  "a-dashboard": { name: "HR · People", hue: "blue", icon: "fa-grip" },
  "a-employees": { name: "HR · People", hue: "blue", icon: "fa-users" },
  "a-employee-detail": { name: "HR · People", hue: "blue", icon: "fa-user" },
  "a-requests": { name: "HR · People", hue: "blue", icon: "fa-inbox" },
  "a-salary": { name: "HR · People", hue: "green", icon: "fa-arrow-trend-up" },
  "a-invoices": { name: "HR · People", hue: "green", icon: "fa-file-lines" },
  "a-vacations": { name: "HR · Benefits and records", hue: "teal", icon: "fa-umbrella-beach" },
  "a-insurance": { name: "HR · Benefits and records", hue: "teal", icon: "fa-briefcase-medical" },
  "a-dochub": { name: "HR · Benefits and records", hue: "ochre", icon: "fa-folder-open" },

  // Payroll
  "a-finance-payroll": { name: "Payroll", hue: "violet", icon: "fa-money-check-dollar" },
  "a-finance-payroll-runs": { name: "Payroll", hue: "violet", icon: "fa-clock-rotate-left" },
  "a-finance-payroll-settings": { name: "Payroll · Settings", hue: "slate", icon: "fa-sliders" },

  // System
  "a-system-roles": { name: "System · Access and security", hue: "pink", icon: "fa-shield-halved" },
  "a-system-users": { name: "System · Access and security", hue: "pink", icon: "fa-users-gear" },

  // Employee Portal
  "e-dashboard": { name: "My workspace", hue: "blue", icon: "fa-grip" },
  "e-salary": { name: "My workspace", hue: "green", icon: "fa-arrow-trend-up" },
  "e-payslips": { name: "My workspace", hue: "violet", icon: "fa-file-invoice-dollar" },
  "e-vacations": { name: "My workspace", hue: "teal", icon: "fa-umbrella-beach" },
  "e-insurance": { name: "My workspace", hue: "teal", icon: "fa-briefcase-medical" },
  "e-dochub": { name: "My workspace", hue: "ochre", icon: "fa-folder-open" },
};

// Outline icon set from the approved mocks for the page-title tile (paths only).
const PAGE_TILE_SVG = {
  "a-dashboard": "<path d=\"M4 13h6V4H4zM14 20h6v-9h-6zM14 8h6V4h-6zM4 20h6v-3H4z\"></path>",
  "a-employees": "<path d=\"M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8\"></path>",
  "a-employee-detail": "<path d=\"M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8\"></path>",
  "a-requests": "<path d=\"M4 13l2.5-8h11L20 13v6H4zM4 13h5l1 2h4l1-2h5\"></path>",
  "a-salary": "<path d=\"M3 17l6-6 4 4 8-8M15 7h6v6\"></path>",
  "a-invoices": "<path d=\"M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6\"></path>",
  "a-vacations": "<path d=\"M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9M12 12v7a2 2 0 0 0 4 0\"></path>",
  "a-insurance": "<path d=\"M12 20s-8-5.2-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 14.8 12 20 12 20z\"></path>",
  "a-dochub": "<path d=\"M3 6h6l2 2h10v11H3z\"></path>",
  "a-finance-payroll": "<path d=\"M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2\"></path>",
  "a-finance-payroll-runs": "<path d=\"M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2\"></path>",
  "a-finance-payroll-settings": "<path d=\"M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M14 4v4M8 10v4M16 16v4\"></path>",
  "a-system-roles": "<path d=\"M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z\"></path>",
  "a-system-users": "<path d=\"M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8\"></path>",
  "e-dashboard": "<path d=\"M4 13h6V4H4zM14 20h6v-9h-6zM14 8h6V4h-6zM4 20h6v-3H4z\"></path>",
  "e-salary": "<path d=\"M3 17l6-6 4 4 8-8M15 7h6v6\"></path>",
  "e-payslips": "<path d=\"M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6\"></path>",
  "e-vacations": "<path d=\"M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9M12 12v7a2 2 0 0 0 4 0\"></path>",
  "e-insurance": "<path d=\"M12 20s-8-5.2-8-10.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 8 2.5C20 14.8 12 20 12 20z\"></path>",
  "e-dochub": "<path d=\"M3 6h6l2 2h10v11H3z\"></path>"
};

function applyFinanceAreaChrome(pageId, portal = "admin") {
  const isEmp = portal === "employee" || (pageId && pageId.startsWith("e-"));
  const shell = document.querySelector(isEmp ? "#employee-app .main" : "#admin-app .main");
  const tile = document.getElementById(isEmp ? "empAreaTile" : "adminAreaTile");
  const nameEl = document.getElementById(isEmp ? "empAreaName" : "adminAreaName");
  if (shell) shell.classList.add("fv-shell");
  if (!tile || !nameEl) return;
  const area = APP_AREA_BY_PAGE[pageId];
  if (!area) {
    tile.hidden = true;
    nameEl.hidden = true;
    return;
  }
  tile.className = `fv-tile fv-hue-${area.hue}`;
  tile.innerHTML = PAGE_TILE_SVG[pageId]
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PAGE_TILE_SVG[pageId]}</svg>`
    : `<i class="fa-solid ${area.icon}"></i>`;
  tile.hidden = false;
  nameEl.textContent = area.name;
  nameEl.hidden = false;
}
window.applyFinanceAreaChrome = applyFinanceAreaChrome;

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
  const paneProducts = document.getElementById("financeSettingsPaneProducts");
  const paneRevenueSources = document.getElementById("financeSettingsPaneRevenueSources");
  const paneDisplay = document.getElementById("financeSettingsPaneDisplay");

  document.querySelectorAll("#a-finance-settings [data-head-for]").forEach((el) => {
    el.style.display = el.dataset.headFor === subTab ? "" : "none";
  });

  if (paneCategories) paneCategories.style.display = subTab === "categories" ? "block" : "none";
  if (panePaymentTypes) panePaymentTypes.style.display = subTab === "payment_types" ? "block" : "none";
  if (paneProducts) paneProducts.style.display = subTab === "products" ? "block" : "none";
  if (paneRevenueSources) paneRevenueSources.style.display = subTab === "revenue_sources" ? "block" : "none";
  if (paneDisplay) paneDisplay.style.display = subTab === "display" ? "block" : "none";

  if (subTab === "payment_types") {
    loadFinancePaymentTypes();
  } else if (subTab === "products") {
    loadFinanceProducts();
  } else if (subTab === "revenue_sources") {
    loadRevenueSources();
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
  // No session yet (first paint, before /api/auth/me answers): nothing to fetch.
  if (typeof SessionInfo !== "undefined" && !SessionInfo.isKnown()) return;
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
    loading = Promise.resolve();
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
      el.classList.add('spend-subnav', 'fv-subnav');
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
        return `<button class="filter-tab${active ? ' active' : ''}" id="${bar.ids[t.key]}" role="tab" aria-selected="${active}" tabindex="${active ? 0 : -1}"${action ? ` onclick="${action}"` : ''}>${t.label}</button>`;
      }).join('');
      if (typeof initAccessibleTablist === 'function') initAccessibleTablist(el);
    });
  },
};
window.SpendTabs = SpendTabs;
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => SpendTabs.render());
else SpendTabs.render();

// Book view switchers (X2, D-028): dashboard and reports re-load when the view changes
(function mountFinanceBookSwitchers() {
  const go = () => {
    FinanceBookView.mount("dashboard", "financeBookSwitcherDashboard", () => { if (typeof refreshFinanceDashboard === "function") refreshFinanceDashboard(); });
    FinanceBookView.mount("reports", "financeBookSwitcherReports", () => { if (typeof refreshActiveReport === "function") refreshActiveReport(); });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go);
  else go();
})();

