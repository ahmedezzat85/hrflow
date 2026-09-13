// ==========================================
// 5.5 Cheque Register & Direct Teller Withdrawals (Phase 5)
// ==========================================
let _currentChequeStatusFilter = "";

async function loadFinanceCheques() {
  const bar = document.getElementById("financeChequesLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const fyFilter = document.getElementById("financeChequeFiscalYearFilter");
    const fy = fyFilter ? fyFilter.value : "";
    const searchInput = document.getElementById("financeChequeSearch");
    const search = searchInput ? searchInput.value.trim() : "";

    const params = {};
    if (fy) params.fiscal_year = fy;
    if (_currentChequeStatusFilter) params.status = _currentChequeStatusFilter;
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
  const tabs = document.querySelectorAll("#financeChequeStatusTabs .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) {
    btn.classList.add("active");
  } else {
    const el = document.querySelector(`#financeChequeStatusTabs [data-status="${status}"]`);
    if (el) el.classList.add("active");
  }
  loadFinanceCheques();
}

function renderFinanceCheques(items) {
  const tbody = document.getElementById("financeChequesTableBody");
  const empty = document.getElementById("financeChequesEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map((c) => {
      let purposeBadge = "";
      if (c.purpose_type === "cash_withdrawal") {
        purposeBadge = `<span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:600;"><i class="fa-solid fa-hand-holding-dollar"></i> Cash Drawer</span>`;
      } else if (c.purpose_type === "vendor_payment") {
        purposeBadge = `<span class="badge" style="background:#fef3c7; color:#92400e; font-weight:600;"><i class="fa-solid fa-file-invoice-dollar"></i> Vendor Bill</span>`;
      } else {
        purposeBadge = `<span class="badge badge-pending">General</span>`;
      }

      let statusBadge = "";
      if (c.status === "cleared") {
        statusBadge = `<span class="badge badge-approved"><i class="fa-solid fa-circle-check"></i> Cleared</span>`;
      } else if (c.status === "bounced") {
        statusBadge = `<span class="badge badge-rejected"><i class="fa-solid fa-triangle-exclamation"></i> Bounced</span>`;
      } else if (c.status === "voided") {
        statusBadge = `<span class="badge" style="background:var(--bg3); color:var(--text3);"><i class="fa-solid fa-ban"></i> Voided</span>`;
      } else {
        statusBadge = `<span class="badge badge-pending"><i class="fa-solid fa-clock"></i> Issued</span>`;
      }

      const sym = c.currency === "EGP" ? "E£" : "$";
      const amtStr = `-${sym}${Number(c.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

      let actionsHtml = "";
      if (c.status === "issued") {
        actionsHtml = `
          <div style="display:flex;gap:4px;justify-content:center;">
            <button class="btn btn-sm" onclick="updateChequeStatusAction(${c.id}, 'cleared')" title="Mark Cleared" style="color:var(--success);"><i class="fa-solid fa-check"></i></button>
            <button class="btn btn-sm btn-danger" onclick="updateChequeStatusAction(${c.id}, 'bounced')" title="Mark Bounced"><i class="fa-solid fa-triangle-exclamation"></i></button>
            <button class="btn btn-sm" onclick="updateChequeStatusAction(${c.id}, 'voided')" title="Void Cheque"><i class="fa-solid fa-ban"></i></button>
          </div>
        `;
      } else if (c.status === "cleared") {
        actionsHtml = `
          <div style="display:flex;gap:4px;justify-content:center;">
            <button class="btn btn-sm" onclick="updateChequeStatusAction(${c.id}, 'voided')" title="Void Cleared Cheque"><i class="fa-solid fa-ban"></i></button>
          </div>
        `;
      } else {
        actionsHtml = `<span style="color:var(--text3); font-size:11px;">No actions</span>`;
      }

      return `
        <tr>
          <td><strong style="font-family:monospace;font-size:13px;"><i class="fa-solid fa-money-check"></i> ${c.cheque_number}</strong></td>
          <td><span style="font-family:monospace;font-size:12px;">${FinanceFormat.formatFinanceDate(c.issue_date)}</span></td>
          <td><strong>${c.account_name || '—'}</strong></td>
          <td><strong>${c.payee}</strong></td>
          <td>${purposeBadge}</td>
          <td class="cell-money"><strong>${FinanceFormat.renderMoneyHtml(-Math.abs(c.amount || 0), c.currency || "USD")}</strong></td>
          <td style="text-align:center;">${FinanceFormat.formatStatusBadge("cheque", c.status)}</td>
          <td><span style="font-family:monospace;font-size:12px;">${FinanceFormat.formatFinanceDate(c.clear_date)}</span></td>
          <td style="text-align:center;">${actionsHtml}</td>
        </tr>
      `;
    })
    .join("");
}

async function updateChequeStatusAction(chequeId, newStatus) {
  let clearDate = null;
  if (newStatus === "cleared") {
    clearDate = new Date().toISOString().split("T")[0];
  }
  const chq = (FinanceState.cheques || []).find((c) => c.id === parseInt(chequeId, 10));
  const chqSummary = chq
    ? `<strong>Cheque #${chq.cheque_number}</strong> · ${chq.payee} · ${FinanceFormat.renderMoneyHtml(chq.amount || 0, chq.currency || "USD")}`
    : `Cheque #${chequeId}`;

  if (newStatus === "bounced") {
    const res = await FinanceCommand.confirmAction({
      title: "Mark Cheque as Bounced",
      summary: chqSummary,
      consequence: "Marking this cheque as Bounced will automatically generate continuous ledger reversal entries and restore account balances.",
      actionLabel: "Confirm Bounced",
      actionClass: "btn btn-danger",
      requireReason: true,
      severity: "danger",
    });
    if (!res.confirmed) return;
  } else if (newStatus === "voided") {
    const res = await FinanceCommand.confirmAction({
      title: "Void Cheque",
      summary: chqSummary,
      consequence: "Voiding will permanently void this cheque. Any linked continuous ledger transactions will be automatically reversed and balances restored.",
      actionLabel: "Void Cheque",
      actionClass: "btn btn-danger",
      requireReason: true,
      severity: "danger",
    });
    if (!res.confirmed) return;
  }

  try {
    const payload = { status: newStatus };
    if (clearDate) payload.clear_date = clearDate;

    await FinanceApi.updateChequeStatus(chequeId, payload);
    toast(`Cheque status updated to ${newStatus.toUpperCase()}`, "fa-solid fa-circle-check");

    // Reload accounts and cheques to synchronize balances everywhere
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

async function openIssueChequeModal() {
  FinanceForm.clearErrors("financeChequeModal");
  if (!FinanceState.accounts || !FinanceState.accounts.length) {
    FinanceState.accounts = await FinanceApi.getAccounts();
  }

  const bankSel = document.getElementById("chequeAccountId");
  if (bankSel) {
    const banks = (FinanceState.accounts || []).filter((a) => (a.account_type === "bank" || !a.account_type || a.account_type !== "cash") && a.is_active);
    bankSel.innerHTML = '<option value="">— Select bank account —</option>' +
      banks.map((a) => `<option value="${a.id}" data-currency="${a.currency}">${a.account_name} (${a.currency}) - Bal: ${a.currency === 'EGP' ? 'E£' : '$'}${Number(a.current_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</option>`).join("");
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
  document.getElementById("chequeCurrency").value = "EGP";
  document.getElementById("chequePayee").value = "";
  document.getElementById("chequePurposeType").value = "other";
  document.getElementById("chequeNotes").value = "";

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
}

function onChequePurposeChanged() {
  const purpose = document.getElementById("chequePurposeType").value;
  const destGroup = document.getElementById("chequeDestCashGroup");
  const billGroup = document.getElementById("chequeLinkedBillGroup");

  if (destGroup) destGroup.style.display = purpose === "cash_withdrawal" ? "block" : "none";
  if (billGroup) billGroup.style.display = purpose === "vendor_payment" ? "block" : "none";
}

async function saveIssueCheque() {
  const accountIdVal = document.getElementById("chequeAccountId").value;
  const chequeNumber = document.getElementById("chequeNumber").value.trim();
  const issueDate = document.getElementById("chequeIssueDate").value;
  const amountVal = document.getElementById("chequeAmount").value;
  const amount = parseFloat(amountVal);
  const currency = document.getElementById("chequeCurrency").value;
  const payee = document.getElementById("chequePayee").value.trim();
  const purposeType = document.getElementById("chequePurposeType").value;
  const destCashVal = document.getElementById("chequeDestinationCashAccountId").value;
  const linkedBillVal = document.getElementById("chequeLinkedBillId").value;
  const notes = document.getElementById("chequeNotes").value.trim();

  const rules = [
    { id: "chequeAccountId", label: "Source Bank Account" },
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

  const btn = document.getElementById("chequeModalSaveBtn");
  if (btn) btn.disabled = true;

  const payload = {
    account_id: parseInt(accountIdVal, 10),
    cheque_number: chequeNumber,
    issue_date: issueDate,
    amount,
    currency,
    payee,
    purpose_type: purposeType,
    destination_cash_account_id: destCashVal ? parseInt(destCashVal, 10) : null,
    linked_bill_id: linkedBillVal ? parseInt(linkedBillVal, 10) : null,
    notes: notes || null,
  };

  try {
    await FinanceApi.createCheque(payload);
    toast("Cheque issued successfully! Running balances updated.", "fa-solid fa-circle-check");
    closeIssueChequeModal();

    FinanceState.accounts = await FinanceApi.getAccounts();
    await loadFinanceCheques();
    if (_currentFinanceSubTab === "accounts") {
      renderFinanceAccounts(FinanceState.accounts);
    }
  } catch (err) {
    console.error("Failed to issue cheque:", err);
    toast("Failed to issue cheque: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (btn) btn.disabled = false;
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
      banks.map((a) => `<option value="${a.id}" data-currency="${a.currency}">${a.account_name} (${a.currency}) - Bal: ${a.currency === 'EGP' ? 'E£' : '$'}${Number(a.current_balance || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</option>`).join("");
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
    { id: "withdrawSourceAccountId", label: "Source Bank Account" },
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
window.updateChequeStatusAction = updateChequeStatusAction;
window.openIssueChequeModal = openIssueChequeModal;
window.closeIssueChequeModal = closeIssueChequeModal;
window.onChequeAccountSelected = onChequeAccountSelected;
window.onChequePurposeChanged = onChequePurposeChanged;
window.saveIssueCheque = saveIssueCheque;
window.openWithdrawCashModal = openWithdrawCashModal;
window.closeWithdrawCashModal = closeWithdrawCashModal;
window.onWithdrawSourceAccountSelected = onWithdrawSourceAccountSelected;
window.saveWithdrawCash = saveWithdrawCash;

