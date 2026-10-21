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
