// ==========================================
// 4. Payroll Runs
// ==========================================
async function loadFinancePayroll() {
  const bar = document.getElementById("financePayrollLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const items = await FinanceApi.getPayrollRuns();
    FinanceState.payrollRuns = items;
    renderFinancePayroll(items);
  } catch (err) {
    console.error("Failed to load payroll runs:", err);
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function renderFinancePayroll(items) {
  const tbody = document.getElementById("financePayrollTableBody");
  const empty = document.getElementById("financePayrollEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map(
      (run) => `
    <tr>
      <td><strong>${run.period_label}</strong></td>
      <td>${run.period_start} to ${run.period_end}</td>
      <td>$${Number(run.total_gross || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td><strong>$${Number(run.total_net || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
      <td>$${Number(run.total_employer_cost || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td><span class="badge ${run.status === "paid" ? "badge-approved" : "badge-pending"}">${run.status.toUpperCase()}</span></td>
      <td>
        <button class="btn btn-sm" onclick="showToast('Payroll run ${run.period_label} detail view in Phase 5', 'info')">
          <i class="fa-solid fa-list-check"></i> Details
        </button>
      </td>
    </tr>
  `
    )
    .join("");
}


// ==========================================
// 7. Employee Payslips
// ==========================================
async function loadMyPayslips() {
  const bar = document.getElementById("myPayslipsLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const items = await FinanceApi.getMyPayslips();
    FinanceState.myPayslips = items;
    renderMyPayslips(items);
  } catch (err) {
    console.error("Failed to load my payslips:", err);
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function renderMyPayslips(items) {
  const tbody = document.getElementById("myPayslipsTableBody");
  const empty = document.getElementById("myPayslipsEmpty");
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = items
    .map(
      (ps) => `
    <tr>
      <td><strong>${ps.period_label}</strong></td>
      <td>${FinanceFormat.formatFinanceDate(ps.period_start)} to ${FinanceFormat.formatFinanceDate(ps.period_end)}</td>
      <td class="cell-money">${FinanceFormat.renderMoneyHtml(ps.base_salary, ps.currency || "USD")}</td>
      <td class="cell-money">${FinanceFormat.renderMoneyHtml(ps.allowances_total, ps.currency || "USD")}</td>
      <td class="cell-money">${FinanceFormat.renderMoneyHtml(ps.deductions_total, ps.currency || "USD")}</td>
      <td class="cell-money"><strong>${FinanceFormat.renderMoneyHtml(ps.net_pay, ps.currency || "USD")}</strong></td>
      <td>${FinanceFormat.formatStatusBadge("payroll", "paid")}</td>
      <td>
        <button class="btn btn-sm" onclick="showToast('PDF Payslip download will be available in Phase 5', 'info')">
          <i class="fa-solid fa-file-pdf"></i> Download PDF
        </button>
      </td>
    </tr>
  `
    )
    .join("");
}

function refreshMyPayslips() {
  loadMyPayslips();
  showToast("Payslip records refreshed", "success");
}


// Window exports for Payroll Runs & Payslips
window.loadFinancePayroll = loadFinancePayroll;
window.renderFinancePayroll = renderFinancePayroll;
window.loadMyPayslips = loadMyPayslips;
window.renderMyPayslips = renderMyPayslips;
window.refreshMyPayslips = refreshMyPayslips;
