/**
 * fe/public/js/finance.js
 * Controller for Finance module sections and employee payslip self-service.
 */

// Global toast wrapper for finance module actions
if (typeof window.showToast !== "function") {
  window.showToast = function (msg, type = "success") {
    if (typeof toast === "function") {
      const icon =
        type === "error"
          ? "fa-solid fa-triangle-exclamation"
          : type === "info"
          ? "fa-solid fa-circle-info"
          : "fa-solid fa-circle-check";
      toast(msg, icon);
    } else {
      console.log(`[Finance Toast ${type}] ${msg}`);
    }
  };
}

const FinanceState = {
  summary: null,
  invoices: [],
  customers: [],
  bills: [],
  vendors: [],
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

// Sub-tab switching for Invoices section
function switchInvoiceSubTab(subTab) {
  const tabInv = document.getElementById("tabFinanceInvoices");
  const tabCust = document.getElementById("tabFinanceCustomers");
  const boxInv = document.getElementById("financeInvoiceSearchBox");
  const boxCust = document.getElementById("financeCustomerSearchBox");
  const conInv = document.getElementById("financeInvoicesContainer");
  const conCust = document.getElementById("financeCustomersContainer");

  if (subTab === "customers") {
    if (tabInv) tabInv.classList.remove("active");
    if (tabCust) tabCust.classList.add("active");
    if (boxInv) boxInv.style.display = "none";
    if (boxCust) boxCust.style.display = "block";
    if (conInv) conInv.style.display = "none";
    if (conCust) conCust.style.display = "block";
    loadFinanceCustomers();
  } else {
    if (tabInv) tabInv.classList.add("active");
    if (tabCust) tabCust.classList.remove("active");
    if (boxInv) boxInv.style.display = "block";
    if (boxCust) boxCust.style.display = "none";
    if (conInv) conInv.style.display = "block";
    if (conCust) conCust.style.display = "none";
    loadFinanceInvoices();
  }
}

async function loadFinanceCustomers() {
  const tbody = document.getElementById("financeCustomersTableBody");
  const empty = document.getElementById("financeCustomersEmpty");
  const bar = document.getElementById("financeCustomersLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const items = await FinanceApi.getCustomers();
    FinanceState.customers = items || [];
    renderFinanceCustomers(FinanceState.customers);
  } catch (err) {
    console.error("Failed to load finance customers:", err);
    showToast(err.message || "Failed to load customers", "error");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function renderFinanceCustomers(items) {
  const tbody = document.getElementById("financeCustomersTableBody");
  const empty = document.getElementById("financeCustomersEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map(
      (c) => `
    <tr>
      <td>
        <strong>${c.name}</strong>
        ${c.notes ? `<div style="font-size:12px;color:var(--text3);">${c.notes}</div>` : ""}
      </td>
      <td>${c.contact_email ? `<a href="mailto:${c.contact_email}">${c.contact_email}</a>` : "--"}</td>
      <td>${c.contact_phone || "--"}</td>
      <td><code>${c.tax_id || "--"}</code></td>
      <td>
        <span class="badge ${c.is_active ? "badge-approved" : "badge-rejected"}">
          ${c.is_active ? "ACTIVE" : "INACTIVE"}
        </span>
      </td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-icon" title="Edit Customer" onclick="openEditCustomerModal(${c.id})">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn btn-sm btn-icon ${c.is_active ? "btn-danger" : ""}" title="${c.is_active ? "Deactivate" : "Activate"}" onclick="toggleCustomerActive(${c.id}, ${c.is_active})">
            <i class="fa-solid ${c.is_active ? "fa-ban" : "fa-check"}"></i>
          </button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");
}

function filterFinanceCustomers(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) {
    renderFinanceCustomers(FinanceState.customers);
    return;
  }
  const filtered = FinanceState.customers.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      (c.contact_email && c.contact_email.toLowerCase().includes(q)) ||
      (c.tax_id && c.tax_id.toLowerCase().includes(q))
  );
  renderFinanceCustomers(filtered);
}

function openAddCustomerModal() {
  document.getElementById("fCustomerId").value = "";
  document.getElementById("fCustomerName").value = "";
  document.getElementById("fCustomerEmail").value = "";
  document.getElementById("fCustomerPhone").value = "";
  document.getElementById("fCustomerTaxId").value = "";
  document.getElementById("fCustomerNotes").value = "";
  const title = document.getElementById("customerModalTitle");
  if (title) title.textContent = "Add Customer";
  const btn = document.getElementById("customerSaveBtn");
  if (btn) btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Customer`;
  openModal("customerModal");
}

function openEditCustomerModal(id) {
  const c = FinanceState.customers.find((x) => x.id === id);
  if (!c) return;

  document.getElementById("fCustomerId").value = c.id;
  document.getElementById("fCustomerName").value = c.name || "";
  document.getElementById("fCustomerEmail").value = c.contact_email || "";
  document.getElementById("fCustomerPhone").value = c.contact_phone || "";
  document.getElementById("fCustomerTaxId").value = c.tax_id || "";
  document.getElementById("fCustomerNotes").value = c.notes || "";
  const title = document.getElementById("customerModalTitle");
  if (title) title.textContent = "Edit Customer";
  const btn = document.getElementById("customerSaveBtn");
  if (btn) btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Update Customer`;
  openModal("customerModal");
}

async function saveCustomer() {
  const idVal = document.getElementById("fCustomerId").value;
  const name = document.getElementById("fCustomerName").value.trim();
  const contact_email = document.getElementById("fCustomerEmail").value.trim();
  const contact_phone = document.getElementById("fCustomerPhone").value.trim();
  const tax_id = document.getElementById("fCustomerTaxId").value.trim();
  const notes = document.getElementById("fCustomerNotes").value.trim();

  if (!name) {
    showToast("Customer name is required", "error");
    return;
  }

  const payload = {
    name,
    contact_email: contact_email || null,
    contact_phone: contact_phone || null,
    tax_id: tax_id || null,
    notes: notes || null,
  };

  const btn = document.getElementById("customerSaveBtn");
  if (btn) btn.disabled = true;

  try {
    if (idVal) {
      await FinanceApi.updateCustomer(parseInt(idVal, 10), payload);
      showToast("Customer updated successfully", "success");
    } else {
      await FinanceApi.createCustomer(payload);
      showToast("Customer created successfully", "success");
    }
    closeModal("customerModal");
    loadFinanceCustomers();
  } catch (err) {
    showToast(err.message || "Failed to save customer", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function toggleCustomerActive(id, currentlyActive) {
  const action = currentlyActive ? "deactivate" : "activate";
  if (!confirm(`Are you sure you want to ${action} this customer?`)) return;

  try {
    if (currentlyActive) {
      await FinanceApi.deleteCustomer(id);
      showToast("Customer deactivated", "success");
    } else {
      await FinanceApi.updateCustomer(id, { is_active: true });
      showToast("Customer reactivated", "success");
    }
    loadFinanceCustomers();
  } catch (err) {
    showToast(err.message || `Failed to ${action} customer`, "error");
  }
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

// Sub-tab switching for Bills section
function switchBillSubTab(subTab) {
  const tabBill = document.getElementById("tabFinanceBills");
  const tabVend = document.getElementById("tabFinanceVendors");
  const boxBill = document.getElementById("financeBillSearchBox");
  const boxVend = document.getElementById("financeVendorSearchBox");
  const conBill = document.getElementById("financeBillsContainer");
  const conVend = document.getElementById("financeVendorsContainer");

  if (subTab === "vendors") {
    if (tabBill) tabBill.classList.remove("active");
    if (tabVend) tabVend.classList.add("active");
    if (boxBill) boxBill.style.display = "none";
    if (boxVend) boxVend.style.display = "block";
    if (conBill) conBill.style.display = "none";
    if (conVend) conVend.style.display = "block";
    loadFinanceVendors();
  } else {
    if (tabBill) tabBill.classList.add("active");
    if (tabVend) tabVend.classList.remove("active");
    if (boxBill) boxBill.style.display = "block";
    if (boxVend) boxVend.style.display = "none";
    if (conBill) conBill.style.display = "block";
    if (conVend) conVend.style.display = "none";
    loadFinanceBills();
  }
}

async function loadFinanceVendors() {
  const tbody = document.getElementById("financeVendorsTableBody");
  const empty = document.getElementById("financeVendorsEmpty");
  const bar = document.getElementById("financeVendorsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const items = await FinanceApi.getVendors();
    FinanceState.vendors = items || [];
    renderFinanceVendors(FinanceState.vendors);
  } catch (err) {
    console.error("Failed to load finance vendors:", err);
    showToast(err.message || "Failed to load vendors", "error");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function renderFinanceVendors(items) {
  const tbody = document.getElementById("financeVendorsTableBody");
  const empty = document.getElementById("financeVendorsEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map(
      (v) => `
    <tr>
      <td>
        <strong>${v.name}</strong>
        ${v.notes ? `<div style="font-size:12px;color:var(--text3);">${v.notes}</div>` : ""}
      </td>
      <td><span class="badge badge-info">${v.category || "General"}</span></td>
      <td>${v.contact_email ? `<a href="mailto:${v.contact_email}">${v.contact_email}</a>` : "--"}</td>
      <td>${v.contact_phone || "--"}</td>
      <td><code>${v.tax_id || "--"}</code></td>
      <td>
        <span class="badge ${v.is_active ? "badge-approved" : "badge-rejected"}">
          ${v.is_active ? "ACTIVE" : "INACTIVE"}
        </span>
      </td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-icon" title="Edit Vendor" onclick="openEditVendorModal(${v.id})">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn btn-sm btn-icon ${v.is_active ? "btn-danger" : ""}" title="${v.is_active ? "Deactivate" : "Activate"}" onclick="toggleVendorActive(${v.id}, ${v.is_active})">
            <i class="fa-solid ${v.is_active ? "fa-ban" : "fa-check"}"></i>
          </button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");
}

function filterFinanceVendors(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) {
    renderFinanceVendors(FinanceState.vendors);
    return;
  }
  const filtered = FinanceState.vendors.filter(
    (v) =>
      v.name.toLowerCase().includes(q) ||
      (v.category && v.category.toLowerCase().includes(q)) ||
      (v.contact_email && v.contact_email.toLowerCase().includes(q)) ||
      (v.tax_id && v.tax_id.toLowerCase().includes(q))
  );
  renderFinanceVendors(filtered);
}

function openAddVendorModal() {
  document.getElementById("fVendorId").value = "";
  document.getElementById("fVendorName").value = "";
  document.getElementById("fVendorCategory").value = "General";
  document.getElementById("fVendorEmail").value = "";
  document.getElementById("fVendorPhone").value = "";
  document.getElementById("fVendorTaxId").value = "";
  document.getElementById("fVendorNotes").value = "";
  const title = document.getElementById("vendorModalTitle");
  if (title) title.textContent = "Add Vendor";
  const btn = document.getElementById("vendorSaveBtn");
  if (btn) btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Vendor`;
  openModal("vendorModal");
}

function openEditVendorModal(id) {
  const v = FinanceState.vendors.find((x) => x.id === id);
  if (!v) return;

  document.getElementById("fVendorId").value = v.id;
  document.getElementById("fVendorName").value = v.name || "";
  document.getElementById("fVendorCategory").value = v.category || "General";
  document.getElementById("fVendorEmail").value = v.contact_email || "";
  document.getElementById("fVendorPhone").value = v.contact_phone || "";
  document.getElementById("fVendorTaxId").value = v.tax_id || "";
  document.getElementById("fVendorNotes").value = v.notes || "";
  const title = document.getElementById("vendorModalTitle");
  if (title) title.textContent = "Edit Vendor";
  const btn = document.getElementById("vendorSaveBtn");
  if (btn) btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Update Vendor`;
  openModal("vendorModal");
}

async function saveVendor() {
  const idVal = document.getElementById("fVendorId").value;
  const name = document.getElementById("fVendorName").value.trim();
  const category = document.getElementById("fVendorCategory").value.trim();
  const contact_email = document.getElementById("fVendorEmail").value.trim();
  const contact_phone = document.getElementById("fVendorPhone").value.trim();
  const tax_id = document.getElementById("fVendorTaxId").value.trim();
  const notes = document.getElementById("fVendorNotes").value.trim();

  if (!name) {
    showToast("Vendor name is required", "error");
    return;
  }

  const payload = {
    name,
    category: category || "General",
    contact_email: contact_email || null,
    contact_phone: contact_phone || null,
    tax_id: tax_id || null,
    notes: notes || null,
  };

  const btn = document.getElementById("vendorSaveBtn");
  if (btn) btn.disabled = true;

  try {
    if (idVal) {
      await FinanceApi.updateVendor(parseInt(idVal, 10), payload);
      showToast("Vendor updated successfully", "success");
    } else {
      await FinanceApi.createVendor(payload);
      showToast("Vendor created successfully", "success");
    }
    closeModal("vendorModal");
    loadFinanceVendors();
  } catch (err) {
    showToast(err.message || "Failed to save vendor", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function toggleVendorActive(id, currentlyActive) {
  const action = currentlyActive ? "deactivate" : "activate";
  if (!confirm(`Are you sure you want to ${action} this vendor?`)) return;

  try {
    if (currentlyActive) {
      await FinanceApi.deleteVendor(id);
      showToast("Vendor deactivated", "success");
    } else {
      await FinanceApi.updateVendor(id, { is_active: true });
      showToast("Vendor reactivated", "success");
    }
    loadFinanceVendors();
  } catch (err) {
    showToast(err.message || `Failed to ${action} vendor`, "error");
  }
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
