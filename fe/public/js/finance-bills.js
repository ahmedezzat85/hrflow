// ==========================================
// 3. Vendor Bills
// ==========================================
function _billStatusBadge(status) {
  const norm = (status || "").toLowerCase();
  return (FinanceFormat.STATUS_MAP.bill[norm]?.badgeClass) || "badge-pending";
}

let _billTableInitialized = false;

function setBillWorkQueue(queue) {
  const state = FinanceTable.getState("finance_bills");
  state.queue = queue || "all";
  state.page = 1;
  FinanceTable.saveState("finance_bills", state);

  _updateBillQueueTabs(state.queue);
  loadFinanceBills();
}

function _updateBillQueueTabs(activeQueue) {
  const queueMap = {
    all: "tabBillQueueAll",
    inbox: "tabBillQueueInbox",
    needs_coding: "tabBillQueueCoding",
    needs_approval: "tabBillQueueApproval",
    ready_to_pay: "tabBillQueueReady",
    scheduled: "tabBillQueueScheduled",
    paid: "tabBillQueuePaid",
    exceptions: "tabBillQueueExceptions",
  };
  const current = activeQueue || "all";
  Object.entries(queueMap).forEach(([q, tabId]) => {
    const tabEl = document.getElementById(tabId);
    if (!tabEl) return;
    const isActive = q === current;
    tabEl.classList.toggle("active", isActive);
    tabEl.setAttribute("aria-selected", isActive ? "true" : "false");
  });
}

