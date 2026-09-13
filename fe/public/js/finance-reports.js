// ==========================================
// 10. Financial Reports & Excel Export (Phase 8)
// ==========================================
let _currentReportsTab = "category-summary";
let _currentMatrixPeriodGroup = "month";
let _reportTxSearchDebounceTimer = null;

function switchFinanceReportsTab(tabName, btn) {
  _currentReportsTab = tabName;

  // Update tabs
  const subnav = document.getElementById("financeReportsSubNav");
  if (subnav) {
    subnav.querySelectorAll(".filter-tab").forEach((b) => {
      b.classList.remove("active");
      b.setAttribute("aria-selected", "false");
      b.setAttribute("tabindex", "-1");
    });
  }
  const activeBtn = btn || (subnav ? subnav.querySelector(`[data-report-tab="${tabName}"]`) : null);
  if (activeBtn) {
    activeBtn.classList.add("active");
    activeBtn.setAttribute("aria-selected", "true");
    activeBtn.setAttribute("tabindex", "0");
  }

  // Toggle panes
  const panes = {
    "category-summary": "reportPaneCategorySummary",
    matrix: "reportPaneMatrix",
    balances: "reportPaneBalances",
    transactions: "reportPaneTransactions",
    cheques: "reportPaneCheques",
  };

  Object.entries(panes).forEach(([k, paneId]) => {
    const el = document.getElementById(paneId);
    if (el) {
      el.style.display = k === tabName ? "block" : "none";
    }
  });

  // Load active tab data
  if (tabName === "category-summary") {
    loadReportCategorySummary();
  } else if (tabName === "matrix") {
    loadReportMatrix();
  } else if (tabName === "balances") {
    loadReportBalances();
  } else if (tabName === "transactions") {
    loadReportTransactions();
  } else if (tabName === "cheques") {
    loadReportCheques();
  }
}

async function loadFinanceReports() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const today = `${yyyy}-${mm}-${dd}`;
  const firstOfMonth = `${yyyy}-${mm}-01`;

  const dFrom1 = document.getElementById("reportCatSumDateFrom");
  const dTo1 = document.getElementById("reportCatSumDateTo");
  if (dFrom1 && !dFrom1.value) dFrom1.value = firstOfMonth;
  if (dTo1 && !dTo1.value) dTo1.value = today;

  const dAsOf = document.getElementById("reportBalancesAsOfDate");
  if (dAsOf && !dAsOf.value) dAsOf.value = today;

  const dFromTx = document.getElementById("reportTxDateFrom");
  const dToTx = document.getElementById("reportTxDateTo");
  if (dFromTx && !dFromTx.value) dFromTx.value = firstOfMonth;
  if (dToTx && !dToTx.value) dToTx.value = today;

  // Populate account & category dropdowns in transactions pane
  populateReportFilters();

  switchFinanceReportsTab(_currentReportsTab);
}

function populateReportFilters() {
  const accSel = document.getElementById("reportTxAccount");
  if (accSel && accSel.options.length <= 1) {
    (FinanceState.accounts || []).forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      opt.textContent = `${a.account_name} (${a.currency})`;
      accSel.appendChild(opt);
    });
  }

  const catSel = document.getElementById("reportTxCategory");
  if (catSel && catSel.options.length <= 1) {
    (FinanceState.categories || []).forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      opt.textContent = c.name;
      catSel.appendChild(opt);
    });
  }
}

