"""
be/tests/test_finance_customers_vendors.py
Tests for Phase 4.2: Customer and Vendor CRUD, validation, soft-delete, and RBAC gating.
"""
import pytest


def test_customers_crud_and_validation(app_client, admin_cookies):
    """Admin can perform full CRUD on customers, including duplicate rejection and soft delete."""
    # 1. List initially
    resp = app_client.get("/api/finance/customers", cookies=admin_cookies)
    assert resp.status_code == 200
    initial_count = len(resp.json())

    # 2. Create customer
    payload = {
        "name": "Acme Health Systems",
        "contact_email": "billing@acmehealth.com",
        "contact_phone": "+1 555-0199",
        "tax_id": "TAX-998877",
        "notes": "Enterprise hospital client",
    }
    create_resp = app_client.post("/api/finance/customers", json=payload, cookies=admin_cookies)
    assert create_resp.status_code == 201
    cust = create_resp.json()
    assert cust["id"] is not None
    assert cust["name"] == "Acme Health Systems"
    assert cust["is_active"] is True
    cust_id = cust["id"]

    # 3. Duplicate name rejection
    dup_resp = app_client.post("/api/finance/customers", json=payload, cookies=admin_cookies)
    assert dup_resp.status_code == 400
    assert "already exists" in dup_resp.json()["detail"]

    # 4. Get by ID
    get_resp = app_client.get(f"/api/finance/customers/{cust_id}", cookies=admin_cookies)
    assert get_resp.status_code == 200
    assert get_resp.json()["tax_id"] == "TAX-998877"

    # 5. Update
    update_payload = {"contact_email": "finance@acmehealth.com"}
    put_resp = app_client.put(f"/api/finance/customers/{cust_id}", json=update_payload, cookies=admin_cookies)
    assert put_resp.status_code == 200
    assert put_resp.json()["contact_email"] == "finance@acmehealth.com"

    # 6. Search
    search_resp = app_client.get("/api/finance/customers?search=Acme", cookies=admin_cookies)
    assert search_resp.status_code == 200
    assert len(search_resp.json()) >= 1

    # 7. Soft delete (deactivate)
    del_resp = app_client.delete(f"/api/finance/customers/{cust_id}", cookies=admin_cookies)
    assert del_resp.status_code == 200
    assert del_resp.json()["is_active"] is False

    # 8. Filter active vs inactive
    active_resp = app_client.get("/api/finance/customers?is_active=true", cookies=admin_cookies)
    assert all(c["id"] != cust_id for c in active_resp.json())

    inactive_resp = app_client.get("/api/finance/customers?is_active=false", cookies=admin_cookies)
    assert any(c["id"] == cust_id for c in inactive_resp.json())


def test_vendors_crud_and_validation(app_client, admin_cookies):
    """Admin can perform full CRUD on vendors, including category filtering and soft delete."""
    # 1. Create vendor
    payload = {
        "name": "CloudHosting Global Inc",
        "contact_email": "accounts@cloudhost.com",
        "contact_phone": "+1 800-555-0122",
        "tax_id": "VEND-112233",
        "category": "Infrastructure",
        "notes": "AWS & cloud server hosting provider",
    }
    create_resp = app_client.post("/api/finance/vendors", json=payload, cookies=admin_cookies)
    assert create_resp.status_code == 201
    vendor = create_resp.json()
    assert vendor["id"] is not None
    assert vendor["name"] == "CloudHosting Global Inc"
    assert vendor["category"] == "Infrastructure"
    assert vendor["is_active"] is True
    vendor_id = vendor["id"]

    # 2. Duplicate rejection
    dup_resp = app_client.post("/api/finance/vendors", json=payload, cookies=admin_cookies)
    assert dup_resp.status_code == 400
    assert "already exists" in dup_resp.json()["detail"]

    # 3. Get by ID
    get_resp = app_client.get(f"/api/finance/vendors/{vendor_id}", cookies=admin_cookies)
    assert get_resp.status_code == 200
    assert get_resp.json()["name"] == "CloudHosting Global Inc"

    # 4. Filter by category
    cat_resp = app_client.get("/api/finance/vendors?category=Infrastructure", cookies=admin_cookies)
    assert cat_resp.status_code == 200
    assert any(v["id"] == vendor_id for v in cat_resp.json())

    other_cat_resp = app_client.get("/api/finance/vendors?category=Legal", cookies=admin_cookies)
    assert other_cat_resp.status_code == 200
    assert all(v["id"] != vendor_id for v in other_cat_resp.json())

    # 5. Soft delete (deactivate)
    del_resp = app_client.delete(f"/api/finance/vendors/{vendor_id}", cookies=admin_cookies)
    assert del_resp.status_code == 200
    assert del_resp.json()["is_active"] is False


