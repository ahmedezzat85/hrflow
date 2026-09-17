"""
be/tests/test_finance_payment_types_fux409.py
Verification for FUX-409: Standard payment-method naming, settings integrity, and bank fee flag.
"""
import pytest


def test_payment_types_standard_names(app_client, admin_cookies):
    """Verify that all default payment types have standard accounting/banking names."""
    res = app_client.get("/api/finance/payment-types", cookies=admin_cookies)
    assert res.status_code == 200, res.text
    types = res.json()
    assert len(types) >= 9

    type_by_code = {t["code"]: t for t in types}

    # Expected mappings per FUX-409
    expected = {
        "CASHWITHDRAW": "ATM Withdrawal",
        "CHK": "Check Payment",
        "INTTRANS": "Internal Transfer",
        "INBOUND_TRANS": "Incoming Transfer",
        "CASH": "Cash Payment",
        "DEBIT_CARD": "Debit Card Payment",
        "USDTOEGP": "Currency Exchange",
        "OUTBOUND_TRANS": "Outgoing Transfer",
        "BANK_FEES": "Bank Fee",
    }

    for code, expected_name in expected.items():
        assert code in type_by_code, f"Payment type code {code} missing from response"
        assert type_by_code[code]["name"] == expected_name, (
            f"Code {code} has name '{type_by_code[code]['name']}', expected '{expected_name}'"
        )

    # Check Bank Fee flag
    assert type_by_code["BANK_FEES"]["requires_bank_fee_flag"] is True
    assert type_by_code["CASH"]["requires_bank_fee_flag"] is False


def test_payment_types_add_and_update(app_client, admin_cookies):
    """Verify custom payment type creation, update, and deactivation work."""
    create_res = app_client.post(
        "/api/finance/payment-types",
        json={
            "name": "Corporate Amex",
            "code": "CORP_AMEX_CUSTOM",
            "requires_cheque_number": False,
            "requires_bank_fee_flag": False,
            "is_active": True,
        },
        cookies=admin_cookies,
    )
    assert create_res.status_code == 201, create_res.text
    pt = create_res.json()
    pt_id = pt["id"]
    assert pt["name"] == "Corporate Amex"
    assert pt["code"] == "CORP_AMEX_CUSTOM"

    # Update name and deactivation via PATCH
    up_res = app_client.patch(
        f"/api/finance/payment-types/{pt_id}",
        json={
            "name": "Corporate Amex Green",
            "is_active": False,
        },
        cookies=admin_cookies,
    )
    assert up_res.status_code == 200, up_res.text
    updated = up_res.json()
    assert updated["name"] == "Corporate Amex Green"
    assert updated["is_active"] is False
