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
  draft: "Draft",
  pending_approval: "Pending Approval",
  rejected: "Rejected",
  approved: "Approved",
  scheduled: "Scheduled",
  partially_paid: "Partially Paid",
  paid: "Paid",
  void: "Void",
};

let _currentBillQueueCounts = {
  all: 0,
  draft: 0,
  pending_approval: 0,
  rejected: 0,
  approved: 0,
  scheduled: 0,
  partially_paid: 0,
  paid: 0,
  void: 0,
  overdue: 0,
};

// Frontend visibility only; the backend enforces finance.bill.approve / finance.bill.pay.
function _canBill(key) {
  return typeof SessionInfo === "undefined" || typeof SessionInfo.hasPermission !== "function" || SessionInfo.hasPermission(key);
}

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
    draft: "tabBillQueueDraft",
    pending_approval: "tabBillQueuePendingApproval",
    rejected: "tabBillQueueRejected",
    approved: "tabBillQueueApproved",
    scheduled: "tabBillQueueScheduled",
    partially_paid: "tabBillQueuePartiallyPaid",
    paid: "tabBillQueuePaid",
    void: "tabBillQueueVoid",
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
    _currentBillQueueCounts = {
      all: counts.all ?? 0,
      draft: counts.draft ?? 0,
      pending_approval: counts.pending_approval ?? 0,
      rejected: counts.rejected ?? 0,
      approved: counts.approved ?? 0,
      scheduled: counts.scheduled ?? 0,
      partially_paid: counts.partially_paid ?? 0,
      paid: counts.paid ?? 0,
      void: counts.void ?? 0,
      overdue: counts.overdue ?? 0,
    };
    const overdueCountEl = document.getElementById("financeBillOverdueCount");
    if (overdueCountEl) overdueCountEl.textContent = _currentBillQueueCounts.overdue;
    const badgeMap = {
      badgeBillQueueAll: _currentBillQueueCounts.all,
      badgeBillQueueDraft: _currentBillQueueCounts.draft,
      badgeBillQueuePendingApproval: _currentBillQueueCounts.pending_approval,
      badgeBillQueueRejected: _currentBillQueueCounts.rejected,
      badgeBillQueueApproved: _currentBillQueueCounts.approved,
      badgeBillQueueScheduled: _currentBillQueueCounts.scheduled,
      badgeBillQueuePartiallyPaid: _currentBillQueueCounts.partially_paid,
      badgeBillQueuePaid: _currentBillQueueCounts.paid,
      badgeBillQueueVoid: _currentBillQueueCounts.void,
    };
    Object.entries(badgeMap).forEach(([id, count]) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = count;
      const pill = el.closest(".fv-pill");
      if (pill) pill.classList.toggle("fv-pill--zero", !count);
    });
    const state = FinanceTable.getState("finance_bills");
  } catch (err) {
    console.warn("Failed to load bill queue counts:", err);
  }
}

function onBillOverdueOnlyChange() {
  loadFinanceBills();
}

async function loadFinanceBills(incomingParams) {
  const bar = document.getElementById("financeBillsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const cachedState = FinanceTable.getState("finance_bills");
    const searchInput = document.getElementById("financeBillSearch");

    // Deep links: the status tabs are the only status filter, so a "status" link selects its tab.
    const urlParams = (typeof window !== "undefined" && window.location) ? new URLSearchParams(window.location.search) : null;
    const wantedQueue = (incomingParams && (incomingParams.queue || incomingParams.status))
      || (!_billTableInitialized && urlParams && (urlParams.get("queue") || urlParams.get("status")))
      || null;
    const wantedSearch = (incomingParams && incomingParams.search)
      || (!_billTableInitialized && !incomingParams && urlParams && urlParams.get("search"))
      || null;

    if (wantedQueue) cachedState.queue = wantedQueue;
    if (wantedSearch && searchInput) searchInput.value = wantedSearch;

    if (!_billTableInitialized) {
      if (!incomingParams && !wantedSearch && cachedState.filters?.search && searchInput) {
        searchInput.value = cachedState.filters.search;
      }
      _billTableInitialized = true;
    }
    _updateBillQueueTabs(cachedState.queue || "all");

    const params = {};
    const overdueOnly = document.getElementById("financeBillOverdueOnly");
    if (overdueOnly && overdueOnly.checked) params.overdue = true;
    if (cachedState.queue && cachedState.queue !== "all") params.queue = cachedState.queue;
    else params.queue = "all"; // "All" excludes Void, matching the tab counts

    const [items] = await Promise.all([
      FinanceApi.getBills(Object.keys(params).length ? params : undefined),
      loadFinanceBillQueueCounts(),
      FinanceUI.loadCategories(),
    ]);
    FinanceState.bills = items || [];
    applyAndRenderBills();
  } catch (err) {
    console.error("Failed to load vendor bills:", err);
    showToast(describeLoadFailure("bills", err), "error");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function applyAndRenderBills() {
  const state = FinanceTable.getState("finance_bills");
  const searchInput = document.getElementById("financeBillSearch");
  const currentSearch = searchInput ? searchInput.value.trim() : "";

  state.filters = currentSearch ? { search: currentSearch } : {};

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

  FinanceTable.bindSortHeaders("financeBillsTable", (col, dir) => {
    state.sortBy = col;
    state.sortDir = dir;
    FinanceTable.saveState("finance_bills", state);
    applyAndRenderBills();
  }, { sortBy: state.sortBy, sortDir: state.sortDir });

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

// ── Bill status pill and flags (D-021, restyled by D-027). Presentation only. ──
// The pill group comes from FinanceUI so D-016 meanings are unchanged;
// FinanceFormat.formatStatusBadge stays untouched because other pages share it.
function _billStatusPill(status) {
  const norm = (status || "").toLowerCase().trim();
  const item = (FinanceFormat.STATUS_MAP.bill || {})[norm] || { label: (status || "Unknown") };
  return FinanceUI.statusPill(FinanceUI.statusGroup(norm), item.label, `role="status" aria-label="Status: ${FinanceUI.esc(item.label)}"`, "status-badge-wrap");
}

// Whole days between the due date and today (local), for the "N days late" flag text only.
// Whether a bill is overdue stays server-owned (bill.is_overdue, open statuses only).
function _billDaysLate(dueDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dueDate || ""));
  if (!m) return 0;
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today - due) / 86400000));
}

// The list shows lateness under the bill date, so it passes withOverdue = false; the details drawer keeps the Overdue flag.
function _billFlags(bill, withOverdue = true) {
  const flags = [];
  const tag = (tone, text, title) => `<span class="fv-note fv-note--${tone} bill-flag" title="${title}">${text}</span>`;
  if (withOverdue && bill.is_overdue) {
    const d = _billDaysLate(bill.due_date);
    flags.push(tag("late", d > 0 ? `${d} ${d === 1 ? "day" : "days"} late` : "Overdue", "Overdue: the due date has passed"));
  }
  if (bill.vendor_to_confirm) flags.push(tag("warn", "Vendor to confirm", "The vendor on the document could not be matched with confidence"));
  if (bill.is_duplicate_override) flags.push(tag("late", "Duplicate override", `Duplicate Override: ${FinanceFormat.escapeHtml(bill.duplicate_override_reason || "")}`));
  if (bill.extraction_confidence != null && Math.round(bill.extraction_confidence * 100) < 80) {
    flags.push(tag("warn", `Low confidence ${Math.round(bill.extraction_confidence * 100)}%`, "Extraction confidence is below 80%"));
  }
  return flags.length ? `<span class="fv-flags">${flags.join("")}</span>` : "";
}

