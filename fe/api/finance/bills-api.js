/**
 * fe/api/finance/bills-api.js
 * Finance API - Bills & Payables domain client and mock handlers.
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

  // Vendor Bill Workflow v2 (D-016): mirrors be/finance/bill_status.py
  const BILL_STATUSES = ["draft", "pending_approval", "rejected", "approved", "scheduled", "partially_paid", "paid", "void"];
  const BILL_OPEN_STATUSES = ["approved", "scheduled", "partially_paid"];
  const BILL_TRANSITIONS = {
    submit: { draft: "pending_approval", rejected: "pending_approval" },
    send_back: { approved: "pending_approval", scheduled: "pending_approval" },
    withdraw: { pending_approval: "draft" },
    approve: { pending_approval: "approved" },
    reject: { pending_approval: "rejected" },
    schedule: { approved: "scheduled" },
    unschedule: { scheduled: "approved" },
    pay: { approved: "partially_paid", scheduled: "partially_paid", partially_paid: "partially_paid" },
    reverse_payment: { paid: "approved", partially_paid: "approved" },
    void: { draft: "void", pending_approval: "void", rejected: "void", approved: "void", scheduled: "void" },
  };
  const _billAllowedActions = (status) => Object.keys(BILL_TRANSITIONS).filter((a) => BILL_TRANSITIONS[a][status]);
  const _can = (key) => typeof SessionInfo === "undefined" || typeof SessionInfo.hasPermission !== "function" || SessionInfo.hasPermission(key);
  const _forbid = (key) => {
    const err = new Error(`Permission denied: '${key}' required`);
    err.status = 403;
    return err;
  };
  const SERVER_OWNED = ["status", "approval_status", "approved_by", "approved_at", "approval_comment", "requires_approval", "created_by", "amount_paid", "is_reviewed", "scheduled_payment_date"];
  const _refuseServerOwned = (payload) => {
    const sent = SERVER_OWNED.filter((k) => k in payload);
    if (sent.length) {
      const err = new Error(`${sent.join(", ")} cannot be set by the client; set by the server through bill actions`);
      err.status = 422;
      throw err;
    }
  };
  // Mirrors be/finance/bill_payment_rules.py and settlement_service.settle_bill (D-018)
  const BILL_PAYMENT_TYPES = { cash: ["CASH"], bank: ["OUTBOUND_TRANS", "CHK", "DEBIT_CARD"] };
  const BILL_PAYMENT_METHOD = { CASH: "cash", OUTBOUND_TRANS: "bank_transfer", CHK: "cheque", DEBIT_CARD: "card" };
  const _paymentError = (code, message) => {
    const err = new Error(message);
    err.status = 400;
    err.detail = { code, message };
    return err;
  };
  const _checkBillPayment = (bill, payload, paidSoFar) => {
    const account = (FinanceMockState.accounts || []).find((a) => a.id === parseInt(payload.bank_account_id, 10));
    if (!account) throw new Error(`Bank account ${payload.bank_account_id} not found`);
    const pt = (FinanceMockState.paymentTypes || []).find((t) => t.id === parseInt(payload.payment_type_id, 10));
    const allowed = BILL_PAYMENT_TYPES[(account.account_type || "bank").toLowerCase()] || [];
    if (!pt || !pt.is_active || !allowed.includes(pt.code)) {
      throw _paymentError("payment_type_not_allowed", `Payment type '${pt ? pt.name : payload.payment_type_id}' cannot be used to pay a bill from a ${account.account_type} account.`);
    }
    if (pt.code === "CHK" && !String(payload.cheque_number || "").trim()) {
      throw _paymentError("cheque_number_required", "A cheque number is required for a cheque payment.");
    }
    if (String(account.currency || "").toUpperCase() !== String(bill.currency || "").toUpperCase()) {
      throw _paymentError("currency_mismatch", `Account currency (${account.currency}) differs from the bill currency (${bill.currency}). Transfer funds into a ${bill.currency} account first.`);
    }
    const pAmt = parseFloat(payload.amount);
    const remaining = round(bill.total - paidSoFar, 2);
    if (pAmt > remaining + 0.01) {
      throw new Error(`Payment amount ($${pAmt.toFixed(2)}) exceeds remaining balance ($${remaining.toFixed(2)}).`);
    }
    if (round(account.current_balance || 0, 4) + 0.0001 < pAmt) {
      throw _paymentError("insufficient_balance", `Account '${account.account_name}' balance (${Number(account.current_balance).toFixed(2)} ${account.currency}) is below the payment (${pAmt.toFixed(2)}).`);
    }
    return { account, pt, pAmt };
  };
  const _missingToLeaveDraft = (b) => {
    const errors = [];
    const need = (field, value, msg) => { if (value === null || value === undefined || String(value).trim() === "") errors.push({ loc: ["body", field], msg, type: "missing_field" }); };
    need("vendor_id", b.vendor_id, "Vendor is required");
    need("bill_number", b.bill_number, "Bill number is required");
    need("issue_date", b.issue_date, "Issue date is required");
    need("due_date", b.due_date, "Due date is required");
    if (!b.category_id && !String(b.category || "").trim()) errors.push({ loc: ["body", "category"], msg: "Category is required", type: "missing_field" });
    return errors;
  };
  const _validationError = (errors) => {
    const err = new Error(errors.map((e) => e.msg).join("; "));
    err.status = 422;
    err.detail = errors;
    return err;
  };
  const _withFlags = (b) => ({ ...b, is_overdue: _billIsOverdue(b), allowed_actions: _billAllowedActions(b.status) });
  const _billNext = (action, bill) => {
    const target = (BILL_TRANSITIONS[action] || {})[bill.status];
    if (!target) {
      const err = new Error(`Cannot ${action.replace("_", " ")} a bill in '${bill.status}' status`);
      err.status = 409;
      err.detail = { code: "invalid_transition", message: err.message, action, current_status: bill.status, allowed_actions: _billAllowedActions(bill.status) };
      throw err;
    }
    return target;
  };
  const _billIsOverdue = (b) => {
    if (!BILL_OPEN_STATUSES.includes(b.status) || !b.due_date) return false;
    return b.due_date < new Date().toISOString().slice(0, 10);
  };
  const _billDerivePaymentStatus = (bill) => {
    if (["draft", "pending_approval", "rejected", "void"].includes(bill.status)) return bill.status;
    const paid = round(bill.amount_paid || 0, 2);
    if (paid > 0.001) return paid >= bill.total - 0.01 ? "paid" : "partially_paid";
    return bill.scheduled_payment_date ? "scheduled" : "approved";
  };
  root.FinanceBillStatus = { BILL_STATUSES, BILL_OPEN_STATUSES, BILL_TRANSITIONS, derivePaymentStatus: _billDerivePaymentStatus };

  if (!FinanceMockState.vendors) {
    FinanceMockState.vendors = [
    { id: 1, name: "Amazon Web Services", legal_name: "Amazon Web Services Inc", category: "Infrastructure", default_category_id: 8, contact_name: "AWS Accounts Team", contact_email: "aws-receivables@amazon.com", contact_phone: "+1 800-555-0199", tax_id: "VAT-1294819", remit_address: "410 Terry Ave N, Seattle WA", country: "United States", payment_terms_days: 30, default_currency: "USD", default_department: "Engineering", tax_treatment: "standard", onboarding_status: "active", notes: "Hosting & compute", is_active: true },
    { id: 2, name: "Slack Technologies", legal_name: "Slack Technologies LLC", category: "SaaS", default_category_id: 9, contact_name: "Sales Billing", contact_email: "billing@slack.com", contact_phone: "+1 800-555-0188", tax_id: "VAT-9988112", remit_address: "500 Howard St, San Francisco CA", country: "United States", payment_terms_days: 15, default_currency: "USD", default_department: "Operations", tax_treatment: "standard", onboarding_status: "active", notes: "Team communication", is_active: true },
    { id: 3, name: "Google Workspace", legal_name: "Google LLC", category: "Software", default_category_id: null, contact_name: "Google Cloud Sales", contact_email: "billing@google.com", contact_phone: "+1 800-555-0100", tax_id: "VAT-5544332", remit_address: "1600 Amphitheatre Pkwy, Mountain View CA", country: "United States", payment_terms_days: 30, default_currency: "USD", default_department: "Engineering", tax_treatment: "standard", onboarding_status: "active", notes: "Productivity suite", is_active: true },
  ];
  }

  if (!FinanceMockState.vendorPaymentInstructions) {
    FinanceMockState.vendorPaymentInstructions = [
    { id: 1, vendor_id: 1, payment_method: "bank_transfer", bank_name: "JPMorgan Chase Bank", account_holder_name: "Amazon Web Services Inc", account_number: "98765432104821", routing_number: "021000021", swift_code: "CHASUS33", iban: "US99CHAS021000021987654321", verification_status: "verified", verified_by: "admin@hrflow.test", verified_at: "2026-09-01T10:00:00", is_active: true, effective_date: "2026-01-01", notes: "Direct ACH Wire Instructions" },
    { id: 2, vendor_id: 2, payment_method: "bank_transfer", bank_name: "Silicon Valley Bank", account_holder_name: "Slack Technologies LLC", account_number: "12345678901122", routing_number: "121140399", swift_code: "SVBKUS6S", iban: "US44SVBK121140399123456789", verification_status: "unverified", verified_by: null, verified_at: null, is_active: true, effective_date: "2026-01-01", notes: "Pending vendor bank verification" },
  ];
  }

  if (!FinanceMockState.bills) {
    FinanceMockState.bills = [
    { id: 1, vendor_id: 1, vendor_name: "Amazon Web Services", bill_number: "BILL-2026-001", category_id: 8, category: "Infrastructure", department: "Engineering", legal_entity: "Voyance Health Inc", issue_date: "2026-09-01", due_date: "2026-09-30", status: "approved", currency: "USD", subtotal: 4200.0, tax_amount: 0.0, total: 4200.0, amount_paid: 0.0, requires_approval: false, capture_source: "manual", extraction_confidence: 1.0, is_reviewed: true, notes: "September cloud hosting", created_at: "2026-09-01T08:00:00", created_by: "ap@voyance.health", lines: [{ id: 1, bill_id: 1, description: "EC2 + S3 usage", quantity: 1, unit_price: 4200.0, line_total: 4200.0 }] },
    { id: 2, vendor_id: 2, vendor_name: "Slack Technologies", bill_number: "BILL-2026-002", category_id: 9, category: "SaaS", department: "Operations", legal_entity: "Voyance Health Inc", issue_date: "2026-09-03", due_date: "2026-09-18", status: "paid", currency: "USD", subtotal: 320.0, tax_amount: 0.0, total: 320.0, amount_paid: 320.0, requires_approval: false, capture_source: "manual", extraction_confidence: 1.0, is_reviewed: true, notes: "Team plan renewal", created_at: "2026-09-03T09:00:00", created_by: "ap@voyance.health", lines: [{ id: 2, bill_id: 2, description: "Slack Business+ (40 seats)", quantity: 40, unit_price: 8.0, line_total: 320.0 }] },
    { id: 3, vendor_id: 1, vendor_name: "Amazon Web Services", bill_number: "BILL-2026-003", category_id: null, category: "", department: "", legal_entity: "Voyance Health Inc", issue_date: "2026-09-08", due_date: "2026-10-08", status: "draft", currency: "USD", subtotal: 1850.0, tax_amount: 0.0, total: 1850.0, amount_paid: 0.0, requires_approval: false, capture_source: "upload", extraction_confidence: 0.82, missing_fields: "category,department", is_reviewed: false, file_fingerprint: "sha256-aws-oct", attachment_name: "aws_september_invoice.pdf", attachment_url: "/api/finance/bills/3/attachment", notes: "Scanned PDF invoice awaiting coding", created_at: "2026-09-08T11:00:00", created_by: "ap@voyance.health", lines: [{ id: 3, bill_id: 3, description: "Database Aurora Serverless", quantity: 1, unit_price: 1850.0, line_total: 1850.0 }] },
    { id: 4, vendor_id: 2, vendor_name: "Slack Technologies", bill_number: "BILL-2026-004", category_id: 9, category: "SaaS", department: "Engineering", legal_entity: "Voyance Health Inc", issue_date: "2026-09-05", due_date: "2026-09-25", status: "draft", currency: "USD", subtotal: 750.0, tax_amount: 0.0, total: 750.0, amount_paid: 0.0, requires_approval: false, capture_source: "upload", extraction_confidence: 0.94, missing_fields: "cost_center", is_reviewed: false, notes: "Needs cost center assignment", created_at: "2026-09-05T09:30:00", created_by: "ap@voyance.health", lines: [{ id: 4, bill_id: 4, description: "Slack Enterprise Grid Add-on", quantity: 1, unit_price: 750.0, line_total: 750.0 }] },
    { id: 5, vendor_id: 1, vendor_name: "Amazon Web Services", bill_number: "BILL-2026-005", category_id: 8, category: "Infrastructure", department: "Engineering", legal_entity: "Voyance Health Inc", issue_date: "2026-09-09", due_date: "2026-10-09", status: "pending_approval", currency: "USD", subtotal: 8900.0, tax_amount: 0.0, total: 8900.0, amount_paid: 0.0, requires_approval: true, approval_status: "pending", capture_source: "manual", extraction_confidence: 1.0, is_reviewed: true, notes: "Requires VP approval for >$5k", created_at: "2026-09-09T14:00:00", created_by: "creator@voyance.health", lines: [{ id: 5, bill_id: 5, description: "Direct Connect 10G link", quantity: 1, unit_price: 8900.0, line_total: 8900.0 }] },
    { id: 6, vendor_id: 2, vendor_name: "Slack Technologies", bill_number: "BILL-2026-006", category_id: 9, category: "SaaS", department: "Operations", legal_entity: "Voyance Health Inc", issue_date: "2026-09-03", due_date: "2026-09-18", status: "rejected", currency: "USD", subtotal: 320.0, tax_amount: 0.0, total: 320.0, amount_paid: 0.0, requires_approval: false, capture_source: "upload", extraction_confidence: 0.70, file_fingerprint: "sha256-slack-dup-10", attachment_name: "slack_renewal_receipt.pdf", attachment_url: "/api/finance/bills/6/attachment", is_reviewed: false, approval_status: "rejected", approval_comment: "Duplicate of BILL-2026-002", notes: "Suspected duplicate of BILL-2026-002", created_at: "2026-09-03T10:00:00", created_by: "ap@voyance.health", lines: [{ id: 6, bill_id: 6, description: "Slack duplicate upload", quantity: 1, unit_price: 320.0, line_total: 320.0 }] },
    { id: 7, vendor_id: 1, vendor_name: "Amazon Web Services", bill_number: "BILL-2026-007", category_id: 8, category: "Infrastructure", department: "Engineering", legal_entity: "Voyance Health Inc", issue_date: "2026-09-20", due_date: "2026-11-20", status: "scheduled", scheduled_payment_date: "2026-11-15", currency: "USD", subtotal: 640.0, tax_amount: 0.0, total: 640.0, amount_paid: 0.0, approval_status: "approved", capture_source: "manual", extraction_confidence: 1.0, is_reviewed: true, notes: "Scheduled support plan", created_at: "2026-09-20T09:00:00", created_by: "ap@voyance.health", lines: [{ id: 7, bill_id: 7, description: "Support plan", quantity: 1, unit_price: 640.0, line_total: 640.0 }] },
    { id: 8, vendor_id: 2, vendor_name: "Slack Technologies", bill_number: "BILL-2026-008", category_id: 9, category: "SaaS", department: "Operations", legal_entity: "Voyance Health Inc", issue_date: "2026-09-02", due_date: "2026-09-30", status: "void", void_reason: "Duplicate", voided_by: "admin@voyance.health", currency: "USD", subtotal: 99.0, tax_amount: 0.0, total: 99.0, amount_paid: 0.0, capture_source: "manual", extraction_confidence: 1.0, is_reviewed: true, notes: "Cancelled add-on", created_at: "2026-09-02T09:00:00", created_by: "ap@voyance.health", lines: [{ id: 8, bill_id: 8, description: "Add-on", quantity: 1, unit_price: 99.0, line_total: 99.0 }] },
  ];
  }

  if (!FinanceMockState.billPayments) {
    FinanceMockState.billPayments = [
    { id: 1, related_bill_id: 2, amount: 320.0, currency: "USD", payment_date: "2026-09-04", bank_account_id: 1, method: "bank_transfer", reference: "ACH-SLACK-01", is_reversed: false, created_at: "2026-09-04T10:00:00" },
  ];
  }

  const FinanceBillsApi = {
// Vendor Bills
  async getBills(params) {
    if (_isMock()) {
      let list = FinanceMockState.bills.map((b) => _withFlags(b));
      if (params && params.queue) {
        const q = params.queue.toLowerCase().trim();
        if (BILL_STATUSES.includes(q)) list = list.filter((b) => b.status === q);
        else if (q === "all") list = list.filter((b) => b.status !== "void");
      } else if (params && params.status) {
        list = list.filter((b) => b.status === params.status);
      }
      if (params && String(params.overdue) === "true") list = list.filter((b) => b.is_overdue);
      if (params && params.vendor_id) list = list.filter((b) => b.vendor_id === parseInt(params.vendor_id, 10));
      if (params && params.has_attachment !== undefined && params.has_attachment !== null && params.has_attachment !== "") {
        const hasAtt = String(params.has_attachment).toLowerCase() === "true" || params.has_attachment === true;
        list = list.filter((b) => hasAtt ? !!(b.attachment_name || b.attachment_url) : !(b.attachment_name || b.attachment_url));
      }
      if (params && params.search) {
        const s = params.search.toLowerCase();
        list = list.filter((b) => (b.bill_number && b.bill_number.toLowerCase().includes(s)) || (b.vendor_name || "").toLowerCase().includes(s) || (b.department || "").toLowerCase().includes(s) || (b.category || "").toLowerCase().includes(s));
      }
      return list;
    }
    let url = "/api/finance/bills";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async getBillQueueCounts(params) {
    if (_isMock()) {
      let list = FinanceMockState.bills || [];
      if (params && params.vendor_id) list = list.filter((b) => b.vendor_id === parseInt(params.vendor_id, 10));
      const counts = { overdue: 0, all: 0 };
      BILL_STATUSES.forEach((st) => { counts[st] = 0; });
      for (const b of list) {
        const st = (b.status || "").toLowerCase();
        if (!(st in counts)) continue;
        counts[st]++;
        if (st === "void") continue;
        counts.all++;
        if (_billIsOverdue(b)) counts.overdue++;
      }
      return counts;
    }
    let url = "/api/finance/bills/queue-counts";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async checkDuplicateBills(payload) {
    if (_isMock()) {
      const candidates = [];
      const cleanNum = (v) => (!v ? "" : String(v).toLowerCase().replace(/[^a-z0-9]/g, ""));
      const normNum = cleanNum(payload.bill_number);
      const targetVend = payload.vendor_id ? parseInt(payload.vendor_id, 10) : null;
      const targetTotal = payload.total !== undefined && payload.total !== null ? parseFloat(payload.total) : null;

      for (const b of FinanceMockState.bills) {
        if (payload.exclude_id && b.id === parseInt(payload.exclude_id, 10)) continue;
        if (b.status === "void") continue;

        let matched_field = null;
        let matching_val = "";

        if (payload.file_fingerprint && b.file_fingerprint && payload.file_fingerprint === b.file_fingerprint) {
          matched_field = "file_fingerprint";
          matching_val = payload.file_fingerprint.slice(0, 16) + "...";
        } else if (targetVend && b.vendor_id === targetVend && normNum && normNum === cleanNum(b.bill_number)) {
          matched_field = "bill_number";
          matching_val = b.bill_number;
        } else if (targetVend && b.vendor_id === targetVend && targetTotal !== null && Math.abs((b.total || 0) - targetTotal) < 0.01 && payload.issue_date && b.issue_date === payload.issue_date) {
          matched_field = "amount_and_date";
          matching_val = `$${b.total.toFixed(2)} on ${b.issue_date}`;
        }

        if (matched_field) {
          candidates.push({
            id: b.id,
            bill_number: b.bill_number,
            vendor_id: b.vendor_id,
            vendor_name: b.vendor_name,
            issue_date: b.issue_date,
            total: b.total,
            status: b.status,
            matched_field,
            matching_value: matching_val,
            match_reason: matched_field === "bill_number" ? "Same bill number for vendor" : (matched_field === "file_fingerprint" ? "Exact file content match" : "Same vendor, total, and issue date"),
          });
        }
      }
      return { has_duplicate: candidates.length > 0, candidates };
    }
    return apiRequest("POST", "/api/finance/bills/check-duplicate", payload);
  },
  async getBill(id) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");
      return _withFlags(bill);
    }
    return apiRequest("GET", `/api/finance/bills/${id}`);
  },
  async getBillCategoryQualityReport() {
    if (_isMock()) {
      const unmatched = FinanceMockState.bills
        .filter((b) => !b.category_id || b.category === "Other")
        .map((b) => ({
          id: b.id,
          bill_number: b.bill_number,
          vendor_name: b.vendor_name,
          category_string: b.category || null,
          issue_date: b.issue_date,
          total: b.total,
          status: b.status,
        }));
      return {
        unmatched_count: unmatched.length,
        unmatched_bills: unmatched,
      };
    }
    return apiRequest("GET", "/api/finance/bills/category-quality-report");
  },
  async createBill(payload) {
    if (_isMock()) {
      const vend = FinanceMockState.vendors.find((v) => v.id === parseInt(payload.vendor_id, 10));
      const lines = (payload.lines || []).map((ln, i) => ({
        id: Date.now() + i, bill_id: FinanceMockState.bills.length + 1,
        ...ln, line_total: ln.line_total || (ln.quantity * ln.unit_price),
      }));
      const subtotal = lines.reduce((s, l) => s + l.line_total, 0);

      _refuseServerOwned(payload);
      if (payload.save_as_draft && payload.is_paid_now) throw new Error("A draft cannot be recorded as already paid");
      const autoApproved = _can("finance.bill.approve") && !payload.save_as_draft;

      if (autoApproved || payload.is_paid_now) {
        // Leaving Draft (here: born Approved) runs the full checks
        const missing = _missingToLeaveDraft(payload);
        if (missing.length) throw _validationError(missing);
        const dupRes = await this.checkDuplicateBills({
          vendor_id: payload.vendor_id,
          bill_number: payload.bill_number,
          issue_date: payload.issue_date,
          total: subtotal,
          file_fingerprint: payload.file_fingerprint,
        });
        const candidates = dupRes?.candidates || [];
        if (candidates.length > 0 && !payload.is_duplicate_override) {
          throw new Error(`Potential duplicate bill detected (${candidates[0].matched_field}: ${candidates[0].matching_value}). Authorized override required.`);
        }
        if (payload.is_duplicate_override && !payload.duplicate_override_reason?.trim()) {
          throw new Error("A valid reason is required when overriding a duplicate bill detection.");
        }
      } else if (!payload.vendor_id && !payload.attachment_name) {
        throw _validationError([{ loc: ["body", "vendor_id"], msg: "A draft needs a vendor or an attachment", type: "missing_field" }]);
      }


      if (payload.is_paid_now) {
        if (!payload.payment) {
          throw new Error("Payment details (bank account, payment date) are required when 'is_paid_now' is True.");
        }
        if (!_can("finance.bill.pay") || !_can("finance.bill.approve")) throw _forbid("finance.bill.pay");
      }

      // An approver's bill is Approved on save (auto-approved) unless saved as a draft.
      const st = autoApproved ? "approved" : "draft";
      const isRev = !(payload.capture_source === "upload" || payload.capture_source === "ocr");

      if (payload.is_paid_now) {
        const subtotalNow = (payload.lines || []).reduce((sum, ln) => sum + (ln.line_total || ln.quantity * ln.unit_price), 0);
        const payAmt = payload.payment.amount !== null && payload.payment.amount !== undefined ? payload.payment.amount : subtotalNow;
        // A refused payment leaves no bill behind
        _checkBillPayment({ currency: payload.currency || "EGP", total: subtotalNow }, { ...payload.payment, amount: payAmt }, 0);
      }

      const newBill = {
        id: FinanceMockState.bills.length + 1,
        ...payload,
        status: st,
        save_as_draft: undefined,
        amount_paid: 0.0,
        is_reviewed: isRev,
        created_by: "admin@voyance.health",
        approval_status: autoApproved ? "auto" : null,
        approved_by: autoApproved ? "admin@voyance.health" : null,
        vendor_name: vend ? vend.name : null,
        subtotal, tax_amount: 0, total: subtotal,
        created_at: new Date().toISOString(),
        lines,
      };
      FinanceMockState.bills.push(newBill);

      // FUX-408: Record settlement if is_paid_now is True
      if (payload.is_paid_now && payload.payment) {
        await this.recordBillPayment(newBill.id, {
          bank_account_id: payload.payment.bank_account_id,
          payment_type_id: payload.payment.payment_type_id,
          payment_date: payload.payment.payment_date,
          amount: payload.payment.amount !== null && payload.payment.amount !== undefined ? payload.payment.amount : newBill.total,
          reference: payload.payment.reference || "",
          details: payload.payment.details || null,
          cheque_number: payload.payment.cheque_number || null,
        });
      }

      return newBill;
    }
    return apiRequest("POST", "/api/finance/bills", payload);
  },
  async updateBill(id, payload) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");

      _refuseServerOwned(payload);
      if (bill.status === "void") throw new Error("Cannot update a voided bill");

      // A material edit (vendor, currency, lines) by a user who cannot approve sends an Approved/Scheduled bill back.
      const oldLines = JSON.stringify((bill.lines || []).map((l) => [String(l.description || "").trim(), Number(l.quantity), Number(l.unit_price)]).sort());
      const newLines = payload.lines ? JSON.stringify(payload.lines.map((l) => [String(l.description || "").trim(), Number(l.quantity ?? 1), Number(l.unit_price ?? 0)]).sort()) : oldLines;
      const material = (payload.vendor_id !== undefined && parseInt(payload.vendor_id, 10) !== bill.vendor_id)
        || (payload.currency !== undefined && payload.currency !== bill.currency)
        || oldLines !== newLines;
      const sendBack = material && ["approved", "scheduled"].includes(bill.status) && !_can("finance.bill.approve");

      Object.assign(bill, payload);
      if (payload.lines) {
        bill.subtotal = payload.lines.reduce((s, l) => s + (l.line_total || l.quantity * l.unit_price), 0);
        bill.total = bill.subtotal;
      }
      if (sendBack) {
        bill.status = _billNext("send_back", bill);
        bill.scheduled_payment_date = null;
        bill.approval_status = "pending";
        bill.approved_by = null;
        bill.approved_at = null;
        bill.approval_comment = null;
      }
      return bill;
    }
    return apiRequest("PUT", `/api/finance/bills/${id}`, payload);
  },
  async voidBill(id, reason = null) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");
      const target = _billNext("void", bill);
      const hasPayments = (FinanceMockState.billPayments || []).some((p) => p.related_bill_id === bill.id && !p.is_reversed);
      if (hasPayments || (bill.amount_paid || 0) > 0.001) {
        const err = new Error("Cannot void a bill that has unreversed payments. Reverse the payments first.");
        err.status = 409;
        err.detail = { code: "has_unreversed_payments", message: err.message, current_status: bill.status, allowed_actions: _billAllowedActions(bill.status) };
        throw err;
      }
      bill.status = target;
      bill.void_reason = reason && reason.trim() ? reason.trim() : null;
      bill.voided_by = "admin@voyance.health";
      bill.voided_at = new Date().toISOString();
      return bill;
    }
    return apiRequest("POST", `/api/finance/bills/${id}/void`, { reason: reason || null }, true, _getIdempHeaders());
  },
  // Discard a Draft: permanent delete. Every other bill is kept; cancelling is Void.
  async discardBill(id) {
    if (_isMock()) {
      const idx = FinanceMockState.bills.findIndex((b) => b.id === parseInt(id, 10));
      if (idx < 0) throw new Error("Bill not found");
      const bill = FinanceMockState.bills[idx];
      if (bill.status !== "draft") {
        const err = new Error("Only a draft can be discarded. Use Void to cancel any other bill.");
        err.status = 409;
        err.detail = { code: "delete_not_allowed", message: err.message, current_status: bill.status, allowed_actions: _billAllowedActions(bill.status) };
        throw err;
      }
      FinanceMockState.bills.splice(idx, 1);
      return bill;
    }
    return apiRequest("DELETE", `/api/finance/bills/${id}`, null, true, _getIdempHeaders());
  },
  // Several PDFs or photos at once: each file becomes its own Draft with its own vendor match
  async uploadBillFiles(files) {
    if (_isMock()) {
      const results = [];
      for (const file of files) {
        const name = file.name || "upload.pdf";
        const base = name.replace(/\.[^.]+$/, "");
        const vendor = (FinanceMockState.vendors || []).find((v) => base.toLowerCase().includes(v.name.toLowerCase().split(" ")[0]));
        const id = Math.max(0, ...FinanceMockState.bills.map((b) => b.id)) + 1;
        const bill = {
          id, vendor_id: vendor ? vendor.id : null, vendor_name: vendor ? vendor.name : null,
          vendor_to_confirm: !vendor, suggested_vendor_name: vendor ? null : base,
          bill_number: null, issue_date: null, due_date: null, status: "draft", currency: "EGP",
          subtotal: 0, tax_amount: 0, total: 0, amount_paid: 0, capture_source: "upload", is_reviewed: false,
          attachment_name: name, attachment_url: `/api/finance/bills/${id}/attachment`,
          file_fingerprint: `sha256-mock-${name}-${id}`, created_by: "admin@voyance.health", created_at: new Date().toISOString(), lines: [],
        };
        FinanceMockState.bills.push(bill);
        results.push({ filename: name, bill, error: null, duplicate_of: null });
      }
      return results;
    }
    const results = [];
    const formData = new FormData();
    files.forEach((f) => formData.append("files", f));
    const body = await apiRequest("POST", "/api/finance/bills/upload", formData);
    return (body && body.results) || results;
  },
  async submitBill(id) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");
      const target = _billNext("submit", bill);
      const missing = _missingToLeaveDraft(bill);
      if (missing.length) throw _validationError(missing);
      bill.status = target;
      bill.approval_status = "pending";
      bill.approved_by = null;
      bill.approved_at = null;
      bill.approval_comment = null;
      return bill;
    }
    return apiRequest("POST", `/api/finance/bills/${id}/submit`, {});
  },
  async withdrawBill(id) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");
      bill.status = _billNext("withdraw", bill);
      bill.approval_status = null;
      return bill;
    }
    return apiRequest("POST", `/api/finance/bills/${id}/withdraw`, {});
  },
  async getBillPayments(billId) {
    if (_isMock()) return FinanceMockState.billPayments.filter((p) => p.related_bill_id === parseInt(billId, 10));
    return apiRequest("GET", `/api/finance/bills/${billId}/payments`);
  },
  async approveBill(id, payload) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");
      if (!_can("finance.bill.approve")) throw _forbid("finance.bill.approve");
      const decision = payload.decision || "approve";
      if (decision !== "approve" && decision !== "reject") throw new Error(`Invalid decision '${decision}'. Must be 'approve' or 'reject'.`);
      const target = _billNext(decision, bill);
      const approverEmail = payload.approver_email || "admin@voyance.health";
      const isSuper = typeof SessionInfo !== "undefined" && (SessionInfo.getRoles() || []).includes("Super-Admin");
      if (bill.created_by && bill.created_by.toLowerCase() === approverEmail.toLowerCase() && !isSuper) {
        throw new Error("Self-approval is prohibited by segregation of duties policy.");
      }
      if (payload.approver_limit !== undefined && payload.approver_limit !== null && bill.total > payload.approver_limit) {
        throw new Error(`Bill total ($${bill.total.toFixed(2)}) exceeds approver authorization limit ($${payload.approver_limit.toFixed(2)}). Escalation required.`);
      }
      if (decision === "reject" && !(payload.comment || "").trim()) {
        throw new Error("A comment or reason is required when rejecting a bill.");
      }
      bill.approval_status = decision === "approve" ? "approved" : "rejected";
      bill.approved_by = approverEmail;
      bill.approved_at = new Date().toISOString();
      bill.approval_comment = decision === "approve" ? (payload.comment || null) : payload.comment.trim();
      bill.status = target;
      return bill;
    }
    return apiRequest("POST", `/api/finance/bills/${id}/approve`, payload);
  },
  async scheduleBill(id, payload) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(id, 10));
      if (!bill) throw new Error("Bill not found");
      const target = _billNext("schedule", bill);
      bill.scheduled_payment_date = payload.scheduled_payment_date;
      if (payload.notes) {
        bill.notes = `${bill.notes || ""}\n[Scheduled: ${payload.scheduled_payment_date} - ${payload.notes}]`.trim();
      }
      bill.status = target;
      return bill;
    }
    return apiRequest("POST", `/api/finance/bills/${id}/schedule`, payload);
  },
  async recordBillPayment(billId, payload) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(billId, 10));
      if (!bill) throw new Error("Bill not found");
      if (!_can("finance.bill.pay")) throw _forbid("finance.bill.pay");
      _billNext("pay", bill);
      const existingPayments = (FinanceMockState.billPayments || []).filter(
        (p) => p.related_bill_id === bill.id && !p.is_reversed
      );
      const paidSoFar = existingPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
      const { account, pt, pAmt } = _checkBillPayment(bill, payload, paidSoFar);
      const newPayment = {
        id: FinanceMockState.billPayments.length + 1,
        direction: "outgoing",
        related_bill_id: parseInt(billId, 10),
        amount: pAmt,
        currency: bill.currency,
        payment_date: payload.payment_date,
        bank_account_id: account.id,
        method: BILL_PAYMENT_METHOD[pt.code] || "other",
        reference: payload.reference || "",
        is_reversed: false,
        created_at: new Date().toISOString(),
      };
      FinanceMockState.billPayments.push(newPayment);
      account.current_balance = round(account.current_balance - pAmt, 2);
      bill.amount_paid = round(paidSoFar + pAmt, 2);
      bill.status = _billDerivePaymentStatus(bill);
      return newPayment;
    }
    return apiRequest("POST", `/api/finance/bills/${billId}/payments`, payload);
  },
  async reverseBillPayment(billId, paymentId, payload) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(billId, 10));
      if (!bill) throw new Error("Bill not found");
      if (!_can("finance.bill.pay")) throw _forbid("finance.bill.pay");
      const payment = (FinanceMockState.billPayments || []).find(
        (p) => p.id === parseInt(paymentId, 10) && p.related_bill_id === bill.id
      );
      if (!payment) throw new Error("Payment not found");
      if (payment.is_reversed) throw new Error("Payment has already been reversed");
      const payAccount = (FinanceMockState.accounts || []).find((a) => a.id === payment.bank_account_id);
      if (payAccount) payAccount.current_balance = round(payAccount.current_balance + payment.amount, 2);
      payment.is_reversed = true;
      payment.reversed_at = new Date().toISOString();
      payment.reversed_by = "admin@voyance.health";
      payment.reversal_reason = (payload.reason || "").trim();

      const remainingPayments = (FinanceMockState.billPayments || []).filter(
        (p) => p.related_bill_id === bill.id && !p.is_reversed
      );
      const remainingPaid = remainingPayments.reduce((s, p) => s + (p.amount || 0), 0);
      bill.amount_paid = round(remainingPaid, 2);
      if (bill.amount_paid <= 0.001) bill.amount_paid = 0.0;
      bill.status = _billDerivePaymentStatus(bill);
      return payment;
    }
    return apiRequest("POST", `/api/finance/bills/${billId}/payments/${paymentId}/reverse`, payload);
  },

  async uploadBillAttachment(billId, file) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(billId, 10));
      if (!bill) throw new Error("Bill not found");
      const filename = file?.name || "uploaded_bill.pdf";
      bill.attachment_name = filename;
      bill.attachment_url = `/api/finance/bills/${bill.id}/attachment`;
      bill.file_fingerprint = "sha256-mock-" + Date.now();
      return bill;
    }
    const formData = new FormData();
    formData.append("file", file);
    return apiRequest("POST", `/api/finance/bills/${billId}/attachment`, formData);
  },

  async deleteBillAttachment(billId) {
    if (_isMock()) {
      const bill = FinanceMockState.bills.find((b) => b.id === parseInt(billId, 10));
      if (!bill) throw new Error("Bill not found");
      bill.attachment_name = null;
      bill.attachment_url = null;
      bill.file_fingerprint = null;
      return bill;
    }
    return apiRequest("DELETE", `/api/finance/bills/${billId}/attachment`);
  },

  async getBillAttachmentBlobUrl(billId) {
    if (_isMock()) {
      // Create a mock sample text/pdf blob URL
      const sampleContent = `%PDF-1.4\n% Mock bill attachment document for bill #${billId}\n1 0 obj\n<< /Title (Bill ${billId}) >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF`;
      const blob = new Blob([sampleContent], { type: "application/pdf" });
      return URL.createObjectURL(blob);
    }
    const token = typeof TokenStore !== "undefined" ? TokenStore.get() : null;
    const headers = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`/api/finance/bills/${billId}/attachment`, { headers, credentials: "include" });
    if (!res.ok) throw new Error(`Failed to load attachment: ${res.statusText}`);
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  async extractBillDocument(file) {
    if (!file) throw new Error("A file is required for extraction");
    if (_isMock()) {
      const fileName = file.name || "document.pdf";
      const isUnreadable =
        fileName.toLowerCase().includes("unreadable") ||
        fileName.toLowerCase().includes("scanned") ||
        fileName.toLowerCase().includes("blank") ||
        fileName.toLowerCase().includes("raster");

      if (fileName.toLowerCase().includes("corrupt")) {
        throw new Error("Invalid or corrupted PDF document");
      }

      if (isUnreadable) {
        return {
          is_readable: false,
          unreadable_reason: "No machine-readable text layer was detected in this file (scanned image or raster PDF). Manual entry required.",
          extraction_confidence: 0.0,
          field_confidence: {},
          missing_fields: ["vendor", "bill_number", "issue_date", "due_date", "total", "line_items", "department", "category"],
          vendor_id: null,
          vendor_name: null,
          bill_number: null,
          issue_date: null,
          due_date: null,
          currency: "USD",
          subtotal: null,
          tax_amount: null,
          total: null,
          lines: [],
          file_fingerprint: "sha256-mock-unreadable-" + Date.now(),
          raw_text_snippet: null,
        };
      }

      // Try reading text if available (e.g. from Blob or text file created in tests)
      let textContent = "";
      try {
        if (typeof file.text === "function") {
          textContent = await file.text();
        }
      } catch (_) {}

      let vendorName = null;
      let vendorId = null;
      let billNumber = null;
      let issueDate = null;
      let dueDate = null;
      let total = null;
      let currency = "USD";
      const lines = [];

      if (textContent && textContent.length > 20) {
        const vMatch = textContent.match(/(?:Vendor|From|Supplier):\s*([^\r\n]+)/i);
        if (vMatch) {
          vendorName = vMatch[1].trim();
          const matchV = (FinanceMockState.vendors || []).find((v) =>
            v.name.toLowerCase().includes(vendorName.toLowerCase()) || vendorName.toLowerCase().includes(v.name.toLowerCase())
          );
          if (matchV) {
            vendorId = matchV.id;
            vendorName = matchV.name;
          }
        }
        const bMatch = textContent.match(/(?:Invoice\s*Number|Bill\s*#?|Invoice\s*#?):\s*([A-Za-z0-9\-_]+)/i);
        if (bMatch) billNumber = bMatch[1].trim();
        const dMatch = textContent.match(/(?:Date|Issue\s*Date):\s*(\d{4}-\d{2}-\d{2})/i);
        if (dMatch) issueDate = dMatch[1];
        const ddMatch = textContent.match(/(?:Due\s*Date):\s*(\d{4}-\d{2}-\d{2})/i);
        if (ddMatch) dueDate = ddMatch[1];
        const tMatch = textContent.match(/(?:Total):\s*(?:[$€\u00a3])?\s*([\d,]+(?:\.\d{2})?)/i);
        if (tMatch) total = parseFloat(tMatch[1].replace(/,/g, ""));
      }

      if (!vendorName && !vendorId) {
        vendorId = 1;
        vendorName = "Amazon Web Services";
      }
      if (!billNumber) {
        billNumber = "INV-2026-991";
      }
      if (!issueDate) {
        issueDate = "2026-09-10";
      }
      if (!dueDate) {
        dueDate = "2026-10-10";
      }
      if (!total) {
        total = 450.0;
      }
      if (lines.length === 0) {
        lines.push({
          description: "Cloud Hosting & Compute Services",
          quantity: 1,
          unit_price: total,
          line_total: total,
        });
      }

      const isLow = fileName.toLowerCase().includes("blur") || fileName.toLowerCase().includes("low");
      const confidence = isLow ? 0.68 : 0.94;

      return {
        is_readable: true,
        unreadable_reason: null,
        extraction_confidence: confidence,
        field_confidence: {
          vendor: 0.95,
          bill_number: 0.95,
          issue_date: 0.90,
          due_date: 0.85,
          total: 0.95,
        },
        missing_fields: ["category", "department"],
        vendor_id: vendorId,
        vendor_name: vendorName,
        bill_number: billNumber,
        issue_date: issueDate,
        due_date: dueDate,
        currency: currency,
        subtotal: total,
        tax_amount: 0.0,
        total: total,
        lines: lines,
        file_fingerprint: "sha256-mock-" + Date.now(),
        raw_text_snippet: textContent.slice(0, 300) || "Sample readable PDF invoice text...",
      };
    }

    const formData = new FormData();
    formData.append("file", file);
    return apiRequest("POST", "/api/finance/bills/extract", formData);
  },

  getPayrollRuns() {
    return apiRequest("GET", "/api/finance/payroll/runs");
  },
  getMyPayslips() {
    return apiRequest("GET", "/api/finance/payroll/payslips/my");
  },
  getSubscriptions() {
    return apiRequest("GET", "/api/finance/subscriptions");
  },

// Vendors
  async getVendors(params) {
    if (_isMock()) {
      let list = [...FinanceMockState.vendors];
      if (params && params.is_active !== undefined) {
        list = list.filter((v) => v.is_active === (params.is_active === "true" || params.is_active === true));
      }
      return list;
    }
    let url = "/api/finance/vendors";
    if (params) {
      const qs = new URLSearchParams(params).toString();
      if (qs) url += `?${qs}`;
    }
    return apiRequest("GET", url);
  },
  async getVendor(id) {
    if (_isMock()) {
      const vend = FinanceMockState.vendors.find((v) => v.id === parseInt(id, 10));
      if (!vend) throw new Error("Vendor not found");
      return vend;
    }
    return apiRequest("GET", `/api/finance/vendors/${id}`);
  },
  async createVendor(payload) {
    if (_isMock()) {
      const newVend = {
        id: FinanceMockState.vendors.length + 1,
        ...payload,
        is_active: true,
      };
      FinanceMockState.vendors.push(newVend);
      return newVend;
    }
    return apiRequest("POST", "/api/finance/vendors", payload);
  },
  async updateVendor(id, payload) {
    if (_isMock()) {
      const vend = FinanceMockState.vendors.find((v) => v.id === parseInt(id, 10));
      if (!vend) throw new Error("Vendor not found");
      Object.assign(vend, payload);
      return vend;
    }
    return apiRequest("PUT", `/api/finance/vendors/${id}`, payload);
  },
  async deleteVendor(id) {
    if (_isMock()) {
      const vend = FinanceMockState.vendors.find((v) => v.id === parseInt(id, 10));
      if (!vend) throw new Error("Vendor not found");
      vend.is_active = false;
      return vend;
    }
    return apiRequest("DELETE", `/api/finance/vendors/${id}`);
  },
  async checkVendorDuplicate(payload) {
    if (_isMock()) {
      const results = [];
      const norm = (s) => (s || "").toLowerCase().replace(/^(the\s+)/, "").replace(/[\s,.-]+(llc|inc|corp|corporation|ltd|limited|co|company)$/, "").replace(/[^a-z0-9]/g, "");
      const normName = payload.name ? norm(payload.name) : "";
      const normTax = payload.tax_id ? norm(payload.tax_id) : "";
      const email = (payload.contact_email || "").trim().toLowerCase();

      for (const v of FinanceMockState.vendors) {
        if (normName && norm(v.name) === normName) {
          results.push({ id: v.id, name: v.name, tax_id: v.tax_id, contact_email: v.contact_email, matched_field: "name", confidence: 0.95 });
        } else if (normTax && v.tax_id && norm(v.tax_id) === normTax) {
          results.push({ id: v.id, name: v.name, tax_id: v.tax_id, contact_email: v.contact_email, matched_field: "tax_id", confidence: 1.0 });
        } else if (email && v.contact_email && v.contact_email.toLowerCase() === email) {
          results.push({ id: v.id, name: v.name, tax_id: v.tax_id, contact_email: v.contact_email, matched_field: "contact_email", confidence: 0.9 });
        }
      }
      return results;
    }
    return apiRequest("POST", "/api/finance/vendors/check-duplicate", payload);
  },
  async getVendor360(id, reveal = false) {
    if (_isMock()) {
      const vend = FinanceMockState.vendors.find((v) => v.id === parseInt(id, 10));
      if (!vend) throw new Error("Vendor not found");
      const instructions = (FinanceMockState.vendorPaymentInstructions || []).filter((pi) => pi.vendor_id === vend.id).map((pi) => {
        if (!reveal && pi.account_number && pi.account_number.length > 4) {
          return { ...pi, account_number: "******" + pi.account_number.slice(-4), iban: pi.iban ? "******" + pi.iban.slice(-4) : null };
        }
        return { ...pi };
      });
      const bills = (FinanceMockState.bills || []).filter((b) => b.vendor_id === vend.id);
      const paidBills = bills.filter((b) => b.status === "paid");
      const totalSpend = paidBills.reduce((acc, b) => acc + (b.total || 0), 0);
      const openBills = bills.filter((b) => b.status !== "paid" && b.status !== "void");
      const openTotal = openBills.reduce((acc, b) => acc + (b.total || 0), 0);
      return {
        vendor: vend,
        payment_instructions: instructions,
        metrics: {
          total_spend: totalSpend,
          open_bills_count: openBills.length,
          open_bills_total: openTotal,
          last_payment_date: paidBills.length ? paidBills[0].due_date : null,
          last_payment_amount: paidBills.length ? paidBills[0].total : null,
          active_subscriptions_count: 1,
        },
        recent_bills: bills.slice(0, 10),
      };
    }
    return apiRequest("GET", `/api/finance/vendors/${id}/360${reveal ? "?reveal=true" : ""}`);
  },
  async getVendorPaymentInstructions(vendorId, reveal = false) {
    if (_isMock()) {
      const list = (FinanceMockState.vendorPaymentInstructions || []).filter((pi) => pi.vendor_id === parseInt(vendorId, 10));
      return list.map((pi) => {
        if (!reveal && pi.account_number && pi.account_number.length > 4) {
          return { ...pi, account_number: "******" + pi.account_number.slice(-4), iban: pi.iban ? "******" + pi.iban.slice(-4) : null };
        }
        return { ...pi };
      });
    }
    return apiRequest("GET", `/api/finance/vendors/${vendorId}/payment-instructions${reveal ? "?reveal=true" : ""}`);
  },
  async createVendorPaymentInstruction(vendorId, payload) {
    if (_isMock()) {
      const newInst = {
        id: (FinanceMockState.vendorPaymentInstructions || []).length + 1,
        vendor_id: parseInt(vendorId, 10),
        ...payload,
        verification_status: "unverified",
        verified_by: null,
        verified_at: null,
        is_active: true,
      };
      FinanceMockState.vendorPaymentInstructions.push(newInst);
      return { ...newInst, account_number: "******" + (newInst.account_number ? newInst.account_number.slice(-4) : "0000") };
    }
    return apiRequest("POST", `/api/finance/vendors/${vendorId}/payment-instructions`, payload);
  },
  async updateVendorPaymentInstruction(vendorId, instructionId, payload) {
    if (_isMock()) {
      const inst = (FinanceMockState.vendorPaymentInstructions || []).find((pi) => pi.id === parseInt(instructionId, 10));
      if (!inst) throw new Error("Payment instruction not found");
      Object.assign(inst, payload);
      inst.verification_status = "unverified";
      inst.verified_by = null;
      inst.verified_at = null;
      return { ...inst, account_number: "******" + (inst.account_number ? inst.account_number.slice(-4) : "0000") };
    }
    return apiRequest("PUT", `/api/finance/vendors/${vendorId}/payment-instructions/${instructionId}`, payload);
  },
  async verifyVendorPaymentInstruction(vendorId, instructionId, payload) {
    if (_isMock()) {
      const inst = (FinanceMockState.vendorPaymentInstructions || []).find((pi) => pi.id === parseInt(instructionId, 10));
      if (!inst) throw new Error("Payment instruction not found");
      inst.verification_status = payload.decision || "verified";
      inst.verified_by = "admin@hrflow.test";
      inst.verified_at = new Date().toISOString();
      return { ...inst, account_number: "******" + (inst.account_number ? inst.account_number.slice(-4) : "0000") };
    }
    return apiRequest("POST", `/api/finance/vendors/${vendorId}/payment-instructions/${instructionId}/verify`, payload);
  }
  };

  root.FinanceBillsApi = FinanceBillsApi;
  if (!root.FinanceApi) root.FinanceApi = {};
  Object.assign(root.FinanceApi, FinanceBillsApi);

  if (typeof module !== "undefined" && module.exports) {
    module.exports = FinanceBillsApi;
  }
})(typeof window !== "undefined" ? window : globalThis);
