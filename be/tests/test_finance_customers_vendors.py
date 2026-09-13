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
