/**
 * fe/api/finance/reports-api.js
 * Finance API - Reports & Analytics domain client and mock handlers.
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

  if (!FinanceMockState.reportExportAudits) {
    FinanceMockState.reportExportAudits = [
    {
      id: 1,
      report_key: "profit-and-loss",
      export_format: "xlsx",
      user_email: "admin@hrflow.test",
      row_count: 18,
      file_name: "profit_and_loss_2026-09-01_to_2026-09-30.xlsx",
      filters: { basis: "accrual", currency: "USD", period: "this_month" },
      created_at: "2026-09-14T08:30:00Z",
    },
    {
      id: 2,
      report_key: "balance-sheet",
      export_format: "csv",
      user_email: "admin@hrflow.test",
      row_count: 12,
      file_name: "balance_sheet_2026-09-14.csv",
      filters: { basis: "accrual", as_of_date: "2026-09-14" },
      created_at: "2026-09-14T09:00:00Z",
    },
  ];
  }

  if (!FinanceMockState.reportSchedules) {
    FinanceMockState.reportSchedules = [
    {
      id: 1,
      report_key: "profit-and-loss",
      report_title: "Profit & Loss Statement (P&L)",
      frequency: "monthly",
      recipients: ["finance-team@voyance.health", "cfo@voyance.health"],
      export_format: "xlsx",
      filters: { basis: "accrual", currency: "USD" },
      is_active: true,
      created_by: "admin@hrflow.test",
      created_at: "2026-09-01T08:00:00Z",
    },
    {
      id: 2,
      report_key: "ar-aging",
      report_title: "Accounts Receivable (AR) Aging",
      frequency: "weekly",
      recipients: ["collections@voyance.health"],
      export_format: "csv",
      filters: { currency: "USD" },
      is_active: true,
      created_by: "admin@hrflow.test",
      created_at: "2026-09-02T11:00:00Z",
    },
  ];
  }

  const FinanceReportsApi = {
// 10. Financial Reports & Excel Export (Phase 8)
  // ==========================================
  async getCategorySummaryReport(params = {}) {
    if (_isMock()) {
      return {
        date_from: params.date_from || "2026-09-01",
        date_to: params.date_to || "2026-09-30",
        currency: params.currency || null,
        total_spent: 42500.0,
        categories: [
          { category_id: 2, category_name: "Salaries", kind: "cost", transaction_count: 8, total_amount: 28000.0, percentage: 65.88 },
          { category_id: 1, category_name: "Hosting Cloud Infrastructure", kind: "cost", transaction_count: 4, total_amount: 6200.0, percentage: 14.59 },
          { category_id: 6, category_name: "Rent & Facilities", kind: "cost", transaction_count: 1, total_amount: 4500.0, percentage: 10.59 },
          { category_id: 3, category_name: "Medical Insurance", kind: "cost", transaction_count: 3, total_amount: 2500.0, percentage: 5.88 },
          { category_id: 4, category_name: "Kitchen Supplies", kind: "cost", transaction_count: 6, total_amount: 1300.0, percentage: 3.06 },
        ],
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/category-summary${qs ? "?" + qs : ""}`);
  },

  async getCategoryMatrixReport(params = {}) {
    const yr = params.year || 2026;
    const grp = params.period_group || "month";
    if (_isMock()) {
      const isQuarter = grp === "quarter";
      return {
        year: yr,
        period_group: grp,
        currency: params.currency || null,
        period_labels: isQuarter ? ["Q1", "Q2", "Q3", "Q4"] : ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        year_total: 382400.0,
        period_totals: isQuarter
          ? { Q1: 92000.0, Q2: 96500.0, Q3: 98400.0, Q4: 95500.0 }
          : { Jan: 30000.0, Feb: 31000.0, Mar: 31000.0, Apr: 32000.0, May: 32000.0, Jun: 32500.0, Jul: 32500.0, Aug: 33000.0, Sep: 32900.0, Oct: 31500.0, Nov: 32000.0, Dec: 32000.0 },
        rows: [
          {
            category_id: 2,
            category_name: "Salaries",
            periods: isQuarter
              ? { Q1: 60000.0, Q2: 63000.0, Q3: 65000.0, Q4: 63000.0 }
              : { Jan: 20000.0, Feb: 20000.0, Mar: 20000.0, Apr: 21000.0, May: 21000.0, Jun: 21000.0, Jul: 21500.0, Aug: 21500.0, Sep: 22000.0, Oct: 21000.0, Nov: 21000.0, Dec: 21000.0 },
            total: 251000.0,
            percentage: 65.64,
          },
          {
            category_id: 1,
            category_name: "Hosting Cloud Infrastructure",
            periods: isQuarter
              ? { Q1: 15000.0, Q2: 16000.0, Q3: 16500.0, Q4: 16000.0 }
              : { Jan: 5000.0, Feb: 5000.0, Mar: 5000.0, Apr: 5200.0, May: 5300.0, Jun: 5500.0, Jul: 5400.0, Aug: 5500.0, Sep: 5600.0, Oct: 5300.0, Nov: 5300.0, Dec: 5400.0 },
            total: 63500.0,
            percentage: 16.61,
          },
          {
            category_id: 6,
            category_name: "Rent & Facilities",
            periods: isQuarter
              ? { Q1: 13500.0, Q2: 13500.0, Q3: 13500.0, Q4: 13500.0 }
              : { Jan: 4500.0, Feb: 4500.0, Mar: 4500.0, Apr: 4500.0, May: 4500.0, Jun: 4500.0, Jul: 4500.0, Aug: 4500.0, Sep: 4500.0, Oct: 4500.0, Nov: 4500.0, Dec: 4500.0 },
            total: 54000.0,
            percentage: 14.12,
          },
        ],
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/category-by-period-matrix${qs ? "?" + qs : ""}`);
  },

  async getBalancesReport(params = {}) {
    if (_isMock()) {
      return {
        as_of_date: params.as_of_date || new Date().toISOString().slice(0, 10),
        accounts: (FinanceMockState.accounts || []).map((a) => ({
          account_id: a.id,
          account_name: a.account_name,
          bank_name: a.bank_name || "—",
          account_number: a.account_number,
          currency: a.currency,
          account_type: a.account_type,
          country: a.country || "Egypt",
          opening_balance: a.opening_balance,
          balance_as_of_date: a.current_balance,
        })),
        currency_totals: {
          USD: 650000.0,
          EGP: 470000.0,
        },
        country_totals: {
          Egypt: { EGP: 470000.0 },
          "United States": { USD: 650000.0 },
        },
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/balances${qs ? "?" + qs : ""}`);
  },

  async getTransactionsReport(params = {}) {
    if (_isMock()) {
      return {
        date_from: params.date_from || "2026-09-01",
        date_to: params.date_to || "2026-09-30",
        count: 4,
        total_inflows: 20900.0,
        total_outflows: 4520.0,
        net_change: 16380.0,
        transactions: [
          {
            id: 1,
            date: "2026-09-01",
            account_name: "Voyance Operating USD",
            direction: "in",
            amount: 12500.0,
            currency: "USD",
            category_name: "Revenue",
            payment_type_name: "Incoming Wire",
            reference: "INV-2026-001",
            description: "Apex Health payment",
            cheque_number: "",
            running_balance: 162500.0,
          },
          {
            id: 2,
            date: "2026-09-02",
            account_name: "Voyance Operating USD",
            direction: "out",
            amount: 4200.0,
            currency: "USD",
            category_name: "Hosting Cloud Infrastructure",
            payment_type_name: "Cheque",
            reference: "BILL-2026-001",
            description: "AWS cloud hosting payment",
            cheque_number: "001011",
            running_balance: 158300.0,
          },
          {
            id: 3,
            date: "2026-09-03",
            account_name: "Voyance Operating USD",
            direction: "out",
            amount: 320.0,
            currency: "USD",
            category_name: "SaaS",
            payment_type_name: "Debit Card",
            reference: "BILL-2026-002",
            description: "Slack monthly renewal",
            cheque_number: "",
            running_balance: 157980.0,
          },
          {
            id: 4,
            date: "2026-09-05",
            account_name: "Voyance Treasury Reserve",
            direction: "in",
            amount: 8400.0,
            currency: "USD",
            category_name: "Revenue",
            payment_type_name: "Internal Transfer",
            reference: "INV-2026-002",
            description: "BioCare Diagnostics SaaS",
            cheque_number: "",
            running_balance: 508400.0,
          },
        ],
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/transactions${qs ? "?" + qs : ""}`);
  },

  async getChequesReport(params = {}) {
    if (_isMock()) {
      const fy = params.fiscal_year || 2026;
      const list = FinanceMockState.cheques || [];
      const totalAmt = list.reduce((acc, c) => acc + Number(c.amount || 0), 0);
      const cleared = list.filter((c) => c.status === "cleared");
      const issued = list.filter((c) => c.status === "issued");
      return {
        fiscal_year: fy,
        summary: {
          total_count: list.length,
          total_amount: totalAmt,
          by_status: {
            issued: { count: issued.length, amount: issued.reduce((acc, c) => acc + Number(c.amount || 0), 0) },
            cleared: { count: cleared.length, amount: cleared.reduce((acc, c) => acc + Number(c.amount || 0), 0) },
            bounced: { count: 0, amount: 0.0 },
            voided: { count: 0, amount: 0.0 },
          },
        },
        cheques: list,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/cheques${qs ? "?" + qs : ""}`);
  },

  downloadExcelUrl(endpoint, params = {}) {
    const p = { ...params, format: "xlsx" };
    const qs = new URLSearchParams(p).toString();
    return `${API_BASE_URL}${endpoint}?${qs}`;
  },

  // ==========================================
  // Story 7.1: Standard Report Library & Shell
  // ==========================================
  async getReportLibrary() {
    if (_isMock()) {
      return {
        categories: ["Performance", "Cash & Banking", "Sales & Receivables", "Spend & Payables", "Payroll", "Audit & Compliance"],
        reports: [
          {
            key: "category-summary",
            title: "Category Spend Rollup",
            category: "Performance",
            business_question: "Where are company operational outflows being spent across budget categories?",
            description: "Monthly expense aggregation and budget percentage allocation mirroring the SPENT block.",
            icon: "fa-solid fa-chart-pie",
            supported_basis: ["cash", "accrual"],
            supported_formats: ["json", "xlsx"],
            badge: "Core Spend",
          },
          {
            key: "matrix",
            title: "Annual Spend Matrix",
            category: "Performance",
            business_question: "How does category spend trend across months and fiscal quarters?",
            description: "Comprehensive cross-tabulation of category expenses across months or quarters with row totals.",
            icon: "fa-solid fa-table-cells",
            supported_basis: ["cash", "accrual"],
            supported_formats: ["json", "xlsx"],
            badge: "Trend Analysis",
          },
          {
            key: "balances",
            title: "Point-in-Time Balances",
            category: "Cash & Banking",
            business_question: "What was our cash and liquidity position on any specific historical date?",
            description: "Historical balance calculations for all active bank and cash accounts as of a cutoff date.",
            icon: "fa-solid fa-scale-balanced",
            supported_basis: ["cash"],
            supported_formats: ["json", "xlsx"],
            badge: "Liquidity",
          },
          {
            key: "cash-forecast",
            title: "Cash Position & 30/60/90-Day Forecast",
            category: "Cash & Banking",
            business_question: "What is our net projected cash flow and liquidity runway over the next 90 days?",
            description: "Forward-looking cash projections incorporating confirmed receivables, bills, and subscriptions.",
            icon: "fa-solid fa-chart-line",
            supported_basis: ["cash"],
            supported_formats: ["json"],
            badge: "Planning",
          },
          {
            key: "reconciliation-summary",
            title: "Bank Reconciliation Summary",
            category: "Cash & Banking",
            business_question: "Which bank accounts and monthly statement periods are reconciled, closed, or pending review?",
            description: "Overview of statement reconciliation completion status, book variances, and period locks.",
            icon: "fa-solid fa-file-invoice-dollar",
            supported_basis: ["cash"],
            supported_formats: ["json"],
            badge: "Control",
          },
          {
            key: "invoices-summary",
            title: "Customer Receivables & Sales Summary",
            category: "Sales & Receivables",
            business_question: "What is our revenue run rate and outstanding receivables exposure by customer?",
            description: "Sales invoice status breakdown, collections aging, and revenue channel distribution.",
            icon: "fa-solid fa-file-invoice",
            supported_basis: ["accrual", "cash"],
            supported_formats: ["json"],
            badge: "Revenue",
          },
          {
            key: "bills-summary",
            title: "Vendor Payables & Commitments Schedule",
            category: "Spend & Payables",
            business_question: "What vendor liabilities and upcoming disbursements are scheduled for payment?",
            description: "Vendor bill approval queues, payment readiness, and upcoming payment obligations.",
            icon: "fa-solid fa-receipt",
            supported_basis: ["accrual", "cash"],
            supported_formats: ["json"],
            badge: "Payables",
          },
          {
            key: "subscriptions-summary",
            title: "Recurring Spend & SaaS Commitments",
            category: "Spend & Payables",
            business_question: "What are our recurring software, cloud infrastructure, and tool commitments?",
            description: "Active subscription contracts, upcoming renewal dates, and monthly equivalent run rates.",
            icon: "fa-solid fa-repeat",
            supported_basis: ["accrual", "cash"],
            supported_formats: ["json"],
            badge: "Commitments",
          },
          {
            key: "payroll-summary",
            title: "Payroll Register & Compensation Outflows",
            category: "Payroll",
            business_question: "How much did net salaries, employee benefits, and payroll taxes cost per cycle?",
            description: "Monthly payroll register aggregation across active staff and department allocations.",
            icon: "fa-solid fa-users",
            supported_basis: ["cash", "accrual"],
            supported_formats: ["json"],
            badge: "Payroll",
          },
          {
            key: "compensation-summary",
            title: "Compensation Spend & Variance Report",
            category: "Payroll",
            business_question: "What is total company compensation spend across external, internal, commission, and bonus pay?",
            description: "Granular compensation reporting per employee and company-wide across flexible date ranges.",
            icon: "fa-solid fa-money-bill-wave",
            supported_basis: ["cash", "accrual"],
            supported_formats: ["json"],
            badge: "Spend",
          },
          {
            key: "statutory-remitted",
            title: "Statutory Obligations Remitted Report",
            category: "Payroll",
            business_question: "How much tax and social insurance has been officially paid and remitted to authorities?",
            description: "Summary of settled statutory obligations by period and tax/insurance obligation type.",
            icon: "fa-solid fa-landmark",
            supported_basis: ["cash"],
            supported_formats: ["json"],
            badge: "Compliance",
          },
          {
            key: "payable-status",
            title: "Payroll & Statutory Settlement Status",
            category: "Payroll",
            business_question: "What is the settlement status (pending vs settled) of employee payouts, taxes, and social insurance?",
            description: "Unified view tracking pending vs settled amounts for external wire, internal cash, tax, and insurance flows.",
            icon: "fa-solid fa-money-bill-transfer",
            supported_basis: ["cash", "accrual"],
            supported_formats: ["json"],
            badge: "Payables",
          },
          {
            key: "transactions",
            title: "Continuous Transaction Ledger",
            category: "Audit & Compliance",
            business_question: "What is the detailed, auditable transaction log across all accounts and categories?",
            description: "Filterable general ledger transaction journal with running balances and reference links.",
            icon: "fa-solid fa-list-check",
            supported_basis: ["cash", "accrual"],
            supported_formats: ["json", "xlsx"],
            badge: "General Ledger",
          },
          {
            key: "cheques",
            title: "Cheque Register & Clear Status",
            category: "Audit & Compliance",
            business_question: "What is the status, clearing trail, and presentment date of all company issued cheques?",
            description: "Cheque register filtered by fiscal year and account with status breakdown.",
            icon: "fa-solid fa-money-check",
            supported_basis: ["cash"],
            supported_formats: ["json", "xlsx"],
            badge: "Audit",
          },
          {
            key: "profit-and-loss",
            title: "Profit & Loss Statement (P&L)",
            category: "Performance",
            business_question: "What was the company's operating revenue, expense allocation, and net bottom line profit?",
            description: "Standard income statement categorizing operational revenues, cost outflows, and net margin %.",
            icon: "fa-solid fa-file-invoice-dollar",
            supported_basis: ["cash", "accrual"],
            supported_formats: ["json", "xlsx", "csv", "pdf"],
            badge: "Core Financial",
          },
          {
            key: "cash-flow",
            title: "Statement of Cash Flows",
            category: "Cash & Banking",
            business_question: "How did cash inflows and outflows reconcile between operating, investing, and financing activities?",
            description: "Comprehensive cash flow statement reconciling beginning to ending cash balances.",
            icon: "fa-solid fa-money-bill-trend-up",
            supported_basis: ["cash"],
            supported_formats: ["json", "xlsx", "csv", "pdf"],
            badge: "Cash Flow",
          },
          {
            key: "ar-aging",
            title: "Accounts Receivable (AR) Aging",
            category: "Sales & Receivables",
            business_question: "How overdue are client invoice balances partitioned across 30-day aging buckets?",
            description: "Customer invoice aging schedule categorized into current, 1-30, 31-60, 61-90, and 90+ day tiers.",
            icon: "fa-solid fa-user-clock",
            supported_basis: ["accrual"],
            supported_formats: ["json", "xlsx", "csv", "pdf"],
            badge: "Aging",
          },
          {
            key: "ap-aging",
            title: "Accounts Payable (AP) Aging",
            category: "Spend & Payables",
            business_question: "What vendor bills and disbursements are due or past due across 30-day aging buckets?",
            description: "Vendor bill aging schedule partitioned into current, 1-30, 31-60, 61-90, and 90+ day tiers.",
            icon: "fa-solid fa-receipt",
            supported_basis: ["accrual"],
            supported_formats: ["json", "xlsx", "csv", "pdf"],
            badge: "Aging",
          },
          {
            key: "balance-sheet",
            title: "Balance Sheet (Statement of Financial Position)",
            category: "Audit & Compliance",
            business_question: "What are company total assets, liabilities, and owners' equity balances as of a cutoff date?",
            description: "Core balance sheet statement enforcing the fundamental accounting equation Assets = Liabilities + Equity.",
            icon: "fa-solid fa-building-columns",
            supported_basis: ["accrual"],
            supported_formats: ["json", "xlsx", "csv", "pdf"],
            badge: "Core Financial",
          },
          {
            key: "trial-balance",
            title: "Trial Balance Ledger Audit",
            category: "Audit & Compliance",
            business_question: "Do total debit balances equal total credit balances across all active chart of accounts?",
            description: "Audit report verifying zero debit-credit variance across all posted ledger lines.",
            icon: "fa-solid fa-scale-unbalanced",
            supported_basis: ["accrual", "cash"],
            supported_formats: ["json", "xlsx", "csv", "pdf"],
            badge: "Audit",
          },
        ],
      };
    }
    return apiRequest("GET", "/api/finance/reports/library");
  },

  async getSavedReportViews(reportKey) {
    if (_isMock()) {
      let views = FinanceMockState.savedReportViews || [
        {
          id: 1,
          report_key: "category-summary",
          view_name: "Executive USD View",
          filters: { period: "QTD", basis: "accrual", currency: "USD" },
          is_default: true,
          created_by: "admin@hrflow.test",
          created_at: new Date().toISOString(),
        },
      ];
      if (reportKey) views = views.filter((v) => v.report_key === reportKey);
      return views;
    }
    const q = reportKey ? `?report_key=${encodeURIComponent(reportKey)}` : "";
    return apiRequest("GET", `/api/finance/reports/saved-views${q}`);
  },

  async createSavedReportView(payload) {
    if (_isMock()) {
      if (!FinanceMockState.savedReportViews) FinanceMockState.savedReportViews = [];
      if (payload.is_default) {
        FinanceMockState.savedReportViews.forEach((v) => {
          if (v.report_key === payload.report_key) v.is_default = false;
        });
      }
      const newV = {
        id: Date.now(),
        report_key: payload.report_key,
        view_name: payload.view_name,
        filters: payload.filters || {},
        is_default: !!payload.is_default,
        created_by: "admin@hrflow.test",
        created_at: new Date().toISOString(),
      };
      FinanceMockState.savedReportViews.push(newV);
      return newV;
    }
    return apiRequest("POST", "/api/finance/reports/saved-views", payload);
  },

  async deleteSavedReportView(viewId) {
    if (_isMock()) {
      if (FinanceMockState.savedReportViews) {
        FinanceMockState.savedReportViews = FinanceMockState.savedReportViews.filter((v) => v.id !== parseInt(viewId, 10));
      }
      return { success: true, id: viewId };
    }
    return apiRequest("DELETE", `/api/finance/reports/saved-views/${viewId}`);
  },

  async getReportDrilldown(params = {}) {
    if (_isMock()) {
      const isCat = params.drilldown_type === "category";
      return {
        report_key: params.report_key || "category-summary",
        drilldown_type: params.drilldown_type || "category",
        target_title: isCat ? "Category: Hosting Cloud Infrastructure" : "Account: Voyance Operating USD",
        total_records: 2,
        total_amount: 5400.0,
        currency: params.currency || "USD",
        records: [
          {
            id: 101,
            date: "2026-09-02",
            description: "AWS Cloud Compute Hosting",
            reference: "AWS-EC2-01",
            category: "Hosting Cloud Infrastructure",
            amount: 4200.0,
            currency: "USD",
            direction: "out",
          },
          {
            id: 102,
            date: "2026-09-04",
            description: "Cloudflare Enterprise Security",
            reference: "CF-INV-02",
            category: "Hosting Cloud Infrastructure",
            amount: 1200.0,
            currency: "USD",
            direction: "out",
          },
        ],
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/drilldown${qs ? "?" + qs : ""}`);
  },

  async getProfitAndLossReport(params = {}) {
    if (_isMock()) {
      const basis = params.basis || "cash";
      return {
        report_title: "Profit & Loss Statement",
        entity: params.entity || "Voyance Health (Consolidated)",
        basis,
        currency: params.currency || "USD",
        period_start: params.date_from || "2026-09-01",
        period_end: params.date_to || "2026-09-30",
        comparison_type: params.comparison || "none",
        revenue_items: [
          { category_name: "Diagnostic Imaging & PACS Software", amount: 95000.0, percentage: 76.0 },
          { category_name: "Maintenance & Platform Consulting", amount: 30000.0, percentage: 24.0 },
        ],
        total_revenue: 125000.0,
        prior_revenue: 110000.0,
        expense_items: [
          { category_name: "Cloud Hosting & AWS Compute Infrastructure", amount: 38000.0, percentage: 55.9 },
          { category_name: "Cairo & Dover Office Facilities", amount: 20000.0, percentage: 29.4 },
          { category_name: "Legal, Tax & Statutory Audit", amount: 10000.0, percentage: 14.7 },
        ],
        total_expenses: 68000.0,
        prior_expenses: 62000.0,
        net_income: 57000.0,
        prior_net_income: 48000.0,
        net_margin_pct: 45.6,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/profit-and-loss${qs ? "?" + qs : ""}`);
  },

  async getBalanceSheetReport(params = {}) {
    if (_isMock()) {
      return {
        report_title: "Balance Sheet",
        entity: params.entity || "Voyance Health (Consolidated)",
        as_of_date: params.as_of_date || "2026-09-14",
        currency: params.currency || "USD",
        basis: params.basis || "accrual",
        assets: {
          title: "Assets",
          items: [
            { name: "Chase Operating Primary (USD)", amount: 220000.0, note: "Liquid cash" },
            { name: "Accounts Receivable (Trade Debtors)", amount: 90000.0, note: "Open client receivables" },
          ],
          total: 310000.0,
        },
        liabilities: {
          title: "Liabilities",
          items: [
            { name: "Accounts Payable (Trade Creditors)", amount: 35000.0, note: "Open vendor bills" },
            { name: "Cheques Payable (Issued / In Transit)", amount: 10000.0, note: "Outstanding cheques" },
          ],
          total: 45000.0,
        },
        equity: {
          title: "Equity",
          items: [
            { name: "Retained Earnings & Cumulative Net Income", amount: 265000.0, note: "Balanced equity" },
          ],
          total: 265000.0,
        },
        total_assets: 310000.0,
        total_liabilities_and_equity: 310000.0,
        is_balanced: true,
        variance: 0.0,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/balance-sheet${qs ? "?" + qs : ""}`);
  },

  async getTrialBalanceReport(params = {}) {
    if (_isMock()) {
      return {
        report_title: "Trial Balance",
        entity: params.entity || "Voyance Health (Consolidated)",
        as_of_date: params.as_of_date || "2026-09-14",
        currency: params.currency || "USD",
        lines: [
          { code: "1000-01", name: "Chase Operating Primary (USD)", type: "asset", debit: 220000.0, credit: 0.0 },
          { code: "1100-AR", name: "Accounts Receivable (Trade)", type: "asset", debit: 90000.0, credit: 0.0 },
          { code: "2000-AP", name: "Accounts Payable (Trade)", type: "liability", debit: 0.0, credit: 35000.0 },
          { code: "2100-CP", name: "Cheques Payable", type: "liability", debit: 0.0, credit: 10000.0 },
          { code: "3000-EQ", name: "Retained Earnings / Owners' Equity", type: "equity", debit: 0.0, credit: 265000.0 },
        ],
        total_debits: 310000.0,
        total_credits: 310000.0,
        variance: 0.0,
        is_balanced: true,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/trial-balance${qs ? "?" + qs : ""}`);
  },

  async getCashFlowReport(params = {}) {
    if (_isMock()) {
      return {
        report_title: "Statement of Cash Flows",
        entity: params.entity || "Voyance Health (Consolidated)",
        currency: params.currency || "USD",
        date_from: params.date_from || "2026-09-01",
        date_to: params.date_to || "2026-09-30",
        operating_activities: [
          { name: "Cash Receipts from Customers & Operational Inflows", amount: 95000.0, activity_type: "operating" },
          { name: "Cash Payments for Suppliers & Operational Outflows", amount: -55000.0, activity_type: "operating" },
        ],
        net_cash_operating: 40000.0,
        investing_activities: [],
        net_cash_investing: 0.0,
        financing_activities: [],
        net_cash_financing: 0.0,
        net_change_in_cash: 40000.0,
        beginning_cash_balance: 180000.0,
        ending_cash_balance: 220000.0,
        is_reconciled: true,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/cash-flow${qs ? "?" + qs : ""}`);
  },

  async getArAgingReport(params = {}) {
    if (_isMock()) {
      return {
        report_title: "Accounts Receivable (AR) Aging",
        aging_type: "ar",
        entity: params.entity || "Voyance Health (Consolidated)",
        as_of_date: params.as_of_date || "2026-09-14",
        currency: params.currency || "USD",
        rows: [
          {
            id: 1,
            name: "Acme Health Systems",
            buckets: { current: 30000.0, days_1_30: 20000.0, days_31_60: 10000.0, days_61_90: 0.0, days_over_90: 0.0, total: 60000.0 },
            outstanding_count: 3,
          },
          {
            id: 2,
            name: "Apex Diagnostic Imaging",
            buckets: { current: 15000.0, days_1_30: 5000.0, days_31_60: 5000.0, days_61_90: 5000.0, days_over_90: 0.0, total: 30000.0 },
            outstanding_count: 2,
          },
        ],
        totals: { current: 45000.0, days_1_30: 25000.0, days_31_60: 15000.0, days_61_90: 5000.0, days_over_90: 0.0, total: 90000.0 },
        total_open_count: 5,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/ar-aging${qs ? "?" + qs : ""}`);
  },

  async getApAgingReport(params = {}) {
    if (_isMock()) {
      return {
        report_title: "Accounts Payable (AP) Aging",
        aging_type: "ap",
        entity: params.entity || "Voyance Health (Consolidated)",
        as_of_date: params.as_of_date || "2026-09-14",
        currency: params.currency || "USD",
        rows: [
          {
            id: 1,
            name: "Cloud Datacenter Inc",
            buckets: { current: 12000.0, days_1_30: 8000.0, days_31_60: 0.0, days_61_90: 0.0, days_over_90: 0.0, total: 20000.0 },
            outstanding_count: 2,
          },
          {
            id: 2,
            name: "Office Space Holdings",
            buckets: { current: 8000.0, days_1_30: 2000.0, days_31_60: 5000.0, days_61_90: 0.0, days_over_90: 0.0, total: 15000.0 },
            outstanding_count: 1,
          },
        ],
        totals: { current: 20000.0, days_1_30: 10000.0, days_31_60: 5000.0, days_61_90: 0.0, days_over_90: 0.0, total: 35000.0 },
        total_open_count: 3,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/ap-aging${qs ? "?" + qs : ""}`);
  },

  // ==========================================
  // Story 7.3: Controlled Exports & Scheduled Delivery
  // ==========================================
  async exportReport(payload) {
    if (_isMock()) {
      if (!FinanceMockState.reportExportAudits) FinanceMockState.reportExportAudits = [];
      const ext = payload.format === "xlsx" ? "xlsx" : (payload.format === "pdf" ? "pdf" : "csv");
      const fileName = `${payload.report_key}_export_${new Date().toISOString().slice(0, 10)}.${ext}`;
      const audit = {
        id: Date.now(),
        report_key: payload.report_key,
        export_format: payload.format,
        user_email: "admin@hrflow.test",
        row_count: 24,
        file_name: fileName,
        filters: payload.filters || {},
        created_at: new Date().toISOString(),
      };
      FinanceMockState.reportExportAudits.unshift(audit);

      const mime = ext === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : (ext === "pdf" ? "application/pdf" : "text/csv;charset=utf-8;");
      const dummyContent = ext === "csv"
        ? `# Report: ${payload.report_key}\n# Generated: ${new Date().toISOString()}\nAccount,Amount\nTotal,10000\n`
        : "HRFlow Mock Binary Export Content";
      const blob = new Blob([dummyContent], { type: mime });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      return { success: true, file_name: fileName };
    }

    const res = await fetch(`${API_BASE_URL}/api/finance/reports/export`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify(payload),
    });

    if (res.status === 401) {
      if (typeof forceSessionExpiredLogout === "function") forceSessionExpiredLogout();
      throw new Error("Session expired. Please sign in again.");
    }
    if (!res.ok) {
      let detail = `Export failed (${res.status})`;
      try {
        const data = await res.json();
        detail = data.detail || data.error || detail;
      } catch (_) {}
      throw new Error(detail);
    }

    let fileName = `${payload.report_key}_export.${payload.format}`;
    const disp = res.headers.get("Content-Disposition");
    if (disp && disp.includes("filename=")) {
      const m = disp.match(/filename="?([^"]+)"?/);
      if (m && m[1]) fileName = m[1];
    }

    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
    return { success: true, file_name: fileName };
  },

  async getExportAudits(reportKey, limit = 50) {
    if (_isMock()) {
      let list = [...(FinanceMockState.reportExportAudits || [])];
      if (reportKey) list = list.filter((a) => a.report_key === reportKey);
      return list.slice(0, limit);
    }
    const params = new URLSearchParams();
    if (reportKey) params.set("report_key", reportKey);
    if (limit) params.set("limit", limit);
    return apiRequest("GET", `/api/finance/reports/export-audits?${params.toString()}`);
  },

  async getReportSchedules(reportKey) {
    if (_isMock()) {
      let list = [...(FinanceMockState.reportSchedules || [])];
      if (reportKey) list = list.filter((s) => s.report_key === reportKey);
      return list;
    }
    const qs = reportKey ? `?report_key=${encodeURIComponent(reportKey)}` : "";
    return apiRequest("GET", `/api/finance/reports/schedules${qs}`);
  },

  async createReportSchedule(payload) {
    if (_isMock()) {
      if (!FinanceMockState.reportSchedules) FinanceMockState.reportSchedules = [];
      const newSched = {
        id: Date.now(),
        report_key: payload.report_key,
        report_title: payload.report_title || payload.report_key,
        frequency: payload.frequency || "monthly",
        recipients: Array.isArray(payload.recipients) ? payload.recipients : (payload.recipients || "").split(",").map(e => e.trim()).filter(Boolean),
        export_format: payload.export_format || "xlsx",
        filters: payload.filters || {},
        is_active: true,
        created_by: "admin@hrflow.test",
        created_at: new Date().toISOString(),
      };
      FinanceMockState.reportSchedules.unshift(newSched);
      return newSched;
    }
    return apiRequest("POST", "/api/finance/reports/schedules", payload);
  },

  async deleteReportSchedule(scheduleId) {
    if (_isMock()) {
      if (FinanceMockState.reportSchedules) {
        FinanceMockState.reportSchedules = FinanceMockState.reportSchedules.filter(
          (s) => s.id !== parseInt(scheduleId, 10)
        );
      }
      return { success: true, id: scheduleId };
    }
    return apiRequest("DELETE", `/api/finance/reports/schedules/${scheduleId}`);
  },

  // ==========================================
  // FUX-419: Compensation Spend & Variance Reporting
  // ==========================================
  async getEmployeeCompensationReport(employeeId, params = {}) {
    if (_isMock()) {
      return {
        employee_id: employeeId,
        employee_name: "Sarah Jenkins",
        department: "Engineering",
        start_date: params.start_date || "2026-09-01",
        end_date: params.end_date || "2026-10-31",
        currency: params.currency || "USD",
        by_compensation_type: {
          external_usd: 6000.0,
          internal_usd_cash: 3000.0,
          commission_sales: 500.0,
          bonus: 200.0,
        },
        total_external: 6000.0,
        total_internal: 3000.0,
        total_commission: 500.0,
        total_bonus: 200.0,
        grand_total: 9700.0,
        payroll_runs_count: 2,
        lines: [
          { id: 101, payroll_run_id: 1, period_label: "2026-09", compensation_type: "external_usd", base_salary: 3000.0, allowances_total: 0.0, deductions_total: 0.0, tax_amount: 0.0, net_pay: 3000.0, employer_cost_extra: 0.0, payment_status: "paid", paid_at: "2026-09-30T10:00:00Z" },
          { id: 102, payroll_run_id: 1, period_label: "2026-09", compensation_type: "internal_usd_cash", base_salary: 1500.0, allowances_total: 0.0, deductions_total: 75.0, tax_amount: 150.0, net_pay: 1275.0, employer_cost_extra: 180.0, payment_status: "paid", paid_at: "2026-09-30T10:00:00Z" },
          { id: 103, payroll_run_id: 1, period_label: "2026-09", compensation_type: "commission_sales", base_salary: 500.0, allowances_total: 0.0, deductions_total: 25.0, tax_amount: 50.0, net_pay: 425.0, employer_cost_extra: 60.0, payment_status: "paid", paid_at: "2026-09-30T10:00:00Z" },
          { id: 104, payroll_run_id: 2, period_label: "2026-10", compensation_type: "external_usd", base_salary: 3000.0, allowances_total: 0.0, deductions_total: 0.0, tax_amount: 0.0, net_pay: 3000.0, employer_cost_extra: 0.0, payment_status: "pending", paid_at: null },
          { id: 105, payroll_run_id: 2, period_label: "2026-10", compensation_type: "internal_usd_cash", base_salary: 1500.0, allowances_total: 0.0, deductions_total: 75.0, tax_amount: 150.0, net_pay: 1275.0, employer_cost_extra: 180.0, payment_status: "pending", paid_at: null },
          { id: 106, payroll_run_id: 2, period_label: "2026-10", compensation_type: "bonus", base_salary: 200.0, allowances_total: 0.0, deductions_total: 10.0, tax_amount: 20.0, net_pay: 170.0, employer_cost_extra: 24.0, payment_status: "pending", paid_at: null },
        ],
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/compensation/employee/${employeeId}${qs ? "?" + qs : ""}`);
  },

  async getCompanyCompensationReport(params = {}) {
    if (_isMock()) {
      return {
        start_date: params.start_date || "2026-09-01",
        end_date: params.end_date || "2026-10-31",
        currency: params.currency || "USD",
        by_compensation_type: {
          external_usd: 12000.0,
          internal_usd_cash: 7000.0,
          commission_sales: 1500.0,
          bonus: 600.0,
        },
        total_external: 12000.0,
        total_internal: 7000.0,
        total_commission: 1500.0,
        total_bonus: 600.0,
        grand_total: 21100.0,
        total_headcount: 3,
        payroll_runs_count: 2,
        employees: [
          { employee_id: 1, employee_name: "Sarah Jenkins", department: "Engineering", by_compensation_type: { external_usd: 6000.0, internal_usd_cash: 3000.0, commission_sales: 500.0, bonus: 200.0 }, total_external: 6000.0, total_internal: 3000.0, total_commission: 500.0, total_bonus: 200.0, grand_total: 9700.0, lines_count: 6 },
          { employee_id: 2, employee_name: "Marcus Vance", department: "Sales", by_compensation_type: { external_usd: 4000.0, internal_usd_cash: 2000.0, commission_sales: 1000.0, bonus: 400.0 }, total_external: 4000.0, total_internal: 2000.0, total_commission: 1000.0, total_bonus: 400.0, grand_total: 7400.0, lines_count: 6 },
          { employee_id: 3, employee_name: "Elena Rostova", department: "Operations", by_compensation_type: { external_usd: 2000.0, internal_usd_cash: 2000.0 }, total_external: 2000.0, total_internal: 2000.0, total_commission: 0.0, total_bonus: 0.0, grand_total: 4000.0, lines_count: 4 },
        ],
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/compensation/company${qs ? "?" + qs : ""}`);
  },

  async getStatutoryRemittedReport(params = {}) {
    if (_isMock()) {
      return {
        start_date: params.start_date || "2026-09-01",
        end_date: params.end_date || "2026-10-31",
        currency: params.currency || "USD",
        total_remitted: 3450.0,
        by_obligation_type: {
          income_tax: 1500.0,
          social_insurance_employee: 750.0,
          social_insurance_employer: 1200.0,
        },
        by_period: {
          "2026-09": 3450.0,
        },
        items: [
          { id: 1, period: "2026-09", obligation_type: "income_tax", amount_remitted: 1500.0, amount_accrued: 1500.0, currency: "USD", status: "remitted", due_date: "2026-10-15", source_type: "payroll_run", source_id: 1, notes: "Payroll 2026-09 - Salary Income Tax Withheld" },
          { id: 2, period: "2026-09", obligation_type: "social_insurance_employee", amount_remitted: 750.0, amount_accrued: 750.0, currency: "USD", status: "remitted", due_date: "2026-10-15", source_type: "payroll_run", source_id: 1, notes: "Payroll 2026-09 - Employee Social Insurance" },
          { id: 3, period: "2026-09", obligation_type: "social_insurance_employer", amount_remitted: 1200.0, amount_accrued: 1200.0, currency: "USD", status: "remitted", due_date: "2026-10-15", source_type: "payroll_run", source_id: 1, notes: "Payroll 2026-09 - Employer Social Insurance" },
        ],
        obligations_count: 3,
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/statutory/remitted${qs ? "?" + qs : ""}`);
  },

  async getPayableStatusReport(params = {}) {
    if (_isMock()) {
      return {
        period: params.period || "2026-09",
        start_date: params.start_date || null,
        end_date: params.end_date || null,
        employee_id: params.employee_id ? parseInt(params.employee_id, 10) : null,
        currency: params.currency || "USD",
        flows: [
          { flow_type: "external_transfer", label: "External Wire Transfers", pending_amount: 0.0, settled_amount: 6000.0, total_amount: 6000.0, status: "settled" },
          { flow_type: "internal_cash", label: "Internal Cash Payroll", pending_amount: 0.0, settled_amount: 3500.0, total_amount: 3500.0, status: "settled" },
          { flow_type: "tax_obligation", label: "Income Tax Obligations", pending_amount: 0.0, settled_amount: 1500.0, total_amount: 1500.0, status: "settled" },
          { flow_type: "insurance_obligation", label: "Social Insurance Obligations", pending_amount: 1950.0, settled_amount: 0.0, total_amount: 1950.0, status: "pending" },
        ],
        total_pending: 1950.0,
        total_settled: 11000.0,
        grand_total: 12950.0,
        employee_breakdown: [
          { employee_id: 1, employee_name: "Sarah Jenkins", department: "Engineering", external_pending: 0.0, external_settled: 3000.0, internal_pending: 0.0, internal_settled: 1700.0, tax_pending: 0.0, tax_settled: 200.0, insurance_pending: 289.0, insurance_settled: 0.0, total_pending: 289.0, total_settled: 4900.0 },
          { employee_id: 2, employee_name: "Marcus Vance", department: "Sales", external_pending: 0.0, external_settled: 2000.0, internal_pending: 0.0, internal_settled: 1100.0, tax_pending: 0.0, tax_settled: 140.0, insurance_pending: 202.0, insurance_settled: 0.0, total_pending: 202.0, total_settled: 3240.0 },
          { employee_id: 3, employee_name: "Elena Rostova", department: "Operations", external_pending: 0.0, external_settled: 1000.0, internal_pending: 0.0, internal_settled: 700.0, tax_pending: 0.0, tax_settled: 90.0, insurance_pending: 130.0, insurance_settled: 0.0, total_pending: 130.0, total_settled: 1790.0 },
        ],
      };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/reports/payroll/payable-status${qs ? "?" + qs : ""}`);
  },


  // ==========================================
  };

  root.FinanceReportsApi = FinanceReportsApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceReportsApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceReportsApi;
  }
})(typeof window !== "undefined" ? window : globalThis);
