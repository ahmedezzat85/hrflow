// ==========================================
// 5.5 Cheque Register & Direct Teller Withdrawals (Phase 5)
// ==========================================
let _currentChequeStatusFilter = "";
let _chequeMoreOpen = false;
const _CHEQUE_STATUSES = [
  ["draft", "Draft"], ["issued", "Issued"], ["outstanding", "Outstanding"], ["cleared", "Cleared"],
  ["bounced", "Bounced"], ["stopped", "Stopped"], ["voided", "Voided"], ["replaced", "Replaced"],
];

async function loadFinanceCheques() {
  const bar = document.getElementById("financeChequesLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const fyFilter = document.getElementById("financeChequeFiscalYearFilter");
    const fy = fyFilter ? fyFilter.value : "";
    const searchInput = document.getElementById("financeChequeSearch");
    const search = searchInput ? searchInput.value.trim() : "";

    // Status is filtered on the client so the pills can show a count for every status.
    const params = {};
    if (fy) params.fiscal_year = fy;
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
  renderFinanceCheques(FinanceState.cheques || []);
}

function toggleChequeMoreStatuses() {
  _chequeMoreOpen = !_chequeMoreOpen;
  renderFinanceCheques(FinanceState.cheques || []);
}

// Status pills: All plus every status that has a cheque; the others sit behind a dashed "More" pill in the same row.
function _renderChequeStatusPills(list) {
  const host = document.getElementById("financeChequeStatusTabs");
  if (!host) return;
  const count = (s) => list.filter((c) => c.status === s).length;
  const pill = (status, label, n, group) => {
    const on = _currentChequeStatusFilter === status;
    const cls = `filter-tab fv-pill${group ? ` fv-pill--${group}` : ""}${on ? " active" : ""}${n ? "" : " fv-pill--zero"}`;
    const dot = group ? `<span class="fv-pill__dot" aria-hidden="true"></span>` : "";
    return `<button type="button" class="${cls}" data-status="${status}" aria-pressed="${on}" onclick="filterFinanceChequeStatus('${status}', this)">${dot}${label} <span class="fv-pill__count">${n}</span></button>`;
  };
  const shown = [];
  const hidden = [];
  _CHEQUE_STATUSES.forEach(([s, label]) => {
    const n = count(s);
    // the selected status stays visible even when it has no cheque
    if (n > 0 || _chequeMoreOpen || _currentChequeStatusFilter === s) shown.push(pill(s, label, n, FinanceUI.statusGroup(s)));
    else hidden.push(label);
  });
  let html = pill("", "All", list.length, "") + shown.join("");
  if (hidden.length) {
    html += `<button type="button" class="fv-pill fv-pill--more" aria-expanded="false" onclick="toggleChequeMoreStatuses()">More &middot; ${hidden.join(", ")} &#9662;</button>`;
  } else if (_chequeMoreOpen) {
    html += `<button type="button" class="fv-pill fv-pill--more" aria-expanded="true" onclick="toggleChequeMoreStatuses()">Fewer &#9652;</button>`;
  }
  host.innerHTML = html;
}

function renderFinanceCheques(all) {
  const tbody = document.getElementById("financeChequesTableBody");
  const empty = document.getElementById("financeChequesEmpty");
  const footer = document.getElementById("financeChequesFooter");
  if (!tbody) return;

  const list = all || [];
  _renderChequeStatusPills(list);
  const items = _currentChequeStatusFilter ? list.filter((c) => c.status === _currentChequeStatusFilter) : list;

  if (items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    if (footer) footer.style.display = "none";
    return;
  }
  if (empty) empty.style.display = "none";

  // Footer: the count and what is not yet cleared, per currency
  if (footer) {
    const open = {};
    items.filter((c) => c.status === "issued" || c.status === "outstanding").forEach((c) => {
      const cur = c.currency || "USD";
      open[cur] = (open[cur] || 0) + Number(c.amount || 0);
    });
    const openText = Object.entries(open).map(([cur, v]) => `<span class="fv-foot__total">${FinanceUI.moneyHtml(v, cur)}</span>`).join(" + ");
    footer.style.display = "";
    footer.innerHTML = `<span>Showing <b>1&ndash;${items.length}</b> of <b>${items.length}</b> ${items.length === 1 ? "cheque" : "cheques"}${openText ? ` &middot; ${openText} not yet cleared` : ""}</span>`;
  }

  const esc = FinanceUI.esc;
  tbody.innerHTML = items
    .map((c) => {
      // Purpose: plain text (a vendor bill shows its number as a link line)
      let purpose = "General";
      let purposeSub = "";
      if (c.purpose_type === "cash_withdrawal") {
        purpose = "Cash withdrawal";
        purposeSub = c.destination_cash_account_name ? `Funds ${esc(c.destination_cash_account_name)}` : "";
      } else if (c.purpose_type === "vendor_payment") {
        purpose = "Vendor bill";
        purposeSub = c.linked_bill_number ? `<span class="fv-link">${esc(c.linked_bill_number)}</span>` : (c.linked_bill_id ? `<span class="fv-link">Bill #${esc(c.linked_bill_id)}</span>` : "");
      }

      const linkage = [];
      if (c.replaced_cheque_id) linkage.push(`Replaces #${esc(c.replaced_cheque_id)}`);
      if (c.replacement_cheque_id) linkage.push(`Replaced by #${esc(c.replacement_cheque_id)}`);

      const statusLabel = (_CHEQUE_STATUSES.find(([s]) => s === c.status) || [c.status, c.status])[1];
      const clear = c.clear_date ? `<span class="fv-sub">${esc(FinanceUI.formatDate(c.clear_date))}</span>` : "";
      const stale = c.is_stale ? `<span class="fv-note fv-note--warn" title="${esc(c.stale_warning || "Stale-dated (>180 days)")}">Stale-dated</span>` : "";

      // One text button and up to three icons per row (Mark outstanding stays reachable through the status filters of the API)
      let primary = null;
      const icons = [];
      if (c.status === "draft") {
        primary = { label: "Issue", kind: "fill", className: "btn-cheque-issue", onclick: `promoteDraftChequeAction(${c.id})`, attrs: 'title="Issue Cheque"' };
        icons.push({ icon: "fa-ban", label: "Void Draft", onclick: `openChequeActionModal(${c.id}, 'voided')` });
      } else if (c.status === "issued" || c.status === "outstanding") {
        primary = { label: "Mark cleared", kind: "fill", className: "btn-cheque-clear", onclick: `updateChequeStatusQuick(${c.id}, 'cleared')`, attrs: 'title="Mark Cleared"' };
        icons.push({ icon: "fa-hand", label: "Stop Payment", onclick: `openChequeActionModal(${c.id}, 'stopped')` });
        icons.push({ icon: "fa-triangle-exclamation", label: "Mark Bounced", className: "fv-icon-btn--danger", onclick: `openChequeActionModal(${c.id}, 'bounced')` });
        icons.push({ icon: "fa-ban", label: "Void Cheque", onclick: `openChequeActionModal(${c.id}, 'voided')` });
      } else if (c.status === "cleared") {
        icons.push({ icon: "fa-ban", label: "Void Cleared Cheque", onclick: `openChequeActionModal(${c.id}, 'voided')` });
        icons.push({ icon: "fa-triangle-exclamation", label: "Mark Bounced Post-Clearance", className: "fv-icon-btn--danger", onclick: `openChequeActionModal(${c.id}, 'bounced')` });
      } else if (c.status === "bounced" || c.status === "stopped") {
        primary = { label: "Replace", kind: "outline", className: "btn-cheque-replace", onclick: `openChequeReplaceModal(${c.id})`, attrs: 'title="Issue Replacement Cheque"' };
      }

      return `
        <tr>
          <td data-label="Payee"><div class="fv-cell-main">${FinanceUI.avatar(c.payee, FinanceUI.hueForId(c.id))}<div class="fv-cell-main__text"><span class="fv-cell-main__name">${esc(c.payee)}</span><span class="fv-link">Cheque ${esc(c.cheque_number)}</span>${linkage.length ? `<span class="fv-sub">${linkage.join(" &middot; ")}</span>` : ""}</div></div></td>
          <td data-label="Issued">${esc(FinanceUI.formatDate(c.issue_date))}</td>
          <td data-label="From account">${esc(c.account_name || "—")}</td>
          <td data-label="Purpose"><div class="fv-date"><span>${purpose}</span>${purposeSub ? `<span class="fv-sub">${purposeSub}</span>` : ""}</div></td>
          <td data-label="Status"><div class="fv-date">${FinanceUI.statusPill(FinanceUI.statusGroup(c.status), statusLabel)}${clear}${stale}</div></td>
          <td data-label="Amount" class="cell-money fv-num"><span class="fv-amount__value">${FinanceUI.moneyHtml(Math.abs(c.amount || 0), c.currency || "USD")}</span></td>
          <td data-label="Actions" class="col-actions">${FinanceUI.rowActions({ primary, icons })}</td>
        </tr>
      `;
    })
    .join("");
}

// Quick status update for non-exception transitions (cleared, outstanding)
async function updateChequeStatusQuick(chequeId, newStatus) {
  let clearDate = null;
  if (newStatus === "cleared") {
    clearDate = new Date().toISOString().split("T")[0];
  }
  try {
    const payload = { status: newStatus };
    if (clearDate) payload.clear_date = clearDate;

    await FinanceApi.updateChequeStatus(chequeId, payload);
    toast(`Cheque status updated to ${newStatus.toUpperCase()}`, "fa-solid fa-circle-check");

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

// Promote draft cheque to issued
async function promoteDraftChequeAction(chequeId) {
  await updateChequeStatusQuick(chequeId, "issued");
}

// Exception action modal state
let _activeChequeActionId = null;
let _activeChequeActionStatus = null;

function openChequeActionModal(chequeId, targetStatus) {
  _activeChequeActionId = parseInt(chequeId, 10);
  _activeChequeActionStatus = targetStatus;

  const chq = (FinanceState.cheques || []).find((c) => c.id === _activeChequeActionId);
  const titleMap = {
    bounced: "Mark Cheque as Bounced",
    stopped: "Stop Payment on Cheque",
    voided: "Void Cheque",
  };
  const titleEl = document.getElementById("chequeActionModalTitle");
  if (titleEl) titleEl.innerText = titleMap[targetStatus] || "Cheque Exception";

  const card = document.getElementById("chequeActionSummaryCard");
  if (card) {
    card.innerHTML = chq
      ? `<strong>Cheque #${chq.cheque_number}</strong> · ${chq.payee} · <strong>${FinanceFormat.renderMoneyHtml(chq.amount || 0, chq.currency || "USD")}</strong> (Account: ${chq.account_name || 'Bank'})`
      : `Cheque #${chequeId}`;
  }

  const reasonEl = document.getElementById("chequeActionReason");
  if (reasonEl) reasonEl.value = "";
  const evEl = document.getElementById("chequeActionEvidence");
  if (evEl) evEl.value = "";

  openModal("financeChequeActionModal");
}

function closeChequeActionModal() {
  closeModal("financeChequeActionModal");
  _activeChequeActionId = null;
  _activeChequeActionStatus = null;
}

async function executeChequeAction() {
  const reason = (document.getElementById("chequeActionReason").value || "").trim();
  const evidence = (document.getElementById("chequeActionEvidence").value || "").trim();

  if (!reason) {
    toast("A reason is mandatory for exception actions.", "fa-solid fa-triangle-exclamation");
    return;
  }

  const btn = document.getElementById("chequeActionConfirmBtn");
  if (btn) btn.disabled = true;

  try {
    await FinanceApi.updateChequeStatus(_activeChequeActionId, {
      status: _activeChequeActionStatus,
      reason,
      evidence: evidence || null,
    });
    toast(`Cheque marked as ${_activeChequeActionStatus.toUpperCase()}`, "fa-solid fa-circle-check");
    closeChequeActionModal();

    FinanceState.accounts = await FinanceApi.getAccounts();
    await loadFinanceCheques();
    if (_currentFinanceSubTab === "accounts") {
      renderFinanceAccounts(FinanceState.accounts);
    }
  } catch (err) {
    console.error("Failed to execute cheque action:", err);
    toast("Action failed: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// Replacement modal state
let _activeChequeReplaceId = null;

function openChequeReplaceModal(chequeId) {
  _activeChequeReplaceId = parseInt(chequeId, 10);
  const chq = (FinanceState.cheques || []).find((c) => c.id === _activeChequeReplaceId);

  const summaryEl = document.getElementById("chequeReplaceOldSummary");
  if (summaryEl) {
    summaryEl.innerHTML = chq
      ? `<strong>Original Cheque #${chq.cheque_number}</strong> · Payee: <strong>${chq.payee}</strong> · Amount: <strong>${FinanceFormat.renderMoneyHtml(chq.amount || 0, chq.currency || "USD")}</strong> (Account: ${chq.account_name || 'Bank'})`
      : `Cheque #${chequeId}`;
  }

  document.getElementById("replaceNewChequeNumber").value = "";
  document.getElementById("replaceNewIssueDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("replaceSignerName").value = chq ? (chq.signer_name || "") : "";
  document.getElementById("replaceReason").value = "";
  document.getElementById("replaceEvidence").value = "";

  openModal("financeChequeReplaceModal");
}

function closeChequeReplaceModal() {
  closeModal("financeChequeReplaceModal");
  _activeChequeReplaceId = null;
}

async function executeChequeReplace() {
  const newNum = (document.getElementById("replaceNewChequeNumber").value || "").trim();
  const newDate = document.getElementById("replaceNewIssueDate").value;
  const signer = (document.getElementById("replaceSignerName").value || "").trim();
  const reason = (document.getElementById("replaceReason").value || "").trim();
  const evidence = (document.getElementById("replaceEvidence").value || "").trim();

  if (!newNum || !newDate || !reason) {
    toast("New cheque #, issue date, and reason are required.", "fa-solid fa-triangle-exclamation");
    return;
  }

  const btn = document.getElementById("replaceConfirmBtn");
  if (btn) btn.disabled = true;

  try {
    await FinanceApi.replaceCheque(_activeChequeReplaceId, {
      new_cheque_number: newNum,
      new_issue_date: newDate,
      signer_name: signer || null,
      reason,
      evidence: evidence || null,
    });
    toast(`Replacement Cheque #${newNum} issued successfully!`, "fa-solid fa-circle-check");
    closeChequeReplaceModal();

    FinanceState.accounts = await FinanceApi.getAccounts();
    await loadFinanceCheques();
    if (_currentFinanceSubTab === "accounts") {
      renderFinanceAccounts(FinanceState.accounts);
    }
  } catch (err) {
    console.error("Failed to replace cheque:", err);
    toast("Replacement failed: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function checkChequeIssueDate() {
  const dateVal = document.getElementById("chequeIssueDate").value;
  const banner = document.getElementById("chequeStaleWarningBanner");
  if (!banner || !dateVal) return;

  const issueDt = new Date(dateVal);
  const now = new Date();
  const diffDays = Math.floor((now - issueDt) / (1000 * 60 * 60 * 24));
  if (diffDays > 180) {
    banner.style.display = "flex";
    const txt = document.getElementById("chequeStaleWarningText");
    if (txt) {
      txt.innerText = `This issue date is ${diffDays} days old, exceeding the standard 180-day clearance validity.`;
    }
  } else {
    banner.style.display = "none";
  }
}

function checkChequeDuplicate() {
  const accId = document.getElementById("chequeAccountId").value;
  const num = (document.getElementById("chequeNumber").value || "").trim().toLowerCase();
  const warn = document.getElementById("chequeDuplicateWarning");
  if (!warn || !accId || !num) {
    if (warn) warn.style.display = "none";
    return;
  }

  const exists = (FinanceState.cheques || []).some(
    (c) => c.account_id === parseInt(accId, 10) && (c.cheque_number || "").trim().toLowerCase() === num
  );
  if (exists) {
    warn.style.display = "flex";
  } else {
    warn.style.display = "none";
  }
}

async function openIssueChequeModal() {
  FinanceForm.clearErrors("financeChequeModal");
  if (!FinanceState.accounts || !FinanceState.accounts.length) {
    FinanceState.accounts = await FinanceApi.getAccounts();
  }

  const bankSel = document.getElementById("chequeAccountId");
  if (bankSel) {
    const banks = (FinanceState.accounts || []).filter((a) => (a.account_type === "bank" || !a.account_type || a.account_type !== "cash") && a.is_active);
    bankSel.innerHTML = '<option value="">— Select company bank account —</option>' +
      banks.map((a) => `<option value="${a.id}" data-currency="${a.currency}">${a.account_name} (${a.currency}) - Bal: ${a.currency === 'EGP' ? 'EGP ' : '$'}${Number(a.current_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</option>`).join("");
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
  document.getElementById("chequeCurrency").value = "USD";
  document.getElementById("chequePostingPolicy").value = "at_issue";
  document.getElementById("chequeSignerName").value = "";
  document.getElementById("chequePayee").value = "";
  document.getElementById("chequePurposeType").value = "other";
  document.getElementById("chequeNotes").value = "";

  const staleBanner = document.getElementById("chequeStaleWarningBanner");
  if (staleBanner) staleBanner.style.display = "none";
  const dupWarn = document.getElementById("chequeDuplicateWarning");
  if (dupWarn) dupWarn.style.display = "none";

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
  checkChequeDuplicate();
}

function onChequePurposeChanged() {
  const purpose = document.getElementById("chequePurposeType").value;
  const destGroup = document.getElementById("chequeDestCashGroup");
  const billGroup = document.getElementById("chequeLinkedBillGroup");

  if (destGroup) destGroup.style.display = purpose === "cash_withdrawal" ? "block" : "none";
  if (billGroup) billGroup.style.display = purpose === "vendor_payment" ? "block" : "none";
}

async function saveIssueCheque(isDraft = false) {
  const accountIdVal = document.getElementById("chequeAccountId").value;
  const chequeNumber = document.getElementById("chequeNumber").value.trim();
  const issueDate = document.getElementById("chequeIssueDate").value;
  const amountVal = document.getElementById("chequeAmount").value;
  const amount = parseFloat(amountVal);
  const currency = document.getElementById("chequeCurrency").value;
  const postingPolicy = document.getElementById("chequePostingPolicy").value;
  const signerName = (document.getElementById("chequeSignerName").value || "").trim();
  const payee = document.getElementById("chequePayee").value.trim();
  const purposeType = document.getElementById("chequePurposeType").value;
  const destCashVal = document.getElementById("chequeDestinationCashAccountId").value;
  const linkedBillVal = document.getElementById("chequeLinkedBillId").value;
  const notes = document.getElementById("chequeNotes").value.trim();

  const rules = [
    { id: "chequeAccountId", label: "Source company bank account" },
    { id: "chequeNumber", label: "Cheque Number" },
    { id: "chequeIssueDate", label: "Issue Date" },
    { id: "chequeAmount", label: "Cheque Amount", check: (v) => parseFloat(v) > 0, message: "Please enter a valid cheque amount greater than 0." },
    { id: "chequePayee", label: "Payee Name" },
  ];
  if (purposeType === "cash_withdrawal") {
    rules.push({ id: "chequeDestinationCashAccountId", label: "Destination Cash Drawer" });
  }
  const isValid = FinanceForm.validateRequiredFields("financeChequeModal", rules);
  if (!isValid) return;

  const saveBtn = document.getElementById("chequeModalSaveBtn");
  const draftBtn = document.getElementById("chequeSaveDraftBtn");
  if (saveBtn) saveBtn.disabled = true;
  if (draftBtn) draftBtn.disabled = true;

  const payload = {
    account_id: parseInt(accountIdVal, 10),
    cheque_number: chequeNumber,
    issue_date: issueDate,
    amount,
    currency,
    posting_policy: postingPolicy,
    signer_name: signerName || null,
    payee,
    purpose_type: purposeType,
    status: isDraft ? "draft" : "issued",
    destination_cash_account_id: destCashVal ? parseInt(destCashVal, 10) : null,
    linked_bill_id: linkedBillVal ? parseInt(linkedBillVal, 10) : null,
    notes: notes || null,
  };

  try {
    await FinanceApi.createCheque(payload);
    toast(isDraft ? "Cheque draft saved successfully." : "Cheque issued successfully!", "fa-solid fa-circle-check");
    closeIssueChequeModal();

    FinanceState.accounts = await FinanceApi.getAccounts();
    await loadFinanceCheques();
    if (_currentFinanceSubTab === "accounts") {
      renderFinanceAccounts(FinanceState.accounts);
    }
  } catch (err) {
    console.error("Failed to save cheque:", err);
    toast("Failed to save cheque: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
    if (draftBtn) draftBtn.disabled = false;
  }
}

async function openWithdrawCashModal() {
  FinanceForm.clearErrors("financeWithdrawCashModal");
  if (!FinanceState.accounts || !FinanceState.accounts.length) {
    FinanceState.accounts = await FinanceApi.getAccounts();
  }
  const bankSel = document.getElementById("withdrawSourceAccountId");
  if (bankSel) {
    const banks = (FinanceState.accounts || []).filter((a) => (a.account_type === "bank" || !a.account_type || a.account_type !== "cash") && a.is_active);
    bankSel.innerHTML = '<option value="">— Select bank —</option>' +
      banks.map((a) => `<option value="${a.id}" data-currency="${a.currency}">${a.account_name} (${a.currency}) - Bal: ${a.currency === 'EGP' ? 'EGP ' : '$'}${Number(a.current_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</option>`).join("");
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

  const isValid = FinanceForm.validateRequiredFields("financeWithdrawCashModal", [
    { id: "withdrawSourceAccountId", label: "Source company bank account" },
    { id: "withdrawDestCashAccountId", label: "Destination Cash Drawer" },
    { id: "withdrawAmount", label: "Withdrawal Amount", check: (v) => parseFloat(v) > 0, message: "Please enter a valid withdrawal amount greater than 0." },
    { id: "withdrawDate", label: "Withdrawal Date" },
  ]);
  if (!isValid) return;

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
window.toggleChequeMoreStatuses = toggleChequeMoreStatuses;
window.updateChequeStatusQuick = updateChequeStatusQuick;
window.openChequeActionModal = openChequeActionModal;
window.closeChequeActionModal = closeChequeActionModal;
window.executeChequeAction = executeChequeAction;
window.openChequeReplaceModal = openChequeReplaceModal;
window.closeChequeReplaceModal = closeChequeReplaceModal;
window.executeChequeReplace = executeChequeReplace;
window.openIssueChequeModal = openIssueChequeModal;
window.closeIssueChequeModal = closeIssueChequeModal;
window.onChequeAccountSelected = onChequeAccountSelected;
window.onChequePurposeChanged = onChequePurposeChanged;
window.saveIssueCheque = saveIssueCheque;
window.openWithdrawCashModal = openWithdrawCashModal;
window.closeWithdrawCashModal = closeWithdrawCashModal;
window.onWithdrawSourceAccountSelected = onWithdrawSourceAccountSelected;
window.saveWithdrawCash = saveWithdrawCash;

