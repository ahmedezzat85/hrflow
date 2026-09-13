// ==========================================
// 2. Sales Invoices
// ==========================================
let _invoiceTableInitialized = false;
let _currentInvoiceWorkQueue = "open";

function setInvoiceWorkQueue(queue) {
  _currentInvoiceWorkQueue = queue;
  const statusFilter = document.getElementById("financeInvoiceStatusFilter");
  if (statusFilter) {
    statusFilter.value = queue;
  }
  _updateInvoiceWorkQueueTabsUi(queue);
  const state = FinanceTable.getState("finance_invoices");
  state.page = 1;
  FinanceTable.saveState("finance_invoices", state);
  loadFinanceInvoices();
}

function onInvoiceStatusFilterChange(status) {
  _currentInvoiceWorkQueue = status || "all";
  _updateInvoiceWorkQueueTabsUi(_currentInvoiceWorkQueue);
  const state = FinanceTable.getState("finance_invoices");
  state.page = 1;
  FinanceTable.saveState("finance_invoices", state);
  loadFinanceInvoices();
}

function _updateInvoiceWorkQueueTabsUi(activeQueue) {
  const tabs = document.querySelectorAll("#financeInvoiceWorkQueueTabs .filter-tab");
  tabs.forEach((tab) => {
    const isMatch = tab.dataset.queue === activeQueue || (!tab.dataset.queue && activeQueue === "open");
    tab.classList.toggle("active", isMatch);
    tab.setAttribute("aria-selected", isMatch ? "true" : "false");
    tab.setAttribute("tabindex", isMatch ? "0" : "-1");
  });
}

