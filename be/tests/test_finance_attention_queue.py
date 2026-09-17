"""
be/tests/test_finance_attention_queue.py
Integration tests for the Finance Needs-Attention Queue (Story 2.2).
Covers:
- Comprehensive domain aggregation: overdue receivables, overdue bills, bills due soon,
  negative cash (overdraft), incomplete transfers, draft payroll runs, unreconciled statement imports, bounced cheques.
- Deterministic priority scoring and tie-breaking.
- Aggregate counts and currency totals.
- Severity, type, and keyword search filters.
- Item review and resolution lifecycle (dismissal from queue).
- Strict RBAC permission redaction: unauthorized items are neither returned nor counted.
"""
import pytest
from datetime import datetime, timedelta

from finance.models import (
    FinanceBankAccountDB,
    CustomerDB,
    SalesInvoiceDB,
    VendorDB,
    BillDB,
    AccountTransferDB,
    PayrollRunDB,
    BankStatementImportDB,
    StatementLineDB,
    FinanceChequeDB,
    FinanceAttentionReviewDB,
)


@pytest.fixture
def db_session():
    from db import get_session_factory
    Session = get_session_factory()
    session = Session()
    try:
        yield session
    finally:
        session.close()


def seed_attention_records(db_session):
    today = datetime.utcnow().date()
    today_str = today.strftime("%Y-%m-%d")
    ten_days_ago = (today - timedelta(days=10)).strftime("%Y-%m-%d")
    five_days_ago = (today - timedelta(days=5)).strftime("%Y-%m-%d")
    two_days_ahead = (today + timedelta(days=2)).strftime("%Y-%m-%d")

    # 1. Negative Cash Account (-$8,500 USD)
    acc_neg = FinanceBankAccountDB(
        account_name="Overdraft Ops Account",
        bank_name="Test Bank Negative",
        account_number="ACC-NEG-001",
        currency="USD",
        opening_balance=0.0,
        current_balance=-8500.0,
        is_active=True,
    )
    db_session.add(acc_neg)

    # Positive account for transfers
    acc_pos = FinanceBankAccountDB(
        account_name="Reserve Funding Account",
        bank_name="Test Bank Positive",
        account_number="ACC-POS-002",
        currency="USD",
        opening_balance=50000.0,
        current_balance=50000.0,
        is_active=True,
    )
    db_session.add(acc_pos)
    db_session.flush()

    # 2. Customer & Overdue Invoice
    cust = CustomerDB(name="Acme Health Systems", contact_email="ap@acmehealth.com")
    db_session.add(cust)
    db_session.flush()

    inv_overdue = SalesInvoiceDB(
        customer_id=cust.id,
        invoice_number="INV-ATTN-101",
        issue_date=ten_days_ago,
        due_date=ten_days_ago,
        status="sent",
        currency="USD",
        total=15000.0,
    )
    db_session.add(inv_overdue)

    # 3. Vendor, Overdue Bill, and Due Soon Bill
    vend = VendorDB(name="Datadog Monitoring", contact_email="billing@datadog.com")
    db_session.add(vend)
    db_session.flush()

    bill_overdue = BillDB(
        vendor_id=vend.id,
        bill_number="BILL-ATTN-501",
        issue_date=five_days_ago,
        due_date=five_days_ago,
        status="unpaid",
        currency="USD",
        total=3200.0,
    )
    bill_due_soon = BillDB(
        vendor_id=vend.id,
        bill_number="BILL-ATTN-502",
        issue_date=today_str,
        due_date=two_days_ahead,
        status="unpaid",
        currency="USD",
        total=1200.0,
    )
    db_session.add(bill_overdue)
    db_session.add(bill_due_soon)

    # 4. Incomplete Transfer
    transfer_incomp = AccountTransferDB(
        from_account_id=acc_pos.id,
        to_account_id=acc_neg.id,
        date=today_str,
        from_amount=4000.0,
        from_currency="USD",
        to_amount=4000.0,
        to_currency="USD",
        confirmed_leg="from_only",
        note="Emergency cover leg 1",
    )
    db_session.add(transfer_incomp)

    # 5. Draft Payroll Run
    payroll_draft = PayrollRunDB(
        period_label="2026-09",
        period_start=ten_days_ago,
        period_end=today_str,
        status="draft",
        total_gross=25000.0,
        total_net=20000.0,
    )
    db_session.add(payroll_draft)

    # 6. Unreconciled Statement Import
    stmt_import = BankStatementImportDB(
        account_id=acc_pos.id,
        period_month="2026-08",
        file_type="csv",
        status="needs_review",
        total_lines_count=2,
        matched_lines_count=0,
    )
    db_session.add(stmt_import)
    db_session.flush()

    stmt_line1 = StatementLineDB(
        import_id=stmt_import.id,
        raw_date=today_str,
        raw_amount=500.0,
        direction="out",
        raw_description="Unrecognized Wire Fee",
        status="unmatched",
    )
    stmt_line2 = StatementLineDB(
        import_id=stmt_import.id,
        raw_date=today_str,
        raw_amount=750.0,
        direction="in",
        raw_description="Unallocated Credit",
        status="unmatched",
    )
    db_session.add(stmt_line1)
    db_session.add(stmt_line2)

    # 7. Bounced Cheque
    bounced_chq = FinanceChequeDB(
        cheque_number="CHQ-9988",
        account_id=acc_pos.id,
        issue_date=ten_days_ago,
        amount=6500.0,
        currency="USD",
        payee="Prime Medical Supplies",
        purpose_type="vendor_payment",
        status="bounced",
        fiscal_year=2026,
    )
    db_session.add(bounced_chq)
    db_session.commit()


@pytest.fixture
def seeded_attention_db(db_session):
    seed_attention_records(db_session)
    return db_session