async function loadFinanceBillQueueCounts() {
  try {
    const counts = await FinanceApi.getBillQueueCounts();
    if (!counts) return;
    const badgeMap = {
      badgeBillQueueAll: counts.all ?? 0,
      badgeBillQueueInbox: counts.inbox ?? 0,
      badgeBillQueueCoding: counts.needs_coding ?? 0,
      badgeBillQueueApproval: counts.needs_approval ?? 0,
      badgeBillQueueReady: counts.ready_to_pay ?? 0,
      badgeBillQueueScheduled: counts.scheduled ?? 0,
      badgeBillQueuePaid: counts.paid ?? 0,
      badgeBillQueueExceptions: counts.exceptions ?? 0,
    };
    Object.entries(badgeMap).forEach(([id, count]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = count;
    });
  } catch (err) {
    console.warn("Failed to load bill queue counts:", err);
  }
}

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
    _updateBillQueueTabs(cachedState.queue || "all");

    const params = {};
    if (statusFilter && statusFilter.value) params.status = statusFilter.value;
    if (cachedState.queue && cachedState.queue !== "all") params.queue = cachedState.queue;

    const [items] = await Promise.all([
      FinanceApi.getBills(Object.keys(params).length ? params : undefined),
      loadFinanceBillQueueCounts(),
    ]);
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
      (bill.category && bill.category.toLowerCase().includes(q)) ||
      (bill.department && bill.department.toLowerCase().includes(q))
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
    const hasConfidence = bill.extraction_confidence != null;
    const confidencePct = hasConfidence ? Math.round(bill.extraction_confidence * 100) : null;
    const confidenceBadgeClass = hasConfidence && confidencePct < 80 ? "badge-warning" : "badge-info";

    return `
    <tr data-record-id="${bill.id}">
      <td><strong>${bill.bill_number}</strong></td>
      <td>${bill.vendor_name || "—"}</td>
      <td>
        <span class="badge badge-info">${bill.category || "General"}</span>
        ${bill.department ? `<div style="font-size:11.5px;color:var(--text3);margin-top:2px;">${bill.department}</div>` : ""}
      </td>
      <td>${FinanceFormat.formatFinanceDate(bill.issue_date)}</td>
      <td>${FinanceFormat.formatFinanceDate(bill.due_date)}</td>
      <td class="cell-money"><strong>${FinanceFormat.renderMoneyHtml(bill.total, bill.currency || "USD")}</strong></td>
      <td>${FinanceFormat.formatStatusBadge("bill", derivedStatus)}</td>
      <td>
        <div style="display:flex; flex-direction:column; gap:3px;">
          <div style="display:flex; gap:4px; align-items:center;">
            ${bill.capture_source === "upload"
              ? `<span class="badge badge-secondary" title="Uploaded Scan / File"><i class="fa-solid fa-file-arrow-up"></i> Upload</span>`
              : `<span class="badge badge-grey" title="Manual Entry"><i class="fa-solid fa-keyboard"></i> Manual</span>`}
            ${hasConfidence ? `<span class="badge ${confidenceBadgeClass}" title="Extraction confidence: ${confidencePct}%">${confidencePct}%</span>` : ""}
          </div>
          <div style="display:flex; gap:4px; align-items:center;">
            ${bill.is_reviewed
              ? `<span class="badge badge-approved" style="font-size:10px;"><i class="fa-solid fa-check"></i> Reviewed</span>`
              : `<span class="badge badge-warning" style="font-size:10px;" title="Review Required"><i class="fa-solid fa-triangle-exclamation"></i> Unreviewed</span>`}
            ${bill.is_duplicate_override
              ? `<span class="badge badge-rejected" style="font-size:10px;" title="Duplicate Override: ${FinanceFormat.escapeHtml(bill.duplicate_override_reason || "")}"><i class="fa-solid fa-flag"></i> Dup Override</span>`
              : ""}
          </div>
        </div>
      </td>
      <td style="display:flex; gap:6px; flex-wrap:wrap;">
        <button class="btn btn-sm btn-outline btn-view-bill" onclick="FinanceDrawer.open('bill', ${bill.id}, this)" title="View Details & Timeline" aria-label="View Bill ${bill.bill_number} details"><i class="fa-solid fa-eye"></i></button>
        ${bill.status !== "void" ? `<button class="btn btn-sm" onclick="openEditBillModal(${bill.id})" title="Edit Bill"><i class="fa-solid fa-pen"></i></button>` : ""}
        ${(derivedStatus === "needs_approval" || (bill.requires_approval && bill.approval_status !== "approved")) ? `<button class="btn btn-sm btn-warning btn-approve-bill" onclick="openBillApprovalModal(${bill.id})" title="Review & Approve"><i class="fa-solid fa-stamp"></i> Approve</button>` : ""}
        ${((derivedStatus === "ready_to_pay" || derivedStatus === "unpaid") && bill.is_reviewed && (!bill.requires_approval || bill.approval_status === "approved")) ? `<button class="btn btn-sm btn-outline btn-schedule-bill" onclick="openScheduleBillModal(${bill.id})" title="Schedule Payment"><i class="fa-solid fa-calendar-plus"></i> Schedule</button>` : ""}
        ${(derivedStatus === "unpaid" || derivedStatus === "overdue" || derivedStatus === "ready_to_pay" || derivedStatus === "partially_paid" || derivedStatus === "scheduled") && bill.is_reviewed && (!bill.requires_approval || bill.approval_status === "approved") ? `<button class="btn btn-sm btn-fill btn-pay-bill" onclick="openBillPaymentModal(${bill.id})" title="Record Payment"><i class="fa-solid fa-money-bill-wave"></i> Pay</button>` : ""}
        ${(derivedStatus === "unpaid" || derivedStatus === "overdue" || derivedStatus === "ready_to_pay" || derivedStatus === "inbox" || derivedStatus === "needs_coding" || derivedStatus === "needs_approval") ? `<button class="btn btn-sm btn-danger" onclick="confirmVoidBill(${bill.id})" title="Void Bill"><i class="fa-solid fa-ban"></i></button>` : ""}
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

function _resetBillCaptureSection() {
  const fileInput = document.getElementById("billFileInput");
  const fileAttached = document.getElementById("billFileAttachedInfo");
  const fileName = document.getElementById("billAttachedFileName");
  const confidenceBadge = document.getElementById("billExtractionConfidenceBadge");
  const dupBanner = document.getElementById("billDuplicateBanner");
  const dupCheckbox = document.getElementById("billDuplicateOverrideCheckbox");
  const dupReasonGroup = document.getElementById("billDuplicateOverrideReasonGroup");
  const dupReason = document.getElementById("billDuplicateOverrideReason");
  const missingAlert = document.getElementById("billMissingFieldsAlert");

  if (fileInput) fileInput.value = "";
  if (fileAttached) fileAttached.style.display = "none";
  if (fileName) fileName.textContent = "";
  if (confidenceBadge) confidenceBadge.style.display = "none";
  if (dupBanner) dupBanner.style.display = "none";
  if (dupCheckbox) dupCheckbox.checked = false;
  if (dupReasonGroup) dupReasonGroup.style.display = "none";
  if (dupReason) dupReason.value = "";
  if (missingAlert) missingAlert.style.display = "none";
}

function _checkBillMissingFields() {
  const alertEl = document.getElementById("billMissingFieldsAlert");
  const textEl = document.getElementById("billMissingFieldsText");
  if (!alertEl || !textEl) return;

  const dept = document.getElementById("billDepartment")?.value;
  const cat = document.getElementById("billCategory")?.value.trim();
  const missing = [];
  if (!dept) missing.push("Department");
  if (!cat) missing.push("Category");

  if (missing.length > 0) {
    textEl.textContent = `Missing required coding: ${missing.join(", ")}. Bill cannot be marked Ready to Pay or Paid until coded.`;
    alertEl.style.display = "block";
  } else {
    alertEl.style.display = "none";
  }
}

let _duplicateCheckTimer = null;
function onBillFieldInput() {
  _checkBillMissingFields();

  if (_duplicateCheckTimer) clearTimeout(_duplicateCheckTimer);
  _duplicateCheckTimer = setTimeout(async () => {
    const vendorId = document.getElementById("billVendorId")?.value;
    const billNumber = document.getElementById("billNumber")?.value.trim();
    const issueDate = document.getElementById("billIssueDate")?.value;
    const totalStr = document.getElementById("billTotalDisplay")?.textContent || "0";
    const total = parseFloat(totalStr) || 0;
    const fingerprint = document.getElementById("billFileFingerprint")?.value || "";
    const excludeIdVal = document.getElementById("billModalId")?.value;
    const excludeId = excludeIdVal ? parseInt(excludeIdVal, 10) : undefined;

    const banner = document.getElementById("billDuplicateBanner");
    const textEl = document.getElementById("billDuplicateText");
    if (!banner) return;

    if (!vendorId && !billNumber && !fingerprint) {
      banner.style.display = "none";
      return;
    }

    try {
      const res = await FinanceApi.checkDuplicateBills({
        vendor_id: vendorId ? parseInt(vendorId, 10) : undefined,
        bill_number: billNumber || undefined,
        issue_date: issueDate || undefined,
        total: total > 0 ? total : undefined,
        file_fingerprint: fingerprint || undefined,
        exclude_id: excludeId,
      });

      if (res && res.has_duplicate && res.candidates && res.candidates.length > 0) {
        const match = res.candidates[0];
        if (textEl) {
          textEl.textContent = `Matches existing bill #${match.bill_number || match.id} (${match.vendor_name || "Vendor"}, $${Number(match.total || 0).toFixed(2)}) — Reason: ${match.match_reason}.`;
        }
        banner.style.display = "block";
      } else {
        banner.style.display = "none";
      }
    } catch (err) {
      console.warn("Duplicate check error:", err);
    }
  }, 250);
}

