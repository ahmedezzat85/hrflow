// ==========================================
// 5. Company Bank & Cash Accounts & Lookups (Phase 0 & 1)
// ==========================================
let _currentFinanceSubTab = "accounts";
let _currentBankAccountFilter = "all";

function switchFinanceAccountsSubTab(tabName, btn) {
  _currentFinanceSubTab = tabName;

  const tabs = document.querySelectorAll("#financeAccountsSubNav .filter-tab");
  tabs.forEach((t) => {
    t.classList.remove("active");
    t.setAttribute("aria-selected", "false");
    t.setAttribute("tabindex", "-1");
  });
  const activeEl = btn || document.getElementById(
    tabName === "accounts" ? "subtabFinanceAccounts" :
    tabName === "statements" ? "subtabFinanceStatements" :
    tabName === "cheques" ? "subtabFinanceCheques" :
    tabName === "transfers" ? "subtabFinanceTransfers" :
    tabName === "categories" ? "subtabFinanceCategories" : "subtabFinancePaymentTypes"
  );
  if (activeEl) {
    activeEl.classList.add("active");
    activeEl.setAttribute("aria-selected", "true");
    activeEl.setAttribute("tabindex", "0");
  }

  const paneAccounts = document.getElementById("financeSubPaneAccounts");
  const paneStatements = document.getElementById("financeSubPaneStatements");
  const paneCheques = document.getElementById("financeSubPaneCheques");
  const paneTransfers = document.getElementById("financeSubPaneTransfers");
  const paneCategories = document.getElementById("financeSubPaneCategories");
  const panePaymentTypes = document.getElementById("financeSubPanePaymentTypes");

  if (paneAccounts) paneAccounts.style.display = tabName === "accounts" ? "block" : "none";
  if (paneStatements) paneStatements.style.display = tabName === "statements" ? "block" : "none";
  if (paneCheques) paneCheques.style.display = tabName === "cheques" ? "block" : "none";
  if (paneTransfers) paneTransfers.style.display = tabName === "transfers" ? "block" : "none";
  if (paneCategories) paneCategories.style.display = tabName === "categories" ? "block" : "none";
  if (panePaymentTypes) panePaymentTypes.style.display = tabName === "payment_types" ? "block" : "none";

  if (tabName === "accounts") {
    loadFinanceAccounts();
  } else if (tabName === "statements") {
    loadFinanceStatements();
  } else if (tabName === "cheques") {
    loadFinanceCheques();
  } else if (tabName === "transfers") {
    loadFinanceTransfers();
  } else if (tabName === "categories") {
    loadFinanceCategories();
  } else if (tabName === "payment_types") {
    loadFinancePaymentTypes();
  }
}