// "30 Sep 2026" style for the Bills table. Local to Bills: FinanceFormat.formatFinanceDate (ISO) is shared.
const _BILL_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function _billDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ""));
  if (!m) return FinanceFormat.formatFinanceDate(value);
  return `${Number(m[3])} ${_BILL_MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

// Relative note under the due date for owed bills: "8 days late", "Due today", "Due in 5 days".
function _billDueNote(dueDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dueDate || ""));
  if (!m) return "";
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const now = new Date();
  const days = Math.round((due - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
  const n = Math.abs(days);
  const unit = n === 1 ? "day" : "days";
  if (days < 0) return `${n} ${unit} late`;
  return days === 0 ? "Due today" : `Due in ${n} ${unit}`;
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
    const owed = ["approved", "scheduled", "partially_paid"].includes(derivedStatus);
    const rel = owed ? _billDueNote(bill.due_date) : "";
    const num = bill.bill_number || "(no number yet)";
    const vendorText = bill.vendor_name || bill.suggested_vendor_name || "—";
    const vendor = FinanceFormat.escapeHtml(vendorText);
    const billNo = FinanceFormat.escapeHtml(bill.bill_number || "");
    const currency = bill.currency || "USD";
    const partPaid = derivedStatus === "partially_paid" && Number(bill.total) > 0;
    const paidSub = partPaid ? `${FinanceFormat.formatMoney(bill.amount_paid || 0, currency)} paid` : "";
    const paidPct = partPaid ? ((Number(bill.amount_paid) || 0) / Number(bill.total)) * 100 : null;
    const hue = FinanceUI.hueForId(bill.vendor_id);
    const edit = bill.status !== "void"
      ? { icon: "fa-pen", label: "Edit Bill", ariaLabel: `Edit Bill ${bill.bill_number || ""}`.trim(), onclick: `openEditBillModal(${bill.id})` }
      : { slot: true };
    const attach = (bill.attachment_name || bill.attachment_url)
      ? { icon: "fa-paperclip", label: `View Attachment (${bill.attachment_name || "Document"})`, onclick: `previewBillDocument(${bill.id})`, ariaLabel: `View Attachment for Bill ${bill.bill_number || ""}`.trim(), className: "btn-bill-attachment" }
      : { slot: true };

    return `
    <tr data-record-id="${bill.id}" class="is-clickable">
      <td><div class="fv-cell-main">${FinanceUI.avatar(vendorText, hue)}<div class="fv-cell-main__text"><button type="button" class="fv-name-btn btn-view-bill" onclick="FinanceDrawer.open('bill', ${bill.id}, this)" title="View Details & Timeline" aria-label="View Bill ${billNo} details">${vendor}</button><span class="fv-link">${FinanceFormat.escapeHtml(num)}</span></div></div></td>
      <td>${FinanceUI.dateCell(bill.issue_date, rel, bill.is_overdue ? "late" : "info", { title: rel ? `Due ${_billDate(bill.due_date)}` : "", extraHtml: _billFlags(bill, false) })}</td>
      <td>${FinanceUI.categoryCell(bill.category)}</td>
      <td>${_billStatusPill(derivedStatus)}</td>
      <td class="cell-money fv-num">${FinanceUI.amountCell(bill.total, currency, paidSub, paidPct)}</td>
      <td>${FinanceUI.rowActions({ primary: _billPrimaryAction(bill, derivedStatus), icons: [edit, attach] })}</td>
    </tr>
  `;
  }).join("");

  if (!tbody.dataset.rowClickBound) {
    tbody.dataset.rowClickBound = "1";
    tbody.addEventListener("click", (e) => {
      if (e.target.closest("button, a, input, select, label")) return;
      const tr = e.target.closest("tr[data-record-id]");
      if (!tr) return;
      const viewBtn = tr.querySelector(".btn-view-bill");
      if (window.FinanceDrawer) FinanceDrawer.open("bill", Number(tr.dataset.recordId), viewBtn || tr);
    });
  }
}

async function submitBillForApproval(id) {
  try {
    await FinanceApi.submitBill(id);
    showToast("Bill submitted for approval", "success");
    loadFinanceBills();
  } catch (err) {
    showToast("Error: " + (err.message || err), "error");
  }
}

async function withdrawBillToDraft(id) {
  try {
    await FinanceApi.withdrawBill(id);
    showToast("Bill withdrawn to draft", "success");
    loadFinanceBills();
  } catch (err) {
    showToast("Error: " + (err.message || err), "error");
  }
}

// One primary row action per status (everything else lives in the bill detail)
function _billPrimaryAction(bill, status) {
  switch (status) {
    case "draft":
      return { label: "Submit", kind: "fill", className: "btn-submit-bill", onclick: `submitBillForApproval(${bill.id})`, attrs: 'title="Submit for approval"' };
    case "rejected":
      return { label: "Edit & resubmit", kind: "outline", className: "btn-resubmit-bill", onclick: `openEditBillModal(${bill.id})`, attrs: 'title="Edit and resubmit"' };
    case "pending_approval":
      return _canBill("finance.bill.approve")
        ? { label: "Approve", kind: "fill", className: "btn-approve-bill", onclick: `openBillApprovalModal(${bill.id})`, attrs: 'title="Review &amp; Approve"' }
        : null;
    case "approved":
    case "scheduled":
    case "partially_paid":
      return _canBill("finance.bill.pay")
        ? { label: "Pay", kind: "fill", className: "btn-pay-bill", onclick: `openBillPaymentModal(${bill.id})`, attrs: 'title="Record Payment"' }
        : (status === "approved" ? { label: "Schedule", kind: "outline", className: "btn-schedule-bill", onclick: `openScheduleBillModal(${bill.id})`, attrs: 'title="Schedule Payment"' } : null);
    default:
      return null;
  }
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
    textEl.textContent = `Missing required coding: ${missing.join(", ")}.`;
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
    const amountInput = document.getElementById("billPaidNowAmount");
    if (amountInput && (!amountInput.value || amountInput.dataset.autofilled === "true")) {
      const currentTotal = _billTotalAmount();
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

let _billPayAccounts = [];

function _billAccountLabel(a) {
  return `${a.account_name} (${a.currency} ${Number(a.current_balance).toLocaleString("en-US", { minimumFractionDigits: 2 })})`;
}

// Accounts a bill can be paid from: same currency as the bill (no exchange on bills), cash first.
async function _loadBillPayAccounts(currency) {
  const accounts = await FinanceApi.getAccounts({ is_active: true });
  const curr = String(currency || "EGP").toUpperCase();
  _billPayAccounts = (accounts || [])
    .filter((a) => String(a.currency || "").toUpperCase() === curr)
    .sort((x, y) => (x.account_type === "cash" ? -1 : 1) - (y.account_type === "cash" ? -1 : 1));
  return _billPayAccounts;
}

function _fillBillPayAccountSelect(selId) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  if (!_billPayAccounts.length) {
    sel.innerHTML = "<option value=''>— No account in the bill currency —</option>";
    return;
  }
  sel.innerHTML = `<option value="">— Select account —</option>` + _billPayAccounts.map((a) => `<option value="${a.id}">${_billAccountLabel(a)}</option>`).join("");
  sel.value = String(_billPayAccounts[0].id); // default: the cash account in the bill currency, else the first
}

async function _fillBillPaymentTypes(accountSelId, typeSelId, chequeGroupId) {
  const typeSel = document.getElementById(typeSelId);
  if (!typeSel) return;
  const acc = _billPayAccounts.find((a) => String(a.id) === String(document.getElementById(accountSelId)?.value));
  if (!acc) {
    typeSel.innerHTML = "<option value=''>— Select account first —</option>";
    onBillPaymentTypeChange(typeSelId, chequeGroupId);
    return;
  }
  let types = [];
  try {
    types = await FinanceApi.getPaymentTypes({ usage: "bill_payment", account_type: acc.account_type });
  } catch (_) {}
  const defaultCode = acc.account_type === "cash" ? "CASH" : "OUTBOUND_TRANS";
  typeSel.innerHTML = types.map((t) => `<option value="${t.id}" data-code="${t.code}"${t.code === defaultCode ? " selected" : ""}>${t.name}</option>`).join("");
  onBillPaymentTypeChange(typeSelId, chequeGroupId);
}

function onBillPaymentTypeChange(typeSelId, chequeGroupId) {
  const sel = document.getElementById(typeSelId);
  const group = document.getElementById(chequeGroupId);
  const code = sel && sel.selectedOptions[0] ? sel.selectedOptions[0].dataset.code : "";
  if (group) group.style.display = code === "CHK" ? "block" : "none";
}

let _billPaymentContext = { remaining: 0, currency: "EGP" };

// Shows the bill balance (and the paying account's balance) after the amount typed in the Pay dialog
function updateBillPaymentBalanceAfter() {
  const el = document.getElementById("billPaymentBalanceAfter");
  if (!el) return;
  const amount = parseFloat(document.getElementById("billPaymentAmount")?.value) || 0;
  const fmt = (v) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const billAfter = Math.round((_billPaymentContext.remaining - amount) * 100) / 100;
  let text = `Bill balance after payment: ${_billPaymentContext.currency} ${fmt(Math.max(0, billAfter))}`;
  const acc = _billPayAccounts.find((a) => String(a.id) === String(document.getElementById("billPaymentBankAccountId")?.value));
  if (acc) {
    const accAfter = Math.round((Number(acc.current_balance) - amount) * 100) / 100;
    text += ` · ${acc.account_name} after payment: ${acc.currency} ${fmt(accAfter)}`;
    el.classList.toggle("fv-hint--danger", accAfter < 0 || billAfter < 0);
  }
  el.textContent = text;
}

function onBillPaymentAccountChange() {
  return _fillBillPaymentTypes("billPaymentBankAccountId", "billPaymentTypeId", "billPaymentChequeGroup");
}

function onBillPaidNowAccountChange() {
  return _fillBillPaymentTypes("billPaidNowBankAccountId", "billPaidNowTypeId", "billPaidNowChequeGroup");
}

async function _populateBillPaidNowAccounts() {
  const accSel = document.getElementById("billPaidNowBankAccountId");
  if (!accSel) return;
  try {
    await _loadBillPayAccounts(document.getElementById("billCurrency")?.value || "EGP");
    _fillBillPayAccountSelect("billPaidNowBankAccountId");
  } catch (_) {
    accSel.innerHTML = "<option value=''>— No accounts available —</option>";
  }
  await onBillPaidNowAccountChange();
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
  const readOnlyContainer = document.getElementById("billStatusReadOnlyContainer");
  const readOnlyBadge = document.getElementById("billStatusReadOnlyBadge");
  const status = bill ? FinanceFormat.getDerivedBillStatus(bill) : (_canBill("finance.bill.approve") ? "approved" : "draft");
  const info = (FinanceFormat.STATUS_MAP.bill || {})[status] || { label: status, badgeClass: "badge-grey" };
  if (readOnlyContainer) readOnlyContainer.style.display = "block";
  if (readOnlyBadge) {
    readOnlyBadge.textContent = info.label;
    readOnlyBadge.className = "badge " + info.badgeClass;
  }
}

// ── "More details (optional)": Legal entity, Department, Notes and Line items ──
function setBillMoreExpanded(expanded) {
  const section = document.getElementById("billMoreSection");
  const toggle = document.getElementById("billMoreToggle");
  if (section) section.hidden = !expanded;
  if (toggle) toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
}

function toggleBillMore() {
  const toggle = document.getElementById("billMoreToggle");
  setBillMoreExpanded(!(toggle && toggle.getAttribute("aria-expanded") === "true"));
}

let _billMoreObserver = null;
function _resetBillMoreSection() {
  setBillMoreExpanded(false);
  // A validation message inside the section must never stay hidden.
  const section = document.getElementById("billMoreSection");
  if (section && !_billMoreObserver && typeof MutationObserver !== "undefined") {
    _billMoreObserver = new MutationObserver(() => {
      if (section.hidden && section.querySelector('[aria-invalid="true"]')) setBillMoreExpanded(true);
    });
    _billMoreObserver.observe(section, { attributes: true, attributeFilter: ["aria-invalid"], subtree: true });
  }
}

function _autoExpandBillMore() {
  const notes = (document.getElementById("billNotes")?.value || "").trim();
  const dept = document.getElementById("billDepartment")?.value || "";
  const entity = document.getElementById("billLegalEntity")?.value || "";
  if (notes || dept || (entity && entity !== "Voyance Health Inc") || _billHasLineItems()) setBillMoreExpanded(true);
}

function openCaptureBillModal() {
  FinanceForm.clearErrors("billModal");
  _resetBillCaptureSection();
  _resetBillMoreSection();
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
  document.getElementById("billCurrency").value = "EGP";
  document.getElementById("billNotes").value = "";
  document.getElementById("billLinesBody").innerHTML = "";

  _updateBillTotals();
  _checkBillMissingFields();
  _billEditStatus = null;
  _applyBillRoleView();
  openModal("billModal");
}

function openAddBillModal() {
  FinanceForm.clearErrors("billModal");
  _resetBillCaptureSection();
  _resetBillMoreSection();
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
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("billIssueDate").value = today;
  document.getElementById("billDueDate").value = today;
  document.getElementById("billCurrency").value = "EGP";
  document.getElementById("billNotes").value = "";
  document.getElementById("billLinesBody").innerHTML = "";
  const amountEl = document.getElementById("billAmount");
  if (amountEl) { amountEl.value = ""; amountEl.disabled = false; }
  const paidAmt = document.getElementById("billPaidNowAmount");
  if (paidAmt) { paidAmt.value = ""; delete paidAmt.dataset.autofilled; }
  ["billPaidNowReference", "billPaidNowDetails", "billPaidNowChequeNumber"].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
  _billEditStatus = null;

  _updateBillTotals();
  _checkBillMissingFields();
  _applyBillRoleView();
  openModal("billModal");
}

async function openEditBillModal(billId) {
  FinanceForm.clearErrors("billModal");
  _resetBillCaptureSection();
  _resetBillMoreSection();
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
    document.getElementById("billCurrency").value = bill.currency || "USD";
    document.getElementById("billNotes").value = bill.notes || "";

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
    const amountEl = document.getElementById("billAmount");
    if (amountEl && !_billHasLineItems()) { amountEl.value = bill.total ? Number(bill.total).toFixed(2) : ""; amountEl.disabled = false; }
    _billEditStatus = bill.status;
    _resetBillStatusDisplay(bill);
    _checkBillMissingFields();
    _applyBillRoleView();
    _autoExpandBillMore();
    if (bill.status === "rejected" && bill.approval_comment) {
      showToast(`Rejected: ${bill.approval_comment}`, "warning");
    }
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

  if (_billHasLineItems()) setBillMoreExpanded(true);
  _syncBillAmountField();
}


// ── B5: new-bill form behaviour (current visual style) ─────────────────────
function _billPaidChoiceKey() {
  const email = (typeof SessionInfo !== "undefined" && SessionInfo.getEmail && SessionInfo.getEmail()) || "default";
  return `hrflow_bill_paid_choice_${email}`;
}

function _billCanPayNow() {
  return _canBill("finance.bill.approve") && _canBill("finance.bill.pay");
}

// Edit mode of an existing bill: set by openEditBillModal, cleared by openAddBillModal
let _billEditStatus = null;

function _billPrimaryLabel() {
  const editing = !!document.getElementById("billModalId").value;
  if (!editing) {
    if (!_canBill("finance.bill.approve")) return "Submit for approval";
    return document.getElementById("billIsPaidNow")?.checked ? "Save as paid" : "Save bill";
  }
  if (_billEditStatus === "draft") return _canBill("finance.bill.approve") ? "Save and approve" : "Submit for approval";
  if (_billEditStatus === "rejected") return "Resubmit for approval";
  return "Save changes";
}

function _billSavesAs(mode) {
  const editing = !!document.getElementById("billModalId").value;
  const label = (st) => (FinanceFormat.STATUS_MAP.bill[st] || { label: st }).label;
  if (mode === "draft") return label("draft");
  if (!editing) {
    if (!_canBill("finance.bill.approve")) return label("pending_approval");
    return document.getElementById("billIsPaidNow")?.checked ? label("paid") : label("approved");
  }
  if (_billEditStatus === "draft") return _canBill("finance.bill.approve") ? label("approved") : label("pending_approval");
  if (_billEditStatus === "rejected") return label("pending_approval");
  if ((_billEditStatus === "approved" || _billEditStatus === "scheduled") && !_canBill("finance.bill.approve")) {
    return `${label(_billEditStatus)} (a change to vendor, amount or lines goes back to ${label("pending_approval")})`;
  }
  return label(_billEditStatus || "draft");
}

function updateBillSavesAsLine() {
  const el = document.getElementById("billSavesAsLine");
  if (el) el.textContent = `Saves as: ${_billSavesAs("primary")}`;
  const btn = document.getElementById("billModalSaveBtn");
  if (btn) btn.textContent = _billPrimaryLabel();
}

function _applyBillRoleView() {
  const editing = !!document.getElementById("billModalId").value;
  const group = document.getElementById("billIsPaidNowGroup");
  const showChoice = !editing && _billCanPayNow();
  if (group) group.style.display = showChoice ? "block" : "none";
  const draftBtn = document.getElementById("billSaveDraftBtn");
  if (draftBtn) draftBtn.style.display = (!editing || _billEditStatus === "draft") ? "" : "none";
  const another = document.getElementById("billAddAnotherWrap");
  if (another) another.style.display = editing ? "none" : "flex";

  // A user who cannot pay a bill never sees payment fields
  const yes = document.getElementById("billPaidChoiceYes");
  const no = document.getElementById("billPaidChoiceNo");
  let remembered = "no";
  try { remembered = localStorage.getItem(_billPaidChoiceKey()) || "no"; } catch (_) {}
  const wantPaid = showChoice && remembered === "yes";
  if (yes) yes.checked = wantPaid;
  if (no) no.checked = !wantPaid;
  const chk = document.getElementById("billIsPaidNow");
  if (chk) chk.checked = wantPaid;
  const section = document.getElementById("billPaidNowSection");
  if (section) section.style.display = wantPaid ? "block" : "none";
  if (wantPaid) {
    const dateEl = document.getElementById("billPaidNowDate");
    if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split("T")[0];
    _populateBillPaidNowAccounts();
  }
  updateBillSavesAsLine();
}

function onBillPaidChoiceChange() {
  const yes = !!document.getElementById("billPaidChoiceYes")?.checked;
  try { localStorage.setItem(_billPaidChoiceKey(), yes ? "yes" : "no"); } catch (_) {}
  const chk = document.getElementById("billIsPaidNow");
  if (chk) chk.checked = yes;
  toggleBillPaidNowSection(yes);
  const dateEl = document.getElementById("billPaidNowDate");
  if (yes && dateEl && !dateEl.value) dateEl.value = new Date().toISOString().split("T")[0];
  updateBillSavesAsLine();
}

function onBillCurrencyChange() {
  // Changing the currency moves the payment account to that currency's cash account
  if (document.getElementById("billIsPaidNow")?.checked) _populateBillPaidNowAccounts();
}

// Line items are optional: without them the Amount field is the bill total
function _billHasLineItems() {
  return Array.from(document.querySelectorAll("#billLinesBody tr")).some((r) => {
    const desc = r.querySelector("input[type='text']")?.value.trim();
    const total = parseFloat(r.querySelector(".bill-total")?.value) || 0;
    return desc || total > 0;
  });
}

function _billTotalAmount() {
  if (_billHasLineItems()) {
    return Array.from(document.querySelectorAll("#billLinesBody tr")).reduce((sum, r) => sum + (parseFloat(r.querySelector(".bill-total")?.value) || 0), 0);
  }
  return parseFloat(document.getElementById("billAmount")?.value) || 0;
}

function onBillAmountInput() {
  _syncBillPaidNowAmount();
}

function _syncBillPaidNowAmount() {
  const paidNowAmount = document.getElementById("billPaidNowAmount");
  if (paidNowAmount && document.getElementById("billIsPaidNow")?.checked && (!paidNowAmount.value || paidNowAmount.dataset.autofilled === "true")) {
    const total = _billTotalAmount();
    paidNowAmount.value = total > 0 ? total.toFixed(2) : "";
    paidNowAmount.dataset.autofilled = "true";
  }
}

function _syncBillAmountField() {
  const amount = document.getElementById("billAmount");
  if (!amount) return;
  if (_billHasLineItems()) {
    amount.value = _billTotalAmount().toFixed(2);
    amount.disabled = true;
  } else {
    amount.disabled = false;
  }
  _syncBillPaidNowAmount();
}

// ── Server errors shown beside their field ─────────────────────────────────
const BILL_FIELD_IDS = {
  vendor_id: "billVendorId",
  bill_number: "billNumber",
  issue_date: "billIssueDate",
  due_date: "billDueDate",
  category: "billCategoryId",
  currency: "billCurrency",
  lines: "billAmount",
};
const BILL_PAYMENT_ERROR_FIELDS = {
  currency_mismatch: ["billPaidNowBankAccountId", "billPaymentBankAccountId"],
  insufficient_balance: ["billPaidNowBankAccountId", "billPaymentBankAccountId"],
  payment_type_not_allowed: ["billPaidNowTypeId", "billPaymentTypeId"],
  cheque_number_required: ["billPaidNowChequeNumber", "billPaymentChequeNumber"],
};

// Returns true when the error was placed beside a field
function showBillServerErrors(err, modalId) {
  const detail = err && err.detail;
  let placed = false;
  const put = (id, msg) => {
    const el = document.getElementById(id);
    if (el && el.offsetParent !== null) {
      FinanceForm.setFieldError(el, msg);
      placed = true;
    }
  };
  if (Array.isArray(detail)) {
    detail.forEach((e) => {
      const field = Array.isArray(e.loc) ? e.loc[e.loc.length - 1] : null;
      if (field && BILL_FIELD_IDS[field]) put(BILL_FIELD_IDS[field], e.msg || "Invalid value");
    });
  } else if (detail && detail.code && BILL_PAYMENT_ERROR_FIELDS[detail.code]) {
    BILL_PAYMENT_ERROR_FIELDS[detail.code].forEach((id) => put(id, detail.message || err.message));
  }
  return placed;
}

function _reportBillError(err) {
  if (!showBillServerErrors(err)) showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  else showToast("Please fix the highlighted fields.", "warning");
}

async function saveBillModal(mode = "primary") {
  const billId = document.getElementById("billModalId").value;
  const isDraftSave = mode === "draft";
  FinanceForm.clearErrors("billModal");

  const vendorId = document.getElementById("billVendorId").value;
  const billNumber = document.getElementById("billNumber").value.trim();
  const issueDate = document.getElementById("billIssueDate").value;
  const dueDate = document.getElementById("billDueDate").value;
  const hasAttachment = !!(_currentModalPendingFile || document.getElementById("billAttachedFileName")?.textContent);
  const total = _billTotalAmount();

  if (isDraftSave) {
    // A draft needs a vendor or an attachment; everything else can be filled in later
    if (!vendorId && !hasAttachment) {
      FinanceForm.setFieldError("billVendorId", "A draft needs a vendor or an attachment.");
      return;
    }
  } else {
    const isValid = FinanceForm.validateRequiredFields("billModal", [
      { id: "billVendorId", label: "Vendor" },
      { id: "billNumber", label: "Bill Number" },
      { id: "billCategoryId", label: "Expense Category" },
      { id: "billIssueDate", label: "Issue Date" },
      { id: "billDueDate", label: "Due Date" },
    ]);
    if (!isValid) return;
    if (!billId && !(total > 0)) {
      FinanceForm.setFieldError("billAmount", "Enter the bill amount (or add line items).");
      return;
    }
  }

  // AC 3: Duplicate detection check
  const dupBanner = document.getElementById("billDuplicateBanner");
  const dupVisible = dupBanner && dupBanner.style.display !== "none";
  const dupOverride = document.getElementById("billDuplicateOverrideCheckbox").checked;
  const dupReason = document.getElementById("billDuplicateOverrideReason").value.trim();

  if (!isDraftSave && dupVisible && !dupOverride) {
    showToast("Potential duplicate detected. Request an authorized override with reason to proceed.", "warning");
    return;
  }
  if (!isDraftSave && dupVisible && dupOverride && !dupReason) {
    showToast("Please provide an override reason for the duplicate bill.", "warning");
    document.getElementById("billDuplicateOverrideReason").focus();
    return;
  }

  const lines = [];
  document.querySelectorAll("#billLinesBody tr").forEach((r) => {
    const desc = r.querySelector("input[type='text']")?.value.trim();
    const qty = parseFloat(r.querySelector(".bill-qty")?.value) || 1;
    const price = parseFloat(r.querySelector(".bill-price")?.value) || 0;
    const lineTotal = parseFloat(r.querySelector(".bill-total")?.value) || 0;
    if (desc) lines.push({ description: desc, quantity: qty, unit_price: price, line_total: lineTotal });
  });
  if (!lines.length && total > 0) {
    // Line items are optional: the Amount becomes a single line
    const vendorSel = document.getElementById("billVendorId");
    const vendorText = vendorSel && vendorSel.selectedOptions[0] ? vendorSel.selectedOptions[0].textContent.trim() : "";
    lines.push({ description: vendorText && vendorSel.value ? `Bill ${billNumber || vendorText}` : "Bill total", quantity: 1, unit_price: total, line_total: total });
  }

  // Already paid (create only, approvers with pay rights)
  const isPaidNow = !billId && !isDraftSave && !!document.getElementById("billIsPaidNow")?.checked && _billCanPayNow();
  let paymentData = null;
  if (isPaidNow) {
    const bankAccountId = document.getElementById("billPaidNowBankAccountId").value;
    const paymentDate = document.getElementById("billPaidNowDate").value;
    const paymentAmount = parseFloat(document.getElementById("billPaidNowAmount").value);
    const paymentTypeId = document.getElementById("billPaidNowTypeId").value;
    const chequeNumber = document.getElementById("billPaidNowChequeNumber").value.trim();
    const paymentDetails = document.getElementById("billPaidNowDetails").value.trim() || null;
    const paymentRef = document.getElementById("billPaidNowReference").value.trim() || "";
    if (!bankAccountId) { FinanceForm.setFieldError("billPaidNowBankAccountId", "Select the account the bill was paid from."); return; }
    if (!paymentDate) { FinanceForm.setFieldError("billPaidNowDate", "Enter the payment date."); return; }
    if (!paymentTypeId) { FinanceForm.setFieldError("billPaidNowTypeId", "Select the payment type."); return; }
    paymentData = {
      bank_account_id: parseInt(bankAccountId, 10),
      payment_type_id: parseInt(paymentTypeId, 10),
      payment_date: paymentDate,
      amount: !isNaN(paymentAmount) && paymentAmount > 0 ? paymentAmount : null,
      reference: paymentRef,
      details: paymentDetails,
      cheque_number: chequeNumber || null,
    };
  }

  const payload = {
    vendor_id: vendorId ? parseInt(vendorId, 10) : null,
    bill_number: billNumber || null,
    department: document.getElementById("billDepartment").value || null,
    legal_entity: document.getElementById("billLegalEntity").value || "Voyance Health Inc",
    category_id: document.getElementById("billCategoryId")?.value ? parseInt(document.getElementById("billCategoryId").value, 10) : null,
    category: document.getElementById("billCategory")?.value.trim() || null,
    issue_date: issueDate || null,
    due_date: dueDate || null,
    currency: document.getElementById("billCurrency").value,
    notes: document.getElementById("billNotes").value.trim(),
    capture_source: document.getElementById("billCaptureSource").value || "manual",
    file_fingerprint: document.getElementById("billFileFingerprint").value || null,
    attachment_name: document.getElementById("billAttachedFileName")?.textContent || null,
    is_duplicate_override: dupOverride,
    duplicate_override_reason: dupOverride ? dupReason : null,
    lines,
    ...(isPaidNow ? { is_paid_now: true, payment: paymentData } : {}),
  };
  // Null fields are not sent on an update (the server ignores them) and not needed on a draft
  Object.keys(payload).forEach((k) => { if (payload[k] === null && k !== "category_id") delete payload[k]; });

  const approver = _canBill("finance.bill.approve");
  const btn = document.getElementById("billModalSaveBtn");
  const draftBtn = document.getElementById("billSaveDraftBtn");
  if (btn) btn.disabled = true;
  if (draftBtn) draftBtn.disabled = true;
  try {
    let savedBill = null;
    if (billId) {
      savedBill = await FinanceApi.updateBill(billId, payload);
    } else {
      if (isDraftSave) payload.save_as_draft = true;
      savedBill = await FinanceApi.createBill(payload);
      // From here the bill exists: further saves update it
      document.getElementById("billModalId").value = savedBill.id;
    }

    // If a new physical file was chosen, upload it to durable attachment storage
    if (_currentModalPendingFile && savedBill && savedBill.id) {
      try {
        await FinanceApi.uploadBillAttachment(savedBill.id, _currentModalPendingFile);
        _currentModalPendingFile = null;
      } catch (uploadErr) {
        console.warn("Failed to upload bill attachment:", uploadErr);
        showToast("Bill saved, but attachment upload failed: " + (uploadErr.message || uploadErr), "warning");
      }
    }

    // Leaving Draft: a finance user submits for approval; an approver also approves
    let message = isPaidNow ? "Bill created and payment recorded" : (billId ? "Bill updated" : "Bill created");
    if (!isDraftSave && savedBill && (savedBill.status === "draft" || savedBill.status === "rejected")) {
      savedBill = await FinanceApi.submitBill(savedBill.id);
      message = "Bill submitted for approval";
      if (approver && _billEditStatus !== "rejected") {
        try {
          savedBill = await FinanceApi.approveBill(savedBill.id, { decision: "approve" });
          message = "Bill saved and approved";
        } catch (approveErr) {
          message = "Bill submitted; a different approver must approve it (" + (approveErr.message || approveErr) + ")";
        }
      }
    } else if (isDraftSave) {
      message = "Saved as draft";
    }
    showToast(message, "success");

    const addAnother = !billId && !!document.getElementById("billAddAnother")?.checked;
    if (addAnother) {
      openAddBillModal();
    } else {
      closeBillModal();
    }
    loadFinanceBills();
  } catch (err) {
    _reportBillError(err);
  } finally {
    if (btn) btn.disabled = false;
    if (draftBtn) draftBtn.disabled = false;
  }
}

async function confirmDiscardDraft(billId) {
  const bill = (FinanceState.bills || []).find((b) => b.id === parseInt(billId, 10));
  const result = await FinanceCommand.confirmAction({
    title: "Discard draft",
    summary: bill ? `<strong>${bill.bill_number || "Draft"}</strong> · ${bill.vendor_name || bill.suggested_vendor_name || "No vendor yet"}` : `Draft #${billId}`,
    consequence: "Discarding deletes this draft and its uploaded file permanently. Only drafts can be discarded; other bills are voided.",
    actionLabel: "Discard draft",
    actionClass: "btn btn-danger",
    requireReason: false,
    severity: "danger",
  });
  if (!result.confirmed) return;
  try {
    await FinanceApi.discardBill(billId);
    showToast("Draft discarded", "success");
    if (window.FinanceDrawer && FinanceDrawer.current) FinanceDrawer.close();
    loadFinanceBills();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  }
}