function toggleBillDuplicateOverrideReason(checked) {
  const group = document.getElementById("billDuplicateOverrideReasonGroup");
  if (group) group.style.display = checked ? "block" : "none";
}

async function handleBillFileSelected(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const fileInfo = document.getElementById("billFileAttachedInfo");
  const fileNameSpan = document.getElementById("billAttachedFileName");
  const confidenceBadge = document.getElementById("billExtractionConfidenceBadge");

  if (fileNameSpan) fileNameSpan.textContent = file.name;
  if (fileInfo) fileInfo.style.display = "block";

  // Simulate OCR extraction with high confidence by default (94%), or low if filename hints low
  const isLow = file.name.toLowerCase().includes("blur") || file.name.toLowerCase().includes("low");
  const confidence = isLow ? 0.68 : 0.94;
  if (confidenceBadge) {
    confidenceBadge.style.display = "inline-block";
    confidenceBadge.textContent = `Confidence: ${(confidence * 100).toFixed(0)}%`;
    confidenceBadge.className = confidence < 0.8 ? "badge badge-warning" : "badge badge-info";
  }

  document.getElementById("billCaptureSource").value = "upload";
  document.getElementById("billFileFingerprint").value = `fp_${file.size}_${file.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;

  // AC 1: Uploaded bills start unreviewed
  const reviewedCheckbox = document.getElementById("billIsReviewed");
  if (reviewedCheckbox) reviewedCheckbox.checked = false;

  // Set status to inbox or needs_coding
  const statusEl = document.getElementById("billStatus");
  if (statusEl) statusEl.value = isLow ? "inbox" : "needs_coding";

  // Prefill OCR extracted values if fields are empty
  const numInput = document.getElementById("billNumber");
  if (!numInput.value) {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    numInput.value = `INV-OCR-${randomSuffix}`;
  }

  const vendorSel = document.getElementById("billVendorId");
  if (vendorSel && (!vendorSel.value || vendorSel.value === "")) {
    if (vendorSel.options.length > 1) {
      vendorSel.selectedIndex = 1;
    }
  }

  const issueDateInput = document.getElementById("billIssueDate");
  if (!issueDateInput.value) {
    issueDateInput.value = new Date().toISOString().split("T")[0];
  }

  const dueDateInput = document.getElementById("billDueDate");
  if (!dueDateInput.value) {
    const d = new Date();
    d.setDate(d.getDate() + 30);
    dueDateInput.value = d.toISOString().split("T")[0];
  }

  // Populate sample extracted line item
  const tbody = document.getElementById("billLinesBody");
  if (tbody && tbody.children.length === 0) {
    addBillLine({ description: "Extracted: Cloud Infrastructure & Services", quantity: 1, unit_price: 1250.00, line_total: 1250.00 });
  } else if (tbody && tbody.children.length === 1) {
    const desc = tbody.querySelector("input[type='text']");
    if (desc && !desc.value) {
      tbody.innerHTML = "";
      addBillLine({ description: "Extracted: Cloud Infrastructure & Services", quantity: 1, unit_price: 1250.00, line_total: 1250.00 });
    }
  }
  _updateBillTotals();

  // Check missing fields (dept & cat)
  _checkBillMissingFields();

  // Trigger duplicate check
  onBillFieldInput();
}

function openCaptureBillModal() {
  FinanceForm.clearErrors("billModal");
  _resetBillCaptureSection();
  _populateBillVendorDropdown();

  document.getElementById("billModalTitleText").textContent = "Upload & Capture Vendor Bill";
  document.getElementById("billModalId").value = "";
  document.getElementById("billCaptureSource").value = "upload";
  document.getElementById("billFileFingerprint").value = "";
  document.getElementById("billVendorId").value = "";
  document.getElementById("billNumber").value = "";
  document.getElementById("billDepartment").value = "";
  document.getElementById("billCategory").value = "";
  document.getElementById("billLegalEntity").value = "Voyance Health Inc";
  document.getElementById("billIssueDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("billDueDate").value = "";
  document.getElementById("billStatus").value = "inbox";
  document.getElementById("billCurrency").value = "USD";
  document.getElementById("billNotes").value = "";
  document.getElementById("billIsReviewed").checked = false;
  document.getElementById("billLinesBody").innerHTML = "";

  _updateBillTotals();
  _checkBillMissingFields();
  openModal("billModal");
}

function openAddBillModal() {
  FinanceForm.clearErrors("billModal");
  _resetBillCaptureSection();
  _populateBillVendorDropdown();

  document.getElementById("billModalTitleText").textContent = "New Vendor Bill";
  document.getElementById("billModalId").value = "";
  document.getElementById("billCaptureSource").value = "manual";
  document.getElementById("billFileFingerprint").value = "";
  document.getElementById("billVendorId").value = "";
  document.getElementById("billNumber").value = "";
  document.getElementById("billDepartment").value = "";
  document.getElementById("billCategory").value = "";
  document.getElementById("billLegalEntity").value = "Voyance Health Inc";
  document.getElementById("billIssueDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("billDueDate").value = "";
  document.getElementById("billStatus").value = "needs_coding";
  document.getElementById("billCurrency").value = "USD";
  document.getElementById("billNotes").value = "";
  document.getElementById("billIsReviewed").checked = true;
  document.getElementById("billLinesBody").innerHTML = "";

  _updateBillTotals();
  addBillLine();
  _checkBillMissingFields();
  openModal("billModal");
}

async function openEditBillModal(billId) {
  FinanceForm.clearErrors("billModal");
  _resetBillCaptureSection();
  _populateBillVendorDropdown();

  try {
    const bill = await FinanceApi.getBill(billId);
    document.getElementById("billModalTitleText").textContent = `Edit Bill ${bill.bill_number}`;
    document.getElementById("billModalId").value = bill.id;
    document.getElementById("billCaptureSource").value = bill.capture_source || "manual";
    document.getElementById("billFileFingerprint").value = bill.file_fingerprint || "";
    document.getElementById("billVendorId").value = bill.vendor_id || "";
    document.getElementById("billNumber").value = bill.bill_number || "";
    document.getElementById("billDepartment").value = bill.department || "";
    document.getElementById("billCategory").value = bill.category || "";
    document.getElementById("billLegalEntity").value = bill.legal_entity || "Voyance Health Inc";
    document.getElementById("billIssueDate").value = bill.issue_date || "";
    document.getElementById("billDueDate").value = bill.due_date || "";
    document.getElementById("billStatus").value = bill.status || "inbox";
    document.getElementById("billCurrency").value = bill.currency || "USD";
    document.getElementById("billNotes").value = bill.notes || "";
    document.getElementById("billIsReviewed").checked = !!bill.is_reviewed;

    if (bill.attachment_name) {
      const fileInfo = document.getElementById("billFileAttachedInfo");
      const fileNameSpan = document.getElementById("billAttachedFileName");
      const confidenceBadge = document.getElementById("billExtractionConfidenceBadge");
      if (fileNameSpan) fileNameSpan.textContent = bill.attachment_name;
      if (fileInfo) fileInfo.style.display = "block";
      if (confidenceBadge && bill.extraction_confidence != null) {
        confidenceBadge.style.display = "inline-block";
        const pct = Math.round(bill.extraction_confidence * 100);
        confidenceBadge.textContent = `Confidence: ${pct}%`;
        confidenceBadge.className = pct < 80 ? "badge badge-warning" : "badge badge-info";
      }
    }

    if (bill.is_duplicate_override) {
      const dupCheckbox = document.getElementById("billDuplicateOverrideCheckbox");
      const dupReasonGroup = document.getElementById("billDuplicateOverrideReasonGroup");
      const dupReason = document.getElementById("billDuplicateOverrideReason");
      if (dupCheckbox) dupCheckbox.checked = true;
      if (dupReasonGroup) dupReasonGroup.style.display = "block";
      if (dupReason) dupReason.value = bill.duplicate_override_reason || "";
    }

    document.getElementById("billLinesBody").innerHTML = "";
    (bill.lines || []).forEach((ln) => addBillLine(ln));
    if (!bill.lines || !bill.lines.length) addBillLine();
    _updateBillTotals();
    _checkBillMissingFields();
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
    <td><input type="text" class="form-control" style="font-size:0.85rem;" placeholder="Description" value="${(data && data.description) || ""}" oninput="_updateBillTotals(); onBillFieldInput();"></td>
    <td><input type="number" class="form-control bill-qty" style="font-size:0.85rem;" value="${(data && data.quantity) || 1}" min="0.001" step="0.001" oninput="_autoComputeBillLineTotal(this); _updateBillTotals(); onBillFieldInput();"></td>
    <td><input type="number" class="form-control bill-price" style="font-size:0.85rem;" value="${(data && data.unit_price) || 0}" min="0" step="0.01" oninput="_autoComputeBillLineTotal(this); _updateBillTotals(); onBillFieldInput();"></td>
    <td><input type="number" class="form-control bill-total" style="font-size:0.85rem;" value="${(data && data.line_total) || 0}" min="0" step="0.01" oninput="_updateBillTotals(); onBillFieldInput();"></td>
    <td><button type="button" class="btn btn-sm btn-danger" onclick="this.closest('tr').remove(); _updateBillTotals(); onBillFieldInput();" title="Remove line"><i class="fa-solid fa-trash"></i></button></td>
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
  const status = document.getElementById("billStatus").value;
  const isReviewed = document.getElementById("billIsReviewed").checked;

  const isValid = FinanceForm.validateRequiredFields("billModal", [
    { id: "billVendorId", label: "Vendor" },
    { id: "billNumber", label: "Bill Number" },
    { id: "billIssueDate", label: "Issue Date" },
    { id: "billDueDate", label: "Due Date" },
  ]);
  if (!isValid) return;

  // AC 1: Uploaded/unreviewed bills cannot move directly to ready_to_pay or paid
  if ((status === "ready_to_pay" || status === "paid") && !isReviewed) {
    showToast("Unreviewed bills cannot be marked Ready to Pay or Paid. Please check 'Mark verified and reviewed' first.", "warning");
    return;
  }

  // AC 3: Duplicate detection check
  const dupBanner = document.getElementById("billDuplicateBanner");
  const dupVisible = dupBanner && dupBanner.style.display !== "none";
  const dupOverride = document.getElementById("billDuplicateOverrideCheckbox").checked;
  const dupReason = document.getElementById("billDuplicateOverrideReason").value.trim();

  if (dupVisible && !dupOverride) {
    showToast("Potential duplicate detected. Request an authorized override with reason to proceed.", "warning");
    return;
  }
  if (dupVisible && dupOverride && !dupReason) {
    showToast("Please provide an override reason for the duplicate bill.", "warning");
    document.getElementById("billDuplicateOverrideReason").focus();
    return;
  }

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
    department: document.getElementById("billDepartment").value || null,
    legal_entity: document.getElementById("billLegalEntity").value || "Voyance Health Inc",
    category: document.getElementById("billCategory").value.trim() || null,
    issue_date: issueDate,
    due_date: dueDate,
    status: status,
    currency: document.getElementById("billCurrency").value,
    notes: document.getElementById("billNotes").value.trim(),
    capture_source: document.getElementById("billCaptureSource").value || "manual",
    file_fingerprint: document.getElementById("billFileFingerprint").value || null,
    attachment_name: document.getElementById("billAttachedFileName")?.textContent || null,
    is_reviewed: isReviewed,
    is_duplicate_override: dupOverride,
    duplicate_override_reason: dupOverride ? dupReason : null,
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

  let paidSoFar = bill && bill.amount_paid != null ? bill.amount_paid : 0;
  try {
    const existingPayments = await FinanceApi.getBillPayments(billId);
    if (existingPayments && existingPayments.length) {
      paidSoFar = existingPayments.filter((p) => !p.is_reversed).reduce((s, p) => s + (p.amount || 0), 0);
    }
  } catch (_) {}

  const total = bill ? bill.total : 0;
  const remaining = Math.max(0, round(total - paidSoFar, 2));

  const totalEl = document.getElementById("billPaymentTotalDisplay");
  const paidEl = document.getElementById("billPaymentPaidDisplay");
  const remEl = document.getElementById("billPaymentRemainingDisplay");
  const curr = bill?.currency || "USD";

  if (totalEl) totalEl.textContent = `${curr} ${Number(total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (paidEl) paidEl.textContent = `${curr} ${Number(paidSoFar).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (remEl) remEl.textContent = `${curr} ${Number(remaining).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const infoEl = document.getElementById("billPaymentBillInfo");
  if (infoEl && bill) {
    infoEl.textContent = `Bill ${bill.bill_number} (${bill.vendor_name || "Vendor"}) — ${curr} ${Number(remaining).toLocaleString("en-US", { minimumFractionDigits: 2 })} remaining to pay`;
  }

  const amtInput = document.getElementById("billPaymentAmount");
  if (amtInput) {
    amtInput.value = remaining > 0 ? remaining.toFixed(2) : "";
    amtInput.max = remaining.toFixed(2);
  }

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

  // Enforce overpayment validation
  if (bill) {
    const paidSoFar = bill.amount_paid != null ? bill.amount_paid : 0;
    const remaining = round(bill.total - paidSoFar, 2);
    if (amount > remaining + 0.01) {
      showToast(`Payment amount ($${amount.toFixed(2)}) exceeds remaining balance ($${remaining.toFixed(2)}).`, "error");
      return;
    }
  }

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
    showToast("Bill payment recorded successfully", "success");
    closeBillPaymentModal();
    loadFinanceBills();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  }
}

function openBillApprovalModal(billId) {
  FinanceForm.clearErrors("billApprovalModal");
  const bill = (FinanceState.bills || []).find((b) => b.id === billId);
  if (!bill) return;

  document.getElementById("billApprovalBillId").value = billId;
  const numEl = document.getElementById("billApprovalBillNumber");
  const vendEl = document.getElementById("billApprovalVendor");
  const amtEl = document.getElementById("billApprovalAmount");
  const deptEl = document.getElementById("billApprovalDepartment");
  const createdEl = document.getElementById("billApprovalCreatedBy");

  if (numEl) numEl.textContent = bill.bill_number;
  if (vendEl) vendEl.textContent = bill.vendor_name || "Vendor";
  if (amtEl) amtEl.textContent = `${bill.currency || "USD"} ${Number(bill.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (deptEl) deptEl.textContent = bill.department || "General";
  if (createdEl) createdEl.textContent = bill.created_by || "System";

  // Check maker-checker segregation of duties
  const currentUserEmail = (window.currentUser && window.currentUser.email) || (typeof Api !== "undefined" && Api.getCurrentUser && Api.getCurrentUser()?.email) || "";
  const warningBanner = document.getElementById("billApprovalSelfWarningBanner");
  const creatorSpan = document.getElementById("billApprovalCreatorEmail");
  const submitBtn = document.getElementById("billApprovalSubmitBtn");

  const isSelf = currentUserEmail && bill.created_by && currentUserEmail.toLowerCase() === bill.created_by.toLowerCase();
  if (warningBanner) {
    if (isSelf) {
      warningBanner.style.display = "block";
      if (creatorSpan) creatorSpan.textContent = bill.created_by;
      if (submitBtn) submitBtn.disabled = true;
    } else {
      warningBanner.style.display = "none";
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  document.getElementById("billApprovalDecision").value = "approve";
  document.getElementById("billApproverLimit").value = "50000";
  document.getElementById("billApprovalComment").value = "";
  onBillApprovalDecisionChange();

  openModal("billApprovalModal");
}

function closeBillApprovalModal() {
  closeModal("billApprovalModal");
}

function onBillApprovalDecisionChange() {
  const dec = document.getElementById("billApprovalDecision")?.value;
  const reqSpan = document.getElementById("billApprovalCommentReq");
  const limitField = document.getElementById("billApproverLimitField");
  const submitBtn = document.getElementById("billApprovalSubmitBtn");

  if (dec === "reject") {
    if (reqSpan) reqSpan.style.display = "inline";
    if (limitField) limitField.style.opacity = "0.5";
    if (submitBtn) {
      submitBtn.className = "btn btn-fill btn-danger";
      submitBtn.innerHTML = '<i class="fa-solid fa-ban"></i> Reject Bill';
    }
  } else {
    if (reqSpan) reqSpan.style.display = "none";
    if (limitField) limitField.style.opacity = "1";
    if (submitBtn) {
      submitBtn.className = "btn btn-fill btn-warning";
      submitBtn.innerHTML = '<i class="fa-solid fa-stamp"></i> Submit Approval';
    }
  }
}

async function saveBillApproval() {
  const billId = document.getElementById("billApprovalBillId").value;
  const decision = document.getElementById("billApprovalDecision").value;
  const limitVal = document.getElementById("billApproverLimit").value;
  const comment = document.getElementById("billApprovalComment").value.trim();

  if (decision === "reject" && !comment) {
    showToast("A comment explaining the rejection reason is required.", "error");
    return;
  }

  const payload = {
    decision,
    comment: comment || null,
    approver_limit: limitVal ? parseFloat(limitVal) : undefined,
  };

  try {
    await FinanceApi.approveBill(billId, payload);
    showToast(decision === "approve" ? "Bill approved and moved to Ready to Pay" : "Bill rejected and moved to Exceptions", "success");
    closeBillApprovalModal();
    loadFinanceBills();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  }
}

function openScheduleBillModal(billId) {
  FinanceForm.clearErrors("billScheduleModal");
  const bill = (FinanceState.bills || []).find((b) => b.id === billId);
  if (!bill) return;

  document.getElementById("billScheduleBillId").value = billId;
  const numEl = document.getElementById("billScheduleBillNumber");
  const vendEl = document.getElementById("billScheduleVendor");
  const amtEl = document.getElementById("billScheduleAmount");

  if (numEl) numEl.textContent = bill.bill_number;
  if (vendEl) vendEl.textContent = bill.vendor_name || "Vendor";
  if (amtEl) amtEl.textContent = `${bill.currency || "USD"} ${Number(bill.total).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  const today = new Date();
  today.setDate(today.getDate() + 7);
  document.getElementById("billScheduledPaymentDate").value = bill.due_date || today.toISOString().split("T")[0];
  document.getElementById("billScheduleNotes").value = "";

  openModal("billScheduleModal");
}

function closeBillScheduleModal() {
  closeModal("billScheduleModal");
}

async function saveBillSchedule() {
  const billId = document.getElementById("billScheduleBillId").value;
  const schedDate = document.getElementById("billScheduledPaymentDate").value;
  const notes = document.getElementById("billScheduleNotes").value.trim();

  if (!schedDate) {
    showToast("Scheduled payment date is required.", "error");
    return;
  }

  try {
    await FinanceApi.scheduleBill(billId, {
      scheduled_payment_date: schedDate,
      notes: notes || null,
    });
    showToast("Bill successfully scheduled for payment", "success");
    closeBillScheduleModal();
    loadFinanceBills();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  }
}

async function confirmReverseBillPayment(billId, paymentId, amount) {
  const reason = prompt(`Enter reason for reversing payment #${paymentId} ($${Number(amount || 0).toFixed(2)}):`);
  if (!reason || !reason.trim()) {
    return;
  }
  try {
    await FinanceApi.reverseBillPayment(billId, paymentId, { reason: reason.trim() });
    showToast("Payment reversed and bank balance restored", "success");
    if (typeof FinanceDrawer !== "undefined" && FinanceDrawer.isOpen()) {
      FinanceDrawer.load("bill", billId);
    }
    loadFinanceBills();
  } catch (err) {
    showToast("Failed to reverse payment: " + (err.message || JSON.stringify(err)), "error");
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
window.setBillWorkQueue = setBillWorkQueue;
window.loadFinanceBillQueueCounts = loadFinanceBillQueueCounts;
window.openCaptureBillModal = openCaptureBillModal;
window.handleBillFileSelected = handleBillFileSelected;
window.onBillFieldInput = onBillFieldInput;
window.toggleBillDuplicateOverrideReason = toggleBillDuplicateOverrideReason;
window.openAddBillModal = openAddBillModal;
window.openEditBillModal = openEditBillModal;
window.closeBillModal = closeBillModal;
window.addBillLine = addBillLine;
window.saveBillModal = saveBillModal;
window.confirmVoidBill = confirmVoidBill;
window.openBillPaymentModal = openBillPaymentModal;
window.closeBillPaymentModal = closeBillPaymentModal;
window.saveBillPayment = saveBillPayment;
window.openBillApprovalModal = openBillApprovalModal;
window.closeBillApprovalModal = closeBillApprovalModal;
window.onBillApprovalDecisionChange = onBillApprovalDecisionChange;
window.saveBillApproval = saveBillApproval;
window.openScheduleBillModal = openScheduleBillModal;
window.closeBillScheduleModal = closeBillScheduleModal;
window.saveBillSchedule = saveBillSchedule;
window.confirmReverseBillPayment = confirmReverseBillPayment;
window.switchBillSubTab = switchBillSubTab;
window.loadFinanceVendors = loadFinanceVendors;
window.filterFinanceVendors = filterFinanceVendors;
window.openAddVendorModal = openAddVendorModal;
window.openEditVendorModal = openEditVendorModal;
window.saveVendor = saveVendor;
window.toggleVendorActive = toggleVendorActive;
