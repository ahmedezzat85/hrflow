/**
 * fe/api/finance/statements-api.js
 * Finance API - Bank Statements & Reconciliation domain client and mock handlers.
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

  if (!FinanceMockState.statementImports) {
    FinanceMockState.statementImports = [
    {
      id: 1,
      account_id: 1,
      account_name: "Voyance Operating USD",
      period_month: "2026-09",
      file_type: "csv",
      status: "needs_review",
      uploaded_file_ref: "uploads/finance_attachments/stmt_sept_sample.csv",
      total_lines_count: 3,
      matched_lines_count: 1,
      reconciled_at: null,
      reconciled_by: null,
      created_at: "2026-09-10T10:00:00",
      created_by: "admin@hrflow.test",
      attachments: [{ id: 1, file_name: "chase_sept_statement.csv", file_size: 4210, storage_ref: "uploads/..." }]
    }
  ];
  }

  if (!FinanceMockState.statementLines) {
    FinanceMockState.statementLines = [
    {
      id: 1,
      import_id: 1,
      raw_date: "2026-09-02",
      raw_amount: 4200.0,
      direction: "out",
      raw_description: "AMAZON WEB SERVICES AWS.AMAZON.CO WA",
      raw_reference: "AWS-BILL-01",
      status: "matched",
      notes: "Auto-matched with Bill BILL-2026-001 payment",
      matched_transaction_id: 1,
      matched_cheque_id: null,
      suggested_matches: []
    },
    {
      id: 2,
      import_id: 1,
      raw_date: "2026-09-08",
      raw_amount: 12500.0,
      direction: "in",
      raw_description: "INWARD WIRE APEX HEALTH PARTNERS",
      raw_reference: "WIRE-INV-001",
      status: "unmatched",
      notes: "",
      matched_transaction_id: null,
      matched_cheque_id: null,
      suggested_matches: [
        {
          transaction_id: 101,
          cheque_id: null,
          match_type: "exact_transaction",
          score: 0.95,
          date: "2026-09-08",
          amount: 12500.0,
          direction: "in",
          description: "Customer Invoice Settlement INV-2026-001",
          reference: "INV-2026-001",
          reason: "Exact amount match, date proximity"
        }
      ]
    },
    {
      id: 3,
      import_id: 1,
      raw_date: "2026-09-15",
      raw_amount: 15.0,
      direction: "out",
      raw_description: "MONTHLY SERVICE FEE CHASE BANK",
      raw_reference: "FEE-0926",
      status: "unmatched",
      notes: "",
      matched_transaction_id: null,
      matched_cheque_id: null,
      suggested_matches: []
    }
  ];
  }

  if (!FinanceMockState.reconciliationRules) {
    FinanceMockState.reconciliationRules = [
    {
      id: 1,
      name: "Auto-Categorize Cloud Services",
      description: "Suggest Hosting category for Amazon Web Services",
      priority: 10,
      is_active: true,
      mode: "suggestion",
      account_id: null,
      description_pattern: "AMAZON|AWS",
      direction: "out",
      min_amount: null,
      max_amount: null,
      counterparty: "Amazon",
      action: "suggest_category",
      target_category: "Hosting Cloud Infrastructure",
      target_vendor_id: 1,
      payment_method: "card",
      audit_reason: null,
      creator: "admin@hrflow.test",
      approved_by: null,
      is_approved: false,
      last_used_at: "2026-09-02T10:00:00",
      times_applied: 4,
      created_at: "2026-08-01T10:00:00",
      updated_at: "2026-08-01T10:00:00"
    },
    {
      id: 2,
      name: "Bank Monthly Maintenance Fees",
      description: "Auto-ignore routine monthly checking account service charges",
      priority: 5,
      is_active: true,
      mode: "auto_apply",
      account_id: null,
      description_pattern: "SERVICE FEE|MAINTENANCE",
      direction: "out",
      min_amount: 1.0,
      max_amount: 50.0,
      counterparty: "Chase",
      action: "auto_ignore",
      target_category: "Bank Charges",
      target_vendor_id: null,
      payment_method: "bank_transfer",
      audit_reason: "Standard recurring bank maintenance charge covered by corporate policy",
      creator: "admin@hrflow.test",
      approved_by: "controller@voyancehealth.com",
      is_approved: true,
      last_used_at: "2026-09-01T09:00:00",
      times_applied: 2,
      created_at: "2026-08-10T10:00:00",
      updated_at: "2026-08-10T10:00:00"
    }
  ];
  }

  const FinanceStatementsApi = {
// Bank Statement Imports & Reconciliation (Phase 7)
  // ==========================================
  async previewStatement(accountId, formData) {
    if (_isMock()) {
      const periodMonth = (formData.get ? formData.get("period_month") : null) || "2026-09";
      const fileObj = formData.get ? formData.get("file") : null;
      const fileName = fileObj && fileObj.name ? fileObj.name : "statement.csv";
      const ext = fileName.split(".").pop().toLowerCase();
      const detectedFormat = ext === "pdf" ? "pdf" : "csv";

      const openBal = formData.get && formData.get("opening_balance") ? parseFloat(formData.get("opening_balance")) : 5000.0;
      const closeBal = formData.get && formData.get("closing_balance") ? parseFloat(formData.get("closing_balance")) : 6700.0;

      // Mock file fingerprint
      const fileFp = `sha256-mock-${fileName}-${fileObj ? fileObj.size : 1024}`;
      const existing = (FinanceMockState.statementImports || []).find(
        (i) => i.account_id === parseInt(accountId, 10) && i.file_fingerprint === fileFp
      );

      const rows = [
        {
          row_index: 2,
          raw_date: `${periodMonth}-02`,
          raw_amount: 500.0,
          direction: "out",
          raw_description: "AWS CLOUD INFRASTRUCTURE INVOICE",
          raw_reference: "REF-001",
          line_fingerprint: "fp-line-1",
          is_duplicate: false,
          is_valid: true,
          error_message: null,
        },
        {
          row_index: 3,
          raw_date: `${periodMonth}-08`,
          raw_amount: 2200.0,
          direction: "in",
          raw_description: "HEALTHCARE SERVICES WIRE INWARD",
          raw_reference: "REF-002",
          line_fingerprint: "fp-line-2",
          is_duplicate: false,
          is_valid: true,
          error_message: null,
        },
      ];

      const totalDebit = 500.0;
      const totalCredit = 2200.0;
      const calculatedNet = round(totalCredit - totalDebit, 2); // +1700
      const expectedClosing = openBal !== null ? round(openBal + calculatedNet, 2) : null;
      const delta = closeBal !== null && expectedClosing !== null ? round(closeBal - expectedClosing, 2) : 0.0;
      const matches = Math.abs(delta) < 0.01;

      return {
        file_fingerprint: fileFp,
        duplicate_file_detected: Boolean(existing),
        duplicate_import_id: existing ? existing.id : null,
        detected_format: detectedFormat,
        detected_headers: ["Date", "Description", "Debit", "Credit", "Reference"],
        suggested_mapping: {
          date_col: "Date",
          description_col: "Description",
          debit_col: "Debit",
          credit_col: "Credit",
          amount_col: null,
          reference_col: "Reference",
        },
        preview_rows: rows,
        validation_summary: {
          total_rows: 2,
          valid_count: 2,
          error_count: 0,
          warning_count: 0,
          duplicate_lines_count: 0,
          opening_balance: openBal,
          closing_balance: closeBal,
          total_debit: totalDebit,
          total_credit: totalCredit,
          calculated_net: calculatedNet,
          expected_closing_balance: expectedClosing,
          balance_delta: delta,
          balance_matches: matches,
        },
        errors: [],
        is_review_required: detectedFormat === "pdf",
      };
    }

    let res;
    try {
      res = await fetch(`${API_BASE_URL}/api/finance/accounts/${accountId}/statements/preview`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
    } catch (networkErr) {
      throw new Error("Network error - is the backend server running?");
    }
    if (res.status === 401) {
      if (typeof forceSessionExpiredLogout === "function") forceSessionExpiredLogout();
      throw new Error("Session expired. Please sign in again.");
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Preview failed with status ${res.status}`);
    }
    return res.json();
  },

  async getStatementTemplates(accountId) {
    if (_isMock()) {
      let list = [...(FinanceMockState.statementTemplates || [])];
      if (accountId) {
        list = list.filter((t) => !t.account_id || t.account_id === parseInt(accountId, 10));
      }
      return list;
    }
    const q = account_id ? `?account_id=${accountId}` : "";
    return apiRequest("GET", `/api/finance/statements/templates${q}`);
  },

  async saveStatementTemplate(payload) {
    if (_isMock()) {
      if (!FinanceMockState.statementTemplates) FinanceMockState.statementTemplates = [];
      const newTmpl = {
        id: FinanceMockState.statementTemplates.length + 1,
        ...payload,
        created_at: new Date().toISOString(),
      };
      FinanceMockState.statementTemplates.push(newTmpl);
      return newTmpl;
    }
    return apiRequest("POST", "/api/finance/statements/templates", payload);
  },

  async deleteStatementTemplate(templateId) {
    if (_isMock()) {
      FinanceMockState.statementTemplates = (FinanceMockState.statementTemplates || []).filter(
        (t) => t.id !== parseInt(templateId, 10)
      );
      return { status: "deleted" };
    }
    return apiRequest("DELETE", `/api/finance/statements/templates/${templateId}`);
  },

  async discardStatement(statementId) {
    if (_isMock()) {
      FinanceMockState.statementImports = (FinanceMockState.statementImports || []).filter(
        (i) => i.id !== parseInt(statementId, 10)
      );
      FinanceMockState.statementLines = (FinanceMockState.statementLines || []).filter(
        (l) => l.import_id !== parseInt(statementId, 10)
      );
      return { status: "discarded", id: statementId };
    }
    return apiRequest("DELETE", `/api/finance/statements/${statementId}`);
  },
  async listAccountStatements(accountId, periodMonth) {
    if (_isMock()) {
      let list = [...(FinanceMockState.statementImports || [])];
      if (accountId) list = list.filter((i) => i.account_id === parseInt(accountId, 10));
      if (periodMonth) list = list.filter((i) => i.period_month === periodMonth);
      return list;
    }
    const params = [];
    if (periodMonth) params.push(`period_month=${encodeURIComponent(periodMonth)}`);
    const qs = params.length ? `?${params.join("&")}` : "";
    return apiRequest("GET", `/api/finance/accounts/${accountId}/statements${qs}`);
  },

  async uploadStatement(accountId, formData) {
    if (_isMock()) {
      const periodMonth = formData.get ? formData.get("period_month") : "2026-09";
      const fileObj = formData.get ? formData.get("file") : null;
      const fileName = fileObj && fileObj.name ? fileObj.name : "statement.csv";
      const ext = fileName.split(".").pop().toLowerCase();
      const fileType = ext === "pdf" ? "pdf" : "csv";

      const acc = (FinanceMockState.accounts || []).find((a) => a.id === parseInt(accountId, 10));
      const newImport = {
        id: (FinanceMockState.statementImports || []).length + 1,
        account_id: parseInt(accountId, 10),
        account_name: acc ? acc.account_name : "Bank Account",
        period_month: periodMonth,
        file_type: fileType,
        status: "needs_review",
        uploaded_file_ref: `uploads/finance_attachments/${fileName}`,
        total_lines_count: 2,
        matched_lines_count: 0,
        reconciled_at: null,
        reconciled_by: null,
        created_at: new Date().toISOString(),
        created_by: "admin@hrflow.test",
        attachments: [{ id: Date.now(), file_name: fileName, file_size: 2048, storage_ref: `uploads/${fileName}` }]
      };

      if (!FinanceMockState.statementImports) FinanceMockState.statementImports = [];
      FinanceMockState.statementImports.unshift(newImport);

      // Create mock lines for the uploaded statement
      const newLines = [
        {
          id: (FinanceMockState.statementLines || []).length + 1,
          import_id: newImport.id,
          raw_date: `${periodMonth}-05`,
          raw_amount: 1500.0,
          direction: "out",
          raw_description: "DIRECT DISBURSEMENT WIRE",
          raw_reference: "WIRE-990",
          status: "unmatched",
          notes: "",
          matched_transaction_id: null,
          matched_cheque_id: null,
          suggested_matches: []
        },
        {
          id: (FinanceMockState.statementLines || []).length + 2,
          import_id: newImport.id,
          raw_date: `${periodMonth}-10`,
          raw_amount: 3200.0,
          direction: "in",
          raw_description: "CLIENT SETTLEMENT DIRECT DEPOSIT",
          raw_reference: "DEP-112",
          status: "unmatched",
          notes: "",
          matched_transaction_id: null,
          matched_cheque_id: null,
          suggested_matches: []
        }
      ];
      if (!FinanceMockState.statementLines) FinanceMockState.statementLines = [];
      FinanceMockState.statementLines.push(...newLines);

      return newImport;
    }

    let res;
    try {
      res = await fetch(`${API_BASE_URL}/api/finance/accounts/${accountId}/statements`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
    } catch (networkErr) {
      throw new Error("Network error - is the backend server running?");
    }
    if (res.status === 401) {
      if (typeof forceSessionExpiredLogout === "function") forceSessionExpiredLogout();
      throw new Error("Session expired. Please sign in again.");
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `Upload failed with status ${res.status}`);
    }
    return res.json();
  },

  async getStatement(statementId) {
    if (_isMock()) {
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10));
      if (!imp) throw new Error("Statement import not found");
      return imp;
    }
    return apiRequest("GET", `/api/finance/statements/${statementId}`);
  },

  async getStatementLines(statementId) {
    if (_isMock()) {
      return (FinanceMockState.statementLines || []).filter((l) => l.import_id === parseInt(statementId, 10));
    }
    return apiRequest("GET", `/api/finance/statements/${statementId}/lines`);
  },

  async getStatementSummary(statementId) {
    if (_isMock()) {
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10));
      const allLines = (FinanceMockState.statementLines || []).filter((l) => l.import_id === parseInt(statementId, 10));
      const activeLines = allLines.filter((l) => l.status !== "split");
      const resolvedLines = activeLines.filter((l) => ["matched", "created", "ignored"].includes(l.status));
      const unmatchedLines = activeLines.filter((l) => l.status === "unmatched");

      const resolvedAmount = resolvedLines.reduce((s, l) => s + (l.raw_amount || 0), 0);
      const unresolvedAmount = unmatchedLines.reduce((s, l) => s + (l.raw_amount || 0), 0);

      const acc = (FinanceMockState.accounts || []).find((a) => a.id === (imp ? imp.account_id : null));
      const bookBalance = acc ? acc.current_balance : 0;
      const diff = imp && imp.closing_balance !== undefined ? imp.closing_balance - bookBalance : null;

      return {
        statement_id: parseInt(statementId, 10),
        account_id: imp ? imp.account_id : 1,
        account_name: imp ? imp.account_name || "Primary Checking" : "Primary Checking",
        currency: acc ? acc.currency || "USD" : "USD",
        period_month: imp ? imp.period_month : "2026-09",
        statement_opening_balance: imp ? imp.opening_balance : 10000.0,
        statement_closing_balance: imp ? imp.closing_balance : 10350.0,
        book_balance: bookBalance,
        difference: diff,
        total_lines_count: activeLines.length,
        resolved_lines_count: resolvedLines.length,
        unmatched_lines_count: unmatchedLines.length,
        resolved_amount: resolvedAmount,
        unresolved_amount: unresolvedAmount,
        status: imp ? imp.status : "needs_review",
      };
    }
    return apiRequest("GET", `/api/finance/statements/${statementId}/summary`);
  },

  async resolveStatementLine(statementId, lineId, payload) {
    if (_isMock()) {
      const line = (FinanceMockState.statementLines || []).find((l) => l.id === parseInt(lineId, 10));
      if (!line) throw new Error("Statement line not found");

      if (payload.action === "match") {
        if (payload.matched_transaction_id) {
          const already = (FinanceMockState.statementLines || []).find(
            (l) => l.id !== line.id && l.matched_transaction_id === payload.matched_transaction_id && ["matched", "created"].includes(l.status)
          );
          if (already) throw new Error(`Ledger Transaction #${payload.matched_transaction_id} is already matched to line #${already.id}`);
        }
        line.status = "matched";
        line.matched_transaction_id = payload.matched_transaction_id || null;
        line.matched_cheque_id = payload.matched_cheque_id || null;
        if (payload.matched_cheque_id) {
          const chq = (FinanceMockState.cheques || []).find((c) => c.id === parseInt(payload.matched_cheque_id, 10));
          if (chq) {
            chq.status = "cleared";
            chq.clear_date = line.raw_date;
          }
        }
      } else if (payload.action === "create") {
        line.status = "created";
        line.matched_transaction_id = Date.now();
      } else if (payload.action === "ignore") {
        if (!payload.notes || !payload.notes.trim()) {
          throw new Error("A documented reason is mandatory to ignore a statement line.");
        }
        line.status = "ignored";
        line.notes = payload.notes.trim();
      } else if (payload.action === "split") {
        if (!payload.splits || payload.splits.length < 2) {
          throw new Error("Split action requires at least two split portions.");
        }
        const totalSplit = payload.splits.reduce((s, p) => s + (p.amount || 0), 0);
        if (Math.abs(totalSplit - line.raw_amount) > 0.01) {
          throw new Error(`Split portions total (${totalSplit}) must equal line amount (${line.raw_amount}) within currency precision.`);
        }
        line.status = "split";
        line.child_lines = payload.splits.map((p, idx) => ({
          id: Date.now() + idx,
          import_id: line.import_id,
          parent_line_id: line.id,
          raw_date: line.raw_date,
          raw_amount: p.amount,
          direction: line.direction,
          raw_description: p.description || `${line.raw_description} (Split ${idx + 1})`,
          raw_reference: p.reference || line.raw_reference,
          status: "matched",
          notes: `Split ${idx + 1} from line #${line.id}`,
        }));
        (FinanceMockState.statementLines || []).push(...line.child_lines);
      }
      if (payload.notes && payload.action !== "ignore") line.notes = payload.notes;

      // Update import matched count
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10));
      if (imp) {
        const resolvedCount = (FinanceMockState.statementLines || []).filter(
          (l) => l.import_id === imp.id && ["matched", "created", "ignored", "split"].includes(l.status)
        ).length;
        imp.matched_lines_count = resolvedCount;
      }
      return line;
    }
    return apiRequest("POST", `/api/finance/statements/${statementId}/lines/${lineId}/resolve`, payload);
  },

  async reconcileStatement(statementId) {
    if (_isMock()) {
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10));
      if (!imp) throw new Error("Statement import not found");
      imp.status = "reconciled";
      imp.reconciled_at = new Date().toISOString();
      imp.reconciled_by = "admin@hrflow.test";
      return imp;
    }
    return apiRequest("POST", `/api/finance/statements/${statementId}/reconcile`);
  },

  async closeStatementPeriod(statementId, payload = {}) {
    if (_isMock()) {
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10));
      if (!imp) throw new Error("Statement import not found");
      const acc = (FinanceMockState.accounts || []).find((a) => a.id === imp.account_id);
      const bookBalance = acc ? acc.current_balance : 0;
      const diff = Math.round(((imp.closing_balance || 0) - bookBalance) * 100) / 100;
      const allLines = (FinanceMockState.statementLines || []).filter((l) => l.import_id === parseInt(statementId, 10));
      const unresolved = allLines.filter((l) => l.status === "unmatched");

      if ((Math.abs(diff) > 0.01 || unresolved.length > 0) && (!payload.is_exception_override || !payload.exception_override_reason?.trim())) {
        throw new Error(`Cannot close period: balance difference ($${diff.toFixed(2)}) is non-zero or ${unresolved.length} line(s) remain unresolved. A documented exception override reason is required.`);
      }

      imp.status = "closed";
      imp.closed_at = new Date().toISOString();
      imp.closed_by = "admin@hrflow.test";
      imp.closing_notes = payload.closing_notes || "";
      imp.is_exception_override = !!payload.is_exception_override;
      imp.exception_override_reason = payload.exception_override_reason || null;
      return imp;
    }
    return apiRequest("POST", `/api/finance/statements/${statementId}/close`, payload);
  },

  async reopenStatementPeriod(statementId, payload = {}) {
    if (_isMock()) {
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10));
      if (!imp) throw new Error("Statement import not found");
      if (!payload.reopen_reason?.trim()) {
        throw new Error("A documented reason is mandatory to reopen a closed reconciliation period.");
      }
      imp.status = "reopened";
      imp.reopened_at = new Date().toISOString();
      imp.reopened_by = "admin@hrflow.test";
      imp.reopen_reason = payload.reopen_reason.trim();
      return imp;
    }
    return apiRequest("POST", `/api/finance/statements/${statementId}/reopen`, payload);
  },

  async getStatementCompletionReport(statementId) {
    if (_isMock()) {
      const imp = (FinanceMockState.statementImports || []).find((i) => i.id === parseInt(statementId, 10)) || {};
      const acc = (FinanceMockState.accounts || []).find((a) => a.id === imp.account_id);
      const bookBalance = acc ? acc.current_balance : 0;
      const closing = imp.closing_balance || 0;
      const diff = Math.round((closing - bookBalance) * 100) / 100;
      const allLines = (FinanceMockState.statementLines || []).filter((l) => l.import_id === parseInt(statementId, 10));
      const matched = allLines.filter((l) => l.status === "matched");
      const created = allLines.filter((l) => l.status === "created");
      const ignored = allLines.filter((l) => l.status === "ignored");

      return {
        statement_id: parseInt(statementId, 10),
        account_id: imp.account_id || 1,
        account_name: imp.account_name || "Primary Checking",
        period_month: imp.period_month || "2026-09",
        currency: acc ? acc.currency || "USD" : "USD",
        status: imp.status || "closed",
        opening_balance: imp.opening_balance || 0,
        closing_balance: closing,
        book_balance: bookBalance,
        balance_difference: diff,
        is_balanced: Math.abs(diff) <= 0.01,
        total_lines_count: allLines.filter((l) => l.status !== "split").length,
        matched_lines_count: matched.length,
        matched_lines_amount: matched.reduce((s, l) => s + (l.raw_amount || 0), 0),
        created_entries_count: created.length,
        created_entries_amount: created.reduce((s, l) => s + (l.raw_amount || 0), 0),
        ignored_lines_count: ignored.length,
        ignored_lines_amount: ignored.reduce((s, l) => s + (l.raw_amount || 0), 0),
        ignored_lines_details: ignored.map((l) => ({
          line_id: l.id,
          date: l.raw_date,
          amount: l.raw_amount,
          description: l.raw_description,
          audit_reason: l.notes || "",
        })),
        split_lines_count: allLines.filter((l) => l.status === "split").length,
        uncleared_ledger_transactions_count: 0,
        uncleared_ledger_transactions_amount: 0.0,
        uncleared_cheques_count: 0,
        uncleared_cheques_amount: 0.0,
        closed_at: imp.closed_at || null,
        closed_by: imp.closed_by || null,
        reopened_at: imp.reopened_at || null,
        reopened_by: imp.reopened_by || null,
        reopen_reason: imp.reopen_reason || null,
        is_exception_override: !!imp.is_exception_override,
        exception_override_reason: imp.exception_override_reason || null,
        closing_notes: imp.closing_notes || null,
        generated_at: new Date().toISOString(),
      };
    }
    return apiRequest("GET", `/api/finance/statements/${statementId}/completion-report`);
  },

  // ==========================================
  // Story 6.3: Reconciliation Rules
  // ==========================================
  async getReconciliationRules(params = {}) {
    if (_isMock()) {
      let rules = [...(FinanceMockState.reconciliationRules || [])];
      if (params.is_active !== undefined && params.is_active !== null) {
        const act = String(params.is_active) === "true";
        rules = rules.filter((r) => r.is_active === act);
      }
      if (params.account_id) {
        rules = rules.filter((r) => !r.account_id || r.account_id === parseInt(params.account_id, 10));
      }
      if (params.mode) {
        rules = rules.filter((r) => r.mode === params.mode);
      }
      return rules.sort((a, b) => a.priority - b.priority || a.id - b.id);
    }
    const q = new URLSearchParams(params).toString();
    return apiRequest("GET", `/api/finance/rules${q ? `?${q}` : ""}`);
  },

  async createReconciliationRule(payload) {
    if (_isMock()) {
      const newRule = {
        id: Date.now(),
        name: payload.name,
        description: payload.description || "",
        priority: parseInt(payload.priority || 10, 10),
        is_active: payload.is_active !== false,
        mode: payload.mode || "suggestion",
        account_id: payload.account_id || null,
        description_pattern: payload.description_pattern || null,
        direction: payload.direction || null,
        min_amount: payload.min_amount ? parseFloat(payload.min_amount) : null,
        max_amount: payload.max_amount ? parseFloat(payload.max_amount) : null,
        counterparty: payload.counterparty || null,
        action: payload.action || "suggest_category",
        target_category: payload.target_category || null,
        target_vendor_id: payload.target_vendor_id || null,
        payment_method: payload.payment_method || "bank_transfer",
        audit_reason: payload.audit_reason || null,
        creator: "admin@hrflow.test",
        approved_by: payload.is_approved ? "controller@voyancehealth.com" : null,
        is_approved: Boolean(payload.is_approved),
        last_used_at: null,
        times_applied: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      (FinanceMockState.reconciliationRules = FinanceMockState.reconciliationRules || []).push(newRule);
      return newRule;
    }
    return apiRequest("POST", "/api/finance/rules", payload);
  },

  async updateReconciliationRule(ruleId, payload) {
    if (_isMock()) {
      const rule = (FinanceMockState.reconciliationRules || []).find((r) => r.id === parseInt(ruleId, 10));
      if (!rule) throw new Error("Reconciliation rule not found");
      Object.assign(rule, payload, { updated_at: new Date().toISOString() });
      return rule;
    }
    return apiRequest("PUT", `/api/finance/rules/${ruleId}`, payload);
  },

  async deleteReconciliationRule(ruleId) {
    if (_isMock()) {
      const idx = (FinanceMockState.reconciliationRules || []).findIndex((r) => r.id === parseInt(ruleId, 10));
      if (idx >= 0) FinanceMockState.reconciliationRules.splice(idx, 1);
      return { status: "success", message: `Rule #${ruleId} deleted` };
    }
    return apiRequest("DELETE", `/api/finance/rules/${ruleId}`);
  },

  async previewReconciliationRule(payload) {
    if (_isMock()) {
      const ruleCandidate = payload.rule;
      const unmatchedLines = (FinanceMockState.statementLines || []).filter((l) => l.status === "unmatched");
      const matched = unmatchedLines.filter((l) => {
        if (ruleCandidate.direction && l.direction !== ruleCandidate.direction) return false;
        if (ruleCandidate.min_amount && l.raw_amount < ruleCandidate.min_amount) return false;
        if (ruleCandidate.max_amount && l.raw_amount > ruleCandidate.max_amount) return false;
        if (ruleCandidate.description_pattern) {
          const pat = new RegExp(ruleCandidate.description_pattern, "i");
          if (!pat.test(l.raw_description || "") && !pat.test(l.raw_reference || "")) return false;
        }
        return true;
      });

      const conflicts = [];
      const activeRules = (FinanceMockState.reconciliationRules || []).filter((r) => r.is_active);
      matched.forEach((m) => {
        activeRules.forEach((ar) => {
          if (ar.id === ruleCandidate.id) return;
          const pat = new RegExp(ar.description_pattern || ".*", "i");
          if (pat.test(m.raw_description || "") || pat.test(m.raw_reference || "")) {
            conflicts.push({
              winning_rule_id: ruleCandidate.priority <= ar.priority ? 0 : ar.id,
              winning_rule_name: ruleCandidate.priority <= ar.priority ? ruleCandidate.name : ar.name,
              conflicting_rule_id: ruleCandidate.priority <= ar.priority ? ar.id : 0,
              conflicting_rule_name: ruleCandidate.priority <= ar.priority ? ar.name : ruleCandidate.name,
              line_id: m.id,
              conflict_reason: `Both rules match statement line #${m.id}. Higher priority (${Math.min(ruleCandidate.priority, ar.priority)}) wins.`,
            });
          }
        });
      });

      return {
        matched_lines_count: matched.length,
        sample_matched_lines: matched.slice(0, 5),
        conflicts: conflicts,
        mode: ruleCandidate.mode || "suggestion",
        is_approved: Boolean(ruleCandidate.is_approved),
        summary: `Matches ${matched.length} unmatched line(s) with ${conflicts.length} conflict(s) detected.`,
      };
    }
    return apiRequest("POST", "/api/finance/rules/preview", payload);
  },

  async applyRulesToStatement(statementId, dryRun = false) {
    if (_isMock()) {
      const activeRules = (FinanceMockState.reconciliationRules || []).filter((r) => r.is_active);
      const lines = (FinanceMockState.statementLines || []).filter(
        (l) => l.import_id === parseInt(statementId, 10) && l.status === "unmatched"
      );

      let suggestionsCount = 0;
      let autoAppliedCount = 0;
      const updatedLines = [];

      lines.forEach((line) => {
        for (const rule of activeRules) {
          if (rule.direction && line.direction !== rule.direction) continue;
          if (rule.min_amount && line.raw_amount < rule.min_amount) continue;
          if (rule.max_amount && line.raw_amount > rule.max_amount) continue;
          if (rule.description_pattern) {
            const pat = new RegExp(rule.description_pattern, "i");
            if (!pat.test(line.raw_description || "") && !pat.test(line.raw_reference || "")) continue;
          }

          // Matched winning rule
          if (dryRun) break;

          if (rule.mode === "suggestion") {
            line.notes = `[Rule: ${rule.name}] Suggests: ${rule.action} (${rule.target_category || ''})`;
            line.applied_rule_id = rule.id;
            line.is_auto_applied = false;
            suggestionsCount++;
            updatedLines.push(line);
          } else if (rule.mode === "auto_apply" && rule.is_approved) {
            if (rule.action === "auto_ignore") {
              line.status = "ignored";
              line.notes = rule.audit_reason || `Auto-ignored by rule ${rule.name}`;
              line.applied_rule_id = rule.id;
              line.is_auto_applied = true;
              autoAppliedCount++;
              updatedLines.push(line);
            } else if (rule.action === "auto_create") {
              line.status = "created";
              line.matched_transaction_id = Date.now();
              line.applied_rule_id = rule.id;
              line.is_auto_applied = true;
              autoAppliedCount++;
              updatedLines.push(line);
            }
            rule.times_applied = (rule.times_applied || 0) + 1;
            rule.last_used_at = new Date().toISOString();
          }
          break;
        }
      });

      return {
        statement_id: parseInt(statementId, 10),
        evaluated_lines_count: lines.length,
        suggestions_count: suggestionsCount,
        auto_applied_count: autoAppliedCount,
        conflicts: [],
        updated_lines: updatedLines,
      };
    }
    return apiRequest("POST", `/api/finance/statements/${statementId}/apply-rules?dry_run=${dryRun ? "true" : "false"}`);
  },

  async revertRule(ruleId) {
    if (_isMock()) {
      const id = parseInt(ruleId, 10);
      const lines = (FinanceMockState.statementLines || []).filter(
        (l) => l.applied_rule_id === id && l.is_auto_applied
      );
      lines.forEach((l) => {
        l.status = "unmatched";
        l.matched_transaction_id = null;
        l.applied_rule_id = null;
        l.is_auto_applied = false;
      });
      const rule = (FinanceMockState.reconciliationRules || []).find((r) => r.id === id);
      if (rule) rule.times_applied = Math.max(0, (rule.times_applied || 0) - lines.length);

      return {
        rule_id: id,
        reverted_lines_count: lines.length,
        status: "success",
        message: `Reverted ${lines.length} auto-applied line(s).`,
      };
    }
    return apiRequest("POST", `/api/finance/rules/${ruleId}/revert`);
  },


  // ==========================================
  };

  root.FinanceStatementsApi = FinanceStatementsApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceStatementsApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceStatementsApi;
  }
})(typeof window !== "undefined" ? window : globalThis);
