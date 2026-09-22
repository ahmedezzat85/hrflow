/**
 * fe/api/finance/dashboard-api.js
 * Finance API - Dashboard & Activity domain client and mock handlers.
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

  if (!FinanceMockState.attentionReviewed) {
    FinanceMockState.attentionReviewed = new Set();
  }

  const FinanceDashboardApi = {
async getFinanceSummary(params = {}) {
    if (_isMock()) {
      const period = (params.period || "MTD").toUpperCase();
      const basis = (params.basis || "cash").toLowerCase();
      const currency = (params.currency || "USD").toUpperCase();
      const entity = (params.entity || "all").toLowerCase();

      let accounts = [...(FinanceMockState.accounts || [])];
      if (currency !== "ALL") {
        accounts = accounts.filter((a) => (a.currency || "USD").toUpperCase() === currency);
      }

      let balance = 245000.0;
      if (currency === "EGP") {
        balance = 470000.0;
      } else if (currency === "ALL") {
        balance = 715000.0;
      }

      let revenue = 0;
      let cost = 0;

      if (basis === "accrual") {
        let invs = [...(FinanceMockState.invoices || [])].filter((i) => i.status !== "void" && i.status !== "draft");
        if (currency !== "ALL") invs = invs.filter((i) => (i.currency || "USD").toUpperCase() === currency);
        revenue = invs.reduce((acc, i) => acc + (i.total || 0), 0) || 30000.0;

        let bills = [...(FinanceMockState.bills || [])].filter((b) => b.status !== "void");
        if (currency !== "ALL") bills = bills.filter((b) => (b.currency || "USD").toUpperCase() === currency);
        cost = bills.reduce((acc, b) => acc + (b.total || 0), 0) || 10000.0;
      } else {
        if (currency === "EGP") {
          revenue = 0.0;
          cost = 0.0;
        } else {
          revenue = 48200.0;
          cost = 31400.0;
        }
      }

      const net = Math.round((revenue - cost) * 100) / 100;
      const marginValid = revenue > 0;
      const marginPct = marginValid ? Math.round((net / revenue) * 1000) / 10 : null;
      const displayCurrency = currency !== "ALL" ? currency : "USD";

      return {
        balance: balance || 245000.0,
        revenue_mtd: revenue,
        cost_mtd: cost,
        net_mtd: net,
        margin_pct: marginPct,
        margin_valid: marginValid,
        currency: displayCurrency,
        base_currency: displayCurrency,
        period: period,
        basis: basis,
        entity: entity,
        conversion_policy: currency === "ALL"
          ? "Consolidated totals across currencies without conversion; select a specific currency for single-currency ledger reconciliation."
          : `Filtered strictly to ${currency} accounts and transactions (1:1 single currency).`,
        data_scope: `${entity}_${currency.toLowerCase()}`,
        open_invoices_count: (FinanceMockState.invoices || []).filter((i) => i.status === "sent" || i.status === "draft").length,
        unpaid_bills_count: (FinanceMockState.bills || []).filter((b) => b.status === "unpaid").length,
        active_subscriptions_count: (FinanceMockState.subscriptions || []).filter((s) => s.is_active).length,
        generated_at: new Date().toISOString(),
        kpis: {
          total_cash: {
            id: "statFinanceBalance",
            value: balance || 245000.0,
            currency: displayCurrency,
            label: "Total Cash Balance",
            period: "Current (Real-time)",
            definition: "Consolidated book cash balance across all active bank and cash accounts matching scope.",
            formula: "SUM(finance_bank_accounts.current_balance WHERE is_active=True)",
            source_coverage: `${accounts.length} active bank & cash accounts`,
            drilldown_section: "finance-accounts",
            drilldown_filter: { is_active: "true" },
          },
          revenue: {
            id: "statFinanceRevenue",
            value: revenue,
            currency: displayCurrency,
            label: `Revenue (${period})`,
            period: period,
            definition: basis === "cash" ? "Actual cash inflows received and categorized as revenue" : "Recognized revenue from all non-void sales invoices issued in period",
            formula: basis === "cash" ? "SUM(ledger_inflows WHERE source!='transfer')" : "SUM(sales_invoices.total WHERE status NOT IN ('void', 'draft'))",
            source_coverage: basis === "cash" ? "Bank & cash ledger transactions" : "Sales invoices register",
            drilldown_section: basis === "cash" ? "finance-transactions" : "finance-invoices",
            drilldown_filter: basis === "cash" ? { direction: "in" } : { status: "all" },
          },
          operating_spend: {
            id: "statFinanceCost",
            value: cost,
            currency: displayCurrency,
            label: `Operating Expenses (${period})`,
            period: period,
            definition: basis === "cash" ? "Actual cash outflows paid for expenses, bills, and charges" : "Recognized costs from all non-void vendor bills issued in period",
            formula: basis === "cash" ? "SUM(ledger_outflows WHERE source!='transfer')" : "SUM(bills.total WHERE status!='void')",
            source_coverage: basis === "cash" ? "Bank & cash ledger transactions" : "Vendor bills register",
            drilldown_section: basis === "cash" ? "finance-transactions" : "finance-bills",
            drilldown_filter: basis === "cash" ? { direction: "out" } : { status: "all" },
          },
          net_result: {
            id: "statFinanceNet",
            value: net,
            currency: displayCurrency,
            label: `Net Operating Result (${period})`,
            period: period,
            definition: "Net operating difference: Revenue minus Operating Expenses for the period.",
            formula: "Revenue - Operating Expenses",
            source_coverage: basis === "cash" ? "Ledger operating delta" : "Invoices minus Bills",
            drilldown_section: "finance-reports",
            drilldown_filter: {},
          },
          operating_margin: {
            id: "statFinanceMargin",
            value: marginPct,
            is_valid: marginValid,
            unit: "%",
            label: `Operating Margin (${period})`,
            period: period,
            definition: marginValid ? "Operating profitability percentage: (Net Result / Revenue) * 100." : "Margin is undefined when Revenue is zero or negative.",
            formula: "(Net Operating Result / Revenue) * 100",
            source_coverage: "Derived from Revenue and Spend",
            drilldown_section: "finance-reports",
            drilldown_filter: {},
          },
        },
      };
    }
    let url = "/api/finance/reports/summary";
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async getDashboardSummary(params = {}) {
    return this.getFinanceSummary(params);
  },

  async getAttentionQueue(params = {}) {
    if (_isMock()) {
      const severity = (params.severity || "all").toLowerCase();
      const itemType = (params.item_type || params.type || "all").toLowerCase();
      const search = (params.search || "").toLowerCase();
      const includeReviewed = params.include_reviewed === true || params.include_reviewed === "true";

      const reviewedSet = FinanceMockState.attentionReviewed || new Set();

      const allMockItems = [
        {
          id: "rec-inv-1",
          deduplication_key: "invoice:1:overdue",
          type: "overdue_receivable",
          severity: "urgent",
          severity_label: "Urgent",
          title: "Overdue Invoice: INV-2026-001",
          description: "Invoice INV-2026-001 to Apex Health Partners is overdue by 13 days. Outstanding balance: $12,500.00 USD.",
          counterparty: "Apex Health Partners",
          amount: 12500.0,
          currency: "USD",
          due_date: "2026-09-01",
          due_state: "overdue",
          due_state_label: "Overdue by 13d",
          owner: "billing@apexhealth.com",
          target_route: "a-finance-invoices",
          target_id: 1,
          target_filter: { status: "overdue", invoice_id: 1 },
          permission: "finance.invoice.read",
          priority_score: 95,
          can_resolve: true,
          can_mark_reviewed: true,
          is_reviewed: reviewedSet.has("invoice:1:overdue"),
          created_at: "2026-09-01T08:00:00",
        },
        {
          id: "bill-1",
          deduplication_key: "bill:1:due",
          type: "bill_due",
          severity: "urgent",
          severity_label: "Urgent",
          title: "Overdue Bill: BILL-2026-001",
          description: "Bill BILL-2026-001 from Amazon Web Services is overdue by 5 days. Payable balance: $4,200.00 USD.",
          counterparty: "Amazon Web Services",
          amount: 4200.0,
          currency: "USD",
          due_date: "2026-09-08",
          due_state: "overdue",
          due_state_label: "Overdue by 5d",
          owner: "aws-receivables@amazon.com",
          target_route: "a-finance-bills",
          target_id: 1,
          target_filter: { bill_id: 1 },
          permission: "finance.bill.read",
          priority_score: 88,
          can_resolve: true,
          can_mark_reviewed: true,
          is_reviewed: reviewedSet.has("bill:1:due"),
          created_at: "2026-09-01T08:00:00",
        },
        {
          id: "cash-acc-4",
          deduplication_key: "account:4:negative_balance",
          type: "negative_cash",
          severity: "urgent",
          severity_label: "Urgent",
          title: "Negative Balance: Cairo Office Petty Cash Drawer",
          description: "Petty cash drawer has an overdraft balance of 2,500.00 EGP. Replenishment transfer required.",
          counterparty: "Cairo Office Petty Cash",
          amount: 2500.0,
          currency: "EGP",
          due_date: "2026-09-13",
          due_state: "immediate",
          due_state_label: "Action Required (Overdraft)",
          owner: null,
          target_route: "a-finance-accounts",
          target_id: 4,
          target_filter: { is_active: "true" },
          permission: "finance.account.read",
          priority_score: 110,
          can_resolve: true,
          can_mark_reviewed: true,
          is_reviewed: reviewedSet.has("account:4:negative_balance"),
          created_at: "2026-09-10T12:00:00",
        },
        {
          id: "transfer-1",
          deduplication_key: "transfer:1:incomplete",
          type: "pending_approval",
          severity: "warning",
          severity_label: "Warning",
          title: "Incomplete Transfer #1",
          description: "Transfer of $50,000.00 USD from Voyance Operating USD to Voyance Treasury Reserve has confirmed leg 'from_only'. Second leg requires confirmation.",
          counterparty: "Voyance Operating USD → Treasury Reserve",
          amount: 50000.0,
          currency: "USD",
          due_date: "2026-09-12",
          due_state: "pending_review",
          due_state_label: "Pending Second Leg",
          owner: "finance.admin@example.com",
          target_route: "a-finance-transfers",
          target_id: 1,
          target_filter: { transfer_id: 1 },
          permission: "finance.transfer.read",
          priority_score: 75,
          can_resolve: true,
          can_mark_reviewed: true,
          is_reviewed: reviewedSet.has("transfer:1:incomplete"),
          created_at: "2026-09-12T15:30:00",
        },
        {
          id: "stmt-1",
          deduplication_key: "statement:1:unmatched",
          type: "unreconciled_statement",
          severity: "warning",
          severity_label: "Warning",
          title: "Unreconciled Statement: JPMorgan Chase (2026-08)",
          description: "Statement import for 2026-08 contains 3 unmatched statement lines requiring ledger matching.",
          counterparty: "JPMorgan Chase",
          amount: 3850.0,
          currency: "USD",
          due_date: "2026-09-01",
          due_state: "needs_reconciliation",
          due_state_label: "3 Unmatched Lines",
          owner: null,
          target_route: "a-finance-statements",
          target_id: 1,
          target_filter: { import_id: 1 },
          permission: "finance.statement.read",
          priority_score: 65,
          can_resolve: true,
          can_mark_reviewed: true,
          is_reviewed: reviewedSet.has("statement:1:unmatched"),
          created_at: "2026-09-01T14:00:00",
        },
      ];

      let filtered = allMockItems.filter((it) => {
        if (!includeReviewed && it.is_reviewed) return false;
        if (severity !== "all" && it.severity !== severity) return false;
        if (itemType !== "all" && it.type !== itemType) return false;
        if (search) {
          const s = search.toLowerCase();
          const match =
            it.title.toLowerCase().includes(s) ||
            it.description.toLowerCase().includes(s) ||
            (it.counterparty && it.counterparty.toLowerCase().includes(s));
          if (!match) return false;
        }
        return true;
      });

      filtered.sort((a, b) => b.priority_score - a.priority_score);

      const urgentCount = filtered.filter((i) => i.severity === "urgent").length;
      const warningCount = filtered.filter((i) => i.severity === "warning").length;
      const infoCount = filtered.filter((i) => i.severity === "info").length;

      const currencyTotals = {};
      filtered.forEach((it) => {
        if (it.amount && it.currency) {
          currencyTotals[it.currency] = round((currencyTotals[it.currency] || 0) + it.amount, 2);
        }
      });

      return {
        total_count: filtered.length,
        urgent_count: urgentCount,
        warning_count: warningCount,
        info_count: infoCount,
        total_amount_by_currency: currencyTotals,
        items: filtered,
        generated_at: new Date().toISOString(),
      };
    }

    let url = "/api/finance/reports/attention-queue";
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },

  async reviewAttentionItem(itemKey, payload = {}) {
    if (_isMock()) {
      if (!FinanceMockState.attentionReviewed) {
        FinanceMockState.attentionReviewed = new Set();
      }
      FinanceMockState.attentionReviewed.add(itemKey);
      return { success: true, deduplication_key: itemKey, status: payload.status || "reviewed" };
    }
    const encodedKey = encodeURIComponent(itemKey);
    return apiRequest("POST", `/api/finance/reports/attention-queue/${encodedKey}/review`, payload);
  },

  async getCashForecast(params = {}) {
    if (_isMock()) {
      const currency = (params.currency || "all").toUpperCase();
      const horizonDays = parseInt(params.horizon_days || "90", 10);
      const includeExpected = params.include_expected !== false && params.include_expected !== "false";

      let rawAccounts = FinanceMockState.accounts || [];
      if (currency !== "ALL") {
        rawAccounts = rawAccounts.filter((a) => (a.currency || "").toUpperCase() === currency);
      }

      const cheques = FinanceMockState.cheques || [];
      const transfers = FinanceMockState.transfers || [];

      let totalCurrentCash = 0;
      const currentCashByCurrency = {};

      const accounts = rawAccounts.map((acc) => {
        const bookBal = round(acc.current_balance || 0, 2);
        const curr = (acc.currency || "USD").toUpperCase();
        currentCashByCurrency[curr] = round((currentCashByCurrency[curr] || 0) + bookBal, 2);
        totalCurrentCash = round(totalCurrentCash + bookBal, 2);

        // Uncleared issued cheques
        let uncleared = 0;
        cheques.forEach((chq) => {
          if (chq.account_id === acc.id && chq.status === "issued") {
            uncleared += (chq.amount || 0);
          }
        });
        uncleared = round(uncleared, 2);

        // Pending outgoing transfers
        let pending = 0;
        transfers.forEach((tr) => {
          if (tr.from_account_id === acc.id && tr.confirmed_leg !== "both") {
            pending += (tr.from_amount || 0);
          }
        });
        pending = round(pending, 2);

        const availableBal = round(bookBal - uncleared - pending, 2);
        const reconciledBal = bookBal > 0 ? round(bookBal * 0.95, 2) : bookBal;

        return {
          account_id: acc.id,
          account_name: acc.account_name,
          bank_name: acc.bank_name,
          account_type: acc.account_type || "bank",
          currency: acc.currency,
          book_balance: bookBal,
          available_balance: availableBal,
          reconciled_balance: reconciledBal,
          uncleared_cheques_amount: uncleared,
          pending_transfers_amount: pending,
          is_active: acc.is_active,
        };
      });

      // Obligations
      const obligations = [];
      const todayStr = "2026-09-13";
      const today = new Date("2026-09-13T00:00:00");

      // (a) Invoices
      (FinanceMockState.invoices || []).forEach((inv) => {
        if (["void", "draft"].includes((inv.status || "").toLowerCase())) return;
        if (currency !== "ALL" && (inv.currency || "").toUpperCase() !== currency) return;
        const total = inv.total || 0;
        const paid = (inv.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
        const bal = round(total - paid, 2);
        if (bal <= 0) return;

        const isOverdue = inv.due_date && inv.due_date < todayStr;
        obligations.push({
          id: `inflow-inv-${inv.id}`,
          entity_type: "invoice",
          entity_id: inv.id,
          reference: inv.invoice_number,
          counterparty: inv.customer_name || "Customer",
          type: "inflow",
          amount: bal,
          currency: inv.currency,
          due_date: isOverdue ? todayStr : (inv.due_date || todayStr),
          status: isOverdue ? "expected" : "confirmed",
          certainty: isOverdue ? "overdue" : "contractual",
          target_route: "a-finance-invoices",
          notes: `Sales Invoice balance: ${bal.toLocaleString()} ${inv.currency}`,
        });
      });

      // (b) Bills
      (FinanceMockState.bills || []).forEach((bill) => {
        if (["void", "draft"].includes((bill.status || "").toLowerCase())) return;
        if (currency !== "ALL" && (bill.currency || "").toUpperCase() !== currency) return;
        const total = bill.total || 0;
        const paid = (bill.payments || []).reduce((s, p) => s + (p.amount || 0), 0);
        const bal = round(total - paid, 2);
        if (bal <= 0) return;

        const isOverdue = bill.due_date && bill.due_date < todayStr;
        obligations.push({
          id: `outflow-bill-${bill.id}`,
          entity_type: "bill",
          entity_id: bill.id,
          reference: bill.bill_number,
          counterparty: bill.vendor_name || "Vendor",
          type: "outflow",
          amount: bal,
          currency: bill.currency,
          due_date: isOverdue ? todayStr : (bill.due_date || todayStr),
          status: "confirmed",
          certainty: isOverdue ? "overdue" : "contractual",
          target_route: "a-finance-bills",
          notes: `Vendor payable balance: ${bal.toLocaleString()} ${bill.currency}`,
        });
      });

      // (c) Subscriptions
      if (includeExpected) {
        (FinanceMockState.subscriptions || []).forEach((sub) => {
          if (!sub.is_active) return;
          if (currency !== "ALL" && (sub.currency || "").toUpperCase() !== currency) return;
          const amt = round(sub.amount || 0, 2);
          if (amt <= 0) return;

          [0, 1, 2].forEach((cycle) => {
            const d = new Date(today);
            d.setDate(d.getDate() + 15 + cycle * 30);
            const cycleDateStr = d.toISOString().split("T")[0];
            obligations.push({
              id: `outflow-sub-${sub.id}-c${cycle}`,
              entity_type: "subscription",
              entity_id: sub.id,
              reference: `${sub.name} (Renewal #${cycle + 1})`,
              counterparty: sub.vendor_name || sub.name,
              type: "outflow",
              amount: amt,
              currency: sub.currency,
              due_date: cycleDateStr,
              status: "expected",
              certainty: "estimated",
              target_route: "a-finance-spend",
              notes: `Recurring ${sub.billing_cycle || "monthly"} subscription charge`,
            });
          });
        });
      }

      // Horizons calculations
      const horizonsMeta = [
        { key: "30_days", days: 30, label: "Next 30 Days", minDays: 0, maxDays: 30 },
        { key: "60_days", days: 60, label: "31 - 60 Days", minDays: 31, maxDays: 60 },
        { key: "90_days", days: 90, label: "61 - 90 Days", minDays: 61, maxDays: 90 },
      ];

      let runningCash = totalCurrentCash;
      const horizons = {};

      horizonsMeta.forEach((h) => {
        let confIn = 0;
        let expIn = 0;
        let confOut = 0;
        let expOut = 0;

        obligations.forEach((ob) => {
          const obDate = new Date(ob.due_date + "T00:00:00");
          const diffDays = Math.round((obDate - today) / (1000 * 60 * 60 * 24));
          const inRange = (h.key === "30_days" && diffDays <= 30) || (diffDays >= h.minDays && diffDays <= h.maxDays);
          if (inRange) {
            if (ob.type === "inflow") {
              if (ob.status === "confirmed") confIn += ob.amount;
              else expIn += ob.amount;
            } else {
              if (ob.status === "confirmed") confOut += ob.amount;
              else expOut += ob.amount;
            }
          }
        });

        confIn = round(confIn, 2);
        expIn = round(expIn, 2);
        confOut = round(confOut, 2);
        expOut = round(expOut, 2);

        const totIn = round(confIn + expIn, 2);
        const totOut = round(confOut + expOut, 2);
        const netFlow = round(totIn - totOut, 2);
        runningCash = round(runningCash + netFlow, 2);

        horizons[h.key] = {
          period_label: h.label,
          days: h.days,
          confirmed_inflows: confIn,
          expected_inflows: expIn,
          total_inflows: totIn,
          confirmed_outflows: confOut,
          expected_outflows: expOut,
          total_outflows: totOut,
          net_cash_flow: netFlow,
          projected_ending_cash: runningCash,
          confidence: h.key === "30_days" ? "high" : (h.key === "60_days" ? "medium" : "low"),
        };
      });

      obligations.sort((a, b) => a.due_date.localeCompare(b.due_date));

      const fxWarnings = [];
      if (currency === "ALL") {
        fxWarnings.push("Multi-currency forecast aggregates values within native currencies. Cross-currency conversions are not fabricated without verified live exchange rates.");
      }

      return {
        as_of_date: todayStr,
        currency: currency,
        accounts: accounts,
        current_cash_by_currency: currentCashByCurrency,
        total_current_cash: totalCurrentCash,
        horizons: horizons,
        material_obligations: obligations.slice(0, 50),
        assumptions: [
          "Draft sales invoices and unapproved vendor bills are strictly excluded from cash projections.",
          "Contractual obligations with past-due dates are placed in the immediate 0-30 day horizon with an overdue status indicator.",
          "Active monthly subscriptions repeat every 30 days as estimated expected outflows.",
          "Book, available, and reconciled balances are tracked independently and never conflated.",
        ],
        fx_warnings: fxWarnings,
        generated_at: new Date().toISOString(),
      };
    }

    let url = "/api/finance/reports/cash-forecast";
    if (params && Object.keys(params).length > 0) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },

async getEntityActivity(entityType, entityId) {
    const norm = (entityType || "").toLowerCase().replace(/s$/, "");
    const id = parseInt(entityId, 10);
    if (_isMock()) {
      if (norm === "invoice") {
        const inv = (FinanceMockState.invoices || []).find((i) => i.id === id) || {
          id,
          invoice_number: `INV-2026-${id}`,
          customer_name: "Apex Health Partners",
          total: 12500.0,
          currency: "USD",
          status: "sent",
          issue_date: "2026-09-01",
          due_date: "2026-09-30",
          notes: "PACS Integration",
        };
        const cust = (FinanceMockState.customers || []).find((c) => c.id === inv.customer_id) || { name: inv.customer_name || "Apex Health Partners", tax_id: "US-88992211" };
        const amountPaid = inv.amount_paid !== undefined ? inv.amount_paid : (inv.status === "paid" ? inv.total : 0.0);
        const balance = inv.balance !== undefined ? inv.balance : Math.max(0, (inv.total || 0) - amountPaid);
        const isOverdue = inv.is_overdue || inv.status === "overdue";
        const nextAction = inv.next_action || (inv.status === "draft" ? "Review & Send to Customer" : (balance <= 0 ? "Completed (Paid in Full)" : (isOverdue ? "Send Payment Reminder" : "Awaiting Due Date / Payment")));
        const attrs = [
          { label: "Subtotal", value: `${(inv.subtotal || inv.total).toLocaleString()} ${inv.currency || "USD"}` },
          { label: "Amount Paid", value: `${amountPaid.toLocaleString()} ${inv.currency || "USD"}` },
          { label: "Outstanding Balance", value: `${balance.toLocaleString()} ${inv.currency || "USD"}` },
          { label: "Next Action", value: nextAction },
          { label: "Due Date", value: inv.due_date || "—" },
          { label: "Revenue Channel", value: inv.revenue_channel || "Overseas USD" },
          { label: "Customer Tax ID", value: cust.tax_id || "US-88992211" },
        ];
        if (isOverdue && inv.days_overdue) {
          attrs.splice(4, 0, { label: "Overdue State", value: `${inv.days_overdue} days overdue` });
        }

        return {
          entity_type: "invoice",
          entity_id: inv.id,
          title: `Invoice ${inv.invoice_number}`,
          status: isOverdue ? "overdue" : (balance <= 0 && inv.status !== "void" ? "paid" : inv.status || "draft"),
          summary: {
            reference: inv.invoice_number,
            counterparty: inv.customer_name || cust.name,
            amount: inv.total,
            currency: inv.currency || "USD",
            date: inv.issue_date,
            due_date: inv.due_date,
            status: isOverdue ? "overdue" : (balance <= 0 && inv.status !== "void" ? "paid" : inv.status || "draft"),
            notes: inv.notes || "",
            sensitive_masked: false,
            attributes: attrs,
          },
          related_records: [
            {
              entity_type: "customer",
              entity_id: cust.id || 1,
              title: cust.name,
              badge: "Customer Account",
              amount: null,
              currency: null,
              date: null,
            },
            {
              entity_type: "transaction",
              entity_id: 1,
              title: "Payment Inflow TXN-0001",
              badge: "Ledger Entry",
              amount: inv.total,
              currency: inv.currency || "USD",
              date: inv.issue_date,
            },
          ],
          attachments: [
            {
              id: 1,
              file_name: `${inv.invoice_number}_document.pdf`,
              file_size: 245760,
              mime_type: "application/pdf",
              storage_ref: "gdrive://invoices/inv.pdf",
              uploaded_at: inv.created_at || "2026-09-01T08:00:00Z",
              uploaded_by: "billing@voyancemed.com",
            },
          ],
          timeline: [
            {
              id: `inv-${inv.id}-created`,
              timestamp: inv.created_at || `${inv.issue_date} 08:00:00`,
              event: "created",
              plain_text: `Invoice ${inv.invoice_number} created with total ${(inv.total || 0).toLocaleString()} ${inv.currency || "USD"}`,
              actor: "admin@voyancemed.com",
              state_transition: { from_state: null, to_state: "draft" },
            },
            {
              id: `inv-${inv.id}-sent`,
              timestamp: `${inv.issue_date} 09:30:00`,
              event: "sent",
              plain_text: `Invoice ${inv.invoice_number} issued and sent to ${inv.customer_name}`,
              actor: "billing@voyancemed.com",
              state_transition: { from_state: "draft", to_state: "sent" },
            },
          ],
        };
      } else if (norm === "customer") {
        const cust = (FinanceMockState.customers || []).find((c) => c.id === id) || {
          id, name: "Customer", is_active: true
        };
        const invoices = (FinanceMockState.invoices || []).filter((i) => i.customer_id === cust.id);
        let total_invoiced = 0.0;
        let total_paid = 0.0;
        let outstanding_balance = 0.0;
        let overdue_balance = 0.0;
        const today = new Date().toISOString().slice(0, 10);
        const daysToPay = [];
        const related = [];
        const timeline = [];

        for (const inv of invoices) {
          const isVoid = inv.status === "void";
          const payments = (FinanceMockState.payments || []).filter((p) => p.related_invoice_id === inv.id && !p.is_reversed);
          const paid = payments.reduce((s, p) => s + (p.amount || 0), 0);
          const bal = isVoid ? 0 : Math.max(0, (inv.total || 0) - paid);
          const isOverdue = !isVoid && bal > 0.001 && inv.due_date && inv.due_date < today;

          if (!isVoid) {
            total_invoiced += (inv.total || 0);
            total_paid += paid;
            outstanding_balance += bal;
            if (isOverdue) overdue_balance += bal;
            if (bal <= 0.001 && paid > 0 && payments.length > 0) {
              const lastP = payments[payments.length - 1];
              if (lastP.payment_date && inv.issue_date) {
                const diff = Math.round((new Date(lastP.payment_date) - new Date(inv.issue_date)) / (86400000));
                if (diff >= 0) daysToPay.push(diff);
              }
            }
          }

          const derivedStatus = isVoid ? "void" : (bal <= 0.001 && inv.total > 0 ? "paid" : (isOverdue ? "overdue" : (inv.status || "sent")));
          related.push({
            entity_type: "invoice",
            entity_id: inv.id,
            title: `Invoice ${inv.invoice_number}`,
            badge: derivedStatus.toUpperCase(),
            amount: inv.total,
            currency: inv.currency || "USD",
            date: inv.issue_date,
          });

          timeline.push({
            id: `inv-${inv.id}-created`,
            timestamp: `${inv.issue_date || today} 09:00:00`,
            event: "invoice_issued",
            plain_text: `Invoice ${inv.invoice_number} issued for ${inv.currency || "USD"} ${(inv.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
            actor: "finance@voyance.health",
            state_transition: { from_state: "draft", to_state: derivedStatus },
          });

          for (const p of payments) {
            timeline.push({
              id: `pmt-${p.id}-received`,
              timestamp: `${p.payment_date || today} 14:00:00`,
              event: "payment_received",
              plain_text: `Payment of ${p.currency || "USD"} ${(p.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} recorded (Ref: ${p.reference || "N/A"})`,
              actor: "finance@voyance.health",
              state_transition: { from_state: "sent", to_state: "paid" },
            });
          }
        }

        const avgDays = daysToPay.length > 0 ? Math.round((daysToPay.reduce((s, d) => s + d, 0) / daysToPay.length) * 10) / 10 : null;

        const attrs = [
          { label: "Legal Name", value: cust.legal_name || "—" },
          { label: "Contact Email", value: cust.contact_email || "—" },
          { label: "Contact Phone", value: cust.contact_phone || "—" },
          { label: "Tax ID", value: cust.tax_id || "—" },
          { label: "Payment Terms", value: `${cust.payment_terms_days || 30} days` },
          { label: "Default Currency", value: cust.default_currency || "USD" },
          { label: "Country", value: cust.country || "Egypt" },
          { label: "Total Invoiced", value: `$${total_invoiced.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${cust.default_currency || "USD"}` },
          { label: "Total Paid", value: `$${total_paid.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${cust.default_currency || "USD"}` },
          { label: "Outstanding Balance", value: `$${outstanding_balance.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${cust.default_currency || "USD"}` },
          { label: "Overdue Balance", value: `$${overdue_balance.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${cust.default_currency || "USD"}` },
          { label: "Avg Days to Pay", value: avgDays ? `${avgDays} days` : "—" },
          { label: "Account Owner", value: cust.owner || "—" },
        ];

        return {
          entity_type: "customer",
          entity_id: cust.id,
          title: `Customer: ${cust.name}`,
          status: cust.is_active ? "active" : "inactive",
          summary: {
            reference: cust.name,
            counterparty: cust.legal_name || cust.name,
            amount: outstanding_balance,
            currency: cust.default_currency || "USD",
            date: cust.created_at,
            due_date: null,
            status: cust.is_active ? "active" : "inactive",
            notes: cust.notes || "",
            sensitive_masked: false,
            attributes: attrs,
          },
          related_records: related,
          attachments: [],
          timeline,
        };
      } else if (norm === "vendor") {
        const vend = (FinanceMockState.vendors || []).find((v) => v.id === id) || {
          id,
          name: "Amazon Web Services",
          category: "Infrastructure",
          contact_email: "aws-receivables@amazon.com",
          tax_id: "VAT-1294819",
          is_active: true,
        };
        const bills = (FinanceMockState.bills || []).filter((b) => b.vendor_id === vend.id);
        const paidBills = bills.filter((b) => b.status === "paid");
        const totalSpend = paidBills.reduce((acc, b) => acc + (b.total || 0), 0);
        const openBills = bills.filter((b) => b.status !== "paid" && b.status !== "void");
        const openTotal = openBills.reduce((acc, b) => acc + (b.total || 0), 0);

        const instructions = (FinanceMockState.vendorPaymentInstructions || []).filter((pi) => pi.vendor_id === vend.id);
        const piParts = instructions.map((pi) => `${pi.bank_name || 'Bank'}: ******${(pi.account_number || '').slice(-4)} (${pi.verification_status})`);

        const related = bills.map((b) => ({
          entity_type: "bill",
          entity_id: b.id,
          title: `Bill ${b.bill_number}`,
          badge: (b.status || "unpaid").toUpperCase(),
          amount: b.total,
          currency: b.currency || "USD",
          date: b.issue_date,
        }));

        const timeline = bills.map((b) => ({
          id: `bill-${b.id}-issued`,
          timestamp: `${b.issue_date || "2026-09-01"} 09:00:00`,
          event: "bill_received",
          plain_text: `Bill ${b.bill_number} recorded for ${b.currency || "USD"} ${(b.total || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
          actor: b.created_by || "finance@voyance.health",
          state_transition: { from_state: "inbox", to_state: b.status || "unpaid" },
        }));

        const attrs = [
          { label: "Legal Name", value: vend.legal_name || "—" },
          { label: "Category", value: vend.category || "General" },
          { label: "Contact Email", value: vend.contact_email || "—" },
          { label: "Contact Phone", value: vend.contact_phone || "—" },
          { label: "Tax ID", value: vend.tax_id || "—" },
          { label: "Payment Terms", value: `${vend.payment_terms_days || 30} days` },
          { label: "Default Currency", value: vend.default_currency || "USD" },
          { label: "Total Spend", value: `$${totalSpend.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${vend.default_currency || "USD"}` },
          { label: "Open Bills Count", value: String(openBills.length) },
          { label: "Open Bills Total", value: `$${openTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${vend.default_currency || "USD"}` },
          { label: "Payment Instructions", value: piParts.length ? piParts.join("; ") : "None recorded" },
        ];

        return {
          entity_type: "vendor",
          entity_id: vend.id,
          title: `Vendor: ${vend.name}`,
          status: vend.is_active ? "active" : "inactive",
          summary: {
            reference: vend.name,
            counterparty: vend.legal_name || vend.name,
            amount: openTotal,
            currency: vend.default_currency || "USD",
            date: vend.created_at,
            due_date: null,
            status: vend.is_active ? "active" : "inactive",
            notes: vend.notes || "",
            sensitive_masked: Boolean(instructions.length),
            attributes: attrs,
          },
          related_records: related,
          attachments: [],
          timeline,
        };
      } else if (norm === "bill") {
        const bill = (FinanceMockState.bills || []).find((b) => b.id === id) || {
          id,
          bill_number: `BILL-2026-${id}`,
          vendor_name: "Amazon Web Services",
          total: 4200.0,
          currency: "USD",
          status: "unpaid",
          issue_date: "2026-09-01",
          due_date: "2026-09-30",
          category: "Infrastructure",
        };
        const vendor = (FinanceMockState.vendors || []).find((v) => v.id === bill.vendor_id) || { name: bill.vendor_name || "Amazon Web Services", tax_id: "VAT-1294819" };
        const payments = (FinanceMockState.billPayments || []).filter((p) => p.related_bill_id === bill.id);
        const activePayments = payments.filter((p) => !p.is_reversed);
        const paidSoFar = activePayments.reduce((s, p) => s + (p.amount || 0), 0);
        const remaining = Math.max(0, (bill.total || 0) - paidSoFar);

        const timeline = [
          {
            id: `bill-${bill.id}-created`,
            timestamp: bill.created_at || `${bill.issue_date} 08:00:00`,
            event: "created",
            plain_text: `Vendor bill ${bill.bill_number} received from ${bill.vendor_name || vendor.name}`,
            actor: bill.created_by || "ap@voyance.health",
            state_transition: { from_state: null, to_state: bill.status || "unpaid" },
          },
        ];

        if (bill.approved_at) {
          timeline.push({
            id: `bill-${bill.id}-approved`,
            timestamp: bill.approved_at,
            event: "approved",
            plain_text: `Bill approval recorded: ${bill.approval_status} by ${bill.approved_by || "manager"}${bill.approval_comment ? ` ("${bill.approval_comment}")` : ""}`,
            actor: bill.approved_by || "manager",
            state_transition: { from_state: "needs_approval", to_state: bill.approval_status === "approved" ? "ready_to_pay" : "exceptions" },
          });
        }

        if (bill.scheduled_payment_date) {
          timeline.push({
            id: `bill-${bill.id}-scheduled`,
            timestamp: bill.created_at || `${bill.issue_date} 10:00:00`,
            event: "scheduled",
            plain_text: `Payment scheduled for ${bill.scheduled_payment_date}`,
            actor: "finance@voyance.health",
            state_transition: { from_state: "ready_to_pay", to_state: "scheduled" },
          });
        }

        for (const p of payments) {
          timeline.push({
            id: `bill-pay-${p.id}`,
            timestamp: `${p.payment_date || bill.issue_date} 12:00:00`,
            event: "payment",
            plain_text: `Payment of ${p.amount.toLocaleString()} ${p.currency || "USD"} recorded (Ref: ${p.reference || "N/A"})`,
            actor: "ap@voyance.health",
            state_transition: { from_state: "ready_to_pay", to_state: "partially_paid" },
          });
          if (p.is_reversed) {
            timeline.push({
              id: `bill-rev-${p.id}`,
              timestamp: p.reversed_at || new Date().toISOString(),
              event: "reversal",
              plain_text: `Payment #${p.id} reversed: ${p.reversal_reason || "Voided by user"}`,
              actor: p.reversed_by || "admin@voyance.health",
              state_transition: { from_state: "paid", to_state: "ready_to_pay" },
            });
          }
        }

        const related = [
          {
            entity_type: "vendor",
            entity_id: vendor.id || 1,
            title: vendor.name,
            badge: "Vendor Payables",
            amount: null,
            currency: null,
            date: null,
          },
          ...payments.map((p) => ({
            entity_type: "payment",
            entity_id: p.id,
            title: `Payment #${p.id} (${p.method || "transfer"})` + (p.is_reversed ? " [REVERSED]" : ""),
            badge: p.is_reversed ? "REVERSED" : "PAID",
            amount: p.amount,
            currency: p.currency || bill.currency || "USD",
            date: p.payment_date,
          })),
        ];

        return {
          entity_type: "bill",
          entity_id: bill.id,
          title: `Bill ${bill.bill_number}`,
          status: bill.status || "unpaid",
          summary: {
            reference: bill.bill_number,
            counterparty: bill.vendor_name || vendor.name,
            amount: bill.total,
            currency: bill.currency || "USD",
            date: bill.issue_date,
            due_date: bill.due_date,
            status: bill.status,
            notes: bill.notes || "",
            sensitive_masked: false,
            attributes: [
              { label: "Category", value: bill.category || "General" },
              { label: "Subtotal", value: `${(bill.subtotal || bill.total).toLocaleString()} ${bill.currency || "USD"}` },
              { label: "Amount Paid", value: `${paidSoFar.toLocaleString()} ${bill.currency || "USD"}` },
              { label: "Remaining Balance", value: `${remaining.toLocaleString()} ${bill.currency || "USD"}` },
              { label: "Approval Status", value: bill.approval_status ? bill.approval_status.toUpperCase() : (bill.requires_approval ? "PENDING" : "NOT REQUIRED") },
              { label: "Approved By", value: bill.approved_by || "—" },
              { label: "Scheduled Date", value: bill.scheduled_payment_date || "—" },
              { label: "Due Date", value: bill.due_date || "—" },
              { label: "Vendor Tax ID", value: vendor.tax_id || "VAT-1294819" },
            ],
          },
          related_records: related,
          attachments: (bill.attachment_name || bill.attachment_url) ? [
            {
              id: bill.id,
              file_name: bill.attachment_name || `${bill.bill_number}_receipt.pdf`,
              file_size: 154800,
              mime_type: "application/pdf",
              storage_ref: `/api/finance/bills/${bill.id}/attachment`,
              uploaded_at: bill.created_at || "2026-09-01T08:00:00Z",
              uploaded_by: bill.created_by || "ap@voyancemed.com",
            },
          ] : [],
          timeline,
        };
      } else if (norm === "transaction") {
        return {
          entity_type: "transaction",
          entity_id: id,
          title: `Transaction TXN-${String(id).padStart(4, "0")}`,
          status: "settled",
          summary: {
            reference: `TXN-${String(id).padStart(4, "0")}`,
            counterparty: "Voyance Operating USD",
            amount: 12500.0,
            currency: "USD",
            date: "2026-09-01",
            status: "settled",
            notes: "Apex Health Partners Q3 Payment",
            sensitive_masked: false,
            attributes: [
              { label: "Direction", value: "Inflow" },
              { label: "Account", value: "Voyance Operating USD" },
              { label: "Category", value: "Revenue" },
              { label: "Running Balance", value: "$162,500.00" },
            ],
          },
          related_records: [
            {
              entity_type: "invoice",
              entity_id: 1,
              title: "Invoice INV-2026-001",
              badge: "Settled Invoice",
              amount: 12500.0,
              currency: "USD",
              date: "2026-09-01",
            },
          ],
          attachments: [],
          timeline: [
            {
              id: `tx-${id}-posted`,
              timestamp: "2026-09-01 10:00:00",
              event: "posted",
              plain_text: `Transaction TXN-${String(id).padStart(4, "0")} posted: Inflow of $12,500.00 into Voyance Operating USD`,
              actor: "system@hrflow.internal",
              state_transition: { from_state: null, to_state: "settled" },
            },
          ],
        };
      }
    }
    return apiRequest("GET", `/api/finance/activity/${norm}/${id}`);
  },

  // ==========================================
  };

  root.FinanceDashboardApi = FinanceDashboardApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceDashboardApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceDashboardApi;
  }
})(typeof window !== "undefined" ? window : globalThis);