// Multi-file upload: each PDF or photo becomes its own Draft; the list then opens filtered to Drafts
async function onBillDraftFilesChosen(input) {
  const files = Array.from(input.files || []);
  input.value = "";
  if (!files.length) return;
  try {
    const results = await FinanceApi.uploadBillFiles(files);
    const created = results.filter((r) => r.bill);
    const toConfirm = created.filter((r) => r.bill.vendor_to_confirm).length;
    const failed = results.filter((r) => !r.bill);
    let msg = `${created.length} draft${created.length === 1 ? "" : "s"} created`;
    if (toConfirm) msg += `, ${toConfirm} need${toConfirm === 1 ? "s" : ""} the vendor confirmed`;
    if (failed.length) msg += `; ${failed.length} not created (${failed.map((f) => `${f.filename}: ${f.error}`).join("; ")})`;
    showToast(msg, failed.length ? "warning" : "success");
    setBillWorkQueue("draft");
  } catch (err) {
    showToast("Upload failed: " + (err.message || JSON.stringify(err)), "error");
  }
}

function confirmVoidBill(billId) {
  const bill = (FinanceState.bills || []).find((b) => b.id === parseInt(billId, 10));
  document.getElementById("billVoidBillId").value = billId;
  const summary = document.getElementById("billVoidSummary");
  if (summary) {
    summary.innerHTML = bill
      ? `<strong>${FinanceFormat.escapeHtml(bill.bill_number || "Bill")}</strong> · ${FinanceFormat.escapeHtml(bill.vendor_name || "Vendor")} · ${FinanceFormat.renderMoneyHtml(bill.total || 0, bill.currency || "EGP")}`
      : `Bill #${billId}`;
  }
  document.getElementById("billVoidReason").value = "Duplicate";
  document.getElementById("billVoidNote").value = "";
  openModal("billVoidModal");
}

