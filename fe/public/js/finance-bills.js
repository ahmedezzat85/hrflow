// ==========================================
// 3. Vendor Bills
// ==========================================
function _billStatusBadge(status) {
  const norm = (status || "").toLowerCase();
  return (FinanceFormat.STATUS_MAP.bill[norm]?.badgeClass) || "badge-pending";
}

let _billTableInitialized = false;

async function loadFinanceBills() {
  const bar = document.getElementById("financeBillsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const cachedState = FinanceTable.getState("finance_bills");
    const statusFilter = document.getElementById("financeBillStatusFilter");
    const searchInput = document.getElementById("financeBillSearch");

    if (!_billTableInitialized) {
      if (cachedState.filters?.status && statusFilter) {
        statusFilter.value = cachedState.filters.status;
      }
      if (cachedState.filters?.search && searchInput) {
        searchInput.value = cachedState.filters.search;
      }
      _billTableInitialized = true;
    }

    const params = {};
    if (statusFilter && statusFilter.value) params.status = statusFilter.value;
    const items = await FinanceApi.getBills(Object.keys(params).length ? params : undefined);
    FinanceState.bills = items || [];
    applyAndRenderBills();
  } catch (err) {
    console.error("Failed to load vendor bills:", err);
    showToast(err.message || "Failed to load bills", "error");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function applyAndRenderBills() {
  const state = FinanceTable.getState("finance_bills");
  const statusFilter = document.getElementById("financeBillStatusFilter");
  const searchInput = document.getElementById("financeBillSearch");

  const currentStatus = statusFilter ? statusFilter.value : "";
  const currentSearch = searchInput ? searchInput.value.trim() : "";

  state.filters = {
    ...(currentStatus ? { status: currentStatus } : {}),
    ...(currentSearch ? { search: currentSearch } : {}),
  };

  let items = FinanceState.bills || [];
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    items = items.filter((bill) =>
      (bill.bill_number && bill.bill_number.toLowerCase().includes(q)) ||
      (bill.vendor_name && bill.vendor_name.toLowerCase().includes(q)) ||
      (bill.category && bill.category.toLowerCase().includes(q))
    );
  }

  if (state.sortBy) {
    items = FinanceTable.sortItems(items, state.sortBy, state.sortDir);
  }

  const meta = FinanceTable.paginate(items, state.page, state.pageSize);
  state.page = meta.page;
  state.pageSize = meta.pageSize;
  FinanceTable.saveState("finance_bills", state);

  renderFinanceBills(meta.items, items.length);

  FinanceTable.renderDensityControl("financeBillDensityControl");

  FinanceTable.bindSortHeaders("financeBillsTable", (col, dir) => {
    state.sortBy = col;
    state.sortDir = dir;
    FinanceTable.saveState("finance_bills", state);
    applyAndRenderBills();
  }, { sortBy: state.sortBy, sortDir: state.sortDir });

  FinanceTable.renderFilterChips(
    "financeBillFilterChips",
    state.filters,
    (removedKey) => {
      if (removedKey === "status" && statusFilter) {
        statusFilter.value = "";
        loadFinanceBills();
      } else if (removedKey === "search" && searchInput) {
        searchInput.value = "";
        applyAndRenderBills();
      }
    },
    () => {
      if (statusFilter) statusFilter.value = "";
      if (searchInput) searchInput.value = "";
      loadFinanceBills();
    }
  );

  FinanceTable.renderPagination(
    "financeBillsPagination",
    meta,
    (newPage) => {
      state.page = newPage;
      FinanceTable.saveState("finance_bills", state);
      applyAndRenderBills();
    },
    (newSize) => {
      state.pageSize = newSize;
      state.page = 1;
      FinanceTable.saveState("finance_bills", state);
      applyAndRenderBills();
    }
  );

  FinanceTable.initAllTablesDensity();
}

function renderFinanceBills(items, totalFiltered = items ? items.length : 0) {
  const tbody = document.getElementById("financeBillsTableBody");
  const empty = document.getElementById("financeBillsEmpty");
  const pagination = document.getElementById("financeBillsPagination");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    if (pagination && totalFiltered === 0) pagination.style.display = "none";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items.map((bill) => {
    const derivedStatus = FinanceFormat.getDerivedBillStatus(bill);
    return `
    <tr data-record-id="${bill.id}">
      <td><strong>${bill.bill_number}</strong></td>
      <td>${bill.vendor_name || "—"}</td>
      <td><span class="badge badge-info">${bill.category || "General"}</span></td>
      <td>${FinanceFormat.formatFinanceDate(bill.issue_date)}</td>
      <td>${FinanceFormat.formatFinanceDate(bill.due_date)}</td>
      <td class="cell-money"><strong>${FinanceFormat.renderMoneyHtml(bill.total, bill.currency || "USD")}</strong></td>
      <td>${FinanceFormat.formatStatusBadge("bill", derivedStatus)}</td>
      <td style="display:flex; gap:6px; flex-wrap:wrap;">
        ${bill.status !== "void" ? `<button class="btn btn-sm" onclick="openEditBillModal(${bill.id})" title="Edit Bill"><i class="fa-solid fa-pen"></i></button>` : ""}
        ${(derivedStatus === "unpaid" || derivedStatus === "overdue") ? `<button class="btn btn-sm btn-fill" onclick="openBillPaymentModal(${bill.id})" title="Record Payment"><i class="fa-solid fa-money-bill-wave"></i> Pay</button>` : ""}
        ${(derivedStatus === "unpaid" || derivedStatus === "overdue") ? `<button class="btn btn-sm btn-danger" onclick="confirmVoidBill(${bill.id})" title="Void Bill"><i class="fa-solid fa-ban"></i></button>` : ""}
      </td>
    </tr>
  `;
  }).join("");
}

function filterFinanceBills(query) {
  const state = FinanceTable.getState("finance_bills");
  state.page = 1;
  FinanceTable.saveState("finance_bills", state);
  applyAndRenderBills();
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
  FinanceForm.clearErrors("billModal");
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
  openModal("billModal");
}

async function openEditBillModal(billId) {
  FinanceForm.clearErrors("billModal");
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
    openModal("billModal");
  } catch (err) {
    showToast("Failed to load bill: " + (err.message || err), "error");
  }
}

