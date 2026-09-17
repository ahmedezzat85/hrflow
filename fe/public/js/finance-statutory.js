/**
 * fe/public/js/finance-statutory.js
 * Controller for Statutory Obligations Tracker (FUX-410).
 * Handles list filtering, metrics calculation, estimate confirm/adjust true-ups,
 * and remittance settlement linking via SettlementService.
 */

let _statutoryObligations = [];
let _statutoryFilterStatus = "all";
let _statutoryFilterType = "all";
let _statutorySearchQuery = "";
let _statutoryActiveObligation = null;

const OBLIGATION_TYPE_LABELS = {
  sales_tax: "Sales Tax / VAT",
  withholding_tax: "Withholding Tax (WHT)",
  income_tax: "Salary/Income Tax Withheld",
  social_insurance_employee: "Social Insurance (Employee)",
  social_insurance_employer: "Social Insurance (Employer)",
  health_insurance: "Health Insurance",
  other_statutory: "Other Statutory",
};

async function initFinanceStatutory() {
  await loadFinanceStatutory();
}

async function loadFinanceStatutory() {
  const loadingBar = document.getElementById("financeStatutoryLoadingBar");
  if (loadingBar) loadingBar.style.display = "block";

  try {
    const params = {};
    if (_statutoryFilterStatus !== "all") params.status = _statutoryFilterStatus;
    if (_statutoryFilterType !== "all") params.obligation_type = _statutoryFilterType;
    if (_statutorySearchQuery) params.search = _statutorySearchQuery;

    const data = await FinanceApi.listStatutoryObligations(params);
    _statutoryObligations = Array.isArray(data) ? data : [];
    renderFinanceStatutoryTable();
    updateFinanceStatutoryMetrics();
  } catch (err) {
    console.error("Failed to load statutory obligations:", err);
    if (typeof showToast === "function") showToast("Failed to load statutory obligations", "error");
  } finally {
    if (loadingBar) loadingBar.style.display = "none";
  }
}