def test_customers_vendors_rbac(app_client, employee_cookies):
    """Employee without finance.customer.* / finance.vendor.* is rejected with 403 Forbidden."""
    # Customers
    resp = app_client.get("/api/finance/customers", cookies=employee_cookies)
    assert resp.status_code == 403
    assert "Permission denied" in resp.json().get("detail", "")

    post_resp = app_client.post("/api/finance/customers", json={"name": "Hacker Corp"}, cookies=employee_cookies)
    assert post_resp.status_code == 403

    # Vendors
    v_resp = app_client.get("/api/finance/vendors", cookies=employee_cookies)
    assert v_resp.status_code == 403

    v_post = app_client.post("/api/finance/vendors", json={"name": "Shady Vendor"}, cookies=employee_cookies)
    assert v_post.status_code == 403

    # Unauthenticated
    assert app_client.get("/api/finance/customers").status_code == 401
    assert app_client.get("/api/finance/vendors").status_code == 401


def test_customer_360_and_duplicate_matching(app_client, admin_cookies):
    """Customer 360 profile returns receivables summary, aging, timeline, and duplicate candidates."""
    # 1. Create a customer with rich profile attributes
    payload = {
        "name": "Pinnacle Care Inc",
        "legal_name": "Pinnacle Healthcare Corporation",
        "contact_email": "billing@pinnaclecare.com",
        "contact_phone": "+1 555-0188",
        "tax_id": "US-9911-2233",
        "billing_address": "123 Care Way, Suite 400",
        "country": "Egypt",
        "default_currency": "USD",
        "payment_terms_days": 45,
        "owner": "Sarah Connor",
        "notes": "Key enterprise account",
    }
    create_resp = app_client.post("/api/finance/customers", json=payload, cookies=admin_cookies)
    assert create_resp.status_code == 201
    cust_id = create_resp.json()["id"]

    # 2. Test duplicate candidate detection
    # Normalized name without 'Inc'
    dup_check = app_client.post(
        "/api/finance/customers/check-duplicate",
        json={"name": "Pinnacle Care"},
        cookies=admin_cookies,
    )
    assert dup_check.status_code == 200
    candidates = dup_check.json()
    assert len(candidates) >= 1
    assert candidates[0]["id"] == cust_id
    assert candidates[0]["matched_field"] == "name"

    # Normalized tax ID without dashes
    dup_tax = app_client.post(
        "/api/finance/customers/check-duplicate",
        json={"tax_id": "us99112233"},
        cookies=admin_cookies,
    )
    assert dup_tax.status_code == 200
    assert len(dup_tax.json()) >= 1
    assert dup_tax.json()[0]["id"] == cust_id

    # Self-exclusion
    dup_excl = app_client.post(
        "/api/finance/customers/check-duplicate",
        json={"name": "Pinnacle Care Inc", "exclude_id": cust_id},
        cookies=admin_cookies,
    )
    assert dup_excl.status_code == 200
    assert not any(c["id"] == cust_id for c in dup_excl.json())

    # 3. Create a receiving bank account for invoices
    bank_resp = app_client.post(
        "/api/finance/accounts",
        json={"account_name": "Operating Cust USD", "currency": "USD", "opening_balance": 10000.0, "account_number": "ACC-CUST-360"},
        cookies=admin_cookies,
    )
    bank_id = bank_resp.json()["id"]

    # 4. Create Invoices for customer:
    # Inv 1: $10,000 overdue
    inv1_resp = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": cust_id,
            "invoice_number": f"INV-C360-001-{cust_id}",
            "issue_date": "2026-08-01",
            "due_date": "2026-08-15",
            "currency": "USD",
            "expected_bank_account_id": bank_id,
            "lines": [{"description": "Medical Imaging PACS", "quantity": 1, "unit_price": 10000.0}],
        },
        cookies=admin_cookies,
    )
    assert inv1_resp.status_code == 201

    # Inv 2: $5,000 sent, then paid in full
    inv2_resp = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": cust_id,
            "invoice_number": f"INV-C360-002-{cust_id}",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "currency": "USD",
            "expected_bank_account_id": bank_id,
            "lines": [{"description": "Cloud Archival", "quantity": 1, "unit_price": 5000.0}],
        },
        cookies=admin_cookies,
    )
    assert inv2_resp.status_code == 201
    inv2_id = inv2_resp.json()["id"]

    # Issue Inv 2 so it can receive payments
    send_resp = app_client.post(f"/api/finance/invoices/{inv2_id}/send", cookies=admin_cookies)
    assert send_resp.status_code == 200

    # Record payment of $5,000 on Inv 2
    pay_resp = app_client.post(
        f"/api/finance/invoices/{inv2_id}/payments",
        json={
            "direction": "incoming",
            "amount": 5000.0,
            "currency": "USD",
            "payment_date": "2026-09-10",
            "bank_account_id": bank_id,
            "method": "bank_transfer",
            "reference": f"WIRE-C360-{cust_id}",
        },
        cookies=admin_cookies,
    )
    assert pay_resp.status_code == 201

    # 5. Fetch Customer 360 Summary
    summary_resp = app_client.get(f"/api/finance/customers/{cust_id}/360", cookies=admin_cookies)
    assert summary_resp.status_code == 200
    s360 = summary_resp.json()

    assert s360["customer"]["id"] == cust_id
    assert s360["customer"]["legal_name"] == "Pinnacle Healthcare Corporation"
    assert s360["customer"]["payment_terms_days"] == 45
    assert s360["total_invoiced"] == 15000.0
    assert s360["total_paid"] == 5000.0
    assert s360["outstanding_balance"] == 10000.0
    assert s360["overdue_balance"] == 10000.0
    assert s360["open_invoices_count"] == 1
    assert s360["overdue_invoices_count"] == 1
    assert s360["average_days_to_pay"] == 9.0  # 2026-09-10 minus 2026-09-01
    assert len(s360["invoices"]) == 2
    assert len(s360["timeline"]) >= 3


