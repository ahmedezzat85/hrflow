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
  categories: [],
  paymentTypes: [],
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
  const bar = document.getElementById("financeInvoicesLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const statusFilter = document.getElementById("financeInvoiceStatusFilter");
    const params = {};
    if (statusFilter && statusFilter.value) params.status = statusFilter.value;
    const items = await FinanceApi.getInvoices(Object.keys(params).length ? params : undefined);
    FinanceState.invoices = items;
    renderFinanceInvoices(items);
  } catch (err) {
    console.error("Failed to load finance invoices:", err);
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function _invoiceStatusBadge(status) {
  const map = {
    draft: "badge-pending",
    sent: "badge-info",
    paid: "badge-approved",
    overdue: "badge-rejected",
    void: "badge-grey",
  };
  return map[status] || "badge-pending";
}

function _revenueChannelLabel(channel) {
  const map = {
    local_egp: "Local EGP",
    overseas_usd: "Overseas USD",
    cash: "Cash",
    intercompany_transfer_us: "Intercompany (US)",
    other: "Other",
  };
  return map[channel] || channel || "";
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
      (inv) => {
        const routeParts = [];
        if (inv.expected_bank_account_name) {
          routeParts.push(`<span style="display:inline-flex; align-items:center; gap:4px; font-size:0.82rem;"><i class="fa-solid fa-building-columns" style="opacity:0.6; font-size:0.75rem;"></i> ${inv.expected_bank_account_name}</span>`);
        }
        if (inv.revenue_channel) {
          routeParts.push(`<span class="badge badge-grey" style="font-size:0.72rem;">${_revenueChannelLabel(inv.revenue_channel)}</span>`);
        }
        const routeDisplay = routeParts.length ? routeParts.join("<br>") : `<span style="opacity:0.4;">—</span>`;
        const discrepancyBadge = inv.has_bank_discrepancy
          ? `<span class="badge" style="background: rgba(234, 179, 8, 0.18); color: #eab308; border: 1px solid rgba(234, 179, 8, 0.4); font-size: 0.72rem; margin-left: 6px;" title="Payment received in different account than expected"><i class="fa-solid fa-triangle-exclamation"></i> Discrepancy</span>`
          : "";

        return `
    <tr>
      <td><strong>${inv.invoice_number}</strong>${discrepancyBadge}</td>
      <td>${inv.customer_name || "--"}</td>
      <td>${routeDisplay}</td>
      <td>${inv.issue_date || "--"}</td>
      <td>${inv.due_date || "--"}</td>
      <td><strong>$${Number(inv.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
      <td><span class="badge ${_invoiceStatusBadge(inv.status)}">${(inv.status || "--").toUpperCase()}</span></td>
      <td style="display:flex; gap:6px; flex-wrap:wrap;">
        ${inv.status !== "void" ? `<button class="btn btn-sm" onclick="openEditInvoiceModal(${inv.id})" title="Edit Invoice"><i class="fa-solid fa-pen"></i></button>` : ""}
        ${(inv.status === "sent" || inv.status === "overdue") ? `<button class="btn btn-sm btn-fill" onclick="openPaymentModal(${inv.id})" title="Record Payment"><i class="fa-solid fa-money-bill-wave"></i> Pay</button>` : ""}
        ${(inv.status === "draft" || inv.status === "sent") ? `<button class="btn btn-sm btn-danger" onclick="confirmVoidInvoice(${inv.id})" title="Void Invoice"><i class="fa-solid fa-ban"></i></button>` : ""}
      </td>
    </tr>
  `;
      }
    )
    .join("");
}

function filterFinanceInvoices(query) {
  const q = (query || "").toLowerCase();
  const filtered = (FinanceState.invoices || []).filter(
    (inv) =>
      inv.invoice_number.toLowerCase().includes(q) ||
      (inv.customer_name || "").toLowerCase().includes(q)
  );
  renderFinanceInvoices(filtered);
}

// ── Invoice Modal ────────────────────────────────────────────────────────────
async function _populateInvoiceBankDropdown() {
  const sel = document.getElementById("invoiceExpectedBankAccount");
  if (!sel) return;
  try {
    const accounts = await FinanceApi.getAccounts({ is_active: true });
    sel.innerHTML = `<option value="">— Any / Unspecified —</option>` + (accounts || []).map((a) => `<option value="${a.id}">${a.account_name} (${a.currency})</option>`).join("");
  } catch (_) {}
}

