// ==========================================
// 2. Sales Invoices
// ==========================================
let _invoiceTableInitialized = false;
let _currentInvoiceWorkQueue = "all";
let _invoiceOverdueOnly = false;
const _INVOICE_QUEUES = ["all", "draft", "sent", "partially_paid", "paid", "void"];

function setInvoiceWorkQueue(queue) {
  _currentInvoiceWorkQueue = _INVOICE_QUEUES.includes(queue) ? queue : "all";
  _updateInvoiceWorkQueueTabsUi(_currentInvoiceWorkQueue);
  const state = FinanceTable.getState("finance_invoices");
  state.page = 1;
  FinanceTable.saveState("finance_invoices", state);
  applyAndRenderInvoices();
}

function onInvoiceOverdueOnlyChange(checked) {
  _invoiceOverdueOnly = !!checked;
  const state = FinanceTable.getState("finance_invoices");
  state.page = 1;
  FinanceTable.saveState("finance_invoices", state);
  applyAndRenderInvoices();
}

function _updateInvoiceWorkQueueTabsUi(activeQueue) {
  const tabs = document.querySelectorAll("#financeInvoiceWorkQueueTabs .filter-tab");
  tabs.forEach((tab) => {
    const isMatch = tab.dataset.queue === activeQueue;
    tab.classList.toggle("active", isMatch);
    tab.setAttribute("aria-selected", isMatch ? "true" : "false");
    tab.setAttribute("tabindex", isMatch ? "0" : "-1");
  });
}

// Pill and toggle counts come from the whole list, whatever the current filter.
function _updateInvoiceCounts(all) {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const n = (st) => all.filter((i) => FinanceFormat.getDerivedInvoiceStatus(i) === st).length;
  set("badgeQueueAll", all.length);
  set("badgeQueueDraft", n("draft"));
  set("badgeQueueSent", n("sent"));
  set("badgeQueuePartiallyPaid", n("partially_paid"));
  set("badgeQueuePaid", n("paid"));
  set("badgeQueueVoid", n("void"));
  set("financeInvoiceOverdueCount", all.filter((i) => i.is_overdue).length);
  document.querySelectorAll("#financeInvoiceWorkQueueTabs .fv-pill").forEach((pill) => {
    const c = Number((pill.querySelector(".fv-pill__count") || {}).textContent || 0);
    pill.classList.toggle("fv-pill--zero", !c);
  });
}

