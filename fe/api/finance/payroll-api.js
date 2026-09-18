/**
 * fe/api/finance/payroll-api.js
 * Finance API - Payroll & Compensation domain client and mock handlers.
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
      status: "paid",
      total_gross: 45000.0,
      total_tax: 4500.0,
      total_deductions: 2250.0,
      total_net: 38250.0,
      total_employer_cost: 50400.0,
      headcount: 4,
      currency: "USD",
      bank_account_id: 1,
      bank_account_name: "Voyance Operating USD",
      created_at: "2026-08-25T09:00:00Z",
      created_by: "payroll@voyance.health",
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
        gross_delta: 0.0,
        net_delta: 0.0,
        pct_change: 0.0,
        joiners_count: 0,
        leavers_count: 0,
        raises_count: 0,
      },
      liabilities_summary: {
        net_pay_payable: 38250.0,
        income_tax_withheld: 4500.0,
        social_insurance_employee: 2250.0,
        social_insurance_employer: 5400.0,
        total_liabilities: 50400.0,
      },
      lines: [
        {
          id: 1,
          payroll_run_id: 1,
          employee_id: 1,
          employee_name: "Sarah Connor",
          department: "Engineering",
          base_salary: 15000.0,
          allowances_total: 0.0,
          deductions_total: 750.0,
          tax_amount: 1500.0,
          net_pay: 12750.0,
          employer_cost_extra: 1800.0,
          bank_name: "Chase",
          bank_account_masked: "••••4821",
          payment_status: "paid",
          failure_reason: null,
          snapshot_notes: "August regular payroll",
          created_at: "2026-08-25T09:00:00Z",
          paid_at: "2026-08-31T14:30:00Z",
        },
        {
          id: 2,
          payroll_run_id: 1,
          employee_id: 2,
          employee_name: "John DevOps",
          department: "Operations",
          base_salary: 12000.0,
          allowances_total: 0.0,
          deductions_total: 600.0,
          tax_amount: 1200.0,
          net_pay: 10200.0,
          employer_cost_extra: 1440.0,
          bank_name: "SVB",
          bank_account_masked: "••••9102",
          payment_status: "paid",
          failure_reason: null,
          snapshot_notes: "August regular payroll",
          created_at: "2026-08-25T09:00:00Z",
          paid_at: "2026-08-31T14:30:00Z",
        },
      ],
    },
    {
      id: 2,
      period_label: "2026-09",
      period_start: "2026-09-01",
      period_end: "2026-09-30",
      status: "draft",
      total_gross: 47000.0,
      total_tax: 4700.0,
      total_deductions: 2350.0,
      total_net: 39950.0,
      total_employer_cost: 52640.0,
      headcount: 4,
      currency: "USD",
      bank_account_id: 1,
      bank_account_name: "Voyance Operating USD",
      created_at: "2026-09-10T10:00:00Z",
      created_by: "payroll@voyance.health",
      approved_at: null,
      approved_by: null,
      finalized_at: null,
      finalized_by: null,
      paid_at: null,
      paid_by: null,
      journal_transaction_id: null,
      has_blocking_exceptions: false,
      exceptions: [],
      variance_summary: {
        prior_period_label: "2026-08",
        headcount_delta: 0,
        gross_delta: 2000.0,
        net_delta: 1700.0,
        pct_change: 4.4,
        joiners_count: 0,
        leavers_count: 0,
        raises_count: 1,
      },
      liabilities_summary: {
        net_pay_payable: 39950.0,
        income_tax_withheld: 4700.0,
        social_insurance_employee: 2350.0,
        social_insurance_employer: 5640.0,
        total_liabilities: 52640.0,
      },
      lines: [
        {
          id: 3,
          payroll_run_id: 2,
          employee_id: 1,
          employee_name: "Sarah Connor",
          department: "Engineering",
          base_salary: 15000.0,
          allowances_total: 0.0,
          deductions_total: 750.0,
          tax_amount: 1500.0,
          net_pay: 12750.0,
          employer_cost_extra: 1800.0,
          bank_name: "Chase",
          bank_account_masked: "••••4821",
          payment_status: "pending",
          failure_reason: null,
          snapshot_notes: "September regular payroll",
          created_at: "2026-09-10T10:00:00Z",
          paid_at: null,
        },
        {
          id: 4,
          payroll_run_id: 2,
          employee_id: 2,
          employee_name: "John DevOps",
          department: "Operations",
          base_salary: 14000.0,
          allowances_total: 0.0,
          deductions_total: 700.0,
          tax_amount: 1400.0,
          net_pay: 11900.0,
          employer_cost_extra: 1680.0,
          bank_name: "SVB",
          bank_account_masked: "••••9102",
          payment_status: "pending",
          failure_reason: null,
          snapshot_notes: "September regular payroll (promotion adjustment)",
          created_at: "2026-09-10T10:00:00Z",
          paid_at: null,
        },
      ],
    },
  ];
  }

  if (!FinanceMockState.compensationPlans) {
    FinanceMockState.compensationPlans = [
    {
      id: 1,
      employee_id: "EMP001",
      component_type: "external_usd",
      amount: 8000.0,
      currency: "USD",
      effective_start_date: "2026-01-01",
      effective_end_date: null,
      notes: "US account direct deposit",
      created_at: "2026-01-01T09:00:00Z",
      updated_at: "2026-01-01T09:00:00Z",
    },
    {
      id: 2,
      employee_id: "EMP001",
      component_type: "internal_usd_cash",
      amount: 4500.0,
      currency: "USD",
      effective_start_date: "2026-01-01",
      effective_end_date: null,
      notes: "Cairo monthly cash payout",
      created_at: "2026-01-01T09:00:00Z",
      updated_at: "2026-01-01T09:00:00Z",
    },
    {
      id: 3,
      employee_id: 1,
      component_type: "external_usd",
      amount: 10000.0,
      currency: "USD",
      effective_start_date: "2026-01-01",
      effective_end_date: null,
      notes: "US account direct deposit",
      created_at: "2026-01-01T09:00:00Z",
      updated_at: "2026-01-01T09:00:00Z",
    },
    {
      id: 4,
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
      id: 5,
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
      id: 6,
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
// Story 8.1: Guided Payroll Run
  // ==========================================
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

  async previewPayrollRun(payload) {
    if (_isMock()) {
      const fxRateSource = payload.fx_rate_source || "first_of_month";
      const fxRateValue = payload.fx_rate_value || (fxRateSource === "payment_date" ? 49.5 : 48.5);
      return {
        period_label: payload.period_label || "2026-10",
        period_start: payload.period_start || "2026-10-01",
        period_end: payload.period_end || "2026-10-31",
        bank_account_id: payload.bank_account_id || 1,
        bank_account_name: "Voyance Operating USD",
        external_funding_account_id: payload.external_funding_account_id || payload.bank_account_id || 1,
        external_funding_account_name: "Voyance Operating USD",
        internal_funding_account_id: payload.internal_funding_account_id || payload.bank_account_id || 2,
        internal_funding_account_name: "Voyance Cash USD Account",
        fx_rate_source: fxRateSource,
        fx_rate_value: fxRateValue,
        headcount: 3,
        total_gross: 29000.0,
        total_tax: 0.0,
        total_deductions: 0.0,
        total_net: 29000.0,
        total_employer_cost: 29000.0,
        has_blocking_exceptions: false,
        exceptions: [],
        variance_summary: {
          prior_period_label: "2026-09",
          headcount_delta: 0,
          gross_delta: 1500.0,
          net_delta: 1500.0,
          pct_change: 3.2,
          joiners_count: 0,
          leavers_count: 0,
          raises_count: 1,
        },
        liabilities_summary: {
          net_pay_payable: 29000.0,
          income_tax_withheld: 0.0,
          social_insurance_employee: 0.0,
          social_insurance_employer: 0.0,
          total_liabilities: 29000.0,
        },
        journal_preview: {
          debits: [
            {
              account: "Salaries & Wages Expense",
              account_code: "5000-SAL",
              direction: "debit",
              amount: 29000.0,
              description: `Gross employee earnings for ${payload.period_label || "2026-10"}`,
            },
          ],
          credits: [
            {
              account: "Voyance Operating USD",
              account_code: "1000-BANK",
              direction: "credit",
              amount: 29000.0,
              description: "Net salary disbursements from funding account",
            },
          ],
          total_debit: 29000.0,
          total_credit: 29000.0,
          is_balanced: true,
        },
        lines: [
          {
            id: 101,
            payroll_run_id: 0,
            employee_id: 1,
            employee_name: "Sarah Connor",
            department: "Engineering",
            compensation_type: "external_usd",
            is_taxable_local: false,
            is_insurable: false,
            base_salary: 10000.0,
            allowances_total: 0.0,
            deductions_total: 0.0,
            tax_amount: 0.0,
            net_pay: 10000.0,
            employer_cost_extra: 0.0,
            bank_name: "Chase",
            bank_account_masked: "••••4821",
            payment_status: "pending",
            failure_reason: null,
            snapshot_notes: "External USD - October",
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
            is_taxable_local: true,
            is_insurable: true,
            base_salary: 5000.0,
            allowances_total: 0.0,
            deductions_total: 0.0,
            tax_amount: 0.0,
            net_pay: 5000.0,
            employer_cost_extra: 0.0,
            bank_name: "Chase",
            bank_account_masked: "••••4821",
            payment_status: "pending",
            failure_reason: null,
            snapshot_notes: "Internal Cash - October",
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
            is_taxable_local: true,
            is_insurable: true,
            base_salary: 14000.0,
            allowances_total: 0.0,
            deductions_total: 0.0,
            tax_amount: 0.0,
            net_pay: 14000.0,
            employer_cost_extra: 0.0,
            bank_name: "SVB",
            bank_account_masked: "••••9102",
            payment_status: "pending",
            failure_reason: null,
            snapshot_notes: "Internal Cash - October",
            created_at: new Date().toISOString(),
            paid_at: null,
          },
        ],
      };
    }
    return apiRequest("POST", "/api/finance/payroll/runs/preview", payload);
  },

  async generatePayrollRun(payload) {
    if (_isMock()) {
      const prev = await this.previewPayrollRun(payload);
      const fxRateSource = payload.fx_rate_source || "first_of_month";
      const fxRateValue = payload.fx_rate_value || (fxRateSource === "payment_date" ? 49.5 : 48.5);
      const newRun = {
        id: (FinanceMockState.payrollRuns || []).length + 1,
        period_label: payload.period_label,
        period_start: payload.period_start,
        period_end: payload.period_end,
        status: "draft",
        fx_rate_source: fxRateSource,
        fx_rate_value: fxRateValue,
        total_gross: prev.total_gross,
        total_tax: prev.total_tax,
        total_deductions: prev.total_deductions,
        total_net: prev.total_net,
        total_employer_cost: prev.total_employer_cost,
        headcount: prev.headcount,
        currency: payload.currency || "USD",
        bank_account_id: payload.bank_account_id || 1,
        bank_account_name: prev.bank_account_name,
        external_funding_account_id: payload.external_funding_account_id || prev.external_funding_account_id || 1,
        external_funding_account_name: prev.external_funding_account_name || prev.bank_account_name,
        internal_funding_account_id: payload.internal_funding_account_id || prev.internal_funding_account_id || 2,
        internal_funding_account_name: prev.internal_funding_account_name || prev.bank_account_name,
        created_at: new Date().toISOString(),
        created_by: "payroll@voyance.health",
        approved_at: null,
        approved_by: null,
        finalized_at: null,
        finalized_by: null,
        paid_at: null,
        paid_by: null,
        journal_transaction_id: null,
        has_blocking_exceptions: false,
        exceptions: [],
        variance_summary: prev.variance_summary,
        liabilities_summary: prev.liabilities_summary,
        lines: prev.lines.map((l, idx) => ({ ...l, id: Date.now() + idx, payroll_run_id: (FinanceMockState.payrollRuns || []).length + 1 })),
      };
      if (!FinanceMockState.payrollRuns) FinanceMockState.payrollRuns = [];
      FinanceMockState.payrollRuns.unshift(newRun);
      return newRun;
    }
    return apiRequest("POST", "/api/finance/payroll/runs/generate", payload);
  },

  async createPayrollRun(payload) {
    if (_isMock()) {
      const prev = await this.previewPayrollRun(payload);
      const fxRateSource = payload.fx_rate_source || "first_of_month";
      const fxRateValue = payload.fx_rate_value || (fxRateSource === "payment_date" ? 49.5 : 48.5);
      const newRun = {
        id: (FinanceMockState.payrollRuns || []).length + 1,
        period_label: payload.period_label,
        period_start: payload.period_start,
        period_end: payload.period_end,
        status: "draft",
        fx_rate_source: fxRateSource,
        fx_rate_value: fxRateValue,
        total_gross: prev.total_gross,
        total_tax: prev.total_tax,
        total_deductions: prev.total_deductions,
        total_net: prev.total_net,
        total_employer_cost: prev.total_employer_cost,
        headcount: prev.headcount,
        currency: payload.currency || "USD",
        bank_account_id: payload.bank_account_id || 1,
        bank_account_name: prev.bank_account_name,
        external_funding_account_id: payload.external_funding_account_id || prev.external_funding_account_id || 1,
        external_funding_account_name: prev.external_funding_account_name || prev.bank_account_name,
        internal_funding_account_id: payload.internal_funding_account_id || prev.internal_funding_account_id || 2,
        internal_funding_account_name: prev.internal_funding_account_name || prev.bank_account_name,
        created_at: new Date().toISOString(),
        created_by: "payroll@voyance.health",
        approved_at: null,
        approved_by: null,
        finalized_at: null,
        finalized_by: null,
        paid_at: null,
        paid_by: null,
        journal_transaction_id: null,
        has_blocking_exceptions: false,
        exceptions: [],
        variance_summary: prev.variance_summary,
        liabilities_summary: prev.liabilities_summary,
        lines: (payload.lines && payload.lines.length > 0 ? payload.lines : prev.lines).map((l, idx) => ({ ...l, id: Date.now() + idx, payroll_run_id: (FinanceMockState.payrollRuns || []).length + 1 })),
      };
      if (!FinanceMockState.payrollRuns) FinanceMockState.payrollRuns = [];
      FinanceMockState.payrollRuns.unshift(newRun);
      return newRun;
    }
    return apiRequest("POST", "/api/finance/payroll/runs", payload);
  },

  async getPayrollRun(id) {
    if (_isMock()) {
      const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(id, 10));
      if (!run) throw new Error(`Payroll run #${id} not found`);
      return run;
    }
    return apiRequest("GET", `/api/finance/payroll/runs/${id}`);
  },

  async approvePayrollRun(id) {
    if (_isMock()) {
      const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(id, 10));
      if (!run) throw new Error(`Payroll run #${id} not found`);
      run.status = "approved";
      run.approved_at = new Date().toISOString();
      run.approved_by = "cfo@voyance.health";
      return run;
    }
    return apiRequest("POST", `/api/finance/payroll/runs/${id}/approve`);
  },

  async finalizePayrollRun(id) {
    if (_isMock()) {
      const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(id, 10));
      if (!run) throw new Error(`Payroll run #${id} not found`);
      run.status = "finalized";
      run.finalized_at = new Date().toISOString();
      run.finalized_by = "payroll@voyance.health";
      return run;
    }
    return apiRequest("POST", `/api/finance/payroll/runs/${id}/finalize`);
  },

  async payPayrollRun(id, payload = {}) {
    if (_isMock()) {
      const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(id, 10));
      if (!run) throw new Error(`Payroll run #${id} not found`);
      run.status = "paid";
      run.paid_at = new Date().toISOString();
      run.paid_by = "payroll@voyance.health";
      (run.lines || []).forEach((l) => {
        l.payment_status = "paid";
        l.paid_at = run.paid_at;
      });
      return run;
    }
    return apiRequest("POST", `/api/finance/payroll/runs/${id}/pay`, payload);
  },

  async postPayrollJournal(id) {
    if (_isMock()) {
      const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(id, 10));
      if (!run) throw new Error(`Payroll run #${id} not found`);
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
    return apiRequest("POST", `/api/finance/payroll/runs/${id}/post-journal`);
  },

  async getMyPayslips() {
    if (_isMock()) {
      return [
        {
          id: 101,
          payroll_run_id: 1,
          period_label: "2026-08",
          period_start: "2026-08-01",
          period_end: "2026-08-31",
          employee_id: 1,
          employee_name: "Sarah Connor",
          department: "Engineering",
          base_salary: 15000.0,
          allowances_total: 0.0,
          deductions_total: 750.0,
          tax_amount: 1500.0,
          net_pay: 12750.0,
          currency: "USD",
          status: "paid",
          paid_date: "2026-08-31",
          bank_name: "Chase",
          bank_account_masked: "••••4821",
        },
      ];
    }
    return apiRequest("GET", "/api/finance/payroll/payslips/my");
  },

  async getEmployeePayslip(runId, employeeId) {
    if (_isMock()) {
      const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
      const line = run ? (run.lines || []).find((l) => l.employee_id === parseInt(employeeId, 10)) : null;
      return {
        id: line ? line.id : 101,
        payroll_run_id: runId,
        period_label: run ? run.period_label : "2026-08",
        period_start: run ? run.period_start : "2026-08-01",
        period_end: run ? run.period_end : "2026-08-31",
        employee_id: employeeId,
        employee_name: line ? line.employee_name : "Sarah Connor",
        department: line ? line.department : "Engineering",
        base_salary: line ? line.base_salary : 15000.0,
        allowances_total: line ? line.allowances_total : 0.0,
        deductions_total: line ? line.deductions_total : 750.0,
        tax_amount: line ? line.tax_amount : 1500.0,
        net_pay: line ? line.net_pay : 12750.0,
        currency: run ? run.currency : "USD",
        status: line ? line.payment_status : "paid",
        paid_date: line ? (line.paid_at ? line.paid_at.slice(0, 10) : "2026-08-31") : "2026-08-31",
        bank_name: line ? line.bank_name : "Chase",
        bank_account_masked: line ? line.bank_account_masked : "••••4821",
      };
    }
    return apiRequest("GET", `/api/finance/payroll/runs/${runId}/payslips/${employeeId}`);
  },

// Story 8.1: Guided Payroll Run API
  // ==========================================
  async getPayrollRuns(params) {
    if (_isMock()) {
      return FinanceMockState.payrollRuns || [];
    }
    let url = "/api/finance/payroll/runs";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
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
      if (payload.period_label === "2026-09") {
        const lines = [
          {
            employee_id: 1,
            employee_name: "Sarah Connor",
            department: "Engineering",
            base_salary: 15000.0,
            allowances_total: 0.0,
            deductions_total: 750.0,
            tax_withheld: 1500.0,
            net_pay: 12750.0,
            employer_taxes: 1800.0,
            bank_name: "Chase",
            bank_account_masked: "••••4821"
          },
          {
            employee_id: 2,
            employee_name: "John DevOps",
            department: "Operations",
            base_salary: 12000.0,
            allowances_total: 0.0,
            deductions_total: 600.0,
            tax_withheld: 1200.0,
            net_pay: 10200.0,
            employer_taxes: 1440.0,
            bank_name: "Wells Fargo",
            bank_account_masked: "••••1192"
          }
        ];

        return {
          period_label: "2026-09",
          period_start: payload.period_start || "2026-09-01",
          period_end: payload.period_end || "2026-09-30",
          headcount: lines.length,
          currency: "USD",
          funding_account_id: payload.funding_account_id || 1,
          fx_rate_source: payload.fx_rate_source || "first_of_month",
          fx_rate_value: payload.fx_rate_value || 48.5,
          total_gross: 27000.0,
          total_net: 22950.0,
          total_deductions: 1350.0,
          total_tax: 2700.0,
          total_employer_cost: 30240.0,
          variance_summary: {
            prior_period_label: "2026-08",
            headcount_delta: 0,
            gross_delta: 0.0,
            net_delta: 0.0,
            pct_change: 0.0,
            joiners_count: 0,
            leavers_count: 0,
            raises_count: 0
          },
          exceptions: [],
          liabilities_summary: {
            net_salaries_payable: 22950.0,
            tax_withheld: 2700.0,
            social_insurance_staff: 1350.0,
            social_insurance_employer: 3240.0,
            total_liabilities: 30240.0
          },
          journal_preview: {
            is_balanced: true,
            total_debit: 30240.0,
            total_credit: 30240.0,
            items: [
              { account_code: "5010", account_name: "Salaries Expense", description: "Gross Employee Salaries", debit: 27000.0, credit: 0.0 },
              { account_code: "5020", account_name: "Employer Payroll Taxes", description: "Employer Statutory Contribution", debit: 3240.0, credit: 0.0 },
              { account_code: "2110", account_name: "Salaries Payable", description: "Net Take-Home Pay Outflow", debit: 0.0, credit: 22950.0 },
              { account_code: "2120", account_name: "Payroll Taxes Payable", description: "Withholding & Employer Taxes", debit: 0.0, credit: 5940.0 },
              { account_code: "2130", account_name: "Social Security Payable", description: "Staff Pension & Social Security", debit: 0.0, credit: 1350.0 }
            ]
          },
          lines: lines
        };
      }

      const fxRateSource = payload.fx_rate_source || "first_of_month";
      const fxRateValue = payload.fx_rate_value || (fxRateSource === "payment_date" ? 49.5 : 48.5);
      const lines = [
        {
          id: 101,
          employee_id: 1,
          employee_name: "Sarah Connor",
          department: "Engineering",
          compensation_type: "external_usd",
          is_taxable_local: false,
          is_insurable: false,
          base_salary: 10000.0,
          allowances_total: 0.0,
          deductions_total: 0.0,
          tax_withheld: 0.0,
          tax_amount: 0.0,
          net_pay: 10000.0,
          employer_taxes: 0.0,
          employer_cost_extra: 0.0,
          bank_name: "Chase",
          bank_account_masked: "••••4821"
        },
        {
          id: 102,
          employee_id: 1,
          employee_name: "Sarah Connor",
          department: "Engineering",
          compensation_type: "internal_usd_cash",
          is_taxable_local: true,
          is_insurable: true,
          base_salary: 5000.0,
          allowances_total: 0.0,
          deductions_total: 750.0,
          tax_withheld: 1500.0,
          tax_amount: 1500.0,
          net_pay: 2750.0,
          employer_taxes: 1800.0,
          employer_cost_extra: 1800.0,
          bank_name: "Chase",
          bank_account_masked: "••••4821"
        },
        {
          id: 103,
          employee_id: 2,
          employee_name: "John DevOps",
          department: "Operations",
          compensation_type: "internal_usd_cash",
          is_taxable_local: true,
          is_insurable: true,
          base_salary: 12000.0,
          allowances_total: 0.0,
          deductions_total: 600.0,
          tax_withheld: 1200.0,
          tax_amount: 1200.0,
          net_pay: 10200.0,
          employer_taxes: 1440.0,
          employer_cost_extra: 1440.0,
          bank_name: "Wells Fargo",
          bank_account_masked: "••••1192"
        }
      ];

      return {
        period_label: payload.period_label || "2026-10",
        period_start: payload.period_start || "2026-10-01",
        period_end: payload.period_end || "2026-10-31",
        headcount: lines.length,
        currency: "USD",
        funding_account_id: payload.funding_account_id || 1,
        fx_rate_source: fxRateSource,
        fx_rate_value: fxRateValue,
        total_gross: 27000.0,
        total_net: 22950.0,
        total_deductions: 1350.0,
        total_tax: 2700.0,
        total_employer_cost: 30240.0,
        variance_summary: {
          prior_period_label: "2026-09",
          headcount_delta: 1,
          gross_delta: 0.0,
          net_delta: 1500.0,
          pct_change: 0.0,
          joiners_count: 0,
          leavers_count: 0,
          raises_count: 0
        },
        exceptions: [],
        liabilities_summary: {
          net_salaries_payable: 24450.0,
          tax_withheld: 1700.0,
          social_insurance_staff: 850.0,
          social_insurance_employer: 2040.0,
          total_liabilities: 29040.0
        },
        journal_preview: {
          is_balanced: true,
          total_debit: 29040.0,
          total_credit: 29040.0,
          items: [
            { account_code: "5010", account_name: "Salaries Expense", description: "Gross Employee Salaries", debit: 27000.0, credit: 0.0 },
            { account_code: "5020", account_name: "Employer Payroll Taxes", description: "Employer Statutory Contribution", debit: 2040.0, credit: 0.0 },
            { account_code: "2110", account_name: "Salaries Payable", description: "Net Take-Home Pay Outflow", debit: 0.0, credit: 24450.0 },
            { account_code: "2120", account_name: "Payroll Taxes Payable", description: "Withholding & Employer Taxes", debit: 0.0, credit: 3740.0 },
            { account_code: "2130", account_name: "Social Security Payable", description: "Staff Pension & Social Security", debit: 0.0, credit: 850.0 }
          ]
        },
        lines: lines
      };
    }
    return apiRequest("POST", "/api/finance/payroll/runs/preview", payload);
  },

  async createPayrollRun(payload) {
    if (_isMock()) {
      const newId = (FinanceMockState.payrollRuns || []).length + 1;
      const lines = (payload.lines || []).map((l, idx) => ({
        id: idx + 1,
        payroll_run_id: newId,
        employee_id: l.employee_id,
        employee_name: l.employee_name,
        department: l.department,
        compensation_type: l.compensation_type || "internal_usd_cash",
        is_taxable_local: l.is_taxable_local !== undefined ? l.is_taxable_local : true,
        is_insurable: l.is_insurable !== undefined ? l.is_insurable : true,
        base_salary: l.base_salary,
        allowances_total: l.allowances_total || 0.0,
        deductions_total: l.deductions_total || 0.0,
        tax_amount: l.tax_withheld || 0.0,
        tax_withheld: l.tax_withheld || 0.0,
        net_pay: (l.base_salary + (l.allowances_total || 0)) - ((l.deductions_total || 0) + (l.tax_withheld || 0)),
        employer_taxes: l.employer_taxes || 0.0,
        employer_cost_extra: l.employer_taxes || 0.0,
        bank_name: l.bank_name || "Chase",
        bank_account_masked: l.bank_account_masked || "••••4821",
        payment_status: "pending",
        failure_reason: null,
        created_at: new Date().toISOString()
      }));

      const totalGross = lines.reduce((sum, l) => sum + Number(l.base_salary || 0), 0);
      const totalNet = lines.reduce((sum, l) => sum + Number(l.net_pay || 0), 0);
      const totalDed = lines.reduce((sum, l) => sum + Number(l.deductions_total || 0), 0);
      const totalTax = lines.reduce((sum, l) => sum + Number(l.tax_withheld || 0), 0);
      const totalEmpCost = lines.reduce((sum, l) => sum + Number(l.employer_taxes || 0), totalGross);

      const newRun = {
        id: newId,
        period_label: payload.period_label,
        period_start: payload.period_start,
        period_end: payload.period_end,
        status: "draft",
        headcount: lines.length,
        currency: payload.currency || "USD",
        funding_account_id: payload.funding_account_id || 1,
        funding_account_name: "Voyance Operating USD",
        fx_rate_source: payload.fx_rate_source || "first_of_month",
        fx_rate_value: payload.fx_rate_value || (payload.fx_rate_source === "payment_date" ? 49.5 : 48.5),
        total_gross: totalGross,
        total_net: totalNet,
        total_deductions: totalDed,
        total_tax: totalTax,
        total_employer_cost: totalEmpCost,
        created_by: "admin@voyance.health",
        created_at: new Date().toISOString(),
        journal_transaction_id: null,
        lines: lines
      };

      FinanceMockState.payrollRuns.unshift(newRun);
      return newRun;
    }
    return apiRequest("POST", "/api/finance/payroll/runs", payload);
  },

  async approvePayrollRun(id) {
    if (_isMock()) {
      const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(id, 10));
      if (!run) throw new Error(`Payroll run #${id} not found`);
      run.status = "approved";
      run.approved_by = "cfo@voyance.health";
      run.approved_at = new Date().toISOString();
      return run;
    }
    return apiRequest("POST", `/api/finance/payroll/runs/${id}/approve`);
  },

  async finalizePayrollRun(id) {
    if (_isMock()) {
      const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(id, 10));
      if (!run) throw new Error(`Payroll run #${id} not found`);
      run.status = "finalized";
      run.finalized_by = "payroll@voyance.health";
      run.finalized_at = new Date().toISOString();
      return run;
    }
    return apiRequest("POST", `/api/finance/payroll/runs/${id}/finalize`);
  },

  async payPayrollRun(id, payload) {
    if (_isMock()) {
      const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(id, 10));
      if (!run) throw new Error(`Payroll run #${id} not found`);
      run.status = "paid";
      run.paid_by = "treasury@voyance.health";
      run.paid_at = new Date().toISOString();
      (run.lines || []).forEach(l => {
        l.payment_status = "paid";
        l.paid_at = run.paid_at;
      });
      return run;
    }
    return apiRequest("POST", `/api/finance/payroll/runs/${id}/pay`, payload);
  },

  async postPayrollJournal(id) {
    if (_isMock()) {
      const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(id, 10));
      if (!run) throw new Error(`Payroll run #${id} not found`);
      run.journal_transaction_id = 105;
      return run;
    }
    return apiRequest("POST", `/api/finance/payroll/runs/${id}/post-journal`);
  },

  async addPayrollLine(runId, payload) {
    if (_isMock()) {
      const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
      if (!run) throw new Error(`Payroll run #${runId} not found`);
      if (run.status !== "draft") {
        throw new Error(`Cannot add lines to payroll run #${runId}: Run is in '${run.status}' status and locked against modification.`);
      }

      const cType = payload.compensation_type || "commission_sales";
      const amt = Number(payload.amount !== undefined ? payload.amount : payload.base_salary);
      if (!amt || amt <= 0) {
        throw new Error("Line amount must be greater than 0");
      }

      const isTaxable = payload.is_taxable_local !== undefined ? Boolean(payload.is_taxable_local) : (cType !== "external_usd");
      const isInsurable = payload.is_insurable !== undefined ? Boolean(payload.is_insurable) : (cType !== "external_usd");

      const deductions = isInsurable ? Math.round(amt * 0.05 * 100) / 100 : 0.0;
      const taxAmt = isTaxable ? Math.round(amt * 0.10 * 100) / 100 : 0.0;
      const employerExtra = isInsurable ? Math.round(amt * 0.12 * 100) / 100 : 0.0;
      const netPay = Math.round((amt - deductions - taxAmt) * 100) / 100;

      const empId = parseInt(payload.employee_id, 10);
      let empName = payload.employee_name;
      let dept = payload.department;
      let bankName = "Commercial Bank";
      let bankAcc = "••••4821";

      const existingLine = (run.lines || []).find(l => l.employee_id === empId);
      if (existingLine) {
        empName = empName || existingLine.employee_name;
        dept = dept || existingLine.department;
        bankName = existingLine.bank_name || bankName;
        bankAcc = existingLine.bank_account_masked || bankAcc;
      } else {
        const emp = (FinanceMockState.employees || []).find(e => e.id === empId);
        if (emp) {
          empName = empName || emp.name;
          dept = dept || emp.department || emp.dept;
        }
      }

      const newLine = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        payroll_run_id: run.id,
        employee_id: empId,
        employee_name: empName || `Employee #${empId}`,
        department: dept || "General",
        compensation_type: cType,
        is_taxable_local: isTaxable,
        is_insurable: isInsurable,
        base_salary: amt,
        allowances_total: 0.0,
        deductions_total: deductions,
        tax_amount: taxAmt,
        tax_withheld: taxAmt,
        net_pay: netPay,
        employer_cost_extra: employerExtra,
        employer_taxes: employerExtra,
        bank_name: bankName,
        bank_account_masked: bankAcc,
        payment_status: "pending",
        failure_reason: null,
        snapshot_notes: payload.notes || payload.snapshot_notes || `${cType.replace(/_/g, ' ')} - ${run.period_label}`,
        created_at: new Date().toISOString(),
        paid_at: null,
      };

      if (!run.lines) run.lines = [];
      run.lines.push(newLine);

      const lines = run.lines;
      run.total_gross = Math.round(lines.reduce((s, l) => s + Number(l.base_salary || 0), 0) * 100) / 100;
      run.total_net = Math.round(lines.reduce((s, l) => s + Number(l.net_pay || 0), 0) * 100) / 100;
      run.total_deductions = Math.round(lines.reduce((s, l) => s + Number(l.deductions_total || 0), 0) * 100) / 100;
      run.total_tax = Math.round(lines.reduce((s, l) => s + Number(l.tax_amount || l.tax_withheld || 0), 0) * 100) / 100;
      const totalEmpExtra = Math.round(lines.reduce((s, l) => s + Number(l.employer_cost_extra || l.employer_taxes || 0), 0) * 100) / 100;
      run.total_employer_cost = Math.round((run.total_gross + totalEmpExtra) * 100) / 100;
      run.headcount = new Set(lines.map(l => l.employee_id)).size;

      const taxableLines = lines.filter(l => l.is_taxable_local);
      const insurableLines = lines.filter(l => l.is_insurable);
      const empSi = Math.round(insurableLines.reduce((s, l) => s + Number(l.deductions_total || 0), 0) * 100) / 100;
      const emprSi = Math.round(insurableLines.reduce((s, l) => s + Number(l.employer_cost_extra || l.employer_taxes || 0), 0) * 100) / 100;
      const taxWithheld = Math.round(taxableLines.reduce((s, l) => s + Number(l.tax_amount || l.tax_withheld || 0), 0) * 100) / 100;

      run.liabilities_summary = {
        net_pay_payable: run.total_net,
        income_tax_withheld: taxWithheld,
        social_insurance_employee: empSi,
        social_insurance_employer: emprSi,
        total_liabilities: Math.round((run.total_net + taxWithheld + empSi + emprSi) * 100) / 100,
      };

      return newLine;
    }
    return apiRequest("POST", `/api/finance/payroll/runs/${runId}/lines`, payload);
  },

  async deletePayrollLine(runId, lineId) {
    if (_isMock()) {
      const run = (FinanceMockState.payrollRuns || []).find((r) => r.id === parseInt(runId, 10));
      if (!run) throw new Error(`Payroll run #${runId} not found`);
      if (run.status !== "draft") {
        throw new Error(`Cannot delete lines from payroll run #${runId}: Run is in '${run.status}' status and locked against modification.`);
      }

      const idx = (run.lines || []).findIndex(l => l.id === parseInt(lineId, 10));
      if (idx === -1) throw new Error(`Payroll line #${lineId} not found in run #${runId}`);
      run.lines.splice(idx, 1);

      const lines = run.lines || [];
      run.total_gross = Math.round(lines.reduce((s, l) => s + Number(l.base_salary || 0), 0) * 100) / 100;
      run.total_net = Math.round(lines.reduce((s, l) => s + Number(l.net_pay || 0), 0) * 100) / 100;
      run.total_deductions = Math.round(lines.reduce((s, l) => s + Number(l.deductions_total || 0), 0) * 100) / 100;
      run.total_tax = Math.round(lines.reduce((s, l) => s + Number(l.tax_amount || l.tax_withheld || 0), 0) * 100) / 100;
      const totalEmpExtra = Math.round(lines.reduce((s, l) => s + Number(l.employer_cost_extra || l.employer_taxes || 0), 0) * 100) / 100;
      run.total_employer_cost = Math.round((run.total_gross + totalEmpExtra) * 100) / 100;
      run.headcount = new Set(lines.map(l => l.employee_id)).size;

      const taxableLines = lines.filter(l => l.is_taxable_local);
      const insurableLines = lines.filter(l => l.is_insurable);
      const empSi = Math.round(insurableLines.reduce((s, l) => s + Number(l.deductions_total || 0), 0) * 100) / 100;
      const emprSi = Math.round(insurableLines.reduce((s, l) => s + Number(l.employer_cost_extra || l.employer_taxes || 0), 0) * 100) / 100;
      const taxWithheld = Math.round(taxableLines.reduce((s, l) => s + Number(l.tax_amount || l.tax_withheld || 0), 0) * 100) / 100;

      run.liabilities_summary = {
        net_pay_payable: run.total_net,
        income_tax_withheld: taxWithheld,
        social_insurance_employee: empSi,
        social_insurance_employer: emprSi,
        total_liabilities: Math.round((run.total_net + taxWithheld + empSi + emprSi) * 100) / 100,
      };

      return { success: true };
    }
    return apiRequest("DELETE", `/api/finance/payroll/runs/${runId}/lines/${lineId}`);
  },

  async getMyPayslips() {
    if (_isMock()) {
      const runs = FinanceMockState.payrollRuns || [];
      const results = [];
      runs.forEach(r => {
        (r.lines || []).forEach(l => {
          results.push({
            id: l.id,
            payroll_run_id: r.id,
            employee_id: l.employee_id,
            period_label: r.period_label,
            period_start: r.period_start,
            period_end: r.period_end,
            currency: r.currency || "USD",
            base_salary: l.base_salary,
            allowances_total: l.allowances_total || 0,
            deductions_total: l.deductions_total || 0,
            tax_withheld: l.tax_withheld || l.tax_amount || 0,
            net_pay: l.net_pay,
            payment_status: l.payment_status || "paid",
            bank_name: l.bank_name,
            bank_account_masked: l.bank_account_masked,
            paid_at: l.paid_at || r.paid_at
          });
        });
      });
      return results;
    }
    return apiRequest("GET", "/api/finance/payroll/payslips/my");
  },

  async getEmployeePayslip(runId, employeeId) {
    if (_isMock()) {
      const run = (FinanceMockState.payrollRuns || []).find(r => r.id === parseInt(runId, 10));
      if (!run) throw new Error(`Payroll run #${runId} not found`);
      const empLines = (run.lines || []).filter(l => l.employee_id === parseInt(employeeId, 10));
      if (empLines.length === 0) throw new Error(`Employee #${employeeId} not found in run #${runId}`);
      const line = empLines[0];
      const baseSalary = empLines.reduce((sum, l) => sum + Number(l.base_salary || 0), 0);
      const allowances = empLines.reduce((sum, l) => sum + Number(l.allowances_total || 0), 0);
      const deductions = empLines.reduce((sum, l) => sum + Number(l.deductions_total || 0), 0);
      const taxWithheld = empLines.reduce((sum, l) => sum + Number(l.tax_withheld || l.tax_amount || 0), 0);
      const netPay = empLines.reduce((sum, l) => sum + Number(l.net_pay || 0), 0);
      const employerTaxes = empLines.reduce((sum, l) => sum + Number(l.employer_taxes || l.employer_cost_extra || 0), 0);
      return {
        payroll_run_id: run.id,
        employee_id: line.employee_id,
        employee_name: line.employee_name,
        department: line.department,
        period_label: run.period_label,
        period_start: run.period_start,
        period_end: run.period_end,
        currency: run.currency || "USD",
        base_salary: baseSalary,
        allowances_total: allowances,
        deductions_total: deductions,
        tax_withheld: taxWithheld,
        net_pay: netPay,
        employer_taxes: employerTaxes,
        bank_name: line.bank_name,
        bank_account_masked: line.bank_account_masked,
        payment_status: line.payment_status || "paid",
        paid_at: line.paid_at || run.paid_at
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



  getLastCorrelationId() {
    return typeof window.Api !== "undefined" && window.Api.getLastCorrelationId
      ? window.Api.getLastCorrelationId()
      : (typeof _lastCorrelationId !== "undefined" && _lastCorrelationId ? _lastCorrelationId : `corr-${Date.now()}`);
  },

  generateCorrelationId() {
    return typeof window.Api !== "undefined" && window.Api.generateCorrelationId
      ? window.Api.generateCorrelationId()
      : `corr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
  };

  root.FinancePayrollApi = FinancePayrollApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinancePayrollApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinancePayrollApi;
  }
})(typeof window !== "undefined" ? window : globalThis);
