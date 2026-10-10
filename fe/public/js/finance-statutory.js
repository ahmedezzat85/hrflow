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
let _statutoryFilterPeriod = "";
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
    const addBtn = document.getElementById("financeAddStatutoryBtn");
    if (addBtn) {
      const canWrite = typeof SessionInfo !== 'undefined' ? SessionInfo.hasPermission('finance.statutory.write') : true;
      addBtn.style.display = canWrite ? '' : 'none';
    }
    renderFinanceStatutoryTable();
    updateFinanceStatutoryMetrics();
  } catch (err) {
    console.error("Failed to load statutory obligations:", err);
    if (typeof showToast === "function") showToast("Failed to load statutory obligations", "error");
  } finally {
    if (loadingBar) loadingBar.style.display = "none";
  }
}

// One currency per page: obligations are EGP by default (F4). If another currency is present, each
// figure carries its own prefix and the summary is not summed across currencies (it follows the main one).
function _statutoryCurrency() {
  const first = _statutoryObligations.find((o) => o.currency);
  return ((first && first.currency) || "EGP").toUpperCase();
}

function _statutoryMixedCurrency() {
  const set = new Set(_statutoryObligations.map((o) => (o.currency || "EGP").toUpperCase()));
  return set.size > 1;
}

function updateFinanceStatutoryMetrics() {
  const cur = _statutoryCurrency();
  const rows = _statutoryObligations.filter((o) => (o.currency || "EGP").toUpperCase() === cur);
  let estTotal = 0;
  let accTotal = 0;
  let remTotal = 0;
  let varTotal = 0;

  for (const obl of rows) {
    if (obl.status === "estimated") {
      estTotal += Number(obl.amount_accrued || obl.amount_estimated || 0);
    } else if (obl.status === "accrued" || obl.status === "partially_remitted") {
      const rem = Number(obl.remaining_balance !== undefined ? obl.remaining_balance : (obl.amount_accrued - (obl.amount_remitted || 0)));
      accTotal += Math.max(0, rem);
    }
    remTotal += Number(obl.amount_remitted || 0);
    varTotal += Number(obl.variance_amount || 0);
  }

  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = FinanceUI.moneyHtml(v, cur);
  };
  set("statutorySummaryEstimated", estTotal);
  set("statutorySummaryAccrued", accTotal);
  set("statutorySummaryRemitted", remTotal);
  set("statutorySummaryVariance", varTotal);

  // status pill counts and the period list come from the whole list
  const count = (s) => _statutoryObligations.filter((o) => o.status === s).length;
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setText("statPillCountAll", _statutoryObligations.length);
  setText("statPillCountEstimated", count("estimated"));
  setText("statPillCountAccrued", count("accrued"));
  setText("statPillCountRemitted", count("remitted"));
  document.querySelectorAll("#financeStatutoryFilterTabs .fv-pill").forEach((p) => {
    const n = Number((p.querySelector(".fv-pill__count") || {}).textContent || 0);
    p.classList.toggle("fv-pill--zero", !n);
  });
  _populateStatutoryPeriods();
}

