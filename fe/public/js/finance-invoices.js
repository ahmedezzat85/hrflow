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
        ${inv.status === "draft" ? `<button class="btn btn-sm btn-outline" onclick="sendInvoiceAction(${inv.id})" title="Approve & Send Invoice" aria-label="Send Invoice ${inv.invoice_number}"><i class="fa-solid fa-paper-plane"></i></button>` : ""}
        ${(derivedStatus === "overdue" || derivedStatus === "sent") ? `<button class="btn btn-sm btn-outline btn-send-reminder" onclick="sendInvoiceReminderAction(${inv.id})" title="Send Reminder" aria-label="Send reminder for invoice ${inv.invoice_number}"><i class="fa-solid fa-bell"></i></button>` : ""}
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

let _invoiceDraftAutoSaveBound = false;
function _ensureInvoiceDraftAutoSave() {
  if (_invoiceDraftAutoSaveBound) return;
  const modal = document.getElementById("invoiceModal");
  if (!modal) return;
  const handler = () => _saveInvoiceDraftToStorage();
  modal.addEventListener("input", handler);
  modal.addEventListener("change", handler);
  _invoiceDraftAutoSaveBound = true;
}

function _saveInvoiceDraftToStorage() {
  const modalId = document.getElementById("invoiceModalId")?.value;
  if (modalId) return; // Only auto-save newly drafted invoices

  const customerId = document.getElementById("invoiceCustomerId")?.value || "";
  const invoiceNumber = document.getElementById("invoiceNumber")?.value || "";
  const issueDate = document.getElementById("invoiceIssueDate")?.value || "";
  const dueDate = document.getElementById("invoiceDueDate")?.value || "";
  const status = document.getElementById("invoiceStatus")?.value || "draft";
  const currency = document.getElementById("invoiceCurrency")?.value || "USD";
  const expectedBank = document.getElementById("invoiceExpectedBankAccount")?.value || "";
  const revenueChannel = document.getElementById("invoiceRevenueChannel")?.value || "";
  const notes = document.getElementById("invoiceNotes")?.value || "";

  const lines = [];
  document.querySelectorAll("#invoiceLinesBody tr").forEach((r) => {
    const desc = r.querySelector("input[type='text']")?.value || "";
    const qty = parseFloat(r.querySelector(".inv-qty")?.value) || 1;
    const price = parseFloat(r.querySelector(".inv-price")?.value) || 0;
    const total = parseFloat(r.querySelector(".inv-total")?.value) || (qty * price);
    if (desc || price > 0) {
      lines.push({ description: desc, quantity: qty, unit_price: price, line_total: total });
    }
  });

  if (customerId || invoiceNumber || notes || lines.length > 0) {
    try {
      localStorage.setItem(
        "hrflow_invoice_draft",
        JSON.stringify({ customerId, invoiceNumber, issueDate, dueDate, status, currency, expectedBank, revenueChannel, notes, lines })
      );
    } catch (_) {}
  }
}

function resumeInvoiceDraft() {
  try {
    const raw = localStorage.getItem("hrflow_invoice_draft");
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.customerId) document.getElementById("invoiceCustomerId").value = d.customerId;
    if (d.invoiceNumber) document.getElementById("invoiceNumber").value = d.invoiceNumber;
    if (d.issueDate) document.getElementById("invoiceIssueDate").value = d.issueDate;
    if (d.dueDate) document.getElementById("invoiceDueDate").value = d.dueDate;
    if (d.status) document.getElementById("invoiceStatus").value = d.status;
    if (d.currency) document.getElementById("invoiceCurrency").value = d.currency;
    if (d.expectedBank && document.getElementById("invoiceExpectedBankAccount")) {
      document.getElementById("invoiceExpectedBankAccount").value = d.expectedBank;
    }
    if (d.revenueChannel && document.getElementById("invoiceRevenueChannel")) {
      document.getElementById("invoiceRevenueChannel").value = d.revenueChannel;
    }
    if (d.notes) document.getElementById("invoiceNotes").value = d.notes;

    if (Array.isArray(d.lines) && d.lines.length > 0) {
      document.getElementById("invoiceLinesBody").innerHTML = "";
      d.lines.forEach((ln) => addInvoiceLine(ln));
    }
    _updateInvoiceTotals();
    const banner = document.getElementById("invoiceDraftResumeBanner");
    if (banner) banner.style.display = "none";
    showToast("Draft resumed successfully", "info");
  } catch (_) {}
}

