/**
 * fe/api/finance/accounts-api.js
 * Finance API - Accounts & Banking domain client and mock handlers.
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

  if (!FinanceMockState.accounts) {
    FinanceMockState.accounts = [
    { id: 1, account_name: "Voyance Operating USD", account_type: "bank", bank_name: "JPMorgan Chase", account_number: "******4821", raw_account_number: "12345678904821", country: "United States", currency: "USD", opening_balance: 150000.0, opening_balance_date: "2025-01-01", current_balance: 150000.0, is_active: true },
    { id: 2, account_name: "Voyance Treasury Reserve", account_type: "bank", bank_name: "Silicon Valley Bank", account_number: "******9102", raw_account_number: "98765432109102", country: "United States", currency: "USD", opening_balance: 500000.0, opening_balance_date: "2025-01-01", current_balance: 500000.0, is_active: true },
    { id: 3, account_name: "CIB EGP Operating", account_type: "bank", bank_name: "Commercial International Bank", account_number: "******3319", raw_account_number: "55443322113319", country: "Egypt", currency: "EGP", opening_balance: 450000.0, opening_balance_date: "2025-01-01", current_balance: 450000.0, is_active: true },
    { id: 4, account_name: "Cairo Office Petty Cash Drawer", account_type: "cash", bank_name: null, account_number: "CASH-CAIRO-01", raw_account_number: "CASH-CAIRO-01", country: "Egypt", currency: "EGP", opening_balance: 20000.0, opening_balance_date: "2025-01-01", current_balance: 20000.0, is_active: true },
  ];
  }

  if (!FinanceMockState.categories) {
    FinanceMockState.categories = [
    { id: 1, name: "Revenue", kind: "revenue", is_active: true, sort_order: 1, is_petty: false },
    { id: 2, name: "Salaries", kind: "cost", is_active: true, sort_order: 2, is_petty: false },
    { id: 3, name: "Medical Insurance", kind: "cost", is_active: true, sort_order: 3, is_petty: false },
    { id: 4, name: "Kitchen Supplies", kind: "cost", is_active: true, sort_order: 4, is_petty: true },
    { id: 5, name: "Transportation", kind: "cost", is_active: true, sort_order: 5, is_petty: true },
    { id: 6, name: "Rent", kind: "cost", is_active: true, sort_order: 6, is_petty: false },
    { id: 7, name: "Bank Fees", kind: "cost", is_active: true, sort_order: 7, is_petty: false },
    { id: 8, name: "Infrastructure", kind: "cost", is_active: true, sort_order: 8, is_petty: false },
    { id: 9, name: "SaaS", kind: "cost", is_active: true, sort_order: 9, is_petty: false },
    { id: 10, name: "Facilities & Maintenance", kind: "cost", is_active: true, sort_order: 10, is_petty: false },
    { id: 11, name: "Electricity", kind: "cost", is_active: true, sort_order: 11, is_petty: false },
    { id: 12, name: "Internet", kind: "cost", is_active: true, sort_order: 12, is_petty: false },
    { id: 13, name: "Operating Expense", kind: "cost", is_active: true, sort_order: 13, is_petty: false },
    { id: 14, name: "Other", kind: "other", is_active: true, sort_order: 99, is_petty: false },
  ];
  }

  if (!FinanceMockState.paymentTypes) {
    FinanceMockState.paymentTypes = [
    { id: 1, name: "Cash Payment", code: "CASH", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 2, name: "ATM Withdrawal", code: "CASHWITHDRAW", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 3, name: "Check Payment", code: "CHK", requires_cheque_number: true, requires_bank_fee_flag: false, is_active: true },
    { id: 4, name: "Internal Transfer", code: "INTTRANS", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 5, name: "Incoming Transfer", code: "INBOUND_TRANS", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 6, name: "Outgoing Transfer", code: "OUTBOUND_TRANS", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 7, name: "Currency Exchange", code: "USDTOEGP", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 8, name: "Debit Card Payment", code: "DEBIT_CARD", requires_cheque_number: false, requires_bank_fee_flag: false, is_active: true },
    { id: 9, name: "Bank Fee", code: "BANK_FEES", requires_cheque_number: false, requires_bank_fee_flag: true, is_active: true },
  ];
  }

  if (!FinanceMockState.transactions) {
    FinanceMockState.transactions = [
    {
      id: 1,
      account_id: 1,
      date: "2026-09-02",
      direction: "out",
      amount: 4200.0,
      currency: "USD",
      category_id: 2,
      category_name: "Infrastructure",
      payment_type_id: 3,
      payment_type_code: "OUTBOUND_TRANS",
      payment_type_name: "Outbound Transfer",
      reference: "AWS-SEPT-01",
      description: "Payment for AWS Cloud Hosting",
      source: "manual",
      running_balance: 145800.0,
      created_at: "2026-09-02T10:00:00"
    },
    {
      id: 2,
      account_id: 4,
      date: "2026-09-03",
      direction: "out",
      amount: 150.0,
      currency: "EGP",
      category_id: 4,
      category_name: "Kitchen Supplies",
      payment_type_id: 1,
      payment_type_code: "CASH",
      payment_type_name: "Cash Payment",
      reference: "CSH-001",
      description: "Office coffee and tea supplies",
      source: "manual",
      running_balance: 19850.0,
      created_at: "2026-09-03T11:00:00"
    }
  ];
  }

  if (!FinanceMockState.transfers) {
    FinanceMockState.transfers = [];
  }

  const FinanceAccountsApi = {
// Bank Accounts
  async getAccounts(params) {
    if (_isMock()) {
      let list = [...FinanceMockState.accounts].map((a) => {
        const book = Number(a.current_balance || a.opening_balance || 0);
        const hasPostings = (FinanceMockState.transactions || []).some((t) => t.account_id === a.id) || (FinanceMockState.cheques || []).some((c) => c.account_id === a.id);
        const uncleared = (FinanceMockState.cheques || [])
          .filter((c) => c.account_id === a.id && (c.status === "issued" || c.status === "outstanding"))
          .reduce((sum, c) => sum + Number(c.amount || 0), 0);
        const available = book;
        return {
          ...a,
          book_balance: book,
          bank_balance: Math.round((book + uncleared) * 100) / 100,
          available_balance: available,
          reconciled_balance: book,
          unreconciled_count: 0,
          last_reconciled_date: "2026-09-01",
          last_import_date: "2026-09-05",
          has_postings: hasPostings,
          balance_definitions: {
            book_balance: "Current posted ledger balance reflecting all recorded accounting inflows and outflows.",
            bank_balance: "Reported bank statement balance as of the latest statement upload or sync.",
            available_balance: "Liquid balance immediately available for disbursement (Book balance minus uncleared issued cheques).",
            reconciled_balance: "Portion of the ledger verified and reconciled against official bank statements."
          },
          balance_as_of: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC"
        };
      });
      if (params && params.is_active !== undefined) {
        list = list.filter((a) => a.is_active === (params.is_active === "true" || params.is_active === true));
      }
      return list;
    }
    let url = "/api/finance/accounts";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async listAccounts(params) {
    return this.getAccounts(params);
  },
  async getAccount(id, params) {
    if (_isMock()) {
      const acc = FinanceMockState.accounts.find((a) => a.id === parseInt(id, 10));
      if (!acc) throw new Error("Account not found");
      const isReveal = params && (params.reveal === true || params.reveal === "true");
      let acctNum = acc.account_number;
      if (!isReveal) {
        acctNum = `******${(acc.account_number || "").slice(-4)}`;
      } else {
        acctNum = acc.raw_account_number || acc.account_number.replace(/\*/g, "9");
      }
      const book = Number(acc.current_balance || acc.opening_balance || 0);
      const hasPostings = (FinanceMockState.transactions || []).some((t) => t.account_id === acc.id) || (FinanceMockState.cheques || []).some((c) => c.account_id === acc.id);
      const uncleared = (FinanceMockState.cheques || [])
        .filter((c) => c.account_id === acc.id && (c.status === "issued" || c.status === "outstanding"))
        .reduce((sum, c) => sum + Number(c.amount || 0), 0);
      return {
        ...acc,
        account_number: acctNum,
        book_balance: book,
        bank_balance: Math.round((book + uncleared) * 100) / 100,
        available_balance: book,
        reconciled_balance: book,
        unreconciled_count: 0,
        last_reconciled_date: "2026-09-01",
        last_import_date: "2026-09-05",
        has_postings: hasPostings,
        balance_definitions: {
          book_balance: "Current posted ledger balance reflecting all recorded accounting inflows and outflows.",
          bank_balance: "Reported bank statement balance as of the latest statement upload or sync.",
          available_balance: "Liquid balance immediately available for disbursement (Book balance minus uncleared issued cheques).",
          reconciled_balance: "Portion of the ledger verified and reconciled against official bank statements."
        },
        balance_as_of: new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC"
      };
    }
    const q = params ? `?${new URLSearchParams(params).toString()}` : "";
    return apiRequest("GET", `/api/finance/accounts/${id}${q}`);
  },
  async createAccount(payload) {
    if (_isMock()) {
      const rawNum = payload.account_number || "";
      const newAcc = {
        id: FinanceMockState.accounts.length + 1,
        ...payload,
        current_balance: payload.opening_balance || 0,
        raw_account_number: rawNum,
        account_number: `******${rawNum.slice(-4)}`,
        country: payload.country || "Egypt",
        opening_balance_date: payload.opening_balance_date || null,
        is_active: true,
      };
      FinanceMockState.accounts.push(newAcc);
      return newAcc;
    }
    return apiRequest("POST", "/api/finance/accounts", payload);
  },
  async updateAccount(id, payload) {
    if (_isMock()) {
      const acc = FinanceMockState.accounts.find((a) => a.id === parseInt(id, 10));
      if (!acc) throw new Error("Account not found");
      if (payload.currency && payload.currency.toUpperCase() !== (acc.currency || "").toUpperCase()) {
        const hasPostings = (FinanceMockState.transactions || []).some((t) => t.account_id === acc.id) || (FinanceMockState.cheques || []).some((c) => c.account_id === acc.id);
        if (hasPostings) {
          throw new Error("Currency cannot be modified after transactions have been posted to this account.");
        }
      }
      Object.assign(acc, payload);
      return acc;
    }
    return apiRequest("PUT", `/api/finance/accounts/${id}`, payload);
  },
  async deleteAccount(id) {
    if (_isMock()) {
      const acc = FinanceMockState.accounts.find((a) => a.id === parseInt(id, 10));
      if (!acc) throw new Error("Account not found");
      acc.is_active = false;
      return acc;
    }
    return apiRequest("DELETE", `/api/finance/accounts/${id}`);
  },

