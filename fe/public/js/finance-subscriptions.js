// ==========================================
// 7. Subscriptions & Charges (Phase 6 / Story 4.4)
// ==========================================
let _subscriptionsFilterStatus = "active";
let _subscriptionsSearchQuery = "";
let _currentHistorySubId = null;
let _currentLoggingSub = null;

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
        (s.vendor_name || "").toLowerCase().includes(_subscriptionsSearchQuery) ||
        (s.owner || "").toLowerCase().includes(_subscriptionsSearchQuery) ||
        (s.department || "").toLowerCase().includes(_subscriptionsSearchQuery)
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
      const lastChargeInfo = s.last_charge_amount
        ? `<div style="font-size:11.5px; color:var(--text3); margin-top:3px;"><i class="fa-solid fa-receipt"></i> Last: ${FinanceFormat.formatMoney(s.last_charge_amount, s.currency || "USD")} (${FinanceFormat.formatFinanceDate(s.last_charge_date)})</div>`
        : "";

      const ownerInfo = s.owner
        ? `<div style="font-size:11.5px; color:var(--text3); margin-top:3px;"><i class="fa-solid fa-user-tag"></i> ${s.owner} ${s.department ? `(${s.department})` : ''}</div>`
        : `<div style="font-size:11.5px; color:var(--danger); margin-top:3px;"><span class="badge badge-warning" style="font-size:10px;"><i class="fa-solid fa-triangle-exclamation"></i> No Owner</span></div>`;

      const monthlyEquiv = s.monthly_equivalent_amount && s.billing_cycle !== 'monthly'
        ? `<div style="font-size:11px; color:var(--text3); font-weight:normal;">~${FinanceFormat.formatMoney(s.monthly_equivalent_amount, s.currency || 'USD')}/mo</div>`
        : "";

      const renewalWarning = s.is_renewal_imminent
        ? `<div style="margin-top:3px;"><span class="badge badge-danger" style="font-size:10.5px; display:inline-flex; align-items:center; gap:4px;"><i class="fa-solid fa-bell"></i> Notice due</span></div>`
        : (s.notice_deadline_date ? `<div style="font-size:11px; color:var(--text3); margin-top:2px;">Notice by: ${s.notice_deadline_date}</div>` : "");

      return `
      <tr>
        <td>
          <div style="font-weight:700; font-size:13.5px;">${s.name}</div>
          ${ownerInfo}
        </td>
        <td>${s.vendor_name || '<span style="opacity:0.5;">--</span>'}</td>
        <td class="cell-money">
          <strong>${FinanceFormat.renderMoneyHtml(s.amount, s.currency || "USD")}</strong>
          ${monthlyEquiv}
        </td>
        <td><span class="badge badge-grey">${(s.billing_cycle || "monthly").toUpperCase()}</span></td>
        <td>
          <div>${FinanceFormat.formatFinanceDate(s.next_renewal_date)}</div>
          ${renewalWarning}
        </td>
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
          ${FinanceFormat.formatStatusBadge("subscription", s.is_active ? "active" : "inactive")}
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
      const currSymbol = c.currency === "EGP" ? "E£" : c.currency === "EUR" ? "€" : "$";
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