function discardInvoiceDraft() {
  try {
    localStorage.removeItem("hrflow_invoice_draft");
  } catch (_) {}
  const banner = document.getElementById("invoiceDraftResumeBanner");
  if (banner) banner.style.display = "none";
  showToast("Draft discarded", "info");
}

async function openAddInvoiceModal() {
  FinanceForm.clearErrors("invoiceModal");
  _populateInvoiceCustomerDropdown();
  _populateInvoiceBankDropdown();
  _ensureInvoiceDraftAutoSave();

  document.getElementById("invoiceModalTitleText").textContent = "New Sales Invoice";
  document.getElementById("invoiceModalId").value = "";

  const invNumEl = document.getElementById("invoiceNumber");
  if (invNumEl) {
    invNumEl.value = "";
    invNumEl.readOnly = false;
    invNumEl.style.backgroundColor = "";
  }
  const lockNote = document.getElementById("invoiceNumberImmutableNote");
  if (lockNote) lockNote.style.display = "none";

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

  const savedDraft = localStorage.getItem("hrflow_invoice_draft");
  const banner = document.getElementById("invoiceDraftResumeBanner");
  if (savedDraft && banner) {
    banner.style.display = "flex";
  } else if (banner) {
    banner.style.display = "none";
  }

  openModal("invoiceModal");
}

