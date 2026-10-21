"""
be/tests/employee_test_helpers.py
Shared pieces for tests that create employees through POST /api/employees.

Creating an employee requires the personal details (D-035): legal name, phone and address line 1.
Spread PERSONAL into the payload: {**PERSONAL, "name": ..., "email": ...}.
"""

PERSONAL = {
    "legal_name": "Test Person Full Legal Name",
    "phone": "+201001234567",
    "address_line_1": "1 Test Street",
}


def set_pay(app_client, cookies, emp_id, internal=0.0, external=0.0, start="2026-01-01", notes="test pay"):
    """
    Give an employee a pay plan through the Pay plan endpoint (the only way pay is set, D-035).
    Does nothing when both amounts are 0 (an employee may have no plan).
    """
    if not internal and not external:
        return None
    resp = app_client.put(
        f"/api/finance/employees/{emp_id}/compensation-plan",
        json={"effective_start_date": start, "internal_usd_cash": internal, "external_usd": external, "notes": notes},
        cookies=cookies,
    )
    assert resp.status_code == 200, resp.text
    return resp