async function loadFinanceInvoices() {
  const bar = document.getElementById("financeInvoicesLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const cachedState = FinanceTable.getState("finance_invoices");
    const searchInput = document.getElementById("financeInvoiceSearch");

    if (!_invoiceTableInitialized) {
      // A saved filter from the old tab layout (open, awaiting_payment, overdue) falls back to All.
      const saved = cachedState.filters?.status;
      _currentInvoiceWorkQueue = _INVOICE_QUEUES.includes(saved) ? saved : "all";
      if (cachedState.filters?.search && searchInput) {
        searchInput.value = cachedState.filters.search;
      }
      _updateInvoiceWorkQueueTabsUi(_currentInvoiceWorkQueue);
      _invoiceTableInitialized = true;
    }

    // The whole list is loaded: pills, counts and the overdue toggle filter on the client.
    const items = await FinanceApi.getInvoices();
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
  const searchInput = document.getElementById("financeInvoiceSearch");
  const currentSearch = searchInput ? searchInput.value.trim() : "";

  state.filters = {
    status: _currentInvoiceWorkQueue,
    ...(currentSearch ? { search: currentSearch } : {}),
  };

  const all = FinanceState.invoices || [];
  _updateInvoiceCounts(all);

  let items = all;
  if (_currentInvoiceWorkQueue !== "all") {
    items = items.filter((inv) => FinanceFormat.getDerivedInvoiceStatus(inv) === _currentInvoiceWorkQueue);
  }
  if (_invoiceOverdueOnly) {
    items = items.filter((inv) => inv.is_overdue);
  }
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

  FinanceTable.bindSortHeaders("financeInvoicesTable", (col, dir) => {
    state.sortBy = col;
    state.sortDir = dir;
    FinanceTable.saveState("finance_invoices", state);
    applyAndRenderInvoices();
  }, { sortBy: state.sortBy, sortDir: state.sortDir });

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

  // Outstanding balance of the listed invoices, one figure per currency (never summed across currencies).
  const summary = document.querySelector("#financeInvoicesPagination .pagination-summary");
  if (summary) {
    const open = items.filter((inv) => ["sent", "partially_paid"].includes(FinanceFormat.getDerivedInvoiceStatus(inv)));
    const byCur = {};
    open.forEach((inv) => {
      const cur = inv.currency || "USD";
      const bal = inv.balance !== undefined ? inv.balance : Math.max(0, (inv.total || 0) - (inv.amount_paid || 0));
      byCur[cur] = (byCur[cur] || 0) + Number(bal || 0);
    });
    const parts = Object.entries(byCur).map(([cur, v]) => `<span class="fv-foot__total">${FinanceUI.moneyHtml(v, cur)}</span>`);
    if (parts.length) summary.insertAdjacentHTML("beforeend", ` &middot; ${parts.join(" + ")} outstanding`);
  }

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

  const esc = FinanceUI.esc;
  tbody.innerHTML = items
    .map((inv) => {
      const cur = inv.currency || "USD";
      const derivedStatus = FinanceFormat.getDerivedInvoiceStatus(inv);
      const amountPaid = inv.amount_paid !== undefined ? inv.amount_paid : (inv.total && derivedStatus === "paid" ? inv.total : 0.0);
      const balance = inv.balance !== undefined ? inv.balance : Math.max(0, (inv.total || 0) - amountPaid);
      const daysOverdue = inv.days_overdue || 0;
      const lateNote = inv.is_overdue && daysOverdue > 0 ? `${daysOverdue} ${daysOverdue === 1 ? "day" : "days"} late` : "";
      const paidPct = inv.total > 0 && derivedStatus !== "draft" && derivedStatus !== "void" ? (Number(amountPaid) / Number(inv.total)) * 100 : null;
      const customer = inv.customer_name || "—";

      const route = (inv.revenue_channel || inv.expected_bank_account_name)
        ? `<div class="fv-date"><span>${esc(_revenueChannelLabel(inv.revenue_channel) || "–")}</span>${inv.expected_bank_account_name ? `<span class="fv-sub">${esc(inv.expected_bank_account_name)}</span>` : ""}</div>`
        : "–";
      const discrepancy = inv.has_bank_discrepancy
        ? `<span class="fv-note fv-note--warn" title="Payment received in different account than expected">Discrepancy</span>`
        : "";

      // Actions: one text button, then up to three icons (the view action is the customer name / row click)
      let primary = null;
      if (inv.status === "draft") {
        primary = { label: "Send", kind: "fill", className: "btn-send-invoice", onclick: `sendInvoiceAction(${inv.id})`, attrs: `title="Approve and issue invoice" aria-label="Send Invoice ${esc(inv.invoice_number)}"` };
      } else if ((derivedStatus === "sent" || derivedStatus === "partially_paid") && balance > 0) {
        primary = { label: "Record receipt", kind: "fill", className: "btn-record-receipt", onclick: `openPaymentModal(${inv.id})`, attrs: 'title="Record Payment"' };
      }
      const icons = [];
      if (inv.status !== "void") icons.push({ icon: "fa-pen", label: "Edit Invoice", ariaLabel: `Edit Invoice ${inv.invoice_number}`, onclick: `openEditInvoiceModal(${inv.id})` });
      if (derivedStatus === "sent" || derivedStatus === "partially_paid") icons.push({ icon: "fa-bell", label: "Send Reminder", ariaLabel: `Send reminder for invoice ${inv.invoice_number}`, className: "btn-send-reminder", onclick: `sendInvoiceReminderAction(${inv.id})` });
      if ((inv.status === "draft" || inv.status === "sent") && !(amountPaid > 0)) icons.push({ icon: "fa-ban", label: "Void Invoice", className: "fv-icon-btn--danger", onclick: `confirmVoidInvoice(${inv.id})` });

      return `
    <tr data-record-id="${inv.id}" class="is-clickable" title="${esc(inv.next_action || "")}">
      <td><div class="fv-cell-main">${FinanceUI.avatar(customer, FinanceUI.hueForId(inv.customer_id))}<div class="fv-cell-main__text"><button type="button" class="fv-name-btn btn-view-invoice" onclick="FinanceDrawer.open('invoice', ${inv.id}, this)" title="View Details & Timeline" aria-label="View Invoice ${esc(inv.invoice_number)} details">${esc(customer)}</button><span class="fv-link">${esc(inv.invoice_number)}</span>${discrepancy}</div></div></td>
      <td>${esc(FinanceUI.formatDate(inv.issue_date))}</td>
      <td>${FinanceUI.dateCell(inv.due_date, lateNote, "late", { title: lateNote })}</td>
      <td>${route}</td>
      <td>${FinanceUI.statusPill(FinanceUI.statusGroup(derivedStatus), (FinanceFormat.STATUS_MAP.invoice[derivedStatus] || {}).label || derivedStatus, `role="status"`, "status-badge-wrap")}</td>
      <td class="cell-money fv-num">${FinanceUI.amountCell(balance, cur, `of ${FinanceFormat.formatMoney(inv.total, cur)}`, paidPct)}</td>
      <td>${FinanceUI.rowActions({ primary, icons })}</td>
    </tr>
  `;
    })
    .join("");

  if (!tbody.dataset.rowClickBound) {
    tbody.dataset.rowClickBound = "1";
    tbody.addEventListener("click", (e) => {
      if (e.target.closest("button, a, input, select, label")) return;
      const tr = e.target.closest("tr[data-record-id]");
      if (!tr) return;
      const viewBtn = tr.querySelector(".btn-view-invoice");
      if (window.FinanceDrawer) FinanceDrawer.open("invoice", Number(tr.dataset.recordId), viewBtn || tr);
    });
  }
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
  _setInvoiceLocked(false);

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
  if (document.getElementById("invoiceVatRate")) document.getElementById("invoiceVatRate").value = "0";
  window._invoiceCustomerHasWht = false;
  if (document.getElementById("invoiceWhtRate")) document.getElementById("invoiceWhtRate").value = "0";
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

    const isIssued = inv.status !== "draft";
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
    if (document.getElementById("invoiceVatRate")) document.getElementById("invoiceVatRate").value = inv.vat_rate !== undefined ? inv.vat_rate : 0;
    window._invoiceCustomerHasWht = false;
    if (document.getElementById("invoiceWhtRate")) document.getElementById("invoiceWhtRate").value = inv.withholding_tax_rate || 0;
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
    _setInvoiceLocked(isIssued);
    openModal("invoiceModal");
  } catch (err) {
    showToast("Failed to load invoice: " + (err.message || err), "error");
  }
}