async function openEditInvoiceModal(invoiceId) {
  FinanceForm.clearErrors("invoiceModal");
  _populateInvoiceCustomerDropdown();
  await _populateInvoiceBankDropdown();
  _ensureInvoiceDraftAutoSave();

  const banner = document.getElementById("invoiceDraftResumeBanner");
  if (banner) banner.style.display = "none";

  try {
    const inv = await FinanceApi.getInvoice(invoiceId);
    document.getElementById("invoiceModalTitleText").textContent = `Edit Invoice ${inv.invoice_number}`;
    document.getElementById("invoiceModalId").value = inv.id;

    const isIssued = inv.status === "sent" || inv.status === "paid";
    const invNumEl = document.getElementById("invoiceNumber");
    if (invNumEl) {
      invNumEl.value = inv.invoice_number;
      invNumEl.readOnly = isIssued;
      invNumEl.style.backgroundColor = isIssued ? "var(--surface2, #f1f5f9)" : "";
    }
    const lockNote = document.getElementById("invoiceNumberImmutableNote");
    if (lockNote) lockNote.style.display = isIssued ? "block" : "none";

    document.getElementById("invoiceCustomerId").value = inv.customer_id;
    document.getElementById("invoiceIssueDate").value = inv.issue_date || "";
    document.getElementById("invoiceDueDate").value = inv.due_date || "";
    document.getElementById("invoiceStatus").value = inv.status === "draft" ? "draft" : "sent";
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

async function saveInvoiceModal(targetStatus) {
  if (targetStatus) {
    const stEl = document.getElementById("invoiceStatus");
    if (stEl) stEl.value = targetStatus;
  }

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

  if (issueDate && dueDate && dueDate < issueDate) {
    FinanceForm.showFieldError("invoiceDueDate", "Due date cannot precede issue date");
    showToast("Due date cannot precede issue date", "error");
    return;
  }

  const lines = [];
  document.querySelectorAll("#invoiceLinesBody tr").forEach((r) => {
    const desc = r.querySelector("input[type='text']")?.value.trim();
    const qty = parseFloat(r.querySelector(".inv-qty")?.value) || 1;
    const price = parseFloat(r.querySelector(".inv-price")?.value) || 0;
    const total = parseFloat(r.querySelector(".inv-total")?.value) || (qty * price);
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
  const draftBtn = document.getElementById("invoiceSaveDraftBtn");
  if (btn) btn.disabled = true;
  if (draftBtn) draftBtn.disabled = true;

  try {
    if (invoiceId) {
      await FinanceApi.updateInvoice(invoiceId, payload);
      showToast("Invoice updated", "success");
    } else {
      await FinanceApi.createInvoice(payload);
      showToast(payload.status === "sent" ? "Invoice created and issued" : "Invoice draft saved", "success");
      try { localStorage.removeItem("hrflow_invoice_draft"); } catch (_) {}
    }
    closeInvoiceModal();
    loadFinanceInvoices();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  } finally {
    if (btn) btn.disabled = false;
    if (draftBtn) draftBtn.disabled = false;
  }
}

async function sendInvoiceAction(invoiceId) {
  try {
    await FinanceApi.sendInvoice(invoiceId);
    showToast("Invoice issued successfully", "success");
    loadFinanceInvoices();
  } catch (err) {
    showToast("Failed to send invoice: " + (err.message || err), "error");
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

  const derivedStatus = inv ? FinanceFormat.getDerivedInvoiceStatus(inv) : "";
  const amountPaid = inv ? (inv.amount_paid !== undefined ? inv.amount_paid : (inv.total && derivedStatus === "paid" ? inv.total : 0.0)) : 0.0;
  const balance = inv ? (inv.balance !== undefined ? inv.balance : Math.max(0, (inv.total || 0) - amountPaid)) : 0.0;

  const infoEl = document.getElementById("paymentInvoiceInfo");
  if (infoEl && inv) {
    infoEl.innerHTML = `Invoice <strong>${inv.invoice_number}</strong> &middot; Total: ${FinanceFormat.renderMoneyHtml(inv.total, inv.currency || "USD")} &middot; Remaining Balance: <strong id="paymentRemainingBalanceDisplay">${FinanceFormat.renderMoneyHtml(balance, inv.currency || "USD")}</strong>`;
  }
  const amtInput = document.getElementById("paymentAmount");
  if (amtInput) {
    amtInput.value = balance > 0 ? balance.toFixed(2) : "";
    amtInput.max = balance > 0 ? String(balance) : "";
  }
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

  const inv = (FinanceState.invoices || []).find((i) => i.id === parseInt(invoiceId, 10));
  if (inv) {
    const derivedStatus = FinanceFormat.getDerivedInvoiceStatus(inv);
    const amountPaid = inv.amount_paid !== undefined ? inv.amount_paid : (inv.total && derivedStatus === "paid" ? inv.total : 0.0);
    const balance = inv.balance !== undefined ? inv.balance : Math.max(0, (inv.total || 0) - amountPaid);
    if (amount > balance + 0.001) {
      FinanceForm.showFieldError("paymentAmount", `Payment amount cannot exceed remaining balance (${balance.toFixed(2)})`);
      showToast(`Payment amount exceeds remaining balance (${balance.toFixed(2)})`, "error");
      return;
    }
  }

  const payload = {
    direction: "incoming",
    amount,
    currency: (inv && inv.currency) || "USD",
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
      showToast("Payment recorded successfully", "success");
    }
    closeInvoicePaymentModal();
    loadFinanceInvoices();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  }
}

async function sendInvoiceReminderAction(invoiceId) {
  const inv = (FinanceState.invoices || []).find((i) => i.id === parseInt(invoiceId, 10));
  if (!inv) return;
  let email = (inv.customer_email || "").trim();
  if (!email && inv.customer_id) {
    let cust = (FinanceState.customers || []).find((c) => c.id === inv.customer_id);
    if (!cust) {
      try {
        cust = await FinanceApi.getCustomer(inv.customer_id);
      } catch (_) {}
    }
    if (cust && cust.contact_email) {
      email = cust.contact_email.trim();
    }
  }
  if (!email) {
    await FinanceCommand.confirmAction({
      title: "Cannot Send Reminder",
      summary: `<strong>${inv.invoice_number}</strong> · ${inv.customer_name || "Customer"}`,
      consequence: "This customer has no contact email address on file. Please edit the customer profile and add a billing email before sending reminders.",
      actionLabel: "Understood",
      actionClass: "btn btn-fill",
      requireReason: false,
      severity: "warning",
    });
    return;
  }

  const res = await FinanceCommand.confirmAction({
    title: "Send Payment Reminder",
    summary: `<strong>${inv.invoice_number}</strong> · ${inv.customer_name || "Customer"} · Recipient: <strong>${email}</strong>`,
    consequence: "An overdue payment reminder and collection instructions will be dispatched to the customer's email.",
    actionLabel: "Send Reminder",
    actionClass: "btn btn-fill",
    requireReason: false,
    severity: "info",
  });
  if (!res.confirmed) return;

  try {
    const resp = await FinanceApi.sendInvoiceReminder(invoiceId);
    showToast(resp.message || "Reminder sent successfully", "success");
  } catch (err) {
    showToast("Failed to send reminder: " + (err.message || err), "error");
  }
}

async function reversePaymentAction(invoiceId, paymentId) {
  const res = await FinanceCommand.confirmAction({
    title: "Reverse Payment",
    summary: `Payment #${paymentId} against Invoice #${invoiceId}`,
    consequence: "Reversing this payment will restore the outstanding balance on the invoice, debit the bank account balance, and create an audit log and reversing ledger entry.",
    actionLabel: "Reverse Payment",
    actionClass: "btn btn-danger",
    requireReason: true,
    severity: "danger",
  });
  if (!res.confirmed) return;

  try {
    await FinanceApi.reverseInvoicePayment(invoiceId, paymentId, res.reason);
    showToast("Payment reversed successfully", "success");
    loadFinanceInvoices();
  } catch (err) {
    showToast("Failed to reverse payment: " + (err.message || err), "error");
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

  tbody.innerHTML = items.map((c) => {
    const termsBadge = `<span class="badge badge-grey">Net ${c.payment_terms_days !== undefined && c.payment_terms_days !== null ? c.payment_terms_days : 30}</span>`;
    const taxHtml = c.tax_id ? `<div style="margin-top:2px;"><code style="font-size:11px;">${c.tax_id}</code></div>` : "";
    const contactHtml = `
      <div>${c.contact_email ? `<a href="mailto:${c.contact_email}">${c.contact_email}</a>` : "—"}</div>
      ${c.contact_phone ? `<div style="font-size:11px; color:var(--text3);">${c.contact_phone}</div>` : ""}
    `;
    const receivablesSummary = `
      <button type="button" class="btn btn-xs btn-ghost" onclick="openCustomer360Drawer(${c.id})" title="View complete 360 overview & invoices">
        <i class="fa-solid fa-chart-pie" style="color:var(--primary, #3b82f6);"></i> View 360
      </button>
    `;

    return `
      <tr data-customer-id="${c.id}">
        <td>
          <a href="javascript:void(0)" class="table-entity-link" onclick="openCustomer360Drawer(${c.id})" style="font-weight:600; text-decoration:underline;">${c.name}</a>
          ${c.notes ? `<div style="font-size:11px;color:var(--text3); max-width:260px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${c.notes}</div>` : ""}
        </td>
        <td><span style="font-size:12px; color:var(--text2);">${c.legal_name || "—"}</span></td>
        <td>${contactHtml}</td>
        <td>${termsBadge}${taxHtml}</td>
        <td>${receivablesSummary}</td>
        <td>${FinanceFormat.formatStatusBadge("customer", c.is_active ? "active" : "inactive")}</td>
        <td>
          <div style="display:flex;gap:6px;">
            <button class="btn btn-sm btn-icon" title="View Customer 360 Profile" onclick="openCustomer360Drawer(${c.id})" aria-label="Customer 360">
              <i class="fa-solid fa-address-card"></i>
            </button>
            <button class="btn btn-sm btn-icon" title="Edit Customer" onclick="openEditCustomerModal(${c.id})" aria-label="Edit Customer">
              <i class="fa-solid fa-pen-to-square"></i>
            </button>
            <button class="btn btn-sm btn-icon ${c.is_active ? "btn-danger" : ""}" title="${c.is_active ? "Deactivate" : "Activate"}" onclick="toggleCustomerActive(${c.id}, ${c.is_active})" aria-label="${c.is_active ? "Deactivate" : "Activate"}">
              <i class="fa-solid ${c.is_active ? "fa-ban" : "fa-check"}"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function openCustomer360Drawer(customerId) {
  const drawer = window.FinanceDrawer || window.FinanceDetailDrawer;
  if (drawer && drawer.open) {
    drawer.open("customer", customerId);
  }
}
window.openCustomer360Drawer = openCustomer360Drawer;

let _customerDuplicateDebounce = null;
async function onCustomerFieldInput() {
  clearTimeout(_customerDuplicateDebounce);
  _customerDuplicateDebounce = setTimeout(async () => {
    const banner = document.getElementById("customerDuplicateBanner");
    const bannerText = document.getElementById("customerDuplicateText");
    if (!banner) return;

    const idVal = document.getElementById("fCustomerId")?.value;
    const name = document.getElementById("fCustomerName")?.value.trim() || "";
    const legal_name = document.getElementById("fCustomerLegalName")?.value.trim() || "";
    const contact_email = document.getElementById("fCustomerEmail")?.value.trim() || "";
    const tax_id = document.getElementById("fCustomerTaxId")?.value.trim() || "";

    if (!name && !legal_name && !contact_email && !tax_id) {
      banner.style.display = "none";
      return;
    }

    try {
      const res = await FinanceApi.checkDuplicateCustomers({
        name,
        legal_name,
        contact_email,
        tax_id,
        exclude_id: idVal ? parseInt(idVal, 10) : undefined,
      });
      const candidates = Array.isArray(res) ? res : ((res && res.candidates) || []);
      if (candidates.length > 0) {
        const top = candidates[0];
        banner.style.display = "block";
        if (bannerText) {
          const fld = top.matched_field || top.matching_field || "identity";
          const val = top[fld] || top.name;
          bannerText.innerHTML = `Existing customer <strong>"${top.name}"</strong> matches on <em>${fld}</em> (${val}).`;
        }
      } else {
        banner.style.display = "none";
      }
    } catch (err) {
      console.warn("Failed duplicate check:", err);
    }
  }, 250);
}
window.onCustomerFieldInput = onCustomerFieldInput;

function filterFinanceCustomers(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return renderFinanceCustomers(FinanceState.customers);
  renderFinanceCustomers(
    FinanceState.customers.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.legal_name && c.legal_name.toLowerCase().includes(q)) ||
        (c.contact_email && c.contact_email.toLowerCase().includes(q)) ||
        (c.tax_id && c.tax_id.toLowerCase().includes(q))
    )
  );
}

function openAddCustomerModal() {
  FinanceForm.clearErrors("customerModal");
  document.getElementById("fCustomerId").value = "";
  document.getElementById("fCustomerName").value = "";
  if (document.getElementById("fCustomerLegalName")) document.getElementById("fCustomerLegalName").value = "";
  document.getElementById("fCustomerEmail").value = "";
  document.getElementById("fCustomerPhone").value = "";
  document.getElementById("fCustomerTaxId").value = "";
  if (document.getElementById("fCustomerTerms")) document.getElementById("fCustomerTerms").value = "30";
  if (document.getElementById("fCustomerCurrency")) document.getElementById("fCustomerCurrency").value = "USD";
  if (document.getElementById("fCustomerCountry")) document.getElementById("fCustomerCountry").value = "Egypt";
  if (document.getElementById("fCustomerOwner")) document.getElementById("fCustomerOwner").value = "";
  if (document.getElementById("fCustomerAddress")) document.getElementById("fCustomerAddress").value = "";
  document.getElementById("fCustomerNotes").value = "";

  const banner = document.getElementById("customerDuplicateBanner");
  if (banner) banner.style.display = "none";

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
  if (document.getElementById("fCustomerLegalName")) document.getElementById("fCustomerLegalName").value = c.legal_name || "";
  document.getElementById("fCustomerEmail").value = c.contact_email || "";
  document.getElementById("fCustomerPhone").value = c.contact_phone || "";
  document.getElementById("fCustomerTaxId").value = c.tax_id || "";
  if (document.getElementById("fCustomerTerms")) document.getElementById("fCustomerTerms").value = c.payment_terms_days !== undefined && c.payment_terms_days !== null ? c.payment_terms_days : 30;
  if (document.getElementById("fCustomerCurrency")) document.getElementById("fCustomerCurrency").value = c.default_currency || "USD";
  if (document.getElementById("fCustomerCountry")) document.getElementById("fCustomerCountry").value = c.country || "Egypt";
  if (document.getElementById("fCustomerOwner")) document.getElementById("fCustomerOwner").value = c.owner || "";
  if (document.getElementById("fCustomerAddress")) document.getElementById("fCustomerAddress").value = c.billing_address || "";
  document.getElementById("fCustomerNotes").value = c.notes || "";

  const banner = document.getElementById("customerDuplicateBanner");
  if (banner) banner.style.display = "none";

  const title = document.getElementById("customerModalTitle");
  if (title) title.textContent = "Edit Customer";
  const btn = document.getElementById("customerSaveBtn");
  if (btn) btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Update Customer`;
  openModal("customerModal");
}

async function saveCustomer() {
  const idVal = document.getElementById("fCustomerId").value;
  const name = document.getElementById("fCustomerName").value.trim();
  const legal_name = document.getElementById("fCustomerLegalName") ? document.getElementById("fCustomerLegalName").value.trim() : "";
  const contact_email = document.getElementById("fCustomerEmail").value.trim();
  const contact_phone = document.getElementById("fCustomerPhone").value.trim();
  const tax_id = document.getElementById("fCustomerTaxId").value.trim();
  const terms = document.getElementById("fCustomerTerms") ? document.getElementById("fCustomerTerms").value : "30";
  const currency = document.getElementById("fCustomerCurrency") ? document.getElementById("fCustomerCurrency").value : "USD";
  const country = document.getElementById("fCustomerCountry") ? document.getElementById("fCustomerCountry").value.trim() : "Egypt";
  const owner = document.getElementById("fCustomerOwner") ? document.getElementById("fCustomerOwner").value.trim() : "";
  const address = document.getElementById("fCustomerAddress") ? document.getElementById("fCustomerAddress").value.trim() : "";
  const notes = document.getElementById("fCustomerNotes").value.trim();

  const isValid = FinanceForm.validateRequiredFields("customerModal", [
    { id: "fCustomerName", label: "Company / Customer Name" }
  ]);
  if (!isValid) return;

  const payload = {
    name,
    legal_name: legal_name || null,
    contact_email: contact_email || null,
    contact_phone: contact_phone || null,
    tax_id: tax_id || null,
    payment_terms_days: terms ? parseInt(terms, 10) : 30,
    default_currency: currency || "USD",
    country: country || "Egypt",
    owner: owner || null,
    billing_address: address || null,
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
    if (typeof _populateInvoiceCustomerDropdown === "function") {
      _populateInvoiceCustomerDropdown();
    }
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
    if (typeof _populateInvoiceCustomerDropdown === "function") {
      _populateInvoiceCustomerDropdown();
    }
  } catch (err) {
    showToast(err.message || "Failed to update customer status", "error");
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
window.sendInvoiceAction = sendInvoiceAction;
window.sendInvoiceReminderAction = sendInvoiceReminderAction;
window.reversePaymentAction = reversePaymentAction;
window.switchInvoiceSubTab = switchInvoiceSubTab;
window.loadFinanceCustomers = loadFinanceCustomers;
window.filterFinanceCustomers = filterFinanceCustomers;
window.openAddCustomerModal = openAddCustomerModal;
window.openEditCustomerModal = openEditCustomerModal;
window.saveCustomer = saveCustomer;
window.toggleCustomerActive = toggleCustomerActive;
window.openCustomer360Drawer = openCustomer360Drawer;
window.onCustomerFieldInput = onCustomerFieldInput;

