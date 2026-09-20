// ==========================================
// 4. Net-Payment Guided Payroll Operations
// Conforms to docs/payroll/09-net-payment-runner-implementation-plan.md
// ==========================================

let wizardCurrentStep = 1;
let wizardPreviewData = null;
let wizardIsStale = false;
let wizardExpandedEmployees = new Set();
let currentDetailRun = null;

async function loadFinancePayroll() {
  const bar = document.getElementById("financePayrollLoadingBar");
  if (bar) bar.style.display = "block";

  try {
    const items = await FinanceApi.getPayrollRuns();
    FinanceState.payrollRuns = items || [];
    renderFinancePayroll(FinanceState.payrollRuns);
  } catch (err) {
    console.error("Failed to load payroll runs:", err);
    showToast("Failed to load payroll runs: " + (err.message || err), "error");
  } finally {
    if (bar) bar.style.display = "none";
  }
}

function renderFinancePayroll(items) {
  const tbody = document.getElementById("financePayrollTableBody");
  const empty = document.getElementById("financePayrollEmpty");
  if (!tbody) return;

  const runs = items || [];
  const latestRun = runs.length > 0 ? runs[0] : null;
  const lastRunNetEl = document.getElementById("kpiLastRunNet");
  const lastRunPeriodEl = document.getElementById("kpiLastRunPeriod");
  const activeStaffEl = document.getElementById("kpiActiveStaff");
  const pendingRunsEl = document.getElementById("kpiPendingRuns");
  const ytdPayrollEl = document.getElementById("kpiYtdPayroll");

  if (lastRunNetEl && latestRun) {
    lastRunNetEl.textContent = `$${Number(latestRun.total_net || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (lastRunPeriodEl && latestRun) {
    lastRunPeriodEl.textContent = `Cycle: ${latestRun.period_label}`;
  }

  const staffCount = latestRun ? (latestRun.headcount || (latestRun.lines ? latestRun.lines.length : 0)) : 0;
  if (activeStaffEl) activeStaffEl.textContent = staffCount || "0";

  const pendingCount = runs.filter(r => r.status === "draft" || r.status === "submitted" || r.status === "approved").length;
  if (pendingRunsEl) pendingRunsEl.textContent = pendingCount;

  const ytdTotal = runs
    .filter(r => r.status === "paid" || r.status === "partially_paid")
    .reduce((sum, r) => sum + Number(r.total_net || 0), 0);
  if (ytdPayrollEl) {
    ytdPayrollEl.textContent = `$${ytdTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  if (runs.length === 0) {
    tbody.innerHTML = "";
    if (empty) empty.style.display = "block";
    return;
  }
  if (empty) empty.style.display = "none";

  tbody.innerHTML = runs
    .map((run) => {
      const statusBadge = getStatusBadge(run.status);
      const staff = run.headcount || (run.lines ? run.lines.length : 0);
      const funding = run.external_funding_account_name || run.funding_account_name || run.bank_account_name || "Operating Account";
      const payDate = run.payment_date || run.period_end;
      return `
      <tr>
        <td><strong>${run.period_label}</strong></td>
        <td>${run.period_start} to ${run.period_end} · <span style="color:var(--text-muted); font-size:0.8rem;">Pay: ${payDate}</span></td>
        <td style="text-align:center;"><span class="badge" style="background:#E2E8F0; color:#1E293B;">${staff} staff</span></td>
        <td style="text-align:right;"><strong>$${Number(run.total_net || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
        <td><i class="fa-solid fa-building-columns" style="color:var(--text-muted); margin-right:4px;"></i>${funding}</td>
        <td>${statusBadge}</td>
        <td style="text-align:center;">
          <button class="btn btn-sm btn-outline" onclick="openPayrollRunDetail('${run.id}')" id="btnDetailRun_${run.id}">
            <i class="fa-solid fa-list-check"></i> Details
          </button>
        </td>
      </tr>
    `;
    })
    .join("");
}

function getStatusBadge(status) {
  const s = (status || "draft").toLowerCase();
  switch (s) {
    case "paid":
      return `<span class="badge badge-success" style="background:#10B981; color:#fff;"><i class="fa-solid fa-check"></i> PAID</span>`;
    case "partially_paid":
      return `<span class="badge" style="background:#F59E0B; color:#fff;"><i class="fa-solid fa-circle-exclamation"></i> PARTIAL</span>`;
    case "finalized":
      return `<span class="badge" style="background:#8B5CF6; color:#fff;"><i class="fa-solid fa-lock"></i> FINALIZED</span>`;
    case "approved":
      return `<span class="badge" style="background:#3B82F6; color:#fff;"><i class="fa-solid fa-stamp"></i> APPROVED</span>`;
    case "submitted":
      return `<span class="badge" style="background:#0EA5E9; color:#fff;"><i class="fa-solid fa-paper-plane"></i> SUBMITTED</span>`;
    case "cancelled":
      return `<span class="badge" style="background:#EF4444; color:#fff;">CANCELLED</span>`;
    case "draft":
    default:
      return `<span class="badge" style="background:#94A3B8; color:#fff;">DRAFT</span>`;
  }
}

function filterFinancePayrollRuns() {
  const query = (document.getElementById("financePayrollSearch")?.value || "").toLowerCase().trim();
  const statusFilter = document.getElementById("financePayrollStatusFilter")?.value || "all";

  const filtered = (FinanceState.payrollRuns || []).filter((run) => {
    const matchQuery = !query ||
      (run.period_label && run.period_label.toLowerCase().includes(query)) ||
      (run.period_start && run.period_start.includes(query)) ||
      (run.period_end && run.period_end.includes(query));

    const matchStatus = statusFilter === "all" || (run.status && run.status.toLowerCase() === statusFilter.toLowerCase());

    return matchQuery && matchStatus;
  });

  renderFinancePayroll(filtered);
}

// ==========================================
// 4-Step Net-Payment Runner Wizard
// ==========================================
async function openRunPayrollWizardModal() {
  wizardCurrentStep = 1;
  wizardPreviewData = null;
  wizardIsStale = false;
  wizardExpandedEmployees.clear();

  // Set default cycle month (current YYYY-MM)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const periodInput = document.getElementById("wizardPeriodLabel");
  if (periodInput) {
    periodInput.value = `${year}-${month}`;
    onWizardPeriodChanged(`${year}-${month}`);
  }

  await loadWizardFundingAccounts();

  updateWizardStepView();
  const modal = document.getElementById("runPayrollWizardModal");
  if (modal) modal.style.display = "flex";
  announceLiveMessage("Net-payment payroll runner opened. Step 1: Setup.");
}

async function loadWizardFundingAccounts() {
  const extSelect = document.getElementById("wizardExternalFundingAccount");
  const intSelect = document.getElementById("wizardInternalFundingAccount");
  const fundingSelect = document.getElementById("wizardFundingAccount");
  const errBanner = document.getElementById("wizardAccountErrorBanner");
  const selects = [extSelect, intSelect, fundingSelect].filter(Boolean);

  selects.forEach(s => s.innerHTML = `<option value="">Loading accounts...</option>`);
  if (errBanner) errBanner.style.display = "none";

  try {
    const accounts = (typeof FinanceApi.getAccounts === "function") 
      ? await FinanceApi.getAccounts({ is_active: true }) 
      : ((typeof FinanceApi.getBankAccounts === "function") ? await FinanceApi.getBankAccounts() : []);
    if (accounts && accounts.length > 0) {
      const optionsHtml = accounts
        .map(acc => `<option value="${acc.id}">${acc.bank_name || 'Bank'} - ${acc.account_name} (${acc.account_number_masked || '••••'}) [${acc.currency || 'USD'}]</option>`)
        .join("");
      selects.forEach(s => s.innerHTML = optionsHtml);
      if (intSelect) {
        const cashAcc = accounts.find(a => (a.account_name || '').toLowerCase().includes("cash") || (a.account_type || '').toLowerCase().includes("cash"));
        if (cashAcc) intSelect.value = cashAcc.id;
      }
    } else {
      throw new Error("No funding accounts configured.");
    }
  } catch (e) {
    console.error("Failed to load funding accounts:", e);
    selects.forEach(s => s.innerHTML = `<option value="">Error loading accounts</option>`);
    if (errBanner) errBanner.style.display = "block";
  }
}

function closeRunPayrollWizardModal() {
  const modal = document.getElementById("runPayrollWizardModal");
  if (modal) modal.style.display = "none";
}

function confirmCancelWizard() {
  if (wizardCurrentStep > 1 || wizardIsStale) {
    if (confirm("Discard unsubmitted payroll runner changes and close?")) {
      closeRunPayrollWizardModal();
    }
  } else {
    closeRunPayrollWizardModal();
  }
}

function onWizardPeriodChanged(val) {
  if (!val) return;
  const parts = val.split("-");
  if (parts.length !== 2) return;
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);

  const firstDay = new Date(Date.UTC(y, m - 1, 1)).toISOString().split("T")[0];
  const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().split("T")[0];

  const startEl = document.getElementById("wizardPeriodStart");
  const endEl = document.getElementById("wizardPeriodEnd");
  const payDateEl = document.getElementById("wizardPaymentDate");

  if (startEl) startEl.value = firstDay;
  if (endEl) endEl.value = lastDay;
  if (payDateEl) payDateEl.value = lastDay;

  onWizardSetupInputChanged();
}

function onWizardSetupInputChanged() {
  if (wizardPreviewData) {
    wizardIsStale = true;
    const staleBadge = document.getElementById("wizardStaleWarningBadge");
    if (staleBadge) staleBadge.style.display = "inline-block";
  }
}

async function navigateWizardStep(direction) {
  const nextStep = wizardCurrentStep + direction;
  if (nextStep < 1 || nextStep > 4) return;

  // Moving from Step 1 to Step 2: calculate preview
  if (wizardCurrentStep === 1 && direction > 0) {
    const periodLabel = document.getElementById("wizardPeriodLabel")?.value;
    const periodStart = document.getElementById("wizardPeriodStart")?.value;
    const periodEnd = document.getElementById("wizardPeriodEnd")?.value;
    const paymentDate = document.getElementById("wizardPaymentDate")?.value || periodEnd;
    const extFundingAccountId = document.getElementById("wizardExternalFundingAccount")?.value;
    const intFundingAccountId = document.getElementById("wizardInternalFundingAccount")?.value;

    if (!periodLabel || !periodStart || !periodEnd) {
      showToast("Please fill in cycle period and dates.", "warning");
      return;
    }

    if (!extFundingAccountId || !intFundingAccountId) {
      showToast("Please select valid funding accounts for external and internal payments.", "warning");
      return;
    }

    const nextBtn = document.getElementById("wizardNextBtn");
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Preparing Preview...`;
    }

    try {
      const fxRateSource = document.getElementById("wizardFxRateSource")?.value || "first_of_month";
      const fxRateValStr = document.getElementById("wizardFxRateValue")?.value;
      const fxRateValue = fxRateValStr ? parseFloat(fxRateValStr) : null;

      wizardPreviewData = await FinanceApi.previewPayrollRun({
        period_label: periodLabel,
        period_start: periodStart,
        period_end: periodEnd,
        payment_date: paymentDate,
        bank_account_id: parseInt(extFundingAccountId, 10),
        external_funding_account_id: parseInt(extFundingAccountId, 10),
        internal_funding_account_id: parseInt(intFundingAccountId, 10),
        fx_rate_source: fxRateSource,
        fx_rate_value: fxRateValue,
      });

      wizardIsStale = false;
      const staleBadge = document.getElementById("wizardStaleWarningBadge");
      if (staleBadge) staleBadge.style.display = "none";

      populateWizardData(wizardPreviewData);
      announceLiveMessage(`Preview prepared. Total net payment: $${Number(wizardPreviewData.total_net || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}.`);
    } catch (err) {
      console.error("Preview error:", err);
      showToast("Failed to preview payments: " + (err.message || err), "error");
      return;
    } finally {
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.innerHTML = `Next <i class="fa-solid fa-arrow-right"></i>`;
      }
    }
  }

  // Moving from Step 3 to Step 4: block if blocking issues exist
  if (wizardCurrentStep === 3 && direction > 0) {
    const hasBlockers = (wizardPreviewData?.exceptions || []).some(e => e.severity === "blocking" && !e.is_resolved);
    if (hasBlockers) {
      showToast("Cannot advance to confirmation while blocking issues exist. Resolve them first.", "error");
      return;
    }
  }

  wizardCurrentStep = nextStep;
  updateWizardStepView();
}

function updateWizardStepView() {
  for (let i = 1; i <= 4; i++) {
    const panel = document.getElementById(`wizardStep${i}`);
    const pill = document.getElementById(`stepPill${i}`);
    if (panel) panel.style.display = i === wizardCurrentStep ? "block" : "none";
    if (pill) {
      if (i === wizardCurrentStep) {
        pill.classList.add("active");
        pill.style.color = "var(--primary, #2563EB)";
        const numSpan = pill.querySelector(".step-num");
        if (numSpan) {
          numSpan.style.background = "var(--primary, #2563EB)";
          numSpan.style.color = "#fff";
        }
      } else if (i < wizardCurrentStep) {
        pill.classList.remove("active");
        pill.style.color = "#10B981";
        const numSpan = pill.querySelector(".step-num");
        if (numSpan) {
          numSpan.style.background = "#10B981";
          numSpan.style.color = "#fff";
        }
      } else {
        pill.classList.remove("active");
        pill.style.color = "var(--text-muted, #94A3B8)";
        const numSpan = pill.querySelector(".step-num");
        if (numSpan) {
          numSpan.style.background = "var(--border-color, #CBD5E1)";
          numSpan.style.color = "#fff";
        }
      }
    }
  }

  const prevBtn = document.getElementById("wizardPrevBtn");
  const nextBtn = document.getElementById("wizardNextBtn");
  if (prevBtn) prevBtn.style.display = wizardCurrentStep > 1 ? "inline-block" : "none";
  if (nextBtn) nextBtn.style.display = wizardCurrentStep < 4 ? "inline-block" : "none";

  announceLiveMessage(`Wizard step ${wizardCurrentStep} active.`);
}

function populateWizardData(preview) {
  if (!preview) return;

  // Step 2 Summary Metrics
  const totalNetEl = document.getElementById("wizardReviewTotalNet");
  const recipCountEl = document.getElementById("wizardReviewRecipientCount");
  const netDeltaEl = document.getElementById("wizardReviewNetDelta");
  const issueCountsEl = document.getElementById("wizardReviewIssueCounts");
  const additionsTotalEl = document.getElementById("wizardReviewAdditionsTotal");

  if (totalNetEl) totalNetEl.textContent = `$${Number(preview.total_net || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (recipCountEl) recipCountEl.textContent = preview.recipient_count || preview.headcount || 0;

  const totalAdditions = Number(preview.total_additions !== undefined ? preview.total_additions : ((preview.total_commissions || 0) + (preview.total_bonuses || 0)));
  if (additionsTotalEl) {
    additionsTotalEl.textContent = `+$${totalAdditions.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  }

  if (preview.variance_summary) {
    const v = preview.variance_summary;
    if (netDeltaEl) {
      const sign = (v.net_delta || 0) >= 0 ? "+" : "";
      netDeltaEl.textContent = `${sign}$${Number(v.net_delta || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
      netDeltaEl.style.color = (v.net_delta || 0) >= 0 ? "#10B981" : "#EF4444";
    }
  }

  const exceptions = preview.exceptions || [];
  const blockers = exceptions.filter(e => e.severity === "blocking" && !e.is_resolved);
  const warnings = exceptions.filter(e => e.severity === "warning");

  if (issueCountsEl) {
    if (blockers.length > 0) {
      issueCountsEl.innerHTML = `<span class="badge" style="background:#EF4444; color:#fff; white-space:nowrap;"><i class="fa-solid fa-ban"></i> ${blockers.length} Blocker(s)</span>`;
    } else if (warnings.length > 0) {
      issueCountsEl.innerHTML = `<span class="badge" style="background:#F59E0B; color:#fff; white-space:nowrap;"><i class="fa-solid fa-triangle-exclamation"></i> ${warnings.length} Warning(s)</span>`;
    } else {
      issueCountsEl.innerHTML = `<span class="badge badge-success" style="background:#10B981; color:#fff; white-space:nowrap;"><i class="fa-solid fa-check"></i> All Ready</span>`;
    }
  }

  // Populate Step 2 Recipients Table
  renderWizardRecipientsTable(preview);

  // Populate Step 3 Readiness Issues
  populateWizardReadiness(preview);

  // Populate Step 4 Confirmation
  populateWizardConfirmation(preview);
}

let wizardSessionSource = "INT"; // Remembers last selected payment source in current runner session
let currentDetailEmpId = null;

function _extractRecipientsFromPreview(preview) {
  if (preview && preview.recipients && preview.recipients.length > 0) {
    return preview.recipients;
  }
  const lines = (preview && preview.lines) || [];
  const allAdjs = (preview && preview.adjustments) || [];
  const grouped = {};

  lines.forEach(l => {
    if (!grouped[l.employee_id]) {
      grouped[l.employee_id] = {
        employee_id: l.employee_id,
        employee_name: l.employee_name || `Employee #${l.employee_id}`,
        department: l.department || "General",
        base_int_amount: 0,
        base_ext_amount: 0,
        int_adjustments_total: 0,
        ext_adjustments_total: 0,
        final_int_amount: 0,
        final_ext_amount: 0,
        final_payment_amount: 0,
        adjustments: [],
        bank_name: l.bank_name,
        destination_masked: l.bank_account_masked,
      };
    }
    const amt = Number(l.net_pay || 0);
    if (l.compensation_type === "external_usd") {
      grouped[l.employee_id].base_ext_amount += amt;
    } else {
      grouped[l.employee_id].base_int_amount += amt;
    }
    if (l.bank_name) grouped[l.employee_id].bank_name = l.bank_name;
    if (l.bank_account_masked) grouped[l.employee_id].destination_masked = l.bank_account_masked;
  });

  Object.values(grouped).forEach(r => {
    const empAdjs = allAdjs.filter(a => a.employee_id === r.employee_id);
    r.adjustments = empAdjs;
    r.int_adjustments_total = empAdjs.filter(a => a.payment_source === "INT").reduce((s, a) => s + Number(a.amount || 0), 0);
    r.ext_adjustments_total = empAdjs.filter(a => a.payment_source === "EXT").reduce((s, a) => s + Number(a.amount || 0), 0);
    r.final_int_amount = r.base_int_amount + r.int_adjustments_total;
    r.final_ext_amount = r.base_ext_amount + r.ext_adjustments_total;
    r.final_payment_amount = r.final_int_amount + r.final_ext_amount;
  });

  return Object.values(grouped);
}

function renderWizardRecipientsTable(preview) {
  const tbody = document.getElementById("wizardEmployeesPreviewTableBody");
  if (!tbody || !preview) return;

  const recipients = _extractRecipientsFromPreview(preview);
  const query = (document.getElementById("wizardReviewSearch")?.value || "").toLowerCase().trim();
  const routeFilter = document.getElementById("wizardReviewRouteFilter")?.value || "all";
  const statusFilter = document.getElementById("wizardReviewStatusFilter")?.value || "all";

  const filtered = recipients.filter(emp => {
    const matchQuery = !query ||
      emp.employee_name.toLowerCase().includes(query) ||
      (emp.destination_masked && emp.destination_masked.toLowerCase().includes(query)) ||
      (emp.department && emp.department.toLowerCase().includes(query));

    const hasExt = Number(emp.final_ext_amount || emp.base_ext_amount || 0) > 0;
    const hasInt = Number(emp.final_int_amount || emp.base_int_amount || 0) > 0;

    const matchRoute = routeFilter === "all" ||
      (routeFilter === "external_usd" && hasExt) ||
      (routeFilter === "internal_usd_cash" && hasInt);

    const empExceptions = (preview.exceptions || []).filter(e => e.employee_id === emp.employee_id);
    const hasIssue = empExceptions.length > 0;
    const matchStatus = statusFilter === "all" ||
      (statusFilter === "issue" && hasIssue) ||
      (statusFilter === "ready" && !hasIssue);

    return matchQuery && matchRoute && matchStatus;
  });

  const emptyEl = document.getElementById("wizardRecipientsEmptyState");
  if (filtered.length === 0) {
    tbody.innerHTML = "";
    if (emptyEl) emptyEl.style.display = "block";
    return;
  }
  if (emptyEl) emptyEl.style.display = "none";

  tbody.innerHTML = filtered.map(emp => {
    const empExceptions = (preview.exceptions || []).filter(e => e.employee_id === emp.employee_id);
    const hasBlocker = empExceptions.some(e => e.severity === "blocking");
    const hasWarning = empExceptions.some(e => e.severity === "warning");

    let statusChip = `<span class="badge badge-success" style="background:#10B981; color:#fff; font-size:0.75rem; white-space:nowrap;"><i class="fa-solid fa-check"></i> Ready</span>`;
    if (hasBlocker) {
      statusChip = `<span class="badge" style="background:#EF4444; color:#fff; font-size:0.75rem; white-space:nowrap;"><i class="fa-solid fa-ban"></i> Action Needed</span>`;
    } else if (hasWarning) {
      statusChip = `<span class="badge" style="background:#F59E0B; color:#fff; font-size:0.75rem; white-space:nowrap;"><i class="fa-solid fa-triangle-exclamation"></i> Warning</span>`;
    }

    const extAmt = Number(emp.final_ext_amount || 0);
    const intAmt = Number(emp.final_int_amount || 0);
    let routeCompact = "";
    if (extAmt > 0 && intAmt > 0) {
      routeCompact = `EXT ($${extAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })}) · INT ($${intAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })})`;
    } else if (extAmt > 0) {
      routeCompact = `EXT ($${extAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })})`;
    } else {
      routeCompact = `INT ($${intAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })})`;
    }

    let destination = "";
    if (extAmt > 0) {
      if (emp.destination_masked) {
        destination = `${emp.bank_name ? emp.bank_name + ' ' : ''}(${emp.destination_masked})`;
      } else {
        destination = `<span class="badge" style="background:#FEE2E2; color:#991B1B; font-size:0.75rem;">Missing Destination</span>`;
      }
    } else {
      destination = `<span style="color:var(--text-muted);">Internal Cash</span>`;
    }

    const empAdjs = emp.adjustments || [];
    let adjSummaryHtml = "";
    if (empAdjs.length > 0) {
      const parts = empAdjs.map(a => `+$${Number(a.amount).toLocaleString("en-US", { minimumFractionDigits: 0 })} ${a.type === 'COMMISSION' ? 'Comm' : 'Bonus'} (${a.payment_source})`);
      adjSummaryHtml = `<div style="font-size:0.75rem; color:#8B5CF6; font-weight:600; margin-top:2px; white-space:nowrap;">${parts.join(" · ")}</div>`;
    }

    const finalPay = Number(emp.final_payment_amount || (extAmt + intAmt));

    return `
      <tr class="recipient-review-row" style="border-bottom:1px solid var(--border-color, #E2E8F0);">
        <td data-label="Recipient" style="padding:10px 12px;"><strong>${emp.employee_name}</strong></td>
        <td data-label="Department" style="padding:10px 12px; color:var(--text-muted);">${emp.department || 'General'}</td>
        <td data-label="Payment Route" style="padding:10px 12px;"><span class="badge" style="background:#F1F5F9; color:#0F172A; font-size:0.8rem; white-space:nowrap; font-variant-numeric:tabular-nums;">${routeCompact}</span></td>
        <td data-label="Destination" style="padding:10px 12px; font-variant-numeric:tabular-nums;">${destination}</td>
        <td data-label="Final Amount" style="padding:10px 12px; text-align:right;">
          <div style="font-weight:700; color:var(--primary, #2563EB); font-size:0.95rem; white-space:nowrap; font-variant-numeric:tabular-nums;">$${finalPay.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
          ${adjSummaryHtml}
        </td>
        <td data-label="Readiness" style="padding:10px 12px; text-align:center;">${statusChip}</td>
        <td data-label="Action" style="padding:10px 12px; text-align:center;">
          <button type="button" class="btn btn-sm btn-outline btn-view-recipient" onclick="openWizardRecipientDetails(${emp.employee_id})" style="padding:6px 12px; font-size:0.8rem; min-height:36px; display:inline-flex; align-items:center; gap:5px; white-space:nowrap;">
            <i class="fa-solid fa-eye"></i> View
          </button>
        </td>
      </tr>
    `;
  }).join("");
}

function filterWizardRecipients() {
  if (wizardPreviewData) {
    renderWizardRecipientsTable(wizardPreviewData);
  }
}

// -----------------------------------------------------------------------------
// Commission / Bonus Adjustment Modal Handlers
// -----------------------------------------------------------------------------
function openWizardAdjustmentModal(empId = null, adjustmentId = null) {
  const modal = document.getElementById("wizardAdjustmentModal");
  if (!modal || !wizardPreviewData) return;

  const empSelect = document.getElementById("wizardAdjEmployeeSelect");
  if (empSelect) {
    empSelect.innerHTML = `<option value="">Select Staff Member...</option>`;
    const recipients = _extractRecipientsFromPreview(wizardPreviewData);
    recipients.forEach(r => {
      const opt = document.createElement("option");
      opt.value = r.employee_id;
      opt.textContent = `${r.employee_name} (${r.department || 'General'})`;
      if (empId && String(r.employee_id) === String(empId)) {
        opt.selected = true;
      }
      empSelect.appendChild(opt);
    });
  }

  const idField = document.getElementById("wizardAdjId");
  const typeField = document.getElementById("wizardAdjType");
  const amountField = document.getElementById("wizardAdjAmount");
  const descField = document.getElementById("wizardAdjDescription");
  const refField = document.getElementById("wizardAdjExternalRef");
  const deleteBtn = document.getElementById("btnDeleteWizardAdjustment");
  const titleEl = document.getElementById("wizardAdjustmentModalTitle");

  if (adjustmentId) {
    // Edit mode
    const allAdjs = wizardPreviewData.adjustments || [];
    const adj = allAdjs.find(a => a.id === adjustmentId);
    if (adj) {
      if (idField) idField.value = adj.id;
      if (empSelect) empSelect.value = adj.employee_id;
      if (typeField) typeField.value = adj.type;
      if (amountField) amountField.value = adj.amount;
      if (descField) descField.value = adj.description || "";
      if (refField) refField.value = adj.external_reference || "";
      const sourceInt = document.getElementById("wizardAdjSourceINT");
      const sourceExt = document.getElementById("wizardAdjSourceEXT");
      if (adj.payment_source === "EXT") {
        if (sourceExt) sourceExt.checked = true;
      } else {
        if (sourceInt) sourceInt.checked = true;
      }
      if (deleteBtn) deleteBtn.style.display = "inline-flex";
      if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-pen-to-square" style="color:var(--primary, #2563EB);"></i> Edit Commission / Bonus`;
    }
  } else {
    // Add mode
    if (idField) idField.value = "";
    if (typeField) typeField.value = "COMMISSION";
    if (amountField) amountField.value = "";
    if (descField) descField.value = "";
    if (refField) refField.value = "";
    const sourceInt = document.getElementById("wizardAdjSourceINT");
    const sourceExt = document.getElementById("wizardAdjSourceEXT");
    if (wizardSessionSource === "EXT") {
      if (sourceExt) sourceExt.checked = true;
    } else {
      if (sourceInt) sourceInt.checked = true;
    }
    if (deleteBtn) deleteBtn.style.display = "none";
    if (titleEl) titleEl.innerHTML = `<i class="fa-solid fa-plus-circle" style="color:var(--primary, #2563EB);"></i> Add Commission / Bonus`;
  }

  modal.style.display = "flex";
}

function closeWizardAdjustmentModal() {
  const modal = document.getElementById("wizardAdjustmentModal");
  if (modal) modal.style.display = "none";
}

async function handleWizardAdjustmentSubmit(event) {
  event.preventDefault();
  if (!wizardPreviewData) return;

  const adjId = document.getElementById("wizardAdjId")?.value;
  const empId = parseInt(document.getElementById("wizardAdjEmployeeSelect")?.value, 10);
  const type = document.getElementById("wizardAdjType")?.value;
  const amount = parseFloat(document.getElementById("wizardAdjAmount")?.value);
  const source = document.querySelector('input[name="wizardAdjSource"]:checked')?.value || "INT";
  const description = document.getElementById("wizardAdjDescription")?.value || "";
  const externalRef = document.getElementById("wizardAdjExternalRef")?.value || null;

  if (!empId) {
    showToast("Please select a recipient.", "error");
    return;
  }
  if (isNaN(amount) || amount <= 0) {
    showToast("Adjustment amount must be greater than zero.", "error");
    return;
  }

  wizardSessionSource = source;

  const saveBtn = document.getElementById("btnSaveWizardAdjustment");
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Saving...`;
  }

  try {
    const previewId = wizardPreviewData.preview_id;
    if (adjId) {
      await FinanceApi.updatePreviewAdjustment(previewId, adjId, {
        employee_id: empId,
        type: type,
        direction: "ADDITION",
        amount: amount,
        payment_source: source,
        description: description,
        external_reference: externalRef,
      });
      showToast("Adjustment updated successfully.", "success");
    } else {
      await FinanceApi.addPreviewAdjustment(previewId, {
        employee_id: empId,
        type: type,
        direction: "ADDITION",
        amount: amount,
        payment_source: source,
        description: description,
        external_reference: externalRef,
      });
      showToast("Adjustment added successfully.", "success");
    }

    const refreshed = await FinanceApi.getPreview(previewId);
    wizardPreviewData = refreshed;
    populateWizardData(refreshed);
    closeWizardAdjustmentModal();

    const detailModal = document.getElementById("wizardRecipientDetailModal");
    if (detailModal && detailModal.style.display !== "none") {
      openWizardRecipientDetails(empId);
    }
  } catch (err) {
    console.error("Adjustment error:", err);
    showToast("Failed to save adjustment: " + (err.message || err), "error");
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = `<i class="fa-solid fa-check"></i> Save Adjustment`;
    }
  }
}

async function handleWizardAdjustmentDelete() {
  const adjId = document.getElementById("wizardAdjId")?.value;
  if (!adjId || !wizardPreviewData) return;

  const empId = parseInt(document.getElementById("wizardAdjEmployeeSelect")?.value, 10);
  const deleteBtn = document.getElementById("btnDeleteWizardAdjustment");
  if (deleteBtn) {
    deleteBtn.disabled = true;
    deleteBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i>`;
  }

  try {
    const previewId = wizardPreviewData.preview_id;
    await FinanceApi.deletePreviewAdjustment(previewId, adjId);
    showToast("Adjustment removed.", "success");

    const refreshed = await FinanceApi.getPreview(previewId);
    wizardPreviewData = refreshed;
    populateWizardData(refreshed);
    closeWizardAdjustmentModal();

    const detailModal = document.getElementById("wizardRecipientDetailModal");
    if (detailModal && detailModal.style.display !== "none" && empId) {
      openWizardRecipientDetails(empId);
    }
  } catch (err) {
    console.error("Failed to delete adjustment:", err);
    showToast("Failed to delete adjustment: " + (err.message || err), "error");
  } finally {
    if (deleteBtn) {
      deleteBtn.disabled = false;
      deleteBtn.innerHTML = `<i class="fa-solid fa-trash"></i> Remove`;
    }
  }
}

// -----------------------------------------------------------------------------
// Recipient Payment Details Modal Handlers
// -----------------------------------------------------------------------------
function openWizardRecipientDetails(empId) {
  currentDetailEmpId = empId;
  const modal = document.getElementById("wizardRecipientDetailModal");
  if (!modal || !wizardPreviewData) return;

  const recipients = _extractRecipientsFromPreview(wizardPreviewData);
  const emp = recipients.find(r => r.employee_id === empId);
  if (!emp) return;

  const nameEl = document.getElementById("recipientDetailName");
  const deptEl = document.getElementById("recipientDetailDept");
  if (nameEl) nameEl.textContent = emp.employee_name;
  if (deptEl) deptEl.textContent = `${emp.department || 'General'} · ID #${emp.employee_id}`;

  const baseTotal = Number(emp.base_int_amount || 0) + Number(emp.base_ext_amount || 0);
  const baseTotEl = document.getElementById("recipientDetailBaseTotal");
  const baseSplitEl = document.getElementById("recipientDetailBaseSplit");
  if (baseTotEl) baseTotEl.textContent = `$${baseTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (baseSplitEl) baseSplitEl.textContent = `EXT: $${Number(emp.base_ext_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} · INT: $${Number(emp.base_int_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  const addTotal = Number(emp.ext_adjustments_total || 0) + Number(emp.int_adjustments_total || 0);
  const addTotEl = document.getElementById("recipientDetailAdditionsTotal");
  const addSplitEl = document.getElementById("recipientDetailAdditionsSplit");
  if (addTotEl) addTotEl.textContent = `+$${addTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (addSplitEl) addSplitEl.textContent = `EXT: $${Number(emp.ext_adjustments_total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} · INT: $${Number(emp.int_adjustments_total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  const finalTotal = Number(emp.final_payment_amount || (baseTotal + addTotal));
  const finalTotEl = document.getElementById("recipientDetailFinalTotal");
  const finalSplitEl = document.getElementById("recipientDetailFinalSplit");
  if (finalTotEl) finalTotEl.textContent = `$${finalTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (finalSplitEl) finalSplitEl.textContent = `EXT: $${Number(emp.final_ext_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} · INT: $${Number(emp.final_int_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  const destText = emp.bank_name ? `${emp.bank_name} (${emp.destination_masked || '••••'})` : 'Internal Cash Drawer';
  const destEl = document.getElementById("recipientDetailDestinationText");
  if (destEl) destEl.textContent = destText;

  const empExceptions = (wizardPreviewData.exceptions || []).filter(e => e.employee_id === emp.employee_id);
  const hasBlocker = empExceptions.some(e => e.severity === "blocking");
  const hasWarning = empExceptions.some(e => e.severity === "warning");

  const badgeContainer = document.getElementById("recipientDetailReadinessBadge");
  if (badgeContainer) {
    if (hasBlocker) {
      badgeContainer.innerHTML = `<span class="badge" style="background:#EF4444; color:#fff; white-space:nowrap;"><i class="fa-solid fa-ban"></i> Action Needed</span>`;
    } else if (hasWarning) {
      badgeContainer.innerHTML = `<span class="badge" style="background:#F59E0B; color:#fff; white-space:nowrap;"><i class="fa-solid fa-triangle-exclamation"></i> Warning</span>`;
    } else {
      badgeContainer.innerHTML = `<span class="badge badge-success" style="background:#10B981; color:#fff; white-space:nowrap;"><i class="fa-solid fa-check"></i> Ready</span>`;
    }
  }

  const alertBox = document.getElementById("recipientDetailIssuesAlert");
  if (alertBox) {
    if (empExceptions.length > 0) {
      alertBox.style.display = "block";
      alertBox.innerHTML = empExceptions.map(e => `<div><strong>${e.title}:</strong> ${e.description}</div>`).join("");
    } else {
      alertBox.style.display = "none";
    }
  }

  const adjsList = document.getElementById("recipientDetailAdjustmentsList");
  if (adjsList) {
    const empAdjs = emp.adjustments || [];
    if (empAdjs.length === 0) {
      adjsList.innerHTML = `<div style="color:var(--text-muted); font-size:0.85rem; padding:10px; background:var(--bg-secondary, #F8FAFC); border-radius:6px; text-align:center;">No commissions or bonuses recorded for this period.</div>`;
    } else {
      adjsList.innerHTML = empAdjs.map(a => `
        <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 14px; background:var(--bg-secondary, #F8FAFC); border:1px solid var(--border-color, #E2E8F0); border-radius:6px;">
          <div>
            <div style="display:flex; align-items:center; gap:8px;">
              <span class="badge" style="background:${a.type === 'COMMISSION' ? '#8B5CF6' : '#3B82F6'}; color:#fff; font-size:0.75rem;">${a.type}</span>
              <span class="badge" style="background:#E2E8F0; color:#1E293B; font-size:0.75rem;">${a.payment_source}</span>
              <strong style="font-size:0.9rem;">$${Number(a.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>
            </div>
            <div style="font-size:0.8rem; color:var(--text-muted); margin-top:3px;">${a.description || 'No description'}</div>
          </div>
          <div style="display:flex; gap:6px;">
            <button type="button" class="btn btn-sm btn-outline" onclick="openWizardAdjustmentModal(${emp.employee_id}, '${a.id}')" style="padding:2px 8px; font-size:0.75rem;">
              <i class="fa-solid fa-pen"></i> Edit
            </button>
            <button type="button" class="btn btn-sm btn-outline" onclick="deleteAdjustmentFromDetail('${a.id}', ${emp.employee_id})" style="padding:2px 8px; font-size:0.75rem; color:#EF4444; border-color:#EF4444;">
              <i class="fa-solid fa-trash"></i>
            </button>
          </div>
        </div>
      `).join("");
    }
  }

  modal.style.display = "flex";
}

function openWizardAdjustmentForCurrentRecipient() {
  if (currentDetailEmpId) {
    openWizardAdjustmentModal(currentDetailEmpId);
  }
}

function closeWizardRecipientDetailModal() {
  const modal = document.getElementById("wizardRecipientDetailModal");
  if (modal) modal.style.display = "none";
}

async function deleteAdjustmentFromDetail(adjId, empId) {
  if (!confirm("Are you sure you want to remove this adjustment?")) return;
  if (!wizardPreviewData) return;
  try {
    await FinanceApi.deletePreviewAdjustment(wizardPreviewData.preview_id, adjId);
    showToast("Adjustment removed.", "success");
    const refreshed = await FinanceApi.getPreview(wizardPreviewData.preview_id);
    wizardPreviewData = refreshed;
    populateWizardData(refreshed);
    openWizardRecipientDetails(empId);
  } catch (err) {
    console.error("Failed to delete adjustment:", err);
    showToast("Failed to delete adjustment: " + (err.message || err), "error");
  }
}

function populateWizardReadiness(preview) {
  const banner = document.getElementById("wizardExceptionsBanner");
  const blockersSec = document.getElementById("wizardBlockersSection");
  const blockersList = document.getElementById("wizardBlockersList");
  const warningsSec = document.getElementById("wizardWarningsSection");
  const warningsList = document.getElementById("wizardWarningsList");
  const cleanState = document.getElementById("wizardExceptionsClean");

  const exceptions = preview.exceptions || [];
  const blockers = exceptions.filter(e => e.severity === "blocking" && !e.is_resolved);
  const warnings = exceptions.filter(e => e.severity === "warning");

  if (exceptions.length === 0) {
    if (banner) banner.style.display = "none";
    if (blockersSec) blockersSec.style.display = "none";
    if (warningsSec) warningsSec.style.display = "none";
    if (cleanState) cleanState.style.display = "block";
    return;
  }

  if (cleanState) cleanState.style.display = "none";

  if (banner) {
    banner.style.display = "block";
    if (blockers.length > 0) {
      banner.style.background = "#FEF2F2";
      banner.style.border = "1px solid #FCA5A5";
      banner.style.color = "#991B1B";
      banner.innerHTML = `<i class="fa-solid fa-ban"></i> <strong>${blockers.length} Blocking Issue(s):</strong> Must be corrected before submitting for approval.`;
    } else {
      banner.style.background = "#FFFBEB";
      banner.style.border = "1px solid #FCD34D";
      banner.style.color = "#92400E";
      banner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>${warnings.length} Warning(s):</strong> Review and acknowledge warnings prior to submission.`;
    }
  }

  if (blockersSec && blockersList) {
    if (blockers.length > 0) {
      blockersSec.style.display = "block";
      blockersList.innerHTML = blockers.map(e => `
        <div class="card" style="padding:14px; border-left:4px solid #EF4444; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <div style="font-weight:700; color:#991B1B; font-size:0.9rem;">${e.employee_name || 'Staff'}: ${e.title}</div>
            <div style="font-size:0.85rem; color:var(--text-muted); margin-top:2px;">${e.description}</div>
          </div>
          ${e.correction_path ? `<a href="${e.correction_path}" target="_blank" class="btn btn-sm btn-outline" style="border-color:#EF4444; color:#EF4444;"><i class="fa-solid fa-arrow-up-right-from-square"></i> Fix Employee</a>` : ''}
        </div>
      `).join("");
    } else {
      blockersSec.style.display = "none";
    }
  }

  if (warningsSec && warningsList) {
    if (warnings.length > 0) {
      warningsSec.style.display = "block";
      warningsList.innerHTML = warnings.map(e => `
        <div class="card" style="padding:14px; border-left:4px solid #F59E0B; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div>
            <div style="font-weight:700; color:#92400E; font-size:0.9rem;">${e.employee_name || 'Notice'}: ${e.title}</div>
            <div style="font-size:0.85rem; color:var(--text-muted); margin-top:2px;">${e.description}</div>
          </div>
          <span class="badge" style="background:#F59E0B; color:#fff;">Review</span>
        </div>
      `).join("");
    } else {
      warningsSec.style.display = "none";
    }
  }
}

async function recheckWizardReadiness() {
  const btn = document.getElementById("btnWizardRecheck");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Rechecking...`;
  }

  try {
    const periodLabel = document.getElementById("wizardPeriodLabel")?.value;
    const periodStart = document.getElementById("wizardPeriodStart")?.value;
    const periodEnd = document.getElementById("wizardPeriodEnd")?.value;
    const paymentDate = document.getElementById("wizardPaymentDate")?.value || periodEnd;
    const extFundingAccountId = document.getElementById("wizardExternalFundingAccount")?.value;
    const intFundingAccountId = document.getElementById("wizardInternalFundingAccount")?.value;
    const fxRateSource = document.getElementById("wizardFxRateSource")?.value || "first_of_month";
    const fxRateValStr = document.getElementById("wizardFxRateValue")?.value;
    const fxRateValue = fxRateValStr ? parseFloat(fxRateValStr) : null;

    const refreshed = await FinanceApi.previewPayrollRun({
      period_label: periodLabel,
      period_start: periodStart,
      period_end: periodEnd,
      payment_date: paymentDate,
      bank_account_id: parseInt(extFundingAccountId, 10),
      external_funding_account_id: parseInt(extFundingAccountId, 10),
      internal_funding_account_id: parseInt(intFundingAccountId, 10),
      fx_rate_source: fxRateSource,
      fx_rate_value: fxRateValue,
    });

    wizardPreviewData = refreshed;
    wizardIsStale = false;
    const staleBadge = document.getElementById("wizardStaleWarningBadge");
    if (staleBadge) staleBadge.style.display = "none";

    populateWizardData(refreshed);
    showToast("Readiness recheck complete.", "success");
    announceLiveMessage("Readiness recheck completed.");
  } catch (err) {
    console.error("Recheck failed:", err);
    showToast("Failed to recheck payments: " + (err.message || err), "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-rotate"></i> Recheck Payments`;
    }
  }
}

function populateWizardConfirmation(preview) {
  const periodDatesEl = document.getElementById("wizardConfirmPeriodDates");
  const totalAmountEl = document.getElementById("wizardConfirmTotalAmount");
  const countsEl = document.getElementById("wizardConfirmCounts");
  const versionEl = document.getElementById("wizardConfirmPreviewVersion");
  const extAccNameEl = document.getElementById("wizardConfirmExtAccountName");
  const intAccNameEl = document.getElementById("wizardConfirmIntAccountName");
  const extTotalEl = document.getElementById("wizardConfirmExtTotal");
  const intTotalEl = document.getElementById("wizardConfirmIntTotal");
  const warnAckContainer = document.getElementById("wizardWarningAckContainer");

  const baseAmountEl = document.getElementById("wizardConfirmBaseAmount");
  const addBreakdownEl = document.getElementById("wizardConfirmAdditionsBreakdown");
  const addDetailEl = document.getElementById("wizardConfirmAdditionsDetail");

  const totalComm = Number(preview.total_commissions || 0);
  const totalBon = Number(preview.total_bonuses || 0);
  const totalAdd = Number(preview.total_additions !== undefined ? preview.total_additions : (totalComm + totalBon));
  const finalNet = Number(preview.total_net || 0);
  const baseNet = Math.round((finalNet - totalAdd + Number.EPSILON) * 100) / 100;

  const lines = preview.lines || [];
  const finalExt = Number(preview.final_ext_total !== undefined ? preview.final_ext_total : lines.filter(l => l.compensation_type === "external_usd").reduce((s, l) => s + Number(l.net_pay || 0), 0));
  const finalInt = Number(preview.final_int_total !== undefined ? preview.final_int_total : lines.filter(l => l.compensation_type !== "external_usd").reduce((s, l) => s + Number(l.net_pay || 0), 0));

  const formattedNet = `$${finalNet.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (periodDatesEl) periodDatesEl.textContent = `${preview.period_label} (${preview.period_start} to ${preview.period_end}) · Pay Date: ${preview.payment_date || preview.period_end}`;
  if (baseAmountEl) baseAmountEl.textContent = `$${baseNet.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (addBreakdownEl) addBreakdownEl.textContent = `+$${totalAdd.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (addDetailEl) addDetailEl.textContent = `Comm: $${totalComm.toLocaleString("en-US", { minimumFractionDigits: 2 })} · Bonus: $${totalBon.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  const netTotalEl = document.getElementById("wizardConfirmNetTotal");
  if (netTotalEl) {
    netTotalEl.textContent = formattedNet;
  } else if (totalAmountEl) {
    totalAmountEl.textContent = formattedNet;
  }

  const headcountEl = document.getElementById("wizardConfirmHeadcount");
  const linesCountEl = document.getElementById("wizardConfirmLinesCount");
  if (headcountEl) {
    headcountEl.textContent = `${preview.recipient_count || preview.headcount || 0}`;
  }
  if (linesCountEl) {
    linesCountEl.textContent = `${lines.length}`;
  }
  if (!headcountEl && countsEl) {
    countsEl.textContent = `${preview.recipient_count || preview.headcount || 0} Recipients · ${lines.length} Payment Lines`;
  }

  if (versionEl) versionEl.textContent = `${preview.preview_id || 'PRV-ACTIVE'} (v${preview.preview_version || 1}) · ${preview.source_version || 'src-v1'}`;

  if (extAccNameEl) extAccNameEl.textContent = preview.external_funding_account_name || "External Bank Account";
  if (intAccNameEl) intAccNameEl.textContent = preview.internal_funding_account_name || "Internal Cash Account";
  if (extTotalEl) extTotalEl.textContent = `$${finalExt.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (intTotalEl) intTotalEl.textContent = `$${finalInt.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  const warnings = (preview.exceptions || []).filter(e => e.severity === "warning");
  if (warnAckContainer) {
    warnAckContainer.style.display = warnings.length > 0 ? "block" : "none";
  }

  const blockers = (preview.exceptions || []).filter(e => e.severity === "blocking" && !e.is_resolved);
  const btnSubmit = document.getElementById("btnWizardSubmitForApproval");
  if (btnSubmit) {
    btnSubmit.disabled = blockers.length > 0;
    btnSubmit.title = blockers.length > 0 ? "Blocked by unresolved readiness issues" : "";
  }
}

function onWarningAckChanged() {
  // Handled on submission
}

async function submitWizardRunner(submitForApproval = false) {
  if (!wizardPreviewData) {
    showToast("No payment preview data available.", "error");
    return;
  }

  if (wizardIsStale) {
    showToast("Preview is stale due to setup edits. Please recheck payments before submitting.", "warning");
    return;
  }

  const blockers = (wizardPreviewData.exceptions || []).filter(e => e.severity === "blocking" && !e.is_resolved);
  if (blockers.length > 0) {
    showToast("Cannot submit: blocking readiness issues remain.", "error");
    return;
  }

  const warnings = (wizardPreviewData.exceptions || []).filter(e => e.severity === "warning");
  const ackCheckbox = document.getElementById("wizardAcknowledgeWarnings");
  if (warnings.length > 0 && ackCheckbox && !ackCheckbox.checked && submitForApproval) {
    showToast("Please acknowledge warnings before submitting for approval.", "warning");
    return;
  }

  const btn = submitForApproval ? document.getElementById("btnWizardSubmitForApproval") : document.getElementById("btnWizardSaveDraft");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Submitting...`;
  }

  try {
    const periodLabel = document.getElementById("wizardPeriodLabel")?.value;
    const periodStart = document.getElementById("wizardPeriodStart")?.value;
    const periodEnd = document.getElementById("wizardPeriodEnd")?.value;
    const paymentDate = document.getElementById("wizardPaymentDate")?.value || periodEnd;
    const extFundingAccountId = document.getElementById("wizardExternalFundingAccount")?.value;
    const intFundingAccountId = document.getElementById("wizardInternalFundingAccount")?.value;
    const fxRateSource = document.getElementById("wizardFxRateSource")?.value || "first_of_month";
    const fxRateValStr = document.getElementById("wizardFxRateValue")?.value;
    const fxRateValue = fxRateValStr ? parseFloat(fxRateValStr) : null;

    const payload = {
      period_label: periodLabel,
      period_start: periodStart,
      period_end: periodEnd,
      payment_date: paymentDate,
      currency: "USD",
      bank_account_id: extFundingAccountId ? parseInt(extFundingAccountId, 10) : null,
      external_funding_account_id: extFundingAccountId ? parseInt(extFundingAccountId, 10) : null,
      internal_funding_account_id: intFundingAccountId ? parseInt(intFundingAccountId, 10) : null,
      fx_rate_source: fxRateSource,
      fx_rate_value: fxRateValue,
      preview_id: wizardPreviewData.preview_id,
      preview_version: wizardPreviewData.preview_version,
      source_version: wizardPreviewData.source_version,
      submit_for_approval: submitForApproval,
      lines: (wizardPreviewData.lines || []).map(l => ({
        employee_id: l.employee_id,
        compensation_type: l.compensation_type,
        amount: l.net_pay || l.amount,
        notes: l.snapshot_notes,
      })),
    };

    const newRun = await FinanceApi.createPayrollRun(payload);

    if (submitForApproval) {
      showToast(`Payroll run ${newRun.period_label} submitted for independent approval!`, "success");
    } else {
      showToast(`Payroll run ${newRun.period_label} saved as Draft.`, "success");
    }

    closeRunPayrollWizardModal();
    await loadFinancePayroll();
    openPayrollRunDetail(newRun.id);
  } catch (err) {
    console.error("Runner submission failed:", err);
    showToast("Submission failed: " + (err.message || err), "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = submitForApproval
        ? `<i class="fa-solid fa-paper-plane"></i> Submit for Approval`
        : `<i class="fa-solid fa-floppy-disk"></i> Save Draft`;
    }
  }
}

// ==========================================
// Run Detail Drawer & Lifecycle Actions
// ==========================================
async function openPayrollRunDetail(runId) {
  try {
    const run = await FinanceApi.getPayrollRun(runId);
    currentDetailRun = run;
    renderPayrollRunDetail(run);
    const modal = document.getElementById("payrollRunDetailModal");
    if (modal) modal.style.display = "flex";
  } catch (err) {
    console.error("Failed to load run detail:", err);
    showToast("Failed to load payroll run details: " + (err.message || err), "error");
  }
}

function closePayrollRunDetailModal() {
  const modal = document.getElementById("payrollRunDetailModal");
  if (modal) modal.style.display = "none";
  currentDetailRun = null;
}

function renderPayrollRunDetail(run) {
  if (!run) return;

  const titleEl = document.getElementById("runDetailTitle");
  const badgeEl = document.getElementById("runDetailStatusBadge");
  const cycleDatesEl = document.getElementById("runDetailCycleDates");
  const bankNameEl = document.getElementById("runDetailBankName");
  const netEl = document.getElementById("runDetailNet");
  const extFundingEl = document.getElementById("runDetailExtFunding");
  const intFundingEl = document.getElementById("runDetailIntFunding");
  const fxRateEl = document.getElementById("runDetailFxRate");
  const linesTbody = document.getElementById("runDetailLinesTableBody");

  if (titleEl) titleEl.textContent = `Payroll Run #${run.period_label}`;
  if (badgeEl) {
    badgeEl.outerHTML = getStatusBadge(run.status).replace('<span class="badge', '<span class="badge" id="runDetailStatusBadge"');
  }
  const payDate = run.payment_date || run.period_end;
  if (cycleDatesEl) cycleDatesEl.textContent = `${run.period_start} to ${run.period_end} · Payment: ${payDate}`;
  if (bankNameEl) bankNameEl.textContent = run.external_funding_account_name || run.bank_account_name || "Operating Account";

  const lines = run.lines || [];
  const extTotal = lines.filter(l => l.compensation_type === "external_usd").reduce((s, l) => s + Number(l.net_pay || 0), 0);
  const intTotal = lines.filter(l => l.compensation_type !== "external_usd").reduce((s, l) => s + Number(l.net_pay || 0), 0);

  if (netEl) netEl.textContent = `$${Number(run.total_net || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (extFundingEl) extFundingEl.textContent = `$${extTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (intFundingEl) intFundingEl.textContent = `$${intTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

  if (fxRateEl) {
    if (run.fx_rate_value) {
      const srcText = run.fx_rate_source === "payment_date" ? "Payment Date" : "1st of Month";
      fxRateEl.textContent = `${Number(run.fx_rate_value).toFixed(4)} (${srcText})`;
    } else {
      fxRateEl.textContent = "—";
    }
  }

  const status = (run.status || "draft").toLowerCase();
  const btnSubmit = document.getElementById("btnRunDetailSubmit");
  const btnApprove = document.getElementById("btnRunDetailApprove");
  const btnFinalize = document.getElementById("btnRunDetailFinalize");
  const btnDisburse = document.getElementById("btnRunDetailDisburse");
  const btnRetry = document.getElementById("btnRunDetailRetryFailed");
  const btnJournal = document.getElementById("btnRunDetailPostJournal");
  const btnAddBonus = document.getElementById("btnRunDetailAddBonus");

  if (btnAddBonus) btnAddBonus.style.display = status === "draft" ? "inline-block" : "none";
  if (btnSubmit) btnSubmit.style.display = status === "draft" ? "inline-block" : "none";
  if (btnApprove) btnApprove.style.display = (status === "draft" || status === "submitted") ? "inline-block" : "none";
  if (btnFinalize) btnFinalize.style.display = status === "approved" ? "inline-block" : "none";
  if (btnDisburse) btnDisburse.style.display = status === "finalized" ? "inline-block" : "none";

  const hasFailedLines = lines.some(l => l.payment_status === "failed");
  if (btnRetry) btnRetry.style.display = (status === "partially_paid" || hasFailedLines) ? "inline-block" : "none";

  if (btnJournal) {
    btnJournal.style.display = (status === "paid" || status === "partially_paid") ? "inline-block" : "none";
    if (run.journal_transaction_id) {
      btnJournal.disabled = true;
      btnJournal.innerHTML = `<i class="fa-solid fa-check"></i> GL Journal Posted (#${run.journal_transaction_id})`;
    } else {
      btnJournal.disabled = false;
      btnJournal.innerHTML = `<i class="fa-solid fa-book-journal-whills"></i> Post GL Journal`;
    }
  }

  // Render Net Payment Lines Table
  if (linesTbody) {
    if (lines.length === 0) {
      linesTbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:20px; color:var(--text-muted);">No employee payment records found in this run.</td></tr>`;
    } else {
      linesTbody.innerHTML = lines.map(line => {
        let payBadge = `<span class="badge" style="background:#94A3B8; color:#fff;">PENDING</span>`;
        if (line.payment_status === "paid") {
          payBadge = `<span class="badge" style="background:#10B981; color:#fff;"><i class="fa-solid fa-check"></i> PAID</span>`;
        } else if (line.payment_status === "failed") {
          payBadge = `<span class="badge" style="background:#EF4444; color:#fff;" title="${line.failure_reason || 'Failed'}"><i class="fa-solid fa-triangle-exclamation"></i> FAILED</span>`;
        }

        let routeBadge = '<span class="badge" style="background:#10B981; color:#fff; font-size:0.75rem;">Internal USD Cash</span>';
        if (line.compensation_type === "external_usd") {
          routeBadge = '<span class="badge" style="background:#0284C7; color:#fff; font-size:0.75rem;">External USD</span>';
        } else if (line.compensation_type === "commission_sales") {
          routeBadge = '<span class="badge" style="background:#8B5CF6; color:#fff; font-size:0.75rem;">Sales Commission</span>';
        } else if (line.compensation_type?.startsWith("commission")) {
          routeBadge = '<span class="badge" style="background:#8B5CF6; color:#fff; font-size:0.75rem;">Commission</span>';
        } else if (line.compensation_type === "bonus") {
          routeBadge = '<span class="badge" style="background:#F59E0B; color:#fff; font-size:0.75rem;">Bonus</span>';
        }

        const isDraft = status === "draft";
        let actionsHtml = `
          <button class="btn btn-sm btn-outline btn-view-payslip" onclick="openEmployeePayslipModal('${run.id}', '${line.employee_id}')" title="View Payment Details">
            <i class="fa-solid fa-receipt"></i>
          </button>
        `;
        if (isDraft) {
          actionsHtml = `
            <div style="display:flex; gap:4px; justify-content:center; align-items:center;">
              <button class="btn btn-sm btn-outline btn-add-bonus" onclick="openAddBonusModal('${line.employee_id}')" title="Add Line">
                <i class="fa-solid fa-plus"></i>
              </button>
              <button class="btn btn-sm btn-outline btn-view-payslip" onclick="openEmployeePayslipModal('${run.id}', '${line.employee_id}')" title="View Details">
                <i class="fa-solid fa-receipt"></i>
              </button>
              <button class="btn btn-sm btn-outline btn-delete-line" onclick="deletePayrollLineItem('${run.id}', '${line.id}')" title="Delete Line" style="color:#EF4444; border-color:#EF4444;">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          `;
        }

        const destText = line.bank_name ? `${line.bank_name} (${line.bank_account_masked || '••••'})` : '<span style="color:var(--text-muted);">Internal Cash Vault</span>';

        return `
          <tr>
            <td><strong>${line.employee_name || ('Employee #' + line.employee_id)}</strong></td>
            <td>${routeBadge}</td>
            <td>${line.department || '—'}</td>
            <td style="text-align:right; font-weight:700; color:var(--primary, #2563EB);">$${Number(line.net_pay || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
            <td>${destText}</td>
            <td style="text-align:center;">${payBadge}</td>
            <td style="text-align:center;">${actionsHtml}</td>
          </tr>
        `;
      }).join("");
    }
  }
}

async function submitCurrentPayrollRun() {
  if (!currentDetailRun) return;
  try {
    const updated = await FinanceApi.submitPayrollRun(currentDetailRun.id);
    showToast(`Payroll run ${updated.period_label} submitted for approval!`, "success");
    currentDetailRun = updated;
    renderPayrollRunDetail(updated);
    await loadFinancePayroll();
  } catch (err) {
    console.error("Submit failed:", err);
    showToast("Submission failed: " + (err.message || err), "error");
  }
}

async function approveCurrentPayrollRun() {
  if (!currentDetailRun) return;
  try {
    const updated = await FinanceApi.approvePayrollRun(currentDetailRun.id);
    showToast(`Payroll run ${updated.period_label} approved!`, "success");
    currentDetailRun = updated;
    renderPayrollRunDetail(updated);
    await loadFinancePayroll();
  } catch (err) {
    console.error("Approve failed:", err);
    showToast("Approval failed: " + (err.message || err), "error");
  }
}

async function finalizeCurrentPayrollRun() {
  if (!currentDetailRun) return;
  try {
    const updated = await FinanceApi.finalizePayrollRun(currentDetailRun.id);
    showToast(`Payroll run ${updated.period_label} finalized and locked for funding!`, "success");
    currentDetailRun = updated;
    renderPayrollRunDetail(updated);
    await loadFinancePayroll();
  } catch (err) {
    console.error("Finalize failed:", err);
    showToast("Finalization failed: " + (err.message || err), "error");
  }
}

async function disburseCurrentPayrollRun() {
  if (!currentDetailRun) return;
  const btn = document.getElementById("btnRunDetailDisburse");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Disbursing...`;
  }

  try {
    const updated = await FinanceApi.disbursePayrollRun(currentDetailRun.id, false);
    if (updated.status === "paid") {
      showToast(`All employee net payments disbursed successfully!`, "success");
    } else {
      showToast(`Disbursement completed with status: ${updated.status}. Some payments require retry.`, "warning");
    }
    currentDetailRun = updated;
    renderPayrollRunDetail(updated);
    await loadFinancePayroll();
  } catch (err) {
    console.error("Disbursement failed:", err);
    showToast("Disbursement failed: " + (err.message || err), "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Fund & Disburse`;
    }
  }
}

async function retryFailedPayrollDisbursements() {
  if (!currentDetailRun) return;
  const btn = document.getElementById("btnRunDetailRetryFailed");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Retrying...`;
  }

  try {
    const updated = await FinanceApi.disbursePayrollRun(currentDetailRun.id, true);
    showToast(`Retry completed. Status: ${updated.status}`, "success");
    currentDetailRun = updated;
    renderPayrollRunDetail(updated);
    await loadFinancePayroll();
  } catch (err) {
    console.error("Retry failed:", err);
    showToast("Retry failed: " + (err.message || err), "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Retry Failed Payments`;
    }
  }
}

async function postCurrentPayrollJournal() {
  if (!currentDetailRun) return;
  const btn = document.getElementById("btnRunDetailPostJournal");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Posting GL Outflows...`;
  }

  try {
    const updated = await FinanceApi.postPayrollJournal(currentDetailRun.id);
    showToast(`GL net disbursement outflows posted successfully!`, "success");
    currentDetailRun.journal_transaction_id = updated.journal_transaction_id;
    renderPayrollRunDetail(currentDetailRun);
    await loadFinancePayroll();
  } catch (err) {
    console.error("GL posting failed:", err);
    showToast("Posting GL Journal failed: " + (err.message || err), "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-book-journal-whills"></i> Post GL Journal`;
    }
  }
}

function exportCurrentPayrollRunLines() {
  if (!currentDetailRun || !currentDetailRun.lines) {
    showToast("No payment lines to export.", "warning");
    return;
  }

  const run = currentDetailRun;
  const headers = [
    "Recipient",
    "Employee ID",
    "Department",
    "Route",
    "Masked Destination",
    "Payment Amount",
    "Currency",
    "Funding Account",
    "Payment Date",
    "Status",
    "Reference",
  ];

  const payDate = run.payment_date || run.period_end;
  const fundingName = run.external_funding_account_name || run.bank_account_name || "Operating Account";

  const rows = run.lines.map(l => [
    `"${l.employee_name || ''}"`,
    `"${l.employee_id}"`,
    `"${l.department || ''}"`,
    `"${l.compensation_type || ''}"`,
    `"${l.bank_account_masked || ''}"`,
    Number(l.net_pay || 0).toFixed(2),
    `"${l.currency || run.currency || 'USD'}"`,
    `"${fundingName}"`,
    `"${payDate}"`,
    `"${l.payment_status || ''}"`,
    `"PAYROLL-${run.period_label}-${l.id}"`,
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `payroll_${run.period_label}_net_payments.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==========================================
// Payment Receipt / Details Modal
// ==========================================
async function openEmployeePayslipModal(runId, employeeId) {
  try {
    const receipt = await FinanceApi.getEmployeePayslip(runId, employeeId);
    if (!receipt) {
      showToast("Payment record not found.", "warning");
      return;
    }

    const nameEl = document.getElementById("payslipEmpName");
    const deptEl = document.getElementById("payslipDept");
    const periodEl = document.getElementById("payslipPeriod");
    const chipEl = document.getElementById("payslipStatusChip");
    const netEl = document.getElementById("payslipNetPay");
    const routeEl = document.getElementById("payslipRoute");
    const bankEl = document.getElementById("payslipBankName");
    const accEl = document.getElementById("payslipMaskedAcc");
    const dateEl = document.getElementById("payslipPaidDate");

    if (nameEl) nameEl.textContent = receipt.employee_name || `Employee #${receipt.employee_id}`;
    if (deptEl) deptEl.textContent = receipt.department || "General";
    if (periodEl) periodEl.textContent = `Period ${receipt.period_label}`;
    if (chipEl) {
      const st = (receipt.status || receipt.payment_status || "PAID").toUpperCase();
      chipEl.textContent = st;
      chipEl.style.background = st === "PAID" ? "#10B981" : "#F59E0B";
      chipEl.style.color = "#fff";
    }

    if (netEl) netEl.textContent = `$${Number(receipt.net_pay || receipt.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

    const rName = receipt.compensation_type === "external_usd" ? "External Bank Wire" : "Internal Cash Payment";
    if (routeEl) routeEl.textContent = rName;
    if (bankEl) bankEl.textContent = receipt.bank_name || "Direct Transfer";
    if (accEl) accEl.textContent = receipt.bank_account_masked || "••••";
    if (dateEl) dateEl.textContent = receipt.paid_date || receipt.paid_at?.slice(0, 10) || receipt.period_end;

    const modal = document.getElementById("employeePayslipModal");
    if (modal) modal.style.display = "flex";
  } catch (err) {
    console.error("Failed to load payment receipt:", err);
    showToast("Failed to load payment details: " + (err.message || err), "error");
  }
}

function closeEmployeePayslipModal() {
  const modal = document.getElementById("employeePayslipModal");
  if (modal) modal.style.display = "none";
}

// ==========================================
// Add Commission / Bonus Modal
// ==========================================
async function openAddBonusModal(defaultEmpId = null) {
  const select = document.getElementById("bonusEmployeeSelect");
  if (select) {
    let empList = (typeof employees !== "undefined" && Array.isArray(employees) && employees.length > 0)
      ? employees
      : (window.employees || FinanceState.employees || []);

    if (empList.length === 0 && currentDetailRun && currentDetailRun.lines) {
      const seen = new Set();
      empList = currentDetailRun.lines
        .filter(l => {
          if (seen.has(l.employee_id)) return false;
          seen.add(l.employee_id);
          return true;
        })
        .map(l => ({ id: l.employee_id, name: l.employee_name, department: l.department }));
    }

    if (empList.length === 0 && window.Api && window.Api.getEmployees) {
      try {
        empList = await window.Api.getEmployees();
      } catch (e) {
        console.warn("Could not load employees from Api:", e);
      }
    }

    select.innerHTML = '<option value="">Select Employee...</option>' +
      empList.map(e => {
        const numId = parseInt(String(e.id || '').replace(/\D/g, ''), 10) || e.id;
        return `<option value="${numId}">${e.name || e.employee_name} (${e.department || e.dept || 'General'})</option>`;
      }).join("");

    if (defaultEmpId) {
      const normDefault = parseInt(String(defaultEmpId).replace(/\D/g, ''), 10) || defaultEmpId;
      select.value = String(normDefault);
      if (!select.value) select.value = String(defaultEmpId);
    }
  }

  const amtInput = document.getElementById("bonusAmount");
  const notesInput = document.getElementById("bonusNotes");
  if (amtInput) amtInput.value = "";
  if (notesInput) notesInput.value = "";

  const modal = document.getElementById("payrollAddBonusModal");
  if (modal) modal.style.display = "flex";
}

function closeAddBonusModal() {
  const modal = document.getElementById("payrollAddBonusModal");
  if (modal) modal.style.display = "none";
}

async function submitAddPayrollBonus(evt) {
  evt.preventDefault();
  if (!currentDetailRun) return;

  const empId = document.getElementById("bonusEmployeeSelect")?.value;
  const compType = document.getElementById("bonusCompensationType")?.value;
  const amount = parseFloat(document.getElementById("bonusAmount")?.value || "0");
  const notes = document.getElementById("bonusNotes")?.value;

  if (!empId || isNaN(amount) || amount <= 0) {
    showToast("Please enter a valid employee and amount.", "warning");
    return;
  }

  const btn = document.getElementById("btnSubmitAddBonus");
  if (btn) btn.disabled = true;

  try {
    await FinanceApi.addPayrollLine(currentDetailRun.id, {
      employee_id: parseInt(empId, 10),
      compensation_type: compType,
      amount: amount,
      notes: notes,
    });

    showToast("Payment line added successfully!", "success");
    closeAddBonusModal();
    await openPayrollRunDetail(currentDetailRun.id);
    await loadFinancePayroll();
  } catch (err) {
    console.error("Failed to add line:", err);
    showToast("Failed to add payment line: " + (err.message || err), "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deletePayrollLineItem(runId, lineId) {
  if (!confirm("Are you sure you want to remove this payment line?")) return;

  try {
    await FinanceApi.deletePayrollLine(runId, lineId);
    showToast("Payment line removed.", "success");
    await openPayrollRunDetail(runId);
    await loadFinancePayroll();
  } catch (err) {
    console.error("Delete line failed:", err);
    showToast("Failed to delete line: " + (err.message || err), "error");
  }
}

function announceLiveMessage(msg) {
  const el = document.getElementById("payrollLiveAnnouncer");
  if (el) {
    el.textContent = msg;
  }
}
