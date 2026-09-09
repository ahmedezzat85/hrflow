/**
 * fe/public/js/finance.js
 * Controller for Finance module sections and employee payslip self-service.
 */

const FinanceState = {
  summary: null,
  invoices: [],
  bills: [],
  payrollRuns: [],
  accounts: [],
  subscriptions: [],
  myPayslips: [],
};

// ==========================================
// 1. Dashboard Overview
// ==========================================
async function loadFinanceDashboard() {
  const loadingBar = document.getElementById("empTableLoadingBar");
  try {
    const summary = await FinanceApi.getFinanceSummary();
    FinanceState.summary = summary;
    renderFinanceDashboard(summary);
  } catch (err) {
    console.error("Failed to load finance summary:", err);
  }
}

function renderFinanceDashboard(summary) {
  if (!summary) return;
  const balanceEl = document.getElementById("statFinanceBalance");
  const revEl = document.getElementById("statFinanceRevenue");
  const costEl = document.getElementById("statFinanceCost");
  const netEl = document.getElementById("statFinanceNet");

  const fmt = (n) => `$${Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (balanceEl) balanceEl.textContent = fmt(summary.balance);
  if (revEl) revEl.textContent = fmt(summary.revenue_mtd);
  if (costEl) costEl.textContent = fmt(summary.cost_mtd);
  if (netEl) netEl.textContent = fmt(summary.net_mtd);
}

function refreshFinanceDashboard() {
  loadFinanceDashboard();
  showToast("Finance dashboard refreshed", "success");
}

// ==========================================
// 2. Sales Invoices
// ==========================================
async function loadFinanceInvoices() {
  const tbody = document.getElementById("financeInvoicesTableBody");
  const empty = document.getElementById("financeInvoicesEmpty");
  const bar = document.getElementById("financeInvoicesLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const items = await FinanceApi.getInvoices();
    FinanceState.invoices = items;
    renderFinanceInvoices(items);
  } catch (err) {
    console.error("Failed to load finance invoices:", err);
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function renderFinanceInvoices(items) {
  const tbody = document.getElementById("financeInvoicesTableBody");
  const empty = document.getElementById("financeInvoicesEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map(
      (inv) => `
    <tr>
      <td><strong>${inv.invoice_number}</strong></td>
      <td>${inv.customer_name}</td>
      <td>${inv.issue_date || "--"}</td>
      <td>${inv.due_date || "--"}</td>
      <td><strong>$${Number(inv.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
      <td><span class="badge ${inv.status === "sent" ? "badge-approved" : "badge-pending"}">${inv.status.toUpperCase()}</span></td>
      <td>
        <button class="btn btn-sm" onclick="showToast('Invoice ${inv.invoice_number} preview in Phase 4', 'info')">
          <i class="fa-solid fa-eye"></i> View
        </button>
      </td>
    </tr>
  `
    )
    .join("");
}

// ==========================================
// 3. Vendor Bills
// ==========================================
async function loadFinanceBills() {
  const bar = document.getElementById("financeBillsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const items = await FinanceApi.getBills();
    FinanceState.bills = items;
    renderFinanceBills(items);
  } catch (err) {
    console.error("Failed to load vendor bills:", err);
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function renderFinanceBills(items) {
  const tbody = document.getElementById("financeBillsTableBody");
  const empty = document.getElementById("financeBillsEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map(
      (bill) => `
    <tr>
      <td><strong>${bill.bill_number}</strong></td>
      <td>${bill.vendor_name}</td>
      <td><span class="badge badge-info">${bill.category || "General"}</span></td>
      <td>${bill.issue_date || "--"}</td>
      <td>${bill.due_date || "--"}</td>
      <td><strong>$${Number(bill.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
      <td><span class="badge ${bill.status === "paid" ? "badge-approved" : "badge-pending"}">${bill.status.toUpperCase()}</span></td>
      <td>
        <button class="btn btn-sm" onclick="showToast('Bill ${bill.bill_number} details in Phase 4', 'info')">
          <i class="fa-solid fa-eye"></i> View
        </button>
      </td>
    </tr>
  `
    )
    .join("");
}

// ==========================================
// 4. Payroll Runs
// ==========================================
async function loadFinancePayroll() {
  const bar = document.getElementById("financePayrollLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const items = await FinanceApi.getPayrollRuns();
    FinanceState.payrollRuns = items;
    renderFinancePayroll(items);
  } catch (err) {
    console.error("Failed to load payroll runs:", err);
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function renderFinancePayroll(items) {
  const tbody = document.getElementById("financePayrollTableBody");
  const empty = document.getElementById("financePayrollEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map(
      (run) => `
    <tr>
      <td><strong>${run.period_label}</strong></td>
      <td>${run.period_start} to ${run.period_end}</td>
      <td>$${Number(run.total_gross || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td><strong>$${Number(run.total_net || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
      <td>$${Number(run.total_employer_cost || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td><span class="badge ${run.status === "paid" ? "badge-approved" : "badge-pending"}">${run.status.toUpperCase()}</span></td>
      <td>
        <button class="btn btn-sm" onclick="showToast('Payroll run ${run.period_label} detail view in Phase 5', 'info')">
          <i class="fa-solid fa-list-check"></i> Details
        </button>
      </td>
    </tr>
  `
    )
    .join("");
}

// ==========================================
// 5. Company Bank Accounts
// ==========================================
let _currentBankAccountFilter = "all";

async function loadFinanceAccounts() {
  const bar = document.getElementById("financeAccountsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    let params = null;
    if (_currentBankAccountFilter === "active") params = { is_active: true };
    else if (_currentBankAccountFilter === "inactive") params = { is_active: false };

    const items = await FinanceApi.getAccounts(params);
    FinanceState.accounts = items;
    renderFinanceAccounts(items);
  } catch (err) {
    console.error("Failed to load bank accounts:", err);
    toast("Failed to load bank accounts: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterCompanyBankAccounts(filterType, btn) {
  _currentBankAccountFilter = filterType;
  const tabs = document.querySelectorAll("#a-finance-accounts .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");
  loadFinanceAccounts();
}

function renderFinanceAccounts(items) {
  const tbody = document.getElementById("financeAccountsTableBody");
  const empty = document.getElementById("financeAccountsEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map(
      (acc) => `
    <tr>
      <td><strong>${acc.account_name}</strong></td>
      <td>${acc.bank_name}</td>
      <td><code>${acc.account_number}</code></td>
      <td><span class="badge badge-info">${acc.currency}</span></td>
      <td><strong>$${Number(acc.current_balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
      <td><span class="badge ${acc.is_active ? "badge-approved" : "badge-rejected"}">${acc.is_active ? "ACTIVE" : "INACTIVE"}</span></td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm" onclick="openEditCompanyBankAccountModal(${acc.id})" title="Edit Account">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn btn-sm ${acc.is_active ? "btn-danger" : "btn-fill"}" onclick="toggleCompanyBankAccountActive(${acc.id}, ${acc.is_active})" title="${acc.is_active ? "Deactivate Account" : "Reactivate Account"}">
            <i class="fa-solid ${acc.is_active ? "fa-power-off" : "fa-check"}"></i>
          </button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");
}

function openAddCompanyBankAccountModal() {
  document.getElementById("companyBankAccountModalTitle").textContent = "Add Company Bank Account";
  document.getElementById("fCompanyAccountId").value = "";
  document.getElementById("fCompanyAccountName").value = "";
  document.getElementById("fCompanyBankName").value = "";
  document.getElementById("fCompanyAccountNumber").value = "";
  document.getElementById("fCompanyCurrency").value = "USD";
  document.getElementById("fCompanyOpeningBalance").value = "0.00";
  document.getElementById("fCompanyOpeningBalanceField").style.display = "block";
  openModal("companyBankAccountModal");
}

function openEditCompanyBankAccountModal(id) {
  const acc = (FinanceState.accounts || []).find((a) => a.id === id);
  if (!acc) return;

  document.getElementById("companyBankAccountModalTitle").textContent = "Edit Company Bank Account";
  document.getElementById("fCompanyAccountId").value = acc.id;
  document.getElementById("fCompanyAccountName").value = acc.account_name;
  document.getElementById("fCompanyBankName").value = acc.bank_name;
  document.getElementById("fCompanyAccountNumber").value = "";
  document.getElementById("fCompanyAccountNumber").placeholder = acc.account_number + " (leave blank to keep unchanged)";
  document.getElementById("fCompanyCurrency").value = acc.currency || "USD";
  document.getElementById("fCompanyOpeningBalanceField").style.display = "none";
  openModal("companyBankAccountModal");
}

async function saveCompanyBankAccount() {
  const idVal = document.getElementById("fCompanyAccountId").value;
  const account_name = document.getElementById("fCompanyAccountName").value.trim();
  const bank_name = document.getElementById("fCompanyBankName").value.trim();
  const account_number = document.getElementById("fCompanyAccountNumber").value.trim();
  const currency = document.getElementById("fCompanyCurrency").value;

  if (!account_name) {
    toast("Please provide an Account Name", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!bank_name) {
    toast("Please provide a Bank Name", "fa-solid fa-circle-exclamation");
    return;
  }

  const saveBtn = document.getElementById("companyBankAccountSaveBtn");
  if (saveBtn) saveBtn.disabled = true;

  try {
    if (idVal) {
      // Edit mode
      const payload = { account_name, bank_name, currency };
      if (account_number) payload.account_number = account_number;
      await FinanceApi.updateAccount(Number(idVal), payload);
      toast("Bank account updated successfully", "fa-solid fa-circle-check");
    } else {
      // Create mode
      if (!account_number) {
        toast("Please provide an Account Number", "fa-solid fa-circle-exclamation");
        if (saveBtn) saveBtn.disabled = false;
        return;
      }
      const opening_balance = parseFloat(document.getElementById("fCompanyOpeningBalance").value) || 0.0;
      const payload = { account_name, bank_name, account_number, currency, opening_balance };
      await FinanceApi.createAccount(payload);
      toast("Bank account created successfully", "fa-solid fa-circle-check");
    }

    closeModal("companyBankAccountModal");
    await loadFinanceAccounts();
  } catch (err) {
    toast(err.message || "Failed to save bank account", "fa-solid fa-triangle-exclamation");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function toggleCompanyBankAccountActive(id, currentActive) {
  const action = currentActive ? "deactivate" : "reactivate";
  if (!confirm(`Are you sure you want to ${action} this bank account?`)) return;

  try {
    if (currentActive) {
      await FinanceApi.deleteAccount(id);
      toast("Bank account deactivated", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.updateAccount(id, { is_active: true });
      toast("Bank account reactivated", "fa-solid fa-circle-check");
    }
    await loadFinanceAccounts();
  } catch (err) {
    toast(err.message || `Failed to ${action} bank account`, "fa-solid fa-triangle-exclamation");
  }
}

// ==========================================
// 6. Vendor Subscriptions
// ==========================================
async function loadFinanceSubscriptions() {
  const bar = document.getElementById("financeSubscriptionsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const items = await FinanceApi.getSubscriptions();
    FinanceState.subscriptions = items;
    renderFinanceSubscriptions(items);
  } catch (err) {
    console.error("Failed to load subscriptions:", err);
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function renderFinanceSubscriptions(items) {
  const tbody = document.getElementById("financeSubscriptionsTableBody");
  const empty = document.getElementById("financeSubscriptionsEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map(
      (sub) => `
    <tr>
      <td><strong>${sub.name}</strong></td>
      <td>${sub.vendor_name}</td>
      <td><strong>$${Number(sub.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
      <td><span class="badge badge-info">${sub.billing_cycle}</span></td>
      <td>${sub.next_renewal_date || "--"}</td>
      <td>${sub.auto_generate_bill ? '<i class="fa-solid fa-check text-success"></i> Auto' : "Manual"}</td>
      <td><span class="badge ${sub.is_active ? "badge-approved" : "badge-rejected"}">${sub.is_active ? "ACTIVE" : "INACTIVE"}</span></td>
      <td>
        <button class="btn btn-sm" onclick="showToast('Subscription ${sub.name} edit in Phase 4', 'info')">
          <i class="fa-solid fa-pen"></i> Edit
        </button>
      </td>
    </tr>
  `
    )
    .join("");
}

// ==========================================
// 7. Employee Payslips
// ==========================================
async function loadMyPayslips() {
  const bar = document.getElementById("myPayslipsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const items = await FinanceApi.getMyPayslips();
    FinanceState.myPayslips = items;
    renderMyPayslips(items);
  } catch (err) {
    console.error("Failed to load my payslips:", err);
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function renderMyPayslips(items) {
  const tbody = document.getElementById("myPayslipsTableBody");
  const empty = document.getElementById("myPayslipsEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map(
      (ps) => `
    <tr>
      <td><strong>${ps.period_label}</strong></td>
      <td>${ps.period_start} to ${ps.period_end}</td>
      <td>$${Number(ps.base_salary || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td>$${Number(ps.allowances_total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td>$${Number(ps.deductions_total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td><strong>$${Number(ps.net_pay || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
      <td><span class="badge badge-approved">PAID</span></td>
      <td>
        <button class="btn btn-sm" onclick="showToast('PDF Payslip download will be available in Phase 5', 'info')">
          <i class="fa-solid fa-file-pdf"></i> Download PDF
        </button>
      </td>
    </tr>
  `
    )
    .join("");
}

function refreshMyPayslips() {
  loadMyPayslips();
  showToast("Payslip records refreshed", "success");
}

// ==========================================
// 8. Navigation & Hook Integration
// ==========================================
function updateFinanceNavVisibility() {
  const group = document.getElementById("adminFinanceNavGroup");
  if (!group) return;

  // Gate on admin role or finance permission
  const role = SessionInfo.getRole();
  const perms = typeof SessionInfo.getPermissions === "function" ? SessionInfo.getPermissions() : [];
  const hasFinancePerm = perms.some((p) => p.startsWith("finance."));

  if (role === "admin" || role === "system_admin" || hasFinancePerm) {
    group.style.display = "block";
  } else {
    group.style.display = "none";
  }
}

// Hook into page navigation
document.addEventListener("DOMContentLoaded", () => {
  // Listen for page switch events or clicks
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
      loadFinanceAccounts();
    } else if (targetPage === "a-finance-subscriptions") {
      loadFinanceSubscriptions();
    } else if (targetPage === "e-payslips") {
      loadMyPayslips();
    }
  });

  // Check visibility on load/session change
  updateFinanceNavVisibility();
  window.addEventListener("hrflow:session-changed", updateFinanceNavVisibility);
});
