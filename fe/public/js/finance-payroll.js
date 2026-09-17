// ==========================================
// 4. Guided Payroll Operations & Runs
// ==========================================

let wizardCurrentStep = 1;
let wizardPreviewData = null;
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

  // Update KPI cards
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

  const pendingCount = runs.filter(r => r.status === "draft" || r.status === "approved").length;
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
      const funding = run.funding_account_name || "Operating Account";
      return `
      <tr>
        <td><strong>${run.period_label}</strong></td>
        <td>${run.period_start} to ${run.period_end}</td>
        <td style="text-align:center;"><span class="badge" style="background:#E2E8F0; color:#1E293B;">${staff} staff</span></td>
        <td style="text-align:right;">$${Number(run.total_gross || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
        <td style="text-align:right;"><strong>$${Number(run.total_net || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
        <td style="text-align:right;">$${Number(run.total_employer_cost || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
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
// 5-Step Guided Run Payroll Wizard
// ==========================================
async function openRunPayrollWizardModal() {
  wizardCurrentStep = 1;
  wizardPreviewData = null;

  // Set default cycle month (current YYYY-MM)
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const periodInput = document.getElementById("wizardPeriodLabel");
  if (periodInput) {
    periodInput.value = `${year}-${month}`;
    onWizardPeriodChanged(`${year}-${month}`);
  }

  // Populate Funding Bank Accounts
  const fundingSelect = document.getElementById("wizardFundingAccount");
  if (fundingSelect) {
    fundingSelect.innerHTML = `<option value="">Loading accounts...</option>`;
    try {
      const accounts = await FinanceApi.getBankAccounts();
      if (accounts && accounts.length > 0) {
        fundingSelect.innerHTML = accounts
          .map(acc => `<option value="${acc.id}">${acc.bank_name || 'Bank'} - ${acc.account_name} (${acc.account_number_masked || '••••'}) [${acc.currency}]</option>`)
          .join("");
      } else {
        fundingSelect.innerHTML = `<option value="1">Primary Treasury Operating Account (USD)</option>`;
      }
    } catch (e) {
      fundingSelect.innerHTML = `<option value="1">Primary Treasury Operating Account (USD)</option>`;
    }
  }

  updateWizardStepView();
  const modal = document.getElementById("runPayrollWizardModal");
  if (modal) modal.style.display = "flex";
}

function closeRunPayrollWizardModal() {
  const modal = document.getElementById("runPayrollWizardModal");
  if (modal) modal.style.display = "none";
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
  if (startEl) startEl.value = firstDay;
  if (endEl) endEl.value = lastDay;
}

async function navigateWizardStep(direction) {
  const nextStep = wizardCurrentStep + direction;
  if (nextStep < 1 || nextStep > 5) return;

  // If moving from step 1 to step 2, trigger preview calculation
  if (wizardCurrentStep === 1 && direction > 0) {
    const periodLabel = document.getElementById("wizardPeriodLabel")?.value;
    const periodStart = document.getElementById("wizardPeriodStart")?.value;
    const periodEnd = document.getElementById("wizardPeriodEnd")?.value;
    const fundingAccountId = document.getElementById("wizardFundingAccount")?.value;

    if (!periodLabel || !periodStart || !periodEnd) {
      showToast("Please fill in cycle period and dates.", "warning");
      return;
    }

    const nextBtn = document.getElementById("wizardNextBtn");
    if (nextBtn) {
      nextBtn.disabled = true;
      nextBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Calculating Preview...`;
    }

    try {
      const fxRateSource = document.getElementById("wizardFxRateSource")?.value || "first_of_month";
      const fxRateValStr = document.getElementById("wizardFxRateValue")?.value;
      const fxRateValue = fxRateValStr ? parseFloat(fxRateValStr) : null;

      wizardPreviewData = await FinanceApi.previewPayrollRun({
        period_label: periodLabel,
        period_start: periodStart,
        period_end: periodEnd,
        funding_account_id: fundingAccountId ? parseInt(fundingAccountId, 10) : null,
        bank_account_id: fundingAccountId ? parseInt(fundingAccountId, 10) : null,
        fx_rate_source: fxRateSource,
        fx_rate_value: fxRateValue,
      });
      populateWizardData(wizardPreviewData);
    } catch (err) {
      console.error("Preview error:", err);
      showToast("Failed to preview payroll cycle: " + (err.message || err), "error");
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.innerHTML = `Next <i class="fa-solid fa-arrow-right"></i>`;
      }
      return;
    } finally {
      if (nextBtn) {
        nextBtn.disabled = false;
        nextBtn.innerHTML = `Next <i class="fa-solid fa-arrow-right"></i>`;
      }
    }
  }

  wizardCurrentStep = nextStep;
  updateWizardStepView();
}