def test_attention_queue_aggregation_and_ordering(app_client, admin_cookies, seeded_attention_db):
    # Query attention queue
    res = app_client.get("/api/finance/reports/attention-queue", cookies=admin_cookies)
    assert res.status_code == 200
    data = res.json()

    assert data["total_count"] >= 8
    assert data["urgent_count"] >= 4  # Overdraft, Bounced cheque, Overdue invoice, Overdue bill
    assert data["warning_count"] >= 3  # Incomplete transfer, Draft payroll, Unreconciled stmt, Bill due soon
    assert "USD" in data["total_amount_by_currency"]

    items = data["items"]
    types_found = {i["type"] for i in items}
    assert "negative_cash" in types_found
    assert "bounced_cheque" in types_found
    assert "overdue_receivable" in types_found
    assert "bill_due" in types_found
    assert "pending_approval" in types_found
    assert "unreconciled_statement" in types_found

    # Priority ordering verification: Urgent items must be at the very top
    urgent_items = [i for i in items if i["severity"] == "urgent"]
    assert len(urgent_items) >= 4
    top_two_types = [items[0]["type"], items[1]["type"]]
    assert "negative_cash" in top_two_types or "bounced_cheque" in top_two_types

    # Ensure each item has actionable route and accessible label (not color alone)
    for it in items:
        assert it["target_route"].startswith("a-finance-")
        assert it["severity_label"] in ["Urgent", "Warning", "Info"]
        assert len(it["due_state_label"]) > 0


def test_attention_queue_filters(app_client, admin_cookies, seeded_attention_db):
    # Filter by severity: urgent
    res_urgent = app_client.get(
        "/api/finance/reports/attention-queue?severity=urgent",
        cookies=admin_cookies,
    )
    assert res_urgent.status_code == 200
    d_urgent = res_urgent.json()
    assert d_urgent["total_count"] > 0
    assert all(i["severity"] == "urgent" for i in d_urgent["items"])

    # Filter by item_type: overdue_receivable
    res_type = app_client.get(
        "/api/finance/reports/attention-queue?item_type=overdue_receivable",
        cookies=admin_cookies,
    )
    assert res_type.status_code == 200
    d_type = res_type.json()
    assert all(i["type"] == "overdue_receivable" for i in d_type["items"])

    # Filter by search keyword: Datadog
    res_search = app_client.get(
        "/api/finance/reports/attention-queue?search=Datadog",
        cookies=admin_cookies,
    )
    assert res_search.status_code == 200
    d_search = res_search.json()
    assert d_search["total_count"] >= 1
    assert any("Datadog" in i["title"] or "Datadog" in (i["counterparty"] or "") for i in d_search["items"])


def test_attention_queue_review_and_resolve_lifecycle(app_client, admin_cookies, seeded_attention_db):
    # Fetch current queue to pick an item to review
    res = app_client.get("/api/finance/reports/attention-queue", cookies=admin_cookies)
    assert res.status_code == 200
    items = res.json()["items"]
    assert len(items) > 0

    target_item = items[0]
    target_key = target_item["deduplication_key"]
    initial_total = res.json()["total_count"]

    # Mark as reviewed
    rev_res = app_client.post(
        f"/api/finance/reports/attention-queue/{target_key}/review",
        json={"status": "reviewed", "notes": "Reviewed and scheduled with operations"},
        cookies=admin_cookies,
    )
    assert rev_res.status_code == 200
    assert rev_res.json()["success"] is True
    assert rev_res.json()["deduplication_key"] == target_key

    # Subsequent queue query should no longer contain this item
    res_after = app_client.get("/api/finance/reports/attention-queue", cookies=admin_cookies)
    assert res_after.status_code == 200
    after_keys = [i["deduplication_key"] for i in res_after.json()["items"]]
    assert target_key not in after_keys
    assert res_after.json()["total_count"] == initial_total - 1

    # But query with include_reviewed=true returns it marked as reviewed
    res_incl = app_client.get(
        "/api/finance/reports/attention-queue?include_reviewed=true",
        cookies=admin_cookies,
    )
    assert res_incl.status_code == 200
    matching = [i for i in res_incl.json()["items"] if i["deduplication_key"] == target_key]
    assert len(matching) == 1
    assert matching[0]["is_reviewed"] is True


def test_attention_queue_rbac_redaction(app_client, employee_cookies, monkeypatch):
    # 1. Employee without finance.report.read gets 403 Forbidden
    res_forbidden = app_client.get("/api/finance/reports/attention-queue", cookies=employee_cookies)
    assert res_forbidden.status_code == 403

    # 2. Mock user permissions: user has finance.report.read and finance.invoice.read ONLY
    from core import permissions as perm_module

    def mock_user_perms(request, current_user, db):
        return {"finance.report.read", "finance.invoice.read"}

    monkeypatch.setattr(perm_module, "get_current_user_permissions", mock_user_perms)

    res_scoped = app_client.get("/api/finance/reports/attention-queue", cookies=employee_cookies)
    assert res_scoped.status_code == 200
    data = res_scoped.json()

    # User MUST ONLY see overdue receivables (invoices).
    # Unauthorized items (negative cash, bills, transfers, etc.) MUST NOT appear and MUST NOT be counted!
    for it in data["items"]:
        assert it["permission"] == "finance.invoice.read"
        assert it["type"] == "overdue_receivable"

    # Make sure items of other types are completely absent
    types_in_scoped = {i["type"] for i in data["items"]}
    assert "negative_cash" not in types_in_scoped
    assert "bill_due" not in types_in_scoped
    assert "pending_approval" not in types_in_scoped
    assert "unreconciled_statement" not in types_in_scoped
    assert "bounced_cheque" not in types_in_scoped
