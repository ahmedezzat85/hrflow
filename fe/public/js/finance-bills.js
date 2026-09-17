// ==========================================
// 3. Vendor Bills
// ==========================================
function _billStatusBadge(status) {
  const norm = (status || "").toLowerCase();
  return (FinanceFormat.STATUS_MAP.bill[norm]?.badgeClass) || "badge-pending";
}

let _billTableInitialized = false;

const BILL_QUEUE_LABELS = {
  all: "All",
  inbox: "Inbox",
  needs_coding: "Needs Coding",
  needs_approval: "Needs Approval",
  ready_to_pay: "Ready to Pay",
  scheduled: "Scheduled",
  paid: "Paid",
  exceptions: "Exceptions",
};

let _currentBillQueueCounts = {
  all: 0,
  inbox: 0,
  needs_coding: 0,
  needs_approval: 0,
  ready_to_pay: 0,
  scheduled: 0,
  paid: 0,
  exceptions: 0,
};

function isBillStatusPanelExpanded() {
  const panel = document.getElementById("financeBillStatusPanel");
  return panel ? panel.style.display !== "none" : false;
}

function setBillStatusPanelExpanded(expanded) {
  const panel = document.getElementById("financeBillStatusPanel");
  const btn = document.getElementById("financeBillChangeViewBtn");
  const icon = document.getElementById("financeBillChangeViewIcon");
  if (panel) {
    panel.style.display = expanded ? "block" : "none";
  }
  if (btn) {
    btn.setAttribute("aria-expanded", expanded ? "true" : "false");
    btn.classList.toggle("active", !!expanded);
  }
  if (icon) {
    icon.style.transform = expanded ? "rotate(180deg)" : "rotate(0deg)";
  }
}

function toggleBillStatusPanel() {
  const current = isBillStatusPanelExpanded();
  setBillStatusPanelExpanded(!current);
}

function _updateBillActiveStatusPill(activeQueue) {
  const current = activeQueue || "all";
  const labelEl = document.getElementById("financeBillActiveStatusLabel");
  const countEl = document.getElementById("financeBillActiveStatusCount");
  if (labelEl) {
    labelEl.textContent = BILL_QUEUE_LABELS[current] || "All";
  }
  if (countEl) {
    countEl.textContent = _currentBillQueueCounts[current] ?? 0;
  }
}

function _updateBillViewResultCount(filteredCount, totalCount) {
  const countTextEl = document.getElementById("financeBillViewResultCount");
  if (!countTextEl) return;
  const shown = filteredCount ?? 0;
  const total = totalCount ?? _currentBillQueueCounts.all ?? shown;
  countTextEl.textContent = `Showing ${shown} of ${total} bills`;
}

function setBillWorkQueue(queue) {
  const state = FinanceTable.getState("finance_bills");
  state.queue = queue || "all";
  state.page = 1;
  FinanceTable.saveState("finance_bills", state);

  _updateBillQueueTabs(state.queue);
  _updateBillActiveStatusPill(state.queue);
  setBillStatusPanelExpanded(false); // auto-collapse panel on selection
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
  _updateBillActiveStatusPill(current);
}

async function loadFinanceBillQueueCounts() {
  try {
    const counts = await FinanceApi.getBillQueueCounts();
    if (!counts) return;
    _currentBillQueueCounts = {
      all: counts.all ?? 0,
      inbox: counts.inbox ?? 0,
      needs_coding: counts.needs_coding ?? 0,
      needs_approval: counts.needs_approval ?? 0,
      ready_to_pay: counts.ready_to_pay ?? 0,
      scheduled: counts.scheduled ?? 0,
      paid: counts.paid ?? 0,
      exceptions: counts.exceptions ?? 0,
    };
    const badgeMap = {
      badgeBillQueueAll: _currentBillQueueCounts.all,
      badgeBillQueueInbox: _currentBillQueueCounts.inbox,
      badgeBillQueueCoding: _currentBillQueueCounts.needs_coding,
      badgeBillQueueApproval: _currentBillQueueCounts.needs_approval,
      badgeBillQueueReady: _currentBillQueueCounts.ready_to_pay,
      badgeBillQueueScheduled: _currentBillQueueCounts.scheduled,
      badgeBillQueuePaid: _currentBillQueueCounts.paid,
      badgeBillQueueExceptions: _currentBillQueueCounts.exceptions,
    };
    Object.entries(badgeMap).forEach(([id, count]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = count;
    });
    const state = FinanceTable.getState("finance_bills");
    _updateBillActiveStatusPill(state.queue || "all");
  } catch (err) {
    console.warn("Failed to load bill queue counts:", err);
  }
}

// ── Collapsible Bill Filters (FUX-412) ──────────────────────────────────────

function _getBillFilterStorageKey() {
  const email = (typeof SessionInfo !== "undefined" && SessionInfo.getEmail && SessionInfo.getEmail()) || "default";
  return `hrflow_bill_filters_expanded_${email}`;
}

function isBillFilterPanelExpanded() {
  const panel = document.getElementById("financeBillFilterPanel");
  return panel ? panel.style.display !== "none" : false;
}

function setBillFilterPanelExpanded(expanded, persist = true) {
  const panel = document.getElementById("financeBillFilterPanel");
  const toggleBtn = document.getElementById("financeBillFilterToggleBtn");
  if (panel) {
    panel.style.display = expanded ? "block" : "none";
  }
  if (toggleBtn) {
    toggleBtn.setAttribute("aria-expanded", expanded ? "true" : "false");
    toggleBtn.classList.toggle("active", !!expanded);
  }
  if (persist) {
    try {
      localStorage.setItem(_getBillFilterStorageKey(), expanded ? "true" : "false");
    } catch (_) {}
  }
}

function toggleBillFilterPanel() {
  const current = isBillFilterPanelExpanded();
  setBillFilterPanelExpanded(!current, true);
}

function updateBillFilterBadge() {
  const statusFilter = document.getElementById("financeBillStatusFilter");
  const attachmentFilter = document.getElementById("financeBillAttachmentFilter");
  const badge = document.getElementById("financeBillFilterBadge");
  if (!badge) return 0;

  let activeCount = 0;
  if (statusFilter && statusFilter.value && statusFilter.value.trim() !== "") {
    activeCount++;
  }
  if (attachmentFilter && attachmentFilter.value && attachmentFilter.value.trim() !== "") {
    activeCount++;
  }

  if (activeCount > 0) {
    badge.textContent = activeCount;
    badge.style.display = "inline-block";
    badge.setAttribute("aria-label", `${activeCount} filters applied`);
  } else {
    badge.style.display = "none";
    badge.textContent = "0";
    badge.removeAttribute("aria-label");
  }
  return activeCount;
}

function onBillFilterChanged() {
  updateBillFilterBadge();
  loadFinanceBills();
}

function resetBillSecondaryFilters() {
  const statusFilter = document.getElementById("financeBillStatusFilter");
  const attachmentFilter = document.getElementById("financeBillAttachmentFilter");
  if (statusFilter) statusFilter.value = "";
  if (attachmentFilter) attachmentFilter.value = "";
  updateBillFilterBadge();
  loadFinanceBills();
}

