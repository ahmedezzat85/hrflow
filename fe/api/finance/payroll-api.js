/**
 * fe/api/finance/payroll-api.js
 * Finance API - Net-Payment Payroll & Compensation domain client and mock handlers.
 * Conforms to docs/payroll/09-net-payment-runner-implementation-plan.md.
 */
(function (root) {
  const _isMock = () => (typeof root._isMock === "function" ? root._isMock() : typeof window !== "undefined" && window.location && window.location.search.includes("mock="));
  const round = root.round || function (val, decimals = 2) {
    return Math.round((Number(val || 0) + Number.EPSILON) * Math.pow(10, decimals)) / Math.pow(10, decimals);
  };
  const _getIdempHeaders = root._getIdempHeaders || function (explicitKey = null) {
    const key = explicitKey || (typeof FinanceCommand !== "undefined" && FinanceCommand.generateIdempotencyKey ? FinanceCommand.generateIdempotencyKey() : null);
    return key ? { "Idempotency-Key": key } : {};
  };

  const FinanceMockState = root.FinanceMockState || (root.FinanceMockState = {});

  if (!FinanceMockState.payrollRuns) {
    FinanceMockState.payrollRuns = [
      {
        id: 1,
        period_label: "2026-08",
        period_start: "2026-08-01",
        period_end: "2026-08-31",
        payment_date: "2026-08-31",
        status: "paid",
        total_net: 27000.0,
        total_payment_amount: 27000.0,
        headcount: 2,
        recipient_count: 2,
        payment_line_count: 4,
        currency: "USD",
        bank_account_id: 1,
        bank_account_name: "Voyance Operating USD",
        external_funding_account_id: 1,
        external_funding_account_name: "Voyance Operating USD",
        internal_funding_account_id: 2,
        internal_funding_account_name: "Voyance Cash USD Account",
        fx_rate_source: "first_of_month",
        fx_rate_value: 48.5,
        created_at: "2026-08-25T09:00:00Z",
        created_by: "payroll@voyance.health",
        submitted_at: "2026-08-26T10:00:00Z",
        submitted_by: "payroll@voyance.health",
        approved_at: "2026-08-28T10:00:00Z",
        approved_by: "cfo@voyance.health",
        finalized_at: "2026-08-29T11:00:00Z",
        finalized_by: "payroll@voyance.health",
        paid_at: "2026-08-31T14:30:00Z",
        paid_by: "payroll@voyance.health",
        journal_transaction_id: 101,
        has_blocking_exceptions: false,
        exceptions: [],
        variance_summary: {
          prior_period_label: "2026-07",
          headcount_delta: 0,
          net_delta: 0.0,
          pct_change: 0.0,
          joiners_count: 0,
          leavers_count: 0,
          raises_count: 0,
        },
        lines: [
          {
            id: 1,
            payroll_run_id: 1,
            employee_id: 1,
            employee_name: "Sarah Connor",
            department: "Engineering",
            compensation_type: "external_usd",
            net_pay: 10000.0,
            amount: 10000.0,
            currency: "USD",
            bank_name: "Chase",
            bank_account_masked: "••••4821",
            payment_status: "paid",
            failure_reason: null,
            snapshot_notes: "External bank wire - August",
            created_at: "2026-08-25T09:00:00Z",
            paid_at: "2026-08-31T14:30:00Z",
          },
          {
            id: 2,
            payroll_run_id: 1,
            employee_id: 1,
            employee_name: "Sarah Connor",
            department: "Engineering",
            compensation_type: "internal_usd_cash",
            net_pay: 5000.0,
            amount: 5000.0,
            currency: "USD",
            bank_name: "Chase",
            bank_account_masked: "••••4821",
            payment_status: "paid",
            failure_reason: null,
            snapshot_notes: "Internal cash payment - August",
            created_at: "2026-08-25T09:00:00Z",
            paid_at: "2026-08-31T14:30:00Z",
          },
          {
            id: 3,
            payroll_run_id: 1,
            employee_id: 2,
            employee_name: "John DevOps",
            department: "Operations",
            compensation_type: "external_usd",
            net_pay: 8000.0,
            amount: 8000.0,
            currency: "USD",
            bank_name: "SVB",
            bank_account_masked: "••••9102",
            payment_status: "paid",
            failure_reason: null,
            snapshot_notes: "External bank wire - August",
            created_at: "2026-08-25T09:00:00Z",
            paid_at: "2026-08-31T14:30:00Z",
          },
          {
            id: 4,
            payroll_run_id: 1,
            employee_id: 2,
            employee_name: "John DevOps",
            department: "Operations",
            compensation_type: "internal_usd_cash",
            net_pay: 4000.0,
            amount: 4000.0,
            currency: "USD",
            bank_name: "SVB",
            bank_account_masked: "••••9102",
            payment_status: "paid",
            failure_reason: null,
            snapshot_notes: "Internal cash payment - August",
            created_at: "2026-08-25T09:00:00Z",
            paid_at: "2026-08-31T14:30:00Z",
          },
        ],
      },
    ];
  }

  if (!FinanceMockState.compensationPlans) {
    FinanceMockState.compensationPlans = [
      {
        id: 1,
        employee_id: 1,
        component_type: "external_usd",
        amount: 10000.0,
        currency: "USD",
        effective_start_date: "2026-01-01",
        effective_end_date: null,
        notes: "US bank account wire",
        created_at: "2026-01-01T09:00:00Z",
        updated_at: "2026-01-01T09:00:00Z",
      },
      {
        id: 2,
        employee_id: 1,
        component_type: "internal_usd_cash",
        amount: 5000.0,
        currency: "USD",
        effective_start_date: "2026-01-01",
        effective_end_date: null,
        notes: "Cairo monthly cash payout",
        created_at: "2026-01-01T09:00:00Z",
        updated_at: "2026-01-01T09:00:00Z",
      },
      {
        id: 3,
        employee_id: 2,
        component_type: "external_usd",
        amount: 8000.0,
        currency: "USD",
        effective_start_date: "2026-01-01",
        effective_end_date: null,
        notes: "US account wire",
        created_at: "2026-01-01T09:00:00Z",
        updated_at: "2026-01-01T09:00:00Z",
      },
      {
        id: 4,
        employee_id: 2,
        component_type: "internal_usd_cash",
        amount: 4000.0,
        currency: "USD",
        effective_start_date: "2026-01-01",
        effective_end_date: null,
        notes: "Local cash component",
        created_at: "2026-01-01T09:00:00Z",
        updated_at: "2026-01-01T09:00:00Z",
      },
    ];
  }

  const FinancePayrollApi = {
    async getPayrollRuns(params = {}) {
      if (_isMock()) {
        let list = [...(FinanceMockState.payrollRuns || [])];
        if (params.status && params.status !== "all") {
          list = list.filter((r) => r.status === params.status);
        }
        if (params.search) {
          const s = params.search.toLowerCase();
          list = list.filter((r) => (r.period_label || "").toLowerCase().includes(s));
        }
        return list;
      }
      const qs = new URLSearchParams(params).toString();
      return apiRequest("GET", `/api/finance/payroll/runs${qs ? "?" + qs : ""}`);
    },

    async getPayrollRun(id) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(id, 10));
        if (!run) throw new Error(`Payroll run #${id} not found`);
        return run;
      }
      return apiRequest("GET", `/api/finance/payroll/runs/${id}`);
    },

    async previewPayrollRun(payload) {
      if (_isMock()) {
        const periodLabel = payload.period_label || "2026-10";
        const fxRateSource = payload.fx_rate_value ? "manual" : (payload.fx_rate_source || "first_of_month");
        const fxRateValue = payload.fx_rate_value ? Number(payload.fx_rate_value) : (fxRateSource === "payment_date" ? 49.5 : 50.0);

        const lines = [
          {
            id: 101,
            payroll_run_id: 0,
            employee_id: 1,
            employee_name: "Sarah Connor",
            department: "Engineering",
            compensation_type: "external_usd",
            net_pay: 10000.0,
            amount: 10000.0,
            currency: "USD",
            bank_name: "Chase",
            bank_account_masked: "••••4821",
            payment_status: "pending",
            failure_reason: null,
            snapshot_notes: "External bank payment - " + periodLabel,
            created_at: new Date().toISOString(),
            paid_at: null,
          },
          {
            id: 102,
            payroll_run_id: 0,
            employee_id: 1,
            employee_name: "Sarah Connor",
            department: "Engineering",
            compensation_type: "internal_usd_cash",
            net_pay: 5000.0,
            amount: 5000.0,
            currency: "USD",
            bank_name: "Chase",
            bank_account_masked: "••••4821",
            payment_status: "pending",
            failure_reason: null,
            snapshot_notes: "Internal cash payment - " + periodLabel,
            created_at: new Date().toISOString(),
            paid_at: null,
          },
          {
            id: 103,
            payroll_run_id: 0,
            employee_id: 2,
            employee_name: "John DevOps",
            department: "Operations",
            compensation_type: "internal_usd_cash",
            net_pay: 14000.0,
            amount: 14000.0,
            currency: "USD",
            bank_name: "SVB",
            bank_account_masked: "••••9102",
            payment_status: "pending",
            failure_reason: null,
            snapshot_notes: "Internal cash payment - " + periodLabel,
            created_at: new Date().toISOString(),
            paid_at: null,
          },
        ];

        const exceptions = [];
        let hasBlocking = false;

        if (payload.simulate_missing_bank) {
          hasBlocking = true;
          exceptions.push({
            id: "exc-bank-1",
            employee_id: 1,
            employee_name: "Sarah Connor",
            severity: "blocking",
            code: "MISSING_BANK_DETAILS",
            title: "Missing Bank Wire Details",
            description: "Sarah Connor is scheduled for external bank payment but does not have verified wire details on file.",
            correction_path: "/admin?section=employees&employee_id=1",
            is_resolved: false,
          });
        }

        const previewId = `PRV-${periodLabel.replace(/-/g, "")}-0042`;
        const totalNet = lines.reduce((sum, l) => sum + l.net_pay, 0);

        const rawEmployeesList = (typeof window !== "undefined" && Array.isArray(window.employees) && window.employees.length > 0)
          ? window.employees
          : [
              { id: 1, name: "Sarah Connor", dept: "Engineering", baseExt: 10000.0, baseInt: 5000.0, bank_name: "Chase", masked: "••••4821" },
              { id: 2, name: "John DevOps", dept: "Operations", baseExt: 0.0, baseInt: 14000.0, bank_name: "SVB", masked: "••••9102" },
              { id: 301, name: 'Youssef Adel', dept: 'Operations', baseExt: 1800, baseInt: 4300, bank_name: "CIB", masked: "••••4021" },
              { id: 302, name: 'Salma Ibrahim', dept: 'Operations', baseExt: 0, baseInt: 4450, bank_name: "NBE", masked: "••••1092" },
              { id: 303, name: 'Karim Nabil', dept: 'Operations', baseExt: 2500, baseInt: 4500, bank_name: "QNB", masked: "••••8831" },
              { id: 304, name: 'Mariam Essam', dept: 'Operations', baseExt: 1200, baseInt: 4550, bank_name: "HSBC", masked: "••••6612" },
              { id: 305, name: 'Omar Farouk', dept: 'Operations', baseExt: 0, baseInt: 4200, bank_name: "CIB", masked: "••••5541" },
              { id: 306, name: 'Nadine Samir', dept: 'Operations', baseExt: 2000, baseInt: 3100, bank_name: "AlexBank", masked: "••••9920" },
              { id: 307, name: 'Hassan Tarek', dept: 'Operations', baseExt: 0, baseInt: 5200, bank_name: "Banque Misr", masked: "••••3321" },
              { id: 308, name: 'Lina Kamal', dept: 'Operations', baseExt: 1600, baseInt: 3900, bank_name: "CIB", masked: "••••7711" },
            ];

        const empRate = (FinanceMockState.payrollSettings && FinanceMockState.payrollSettings.employee_rate) || 0.11;
        const orgRate = (FinanceMockState.payrollSettings && FinanceMockState.payrollSettings.employer_rate) || 0.18;

        const recipients = rawEmployeesList.map(e => {
          const ext = Number(e.baseExt !== undefined ? e.baseExt : (e.externalSalaryUsd !== undefined ? e.externalSalaryUsd : (e.external_salary_usd || 0)));
          let intSal = Number(e.baseInt !== undefined ? e.baseInt : (e.internalSalaryUsd !== undefined ? e.internalSalaryUsd : (e.internal_salary_usd || 0)));
          if (ext === 0 && intSal === 0 && e.salary) intSal = Number(e.salary);

          const isInsured = e.is_insured !== false;
          const ded = (intSal > 0 && isInsured) ? round(intSal * empRate, 2) : 0.0;
          const finalInt = round(intSal - ded, 2);
          const finalExt = round(ext, 2);

          const isBlocker = payload.simulate_missing_bank && e.id === 1;

          return {
            employee_id: e.id,
            employee_name: e.name,
            department: e.dept || e.department || "Operations",
            base_int_amount: intSal,
            base_ext_amount: ext,
            int_deductions_total: ded,
            deductions_label: ded > 0 ? "Social Insurance (Internal Estimate)" : null,
            employer_cost_extra: (intSal > 0 && isInsured) ? round(intSal * orgRate, 2) : 0.0,
            int_adjustments_total: 0.0,
            ext_adjustments_total: 0.0,
            final_int_amount: finalInt,
            final_ext_amount: finalExt,
            final_payment_amount: round(finalInt + finalExt, 2),
            adjustments: [],
            bank_name: e.bank_name || "Primary Bank",
            destination_masked: e.masked || e.bank_account_masked || "••••4021",
            readiness: {
              status: isBlocker ? "BLOCKER" : "READY",
              issues: isBlocker ? ["Sarah Connor is scheduled for external bank payment but does not have verified wire details on file."] : [],
            },
          };
        });

        // Ensure Sarah Connor is always available in recipients for legacy wizard specs
        if (!recipients.some(r => r.employee_id === 1)) {
          recipients.unshift({
            employee_id: 1,
            employee_name: "Sarah Connor",
            department: "Engineering",
            base_int_amount: 5000.0,
            base_ext_amount: 10000.0,
            int_deductions_total: 550.0,
            deductions_label: "Social Insurance (Internal Estimate)",
            employer_cost_extra: 900.0,
            int_adjustments_total: 0.0,
            ext_adjustments_total: 0.0,
            final_int_amount: 4450.0,
            final_ext_amount: 10000.0,
            final_payment_amount: 14450.0,
            adjustments: [],
            bank_name: "Chase",
            destination_masked: "••••4821",
            readiness: {
              status: payload.simulate_missing_bank ? "BLOCKER" : "READY",
              issues: payload.simulate_missing_bank ? ["Sarah Connor is scheduled for external bank payment but does not have verified wire details on file."] : [],
            },
          });
        }

        const prevObj = {
          preview_id: previewId,
          preview_version: 1,
          source_version: "src-mock-v1",
          generated_at: new Date().toISOString(),
          period_label: periodLabel,
          period_start: payload.period_start || `${periodLabel}-01`,
          period_end: payload.period_end || `${periodLabel}-30`,
          payment_date: payload.payment_date || payload.period_end || `${periodLabel}-30`,
          bank_account_id: payload.bank_account_id || 1,
          bank_account_name: "Voyance Operating USD",
          external_funding_account_id: payload.external_funding_account_id || 1,
          external_funding_account_name: "Voyance Operating USD",
          internal_funding_account_id: payload.internal_funding_account_id || 2,
          internal_funding_account_name: "Voyance Cash USD Account",
          fx_rate_source: fxRateSource,
          fx_rate_value: fxRateValue,
          headcount: 2,
          recipient_count: 2,
          payment_line_count: lines.length,
          total_net: totalNet,
          total_payment_amount: totalNet,
          total_commissions: 0.0,
          total_bonuses: 0.0,
          total_additions: 0.0,
          final_int_total: 19000.0,
          final_ext_total: 10000.0,
          prior_period_total: 27000.0,
          change_amount: round(totalNet - 27000.0),
          has_blocking_exceptions: hasBlocking,
          exceptions: exceptions,
          variance_summary: {
            prior_period_label: "2026-08",
            headcount_delta: 0,
            net_delta: round(totalNet - 27000.0),
            pct_change: round(((totalNet - 27000.0) / 27000.0) * 100, 1),
            joiners_count: 0,
            leavers_count: 0,
            raises_count: totalNet > 27000.0 ? 1 : 0,
          },
          lines: lines,
          recipients: recipients,
          adjustments: [],
        };

        FinanceMockState.previews = FinanceMockState.previews || {};
        FinanceMockState.previews[previewId] = prevObj;
        return prevObj;
      }
      return apiRequest("POST", "/api/finance/payroll/previews", payload);
    },

    async getPreview(previewId) {
      if (_isMock()) {
        const p = (FinanceMockState.previews || {})[previewId];
        if (!p) throw new Error(`Preview '${previewId}' not found`);
        return p;
      }
      return apiRequest("GET", `/api/finance/payroll/previews/${previewId}`);
    },

    async getPreviewAdjustments(previewId) {
      if (_isMock()) {
        const p = (FinanceMockState.previews || {})[previewId];
        return p ? (p.adjustments || []) : [];
      }
      return apiRequest("GET", `/api/finance/payroll/previews/${previewId}/adjustments`);
    },

    async addPreviewAdjustment(previewId, payload) {
      if (_isMock()) {
        const p = (FinanceMockState.previews || {})[previewId];
        if (!p) throw new Error(`Preview '${previewId}' not found`);
        if (!payload.amount || Number(payload.amount) <= 0) {
          throw new Error("Adjustment amount must be greater than zero.");
        }
        if (payload.external_reference) {
          const dup = (p.adjustments || []).find(a => a.external_reference === payload.external_reference);
          if (dup) throw new Error(`Duplicate external reference '${payload.external_reference}'.`);
        }
        const adjId = `adj_mock_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
        const adj = {
          id: adjId,
          employee_id: payload.employee_id,
          preview_id: previewId,
          payroll_run_id: null,
          type: (payload.type || "BONUS").toUpperCase(),
          direction: "ADDITION",
          amount: round(payload.amount),
          currency: payload.currency || "USD",
          payment_source: (payload.payment_source || "INT").toUpperCase(),
          effective_period: p.period_label,
          description: payload.description || "",
          external_reference: payload.external_reference || null,
          origin: "MANUAL",
          status: "DRAFT",
          created_by: "admin@voyance.health",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        p.adjustments = p.adjustments || [];
        p.adjustments.push(adj);
        p.preview_version = (p.preview_version || 1) + 1;
        this._recalculateMockPreview(p);
        return adj;
      }
      return apiRequest("POST", `/api/finance/payroll/previews/${previewId}/adjustments`, payload);
    },

    async updatePreviewAdjustment(previewId, adjustmentId, payload) {
      if (_isMock()) {
        const p = (FinanceMockState.previews || {})[previewId];
        if (!p) throw new Error(`Preview '${previewId}' not found`);
        const adj = (p.adjustments || []).find(a => a.id === adjustmentId);
        if (!adj) throw new Error(`Adjustment '${adjustmentId}' not found`);
        if (payload.amount !== undefined) {
          if (Number(payload.amount) <= 0) throw new Error("Adjustment amount must be greater than zero.");
          adj.amount = round(payload.amount);
        }
        if (payload.type) adj.type = payload.type.toUpperCase();
        if (payload.payment_source) adj.payment_source = payload.payment_source.toUpperCase();
        if (payload.description !== undefined) adj.description = payload.description;
        if (payload.external_reference !== undefined) adj.external_reference = payload.external_reference;
        adj.updated_at = new Date().toISOString();
        p.preview_version = (p.preview_version || 1) + 1;
        this._recalculateMockPreview(p);
        return adj;
      }
      return apiRequest("PATCH", `/api/finance/payroll/previews/${previewId}/adjustments/${adjustmentId}`, payload);
    },

    async deletePreviewAdjustment(previewId, adjustmentId) {
      if (_isMock()) {
        const p = (FinanceMockState.previews || {})[previewId];
        if (!p) throw new Error(`Preview '${previewId}' not found`);
        p.adjustments = (p.adjustments || []).filter(a => a.id !== adjustmentId);
        p.preview_version = (p.preview_version || 1) + 1;
        this._recalculateMockPreview(p);
        return { success: true, deleted_id: adjustmentId };
      }
      return apiRequest("DELETE", `/api/finance/payroll/previews/${previewId}/adjustments/${adjustmentId}`);
    },

    _recalculateMockPreview(p) {
      const allAdjs = p.adjustments || [];
      (p.recipients || []).forEach(r => {
        const empAdjs = allAdjs.filter(a => a.employee_id === r.employee_id);
        r.adjustments = empAdjs;
        r.int_adjustments_total = round(empAdjs.filter(a => a.payment_source === "INT").reduce((sum, a) => sum + a.amount, 0));
        r.ext_adjustments_total = round(empAdjs.filter(a => a.payment_source === "EXT").reduce((sum, a) => sum + a.amount, 0));
        r.final_int_amount = round(r.base_int_amount + r.int_adjustments_total);
        r.final_ext_amount = round(r.base_ext_amount + r.ext_adjustments_total);
        r.final_payment_amount = round(r.final_int_amount + r.final_ext_amount);
      });
      p.total_commissions = round(allAdjs.filter(a => a.type === "COMMISSION").reduce((sum, a) => sum + a.amount, 0));
      p.total_bonuses = round(allAdjs.filter(a => a.type === "BONUS").reduce((sum, a) => sum + a.amount, 0));
      p.total_additions = round(p.total_commissions + p.total_bonuses);
      p.final_int_total = round((p.recipients || []).reduce((sum, r) => sum + r.final_int_amount, 0));
      p.final_ext_total = round((p.recipients || []).reduce((sum, r) => sum + r.final_ext_amount, 0));
      p.total_net = round(p.final_int_total + p.final_ext_total);
      p.total_payment_amount = p.total_net;
      p.change_amount = round(p.total_net - (p.prior_period_total || 27000.0));
      if (p.variance_summary) {
        p.variance_summary.net_delta = p.change_amount;
      }
    },

    async generatePayrollRun(payload) {
      if (_isMock()) {
        const prev = await this.previewPayrollRun(payload);
        const newRun = {
          id: (FinanceMockState.payrollRuns || []).length + 1,
          period_label: payload.period_label,
          period_start: payload.period_start,
          period_end: payload.period_end,
          payment_date: payload.payment_date || payload.period_end,
          status: "draft",
          fx_rate_source: prev.fx_rate_source,
          fx_rate_value: prev.fx_rate_value,
          total_net: prev.total_net,
          total_payment_amount: prev.total_net,
          headcount: prev.headcount,
          recipient_count: prev.recipient_count,
          payment_line_count: prev.payment_line_count,
          currency: payload.currency || "USD",
          bank_account_id: prev.bank_account_id,
          bank_account_name: prev.bank_account_name,
          external_funding_account_id: prev.external_funding_account_id,
          external_funding_account_name: prev.external_funding_account_name,
          internal_funding_account_id: prev.internal_funding_account_id,
          internal_funding_account_name: prev.internal_funding_account_name,
          created_at: new Date().toISOString(),
          created_by: "admin@voyance.health",
          has_blocking_exceptions: prev.has_blocking_exceptions,
          exceptions: prev.exceptions,
          variance_summary: prev.variance_summary,
          lines: prev.lines.map((l, idx) => ({ ...l, id: idx + 1, payroll_run_id: (FinanceMockState.payrollRuns || []).length + 1 })),
        };
        (FinanceMockState.payrollRuns || (FinanceMockState.payrollRuns = [])).unshift(newRun);
        return newRun;
      }
      return apiRequest("POST", "/api/finance/payroll/runs/generate", payload);
    },

    async createPayrollRun(payload) {
      if (_isMock()) {
        if (payload.source_version === "simulate-stale") {
          throw new Error("Payroll source data has changed since this preview was generated. Please refresh preview.");
        }

        const prev = await this.previewPayrollRun(payload);
        const runId = (FinanceMockState.payrollRuns || []).length + 1;
        const submitForApproval = Boolean(payload.submit_for_approval);

        const newRun = {
          id: runId,
          period_label: payload.period_label,
          period_start: payload.period_start,
          period_end: payload.period_end,
          payment_date: payload.payment_date || payload.period_end,
          status: submitForApproval ? "submitted" : "draft",
          fx_rate_source: payload.fx_rate_source || "first_of_month",
          fx_rate_value: payload.fx_rate_value || prev.fx_rate_value,
          total_net: prev.total_net,
          total_payment_amount: prev.total_net,
          headcount: prev.headcount,
          recipient_count: prev.recipient_count,
          payment_line_count: prev.payment_line_count,
          currency: payload.currency || "USD",
          bank_account_id: payload.bank_account_id || prev.bank_account_id,
          bank_account_name: prev.bank_account_name,
          external_funding_account_id: payload.external_funding_account_id || prev.external_funding_account_id,
          external_funding_account_name: prev.external_funding_account_name,
          internal_funding_account_id: payload.internal_funding_account_id || prev.internal_funding_account_id,
          internal_funding_account_name: prev.internal_funding_account_name,
          preview_id: payload.preview_id || prev.preview_id,
          preview_version: payload.preview_version || prev.preview_version,
          source_version: payload.source_version || prev.source_version,
          created_at: new Date().toISOString(),
          created_by: "preparer@voyance.health",
          submitted_at: submitForApproval ? new Date().toISOString() : null,
          submitted_by: submitForApproval ? "preparer@voyance.health" : null,
          approved_at: null,
          approved_by: null,
          finalized_at: null,
          finalized_by: null,
          paid_at: null,
          paid_by: null,
          has_blocking_exceptions: prev.has_blocking_exceptions,
          exceptions: prev.exceptions,
          variance_summary: prev.variance_summary,
          lines: prev.lines.map((l, idx) => ({ ...l, id: idx + 10, payroll_run_id: runId })),
        };
        (FinanceMockState.payrollRuns || (FinanceMockState.payrollRuns = [])).unshift(newRun);
        return newRun;
      }
      return apiRequest("POST", "/api/finance/payroll/runs", payload);
    },

    async submitPayrollRun(runId) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        if (run.status !== "draft") {
          throw new Error(`Only draft runs can be submitted for approval. Current status: ${run.status}`);
        }
        run.status = "submitted";
        run.submitted_at = new Date().toISOString();
        run.submitted_by = "preparer@voyance.health";
        return run;
      }
      return apiRequest("POST", `/api/finance/payroll/runs/${runId}/submit`);
    },

    async approvePayrollRun(runId, allowSelfApproval = false) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        if (!["draft", "submitted"].includes(run.status)) {
          throw new Error(`Payroll run #${runId} is in status '${run.status}', only draft or submitted runs can be approved.`);
        }
        if (!allowSelfApproval && run.simulate_self_approval_error) {
          throw new Error("Maker-checker policy violation: The preparer or submitter cannot approve their own payroll run. An independent finance reviewer must approve.");
        }
        run.status = "approved";
        run.approved_at = new Date().toISOString();
        run.approved_by = "cfo@voyance.health";
        return run;
      }
      return apiRequest("POST", `/api/finance/payroll/runs/${runId}/approve`);
    },

    async finalizePayrollRun(runId) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        if (run.status !== "approved") {
          throw new Error(`Payroll run #${runId} must be approved before finalization. Current status: '${run.status}'.`);
        }
        run.status = "finalized";
        run.finalized_at = new Date().toISOString();
        run.finalized_by = "cfo@voyance.health";
        return run;
      }
      return apiRequest("POST", `/api/finance/payroll/runs/${runId}/finalize`);
    },

    async disbursePayrollRun(runId, retryFailedOnly = false, simulateFailures = null) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        const lines = run.lines || [];
        const now = new Date().toISOString();

        lines.forEach((l) => {
          if (retryFailedOnly && l.payment_status !== "failed") return;
          if (!retryFailedOnly && l.payment_status === "paid") return;

          if (simulateFailures && simulateFailures.includes(l.employee_id)) {
            l.payment_status = "failed";
            l.failure_reason = "Payment Gateway Reject: Account Routing Failure";
          } else {
            l.payment_status = "paid";
            l.paid_at = now;
            l.failure_reason = null;
          }
        });

        const hasFailed = lines.some((l) => l.payment_status === "failed");
        const hasPending = lines.some((l) => l.payment_status === "pending");

        if (hasFailed) {
          run.status = "partially_paid";
        } else if (!hasPending) {
          run.status = "paid";
          run.paid_at = now;
        }
        run.paid_by = "payroll@voyance.health";
        return run;
      }
      return apiRequest("POST", `/api/finance/payroll/runs/${runId}/pay`, {
        retry_failed_only: retryFailedOnly,
        simulate_partial_failure_ids: simulateFailures,
      });
    },

    async postPayrollJournal(runId) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        run.journal_transaction_id = 999;
        return {
          success: true,
          journal_transaction_id: 999,
          reference: `PAYROLL-${run.period_label}`,
          amount: run.total_net,
          date: new Date().toISOString().slice(0, 10),
          is_already_posted: false,
        };
      }
      return apiRequest("POST", `/api/finance/payroll/runs/${runId}/post-journal`);
    },

    async addPayrollLine(runId, payload) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        if (run.status !== "draft") {
          throw new Error(`Cannot add lines to payroll run #${runId}: Run is locked in status '${run.status}'.`);
        }

        const amt = round(Number(payload.amount || payload.base_salary || 0));
        const cType = payload.compensation_type || "internal_usd_cash";
        const empId = parseInt(payload.employee_id, 10);

        let empName = "Employee";
        let dept = "General";
        let bankName = "Commercial Bank";
        let bankAcc = "••••4821";

        const existingLine = (run.lines || []).find((l) => l.employee_id === empId);
        if (existingLine) {
          empName = existingLine.employee_name;
          dept = existingLine.department;
          bankName = existingLine.bank_name;
          bankAcc = existingLine.bank_account_masked;
        }

        const newLine = {
          id: Date.now() + Math.floor(Math.random() * 1000),
          payroll_run_id: run.id,
          employee_id: empId,
          employee_name: empName,
          department: dept,
          compensation_type: cType,
          net_pay: amt,
          amount: amt,
          currency: run.currency || "USD",
          bank_name: bankName,
          bank_account_masked: bankAcc,
          payment_status: "pending",
          failure_reason: null,
          snapshot_notes: payload.notes || payload.snapshot_notes || `${cType.replace(/_/g, " ")} - ${run.period_label}`,
          created_at: new Date().toISOString(),
          paid_at: null,
        };

        if (!run.lines) run.lines = [];
        run.lines.push(newLine);

        run.total_net = round(run.lines.reduce((s, l) => s + Number(l.net_pay || 0), 0));
        run.total_payment_amount = run.total_net;
        run.headcount = new Set(run.lines.map((l) => l.employee_id)).size;
        run.recipient_count = run.headcount;
        run.payment_line_count = run.lines.length;

        return newLine;
      }
      return apiRequest("POST", `/api/finance/payroll/runs/${runId}/lines`, payload);
    },

    async deletePayrollLine(runId, lineId) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        if (run.status !== "draft") {
          throw new Error(`Cannot delete lines from payroll run #${runId}: Run is locked in status '${run.status}'.`);
        }

        const idx = (run.lines || []).findIndex((l) => l.id === parseInt(lineId, 10));
        if (idx === -1) throw new Error(`Payroll line #${lineId} not found in run #${runId}`);
        run.lines.splice(idx, 1);

        run.total_net = round(run.lines.reduce((s, l) => s + Number(l.net_pay || 0), 0));
        run.total_payment_amount = run.total_net;
        run.headcount = new Set(run.lines.map((l) => l.employee_id)).size;
        run.recipient_count = run.headcount;
        run.payment_line_count = run.lines.length;

        return { success: true };
      }
      return apiRequest("DELETE", `/api/finance/payroll/runs/${runId}/lines/${lineId}`);
    },

    async getMyPayslips() {
      if (_isMock()) {
        const runs = FinanceMockState.payrollRuns || [];
        const results = [];
        runs.forEach((r) => {
          (r.lines || []).forEach((l) => {
            results.push({
              id: l.id,
              payroll_run_id: r.id,
              employee_id: l.employee_id,
              employee_name: l.employee_name,
              department: l.department,
              period_label: r.period_label,
              period_start: r.period_start,
              period_end: r.period_end,
              currency: r.currency || "USD",
              net_pay: l.net_pay,
              amount: l.net_pay,
              payment_status: l.payment_status || "paid",
              bank_name: l.bank_name,
              bank_account_masked: l.bank_account_masked,
              compensation_type: l.compensation_type,
              paid_date: l.paid_at ? l.paid_at.slice(0, 10) : r.period_end,
            });
          });
        });
        return results;
      }
      return apiRequest("GET", "/api/finance/payroll/payslips/my");
    },

    async getEmployeePayslip(runId, employeeId) {
      if (_isMock()) {
        const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
        if (!run) throw new Error(`Payroll run #${runId} not found`);
        const empLines = (run.lines || []).filter((l) => l.employee_id === parseInt(employeeId, 10));
        if (empLines.length === 0) throw new Error(`Employee #${employeeId} not found in run #${runId}`);
        const line = empLines[0];
        const netPay = empLines.reduce((sum, l) => sum + Number(l.net_pay || 0), 0);
        return {
          id: line.id,
          payroll_run_id: run.id,
          employee_id: line.employee_id,
          employee_name: line.employee_name,
          department: line.department,
          period_label: run.period_label,
          period_start: run.period_start,
          period_end: run.period_end,
          currency: run.currency || "USD",
          net_pay: netPay,
          amount: netPay,
          status: line.payment_status || "paid",
          paid_date: line.paid_at ? line.paid_at.slice(0, 10) : run.period_end,
          bank_name: line.bank_name,
          bank_account_masked: line.bank_account_masked,
          compensation_type: line.compensation_type,
        };
      }
      return apiRequest("GET", `/api/finance/payroll/runs/${runId}/payslips/${employeeId}`);
    },

    // Employee Compensation Plans (FUX-416)
    async getEmployeeCompensationPlan(employeeId) {
      if (_isMock()) {
        const plans = (FinanceMockState.compensationPlans || []).filter(
          (p) => String(p.employee_id) === String(employeeId) && !p.effective_end_date
        );
        const ext = plans.find((p) => p.component_type === "external_usd") || null;
        const intCash = plans.find((p) => p.component_type === "internal_usd_cash") || null;
        const total = round((ext ? Number(ext.amount) : 0) + (intCash ? Number(intCash.amount) : 0));
        return {
          employee_id: employeeId,
          external_usd: ext,
          internal_usd_cash: intCash,
          total_monthly_usd: total,
        };
      }
      return apiRequest("GET", `/api/finance/employees/${employeeId}/compensation-plan`);
    },

    async getEmployeeCompensationPlanHistory(employeeId) {
      if (_isMock()) {
        const history = (FinanceMockState.compensationPlans || [])
          .filter((p) => String(p.employee_id) === String(employeeId))
          .sort((a, b) => new Date(b.effective_start_date) - new Date(a.effective_start_date) || b.id - a.id);
        return history;
      }
      return apiRequest("GET", `/api/finance/employees/${employeeId}/compensation-plan/history`);
    },

    async setEmployeeCompensationPlanComponent(employeeId, componentType, data) {
      if (_isMock()) {
        const amt = Number(data.amount);
        if (isNaN(amt) || amt <= 0) {
          throw new Error("Component amount must be greater than 0");
        }
        if (!data.effective_start_date) {
          throw new Error("effective_start_date is required");
        }
        if (!["external_usd", "internal_usd_cash"].includes(componentType)) {
          throw new Error(`Invalid component_type '${componentType}'`);
        }

        const plans = FinanceMockState.compensationPlans || [];
        const activeIdx = plans.findIndex(
          (p) => String(p.employee_id) === String(employeeId) && p.component_type === componentType && !p.effective_end_date
        );

        if (activeIdx >= 0) {
          const active = plans[activeIdx];
          if (data.effective_start_date <= active.effective_start_date) {
            throw new Error(`New effective_start_date must be strictly after current component start date (${active.effective_start_date})`);
          }
          const d = new Date(data.effective_start_date);
          d.setDate(d.getDate() - 1);
          active.effective_end_date = d.toISOString().slice(0, 10);
          active.updated_at = new Date().toISOString();
        }

        const newId = plans.length > 0 ? Math.max(...plans.map((p) => p.id)) + 1 : 1;
        const newRow = {
          id: newId,
          employee_id: employeeId,
          component_type: componentType,
          amount: round(amt),
          currency: "USD",
          salary_basis: componentType === "internal_usd_cash" ? (data.salary_basis || "NET") : "NET",
          effective_start_date: data.effective_start_date,
          effective_end_date: null,
          notes: data.notes || "",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        plans.push(newRow);

        if (typeof employees !== "undefined" && Array.isArray(employees)) {
          const emp = employees.find((e) => String(e.id) === String(employeeId));
          if (emp) {
            if (componentType === "external_usd") emp.externalSalaryUsd = round(amt);
            if (componentType === "internal_usd_cash") emp.internalSalaryUsd = round(amt);
            emp.salary = round((emp.externalSalaryUsd || 0) + (emp.internalSalaryUsd || 0));
          }
        }

        return newRow;
      }
      return apiRequest("PUT", `/api/finance/employees/${employeeId}/compensation-plan/${componentType}`, data);
    },

    async getPayrollSettings() {
      if (_isMock()) {
        if (!FinanceMockState.payrollSettings) {
          FinanceMockState.payrollSettings = {
            id: 1,
            employee_rate: 0.11,
            employer_rate: 0.18,
            updated_at: new Date().toISOString(),
            updated_by: "admin@voyance.health"
          };
        }
        return FinanceMockState.payrollSettings;
      }
      return apiRequest("GET", "/api/finance/payroll/settings");
    },

    async updatePayrollSettings(payload) {
      if (_isMock()) {
        FinanceMockState.payrollSettings = {
          id: 1,
          employee_rate: Number(payload.employee_rate),
          employer_rate: Number(payload.employer_rate),
          updated_at: new Date().toISOString(),
          updated_by: "admin@voyance.health"
        };
        return FinanceMockState.payrollSettings;
      }
      return apiRequest("PUT", "/api/finance/payroll/settings", payload);
    },

    getLastCorrelationId() {
      return typeof window.Api !== "undefined" && window.Api.getLastCorrelationId
        ? window.Api.getLastCorrelationId()
        : (typeof _lastCorrelationId !== "undefined" && _lastCorrelationId ? _lastCorrelationId : `corr-${Date.now()}`);
    },

    generateCorrelationId() {
      return typeof window.Api !== "undefined" && window.Api.generateCorrelationId
        ? window.Api.generateCorrelationId()
        : `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    },
  };

  root.FinancePayrollApi = FinancePayrollApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinancePayrollApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinancePayrollApi;
  }
})(typeof window !== "undefined" ? window : globalThis);