async function loadFinanceInvoices() {
  const bar = document.getElementById("financeInvoicesLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const cachedState = FinanceTable.getState("finance_invoices");
    const statusFilter = document.getElementById("financeInvoiceStatusFilter");
    const searchInput = document.getElementById("financeInvoiceSearch");

    if (!_invoiceTableInitialized) {
      if (cachedState.filters?.status && statusFilter) {
        statusFilter.value = cachedState.filters.status;
        _currentInvoiceWorkQueue = cachedState.filters.status;
      } else if (statusFilter) {
        statusFilter.value = "open";
        _currentInvoiceWorkQueue = "open";
      }
      if (cachedState.filters?.search && searchInput) {
        searchInput.value = cachedState.filters.search;
      }
      _updateInvoiceWorkQueueTabsUi(_currentInvoiceWorkQueue);
      _invoiceTableInitialized = true;
    }

    const params = {};
    const effectiveStatus = (statusFilter && statusFilter.value) ? statusFilter.value : _currentInvoiceWorkQueue;
    if (effectiveStatus && effectiveStatus !== "all") {
      params.status = effectiveStatus;
    }
    const items = await FinanceApi.getInvoices(Object.keys(params).length ? params : undefined);
    FinanceState.invoices = items || [];
    applyAndRenderInvoices();
  } catch (err) {
    console.error("Failed to load finance invoices:", err);
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function applyAndRenderInvoices() {
  const state = FinanceTable.getState("finance_invoices");
  const statusFilter = document.getElementById("financeInvoiceStatusFilter");
  const searchInput = document.getElementById("financeInvoiceSearch");

  const currentStatus = statusFilter ? statusFilter.value : "";
  const currentSearch = searchInput ? searchInput.value.trim() : "";

  state.filters = {
    ...(currentStatus ? { status: currentStatus } : {}),
    ...(currentSearch ? { search: currentSearch } : {}),
  };

  let items = FinanceState.invoices || [];
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    items = items.filter(
      (inv) =>
        (inv.invoice_number && inv.invoice_number.toLowerCase().includes(q)) ||
        (inv.customer_name && inv.customer_name.toLowerCase().includes(q))
    );
  }

  if (state.sortBy) {
    items = FinanceTable.sortItems(items, state.sortBy, state.sortDir);
  }

  const meta = FinanceTable.paginate(items, state.page, state.pageSize);
  state.page = meta.page;
  state.pageSize = meta.pageSize;
  FinanceTable.saveState("finance_invoices", state);

  renderFinanceInvoices(meta.items, items.length);

  FinanceTable.renderDensityControl("financeInvoiceDensityControl");

  FinanceTable.bindSortHeaders("financeInvoicesTable", (col, dir) => {
    state.sortBy = col;
    state.sortDir = dir;
    FinanceTable.saveState("finance_invoices", state);
    applyAndRenderInvoices();
  }, { sortBy: state.sortBy, sortDir: state.sortDir });

  FinanceTable.renderFilterChips(
    "financeInvoiceFilterChips",
    state.filters,
    (removedKey) => {
      if (removedKey === "status" && statusFilter) {
        statusFilter.value = "";
        loadFinanceInvoices();
      } else if (removedKey === "search" && searchInput) {
        searchInput.value = "";
        applyAndRenderInvoices();
      }
    },
    () => {
      if (statusFilter) statusFilter.value = "";
      if (searchInput) searchInput.value = "";
      loadFinanceInvoices();
    }
  );

  FinanceTable.renderPagination(
    "financeInvoicesPagination",
    meta,
    (newPage) => {
      state.page = newPage;
      FinanceTable.saveState("finance_invoices", state);
      applyAndRenderInvoices();
    },
    (newSize) => {
      state.pageSize = newSize;
      state.page = 1;
      FinanceTable.saveState("finance_invoices", state);
      applyAndRenderInvoices();
    }
  );

  FinanceTable.initAllTablesDensity();
}

function _invoiceStatusBadge(status) {
  const norm = (status || "").toLowerCase();
  return (FinanceFormat.STATUS_MAP.invoice[norm]?.badgeClass) || "badge-pending";
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

function renderFinanceInvoices(items, totalFiltered = items ? items.length : 0) {
  const tbody = document.getElementById("financeInvoicesTableBody");
  const empty = document.getElementById("financeInvoicesEmpty");
  const pagination = document.getElementById("financeInvoicesPagination");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    if (pagination && totalFiltered === 0) pagination.style.display = "none";
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

        const derivedStatus = FinanceFormat.getDerivedInvoiceStatus(inv);
        const amountPaid = inv.amount_paid !== undefined ? inv.amount_paid : (inv.total && derivedStatus === "paid" ? inv.total : 0.0);
        const balance = inv.balance !== undefined ? inv.balance : Math.max(0, (inv.total || 0) - amountPaid);
        const isOverdue = inv.is_overdue || derivedStatus === "overdue";
        const daysOverdue = inv.days_overdue || 0;
        const overdueBadge = isOverdue && daysOverdue > 0
          ? `<span class="badge badge-danger" style="font-size:0.7rem; margin-left:4px;" title="${daysOverdue} days overdue">${daysOverdue}d overdue</span>`
          : "";
        const dueDateDisplay = `${FinanceFormat.formatFinanceDate(inv.due_date)}${overdueBadge}`;
        const nextActionDisplay = inv.next_action
          ? `<span class="finance-next-action-hint" style="font-size:0.78rem; color:var(--text2); display:inline-flex; align-items:center; gap:4px;"><i class="fa-solid fa-arrow-right-long" style="opacity:0.6; font-size:0.7rem;"></i> ${FinanceFormat.escapeHtml(inv.next_action)}</span>`
          : `<span style="opacity:0.4;">—</span>`;

        return `
    <tr data-record-id="${inv.id}">
      <td><strong>${inv.invoice_number}</strong>${discrepancyBadge}</td>
      <td>${inv.customer_name || "—"}</td>
      <td>${routeDisplay}</td>
      <td>${FinanceFormat.formatFinanceDate(inv.issue_date)}</td>
      <td>${dueDateDisplay}</td>
      <td class="cell-money"><strong>${FinanceFormat.renderMoneyHtml(inv.total, inv.currency || "USD")}</strong></td>
      <td class="cell-money">${FinanceFormat.renderMoneyHtml(amountPaid, inv.currency || "USD")}</td>
      <td class="cell-money" style="${balance > 0 ? 'font-weight:700; color:var(--text);' : 'opacity:0.6;'}">${FinanceFormat.renderMoneyHtml(balance, inv.currency || "USD")}</td>
      <td>${FinanceFormat.formatStatusBadge("invoice", derivedStatus)}</td>
      <td>${nextActionDisplay}</td>
      <td style="display:flex; gap:6px; flex-wrap:wrap;">
        <button class="btn btn-sm btn-outline btn-view-invoice" onclick="FinanceDrawer.open('invoice', ${inv.id}, this)" title="View Details & Timeline" aria-label="View Invoice ${inv.invoice_number} details"><i class="fa-solid fa-eye"></i></button>
        ${inv.status !== "void" ? `<button class="btn btn-sm" onclick="openEditInvoiceModal(${inv.id})" title="Edit Invoice"><i class="fa-solid fa-pen"></i></button>` : ""}
        ${(derivedStatus === "sent" || derivedStatus === "overdue" || (balance > 0 && inv.status !== "draft" && inv.status !== "void")) ? `<button class="btn btn-sm btn-fill" onclick="openPaymentModal(${inv.id})" title="Record Payment"><i class="fa-solid fa-money-bill-wave"></i> Pay</button>` : ""}
        ${(inv.status === "draft" || inv.status === "sent") ? `<button class="btn btn-sm btn-danger" onclick="confirmVoidInvoice(${inv.id})" title="Void Invoice"><i class="fa-solid fa-ban"></i></button>` : ""}
      </td>
    </tr>
  `;
      }
    )
    .join("");
}