function closeBillVoidModal() {
  closeModal("billVoidModal");
}

async function submitBillVoid() {
  const billId = document.getElementById("billVoidBillId").value;
  const reason = document.getElementById("billVoidReason").value;
  const note = document.getElementById("billVoidNote").value.trim();
  const full = note ? `${reason}: ${note}` : reason;
  const btn = document.getElementById("billVoidSubmitBtn");
  if (btn) btn.disabled = true;
  try {
    await FinanceApi.voidBill(billId, full);
    showToast("Bill voided", "success");
    closeBillVoidModal();
    if (window.FinanceDrawer && FinanceDrawer.current) FinanceDrawer.close();
    loadFinanceBills();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  } finally {
    if (btn) btn.disabled = false;
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
  document.getElementById("billPaymentReference").value = "";
  document.getElementById("billPaymentDetails").value = "";
  document.getElementById("billPaymentChequeNumber").value = "";

  const accSel = document.getElementById("billPaymentBankAccountId");
  if (accSel) {
    try {
      await _loadBillPayAccounts(curr);
      _fillBillPayAccountSelect("billPaymentBankAccountId");
    } catch (_) { accSel.innerHTML = "<option value=''>— No accounts available —</option>"; }
  }
  await onBillPaymentAccountChange();
  _billPaymentContext = { remaining, currency: curr };
  updateBillPaymentBalanceAfter();

  openModal("billPaymentModal");
}

function closeBillPaymentModal() {
  closeModal("billPaymentModal");
}

// Double-click safe: the shared submit lock ignores a second click while the request runs
function saveBillPayment() {
  return withSubmitLock("billPaymentSubmitBtn", _saveBillPaymentImpl);
}

async function _saveBillPaymentImpl() {
  const billId = document.getElementById("billPaymentBillId").value;
  const amount = parseFloat(document.getElementById("billPaymentAmount").value);
  const paymentDate = document.getElementById("billPaymentDate").value;
  const bankAccountId = document.getElementById("billPaymentBankAccountId").value;
  const bill = (FinanceState.bills || []).find((b) => String(b.id) === String(billId));

  const isValid = FinanceForm.validateRequiredFields("billPaymentModal", [
    { id: "billPaymentBankAccountId", label: "Account" },
    { id: "billPaymentTypeId", label: "Payment type" },
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
    amount,
    payment_date: paymentDate,
    bank_account_id: parseInt(bankAccountId, 10),
    payment_type_id: parseInt(document.getElementById("billPaymentTypeId").value, 10),
    reference: document.getElementById("billPaymentReference").value.trim(),
    details: document.getElementById("billPaymentDetails").value.trim() || null,
    cheque_number: document.getElementById("billPaymentChequeNumber").value.trim() || null,
  };

  try {
    await FinanceApi.recordBillPayment(billId, payload);
    showToast("Bill payment recorded successfully", "success");
    closeBillPaymentModal();
    if (window.FinanceDrawer && FinanceDrawer.current) FinanceDrawer.load(FinanceDrawer.current.entityType, FinanceDrawer.current.entityId);
    loadFinanceBills();
  } catch (err) {
    _reportBillError(err);
  }
}

function openBillApprovalModal(billId, decision) {
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
  const avEl = document.getElementById("billApprovalAvatar");
  if (avEl) avEl.innerHTML = FinanceUI.avatar(bill.vendor_name || "Vendor", FinanceUI.hueForId(bill.vendor_id), "lg");
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

  document.getElementById("billApprovalDecision").value = decision === "reject" ? "reject" : "approve";
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
      submitBtn.textContent = "Reject bill";
    }
  } else {
    if (reqSpan) reqSpan.style.display = "none";
    if (limitField) limitField.style.opacity = "1";
    if (submitBtn) {
      submitBtn.className = "btn btn-fill";
      submitBtn.textContent = "Approve bill";
    }
  }
  _syncBillApprovalBar(dec === "reject" ? "reject" : "approve");
}