// Categories (Phase 0)
  async getCategories(params) {
    if (_isMock()) {
      let list = [...FinanceMockState.categories];
      if (params && params.kind) list = list.filter((c) => c.kind === params.kind);
      if (params && params.is_active !== undefined) {
        list = list.filter((c) => c.is_active === (params.is_active === "true" || params.is_active === true));
      }
      return list.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
    }
    let url = "/api/finance/categories";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async getCategory(id) {
    if (_isMock()) {
      const cat = FinanceMockState.categories.find((c) => c.id === parseInt(id, 10));
      if (!cat) throw new Error("Category not found");
      return cat;
    }
    return apiRequest("GET", `/api/finance/categories/${id}`);
  },
  async createCategory(payload) {
    if (_isMock()) {
      const newCat = {
        id: FinanceMockState.categories.length + 1,
        ...payload,
        is_active: payload.is_active !== undefined ? payload.is_active : true,
        sort_order: payload.sort_order || 0,
        is_petty: Boolean(payload.is_petty),
      };
      FinanceMockState.categories.push(newCat);
      return newCat;
    }
    return apiRequest("POST", "/api/finance/categories", payload);
  },
  async updateCategory(id, payload) {
    if (_isMock()) {
      const cat = FinanceMockState.categories.find((c) => c.id === parseInt(id, 10));
      if (!cat) throw new Error("Category not found");
      Object.assign(cat, payload);
      return cat;
    }
    return apiRequest("PATCH", `/api/finance/categories/${id}`, payload);
  },
  async deleteCategory(id) {
    if (_isMock()) {
      const cat = FinanceMockState.categories.find((c) => c.id === parseInt(id, 10));
      if (!cat) throw new Error("Category not found");
      cat.is_active = false;
      return cat;
    }
    return apiRequest("DELETE", `/api/finance/categories/${id}`);
  },

  // Payment Types (Phase 0)
  async getPaymentTypes(params) {
    if (_isMock()) {
      let list = [...FinanceMockState.paymentTypes];
      if (params && params.is_active !== undefined) {
        list = list.filter((p) => p.is_active === (params.is_active === "true" || params.is_active === true));
      }
      return list;
    }
    let url = "/api/finance/payment-types";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async getPaymentType(id) {
    if (_isMock()) {
      const pt = FinanceMockState.paymentTypes.find((p) => p.id === parseInt(id, 10));
      if (!pt) throw new Error("Payment type not found");
      return pt;
    }
    return apiRequest("GET", `/api/finance/payment-types/${id}`);
  },
  async createPaymentType(payload) {
    if (_isMock()) {
      const newPt = {
        id: FinanceMockState.paymentTypes.length + 1,
        ...payload,
        code: payload.code.toUpperCase(),
        is_active: payload.is_active !== undefined ? payload.is_active : true,
      };
      FinanceMockState.paymentTypes.push(newPt);
      return newPt;
    }
    return apiRequest("POST", "/api/finance/payment-types", payload);
  },
  async updatePaymentType(id, payload) {
    if (_isMock()) {
      const pt = FinanceMockState.paymentTypes.find((p) => p.id === parseInt(id, 10));
      if (!pt) throw new Error("Payment type not found");
      Object.assign(pt, payload);
      return pt;
    }
    return apiRequest("PATCH", `/api/finance/payment-types/${id}`, payload);
  },
  async deletePaymentType(id) {
    if (_isMock()) {
      const pt = FinanceMockState.paymentTypes.find((p) => p.id === parseInt(id, 10));
      if (!pt) throw new Error("Payment type not found");
      pt.is_active = false;
      return pt;
    }
    return apiRequest("DELETE", `/api/finance/payment-types/${id}`);
  },

// Transactions & Continuous Ledger (Phase 2)
  async getAccountTransactions(accountId, params) {
    if (_isMock()) {
      let list = (FinanceMockState.transactions || []).filter((t) => t.account_id === parseInt(accountId, 10));
      if (params && params.direction) list = list.filter((t) => t.direction === params.direction);
      if (params && params.category_id) list = list.filter((t) => t.category_id === parseInt(params.category_id, 10));
      if (params && params.payment_type_id) list = list.filter((t) => t.payment_type_id === parseInt(params.payment_type_id, 10));
      if (params && params.date_from) list = list.filter((t) => t.date >= params.date_from);
      if (params && params.date_to) list = list.filter((t) => t.date <= params.date_to);
      if (params && params.is_petty !== undefined) {
        const pettyCatIds = new Set(FinanceMockState.categories.filter((c) => c.is_petty).map((c) => c.id));
        const wantPetty = params.is_petty === true || params.is_petty === "true";
        list = list.filter((t) => pettyCatIds.has(t.category_id) === wantPetty);
      }
      return list.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    }
    let url = `/api/finance/accounts/${accountId}/transactions`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },

  async createTransaction(accountId, payload) {
    return this.createAccountTransaction(accountId, payload);
  },

  async createAccountTransaction(accountId, payload) {
    if (_isMock()) {
      if (!FinanceMockState.transactions) FinanceMockState.transactions = [];
      const acc = FinanceMockState.accounts.find((a) => a.id === parseInt(accountId, 10));
      const amount = parseFloat(payload.amount);
      const entryType = (payload.entry_type || "standard").toLowerCase();
      let direction = payload.direction;
      if (entryType === "bank_fee") direction = "out";

      const txCurr = (payload.currency || (acc ? acc.currency : "USD")).toUpperCase();
      const acctCurr = (acc ? acc.currency : "USD").toUpperCase();

      if (txCurr !== acctCurr) {
        if (!payload.fx_rate || parseFloat(payload.fx_rate) <= 0) {
          throw new Error(`Currency mismatch between transaction (${txCurr}) and account (${acctCurr}). An exchange rate (fx_rate) is required.`);
        }
      }

      if (entryType === "adjustment") {
        if (!payload.reason || !payload.reason.trim()) {
          throw new Error("A specific reason is required when recording an adjustment.");
        }
      }

      const effectiveAmt = txCurr !== acctCurr && payload.fx_rate ? amount / parseFloat(payload.fx_rate) : amount;

      if (acc) {
        if (direction === "in") acc.current_balance = round(acc.current_balance + effectiveAmt, 2);
        else acc.current_balance = round(acc.current_balance - effectiveAmt, 2);
      }

      const cat = FinanceMockState.categories.find((c) => c.id === parseInt(payload.category_id, 10));
      const pt = FinanceMockState.paymentTypes.find((p) => p.id === parseInt(payload.payment_type_id, 10));

      const newTx = {
        id: FinanceMockState.transactions.length + 1,
        account_id: parseInt(accountId, 10),
        date: payload.date,
        amount,
        direction,
        currency: txCurr,
        entry_type: entryType,
        counterparty: payload.counterparty || null,
        tax_amount: parseFloat(payload.tax_amount || 0.0),
        base_amount: txCurr !== acctCurr && payload.fx_rate ? round(effectiveAmt, 2) : null,
        reason: payload.reason || null,
        category_id: payload.category_id ? parseInt(payload.category_id, 10) : null,
        payment_type_id: payload.payment_type_id ? parseInt(payload.payment_type_id, 10) : null,
        category_name: cat ? cat.name : null,
        payment_type_code: pt ? pt.code : null,
        payment_type_name: pt ? pt.name : null,
        reference: payload.reference || "",
        description: payload.description || "",
        fx_rate: payload.fx_rate ? parseFloat(payload.fx_rate) : null,
        fx_equivalent: payload.fx_rate ? round(effectiveAmt, 2) : null,
        destination_cash_account_id: payload.destination_cash_account_id ? parseInt(payload.destination_cash_account_id, 10) : null,
        cheque_number: payload.cheque_number || null,
        source: payload.linked_bill_id ? "bill_payment" : (payload.linked_invoice_id ? "invoice_payment" : "manual"),
        linked_bill_id: payload.linked_bill_id ? parseInt(payload.linked_bill_id, 10) : null,
        linked_invoice_id: payload.linked_invoice_id ? parseInt(payload.linked_invoice_id, 10) : null,
        running_balance: acc ? acc.current_balance : amount,
        created_at: new Date().toISOString(),
      };

      if (payload.linked_bill_id) {
        const bill = (FinanceMockState.bills || []).find((b) => b.id === newTx.linked_bill_id);
        if (bill) {
          bill.amount_paid = round((bill.amount_paid || 0) + amount, 2);
          if (bill.amount_paid >= (bill.total || 0) - 0.01) {
            bill.status = "paid";
          } else {
            bill.status = "partially_paid";
          }
          if (!FinanceMockState.billPayments) FinanceMockState.billPayments = [];
          FinanceMockState.billPayments.push({
            id: Date.now(),
            related_bill_id: bill.id,
            amount,
            currency: txCurr,
            payment_date: payload.date,
            bank_account_id: parseInt(accountId, 10),
            reference: payload.reference || bill.bill_number,
            method: "bank_transfer",
            is_reversed: false,
          });
        }
      } else if (payload.linked_invoice_id) {
        const inv = (FinanceMockState.invoices || []).find((i) => i.id === newTx.linked_invoice_id);
        if (inv) {
          const prevPaid = (FinanceMockState.payments || [])
            .filter((p) => p.related_invoice_id === inv.id && !p.is_reversed)
            .reduce((s, p) => s + (p.amount || 0), 0);
          if (prevPaid + amount >= (inv.total || 0) - 0.01) {
            inv.status = "paid";
          } else {
            inv.status = "partially_paid";
          }
          if (!FinanceMockState.payments) FinanceMockState.payments = [];
          FinanceMockState.payments.push({
            id: Date.now(),
            related_invoice_id: inv.id,
            amount,
            currency: txCurr,
            payment_date: payload.date,
            bank_account_id: parseInt(accountId, 10),
            reference: payload.reference || inv.invoice_number,
            method: "bank_transfer",
            is_reversed: false,
          });
        }
      }

      FinanceMockState.transactions.unshift(newTx);

      if (payload.destination_cash_account_id && direction === "out") {
        const destCash = FinanceMockState.accounts.find((a) => a.id === parseInt(payload.destination_cash_account_id, 10));
        if (destCash) {
          destCash.current_balance = round(destCash.current_balance + amount, 2);
          const pairedInflow = {
            id: FinanceMockState.transactions.length + 1,
            account_id: destCash.id,
            date: payload.date,
            amount,
            direction: "in",
            currency: destCash.currency,
            entry_type: "standard",
            category_id: payload.category_id ? parseInt(payload.category_id, 10) : null,
            payment_type_id: payload.payment_type_id ? parseInt(payload.payment_type_id, 10) : null,
            category_name: cat ? cat.name : null,
            payment_type_code: pt ? pt.code : "CASHWITHDRAW",
            payment_type_name: pt ? pt.name : "Cash Withdrawal",
            reference: payload.reference || "",
            description: `Cash deposit from teller withdrawal (${acc ? acc.account_name : 'Bank'})`,
            source: "transfer",
            running_balance: destCash.current_balance,
            created_at: new Date().toISOString(),
          };
          FinanceMockState.transactions.unshift(pairedInflow);
        }
      }

      return newTx;
    }
    return apiRequest("POST", `/api/finance/accounts/${accountId}/transactions`, payload);
  },

  async checkDuplicateSettlement(params) {
    if (_isMock()) {
      const pType = (params.payee_type || "").toLowerCase();
      const pId = parseInt(params.payee_id, 10);
      const amt = parseFloat(params.amount || 0);

      if (pType === "vendor" && pId) {
        const bills = (FinanceMockState.bills || []).filter((b) => b.vendor_id === pId && b.status !== "paid" && b.status !== "void");
        for (const bill of bills) {
          const paid = (bill.amount_paid || 0);
          const remaining = Math.max(0, (bill.total || 0) - paid);
          const tol = Math.max(1.0, remaining * 0.05);
          if (Math.abs(remaining - amt) <= tol || Math.abs(bill.total - amt) <= tol) {
            return {
              has_match: true,
              match_type: "bill",
              document_id: bill.id,
              document_number: bill.bill_number,
              document_total: bill.total,
              remaining_balance: remaining,
              currency: bill.currency,
              due_date: bill.due_date,
              message: `Matching open bill #${bill.bill_number} found with remaining balance of ${bill.currency} ${remaining.toFixed(2)} (Due: ${bill.due_date}).`,
            };
          }
        }
      } else if (pType === "customer" && pId) {
        const invoices = (FinanceMockState.invoices || []).filter((i) => i.customer_id === pId && i.status !== "paid" && i.status !== "void");
        for (const inv of invoices) {
          const prevPaid = (FinanceMockState.payments || [])
            .filter((p) => p.related_invoice_id === inv.id && !p.is_reversed)
            .reduce((s, p) => s + (p.amount || 0), 0);
          const remaining = Math.max(0, (inv.total || 0) - prevPaid);
          const tol = Math.max(1.0, remaining * 0.05);
          if (Math.abs(remaining - amt) <= tol || Math.abs(inv.total - amt) <= tol) {
            return {
              has_match: true,
              match_type: "invoice",
              document_id: inv.id,
              document_number: inv.invoice_number,
              document_total: inv.total,
              remaining_balance: remaining,
              currency: inv.currency,
              due_date: inv.due_date,
              message: `Matching open invoice #${inv.invoice_number} found with remaining balance of ${inv.currency} ${remaining.toFixed(2)} (Due: ${inv.due_date}).`,
            };
          }
        }
      }
      return { has_match: false };
    }
    const qs = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/transactions/duplicate-settlement-check?${qs}`);
  },

  async getUnlinkedSettlementCandidates(limit = 20) {
    if (_isMock()) {
      return [];
    }
    return apiRequest("GET", `/api/finance/transactions/unlinked-settlement-candidates?limit=${limit}`);
  },

  async previewTransaction(accountId, payload) {
    if (_isMock()) {
      const acc = FinanceMockState.accounts.find((a) => a.id === parseInt(accountId, 10));
      if (!acc) throw new Error("Account not found");

      const amount = parseFloat(payload.amount || 0);
      const txCurr = (payload.currency || acc.currency || "USD").toUpperCase();
      const acctCurr = (acc.currency || "USD").toUpperCase();
      const fxRate = payload.fx_rate ? parseFloat(payload.fx_rate) : null;

      if (txCurr !== acctCurr) {
        if (!fxRate || fxRate <= 0) {
          throw new Error(`Currency mismatch between transaction (${txCurr}) and account (${acctCurr}). An exchange rate (fx_rate) is required.`);
        }
      }

      const effectiveAmt = txCurr !== acctCurr && fxRate ? round(amount / fxRate, 2) : amount;
      const curBal = Number(acc.current_balance || 0);
      const direction = payload.entry_type === "bank_fee" ? "out" : (payload.direction || "out");
      const projBal = direction === "in" ? round(curBal + effectiveAmt, 2) : round(curBal - effectiveAmt, 2);
      const effectWord = direction === "in" ? "increase" : "decrease";

      const sym = txCurr === "USD" ? "$" : (txCurr === "EGP" ? "E£" : txCurr);
      const acctSym = acctCurr === "USD" ? "$" : (acctCurr === "EGP" ? "E£" : acctCurr);

      let plain = `This will ${effectWord} the Book Balance of ${acc.account_name} by ${sym}${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${txCurr}.`;
      if (txCurr !== acctCurr) {
        plain += ` (Converted @ ${fxRate}: ${acctSym}${effectiveAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${acctCurr}).`;
      }
      plain += ` Projected Book Balance: ${acctSym}${projBal.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${acctCurr}.`;

      const journal = [];
      const acctLabel = `Cash / Bank: ${acc.account_name}`;
      if (direction === "in") {
        journal.append ? journal.append({}) : journal.push({ type: "debit", account: acctLabel, amount: effectiveAmt, currency: acctCurr });
        const offsetLabel = payload.entry_type === "money_in" ? "Revenue / Accounts Receivable" : "Retained Earnings (Adjustment)";
        journal.push({ type: "credit", account: offsetLabel, amount: effectiveAmt, currency: acctCurr });
      } else {
        const offsetLabel = payload.entry_type === "bank_fee" ? "Bank & Financing Fees Expense" : (payload.entry_type === "adjustment" ? "Retained Earnings / Variance Adjustment" : "Expense / Accounts Payable");
        journal.push({ type: "debit", account: offsetLabel, amount: effectiveAmt, currency: acctCurr });
        journal.push({ type: "credit", account: acctLabel, amount: effectiveAmt, currency: acctCurr });
      }

      return {
        account_id: acc.id,
        account_name: acc.account_name,
        account_currency: acctCurr,
        entry_type: payload.entry_type || "standard",
        direction,
        transaction_amount: amount,
        transaction_currency: txCurr,
        fx_rate: fxRate,
        converted_amount: effectiveAmt,
        current_book_balance: curBal,
        projected_book_balance: projBal,
        plain_description: plain,
        journal_preview: journal,
      };
    }
    return apiRequest("POST", `/api/finance/accounts/${accountId}/transactions/preview`, payload);
  },

  async getTransaction(id) {
    if (_isMock()) {
      const tx = (FinanceMockState.transactions || []).find((t) => t.id === parseInt(id, 10));
      if (!tx) throw new Error("Transaction not found");
      return tx;
    }
    return apiRequest("GET", `/api/finance/transactions/${id}`);
  },

  async updateTransaction(id, payload) {
    if (_isMock()) {
      const tx = (FinanceMockState.transactions || []).find((t) => t.id === parseInt(id, 10));
      if (!tx) throw new Error("Transaction not found");
      if (tx.source !== "manual") throw new Error("Only manual transactions can be edited directly");
      Object.assign(tx, payload);
      if (payload.amount) tx.amount = parseFloat(payload.amount);
      if (payload.category_id) {
        const cat = FinanceMockState.categories.find((c) => c.id === parseInt(payload.category_id, 10));
        tx.category_name = cat ? cat.name : null;
      }
      if (payload.payment_type_id) {
        const pt = FinanceMockState.paymentTypes.find((p) => p.id === parseInt(payload.payment_type_id, 10));
        tx.payment_type_code = pt ? pt.code : null;
        tx.payment_type_name = pt ? pt.name : null;
      }
      return tx;
    }
    return apiRequest("PATCH", `/api/finance/transactions/${id}`, payload);
  },

  async deleteTransaction(id, reason = null) {
    if (_isMock()) {
      const idx = (FinanceMockState.transactions || []).findIndex((t) => t.id === parseInt(id, 10));
      if (idx === -1) throw new Error("Transaction not found");
      const tx = FinanceMockState.transactions[idx];
      if (tx.source !== "manual") throw new Error("Only manual transactions can be deleted");
      FinanceMockState.transactions.splice(idx, 1);
      return { message: "Transaction deleted successfully", id: parseInt(id, 10), reason: reason || "" };
    }
    const q = reason ? `?reason=${encodeURIComponent(reason)}` : "";
    return apiRequest("DELETE", `/api/finance/transactions/${id}${q}`, null, true, _getIdempHeaders());
  },

  async getAccountPettySummary(accountId, params) {
    if (_isMock()) {
      const txs = await this.getAccountTransactions(accountId, { ...params, is_petty: true });
      const acc = FinanceMockState.accounts.find((a) => a.id === parseInt(accountId, 10));
      let total_in = 0.0;
      let total_out = 0.0;
      const by_cat = {};

      txs.forEach((t) => {
        if (t.direction === "in") total_in += t.amount;
        else total_out += t.amount;
        const catId = t.category_id || 0;
        if (!by_cat[catId]) {
          by_cat[catId] = {
            category_id: catId,
            category_name: t.category_name || "Uncategorized",
            count: 0,
            total_in: 0,
            total_out: 0,
            net_amount: 0,
          };
        }
        by_cat[catId].count++;
        if (t.direction === "in") by_cat[catId].total_in += t.amount;
        else by_cat[catId].total_out += t.amount;
        by_cat[catId].net_amount = by_cat[catId].total_in - by_cat[catId].total_out;
      });

      return {
        account_id: parseInt(accountId, 10),
        account_name: acc ? acc.account_name : "Account",
        currency: acc ? acc.currency : "USD",
        date_from: params?.date_from || null,
        date_to: params?.date_to || null,
        total_in,
        total_out,
        net_amount: total_in - total_out,
        by_category: Object.values(by_cat),
        transactions: txs,
      };
    }
    let url = `/api/finance/accounts/${accountId}/transactions/petty-summary`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },

// Transfers (Phase 3)
  async getTransfers(params) {
    if (_isMock()) {
      let list = [...(FinanceMockState.transfers || [])];
      if (params && params.account_id) {
        const aid = parseInt(params.account_id, 10);
        list = list.filter((t) => t.from_account_id === aid || t.to_account_id === aid);
      }
      if (params && params.transfer_type && params.transfer_type !== "all") {
        list = list.filter((t) => t.transfer_type === params.transfer_type);
      }
      if (params && params.date_from) list = list.filter((t) => t.date >= params.date_from);
      if (params && params.date_to) list = list.filter((t) => t.date <= params.date_to);
      return list.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    }
    let url = "/api/finance/transfers";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },

  async getTransfer(id) {
    if (_isMock()) {
      const transfer = (FinanceMockState.transfers || []).find((t) => t.id === parseInt(id, 10));
      if (!transfer) throw new Error("Transfer not found");
      return transfer;
    }
    return apiRequest("GET", `/api/finance/transfers/${id}`);
  },

  async createTransfer(payload) {
    if (_isMock()) {
      if (!FinanceMockState.transfers) FinanceMockState.transfers = [];
      if (!FinanceMockState.transactions) FinanceMockState.transactions = [];

      const fromAcc = payload.from_account_id
        ? FinanceMockState.accounts.find((a) => a.id === parseInt(payload.from_account_id, 10))
        : null;
      const toAcc = payload.to_account_id
        ? FinanceMockState.accounts.find((a) => a.id === parseInt(payload.to_account_id, 10))
        : null;

      const fromAmount = parseFloat(payload.from_amount);
      let toAmount = payload.to_amount ? parseFloat(payload.to_amount) : fromAmount;
      const fxRate = payload.fx_rate ? parseFloat(payload.fx_rate) : null;

      if (payload.transfer_type === "same_bank_fx" && fxRate && !payload.to_amount) {
        toAmount = round(fromAmount * fxRate, 2);
      }

      const transferId = FinanceMockState.transfers.length + 1;
      let outTxId = null;
      let inTxId = null;

      const postOutflow = payload.transfer_type !== "external_linked" || payload.confirmed_leg !== "to_only";
      const postInflow = payload.transfer_type !== "external_linked" || payload.confirmed_leg !== "from_only";

      if (postOutflow && fromAcc) {
        fromAcc.current_balance = round(fromAcc.current_balance - fromAmount, 2);
        outTxId = FinanceMockState.transactions.length + 1;
        FinanceMockState.transactions.unshift({
          id: outTxId,
          account_id: fromAcc.id,
          date: payload.date,
          amount: fromAmount,
          direction: "out",
          currency: payload.from_currency || fromAcc.currency,
          reference: payload.exchange_reference || `Transfer to ${toAcc ? toAcc.account_name : "External"}`,
          description: payload.note || `Transfer to ${toAcc ? toAcc.account_name : "External"}`,
          fx_rate: fxRate,
          source: "transfer",
          linked_transfer_id: transferId,
          running_balance: fromAcc.current_balance,
          created_at: new Date().toISOString(),
        });
      }

      if (postInflow && toAcc) {
        toAcc.current_balance = round(toAcc.current_balance + toAmount, 2);
        inTxId = FinanceMockState.transactions.length + 1;
        FinanceMockState.transactions.unshift({
          id: inTxId,
          account_id: toAcc.id,
          date: payload.date,
          amount: toAmount,
          direction: "in",
          currency: payload.to_currency || toAcc.currency,
          reference: payload.exchange_reference || `Transfer from ${fromAcc ? fromAcc.account_name : "External"}`,
          description: payload.note || `Transfer from ${fromAcc ? fromAcc.account_name : "External"}`,
          fx_rate: fxRate,
          source: "transfer",
          linked_transfer_id: transferId,
          running_balance: toAcc.current_balance,
          created_at: new Date().toISOString(),
        });
      }

      const confirmedLeg = payload.confirmed_leg || "both";
      let settlementStatus = payload.settlement_status;
      if (!settlementStatus) {
        if (confirmedLeg === "from_only") settlementStatus = "in_transit";
        else if (confirmedLeg === "to_only") settlementStatus = "awaiting_match";
        else settlementStatus = "settled";
      }

      const newTransfer = {
        id: transferId,
        from_account_id: fromAcc ? fromAcc.id : null,
        to_account_id: toAcc ? toAcc.id : null,
        from_account_name: fromAcc ? fromAcc.account_name : null,
        to_account_name: toAcc ? toAcc.account_name : null,
        date: payload.date,
        from_amount: fromAmount,
        from_currency: payload.from_currency || (fromAcc ? fromAcc.currency : "USD"),
        to_amount: toAmount,
        to_currency: payload.to_currency || (toAcc ? toAcc.currency : "USD"),
        fx_rate: fxRate,
        transfer_type: payload.transfer_type,
        exchange_reference: payload.exchange_reference || null,
        confirmed_leg: confirmedLeg,
        settlement_status: settlementStatus,
        fee: parseFloat(payload.fee) || 0.0,
        expected_date: payload.expected_date || null,
        note: payload.note || "",
        outflow_transaction_id: outTxId,
        inflow_transaction_id: inTxId,
        created_at: new Date().toISOString(),
      };
      FinanceMockState.transfers.unshift(newTransfer);
      return newTransfer;
    }
    return apiRequest("POST", "/api/finance/transfers", payload);
  },

  async previewTransfer(payload) {
    if (_isMock()) {
      const fromAcc = payload.from_account_id
        ? (FinanceMockState.accounts || []).find((a) => a.id === parseInt(payload.from_account_id, 10))
        : null;
      const toAcc = payload.to_account_id
        ? (FinanceMockState.accounts || []).find((a) => a.id === parseInt(payload.to_account_id, 10))
        : null;

      const fromName = fromAcc ? fromAcc.account_name : "External Account";
      const toName = toAcc ? toAcc.account_name : "External Account";
      const fromCurr = fromAcc ? fromAcc.currency : "USD";
      const toCurr = toAcc ? toAcc.currency : (payload.to_currency || fromCurr);
      const fromCurBal = fromAcc ? fromAcc.current_balance : 0.0;
      const toCurBal = toAcc ? toAcc.current_balance : (toAcc ? 0.0 : null);

      let isValid = true;
      let validationErr = null;

      if (payload.from_account_id && payload.to_account_id && parseInt(payload.from_account_id, 10) === parseInt(payload.to_account_id, 10)) {
        isValid = false;
        validationErr = "Source and target bank accounts cannot be the same";
      }

      const fromAmt = parseFloat(payload.from_amount) || 0;
      let toAmt = parseFloat(payload.to_amount) || null;
      let fxRate = parseFloat(payload.fx_rate) || null;
      const fee = parseFloat(payload.fee) || 0;

      let explicitFx = null;
      let impliedRate = 1.0;

      if (payload.transfer_type === "internal") {
        toAmt = fromAmt;
        fxRate = 1.0;
        explicitFx = `1 ${fromCurr} = 1.00 ${fromCurr}`;
        impliedRate = 1.0;
        if (fromAcc && toAcc && fromAcc.currency !== toAcc.currency) {
          isValid = false;
          validationErr = `Internal transfer requires same currency (${fromAcc.currency} != ${toAcc.currency}). Use Same-Bank FX.`;
        }
      } else if (payload.transfer_type === "same_bank_fx") {
        if (fxRate && fxRate > 0) {
          if (!toAmt || toAmt <= 0) toAmt = round(fromAmt * fxRate, 2);
        } else if (toAmt && toAmt > 0) {
          fxRate = fromAmt > 0 ? round(toAmt / fromAmt, 6) : null;
        }
        impliedRate = (toAmt && fromAmt > 0) ? round(toAmt / fromAmt, 4) : fxRate;
        explicitFx = fxRate ? `1 ${fromCurr} = ${fxRate.toFixed(4)} ${toCurr}` : null;
      } else {
        if (!toAmt) toAmt = (fxRate && fxRate > 0) ? round(fromAmt * fxRate, 2) : fromAmt;
        impliedRate = (toAmt && fromAmt > 0) ? round(toAmt / fromAmt, 4) : 1.0;
        explicitFx = (fromCurr !== toCurr) ? `1 ${fromCurr} = ${impliedRate.toFixed(4)} ${toCurr}` : null;
      }

      const fromProj = round(fromCurBal - fromAmt - fee, 2);
      const toProj = toCurBal !== null ? round(toCurBal + (toAmt || 0), 2) : null;

      let settlementStatus = "settled";
      if (payload.confirmed_leg === "from_only") settlementStatus = "in_transit";
      else if (payload.confirmed_leg === "to_only") settlementStatus = "awaiting_match";

      const journalPreview = [];
      if (payload.confirmed_leg !== "to_only" && fromAcc) {
        journalPreview.push({ account: `${fromName} (Asset)`, debit: null, credit: fromAmt, currency: fromCurr });
        if (fee > 0) {
          journalPreview.push({ account: `Transfer Fees / ${fromName}`, debit: fee, credit: null, currency: fromCurr });
        }
      }
      if (payload.confirmed_leg !== "from_only" && toAcc) {
        journalPreview.push({ account: `${toName} (Asset)`, debit: toAmt, credit: null, currency: toCurr });
      }

      const plainDesc = `Transfer ${fromAmt.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${fromCurr} from ${fromName} to ${toName}`
        + (fromCurr !== toCurr && fxRate ? ` (${(toAmt || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })} ${toCurr} at ${fxRate.toFixed(4)})` : "")
        + (fee > 0 ? ` with ${fee.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${fromCurr} fee` : "")
        + `. Projected source balance: ${fromProj.toLocaleString("en-US", { minimumFractionDigits: 2 })} ${fromCurr}.`;

      return {
        from_account_name: fromName,
        from_currency: fromCurr,
        from_current_balance: fromCurBal,
        from_projected_balance: fromProj,
        to_account_name: toName,
        to_currency: toCurr,
        to_current_balance: toCurBal,
        to_projected_balance: toProj,
        explicit_fx_direction: explicitFx,
        implied_rate: impliedRate,
        settlement_status: settlementStatus,
        is_valid: isValid,
        validation_error: validationErr,
        plain_description: plainDesc,
        journal_preview: journalPreview,
      };
    }
    return apiRequest("POST", "/api/finance/transfers/preview", payload);
  },

  async matchTransfer(transferId, payload) {
    if (_isMock()) {
      const transfer = (FinanceMockState.transfers || []).find((t) => t.id === parseInt(transferId, 10));
      if (!transfer) throw new Error("Transfer not found");
      if (transfer.settlement_status === "settled") throw new Error("Transfer is already fully settled");

      const toAcc = (FinanceMockState.accounts || []).find((a) => a.id === parseInt(payload.target_account_id, 10));
      if (!toAcc) throw new Error("Target bank account not found");

      transfer.to_account_id = toAcc.id;
      transfer.to_account_name = toAcc.account_name;
      transfer.to_currency = toAcc.currency;
      if (payload.received_amount) transfer.to_amount = parseFloat(payload.received_amount);
      transfer.confirmed_leg = "both";
      transfer.settlement_status = "settled";
      if (payload.note) transfer.note = `${transfer.note} | Matched: ${payload.note}`.trim();

      toAcc.current_balance = round(toAcc.current_balance + transfer.to_amount, 2);
      const inTxId = (FinanceMockState.transactions || []).length + 1;
      FinanceMockState.transactions.unshift({
        id: inTxId,
        account_id: toAcc.id,
        date: payload.settled_date || transfer.date,
        amount: transfer.to_amount,
        direction: "in",
        currency: toAcc.currency,
        reference: transfer.exchange_reference || `Transfer from ${transfer.from_account_name || "External"}`,
        description: `Settled transfer from ${transfer.from_account_name || "External"} (Linked #${transfer.id})`,
        source: "transfer",
        linked_transfer_id: transfer.id,
        running_balance: toAcc.current_balance,
        created_at: new Date().toISOString(),
      });
      transfer.inflow_transaction_id = inTxId;
      return transfer;
    }
    return apiRequest("POST", `/api/finance/transfers/${transferId}/match`, payload);
  }
  };

  root.FinanceAccountsApi = FinanceAccountsApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceAccountsApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceAccountsApi;
  }
})(typeof window !== "undefined" ? window : globalThis);