async function loadFinanceAccounts() {
  const bar = document.getElementById("financeAccountsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    let params = null;
    if (_currentBankAccountFilter === "active") params = { is_active: true };
    else if (_currentBankAccountFilter === "inactive") params = { is_active: false };

    const items = await FinanceApi.getAccounts(params);
    FinanceState.accounts = items;
    renderFinanceAccounts(items);
  } catch (err) {
    console.error("Failed to load company accounts:", err);
    toast("Failed to load company accounts: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterCompanyBankAccounts(filterType, btn) {
  _currentBankAccountFilter = filterType;
  const tabs = document.querySelectorAll("#financeSubPaneAccounts .filter-tabs .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");
  loadFinanceAccounts();
}

function renderFinanceAccounts(items) {
  const tbody = document.getElementById("financeAccountsTableBody");
  const empty = document.getElementById("financeAccountsEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map((acc) => {
      const typeLabel = (acc.account_type || "bank").toUpperCase();
      const isCash = acc.account_type === "cash";
      const bookBal = acc.book_balance !== undefined ? acc.book_balance : acc.current_balance;
      const availBal = acc.available_balance !== undefined ? acc.available_balance : acc.current_balance;
      const recBal = acc.reconciled_balance !== undefined ? acc.reconciled_balance : 0;
      const feedText = acc.last_import_date ? `Feed: ${acc.last_import_date}` : "No feed";
      const recText = acc.last_reconciled_date
        ? `Reconciled: ${acc.last_reconciled_date}`
        : (acc.unreconciled_count ? `Unreconciled (${acc.unreconciled_count})` : "Unreconciled");

      return `
    <tr class="${acc.is_active ? "" : "account-inactive"}">
      <td data-label="Account">
        <div style="font-weight:600;display:flex;align-items:center;gap:6px;min-width:0;word-break:break-word;">
          <i class="fa-solid ${isCash ? "fa-wallet" : "fa-building-columns"}" style="color:var(--text3);flex-shrink:0;"></i>
          <a href="javascript:void(0)" onclick="openAccountWorkspace(${acc.id})" style="font-weight:600;color:var(--accent);text-decoration:none;word-break:break-word;">
            ${acc.account_name}
          </a>
        </div>
        ${acc.bank_name && !isCash ? `<div style="font-size:12px;color:var(--text3);">${acc.bank_name}${acc.country ? ' · ' + acc.country : ''}</div>` : (acc.country ? `<div style="font-size:12px;color:var(--text3);">${acc.country}</div>` : '')}
      </td>
      <td data-label="Type & ID">
        <span class="badge ${isCash ? "badge-info" : "badge-neutral"}">
          ${typeLabel}
        </span>
        <code style="margin-left:4px;font-size:11.5px;">${FinanceFormat.formatMaskedAccountNumber(acc.account_number, isCash)}</code>
      </td>
      <td data-label="Currency"><strong>${acc.currency || "USD"}</strong></td>
      <td data-label="Book Balance" class="cell-money" style="text-align:right;font-weight:700;">
        ${FinanceFormat.renderMoneyHtml(bookBal, acc.currency)}
      </td>
      <td data-label="Available" class="cell-money" style="text-align:right;font-weight:700;color:var(--accent);">
        ${FinanceFormat.renderMoneyHtml(availBal, acc.currency)}
      </td>
      <td data-label="Reconciled" class="cell-money" style="text-align:right;font-weight:700;color:var(--success, #10b981);">
        ${FinanceFormat.renderMoneyHtml(recBal, acc.currency)}
      </td>
      <td data-label="Feed / Rec" style="font-size:11.5px;color:var(--text3);">
        <div><i class="fa-solid fa-cloud-arrow-up" style="font-size:10px;"></i> ${feedText}</div>
        <div style="margin-top:2px;"><i class="fa-solid fa-scale-balanced" style="font-size:10px;"></i> ${recText}</div>
      </td>
      <td data-label="Status" style="text-align:center;">
        <span class="status-led-badge ${acc.is_active ? "status-led-active" : "status-led-inactive"}" title="${acc.is_active ? "Active" : "Inactive"}">
          <span class="led-dot"></span>
          ${acc.is_active ? "Active" : "Inactive"}
        </span>
      </td>
      <td data-label="Actions" class="col-actions">
        <div style="display:flex;gap:6px;align-items:center;flex-wrap:nowrap;justify-content:flex-end;">
          <button class="btn btn-sm btn-fill btn-open-workspace" onclick="openAccountWorkspace(${acc.id})" title="Open Account Workspace" aria-label="Open Account Workspace" style="padding:6px 10px;">
            <i class="fa-solid fa-folder-open"></i>
          </button>
          <button class="btn btn-sm btn-outline" onclick="openEditCompanyBankAccountModal(${acc.id})" title="Edit Account" aria-label="Edit Account" style="padding:6px 10px;">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn btn-sm ${acc.is_active ? "btn-danger" : "btn-outline"}" onclick="toggleCompanyBankAccountActive(${acc.id}, ${acc.is_active})" title="${acc.is_active ? "Deactivate Account" : "Reactivate Account"}" aria-label="${acc.is_active ? "Deactivate Account" : "Reactivate Account"}" style="padding:6px 10px;">
            <i class="fa-solid ${acc.is_active ? "fa-power-off" : "fa-check"}"></i>
          </button>
        </div>
      </td>
    </tr>
  `;
    })
    .join("");
}

function onCompanyAccountTypeChange() {
  const sel = document.getElementById("fCompanyAccountType");
  const type = sel ? sel.value : "bank";
  const bankField = document.getElementById("fCompanyBankNameField");
  const accNumLabel = document.getElementById("fCompanyAccountNumberLabel");
  const bankNameInput = document.getElementById("fCompanyBankName");

  if (type === "cash") {
    if (bankField) bankField.style.display = "none";
    if (accNumLabel) accNumLabel.textContent = "Identifier / Tag (Optional)";
    if (bankNameInput) bankNameInput.placeholder = "e.g. Petty Cash Drawer";
  } else {
    if (bankField) bankField.style.display = "block";
    if (accNumLabel) accNumLabel.textContent = "Account Number / IBAN";
    if (bankNameInput) bankNameInput.placeholder = "e.g. JPMorgan Chase or CIB";
  }
}

function openAddCompanyBankAccountModal() {
  FinanceForm.clearErrors("companyBankAccountModal");
  document.getElementById("companyBankAccountModalTitle").textContent = "Add Company Bank / Cash Account";
  document.getElementById("fCompanyAccountId").value = "";
  document.getElementById("fCompanyAccountName").value = "";
  if (document.getElementById("fCompanyAccountType")) document.getElementById("fCompanyAccountType").value = "bank";
  if (document.getElementById("fCompanyCountry")) document.getElementById("fCompanyCountry").value = "United States";
  document.getElementById("fCompanyBankName").value = "";
  document.getElementById("fCompanyAccountNumber").value = "";
  const currEl = document.getElementById("fCompanyCurrency");
  if (currEl) {
    currEl.value = "USD";
    currEl.disabled = false;
  }
  const currWarn = document.getElementById("fCompanyCurrencyWarning");
  if (currWarn) currWarn.style.display = "none";
  document.getElementById("fCompanyOpeningBalance").value = "0.00";
  document.getElementById("fCompanyOpeningBalanceField").style.display = "block";
  if (document.getElementById("fCompanyOpeningBalanceDate")) {
    document.getElementById("fCompanyOpeningBalanceDate").value = "";
  }
  onCompanyAccountTypeChange();
  openModal("companyBankAccountModal");
}

function openEditCompanyBankAccountModal(id) {
  FinanceForm.clearErrors("companyBankAccountModal");
  const acc = (FinanceState.accounts || []).find((a) => a.id === id);
  if (!acc) return;

  document.getElementById("companyBankAccountModalTitle").textContent = "Edit Company Account";
  document.getElementById("fCompanyAccountId").value = acc.id;
  document.getElementById("fCompanyAccountName").value = acc.account_name;
  if (document.getElementById("fCompanyAccountType")) document.getElementById("fCompanyAccountType").value = acc.account_type || "bank";
  if (document.getElementById("fCompanyCountry")) document.getElementById("fCompanyCountry").value = acc.country || "United States";
  document.getElementById("fCompanyBankName").value = acc.bank_name || "";
  document.getElementById("fCompanyAccountNumber").value = "";
  const maskedAccPlaceholder = FinanceFormat.formatMaskedAccountNumber(acc.account_number, acc.account_type === "cash");
  document.getElementById("fCompanyAccountNumber").placeholder = maskedAccPlaceholder + " (leave blank to keep unchanged)";

  const currEl = document.getElementById("fCompanyCurrency");
  const currWarn = document.getElementById("fCompanyCurrencyWarning");
  if (currEl) {
    currEl.value = acc.currency || "USD";
    if (acc.has_postings) {
      currEl.disabled = true;
      if (currWarn) currWarn.style.display = "block";
    } else {
      currEl.disabled = false;
      if (currWarn) currWarn.style.display = "none";
    }
  }

  document.getElementById("fCompanyOpeningBalanceField").style.display = "none";
  if (document.getElementById("fCompanyOpeningBalanceDate")) {
    document.getElementById("fCompanyOpeningBalanceDate").value = acc.opening_balance_date || "";
  }
  onCompanyAccountTypeChange();
  openModal("companyBankAccountModal");
}

async function saveCompanyBankAccount() {
  const idVal = document.getElementById("fCompanyAccountId").value;
  const account_name = document.getElementById("fCompanyAccountName").value.trim();
  const account_type = document.getElementById("fCompanyAccountType")?.value || "bank";
  const country = document.getElementById("fCompanyCountry")?.value.trim() || null;
  const bank_name = document.getElementById("fCompanyBankName").value.trim();
  const account_number = document.getElementById("fCompanyAccountNumber").value.trim();
  const currency = document.getElementById("fCompanyCurrency").value;
  const opening_balance_date = document.getElementById("fCompanyOpeningBalanceDate")?.value || null;

  const rules = [
    { id: "fCompanyAccountName", label: "Account Name" },
  ];
  if (account_type === "bank") {
    rules.push({ id: "fCompanyBankName", label: "Bank Name" });
    if (!idVal) {
      rules.push({ id: "fCompanyAccountNumber", label: "Account Number" });
    }
  }
  const isValid = FinanceForm.validateRequiredFields("companyBankAccountModal", rules);
  if (!isValid) return;

  const saveBtn = document.getElementById("companyBankAccountSaveBtn");
  if (saveBtn) saveBtn.disabled = true;

  try {
    if (idVal) {
      const payload = { account_name, account_type, country, currency, opening_balance_date };
      if (bank_name || account_type === "cash") payload.bank_name = bank_name || null;
      if (account_number) payload.account_number = account_number;
      await FinanceApi.updateAccount(Number(idVal), payload);
      toast("Account updated successfully", "fa-solid fa-circle-check");
    } else {
      if (!account_number && account_type === "bank") {
        toast("Please provide an Account Number", "fa-solid fa-circle-exclamation");
        if (saveBtn) saveBtn.disabled = false;
        return;
      }
      const finalAccNum = account_number || `CASH-${currency}-${Date.now().toString().slice(-4)}`;
      const opening_balance = parseFloat(document.getElementById("fCompanyOpeningBalance").value) || 0.0;
      const payload = {
        account_name,
        account_type,
        country,
        bank_name: bank_name || (account_type === "cash" ? "Cash Account" : null),
        account_number: finalAccNum,
        currency,
        opening_balance,
        opening_balance_date,
      };
      await FinanceApi.createAccount(payload);
      toast("Account created successfully", "fa-solid fa-circle-check");
    }

    closeModal("companyBankAccountModal");
    await loadFinanceAccounts();
  } catch (err) {
    toast(err.message || "Failed to save account", "fa-solid fa-triangle-exclamation");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function toggleCompanyBankAccountActive(id, currentActive) {
  const acc = (FinanceState.accounts || []).find((a) => a.id === parseInt(id, 10));
  const action = currentActive ? "deactivate" : "reactivate";

  const result = await FinanceCommand.confirmAction({
    title: `${currentActive ? "Deactivate" : "Reactivate"} Bank Account`,
    summary: acc ? `<strong>${acc.account_name}</strong> · ${acc.currency} · Balance: ${FinanceFormat.renderMoneyHtml(acc.current_balance || 0, acc.currency)}` : `Account #${id}`,
    consequence: currentActive
      ? "Deactivating this account will prevent new payments, cheques, or transfers from using it. Existing transaction history remains intact."
      : "Reactivating will restore this account to active payment and ledger selections.",
    actionLabel: currentActive ? "Deactivate Account" : "Reactivate Account",
    actionClass: currentActive ? "btn btn-danger" : "btn btn-primary",
    requireReason: false,
    severity: currentActive ? "warning" : "info",
  });
  if (!result.confirmed) return;

  try {
    if (currentActive) {
      await FinanceApi.deleteAccount(id);
      toast("Account deactivated", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.updateAccount(id, { is_active: true });
      toast("Account reactivated", "fa-solid fa-circle-check");
    }
    await loadFinanceAccounts();
  } catch (err) {
    toast(err.message || `Failed to ${action} account`, "fa-solid fa-triangle-exclamation");
  }
}

// ==========================================
// 5.0 Dedicated Account Workspace (Story 5.1)
// ==========================================
let _activeWorkspaceAccountId = null;
let _activeWorkspaceAccount = null;
let _isWorkspaceAccountNumberRevealed = false;
let _workspaceLedgerDirectionFilter = "all";

async function openAccountWorkspace(accountId, initialTab = "activity") {
  _activeWorkspaceAccountId = accountId;
  _isWorkspaceAccountNumberRevealed = false;

  const paneAccounts = document.getElementById("financeSubPaneAccounts");
  const paneStatements = document.getElementById("financeSubPaneStatements");
  const paneCheques = document.getElementById("financeSubPaneCheques");
  const paneTransfers = document.getElementById("financeSubPaneTransfers");
  const paneCategories = document.getElementById("financeSubPaneCategories");
  const panePaymentTypes = document.getElementById("financeSubPanePaymentTypes");
  const paneLedger = document.getElementById("financeSubPaneLedger");
  const paneWorkspace = document.getElementById("financeSubPaneWorkspace");
  const subNav = document.getElementById("financeAccountsSubNav");

  if (paneAccounts) paneAccounts.style.display = "none";
  if (paneStatements) paneStatements.style.display = "none";
  if (paneCheques) paneCheques.style.display = "none";
  if (paneTransfers) paneTransfers.style.display = "none";
  if (paneCategories) paneCategories.style.display = "none";
  if (panePaymentTypes) panePaymentTypes.style.display = "none";
  if (paneLedger) paneLedger.style.display = "none";
  if (subNav) subNav.style.display = "none";
  if (paneWorkspace) paneWorkspace.style.display = "block";

  try {
    _isWorkspaceAccountNumberRevealed = false;
    const acc = await FinanceApi.getAccount(accountId, { reveal: false });
    _activeWorkspaceAccount = acc;
    renderWorkspaceHeader(acc);
    populateWorkspaceSettings(acc);
    switchWorkspaceTab(initialTab);
  } catch (err) {
    console.error("Failed to open account workspace:", err);
    toast("Failed to load account workspace: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  }
}

function closeAccountWorkspace() {
  _activeWorkspaceAccountId = null;
  _activeWorkspaceAccount = null;
  _isWorkspaceAccountNumberRevealed = false;

  const paneWorkspace = document.getElementById("financeSubPaneWorkspace");
  const paneAccounts = document.getElementById("financeSubPaneAccounts");
  const subNav = document.getElementById("financeAccountsSubNav");

  if (paneWorkspace) paneWorkspace.style.display = "none";
  if (paneAccounts) paneAccounts.style.display = "block";
  if (subNav) subNav.style.display = "flex";

  loadFinanceAccounts();
}

function renderWorkspaceHeader(acc) {
  if (!acc) return;

  const nameEl = document.getElementById("workspaceAccountName");
  const typeBadge = document.getElementById("workspaceAccountTypeBadge");
  const statusBadge = document.getElementById("workspaceAccountStatusBadge");
  const instEl = document.getElementById("workspaceAccountInstitution");
  const countryEl = document.getElementById("workspaceAccountCountry");
  const idEl = document.getElementById("workspaceAccountIdentifier");
  const revBtn = document.getElementById("btnRevealAccountNumber");

  if (nameEl) nameEl.textContent = acc.account_name;
  if (typeBadge) {
    typeBadge.textContent = (acc.account_type || "bank").toUpperCase();
    typeBadge.className = `badge ${acc.account_type === "cash" ? "badge-info" : "badge-neutral"}`;
  }
  if (statusBadge) {
    statusBadge.innerHTML = `<span class="led-dot"></span> ${acc.is_active ? "Active" : "Inactive"}`;
    statusBadge.className = `status-led-badge ${acc.is_active ? "status-led-active" : "status-led-inactive"}`;
  }
  if (instEl) {
    instEl.innerHTML = `<i class="fa-solid ${acc.account_type === "cash" ? "fa-wallet" : "fa-building-columns"}"></i> ${acc.bank_name || (acc.account_type === "cash" ? "Cash Custody" : "Bank")}`;
  }
  if (countryEl) {
    countryEl.innerHTML = `<i class="fa-solid fa-globe"></i> ${acc.country || "Global"}`;
  }
  if (idEl) {
    idEl.textContent = _isWorkspaceAccountNumberRevealed
      ? acc.account_number
      : FinanceFormat.formatMaskedAccountNumber(acc.account_number, acc.account_type === "cash");
  }
  if (revBtn) {
    revBtn.innerHTML = '<i class="fa-solid fa-eye"></i> Reveal';
  }

  const bookBal = acc.book_balance !== undefined ? acc.book_balance : acc.current_balance;
  const availBal = acc.available_balance !== undefined ? acc.available_balance : acc.current_balance;
  const bankBal = acc.bank_balance !== undefined ? acc.bank_balance : acc.current_balance;
  const recBal = acc.reconciled_balance !== undefined ? acc.reconciled_balance : 0;

  const bookEl = document.getElementById("workspaceBookBalance");
  const bookAsOfEl = document.getElementById("workspaceBookBalanceAsOf");
  const availEl = document.getElementById("workspaceAvailableBalance");
  const availSubEl = document.getElementById("workspaceAvailableBalanceSub");
  const bankEl = document.getElementById("workspaceBankBalance");
  const bankImportEl = document.getElementById("workspaceLastImportStatus");
  const recEl = document.getElementById("workspaceReconciledBalance");
  const recStatusEl = document.getElementById("workspaceLastReconciledStatus");

  if (bookEl) bookEl.innerHTML = FinanceFormat.renderMoneyHtml(bookBal, acc.currency);
  if (bookAsOfEl) bookAsOfEl.textContent = `As of: ${acc.balance_as_of || "Today"}`;

  if (availEl) availEl.innerHTML = FinanceFormat.renderMoneyHtml(availBal, acc.currency);
  if (availSubEl) availSubEl.textContent = (acc.balance_definitions && acc.balance_definitions.available_balance) || "Liquid after uncleared cheques";

  if (bankEl) bankEl.innerHTML = FinanceFormat.renderMoneyHtml(bankBal, acc.currency);
  if (bankImportEl) bankImportEl.textContent = `Last feed: ${acc.last_import_date || "None"}`;

  if (recEl) recEl.innerHTML = FinanceFormat.renderMoneyHtml(recBal, acc.currency);
  if (recStatusEl) recStatusEl.textContent = `Last reconciled: ${acc.last_reconciled_date || "Never"}`;
}

async function revealWorkspaceAccountNumber() {
  if (!_activeWorkspaceAccountId) return;
  const idEl = document.getElementById("workspaceAccountIdentifier");
  const btn = document.getElementById("btnRevealAccountNumber");

  try {
    if (!_isWorkspaceAccountNumberRevealed) {
      const acc = await FinanceApi.getAccount(_activeWorkspaceAccountId, { reveal: true });
      if (idEl) idEl.textContent = acc.account_number;
      if (btn) btn.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Conceal';
      _isWorkspaceAccountNumberRevealed = true;
    } else {
      const acc = await FinanceApi.getAccount(_activeWorkspaceAccountId, { reveal: false });
      if (idEl) idEl.textContent = FinanceFormat.formatMaskedAccountNumber(acc.account_number, acc.account_type === "cash");
      if (btn) btn.innerHTML = '<i class="fa-solid fa-eye"></i> Reveal';
      _isWorkspaceAccountNumberRevealed = false;
    }
  } catch (err) {
    console.error("Reveal error:", err);
    toast(err.message || "Unauthorized to reveal account number", "fa-solid fa-lock");
  }
}

function switchWorkspaceTab(tabName, btn) {
  const tabs = ["activity", "reconcile", "statements", "details"];
  tabs.forEach((t) => {
    const tabBtn = document.getElementById(`tabWs${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (tabBtn) {
      tabBtn.classList.remove("active");
      tabBtn.setAttribute("aria-selected", "false");
      tabBtn.setAttribute("tabindex", "-1");
    }
    const pane = document.getElementById(`workspacePane${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (pane) pane.style.display = (t === tabName ? "block" : "none");
  });

  const activeBtn = btn || document.getElementById(`tabWs${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`);
  if (activeBtn) {
    activeBtn.classList.add("active");
    activeBtn.setAttribute("aria-selected", "true");
    activeBtn.setAttribute("tabindex", "0");
  }

  if (tabName === "activity") {
    loadWorkspaceActivity();
  } else if (tabName === "statements") {
    loadWorkspaceStatements();
  } else if (tabName === "reconcile") {
    loadWorkspaceReconcile();
  }
}

function populateWorkspaceSettings(acc) {
  if (!acc) return;
  const nameInput = document.getElementById("wsSettingAccountName");
  const typeSelect = document.getElementById("wsSettingAccountType");
  const countrySelect = document.getElementById("wsSettingCountry");
  const bankInput = document.getElementById("wsSettingBankName");
  const currSelect = document.getElementById("wsSettingCurrency");
  const dateInput = document.getElementById("wsSettingOpeningDate");
  const currLock = document.getElementById("wsSettingCurrencyLockNotice");

  if (nameInput) nameInput.value = acc.account_name || "";
  if (typeSelect) typeSelect.value = acc.account_type || "bank";
  if (countrySelect) countrySelect.value = acc.country || "United States";
  if (bankInput) bankInput.value = acc.bank_name || "";
  if (currSelect) currSelect.value = acc.currency || "USD";
  if (dateInput) dateInput.value = acc.opening_balance_date || "";

  if (acc.has_postings) {
    if (currSelect) currSelect.disabled = true;
    if (currLock) currLock.style.display = "block";
  } else {
    if (currSelect) currSelect.disabled = false;
    if (currLock) currLock.style.display = "none";
  }
}

async function saveWorkspaceAccountSettings() {
  if (!_activeWorkspaceAccountId) return;
  const btn = document.getElementById("btnSaveWsSettings");
  if (btn) btn.disabled = true;

  try {
    const account_name = document.getElementById("wsSettingAccountName").value.trim();
    const account_type = document.getElementById("wsSettingAccountType").value;
    const country = document.getElementById("wsSettingCountry").value;
    const bank_name = document.getElementById("wsSettingBankName").value.trim();
    const currency = document.getElementById("wsSettingCurrency").value;
    const opening_balance_date = document.getElementById("wsSettingOpeningDate").value || null;

    if (!account_name) {
      toast("Account name is required", "fa-solid fa-triangle-exclamation");
      return;
    }

    const payload = {
      account_name,
      account_type,
      country,
      bank_name: bank_name || (account_type === "cash" ? "Cash Account" : null),
      currency,
      opening_balance_date,
    };

    await FinanceApi.updateAccount(_activeWorkspaceAccountId, payload);
    toast("Account settings saved successfully", "fa-solid fa-circle-check");
    await openAccountWorkspace(_activeWorkspaceAccountId, "details");
  } catch (err) {
    console.error("Failed to save account settings:", err);
    toast(err.message || "Failed to save settings", "fa-solid fa-triangle-exclamation");
  } finally {
    if (btn) btn.disabled = false;
  }
}

function workspaceRecordTransaction() {
  if (_activeWorkspaceAccountId) {
    _currentLedgerAccountId = _activeWorkspaceAccountId;
    openAddFinanceTransactionModal();
  }
}

function workspaceTransfer() {
  if (_activeWorkspaceAccountId) {
    openRecordFinanceTransferModal(_activeWorkspaceAccountId);
  } else {
    openRecordFinanceTransferModal();
  }
}

function workspaceImportStatement() {
  if (_activeWorkspaceAccountId) {
    openUploadStatementModal(_activeWorkspaceAccountId);
  } else {
    openUploadStatementModal();
  }
}

async function loadWorkspaceActivity() {
  if (!_activeWorkspaceAccountId) return;
  const bar = document.getElementById("workspaceLedgerLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    await _populateWorkspaceFilterDropdowns();
    const params = {};
    const dateFrom = document.getElementById("workspaceLedgerDateFrom")?.value;
    const dateTo = document.getElementById("workspaceLedgerDateTo")?.value;
    const catId = document.getElementById("workspaceLedgerCategoryFilter")?.value;
    const ptId = document.getElementById("workspaceLedgerPaymentTypeFilter")?.value;

    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (catId) params.category_id = catId;
    if (ptId) params.payment_type_id = ptId;
    if (_workspaceLedgerDirectionFilter && _workspaceLedgerDirectionFilter !== "all") {
      params.direction = _workspaceLedgerDirectionFilter;
    }

    const items = await FinanceApi.getAccountTransactions(_activeWorkspaceAccountId, params);
    renderWorkspaceLedger(items);
  } catch (err) {
    console.error("Failed to load workspace ledger activity:", err);
  } finally {
    if (bar) bar.style.display = "none";
  }
}

async function _populateWorkspaceFilterDropdowns() {
  try {
    if (!FinanceState.categories || !FinanceState.categories.length) {
      FinanceState.categories = await FinanceApi.getCategories();
    }
    if (!FinanceState.paymentTypes || !FinanceState.paymentTypes.length) {
      FinanceState.paymentTypes = await FinanceApi.getPaymentTypes();
    }

    const catSel = document.getElementById("workspaceLedgerCategoryFilter");
    if (catSel && catSel.options.length <= 1) {
      catSel.innerHTML = '<option value="">All Categories</option>' +
        (FinanceState.categories || [])
          .map((c) => `<option value="${c.id}">${c.name}${c.is_petty ? " (Petty)" : ""}</option>`)
          .join("");
    }

    const ptSel = document.getElementById("workspaceLedgerPaymentTypeFilter");
    if (ptSel && ptSel.options.length <= 1) {
      ptSel.innerHTML = '<option value="">All Payment Types</option>' +
        (FinanceState.paymentTypes || [])
          .map((p) => `<option value="${p.id}">${p.name} (${p.code})</option>`)
          .join("");
    }
  } catch (_) {}
}

function filterWorkspaceLedger() {
  loadWorkspaceActivity();
}

function filterWorkspaceLedgerDirection(direction, btn) {
  _workspaceLedgerDirectionFilter = direction;
  const tabs = document.querySelectorAll("#workspacePaneActivity .filter-tabs .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");
  loadWorkspaceActivity();
}

function renderWorkspaceLedger(items) {
  const tbody = document.getElementById("workspaceLedgerTableBody");
  const empty = document.getElementById("workspaceLedgerEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  const acc = _activeWorkspaceAccount;
  const symbol = acc && acc.currency === "EGP" ? "E£" : "$";

  tbody.innerHTML = items
    .map((tx) => {
      const isIn = tx.direction === "in";
      const inDisplay = isIn ? `<strong style="color:var(--success);">${symbol}${Number(tx.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>` : "—";
      const outDisplay = !isIn ? `<strong style="color:var(--danger);">${symbol}${Number(tx.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>` : "—";

      let fxDisplay = "—";
      if (tx.fx_rate) {
        const eqCurr = tx.currency === "USD" ? "EGP" : "USD";
        const eqSym = eqCurr === "EGP" ? "E£" : "$";
        const eqVal = tx.fx_equivalent ? `${eqSym}${Number(tx.fx_equivalent).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "";
        fxDisplay = `<span style="font-size:11px;color:var(--text3);" title="Exchange Rate applied">@ ${tx.fx_rate} <br><strong>${eqVal}</strong></span>`;
      }

      const isManual = tx.source === "manual";
      const actionsHtml = isManual
        ? `<div style="display:flex;gap:4px;justify-content:center;">
             <button class="btn btn-sm" onclick="openEditFinanceTransactionModal(${tx.id})" title="Edit Transaction"><i class="fa-solid fa-pen"></i></button>
             <button class="btn btn-sm btn-danger" onclick="confirmDeleteFinanceTransaction(${tx.id})" title="Void / Delete Transaction"><i class="fa-solid fa-trash"></i></button>
           </div>`
        : `<span class="badge badge-info" title="System-generated from ${tx.source}"><i class="fa-solid fa-lock"></i> ${(tx.source || '').replace('_', ' ').toUpperCase()}</span>`;

      return `
        <tr>
          <td data-label="Date"><span style="font-family:monospace;font-size:12px;">${tx.date}</span></td>
          <td data-label="Category"><span class="badge ${_categoryKindBadge(tx.category_name ? 'cost' : 'other')}">${tx.category_name || "Uncategorized"}</span></td>
          <td data-label="Payment Type"><span class="badge badge-pending"><code>${tx.payment_type_code || "—"}</code></span></td>
          <td data-label="Reference"><span style="font-size:12px;">${tx.reference || "—"}</span></td>
          <td data-label="Description"><span style="font-size:12px;color:var(--text2);">${tx.description || "—"}</span></td>
          <td data-label="In (+)" class="cell-money" style="text-align:right;">${inDisplay}</td>
          <td data-label="Out (-)" class="cell-money" style="text-align:right;">${outDisplay}</td>
          <td data-label="Rate / Equiv" style="text-align:right;">${fxDisplay}</td>
          <td data-label="Balance" class="cell-money" style="text-align:right;"><strong>${symbol}${Number(tx.running_balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
          <td data-label="Actions" class="col-actions" style="text-align:center;">${actionsHtml}</td>
        </tr>
      `;
    })
    .join("");
}

async function loadWorkspaceStatements() {
  if (!_activeWorkspaceAccountId) return;
  const tbody = document.getElementById("workspaceStatementsTableBody");
  const empty = document.getElementById("workspaceStatementsEmpty");
  if (!tbody) return;

  try {
    const list = await FinanceApi.listAccountStatements(_activeWorkspaceAccountId);
    if (!list || list.length === 0) {
      tbody.innerHTML = "";
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    tbody.innerHTML = list
      .map(
        (s) => `
      <tr>
        <td data-label="Period"><strong>${s.period_month || "—"}</strong></td>
        <td data-label="File Name"><i class="fa-regular fa-file-lines" style="color:var(--text3);margin-right:4px;"></i> ${s.file_name || s.filename || "Statement"}</td>
        <td data-label="Total Lines">${s.lines_count || s.total_lines || 0}</td>
        <td data-label="Matched">${s.matched_lines || s.resolved_lines || 0}</td>
        <td data-label="Status"><span class="badge ${s.status === 'reconciled' ? 'badge-approved' : 'badge-pending'}">${(s.status || 'PENDING').toUpperCase()}</span></td>
        <td data-label="Uploaded At" style="font-size:12px;color:var(--text3);">${s.created_at ? s.created_at.slice(0, 10) : '—'}</td>
        <td data-label="Actions" class="col-actions" style="text-align:center;">
          <button class="btn btn-sm btn-outline" onclick="switchWorkspaceTab('reconcile')">
            <i class="fa-solid fa-scale-balanced"></i> Reconcile
          </button>
        </td>
      </tr>
    `
      )
      .join("");
  } catch (err) {
    console.error("Failed to load workspace statements:", err);
  }
}

async function loadWorkspaceReconcile() {
  if (!_activeWorkspaceAccountId) return;
  const container = document.getElementById("workspaceReconcileContent");
  if (!container) return;

  try {
    const list = await FinanceApi.listAccountStatements(_activeWorkspaceAccountId);
    const pendingStmt = (list || []).find((s) => s.status !== "reconciled");
    if (pendingStmt && typeof openReconciliationForStatement === "function") {
      container.innerHTML = `
        <div style="margin-bottom:14px; padding:12px 16px; background:var(--surface2); border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <strong>Active Statement Period: ${pendingStmt.period_month}</strong>
            <div style="font-size:12px; color:var(--text3);">${pendingStmt.file_name || "Bank Statement"} · ${pendingStmt.lines_count || 0} lines</div>
          </div>
          <button class="btn btn-sm btn-fill" onclick="openReconciliationForStatement(${pendingStmt.id})">
            <i class="fa-solid fa-play"></i> Open Matcher
          </button>
        </div>
        <div id="workspaceReconcileRunner"></div>
      `;
    } else {
      container.innerHTML = `
        <div class="empty-state" style="padding:2.5rem 1rem;">
          <i class="fa-solid fa-check-double" style="font-size:2rem; color:var(--success, #10b981); margin-bottom:10px;"></i>
          <h4>Account In Balance</h4>
          <p style="color:var(--text3); font-size:13px; max-width:480px; margin:0 auto 14px auto;">
            All recent statement lines have been matched with ledger transactions or no pending statements require review.
          </p>
          <button class="btn btn-outline btn-sm" onclick="switchWorkspaceTab('statements')"><i class="fa-solid fa-file-invoice"></i> View Imported Statements</button>
        </div>
      `;
    }
  } catch (err) {
    console.error("Failed to load reconcile view:", err);
  }
}

// ==========================================
// 5.1 Transaction Categories (Phase 0)
// ==========================================
let _currentCategoryStatusFilter = "all";
let _currentCategoryKindFilter = "all";

async function loadFinanceCategories() {
  const bar = document.getElementById("financeCategoriesLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    let params = {};
    if (_currentCategoryStatusFilter === "active") params.is_active = true;
    else if (_currentCategoryStatusFilter === "inactive") params.is_active = false;
    if (_currentCategoryKindFilter && _currentCategoryKindFilter !== "all") params.kind = _currentCategoryKindFilter;

    const items = await FinanceApi.getCategories(params);
    FinanceState.categories = items;

    let filtered = items;
    if (_currentCategoryStatusFilter === "petty") {
      filtered = items.filter((c) => c.is_petty);
    }
    renderFinanceCategories(filtered);
  } catch (err) {
    console.error("Failed to load categories:", err);
    toast("Failed to load categories: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterFinanceCategories(filterType, btn) {
  _currentCategoryStatusFilter = filterType;
  const tabs = document.querySelectorAll("#financeSubPaneCategories .filter-tabs .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");
  loadFinanceCategories();
}

function filterFinanceCategoriesByKind(kind) {
  _currentCategoryKindFilter = kind;
  loadFinanceCategories();
}

function _categoryKindBadge(kind) {
  switch (kind) {
    case "revenue": return "badge-approved";
    case "cost": return "badge-rejected";
    case "transfer": return "badge-info";
    default: return "badge-pending";
  }
}

function renderFinanceCategories(items) {
  const tbody = document.getElementById("financeCategoriesTableBody");
  const empty = document.getElementById("financeCategoriesEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map(
      (c) => `
    <tr>
      <td><span style="color:var(--text3);font-size:12px;">${c.sort_order ?? 0}</span></td>
      <td><strong>${c.name}</strong></td>
      <td><span class="badge ${_categoryKindBadge(c.kind)}">${(c.kind || "other").toUpperCase()}</span></td>
      <td>
        ${c.is_petty
          ? '<span class="badge badge-info"><i class="fa-solid fa-receipt"></i> Petty / Recurring</span>'
          : '<span style="color:var(--text3);font-size:12px;">Standard</span>'
        }
      </td>
      <td><span class="badge ${c.is_active ? "badge-approved" : "badge-rejected"}">${c.is_active ? "ACTIVE" : "INACTIVE"}</span></td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm" onclick="openEditFinanceCategoryModal(${c.id})" title="Edit Category">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn btn-sm ${c.is_active ? "btn-danger" : "btn-fill"}" onclick="toggleFinanceCategoryActive(${c.id}, ${c.is_active})" title="${c.is_active ? "Deactivate Category" : "Reactivate Category"}">
            <i class="fa-solid ${c.is_active ? "fa-power-off" : "fa-check"}"></i>
          </button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");
}

function openAddFinanceCategoryModal() {
  FinanceForm.clearErrors("financeCategoryModal");
  document.getElementById("financeCategoryModalTitle").textContent = "Add Transaction Category";
  document.getElementById("fFinanceCategoryId").value = "";
  document.getElementById("fFinanceCategoryName").value = "";
  document.getElementById("fFinanceCategoryKind").value = "cost";
  document.getElementById("fFinanceCategorySortOrder").value = "0";
  document.getElementById("fFinanceCategoryIsPetty").checked = false;
  openModal("financeCategoryModal");
}

function openEditFinanceCategoryModal(id) {
  FinanceForm.clearErrors("financeCategoryModal");
  const cat = (FinanceState.categories || []).find((c) => c.id === id);
  if (!cat) return;

  document.getElementById("financeCategoryModalTitle").textContent = "Edit Transaction Category";
  document.getElementById("fFinanceCategoryId").value = cat.id;
  document.getElementById("fFinanceCategoryName").value = cat.name;
  document.getElementById("fFinanceCategoryKind").value = cat.kind || "cost";
  document.getElementById("fFinanceCategorySortOrder").value = cat.sort_order ?? 0;
  document.getElementById("fFinanceCategoryIsPetty").checked = Boolean(cat.is_petty);
  openModal("financeCategoryModal");
}

async function saveFinanceCategory() {
  const idVal = document.getElementById("fFinanceCategoryId").value;
  const name = document.getElementById("fFinanceCategoryName").value.trim();
  const kind = document.getElementById("fFinanceCategoryKind").value;
  const sort_order = parseInt(document.getElementById("fFinanceCategorySortOrder").value, 10) || 0;
  const is_petty = document.getElementById("fFinanceCategoryIsPetty").checked;

  const isValid = FinanceForm.validateRequiredFields("financeCategoryModal", [
    { id: "fFinanceCategoryName", label: "Category Name" }
  ]);
  if (!isValid) return;

  const saveBtn = document.getElementById("financeCategorySaveBtn");
  if (saveBtn) saveBtn.disabled = true;

  try {
    if (idVal) {
      await FinanceApi.updateCategory(Number(idVal), { name, kind, sort_order, is_petty });
      toast("Category updated successfully", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.createCategory({ name, kind, sort_order, is_petty, is_active: true });
      toast("Category created successfully", "fa-solid fa-circle-check");
    }
    closeModal("financeCategoryModal");
    await loadFinanceCategories();
  } catch (err) {
    toast(err.message || "Failed to save category", "fa-solid fa-triangle-exclamation");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function toggleFinanceCategoryActive(id, currentActive) {
  const cat = (FinanceState.categories || []).find((c) => c.id === parseInt(id, 10));
  const action = currentActive ? "deactivate" : "reactivate";

  const result = await FinanceCommand.confirmAction({
    title: `${currentActive ? "Deactivate" : "Reactivate"} Category`,
    summary: cat ? `<strong>${cat.name}</strong> (${cat.kind})` : `Category #${id}`,
    consequence: currentActive
      ? "Deactivating this category will hide it from new transaction forms. Deactivated categories remain on historical records."
      : "Reactivating will make this category available again for new transactions.",
    actionLabel: currentActive ? "Deactivate Category" : "Reactivate Category",
    actionClass: currentActive ? "btn btn-danger" : "btn btn-primary",
    requireReason: false,
    severity: currentActive ? "warning" : "info",
  });
  if (!result.confirmed) return;

  try {
    if (currentActive) {
      await FinanceApi.deleteCategory(id);
      toast("Category deactivated", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.updateCategory(id, { is_active: true });
      toast("Category reactivated", "fa-solid fa-circle-check");
    }
    await loadFinanceCategories();
  } catch (err) {
    toast(err.message || `Failed to ${action} category`, "fa-solid fa-triangle-exclamation");
  }
}

// ==========================================
// 5.2 Payment Types (Phase 0)
// ==========================================
let _currentPaymentTypeStatusFilter = "all";

async function loadFinancePaymentTypes() {
  const bar = document.getElementById("financePaymentTypesLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    let params = {};
    if (_currentPaymentTypeStatusFilter === "active") params.is_active = true;
    else if (_currentPaymentTypeStatusFilter === "inactive") params.is_active = false;

    const items = await FinanceApi.getPaymentTypes(params);
    FinanceState.paymentTypes = items;
    renderFinancePaymentTypes(items);
  } catch (err) {
    console.error("Failed to load payment types:", err);
    toast("Failed to load payment types: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterFinancePaymentTypes(filterType, btn) {
  _currentPaymentTypeStatusFilter = filterType;
  const tabs = document.querySelectorAll("#financeSubPanePaymentTypes .filter-tabs .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");
  loadFinancePaymentTypes();
}

function renderFinancePaymentTypes(items) {
  const tbody = document.getElementById("financePaymentTypesTableBody");
  const empty = document.getElementById("financePaymentTypesEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map(
      (pt) => `
    <tr>
      <td><strong>${pt.name}</strong></td>
      <td><code>${pt.code}</code></td>
      <td>
        ${pt.requires_cheque_number
          ? '<span class="badge badge-pending"><i class="fa-solid fa-money-check"></i> Cheque #</span>'
          : '<span style="color:var(--text3);font-size:12px;">No</span>'
        }
      </td>
      <td>
        ${pt.requires_bank_fee_flag
          ? '<span class="badge badge-pending"><i class="fa-solid fa-receipt"></i> Bank Fee</span>'
          : '<span style="color:var(--text3);font-size:12px;">No</span>'
        }
      </td>
      <td><span class="badge ${pt.is_active ? "badge-approved" : "badge-rejected"}">${pt.is_active ? "ACTIVE" : "INACTIVE"}</span></td>
      <td>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-sm" onclick="openEditFinancePaymentTypeModal(${pt.id})" title="Edit Payment Type">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <button class="btn btn-sm ${pt.is_active ? "btn-danger" : "btn-fill"}" onclick="toggleFinancePaymentTypeActive(${pt.id}, ${pt.is_active})" title="${pt.is_active ? "Deactivate Payment Type" : "Reactivate Payment Type"}">
            <i class="fa-solid ${pt.is_active ? "fa-power-off" : "fa-check"}"></i>
          </button>
        </div>
      </td>
    </tr>
  `
    )
    .join("");
}

function openAddFinancePaymentTypeModal() {
  FinanceForm.clearErrors("financePaymentTypeModal");
  document.getElementById("financePaymentTypeModalTitle").textContent = "Add Payment Type";
  document.getElementById("fFinancePaymentTypeId").value = "";
  document.getElementById("fFinancePaymentTypeName").value = "";
  document.getElementById("fFinancePaymentTypeCode").value = "";
  document.getElementById("fFinancePaymentTypeCode").disabled = false;
  document.getElementById("fFinancePaymentTypeReqCheque").checked = false;
  document.getElementById("fFinancePaymentTypeReqBankFee").checked = false;
  openModal("financePaymentTypeModal");
}

function openEditFinancePaymentTypeModal(id) {
  FinanceForm.clearErrors("financePaymentTypeModal");
  const pt = (FinanceState.paymentTypes || []).find((p) => p.id === id);
  if (!pt) return;

  document.getElementById("financePaymentTypeModalTitle").textContent = "Edit Payment Type";
  document.getElementById("fFinancePaymentTypeId").value = pt.id;
  document.getElementById("fFinancePaymentTypeName").value = pt.name;
  document.getElementById("fFinancePaymentTypeCode").value = pt.code;
  document.getElementById("fFinancePaymentTypeReqCheque").checked = Boolean(pt.requires_cheque_number);
  document.getElementById("fFinancePaymentTypeReqBankFee").checked = Boolean(pt.requires_bank_fee_flag);
  openModal("financePaymentTypeModal");
}

async function saveFinancePaymentType() {
  const idVal = document.getElementById("fFinancePaymentTypeId").value;
  const name = document.getElementById("fFinancePaymentTypeName").value.trim();
  const code = document.getElementById("fFinancePaymentTypeCode").value.trim().toUpperCase();
  const requires_cheque_number = document.getElementById("fFinancePaymentTypeReqCheque").checked;
  const requires_bank_fee_flag = document.getElementById("fFinancePaymentTypeReqBankFee").checked;

  const isValid = FinanceForm.validateRequiredFields("financePaymentTypeModal", [
    { id: "fFinancePaymentTypeName", label: "Payment Type Name" },
    { id: "fFinancePaymentTypeCode", label: "Payment Type Code" }
  ]);
  if (!isValid) return;

  const saveBtn = document.getElementById("financePaymentTypeSaveBtn");
  if (saveBtn) saveBtn.disabled = true;

  try {
    if (idVal) {
      await FinanceApi.updatePaymentType(Number(idVal), { name, code, requires_cheque_number, requires_bank_fee_flag });
      toast("Payment type updated successfully", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.createPaymentType({ name, code, requires_cheque_number, requires_bank_fee_flag, is_active: true });
      toast("Payment type created successfully", "fa-solid fa-circle-check");
    }
    closeModal("financePaymentTypeModal");
    await loadFinancePaymentTypes();
  } catch (err) {
    toast(err.message || "Failed to save payment type", "fa-solid fa-triangle-exclamation");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function toggleFinancePaymentTypeActive(id, currentActive) {
  const pt = (FinanceState.paymentTypes || []).find((p) => p.id === parseInt(id, 10));
  const action = currentActive ? "deactivate" : "reactivate";

  const result = await FinanceCommand.confirmAction({
    title: `${currentActive ? "Deactivate" : "Reactivate"} Payment Type`,
    summary: pt ? `<strong>${pt.name}</strong> (${pt.code})` : `Payment Type #${id}`,
    consequence: currentActive
      ? "Deactivating this payment type will hide it from new transaction forms. Historical records are preserved."
      : "Reactivating will restore this payment type to active form dropdowns.",
    actionLabel: currentActive ? "Deactivate Payment Type" : "Reactivate Payment Type",
    actionClass: currentActive ? "btn btn-danger" : "btn btn-primary",
    requireReason: false,
    severity: currentActive ? "warning" : "info",
  });
  if (!result.confirmed) return;

  try {
    if (currentActive) {
      await FinanceApi.deletePaymentType(id);
      toast("Payment type deactivated", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.updatePaymentType(id, { is_active: true });
      toast("Payment type reactivated", "fa-solid fa-circle-check");
    }
    await loadFinancePaymentTypes();
  } catch (err) {
    toast(err.message || `Failed to ${action} payment type`, "fa-solid fa-triangle-exclamation");
  }
}

// ==========================================
// 5.3 Continuous Ledger & Petty Spend (Phase 2)
// ==========================================
let _currentLedgerAccountId = null;
let _currentLedgerDirectionFilter = "all";
let _isPettyLedgerOnly = false;

async function viewAccountLedger(accountId) {
  _currentLedgerAccountId = accountId;
  _currentLedgerDirectionFilter = "all";
  _isPettyLedgerOnly = false;

  const subNav = document.getElementById("financeAccountsSubNav");
  if (subNav) subNav.style.display = "none";

  const paneAccounts = document.getElementById("financeSubPaneAccounts");
  const paneCategories = document.getElementById("financeSubPaneCategories");
  const panePaymentTypes = document.getElementById("financeSubPanePaymentTypes");
  const paneLedger = document.getElementById("financeSubPaneLedger");

  if (paneAccounts) paneAccounts.style.display = "none";
  if (paneCategories) paneCategories.style.display = "none";
  if (panePaymentTypes) panePaymentTypes.style.display = "none";
  if (paneLedger) paneLedger.style.display = "block";

  // Populate account header details
  const acc = (FinanceState.accounts || []).find((a) => a.id === accountId);
  if (acc) {
    const nameEl = document.getElementById("financeLedgerAccountName");
    const metaEl = document.getElementById("financeLedgerAccountMeta");
    const balEl = document.getElementById("financeLedgerCurrentBalance");
    if (nameEl) nameEl.textContent = `${acc.account_name} — Ledger`;
    if (metaEl) {
      const typeLabel = (acc.account_type || "bank").toUpperCase();
      const institution = acc.bank_name || "Cash Custody";
      const maskedNum = FinanceFormat.formatMaskedAccountNumber(acc.account_number, acc.account_type === "cash");
  metaEl.textContent = `${typeLabel} · ${institution} · ${acc.currency} · ${maskedNum}`;
    }
    if (balEl) {
      const symbol = acc.currency === "EGP" ? "E£" : "$";
      balEl.textContent = `${symbol}${Number(acc.current_balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    }
  }

  // Populate categories and payment types dropdowns in filter
  await _populateLedgerFilterDropdowns();

  // Reset filter inputs
  const dateFrom = document.getElementById("financeLedgerDateFrom");
  const dateTo = document.getElementById("financeLedgerDateTo");
  const catFilter = document.getElementById("financeLedgerCategoryFilter");
  const ptFilter = document.getElementById("financeLedgerPaymentTypeFilter");
  if (dateFrom) dateFrom.value = "";
  if (dateTo) dateTo.value = "";
  if (catFilter) catFilter.value = "";
  if (ptFilter) ptFilter.value = "";

  const dirTabs = document.querySelectorAll("#financeSubPaneLedger .filter-tabs .filter-tab");
  dirTabs.forEach((t) => t.classList.remove("active"));
  const allDirBtn = document.querySelector('#financeSubPaneLedger .filter-tabs .filter-tab[data-direction="all"]');
  if (allDirBtn) allDirBtn.classList.add("active");

  const pettyBtn = document.getElementById("btnTogglePettyLedger");
  if (pettyBtn) {
    pettyBtn.classList.remove("btn-fill");
    pettyBtn.classList.add("btn-sm");
  }

  await loadAccountTransactions();
}

function closeAccountLedger() {
  _currentLedgerAccountId = null;
  const subNav = document.getElementById("financeAccountsSubNav");
  if (subNav) subNav.style.display = "flex";

  const paneLedger = document.getElementById("financeSubPaneLedger");
  const paneAccounts = document.getElementById("financeSubPaneAccounts");
  if (paneLedger) paneLedger.style.display = "none";
  if (paneAccounts) paneAccounts.style.display = "block";

  loadFinanceAccounts();
}

async function _populateLedgerFilterDropdowns() {
  try {
    if (!FinanceState.categories || !FinanceState.categories.length) {
      FinanceState.categories = await FinanceApi.getCategories();
    }
    if (!FinanceState.paymentTypes || !FinanceState.paymentTypes.length) {
      FinanceState.paymentTypes = await FinanceApi.getPaymentTypes();
    }

    const catSel = document.getElementById("financeLedgerCategoryFilter");
    if (catSel) {
      catSel.innerHTML = '<option value="">All Categories</option>' +
        (FinanceState.categories || [])
          .map((c) => `<option value="${c.id}">${c.name}${c.is_petty ? " (Petty)" : ""}</option>`)
          .join("");
    }

    const ptSel = document.getElementById("financeLedgerPaymentTypeFilter");
    if (ptSel) {
      ptSel.innerHTML = '<option value="">All Payment Types</option>' +
        (FinanceState.paymentTypes || [])
          .map((p) => `<option value="${p.id}">${p.name} (${p.code})</option>`)
          .join("");
    }
  } catch (_) {}
}

async function loadAccountTransactions() {
  if (!_currentLedgerAccountId) return;

  const bar = document.getElementById("financeLedgerLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const params = {};
    const dateFrom = document.getElementById("financeLedgerDateFrom")?.value;
    const dateTo = document.getElementById("financeLedgerDateTo")?.value;
    const catId = document.getElementById("financeLedgerCategoryFilter")?.value;
    const ptId = document.getElementById("financeLedgerPaymentTypeFilter")?.value;

    if (dateFrom) params.date_from = dateFrom;
    if (dateTo) params.date_to = dateTo;
    if (catId) params.category_id = catId;
    if (ptId) params.payment_type_id = ptId;
    if (_currentLedgerDirectionFilter && _currentLedgerDirectionFilter !== "all") {
      params.direction = _currentLedgerDirectionFilter;
    }
    if (_isPettyLedgerOnly) {
      params.is_petty = true;
    }

    const items = await FinanceApi.getAccountTransactions(_currentLedgerAccountId, params);
    FinanceState.ledgerTransactions = items;
    renderAccountTransactions(items);

    // If petty rollup active, load petty summary banner
    const banner = document.getElementById("financeLedgerPettyBanner");
    if (_isPettyLedgerOnly) {
      const summary = await FinanceApi.getAccountPettySummary(_currentLedgerAccountId, {
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      if (banner) banner.style.display = "block";
      const totalOutEl = document.getElementById("financeLedgerPettyTotalOut");
      const countEl = document.getElementById("financeLedgerPettyCount");
      const breakdownEl = document.getElementById("financeLedgerPettyBreakdown");

      const acc = (FinanceState.accounts || []).find((a) => a.id === _currentLedgerAccountId);
      const symbol = acc && acc.currency === "EGP" ? "E£" : "$";

      if (totalOutEl) totalOutEl.textContent = `${symbol}${Number(summary.total_out || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
      if (countEl) countEl.textContent = summary.transactions ? summary.transactions.length : 0;
      if (breakdownEl) {
        const parts = (summary.by_category || []).map((b) => `${b.category_name}: ${symbol}${Number(b.total_out).toLocaleString("en-US", { minimumFractionDigits: 2 })} (${b.count})`);
        breakdownEl.textContent = parts.length ? parts.join("  |  ") : "No recurring expenses in selected period.";
      }
    } else {
      if (banner) banner.style.display = "none";
    }

    // Update current balance in header from account fresh state
    const acc = (FinanceState.accounts || []).find((a) => a.id === _currentLedgerAccountId);
    if (acc) {
      const balEl = document.getElementById("financeLedgerCurrentBalance");
      if (balEl) {
        const symbol = acc.currency === "EGP" ? "E£" : "$";
        balEl.textContent = `${symbol}${Number(acc.current_balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
      }
    }
  } catch (err) {
    console.error("Failed to load transactions:", err);
    toast("Failed to load transactions: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterAccountLedger() {
  loadAccountTransactions();
}

function filterAccountLedgerDirection(direction, btn) {
  _currentLedgerDirectionFilter = direction;
  const tabs = document.querySelectorAll("#financeSubPaneLedger .filter-tabs .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");
  loadAccountTransactions();
}

function togglePettyLedgerView() {
  _isPettyLedgerOnly = !_isPettyLedgerOnly;
  const btn = document.getElementById("btnTogglePettyLedger");
  if (btn) {
    if (_isPettyLedgerOnly) {
      btn.classList.remove("btn-sm");
      btn.classList.add("btn-fill");
    } else {
      btn.classList.remove("btn-fill");
      btn.classList.add("btn-sm");
    }
  }
  loadAccountTransactions();
}

function renderAccountTransactions(items) {
  const tbody = document.getElementById("financeLedgerTableBody");
  const empty = document.getElementById("financeLedgerEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  const acc = (FinanceState.accounts || []).find((a) => a.id === _currentLedgerAccountId);
  const symbol = acc && acc.currency === "EGP" ? "E£" : "$";

  tbody.innerHTML = items
    .map((tx) => {
      const isIn = tx.direction === "in";
      const inDisplay = isIn ? `<strong style="color:var(--success);">${symbol}${Number(tx.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>` : "—";
      const outDisplay = !isIn ? `<strong style="color:var(--danger);">${symbol}${Number(tx.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>` : "—";

      let fxDisplay = "—";
      if (tx.fx_rate) {
        const eqCurr = tx.currency === "USD" ? "EGP" : "USD";
        const eqSym = eqCurr === "EGP" ? "E£" : "$";
        const eqVal = tx.fx_equivalent ? `${eqSym}${Number(tx.fx_equivalent).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "";
        fxDisplay = `<span style="font-size:11px;color:var(--text3);" title="Exchange Rate applied">@ ${tx.fx_rate} <br><strong>${eqVal}</strong></span>`;
      }

      const isManual = tx.source === "manual";
      const actionsHtml = isManual
        ? `<div style="display:flex;gap:4px;justify-content:center;">
             <button class="btn btn-sm" onclick="openEditFinanceTransactionModal(${tx.id})" title="Edit Transaction"><i class="fa-solid fa-pen"></i></button>
             <button class="btn btn-sm btn-danger" onclick="confirmDeleteFinanceTransaction(${tx.id})" title="Void / Delete Transaction"><i class="fa-solid fa-trash"></i></button>
           </div>`
        : `<span class="badge badge-info" title="System-generated from ${tx.source}"><i class="fa-solid fa-lock"></i> ${tx.source.replace('_', ' ').toUpperCase()}</span>`;

      return `
        <tr>
          <td><span style="font-family:monospace;font-size:12px;">${tx.date}</span></td>
          <td><span class="badge ${_categoryKindBadge(tx.category_name ? 'cost' : 'other')}">${tx.category_name || "Uncategorized"}</span></td>
          <td><span class="badge badge-pending"><code>${tx.payment_type_code || "—"}</code></span></td>
          <td><span style="font-size:12px;">${tx.reference || "—"}</span></td>
          <td><span style="font-size:12px;color:var(--text2);">${tx.description || "—"}</span></td>
          <td style="text-align:right;">${inDisplay}</td>
          <td style="text-align:right;">${outDisplay}</td>
          <td style="text-align:right;">${fxDisplay}</td>
          <td style="text-align:right;"><strong>${symbol}${Number(tx.running_balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
          <td style="text-align:center;">${actionsHtml}</td>
        </tr>
      `;
    })
    .join("");
}

async function _populateTransactionModalDropdowns() {
  try {
    if (!FinanceState.categories || !FinanceState.categories.length) {
      FinanceState.categories = await FinanceApi.getCategories();
    }
    if (!FinanceState.paymentTypes || !FinanceState.paymentTypes.length) {
      FinanceState.paymentTypes = await FinanceApi.getPaymentTypes();
    }

    const catSel = document.getElementById("fFinanceTxCategory");
    if (catSel) {
      catSel.innerHTML = '<option value="">— Select Category —</option>' +
        (FinanceState.categories || [])
          .filter((c) => c.is_active)
          .map((c) => `<option value="${c.id}">${c.name}${c.is_petty ? " [Petty]" : ""}</option>`)
          .join("");
    }

    const ptSel = document.getElementById("fFinanceTxPaymentType");
    if (ptSel) {
      ptSel.innerHTML = '<option value="">— Select Payment Type —</option>' +
        (FinanceState.paymentTypes || [])
          .filter((p) => p.is_active)
          .map((p) => `<option value="${p.id}">${p.name} (${p.code})</option>`)
          .join("");
    }
  } catch (_) {}
}

let _txPreviewDebounceTimer = null;

function setTransactionEntryType(type, btn) {
  const entryTypeInput = document.getElementById("fFinanceTxEntryType");
  if (entryTypeInput) entryTypeInput.value = type;

  // Update tabs active state
  const typeButtons = document.querySelectorAll("#fFinanceTxTypeSelector button[data-tx-type]");
  typeButtons.forEach((b) => {
    b.classList.toggle("active", b.getAttribute("data-tx-type") === type);
  });

  const counterpartyGroup = document.getElementById("fFinanceTxCounterpartyGroup");
  const counterpartyLabel = document.getElementById("fFinanceTxCounterpartyLabel");
  const counterpartyInput = document.getElementById("fFinanceTxCounterparty");
  const taxGroup = document.getElementById("fFinanceTxTaxGroup");
  const directionGroup = document.getElementById("fFinanceTxDirectionGroup");
  const directionInput = document.getElementById("fFinanceTxDirection");
  const paymentTypeGroup = document.getElementById("fFinanceTxPaymentTypeGroup");
  const reasonGroup = document.getElementById("fFinanceTxReasonGroup");
  const reasonInput = document.getElementById("fFinanceTxReason");
  const catSel = document.getElementById("fFinanceTxCategory");

  if (type === "money_out") {
    if (counterpartyGroup) counterpartyGroup.style.display = "block";
    if (counterpartyLabel) counterpartyLabel.textContent = "Payee / Vendor";
    if (counterpartyInput) counterpartyInput.placeholder = "e.g. Acme Supplies, Landlord";
    if (taxGroup) taxGroup.style.display = "block";
    if (directionGroup) directionGroup.style.display = "none";
    if (directionInput) directionInput.value = "out";
    if (paymentTypeGroup) paymentTypeGroup.style.display = "block";
    if (reasonGroup) reasonGroup.style.display = "none";
    if (reasonInput) reasonInput.required = false;
  } else if (type === "money_in") {
    if (counterpartyGroup) counterpartyGroup.style.display = "block";
    if (counterpartyLabel) counterpartyLabel.textContent = "Customer / Payer";
    if (counterpartyInput) counterpartyInput.placeholder = "e.g. Client Ltd, Customer Name";
    if (taxGroup) taxGroup.style.display = "none";
    if (directionGroup) directionGroup.style.display = "none";
    if (directionInput) directionInput.value = "in";
    if (paymentTypeGroup) paymentTypeGroup.style.display = "block";
    if (reasonGroup) reasonGroup.style.display = "none";
    if (reasonInput) reasonInput.required = false;
  } else if (type === "bank_fee") {
    if (counterpartyGroup) counterpartyGroup.style.display = "none";
    if (taxGroup) taxGroup.style.display = "none";
    if (directionGroup) directionGroup.style.display = "none";
    if (directionInput) directionInput.value = "out";
    if (paymentTypeGroup) paymentTypeGroup.style.display = "block";
    if (reasonGroup) reasonGroup.style.display = "none";
    if (reasonInput) reasonInput.required = false;
    // Auto-select Bank Fee category if available
    if (catSel && FinanceState.categories) {
      const feeCat = FinanceState.categories.find((c) =>
        c.name.toLowerCase().includes("bank fee") || c.name.toLowerCase().includes("bank charge")
      );
      if (feeCat) catSel.value = feeCat.id;
    }
  } else if (type === "adjustment") {
    if (counterpartyGroup) counterpartyGroup.style.display = "none";
    if (taxGroup) taxGroup.style.display = "none";
    if (directionGroup) directionGroup.style.display = "block";
    if (paymentTypeGroup) paymentTypeGroup.style.display = "none";
    if (reasonGroup) reasonGroup.style.display = "block";
    if (reasonInput) reasonInput.required = true;
  }

  updateTransactionPreview();
}

function onTxCurrencyChanged() {
  const accountId = document.getElementById("fFinanceTxAccountId")?.value || _currentLedgerAccountId;
  const acc = (FinanceState.accounts || []).find((a) => a.id === parseInt(accountId, 10));
  const txCurrency = document.getElementById("fFinanceTxCurrency")?.value || "USD";
  const accCurrency = acc ? acc.currency : "USD";
  const warningEl = document.getElementById("fFinanceTxCurrencyWarning");
  const fxLabel = document.getElementById("fFinanceTxFxLabel");
  const fxInput = document.getElementById("fFinanceTxFxRate");

  if (txCurrency !== accCurrency) {
    if (warningEl) warningEl.style.display = "block";
    if (fxLabel) {
      fxLabel.textContent = `(REQUIRED to convert ${txCurrency} to ${accCurrency})`;
      fxLabel.style.color = "var(--danger)";
    }
    if (fxInput) fxInput.required = true;
  } else {
    if (warningEl) warningEl.style.display = "none";
    if (fxLabel) {
      fxLabel.textContent = "(Optional if same currency)";
      fxLabel.style.color = "var(--text3)";
    }
    if (fxInput) fxInput.required = false;
  }
  updateTransactionPreview();
}

function updateTransactionPreview() {
  if (_txPreviewDebounceTimer) clearTimeout(_txPreviewDebounceTimer);
  _txPreviewDebounceTimer = setTimeout(async () => {
    const accountId = document.getElementById("fFinanceTxAccountId")?.value || _currentLedgerAccountId;
    if (!accountId) return;

    const acc = (FinanceState.accounts || []).find((a) => a.id === parseInt(accountId, 10));
    const entryType = document.getElementById("fFinanceTxEntryType")?.value || "money_out";
    const amountVal = parseFloat(document.getElementById("fFinanceTxAmount")?.value || "0");
    const currency = document.getElementById("fFinanceTxCurrency")?.value || (acc ? acc.currency : "USD");
    const direction = document.getElementById("fFinanceTxDirection")?.value || (entryType === "money_in" ? "in" : "out");
    const fxRateVal = parseFloat(document.getElementById("fFinanceTxFxRate")?.value || "0") || null;
    const counterparty = document.getElementById("fFinanceTxCounterparty")?.value || null;
    const taxAmountVal = parseFloat(document.getElementById("fFinanceTxTaxAmount")?.value || "0") || null;
    const reason = document.getElementById("fFinanceTxReason")?.value || null;
    const catId = parseInt(document.getElementById("fFinanceTxCategory")?.value, 10) || null;

    const plainDescEl = document.getElementById("fFinanceTxPlainDesc");
    const badgeEl = document.getElementById("fFinanceTxProjectedBadge");
    const journalWrapper = document.getElementById("fFinanceTxJournalWrapper");
    const journalTbody = document.getElementById("fFinanceTxJournalTbody");

    if (!amountVal || amountVal <= 0) {
      if (plainDescEl) plainDescEl.textContent = "Enter an amount to see projected balance and ledger impact.";
      if (badgeEl) badgeEl.textContent = `Current Book Balance: ${acc ? (window.formatMoney ? window.formatMoney(acc.book_balance, acc.currency) : "$" + (acc.book_balance || 0).toFixed(2)) : "—"}`;
      if (journalWrapper) journalWrapper.style.display = "none";
      return;
    }

    try {
      const payload = {
        amount: amountVal,
        currency: currency,
        direction: direction,
        entry_type: entryType,
        counterparty: counterparty,
        fx_rate: fxRateVal,
        tax_amount: taxAmountVal,
        reason: reason,
        category_id: catId
      };
      const preview = await FinanceApi.previewTransaction(parseInt(accountId, 10), payload);
      if (plainDescEl) plainDescEl.textContent = preview.plain_description || "";
      if (badgeEl) {
        const fmtBal = window.formatMoney ? window.formatMoney(preview.projected_book_balance, acc ? acc.currency : currency) : `$${preview.projected_book_balance.toFixed(2)}`;
        badgeEl.textContent = `Projected: ${fmtBal}`;
      }

      if (journalWrapper && journalTbody) {
        if (preview.journal_preview && preview.journal_preview.length > 0) {
          journalTbody.innerHTML = preview.journal_preview.map((line) => `
            <tr>
              <td style="padding: 4px 6px;">${line.account || "Account"}</td>
              <td style="padding: 4px 6px; text-align: right; font-variant-numeric: tabular-nums;">${line.debit ? (window.formatMoney ? window.formatMoney(line.debit, acc ? acc.currency : currency) : line.debit.toFixed(2)) : "—"}</td>
              <td style="padding: 4px 6px; text-align: right; font-variant-numeric: tabular-nums;">${line.credit ? (window.formatMoney ? window.formatMoney(line.credit, acc ? acc.currency : currency) : line.credit.toFixed(2)) : "—"}</td>
            </tr>
          `).join("");
          journalWrapper.style.display = "block";
        } else {
          journalWrapper.style.display = "none";
        }
      }
    } catch (err) {
      if (plainDescEl) plainDescEl.textContent = err.message || "Unable to compute preview.";
    }
  }, 150);
}

async function openAddFinanceTransactionModal(defaultType = "money_out") {
  if (!_currentLedgerAccountId) return;
  await _populateTransactionModalDropdowns();

  const acc = (FinanceState.accounts || []).find((a) => a.id === parseInt(_currentLedgerAccountId, 10));

  document.getElementById("financeTransactionModalTitle").textContent = "Record Transaction";
  document.getElementById("financeTransactionModalSubtitle").textContent = "Guided continuous ledger entry for the active account.";
  document.getElementById("fFinanceTxId").value = "";
  document.getElementById("fFinanceTxAccountId").value = _currentLedgerAccountId;

  // Active account context
  const accNameEl = document.getElementById("fFinanceTxAccountName");
  const accMetaEl = document.getElementById("fFinanceTxAccountMeta");
  const accBalEl = document.getElementById("fFinanceTxAccountBookBalance");
  if (acc) {
    if (accNameEl) accNameEl.textContent = acc.account_name || "Account";
    if (accMetaEl) accMetaEl.textContent = `(${acc.currency}) · ${acc.institution_name || ""}`;
    if (accBalEl) accBalEl.textContent = window.formatMoney ? window.formatMoney(acc.book_balance || 0, acc.currency) : `$${(acc.book_balance || 0).toFixed(2)}`;
  }

  // Set currency to match account
  const currSelect = document.getElementById("fFinanceTxCurrency");
  if (currSelect && acc) {
    currSelect.value = acc.currency;
  }

  document.getElementById("fFinanceTxDate").value = new Date().toISOString().split("T")[0];
  document.getElementById("fFinanceTxAmount").value = "";
  document.getElementById("fFinanceTxFxRate").value = "";
  document.getElementById("fFinanceTxCounterparty").value = "";
  document.getElementById("fFinanceTxTaxAmount").value = "";
  document.getElementById("fFinanceTxCategory").value = "";
  document.getElementById("fFinanceTxPaymentType").value = "";
  document.getElementById("fFinanceTxReference").value = "";
  document.getElementById("fFinanceTxReason").value = "";
  document.getElementById("fFinanceTxDescription").value = "";

  setTransactionEntryType(defaultType);
  onTxCurrencyChanged();
  updateTransactionPreview();

  openModal("financeTransactionModal");
}

async function openEditFinanceTransactionModal(txId) {
  const tx = (FinanceState.ledgerTransactions || []).find((t) => t.id === txId);
  if (!tx) return;

  await _populateTransactionModalDropdowns();

  const acc = (FinanceState.accounts || []).find((a) => a.id === tx.account_id);
  document.getElementById("financeTransactionModalTitle").textContent = "Edit Transaction";
  document.getElementById("fFinanceTxId").value = tx.id;
  document.getElementById("fFinanceTxAccountId").value = tx.account_id;
  if (acc) {
    const accNameEl = document.getElementById("fFinanceTxAccountName");
    const accMetaEl = document.getElementById("fFinanceTxAccountMeta");
    const accBalEl = document.getElementById("fFinanceTxAccountBookBalance");
    if (accNameEl) accNameEl.textContent = acc.account_name || "Account";
    if (accMetaEl) accMetaEl.textContent = `(${acc.currency}) · ${acc.institution_name || ""}`;
    if (accBalEl) accBalEl.textContent = window.formatMoney ? window.formatMoney(acc.book_balance || 0, acc.currency) : `$${(acc.book_balance || 0).toFixed(2)}`;
  }
  const currSelect = document.getElementById("fFinanceTxCurrency");
  if (currSelect) currSelect.value = tx.currency || (acc ? acc.currency : "USD");

  document.getElementById("fFinanceTxDate").value = tx.date;
  document.getElementById("fFinanceTxDirection").value = tx.direction;
  document.getElementById("fFinanceTxAmount").value = tx.amount;
  document.getElementById("fFinanceTxFxRate").value = tx.fx_rate || "";
  document.getElementById("fFinanceTxCounterparty").value = tx.counterparty || "";
  document.getElementById("fFinanceTxTaxAmount").value = tx.tax_amount || "";
  document.getElementById("fFinanceTxCategory").value = tx.category_id || "";
  document.getElementById("fFinanceTxPaymentType").value = tx.payment_type_id || "";
  document.getElementById("fFinanceTxReference").value = tx.reference || "";
  document.getElementById("fFinanceTxReason").value = tx.reason || "";
  document.getElementById("fFinanceTxDescription").value = tx.description || "";

  setTransactionEntryType(tx.entry_type || (tx.direction === "in" ? "money_in" : "money_out"));
  onTxCurrencyChanged();
  updateTransactionPreview();

  openModal("financeTransactionModal");
}

async function saveFinanceTransaction() {
  const txId = document.getElementById("fFinanceTxId").value;
  const accountId = document.getElementById("fFinanceTxAccountId").value || _currentLedgerAccountId;
  const acc = (FinanceState.accounts || []).find((a) => a.id === parseInt(accountId, 10));
  const entryType = document.getElementById("fFinanceTxEntryType").value || "money_out";
  const date = document.getElementById("fFinanceTxDate").value;
  const currency = document.getElementById("fFinanceTxCurrency").value || (acc ? acc.currency : "USD");
  const amount = parseFloat(document.getElementById("fFinanceTxAmount").value);
  const fx_rate_val = document.getElementById("fFinanceTxFxRate").value;
  const fx_rate = fx_rate_val ? parseFloat(fx_rate_val) : null;
  const direction = document.getElementById("fFinanceTxDirection").value || (entryType === "money_in" ? "in" : "out");
  const counterparty = document.getElementById("fFinanceTxCounterparty").value.trim() || null;
  const tax_amount_val = document.getElementById("fFinanceTxTaxAmount").value;
  const tax_amount = tax_amount_val ? parseFloat(tax_amount_val) : null;
  const category_id_val = document.getElementById("fFinanceTxCategory").value;
  const category_id = category_id_val ? parseInt(category_id_val, 10) : null;
  const payment_type_id_val = document.getElementById("fFinanceTxPaymentType").value;
  const payment_type_id = payment_type_id_val ? parseInt(payment_type_id_val, 10) : null;
  const reference = document.getElementById("fFinanceTxReference").value.trim();
  const reason = document.getElementById("fFinanceTxReason").value.trim();
  const description = document.getElementById("fFinanceTxDescription").value.trim();

  if (!date) {
    toast("Please select a transaction date", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!amount || amount <= 0) {
    toast("Please enter a valid amount greater than zero", "fa-solid fa-circle-exclamation");
    return;
  }
  if (acc && currency !== acc.currency && (!fx_rate || fx_rate <= 0)) {
    toast(`Foreign currency transaction (${currency} vs account ${acc.currency}) requires an explicit exchange rate.`, "fa-solid fa-circle-exclamation");
    return;
  }
  if (entryType === "adjustment" && !reason) {
    toast("Adjustment reason is required for direct balance/journal corrections", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!category_id && entryType !== "adjustment") {
    toast("Please select a transaction category", "fa-solid fa-circle-exclamation");
    return;
  }

  const saveBtn = document.getElementById("financeTxSaveBtn");
  if (saveBtn) saveBtn.disabled = true;

  try {
    const payload = {
      date,
      direction,
      amount,
      currency,
      category_id,
      payment_type_id,
      reference,
      description,
      fx_rate,
      entry_type: entryType,
      counterparty,
      tax_amount,
      reason: entryType === "adjustment" ? reason : null,
    };

    if (txId) {
      await FinanceApi.updateTransaction(Number(txId), payload);
      toast("Transaction updated successfully", "fa-solid fa-circle-check");
    } else {
      await FinanceApi.createAccountTransaction(Number(accountId), payload);
      toast("Transaction recorded successfully", "fa-solid fa-circle-check");
    }

    closeModal("financeTransactionModal");
    // Reload accounts to update cached balances
    const accounts = await FinanceApi.getAccounts();
    FinanceState.accounts = accounts;
    if (_activeWorkspaceAccountId && _activeWorkspaceAccountId === parseInt(accountId, 10)) {
      await openAccountWorkspace(_activeWorkspaceAccountId, "activity");
    } else {
      await loadAccountTransactions();
    }
  } catch (err) {
    toast(err.message || "Failed to save transaction", "fa-solid fa-triangle-exclamation");
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

async function confirmDeleteFinanceTransaction(txId) {
  const result = await FinanceCommand.confirmAction({
    title: "Delete Ledger Transaction",
    summary: `Transaction #${txId}`,
    consequence: "Deleting this transaction will permanently remove it and recalculate running balances for all subsequent transactions.",
    actionLabel: "Delete Transaction",
    actionClass: "btn btn-danger",
    requireReason: true,
    severity: "danger",
  });
  if (!result.confirmed) return;

  try {
    await FinanceApi.deleteTransaction(txId, result.reason);
    toast("Transaction deleted successfully", "fa-solid fa-circle-check");
    const accounts = await FinanceApi.getAccounts();
    FinanceState.accounts = accounts;
    await loadAccountTransactions();
  } catch (err) {
    toast(err.message || "Failed to delete transaction", "fa-solid fa-triangle-exclamation");
  }
}

// ==========================================
// 5.4 Account Transfers (Phase 3)
// ==========================================
let _currentTransferTypeFilter = "all";

async function loadFinanceTransfers() {
  const bar = document.getElementById("financeTransfersLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    // Populate account filter dropdown if empty
    const accFilter = document.getElementById("financeTransferAccountFilter");
    if (accFilter && accFilter.options.length <= 1) {
      if (!FinanceState.accounts || !FinanceState.accounts.length) {
        FinanceState.accounts = await FinanceApi.getAccounts();
      }
      accFilter.innerHTML = '<option value="">All Accounts</option>' +
        (FinanceState.accounts || [])
          .map((a) => `<option value="${a.id}">${a.account_name} (${a.currency})</option>`)
          .join("");
    }

    const selectedAcc = accFilter ? accFilter.value : "";
    const params = {};
    if (selectedAcc) params.account_id = selectedAcc;
    if (_currentTransferTypeFilter && _currentTransferTypeFilter !== "all") {
      params.transfer_type = _currentTransferTypeFilter;
    }

    const items = await FinanceApi.getTransfers(params);
    FinanceState.transfers = items;
    renderFinanceTransfers(items);
  } catch (err) {
    console.error("Failed to load transfers:", err);
    toast("Failed to load transfers: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function filterFinanceTransfers() {
  loadFinanceTransfers();
}

function filterFinanceTransferType(type, btn) {
  _currentTransferTypeFilter = type;
  const tabs = document.querySelectorAll("#financeTransferTypeTabs .filter-tab");
  tabs.forEach((t) => t.classList.remove("active"));
  if (btn) btn.classList.add("active");
  loadFinanceTransfers();
}

function renderFinanceTransfers(items) {
  const tbody = document.getElementById("financeTransfersTableBody");
  const empty = document.getElementById("financeTransfersEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map((t) => {
      let typeBadge = "";
      if (t.transfer_type === "same_bank_fx") {
        typeBadge = `<span class="badge" style="background:#e0e7ff; color:#3730a3; font-weight:600;"><i class="fa-solid fa-arrow-right-arrow-left"></i> FX Conversion</span>`;
      } else if (t.transfer_type === "external_linked") {
        typeBadge = `<span class="badge" style="background:#fef3c7; color:#92400e; font-weight:600;"><i class="fa-solid fa-globe"></i> External Linked</span>`;
      } else {
        typeBadge = `<span class="badge" style="background:#e0f2fe; color:#0369a1; font-weight:600;"><i class="fa-solid fa-arrows-split-up-and-left"></i> Internal Move</span>`;
      }

      const fromSymbol = t.from_currency === "EGP" ? "E£" : "$";
      const toSymbol = t.to_currency === "EGP" ? "E£" : "$";

      let legsStatus = "";
      if (t.outflow_transaction_id && t.inflow_transaction_id) {
        legsStatus = `<span class="badge badge-approved" title="Dual continuous ledger legs created"><i class="fa-solid fa-check-double"></i> Dual Legs</span>`;
      } else if (t.outflow_transaction_id) {
        legsStatus = `<span class="badge badge-pending" title="Outflow leg confirmed"><i class="fa-solid fa-arrow-up-right-from-square"></i> Outflow Leg</span>`;
      } else if (t.inflow_transaction_id) {
        legsStatus = `<span class="badge badge-pending" title="Inflow leg confirmed"><i class="fa-solid fa-arrow-down-left-and-up-right-to-center"></i> Inflow Leg</span>`;
      } else {
        legsStatus = `<span class="badge badge-rejected">Pending</span>`;
      }

      const fxDisplay = t.fx_rate ? `<code>${t.fx_rate}</code>` : `<span style="color:var(--text3);">1.0</span>`;

      return `
        <tr>
          <td data-label="Date"><span style="font-family:monospace;font-size:12px;">${FinanceFormat.formatFinanceDate(t.date)}</span></td>
          <td data-label="Type">${typeBadge}</td>
          <td data-label="From Account"><strong>${t.from_account_name || '<span style="color:var(--text3); font-style:italic;">External</span>'}</strong></td>
          <td data-label="Outflow" class="cell-money">${FinanceFormat.renderMoneyHtml(-Math.abs(t.from_amount || 0), t.from_currency, { extraClass: "money-negative" })}</td>
          <td data-label="To Account"><strong>${t.to_account_name || '<span style="color:var(--text3); font-style:italic;">External</span>'}</strong></td>
          <td data-label="Inflow" class="cell-money">${FinanceFormat.renderMoneyHtml(Math.abs(t.to_amount || 0), t.to_currency, { showSign: true, extraClass: "money-positive" })}</td>
          <td data-label="FX Rate" style="text-align:right;">${fxDisplay}</td>
          <td data-label="Reference / Memo">
            ${t.exchange_reference ? `<strong style="font-size:12px; color:var(--primary);">${t.exchange_reference}</strong><br>` : ""}
            <span style="font-size:12px; color:var(--text2);">${t.note || "—"}</span>
          </td>
          <td data-label="Legs Status" class="col-actions" style="text-align:center;">${legsStatus}</td>
        </tr>
      `;
    })
    .join("");
}

async function openRecordFinanceTransferModal(presetFromAccountId = null) {
  FinanceForm.clearErrors("financeTransferModal");
  if (!FinanceState.accounts || !FinanceState.accounts.length) {
    FinanceState.accounts = await FinanceApi.getAccounts({ is_active: true });
  }

  const activeAccounts = (FinanceState.accounts || []).filter((a) => a.is_active !== false);

  const fromSel = document.getElementById("transferFromAccount");
  const toSel = document.getElementById("transferToAccount");

  const accountOptions = '<option value="">-- Select Account --</option>' +
    activeAccounts
      .map((a) => `<option value="${a.id}" data-currency="${a.currency}" data-balance="${a.current_balance}">${a.account_name} (${a.currency} • ${a.currency === "EGP" ? "E£" : "$"}${Number(a.current_balance || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })})</option>`)
      .join("");

  if (fromSel) fromSel.innerHTML = accountOptions;
  if (toSel) toSel.innerHTML = accountOptions;

  // Defaults
  document.getElementById("transferDate").value = new Date().toISOString().split("T")[0];
  const expDate = document.getElementById("transferExpectedDate");
  if (expDate) expDate.value = "";
  document.getElementById("transferFromAmount").value = "";
  document.getElementById("transferToAmount").value = "";
  const fxInput = document.getElementById("transferFxRate");
  if (fxInput) fxInput.value = "";
  const feeInput = document.getElementById("transferFee");
  if (feeInput) feeInput.value = "";
  document.getElementById("transferExchangeRef").value = "";
  document.getElementById("transferNote").value = "";
  document.getElementById("transferFromBalanceHint").textContent = "$0.00";
  document.getElementById("transferToBalanceHint").textContent = "$0.00";
  const fromProj = document.getElementById("transferFromProjectedHint");
  if (fromProj) fromProj.textContent = "—";
  const toProj = document.getElementById("transferToProjectedHint");
  if (toProj) toProj.textContent = "—";
  const sameAlert = document.getElementById("transferSameAccountAlert");
  if (sameAlert) sameAlert.style.display = "none";

  if (presetFromAccountId && fromSel) {
    fromSel.value = String(presetFromAccountId);
    onTransferAccountSelected("from");
  }

  // Reset to Internal Move
  const internalRadio = document.querySelector('input[name="transferTypeRadio"][value="internal"]');
  if (internalRadio) internalRadio.checked = true;
  onTransferTypeChanged("internal");

  openModal("financeTransferModal");
}

function closeFinanceTransferModal() {
  closeModal("financeTransferModal");
}

let _transferPreviewDebounceTimer = null;

function onTransferTypeChanged(type) {
  const fxSection = document.getElementById("transferFxSection");
  const extGroup = document.getElementById("transferExternalGroup");

  if (type === "internal") {
    if (fxSection) fxSection.style.display = "none";
    if (extGroup) extGroup.style.display = "none";
    recalcTransferAmounts("from");
  } else if (type === "same_bank_fx") {
    if (fxSection) fxSection.style.display = "block";
    if (extGroup) extGroup.style.display = "none";
  } else if (type === "external_linked") {
    if (fxSection) fxSection.style.display = "block";
    if (extGroup) extGroup.style.display = "block";
  }
  updateTransferPreview();
}

function onTransferAccountSelected(side) {
  const fromSel = document.getElementById("transferFromAccount");
  const toSel = document.getElementById("transferToAccount");
  const sameAlert = document.getElementById("transferSameAccountAlert");
  const postBtn = document.getElementById("btnSaveFinanceTransfer");

  const fromOpt = fromSel ? fromSel.selectedOptions[0] : null;
  const toOpt = toSel ? toSel.selectedOptions[0] : null;

  const fromCur = fromOpt ? fromOpt.getAttribute("data-currency") : "USD";
  const toCur = toOpt ? toOpt.getAttribute("data-currency") : "USD";

  const fromBal = fromOpt ? fromOpt.getAttribute("data-balance") : null;
  const toBal = toOpt ? toOpt.getAttribute("data-balance") : null;

  const fromBadge = document.getElementById("transferFromCurrencyBadge");
  const toBadge = document.getElementById("transferToCurrencyBadge");
  if (fromBadge && fromCur) fromBadge.textContent = fromCur;
  if (toBadge && toCur) toBadge.textContent = toCur;

  const fromHint = document.getElementById("transferFromBalanceHint");
  const toHint = document.getElementById("transferToBalanceHint");
  if (fromHint && fromBal !== null) fromHint.textContent = window.formatMoney ? window.formatMoney(fromBal, fromCur) : `$${Number(fromBal).toFixed(2)}`;
  if (toHint && toBal !== null) toHint.textContent = window.formatMoney ? window.formatMoney(toBal, toCur) : `$${Number(toBal).toFixed(2)}`;

  // Same account detection (AC 1)
  if (fromSel && toSel && fromSel.value && toSel.value && fromSel.value === toSel.value) {
    if (sameAlert) sameAlert.style.display = "block";
    if (postBtn) postBtn.disabled = true;
    toast("Source and destination accounts cannot be the same", "fa-solid fa-circle-exclamation");
  } else {
    if (sameAlert) sameAlert.style.display = "none";
    if (postBtn) postBtn.disabled = false;
  }

  // Auto-switch transfer type if both accounts selected
  if (fromSel && toSel && fromSel.value && toSel.value && fromSel.value !== toSel.value) {
    const isSameCur = fromCur === toCur;
    const currentType = document.querySelector('input[name="transferTypeRadio"]:checked')?.value;

    if (currentType !== "external_linked") {
      if (!isSameCur) {
        const fxRadio = document.querySelector('input[name="transferTypeRadio"][value="same_bank_fx"]');
        if (fxRadio) fxRadio.checked = true;
        onTransferTypeChanged("same_bank_fx");
      } else {
        const internalRadio = document.querySelector('input[name="transferTypeRadio"][value="internal"]');
        if (internalRadio) internalRadio.checked = true;
        onTransferTypeChanged("internal");
      }
    }
  }

  recalcTransferAmounts("from");
}

function recalcTransferAmounts(source) {
  const type = document.querySelector('input[name="transferTypeRadio"]:checked')?.value || "internal";
  const fromAmtInput = document.getElementById("transferFromAmount");
  const toAmtInput = document.getElementById("transferToAmount");
  const fxRateInput = document.getElementById("transferFxRate");
  const fromSel = document.getElementById("transferFromAccount");
  const toSel = document.getElementById("transferToAccount");

  const fromOpt = fromSel?.selectedOptions[0];
  const toOpt = toSel?.selectedOptions[0];
  const fromCur = fromOpt ? fromOpt.getAttribute("data-currency") : "USD";
  const toCur = toOpt ? toOpt.getAttribute("data-currency") : "USD";

  const fromAmt = parseFloat(fromAmtInput?.value) || 0;
  let toAmt = parseFloat(toAmtInput?.value) || 0;
  let fxRate = parseFloat(fxRateInput?.value) || 0;

  if (type === "internal") {
    if (source === "from") {
      if (toAmtInput) toAmtInput.value = fromAmt > 0 ? fromAmt.toFixed(2) : "";
    } else if (source === "to") {
      if (fromAmtInput) fromAmtInput.value = toAmt > 0 ? toAmt.toFixed(2) : "";
    }
  } else {
    // 3-way conversion computation (AC 2)
    if (source === "from" || source === "fx") {
      if (fromAmt > 0 && fxRate > 0) {
        toAmt = parseFloat((fromAmt * fxRate).toFixed(2));
        if (toAmtInput) toAmtInput.value = toAmt.toFixed(2);
      }
    } else if (source === "to") {
      if (fromAmt > 0 && toAmt > 0) {
        fxRate = parseFloat((toAmt / fromAmt).toFixed(4));
        if (fxRateInput) fxRateInput.value = fxRate.toFixed(4);
      }
    }

    // Inconsistent conversion check
    const mismatchAlert = document.getElementById("transferFxMismatchAlert");
    const mismatchText = document.getElementById("transferFxMismatchText");
    if (fromAmt > 0 && fxRate > 0 && toAmt > 0) {
      const expectedTo = fromAmt * fxRate;
      if (Math.abs(toAmt - expectedTo) > 0.1) {
        if (mismatchAlert) mismatchAlert.style.display = "block";
        if (mismatchText) {
          mismatchText.textContent = `Conversion mismatch: ${fromAmt} @ ${fxRate} = ${expectedTo.toFixed(2)} ${toCur}, but ${toAmt} ${toCur} is entered.`;
        }
      } else {
        if (mismatchAlert) mismatchAlert.style.display = "none";
      }
    } else {
      if (mismatchAlert) mismatchAlert.style.display = "none";
    }

    // Update explicit FX banner
    const fxDirText = document.getElementById("transferFxDirectionText");
    const impliedText = document.getElementById("transferImpliedRateText");
    if (fxDirText) {
      const displayRate = fxRate > 0 ? fxRate.toFixed(4) : (fromAmt > 0 && toAmt > 0 ? (toAmt / fromAmt).toFixed(4) : "—");
      fxDirText.textContent = `Explicit Conversion: 1 ${fromCur} = ${displayRate} ${toCur}`;
    }
    if (impliedText) {
      const implied = (toAmt > 0 && fromAmt > 0) ? (toAmt / fromAmt).toFixed(4) : "—";
      impliedText.textContent = `Implied Rate: ${implied}`;
    }
  }

  updateTransferPreview();
}

function updateTransferPreview() {
  if (_transferPreviewDebounceTimer) clearTimeout(_transferPreviewDebounceTimer);
  _transferPreviewDebounceTimer = setTimeout(async () => {
    const fromSel = document.getElementById("transferFromAccount");
    const toSel = document.getElementById("transferToAccount");
    const type = document.querySelector('input[name="transferTypeRadio"]:checked')?.value || "internal";
    const fromAmount = parseFloat(document.getElementById("transferFromAmount")?.value || "0");
    const toAmountVal = document.getElementById("transferToAmount")?.value;
    const toAmount = toAmountVal ? parseFloat(toAmountVal) : null;
    const fxRate = parseFloat(document.getElementById("transferFxRate")?.value || "0") || null;
    const fee = parseFloat(document.getElementById("transferFee")?.value || "0") || 0;
    const date = document.getElementById("transferDate")?.value;
    const confirmedLeg = type === "external_linked" ? (document.getElementById("transferConfirmedLeg")?.value || "both") : "both";

    const fromProjHint = document.getElementById("transferFromProjectedHint");
    const toProjHint = document.getElementById("transferToProjectedHint");
    const settlementBadge = document.getElementById("transferSettlementBadge");
    const plainDesc = document.getElementById("transferPlainDesc");
    const journalWrapper = document.getElementById("transferJournalWrapper");
    const journalTbody = document.getElementById("transferJournalTbody");

    if (!fromAmount || fromAmount <= 0) {
      if (fromProjHint) fromProjHint.textContent = "—";
      if (toProjHint) toProjHint.textContent = "—";
      if (plainDesc) plainDesc.textContent = "Select accounts and enter an amount to preview continuous ledger effect.";
      if (journalWrapper) journalWrapper.style.display = "none";
      return;
    }

    try {
      const payload = {
        transfer_type: type,
        from_account_id: fromSel?.value ? parseInt(fromSel.value, 10) : null,
        to_account_id: toSel?.value ? parseInt(toSel.value, 10) : null,
        from_amount: fromAmount,
        to_amount: toAmount,
        fx_rate: fxRate,
        fee: fee,
        date: date,
        confirmed_leg: confirmedLeg,
      };

      const preview = await FinanceApi.previewTransfer(payload);

      if (fromProjHint) {
        fromProjHint.textContent = window.formatMoney ? window.formatMoney(preview.from_projected_balance, preview.from_currency) : `$${preview.from_projected_balance.toFixed(2)}`;
      }
      if (toProjHint && preview.to_projected_balance !== null) {
        toProjHint.textContent = window.formatMoney ? window.formatMoney(preview.to_projected_balance, preview.to_currency) : `$${preview.to_projected_balance.toFixed(2)}`;
      }
      if (settlementBadge) {
        if (preview.settlement_status === "in_transit") {
          settlementBadge.className = "badge badge-warning";
          settlementBadge.textContent = "In Transit (Awaiting Match)";
        } else if (preview.settlement_status === "awaiting_match") {
          settlementBadge.className = "badge badge-warning";
          settlementBadge.textContent = "Awaiting Match (Inbound)";
        } else {
          settlementBadge.className = "badge badge-info";
          settlementBadge.textContent = "Settled (Dual Leg)";
        }
      }
      if (plainDesc) {
        plainDesc.textContent = preview.plain_description || "";
      }

      if (journalWrapper && journalTbody) {
        if (preview.journal_preview && preview.journal_preview.length > 0) {
          journalTbody.innerHTML = preview.journal_preview.map((line) => `
            <tr>
              <td style="padding: 4px 6px;">${line.account}</td>
              <td style="padding: 4px 6px; text-align: right; font-variant-numeric: tabular-nums;">${line.debit ? (window.formatMoney ? window.formatMoney(line.debit, line.currency) : line.debit.toFixed(2)) : "—"}</td>
              <td style="padding: 4px 6px; text-align: right; font-variant-numeric: tabular-nums;">${line.credit ? (window.formatMoney ? window.formatMoney(line.credit, line.currency) : line.credit.toFixed(2)) : "—"}</td>
            </tr>
          `).join("");
          journalWrapper.style.display = "block";
        } else {
          journalWrapper.style.display = "none";
        }
      }
    } catch (err) {
      if (plainDesc) plainDesc.textContent = err.message || "Failed to calculate preview";
    }
  }, 150);
}

async function saveFinanceTransfer() {
  const date = document.getElementById("transferDate").value;
  const type = document.querySelector('input[name="transferTypeRadio"]:checked')?.value || "internal";
  const fromAccountIdVal = document.getElementById("transferFromAccount").value;
  const toAccountIdVal = document.getElementById("transferToAccount").value;
  const fromAmount = parseFloat(document.getElementById("transferFromAmount").value);
  const toAmountVal = document.getElementById("transferToAmount").value;
  const toAmount = toAmountVal ? parseFloat(toAmountVal) : fromAmount;
  const fxRateVal = document.getElementById("transferFxRate")?.value;
  const fxRate = fxRateVal ? parseFloat(fxRateVal) : null;
  const feeVal = document.getElementById("transferFee")?.value;
  const fee = feeVal ? parseFloat(feeVal) : 0.0;
  const expectedDate = document.getElementById("transferExpectedDate")?.value || null;
  const exchangeRef = document.getElementById("transferExchangeRef").value.trim();
  const note = document.getElementById("transferNote").value.trim();
  const confirmedLeg = document.getElementById("transferConfirmedLeg")?.value || "both";

  if (!date) {
    toast("Please select a transfer date", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!fromAmount || fromAmount <= 0) {
    toast("Please enter a valid outflow amount greater than 0", "fa-solid fa-circle-exclamation");
    return;
  }
  if (!fromAccountIdVal && !toAccountIdVal) {
    toast("Please select at least one account for the transfer", "fa-solid fa-circle-exclamation");
    return;
  }
  if (fromAccountIdVal && toAccountIdVal && fromAccountIdVal === toAccountIdVal) {
    toast("Source and destination accounts cannot be the same", "fa-solid fa-circle-exclamation");
    return;
  }
  if ((type === "internal" || type === "same_bank_fx") && (!fromAccountIdVal || !toAccountIdVal)) {
    toast("Both source and destination accounts must be selected for internal transfers", "fa-solid fa-circle-exclamation");
    return;
  }
  if (type === "same_bank_fx" && (!fxRate || fxRate <= 0)) {
    toast("Please provide a valid exchange rate greater than 0", "fa-solid fa-circle-exclamation");
    return;
  }

  const btn = document.getElementById("btnSaveFinanceTransfer");
  if (btn) btn.disabled = true;

  const payload = {
    date,
    transfer_type: type,
    from_account_id: fromAccountIdVal ? parseInt(fromAccountIdVal, 10) : null,
    to_account_id: toAccountIdVal ? parseInt(toAccountIdVal, 10) : null,
    from_amount: fromAmount,
    to_amount: toAmount,
    fx_rate: fxRate,
    fee: fee,
    expected_date: expectedDate,
    exchange_reference: exchangeRef || null,
    confirmed_leg: type === "external_linked" ? confirmedLeg : "both",
    note,
  };

  try {
    await FinanceApi.createTransfer(payload);
    toast("Transfer posted successfully! Continuous ledger legs updated.", "fa-solid fa-circle-check");
    closeFinanceTransferModal();

    // Reload accounts to update balances across all views
    FinanceState.accounts = await FinanceApi.getAccounts();
    if (_activeWorkspaceAccountId) {
      await openAccountWorkspace(_activeWorkspaceAccountId, "activity");
    } else if (_currentFinanceSubTab === "transfers") {
      await loadFinanceTransfers();
    } else if (_currentFinanceSubTab === "accounts") {
      renderFinanceAccounts(FinanceState.accounts);
    }
  } catch (err) {
    console.error("Failed to save transfer:", err);
    toast("Failed to save transfer: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function matchInTransitTransfer(transferId) {
  const transfer = (FinanceState.transfers || []).find((t) => t.id === transferId);
  if (!transfer) return;

  const targetAccountId = prompt(`Match in-transit transfer #${transferId} (${transfer.from_amount} ${transfer.from_currency}). Enter destination Bank Account ID:`);
  if (!targetAccountId) return;

  try {
    await FinanceApi.matchTransfer(transferId, {
      target_account_id: parseInt(targetAccountId, 10),
      received_amount: transfer.to_amount,
      note: "Matched from transfer register",
    });
    toast("In-transit transfer matched and settled successfully!", "fa-solid fa-circle-check");
    FinanceState.accounts = await FinanceApi.getAccounts();
    await loadFinanceTransfers();
  } catch (err) {
    toast("Failed to match transfer: " + (err.message || err), "fa-solid fa-triangle-exclamation");
  }
}


// Window exports for Accounts, Categories, Payment Types, Ledger, Transfers
window.switchFinanceAccountsSubTab = switchFinanceAccountsSubTab;
window.loadFinanceAccounts = loadFinanceAccounts;
window.filterCompanyBankAccounts = filterCompanyBankAccounts;
window.onCompanyAccountTypeChange = onCompanyAccountTypeChange;
window.openAddCompanyBankAccountModal = openAddCompanyBankAccountModal;
window.openEditCompanyBankAccountModal = openEditCompanyBankAccountModal;
window.saveCompanyBankAccount = saveCompanyBankAccount;
window.toggleCompanyBankAccountActive = toggleCompanyBankAccountActive;
window.loadFinanceCategories = loadFinanceCategories;
window.filterFinanceCategories = filterFinanceCategories;
window.filterFinanceCategoriesByKind = filterFinanceCategoriesByKind;
window.openAddFinanceCategoryModal = openAddFinanceCategoryModal;
window.openEditFinanceCategoryModal = openEditFinanceCategoryModal;
window.saveFinanceCategory = saveFinanceCategory;
window.toggleFinanceCategoryActive = toggleFinanceCategoryActive;
window.loadFinancePaymentTypes = loadFinancePaymentTypes;
window.filterFinancePaymentTypes = filterFinancePaymentTypes;
window.openAddFinancePaymentTypeModal = openAddFinancePaymentTypeModal;
window.openEditFinancePaymentTypeModal = openEditFinancePaymentTypeModal;
window.saveFinancePaymentType = saveFinancePaymentType;
window.toggleFinancePaymentTypeActive = toggleFinancePaymentTypeActive;
window.viewAccountLedger = viewAccountLedger;
window.closeAccountLedger = closeAccountLedger;
window.loadAccountTransactions = loadAccountTransactions;
window.filterAccountLedger = filterAccountLedger;
window.filterAccountLedgerDirection = filterAccountLedgerDirection;
window.togglePettyLedgerView = togglePettyLedgerView;
window.openAddFinanceTransactionModal = openAddFinanceTransactionModal;
window.openEditFinanceTransactionModal = openEditFinanceTransactionModal;
window.saveFinanceTransaction = saveFinanceTransaction;
window.confirmDeleteFinanceTransaction = confirmDeleteFinanceTransaction;
window.loadFinanceTransfers = loadFinanceTransfers;
window.filterFinanceTransfers = filterFinanceTransfers;
window.filterFinanceTransferType = filterFinanceTransferType;
window.openRecordFinanceTransferModal = openRecordFinanceTransferModal;
window.closeFinanceTransferModal = closeFinanceTransferModal;
window.onTransferTypeChanged = onTransferTypeChanged;
window.onTransferAccountSelected = onTransferAccountSelected;
window.recalcTransferAmounts = recalcTransferAmounts;
window.saveFinanceTransfer = saveFinanceTransfer;
window.openAccountWorkspace = openAccountWorkspace;
window.closeAccountWorkspace = closeAccountWorkspace;
window.revealWorkspaceAccountNumber = revealWorkspaceAccountNumber;
window.switchWorkspaceTab = switchWorkspaceTab;
window.saveWorkspaceAccountSettings = saveWorkspaceAccountSettings;
window.workspaceRecordTransaction = workspaceRecordTransaction;
window.workspaceTransfer = workspaceTransfer;
window.workspaceImportStatement = workspaceImportStatement;
window.setTransactionEntryType = setTransactionEntryType;
window.onTxCurrencyChanged = onTxCurrencyChanged;
window.updateTransactionPreview = updateTransactionPreview;
window.updateTransferPreview = updateTransferPreview;
window.matchInTransitTransfer = matchInTransitTransfer;
window.filterWorkspaceLedger = filterWorkspaceLedger;
window.filterWorkspaceLedgerDirection = filterWorkspaceLedgerDirection;