// The decision bar is the visible control; the select keeps the value, ID and change handler.
function _syncBillApprovalBar(decision) {
  document.querySelectorAll("#billApprovalDecisionBar .fv-choice__btn").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.decision === decision ? "true" : "false");
  });
  const outcome = document.getElementById("billApprovalOutcome");
  if (outcome) {
    const status = decision === "reject" ? "rejected" : "approved";
    const label = (FinanceFormat.STATUS_MAP.bill[status] || {}).label || status;
    outcome.innerHTML = `After ${decision === "reject" ? "rejection" : "approval"} the bill moves to ${FinanceUI.statusPill(FinanceUI.statusGroup(status), label)}.`;
  }
}

function setBillApprovalDecision(decision) {
  const sel = document.getElementById("billApprovalDecision");
  if (!sel) return;
  sel.value = decision;
  onBillApprovalDecisionChange();
}

// Double-click safe: the shared submit lock ignores a second click while the request runs
function saveBillApproval() {
  return withSubmitLock("billApprovalSubmitBtn", _saveBillApprovalImpl);
}

async function _saveBillApprovalImpl() {
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

// Double-click safe: the shared submit lock ignores a second click while the request runs
function saveBillSchedule() {
  return withSubmitLock("billScheduleSubmitBtn", _saveBillScheduleImpl);
}

async function _saveBillScheduleImpl() {
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
  const revResult = await FinanceCommand.confirmAction({
    title: "Reverse payment",
    consequence: `Reverse payment #${paymentId} (${FinanceFormat.formatMoney(amount || 0, "USD")})? The bank balance will be restored.`,
    actionLabel: "Reverse payment",
    requireReason: true,
  });
  if (!revResult.confirmed || !revResult.reason.trim()) {
    return;
  }
  try {
    await FinanceApi.reverseBillPayment(billId, paymentId, { reason: revResult.reason.trim() });
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
  const statusRow = document.getElementById("financeBillStatusRow");
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
    if (statusRow) statusRow.style.display = "none";
    if (boxVend) boxVend.style.display = "block";
    if (conBill) conBill.style.display = "none";
    if (conVend) conVend.style.display = "block";
    if (addVendBtn) {
      addVendBtn.style.display = "inline-flex";
      addVendBtn.className = "btn btn-fill"; // the primary of the Vendors view
    }
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
    if (statusRow) statusRow.style.display = "flex";
    if (boxVend) boxVend.style.display = "none";
    if (conBill) conBill.style.display = "block";
    if (conVend) conVend.style.display = "none";
    if (addVendBtn) {
      addVendBtn.style.display = "inline-flex";
      addVendBtn.className = "btn btn-outline";
    }
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
    showToast(describeLoadFailure("vendors", err), "error");
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

  tbody.innerHTML = items.map((v) => {
    const name = FinanceFormat.escapeHtml(v.name);
    const second = v.legal_name && v.legal_name !== v.name ? v.legal_name : (v.notes || "");
    const email = v.contact_email ? `<a class="fv-link" href="mailto:${FinanceFormat.escapeHtml(v.contact_email)}">${FinanceFormat.escapeHtml(v.contact_email)}</a>` : "";
    const phone = v.contact_phone ? `<span class="fv-sub">${FinanceFormat.escapeHtml(v.contact_phone)}</span>` : "";
    const contact = (email || phone) ? `${email}${phone}` : "–";
    const inactive = v.is_active ? "" : `<span class="fv-status fv-status--closed fv-status--inline status-badge-wrap"><span class="fv-status__dot" aria-hidden="true"></span>Inactive</span>`;
    return `
    <tr>
      <td><div class="fv-cell-main">${FinanceUI.avatar(v.name, FinanceUI.hueForId(v.id))}<div class="fv-cell-main__text"><span class="fv-cell-main__name"><a href="javascript:void(0)" class="fv-name-btn" onclick="openVendor360Drawer(${v.id})">${name}</a> ${inactive}</span>${second ? `<span class="fv-sub">${FinanceFormat.escapeHtml(second)}</span>` : ""}</div></div></td>
      <td>${FinanceUI.categoryCell(v.category)}</td>
      <td><div class="fv-date">${contact}</div></td>
      <td>${v.tax_id ? FinanceFormat.escapeHtml(v.tax_id) : "–"}</td>
      <td class="fv-num">${_vendorOpenBills(v)}</td>
      <td>${FinanceUI.rowActions({
        primary: { label: "Bills", kind: "outline", className: "btn-vendor-bills", onclick: `openVendorBills(${v.id})` },
        icons: [
          { icon: "fa-eye", label: "View 360 & Payments", onclick: `openVendor360Drawer(${v.id})` },
          { icon: "fa-pen", label: "Edit Vendor", onclick: `openEditVendorModal(${v.id})` },
          { icon: v.is_active ? "fa-power-off" : "fa-check", label: v.is_active ? "Deactivate" : "Activate", onclick: `toggleVendorActive(${v.id}, ${v.is_active})` },
        ],
      })}</td>
    </tr>`;
  }).join("");

  FinanceUI.loadCategories().then(() => {
    // Dots need the category list; repaint once if it arrived after the first render.
    if (!FinanceUI._categories.length) return;
    tbody.querySelectorAll("tr").forEach((tr, i) => {
      const dot = tr.querySelector(".fv-with-dot .fv-dot");
      if (dot && items[i]) dot.className = `fv-dot fv-hue-${FinanceUI.categoryHueByName(items[i].category || "General")}`;
    });
  });
}

// Open bills per vendor: BE-3 `payables` (one entry per currency). Absent until the backend ships it.
function _vendorOpenBills(v) {
  if (!Array.isArray(v.payables)) return "–";
  const open = v.payables.filter((p) => Number(p.open_count) > 0);
  if (!open.length) return `<div class="fv-amount"><span class="fv-amount__value fv-amount__value--none">–</span><span class="fv-sub">No open bills</span></div>`;
  const count = open.reduce((n, p) => n + Number(p.open_count || 0), 0);
  const lines = open.map((p) => FinanceUI.amountCell(p.open_amount, p.currency, "")).join("");
  return `${lines}<span class="fv-sub">${count} open ${count === 1 ? "bill" : "bills"}</span>`;
}

// "Bills" on a vendor row: the bills list narrowed to that vendor through the existing search box.
function openVendorBills(vendorId) {
  const vendor = (FinanceState.vendors || []).find((x) => x.id === vendorId);
  switchBillSubTab("bills");
  const search = document.getElementById("financeBillSearch");
  if (search && vendor) {
    search.value = vendor.name;
    filterFinanceBills(vendor.name);
  }
}
window.openVendorBills = openVendorBills;

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
            <button type="button" class="btn btn-sm btn-outline" onclick="verifyVendorPaymentInstructionItem(${vendorId}, ${pi.id})"><i class="fa-solid fa-check"></i> Verify Instruction</button>
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

// Double-click safe: the shared submit lock ignores a second click while the request runs
function saveVendorPaymentInstruction() {
  return withSubmitLock("vendorAddPIBtn", _saveVendorPaymentInstructionImpl);
}

async function _saveVendorPaymentInstructionImpl() {
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
    actionClass: currentlyActive ? "btn btn-danger" : "btn btn-fill",
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
window.toggleBillMore = toggleBillMore;
window.setBillMoreExpanded = setBillMoreExpanded;
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

// ── Bill detail: status badge, Overdue flag and actions by status and permission ──
async function renderBillDrawerActions(data) {
  const host = document.getElementById("financeDetailDrawerActions");
  if (!host || !data || data.entity_type !== "bill") return;
  const id = data.entity_id;
  let bill = null;
  try { bill = await FinanceApi.getBill(id); } catch (_) { return; }
  if (!window.FinanceDrawer || !FinanceDrawer.current || FinanceDrawer.current.entityId !== id) return;

  const statusEl = document.getElementById("financeDetailDrawerStatusBadge");
  if (statusEl) {
    statusEl.innerHTML = _billStatusPill(FinanceFormat.getDerivedBillStatus(bill)) + _billFlags(bill);
  }

  const allowed = bill.allowed_actions || [];
  const btns = [];
  const add = (cls, icon, label, onclick, title) => btns.push(`<button type="button" class="btn btn-sm ${cls}" onclick="${onclick}" title="${title || label}"><i class="fa-solid ${icon}"></i> ${label}</button>`);
  if (bill.status === "draft") {
    add("btn-outline btn-drawer-submit", "fa-paper-plane", "Submit for approval", `submitBillForApproval(${id})`);
    add("btn-outline btn-drawer-edit", "fa-pen", "Edit", `FinanceDrawer.close(); openEditBillModal(${id})`);
    add("btn-danger btn-drawer-discard", "fa-trash", "Discard draft", `confirmDiscardDraft(${id})`);
  }
  if (bill.status === "rejected") add("btn-outline btn-drawer-resubmit", "fa-rotate-right", "Edit and resubmit", `FinanceDrawer.close(); openEditBillModal(${id})`);
  if (bill.status === "pending_approval") {
    if (_canBill("finance.bill.approve")) {
      add("btn-warning btn-drawer-approve", "fa-stamp", "Approve", `FinanceDrawer.close(); openBillApprovalModal(${id}, 'approve')`);
      add("btn-outline btn-drawer-reject", "fa-circle-xmark", "Reject", `FinanceDrawer.close(); openBillApprovalModal(${id}, 'reject')`);
    }
    add("btn-outline btn-drawer-withdraw", "fa-rotate-left", "Withdraw", `withdrawBillToDraft(${id})`);
  }
  if (allowed.includes("schedule") && _canBill("finance.bill.write")) add("btn-outline btn-drawer-schedule", "fa-calendar-plus", "Schedule payment", `FinanceDrawer.close(); openScheduleBillModal(${id})`);
  if (allowed.includes("pay") && _canBill("finance.bill.pay")) add("btn-outline btn-drawer-pay", "fa-money-bill-wave", "Record payment", `FinanceDrawer.close(); openBillPaymentModal(${id})`);
  if (bill.status !== "draft" && allowed.includes("void") && _canBill("finance.bill.write")) add("btn-danger btn-drawer-void", "fa-ban", "Void bill", `FinanceDrawer.close(); confirmVoidBill(${id})`);
  host.innerHTML = btns.join("");

  // The reason a bill was rejected stays visible to whoever resubmits it
  let banner = document.getElementById("financeDrawerBillBanner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "financeDrawerBillBanner";
    const nav = document.querySelector("#financeDetailDrawer .finance-drawer-nav");
    if (nav) nav.parentNode.insertBefore(banner, nav);
  }
  if (bill.status === "rejected" && bill.approval_comment) {
    banner.style.cssText = "margin:8px 20px 0; padding:8px 12px; border:1px solid var(--danger,#ef4444); border-radius:6px; font-size:0.85rem;";
    banner.innerHTML = `<strong>Rejected:</strong> ${FinanceFormat.escapeHtml(bill.approval_comment)}`;
  } else {
    banner.style.cssText = "display:none;";
    banner.innerHTML = "";
  }
}
window.renderBillDrawerActions = renderBillDrawerActions;