function updateWizardStepView() {
  for (let i = 1; i <= 5; i++) {
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
  if (nextBtn) nextBtn.style.display = wizardCurrentStep < 5 ? "inline-block" : "none";
}

function populateWizardData(preview) {
  if (!preview) return;

  // Step 2: Variances & Employees Preview
  const varHeadcount = document.getElementById("wizardVarianceHeadcount");
  const varGross = document.getElementById("wizardVarianceGrossDelta");
  const varNet = document.getElementById("wizardVarianceNetDelta");
  const varPct = document.getElementById("wizardVariancePctChange");

  if (varHeadcount) varHeadcount.textContent = preview.headcount || 0;
  if (preview.variance_summary) {
    const v = preview.variance_summary;
    if (varGross) {
      const sign = v.gross_delta >= 0 ? "+" : "-";
      varGross.textContent = `${sign}$${Math.abs(v.gross_delta || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
      varGross.style.color = v.gross_delta >= 0 ? "#10B981" : "#EF4444";
    }
    if (varNet) {
      const sign = v.net_delta >= 0 ? "+" : "-";
      varNet.textContent = `${sign}$${Math.abs(v.net_delta || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    }
    if (varPct) {
      const sign = v.pct_change >= 0 ? "+" : "";
      varPct.textContent = `${sign}${Number(v.pct_change || 0).toFixed(1)}%`;
    }
  }

  const empTableBody = document.getElementById("wizardEmployeesPreviewTableBody");
  if (empTableBody && preview.lines) {
    empTableBody.innerHTML = preview.lines
      .map(line => {
        const compType = line.compensation_type || "internal_usd_cash";
        const isExt = compType === "external_usd";
        const typeBadge = isExt
          ? `<span class="badge" style="background:#0284C7; color:#fff; font-size:0.75rem; padding:2px 6px;">External USD</span>`
          : `<span class="badge" style="background:#10B981; color:#fff; font-size:0.75rem; padding:2px 6px;">Internal USD Cash</span>`;
        return `
          <tr>
            <td><strong>${line.employee_name}</strong></td>
            <td>${typeBadge}</td>
            <td>${line.department}</td>
            <td style="text-align:right;">$${Number(line.base_salary || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
            <td style="text-align:right; color:#EF4444;">-$${Number(line.deductions_total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
            <td style="text-align:right; color:#EA580C;">-$${Number(line.tax_amount || line.tax_withheld || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
            <td style="text-align:right; font-weight:700; color:var(--primary, #2563EB);">$${Number(line.net_pay || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
            <td>${line.bank_name ? `${line.bank_name} (${line.bank_account_masked})` : '<span style="color:#EF4444; font-weight:600;"><i class="fa-solid fa-triangle-exclamation"></i> Missing Bank</span>'}</td>
          </tr>
        `;
      })
      .join("");
  }

  // Step 3: Exceptions & Readiness
  const excList = document.getElementById("wizardExceptionsList");
  const excClean = document.getElementById("wizardExceptionsClean");
  const excBanner = document.getElementById("wizardExceptionsBanner");
  const exceptions = preview.exceptions || [];

  if (exceptions.length === 0) {
    if (excList) excList.innerHTML = "";
    if (excClean) excClean.style.display = "block";
    if (excBanner) excBanner.style.display = "none";
  } else {
    if (excClean) excClean.style.display = "none";
    const blockingCount = exceptions.filter(e => e.blocking).length;
    if (excBanner) {
      excBanner.style.display = "block";
      if (blockingCount > 0) {
        excBanner.style.background = "#FEF2F2";
        excBanner.style.border = "1px solid #FCA5A5";
        excBanner.style.color = "#991B1B";
        excBanner.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <strong>${blockingCount} Blocking Exception(s) Detected:</strong> Approval is blocked until resolved. You may only save this cycle as a Draft.`;
      } else {
        excBanner.style.background = "#FFFBEB";
        excBanner.style.border = "1px solid #FCD34D";
        excBanner.style.color = "#92400E";
        excBanner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <strong>${exceptions.length} Warning(s) Detected:</strong> Please review adjustments before final approval.`;
      }
    }

    if (excList) {
      excList.innerHTML = exceptions.map(exc => `
        <div class="card" style="padding:14px; margin-bottom:10px; border-left:4px solid ${exc.blocking ? '#EF4444' : '#F59E0B'}; display:flex; justify-content:space-between; align-items:center;">
          <div>
            <div style="font-weight:600; font-size:0.9rem; color:var(--text-main);">
              ${exc.employee_name} (${exc.department})
            </div>
            <div style="font-size:0.85rem; color:var(--text-muted); margin-top:2px;">
              ${exc.message}
            </div>
          </div>
          <div>
            <span class="badge" style="background:${exc.blocking ? '#EF4444' : '#F59E0B'}; color:#fff;">
              ${exc.blocking ? 'BLOCKING' : 'WARNING'}
            </span>
          </div>
        </div>
      `).join("");
    }
  }

  // Step 4: Liabilities & Balanced GL Double-Entry Journal
  if (preview.liabilities_summary) {
    const liab = preview.liabilities_summary;
    const lNet = document.getElementById("wizardLiabNetPay");
    const lTax = document.getElementById("wizardLiabTax");
    const lStaff = document.getElementById("wizardLiabStaffIns");
    const lEmp = document.getElementById("wizardLiabEmployerIns");

    if (lNet) lNet.textContent = `$${Number(liab.net_salaries_payable || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    if (lTax) lTax.textContent = `$${Number(liab.tax_withheld || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    if (lStaff) lStaff.textContent = `$${Number(liab.social_insurance_staff || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    if (lEmp) lEmp.textContent = `$${Number(liab.social_insurance_employer || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  }

  if (preview.journal_preview) {
    const jp = preview.journal_preview;
    const jBody = document.getElementById("wizardJournalTableBody");
    const jFoot = document.getElementById("wizardJournalTableFoot");
    const jBadge = document.getElementById("wizardJournalBalancedBadge");

    if (jBadge) {
      if (jp.is_balanced) {
        jBadge.className = "badge badge-success";
        jBadge.style.background = "#10B981";
        jBadge.style.color = "#fff";
        jBadge.innerHTML = `<i class="fa-solid fa-check"></i> Balanced (Zero Variance)`;
      } else {
        jBadge.className = "badge";
        jBadge.style.background = "#EF4444";
        jBadge.style.color = "#fff";
        jBadge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Out of Balance`;
      }
    }

    if (jBody && jp.items) {
      jBody.innerHTML = jp.items.map(item => `
        <tr>
          <td><strong>${item.account_name}</strong></td>
          <td><code>${item.account_code}</code></td>
          <td style="color:var(--text-muted); font-size:0.8rem;">${item.description}</td>
          <td style="text-align:right; font-weight:600;">${item.debit > 0 ? `$${Number(item.debit).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : '—'}</td>
          <td style="text-align:right; font-weight:600;">${item.credit > 0 ? `$${Number(item.credit).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : '—'}</td>
        </tr>
      `).join("");
    }

    if (jFoot) {
      jFoot.innerHTML = `
        <tr>
          <td colspan="3" style="text-align:right;">Total General Ledger Outflow:</td>
          <td style="text-align:right; color:var(--primary, #2563EB);">$${Number(jp.total_debit || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
          <td style="text-align:right; color:var(--primary, #2563EB);">$${Number(jp.total_credit || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
        </tr>
      `;
    }
  }

  // Step 5: Adjust Create/Approve button if blocking exceptions exist
  const btnApprove = document.getElementById("btnWizardCreateAndApprove");
  const hasBlocking = (preview.exceptions || []).some(e => e.blocking);
  if (btnApprove) {
    if (hasBlocking) {
      btnApprove.disabled = true;
      btnApprove.style.opacity = "0.5";
      btnApprove.title = "Cannot approve with blocking exceptions. Fix bank details or save as draft.";
    } else {
      btnApprove.disabled = false;
      btnApprove.style.opacity = "1.0";
      btnApprove.title = "";
    }
  }
}

async function submitWizardCreateRun(autoApprove = false) {
  if (!wizardPreviewData) {
    showToast("No cycle preview data available.", "error");
    return;
  }

  const periodLabel = document.getElementById("wizardPeriodLabel")?.value;
  const periodStart = document.getElementById("wizardPeriodStart")?.value;
  const periodEnd = document.getElementById("wizardPeriodEnd")?.value;
  const fundingAccountId = document.getElementById("wizardFundingAccount")?.value;

  const btn = autoApprove ? document.getElementById("btnWizardCreateAndApprove") : document.getElementById("btnWizardCreateDraftOnly");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing...`;
  }

  try {
    const fxRateSource = document.getElementById("wizardFxRateSource")?.value || "first_of_month";
    const fxRateValStr = document.getElementById("wizardFxRateValue")?.value;
    const fxRateValue = fxRateValStr ? parseFloat(fxRateValStr) : null;

    const payload = {
      period_label: periodLabel,
      period_start: periodStart,
      period_end: periodEnd,
      currency: "USD",
      funding_account_id: fundingAccountId ? parseInt(fundingAccountId, 10) : null,
      bank_account_id: fundingAccountId ? parseInt(fundingAccountId, 10) : null,
      fx_rate_source: fxRateSource,
      fx_rate_value: fxRateValue,
      lines: (wizardPreviewData.lines || []).map(l => ({
        employee_id: l.employee_id,
        employee_name: l.employee_name,
        department: l.department,
        compensation_type: l.compensation_type || "internal_usd_cash",
        is_taxable_local: l.is_taxable_local !== undefined ? l.is_taxable_local : true,
        is_insurable: l.is_insurable !== undefined ? l.is_insurable : true,
        base_salary: l.base_salary,
        allowances_total: l.allowances_total || 0,
        deductions_total: l.deductions_total || 0,
        tax_amount: l.tax_amount || l.tax_withheld || 0,
        tax_withheld: l.tax_amount || l.tax_withheld || 0,
        employer_taxes: l.employer_cost_extra || l.employer_taxes || 0,
        employer_cost_extra: l.employer_cost_extra || l.employer_taxes || 0,
        net_pay: l.net_pay || l.base_salary,
        bank_name: l.bank_name,
        bank_account_masked: l.bank_account_masked,
      }))
    };

    const newRun = await FinanceApi.createPayrollRun(payload);

    if (autoApprove) {
      try {
        await FinanceApi.approvePayrollRun(newRun.id);
        showToast(`Payroll run ${newRun.period_label} created and approved!`, "success");
      } catch (appErr) {
        console.warn("Auto-approve rejected:", appErr);
        showToast(`Payroll run created as Draft. Approval blocked: ${appErr.message || appErr}`, "warning");
      }
    } else {
      showToast(`Payroll run ${newRun.period_label} saved as Draft.`, "success");
    }

    closeRunPayrollWizardModal();
    await loadFinancePayroll();
    openPayrollRunDetail(newRun.id);
  } catch (err) {
    console.error("Create run failed:", err);
    showToast("Failed to create payroll run: " + (err.message || err), "error");
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = autoApprove ? `<i class="fa-solid fa-check-double"></i> Create & Approve Run` : `<i class="fa-solid fa-floppy-disk"></i> Save as Draft Only`;
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
  const grossEl = document.getElementById("runDetailGross");
  const netEl = document.getElementById("runDetailNet");
  const dedEl = document.getElementById("runDetailDeductions");
  const empCostEl = document.getElementById("runDetailEmployerCost");
  const fxRateEl = document.getElementById("runDetailFxRate");
  const linesTbody = document.getElementById("runDetailLinesTableBody");

  if (titleEl) titleEl.textContent = `Payroll Run #${run.period_label}`;
  if (badgeEl) {
    badgeEl.outerHTML = getStatusBadge(run.status).replace('<span class="badge', '<span class="badge" id="runDetailStatusBadge"');
  }
  if (cycleDatesEl) cycleDatesEl.textContent = `${run.period_start} to ${run.period_end}`;
  if (bankNameEl) bankNameEl.textContent = run.funding_account_name || "Operating Account";

  if (grossEl) grossEl.textContent = `$${Number(run.total_gross || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (netEl) netEl.textContent = `$${Number(run.total_net || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (dedEl) dedEl.textContent = `$${Number(run.total_deductions || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (empCostEl) empCostEl.textContent = `$${Number(run.total_employer_cost || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (fxRateEl) {
    if (run.fx_rate_value) {
      const srcText = run.fx_rate_source === "payment_date" ? "Payment Date" : "1st of Month";
      fxRateEl.textContent = `${Number(run.fx_rate_value).toFixed(4)} (${srcText})`;
    } else {
      fxRateEl.textContent = "—";
    }
  }

  // Update Action Buttons based on status
  const status = (run.status || "draft").toLowerCase();
  const btnApprove = document.getElementById("btnRunDetailApprove");
  const btnFinalize = document.getElementById("btnRunDetailFinalize");
  const btnDisburse = document.getElementById("btnRunDetailDisburse");
  const btnRetry = document.getElementById("btnRunDetailRetryFailed");
  const btnJournal = document.getElementById("btnRunDetailPostJournal");

  const btnAddBonus = document.getElementById("btnRunDetailAddBonus");
  if (btnAddBonus) btnAddBonus.style.display = status === "draft" ? "inline-block" : "none";
  if (btnApprove) btnApprove.style.display = status === "draft" ? "inline-block" : "none";
  if (btnFinalize) btnFinalize.style.display = status === "approved" ? "inline-block" : "none";
  if (btnDisburse) btnDisburse.style.display = status === "finalized" ? "inline-block" : "none";
  const hasFailedLines = (run.lines || []).some(l => l.payment_status === "failed");
  if (btnRetry) btnRetry.style.display = (status === "partially_paid" || hasFailedLines) ? "inline-block" : "none";
  if (btnJournal) {
    // Show GL post button if paid or partially paid and not yet posted
    btnJournal.style.display = (status === "paid" || status === "partially_paid") ? "inline-block" : "none";
    if (run.journal_transaction_id) {
      btnJournal.disabled = true;
      btnJournal.innerHTML = `<i class="fa-solid fa-check"></i> GL Journal Posted (#${run.journal_transaction_id})`;
    } else {
      btnJournal.disabled = false;
      btnJournal.innerHTML = `<i class="fa-solid fa-book-journal-whills"></i> Post GL Journal`;
    }
  }

  // Render Employee Lines
  if (linesTbody) {
    const lines = run.lines || [];
    if (lines.length === 0) {
      linesTbody.innerHTML = `<tr><td colspan="10" style="text-align:center; padding:20px; color:var(--text-muted);">No employee records found in this run.</td></tr>`;
    } else {
      linesTbody.innerHTML = lines.map(line => {
        let payBadge = `<span class="badge" style="background:#94A3B8; color:#fff;">PENDING</span>`;
        if (line.payment_status === "paid") {
          payBadge = `<span class="badge" style="background:#10B981; color:#fff;"><i class="fa-solid fa-check"></i> PAID</span>`;
        } else if (line.payment_status === "failed") {
          payBadge = `<span class="badge" style="background:#EF4444; color:#fff;" title="${line.failure_reason || 'Failed'}"><i class="fa-solid fa-triangle-exclamation"></i> FAILED</span>`;
        }

        let typeBadge = '<span class="badge" style="background:#64748B; color:#fff; font-size:0.75rem; padding:2px 6px;">Standard</span>';
        if (line.compensation_type === "external_usd") {
          typeBadge = '<span class="badge" style="background:#0284C7; color:#fff; font-size:0.75rem; padding:2px 6px;">External USD</span>';
        } else if (line.compensation_type === "internal_usd_cash") {
          typeBadge = '<span class="badge" style="background:#10B981; color:#fff; font-size:0.75rem; padding:2px 6px;">Internal USD Cash</span>';
        } else if (line.compensation_type === "commission_sales") {
          typeBadge = '<span class="badge" style="background:#8B5CF6; color:#fff; font-size:0.75rem; padding:2px 6px;">Sales Commission</span>';
        } else if (line.compensation_type === "commission_support") {
          typeBadge = '<span class="badge" style="background:#EC4899; color:#fff; font-size:0.75rem; padding:2px 6px;">Support Commission</span>';
        } else if (line.compensation_type === "bonus") {
          typeBadge = '<span class="badge" style="background:#F59E0B; color:#fff; font-size:0.75rem; padding:2px 6px;">Bonus</span>';
        }

        const isDraft = status === "draft";
        let actionsHtml = `
          <button class="btn btn-sm btn-outline" onclick="openEmployeePayslipModal('${run.id}', '${line.employee_id}')" title="View Payslip">
            <i class="fa-solid fa-file-invoice"></i>
          </button>
        `;
        if (isDraft) {
          actionsHtml = `
            <div style="display:flex; gap:4px; justify-content:center; align-items:center;">
              <button class="btn btn-sm btn-outline btn-add-bonus" onclick="openAddBonusModal('${line.employee_id}')" title="Add Commission/Bonus">
                <i class="fa-solid fa-plus"></i>
              </button>
              <button class="btn btn-sm btn-outline" onclick="openEmployeePayslipModal('${run.id}', '${line.employee_id}')" title="View Payslip">
                <i class="fa-solid fa-file-invoice"></i>
              </button>
              <button class="btn btn-sm btn-outline btn-delete-line" onclick="deletePayrollLineItem('${run.id}', '${line.id}')" title="Delete Line" style="color:#EF4444; border-color:#EF4444;">
                <i class="fa-solid fa-trash-can"></i>
              </button>
            </div>
          `;
        }

        return `
          <tr>
            <td><strong>${line.employee_name || ('Employee #' + line.employee_id)}</strong></td>
            <td>${typeBadge}</td>
            <td>${line.department || '—'}</td>
            <td style="text-align:right;">$${Number(line.base_salary || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
            <td style="text-align:right; color:#EF4444;">-$${Number(line.deductions_total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
            <td style="text-align:right; color:#EA580C;">-$${Number(line.tax_withheld || line.tax_amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
            <td style="text-align:right; font-weight:700; color:var(--primary, #2563EB);">$${Number(line.net_pay || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
            <td>${line.bank_name ? `${line.bank_name} (${line.bank_account_masked})` : '<span style="color:#EF4444;">Missing</span>'}</td>
            <td style="text-align:center;">${payBadge}</td>
            <td style="text-align:center;">${actionsHtml}</td>
          </tr>
        `;
      }).join("");
    }
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
    showToast(`Payroll run ${updated.period_label} finalized and locked against edits!`, "success");
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
    const updated = await FinanceApi.payPayrollRun(currentDetailRun.id, { retry_failed_only: false });
    if (updated.status === "paid") {
      showToast(`All employee net salaries successfully disbursed!`, "success");
    } else {
      showToast(`Disbursement finished with status: ${updated.status}. Check failed lines.`, "warning");
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
    const updated = await FinanceApi.payPayrollRun(currentDetailRun.id, { retry_failed_only: true });
    showToast(`Retry completed. Updated status: ${updated.status}`, "success");
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
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Posting GL Journal...`;
  }

  try {
    const updated = await FinanceApi.postPayrollJournal(currentDetailRun.id);
    showToast(`Balanced GL Double-Entry Journal posted successfully (#${updated.journal_transaction_id})!`, "success");
    currentDetailRun = updated;
    renderPayrollRunDetail(updated);
    await loadFinancePayroll();
  } catch (err) {
    console.error("GL Journal posting failed:", err);
    showToast("Posting GL Journal failed: " + (err.message || err), "error");
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<i class="fa-solid fa-book-journal-whills"></i> Post GL Journal`;
    }
  }
}

function exportCurrentPayrollRunLines() {
  if (!currentDetailRun || !currentDetailRun.lines) {
    showToast("No line records to export.", "warning");
    return;
  }

  const run = currentDetailRun;
  const headers = ["Employee ID", "Employee Name", "Department", "Base Salary", "Allowances", "Deductions", "Tax Withheld", "Net Pay", "Bank Name", "Bank Account", "Payment Status"];
  const rows = run.lines.map(l => [
    `"${l.employee_id}"`,
    `"${l.employee_name}"`,
    `"${l.department}"`,
    l.base_salary,
    l.allowances_total,
    l.deductions_total,
    l.tax_withheld,
    l.net_pay,
    `"${l.bank_name || ''}"`,
    `"${l.bank_account_masked || ''}"`,
    `"${l.payment_status}"`
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `payroll_${run.period_label}_disbursements.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ==========================================
// Employee Payslip View Modal
// ==========================================
async function openEmployeePayslipModal(runId, employeeId) {
  try {
    const payslip = await FinanceApi.getEmployeePayslip(runId, employeeId);
    if (!payslip) {
      showToast("Payslip record not found.", "warning");
      return;
    }

    const nameEl = document.getElementById("payslipEmpName");
    const deptEl = document.getElementById("payslipDept");
    const periodEl = document.getElementById("payslipPeriod");
    const chipEl = document.getElementById("payslipStatusChip");
    const baseEl = document.getElementById("payslipBaseSalary");
    const allowEl = document.getElementById("payslipAllowances");
    const dedEl = document.getElementById("payslipDeductions");
    const taxEl = document.getElementById("payslipTax");
    const netEl = document.getElementById("payslipNetPay");
    const bankEl = document.getElementById("payslipBankName");
    const accEl = document.getElementById("payslipMaskedAcc");
    const dateEl = document.getElementById("payslipPaidDate");

    if (nameEl) nameEl.textContent = payslip.employee_name || `Employee #${payslip.employee_id}`;
    if (deptEl) deptEl.textContent = payslip.department || "General";
    if (periodEl) periodEl.textContent = `Period ${payslip.period_label}`;
    if (chipEl) {
      chipEl.textContent = (payslip.payment_status || "PAID").toUpperCase();
      chipEl.style.background = payslip.payment_status === "paid" ? "#10B981" : "#F59E0B";
      chipEl.style.color = "#fff";
    }

    if (baseEl) baseEl.textContent = `$${Number(payslip.base_salary || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    if (allowEl) allowEl.textContent = `$${Number(payslip.allowances_total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    if (dedEl) dedEl.textContent = `-$${Number(payslip.deductions_total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    if (taxEl) taxEl.textContent = `-$${Number(payslip.tax_withheld || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    if (netEl) netEl.textContent = `$${Number(payslip.net_pay || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

    if (bankEl) bankEl.textContent = payslip.bank_name || "Direct Deposit";
    if (accEl) accEl.textContent = payslip.bank_account_masked || "••••";
    if (dateEl) dateEl.textContent = payslip.paid_at ? payslip.paid_at.split("T")[0] : payslip.period_end;

    const modal = document.getElementById("employeePayslipModal");
    if (modal) modal.style.display = "flex";
  } catch (err) {
    console.error("Failed to load payslip:", err);
    showToast("Failed to load employee payslip: " + (err.message || err), "error");
  }
}

function closeEmployeePayslipModal() {
  const modal = document.getElementById("employeePayslipModal");
  if (modal) modal.style.display = "none";
}

// ==========================================
// 7. Employee Self-Service Payslips
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
      <td>${ps.period_start} to ${ps.period_end}</td>
      <td class="cell-money">$${Number(ps.base_salary || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td class="cell-money">$${Number(ps.allowances_total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td class="cell-money">-$${Number(ps.deductions_total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</td>
      <td class="cell-money"><strong>$${Number(ps.net_pay || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong></td>
      <td><span class="badge badge-success" style="background:#10B981; color:#fff;">PAID</span></td>
      <td>
        <button class="btn btn-sm btn-outline" onclick="openEmployeePayslipModal('${ps.payroll_run_id}', '${ps.employee_id}')">
          <i class="fa-solid fa-file-invoice"></i> View
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

function openAddBonusModal(employeeId) {
  const modal = document.getElementById("payrollAddBonusModal");
  if (!modal) return;

  const empSelect = document.getElementById("bonusEmployeeSelect");
  if (empSelect) {
    empSelect.innerHTML = '<option value="">Select Employee...</option>';
    const seen = new Set();
    const run = currentDetailRun;
    if (run && run.lines) {
      run.lines.forEach(l => {
        if (!seen.has(l.employee_id)) {
          seen.add(l.employee_id);
          const opt = document.createElement("option");
          opt.value = l.employee_id;
          opt.textContent = `${l.employee_name || ('Employee #' + l.employee_id)} (${l.department || 'General'})`;
          empSelect.appendChild(opt);
        }
      });
    }

    if (window.FinanceMockState && window.FinanceMockState.employees) {
      window.FinanceMockState.employees.forEach(e => {
        if (!seen.has(e.id)) {
          seen.add(e.id);
          const opt = document.createElement("option");
          opt.value = e.id;
          opt.textContent = `${e.name} (${e.department || e.dept || 'General'})`;
          empSelect.appendChild(opt);
        }
      });
    }

    if (employeeId) {
      empSelect.value = String(employeeId);
    }
  }

  const typeSelect = document.getElementById("bonusCompensationType");
  if (typeSelect) typeSelect.value = "commission_sales";

  const amtInput = document.getElementById("bonusAmount");
  if (amtInput) amtInput.value = "";

  const notesInput = document.getElementById("bonusNotes");
  if (notesInput) notesInput.value = "";

  const taxCb = document.getElementById("bonusIsTaxableLocal");
  if (taxCb) taxCb.checked = true;

  const insCb = document.getElementById("bonusIsInsurable");
  if (insCb) insCb.checked = true;

  modal.style.display = "flex";
}

function closeAddBonusModal() {
  const modal = document.getElementById("payrollAddBonusModal");
  if (modal) modal.style.display = "none";
}

async function submitAddPayrollBonus(e) {
  if (e) e.preventDefault();
  if (!currentDetailRun) return;

  const empSelect = document.getElementById("bonusEmployeeSelect");
  const typeSelect = document.getElementById("bonusCompensationType");
  const amtInput = document.getElementById("bonusAmount");
  const notesInput = document.getElementById("bonusNotes");
  const taxCb = document.getElementById("bonusIsTaxableLocal");
  const insCb = document.getElementById("bonusIsInsurable");

  const empId = empSelect ? parseInt(empSelect.value, 10) : null;
  const compType = typeSelect ? typeSelect.value : "commission_sales";
  const amount = amtInput ? parseFloat(amtInput.value) : 0;
  const notes = notesInput ? notesInput.value.trim() : "";
  const isTaxable = taxCb ? taxCb.checked : true;
  const isInsurable = insCb ? insCb.checked : true;

  if (!empId) {
    showToast("Please select an employee.", "warning");
    return;
  }
  if (!amount || amount <= 0) {
    showToast("Amount must be greater than 0.", "warning");
    return;
  }

  const submitBtn = document.getElementById("btnSubmitAddBonus");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Adding...`;
  }

  try {
    await FinanceApi.addPayrollLine(currentDetailRun.id, {
      employee_id: empId,
      compensation_type: compType,
      amount: amount,
      notes: notes,
      is_taxable_local: isTaxable,
      is_insurable: isInsurable,
    });

    showToast("Commission / bonus line added successfully!", "success");
    closeAddBonusModal();

    const updated = await FinanceApi.getPayrollRun(currentDetailRun.id);
    currentDetailRun = updated;
    renderPayrollRunDetail(updated);
    await loadFinancePayroll();
  } catch (err) {
    console.error("Failed to add commission/bonus:", err);
    showToast("Failed to add line: " + (err.message || err), "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i class="fa-solid fa-plus"></i> Add Line`;
    }
  }
}

async function deletePayrollLineItem(runId, lineId) {
  if (!confirm("Are you sure you want to remove this payroll line?")) return;

  try {
    await FinanceApi.deletePayrollLine(runId, lineId);
    showToast("Payroll line removed successfully.", "success");

    const updated = await FinanceApi.getPayrollRun(runId);
    currentDetailRun = updated;
    renderPayrollRunDetail(updated);
    await loadFinancePayroll();
  } catch (err) {
    console.error("Failed to delete line:", err);
    showToast("Failed to delete line: " + (err.message || err), "error");
  }
}

// Window exports for Payroll Runs & Payslips
window.loadFinancePayroll = loadFinancePayroll;
window.renderFinancePayroll = renderFinancePayroll;
window.filterFinancePayrollRuns = filterFinancePayrollRuns;
window.openRunPayrollWizardModal = openRunPayrollWizardModal;
window.closeRunPayrollWizardModal = closeRunPayrollWizardModal;
window.onWizardPeriodChanged = onWizardPeriodChanged;
window.navigateWizardStep = navigateWizardStep;
window.submitWizardCreateRun = submitWizardCreateRun;
window.openPayrollRunDetail = openPayrollRunDetail;
window.closePayrollRunDetailModal = closePayrollRunDetailModal;
window.approveCurrentPayrollRun = approveCurrentPayrollRun;
window.finalizeCurrentPayrollRun = finalizeCurrentPayrollRun;
window.disburseCurrentPayrollRun = disburseCurrentPayrollRun;
window.retryFailedPayrollDisbursements = retryFailedPayrollDisbursements;
window.postCurrentPayrollJournal = postCurrentPayrollJournal;
window.exportCurrentPayrollRunLines = exportCurrentPayrollRunLines;
window.openEmployeePayslipModal = openEmployeePayslipModal;
window.closeEmployeePayslipModal = closeEmployeePayslipModal;
window.loadMyPayslips = loadMyPayslips;
window.renderMyPayslips = renderMyPayslips;
window.refreshMyPayslips = refreshMyPayslips;
window.openAddBonusModal = openAddBonusModal;
window.closeAddBonusModal = closeAddBonusModal;
window.submitAddPayrollBonus = submitAddPayrollBonus;
window.deletePayrollLineItem = deletePayrollLineItem;