def test_customer_receivables_on_list_and_detail(app_client, admin_cookies):
    """
    BE-2 Acceptance:
    - GET /api/finance/customers adds receivables per currency to each customer (empty list when none open).
    - GET /api/finance/customers/{id} also returns receivables.
    - Open = status 'sent' or 'partially_paid' (D-022); draft, paid, and void not counted.
    - Multi-currency customer returns one entry per currency.
    - Values equal customer 360 receivables summary.
    """
    # 1. Create test customer
    cust_resp = app_client.post(
        "/api/finance/customers",
        json={"name": "Receivables Test Health", "default_currency": "USD"},
        cookies=admin_cookies,
    )
    assert cust_resp.status_code == 201
    cust_id = cust_resp.json()["id"]

    # Initially has empty receivables
    get_cust = app_client.get(f"/api/finance/customers/{cust_id}", cookies=admin_cookies)
    assert get_cust.status_code == 200
    assert get_cust.json()["receivables"] == []

    # 2. Setup USD and EGP bank accounts
    usd_resp = app_client.post(
        "/api/finance/accounts",
        json={"account_name": f"USD Bank {cust_id}", "bank_name": "Test Bank", "account_number": f"USD-{cust_id}", "currency": "USD", "account_type": "bank"},
        cookies=admin_cookies,
    )
    assert usd_resp.status_code == 201
    usd_acc = usd_resp.json()["id"]

    egp_resp = app_client.post(
        "/api/finance/accounts",
        json={"account_name": f"EGP Bank {cust_id}", "bank_name": "Test Bank", "account_number": f"EGP-{cust_id}", "currency": "EGP", "account_type": "bank"},
        cookies=admin_cookies,
    )
    assert egp_resp.status_code == 201
    egp_acc = egp_resp.json()["id"]

    # 3. Create Draft USD invoice: should NOT count
    inv_draft = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": cust_id,
            "invoice_number": f"INV-DRAFT-{cust_id}",
            "issue_date": "2026-08-01",
            "due_date": "2026-08-15",
            "currency": "USD",
            "expected_bank_account_id": usd_acc,
            "lines": [{"description": "Draft service", "quantity": 1, "unit_price": 5000.0}],
        },
        cookies=admin_cookies,
    ).json()

    get_cust = app_client.get(f"/api/finance/customers/{cust_id}", cookies=admin_cookies)
    assert get_cust.json()["receivables"] == []

    # Send the USD invoice: now open and overdue
    app_client.post(f"/api/finance/invoices/{inv_draft['id']}/send", cookies=admin_cookies)

    get_cust = app_client.get(f"/api/finance/customers/{cust_id}", cookies=admin_cookies)
    rec = get_cust.json()["receivables"]
    assert len(rec) == 1
    assert rec[0]["currency"] == "USD"
    assert rec[0]["open_amount"] == 5000.0
    assert rec[0]["open_count"] == 1
    assert rec[0]["overdue_count"] == 1
    assert rec[0]["max_days_overdue"] > 0

    # Customer 360 comparison
    c360 = app_client.get(f"/api/finance/customers/{cust_id}/360", cookies=admin_cookies).json()
    assert rec[0]["open_amount"] == c360["outstanding_balance"]
    assert rec[0]["open_count"] == c360["open_invoices_count"]
    assert rec[0]["overdue_count"] == c360["overdue_invoices_count"]

    # 4. Create second invoice in EGP (future due date)
    inv_egp = app_client.post(
        "/api/finance/invoices",
        json={
            "customer_id": cust_id,
            "invoice_number": f"INV-EGP-{cust_id}",
            "issue_date": "2026-10-01",
            "due_date": "2026-12-31",
            "currency": "EGP",
            "vat_rate": 0.0,
            "expected_bank_account_id": egp_acc,
            "lines": [{"description": "EGP service", "quantity": 1, "unit_price": 40000.0}],
        },
        cookies=admin_cookies,
    ).json()
    app_client.post(f"/api/finance/invoices/{inv_egp['id']}/send", cookies=admin_cookies)

    # Now returns 2 entries: EGP and USD
    get_cust = app_client.get(f"/api/finance/customers/{cust_id}", cookies=admin_cookies)
    rec = {r["currency"]: r for r in get_cust.json()["receivables"]}
    assert len(rec) == 2
    assert rec["USD"]["open_amount"] == 5000.0
    assert rec["USD"]["open_count"] == 1
    assert rec["USD"]["overdue_count"] == 1
    assert rec["EGP"]["open_amount"] == 40000.0
    assert rec["EGP"]["open_count"] == 1
    assert rec["EGP"]["overdue_count"] == 0
    assert rec["EGP"]["max_days_overdue"] == 0

    # Also verified on the list endpoint
    list_resp = app_client.get(f"/api/finance/customers?search=Receivables Test Health", cookies=admin_cookies)
    assert list_resp.status_code == 200
    listed_cust = [c for c in list_resp.json() if c["id"] == cust_id][0]
    listed_rec = {r["currency"]: r for r in listed_cust["receivables"]}
    assert listed_rec == rec

    # 5. Partially pay EGP invoice
    app_client.post(
        f"/api/finance/invoices/{inv_egp['id']}/payments",
        json={
            "direction": "incoming",
            "amount": 15000.0,
            "currency": "EGP",
            "payment_date": "2026-10-05",
            "bank_account_id": egp_acc,
            "method": "bank_transfer",
        },
        cookies=admin_cookies,
    )
    get_cust = app_client.get(f"/api/finance/customers/{cust_id}", cookies=admin_cookies)
    rec = {r["currency"]: r for r in get_cust.json()["receivables"]}
    assert rec["EGP"]["open_amount"] == 25000.0
    assert rec["EGP"]["open_count"] == 1

    # 6. Settle USD invoice in full -> USD disappears from receivables
    app_client.post(
        f"/api/finance/invoices/{inv_draft['id']}/payments",
        json={
            "direction": "incoming",
            "amount": 5000.0,
            "currency": "USD",
            "payment_date": "2026-10-05",
            "bank_account_id": usd_acc,
            "method": "bank_transfer",
        },
        cookies=admin_cookies,
    )
    get_cust = app_client.get(f"/api/finance/customers/{cust_id}", cookies=admin_cookies)
    rec = get_cust.json()["receivables"]
    assert len(rec) == 1
    assert rec[0]["currency"] == "EGP"
    assert rec[0]["open_amount"] == 25000.0