function filterFinanceInvoices(query) {
  const state = FinanceTable.getState("finance_invoices");
  state.page = 1;
  FinanceTable.saveState("finance_invoices", state);
  applyAndRenderInvoices();
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
  FinanceForm.clearErrors("invoiceModal");
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
  FinanceForm.clearErrors("invoiceModal");
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

  const isValid = FinanceForm.validateRequiredFields("invoiceModal", [
    { id: "invoiceCustomerId", label: "Customer" },
    { id: "invoiceNumber", label: "Invoice Number" },
    { id: "invoiceIssueDate", label: "Issue Date" },
    { id: "invoiceDueDate", label: "Due Date" },
  ]);
  if (!isValid) return;

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
  const inv = (FinanceState.invoices || []).find((i) => i.id === parseInt(invoiceId, 10));
  const invSummary = inv
    ? `<strong>${inv.invoice_number}</strong> · ${inv.customer_name || "Customer"} · ${FinanceFormat.renderMoneyHtml(inv.total || 0, inv.currency || "USD")}`
    : `Invoice #${invoiceId}`;

  const result = await FinanceCommand.confirmAction({
    title: "Void Sales Invoice",
    summary: invSummary,
    consequence: "Voiding will mark this invoice as void and cancel pending receivables. This cannot be undone.",
    actionLabel: "Void Invoice",
    actionClass: "btn btn-danger",
    requireReason: true,
    severity: "danger",
  });
  if (!result.confirmed) return;

  try {
    await FinanceApi.voidInvoice(invoiceId, result.reason);
    showToast("Invoice voided successfully", "success");
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
  FinanceForm.clearErrors("invoicePaymentModal");
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

  const isValid = FinanceForm.validateRequiredFields("invoicePaymentModal", [
    { id: "paymentBankAccountId", label: "Bank Account" },
    { id: "paymentAmount", label: "Payment Amount", check: (v) => parseFloat(v) > 0, message: "Enter a valid payment amount greater than 0." },
    { id: "paymentDate", label: "Payment Date" },
  ]);
  if (!isValid) return;

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
    if (tabInv) {
      tabInv.classList.remove("active");
      tabInv.setAttribute("aria-selected", "false");
      tabInv.setAttribute("tabindex", "-1");
    }
    if (tabCust) {
      tabCust.classList.add("active");
      tabCust.setAttribute("aria-selected", "true");
      tabCust.setAttribute("tabindex", "0");
    }
    if (boxInv) boxInv.style.display = "none";
    if (statusFilter) statusFilter.style.display = "none";
    if (boxCust) boxCust.style.display = "block";
    if (conInv) conInv.style.display = "none";
    if (conCust) conCust.style.display = "block";
    if (addCustBtn) addCustBtn.style.display = "inline-flex";
    if (newInvBtn) newInvBtn.style.display = "none";
    loadFinanceCustomers();
  } else {
    if (tabInv) {
      tabInv.classList.add("active");
      tabInv.setAttribute("aria-selected", "true");
      tabInv.setAttribute("tabindex", "0");
    }
    if (tabCust) {
      tabCust.classList.remove("active");
      tabCust.setAttribute("aria-selected", "false");
      tabCust.setAttribute("tabindex", "-1");
    }
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
      <td>${c.contact_email ? `<a href="mailto:${c.contact_email}">${c.contact_email}</a>` : "—"}</td>
      <td>${c.contact_phone || "—"}</td>
      <td><code>${c.tax_id || "—"}</code></td>
      <td>${FinanceFormat.formatStatusBadge("customer", c.is_active ? "active" : "inactive")}</td>
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
  FinanceForm.clearErrors("customerModal");
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
  FinanceForm.clearErrors("customerModal");
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
  const isValid = FinanceForm.validateRequiredFields("customerModal", [
    { id: "fCustomerName", label: "Company / Customer Name" }
  ]);
  if (!isValid) return;
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
  const cust = (FinanceState.customers || []).find((c) => c.id === parseInt(id, 10));
  const action = currentlyActive ? "deactivate" : "activate";

  const result = await FinanceCommand.confirmAction({
    title: `${currentlyActive ? "Deactivate" : "Reactivate"} Customer`,
    summary: cust ? `<strong>${cust.name}</strong>` : `Customer #${id}`,
    consequence: currentlyActive
      ? "Deactivating will hide this customer from new invoice selectors. Existing invoices are preserved."
      : "Reactivating will make this customer selectable again on invoices.",
    actionLabel: currentlyActive ? "Deactivate Customer" : "Reactivate Customer",
    actionClass: currentlyActive ? "btn btn-danger" : "btn btn-primary",
    requireReason: false,
    severity: currentlyActive ? "warning" : "info",
  });
  if (!result.confirmed) return;

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


// Window exports for Sales Invoices & Customers
window.loadFinanceInvoices = loadFinanceInvoices;
window.setInvoiceWorkQueue = setInvoiceWorkQueue;
window.onInvoiceStatusFilterChange = onInvoiceStatusFilterChange;
window.filterFinanceInvoices = filterFinanceInvoices;
window.openAddInvoiceModal = openAddInvoiceModal;
window.openEditInvoiceModal = openEditInvoiceModal;
window.closeInvoiceModal = closeInvoiceModal;
window.addInvoiceLine = addInvoiceLine;
window.saveInvoiceModal = saveInvoiceModal;
window.confirmVoidInvoice = confirmVoidInvoice;
window.openPaymentModal = openPaymentModal;
window.closeInvoicePaymentModal = closeInvoicePaymentModal;
window.saveInvoicePayment = saveInvoicePayment;
window.switchInvoiceSubTab = switchInvoiceSubTab;
window.loadFinanceCustomers = loadFinanceCustomers;
window.filterFinanceCustomers = filterFinanceCustomers;
window.openAddCustomerModal = openAddCustomerModal;
window.openEditCustomerModal = openEditCustomerModal;
window.saveCustomer = saveCustomer;
window.toggleCustomerActive = toggleCustomerActive;