// "2026-08" -> "Aug 2026"
function _statutoryPeriodLabel(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ""));
  if (!m) return String(period || "");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1]} ${m[1]}`;
}

// Period select: the periods present in the data plus the last twelve months (so a VAT estimate can be
// generated for any recent month). The chosen value is "YYYY-MM", as the month input was.
function _populateStatutoryPeriods() {
  const sel = document.getElementById("financeVatEstimateMonth");
  if (!sel) return;
  const keep = sel.value;
  const periods = new Set(_statutoryObligations.map((o) => o.period).filter(Boolean));
  const now = new Date();
  for (let i = 0; i < 13; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    periods.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const sorted = [...periods].sort().reverse();
  sel.innerHTML = `<option value="">All periods</option>` + sorted.map((p) => `<option value="${p}">${_statutoryPeriodLabel(p)}</option>`).join("");
  if (keep && periods.has(keep)) sel.value = keep;
}

function filterFinanceStatutoryPeriod(period) {
  _statutoryFilterPeriod = period || "";
  renderFinanceStatutoryTable();
}

// Source tile (doc 21 section 3.3): payroll = sky, sales VAT = teal, bill WHT = orange.
function _statutorySourceTile(obl) {
  const src = obl.source_type || "manual";
  let initials = "ST";
  let hue = "violet";
  if (src === "payroll_run") { initials = "PR"; hue = "sky"; }
  else if (src === "invoice_tax_line" || obl.obligation_type === "sales_tax") { initials = "VT"; hue = "teal"; }
  else if (src === "bill_tax_line" || obl.obligation_type === "withholding_tax") { initials = "WH"; hue = "orange"; }
  return `<span class="fv-avatar fv-hue-${hue}" aria-hidden="true">${initials}</span>`;
}

function _statutorySourceLabel(src) {
  return ({ payroll_run: "Payroll run", invoice_tax_line: "Invoice tax lines", bill_tax_line: "Bill tax lines", manual: "Manual entry" })[src]
    || String(src || "manual").replace(/_/g, " ");
}

function renderFinanceStatutoryTable() {
  const tbody = document.getElementById("financeStatutoryTableBody");
  const empty = document.getElementById("financeStatutoryEmpty");
  const footer = document.getElementById("financeStatutoryFooter");
  if (!tbody) return;

  tbody.innerHTML = "";

  let list = [..._statutoryObligations];
  if (_statutoryFilterStatus !== "all") {
    list = list.filter((o) => o.status === _statutoryFilterStatus);
  }
  if (_statutoryFilterType !== "all") {
    list = list.filter((o) => o.obligation_type === _statutoryFilterType);
  }
  if (_statutoryFilterPeriod) {
    list = list.filter((o) => o.period === _statutoryFilterPeriod);
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
    if (footer) footer.style.display = "none";
    return;
  }
  if (empty) empty.style.display = "none";

  const mixed = _statutoryMixedCurrency();
  const pageCur = _statutoryCurrency();
  const esc = FinanceUI.esc;
  // The currency is stated once in the footer; only a currency different from it is shown on the cell.
  const cell = (v, cur) => {
    const c = (cur || "EGP").toUpperCase();
    return mixed && c !== pageCur ? FinanceUI.moneyHtml(v, c) : esc(FinanceUI.plainNumber(v, c));
  };

  for (const obl of list) {
    const tr = document.createElement("tr");
    const cur = (obl.currency || "EGP").toUpperCase();

    const typeLabel = OBLIGATION_TYPE_LABELS[obl.obligation_type] || obl.obligation_type.replace(/_/g, " ");
    const remaining = Math.max(0, Number(obl.remaining_balance !== undefined ? obl.remaining_balance : (obl.amount_accrued - (obl.amount_remitted || 0))));

    // Variance (true-up) under the remaining amount, in the obligation's own currency
    let varianceNote = "";
    const varAmt = Number(obl.variance_amount || 0);
    if (varAmt !== 0) {
      const sign = varAmt > 0 ? "+" : "";
      varianceNote = `<span class="fv-note fv-note--warn" title="${esc(obl.variance_note || "")}">Variance ${sign}${esc(FinanceFormat.formatMoney(varAmt, cur))}</span>`;
    }

    const status = obl.status === "partially_remitted"
      ? FinanceUI.statusPill("part", "Partially Remitted")
      : FinanceUI.statusPill(obl.status, ({ estimated: "Estimated", accrued: "Accrued", remitted: "Remitted" })[obl.status] || obl.status);

    // Actions
    let actions;
    if (obl.status === "estimated") {
      actions = FinanceUI.rowActions({ primary: { label: "Confirm / Adjust", kind: "fill", className: "btn-stat-confirm", onclick: `openStatutoryConfirmModal(${obl.id})`, attrs: 'title="Confirm or adjust authoritative figure from government portal"' } });
    } else if (obl.status === "accrued" || obl.status === "partially_remitted") {
      actions = FinanceUI.rowActions({ primary: { label: "Remit Payment", kind: "fill", className: "btn-stat-remit", onclick: `openStatutorySettleModal(${obl.id})`, attrs: 'title="Remit government liability"' } });
    } else {
      actions = `<div class="fv-row-actions"><span class="fv-note">Settled</span></div>`;
    }

    tr.innerHTML = `
      <td><div class="fv-cell-main">${_statutorySourceTile(obl)}<div class="fv-cell-main__text"><span class="fv-cell-main__name">${esc(typeLabel)}</span><span class="fv-sub" title="${esc(obl.notes || "")}">${esc(_statutorySourceLabel(obl.source_type))} &middot; ${esc(_statutoryPeriodLabel(obl.period))}${(obl.source_type || "manual") === "manual" && obl.notes ? ` &middot; ${esc(obl.notes)}` : ""}</span></div></div></td>
      <td>${obl.due_date ? esc(FinanceUI.formatDate(obl.due_date)) : "–"}</td>
      <td class="cell-money fv-num fv-muted">${obl.amount_estimated !== null && obl.amount_estimated !== undefined ? cell(obl.amount_estimated, cur) : "–"}</td>
      <td class="cell-money fv-num">${cell(obl.amount_accrued, cur)}</td>
      <td class="cell-money fv-num">${cell(obl.amount_remitted || 0, cur)}</td>
      <td class="cell-money fv-num"><div class="fv-amount"><span class="fv-amount__value">${cell(remaining, cur)}</span>${varianceNote}</div></td>
      <td>${status}</td>
      <td>${actions}</td>
    `;
    tbody.appendChild(tr);
  }

  if (footer) {
    footer.style.display = "";
    const periodVar = list.filter((o) => (o.currency || "EGP").toUpperCase() === pageCur).reduce((n, o) => n + Number(o.variance_amount || 0), 0);
    const varLabel = _statutoryFilterPeriod ? `Variance for ${esc(_statutoryPeriodLabel(_statutoryFilterPeriod))}` : "Variance";
    footer.innerHTML = `<span>${mixed ? "Amounts in their own currency" : `Amounts in ${esc(pageCur)}`} &middot; showing <b>1&ndash;${list.length}</b> of <b>${list.length}</b> obligations</span><span>${varLabel}: <span class="fv-foot__total">${FinanceUI.moneyHtml(periodVar, pageCur)}</span></span>`;
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
    container.querySelectorAll(".filter-tab").forEach((t) => {
      const on = t.dataset.filter === status;
      t.classList.toggle("active", on);
      t.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
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
  if (estEl) estEl.textContent = FinanceFormat.formatMoney(estVal, obl.currency || 'EGP');
  if (accEl) accEl.value = obl.amount_accrued;
  if (varEl) varEl.textContent = FinanceFormat.formatMoney(0, obl.currency || "EGP");
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
  varEl.textContent = `${sign}${FinanceFormat.formatMoney(diff, _statutoryActiveObligation.currency || "EGP")}`;
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
    const c = obl.currency || "EGP";
    infoEl.innerHTML = `
      <div class="fv-summary__name">${FinanceUI.esc(typeLabel)} (${FinanceUI.esc(obl.period)})</div>
      <div class="fv-summary__meta">
        <span>Total Accrued: <strong>${FinanceFormat.formatMoney(obl.amount_accrued, c)}</strong></span>
        <span>Already Remitted: <strong>${FinanceFormat.formatMoney(obl.amount_remitted || 0, c)}</strong></span>
        <span>Remaining: <strong>${FinanceFormat.formatMoney(remaining, c)}</strong></span>
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
      // F4: a remittance is paid from an account in the obligation's currency (no exchange rate); the server enforces it
      const allAccounts = await FinanceApi.getAccounts({ is_active: true });
      const accounts = (allAccounts || []).filter((a) => (a.currency || "").toUpperCase() === (obl.currency || "EGP").toUpperCase());
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

  await refreshStatutoryPaymentTypes();
  if (typeof openModal === "function") openModal("statutorySettleModal");
}

