"""
be/tests/test_employee_pay_verification.py
BE-0 Verification test:
Creates a payroll run with one commission and one bonus adjustment,
persists it through the normal service path, and asserts how the persisted lines look
(compensation type and which field holds the amount).
"""
import pytest
from db import get_db_context
from finance.models import PayrollLineDB, PayrollRunDB
from test_finance_payroll_adjustments import seed_env  # reuse fixture


def test_be0_payroll_run_with_commission_and_bonus_lines(app_client, admin_cookies, seed_env):
    emp_id = seed_env["employee_id"]

    # 1. Create preview
    resp = app_client.post(
        "/api/finance/payroll/previews",
        json={
            "period_label": "2026-11",
            "period_start": "2026-11-01",
            "period_end": "2026-11-30",
            "external_funding_account_id": seed_env["ext_bank_id"],
            "internal_funding_account_id": seed_env["int_bank_id"],
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 200, resp.text
    preview = resp.json()
    preview_id = preview["preview_id"]

    # 2. Add COMMISSION adjustment ($600)
    resp_comm = app_client.post(
        f"/api/finance/payroll/previews/{preview_id}/adjustments",
        json={
            "employee_id": emp_id,
            "type": "COMMISSION",
            "direction": "ADDITION",
            "amount": 600.0,
            "payment_source": "EXT",
            "description": "Sales Commission Nov",
        },
        cookies=admin_cookies,
    )
    assert resp_comm.status_code in (200, 201), resp_comm.text

    # 3. Add BONUS adjustment ($400)
    resp_bonus = app_client.post(
        f"/api/finance/payroll/previews/{preview_id}/adjustments",
        json={
            "employee_id": emp_id,
            "type": "BONUS",
            "direction": "ADDITION",
            "amount": 400.0,
            "payment_source": "INT",
            "description": "Year-end Bonus",
        },
        cookies=admin_cookies,
    )
    assert resp_bonus.status_code in (200, 201), resp_bonus.text

    # 4. Refresh preview
    p_updated = app_client.get(f"/api/finance/payroll/previews/{preview_id}", cookies=admin_cookies).json()

    # 5. Create run from preview
    create_resp = app_client.post(
        "/api/finance/payroll/runs",
        json={
            "period_label": "2026-11",
            "period_start": "2026-11-01",
            "period_end": "2026-11-30",
            "external_funding_account_id": seed_env["ext_bank_id"],
            "internal_funding_account_id": seed_env["int_bank_id"],
            "preview_id": preview_id,
            "preview_version": p_updated["preview_version"],
            "source_version": p_updated["source_version"],
        },
        cookies=admin_cookies,
    )
    assert create_resp.status_code == 201, create_resp.text
    run_data = create_resp.json()
    run_id = run_data["id"]

    # 6. Check persisted PayrollLineDB rows
    with get_db_context() as db:
        lines = (
            db.query(PayrollLineDB)
            .filter(PayrollLineDB.payroll_run_id == run_id)
            .order_by(PayrollLineDB.id.asc())
            .all()
        )
        line_dicts = [
            {
                "id": l.id,
                "employee_id": l.employee_id,
                "compensation_type": l.compensation_type,
                "base_salary": l.base_salary,
                "allowances_total": l.allowances_total,
                "deductions_total": l.deductions_total,
                "net_pay": l.net_pay,
            }
            for l in lines
        ]

    # Find the commission and bonus lines
    comm_lines = [l for l in line_dicts if "commission" in l["compensation_type"].lower()]
    bonus_lines = [l for l in line_dicts if "bonus" in l["compensation_type"].lower()]
    base_ext_lines = [l for l in line_dicts if l["compensation_type"] == "external_usd"]
    base_int_lines = [l for l in line_dicts if l["compensation_type"] == "internal_usd_cash"]

    print("ALL PERSISTED LINES:", line_dicts)

    assert len(comm_lines) == 1, f"Expected 1 commission line, got: {comm_lines}"
    assert comm_lines[0]["compensation_type"] == "commission_sales"
    assert comm_lines[0]["base_salary"] == 600.0
    assert comm_lines[0]["net_pay"] == 600.0
    assert comm_lines[0]["allowances_total"] == 0.0

    assert len(bonus_lines) == 1, f"Expected 1 bonus line, got: {bonus_lines}"
    assert bonus_lines[0]["compensation_type"] == "bonus"
    assert bonus_lines[0]["base_salary"] == 400.0
    assert bonus_lines[0]["net_pay"] == 400.0
    assert bonus_lines[0]["allowances_total"] == 0.0

    assert len(base_ext_lines) == 1
    assert base_ext_lines[0]["base_salary"] == 10000.0
    assert len(base_int_lines) == 1
    assert base_int_lines[0]["base_salary"] == 5000.0


def test_be0_adhoc_commission_support_line_persistence(app_client, admin_cookies, seed_env):
    emp_id = seed_env["employee_id"]

    # 1. Create a draft run
    create_resp = app_client.post(
        "/api/finance/payroll/runs",
        json={
            "period_label": "2026-12",
            "period_start": "2026-12-01",
            "period_end": "2026-12-31",
            "external_funding_account_id": seed_env["ext_bank_id"],
            "internal_funding_account_id": seed_env["int_bank_id"],
        },
        cookies=admin_cookies,
    )
    assert create_resp.status_code == 201, create_resp.text
    run_id = create_resp.json()["id"]

    # 2. Add an ad-hoc line with commission_support
    add_resp = app_client.post(
        f"/api/finance/payroll/runs/{run_id}/lines",
        json={
            "employee_id": emp_id,
            "compensation_type": "commission_support",
            "amount": 250.0,
            "notes": "Support commission",
        },
        cookies=admin_cookies,
    )
    assert add_resp.status_code in (200, 201), add_resp.text

    # 3. Check line in db
    with get_db_context() as db:
        adhoc_line = (
            db.query(PayrollLineDB)
            .filter(
                PayrollLineDB.payroll_run_id == run_id,
                PayrollLineDB.compensation_type == "commission_support",
            )
            .first()
        )
        assert adhoc_line is not None
        assert adhoc_line.compensation_type == "commission_support"
        assert adhoc_line.base_salary == 250.0
        assert adhoc_line.net_pay == 250.0
        assert adhoc_line.allowances_total == 0.0