function closeBillModal() {
  closeModal("billModal");
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

  const isValid = FinanceForm.validateRequiredFields("billModal", [
    { id: "billVendorId", label: "Vendor" },
    { id: "billNumber", label: "Bill Number" },
    { id: "billIssueDate", label: "Issue Date" },
    { id: "billDueDate", label: "Due Date" },
  ]);
  if (!isValid) return;

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
  const bill = (FinanceState.bills || []).find((b) => b.id === parseInt(billId, 10));
  const billSummary = bill
    ? `<strong>${bill.bill_number}</strong> · ${bill.vendor_name || "Vendor"} · ${FinanceFormat.renderMoneyHtml(bill.total || 0, bill.currency || "USD")}`
    : `Bill #${billId}`;

  const result = await FinanceCommand.confirmAction({
    title: "Void Vendor Bill",
    summary: billSummary,
    consequence: "Voiding will mark this bill as void and cancel all pending payables. This cannot be undone.",
    actionLabel: "Void Bill",
    actionClass: "btn btn-danger",
    requireReason: true,
    severity: "danger",
  });
  if (!result.confirmed) return;

  try {
    await FinanceApi.voidBill(billId, result.reason);
    showToast("Bill voided successfully", "success");
    loadFinanceBills();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  }
}

async function openBillPaymentModal(billId) {
  FinanceForm.clearErrors("billPaymentModal");
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

  openModal("billPaymentModal");
}

function closeBillPaymentModal() {
  closeModal("billPaymentModal");
}