// D-022: once an invoice is issued its customer, currency, number, issue date and lines are locked
// (void and reissue to correct). The backend enforces this; the form only reflects it.
function _setInvoiceLocked(locked) {
  ["invoiceCustomerId", "invoiceIssueDate", "invoiceCurrency", "invoiceVatRate", "invoiceWhtRate"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = !!locked;
  });
  const body = document.getElementById("invoiceLinesBody");
  if (body) {
    body.querySelectorAll("input, button").forEach((el) => { el.disabled = !!locked; });
    body.dataset.locked = locked ? "1" : "";
  }
  const addLine = document.querySelector("#invoiceModal button[onclick='addInvoiceLine()']");
  if (addLine) addLine.disabled = !!locked;
  const statusEl = document.getElementById("invoiceStatus");
  if (statusEl) statusEl.disabled = !!locked;
  const draftBtn = document.getElementById("invoiceSaveDraftBtn");
  if (draftBtn) draftBtn.style.display = locked ? "none" : "";
  const note = document.getElementById("invoiceLockedNote");
  if (note) note.style.display = locked ? "block" : "none";
}

function closeInvoiceModal() {
  closeModal("invoiceModal");
}

function addInvoiceLine(data) {
  const tbody = document.getElementById("invoiceLinesBody");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="form-control" style="font-size:0.85rem;" aria-label="Description" placeholder="Description" value="${escapeHtml((data && data.description) || "")}" oninput="_updateInvoiceTotals()"></td>
    <td><input type="number" class="form-control inv-qty" style="font-size:0.85rem;" aria-label="Quantity" placeholder="Qty" value="${(data && data.quantity) || 1}" min="0.001" step="0.001" oninput="_autoComputeLineTotal(this); _updateInvoiceTotals();"></td>
    <td><input type="number" class="form-control inv-price" style="font-size:0.85rem;" aria-label="Unit price" placeholder="Unit price" value="${(data && data.unit_price) || 0}" min="0" step="0.01" oninput="_autoComputeLineTotal(this); _updateInvoiceTotals();"></td>
    <td><input type="number" class="form-control inv-total" style="font-size:0.85rem;" aria-label="Line total" placeholder="Total" value="${(data && data.line_total) || 0}" min="0" step="0.01" oninput="_updateInvoiceTotals()"></td>
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
  const vatEl = document.getElementById("invoiceVatDisplay");
  const totalEl = document.getElementById("invoiceTotalDisplay");
  const rate = parseFloat(document.getElementById("invoiceVatRate")?.value) || 0;
  const vat = Math.round(subtotal * rate) / 100; // D-023: VAT on the net subtotal
  if (subtotalEl) subtotalEl.textContent = subtotal.toFixed(2);
  if (vatEl) vatEl.textContent = vat.toFixed(2);
  if (totalEl) totalEl.textContent = (subtotal + vat).toFixed(2);
  // D-024: withholding tax stays invisible unless a rate is set; it is taken on the net subtotal
  const whtRate = parseFloat(document.getElementById("invoiceWhtRate")?.value) || 0;
  const whtField = document.getElementById("invoiceWhtField");
  const expWrap = document.getElementById("invoiceExpectedWrap");
  const expEl = document.getElementById("invoiceExpectedDisplay");
  const show = whtRate > 0 || window._invoiceCustomerHasWht === true;
  if (whtField) whtField.style.display = show ? "" : "none";
  if (expWrap) expWrap.style.display = whtRate > 0 ? "" : "none";
  if (expEl) expEl.textContent = (subtotal + vat - Math.round(subtotal * whtRate) / 100).toFixed(2);
}

