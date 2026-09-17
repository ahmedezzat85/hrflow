"""Contract tests for Finance data table query parameters (Story 1.2).

Validates that invalid sort, filter, pagination (limit/offset) parameters are
strictly rejected by the API with appropriate HTTP status codes (400 Bad Request,
422 Unprocessable Entity) and clear error messages.
"""

import pytest
from fastapi.testclient import TestClient
from main import app


def test_invoices_query_contract_invalid_status(app_client, admin_cookies):
    """Passing an unknown invoice status returns 400 Bad Request."""
    res = app_client.get("/api/finance/invoices?status=bogus_status", cookies=admin_cookies)
    assert res.status_code == 400
    assert "Invalid status" in res.json().get("detail", "")


def test_invoices_query_contract_invalid_pagination(app_client, admin_cookies):
    """Passing invalid limit or offset returns 422 Unprocessable Entity."""
    # limit < 1
    res_zero_limit = app_client.get("/api/finance/invoices?limit=0", cookies=admin_cookies)
    assert res_zero_limit.status_code == 422

    # limit > 100
    res_huge_limit = app_client.get("/api/finance/invoices?limit=500", cookies=admin_cookies)
    assert res_huge_limit.status_code == 422

    # negative offset
    res_neg_offset = app_client.get("/api/finance/invoices?offset=-5", cookies=admin_cookies)
    assert res_neg_offset.status_code == 422


def test_bills_query_contract_invalid_status(app_client, admin_cookies):
    """Passing an unknown bill status returns 400 Bad Request."""
    res = app_client.get("/api/finance/bills?status=bogus_status", cookies=admin_cookies)
    assert res.status_code == 400
    assert "Invalid status" in res.json().get("detail", "")


def test_bills_query_contract_invalid_pagination(app_client, admin_cookies):
    """Passing invalid limit or offset for bills returns 422 Unprocessable Entity."""
    res_zero_limit = app_client.get("/api/finance/bills?limit=0", cookies=admin_cookies)
    assert res_zero_limit.status_code == 422

    res_huge_limit = app_client.get("/api/finance/bills?limit=250", cookies=admin_cookies)
    assert res_huge_limit.status_code == 422

    res_neg_offset = app_client.get("/api/finance/bills?offset=-1", cookies=admin_cookies)
    assert res_neg_offset.status_code == 422


def test_valid_table_queries(app_client, admin_cookies):
    """Valid filters and pagination are accepted with 200 OK."""
    res_inv = app_client.get("/api/finance/invoices?status=draft&limit=10&offset=0", cookies=admin_cookies)
    assert res_inv.status_code == 200
    assert isinstance(res_inv.json(), list)

    res_bills = app_client.get("/api/finance/bills?status=unpaid&limit=25&offset=0", cookies=admin_cookies)
    assert res_bills.status_code == 200
    assert isinstance(res_bills.json(), list)