async function openAddInvoiceModal() {
  _populateInvoiceCustomerDropdown();
  _populateInvoiceBankDropdown();
  document.getElementById("invoiceModalTitleText").textContent = "New Sales Invoice";
  document.getElementById("invoiceModalId").value = "";
  document.getElementById("invoiceNumber").value = "";
  document.getElementById("invoiceCustomerId").value = "";
  document.getElementById("invoiceIssueDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("invoiceDueDate").value = "";
  document.getElementById("invoiceStatus").value = "draft";
  document.getElementById("invoiceCurrency").value = "USD";
  if (document.getElementById("invoiceExpectedBankAccount")) document.getElementById("invoiceExpectedBankAccount").value = "";
  if (document.getElementById("invoiceRevenueChannel")) document.getElementById("invoiceRevenueChannel").value = "";
  document.getElementById("invoiceNotes").value = "";
  document.getElementById("invoiceLinesBody").innerHTML = "";
  _updateInvoiceTotals();
  addInvoiceLine();
  openModal("invoiceModal");
}

async function openEditInvoiceModal(invoiceId) {
  _populateInvoiceCustomerDropdown();
  await _populateInvoiceBankDropdown();
  try {
    const inv = await FinanceApi.getInvoice(invoiceId);
    document.getElementById("invoiceModalTitleText").textContent = `Edit Invoice ${inv.invoice_number}`;
    document.getElementById("invoiceModalId").value = inv.id;
    document.getElementById("invoiceNumber").value = inv.invoice_number;
    document.getElementById("invoiceCustomerId").value = inv.customer_id;
    document.getElementById("invoiceIssueDate").value = inv.issue_date || "";
    document.getElementById("invoiceDueDate").value = inv.due_date || "";
    document.getElementById("invoiceStatus").value = inv.status || "draft";
    document.getElementById("invoiceCurrency").value = inv.currency || "USD";
    if (document.getElementById("invoiceExpectedBankAccount")) {
      document.getElementById("invoiceExpectedBankAccount").value = inv.expected_bank_account_id ? String(inv.expected_bank_account_id) : "";
    }
    if (document.getElementById("invoiceRevenueChannel")) {
      document.getElementById("invoiceRevenueChannel").value = inv.revenue_channel || "";
    }
    document.getElementById("invoiceNotes").value = inv.notes || "";
    document.getElementById("invoiceLinesBody").innerHTML = "";
    (inv.lines || []).forEach((ln) => addInvoiceLine(ln));
    _updateInvoiceTotals();
    openModal("invoiceModal");
  } catch (err) {
    showToast("Failed to load invoice: " + (err.message || err), "error");
  }
}

function closeInvoiceModal() {
  closeModal("invoiceModal");
}

function addInvoiceLine(data) {
  const tbody = document.getElementById("invoiceLinesBody");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="form-control" style="font-size:0.85rem;" placeholder="Description" value="${(data && data.description) || ""}" oninput="_updateInvoiceTotals()"></td>
    <td><input type="number" class="form-control inv-qty" style="font-size:0.85rem;" value="${(data && data.quantity) || 1}" min="0.001" step="0.001" oninput="_autoComputeLineTotal(this); _updateInvoiceTotals();"></td>
    <td><input type="number" class="form-control inv-price" style="font-size:0.85rem;" value="${(data && data.unit_price) || 0}" min="0" step="0.01" oninput="_autoComputeLineTotal(this); _updateInvoiceTotals();"></td>
    <td><input type="number" class="form-control inv-total" style="font-size:0.85rem;" value="${(data && data.line_total) || 0}" min="0" step="0.01" oninput="_updateInvoiceTotals()"></td>
    <td><button type="button" class="btn btn-sm btn-danger" onclick="this.closest('tr').remove(); _updateInvoiceTotals();" title="Remove line"><i class="fa-solid fa-trash"></i></button></td>
  `;
  tbody.appendChild(tr);
  _updateInvoiceTotals();
}

function _autoComputeLineTotal(input) {
  const row = input.closest("tr");
  const qty = parseFloat(row.querySelector(".inv-qty").value) || 0;
  const price = parseFloat(row.querySelector(".inv-price").value) || 0;
  row.querySelector(".inv-total").value = (qty * price).toFixed(2);
}

function _updateInvoiceTotals() {
  const rows = document.querySelectorAll("#invoiceLinesBody tr");
  let subtotal = 0;
  rows.forEach((r) => {
    subtotal += parseFloat(r.querySelector(".inv-total")?.value || 0);
  });
  const subtotalEl = document.getElementById("invoiceSubtotalDisplay");
  const totalEl = document.getElementById("invoiceTotalDisplay");
  if (subtotalEl) subtotalEl.textContent = subtotal.toFixed(2);
  if (totalEl) totalEl.textContent = subtotal.toFixed(2);
}

async function _populateInvoiceCustomerDropdown() {
  const sel = document.getElementById("invoiceCustomerId");
  if (!sel) return;
  try {
    const customers = await FinanceApi.getCustomers({ is_active: true });
    sel.innerHTML = `<option value="">— Select customer —</option>` + customers.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  } catch (_) {}
}

async function saveInvoiceModal() {
  const invoiceId = document.getElementById("invoiceModalId").value;
  const customerId = document.getElementById("invoiceCustomerId").value;
  const invoiceNumber = document.getElementById("invoiceNumber").value.trim();
  const issueDate = document.getElementById("invoiceIssueDate").value;
  const dueDate = document.getElementById("invoiceDueDate").value;

  if (!customerId) { showToast("Please select a customer", "error"); return; }
  if (!invoiceNumber) { showToast("Invoice number is required", "error"); return; }
  if (!issueDate || !dueDate) { showToast("Both dates are required", "error"); return; }

  const lines = [];
  document.querySelectorAll("#invoiceLinesBody tr").forEach((r) => {
    const desc = r.querySelector("input[type='text']")?.value.trim();
    const qty = parseFloat(r.querySelector(".inv-qty")?.value) || 1;
    const price = parseFloat(r.querySelector(".inv-price")?.value) || 0;
    const total = parseFloat(r.querySelector(".inv-total")?.value) || 0;
    if (desc) lines.push({ description: desc, quantity: qty, unit_price: price, line_total: total });
  });

  const expBankEl = document.getElementById("invoiceExpectedBankAccount");
  const revChanEl = document.getElementById("invoiceRevenueChannel");

  const payload = {
    customer_id: parseInt(customerId, 10),
    invoice_number: invoiceNumber,
    issue_date: issueDate,
    due_date: dueDate,
    status: document.getElementById("invoiceStatus").value,
    currency: document.getElementById("invoiceCurrency").value,
    expected_bank_account_id: expBankEl && expBankEl.value ? parseInt(expBankEl.value, 10) : null,
    revenue_channel: revChanEl && revChanEl.value ? revChanEl.value : null,
    notes: document.getElementById("invoiceNotes").value.trim(),
    lines,
  };

  const btn = document.getElementById("invoiceModalSaveBtn");
  if (btn) btn.disabled = true;
  try {
    if (invoiceId) {
      await FinanceApi.updateInvoice(invoiceId, payload);
      showToast("Invoice updated", "success");
    } else {
      await FinanceApi.createInvoice(payload);
      showToast("Invoice created", "success");
    }
    closeInvoiceModal();
    loadFinanceInvoices();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function confirmVoidInvoice(invoiceId) {
  if (!confirm("Void this invoice? This cannot be undone.")) return;
  try {
    await FinanceApi.voidInvoice(invoiceId);
    showToast("Invoice voided", "success");
    loadFinanceInvoices();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  }
}

function _checkPaymentBankDiscrepancy() {
  const expId = document.getElementById("paymentExpectedBankAccountId")?.value;
  const selectedId = document.getElementById("paymentBankAccountId")?.value;
  const warnEl = document.getElementById("paymentDiscrepancyWarning");
  if (!warnEl) return;
  if (expId && selectedId && String(expId) !== String(selectedId)) {
    warnEl.style.display = "block";
  } else {
    warnEl.style.display = "none";
  }
}

async function openPaymentModal(invoiceId) {
  const inv = (FinanceState.invoices || []).find((i) => i.id === invoiceId);
  document.getElementById("paymentInvoiceId").value = invoiceId;
  const expBankId = inv ? (inv.expected_bank_account_id || "") : "";
  const expBankName = inv ? (inv.expected_bank_account_name || "Expected Account") : "Expected Account";
  
  const expIdEl = document.getElementById("paymentExpectedBankAccountId");
  if (expIdEl) expIdEl.value = expBankId;
  const expNameEl = document.getElementById("paymentExpectedBankName");
  if (expNameEl) expNameEl.textContent = expBankName;

  const infoEl = document.getElementById("paymentInvoiceInfo");
  if (infoEl && inv) {
    infoEl.textContent = `Invoice ${inv.invoice_number} — ${inv.currency} ${Number(inv.total).toLocaleString("en-US", { minimumFractionDigits: 2 })} total`;
  }
  document.getElementById("paymentAmount").value = "";
  document.getElementById("paymentDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("paymentMethod").value = "bank_transfer";
  document.getElementById("paymentReference").value = "";

  const accSel = document.getElementById("paymentBankAccountId");
  if (accSel) {
    try {
      const accounts = await FinanceApi.getAccounts({ is_active: true });
      accSel.innerHTML = `<option value="">— Select account —</option>` + (accounts || []).map((a) => `<option value="${a.id}">${a.account_name} (${a.currency} ${Number(a.current_balance).toLocaleString("en-US", { minimumFractionDigits: 2 })})</option>`).join("");
      if (expBankId) {
        accSel.value = String(expBankId);
      }
    } catch (_) { accSel.innerHTML = "<option value=''>— No accounts available —</option>"; }
  }

  _checkPaymentBankDiscrepancy();
  openModal("invoicePaymentModal");
}

function closeInvoicePaymentModal() {
  closeModal("invoicePaymentModal");
}

async function saveInvoicePayment() {
  const invoiceId = document.getElementById("paymentInvoiceId").value;
  const amount = parseFloat(document.getElementById("paymentAmount").value);
  const paymentDate = document.getElementById("paymentDate").value;
  const bankAccountId = document.getElementById("paymentBankAccountId").value;

  if (!amount || amount <= 0) { showToast("Enter a valid payment amount", "error"); return; }
  if (!paymentDate) { showToast("Payment date is required", "error"); return; }
  if (!bankAccountId) { showToast("Select a bank account", "error"); return; }

  const payload = {
    direction: "incoming",
    amount,
    currency: "USD",
    payment_date: paymentDate,
    bank_account_id: parseInt(bankAccountId, 10),
    method: document.getElementById("paymentMethod").value,
    reference: document.getElementById("paymentReference").value.trim(),
  };

  try {
    const res = await FinanceApi.recordInvoicePayment(invoiceId, payload);
    if (res && res.account_discrepancy) {
      showToast("Payment recorded (Note: Routed to different account than expected)", "warning");
    } else {
      showToast("Payment recorded", "success");
    }
    closeInvoicePaymentModal();
    loadFinanceInvoices();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  }
}

function switchInvoiceSubTab(subTab) {
  const tabInv = document.getElementById("tabFinanceInvoices");
  const tabCust = document.getElementById("tabFinanceCustomers");
  const boxInv = document.getElementById("financeInvoiceSearchBox");
  const statusFilter = document.getElementById("financeInvoiceStatusFilter");
  const boxCust = document.getElementById("financeCustomerSearchBox");
  const conInv = document.getElementById("financeInvoicesContainer");
  const conCust = document.getElementById("financeCustomersContainer");
  const addCustBtn = document.getElementById("financeAddCustomerBtn");
  const newInvBtn = document.getElementById("financeNewInvoiceBtn");

  if (subTab === "customers") {
    if (tabInv) tabInv.classList.remove("active");
    if (tabCust) tabCust.classList.add("active");
    if (boxInv) boxInv.style.display = "none";
    if (statusFilter) statusFilter.style.display = "none";
    if (boxCust) boxCust.style.display = "block";
    if (conInv) conInv.style.display = "none";
    if (conCust) conCust.style.display = "block";
    if (addCustBtn) addCustBtn.style.display = "inline-flex";
    if (newInvBtn) newInvBtn.style.display = "none";
    loadFinanceCustomers();
  } else {
    if (tabInv) tabInv.classList.add("active");
    if (tabCust) tabCust.classList.remove("active");
    if (boxInv) boxInv.style.display = "block";
    if (statusFilter) statusFilter.style.display = "block";
    if (boxCust) boxCust.style.display = "none";
    if (conInv) conInv.style.display = "block";
    if (conCust) conCust.style.display = "none";
    if (addCustBtn) addCustBtn.style.display = "none";
    if (newInvBtn) newInvBtn.style.display = "inline-flex";
    loadFinanceInvoices();
  }
}

async function loadFinanceCustomers() {
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

  tbody.innerHTML = items.map((c) => `
    <tr>
      <td><strong>${c.name}</strong>${c.notes ? `<div style="font-size:12px;color:var(--text3);">${c.notes}</div>` : ""}</td>
      <td>${c.contact_email ? `<a href="mailto:${c.contact_email}">${c.contact_email}</a>` : "--"}</td>
      <td>${c.contact_phone || "--"}</td>
      <td><code>${c.tax_id || "--"}</code></td>
      <td><span class="badge ${c.is_active ? "badge-approved" : "badge-rejected"}">${c.is_active ? "ACTIVE" : "INACTIVE"}</span></td>
      <td><div style="display:flex;gap:6px;"><button class="btn btn-sm btn-icon" title="Edit Customer" onclick="openEditCustomerModal(${c.id})"><i class="fa-solid fa-pen-to-square"></i></button><button class="btn btn-sm btn-icon ${c.is_active ? "btn-danger" : ""}" title="${c.is_active ? "Deactivate" : "Activate"}" onclick="toggleCustomerActive(${c.id}, ${c.is_active})"><i class="fa-solid ${c.is_active ? "fa-ban" : "fa-check"}"></i></button></div></td>
    </tr>
  `).join("");
}

function filterFinanceCustomers(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return renderFinanceCustomers(FinanceState.customers);
  renderFinanceCustomers(FinanceState.customers.filter((c) => c.name.toLowerCase().includes(q) || (c.contact_email && c.contact_email.toLowerCase().includes(q)) || (c.tax_id && c.tax_id.toLowerCase().includes(q))));
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
  if (!name) { showToast("Customer name is required", "error"); return; }
  const payload = { name, contact_email: contact_email || null, contact_phone: contact_phone || null, tax_id: tax_id || null, notes: notes || null };
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
function _billStatusBadge(status) {
  const map = {
    unpaid: "badge-pending",
    paid: "badge-approved",
    overdue: "badge-rejected",
    void: "badge-grey",
  };
  return map[status] || "badge-pending";
}

async function loadFinanceBills() {
  const bar = document.getElementById("financeBillsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const statusFilter = document.getElementById("financeBillStatusFilter");
    const searchInput = document.getElementById("financeBillSearch");
    const params = {};
    if (statusFilter && statusFilter.value) params.status = statusFilter.value;
    if (searchInput && searchInput.value.trim()) params.search = searchInput.value.trim();
    const items = await FinanceApi.getBills(Object.keys(params).length ? params : undefined);
    FinanceState.bills = items || [];
    renderFinanceBills(FinanceState.bills);
  } catch (err) {
    console.error("Failed to load vendor bills:", err);
    showToast(err.message || "Failed to load bills", "error");
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

  tbody.innerHTML = items.map((bill) => `
    <tr>
      <td><strong>${bill.bill_number}</strong></td>
      <td>${bill.vendor_name || "--"}</td>
      <td><span class="badge badge-info">${bill.category || "General"}</span></td>
      <td>${bill.issue_date || "--"}</td>
      <td>${bill.due_date || "--"}</td>
      <td><strong>$${Number(bill.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
      <td><span class="badge ${_billStatusBadge(bill.status)}">${(bill.status || "--").toUpperCase()}</span></td>
      <td style="display:flex; gap:6px; flex-wrap:wrap;">
        ${bill.status !== "void" ? `<button class="btn btn-sm" onclick="openEditBillModal(${bill.id})" title="Edit Bill"><i class="fa-solid fa-pen"></i></button>` : ""}
        ${(bill.status === "unpaid" || bill.status === "overdue") ? `<button class="btn btn-sm btn-fill" onclick="openBillPaymentModal(${bill.id})" title="Record Payment"><i class="fa-solid fa-money-bill-wave"></i> Pay</button>` : ""}
        ${(bill.status === "unpaid" || bill.status === "overdue") ? `<button class="btn btn-sm btn-danger" onclick="confirmVoidBill(${bill.id})" title="Void Bill"><i class="fa-solid fa-ban"></i></button>` : ""}
      </td>
    </tr>
  `).join("");
}

function filterFinanceBills(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) {
    loadFinanceBills();
    return;
  }
  const filtered = (FinanceState.bills || []).filter((bill) =>
    (bill.bill_number || "").toLowerCase().includes(q) ||
    (bill.vendor_name || "").toLowerCase().includes(q) ||
    (bill.category || "").toLowerCase().includes(q)
  );
  renderFinanceBills(filtered);
}

async function _populateBillVendorDropdown() {
  const sel = document.getElementById("billVendorId");
  if (!sel) return;
  try {
    const vendors = await FinanceApi.getVendors({ is_active: true });
    sel.innerHTML = `<option value="">— Select vendor —</option>` + vendors.map((v) => `<option value="${v.id}">${v.name}</option>`).join("");
  } catch (_) {}
}

function openAddBillModal() {
  _populateBillVendorDropdown();
  document.getElementById("billModalTitleText").textContent = "New Vendor Bill";
  document.getElementById("billModalId").value = "";
  document.getElementById("billVendorId").value = "";
  document.getElementById("billNumber").value = "";
  document.getElementById("billCategory").value = "";
  document.getElementById("billIssueDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("billDueDate").value = "";
  document.getElementById("billStatus").value = "unpaid";
  document.getElementById("billCurrency").value = "USD";
  document.getElementById("billNotes").value = "";
  document.getElementById("billLinesBody").innerHTML = "";
  _updateBillTotals();
  addBillLine();
  document.getElementById("billModal").style.display = "flex";
}

async function openEditBillModal(billId) {
  _populateBillVendorDropdown();
  try {
    const bill = await FinanceApi.getBill(billId);
    document.getElementById("billModalTitleText").textContent = `Edit Bill ${bill.bill_number}`;
    document.getElementById("billModalId").value = bill.id;
    document.getElementById("billVendorId").value = bill.vendor_id;
    document.getElementById("billNumber").value = bill.bill_number || "";
    document.getElementById("billCategory").value = bill.category || "";
    document.getElementById("billIssueDate").value = bill.issue_date || "";
    document.getElementById("billDueDate").value = bill.due_date || "";
    document.getElementById("billStatus").value = bill.status || "unpaid";
    document.getElementById("billCurrency").value = bill.currency || "USD";
    document.getElementById("billNotes").value = bill.notes || "";
    document.getElementById("billLinesBody").innerHTML = "";
    (bill.lines || []).forEach((ln) => addBillLine(ln));
    if (!bill.lines || !bill.lines.length) addBillLine();
    _updateBillTotals();
    document.getElementById("billModal").style.display = "flex";
  } catch (err) {
    showToast("Failed to load bill: " + (err.message || err), "error");
  }
}

function closeBillModal() {
  document.getElementById("billModal").style.display = "none";
}

function addBillLine(data) {
  const tbody = document.getElementById("billLinesBody");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="form-control" style="font-size:0.85rem;" placeholder="Description" value="${(data && data.description) || ""}" oninput="_updateBillTotals()"></td>
    <td><input type="number" class="form-control bill-qty" style="font-size:0.85rem;" value="${(data && data.quantity) || 1}" min="0.001" step="0.001" oninput="_autoComputeBillLineTotal(this); _updateBillTotals();"></td>
    <td><input type="number" class="form-control bill-price" style="font-size:0.85rem;" value="${(data && data.unit_price) || 0}" min="0" step="0.01" oninput="_autoComputeBillLineTotal(this); _updateBillTotals();"></td>
    <td><input type="number" class="form-control bill-total" style="font-size:0.85rem;" value="${(data && data.line_total) || 0}" min="0" step="0.01" oninput="_updateBillTotals()"></td>
    <td><button type="button" class="btn btn-sm btn-danger" onclick="this.closest('tr').remove(); _updateBillTotals();" title="Remove line"><i class="fa-solid fa-trash"></i></button></td>
  `;
  tbody.appendChild(tr);
  _updateBillTotals();
}

function _autoComputeBillLineTotal(input) {
  const row = input.closest("tr");
  const qty = parseFloat(row.querySelector(".bill-qty").value) || 0;
  const price = parseFloat(row.querySelector(".bill-price").value) || 0;
  row.querySelector(".bill-total").value = (qty * price).toFixed(2);
}

function _updateBillTotals() {
  const rows = document.querySelectorAll("#billLinesBody tr");
  let subtotal = 0;
  rows.forEach((r) => {
    subtotal += parseFloat(r.querySelector(".bill-total")?.value || 0);
  });
  const subtotalEl = document.getElementById("billSubtotalDisplay");
  const totalEl = document.getElementById("billTotalDisplay");
  if (subtotalEl) subtotalEl.textContent = subtotal.toFixed(2);
  if (totalEl) totalEl.textContent = subtotal.toFixed(2);
}

async function saveBillModal() {
  const billId = document.getElementById("billModalId").value;
  const vendorId = document.getElementById("billVendorId").value;
  const billNumber = document.getElementById("billNumber").value.trim();
  const issueDate = document.getElementById("billIssueDate").value;
  const dueDate = document.getElementById("billDueDate").value;

  if (!vendorId) { showToast("Please select a vendor", "error"); return; }
  if (!billNumber) { showToast("Bill number is required", "error"); return; }
  if (!issueDate || !dueDate) { showToast("Both dates are required", "error"); return; }

  const lines = [];
  document.querySelectorAll("#billLinesBody tr").forEach((r) => {
    const desc = r.querySelector("input[type='text']")?.value.trim();
    const qty = parseFloat(r.querySelector(".bill-qty")?.value) || 1;
    const price = parseFloat(r.querySelector(".bill-price")?.value) || 0;
    const total = parseFloat(r.querySelector(".bill-total")?.value) || 0;
    if (desc) lines.push({ description: desc, quantity: qty, unit_price: price, line_total: total });
  });

  const payload = {
    vendor_id: parseInt(vendorId, 10),
    bill_number: billNumber,
    category: document.getElementById("billCategory").value.trim() || null,
    issue_date: issueDate,
    due_date: dueDate,
    status: document.getElementById("billStatus").value,
    currency: document.getElementById("billCurrency").value,
    notes: document.getElementById("billNotes").value.trim(),
    lines,
  };

  const btn = document.getElementById("billModalSaveBtn");
  if (btn) btn.disabled = true;
  try {
    if (billId) {
      await FinanceApi.updateBill(billId, payload);
      showToast("Bill updated", "success");
    } else {
      await FinanceApi.createBill(payload);
      showToast("Bill created", "success");
    }
    closeBillModal();
    loadFinanceBills();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function confirmVoidBill(billId) {
  if (!confirm("Void this bill? This cannot be undone.")) return;
  try {
    await FinanceApi.voidBill(billId);
    showToast("Bill voided", "success");
    loadFinanceBills();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  }
}

async function openBillPaymentModal(billId) {
  const bill = (FinanceState.bills || []).find((b) => b.id === billId);
  document.getElementById("billPaymentBillId").value = billId;
  const infoEl = document.getElementById("billPaymentBillInfo");
  if (infoEl && bill) {
    infoEl.textContent = `Bill ${bill.bill_number} — ${bill.currency} ${Number(bill.total).toLocaleString("en-US", { minimumFractionDigits: 2 })} total`;
  }
  document.getElementById("billPaymentAmount").value = "";
  document.getElementById("billPaymentDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("billPaymentMethod").value = "bank_transfer";
  document.getElementById("billPaymentReference").value = "";

  const accSel = document.getElementById("billPaymentBankAccountId");
  if (accSel) {
    try {
      const accounts = await FinanceApi.getAccounts({ is_active: true });
      accSel.innerHTML = `<option value="">— Select account —</option>` + accounts.map((a) => `<option value="${a.id}">${a.account_name} (${a.currency} ${Number(a.current_balance).toLocaleString("en-US", { minimumFractionDigits: 2 })})</option>`).join("");
    } catch (_) { accSel.innerHTML = "<option value=''>— No accounts available —</option>"; }
  }

  document.getElementById("billPaymentModal").style.display = "flex";
}

function closeBillPaymentModal() {
  document.getElementById("billPaymentModal").style.display = "none";
}

async function saveBillPayment() {
  const billId = document.getElementById("billPaymentBillId").value;
  const amount = parseFloat(document.getElementById("billPaymentAmount").value);
  const paymentDate = document.getElementById("billPaymentDate").value;
  const bankAccountId = document.getElementById("billPaymentBankAccountId").value;
  const bill = (FinanceState.bills || []).find((b) => String(b.id) === String(billId));

  if (!amount || amount <= 0) { showToast("Enter a valid payment amount", "error"); return; }
  if (!paymentDate) { showToast("Payment date is required", "error"); return; }
  if (!bankAccountId) { showToast("Select a bank account", "error"); return; }

  const payload = {
    direction: "outgoing",
    amount,
    currency: bill?.currency || "USD",
    payment_date: paymentDate,
    bank_account_id: parseInt(bankAccountId, 10),
    method: document.getElementById("billPaymentMethod").value,
    reference: document.getElementById("billPaymentReference").value.trim(),
  };

  try {
    await FinanceApi.recordBillPayment(billId, payload);
    showToast("Bill payment recorded", "success");
    closeBillPaymentModal();
    loadFinanceBills();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  }
}

function switchBillSubTab(subTab) {
  const tabBill = document.getElementById("tabFinanceBills");
  const tabVend = document.getElementById("tabFinanceVendors");
  const boxBill = document.getElementById("financeBillSearchBox");
  const statusFilter = document.getElementById("financeBillStatusFilter");
  const boxVend = document.getElementById("financeVendorSearchBox");
  const conBill = document.getElementById("financeBillsContainer");
  const conVend = document.getElementById("financeVendorsContainer");
  const addVendBtn = document.getElementById("financeAddVendorBtn");
  const recordBillBtn = document.getElementById("financeRecordBillBtn");

  if (subTab === "vendors") {
    if (tabBill) tabBill.classList.remove("active");
    if (tabVend) tabVend.classList.add("active");
    if (boxBill) boxBill.style.display = "none";
    if (statusFilter) statusFilter.style.display = "none";
    if (boxVend) boxVend.style.display = "block";
    if (conBill) conBill.style.display = "none";
    if (conVend) conVend.style.display = "block";
    if (addVendBtn) addVendBtn.style.display = "inline-flex";
    if (recordBillBtn) recordBillBtn.style.display = "none";
    loadFinanceVendors();
  } else {
    if (tabBill) tabBill.classList.add("active");
    if (tabVend) tabVend.classList.remove("active");
    if (boxBill) boxBill.style.display = "block";
    if (statusFilter) statusFilter.style.display = "block";
    if (boxVend) boxVend.style.display = "none";
    if (conBill) conBill.style.display = "block";
    if (conVend) conVend.style.display = "none";
    if (addVendBtn) addVendBtn.style.display = "inline-flex";
    if (recordBillBtn) recordBillBtn.style.display = "inline-flex";
    loadFinanceBills();
  }
}

async function loadFinanceVendors() {
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

  tbody.innerHTML = items.map((v) => `
    <tr>
      <td><strong>${v.name}</strong>${v.notes ? `<div style="font-size:12px;color:var(--text3);">${v.notes}</div>` : ""}</td>
      <td><span class="badge badge-info">${v.category || "General"}</span></td>
      <td>${v.contact_email ? `<a href="mailto:${v.contact_email}">${v.contact_email}</a>` : "--"}</td>
      <td>${v.contact_phone || "--"}</td>
      <td><code>${v.tax_id || "--"}</code></td>
      <td><span class="badge ${v.is_active ? "badge-approved" : "badge-rejected"}">${v.is_active ? "ACTIVE" : "INACTIVE"}</span></td>
      <td><div style="display:flex;gap:6px;"><button class="btn btn-sm btn-icon" title="Edit Vendor" onclick="openEditVendorModal(${v.id})"><i class="fa-solid fa-pen-to-square"></i></button><button class="btn btn-sm btn-icon ${v.is_active ? "btn-danger" : ""}" title="${v.is_active ? "Deactivate" : "Activate"}" onclick="toggleVendorActive(${v.id}, ${v.is_active})"><i class="fa-solid ${v.is_active ? "fa-ban" : "fa-check"}"></i></button></div></td>
    </tr>
  `).join("");
}

function filterFinanceVendors(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return renderFinanceVendors(FinanceState.vendors);
  renderFinanceVendors(FinanceState.vendors.filter((v) => v.name.toLowerCase().includes(q) || (v.category && v.category.toLowerCase().includes(q)) || (v.contact_email && v.contact_email.toLowerCase().includes(q)) || (v.tax_id && v.tax_id.toLowerCase().includes(q))));
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
  if (!name) { showToast("Vendor name is required", "error"); return; }
  const payload = { name, category: category || "General", contact_email: contact_email || null, contact_phone: contact_phone || null, tax_id: tax_id || null, notes: notes || null };
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
// 5. Company Bank & Cash Accounts & Lookups (Phase 0 & 1)
// ==========================================
let _currentFinanceSubTab = "accounts";
let _currentBankAccountFilter = "all";

function switchFinanceAccountsSubTab(tabName, btn) {
  _currentFinanceSubTab = tabName;

  const tabs = document.querySelectorAll("#financeAccountsSubNav .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) {
    btn.classList.add("active");
  } else {
    const el = document.getElementById(
      tabName === "accounts" ? "subtabFinanceAccounts" :
      tabName === "statements" ? "subtabFinanceStatements" :
      tabName === "cheques" ? "subtabFinanceCheques" :
      tabName === "transfers" ? "subtabFinanceTransfers" :
      tabName === "categories" ? "subtabFinanceCategories" : "subtabFinancePaymentTypes"
    );
    if (el) el.classList.add("active");
  }

  const paneAccounts = document.getElementById("financeSubPaneAccounts");
  const paneStatements = document.getElementById("financeSubPaneStatements");
  const paneCheques = document.getElementById("financeSubPaneCheques");
  const paneTransfers = document.getElementById("financeSubPaneTransfers");
  const paneCategories = document.getElementById("financeSubPaneCategories");
  const panePaymentTypes = document.getElementById("financeSubPanePaymentTypes");

  if (paneAccounts) paneAccounts.style.display = tabName === "accounts" ? "block" : "none";
  if (paneStatements) paneStatements.style.display = tabName === "statements" ? "block" : "none";
  if (paneCheques) paneCheques.style.display = tabName === "cheques" ? "block" : "none";
  if (paneTransfers) paneTransfers.style.display = tabName === "transfers" ? "block" : "none";
  if (paneCategories) paneCategories.style.display = tabName === "categories" ? "block" : "none";
  if (panePaymentTypes) panePaymentTypes.style.display = tabName === "payment_types" ? "block" : "none";

  if (tabName === "accounts") {
    loadFinanceAccounts();
  } else if (tabName === "statements") {
    loadFinanceStatements();
  } else if (tabName === "cheques") {
    loadFinanceCheques();
  } else if (tabName === "transfers") {
    loadFinanceTransfers();
  } else if (tabName === "categories") {
    loadFinanceCategories();
  } else if (tabName === "payment_types") {
    loadFinancePaymentTypes();
  }
}

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
  const tabs = document.querySelectorAll("#financeSubPaneAccounts .filter-tab");
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
      <td><span class="badge ${acc.account_type === 'cash' ? 'badge-warning' : 'badge-info'}">${(acc.account_type || 'bank').toUpperCase()}</span></td>
      <td>${acc.bank_name || '<span style="color:var(--text3); font-style:italic;">Cash Safe</span>'}</td>
      <td><code>${acc.account_number}</code></td>
      <td><span class="badge badge-info">${acc.currency}</span></td>
      <td><strong>${acc.currency === "EGP" ? "E£" : "$"}${Number(acc.current_balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
      <td><span class="badge ${acc.is_active ? "badge-approved" : "badge-rejected"}">${acc.is_active ? "ACTIVE" : "INACTIVE"}</span></td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-fill" onclick="viewAccountLedger(${acc.id})" title="View Continuous Ledger">
            <i class="fa-solid fa-list-check"></i> Ledger
          </button>
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

function onCompanyAccountTypeChange() {
  const type = document.getElementById("fCompanyAccountType")?.value;
  const bankNameLabel = document.getElementById("fCompanyBankNameLabel");
  const bankNameInput = document.getElementById("fCompanyBankName");
  if (type === "cash") {
    if (bankNameLabel) bankNameLabel.innerHTML = 'Custodian / Location <span class="opt" style="font-size:11px;color:var(--text3);">(optional)</span>';
    if (bankNameInput) bankNameInput.placeholder = "e.g. Office Safe, Petty Cash Box";
  } else {
    if (bankNameLabel) bankNameLabel.innerHTML = 'Bank Name <span class="req">*</span>';
    if (bankNameInput) bankNameInput.placeholder = "e.g. JPMorgan Chase or CIB";
  }
}

function openAddCompanyBankAccountModal() {
  document.getElementById("companyBankAccountModalTitle").textContent = "Add Company Bank / Cash Account";
  document.getElementById("fCompanyAccountId").value = "";
  document.getElementById("fCompanyAccountName").value = "";
  if (document.getElementById("fCompanyAccountType")) document.getElementById("fCompanyAccountType").value = "bank";
  if (document.getElementById("fCompanyCountry")) document.getElementById("fCompanyCountry").value = "EG";
  document.getElementById("fCompanyBankName").value = "";
  document.getElementById("fCompanyAccountNumber").value = "";
  document.getElementById("fCompanyCurrency").value = "USD";
  document.getElementById("fCompanyOpeningBalance").value = "0.00";
  document.getElementById("fCompanyOpeningBalanceField").style.display = "block";
  onCompanyAccountTypeChange();
  openModal("companyBankAccountModal");
}

function openEditCompanyBankAccountModal(id) {
  const acc = (FinanceState.accounts || []).find((a) => a.id === id);
  if (!acc) return;

  document.getElementById("companyBankAccountModalTitle").textContent = "Edit Company Account";
  document.getElementById("fCompanyAccountId").value = acc.id;
  document.getElementById("fCompanyAccountName").value = acc.account_name;
  if (document.getElementById("fCompanyAccountType")) document.getElementById("fCompanyAccountType").value = acc.account_type || "bank";
  if (document.getElementById("fCompanyCountry")) document.getElementById("fCompanyCountry").value = acc.country || "";
  document.getElementById("fCompanyBankName").value = acc.bank_name || "";
  document.getElementById("fCompanyAccountNumber").value = "";
  document.getElementById("fCompanyAccountNumber").placeholder = acc.account_number + " (leave blank to keep unchanged)";
  document.getElementById("fCompanyCurrency").value = acc.currency || "USD";
  document.getElementById("fCompanyOpeningBalanceField").style.display = "none";
  onCompanyAccountTypeChange();
  openModal("companyBankAccountModal");
}

async function saveCompanyBankAccount() {
  const idVal = document.getElementById("fCompanyAccountId").value;
  const account_name = document.getElementById("fCompanyAccountName").value.trim();
  const account_type = document.getElementById("fCompanyAccountType")?.value || "bank";
  const country = document.getElementById("fCompanyCountry")?.value.trim() || null;
  const bank_name = document.getElementById("fCompanyBankName").value.trim();
  const account_number = document.getElementById("fCompanyAccountNumber").value.trim();
  const currency = document.getElementById("fCompanyCurrency").value;

  if (!account_name) {
    toast("Please provide an Account Name", "fa-solid fa-circle-exclamation");
    return;
  }
  if (account_type === "bank" && !bank_name) {
    toast("Please provide a Bank Name for bank accounts", "fa-solid fa-circle-exclamation");
    return;
  }

  const saveBtn = document.getElementById("companyBankAccountSaveBtn");
  if (saveBtn) saveBtn.disabled = true;

  try {
    if (idVal) {
      const payload = { account_name, account_type, country, currency };
      if (bank_name || account_type === "cash") payload.bank_name = bank_name || null;
      if (account_number) payload.account_number = account_number;
      await FinanceApi.updateAccount(Number(idVal), payload);
      toast("Account updated successfully", "fa-solid fa-circle-check");
    } else {
      if (!account_number && account_type === "bank") {
        toast("Please provide an Account Number", "fa-solid fa-circle-exclamation");
        if (saveBtn) saveBtn.disabled = false;
        return;
      }
      const finalAccNum = account_number || `CASH-${currency}-${Date.now().toString().slice(-4)}`;
      const opening_balance = parseFloat(document.getElementById("fCompanyOpeningBalance").value) || 0.0;
      const payload = {
        account_name,
        account_type,
        country,
        bank_name: bank_name || (account_type === "cash" ? "Cash Account" : null),
        account_number: finalAccNum,
        currency,
        opening_balance,
      };
      await FinanceApi.createAccount(payload);
      toast("Account created successfully", "fa-solid fa-circle-check");
    }

    closeModal("companyBankAccountModal");
    await loadFinanceAccounts();
  } catch (err) {
    toast(err.message || "Failed to save account", "fa-solid fa-triangle-exclamation");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function toggleCompanyBankAccountActive(id, currentActive) {
  const action = currentActive ? "deactivate" : "reactivate";
  if (!confirm(`Are you sure you want to ${action} this account?`)) return;

  try {
    if (currentActive) {
      await FinanceApi.deleteAccount(id);
      toast("Account deactivated", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.updateAccount(id, { is_active: true });
      toast("Account reactivated", "fa-solid fa-circle-check");
    }
    await loadFinanceAccounts();
  } catch (err) {
    toast(err.message || `Failed to ${action} account`, "fa-solid fa-triangle-exclamation");
  }
}

// ==========================================
// 5.1 Transaction Categories (Phase 0)
// ==========================================
let _currentCategoryStatusFilter = "all";
let _currentCategoryKindFilter = "all";

async function loadFinanceCategories() {
  const bar = document.getElementById("financeCategoriesLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    let params = {};
    if (_currentCategoryStatusFilter === "active") params.is_active = true;
    else if (_currentCategoryStatusFilter === "inactive") params.is_active = false;
    if (_currentCategoryKindFilter && _currentCategoryKindFilter !== "all") params.kind = _currentCategoryKindFilter;

    const items = await FinanceApi.getCategories(params);
    FinanceState.categories = items;

    let filtered = items;
    if (_currentCategoryStatusFilter === "petty") {
      filtered = items.filter((c) => c.is_petty);
    }
    renderFinanceCategories(filtered);
  } catch (err) {
    console.error("Failed to load categories:", err);
    toast("Failed to load categories: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterFinanceCategories(filterType, btn) {
  _currentCategoryStatusFilter = filterType;
  const tabs = document.querySelectorAll("#financeSubPaneCategories .filter-tabs .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");
  loadFinanceCategories();
}

function filterFinanceCategoriesByKind(kind) {
  _currentCategoryKindFilter = kind;
  loadFinanceCategories();
}

function _categoryKindBadge(kind) {
  switch (kind) {
    case "revenue": return "badge-approved";
    case "cost": return "badge-rejected";
    case "transfer": return "badge-info";
    default: return "badge-pending";
  }
}

function renderFinanceCategories(items) {
  const tbody = document.getElementById("financeCategoriesTableBody");
  const empty = document.getElementById("financeCategoriesEmpty");
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
      <td><span style="color:var(--text3);font-size:12px;">${c.sort_order ?? 0}</span></td>
      <td><strong>${c.name}</strong></td>
      <td><span class="badge ${_categoryKindBadge(c.kind)}">${(c.kind || "other").toUpperCase()}</span></td>
      <td>
        ${c.is_petty
          ? '<span class="badge badge-info"><i class="fa-solid fa-receipt"></i> Petty / Recurring</span>'
          : '<span style="color:var(--text3);font-size:12px;">Standard</span>'
        }
      </td>
      <td><span class="badge ${c.is_active ? "badge-approved" : "badge-rejected"}">${c.is_active ? "ACTIVE" : "INACTIVE"}</span></td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm" onclick="openEditFinanceCategoryModal(${c.id})" title="Edit Category">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn btn-sm ${c.is_active ? "btn-danger" : "btn-fill"}" onclick="toggleFinanceCategoryActive(${c.id}, ${c.is_active})" title="${c.is_active ? "Deactivate Category" : "Reactivate Category"}">
            <i class="fa-solid ${c.is_active ? "fa-power-off" : "fa-check"}"></i>
          </button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");
}

function openAddFinanceCategoryModal() {
  document.getElementById("financeCategoryModalTitle").textContent = "Add Transaction Category";
  document.getElementById("fFinanceCategoryId").value = "";
  document.getElementById("fFinanceCategoryName").value = "";
  document.getElementById("fFinanceCategoryKind").value = "cost";
  document.getElementById("fFinanceCategorySortOrder").value = "0";
  document.getElementById("fFinanceCategoryIsPetty").checked = false;
  openModal("financeCategoryModal");
}

function openEditFinanceCategoryModal(id) {
  const cat = (FinanceState.categories || []).find((c) => c.id === id);
  if (!cat) return;

  document.getElementById("financeCategoryModalTitle").textContent = "Edit Transaction Category";
  document.getElementById("fFinanceCategoryId").value = cat.id;
  document.getElementById("fFinanceCategoryName").value = cat.name;
  document.getElementById("fFinanceCategoryKind").value = cat.kind || "cost";
  document.getElementById("fFinanceCategorySortOrder").value = cat.sort_order ?? 0;
  document.getElementById("fFinanceCategoryIsPetty").checked = Boolean(cat.is_petty);
  openModal("financeCategoryModal");
}

async function saveFinanceCategory() {
  const idVal = document.getElementById("fFinanceCategoryId").value;
  const name = document.getElementById("fFinanceCategoryName").value.trim();
  const kind = document.getElementById("fFinanceCategoryKind").value;
  const sort_order = parseInt(document.getElementById("fFinanceCategorySortOrder").value, 10) || 0;
  const is_petty = document.getElementById("fFinanceCategoryIsPetty").checked;

  if (!name) {
    toast("Please enter a category name", "fa-solid fa-circle-exclamation");
    return;
  }

  const saveBtn = document.getElementById("financeCategorySaveBtn");
  if (saveBtn) saveBtn.disabled = true;

  try {
    if (idVal) {
      await FinanceApi.updateCategory(Number(idVal), { name, kind, sort_order, is_petty });
      toast("Category updated successfully", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.createCategory({ name, kind, sort_order, is_petty, is_active: true });
      toast("Category created successfully", "fa-solid fa-circle-check");
    }
    closeModal("financeCategoryModal");
    await loadFinanceCategories();
  } catch (err) {
    toast(err.message || "Failed to save category", "fa-solid fa-triangle-exclamation");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function toggleFinanceCategoryActive(id, currentActive) {
  const action = currentActive ? "deactivate" : "reactivate";
  if (!confirm(`Are you sure you want to ${action} this category? Deactivated categories remain on historical records.`)) return;

  try {
    if (currentActive) {
      await FinanceApi.deleteCategory(id);
      toast("Category deactivated", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.updateCategory(id, { is_active: true });
      toast("Category reactivated", "fa-solid fa-circle-check");
    }
    await loadFinanceCategories();
  } catch (err) {
    toast(err.message || `Failed to ${action} category`, "fa-solid fa-triangle-exclamation");
  }
}

// ==========================================
// 5.2 Payment Types (Phase 0)
// ==========================================
let _currentPaymentTypeStatusFilter = "all";

async function loadFinancePaymentTypes() {
  const bar = document.getElementById("financePaymentTypesLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    let params = {};
    if (_currentPaymentTypeStatusFilter === "active") params.is_active = true;
    else if (_currentPaymentTypeStatusFilter === "inactive") params.is_active = false;

    const items = await FinanceApi.getPaymentTypes(params);
    FinanceState.paymentTypes = items;
    renderFinancePaymentTypes(items);
  } catch (err) {
    console.error("Failed to load payment types:", err);
    toast("Failed to load payment types: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterFinancePaymentTypes(filterType, btn) {
  _currentPaymentTypeStatusFilter = filterType;
  const tabs = document.querySelectorAll("#financeSubPanePaymentTypes .filter-tabs .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");
  loadFinancePaymentTypes();
}

function renderFinancePaymentTypes(items) {
  const tbody = document.getElementById("financePaymentTypesTableBody");
  const empty = document.getElementById("financePaymentTypesEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map(
      (pt) => `
    <tr>
      <td><strong>${pt.name}</strong></td>
      <td><code>${pt.code}</code></td>
      <td>
        ${pt.requires_cheque_number
          ? '<span class="badge badge-pending"><i class="fa-solid fa-money-check"></i> Cheque #</span>'
          : '<span style="color:var(--text3);font-size:12px;">No</span>'
        }
      </td>
      <td>
        ${pt.requires_bank_fee_flag
          ? '<span class="badge badge-pending"><i class="fa-solid fa-receipt"></i> Bank Fee</span>'
          : '<span style="color:var(--text3);font-size:12px;">No</span>'
        }
      </td>
      <td><span class="badge ${pt.is_active ? "badge-approved" : "badge-rejected"}">${pt.is_active ? "ACTIVE" : "INACTIVE"}</span></td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm" onclick="openEditFinancePaymentTypeModal(${pt.id})" title="Edit Payment Type">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn btn-sm ${pt.is_active ? "btn-danger" : "btn-fill"}" onclick="toggleFinancePaymentTypeActive(${pt.id}, ${pt.is_active})" title="${pt.is_active ? "Deactivate Payment Type" : "Reactivate Payment Type"}">
            <i class="fa-solid ${pt.is_active ? "fa-power-off" : "fa-check"}"></i>
          </button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");
}

function openAddFinancePaymentTypeModal() {
  document.getElementById("financePaymentTypeModalTitle").textContent = "Add Payment Type";
  document.getElementById("fFinancePaymentTypeId").value = "";
  document.getElementById("fFinancePaymentTypeName").value = "";
  document.getElementById("fFinancePaymentTypeCode").value = "";
  document.getElementById("fFinancePaymentTypeCode").disabled = false;
  document.getElementById("fFinancePaymentTypeReqCheque").checked = false;
  document.getElementById("fFinancePaymentTypeReqBankFee").checked = false;
  openModal("financePaymentTypeModal");
}

function openEditFinancePaymentTypeModal(id) {
  const pt = (FinanceState.paymentTypes || []).find((p) => p.id === id);
  if (!pt) return;

  document.getElementById("financePaymentTypeModalTitle").textContent = "Edit Payment Type";
  document.getElementById("fFinancePaymentTypeId").value = pt.id;
  document.getElementById("fFinancePaymentTypeName").value = pt.name;
  document.getElementById("fFinancePaymentTypeCode").value = pt.code;
  document.getElementById("fFinancePaymentTypeReqCheque").checked = Boolean(pt.requires_cheque_number);
  document.getElementById("fFinancePaymentTypeReqBankFee").checked = Boolean(pt.requires_bank_fee_flag);
  openModal("financePaymentTypeModal");
}

async function saveFinancePaymentType() {
  const idVal = document.getElementById("fFinancePaymentTypeId").value;
  const name = document.getElementById("fFinancePaymentTypeName").value.trim();
  const code = document.getElementById("fFinancePaymentTypeCode").value.trim().toUpperCase();
  const requires_cheque_number = document.getElementById("fFinancePaymentTypeReqCheque").checked;
  const requires_bank_fee_flag = document.getElementById("fFinancePaymentTypeReqBankFee").checked;

  if (!name) {
    toast("Please enter a name for the payment type", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!code) {
    toast("Please enter a unique machine code", "fa-solid fa-circle-exclamation");
    return;
  }

  const saveBtn = document.getElementById("financePaymentTypeSaveBtn");
  if (saveBtn) saveBtn.disabled = true;

  try {
    if (idVal) {
      await FinanceApi.updatePaymentType(Number(idVal), { name, code, requires_cheque_number, requires_bank_fee_flag });
      toast("Payment type updated successfully", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.createPaymentType({ name, code, requires_cheque_number, requires_bank_fee_flag, is_active: true });
      toast("Payment type created successfully", "fa-solid fa-circle-check");
    }
    closeModal("financePaymentTypeModal");
    await loadFinancePaymentTypes();
  } catch (err) {
    toast(err.message || "Failed to save payment type", "fa-solid fa-triangle-exclamation");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function toggleFinancePaymentTypeActive(id, currentActive) {
  const action = currentActive ? "deactivate" : "reactivate";
  if (!confirm(`Are you sure you want to ${action} this payment type? Deactivated types remain on historical records.`)) return;

  try {
    if (currentActive) {
      await FinanceApi.deletePaymentType(id);
      toast("Payment type deactivated", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.updatePaymentType(id, { is_active: true });
      toast("Payment type reactivated", "fa-solid fa-circle-check");
    }
    await loadFinancePaymentTypes();
  } catch (err) {
    toast(err.message || `Failed to ${action} payment type`, "fa-solid fa-triangle-exclamation");
  }
}

// ==========================================
// 5.3 Continuous Ledger & Petty Spend (Phase 2)
// ==========================================
let _currentLedgerAccountId = null;
let _currentLedgerDirectionFilter = "all";
let _isPettyLedgerOnly = false;

async function viewAccountLedger(accountId) {
  _currentLedgerAccountId = accountId;
  _currentLedgerDirectionFilter = "all";
  _isPettyLedgerOnly = false;

  const subNav = document.getElementById("financeAccountsSubNav");
  if (subNav) subNav.style.display = "none";

  const paneAccounts = document.getElementById("financeSubPaneAccounts");
  const paneCategories = document.getElementById("financeSubPaneCategories");
  const panePaymentTypes = document.getElementById("financeSubPanePaymentTypes");
  const paneLedger = document.getElementById("financeSubPaneLedger");

  if (paneAccounts) paneAccounts.style.display = "none";
  if (paneCategories) paneCategories.style.display = "none";
  if (panePaymentTypes) panePaymentTypes.style.display = "none";
  if (paneLedger) paneLedger.style.display = "block";

  // Populate account header details
  const acc = (FinanceState.accounts || []).find((a) => a.id === accountId);
  if (acc) {
    const nameEl = document.getElementById("financeLedgerAccountName");
    const metaEl = document.getElementById("financeLedgerAccountMeta");
    const balEl = document.getElementById("financeLedgerCurrentBalance");
    if (nameEl) nameEl.textContent = `${acc.account_name} — Ledger`;
    if (metaEl) {
      const typeLabel = (acc.account_type || "bank").toUpperCase();
      const institution = acc.bank_name || "Cash Custody";
      metaEl.textContent = `${typeLabel} · ${institution} · ${acc.currency} · ${acc.account_number}`;
    }
    if (balEl) {
      const symbol = acc.currency === "EGP" ? "E£" : "$";
      balEl.textContent = `${symbol}${Number(acc.current_balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    }
  }

  // Populate categories and payment types dropdowns in filter
  await _populateLedgerFilterDropdowns();

  // Reset filter inputs
  const dateFrom = document.getElementById("financeLedgerDateFrom");
  const dateTo = document.getElementById("financeLedgerDateTo");
  const catFilter = document.getElementById("financeLedgerCategoryFilter");
  const ptFilter = document.getElementById("financeLedgerPaymentTypeFilter");
  if (dateFrom) dateFrom.value = "";
  if (dateTo) dateTo.value = "";
  if (catFilter) catFilter.value = "";
  if (ptFilter) ptFilter.value = "";

  const dirTabs = document.querySelectorAll("#financeSubPaneLedger .filter-tabs .filter-tab");
  dirTabs.forEach((t) => t.classList.remove("active"));
  const allDirBtn = document.querySelector('#financeSubPaneLedger .filter-tabs .filter-tab[data-direction="all"]');
  if (allDirBtn) allDirBtn.classList.add("active");

  const pettyBtn = document.getElementById("btnTogglePettyLedger");
  if (pettyBtn) {
    pettyBtn.classList.remove("btn-fill");
    pettyBtn.classList.add("btn-sm");
  }

  await loadAccountTransactions();
}

function closeAccountLedger() {
  _currentLedgerAccountId = null;
  const subNav = document.getElementById("financeAccountsSubNav");
  if (subNav) subNav.style.display = "flex";

  const paneLedger = document.getElementById("financeSubPaneLedger");
  const paneAccounts = document.getElementById("financeSubPaneAccounts");
  if (paneLedger) paneLedger.style.display = "none";
  if (paneAccounts) paneAccounts.style.display = "block";

  loadFinanceAccounts();
}

async function _populateLedgerFilterDropdowns() {
  try {
    if (!FinanceState.categories || !FinanceState.categories.length) {
      FinanceState.categories = await FinanceApi.getCategories();
    }
    if (!FinanceState.paymentTypes || !FinanceState.paymentTypes.length) {
      FinanceState.paymentTypes = await FinanceApi.getPaymentTypes();
    }

    const catSel = document.getElementById("financeLedgerCategoryFilter");
    if (catSel) {
      catSel.innerHTML = '<option value="">All Categories</option>' +
        (FinanceState.categories || [])
          .map((c) => `<option value="${c.id}">${c.name}${c.is_petty ? " (Petty)" : ""}</option>`)
          .join("");
    }

    const ptSel = document.getElementById("financeLedgerPaymentTypeFilter");
    if (ptSel) {
      ptSel.innerHTML = '<option value="">All Payment Types</option>' +
        (FinanceState.paymentTypes || [])
          .map((p) => `<option value="${p.id}">${p.name} (${p.code})</option>`)
          .join("");
    }
  } catch (_) {}
}

async function loadAccountTransactions() {
  if (!_currentLedgerAccountId) return;

  const bar = document.getElementById("financeLedgerLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const params = {};
    const dateFrom = document.getElementById("financeLedgerDateFrom")?.value;
    const dateTo = document.getElementById("financeLedgerDateTo")?.value;
    const catId = document.getElementById("financeLedgerCategoryFilter")?.value;
    const ptId = document.getElementById("financeLedgerPaymentTypeFilter")?.value;

    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (catId) params.category_id = catId;
    if (ptId) params.payment_type_id = ptId;
    if (_currentLedgerDirectionFilter && _currentLedgerDirectionFilter !== "all") {
      params.direction = _currentLedgerDirectionFilter;
    }
    if (_isPettyLedgerOnly) {
      params.is_petty = true;
    }

    const items = await FinanceApi.getAccountTransactions(_currentLedgerAccountId, params);
    FinanceState.ledgerTransactions = items;
    renderAccountTransactions(items);

    // If petty rollup active, load petty summary banner
    const banner = document.getElementById("financeLedgerPettyBanner");
    if (_isPettyLedgerOnly) {
      const summary = await FinanceApi.getAccountPettySummary(_currentLedgerAccountId, {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      if (banner) banner.style.display = "block";
      const totalOutEl = document.getElementById("financeLedgerPettyTotalOut");
      const countEl = document.getElementById("financeLedgerPettyCount");
      const breakdownEl = document.getElementById("financeLedgerPettyBreakdown");

      const acc = (FinanceState.accounts || []).find((a) => a.id === _currentLedgerAccountId);
      const symbol = acc && acc.currency === "EGP" ? "E£" : "$";

      if (totalOutEl) totalOutEl.textContent = `${symbol}${Number(summary.total_out || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
      if (countEl) countEl.textContent = summary.transactions ? summary.transactions.length : 0;
      if (breakdownEl) {
        const parts = (summary.by_category || []).map((b) => `${b.category_name}: ${symbol}${Number(b.total_out).toLocaleString("en-US", { minimumFractionDigits: 2 })} (${b.count})`);
        breakdownEl.textContent = parts.length ? parts.join("  |  ") : "No recurring expenses in selected period.";
      }
    } else {
      if (banner) banner.style.display = "none";
    }

    // Update current balance in header from account fresh state
    const acc = (FinanceState.accounts || []).find((a) => a.id === _currentLedgerAccountId);
    if (acc) {
      const balEl = document.getElementById("financeLedgerCurrentBalance");
      if (balEl) {
        const symbol = acc.currency === "EGP" ? "E£" : "$";
        balEl.textContent = `${symbol}${Number(acc.current_balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
      }
    }
  } catch (err) {
    console.error("Failed to load transactions:", err);
    toast("Failed to load transactions: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterAccountLedger() {
  loadAccountTransactions();
}

function filterAccountLedgerDirection(direction, btn) {
  _currentLedgerDirectionFilter = direction;
  const tabs = document.querySelectorAll("#financeSubPaneLedger .filter-tabs .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");
  loadAccountTransactions();
}

function togglePettyLedgerView() {
  _isPettyLedgerOnly = !_isPettyLedgerOnly;
  const btn = document.getElementById("btnTogglePettyLedger");
  if (btn) {
    if (_isPettyLedgerOnly) {
      btn.classList.remove("btn-sm");
      btn.classList.add("btn-fill");
    } else {
      btn.classList.remove("btn-fill");
      btn.classList.add("btn-sm");
    }
  }
  loadAccountTransactions();
}

function renderAccountTransactions(items) {
  const tbody = document.getElementById("financeLedgerTableBody");
  const empty = document.getElementById("financeLedgerEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  const acc = (FinanceState.accounts || []).find((a) => a.id === _currentLedgerAccountId);
  const symbol = acc && acc.currency === "EGP" ? "E£" : "$";

  tbody.innerHTML = items
    .map((tx) => {
      const isIn = tx.direction === "in";
      const inDisplay = isIn ? `<strong style="color:var(--success);">${symbol}${Number(tx.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>` : "—";
      const outDisplay = !isIn ? `<strong style="color:var(--danger);">${symbol}${Number(tx.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>` : "—";

      let fxDisplay = "—";
      if (tx.fx_rate) {
        const eqCurr = tx.currency === "USD" ? "EGP" : "USD";
        const eqSym = eqCurr === "EGP" ? "E£" : "$";
        const eqVal = tx.fx_equivalent ? `${eqSym}${Number(tx.fx_equivalent).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "";
        fxDisplay = `<span style="font-size:11px;color:var(--text3);" title="Exchange Rate applied">@ ${tx.fx_rate} <br><strong>${eqVal}</strong></span>`;
      }

      const isManual = tx.source === "manual";
      const actionsHtml = isManual
        ? `<div style="display:flex;gap:4px;justify-content:center;">
             <button class="btn btn-sm" onclick="openEditFinanceTransactionModal(${tx.id})" title="Edit Transaction"><i class="fa-solid fa-pen"></i></button>
             <button class="btn btn-sm btn-danger" onclick="confirmDeleteFinanceTransaction(${tx.id})" title="Void / Delete Transaction"><i class="fa-solid fa-trash"></i></button>
           </div>`
        : `<span class="badge badge-info" title="System-generated from ${tx.source}"><i class="fa-solid fa-lock"></i> ${tx.source.replace('_', ' ').toUpperCase()}</span>`;

      return `
        <tr>
          <td><span style="font-family:monospace;font-size:12px;">${tx.date}</span></td>
          <td><span class="badge ${_categoryKindBadge(tx.category_name ? 'cost' : 'other')}">${tx.category_name || "Uncategorized"}</span></td>
          <td><span class="badge badge-pending"><code>${tx.payment_type_code || "—"}</code></span></td>
          <td><span style="font-size:12px;">${tx.reference || "—"}</span></td>
          <td><span style="font-size:12px;color:var(--text2);">${tx.description || "—"}</span></td>
          <td style="text-align:right;">${inDisplay}</td>
          <td style="text-align:right;">${outDisplay}</td>
          <td style="text-align:right;">${fxDisplay}</td>
          <td style="text-align:right;"><strong>${symbol}${Number(tx.running_balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
          <td style="text-align:center;">${actionsHtml}</td>
        </tr>
      `;
    })
    .join("");
}

async function _populateTransactionModalDropdowns() {
  try {
    if (!FinanceState.categories || !FinanceState.categories.length) {
      FinanceState.categories = await FinanceApi.getCategories();
    }
    if (!FinanceState.paymentTypes || !FinanceState.paymentTypes.length) {
      FinanceState.paymentTypes = await FinanceApi.getPaymentTypes();
    }

    const catSel = document.getElementById("fFinanceTxCategory");
    if (catSel) {
      catSel.innerHTML = '<option value="">— Select Category —</option>' +
        (FinanceState.categories || [])
          .filter((c) => c.is_active)
          .map((c) => `<option value="${c.id}">${c.name}${c.is_petty ? " [Petty]" : ""}</option>`)
          .join("");
    }

    const ptSel = document.getElementById("fFinanceTxPaymentType");
    if (ptSel) {
      ptSel.innerHTML = '<option value="">— Select Payment Type —</option>' +
        (FinanceState.paymentTypes || [])
          .filter((p) => p.is_active)
          .map((p) => `<option value="${p.id}">${p.name} (${p.code})</option>`)
          .join("");
    }
  } catch (_) {}
}

async function openAddFinanceTransactionModal() {
  if (!_currentLedgerAccountId) return;
  await _populateTransactionModalDropdowns();

  document.getElementById("financeTransactionModalTitle").textContent = "Record Transaction";
  document.getElementById("fFinanceTxId").value = "";
  document.getElementById("fFinanceTxAccountId").value = _currentLedgerAccountId;
  document.getElementById("fFinanceTxDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("fFinanceTxDirection").value = "out";
  document.getElementById("fFinanceTxAmount").value = "";
  document.getElementById("fFinanceTxFxRate").value = "";
  document.getElementById("fFinanceTxCategory").value = "";
  document.getElementById("fFinanceTxPaymentType").value = "";
  document.getElementById("fFinanceTxReference").value = "";
  document.getElementById("fFinanceTxDescription").value = "";

  openModal("financeTransactionModal");
}

async function openEditFinanceTransactionModal(txId) {
  const tx = (FinanceState.ledgerTransactions || []).find((t) => t.id === txId);
  if (!tx) return;

  await _populateTransactionModalDropdowns();

  document.getElementById("financeTransactionModalTitle").textContent = "Edit Transaction";
  document.getElementById("fFinanceTxId").value = tx.id;
  document.getElementById("fFinanceTxAccountId").value = tx.account_id;
  document.getElementById("fFinanceTxDate").value = tx.date;
  document.getElementById("fFinanceTxDirection").value = tx.direction;
  document.getElementById("fFinanceTxAmount").value = tx.amount;
  document.getElementById("fFinanceTxFxRate").value = tx.fx_rate || "";
  document.getElementById("fFinanceTxCategory").value = tx.category_id || "";
  document.getElementById("fFinanceTxPaymentType").value = tx.payment_type_id || "";
  document.getElementById("fFinanceTxReference").value = tx.reference || "";
  document.getElementById("fFinanceTxDescription").value = tx.description || "";

  openModal("financeTransactionModal");
}

async function saveFinanceTransaction() {
  const txId = document.getElementById("fFinanceTxId").value;
  const accountId = document.getElementById("fFinanceTxAccountId").value || _currentLedgerAccountId;
  const date = document.getElementById("fFinanceTxDate").value;
  const direction = document.getElementById("fFinanceTxDirection").value;
  const amount = parseFloat(document.getElementById("fFinanceTxAmount").value);
  const fx_rate_val = document.getElementById("fFinanceTxFxRate").value;
  const fx_rate = fx_rate_val ? parseFloat(fx_rate_val) : null;
  const category_id_val = document.getElementById("fFinanceTxCategory").value;
  const category_id = category_id_val ? parseInt(category_id_val, 10) : null;
  const payment_type_id_val = document.getElementById("fFinanceTxPaymentType").value;
  const payment_type_id = payment_type_id_val ? parseInt(payment_type_id_val, 10) : null;
  const reference = document.getElementById("fFinanceTxReference").value.trim();
  const description = document.getElementById("fFinanceTxDescription").value.trim();

  if (!date) {
    toast("Please select a transaction date", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!amount || amount <= 0) {
    toast("Please enter a valid amount greater than zero", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!category_id) {
    toast("Please select a transaction category", "fa-solid fa-circle-exclamation");
    return;
  }

  const saveBtn = document.getElementById("financeTxSaveBtn");
  if (saveBtn) saveBtn.disabled = true;

  try {
    if (txId) {
      const payload = { date, direction, amount, category_id, payment_type_id, reference, description, fx_rate };
      await FinanceApi.updateTransaction(Number(txId), payload);
      toast("Transaction updated successfully", "fa-solid fa-circle-check");
    } else {
      const acc = (FinanceState.accounts || []).find((a) => a.id === parseInt(accountId, 10));
      const payload = {
        date,
        direction,
        amount,
        currency: acc ? acc.currency : "USD",
        category_id,
        payment_type_id,
        reference,
        description,
        fx_rate,
      };
      await FinanceApi.createAccountTransaction(Number(accountId), payload);
      toast("Transaction recorded successfully", "fa-solid fa-circle-check");
    }

    closeModal("financeTransactionModal");
    // Reload accounts to update cached balances
    const accounts = await FinanceApi.getAccounts();
    FinanceState.accounts = accounts;
    await loadAccountTransactions();
  } catch (err) {
    toast(err.message || "Failed to save transaction", "fa-solid fa-triangle-exclamation");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function confirmDeleteFinanceTransaction(txId) {
  if (!confirm("Are you sure you want to delete this transaction? Running balances will be recalculated automatically.")) return;

  try {
    await FinanceApi.deleteTransaction(txId);
    toast("Transaction deleted successfully", "fa-solid fa-circle-check");
    const accounts = await FinanceApi.getAccounts();
    FinanceState.accounts = accounts;
    await loadAccountTransactions();
  } catch (err) {
    toast(err.message || "Failed to delete transaction", "fa-solid fa-triangle-exclamation");
  }
}

// ==========================================
// 5.4 Account Transfers (Phase 3)
// ==========================================
let _currentTransferTypeFilter = "all";

async function loadFinanceTransfers() {
  const bar = document.getElementById("financeTransfersLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    // Populate account filter dropdown if empty
    const accFilter = document.getElementById("financeTransferAccountFilter");
    if (accFilter && accFilter.options.length <= 1) {
      if (!FinanceState.accounts || !FinanceState.accounts.length) {
        FinanceState.accounts = await FinanceApi.getAccounts();
      }
      accFilter.innerHTML = '<option value="">All Accounts</option>' +
        (FinanceState.accounts || [])
          .map((a) => `<option value="${a.id}">${a.account_name} (${a.currency})</option>`)
          .join("");
    }

    const selectedAcc = accFilter ? accFilter.value : "";
    const params = {};
    if (selectedAcc) params.account_id = selectedAcc;
    if (_currentTransferTypeFilter && _currentTransferTypeFilter !== "all") {
      params.transfer_type = _currentTransferTypeFilter;
    }

    const items = await FinanceApi.getTransfers(params);
    FinanceState.transfers = items;
    renderFinanceTransfers(items);
  } catch (err) {
    console.error("Failed to load transfers:", err);
    toast("Failed to load transfers: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterFinanceTransfers() {
  loadFinanceTransfers();
}

function filterFinanceTransferType(type, btn) {
  _currentTransferTypeFilter = type;
  const tabs = document.querySelectorAll("#financeTransferTypeTabs .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");
  loadFinanceTransfers();
}

function renderFinanceTransfers(items) {
  const tbody = document.getElementById("financeTransfersTableBody");
  const empty = document.getElementById("financeTransfersEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map((t) => {
      let typeBadge = "";
      if (t.transfer_type === "same_bank_fx") {
        typeBadge = `<span class="badge" style="background:#e0e7ff; color:#3730a3; font-weight:600;"><i class="fa-solid fa-arrow-right-arrow-left"></i> FX Conversion</span>`;
      } else if (t.transfer_type === "external_linked") {
        typeBadge = `<span class="badge" style="background:#fef3c7; color:#92400e; font-weight:600;"><i class="fa-solid fa-globe"></i> External Linked</span>`;
      } else {
        typeBadge = `<span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:600;"><i class="fa-solid fa-arrows-split-up-and-left"></i> Internal Move</span>`;
      }

      const fromSymbol = t.from_currency === "EGP" ? "E£" : "$";
      const toSymbol = t.to_currency === "EGP" ? "E£" : "$";

      let legsStatus = "";
      if (t.outflow_transaction_id && t.inflow_transaction_id) {
        legsStatus = `<span class="badge badge-approved" title="Dual continuous ledger legs created"><i class="fa-solid fa-check-double"></i> Dual Legs</span>`;
      } else if (t.outflow_transaction_id) {
        legsStatus = `<span class="badge badge-pending" title="Outflow leg confirmed"><i class="fa-solid fa-arrow-up-right-from-square"></i> Outflow Leg</span>`;
      } else if (t.inflow_transaction_id) {
        legsStatus = `<span class="badge badge-pending" title="Inflow leg confirmed"><i class="fa-solid fa-arrow-down-left-and-up-right-to-center"></i> Inflow Leg</span>`;
      } else {
        legsStatus = `<span class="badge badge-rejected">Pending</span>`;
      }

      const fxDisplay = t.fx_rate ? `<code>${t.fx_rate}</code>` : `<span style="color:var(--text3);">1.0</span>`;

      return `
        <tr>
          <td><span style="font-family:monospace;font-size:12px;">${t.date}</span></td>
          <td>${typeBadge}</td>
          <td><strong>${t.from_account_name || '<span style="color:var(--text3); font-style:italic;">External</span>'}</strong></td>
          <td style="text-align:right;"><span style="color:var(--danger); font-weight:600;">-${fromSymbol}${Number(t.from_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></td>
          <td><strong>${t.to_account_name || '<span style="color:var(--text3); font-style:italic;">External</span>'}</strong></td>
          <td style="text-align:right;"><span style="color:var(--success); font-weight:600;">+${toSymbol}${Number(t.to_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></td>
          <td style="text-align:right;">${fxDisplay}</td>
          <td>
            ${t.exchange_reference ? `<strong style="font-size:12px; color:var(--primary);">${t.exchange_reference}</strong><br>` : ""}
            <span style="font-size:12px; color:var(--text2);">${t.note || "—"}</span>
          </td>
          <td style="text-align:center;">${legsStatus}</td>
        </tr>
      `;
    })
    .join("");
}

async function openRecordFinanceTransferModal() {
  if (!FinanceState.accounts || !FinanceState.accounts.length) {
    FinanceState.accounts = await FinanceApi.getAccounts({ is_active: true });
  }

  const activeAccounts = (FinanceState.accounts || []).filter((a) => a.is_active !== false);

  const fromSel = document.getElementById("transferFromAccount");
  const toSel = document.getElementById("transferToAccount");

  const accountOptions = '<option value="">-- Select Account --</option>' +
    activeAccounts
      .map((a) => `<option value="${a.id}" data-currency="${a.currency}" data-balance="${a.current_balance}">${a.account_name} (${a.currency} • ${a.currency === "EGP" ? "E£" : "$"}${Number(a.current_balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })})</option>`)
      .join("");

  if (fromSel) fromSel.innerHTML = accountOptions;
  if (toSel) toSel.innerHTML = accountOptions;

  // Defaults
  document.getElementById("transferDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("transferFromAmount").value = "";
  document.getElementById("transferToAmount").value = "";
  document.getElementById("transferFxRate").value = "";
  document.getElementById("transferExchangeRef").value = "";
  document.getElementById("transferNote").value = "";
  document.getElementById("transferFromBalanceHint").textContent = "";
  document.getElementById("transferToBalanceHint").textContent = "";

  // Reset to Internal Move
  const internalRadio = document.querySelector('input[name="transferTypeRadio"][value="internal"]');
  if (internalRadio) internalRadio.checked = true;
  onTransferTypeChanged("internal");

  openModal("financeTransferModal");
}

function closeFinanceTransferModal() {
  closeModal("financeTransferModal");
}

function onTransferTypeChanged(type) {
  const fxGroup = document.getElementById("transferFxGroup");
  const extGroup = document.getElementById("transferExternalGroup");

  if (type === "internal") {
    if (fxGroup) fxGroup.style.display = "none";
    if (extGroup) extGroup.style.display = "none";
    recalcTransferAmounts("from");
  } else if (type === "same_bank_fx") {
    if (fxGroup) fxGroup.style.display = "block";
    if (extGroup) extGroup.style.display = "none";
  } else if (type === "external_linked") {
    if (fxGroup) fxGroup.style.display = "block";
    if (extGroup) extGroup.style.display = "block";
  }
}

function onTransferAccountSelected(side) {
  const fromSel = document.getElementById("transferFromAccount");
  const toSel = document.getElementById("transferToAccount");

  const fromOpt = fromSel.selectedOptions[0];
  const toOpt = toSel.selectedOptions[0];

  const fromCur = fromOpt ? fromOpt.getAttribute("data-currency") : "USD";
  const toCur = toOpt ? toOpt.getAttribute("data-currency") : "USD";

  const fromBal = fromOpt ? fromOpt.getAttribute("data-balance") : null;
  const toBal = toOpt ? toOpt.getAttribute("data-balance") : null;

  const fromBadge = document.getElementById("transferFromCurrencyBadge");
  const toBadge = document.getElementById("transferToCurrencyBadge");
  if (fromBadge && fromCur) fromBadge.textContent = fromCur;
  if (toBadge && toCur) toBadge.textContent = toCur;

  const fromHint = document.getElementById("transferFromBalanceHint");
  const toHint = document.getElementById("transferToBalanceHint");
  if (fromHint && fromBal !== null) fromHint.textContent = `Avail: ${fromCur === "EGP" ? "E£" : "$"}${Number(fromBal).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (toHint && toBal !== null) toHint.textContent = `Current: ${toCur === "EGP" ? "E£" : "$"}${Number(toBal).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  // Auto-switch transfer type if both accounts selected
  if (fromSel.value && toSel.value) {
    const isSameCur = fromCur === toCur;
    const currentType = document.querySelector('input[name="transferTypeRadio"]:checked')?.value;

    if (currentType !== "external_linked") {
      if (!isSameCur) {
        const fxRadio = document.querySelector('input[name="transferTypeRadio"][value="same_bank_fx"]');
        if (fxRadio) fxRadio.checked = true;
        onTransferTypeChanged("same_bank_fx");
      } else {
        const internalRadio = document.querySelector('input[name="transferTypeRadio"][value="internal"]');
        if (internalRadio) internalRadio.checked = true;
        onTransferTypeChanged("internal");
      }
    }
  }

  recalcTransferAmounts("from");
}

function recalcTransferAmounts(source) {
  const type = document.querySelector('input[name="transferTypeRadio"]:checked')?.value || "internal";
  const fromAmtInput = document.getElementById("transferFromAmount");
  const toAmtInput = document.getElementById("transferToAmount");
  const fxRateInput = document.getElementById("transferFxRate");

  const fromAmt = parseFloat(fromAmtInput.value) || 0;
  const toAmt = parseFloat(toAmtInput.value) || 0;
  const fxRate = parseFloat(fxRateInput.value) || 0;

  if (type === "internal") {
    if (source === "from") {
      toAmtInput.value = fromAmt > 0 ? fromAmt.toFixed(2) : "";
    } else if (source === "to") {
      fromAmtInput.value = toAmt > 0 ? toAmt.toFixed(2) : "";
    }
    return;
  }

  // FX or External
  if (source === "from" || source === "fx") {
    if (fromAmt > 0 && fxRate > 0) {
      toAmtInput.value = (fromAmt * fxRate).toFixed(2);
    }
  } else if (source === "to") {
    if (fromAmt > 0 && toAmt > 0) {
      fxRateInput.value = (toAmt / fromAmt).toFixed(4);
    }
  }
}

async function saveFinanceTransfer() {
  const date = document.getElementById("transferDate").value;
  const type = document.querySelector('input[name="transferTypeRadio"]:checked')?.value || "internal";
  const fromAccountIdVal = document.getElementById("transferFromAccount").value;
  const toAccountIdVal = document.getElementById("transferToAccount").value;
  const fromAmount = parseFloat(document.getElementById("transferFromAmount").value);
  const toAmountVal = document.getElementById("transferToAmount").value;
  const toAmount = toAmountVal ? parseFloat(toAmountVal) : fromAmount;
  const fxRateVal = document.getElementById("transferFxRate").value;
  const fxRate = fxRateVal ? parseFloat(fxRateVal) : null;
  const exchangeRef = document.getElementById("transferExchangeRef").value.trim();
  const note = document.getElementById("transferNote").value.trim();
  const confirmedLeg = document.getElementById("transferConfirmedLeg")?.value || "both";

  if (!date) {
    toast("Please enter a transfer date", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!fromAmount || fromAmount <= 0) {
    toast("Please enter a valid outflow amount greater than 0", "fa-solid fa-circle-exclamation");
    return;
  }

  if (type === "internal" || type === "same_bank_fx") {
    if (!fromAccountIdVal || !toAccountIdVal) {
      toast("Please select both source and target bank accounts", "fa-solid fa-circle-exclamation");
      return;
    }
    if (fromAccountIdVal === toAccountIdVal) {
      toast("Source and target bank accounts cannot be the same", "fa-solid fa-circle-exclamation");
      return;
    }
  } else if (type === "external_linked") {
    if (!fromAccountIdVal && !toAccountIdVal) {
      toast("Please select at least one owned bank account", "fa-solid fa-circle-exclamation");
      return;
    }
  }

  if (type === "same_bank_fx" && (!fxRate || fxRate <= 0)) {
    toast("Please provide an exchange rate for FX transfer", "fa-solid fa-circle-exclamation");
    return;
  }

  const btn = document.getElementById("btnSaveFinanceTransfer");
  if (btn) btn.disabled = true;

  const payload = {
    date,
    transfer_type: type,
    from_account_id: fromAccountIdVal ? parseInt(fromAccountIdVal, 10) : null,
    to_account_id: toAccountIdVal ? parseInt(toAccountIdVal, 10) : null,
    from_amount: fromAmount,
    to_amount: toAmount,
    fx_rate: fxRate,
    exchange_reference: exchangeRef || null,
    confirmed_leg: type === "external_linked" ? confirmedLeg : "both",
    note,
  };

  try {
    await FinanceApi.createTransfer(payload);
    toast("Transfer posted successfully! Continuous ledger legs updated.", "fa-solid fa-circle-check");
    closeFinanceTransferModal();

    // Reload accounts to update balances across all views
    FinanceState.accounts = await FinanceApi.getAccounts();
    if (_currentFinanceSubTab === "transfers") {
      await loadFinanceTransfers();
    } else if (_currentFinanceSubTab === "accounts") {
      renderFinanceAccounts(FinanceState.accounts);
    }
  } catch (err) {
    console.error("Failed to save transfer:", err);
    toast("Failed to save transfer: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ==========================================
// 5.5 Cheque Register & Direct Teller Withdrawals (Phase 5)
// ==========================================
let _currentChequeStatusFilter = "";

async function loadFinanceCheques() {
  const bar = document.getElementById("financeChequesLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const fyFilter = document.getElementById("financeChequeFiscalYearFilter");
    const fy = fyFilter ? fyFilter.value : "";
    const searchInput = document.getElementById("financeChequeSearch");
    const search = searchInput ? searchInput.value.trim() : "";

    const params = {};
    if (fy) params.fiscal_year = fy;
    if (_currentChequeStatusFilter) params.status = _currentChequeStatusFilter;
    if (search) params.search = search;

    const items = await FinanceApi.getCheques(params);
    FinanceState.cheques = items;
    renderFinanceCheques(items);
  } catch (err) {
    console.error("Failed to load cheques:", err);
    toast("Failed to load cheques: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterFinanceCheques() {
  loadFinanceCheques();
}

function filterFinanceChequeStatus(status, btn) {
  _currentChequeStatusFilter = status;
  const tabs = document.querySelectorAll("#financeChequeStatusTabs .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) {
    btn.classList.add("active");
  } else {
    const el = document.querySelector(`#financeChequeStatusTabs [data-status="${status}"]`);
    if (el) el.classList.add("active");
  }
  loadFinanceCheques();
}

function renderFinanceCheques(items) {
  const tbody = document.getElementById("financeChequesTableBody");
  const empty = document.getElementById("financeChequesEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map((c) => {
      let purposeBadge = "";
      if (c.purpose_type === "cash_withdrawal") {
        purposeBadge = `<span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:600;"><i class="fa-solid fa-hand-holding-dollar"></i> Cash Drawer</span>`;
      } else if (c.purpose_type === "vendor_payment") {
        purposeBadge = `<span class="badge" style="background:#fef3c7; color:#92400e; font-weight:600;"><i class="fa-solid fa-file-invoice-dollar"></i> Vendor Bill</span>`;
      } else {
        purposeBadge = `<span class="badge badge-pending">General</span>`;
      }

      let statusBadge = "";
      if (c.status === "cleared") {
        statusBadge = `<span class="badge badge-approved"><i class="fa-solid fa-circle-check"></i> Cleared</span>`;
      } else if (c.status === "bounced") {
        statusBadge = `<span class="badge badge-rejected"><i class="fa-solid fa-triangle-exclamation"></i> Bounced</span>`;
      } else if (c.status === "voided") {
        statusBadge = `<span class="badge" style="background:var(--bg3); color:var(--text3);"><i class="fa-solid fa-ban"></i> Voided</span>`;
      } else {
        statusBadge = `<span class="badge badge-pending"><i class="fa-solid fa-clock"></i> Issued</span>`;
      }

      const sym = c.currency === "EGP" ? "E£" : "$";
      const amtStr = `-${sym}${Number(c.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

      let actionsHtml = "";
      if (c.status === "issued") {
        actionsHtml = `
          <div style="display:flex;gap:4px;justify-content:center;">
            <button class="btn btn-sm" onclick="updateChequeStatusAction(${c.id}, 'cleared')" title="Mark Cleared" style="color:var(--success);"><i class="fa-solid fa-check"></i></button>
            <button class="btn btn-sm btn-danger" onclick="updateChequeStatusAction(${c.id}, 'bounced')" title="Mark Bounced"><i class="fa-solid fa-triangle-exclamation"></i></button>
            <button class="btn btn-sm" onclick="updateChequeStatusAction(${c.id}, 'voided')" title="Void Cheque"><i class="fa-solid fa-ban"></i></button>
          </div>
        `;
      } else if (c.status === "cleared") {
        actionsHtml = `
          <div style="display:flex;gap:4px;justify-content:center;">
            <button class="btn btn-sm" onclick="updateChequeStatusAction(${c.id}, 'voided')" title="Void Cleared Cheque"><i class="fa-solid fa-ban"></i></button>
          </div>
        `;
      } else {
        actionsHtml = `<span style="color:var(--text3); font-size:11px;">No actions</span>`;
      }

      return `
        <tr>
          <td><strong style="font-family:monospace;font-size:13px;"><i class="fa-solid fa-money-check"></i> ${c.cheque_number}</strong></td>
          <td><span style="font-family:monospace;font-size:12px;">${c.issue_date}</span></td>
          <td><strong>${c.account_name || '—'}</strong></td>
          <td><strong>${c.payee}</strong></td>
          <td>${purposeBadge}</td>
          <td style="text-align:right;"><span style="color:var(--danger); font-weight:600;">${amtStr}</span></td>
          <td style="text-align:center;">${statusBadge}</td>
          <td><span style="font-family:monospace;font-size:12px;">${c.clear_date || '—'}</span></td>
          <td style="text-align:center;">${actionsHtml}</td>
        </tr>
      `;
    })
    .join("");
}

async function updateChequeStatusAction(chequeId, newStatus) {
  let clearDate = null;
  if (newStatus === "cleared") {
    clearDate = new Date().toISOString().split("T")[0];
  } else if (newStatus === "bounced") {
    if (!confirm("Are you sure you want to mark this cheque as Bounced? Any linked continuous ledger transactions will be automatically reversed and balances restored.")) {
      return;
    }
  } else if (newStatus === "voided") {
    if (!confirm("Are you sure you want to void this cheque? Any linked continuous ledger transactions will be automatically reversed and balances restored.")) {
      return;
    }
  }

  try {
    const payload = { status: newStatus };
    if (clearDate) payload.clear_date = clearDate;

    await FinanceApi.updateChequeStatus(chequeId, payload);
    toast(`Cheque status updated to ${newStatus.toUpperCase()}`, "fa-solid fa-circle-check");

    // Reload accounts and cheques to synchronize balances everywhere
    FinanceState.accounts = await FinanceApi.getAccounts();
    await loadFinanceCheques();
    if (_currentFinanceSubTab === "accounts") {
      renderFinanceAccounts(FinanceState.accounts);
    }
  } catch (err) {
    console.error("Failed to update cheque status:", err);
    toast("Failed to update cheque: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  }
}

async function openIssueChequeModal() {
  if (!FinanceState.accounts || !FinanceState.accounts.length) {
    FinanceState.accounts = await FinanceApi.getAccounts();
  }

  const bankSel = document.getElementById("chequeAccountId");
  if (bankSel) {
    const banks = (FinanceState.accounts || []).filter((a) => (a.account_type === "bank" || !a.account_type || a.account_type !== "cash") && a.is_active);
    bankSel.innerHTML = '<option value="">— Select bank account —</option>' +
      banks.map((a) => `<option value="${a.id}" data-currency="${a.currency}">${a.account_name} (${a.currency}) - Bal: ${a.currency === 'EGP' ? 'E£' : '$'}${Number(a.current_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</option>`).join("");
  }

  const cashSel = document.getElementById("chequeDestinationCashAccountId");
  if (cashSel) {
    let cashAccounts = (FinanceState.accounts || []).filter((a) => a.account_type === "cash" && a.is_active);
    if (!cashAccounts.length) cashAccounts = (FinanceState.accounts || []).filter((a) => a.is_active);
    cashSel.innerHTML = '<option value="">— Select cash account to fund —</option>' +
      cashAccounts.map((a) => `<option value="${a.id}">${a.account_name} (${a.currency})</option>`).join("");
  }

  const billSel = document.getElementById("chequeLinkedBillId");
  if (billSel) {
    try {
      const bills = await FinanceApi.getBills({ status: "posted" });
      billSel.innerHTML = '<option value="">— Select unpaid bill (optional) —</option>' +
        (bills || []).map((b) => `<option value="${b.id}">${b.bill_number} - ${b.vendor_name || 'Vendor'} ($${Number(b.total || 0).toFixed(2)})</option>`).join("");
    } catch (_) {
      billSel.innerHTML = '<option value="">— Select unpaid bill (optional) —</option>';
    }
  }

  document.getElementById("chequeNumber").value = "";
  document.getElementById("chequeIssueDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("chequeAmount").value = "";
  document.getElementById("chequeCurrency").value = "EGP";
  document.getElementById("chequePayee").value = "";
  document.getElementById("chequePurposeType").value = "other";
  document.getElementById("chequeNotes").value = "";

  const destGroup = document.getElementById("chequeDestCashGroup");
  if (destGroup) destGroup.style.display = "none";
  const billGroup = document.getElementById("chequeLinkedBillGroup");
  if (billGroup) billGroup.style.display = "none";

  openModal("financeChequeModal");
}

function closeIssueChequeModal() {
  closeModal("financeChequeModal");
}

function onChequeAccountSelected() {
  const sel = document.getElementById("chequeAccountId");
  const opt = sel ? sel.selectedOptions[0] : null;
  if (opt && opt.getAttribute("data-currency")) {
    document.getElementById("chequeCurrency").value = opt.getAttribute("data-currency");
  }
}

function onChequePurposeChanged() {
  const purpose = document.getElementById("chequePurposeType").value;
  const destGroup = document.getElementById("chequeDestCashGroup");
  const billGroup = document.getElementById("chequeLinkedBillGroup");

  if (destGroup) destGroup.style.display = purpose === "cash_withdrawal" ? "block" : "none";
  if (billGroup) billGroup.style.display = purpose === "vendor_payment" ? "block" : "none";
}

async function saveIssueCheque() {
  const accountIdVal = document.getElementById("chequeAccountId").value;
  const chequeNumber = document.getElementById("chequeNumber").value.trim();
  const issueDate = document.getElementById("chequeIssueDate").value;
  const amountVal = document.getElementById("chequeAmount").value;
  const amount = parseFloat(amountVal);
  const currency = document.getElementById("chequeCurrency").value;
  const payee = document.getElementById("chequePayee").value.trim();
  const purposeType = document.getElementById("chequePurposeType").value;
  const destCashVal = document.getElementById("chequeDestinationCashAccountId").value;
  const linkedBillVal = document.getElementById("chequeLinkedBillId").value;
  const notes = document.getElementById("chequeNotes").value.trim();

  if (!accountIdVal) {
    toast("Please select a source bank account", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!chequeNumber) {
    toast("Please enter a cheque number", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!issueDate) {
    toast("Please select an issue date", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!amount || amount <= 0) {
    toast("Please enter a valid cheque amount greater than 0", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!payee) {
    toast("Please enter the payee name", "fa-solid fa-circle-exclamation");
    return;
  }
  if (purposeType === "cash_withdrawal" && !destCashVal) {
    toast("Please select a destination cash drawer account to fund", "fa-solid fa-circle-exclamation");
    return;
  }

  const btn = document.getElementById("chequeModalSaveBtn");
  if (btn) btn.disabled = true;

  const payload = {
    account_id: parseInt(accountIdVal, 10),
    cheque_number: chequeNumber,
    issue_date: issueDate,
    amount,
    currency,
    payee,
    purpose_type: purposeType,
    destination_cash_account_id: destCashVal ? parseInt(destCashVal, 10) : null,
    linked_bill_id: linkedBillVal ? parseInt(linkedBillVal, 10) : null,
    notes: notes || null,
  };

  try {
    await FinanceApi.createCheque(payload);
    toast("Cheque issued successfully! Running balances updated.", "fa-solid fa-circle-check");
    closeIssueChequeModal();

    FinanceState.accounts = await FinanceApi.getAccounts();
    await loadFinanceCheques();
    if (_currentFinanceSubTab === "accounts") {
      renderFinanceAccounts(FinanceState.accounts);
    }
  } catch (err) {
    console.error("Failed to issue cheque:", err);
    toast("Failed to issue cheque: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function openWithdrawCashModal() {
  if (!FinanceState.accounts || !FinanceState.accounts.length) {
    FinanceState.accounts = await FinanceApi.getAccounts();
  }

  const bankSel = document.getElementById("withdrawSourceAccountId");
  if (bankSel) {
    const banks = (FinanceState.accounts || []).filter((a) => (a.account_type === "bank" || !a.account_type || a.account_type !== "cash") && a.is_active);
    bankSel.innerHTML = '<option value="">— Select bank —</option>' +
      banks.map((a) => `<option value="${a.id}" data-currency="${a.currency}">${a.account_name} (${a.currency}) - Bal: ${a.currency === 'EGP' ? 'E£' : '$'}${Number(a.current_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</option>`).join("");
  }

  const cashSel = document.getElementById("withdrawDestCashAccountId");
  if (cashSel) {
    let cashAccounts = (FinanceState.accounts || []).filter((a) => a.account_type === "cash" && a.is_active);
    if (!cashAccounts.length) cashAccounts = (FinanceState.accounts || []).filter((a) => a.is_active);
    cashSel.innerHTML = '<option value="">— Select cash drawer —</option>' +
      cashAccounts.map((a) => `<option value="${a.id}" data-currency="${a.currency}">${a.account_name} (${a.currency})</option>`).join("");
  }

  document.getElementById("withdrawAmount").value = "";
  document.getElementById("withdrawDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("withdrawReference").value = "";
  document.getElementById("withdrawDescription").value = "Counter teller cash withdrawal";
  document.getElementById("withdrawCurrency").value = "EGP";

  openModal("financeWithdrawCashModal");
}

function closeWithdrawCashModal() {
  closeModal("financeWithdrawCashModal");
}

function onWithdrawSourceAccountSelected() {
  const sel = document.getElementById("withdrawSourceAccountId");
  const opt = sel ? sel.selectedOptions[0] : null;
  if (opt && opt.getAttribute("data-currency")) {
    document.getElementById("withdrawCurrency").value = opt.getAttribute("data-currency");
  }
}

async function saveWithdrawCash() {
  const sourceAccountIdVal = document.getElementById("withdrawSourceAccountId").value;
  const destCashAccountIdVal = document.getElementById("withdrawDestCashAccountId").value;
  const amountVal = document.getElementById("withdrawAmount").value;
  const amount = parseFloat(amountVal);
  const date = document.getElementById("withdrawDate").value;
  const currency = document.getElementById("withdrawCurrency").value;
  const reference = document.getElementById("withdrawReference").value.trim();
  const description = document.getElementById("withdrawDescription").value.trim();

  if (!sourceAccountIdVal) {
    toast("Please select a source bank account", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!destCashAccountIdVal) {
    toast("Please select a destination cash drawer", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!amount || amount <= 0) {
    toast("Please enter a valid withdrawal amount greater than 0", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!date) {
    toast("Please enter a withdrawal date", "fa-solid fa-circle-exclamation");
    return;
  }

  const btn = document.getElementById("withdrawCashSaveBtn");
  if (btn) btn.disabled = true;

  if (!FinanceState.paymentTypes || !FinanceState.paymentTypes.length) {
    try {
      FinanceState.paymentTypes = await FinanceApi.getPaymentTypes();
    } catch (_) {}
  }
  const pt = (FinanceState.paymentTypes || []).find((p) => p.code === "CASHWITHDRAW");

  const payload = {
    date,
    amount,
    direction: "out",
    currency,
    payment_type_id: pt ? pt.id : null,
    destination_cash_account_id: parseInt(destCashAccountIdVal, 10),
    reference: reference || null,
    description: description || "Teller cash withdrawal for cash replenishment",
  };

  try {
    if (typeof FinanceApi.createAccountTransaction === "function") {
      await FinanceApi.createAccountTransaction(sourceAccountIdVal, payload);
    } else {
      await FinanceApi.createTransaction(sourceAccountIdVal, payload);
    }
    toast("Direct teller withdrawal recorded! Cash drawer credited.", "fa-solid fa-circle-check");
    closeWithdrawCashModal();

    FinanceState.accounts = await FinanceApi.getAccounts();
    if (_currentFinanceSubTab === "accounts") {
      renderFinanceAccounts(FinanceState.accounts);
    } else if (_currentFinanceSubTab === "cheques") {
      await loadFinanceCheques();
    }
  } catch (err) {
    console.error("Failed to record teller withdrawal:", err);
    toast("Failed to record withdrawal: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Global exposures for Cheques module
window.switchFinanceAccountsSubTab = switchFinanceAccountsSubTab;
window.loadFinanceCheques = loadFinanceCheques;
window.filterFinanceCheques = filterFinanceCheques;
window.filterFinanceChequeStatus = filterFinanceChequeStatus;
window.updateChequeStatusAction = updateChequeStatusAction;
window.openIssueChequeModal = openIssueChequeModal;
window.closeIssueChequeModal = closeIssueChequeModal;
window.onChequeAccountSelected = onChequeAccountSelected;
window.onChequePurposeChanged = onChequePurposeChanged;
window.saveIssueCheque = saveIssueCheque;
window.openWithdrawCashModal = openWithdrawCashModal;
window.closeWithdrawCashModal = closeWithdrawCashModal;
window.onWithdrawSourceAccountSelected = onWithdrawSourceAccountSelected;
window.saveWithdrawCash = saveWithdrawCash;

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
// 7. Subscriptions & Charges (Phase 6)
// ==========================================
let _subscriptionsFilterStatus = "active";
let _subscriptionsSearchQuery = "";
let _currentHistorySubId = null;

async function loadFinanceSubscriptions() {
  const bar = document.getElementById("financeSubscriptionsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const subs = await FinanceApi.getSubscriptions();
    FinanceState.subscriptions = subs || [];
    renderFinanceSubscriptionsTable();
  } catch (err) {
    console.error("Failed to load finance subscriptions:", err);
    showToast("Error loading subscriptions: " + (err.message || err), "error");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterFinanceSubscriptions(query) {
  _subscriptionsSearchQuery = (query || "").toLowerCase();
  renderFinanceSubscriptionsTable();
}

function filterFinanceSubscriptionsStatus(status, btn) {
  _subscriptionsFilterStatus = status;
  if (btn && btn.parentElement) {
    btn.parentElement.querySelectorAll(".filter-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  }
  renderFinanceSubscriptionsTable();
}

function renderFinanceSubscriptionsTable() {
  const tbody = document.getElementById("financeSubscriptionsTableBody");
  const empty = document.getElementById("financeSubscriptionsEmpty");
  if (!tbody) return;

  let items = [...(FinanceState.subscriptions || [])];

  if (_subscriptionsFilterStatus === "active") {
    items = items.filter((s) => s.is_active);
  } else if (_subscriptionsFilterStatus === "inactive") {
    items = items.filter((s) => !s.is_active);
  }

  if (_subscriptionsSearchQuery) {
    items = items.filter(
      (s) =>
        (s.name || "").toLowerCase().includes(_subscriptionsSearchQuery) ||
        (s.vendor_name || "").toLowerCase().includes(_subscriptionsSearchQuery)
    );
  }

  if (!items.length) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map((s) => {
      const currSymbol = s.currency === "EGP" ? "E£" : s.currency === "EUR" ? "€" : "$";
      const amountStr = `${currSymbol}${Number(s.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
      const lastChargeInfo = s.last_charge_amount
        ? `<div style="font-size:11.5px; color:var(--text3); margin-top:3px;"><i class="fa-solid fa-receipt"></i> Last: ${currSymbol}${Number(s.last_charge_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} (${s.last_charge_date || "--"})</div>`
        : "";

      return `
      <tr>
        <td>
          <div style="font-weight:700; font-size:13.5px;">${s.name}</div>
        </td>
        <td>${s.vendor_name || '<span style="opacity:0.5;">--</span>'}</td>
        <td><strong>${amountStr}</strong></td>
        <td><span class="badge badge-grey">${(s.billing_cycle || "monthly").toUpperCase()}</span></td>
        <td>${s.next_renewal_date || '<span style="opacity:0.5;">--</span>'}</td>
        <td>
          ${s.auto_generate_bill
            ? '<span class="badge badge-approved" style="font-size:11px;"><i class="fa-solid fa-bolt"></i> Auto-Bill</span>'
            : '<span class="badge badge-grey" style="font-size:11px;">Manual</span>'}
        </td>
        <td>
          <div>${s.charges_count || 0} charge(s)</div>
          ${lastChargeInfo}
        </td>
        <td>
          ${s.is_active
            ? '<span class="badge badge-approved">ACTIVE</span>'
            : '<span class="badge badge-grey">INACTIVE</span>'}
        </td>
        <td>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button class="btn btn-sm btn-fill btn-log-charge" onclick="openLogSubscriptionChargeModal(${s.id})" title="Log Actual Charge"><i class="fa-solid fa-credit-card"></i> Log Charge</button>
            <button class="btn btn-sm btn-sub-history" onclick="openSubscriptionHistoryModal(${s.id})" title="View Charge History"><i class="fa-solid fa-clock-rotate-left"></i> History</button>
            <button class="btn btn-sm btn-outline" onclick="openEditSubscriptionModal(${s.id})" title="Edit Subscription"><i class="fa-solid fa-pen"></i></button>
          </div>
        </td>
      </tr>
      `;
    })
    .join("");
}

async function _populateSubscriptionVendorDropdown(selectedId = null) {
  const sel = document.getElementById("subVendorId");
  if (!sel) return;
  try {
    const vendors = await FinanceApi.getVendors({ is_active: true });
    sel.innerHTML = '<option value="">— Select vendor —</option>' +
      (vendors || []).map((v) => `<option value="${v.id}">${v.name} (${v.category || "General"})</option>`).join("");
    if (selectedId) sel.value = String(selectedId);
  } catch (_) {}
}

async function openAddSubscriptionModal() {
  document.getElementById("subId").value = "";
  document.getElementById("subModalTitle").textContent = "New Subscription";
  document.getElementById("subName").value = "";
  document.getElementById("subAmount").value = "";
  document.getElementById("subCurrency").value = "USD";
  document.getElementById("subBillingCycle").value = "monthly";
  
  const today = new Date();
  today.setMonth(today.getMonth() + 1);
  document.getElementById("subNextRenewal").value = today.toISOString().split("T")[0];
  document.getElementById("subAutoBill").checked = true;

  await _populateSubscriptionVendorDropdown();
  openModal("subscriptionModal");
}

async function openEditSubscriptionModal(id) {
  const s = (FinanceState.subscriptions || []).find((sub) => sub.id === parseInt(id, 10));
  if (!s) return;

  document.getElementById("subId").value = s.id;
  document.getElementById("subModalTitle").textContent = "Edit Subscription: " + s.name;
  document.getElementById("subName").value = s.name;
  document.getElementById("subAmount").value = s.amount;
  document.getElementById("subCurrency").value = s.currency || "USD";
  document.getElementById("subBillingCycle").value = s.billing_cycle || "monthly";
  document.getElementById("subNextRenewal").value = s.next_renewal_date || "";
  document.getElementById("subAutoBill").checked = s.auto_generate_bill !== false;

  await _populateSubscriptionVendorDropdown(s.vendor_id);
  openModal("subscriptionModal");
}

async function saveSubscription() {
  const id = document.getElementById("subId").value;
  const name = document.getElementById("subName").value.trim();
  const vendorId = document.getElementById("subVendorId").value;
  const amount = parseFloat(document.getElementById("subAmount").value);
  const currency = document.getElementById("subCurrency").value;
  const billingCycle = document.getElementById("subBillingCycle").value;
  const nextRenewal = document.getElementById("subNextRenewal").value;
  const autoBill = document.getElementById("subAutoBill").checked;

  if (!name) { showToast("Service name is required", "error"); return; }
  if (!vendorId) { showToast("Please select a vendor", "error"); return; }
  if (isNaN(amount) || amount < 0) { showToast("Enter a valid amount", "error"); return; }
  if (!nextRenewal) { showToast("Next renewal date is required", "error"); return; }

  const payload = {
    vendor_id: parseInt(vendorId, 10),
    name,
    amount,
    currency,
    billing_cycle: billingCycle,
    next_renewal_date: nextRenewal,
    auto_generate_bill: autoBill,
  };

  const btn = document.getElementById("btnSaveSubscription");
  if (btn) btn.disabled = true;

  try {
    if (id) {
      await FinanceApi.updateSubscription(id, payload);
      showToast("Subscription updated successfully", "success");
    } else {
      await FinanceApi.createSubscription(payload);
      showToast("Subscription created successfully", "success");
    }
    closeModal("subscriptionModal");
    await loadFinanceSubscriptions();
  } catch (err) {
    showToast("Error saving subscription: " + (err.message || err), "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function openLogSubscriptionChargeModal(subId) {
  const sub = (FinanceState.subscriptions || []).find((s) => s.id === parseInt(subId, 10));
  if (!sub) return;

  document.getElementById("chargeSubId").value = sub.id;
  document.getElementById("chargeModalTitle").textContent = "Log Charge: " + sub.name;
  document.getElementById("chargeModalSub").textContent = `Vendor: ${sub.vendor_name || "--"} | Base Rate: ${sub.currency} ${Number(sub.amount).toFixed(2)}`;
  
  document.getElementById("chargeAmount").value = sub.amount || "";
  document.getElementById("chargeCurrency").value = sub.currency || "USD";
  document.getElementById("chargeDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("chargeNote").value = "";
  document.getElementById("chargeFile").value = "";

  const bankSel = document.getElementById("chargeBankAccountId");
  if (bankSel) {
    try {
      const accounts = await FinanceApi.getAccounts({ is_active: true });
      bankSel.innerHTML = '<option value="">— Don\'t record ledger outflow —</option>' +
        (accounts || []).map((a) => `<option value="${a.id}">${a.account_name} (${a.currency}) - Bal: ${a.currency === 'EGP' ? 'E£' : '$'}${Number(a.current_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</option>`).join("");
    } catch (_) {
      bankSel.innerHTML = '<option value="">— Don\'t record ledger outflow —</option>';
    }
  }

  openModal("subscriptionChargeModal");
}

async function saveSubscriptionCharge() {
  const subId = document.getElementById("chargeSubId").value;
  const amount = parseFloat(document.getElementById("chargeAmount").value);
  const currency = document.getElementById("chargeCurrency").value;
  const date = document.getElementById("chargeDate").value;
  const bankId = document.getElementById("chargeBankAccountId").value;
  const note = document.getElementById("chargeNote").value.trim();
  const fileInput = document.getElementById("chargeFile");

  if (!subId) { showToast("Subscription ID missing", "error"); return; }
  if (isNaN(amount) || amount <= 0) { showToast("Please enter a valid charge amount", "error"); return; }
  if (!date) { showToast("Billing date is required", "error"); return; }

  const formData = new FormData();
  formData.append("amount", String(amount));
  formData.append("billing_date", date);
  formData.append("currency", currency);
  if (note) formData.append("note", note);
  if (bankId) formData.append("bank_account_id", String(bankId));
  if (fileInput && fileInput.files && fileInput.files[0]) {
    formData.append("file", fileInput.files[0]);
  }

  const btn = document.getElementById("btnSaveSubscriptionCharge");
  if (btn) btn.disabled = true;

  try {
    await FinanceApi.logSubscriptionCharge(subId, formData);
    showToast("Subscription charge recorded successfully", "success");
    closeModal("subscriptionChargeModal");
    await loadFinanceSubscriptions();
  } catch (err) {
    showToast("Error recording charge: " + (err.message || err), "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function openSubscriptionHistoryModal(subId) {
  _currentHistorySubId = subId;
  const sub = (FinanceState.subscriptions || []).find((s) => s.id === parseInt(subId, 10));
  if (!sub) return;

  document.getElementById("subHistoryTitle").textContent = `${sub.name} — Charge History`;
  document.getElementById("subHistorySummary").textContent = `Vendor: ${sub.vendor_name || "--"} | Base Rate: ${sub.currency} ${Number(sub.amount).toFixed(2)} / ${sub.billing_cycle}`;

  const tbody = document.getElementById("subHistoryTableBody");
  const empty = document.getElementById("subHistoryEmpty");
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.5rem;"><i class="fa-solid fa-spinner fa-spin"></i> Loading charge history...</td></tr>';
  if (empty) empty.style.display = "none";

  openModal("subscriptionHistoryModal");

  try {
    const charges = await FinanceApi.getSubscriptionCharges(subId);
    if (!charges || !charges.length) {
      if (tbody) tbody.innerHTML = "";
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    tbody.innerHTML = charges.map((c) => {
      const currSymbol = c.currency === "EGP" ? "E£" : c.currency === "EUR" ? "€" : "$";
      const amountStr = `${currSymbol}${Number(c.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
      
      const ledgerBadge = c.linked_transaction_id
        ? '<span class="badge badge-approved" style="font-size:11px;"><i class="fa-solid fa-link"></i> Ledger Linked</span>'
        : '<span class="badge badge-grey" style="font-size:11px;">Unlinked</span>';

      const attachmentLinks = (c.attachments || []).length
        ? c.attachments.map((att) => `
            <a href="/api/finance/attachments/${att.id}/download" target="_blank" class="btn btn-sm btn-outline" style="font-size:11px; padding:3px 8px; gap:4px;" title="Download private accounting receipt">
              <i class="fa-solid fa-paperclip"></i> ${att.file_name}
            </a>
          `).join(" ")
        : '<span style="color:var(--text3); font-size:12px;">No file</span>';

      return `
      <tr>
        <td><strong>${c.billing_date || "--"}</strong></td>
        <td><strong>${amountStr}</strong></td>
        <td>${c.note || '<span style="opacity:0.4;">--</span>'}</td>
        <td>${ledgerBadge}</td>
        <td>${attachmentLinks}</td>
      </tr>
      `;
    }).join("");
  } catch (err) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--danger); padding:1.5rem;">Failed to load charges: ${err.message || err}</td></tr>`;
  }
}

function openLogChargeFromHistory() {
  if (_currentHistorySubId) {
    closeModal("subscriptionHistoryModal");
    openLogSubscriptionChargeModal(_currentHistorySubId);
  }
}

window.loadFinanceSubscriptions = loadFinanceSubscriptions;
window.filterFinanceSubscriptions = filterFinanceSubscriptions;
window.filterFinanceSubscriptionsStatus = filterFinanceSubscriptionsStatus;
window.renderFinanceSubscriptionsTable = renderFinanceSubscriptionsTable;
window.openAddSubscriptionModal = openAddSubscriptionModal;
window.openEditSubscriptionModal = openEditSubscriptionModal;
window.saveSubscription = saveSubscription;
window.openLogSubscriptionChargeModal = openLogSubscriptionChargeModal;
window.saveSubscriptionCharge = saveSubscriptionCharge;
window.openSubscriptionHistoryModal = openSubscriptionHistoryModal;
window.openLogChargeFromHistory = openLogChargeFromHistory;

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

// ==========================================
// 9. Bank Statement Imports & Reconciliation (Phase 7)
// ==========================================
let _allFinanceStatements = [];
let _currentReconcileImport = null;
let _currentReconcileLines = [];
let _currentReconcileFilter = "all";

async function loadFinanceStatements() {
  const bar = document.getElementById("financeStatementsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const accFilter = document.getElementById("financeStatementAccountFilter");
    const monthFilter = document.getElementById("financeStatementMonthFilter");
    const accountId = accFilter ? accFilter.value : "";
    const periodMonth = monthFilter ? monthFilter.value : "";

    // Populate bank account dropdown if empty
    if (accFilter && accFilter.options.length <= 1) {
      try {
        const accounts = await FinanceApi.listAccounts();
        const currentVal = accFilter.value;
        accFilter.innerHTML = '<option value="">All Bank Accounts</option>';
        accounts.forEach((a) => {
          if (a.is_active && a.account_type === "bank") {
            const opt = document.createElement("option");
            opt.value = a.id;
            opt.textContent = `${a.account_name} (${a.currency})`;
            accFilter.appendChild(opt);
          }
        });
        accFilter.value = currentVal;
      } catch (e) {
        console.warn("Could not load accounts for statement filter", e);
      }
    }

    _allFinanceStatements = await FinanceApi.listAccountStatements(accountId, periodMonth);
    renderFinanceStatementsTable(_allFinanceStatements);
  } catch (err) {
    console.error("Failed to load statements", err);
    showToast(err.message || "Failed to load bank statements", "error");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterFinanceStatements() {
  const query = (document.getElementById("financeStatementSearch")?.value || "").toLowerCase().trim();
  let filtered = _allFinanceStatements;
  if (query) {
    filtered = filtered.filter(
      (s) =>
        (s.account_name || "").toLowerCase().includes(query) ||
        (s.period_month || "").toLowerCase().includes(query) ||
        (s.status || "").toLowerCase().includes(query)
    );
  }
  renderFinanceStatementsTable(filtered);
}

function renderFinanceStatementsTable(statements) {
  const tbody = document.getElementById("statementImportsTableBody");
  const emptyState = document.getElementById("financeStatementsEmpty");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (!statements || statements.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    return;
  }
  if (emptyState) emptyState.style.display = "none";

  statements.forEach((stmt) => {
    const tr = document.createElement("tr");

    const statusBadge =
      stmt.status === "reconciled"
        ? '<span class="status-badge status-success"><i class="fa-solid fa-lock"></i> Reconciled</span>'
        : '<span class="status-badge status-warning"><i class="fa-solid fa-clock"></i> Needs Review</span>';

    const fmtBadge =
      stmt.file_type === "pdf"
        ? '<span class="status-badge status-danger" style="font-size:11px;">PDF</span>'
        : '<span class="status-badge status-info" style="font-size:11px;">CSV</span>';

    const progressPct = stmt.total_lines_count > 0 ? Math.round((stmt.matched_lines_count / stmt.total_lines_count) * 100) : 0;
    const progressText = `${stmt.matched_lines_count || 0} / ${stmt.total_lines_count || 0} (${progressPct}%)`;

    const uploadDate = stmt.created_at ? new Date(stmt.created_at).toLocaleDateString() : "—";

    tr.innerHTML = `
      <td style="font-weight:600;"><i class="fa-regular fa-calendar" style="margin-right:6px;color:var(--text-muted);"></i>${escapeHtml(stmt.period_month)}</td>
      <td style="font-weight:500;">${escapeHtml(stmt.account_name || 'Bank Account #' + stmt.account_id)}</td>
      <td style="text-align:center;">${fmtBadge}</td>
      <td style="text-align:center;">${stmt.total_lines_count || 0}</td>
      <td style="text-align:center;font-weight:600;color:${progressPct === 100 ? 'var(--color-success)' : 'inherit'};">${progressText}</td>
      <td style="text-align:center;">${statusBadge}</td>
      <td>${uploadDate}</td>
      <td style="text-align:center;">
        <button class="btn btn-sm btn-outline btn-review-statement" onclick="openReconciliationModal(${stmt.id})">
          <i class="fa-solid fa-scale-balanced"></i> Review &amp; Reconcile
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function openUploadStatementModal() {
  const select = document.getElementById("stmtUploadAccountId");
  if (select) {
    try {
      const accounts = await FinanceApi.listAccounts();
      select.innerHTML = '<option value="">— Select company bank account —</option>';
      accounts.forEach((a) => {
        if (a.is_active && a.account_type === "bank") {
          const opt = document.createElement("option");
          opt.value = a.id;
          opt.textContent = `${a.account_name} (${a.currency}) — ${a.bank_name || ''}`;
          select.appendChild(opt);
        }
      });
    } catch (e) {
      console.warn("Could not load accounts", e);
    }
  }

  // Pre-fill current month YYYY-MM
  const periodInput = document.getElementById("stmtUploadPeriodMonth");
  if (periodInput && !periodInput.value) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    periodInput.value = `${y}-${m}`;
  }

  const form = document.getElementById("financeStatementUploadForm");
  if (form) form.reset();

  const mappingFields = document.getElementById("stmtCsvMappingFields");
  if (mappingFields) mappingFields.style.display = "none";

  openModal("financeStatementUploadModal");
}

function closeUploadStatementModal() {
  closeModal("financeStatementUploadModal");
}

function toggleCsvMappingFields() {
  const el = document.getElementById("stmtCsvMappingFields");
  const chevron = document.getElementById("stmtCsvMappingChevron");
  if (!el) return;
  const isHidden = el.style.display === "none";
  el.style.display = isHidden ? "block" : "none";
  if (chevron) chevron.style.transform = isHidden ? "rotate(180deg)" : "rotate(0deg)";
}

function onStatementFileTypeChange() {
  const type = document.getElementById("stmtUploadFileType")?.value;
  const fileInput = document.getElementById("stmtUploadFile");
  const mappingSec = document.getElementById("stmtCsvMappingSection");
  if (fileInput) {
    fileInput.accept = type === "pdf" ? ".pdf" : ".csv";
  }
  if (mappingSec) {
    mappingSec.style.display = type === "pdf" ? "none" : "block";
  }
}

async function handleStatementUploadSubmit(e) {
  e.preventDefault();
  const accountId = document.getElementById("stmtUploadAccountId")?.value;
  const periodMonth = document.getElementById("stmtUploadPeriodMonth")?.value;
  const fileInput = document.getElementById("stmtUploadFile");

  if (!accountId) {
    showToast("Please select a target bank account", "error");
    return;
  }
  if (!periodMonth) {
    showToast("Please specify the statement period month", "error");
    return;
  }
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    showToast("Please choose a statement file to upload", "error");
    return;
  }

  const formData = new FormData();
  formData.append("period_month", periodMonth);
  formData.append("file", fileInput.files[0]);

  // Optional custom mapping
  const dateCol = document.getElementById("mapDateCol")?.value.trim();
  const descCol = document.getElementById("mapDescCol")?.value.trim();
  const debitCol = document.getElementById("mapDebitCol")?.value.trim();
  const creditCol = document.getElementById("mapCreditCol")?.value.trim();
  if (dateCol || descCol || debitCol || creditCol) {
    const mapping = {};
    if (dateCol) mapping.date_col = dateCol;
    if (descCol) mapping.description_col = descCol;
    if (debitCol) mapping.debit_col = debitCol;
    if (creditCol) mapping.credit_col = creditCol;
    formData.append("column_mapping", JSON.stringify(mapping));
  }

  const submitBtn = document.getElementById("btnSubmitStatementUpload");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Uploading &amp; Parsing...';
  }

  try {
    const result = await FinanceApi.uploadStatement(accountId, formData);
    showToast(`Statement uploaded successfully (${result.total_lines_count || 0} lines parsed)`, "success");
    closeUploadStatementModal();
    await loadFinanceStatements();

    // Open reconciliation modal immediately
    if (result && result.id) {
      openReconciliationModal(result.id);
    }
  } catch (err) {
    console.error("Statement upload failed", err);
    showToast(err.message || "Failed to upload bank statement", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<i class="fa-solid fa-upload"></i> Upload &amp; Parse';
    }
  }
}

// Reconciliation Review Modal
async function openReconciliationModal(importId) {
  const loading = document.getElementById("reconcileLoadingBar");
  if (loading) loading.style.display = "block";
  openModal("financeReconciliationModal");

  try {
    const [imp, lines] = await Promise.all([
      FinanceApi.getStatement(importId),
      FinanceApi.getStatementLines(importId),
    ]);

    _currentReconcileImport = imp;
    _currentReconcileLines = lines;
    _currentReconcileFilter = "all";

    updateReconciliationHeader(imp);
    renderReconciliationLinesTable(lines);
  } catch (err) {
    console.error("Failed to load reconciliation details", err);
    showToast(err.message || "Failed to load statement reconciliation details", "error");
    closeReconciliationModal();
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function closeReconciliationModal() {
  closeModal("financeReconciliationModal");
  _currentReconcileImport = null;
  _currentReconcileLines = [];
}

function updateReconciliationHeader(imp) {
  if (!imp) return;
  const pEl = document.getElementById("reconcileSummaryPeriod");
  const aEl = document.getElementById("reconcileSummaryAccount");
  const prEl = document.getElementById("reconcileSummaryProgress");
  const stEl = document.getElementById("reconcileSummaryStatus");
  const btnFinal = document.getElementById("btnFinalizeReconciliation");

  if (pEl) pEl.textContent = imp.period_month || "Period";
  if (aEl) aEl.textContent = imp.account_name || "Account";
  if (prEl) prEl.textContent = `${imp.matched_lines_count || 0} / ${imp.total_lines_count || 0} Resolved`;

  const isReconciled = imp.status === "reconciled";
  if (stEl) {
    stEl.textContent = isReconciled ? "Reconciled" : "Needs Review";
    stEl.className = isReconciled ? "status-badge status-success" : "status-badge status-warning";
  }

  const allResolved = imp.total_lines_count > 0 && imp.matched_lines_count === imp.total_lines_count;
  if (btnFinal) {
    if (isReconciled) {
      btnFinal.disabled = true;
      btnFinal.innerHTML = '<i class="fa-solid fa-check-double"></i> Period Reconciled';
    } else {
      btnFinal.disabled = !allResolved;
      btnFinal.innerHTML = '<i class="fa-solid fa-lock"></i> Reconcile &amp; Close Period';
    }
  }
}

function filterReconciliationLines(filterType, btn) {
  _currentReconcileFilter = filterType;
  const tabs = document.querySelectorAll("#reconcileLineFilterTabs .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");

  let filtered = _currentReconcileLines;
  if (filterType === "unmatched") {
    filtered = filtered.filter((l) => l.status === "unmatched");
  } else if (filterType === "matched") {
    filtered = filtered.filter((l) => ["matched", "created"].includes(l.status));
  } else if (filterType === "ignored") {
    filtered = filtered.filter((l) => l.status === "ignored");
  }

  const countEl = document.getElementById("reconcileFilterCount");
  if (countEl) {
    countEl.textContent = `Showing ${filtered.length} of ${_currentReconcileLines.length} lines`;
  }
  renderReconciliationLinesTable(filtered);
}

function renderReconciliationLinesTable(lines) {
  const tbody = document.getElementById("reconciliationLinesBody");
  const emptyState = document.getElementById("reconcileEmptyState");
  if (!tbody) return;

  tbody.innerHTML = "";
  if (!lines || lines.length === 0) {
    if (emptyState) emptyState.style.display = "block";
    return;
  }
  if (emptyState) emptyState.style.display = "none";

  const isStmtReconciled = _currentReconcileImport && _currentReconcileImport.status === "reconciled";

  lines.forEach((line) => {
    const tr = document.createElement("tr");
    tr.id = `stmtLineRow_${line.id}`;

    const isCredit = line.direction === "in";
    const amountClass = isCredit ? "text-success" : "text-danger";
    const amountPrefix = isCredit ? "+" : "-";
    const formattedAmount = `${amountPrefix}${formatCurrency(line.raw_amount)}`;

    // Status Badge
    let statusBadge = "";
    if (line.status === "matched") {
      statusBadge = '<span class="status-badge status-success" style="font-size:11px;"><i class="fa-solid fa-check"></i> Matched</span>';
    } else if (line.status === "created") {
      statusBadge = '<span class="status-badge status-primary" style="font-size:11px;"><i class="fa-solid fa-plus"></i> Created</span>';
    } else if (line.status === "ignored") {
      statusBadge = '<span class="status-badge status-neutral" style="font-size:11px;"><i class="fa-solid fa-ban"></i> Ignored</span>';
    } else {
      statusBadge = '<span class="status-badge status-warning" style="font-size:11px;"><i class="fa-solid fa-circle-exclamation"></i> Unmatched</span>';
    }

    // Suggested Matches Column
    let matchColContent = "";
    if (line.status === "unmatched") {
      const suggestions = line.suggested_matches || [];
      if (suggestions.length > 0) {
        matchColContent = `
          <select id="lineMatchSelect_${line.id}" class="form-control" style="width:100%;font-size:12px;padding:3px 8px;height:32px;">
            ${suggestions
              .map(
                (s, idx) => `
              <option value="${s.transaction_id || ''}" data-cheque="${s.cheque_id || ''}" ${idx === 0 ? 'selected' : ''}>
                ${s.match_type === 'cheque' ? 'Cheque' : 'Tx'} [${Math.round(s.score * 100)}%] ${escapeHtml(s.description)} (${formatCurrency(s.amount)})
              </option>
            `
              )
              .join("")}
          </select>
        `;
      } else {
        matchColContent = '<span style="color:var(--text-muted);font-size:12px;">No automated match found</span>';
      }
    } else if (line.status === "matched") {
      if (line.matched_cheque_id) {
        matchColContent = `<span style="color:var(--color-success);font-size:12px;"><i class="fa-solid fa-money-check"></i> Linked Cheque #${line.matched_cheque_id} (Auto-cleared)</span>`;
      } else {
        matchColContent = `<span style="color:var(--color-success);font-size:12px;"><i class="fa-solid fa-link"></i> Linked to Ledger Tx #${line.matched_transaction_id}</span>`;
      }
    } else if (line.status === "created") {
      matchColContent = `<span style="color:var(--color-primary);font-size:12px;"><i class="fa-solid fa-receipt"></i> Created Continuous Ledger Entry</span>`;
    } else if (line.status === "ignored") {
      matchColContent = '<span style="color:var(--text-muted);font-size:12px;">Excluded from reconciliation</span>';
    }

    // Actions Column
    let actionButtons = "";
    if (!isStmtReconciled && line.status === "unmatched") {
      const hasMatches = (line.suggested_matches || []).length > 0;
      actionButtons = `
        <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;">
          ${
            hasMatches
              ? `<button class="btn btn-sm btn-fill btn-success" style="padding:4px 8px;font-size:11px;" onclick="confirmLineMatch(${line.id})"><i class="fa-solid fa-check"></i> Match</button>`
              : ""
          }
          <button class="btn btn-sm btn-outline" style="padding:4px 8px;font-size:11px;" onclick="openCreateEntryForLine(${line.id})"><i class="fa-solid fa-plus"></i> Create</button>
          <button class="btn btn-sm btn-outline" style="padding:4px 8px;font-size:11px;color:var(--text-muted);" onclick="ignoreStatementLine(${line.id})"><i class="fa-solid fa-ban"></i></button>
        </div>
      `;
    } else {
      actionButtons = `<span style="font-size:11px;color:var(--text-muted);">${escapeHtml(line.notes || 'Resolved')}</span>`;
    }

    tr.innerHTML = `
      <td style="font-weight:600;font-size:12px;">${escapeHtml(line.raw_date)}</td>
      <td>
        <div style="font-weight:500;font-size:12px;">${escapeHtml(line.raw_description)}</div>
        ${line.raw_reference ? `<div style="font-size:11px;color:var(--text-muted);">Ref: ${escapeHtml(line.raw_reference)}</div>` : ''}
      </td>
      <td style="text-align:right;font-weight:600;font-size:13px;" class="${amountClass}">${formattedAmount}</td>
      <td style="text-align:center;">${statusBadge}</td>
      <td>${matchColContent}</td>
      <td style="text-align:center;">${actionButtons}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function confirmLineMatch(lineId) {
  if (!_currentReconcileImport) return;
  const select = document.getElementById(`lineMatchSelect_${lineId}`);
  let txId = null;
  let chqId = null;

  if (select && select.selectedOptions && select.selectedOptions[0]) {
    const opt = select.selectedOptions[0];
    txId = opt.value ? parseInt(opt.value, 10) : null;
    chqId = opt.getAttribute("data-cheque") ? parseInt(opt.getAttribute("data-cheque"), 10) : null;
  }

  try {
    const updated = await FinanceApi.resolveStatementLine(_currentReconcileImport.id, lineId, {
      action: "match",
      matched_transaction_id: txId,
      matched_cheque_id: chqId,
      notes: chqId ? `Matched with issued Cheque #${chqId}` : `Matched with Ledger Tx #${txId}`,
    });

    showToast("Statement line matched successfully", "success");
    // Update local state and re-render
    const idx = _currentReconcileLines.findIndex((l) => l.id === lineId);
    if (idx >= 0) _currentReconcileLines[idx] = updated;

    _currentReconcileImport.matched_lines_count = _currentReconcileLines.filter((l) =>
      ["matched", "created", "ignored"].includes(l.status)
    ).length;

    updateReconciliationHeader(_currentReconcileImport);
    filterReconciliationLines(_currentReconcileFilter);
    await loadFinanceStatements();
  } catch (err) {
    console.error("Match resolution failed", err);
    showToast(err.message || "Failed to confirm match", "error");
  }
}

async function ignoreStatementLine(lineId) {
  if (!_currentReconcileImport) return;
  try {
    const updated = await FinanceApi.resolveStatementLine(_currentReconcileImport.id, lineId, {
      action: "ignore",
      notes: "Ignored by user",
    });

    showToast("Line ignored", "info");
    const idx = _currentReconcileLines.findIndex((l) => l.id === lineId);
    if (idx >= 0) _currentReconcileLines[idx] = updated;

    _currentReconcileImport.matched_lines_count = _currentReconcileLines.filter((l) =>
      ["matched", "created", "ignored"].includes(l.status)
    ).length;

    updateReconciliationHeader(_currentReconcileImport);
    filterReconciliationLines(_currentReconcileFilter);
    await loadFinanceStatements();
  } catch (err) {
    console.error("Ignore failed", err);
    showToast(err.message || "Failed to ignore line", "error");
  }
}

async function openCreateEntryForLine(lineId) {
  const line = _currentReconcileLines.find((l) => l.id === lineId);
  if (!line) return;

  document.getElementById("reconcileLineId").value = line.id;
  document.getElementById("reconcileLineDate").value = line.raw_date;
  document.getElementById("reconcileLineAmount").value = `${line.direction === "in" ? "+" : "-"}${formatCurrency(line.raw_amount)}`;
  document.getElementById("reconcileEntryDesc").value = line.raw_description || "Statement Line Outflow";
  document.getElementById("reconcileEntryRef").value = line.raw_reference || "STMT-AUTOCREATE";

  // Populate Categories and Payment Types dropdowns
  const catSel = document.getElementById("reconcileEntryCategory");
  const ptSel = document.getElementById("reconcileEntryPaymentType");
  if (catSel && catSel.options.length <= 1) {
    try {
      const cats = await FinanceApi.listCategories();
      catSel.innerHTML = '<option value="">— Select Category —</option>';
      cats.forEach((c) => {
        if (c.is_active) {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = `${c.name} (${c.kind})`;
          catSel.appendChild(opt);
        }
      });
    } catch (e) {}
  }
  if (ptSel && ptSel.options.length <= 1) {
    try {
      const pts = await FinanceApi.listPaymentTypes();
      ptSel.innerHTML = '<option value="">— Select Payment Type —</option>';
      pts.forEach((p) => {
        if (p.is_active) {
          const opt = document.createElement("option");
          opt.value = p.id;
          opt.textContent = `${p.name} (${p.code})`;
          ptSel.appendChild(opt);
        }
      });
    } catch (e) {}
  }

  openModal("reconcileCreateEntryModal");
}

function closeReconcileCreateEntryModal() {
  closeModal("reconcileCreateEntryModal");
}

async function handleReconcileCreateEntrySubmit(e) {
  e.preventDefault();
  if (!_currentReconcileImport) return;

  const lineId = parseInt(document.getElementById("reconcileLineId").value, 10);
  const desc = document.getElementById("reconcileEntryDesc").value.trim();
  const catId = document.getElementById("reconcileEntryCategory").value;
  const ptId = document.getElementById("reconcileEntryPaymentType").value;
  const ref = document.getElementById("reconcileEntryRef").value.trim();

  try {
    const updated = await FinanceApi.resolveStatementLine(_currentReconcileImport.id, lineId, {
      action: "create",
      description: desc,
      category_id: catId ? parseInt(catId, 10) : null,
      payment_type_id: ptId ? parseInt(ptId, 10) : null,
      reference: ref,
      notes: "Auto-created continuous ledger entry from statement line",
    });

    showToast("Ledger entry created and statement line matched", "success");
    closeReconcileCreateEntryModal();

    const idx = _currentReconcileLines.findIndex((l) => l.id === lineId);
    if (idx >= 0) _currentReconcileLines[idx] = updated;

    _currentReconcileImport.matched_lines_count = _currentReconcileLines.filter((l) =>
      ["matched", "created", "ignored"].includes(l.status)
    ).length;

    updateReconciliationHeader(_currentReconcileImport);
    filterReconciliationLines(_currentReconcileFilter);
    await loadFinanceStatements();
  } catch (err) {
    console.error("Create entry failed", err);
    showToast(err.message || "Failed to create ledger entry", "error");
  }
}

async function finalizeStatementReconciliation() {
  if (!_currentReconcileImport) return;
  const btn = document.getElementById("btnFinalizeReconciliation");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Reconciling Period...';
  }

  try {
    const reconciled = await FinanceApi.reconcileStatement(_currentReconcileImport.id);
    _currentReconcileImport = reconciled;
    updateReconciliationHeader(reconciled);
    renderReconciliationLinesTable(_currentReconcileLines);
    showToast(`Statement period ${reconciled.period_month} successfully reconciled and closed!`, "success");
    await loadFinanceStatements();
  } catch (err) {
    console.error("Reconciliation finalization failed", err);
    showToast(err.message || "Failed to finalize reconciliation", "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-lock"></i> Reconcile &amp; Close Period';
    }
  }
}

// Window exports
window.loadFinanceStatements = loadFinanceStatements;
window.filterFinanceStatements = filterFinanceStatements;
window.openUploadStatementModal = openUploadStatementModal;
window.closeUploadStatementModal = closeUploadStatementModal;
window.toggleCsvMappingFields = toggleCsvMappingFields;
window.onStatementFileTypeChange = onStatementFileTypeChange;
window.handleStatementUploadSubmit = handleStatementUploadSubmit;
window.openReconciliationModal = openReconciliationModal;
window.closeReconciliationModal = closeReconciliationModal;
window.filterReconciliationLines = filterReconciliationLines;
window.confirmLineMatch = confirmLineMatch;
window.ignoreStatementLine = ignoreStatementLine;
window.openCreateEntryForLine = openCreateEntryForLine;
window.closeReconcileCreateEntryModal = closeReconcileCreateEntryModal;
window.handleReconcileCreateEntrySubmit = handleReconcileCreateEntrySubmit;
window.finalizeStatementReconciliation = finalizeStatementReconciliation;

// ==========================================
// 10. Financial Reports & Excel Export (Phase 8)
// ==========================================
let _currentReportsTab = "category-summary";
let _currentMatrixPeriodGroup = "month";
let _reportTxSearchDebounceTimer = null;

function switchFinanceReportsTab(tabName, btn) {
  _currentReportsTab = tabName;

  // Update tabs
  const subnav = document.getElementById("financeReportsSubNav");
  if (subnav) {
    subnav.querySelectorAll(".filter-tab").forEach((b) => b.classList.remove("active"));
  }
  if (btn) {
    btn.classList.add("active");
  } else if (subnav) {
    const target = subnav.querySelector(`[data-report-tab="${tabName}"]`);
    if (target) target.classList.add("active");
  }

  // Toggle panes
  const panes = {
    "category-summary": "reportPaneCategorySummary",
    matrix: "reportPaneMatrix",
    balances: "reportPaneBalances",
    transactions: "reportPaneTransactions",
    cheques: "reportPaneCheques",
  };

  Object.entries(panes).forEach(([k, paneId]) => {
    const el = document.getElementById(paneId);
    if (el) {
      el.style.display = k === tabName ? "block" : "none";
    }
  });

  // Load active tab data
  if (tabName === "category-summary") {
    loadReportCategorySummary();
  } else if (tabName === "matrix") {
    loadReportMatrix();
  } else if (tabName === "balances") {
    loadReportBalances();
  } else if (tabName === "transactions") {
    loadReportTransactions();
  } else if (tabName === "cheques") {
    loadReportCheques();
  }
}

async function loadFinanceReports() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const today = `${yyyy}-${mm}-${dd}`;
  const firstOfMonth = `${yyyy}-${mm}-01`;

  const dFrom1 = document.getElementById("reportCatSumDateFrom");
  const dTo1 = document.getElementById("reportCatSumDateTo");
  if (dFrom1 && !dFrom1.value) dFrom1.value = firstOfMonth;
  if (dTo1 && !dTo1.value) dTo1.value = today;

  const dAsOf = document.getElementById("reportBalancesAsOfDate");
  if (dAsOf && !dAsOf.value) dAsOf.value = today;

  const dFromTx = document.getElementById("reportTxDateFrom");
  const dToTx = document.getElementById("reportTxDateTo");
  if (dFromTx && !dFromTx.value) dFromTx.value = firstOfMonth;
  if (dToTx && !dToTx.value) dToTx.value = today;

  // Populate account & category dropdowns in transactions pane
  populateReportFilters();

  switchFinanceReportsTab(_currentReportsTab);
}

function populateReportFilters() {
  const accSel = document.getElementById("reportTxAccount");
  if (accSel && accSel.options.length <= 1) {
    (FinanceState.accounts || []).forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `${a.account_name} (${a.currency})`;
      accSel.appendChild(opt);
    });
  }

  const catSel = document.getElementById("reportTxCategory");
  if (catSel && catSel.options.length <= 1) {
    (FinanceState.categories || []).forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      catSel.appendChild(opt);
    });
  }
}

// ----------------------------------------------------------------------
// Category Spend Rollup
// ----------------------------------------------------------------------
async function loadReportCategorySummary() {
  const loading = document.getElementById("reportCatSumLoadingBar");
  if (loading) loading.style.display = "block";

  const dateFrom = document.getElementById("reportCatSumDateFrom")?.value || "";
  const dateTo = document.getElementById("reportCatSumDateTo")?.value || "";
  const currency = document.getElementById("reportCatSumCurrency")?.value || "";

  try {
    const report = await FinanceApi.getCategorySummaryReport({
      date_from: dateFrom,
      date_to: dateTo,
      currency: currency || undefined,
    });

    const totSpentEl = document.getElementById("reportCatSumTotalSpent");
    const catCountEl = document.getElementById("reportCatSumCategoryCount");
    const tbody = document.getElementById("reportCategorySummaryTableBody");
    const empty = document.getElementById("reportCatSumEmpty");

    const total = Number(report.total_spent || 0);
    const currSymbol = currency ? (currency === "USD" ? "$" : currency + " ") : "$";
    if (totSpentEl) totSpentEl.textContent = `${currSymbol}${total.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (catCountEl) catCountEl.textContent = (report.categories || []).length;

    if (!tbody) return;
    tbody.innerHTML = "";

    if (!report.categories || report.categories.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    report.categories.forEach((cat) => {
      const tr = document.createElement("tr");
      const amt = Number(cat.total_amount || 0);
      const pct = Number(cat.percentage || 0);

      tr.innerHTML = `
        <td><strong>${cat.category_name}</strong></td>
        <td><span class="badge ${cat.kind === 'cost' ? 'badge-danger' : 'badge-neutral'}">${(cat.kind || 'cost').toUpperCase()}</span></td>
        <td style="text-align:center;">${cat.transaction_count || 0}</td>
        <td style="text-align:right; font-weight:600;">${currSymbol}${amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td>
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="flex:1; height:8px; background:var(--border-color, #E2E8F0); border-radius:4px; overflow:hidden;">
              <div style="width:${Math.min(pct, 100)}%; height:100%; background:#EF4444; border-radius:4px;"></div>
            </div>
            <span style="font-size:0.85rem; font-weight:600; min-width:48px; text-align:right;">${pct.toFixed(1)}%</span>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load category summary:", err);
    showToast(err.message || "Failed to load category spend rollup", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportCategorySummaryExcel() {
  const dateFrom = document.getElementById("reportCatSumDateFrom")?.value || "";
  const dateTo = document.getElementById("reportCatSumDateTo")?.value || "";
  const currency = document.getElementById("reportCatSumCurrency")?.value || "";

  const params = { date_from: dateFrom, date_to: dateTo };
  if (currency) params.currency = currency;

  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/category-summary", params);
  triggerExcelDownload(url, `category_spend_rollup_${dateFrom || 'start'}_to_${dateTo || 'end'}.xlsx`);
}

// ----------------------------------------------------------------------
// Annual Spend Matrix
// ----------------------------------------------------------------------
function setMatrixPeriodGroup(grp, btn) {
  _currentMatrixPeriodGroup = grp;
  const container = document.getElementById("reportMatrixPeriodTabs");
  if (container) {
    container.querySelectorAll(".filter-tab").forEach((b) => b.classList.remove("active"));
  }
  if (btn) btn.classList.add("active");
  loadReportMatrix();
}

async function loadReportMatrix() {
  const loading = document.getElementById("reportMatrixLoadingBar");
  if (loading) loading.style.display = "block";

  const yr = document.getElementById("reportMatrixYear")?.value || "2026";
  const grp = _currentMatrixPeriodGroup || "month";

  try {
    const report = await FinanceApi.getCategoryMatrixReport({ year: yr, period_group: grp });

    const thead = document.getElementById("reportMatrixTableHead");
    const tbody = document.getElementById("reportMatrixTableBody");
    const tfoot = document.getElementById("reportMatrixTableFoot");
    const empty = document.getElementById("reportMatrixEmpty");

    if (!thead || !tbody || !tfoot) return;
    thead.innerHTML = "";
    tbody.innerHTML = "";
    tfoot.innerHTML = "";

    const labels = report.period_labels || [];
    if (!report.rows || report.rows.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    // Header
    const trHead = document.createElement("tr");
    let headHtml = `<th style="min-width:180px;">Category</th>`;
    labels.forEach((lbl) => {
      headHtml += `<th style="text-align:right; min-width:80px;">${lbl}</th>`;
    });
    headHtml += `<th style="text-align:right; min-width:95px;">Total</th><th style="text-align:right; min-width:70px;">% Total</th>`;
    trHead.innerHTML = headHtml;
    thead.appendChild(trHead);

    // Rows
    report.rows.forEach((row) => {
      const tr = document.createElement("tr");
      let rowHtml = `<td><strong>${row.category_name}</strong></td>`;
      labels.forEach((lbl) => {
        const val = Number((row.periods && row.periods[lbl]) || 0);
        rowHtml += `<td style="text-align:right; font-variant-numeric:tabular-nums;">${val > 0 ? val.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : "—"}</td>`;
      });
      const tot = Number(row.total || 0);
      const pct = Number(row.percentage || 0);
      rowHtml += `<td style="text-align:right; font-weight:700; font-variant-numeric:tabular-nums;">$${tot.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>`;
      rowHtml += `<td style="text-align:right; color:var(--text-muted); font-size:0.85rem;">${pct.toFixed(1)}%</td>`;
      tr.innerHTML = rowHtml;
      tbody.appendChild(tr);
    });

    // Foot (Totals)
    const trFoot = document.createElement("tr");
    trFoot.style.borderTop = "2px solid var(--border-color, #E2E8F0)";
    trFoot.style.fontWeight = "700";
    let footHtml = `<td>Total Spend</td>`;
    labels.forEach((lbl) => {
      const tot = Number((report.period_totals && report.period_totals[lbl]) || 0);
      footHtml += `<td style="text-align:right; font-variant-numeric:tabular-nums;">$${tot.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>`;
    });
    const yrTot = Number(report.year_total || 0);
    footHtml += `<td style="text-align:right; font-variant-numeric:tabular-nums; color:#EF4444;">$${yrTot.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</td>`;
    footHtml += `<td style="text-align:right;">100.0%</td>`;
    trFoot.innerHTML = footHtml;
    tfoot.appendChild(trFoot);
  } catch (err) {
    console.error("Failed to load matrix report:", err);
    showToast(err.message || "Failed to load annual spend matrix", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportMatrixExcel() {
  const yr = document.getElementById("reportMatrixYear")?.value || "2026";
  const grp = _currentMatrixPeriodGroup || "month";
  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/category-by-period-matrix", { year: yr, period_group: grp });
  triggerExcelDownload(url, `spend_matrix_${yr}_${grp}.xlsx`);
}

// ----------------------------------------------------------------------
// Point-in-Time Balances
// ----------------------------------------------------------------------
async function loadReportBalances() {
  const loading = document.getElementById("reportBalancesLoadingBar");
  if (loading) loading.style.display = "block";

  const asOfDate = document.getElementById("reportBalancesAsOfDate")?.value || "";

  try {
    const report = await FinanceApi.getBalancesReport({ as_of_date: asOfDate });

    // Render currency rollup summary cards
    const cardsContainer = document.getElementById("reportBalancesCurrencyCards");
    if (cardsContainer) {
      cardsContainer.innerHTML = "";
      Object.entries(report.currency_totals || {}).forEach(([curr, total]) => {
        const cVal = Number(total || 0);
        const card = document.createElement("div");
        card.className = "card";
        card.style.padding = "16px";
        card.style.borderLeft = curr === "USD" ? "4px solid #10B981" : "4px solid #3B82F6";
        card.innerHTML = `
          <div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Total ${curr} Liquidity</div>
          <div style="font-size:1.4rem; font-weight:700; color:var(--text-main); margin-top:4px;">
            ${curr === "USD" ? "$" : curr + " "}${cVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">As of ${report.as_of_date}</div>
        `;
        cardsContainer.appendChild(card);
      });
    }

    const tbody = document.getElementById("reportBalancesTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    (report.accounts || []).forEach((acc) => {
      const tr = document.createElement("tr");
      const op = Number(acc.opening_balance || 0);
      const bal = Number(acc.balance_as_of_date || 0);
      const isBank = acc.account_type === "bank";

      tr.innerHTML = `
        <td>
          <div style="font-weight:600;">${acc.account_name}</div>
        </td>
        <td>
          <span class="badge ${isBank ? 'badge-neutral' : 'badge-info'}">
            <i class="fa-solid ${isBank ? 'fa-building-columns' : 'fa-wallet'}"></i> ${acc.account_type.toUpperCase()}
          </span>
        </td>
        <td>${acc.bank_name || "—"}</td>
        <td><code style="font-size:0.85rem;">${acc.account_number}</code></td>
        <td>${acc.country || "—"}</td>
        <td><strong>${acc.currency}</strong></td>
        <td style="text-align:right; color:var(--text-muted);">${op.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="text-align:right; font-weight:700; font-size:1rem; color:${bal < 0 ? '#EF4444' : 'var(--text-main)'};">
          ${bal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load balances report:", err);
    showToast(err.message || "Failed to load point-in-time balances", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportBalancesExcel() {
  const asOfDate = document.getElementById("reportBalancesAsOfDate")?.value || "";
  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/balances", { as_of_date: asOfDate });
  triggerExcelDownload(url, `account_balances_as_of_${asOfDate || 'today'}.xlsx`);
}

// ----------------------------------------------------------------------
// Transactions Ledger Report
// ----------------------------------------------------------------------
function debounceReportTxSearch() {
  clearTimeout(_reportTxSearchDebounceTimer);
  _reportTxSearchDebounceTimer = setTimeout(() => {
    loadReportTransactions();
  }, 350);
}

async function loadReportTransactions() {
  const loading = document.getElementById("reportTxLoadingBar");
  if (loading) loading.style.display = "block";

  const dateFrom = document.getElementById("reportTxDateFrom")?.value || "";
  const dateTo = document.getElementById("reportTxDateTo")?.value || "";
  const accId = document.getElementById("reportTxAccount")?.value || "";
  const catId = document.getElementById("reportTxCategory")?.value || "";
  const dir = document.getElementById("reportTxDirection")?.value || "";
  const search = document.getElementById("reportTxSearch")?.value || "";

  const params = {};
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  if (accId) params.account_id = accId;
  if (catId) params.category_id = catId;
  if (dir) params.direction = dir;
  if (search) params.search = search;

  try {
    const report = await FinanceApi.getTransactionsReport(params);

    const inEl = document.getElementById("reportTxTotalInflows");
    const outEl = document.getElementById("reportTxTotalOutflows");
    const netEl = document.getElementById("reportTxNetChange");
    const tbody = document.getElementById("reportTransactionsTableBody");
    const empty = document.getElementById("reportTxEmpty");

    const inflows = Number(report.total_inflows || 0);
    const outflows = Number(report.total_outflows || 0);
    const net = Number(report.net_change || 0);

    if (inEl) inEl.textContent = `+$${inflows.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (outEl) outEl.textContent = `-$${outflows.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (netEl) {
      netEl.textContent = `${net >= 0 ? "+" : ""}$${net.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      netEl.style.color = net >= 0 ? "#10B981" : "#EF4444";
    }

    if (!tbody) return;
    tbody.innerHTML = "";

    if (!report.transactions || report.transactions.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    report.transactions.forEach((tx) => {
      const tr = document.createElement("tr");
      const isIn = tx.direction === "in";
      const amt = Number(tx.amount || 0);
      const run = Number(tx.running_balance || 0);

      tr.innerHTML = `
        <td style="font-variant-numeric:tabular-nums;">${tx.date}</td>
        <td><strong>${tx.account_name}</strong></td>
        <td>
          <span class="badge ${isIn ? 'badge-success' : 'badge-danger'}">
            <i class="fa-solid ${isIn ? 'fa-arrow-down-long' : 'fa-arrow-up-long'}"></i> ${isIn ? 'INFLOW' : 'OUTFLOW'}
          </span>
        </td>
        <td>${tx.category_name || "—"}</td>
        <td>${tx.payment_type_name || "—"}</td>
        <td>
          <div>${tx.reference || "—"}</div>
          ${tx.description ? `<div style="font-size:0.75rem; color:var(--text-muted);">${tx.description}</div>` : ""}
          ${tx.cheque_number ? `<div style="font-size:0.75rem; color:#6366F1;"><i class="fa-solid fa-money-check"></i> Chq #${tx.cheque_number}</div>` : ""}
        </td>
        <td style="text-align:right; font-weight:700; color:${isIn ? '#10B981' : '#EF4444'}; font-variant-numeric:tabular-nums;">
          ${isIn ? "+" : "-"}${amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </td>
        <td style="text-align:right; color:var(--text-muted); font-variant-numeric:tabular-nums;">
          ${run.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load transactions report:", err);
    showToast(err.message || "Failed to load transactions report", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportTransactionsExcel() {
  const dateFrom = document.getElementById("reportTxDateFrom")?.value || "";
  const dateTo = document.getElementById("reportTxDateTo")?.value || "";
  const accId = document.getElementById("reportTxAccount")?.value || "";
  const catId = document.getElementById("reportTxCategory")?.value || "";
  const dir = document.getElementById("reportTxDirection")?.value || "";
  const search = document.getElementById("reportTxSearch")?.value || "";

  const params = {};
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  if (accId) params.account_id = accId;
  if (catId) params.category_id = catId;
  if (dir) params.direction = dir;
  if (search) params.search = search;

  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/transactions", params);
  triggerExcelDownload(url, `transactions_ledger_${dateFrom || 'start'}_to_${dateTo || 'end'}.xlsx`);
}

// ----------------------------------------------------------------------
// Cheques Report
// ----------------------------------------------------------------------
async function loadReportCheques() {
  const loading = document.getElementById("reportChequesLoadingBar");
  if (loading) loading.style.display = "block";

  const yr = document.getElementById("reportChequesFiscalYear")?.value || "2026";
  const st = document.getElementById("reportChequesStatus")?.value || "";

  const params = { fiscal_year: yr };
  if (st) params.status = st;

  try {
    const report = await FinanceApi.getChequesReport(params);

    const s = report.summary || {};
    const bySt = s.by_status || {};

    const totCntEl = document.getElementById("reportChequesTotalCount");
    const totAmtEl = document.getElementById("reportChequesTotalAmount");
    const issCntEl = document.getElementById("reportChequesIssuedCount");
    const issAmtEl = document.getElementById("reportChequesIssuedAmount");
    const clrCntEl = document.getElementById("reportChequesClearedCount");
    const clrAmtEl = document.getElementById("reportChequesClearedAmount");
    const bncCntEl = document.getElementById("reportChequesBouncedVoidedCount");
    const bncAmtEl = document.getElementById("reportChequesBouncedVoidedAmount");

    if (totCntEl) totCntEl.textContent = s.total_count || 0;
    if (totAmtEl) totAmtEl.textContent = `$${Number(s.total_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const iss = bySt.issued || { count: 0, amount: 0 };
    if (issCntEl) issCntEl.textContent = iss.count;
    if (issAmtEl) issAmtEl.textContent = `$${Number(iss.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const clr = bySt.cleared || { count: 0, amount: 0 };
    if (clrCntEl) clrCntEl.textContent = clr.count;
    if (clrAmtEl) clrAmtEl.textContent = `$${Number(clr.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const bnc = Number(bySt.bounced?.count || 0) + Number(bySt.voided?.count || 0);
    const bncAmt = Number(bySt.bounced?.amount || 0) + Number(bySt.voided?.amount || 0);
    if (bncCntEl) bncCntEl.textContent = bnc;
    if (bncAmtEl) bncAmtEl.textContent = `$${bncAmt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const tbody = document.getElementById("reportChequesTableBody");
    const empty = document.getElementById("reportChequesEmpty");

    if (!tbody) return;
    tbody.innerHTML = "";

    if (!report.cheques || report.cheques.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    report.cheques.forEach((chk) => {
      const tr = document.createElement("tr");
      const amt = Number(chk.amount || 0);
      const stClass =
        chk.status === "cleared" ? "badge-success" : chk.status === "issued" ? "badge-warning" : "badge-danger";

      tr.innerHTML = `
        <td><strong><i class="fa-solid fa-money-check"></i> ${chk.cheque_number}</strong></td>
        <td>${chk.issue_date}</td>
        <td>${chk.clear_date || "—"}</td>
        <td>${chk.account_name}</td>
        <td><strong>${chk.payee}</strong></td>
        <td><span style="font-size:0.85rem; color:var(--text-muted);">${(chk.purpose_type || 'other').replace('_', ' ')}</span></td>
        <td style="text-align:right; font-weight:700;">${chk.currency} ${amt.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td><span class="badge ${stClass}">${chk.status.toUpperCase()}</span></td>
        <td style="font-size:0.85rem; color:var(--text-muted);">${chk.notes || "—"}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load cheques report:", err);
    showToast(err.message || "Failed to load cheques report", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportChequesExcel() {
  const yr = document.getElementById("reportChequesFiscalYear")?.value || "2026";
  const st = document.getElementById("reportChequesStatus")?.value || "";
  const params = { fiscal_year: yr };
  if (st) params.status = st;

  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/cheques", params);
  triggerExcelDownload(url, `cheque_register_FY${yr}.xlsx`);
}

function triggerExcelDownload(url, filename) {
  if (typeof _isMock === "function" && _isMock()) {
    showToast(`Excel workbook "${filename}" ready for download!`, "success");
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Window exports for Phase 8 Reports
window.switchFinanceReportsTab = switchFinanceReportsTab;
window.loadFinanceReports = loadFinanceReports;
window.loadReportCategorySummary = loadReportCategorySummary;
window.exportCategorySummaryExcel = exportCategorySummaryExcel;
window.setMatrixPeriodGroup = setMatrixPeriodGroup;
window.loadReportMatrix = loadReportMatrix;
window.exportMatrixExcel = exportMatrixExcel;
window.loadReportBalances = loadReportBalances;
window.exportBalancesExcel = exportBalancesExcel;
window.loadReportTransactions = loadReportTransactions;
window.debounceReportTxSearch = debounceReportTxSearch;
window.exportTransactionsExcel = exportTransactionsExcel;
window.loadReportCheques = loadReportCheques;
window.exportChequesExcel = exportChequesExcel;
window.triggerExcelDownload = triggerExcelDownload;