async function loadFinanceBills(incomingParams) {
  const bar = document.getElementById("financeBillsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const cachedState = FinanceTable.getState("finance_bills");
    const statusFilter = document.getElementById("financeBillStatusFilter");
    const searchInput = document.getElementById("financeBillSearch");
    const attachmentFilter = document.getElementById("financeBillAttachmentFilter");

    // Read incoming URL query params
    const urlParams = (typeof window !== "undefined" && window.location) ? new URLSearchParams(window.location.search) : null;
    const urlStatus = urlParams ? urlParams.get("status") : null;
    const urlAttachment = urlParams ? urlParams.get("attachment") : null;
    const urlQueue = urlParams ? urlParams.get("queue") : null;
    const urlSearch = urlParams ? urlParams.get("search") : null;

    let hasDeepLinkFilter = false;

    if (incomingParams) {
      if (incomingParams.status && statusFilter) {
        statusFilter.value = incomingParams.status;
        hasDeepLinkFilter = true;
      }
      if (incomingParams.attachment && attachmentFilter) {
        attachmentFilter.value = incomingParams.attachment;
        hasDeepLinkFilter = true;
      }
      if (incomingParams.queue) {
        cachedState.queue = incomingParams.queue;
        if (incomingParams.queue !== "all") hasDeepLinkFilter = true;
      }
      if (incomingParams.search && searchInput) {
        searchInput.value = incomingParams.search;
      }
      if (incomingParams.vendor_id || incomingParams.bill_id) {
        hasDeepLinkFilter = true;
      }
    } else if (!_billTableInitialized) {
      if (urlStatus && statusFilter) {
        statusFilter.value = urlStatus;
        hasDeepLinkFilter = true;
      }
      if (urlAttachment && attachmentFilter) {
        attachmentFilter.value = urlAttachment;
        hasDeepLinkFilter = true;
      }
      if (urlQueue) {
        cachedState.queue = urlQueue;
        if (urlQueue !== "all") hasDeepLinkFilter = true;
      }
      if (urlSearch && searchInput) {
        searchInput.value = urlSearch;
      }
    }

    if (!_billTableInitialized) {
      if (!incomingParams && !urlStatus && cachedState.filters?.status && statusFilter) {
        statusFilter.value = cachedState.filters.status;
      }
      if (!incomingParams && !urlSearch && cachedState.filters?.search && searchInput) {
        searchInput.value = cachedState.filters.search;
      }
      if (!incomingParams && !urlAttachment && cachedState.filters?.attachment && attachmentFilter) {
        attachmentFilter.value = cachedState.filters.attachment;
      }

      // Initialize filter panel expanded/collapsed state:
      // If a non-default filter is pre-applied (deep-link / query param), force-expand.
      // Otherwise restore user's stored preference (default: collapsed/false).
      const activeCount = updateBillFilterBadge();
      const nonDefaultFilterPresent = hasDeepLinkFilter || activeCount > 0;
      if (nonDefaultFilterPresent) {
        setBillFilterPanelExpanded(true, false);
      } else {
        const savedPref = localStorage.getItem(_getBillFilterStorageKey());
        setBillFilterPanelExpanded(savedPref === "true", false);
      }
      _billTableInitialized = true;
    } else {
      updateBillFilterBadge();
      if (hasDeepLinkFilter) {
        setBillFilterPanelExpanded(true, false);
      }
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
  const attachmentFilter = document.getElementById("financeBillAttachmentFilter");

  const currentStatus = statusFilter ? statusFilter.value : "";
  const currentSearch = searchInput ? searchInput.value.trim() : "";
  const currentAttachment = attachmentFilter ? attachmentFilter.value : "";

  state.filters = {
    ...(currentStatus ? { status: currentStatus } : {}),
    ...(currentSearch ? { search: currentSearch } : {}),
    ...(currentAttachment ? { attachment: currentAttachment } : {}),
  };

  let items = FinanceState.bills || [];
  if (currentAttachment === "with_attachment") {
    items = items.filter((b) => !!(b.attachment_name || b.attachment_url));
  } else if (currentAttachment === "no_attachment") {
    items = items.filter((b) => !(b.attachment_name || b.attachment_url));
  }

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

  FinanceTable.bindSortHeaders("financeBillsTable", (col, dir) => {
    state.sortBy = col;
    state.sortDir = dir;
    FinanceTable.saveState("finance_bills", state);
    applyAndRenderBills();
  }, { sortBy: state.sortBy, sortDir: state.sortDir });

  updateBillFilterBadge();

  FinanceTable.renderFilterChips(
    "financeBillFilterChips",
    state.filters,
    (removedKey) => {
      if (removedKey === "status" && statusFilter) {
        statusFilter.value = "";
        updateBillFilterBadge();
        loadFinanceBills();
      } else if (removedKey === "search" && searchInput) {
        searchInput.value = "";
        updateBillFilterBadge();
        applyAndRenderBills();
      } else if (removedKey === "attachment" && attachmentFilter) {
        attachmentFilter.value = "";
        updateBillFilterBadge();
        applyAndRenderBills();
      }
    },
    () => {
      if (statusFilter) statusFilter.value = "";
      if (searchInput) searchInput.value = "";
      if (attachmentFilter) attachmentFilter.value = "";
      updateBillFilterBadge();
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

  _updateBillViewResultCount(totalFiltered, _currentBillQueueCounts.all);

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
        ${(bill.attachment_name || bill.attachment_url) ? `<button class="btn btn-sm btn-outline btn-bill-attachment" onclick="previewBillDocument(${bill.id})" title="View Attachment (${FinanceFormat.escapeHtml(bill.attachment_name || 'Document')})" aria-label="View Attachment for Bill ${bill.bill_number}"><i class="fa-solid fa-paperclip"></i></button>` : ""}
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

async function _populateBillCategoryDropdown() {
  const sel = document.getElementById("billCategoryId");
  if (!sel) return;
  if (sel.options.length > 1) return;
  try {
    const categories = await FinanceApi.getCategories({ is_active: true });
    const sorted = (categories || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));
    sel.innerHTML = `<option value="">— Select Category —</option>` + sorted.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  } catch (_) {
    sel.innerHTML = `<option value="">— Select Category —</option>`;
  }
}

async function _populateBillVendorDropdown() {
  const sel = document.getElementById("billVendorId");
  if (!sel) return;
  try {
    const vendors = await FinanceApi.getVendors({ is_active: true });
    sel.innerHTML = `<option value="">— Select vendor —</option>` + vendors.map((v) => `<option value="${v.id}" data-default-category-id="${v.default_category_id || ''}">${v.name}</option>`).join("");
  } catch (_) {}
}

function onBillVendorChange() {
  const vendorSel = document.getElementById("billVendorId");
  const categorySel = document.getElementById("billCategoryId");
  if (vendorSel && categorySel) {
    const opt = vendorSel.selectedOptions[0];
    const defaultCatId = opt?.dataset?.defaultCategoryId;
    // FUX-411: Auto-select vendor's default category if available and not manually set by user
    if (defaultCatId && (!categorySel.value || categorySel.dataset.userModified !== "true")) {
      categorySel.value = defaultCatId;
      categorySel.dataset.autoFilled = "true";
      onBillCategoryChange(true);
    }
  }
  onBillFieldInput();
}

function onBillCategoryChange(isAutoFill = false) {
  const categorySel = document.getElementById("billCategoryId");
  const hiddenCat = document.getElementById("billCategory");
  if (categorySel) {
    if (!isAutoFill) {
      categorySel.dataset.userModified = "true";
      delete categorySel.dataset.autoFilled;
    }
    const opt = categorySel.selectedOptions[0];
    const text = (opt && opt.value) ? opt.textContent.trim() : "";
    if (hiddenCat) hiddenCat.value = text;
  }
  _checkBillMissingFields();
  onBillFieldInput();
}

let _currentModalPendingFile = null;
let _currentModalAttachmentBillId = null;

function _resetBillCaptureSection() {
  _currentModalPendingFile = null;
  _currentModalAttachmentBillId = null;
  const fileInput = document.getElementById("billFileInput");
  const fileAttached = document.getElementById("billFileAttachedInfo");
  const fileName = document.getElementById("billAttachedFileName");
  const confidenceBadge = document.getElementById("billExtractionConfidenceBadge");
  const dupBanner = document.getElementById("billDuplicateBanner");
  const dupCheckbox = document.getElementById("billDuplicateOverrideCheckbox");
  const dupReasonGroup = document.getElementById("billDuplicateOverrideReasonGroup");
  const dupReason = document.getElementById("billDuplicateOverrideReason");
  const missingAlert = document.getElementById("billMissingFieldsAlert");
  const unreadableAlert = document.getElementById("billUnreadableAlert");

  if (fileInput) fileInput.value = "";
  if (fileAttached) fileAttached.style.display = "none";
  if (fileName) fileName.textContent = "";
  if (confidenceBadge) confidenceBadge.style.display = "none";
  if (dupBanner) dupBanner.style.display = "none";
  if (dupCheckbox) dupCheckbox.checked = false;
  if (dupReasonGroup) dupReasonGroup.style.display = "none";
  if (dupReason) dupReason.value = "";
  if (missingAlert) missingAlert.style.display = "none";
  if (unreadableAlert) unreadableAlert.style.display = "none";
}

function _checkBillMissingFields() {
  const alertEl = document.getElementById("billMissingFieldsAlert");
  const textEl = document.getElementById("billMissingFieldsText");
  if (!alertEl || !textEl) return;

  const dept = document.getElementById("billDepartment")?.value;
  const catId = document.getElementById("billCategoryId")?.value;
  const cat = document.getElementById("billCategory")?.value.trim();
  const missing = [];
  if (!dept) missing.push("Department");
  if (!catId && !cat) missing.push("Category");

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

  _currentModalPendingFile = file;
  const fileInfo = document.getElementById("billFileAttachedInfo");
  const fileNameSpan = document.getElementById("billAttachedFileName");
  const confidenceBadge = document.getElementById("billExtractionConfidenceBadge");
  const unreadableAlert = document.getElementById("billUnreadableAlert");
  const unreadableText = document.getElementById("billUnreadableText");

  if (fileNameSpan) fileNameSpan.textContent = file.name;
  if (fileInfo) fileInfo.style.display = "block";
  if (unreadableAlert) unreadableAlert.style.display = "none";

  if (confidenceBadge) {
    confidenceBadge.style.display = "inline-block";
    confidenceBadge.textContent = "Extracting...";
    confidenceBadge.className = "badge badge-info";
  }

  // AC 1: Uploaded bills strictly start unreviewed
  const reviewedCheckbox = document.getElementById("billIsReviewed");
  if (reviewedCheckbox) reviewedCheckbox.checked = false;

  document.getElementById("billCaptureSource").value = "upload";

  let extraction = null;
  try {
    extraction = await FinanceApi.extractBillDocument(file);
  } catch (err) {
    console.warn("Document extraction error:", err);
    if (confidenceBadge) {
      confidenceBadge.textContent = "Extraction Error";
      confidenceBadge.className = "badge badge-warning";
    }
    if (typeof showToast === "function") {
      showToast("Document extraction failed: " + (err.message || "Could not parse document"), "error");
    }
    return;
  }

  if (!extraction) return;

  // Fingerprint for duplicate detection
  if (extraction.file_fingerprint) {
    const fpEl = document.getElementById("billFileFingerprint");
    if (fpEl) fpEl.value = extraction.file_fingerprint;
  }

  // Handle unreadable / scanned documents
  if (!extraction.is_readable) {
    if (unreadableAlert) unreadableAlert.style.display = "block";
    if (unreadableText && extraction.unreadable_reason) {
      unreadableText.textContent = extraction.unreadable_reason;
    }
    if (confidenceBadge) {
      confidenceBadge.style.display = "inline-block";
      confidenceBadge.textContent = "Unreadable (0%)";
      confidenceBadge.className = "badge badge-warning";
    }

    const statusEl = document.getElementById("billStatus");
    if (statusEl) statusEl.value = "inbox";

    // FUX-413: DO NOT fabricate mock numbers, dates, or line items for unreadable scans!
    // Leave fields untouched for manual entry
    _updateBillTotals();
    _checkBillMissingFields();
    onBillFieldInput();
    return;
  }

  // Readable document: display confidence badge
  const confPct = Math.round((extraction.extraction_confidence || 0) * 100);
  if (confidenceBadge) {
    confidenceBadge.style.display = "inline-block";
    confidenceBadge.textContent = `Confidence: ${confPct}%`;
    confidenceBadge.className = confPct < 80 ? "badge badge-warning" : "badge badge-info";
  }

  const statusEl = document.getElementById("billStatus");
  if (statusEl) statusEl.value = confPct < 80 ? "inbox" : "needs_coding";

  // Prefill extracted invoice / bill number
  if (extraction.bill_number) {
    const numInput = document.getElementById("billNumber");
    if (numInput) numInput.value = extraction.bill_number;
  }

  // Prefill vendor if matched
  const vendorSel = document.getElementById("billVendorId");
  if (vendorSel) {
    if (extraction.vendor_id) {
      vendorSel.value = extraction.vendor_id;
      if (typeof onBillVendorChange === "function") onBillVendorChange();
    } else if (extraction.vendor_name) {
      const match = Array.from(vendorSel.options).find(
        (o) => o.textContent.trim().toLowerCase().includes(extraction.vendor_name.toLowerCase()) ||
               extraction.vendor_name.toLowerCase().includes(o.textContent.trim().toLowerCase())
      );
      if (match) {
        vendorSel.value = match.value;
        if (typeof onBillVendorChange === "function") onBillVendorChange();
      }
    }
  }

  // Prefill dates
  if (extraction.issue_date) {
    const issueDateInput = document.getElementById("billIssueDate");
    if (issueDateInput) issueDateInput.value = extraction.issue_date;
  }
  if (extraction.due_date) {
    const dueDateInput = document.getElementById("billDueDate");
    if (dueDateInput) dueDateInput.value = extraction.due_date;
  }

  // Prefill currency
  if (extraction.currency) {
    const currSel = document.getElementById("billCurrency");
    if (currSel) currSel.value = extraction.currency;
  }

  // Populate extracted line items
  const tbody = document.getElementById("billLinesBody");
  if (tbody) {
    tbody.innerHTML = "";
    if (extraction.lines && extraction.lines.length > 0) {
      extraction.lines.forEach((ln) => {
        addBillLine({
          description: ln.description || "Extracted Item",
          quantity: ln.quantity || 1,
          unit_price: ln.unit_price || 0,
          line_total: ln.line_total || 0,
        });
      });
    } else if (extraction.total != null && extraction.total > 0) {
      addBillLine({
        description: "Extracted Line Item",
        quantity: 1,
        unit_price: extraction.total,
        line_total: extraction.total,
      });
    }
  }

  _updateBillTotals();
  _checkBillMissingFields();
  onBillFieldInput();
}

function toggleBillPaidNowSection(checked) {
  const section = document.getElementById("billPaidNowSection");
  if (section) section.style.display = checked ? "block" : "none";
  if (checked) {
    _populateBillPaidNowAccounts();
    const totalEl = document.getElementById("billTotalDisplay");
    const amountInput = document.getElementById("billPaidNowAmount");
    if (amountInput && (!amountInput.value || amountInput.dataset.autofilled === "true")) {
      const currentTotal = totalEl ? parseFloat(totalEl.textContent) || 0 : 0;
      amountInput.value = currentTotal > 0 ? currentTotal.toFixed(2) : "";
      amountInput.dataset.autofilled = "true";
    }
    const dateInput = document.getElementById("billPaidNowDate");
    const issueDateInput = document.getElementById("billIssueDate");
    if (dateInput && !dateInput.value) {
      dateInput.value = (issueDateInput && issueDateInput.value) ? issueDateInput.value : new Date().toISOString().split("T")[0];
    }
  }
}

async function _populateBillPaidNowAccounts() {
  const accSel = document.getElementById("billPaidNowBankAccountId");
  if (!accSel) return;
  if (accSel.options.length > 1) return; // already loaded
  try {
    const accounts = await FinanceApi.getAccounts({ is_active: true });
    accSel.innerHTML = `<option value="">— Select account —</option>` + accounts.map((a) => `<option value="${a.id}">${a.account_name} (${a.currency} ${Number(a.current_balance).toLocaleString("en-US", { minimumFractionDigits: 2 })})</option>`).join("");
  } catch (_) {
    accSel.innerHTML = "<option value=''>— No accounts available —</option>";
  }
}

function _resetBillPaidNowSection() {
  const group = document.getElementById("billIsPaidNowGroup");
  const chk = document.getElementById("billIsPaidNow");
  const section = document.getElementById("billPaidNowSection");
  const amtInput = document.getElementById("billPaidNowAmount");
  if (group) group.style.display = "block";
  if (chk) chk.checked = false;
  if (section) section.style.display = "none";
  if (amtInput) {
    amtInput.value = "";
    delete amtInput.dataset.autofilled;
  }
}

function _resetBillStatusDisplay(bill = null) {
  const statusSel = document.getElementById("billStatus");
  const readOnlyContainer = document.getElementById("billStatusReadOnlyContainer");
  const readOnlyBadge = document.getElementById("billStatusReadOnlyBadge");

  // If editing a bill that has payments recorded or is in settled status, show read-only status badge
  const isSettledOrPaid = bill && (bill.status === "paid" || bill.status === "partially_paid" || (bill.amount_paid && bill.amount_paid > 0));
  if (isSettledOrPaid) {
    if (statusSel) statusSel.style.display = "none";
    if (readOnlyContainer) readOnlyContainer.style.display = "block";
    if (readOnlyBadge) {
      readOnlyBadge.textContent = bill.status === "paid" ? "Paid" : "Partially Paid";
      readOnlyBadge.className = bill.status === "paid" ? "badge badge-success" : "badge badge-warning";
    }
  } else {
    if (statusSel) statusSel.style.display = "block";
    if (readOnlyContainer) readOnlyContainer.style.display = "none";
  }
}

function openCaptureBillModal() {
  FinanceForm.clearErrors("billModal");
  _resetBillCaptureSection();
  _resetBillPaidNowSection();
  _resetBillStatusDisplay();
  _populateBillVendorDropdown();
  _populateBillCategoryDropdown();

  document.getElementById("billModalTitleText").textContent = "Upload & Capture Vendor Bill";
  document.getElementById("billModalId").value = "";
  document.getElementById("billCaptureSource").value = "upload";
  document.getElementById("billFileFingerprint").value = "";
  document.getElementById("billVendorId").value = "";
  document.getElementById("billNumber").value = "";
  document.getElementById("billDepartment").value = "";
  const catSel = document.getElementById("billCategoryId");
  if (catSel) {
    catSel.value = "";
    delete catSel.dataset.userModified;
    delete catSel.dataset.autoFilled;
  }
  document.getElementById("billCategory").value = "";
  document.getElementById("billLegalEntity").value = "Voyance Health Inc";
  document.getElementById("billIssueDate").value = "";
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
  _resetBillPaidNowSection();
  _resetBillStatusDisplay();
  _populateBillVendorDropdown();
  _populateBillCategoryDropdown();

  document.getElementById("billModalTitleText").textContent = "New Vendor Bill";
  document.getElementById("billModalId").value = "";
  document.getElementById("billCaptureSource").value = "manual";
  document.getElementById("billFileFingerprint").value = "";
  document.getElementById("billVendorId").value = "";
  document.getElementById("billNumber").value = "";
  document.getElementById("billDepartment").value = "";
  const catSel = document.getElementById("billCategoryId");
  if (catSel) {
    catSel.value = "";
    delete catSel.dataset.userModified;
    delete catSel.dataset.autoFilled;
  }
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
  await _populateBillCategoryDropdown();

  // Hide "Bill is already paid" on edit mode
  const paidNowGroup = document.getElementById("billIsPaidNowGroup");
  if (paidNowGroup) paidNowGroup.style.display = "none";

  try {
    const bill = await FinanceApi.getBill(billId);
    _resetBillStatusDisplay(bill);

    document.getElementById("billModalTitleText").textContent = `Edit Bill ${bill.bill_number}`;
    document.getElementById("billModalId").value = bill.id;
    document.getElementById("billCaptureSource").value = bill.capture_source || "manual";
    document.getElementById("billFileFingerprint").value = bill.file_fingerprint || "";
    document.getElementById("billVendorId").value = bill.vendor_id || "";
    document.getElementById("billNumber").value = bill.bill_number || "";
    document.getElementById("billDepartment").value = bill.department || "";
    const catSel = document.getElementById("billCategoryId");
    if (catSel) {
      if (bill.category_id) {
        catSel.value = bill.category_id;
      } else if (bill.category) {
        const matchingOpt = Array.from(catSel.options).find(
          (o) => o.textContent.trim().toLowerCase() === bill.category.trim().toLowerCase()
        );
        catSel.value = matchingOpt ? matchingOpt.value : "";
      } else {
        catSel.value = "";
      }
      catSel.dataset.userModified = "true";
    }
    document.getElementById("billCategory").value = bill.category || "";
    document.getElementById("billLegalEntity").value = bill.legal_entity || "Voyance Health Inc";
    document.getElementById("billIssueDate").value = bill.issue_date || "";
    document.getElementById("billDueDate").value = bill.due_date || "";
    document.getElementById("billStatus").value = bill.status || "inbox";
    document.getElementById("billCurrency").value = bill.currency || "USD";
    document.getElementById("billNotes").value = bill.notes || "";
    document.getElementById("billIsReviewed").checked = !!bill.is_reviewed;

    if (bill.attachment_name || bill.attachment_url) {
      _currentModalAttachmentBillId = bill.id;
      const fileInfo = document.getElementById("billFileAttachedInfo");
      const fileNameSpan = document.getElementById("billAttachedFileName");
      const confidenceBadge = document.getElementById("billExtractionConfidenceBadge");
      if (fileNameSpan) fileNameSpan.textContent = bill.attachment_name || "bill_attachment.pdf";
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

  // FUX-408: Sync inline payment amount if checked
  const isPaidNowCheckbox = document.getElementById("billIsPaidNow");
  const paidNowAmount = document.getElementById("billPaidNowAmount");
  if (isPaidNowCheckbox && isPaidNowCheckbox.checked && paidNowAmount && (!paidNowAmount.value || paidNowAmount.dataset.autofilled === "true")) {
    paidNowAmount.value = subtotal.toFixed(2);
    paidNowAmount.dataset.autofilled = "true";
  }
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

  // FUX-408: Handle combined create-and-pay if isPaidNow is checked
  const isPaidNowCheckbox = document.getElementById("billIsPaidNow");
  const isPaidNow = !billId && isPaidNowCheckbox && isPaidNowCheckbox.checked;
  let paymentData = null;
  if (isPaidNow) {
    const bankAccountId = document.getElementById("billPaidNowBankAccountId").value;
    const paymentDate = document.getElementById("billPaidNowDate").value;
    const paymentAmount = parseFloat(document.getElementById("billPaidNowAmount").value);
    const paymentMethod = document.getElementById("billPaidNowMethod").value || "bank_transfer";
    const paymentRef = document.getElementById("billPaidNowReference").value.trim() || null;

    if (!bankAccountId) {
      showToast("Please select a bank account for the payment.", "warning");
      document.getElementById("billPaidNowBankAccountId").focus();
      return;
    }
    if (!paymentDate) {
      showToast("Please enter the payment date.", "warning");
      document.getElementById("billPaidNowDate").focus();
      return;
    }

    paymentData = {
      bank_account_id: parseInt(bankAccountId, 10),
      payment_date: paymentDate,
      amount: !isNaN(paymentAmount) && paymentAmount > 0 ? paymentAmount : null,
      method: paymentMethod,
      reference: paymentRef,
    };
  }

  const payload = {
    vendor_id: parseInt(vendorId, 10),
    bill_number: billNumber,
    department: document.getElementById("billDepartment").value || null,
    legal_entity: document.getElementById("billLegalEntity").value || "Voyance Health Inc",
    category_id: document.getElementById("billCategoryId")?.value ? parseInt(document.getElementById("billCategoryId").value, 10) : null,
    category: document.getElementById("billCategory")?.value.trim() || null,
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
    ...(isPaidNow ? { is_paid_now: true, payment: paymentData } : {}),
  };

  const btn = document.getElementById("billModalSaveBtn");
  if (btn) btn.disabled = true;
  try {
    let savedBill = null;
    if (billId) {
      savedBill = await FinanceApi.updateBill(billId, payload);
      showToast("Bill updated", "success");
    } else {
      savedBill = await FinanceApi.createBill(payload);
      showToast(isPaidNow ? "Bill created and payment recorded" : "Bill created", "success");
    }

    // If a new physical file was chosen, upload it to durable attachment storage
    if (_currentModalPendingFile && savedBill && savedBill.id) {
      try {
        await FinanceApi.uploadBillAttachment(savedBill.id, _currentModalPendingFile);
      } catch (uploadErr) {
        console.warn("Failed to upload bill attachment:", uploadErr);
        showToast("Bill saved, but attachment upload failed: " + (uploadErr.message || uploadErr), "warning");
      }
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
  const filterToggleBtn = document.getElementById("financeBillFilterToggleBtn");
  const filterPanel = document.getElementById("financeBillFilterPanel");
  const workQueueTabs = document.getElementById("financeBillWorkQueueTabs");
  const statusToggleBar = document.getElementById("financeBillStatusToggleBar");
  const statusPanel = document.getElementById("financeBillStatusPanel");
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
    if (filterToggleBtn) filterToggleBtn.style.display = "none";
    if (filterPanel) filterPanel.style.display = "none";
    if (statusToggleBar) statusToggleBar.style.display = "none";
    if (statusPanel) statusPanel.style.display = "none";
    if (workQueueTabs) workQueueTabs.style.display = "none";
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
    if (filterToggleBtn) filterToggleBtn.style.display = "inline-flex";
    if (statusToggleBar) statusToggleBar.style.display = "flex";
    if (statusPanel) statusPanel.style.display = "none";
    setBillStatusPanelExpanded(false);
    if (workQueueTabs) workQueueTabs.style.display = "flex";
    const savedPref = localStorage.getItem(_getBillFilterStorageKey());
    setBillFilterPanelExpanded(savedPref === "true", false);
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
      <td>
        <a href="javascript:void(0)" class="table-entity-link" onclick="openVendor360Drawer(${v.id})"><strong>${v.name}</strong></a>
        ${v.legal_name && v.legal_name !== v.name ? `<div style="font-size:12px;color:var(--text2);">${v.legal_name}</div>` : ""}
        ${v.notes ? `<div style="font-size:12px;color:var(--text3);">${v.notes}</div>` : ""}
      </td>
      <td><span class="badge badge-info">${v.category || "General"}</span></td>
      <td>${v.contact_email ? `<a href="mailto:${v.contact_email}">${v.contact_email}</a>` : "—"}</td>
      <td>${v.contact_phone || "—"}</td>
      <td><code>${v.tax_id || "—"}</code></td>
      <td>${FinanceFormat.formatStatusBadge("vendor", v.is_active ? "active" : "inactive")}</td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm btn-icon" title="View 360 & Payments" onclick="openVendor360Drawer(${v.id})"><i class="fa-solid fa-eye"></i></button>
          <button class="btn btn-sm btn-icon" title="Edit Vendor" onclick="openEditVendorModal(${v.id})"><i class="fa-solid fa-pen-to-square"></i></button>
          <button class="btn btn-sm btn-icon ${v.is_active ? "btn-danger" : ""}" title="${v.is_active ? "Deactivate" : "Activate"}" onclick="toggleVendorActive(${v.id}, ${v.is_active})"><i class="fa-solid ${v.is_active ? "fa-ban" : "fa-check"}"></i></button>
        </div>
      </td>
    </tr>
  `).join("");
}

function openVendor360Drawer(vendorId) {
  const drawer = window.FinanceDrawer || window.FinanceDetailDrawer;
  if (drawer && drawer.open) {
    drawer.open("vendor", vendorId);
  }
}
window.openVendor360Drawer = openVendor360Drawer;

let _vendorDuplicateDebounce = null;
async function onVendorFieldInput() {
  clearTimeout(_vendorDuplicateDebounce);
  _vendorDuplicateDebounce = setTimeout(async () => {
    const banner = document.getElementById("vendorDuplicateBanner");
    const bannerText = document.getElementById("vendorDuplicateText");
    if (!banner) return;

    const idVal = document.getElementById("fVendorId")?.value;
    const name = document.getElementById("fVendorName")?.value.trim() || "";
    const legal_name = document.getElementById("fVendorLegalName")?.value.trim() || "";
    const contact_email = document.getElementById("fVendorEmail")?.value.trim() || "";
    const tax_id = document.getElementById("fVendorTaxId")?.value.trim() || "";

    if (!name && !legal_name && !contact_email && !tax_id) {
      banner.style.display = "none";
      return;
    }

    try {
      const candidates = await FinanceApi.checkVendorDuplicate({
        name: name || legal_name,
        contact_email,
        tax_id,
      });
      const filtered = (candidates || []).filter((c) => !idVal || c.id !== parseInt(idVal, 10));
      if (filtered.length > 0) {
        const top = filtered[0];
        banner.style.display = "block";
        if (bannerText) {
          bannerText.innerHTML = `Existing vendor <strong>"${top.name}"</strong> matches on <em>${top.matched_field}</em>.`;
        }
      } else {
        banner.style.display = "none";
      }
    } catch (err) {
      console.warn("Failed duplicate check:", err);
    }
  }, 250);
}
window.onVendorFieldInput = onVendorFieldInput;

function filterFinanceVendors(query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return renderFinanceVendors(FinanceState.vendors);
  renderFinanceVendors(FinanceState.vendors.filter((v) => v.name.toLowerCase().includes(q) || (v.category && v.category.toLowerCase().includes(q)) || (v.contact_email && v.contact_email.toLowerCase().includes(q)) || (v.tax_id && v.tax_id.toLowerCase().includes(q))));
}

async function renderVendorPaymentInstructionsInModal(vendorId) {
  const container = document.getElementById("vendorPaymentInstructionsList");
  if (!container) return;
  if (!vendorId) {
    container.innerHTML = `<div style="font-size:0.8rem; color:var(--text3); font-style:italic;">Save vendor profile first to attach and verify payment instructions.</div>`;
    return;
  }
  try {
    const list = await FinanceApi.getVendorPaymentInstructions(vendorId);
    if (!list || list.length === 0) {
      container.innerHTML = `<div style="font-size:0.82rem; color:var(--text3); margin-bottom:8px;">No bank or payment instructions recorded for this vendor yet.</div>`;
      return;
    }
    container.innerHTML = list.map((pi) => `
      <div class="card" style="padding:10px 14px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; background:var(--surface); border:1px solid var(--border);">
        <div>
          <div style="font-weight:700; font-size:0.9rem;">${pi.bank_name || 'Bank'} <span class="badge ${pi.verification_status === 'verified' ? 'badge-success' : 'badge-warning'}" style="margin-left:6px; font-size:0.7rem;">${pi.verification_status.toUpperCase()}</span></div>
          <div style="font-size:0.8rem; color:var(--text2); font-family:monospace; margin-top:2px;">Acct: ${pi.account_number || '—'} ${pi.routing_number ? `| Routing: ${pi.routing_number}` : ''}</div>
          <div style="font-size:0.75rem; color:var(--text3);">${pi.account_holder_name ? `Holder: ${pi.account_holder_name}` : ''} ${pi.verified_by ? `• Verified by ${pi.verified_by}` : ''}</div>
        </div>
        <div>
          ${pi.verification_status !== 'verified' ? `
            <button type="button" class="btn btn-sm btn-primary" onclick="verifyVendorPaymentInstructionItem(${vendorId}, ${pi.id})"><i class="fa-solid fa-check"></i> Verify Instruction</button>
          ` : `
            <button type="button" class="btn btn-sm btn-outline" onclick="verifyVendorPaymentInstructionItem(${vendorId}, ${pi.id}, 'unverified')"><i class="fa-solid fa-rotate-left"></i> Re-verify</button>
          `}
        </div>
      </div>
    `).join("");
  } catch (err) {
    container.innerHTML = `<div style="font-size:0.8rem; color:var(--danger);">${err.message || 'Failed to load payment instructions'}</div>`;
  }
}

async function verifyVendorPaymentInstructionItem(vendorId, piId, decision = "verified") {
  try {
    await FinanceApi.verifyVendorPaymentInstruction(vendorId, piId, { decision, comment: `Instruction ${decision} via admin portal` });
    showToast(`Payment instruction marked as ${decision}`, "success");
    renderVendorPaymentInstructionsInModal(vendorId);
  } catch (err) {
    showToast(err.message || "Failed to verify instruction", "error");
  }
}
window.verifyVendorPaymentInstructionItem = verifyVendorPaymentInstructionItem;

async function saveVendorPaymentInstruction() {
  const vendorId = document.getElementById("fVendorId").value;
  if (!vendorId) {
    showToast("Please save the vendor profile first before adding payment instructions", "warning");
    return;
  }
  const bank_name = document.getElementById("fVendorPIBankName").value.trim();
  const account_holder_name = document.getElementById("fVendorPIAccountHolder").value.trim();
  const account_number = document.getElementById("fVendorPIAccountNumber").value.trim();
  const routing_number = document.getElementById("fVendorPIRouting").value.trim();

  if (!account_number) {
    showToast("Account number is required", "error");
    return;
  }

  const payload = {
    payment_method: "bank_transfer",
    bank_name: bank_name || "Bank",
    account_holder_name: account_holder_name || null,
    account_number,
    routing_number: routing_number || null,
  };

  try {
    await FinanceApi.createVendorPaymentInstruction(parseInt(vendorId, 10), payload);
    showToast("Payment instruction added (unverified)", "success");
    document.getElementById("fVendorPIBankName").value = "";
    document.getElementById("fVendorPIAccountHolder").value = "";
    document.getElementById("fVendorPIAccountNumber").value = "";
    document.getElementById("fVendorPIRouting").value = "";
    renderVendorPaymentInstructionsInModal(parseInt(vendorId, 10));
  } catch (err) {
    showToast(err.message || "Failed to add payment instruction", "error");
  }
}
window.saveVendorPaymentInstruction = saveVendorPaymentInstruction;

async function _populateVendorCategoryDropdown() {
  const sel = document.getElementById("fVendorDefaultCategoryId");
  if (!sel) return;
  if (sel.options.length > 1) return;
  try {
    const categories = await FinanceApi.getCategories({ is_active: true });
    const sorted = (categories || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.name.localeCompare(b.name));
    sel.innerHTML = `<option value="">— None (Select per bill) —</option>` + sorted.map((c) => `<option value="${c.id}">${c.name}</option>`).join("");
  } catch (_) {
    sel.innerHTML = `<option value="">— None (Select per bill) —</option>`;
  }
}

async function openAddVendorModal() {
  FinanceForm.clearErrors("vendorModal");
  const banner = document.getElementById("vendorDuplicateBanner");
  if (banner) banner.style.display = "none";
  await _populateVendorCategoryDropdown();
  document.getElementById("fVendorId").value = "";
  document.getElementById("fVendorName").value = "";
  if (document.getElementById("fVendorLegalName")) document.getElementById("fVendorLegalName").value = "";
  document.getElementById("fVendorCategory").value = "General";
  if (document.getElementById("fVendorDefaultCategoryId")) document.getElementById("fVendorDefaultCategoryId").value = "";
  document.getElementById("fVendorEmail").value = "";
  document.getElementById("fVendorPhone").value = "";
  if (document.getElementById("fVendorContactName")) document.getElementById("fVendorContactName").value = "";
  if (document.getElementById("fVendorCountry")) document.getElementById("fVendorCountry").value = "Egypt";
  if (document.getElementById("fVendorTerms")) document.getElementById("fVendorTerms").value = "30";
  if (document.getElementById("fVendorCurrency")) document.getElementById("fVendorCurrency").value = "EGP";
  if (document.getElementById("fVendorDepartment")) document.getElementById("fVendorDepartment").value = "Engineering";
  if (document.getElementById("fVendorWithholdingRate")) document.getElementById("fVendorWithholdingRate").value = "0.0";
  if (document.getElementById("fVendorAddress")) document.getElementById("fVendorAddress").value = "";
  document.getElementById("fVendorTaxId").value = "";
  document.getElementById("fVendorNotes").value = "";

  renderVendorPaymentInstructionsInModal(null);

  const title = document.getElementById("vendorModalTitle");
  if (title) title.textContent = "Add Vendor";
  const btn = document.getElementById("vendorSaveBtn");
  if (btn) btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Save Vendor`;
  openModal("vendorModal");
}

async function openEditVendorModal(id) {
  FinanceForm.clearErrors("vendorModal");
  const banner = document.getElementById("vendorDuplicateBanner");
  if (banner) banner.style.display = "none";
  await _populateVendorCategoryDropdown();
  const v = FinanceState.vendors.find((x) => x.id === id);
  if (!v) return;
  document.getElementById("fVendorId").value = v.id;
  document.getElementById("fVendorName").value = v.name || "";
  if (document.getElementById("fVendorLegalName")) document.getElementById("fVendorLegalName").value = v.legal_name || "";
  document.getElementById("fVendorCategory").value = v.category || "General";
  if (document.getElementById("fVendorDefaultCategoryId")) {
    document.getElementById("fVendorDefaultCategoryId").value = v.default_category_id ? String(v.default_category_id) : "";
  }
  document.getElementById("fVendorEmail").value = v.contact_email || "";
  document.getElementById("fVendorPhone").value = v.contact_phone || "";
  if (document.getElementById("fVendorContactName")) document.getElementById("fVendorContactName").value = v.contact_name || "";
  if (document.getElementById("fVendorCountry")) {
    const cVal = v.country || "Egypt";
    const cSelect = document.getElementById("fVendorCountry");
    if (cSelect && !Array.from(cSelect.options).some((o) => o.value === cVal)) {
      const opt = document.createElement("option");
      opt.value = cVal;
      opt.textContent = cVal;
      cSelect.appendChild(opt);
    }
    cSelect.value = cVal;
  }
  if (document.getElementById("fVendorTerms")) document.getElementById("fVendorTerms").value = v.payment_terms_days !== undefined ? v.payment_terms_days : 30;
  if (document.getElementById("fVendorCurrency")) document.getElementById("fVendorCurrency").value = v.default_currency || "EGP";
  if (document.getElementById("fVendorDepartment")) document.getElementById("fVendorDepartment").value = v.default_department || "Engineering";
  if (document.getElementById("fVendorWithholdingRate")) document.getElementById("fVendorWithholdingRate").value = v.withholding_tax_rate !== undefined ? v.withholding_tax_rate : 0.0;
  if (document.getElementById("fVendorAddress")) document.getElementById("fVendorAddress").value = v.remit_address || "";
  document.getElementById("fVendorTaxId").value = v.tax_id || "";
  document.getElementById("fVendorNotes").value = v.notes || "";

  renderVendorPaymentInstructionsInModal(v.id);

  const title = document.getElementById("vendorModalTitle");
  if (title) title.textContent = "Edit Vendor";
  const btn = document.getElementById("vendorSaveBtn");
  if (btn) btn.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> Update Vendor`;
  openModal("vendorModal");
}

async function saveVendor() {
  const idVal = document.getElementById("fVendorId").value;
  const name = document.getElementById("fVendorName").value.trim();
  const legal_name = document.getElementById("fVendorLegalName") ? document.getElementById("fVendorLegalName").value.trim() : null;
  const category = document.getElementById("fVendorCategory").value.trim();
  const default_cat_val = document.getElementById("fVendorDefaultCategoryId") ? document.getElementById("fVendorDefaultCategoryId").value : "";
  const contact_email = document.getElementById("fVendorEmail").value.trim();
  const contact_phone = document.getElementById("fVendorPhone").value.trim();
  const contact_name = document.getElementById("fVendorContactName") ? document.getElementById("fVendorContactName").value.trim() : null;
  const country = document.getElementById("fVendorCountry") ? document.getElementById("fVendorCountry").value.trim() : null;
  const payment_terms_days = document.getElementById("fVendorTerms") ? parseInt(document.getElementById("fVendorTerms").value, 10) : 30;
  const default_currency = document.getElementById("fVendorCurrency") ? document.getElementById("fVendorCurrency").value : "EGP";
  const default_department = document.getElementById("fVendorDepartment") ? document.getElementById("fVendorDepartment").value : null;
  const withholding_tax_rate = document.getElementById("fVendorWithholdingRate") ? parseFloat(document.getElementById("fVendorWithholdingRate").value) : 0.0;
  const remit_address = document.getElementById("fVendorAddress") ? document.getElementById("fVendorAddress").value.trim() : null;
  const tax_id = document.getElementById("fVendorTaxId").value.trim();
  const notes = document.getElementById("fVendorNotes").value.trim();
  const isValid = FinanceForm.validateRequiredFields("vendorModal", [
    { id: "fVendorName", label: "Vendor / Supplier Name" }
  ]);
  if (!isValid) return;
  const payload = {
    name,
    legal_name: legal_name || null,
    category: category || "General",
    default_category_id: default_cat_val ? parseInt(default_cat_val, 10) : null,
    contact_email: contact_email || null,
    contact_phone: contact_phone || null,
    contact_name: contact_name || null,
    country: country || "Egypt",
    payment_terms_days: isNaN(payment_terms_days) ? 30 : payment_terms_days,
    default_currency: default_currency || "EGP",
    default_department: default_department || null,
    withholding_tax_rate: isNaN(withholding_tax_rate) ? 0.0 : withholding_tax_rate,
    remit_address: remit_address || null,
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
      const created = await FinanceApi.createVendor(payload);
      showToast("Vendor created successfully", "success");
      document.getElementById("fVendorId").value = created.id;
      renderVendorPaymentInstructionsInModal(created.id);
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
window.toggleBillFilterPanel = toggleBillFilterPanel;
window.setBillFilterPanelExpanded = setBillFilterPanelExpanded;
window.isBillFilterPanelExpanded = isBillFilterPanelExpanded;
window.updateBillFilterBadge = updateBillFilterBadge;
window.onBillFilterChanged = onBillFilterChanged;
window.resetBillSecondaryFilters = resetBillSecondaryFilters;
window.toggleBillStatusPanel = toggleBillStatusPanel;
window.setBillStatusPanelExpanded = setBillStatusPanelExpanded;
window.isBillStatusPanelExpanded = isBillStatusPanelExpanded;
window.setBillWorkQueue = setBillWorkQueue;
window.loadFinanceBillQueueCounts = loadFinanceBillQueueCounts;
window.openCaptureBillModal = openCaptureBillModal;
window.handleBillFileSelected = handleBillFileSelected;
window.onBillFieldInput = onBillFieldInput;
window.onBillVendorChange = onBillVendorChange;
window.onBillCategoryChange = onBillCategoryChange;
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
window.onVendorFieldInput = onVendorFieldInput;
window.openVendor360Drawer = openVendor360Drawer;
window.saveVendorPaymentInstruction = saveVendorPaymentInstruction;
window.verifyVendorPaymentInstructionItem = verifyVendorPaymentInstructionItem;

// ── Attachment Document Preview & Download (FUX-407) ─────────────────────────

async function previewBillDocument(billId) {
  try {
    const modal = document.getElementById("documentPreviewModal");
    const container = document.getElementById("docPreviewContainer");
    const title = document.getElementById("docPreviewTitle");
    const downloadBtn = document.getElementById("docPreviewDownloadBtn");

    if (!modal || !container) {
      showToast("Document preview modal not found", "error");
      return;
    }

    const bill = (FinanceState.bills || []).find((b) => b.id === parseInt(billId, 10)) || { bill_number: `#${billId}` };
    const fileName = bill.attachment_name || `Bill_${bill.bill_number}.pdf`;

    if (title) title.textContent = `Attachment: ${fileName}`;
    container.innerHTML = '<div style="color:var(--text3); padding:20px; font-size:14px;"><i class="fa-solid fa-spinner fa-spin"></i> Loading document preview...</div>';

    if (modal.classList) {
      modal.classList.add("active");
    } else {
      modal.style.display = "flex";
    }

    const blobUrl = await FinanceApi.getBillAttachmentBlobUrl(billId);
    if (downloadBtn) {
      downloadBtn.href = blobUrl;
      downloadBtn.download = fileName;
    }

    const isPdf = fileName.toLowerCase().endsWith(".pdf") || fileName.toLowerCase().includes(".pdf");
    if (isPdf) {
      container.innerHTML = `<iframe src="${blobUrl}" style="width:100%; height:75vh; border:none; background:var(--surface);"></iframe>`;
    } else {
      container.innerHTML = `<img src="${blobUrl}" alt="Attachment preview" style="max-width:100%; max-height:75vh; object-fit:contain;">`;
    }
  } catch (err) {
    showToast("Failed to preview bill document: " + (err.message || err), "error");
  }
}

async function downloadBillAttachment(billId) {
  try {
    const bill = (FinanceState.bills || []).find((b) => b.id === parseInt(billId, 10));
    const fileName = bill?.attachment_name || `Bill_${billId}.pdf`;
    const blobUrl = await FinanceApi.getBillAttachmentBlobUrl(billId);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    showToast("Failed to download bill attachment: " + (err.message || err), "error");
  }
}

async function previewCurrentModalBillDocument() {
  if (_currentModalPendingFile) {
    const url = URL.createObjectURL(_currentModalPendingFile);
    const modal = document.getElementById("documentPreviewModal");
    const container = document.getElementById("docPreviewContainer");
    const title = document.getElementById("docPreviewTitle");
    const downloadBtn = document.getElementById("docPreviewDownloadBtn");
    if (title) title.textContent = `Attachment: ${_currentModalPendingFile.name}`;
    if (downloadBtn) {
      downloadBtn.href = url;
      downloadBtn.download = _currentModalPendingFile.name;
    }
    if (modal) modal.classList.add("active");
    if (_currentModalPendingFile.name.toLowerCase().endsWith(".pdf")) {
      container.innerHTML = `<iframe src="${url}" style="width:100%; height:75vh; border:none; background:var(--surface);"></iframe>`;
    } else {
      container.innerHTML = `<img src="${url}" alt="Preview" style="max-width:100%; max-height:75vh; object-fit:contain;">`;
    }
    return;
  }
  const billId = _currentModalAttachmentBillId || document.getElementById("billModalId")?.value;
  if (billId) {
    previewBillDocument(billId);
  } else {
    showToast("No attachment available to preview", "info");
  }
}

async function downloadCurrentModalBillDocument() {
  if (_currentModalPendingFile) {
    const url = URL.createObjectURL(_currentModalPendingFile);
    const a = document.createElement("a");
    a.href = url;
    a.download = _currentModalPendingFile.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }
  const billId = _currentModalAttachmentBillId || document.getElementById("billModalId")?.value;
  if (billId) {
    downloadBillAttachment(billId);
  } else {
    showToast("No attachment available to download", "info");
  }
}

async function removeBillModalAttachment() {
  const billId = _currentModalAttachmentBillId || document.getElementById("billModalId")?.value;
  if (billId) {
    const result = await FinanceCommand.confirmAction({
      title: "Remove Attached Document",
      consequence: "Are you sure you want to remove this document attachment from the bill?",
      actionLabel: "Remove Attachment",
      actionClass: "btn btn-danger",
    });
    if (!result.confirmed) return;
    try {
      await FinanceApi.deleteBillAttachment(billId);
      showToast("Attachment removed", "success");
    } catch (err) {
      showToast("Failed to remove attachment: " + (err.message || err), "error");
      return;
    }
  }

  _currentModalPendingFile = null;
  _currentModalAttachmentBillId = null;
  const fileInput = document.getElementById("billFileInput");
  if (fileInput) fileInput.value = "";
  const fileInfo = document.getElementById("billFileAttachedInfo");
  if (fileInfo) fileInfo.style.display = "none";
  const fileNameSpan = document.getElementById("billAttachedFileName");
  if (fileNameSpan) fileNameSpan.textContent = "";
  const fingerprint = document.getElementById("billFileFingerprint");
  if (fingerprint) fingerprint.value = "";
}

window.previewBillDocument = previewBillDocument;
window.downloadBillAttachment = downloadBillAttachment;
window.previewCurrentModalBillDocument = previewCurrentModalBillDocument;
window.downloadCurrentModalBillDocument = downloadCurrentModalBillDocument;
window.removeBillModalAttachment = removeBillModalAttachment;