async function saveBillPayment() {
  const billId = document.getElementById("billPaymentBillId").value;
  const amount = parseFloat(document.getElementById("billPaymentAmount").value);
  const paymentDate = document.getElementById("billPaymentDate").value;
  const bankAccountId = document.getElementById("billPaymentBankAccountId").value;
  const bill = (FinanceState.bills || []).find((b) => String(b.id) === String(billId));

  const isValid = FinanceForm.validateRequiredFields("billPaymentModal", [
    { id: "billPaymentBankAccountId", label: "Bank Account" },
    { id: "billPaymentAmount", label: "Payment Amount", check: (v) => parseFloat(v) > 0, message: "Enter a valid payment amount greater than 0." },
    { id: "billPaymentDate", label: "Payment Date" },
  ]);
  if (!isValid) return;

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
    if (tabBill) {
      tabBill.classList.remove("active");
      tabBill.setAttribute("aria-selected", "false");
      tabBill.setAttribute("tabindex", "-1");
    }
    if (tabVend) {
      tabVend.classList.add("active");
      tabVend.setAttribute("aria-selected", "true");
      tabVend.setAttribute("tabindex", "0");
    }
    if (boxBill) boxBill.style.display = "none";
    if (statusFilter) statusFilter.style.display = "none";
    if (boxVend) boxVend.style.display = "block";
    if (conBill) conBill.style.display = "none";
    if (conVend) conVend.style.display = "block";
    if (addVendBtn) addVendBtn.style.display = "inline-flex";
    if (recordBillBtn) recordBillBtn.style.display = "none";
    loadFinanceVendors();
  } else {
    if (tabBill) {
      tabBill.classList.add("active");
      tabBill.setAttribute("aria-selected", "true");
      tabBill.setAttribute("tabindex", "0");
    }
    if (tabVend) {
      tabVend.classList.remove("active");
      tabVend.setAttribute("aria-selected", "false");
      tabVend.setAttribute("tabindex", "-1");
    }
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
      <td>${v.contact_email ? `<a href="mailto:${v.contact_email}">${v.contact_email}</a>` : "—"}</td>
      <td>${v.contact_phone || "—"}</td>
      <td><code>${v.tax_id || "—"}</code></td>
      <td>${FinanceFormat.formatStatusBadge("vendor", v.is_active ? "active" : "inactive")}</td>
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
  FinanceForm.clearErrors("vendorModal");
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
  FinanceForm.clearErrors("vendorModal");
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
  const isValid = FinanceForm.validateRequiredFields("vendorModal", [
    { id: "fVendorName", label: "Vendor / Supplier Name" }
  ]);
  if (!isValid) return;
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
  const vendor = (FinanceState.vendors || []).find((v) => v.id === parseInt(id, 10));
  const action = currentlyActive ? "deactivate" : "activate";

  const result = await FinanceCommand.confirmAction({
    title: `${currentlyActive ? "Deactivate" : "Reactivate"} Vendor`,
    summary: vendor ? `<strong>${vendor.name}</strong>` : `Vendor #${id}`,
    consequence: currentlyActive
      ? "Deactivating will hide this vendor from new bill entry. Existing bills and history are preserved."
      : "Reactivating will restore this vendor to active billing lists.",
    actionLabel: currentlyActive ? "Deactivate Vendor" : "Reactivate Vendor",
    actionClass: currentlyActive ? "btn btn-danger" : "btn btn-primary",
    requireReason: false,
    severity: currentlyActive ? "warning" : "info",
  });
  if (!result.confirmed) return;

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


// Window exports for Vendor Bills & Vendors
window.loadFinanceBills = loadFinanceBills;
window.filterFinanceBills = filterFinanceBills;
window.openAddBillModal = openAddBillModal;
window.openEditBillModal = openEditBillModal;
window.closeBillModal = closeBillModal;
window.addBillLine = addBillLine;
window.saveBillModal = saveBillModal;
window.confirmVoidBill = confirmVoidBill;
window.openBillPaymentModal = openBillPaymentModal;
window.closeBillPaymentModal = closeBillPaymentModal;
window.saveBillPayment = saveBillPayment;
window.switchBillSubTab = switchBillSubTab;
window.loadFinanceVendors = loadFinanceVendors;
window.filterFinanceVendors = filterFinanceVendors;
window.openAddVendorModal = openAddVendorModal;
window.openEditVendorModal = openEditVendorModal;
window.saveVendor = saveVendor;
window.toggleVendorActive = toggleVendorActive;
