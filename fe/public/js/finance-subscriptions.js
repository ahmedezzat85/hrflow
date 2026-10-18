// ==========================================
// 7. Subscriptions & Charges (Phase 6 / Story 4.4)
// ==========================================
let _subscriptionsFilterStatus = "active";
let _subscriptionsSearchQuery = "";
let _subscriptionsNoticeOnly = false;
let _currentHistorySubId = null;
let _currentLoggingSub = null;

let _subChargeFilter = "expected";

function _subscriptionBookView() {
  return typeof FinanceBookView !== "undefined" ? FinanceBookView.get("subscriptions") : "consolidated";
}

async function loadFinanceSubscriptions() {
  const bar = document.getElementById("financeSubscriptionsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    // Opening the page generates any due expected charges on the server (idempotent)
    const subs = await FinanceApi.getSubscriptions();
    FinanceState.subscriptions = subs || [];
    renderFinanceSubscriptionsTable();
    await loadSubscriptionCharges();
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
  const group = document.getElementById("financeSubscriptionStatusPills");
  if (group) {
    group.querySelectorAll(".fv-pill").forEach((b) => {
      const on = b.dataset.filter === status;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  renderFinanceSubscriptionsTable();
}

function onSubscriptionNoticeOnlyChange(checked) {
  _subscriptionsNoticeOnly = !!checked;
  renderFinanceSubscriptionsTable();
}

// Monthly run rate per currency, only when every shown subscription has a monthly equivalent
// (monthly_equivalent_amount, or its amount when it is billed monthly); otherwise nothing is claimed.
function _subscriptionRunRate(items) {
  const totals = {};
  for (const s of items) {
    const monthly = s.monthly_equivalent_amount != null
      ? Number(s.monthly_equivalent_amount)
      : ((s.billing_cycle || "monthly") === "monthly" ? Number(s.amount) : null);
    if (monthly == null || isNaN(monthly)) return "";
    const cur = s.currency || "USD";
    totals[cur] = (totals[cur] || 0) + monthly;
  }
  const parts = Object.entries(totals).map(([cur, v]) => `<span class="fv-foot__total">${FinanceUI.moneyHtml(v, cur)}</span>`);
  return parts.length ? ` &middot; monthly run rate ${parts.join(" + ")}` : "";
}

function renderFinanceSubscriptionsTable() {
  const tbody = document.getElementById("financeSubscriptionsTableBody");
  const empty = document.getElementById("financeSubscriptionsEmpty");
  const footer = document.getElementById("financeSubscriptionsFooter");
  if (!tbody) return;

  const bookView = _subscriptionBookView();
  const all = [...(FinanceState.subscriptions || [])].filter((s) => bookView === "consolidated" || (s.book_code || "local") === bookView);

  // pill and toggle counts come from the whole list
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const activeCount = all.filter((s) => s.is_active).length;
  setText("subPillCountAll", all.length);
  setText("subPillCountActive", activeCount);
  setText("subPillCountInactive", all.length - activeCount);
  setText("financeSubNoticeCount", all.filter((s) => s.is_renewal_imminent).length);
  document.querySelectorAll("#financeSubscriptionStatusPills .fv-pill").forEach((p) => {
    const n = Number((p.querySelector(".fv-pill__count") || {}).textContent || 0);
    p.classList.toggle("fv-pill--zero", !n);
  });

  let items = all;

  if (_subscriptionsFilterStatus === "active") {
    items = items.filter((s) => s.is_active);
  } else if (_subscriptionsFilterStatus === "inactive") {
    items = items.filter((s) => !s.is_active);
  }

  if (_subscriptionsNoticeOnly) {
    items = items.filter((s) => s.is_renewal_imminent);
  }

  if (_subscriptionsSearchQuery) {
    items = items.filter(
      (s) =>
        (s.name || "").toLowerCase().includes(_subscriptionsSearchQuery) ||
        (s.vendor_name || "").toLowerCase().includes(_subscriptionsSearchQuery) ||
        (s.owner || "").toLowerCase().includes(_subscriptionsSearchQuery) ||
        (s.department || "").toLowerCase().includes(_subscriptionsSearchQuery)
    );
  }

  if (!items.length) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    if (footer) footer.style.display = "none";
    return;
  }
  if (empty) empty.style.display = "none";

  if (footer) {
    footer.style.display = "";
    footer.innerHTML = `<span>Showing <b>1&ndash;${items.length}</b> of <b>${items.length}</b> subscriptions${_subscriptionRunRate(items)}</span>`;
  }

  tbody.innerHTML = items
    .map((s) => {
      const cur = s.currency || "USD";
      const esc = FinanceUI.esc;
      const cycle = (s.billing_cycle || "monthly");
      const cycleLabel = cycle.charAt(0).toUpperCase() + cycle.slice(1);
      const billing = `${cycleLabel} &middot; ${s.auto_generate_bill ? "auto" : "manual"}`;
      const lastCharged = s.last_charge_date ? `Last charged ${FinanceUI.formatDate(s.last_charge_date)}` : "";

      const owner = s.owner
        ? `<div class="fv-date"><span>${esc(s.owner)}</span>${s.department ? `<span class="fv-sub">${esc(s.department)}</span>` : ""}</div>`
        : `<span class="fv-note fv-note--warn">No owner</span>`;

      const monthlyEquiv = s.monthly_equivalent_amount && s.billing_cycle !== "monthly"
        ? `~${FinanceFormat.formatMoney(s.monthly_equivalent_amount, cur)}/mo`
        : "";

      let renewalNote = "";
      let renewalTone = "info";
      if (s.is_renewal_imminent) {
        renewalNote = "Notice due";
        renewalTone = "warn";
      } else if (s.notice_deadline_date) {
        renewalNote = `Notice by: ${s.notice_deadline_date}`;
      }

      return `
      <tr>
        <td><div class="fv-cell-main">${FinanceUI.avatar(s.vendor_name || s.name, FinanceUI.hueForId(s.vendor_id || s.id))}<div class="fv-cell-main__text"><span class="fv-cell-main__name">${esc(s.name)}</span><span class="fv-sub">${s.vendor_name ? esc(s.vendor_name) : "–"}</span></div></div></td>
        <td>${owner}</td>
        <td>${FinanceUI.dateCell(s.next_renewal_date, renewalNote, renewalTone)}</td>
        <td><div class="fv-date"><span>${billing}</span>${lastCharged ? `<span class="fv-sub">${lastCharged}</span>` : ""}</div></td>
        <td data-label="Paid from">${s.payment_account_name ? `<div class="fv-date"><span>${esc(s.payment_account_name)}</span><span class="fv-book-chip fv-book-chip--${esc(s.book_code || "local")}" data-book-chip>${esc((s.book_code || "local") === "overseas" ? "Overseas" : "Local")}</span></div>` : `<span class="fv-muted">Not set</span>`}</td>
        <td>${FinanceUI.statusPill(s.is_active ? "active" : "inactive", s.is_active ? "Active" : "Inactive")}</td>
        <td class="cell-money fv-num">${FinanceUI.amountCell(s.amount, cur, monthlyEquiv)}</td>
        <td>${FinanceUI.rowActions({
          primary: { label: "Log Charge", kind: "fill", className: "btn-log-charge", onclick: `openLogSubscriptionChargeModal(${s.id})`, attrs: 'title="Log Actual Charge"' },
          icons: [
            { icon: "fa-clock-rotate-left", label: "View Charge History", className: "btn-sub-history", onclick: `openSubscriptionHistoryModal(${s.id})` },
            { icon: "fa-pen", label: "Edit Subscription", onclick: `openEditSubscriptionModal(${s.id})` },
          ],
        })}</td>
      </tr>
      `;
    })
    .join("");
}

async function _populateSubscriptionAccountDropdown(selectedId = null) {
  if (!FinanceState.accounts || !FinanceState.accounts.length) {
    try { FinanceState.accounts = await FinanceApi.getAccounts(); } catch (_) { FinanceState.accounts = []; }
  }
  const sel = document.getElementById("subPaymentAccount");
  if (!sel) return;
  const esc = FinanceUI.esc;
  sel.innerHTML = '<option value="">No account set</option>' + (FinanceState.accounts || []).filter((a) => a.is_active)
    .map((a) => `<option value="${a.id}">${esc(a.account_name)} (${esc(a.currency)}${a.book_name ? ` · ${esc(a.book_name)}` : ""})</option>`).join("");
  sel.value = selectedId ? String(selectedId) : "";
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
  FinanceForm.clearErrors("subscriptionModal");
  document.getElementById("subId").value = "";
  document.getElementById("subModalTitle").textContent = "New Subscription";
  document.getElementById("subName").value = "";
  document.getElementById("subAmount").value = "";
  document.getElementById("subCurrency").value = "USD";
  document.getElementById("subBillingCycle").value = "monthly";
  document.getElementById("subOwner").value = "";
  document.getElementById("subDepartment").value = "Engineering";
  document.getElementById("subNoticeDays").value = "30";
  document.getElementById("subSeats").value = "";
  document.getElementById("subContractStart").value = "";
  document.getElementById("subContractEnd").value = "";
  
  const today = new Date();
  today.setMonth(today.getMonth() + 1);
  document.getElementById("subNextRenewal").value = today.toISOString().split("T")[0];
  document.getElementById("subAutoBill").checked = true;
  document.getElementById("subBillingEmail").value = "";
  document.getElementById("subProofSource").value = "none";
  document.getElementById("subProofExpected").checked = true;
  await _populateSubscriptionAccountDropdown(null);

  await _populateSubscriptionVendorDropdown();
  openModal("subscriptionModal");
}

async function openEditSubscriptionModal(id) {
  FinanceForm.clearErrors("subscriptionModal");
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

  document.getElementById("subOwner").value = s.owner || "";
  document.getElementById("subDepartment").value = s.department || "Engineering";
  document.getElementById("subNoticeDays").value = s.notice_period_days != null ? s.notice_period_days : 30;
  document.getElementById("subSeats").value = s.seats_count || "";
  document.getElementById("subContractStart").value = s.contract_start_date || "";
  document.getElementById("subContractEnd").value = s.contract_end_date || "";
  document.getElementById("subBillingEmail").value = s.billing_email || "";
  document.getElementById("subProofSource").value = s.proof_source || "none";
  document.getElementById("subProofExpected").checked = !!s.proof_expected;
  await _populateSubscriptionAccountDropdown(s.payment_account_id);

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

  const owner = document.getElementById("subOwner") ? document.getElementById("subOwner").value.trim() : "";
  const department = document.getElementById("subDepartment") ? document.getElementById("subDepartment").value : null;
  const noticeDays = document.getElementById("subNoticeDays") ? parseInt(document.getElementById("subNoticeDays").value || "30", 10) : 30;
  const seats = document.getElementById("subSeats") && document.getElementById("subSeats").value ? parseInt(document.getElementById("subSeats").value, 10) : null;
  const contractStart = document.getElementById("subContractStart") ? document.getElementById("subContractStart").value : null;
  const contractEnd = document.getElementById("subContractEnd") ? document.getElementById("subContractEnd").value : null;

  const isValid = FinanceForm.validateRequiredFields("subscriptionModal", [
    { id: "subName", label: "Service Name" },
    { id: "subVendorId", label: "Vendor" },
    { id: "subAmount", label: "Recurring Amount", check: (v) => !isNaN(parseFloat(v)) && parseFloat(v) >= 0, message: "Enter a valid recurring amount." },
    { id: "subNextRenewal", label: "Next Renewal Date" },
  ]);
  if (!isValid) return;

  const payload = {
    vendor_id: parseInt(vendorId, 10),
    name,
    amount,
    currency,
    billing_cycle: billingCycle,
    next_renewal_date: nextRenewal,
    auto_generate_bill: autoBill,
    owner: owner || null,
    department: department || null,
    notice_period_days: isNaN(noticeDays) ? 30 : noticeDays,
    seats_count: seats,
    contract_start_date: contractStart || null,
    contract_end_date: contractEnd || null,
    payment_account_id: document.getElementById("subPaymentAccount").value ? parseInt(document.getElementById("subPaymentAccount").value, 10) : null,
    billing_email: document.getElementById("subBillingEmail").value.trim() || null,
    proof_source: document.getElementById("subProofSource").value,
    proof_expected: document.getElementById("subProofExpected").checked,
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

function onChargeAmountInput() {
  if (!_currentLoggingSub) return;
  const enteredAmount = parseFloat(document.getElementById("chargeAmount").value);
  const baseRate = parseFloat(_currentLoggingSub.amount || 0);
  const varianceGroup = document.getElementById("chargeVarianceGroup");
  const varianceAlert = document.getElementById("chargeVarianceAlert");

  if (isNaN(enteredAmount)) {
    if (varianceGroup) varianceGroup.style.display = "none";
    return;
  }

  const diff = enteredAmount - baseRate;
  if (Math.abs(diff) > 0.009) {
    if (varianceGroup) varianceGroup.style.display = "block";
    if (varianceAlert) {
      const sign = diff > 0 ? "+" : "";
      varianceAlert.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Amount differs from base expected rate (${_currentLoggingSub.currency || 'USD'} ${baseRate.toFixed(2)}). Variance: <strong>${sign}${diff.toFixed(2)}</strong>`;
    }
  } else {
    if (varianceGroup) varianceGroup.style.display = "none";
  }
}

async function openLogSubscriptionChargeModal(subId) {
  FinanceForm.clearErrors("subscriptionChargeModal");
  const sub = (FinanceState.subscriptions || []).find((s) => s.id === parseInt(subId, 10));
  if (!sub) return;

  _currentLoggingSub = sub;

  document.getElementById("chargeSubId").value = sub.id;
  document.getElementById("chargeModalTitle").textContent = "Log Charge: " + sub.name;
  document.getElementById("chargeModalSub").textContent = `Vendor: ${sub.vendor_name || "--"} | Base Rate: ${sub.currency} ${Number(sub.amount).toFixed(2)}`;
  
  document.getElementById("chargeAmount").value = sub.amount || "";
  document.getElementById("chargeCurrency").value = sub.currency || "USD";
  document.getElementById("chargeDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("chargeNote").value = "";
  document.getElementById("chargeFile").value = "";

  const createBillCheck = document.getElementById("chargeCreateBill");
  if (createBillCheck) createBillCheck.checked = true;

  const varReason = document.getElementById("chargeVarianceReason");
  if (varReason) varReason.value = "";

  onChargeAmountInput();

  const bankSel = document.getElementById("chargeBankAccountId");
  if (bankSel) {
    try {
      const accounts = await FinanceApi.getAccounts({ is_active: true });
      bankSel.innerHTML = '<option value="">— Don\'t record ledger outflow —</option>' +
        (accounts || []).map((a) => `<option value="${a.id}">${a.account_name} (${a.currency}) - Bal: ${a.currency === 'EGP' ? 'EGP ' : '$'}${Number(a.current_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</option>`).join("");
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

  const createBill = document.getElementById("chargeCreateBill") ? document.getElementById("chargeCreateBill").checked : false;
  const varianceReason = document.getElementById("chargeVarianceReason") ? document.getElementById("chargeVarianceReason").value.trim() : "";

  if (!subId) { showToast("Subscription ID missing", "error"); return; }
  const isValid = FinanceForm.validateRequiredFields("subscriptionChargeModal", [
    { id: "chargeAmount", label: "Charge Amount", check: (v) => parseFloat(v) > 0, message: "Please enter a valid charge amount greater than 0." },
    { id: "chargeDate", label: "Billing Date" },
  ]);
  if (!isValid) return;

  const formData = new FormData();
  formData.append("amount", String(amount));
  formData.append("billing_date", date);
  formData.append("currency", currency);
  if (note) formData.append("note", note);
  if (bankId) formData.append("bank_account_id", String(bankId));
  formData.append("create_bill", createBill ? "true" : "false");
  if (varianceReason) formData.append("variance_reason", varianceReason);

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
      const currSymbol = c.currency === "EGP" ? "EGP " : c.currency === "EUR" ? "€" : "$";
      const amountStr = `${currSymbol}${Number(c.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

      let varianceBadge = "";
      if (c.variance_amount && Math.abs(c.variance_amount) > 0.009) {
        const sign = c.variance_amount > 0 ? "+" : "";
        const badgeClass = c.variance_amount > 0 ? "badge-danger" : "badge-approved";
        varianceBadge = `<span class="badge ${badgeClass}" style="font-size:10px; margin-left:6px;" title="Variance: ${sign}${c.variance_amount.toFixed(2)}${c.variance_reason ? ' (' + c.variance_reason + ')' : ''}">${sign}${c.variance_amount.toFixed(2)}</span>`;
      }

      const varianceReasonText = c.variance_reason
        ? `<div style="font-size:11px; color:var(--text3); font-style:italic; margin-top:2px;">Variance: ${c.variance_reason}</div>`
        : "";
      
      const ledgerBadge = c.linked_transaction_id
        ? '<span class="badge badge-approved" style="font-size:11px;"><i class="fa-solid fa-link"></i> Ledger</span>'
        : '<span class="badge badge-grey" style="font-size:11px;">No Ledger</span>';

      const billBadge = c.linked_bill_id
        ? `<span class="badge badge-approved" style="font-size:11px;"><i class="fa-solid fa-file-invoice"></i> Bill #${c.linked_bill_id}</span>`
        : "";

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
        <td>
          <strong>${amountStr}</strong>
          ${varianceBadge}
        </td>
        <td>
          ${c.note || '<span style="opacity:0.4;">--</span>'}
          ${varianceReasonText}
        </td>
        <td>
          <div style="display:flex; flex-direction:column; gap:3px;">
            <div>${ledgerBadge}</div>
            ${billBadge ? `<div>${billBadge}</div>` : ''}
          </div>
        </td>
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
window.onChargeAmountInput = onChargeAmountInput;
window.openLogSubscriptionChargeModal = openLogSubscriptionChargeModal;
window.saveSubscriptionCharge = saveSubscriptionCharge;
window.openSubscriptionHistoryModal = openSubscriptionHistoryModal;
window.openLogChargeFromHistory = openLogChargeFromHistory;

// ==========================================
// Charges to settle and proofs missing (X5, D-031)
// ==========================================
let _subCharges = [];

async function loadSubscriptionCharges() {
  try {
    const book = _subscriptionBookView();
    const [expected, missing] = await Promise.all([
      FinanceApi.getSubscriptionChargesV2({ status: "expected", book }),
      FinanceApi.getSubscriptionChargesV2({ proofs_missing: true, book }),
    ]);
    FinanceState.subChargesExpected = expected || [];
    FinanceState.subChargesMissing = missing || [];
    renderSubscriptionCharges();
  } catch (err) {
    console.error("Failed to load subscription charges:", err);
  }
}

function filterSubscriptionCharges(filter) {
  _subChargeFilter = filter;
  renderSubscriptionCharges();
}

function renderSubscriptionCharges() {
  const body = document.getElementById("financeSubChargesBody");
  const empty = document.getElementById("financeSubChargesEmpty");
  if (!body) return;
  const expected = FinanceState.subChargesExpected || [];
  const missing = FinanceState.subChargesMissing || [];
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText("subChgCountExpected", expected.length);
  setText("subChgCountProofs", missing.length);
  document.querySelectorAll("#financeSubChargePills .fv-pill").forEach((p) => {
    const on = p.dataset.filter === _subChargeFilter;
    p.classList.toggle("active", on);
    p.setAttribute("aria-pressed", on ? "true" : "false");
    p.classList.toggle("fv-pill--zero", !Number((p.querySelector(".fv-pill__count") || {}).textContent || 0));
  });
  const items = _subChargeFilter === "proofs_missing" ? missing : expected;
  _subCharges = [...expected, ...missing];
  if (!items.length) {
    body.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";
  const esc = FinanceUI.esc;
  const proofLabel = { attached: "Attached", pending: "Pending", unavailable: "Unavailable" };
  body.innerHTML = items.map((c) => {
    const today = new Date().toISOString().split("T")[0];
    const late = c.status === "expected" && c.billing_date < today;
    const proofTone = c.proof_status === "pending" && c.proof_expected ? "fv-note fv-note--warn" : "fv-sub";
    const proofText = c.proof_expected ? (proofLabel[c.proof_status] || c.proof_status) : "Not expected";
    const isOpen = c.status === "expected";
    return `
    <tr data-charge-id="${c.id}">
      <td data-label="Subscription"><div class="fv-cell-main__text"><span class="fv-cell-main__name">${esc(c.subscription_name || "")}</span><span class="fv-sub">${esc(c.vendor_name || "")}</span></div></td>
      <td data-label="Billing date">${FinanceUI.dateCell(c.billing_date, late ? "Not settled" : (isOpen ? "Expected" : "Settled"), late ? "late" : "info")}</td>
      <td data-label="Paid from">${c.payment_account_name ? `<div class="fv-date"><span>${esc(c.payment_account_name)}</span><span class="fv-book-chip fv-book-chip--${esc(c.book_code || "local")}" data-book-chip>${(c.book_code || "local") === "overseas" ? "Overseas" : "Local"}</span></div>` : '<span class="fv-muted">Not set</span>'}</td>
      <td data-label="Proof"><span class="${proofTone}" data-proof-status>${esc(proofText)}</span>${c.proof_note ? `<span class="fv-sub">${esc(c.proof_note)}</span>` : ""}</td>
      <td data-label="Amount" class="cell-money fv-num">${FinanceUI.amountCell(c.amount, c.currency || "USD", "")}</td>
      <td class="col-actions">${FinanceUI.rowActions({
        primary: isOpen ? { label: "Settle", kind: "fill", className: "btn-charge-settle", onclick: `openSubscriptionSettleModal(${c.id})`, attrs: 'title="Settle this charge"' } : null,
        icons: [
          { icon: "fa-paperclip", label: "Proof of payment", className: "btn-charge-proof", onclick: `openSubscriptionProofModal(${c.id})` },
          ...(isOpen ? [{ icon: "fa-forward", label: "Skip this charge", className: "btn-charge-skip", onclick: `skipSubscriptionCharge(${c.id})` }] : []),
        ],
      })}</td>
    </tr>`;
  }).join("");
}

async function openSubscriptionSettleModal(chargeId) {
  const c = (FinanceState.subChargesExpected || []).find((x) => x.id === Number(chargeId));
  if (!c) return;
  FinanceForm.clearErrors("subSettleModal");
  document.getElementById("subSettleChargeId").value = c.id;
  document.getElementById("subSettleTitle").textContent = `Settle: ${c.subscription_name}`;
  document.getElementById("subSettleSub").textContent = `${c.billing_date} · expected ${FinanceFormat.formatMoney(c.expected_amount != null ? c.expected_amount : c.amount, c.currency)}`;
  document.getElementById("subSettleMode").value = "link_ledger";
  document.getElementById("subSettleAmount").value = c.expected_amount != null ? c.expected_amount : c.amount;
  document.getElementById("subSettleVarianceReason").value = "";
  if (!FinanceState.accounts || !FinanceState.accounts.length) FinanceState.accounts = await FinanceApi.getAccounts();
  const esc = FinanceUI.esc;
  const accounts = (FinanceState.accounts || []).filter((a) => a.is_active && a.currency === c.currency);
  document.getElementById("subSettleAccount").innerHTML = accounts.map((a) => `<option value="${a.id}">${esc(a.account_name)}</option>`).join("");
  if (c.payment_account_id && accounts.some((a) => a.id === c.payment_account_id)) document.getElementById("subSettleAccount").value = String(c.payment_account_id);
  // Payments (money out, same currency) from the accounts the charge could have been paid from
  let options = [];
  for (const a of accounts) {
    try {
      const txs = await FinanceApi.getAccountTransactions(a.id);
      (txs || []).filter((t) => t.direction === "out" && (t.currency || a.currency) === c.currency && !t.linked_bill_id)
        .forEach((t) => options.push(`<option value="${t.id}">${esc(a.account_name)} · ${esc(t.date)} · ${esc(FinanceFormat.formatMoney(t.amount, c.currency))} · ${esc(t.description || t.reference || "")}</option>`));
    } catch (_) { /* an account without a ledger view is skipped */ }
  }
  document.getElementById("subSettleLedger").innerHTML = options.length ? options.join("") : '<option value="">No unlinked payments found</option>';
  onSubSettleModeChanged();
  openModal("subSettleModal");
}

function onSubSettleModeChanged() {
  const bill = document.getElementById("subSettleMode").value === "already_paid_bill";
  document.getElementById("subSettleLedgerGroup").style.display = bill ? "none" : "";
  document.getElementById("subSettleAccountGroup").style.display = bill ? "" : "none";
  document.getElementById("subSettleAmountGroup").style.display = bill ? "" : "none";
}

async function saveSubscriptionSettle() {
  const id = Number(document.getElementById("subSettleChargeId").value);
  const mode = document.getElementById("subSettleMode").value;
  const payload = { mode, variance_reason: document.getElementById("subSettleVarianceReason").value.trim() || null };
  if (mode === "link_ledger") {
    const tx = document.getElementById("subSettleLedger").value;
    if (!tx) { toast("Choose the payment to link.", "fa-solid fa-triangle-exclamation"); return; }
    payload.ledger_transaction_id = parseInt(tx, 10);
  } else {
    payload.bank_account_id = parseInt(document.getElementById("subSettleAccount").value, 10) || null;
    const amt = document.getElementById("subSettleAmount").value;
    if (amt) payload.amount = parseFloat(amt);
  }
  const btn = document.getElementById("subSettleSaveBtn");
  if (btn) btn.disabled = true;
  try {
    await FinanceApi.settleSubscriptionCharge(id, payload);
    toast("Charge settled.", "fa-solid fa-circle-check");
    closeModal("subSettleModal");
    await loadFinanceSubscriptions();
  } catch (err) {
    toast(err.message || "Could not settle the charge", "fa-solid fa-triangle-exclamation");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function skipSubscriptionCharge(chargeId) {
  const c = (FinanceState.subChargesExpected || []).find((x) => x.id === Number(chargeId));
  const result = await FinanceCommand.confirmAction({
    title: "Skip this charge",
    summary: c ? `<strong>${FinanceUI.esc(c.subscription_name)}</strong> · ${FinanceUI.esc(c.billing_date)}` : `Charge #${chargeId}`,
    consequence: "The charge will not be expected any more and the next renewal moves forward one cycle.",
    actionLabel: "Skip charge",
    actionClass: "btn btn-fill",
    requireReason: true,
    severity: "info",
  });
  if (!result.confirmed) return;
  try {
    await FinanceApi.skipSubscriptionCharge(Number(chargeId), { reason: result.reason });
    toast("Charge skipped.", "fa-solid fa-circle-check");
    await loadFinanceSubscriptions();
  } catch (err) {
    toast(err.message || "Could not skip the charge", "fa-solid fa-triangle-exclamation");
  }
}

function openSubscriptionProofModal(chargeId) {
  document.getElementById("subProofChargeId").value = chargeId;
  document.getElementById("subProofFile").value = "";
  document.getElementById("subProofReason").value = "";
  openModal("subProofModal");
}

async function saveSubscriptionProof(kind) {
  const id = Number(document.getElementById("subProofChargeId").value);
  try {
    if (kind === "attached") {
      const file = document.getElementById("subProofFile").files[0];
      if (!file) { toast("Choose the proof file first.", "fa-solid fa-triangle-exclamation"); return; }
      await FinanceApi.uploadSubscriptionChargeProof(id, file);
    } else {
      const reason = document.getElementById("subProofReason").value.trim();
      if (!reason) { toast("A reason is required when the proof is unavailable.", "fa-solid fa-triangle-exclamation"); return; }
      await FinanceApi.setSubscriptionChargeProof(id, { proof_status: "unavailable", proof_note: reason });
    }
    toast("Proof updated.", "fa-solid fa-circle-check");
    closeModal("subProofModal");
    await loadSubscriptionCharges();
  } catch (err) {
    toast(err.message || "Could not update the proof", "fa-solid fa-triangle-exclamation");
  }
}

window.filterSubscriptionCharges = filterSubscriptionCharges;
window.openSubscriptionSettleModal = openSubscriptionSettleModal;
window.onSubSettleModeChanged = onSubSettleModeChanged;
window.saveSubscriptionSettle = saveSubscriptionSettle;
window.skipSubscriptionCharge = skipSubscriptionCharge;
window.openSubscriptionProofModal = openSubscriptionProofModal;
window.saveSubscriptionProof = saveSubscriptionProof;