// Outgoing payment types that fit the paying account kind (mirrors be/finance/services/settlement_service.py)
const _STATUTORY_TYPE_CODES = { cash: ["CASH"], bank: ["OUTBOUND_TRANS", "DEBIT_CARD"] };

async function refreshStatutoryPaymentTypes() {
  const typeEl = document.getElementById("statSettlePaymentType");
  const bankEl = document.getElementById("statSettleBankAccount");
  if (!typeEl) return;
  let kind = "bank";
  try {
    const accounts = await FinanceApi.getAccounts({ is_active: true });
    const acc = (accounts || []).find((a) => String(a.id) === String(bankEl ? bankEl.value : ""));
    kind = ((acc && acc.account_type) || "bank").toLowerCase();
    const types = await FinanceApi.getPaymentTypes({ is_active: true });
    const allowed = _STATUTORY_TYPE_CODES[kind] || [];
    typeEl.innerHTML = (types || []).filter((t) => allowed.includes(t.code)).map((t) => `<option value="${t.id}">${FinanceFormat.escapeHtml(t.name)}</option>`).join("");
  } catch (_) {
    typeEl.innerHTML = "";
  }
}
window.refreshStatutoryPaymentTypes = refreshStatutoryPaymentTypes;

async function submitStatutorySettlement() {
  const idEl = document.getElementById("statSettleId");
  const amtEl = document.getElementById("statSettleAmount");
  const dateEl = document.getElementById("statSettleDate");
  const bankEl = document.getElementById("statSettleBankAccount");
  const typeEl = document.getElementById("statSettlePaymentType");
  const refEl = document.getElementById("statSettleReference");
  const btn = document.getElementById("statSettleSaveBtn");

  if (!idEl || !amtEl || !bankEl) return;
  const id = Number(idEl.value);
  const amount = parseFloat(amtEl.value);
  const bank_account_id = Number(bankEl.value);
  const payment_date = dateEl ? dateEl.value : new Date().toISOString().slice(0, 10);
  const payment_type_id = typeEl && typeEl.value ? Number(typeEl.value) : undefined;
  const reference = refEl ? refEl.value.trim() : "";

  if (isNaN(amount) || amount <= 0) {
    if (typeof showToast === "function") showToast("Please enter a valid payment amount", "error");
    return;
  }
  if (!bank_account_id) {
    if (typeof showToast === "function") showToast("Please select a company bank account", "error");
    return;
  }

  if (btn) btn.disabled = true;
  try {
    await FinanceApi.settleStatutoryObligation(id, {
      amount: amount,
      payment_date: payment_date,
      bank_account_id: bank_account_id,
      currency: (_statutoryActiveObligation && _statutoryActiveObligation.currency) || "EGP",
      reference: reference,
      payment_type_id: payment_type_id,
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
// D-023: on-demand monthly VAT estimate from the VAT on EGP invoices issued that month (no scheduler)
async function generateVatEstimateAction() {
  const monthEl = document.getElementById("financeVatEstimateMonth");
  const now = new Date();
  const period = (monthEl && monthEl.value) || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  try {
    const obl = await FinanceApi.generateVatEstimate(period);
    showToast(`VAT estimate for ${period}: ${FinanceFormat.formatMoney ? FinanceFormat.formatMoney(obl.amount_estimated, "EGP") : obl.amount_estimated}`, "success");
    if (typeof loadFinanceStatutory === "function") loadFinanceStatutory();
  } catch (err) {
    showToast("Error: " + (err.message || JSON.stringify(err)), "error");
  }
}
window.generateVatEstimateAction = generateVatEstimateAction;

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
  const currencyEl = document.getElementById("statRecordCurrency");
  if (currencyEl) currencyEl.value = "EGP";

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
  const currency = currEl ? currEl.value.trim() : "EGP";
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