// ----------------------------------------------------------------------
// Category Spend Rollup
// ----------------------------------------------------------------------
async function loadReportCategorySummary() {
  const loading = document.getElementById("reportCatSumLoadingBar");
  if (loading) loading.style.display = "block";

  const dateFrom = document.getElementById("reportCatSumDateFrom")?.value || "";
  const dateTo = document.getElementById("reportCatSumDateTo")?.value || "";
  const currency = document.getElementById("reportCatSumCurrency")?.value || "";

  try {
    const report = await FinanceApi.getCategorySummaryReport({
      date_from: dateFrom,
      date_to: dateTo,
      currency: currency || undefined,
    });

    const totSpentEl = document.getElementById("reportCatSumTotalSpent");
    const catCountEl = document.getElementById("reportCatSumCategoryCount");
    const tbody = document.getElementById("reportCategorySummaryTableBody");
    const empty = document.getElementById("reportCatSumEmpty");

    const total = Number(report.total_spent || 0);
    const reportCurr = currency || report.currency || "USD";
    if (totSpentEl) totSpentEl.textContent = FinanceFormat.formatMoney(total, reportCurr);
    if (catCountEl) catCountEl.textContent = (report.categories || []).length;

    if (!tbody) return;
    tbody.innerHTML = "";

    if (!report.categories || report.categories.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    report.categories.forEach((cat) => {
      const tr = document.createElement("tr");
      const amt = Number(cat.total_amount || 0);
      const pct = Number(cat.percentage || 0);

      tr.innerHTML = `
        <td><strong>${cat.category_name}</strong></td>
        <td><span class="badge ${cat.kind === 'cost' ? 'badge-danger' : 'badge-neutral'}">${(cat.kind || 'cost').toUpperCase()}</span></td>
        <td style="text-align:center;">${cat.transaction_count || 0}</td>
        <td class="cell-money" style="text-align:right; font-weight:600;">${FinanceFormat.renderMoneyHtml(amt, reportCurr)}</td>
        <td>
          <div style="display:flex; align-items:center; gap:10px;">
            <div style="flex:1; height:8px; background:var(--border-color, #E2E8F0); border-radius:4px; overflow:hidden;">
              <div style="width:${Math.min(pct, 100)}%; height:100%; background:#EF4444; border-radius:4px;"></div>
            </div>
            <span style="font-size:0.85rem; font-weight:600; min-width:48px; text-align:right;">${pct.toFixed(1)}%</span>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load category summary:", err);
    showToast(err.message || "Failed to load category spend rollup", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportCategorySummaryExcel() {
  const dateFrom = document.getElementById("reportCatSumDateFrom")?.value || "";
  const dateTo = document.getElementById("reportCatSumDateTo")?.value || "";
  const currency = document.getElementById("reportCatSumCurrency")?.value || "";

  const params = { date_from: dateFrom, date_to: dateTo };
  if (currency) params.currency = currency;

  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/category-summary", params);
  triggerExcelDownload(url, `category_spend_rollup_${dateFrom || 'start'}_to_${dateTo || 'end'}.xlsx`);
}

// ----------------------------------------------------------------------
// Annual Spend Matrix
// ----------------------------------------------------------------------
function setMatrixPeriodGroup(grp, btn) {
  _currentMatrixPeriodGroup = grp;
  const container = document.getElementById("reportMatrixPeriodTabs");
  if (container) {
    container.querySelectorAll(".filter-tab").forEach((b) => b.classList.remove("active"));
  }
  if (btn) btn.classList.add("active");
  loadReportMatrix();
}

async function loadReportMatrix() {
  const loading = document.getElementById("reportMatrixLoadingBar");
  if (loading) loading.style.display = "block";

  const yr = document.getElementById("reportMatrixYear")?.value || "2026";
  const grp = _currentMatrixPeriodGroup || "month";

  try {
    const report = await FinanceApi.getCategoryMatrixReport({ year: yr, period_group: grp });

    const thead = document.getElementById("reportMatrixTableHead");
    const tbody = document.getElementById("reportMatrixTableBody");
    const tfoot = document.getElementById("reportMatrixTableFoot");
    const empty = document.getElementById("reportMatrixEmpty");

    if (!thead || !tbody || !tfoot) return;
    thead.innerHTML = "";
    tbody.innerHTML = "";
    tfoot.innerHTML = "";

    const labels = report.period_labels || [];
    if (!report.rows || report.rows.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    // Header
    const trHead = document.createElement("tr");
    let headHtml = `<th style="min-width:180px;">Category</th>`;
    labels.forEach((lbl) => {
      headHtml += `<th style="text-align:right; min-width:80px;">${lbl}</th>`;
    });
    headHtml += `<th style="text-align:right; min-width:95px;">Total</th><th style="text-align:right; min-width:70px;">% Total</th>`;
    trHead.innerHTML = headHtml;
    thead.appendChild(trHead);

    // Rows
    report.rows.forEach((row) => {
      const tr = document.createElement("tr");
      let rowHtml = `<td><strong>${row.category_name}</strong></td>`;
      labels.forEach((lbl) => {
        const val = Number((row.periods && row.periods[lbl]) || 0);
        rowHtml += `<td class="cell-money" style="text-align:right; font-variant-numeric:tabular-nums;">${val > 0 ? FinanceFormat.formatMoney(val, report.currency || "USD", { decimals: 0 }) : "—"}</td>`;
      });
      const tot = Number(row.total || 0);
      const pct = Number(row.percentage || 0);
      rowHtml += `<td class="cell-money" style="text-align:right; font-weight:700; font-variant-numeric:tabular-nums;">${FinanceFormat.renderMoneyHtml(tot, report.currency || "USD", { decimals: 0 })}</td>`;
      rowHtml += `<td style="text-align:right; color:var(--text-muted); font-size:0.85rem;">${pct.toFixed(1)}%</td>`;
      tr.innerHTML = rowHtml;
      tbody.appendChild(tr);
    });

    // Foot (Totals)
    const trFoot = document.createElement("tr");
    trFoot.style.borderTop = "2px solid var(--border-color, #E2E8F0)";
    trFoot.style.fontWeight = "700";
    let footHtml = `<td>Total Spend</td>`;
    labels.forEach((lbl) => {
      const tot = Number((report.period_totals && report.period_totals[lbl]) || 0);
      footHtml += `<td class="cell-money" style="text-align:right; font-variant-numeric:tabular-nums;">${FinanceFormat.formatMoney(tot, report.currency || "USD", { decimals: 0 })}</td>`;
    });
    const yrTot = Number(report.year_total || 0);
    footHtml += `<td class="cell-money" style="text-align:right; font-variant-numeric:tabular-nums; color:#EF4444;">${FinanceFormat.renderMoneyHtml(yrTot, report.currency || "USD", { decimals: 0 })}</td>`;
    footHtml += `<td style="text-align:right;">100.0%</td>`;
    trFoot.innerHTML = footHtml;
    tfoot.appendChild(trFoot);
  } catch (err) {
    console.error("Failed to load matrix report:", err);
    showToast(err.message || "Failed to load annual spend matrix", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportMatrixExcel() {
  const yr = document.getElementById("reportMatrixYear")?.value || "2026";
  const grp = _currentMatrixPeriodGroup || "month";
  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/category-by-period-matrix", { year: yr, period_group: grp });
  triggerExcelDownload(url, `spend_matrix_${yr}_${grp}.xlsx`);
}

// ----------------------------------------------------------------------
// Point-in-Time Balances
// ----------------------------------------------------------------------
async function loadReportBalances() {
  const loading = document.getElementById("reportBalancesLoadingBar");
  if (loading) loading.style.display = "block";

  const asOfDate = document.getElementById("reportBalancesAsOfDate")?.value || "";

  try {
    const report = await FinanceApi.getBalancesReport({ as_of_date: asOfDate });

    // Render currency rollup summary cards
    const cardsContainer = document.getElementById("reportBalancesCurrencyCards");
    if (cardsContainer) {
      cardsContainer.innerHTML = "";
      Object.entries(report.currency_totals || {}).forEach(([curr, total]) => {
        const cVal = Number(total || 0);
        const card = document.createElement("div");
        card.className = "card";
        card.style.padding = "16px";
        card.style.borderLeft = curr === "USD" ? "4px solid #10B981" : "4px solid #3B82F6";
        card.innerHTML = `
          <div style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase; font-weight:600;">Total ${curr} Liquidity</div>
          <div style="font-size:1.4rem; font-weight:700; color:var(--text-main); margin-top:4px;">
            ${FinanceFormat.formatMoney(cVal, curr)}
          </div>
          <div style="font-size:0.8rem; color:var(--text-muted); margin-top:2px;">As of ${FinanceFormat.formatFinanceDate(report.as_of_date)}</div>
        `;
        cardsContainer.appendChild(card);
      });
    }

    const tbody = document.getElementById("reportBalancesTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    (report.accounts || []).forEach((acc) => {
      const tr = document.createElement("tr");
      const op = Number(acc.opening_balance || 0);
      const bal = Number(acc.balance_as_of_date || 0);
      const isBank = acc.account_type === "bank";

      tr.innerHTML = `
        <td>
          <div style="font-weight:600;">${acc.account_name}</div>
        </td>
        <td>
          <span class="badge ${isBank ? 'badge-neutral' : 'badge-info'}">
            <i class="fa-solid ${isBank ? 'fa-building-columns' : 'fa-wallet'}"></i> ${acc.account_type.toUpperCase()}
          </span>
        </td>
        <td>${acc.bank_name || "—"}</td>
        <td><code style="font-size:0.85rem;">${acc.account_number}</code></td>
        <td>${acc.country || "—"}</td>
        <td><strong>${acc.currency}</strong></td>
        <td class="cell-money" style="text-align:right; color:var(--text-muted);">${FinanceFormat.renderMoneyHtml(op, acc.currency)}</td>
        <td class="cell-money" style="text-align:right; font-weight:700; font-size:1rem;">
          ${FinanceFormat.renderMoneyHtml(bal, acc.currency)}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load balances report:", err);
    showToast(err.message || "Failed to load point-in-time balances", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportBalancesExcel() {
  const asOfDate = document.getElementById("reportBalancesAsOfDate")?.value || "";
  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/balances", { as_of_date: asOfDate });
  triggerExcelDownload(url, `account_balances_as_of_${asOfDate || 'today'}.xlsx`);
}

// ----------------------------------------------------------------------
// Transactions Ledger Report
// ----------------------------------------------------------------------
function debounceReportTxSearch() {
  clearTimeout(_reportTxSearchDebounceTimer);
  _reportTxSearchDebounceTimer = setTimeout(() => {
    loadReportTransactions();
  }, 350);
}

async function loadReportTransactions() {
  const loading = document.getElementById("reportTxLoadingBar");
  if (loading) loading.style.display = "block";

  const dateFrom = document.getElementById("reportTxDateFrom")?.value || "";
  const dateTo = document.getElementById("reportTxDateTo")?.value || "";
  const accId = document.getElementById("reportTxAccount")?.value || "";
  const catId = document.getElementById("reportTxCategory")?.value || "";
  const dir = document.getElementById("reportTxDirection")?.value || "";
  const search = document.getElementById("reportTxSearch")?.value || "";

  const params = {};
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  if (accId) params.account_id = accId;
  if (catId) params.category_id = catId;
  if (dir) params.direction = dir;
  if (search) params.search = search;

  try {
    const report = await FinanceApi.getTransactionsReport(params);

    const inEl = document.getElementById("reportTxTotalInflows");
    const outEl = document.getElementById("reportTxTotalOutflows");
    const netEl = document.getElementById("reportTxNetChange");
    const tbody = document.getElementById("reportTransactionsTableBody");
    const empty = document.getElementById("reportTxEmpty");

    const inflows = Number(report.total_inflows || 0);
    const outflows = Number(report.total_outflows || 0);
    const net = Number(report.net_change || 0);

    if (inEl) inEl.textContent = FinanceFormat.formatMoney(inflows, "USD", { showSign: true });
    if (outEl) outEl.textContent = FinanceFormat.formatMoney(-outflows, "USD");
    if (netEl) {
      netEl.textContent = FinanceFormat.formatMoney(net, "USD", { showSign: true });
      netEl.style.color = net >= 0 ? "#10B981" : "#EF4444";
    }

    if (!tbody) return;
    tbody.innerHTML = "";

    if (!report.transactions || report.transactions.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    report.transactions.forEach((tx) => {
      const tr = document.createElement("tr");
      const isIn = tx.direction === "in";
      const amt = Number(tx.amount || 0);
      const run = Number(tx.running_balance || 0);

      tr.innerHTML = `
        <td style="font-variant-numeric:tabular-nums;">${FinanceFormat.formatFinanceDate(tx.date)}</td>
        <td><strong>${tx.account_name}</strong></td>
        <td>
          <span class="badge ${isIn ? 'badge-success' : 'badge-danger'}">
            <i class="fa-solid ${isIn ? 'fa-arrow-down-long' : 'fa-arrow-up-long'}"></i> ${isIn ? 'INFLOW' : 'OUTFLOW'}
          </span>
        </td>
        <td>${tx.category_name || "—"}</td>
        <td>${tx.payment_type_name || "—"}</td>
        <td>
          <div>${tx.reference || "—"}</div>
          ${tx.description ? `<div style="font-size:0.75rem; color:var(--text-muted);">${tx.description}</div>` : ""}
          ${tx.cheque_number ? `<div style="font-size:0.75rem; color:#6366F1;"><i class="fa-solid fa-money-check"></i> Chq #${tx.cheque_number}</div>` : ""}
        </td>
        <td class="cell-money" style="text-align:right; font-weight:700; font-variant-numeric:tabular-nums;">
          ${FinanceFormat.renderMoneyHtml(isIn ? amt : -amt, tx.currency || "USD", { showSign: true })}
        </td>
        <td class="cell-money" style="text-align:right; color:var(--text-muted); font-variant-numeric:tabular-nums;">
          ${FinanceFormat.renderMoneyHtml(run, tx.currency || "USD")}
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load transactions report:", err);
    showToast(err.message || "Failed to load transactions report", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportTransactionsExcel() {
  const dateFrom = document.getElementById("reportTxDateFrom")?.value || "";
  const dateTo = document.getElementById("reportTxDateTo")?.value || "";
  const accId = document.getElementById("reportTxAccount")?.value || "";
  const catId = document.getElementById("reportTxCategory")?.value || "";
  const dir = document.getElementById("reportTxDirection")?.value || "";
  const search = document.getElementById("reportTxSearch")?.value || "";

  const params = {};
  if (dateFrom) params.date_from = dateFrom;
  if (dateTo) params.date_to = dateTo;
  if (accId) params.account_id = accId;
  if (catId) params.category_id = catId;
  if (dir) params.direction = dir;
  if (search) params.search = search;

  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/transactions", params);
  triggerExcelDownload(url, `transactions_ledger_${dateFrom || 'start'}_to_${dateTo || 'end'}.xlsx`);
}

// ----------------------------------------------------------------------
// Cheques Report
// ----------------------------------------------------------------------
async function loadReportCheques() {
  const loading = document.getElementById("reportChequesLoadingBar");
  if (loading) loading.style.display = "block";

  const yr = document.getElementById("reportChequesFiscalYear")?.value || "2026";
  const st = document.getElementById("reportChequesStatus")?.value || "";

  const params = { fiscal_year: yr };
  if (st) params.status = st;

  try {
    const report = await FinanceApi.getChequesReport(params);

    const s = report.summary || {};
    const bySt = s.by_status || {};

    const totCntEl = document.getElementById("reportChequesTotalCount");
    const totAmtEl = document.getElementById("reportChequesTotalAmount");
    const issCntEl = document.getElementById("reportChequesIssuedCount");
    const issAmtEl = document.getElementById("reportChequesIssuedAmount");
    const clrCntEl = document.getElementById("reportChequesClearedCount");
    const clrAmtEl = document.getElementById("reportChequesClearedAmount");
    const bncCntEl = document.getElementById("reportChequesBouncedVoidedCount");
    const bncAmtEl = document.getElementById("reportChequesBouncedVoidedAmount");

    if (totCntEl) totCntEl.textContent = s.total_count || 0;
    if (totAmtEl) totAmtEl.textContent = FinanceFormat.formatMoney(s.total_amount, "USD");

    const iss = bySt.issued || { count: 0, amount: 0 };
    if (issCntEl) issCntEl.textContent = iss.count;
    if (issAmtEl) issAmtEl.textContent = FinanceFormat.formatMoney(iss.amount, "USD");

    const clr = bySt.cleared || { count: 0, amount: 0 };
    if (clrCntEl) clrCntEl.textContent = clr.count;
    if (clrAmtEl) clrAmtEl.textContent = FinanceFormat.formatMoney(clr.amount, "USD");

    const bnc = Number(bySt.bounced?.count || 0) + Number(bySt.voided?.count || 0);
    const bncAmt = Number(bySt.bounced?.amount || 0) + Number(bySt.voided?.amount || 0);
    if (bncCntEl) bncCntEl.textContent = bnc;
    if (bncAmtEl) bncAmtEl.textContent = FinanceFormat.formatMoney(bncAmt, "USD");

    const tbody = document.getElementById("reportChequesTableBody");
    const empty = document.getElementById("reportChequesEmpty");

    if (!tbody) return;
    tbody.innerHTML = "";

    if (!report.cheques || report.cheques.length === 0) {
      if (empty) empty.style.display = "block";
      return;
    }
    if (empty) empty.style.display = "none";

    report.cheques.forEach((chk) => {
      const tr = document.createElement("tr");
      const amt = Number(chk.amount || 0);

      tr.innerHTML = `
        <td><strong><i class="fa-solid fa-money-check"></i> ${chk.cheque_number}</strong></td>
        <td>${FinanceFormat.formatFinanceDate(chk.issue_date)}</td>
        <td>${FinanceFormat.formatFinanceDate(chk.clear_date)}</td>
        <td>${chk.account_name}</td>
        <td><strong>${chk.payee}</strong></td>
        <td><span style="font-size:0.85rem; color:var(--text-muted);">${(chk.purpose_type || 'other').replace('_', ' ')}</span></td>
        <td class="cell-money" style="text-align:right; font-weight:700;">${FinanceFormat.renderMoneyHtml(amt, chk.currency || "USD")}</td>
        <td>${FinanceFormat.formatStatusBadge("cheque", chk.status)}</td>
        <td style="font-size:0.85rem; color:var(--text-muted);">${chk.notes || "—"}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error("Failed to load cheques report:", err);
    showToast(err.message || "Failed to load cheques report", "error");
  } finally {
    if (loading) loading.style.display = "none";
  }
}

function exportChequesExcel() {
  const yr = document.getElementById("reportChequesFiscalYear")?.value || "2026";
  const st = document.getElementById("reportChequesStatus")?.value || "";
  const params = { fiscal_year: yr };
  if (st) params.status = st;

  const url = FinanceApi.downloadExcelUrl("/api/finance/reports/cheques", params);
  triggerExcelDownload(url, `cheque_register_FY${yr}.xlsx`);
}

function triggerExcelDownload(url, filename) {
  if (typeof _isMock === "function" && _isMock()) {
    showToast(`Excel workbook "${filename}" ready for download!`, "success");
    return;
  }
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Window exports for Phase 8 Reports
window.switchFinanceReportsTab = switchFinanceReportsTab;
window.loadFinanceReports = loadFinanceReports;
window.loadReportCategorySummary = loadReportCategorySummary;
window.exportCategorySummaryExcel = exportCategorySummaryExcel;
window.setMatrixPeriodGroup = setMatrixPeriodGroup;
window.loadReportMatrix = loadReportMatrix;
window.exportMatrixExcel = exportMatrixExcel;
window.loadReportBalances = loadReportBalances;
window.exportBalancesExcel = exportBalancesExcel;
window.loadReportTransactions = loadReportTransactions;
window.debounceReportTxSearch = debounceReportTxSearch;
window.exportTransactionsExcel = exportTransactionsExcel;
window.loadReportCheques = loadReportCheques;
window.exportChequesExcel = exportChequesExcel;
window.triggerExcelDownload = triggerExcelDownload;