// D-024: a draft invoice takes the customer's default withholding rate (normally 0)
async function _applyCustomerWithholding(customerId) {
  const rateEl = document.getElementById("invoiceWhtRate");
  if (!rateEl || rateEl.disabled) return;
  let rate = 0;
  try {
    const cust = (FinanceState.customers || []).find((c) => String(c.id) === String(customerId)) || (customerId ? await FinanceApi.getCustomer(customerId) : null);
    rate = (cust && cust.withholding_tax_rate) || 0;
  } catch (_) {}
  window._invoiceCustomerHasWht = rate > 0;
  rateEl.value = rate;
  _updateInvoiceTotals();
}

// D-023: a new invoice starts at 14% VAT for EGP and 0% for other currencies; the rate stays editable while Draft
function _applyDefaultInvoiceVat() {
  const rateEl = document.getElementById("invoiceVatRate");
  const cur = document.getElementById("invoiceCurrency")?.value;
  if (rateEl && !rateEl.disabled) rateEl.value = cur === "EGP" ? "14" : "0";
  _updateInvoiceTotals();
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

  // The status select is only the user's intent (save as draft / save and send); status itself is server-owned
  const sendAfterSave = document.getElementById("invoiceStatus").value === "sent";
  const payload = {
    customer_id: parseInt(customerId, 10),
    invoice_number: invoiceNumber,
    issue_date: issueDate,
    due_date: dueDate,
    currency: document.getElementById("invoiceCurrency").value,
    vat_rate: parseFloat(document.getElementById("invoiceVatRate")?.value) || 0,
    withholding_tax_rate: parseFloat(document.getElementById("invoiceWhtRate")?.value) || 0,
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
      const updated = await FinanceApi.updateInvoice(invoiceId, payload);
      if (sendAfterSave && updated && updated.status === "draft") {
        await FinanceApi.sendInvoice(invoiceId);
        showToast("Invoice updated and issued", "success");
      } else {
        showToast("Invoice updated", "success");
      }
    } else {
      const created = await FinanceApi.createInvoice(payload);
      if (sendAfterSave) {
        try {
          await FinanceApi.sendInvoice(created.id);
        } catch (sendErr) {
          showToast("Invoice saved as draft but could not be issued: " + (sendErr.message || sendErr), "error");
          closeInvoiceModal();
          loadFinanceInvoices();
          return;
        }
      }
      showToast(sendAfterSave ? "Invoice created and issued" : "Invoice draft saved", "success");
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
  // D-024: with withholding, the expected receipt is the balance minus the tax still to be withheld
  const whtLeft = inv ? Math.max(0, (inv.withholding_amount || 0) - (inv.withheld_total || 0)) : 0;
  const whtField = document.getElementById("paymentWithheldField");
  const whtInput = document.getElementById("paymentWithheldAmount");
  if (whtField) whtField.style.display = whtLeft > 0 ? "" : "none";
  if (whtInput) whtInput.value = whtLeft > 0 ? Math.min(whtLeft, balance).toFixed(2) : "0";
  const defaultReceipt = Math.max(0, balance - (whtLeft > 0 ? Math.min(whtLeft, balance) : 0));
  const amtInput = document.getElementById("paymentAmount");
  if (amtInput) {
    amtInput.value = defaultReceipt > 0 ? defaultReceipt.toFixed(2) : "";
    amtInput.max = balance > 0 ? String(balance) : "";
  }
  document.getElementById("paymentDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("paymentReference").value = "";

  const accSel = document.getElementById("paymentBankAccountId");
  if (accSel) {
    try {
      // D-022: a receipt goes into an account in the invoice's currency (no exchange rate); the server enforces it
      const allAccounts = await FinanceApi.getAccounts({ is_active: true });
      const accounts = (allAccounts || []).filter((a) => !inv || (a.currency || "").toUpperCase() === (inv.currency || "").toUpperCase());
      accSel.innerHTML = `<option value="">— Select account —</option>` + (accounts || []).map((a) => `<option value="${a.id}">${a.account_name} (${a.currency} ${Number(a.current_balance).toLocaleString("en-US", { minimumFractionDigits: 2 })})</option>`).join("");
      if (expBankId && accounts.some((a) => String(a.id) === String(expBankId))) {
        accSel.value = String(expBankId);
      }
    } catch (_) { accSel.innerHTML = "<option value=''>— No accounts available —</option>"; }
  }
  window._invoiceReceiptAccounts = accSel ? Array.from(accSel.options).filter((o) => o.value).map((o) => o.value) : [];
  await _refreshReceiptPaymentTypes();

  _checkPaymentBankDiscrepancy();
  openModal("invoicePaymentModal");
}

// Incoming payment types that fit the chosen account kind (mirrors be/finance/invoice_status.py)
const _RECEIPT_TYPE_CODES = { cash: ["CASH"], bank: ["INBOUND_TRANS"] };

async function _refreshReceiptPaymentTypes() {
  const typeSel = document.getElementById("paymentTypeId");
  if (!typeSel) return;
  const accId = document.getElementById("paymentBankAccountId")?.value;
  let kind = "bank";
  if (accId) {
    try {
      const accounts = await FinanceApi.getAccounts({ is_active: true });
      const acc = (accounts || []).find((a) => String(a.id) === String(accId));
      kind = ((acc && acc.account_type) || "bank").toLowerCase();
    } catch (_) {}
  }
  try {
    const types = await FinanceApi.getPaymentTypes({ is_active: true });
    const allowed = _RECEIPT_TYPE_CODES[kind] || [];
    const list = (types || []).filter((t) => allowed.includes(t.code));
    typeSel.innerHTML = list.map((t) => `<option value="${t.id}" data-code="${t.code}">${FinanceFormat.escapeHtml(t.name)}</option>`).join("");
  } catch (_) {
    typeSel.innerHTML = "";
  }
}

function onReceiptAccountChange() {
  _checkPaymentBankDiscrepancy();
  _refreshReceiptPaymentTypes();
}

function closeInvoicePaymentModal() {
  closeModal("invoicePaymentModal");
}

// Double-click safe: the shared submit lock ignores a second click while the request runs
function saveInvoicePayment() {
  return withSubmitLock("invoicePaymentSubmitBtn", _saveInvoicePaymentImpl);
}

async function _saveInvoicePaymentImpl() {
  const invoiceId = document.getElementById("paymentInvoiceId").value;
  const amount = parseFloat(document.getElementById("paymentAmount").value);
  const paymentDate = document.getElementById("paymentDate").value;
  const bankAccountId = document.getElementById("paymentBankAccountId").value;

  const isValid = FinanceForm.validateRequiredFields("invoicePaymentModal", [
    { id: "paymentBankAccountId", label: "Company bank account" },
    { id: "paymentAmount", label: "Payment Amount", check: (v) => parseFloat(v) > 0, message: "Enter a valid payment amount greater than 0." },
    { id: "paymentDate", label: "Payment Date" },
  ]);
  if (!isValid) return;

  const inv = (FinanceState.invoices || []).find((i) => i.id === parseInt(invoiceId, 10));
  if (inv) {
    const derivedStatus = FinanceFormat.getDerivedInvoiceStatus(inv);
    const amountPaid = inv.amount_paid !== undefined ? inv.amount_paid : (inv.total && derivedStatus === "paid" ? inv.total : 0.0);
    const balance = inv.balance !== undefined ? inv.balance : Math.max(0, (inv.total || 0) - amountPaid);
    const withheldEntered = parseFloat(document.getElementById("paymentWithheldAmount")?.value) || 0;
    if (amount + withheldEntered > balance + 0.001) {
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
    method: (document.getElementById("paymentTypeId")?.selectedOptions[0]?.dataset.code === "CASH") ? "cash" : "bank_transfer",
    reference: document.getElementById("paymentReference").value.trim(),
  };
  const paymentTypeId = document.getElementById("paymentTypeId")?.value;
  if (paymentTypeId) payload.payment_type_id = parseInt(paymentTypeId, 10);
  const withheldAmount = parseFloat(document.getElementById("paymentWithheldAmount")?.value) || 0;
  if (withheldAmount > 0) payload.withheld_amount = withheldAmount;

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
    applyAndRenderCustomers();
  } catch (err) {
    console.error("Failed to load finance customers:", err);
    showToast(describeLoadFailure("customers", err), "error");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

let _customerStatusFilter = "all";

function setCustomerStatusFilter(filter) {
  _customerStatusFilter = filter;
  document.querySelectorAll("#financeCustomerStatusPills .fv-pill").forEach((p) => {
    const on = p.dataset.filter === filter;
    p.classList.toggle("active", on);
    p.setAttribute("aria-pressed", on ? "true" : "false");
  });
  applyAndRenderCustomers();
}

function _customerLateCount(c) {
  return Array.isArray(c.receivables) ? c.receivables.reduce((n, r) => n + Number(r.overdue_count || 0), 0) : 0;
}

// BE-2 `receivables` (one entry per currency). Until the backend ships it the column shows a dash and
// the "With late invoices" pill stays hidden.
function _customerOpenBalance(c) {
  if (!Array.isArray(c.receivables)) return "–";
  const open = c.receivables.filter((r) => Number(r.open_count) > 0);
  if (!open.length) return `<div class="fv-amount"><span class="fv-amount__value fv-amount__value--none">–</span><span class="fv-sub">No open invoices</span></div>`;
  return open.map((r) => {
    const late = Number(r.overdue_count) > 0;
    const note = late
      ? `<span class="fv-note fv-note--late">${r.overdue_count} late${r.max_days_overdue ? `, ${r.max_days_overdue} days` : ""}</span>`
      : `<span class="fv-sub">${r.open_count} open ${Number(r.open_count) === 1 ? "invoice" : "invoices"}</span>`;
    return `<div class="fv-amount"><span class="fv-amount__value">${FinanceUI.moneyHtml(r.open_amount, r.currency)}</span>${note}</div>`;
  }).join("");
}

function applyAndRenderCustomers() {
  const all = FinanceState.customers || [];
  const searchEl = document.getElementById("financeCustomerSearch");
  const q = ((searchEl && searchEl.value) || "").trim().toLowerCase();

  const hasReceivables = all.some((c) => Array.isArray(c.receivables));
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const activeCount = all.filter((c) => c.is_active).length;
  setText("custPillCountAll", all.length);
  setText("custPillCountActive", activeCount);
  setText("custPillCountInactive", all.length - activeCount);
  setText("custPillCountLate", all.filter((c) => _customerLateCount(c) > 0).length);
  const latePill = document.getElementById("custPillLate");
  if (latePill) latePill.style.display = hasReceivables ? "" : "none";
  if (!hasReceivables && _customerStatusFilter === "late") _customerStatusFilter = "all";
  document.querySelectorAll("#financeCustomerStatusPills .fv-pill").forEach((p) => {
    const c = Number((p.querySelector(".fv-pill__count") || {}).textContent || 0);
    p.classList.toggle("fv-pill--zero", !c);
    const on = p.dataset.filter === _customerStatusFilter;
    p.classList.toggle("active", on);
    p.setAttribute("aria-pressed", on ? "true" : "false");
  });

  let items = all;
  if (_customerStatusFilter === "active") items = items.filter((c) => c.is_active);
  else if (_customerStatusFilter === "inactive") items = items.filter((c) => !c.is_active);
  else if (_customerStatusFilter === "late") items = items.filter((c) => _customerLateCount(c) > 0);
  if (q) {
    items = items.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.legal_name && c.legal_name.toLowerCase().includes(q)) ||
        (c.contact_email && c.contact_email.toLowerCase().includes(q)) ||
        (c.tax_id && c.tax_id.toLowerCase().includes(q))
    );
  }
  renderFinanceCustomers(items);
}

function renderFinanceCustomers(items) {
  const tbody = document.getElementById("financeCustomersTableBody");
  const empty = document.getElementById("financeCustomersEmpty");
  const footer = document.getElementById("financeCustomersFooter");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    if (footer) footer.style.display = "none";
    return;
  }
  if (empty) empty.style.display = "none";
  if (footer) {
    footer.style.display = "";
    footer.innerHTML = `<span>Showing <b>1&ndash;${items.length}</b> of <b>${items.length}</b> customers</span>`;
  }

  const esc = FinanceUI.esc;
  tbody.innerHTML = items.map((c) => {
    const terms = c.payment_terms_days !== undefined && c.payment_terms_days !== null ? c.payment_terms_days : 30;
    const contact = (c.contact_email || c.contact_phone)
      ? `<div class="fv-date">${c.contact_email ? `<a class="fv-link" href="mailto:${esc(c.contact_email)}">${esc(c.contact_email)}</a>` : "<span>–</span>"}${c.contact_phone ? `<span class="fv-sub">${esc(c.contact_phone)}</span>` : ""}</div>`
      : "–";
    return `
      <tr data-customer-id="${c.id}">
        <td><div class="fv-cell-main">${FinanceUI.avatar(c.name, FinanceUI.hueForId(c.id))}<div class="fv-cell-main__text"><a href="javascript:void(0)" class="table-entity-link fv-name-btn" onclick="openCustomer360Drawer(${c.id})">${esc(c.name)}</a>${c.legal_name ? `<span class="fv-sub">${esc(c.legal_name)}</span>` : ""}</div></div></td>
        <td>${contact}</td>
        <td><div class="fv-date"><span>Net ${terms}</span>${c.tax_id ? `<span class="fv-sub">${esc(c.tax_id)}</span>` : ""}</div></td>
        <td>${FinanceUI.statusPill(c.is_active ? "active" : "inactive", c.is_active ? "Active" : "Inactive", "", "status-badge-wrap")}</td>
        <td class="fv-num">${_customerOpenBalance(c)}</td>
        <td>${FinanceUI.rowActions({
          primary: { label: "Invoices", kind: "outline", className: "btn-customer-invoices", onclick: `openCustomer360Drawer(${c.id})`, attrs: 'title="View complete 360 overview &amp; invoices"' },
          icons: [
            { icon: "fa-pen", label: "Edit Customer", onclick: `openEditCustomerModal(${c.id})` },
            { icon: c.is_active ? "fa-power-off" : "fa-check", label: c.is_active ? "Deactivate" : "Activate", onclick: `toggleCustomerActive(${c.id}, ${c.is_active})` },
          ],
        })}</td>
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
  applyAndRenderCustomers();
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
  if (document.getElementById("fCustomerWithholding")) document.getElementById("fCustomerWithholding").value = "0";
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
  if (document.getElementById("fCustomerWithholding")) document.getElementById("fCustomerWithholding").value = c.withholding_tax_rate || 0;
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
    withholding_tax_rate: parseFloat(document.getElementById("fCustomerWithholding")?.value) || 0,
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
    actionClass: currentlyActive ? "btn btn-danger" : "btn btn-fill",
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
window.onInvoiceOverdueOnlyChange = onInvoiceOverdueOnlyChange;
window.setCustomerStatusFilter = setCustomerStatusFilter;
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