function updateFinanceStatutoryMetrics() {
  let estTotal = 0;
  let accTotal = 0;
  let remTotal = 0;
  let varTotal = 0;

  for (const obl of _statutoryObligations) {
    if (obl.status === "estimated") {
      estTotal += Number(obl.amount_accrued || obl.amount_estimated || 0);
    } else if (obl.status === "accrued" || obl.status === "partially_remitted") {
      const rem = Number(obl.remaining_balance !== undefined ? obl.remaining_balance : (obl.amount_accrued - (obl.amount_remitted || 0)));
      accTotal += Math.max(0, rem);
    }
    remTotal += Number(obl.amount_remitted || 0);
    varTotal += Number(obl.variance_amount || 0);
  }

  const fmt = (v) => `$${Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const elEst = document.getElementById("statutorySummaryEstimated");
  const elAcc = document.getElementById("statutorySummaryAccrued");
  const elRem = document.getElementById("statutorySummaryRemitted");
  const elVar = document.getElementById("statutorySummaryVariance");

  if (elEst) elEst.textContent = fmt(estTotal);
  if (elAcc) elAcc.textContent = fmt(accTotal);
  if (elRem) elRem.textContent = fmt(remTotal);
  if (elVar) {
    elVar.textContent = fmt(varTotal);
    elVar.style.color = varTotal !== 0 ? (varTotal > 0 ? "#b91c1c" : "#15803d") : "#64748b";
  }
}

function renderFinanceStatutoryTable() {
  const tbody = document.getElementById("financeStatutoryTableBody");
  const empty = document.getElementById("financeStatutoryEmpty");
  if (!tbody) return;

  tbody.innerHTML = "";

  let list = [..._statutoryObligations];
  if (_statutoryFilterStatus !== "all") {
    list = list.filter((o) => o.status === _statutoryFilterStatus);
  }
  if (_statutoryFilterType !== "all") {
    list = list.filter((o) => o.obligation_type === _statutoryFilterType);
  }
  if (_statutorySearchQuery) {
    const s = _statutorySearchQuery.toLowerCase();
    list = list.filter((o) =>
      (o.obligation_type && o.obligation_type.toLowerCase().includes(s)) ||
      (o.period && o.period.toLowerCase().includes(s)) ||
      (o.notes && o.notes.toLowerCase().includes(s))
    );
  }

  if (list.length === 0) {
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  const fmt = (v) => `$${Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  for (const obl of list) {
    const tr = document.createElement("tr");

    const typeLabel = OBLIGATION_TYPE_LABELS[obl.obligation_type] || obl.obligation_type.replace(/_/g, " ");
    const remaining = Math.max(0, Number(obl.remaining_balance !== undefined ? obl.remaining_balance : (obl.amount_accrued - (obl.amount_remitted || 0))));

    // Variance display with tooltip/note
    let varianceHtml = `<span style="color:#64748b;">$0.00</span>`;
    const varAmt = Number(obl.variance_amount || 0);
    if (varAmt !== 0) {
      const varColor = varAmt > 0 ? "#b91c1c" : "#15803d";
      const sign = varAmt > 0 ? "+" : "";
      varianceHtml = `<span style="color:${varColor}; font-weight:600;" title="${obl.variance_note || ''}">${sign}${fmt(varAmt)} ${obl.variance_note ? '<i class="fa-solid fa-circle-info" style="font-size:10px; margin-left:3px;"></i>' : ''}</span>`;
    }

    // Status Badge
    let badgeClass = "badge-draft";
    let badgeLabel = obl.status;
    if (obl.status === "estimated") {
      badgeClass = "badge-warning";
      badgeLabel = "Estimated";
    } else if (obl.status === "accrued") {
      badgeClass = "badge-info";
      badgeLabel = "Accrued";
    } else if (obl.status === "partially_remitted") {
      badgeClass = "badge-purple";
      badgeLabel = "Partially Remitted";
    } else if (obl.status === "remitted") {
      badgeClass = "badge-success";
      badgeLabel = "Remitted";
    }

    // Actions
    let actionButtons = "";
    if (obl.status === "estimated") {
      actionButtons = `
        <button class="btn btn-sm btn-outline btn-stat-confirm" onclick="openStatutoryConfirmModal(${obl.id})" title="Confirm or adjust authoritative figure from government portal">
          <i class="fa-solid fa-check"></i> Confirm / Adjust
        </button>
      `;
    } else if (obl.status === "accrued" || obl.status === "partially_remitted") {
      actionButtons = `
        <button class="btn btn-sm btn-fill btn-stat-remit" onclick="openStatutorySettleModal(${obl.id})" title="Remit government liability">
          <i class="fa-solid fa-money-bill-transfer"></i> Remit Payment
        </button>
      `;
    } else {
      actionButtons = `
        <span style="font-size:12px; color:#16a34a;"><i class="fa-solid fa-check-double"></i> Settled</span>
      `;
    }

    tr.innerHTML = `
      <td>
        <div style="font-weight:600; color:var(--text-primary, #0f172a);">${typeLabel}</div>
        <div style="font-size:11px; color:var(--text-muted, #64748b);">${obl.source_type ? obl.source_type.replace(/_/g, ' ') : 'manual'} ${obl.notes ? '• ' + obl.notes : ''}</div>
      </td>
      <td><span class="badge badge-neutral">${obl.period}</span></td>
      <td class="cell-money">${obl.amount_estimated !== null && obl.amount_estimated !== undefined ? fmt(obl.amount_estimated) : '<span style="color:#94a3b8;">—</span>'}</td>
      <td class="cell-money" style="font-weight:600;">${fmt(obl.amount_accrued)}</td>
      <td class="cell-money" style="color:#16a34a;">${fmt(obl.amount_remitted)}</td>
      <td class="cell-money" style="font-weight:700; color:${remaining > 0 ? '#0f172a' : '#64748b'};">${fmt(remaining)}</td>
      <td class="cell-money">${varianceHtml}</td>
      <td>${obl.due_date ? obl.due_date : '<span style="color:#94a3b8;">—</span>'}</td>
      <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
      <td style="text-align:right;">${actionButtons}</td>
    `;
    tbody.appendChild(tr);
  }
}

function filterFinanceStatutorySearch(val) {
  _statutorySearchQuery = val || "";
  renderFinanceStatutoryTable();
}

function filterFinanceStatutoryType(type) {
  _statutoryFilterType = type || "all";
  renderFinanceStatutoryTable();
}

function filterFinanceStatutoryStatus(status, tabElem) {
  _statutoryFilterStatus = status;
  const container = document.getElementById("financeStatutoryFilterTabs");
  if (container) {
    container.querySelectorAll(".filter-tab").forEach((t) => t.classList.remove("active"));
  }
  if (tabElem) tabElem.classList.add("active");
  renderFinanceStatutoryTable();
}

// -------------------------------------------------------------
// Confirm / Adjust Modal Flow
// -------------------------------------------------------------
function openStatutoryConfirmModal(id) {
  const obl = _statutoryObligations.find((o) => o.id === Number(id));
  if (!obl) return;

  _statutoryActiveObligation = obl;
  const idEl = document.getElementById("statConfirmId");
  const estEl = document.getElementById("statConfirmEstimateDisplay");
  const accEl = document.getElementById("statConfirmAccruedAmount");
  const varEl = document.getElementById("statConfirmVarianceDisplay");
  const noteEl = document.getElementById("statConfirmVarianceNote");

  if (idEl) idEl.value = obl.id;
  const estVal = Number(obl.amount_estimated !== null && obl.amount_estimated !== undefined ? obl.amount_estimated : obl.amount_accrued);
  if (estEl) estEl.textContent = `$${estVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${obl.currency}`;
  if (accEl) accEl.value = obl.amount_accrued;
  if (varEl) varEl.textContent = "$0.00";
  if (noteEl) noteEl.value = obl.variance_note || "";

  calculateStatutoryConfirmVariance();
  if (typeof openModal === "function") openModal("statutoryConfirmModal");
}

function calculateStatutoryConfirmVariance() {
  if (!_statutoryActiveObligation) return;
  const accEl = document.getElementById("statConfirmAccruedAmount");
  const varEl = document.getElementById("statConfirmVarianceDisplay");
  if (!accEl || !varEl) return;

  const newAccrued = parseFloat(accEl.value) || 0;
  const est = Number(_statutoryActiveObligation.amount_estimated !== null && _statutoryActiveObligation.amount_estimated !== undefined ? _statutoryActiveObligation.amount_estimated : _statutoryActiveObligation.amount_accrued);
  const diff = Math.round((newAccrued - est + Number.EPSILON) * 100) / 100;

  const sign = diff > 0 ? "+" : "";
  varEl.textContent = `${sign}$${diff.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  varEl.style.color = diff !== 0 ? (diff > 0 ? "#b91c1c" : "#15803d") : "#0f172a";
}

async function submitStatutoryConfirmAdjust() {
  const idEl = document.getElementById("statConfirmId");
  const accEl = document.getElementById("statConfirmAccruedAmount");
  const noteEl = document.getElementById("statConfirmVarianceNote");
  const btn = document.getElementById("statConfirmSaveBtn");

  if (!idEl || !accEl) return;
  const id = Number(idEl.value);
  const amount_accrued = parseFloat(accEl.value);

  if (isNaN(amount_accrued) || amount_accrued < 0) {
    if (typeof showToast === "function") showToast("Please enter a valid accrued amount", "error");
    return;
  }

  if (btn) btn.disabled = true;
  try {
    await FinanceApi.confirmOrAdjustStatutoryObligation(id, {
      amount_accrued: amount_accrued,
      variance_note: noteEl ? noteEl.value.trim() : "",
    });
    if (typeof showToast === "function") showToast("Accrued amount confirmed successfully", "success");
    if (typeof closeModal === "function") closeModal("statutoryConfirmModal");
    await loadFinanceStatutory();
  } catch (err) {
    console.error("Failed to confirm statutory obligation:", err);
    if (typeof showToast === "function") showToast(err.message || "Failed to confirm accrual", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// -------------------------------------------------------------
// Settle / Remittance Modal Flow
// -------------------------------------------------------------
async function openStatutorySettleModal(id) {
  const obl = _statutoryObligations.find((o) => o.id === Number(id));
  if (!obl) return;

  _statutoryActiveObligation = obl;
  const idEl = document.getElementById("statSettleId");
  const infoEl = document.getElementById("statSettleObligationInfo");
  const amtEl = document.getElementById("statSettleAmount");
  const dateEl = document.getElementById("statSettleDate");
  const bankEl = document.getElementById("statSettleBankAccount");
  const refEl = document.getElementById("statSettleReference");

  if (idEl) idEl.value = obl.id;

  const remaining = Math.max(0, Number(obl.remaining_balance !== undefined ? obl.remaining_balance : (obl.amount_accrued - (obl.amount_remitted || 0))));
  const typeLabel = OBLIGATION_TYPE_LABELS[obl.obligation_type] || obl.obligation_type.replace(/_/g, " ");

  if (infoEl) {
    infoEl.innerHTML = `
      <div style="font-size:14px; font-weight:700; color:var(--text-primary, #0f172a);">${typeLabel} (${obl.period})</div>
      <div style="display:flex; justify-content:space-between; margin-top:6px; font-size:12px; color:var(--text-muted, #64748b);">
        <span>Total Accrued: <strong>$${obl.amount_accrued.toFixed(2)}</strong></span>
        <span>Already Remitted: <strong>$${(obl.amount_remitted || 0).toFixed(2)}</strong></span>
        <span style="color:#2563eb; font-weight:700;">Remaining: $${remaining.toFixed(2)}</span>
      </div>
    `;
  }

  if (amtEl) {
    amtEl.value = remaining.toFixed(2);
    amtEl.max = remaining;
  }
  if (dateEl) {
    dateEl.value = new Date().toISOString().slice(0, 10);
  }
  if (refEl) {
    refEl.value = `REMIT-${obl.period}-${obl.obligation_type.slice(0, 4).toUpperCase()}`;
  }

  // Populate Bank Accounts
  if (bankEl) {
    bankEl.innerHTML = "";
    try {
      const accounts = await FinanceApi.getAccounts({ is_active: true });
      for (const acc of accounts) {
        const opt = document.createElement("option");
        opt.value = acc.id;
        opt.textContent = `${acc.account_name} (${acc.currency}) - Balance: $${Number(acc.current_balance || 0).toLocaleString()}`;
        bankEl.appendChild(opt);
      }
    } catch (e) {
      console.warn("Failed to load bank accounts for settlement dropdown:", e);
    }
  }

  if (typeof openModal === "function") openModal("statutorySettleModal");
}

async function submitStatutorySettlement() {
  const idEl = document.getElementById("statSettleId");
  const amtEl = document.getElementById("statSettleAmount");
  const dateEl = document.getElementById("statSettleDate");
  const bankEl = document.getElementById("statSettleBankAccount");
  const methodEl = document.getElementById("statSettleMethod");
  const refEl = document.getElementById("statSettleReference");
  const btn = document.getElementById("statSettleSaveBtn");

  if (!idEl || !amtEl || !bankEl) return;
  const id = Number(idEl.value);
  const amount = parseFloat(amtEl.value);
  const bank_account_id = Number(bankEl.value);
  const payment_date = dateEl ? dateEl.value : new Date().toISOString().slice(0, 10);
  const method = methodEl ? methodEl.value : "bank_transfer";
  const reference = refEl ? refEl.value.trim() : "";

  if (isNaN(amount) || amount <= 0) {
    if (typeof showToast === "function") showToast("Please enter a valid payment amount", "error");
    return;
  }
  if (!bank_account_id) {
    if (typeof showToast === "function") showToast("Please select a bank account", "error");
    return;
  }

  if (btn) btn.disabled = true;
  try {
    await FinanceApi.settleStatutoryObligation(id, {
      amount: amount,
      payment_date: payment_date,
      bank_account_id: bank_account_id,
      currency: "USD",
      reference: reference,
      method: method,
    });
    if (typeof showToast === "function") showToast("Statutory remittance recorded successfully", "success");
    if (typeof closeModal === "function") closeModal("statutorySettleModal");
    await loadFinanceStatutory();
  } catch (err) {
    console.error("Failed to settle statutory obligation:", err);
    if (typeof showToast === "function") showToast(err.message || "Failed to record remittance", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// -------------------------------------------------------------
// Manual Record Modal Flow
// -------------------------------------------------------------
function openRecordStatutoryModal() {
  const typeEl = document.getElementById("statRecordType");
  const periodEl = document.getElementById("statRecordPeriod");
  const amtEl = document.getElementById("statRecordAmount");
  const dueEl = document.getElementById("statRecordDueDate");
  const notesEl = document.getElementById("statRecordNotes");

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");

  if (typeEl) typeEl.value = "sales_tax";
  if (periodEl) periodEl.value = `${year}-${month}`;
  if (amtEl) amtEl.value = "";
  if (dueEl) {
    const nextMonth = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
    const nextYear = now.getMonth() === 11 ? year + 1 : year;
    dueEl.value = `${nextYear}-${String(nextMonth).padStart(2, "0")}-15`;
  }
  if (notesEl) notesEl.value = "";

  if (typeof openModal === "function") openModal("statutoryRecordModal");
}

async function submitRecordStatutoryModal() {
  const typeEl = document.getElementById("statRecordType");
  const periodEl = document.getElementById("statRecordPeriod");
  const amtEl = document.getElementById("statRecordAmount");
  const dueEl = document.getElementById("statRecordDueDate");
  const currEl = document.getElementById("statRecordCurrency");
  const notesEl = document.getElementById("statRecordNotes");
  const btn = document.getElementById("statRecordSaveBtn");

  if (!typeEl || !periodEl || !amtEl) return;
  const obligation_type = typeEl.value;
  const period = periodEl.value.trim();
  const amount_accrued = parseFloat(amtEl.value);
  const due_date = dueEl ? dueEl.value : null;
  const currency = currEl ? currEl.value.trim() : "USD";
  const notes = notesEl ? notesEl.value.trim() : "";

  if (!period || !/^\d{4}-\d{2}$/.test(period)) {
    if (typeof showToast === "function") showToast("Please enter a valid period formatted as YYYY-MM", "error");
    return;
  }
  if (isNaN(amount_accrued) || amount_accrued <= 0) {
    if (typeof showToast === "function") showToast("Please enter an accrued amount greater than 0", "error");
    return;
  }

  if (btn) btn.disabled = true;
  try {
    await FinanceApi.createStatutoryObligation({
      obligation_type,
      period,
      amount_accrued,
      due_date,
      currency,
      notes,
    });
    if (typeof showToast === "function") showToast("Statutory obligation recorded successfully", "success");
    if (typeof closeModal === "function") closeModal("statutoryRecordModal");
    await loadFinanceStatutory();
  } catch (err) {
    console.error("Failed to create statutory obligation:", err);
    if (typeof showToast === "function") showToast(err.message || "Failed to record obligation", "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

window.initFinanceStatutory = initFinanceStatutory;
window.loadFinanceStatutory = loadFinanceStatutory;
window.filterFinanceStatutorySearch = filterFinanceStatutorySearch;
window.filterFinanceStatutoryType = filterFinanceStatutoryType;
window.filterFinanceStatutoryStatus = filterFinanceStatutoryStatus;
window.openStatutoryConfirmModal = openStatutoryConfirmModal;
window.calculateStatutoryConfirmVariance = calculateStatutoryConfirmVariance;
window.submitStatutoryConfirmAdjust = submitStatutoryConfirmAdjust;
window.openStatutorySettleModal = openStatutorySettleModal;
window.submitStatutorySettlement = submitStatutorySettlement;
window.openRecordStatutoryModal = openRecordStatutoryModal;
window.submitRecordStatutoryModal = submitRecordStatutoryModal;
