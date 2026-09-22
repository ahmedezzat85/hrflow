"""
be/tests/test_finance_payroll_adjustments.py
Targeted unit tests for extensible payroll adjustments (Commissions and Bonuses),
recalculation of recipient and payroll totals, validation rules, and immutability.
"""
import pytest
from db import get_db_context
from models_db import EmployeeDB, EmployeeBankAccountDB
from finance.models import (
    PayrollRunDB,
    PayrollLineDB,
    PayrollAdjustmentDB,
    FinanceBankAccountDB,
    TransactionCategoryDB,
    PaymentTypeDB,
    EmployeeCompensationPlanDB,
)


@pytest.fixture
def seed_env():
    with get_db_context() as db_session:
        # Ensure bank accounts
        ext_bank = db_session.query(FinanceBankAccountDB).filter_by(account_number="EXT-BANK-01").first()
        if not ext_bank:
            ext_bank = FinanceBankAccountDB(
                account_name="Voyance Wire Bank",
                bank_name="Chase Wire",
                account_number="EXT-BANK-01",
                currency="USD",
                opening_balance=500000.0,
                current_balance=500000.0,
                is_active=True,
            )
            db_session.add(ext_bank)

        int_bank = db_session.query(FinanceBankAccountDB).filter_by(account_number="INT-CASH-01").first()
        if not int_bank:
            int_bank = FinanceBankAccountDB(
                account_name="Voyance Internal Cash",
                bank_name="Cash Drawer",
                account_number="INT-CASH-01",
                currency="USD",
                opening_balance=100000.0,
                current_balance=100000.0,
                is_active=True,
            )
            db_session.add(int_bank)

        cat = db_session.query(TransactionCategoryDB).filter_by(name="Salaries & Wages").first()
        if not cat:
            cat = TransactionCategoryDB(name="Salaries & Wages", kind="cost", is_active=True, sort_order=1)
            db_session.add(cat)

        pt = db_session.query(PaymentTypeDB).filter_by(code="OUTBOUND_TRANS").first()
        if not pt:
            pt = PaymentTypeDB(name="Bank Transfer", code="OUTBOUND_TRANS", is_active=True)
            db_session.add(pt)

        # Seed an employee with split compensation: Base EXT $10,000, Base INT $5,000
        emp = db_session.query(EmployeeDB).filter_by(email="alice.adj@voyance.health").first()
        if not emp:
            emp = EmployeeDB(
                name="Alice Adjustments",
                email="alice.adj@voyance.health",
                dept="Engineering",
                job_role="Senior Architect",
                status="active",
            )
            db_session.add(emp)
            db_session.flush()

            bank_rec = EmployeeBankAccountDB(
                employee_id=emp.id,
                bank_name="Barclays",
                iban="GB29BARC20202012345678",
                swift_code="BARCGB22",
            )
            db_session.add(bank_rec)

        # Clear prior plans and add split plans
        db_session.query(EmployeeCompensationPlanDB).filter_by(employee_id=emp.id).delete()
        p_ext = EmployeeCompensationPlanDB(
            employee_id=emp.id,
            component_type="external_usd",
            amount=10000.0,
            currency="USD",
            effective_start_date="2026-01-01",
        )
        p_int = EmployeeCompensationPlanDB(
            employee_id=emp.id,
            component_type="internal_usd_cash",
            amount=5000.0,
            currency="USD",
            effective_start_date="2026-01-01",
        )
        db_session.add_all([p_ext, p_int])
        db_session.commit()

        return {"ext_bank_id": ext_bank.id, "int_bank_id": int_bank.id, "employee_id": emp.id}


def test_payroll_adjustment_lifecycle(app_client, admin_cookies, seed_env):
    """Tests preview creation, adding INT Bonus, editing to EXT, and deleting adjustment."""
    emp_id = seed_env["employee_id"]

    # 1. Create Preview
    resp = app_client.post(
        "/api/finance/payroll/previews",
        json={
            "period_label": "2026-09",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
            "external_funding_account_id": seed_env["ext_bank_id"],
            "internal_funding_account_id": seed_env["int_bank_id"],
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 200, resp.text
    preview = resp.json()
    preview_id = preview["preview_id"]
    initial_version = preview["preview_version"]
    initial_net = preview["total_net"]

    # Recipient initial state
    recipient = next(r for r in preview["recipients"] if r["employee_id"] == emp_id)
    assert recipient["base_ext_amount"] == 10000.0
    assert recipient["base_int_amount"] == 5000.0
    assert recipient["final_payment_amount"] == 15000.0

    # 2. Add an INT Bonus of $750.00
    adj_resp = app_client.post(
        f"/api/finance/payroll/previews/{preview_id}/adjustments",
        json={
            "employee_id": emp_id,
            "type": "BONUS",
            "direction": "ADDITION",
            "amount": 750.0,
            "payment_source": "INT",
            "description": "Q3 Performance Bonus",
        },
        cookies=admin_cookies,
    )
    assert adj_resp.status_code == 201, adj_resp.text
    adj_data = adj_resp.json()
    adj_id = adj_data["id"]
    assert adj_data["amount"] == 750.0
    assert adj_data["payment_source"] == "INT"

    # 3. Check Preview Recalculation
    prev_resp = app_client.get(f"/api/finance/payroll/previews/{preview_id}", cookies=admin_cookies)
    assert prev_resp.status_code == 200
    updated_preview = prev_resp.json()
    assert updated_preview["preview_version"] == initial_version + 1
    assert updated_preview["total_bonuses"] == 750.0
    assert updated_preview["total_net"] == initial_net + 750.0

    updated_recip = next(r for r in updated_preview["recipients"] if r["employee_id"] == emp_id)
    assert updated_recip["base_int_amount"] == 5000.0
    assert updated_recip["int_adjustments_total"] == 750.0
    assert updated_recip["final_int_amount"] == 5750.0
    assert updated_recip["final_ext_amount"] == 10000.0
    assert updated_recip["final_payment_amount"] == 15750.0

    # 4. Edit adjustment: switch to EXT and change amount to $1,200.00
    edit_resp = app_client.patch(
        f"/api/finance/payroll/previews/{preview_id}/adjustments/{adj_id}",
        json={"amount": 1200.0, "payment_source": "EXT", "type": "COMMISSION"},
        cookies=admin_cookies,
    )
    assert edit_resp.status_code == 200
    edited_adj = edit_resp.json()
    assert edited_adj["amount"] == 1200.0
    assert edited_adj["payment_source"] == "EXT"
    assert edited_adj["type"] == "COMMISSION"

    prev_resp2 = app_client.get(f"/api/finance/payroll/previews/{preview_id}", cookies=admin_cookies)
    p2 = prev_resp2.json()
    recip2 = next(r for r in p2["recipients"] if r["employee_id"] == emp_id)
    assert recip2["int_adjustments_total"] == 0.0
    assert recip2["ext_adjustments_total"] == 1200.0
    assert recip2["final_int_amount"] == 5000.0
    assert recip2["final_ext_amount"] == 11200.0
    assert recip2["final_payment_amount"] == 16200.0
    assert p2["total_commissions"] == 1200.0
    assert p2["total_bonuses"] == 0.0

    # 5. Delete adjustment and verify totals revert
    del_resp = app_client.delete(f"/api/finance/payroll/previews/{preview_id}/adjustments/{adj_id}", cookies=admin_cookies)
    assert del_resp.status_code == 200

    prev_resp3 = app_client.get(f"/api/finance/payroll/previews/{preview_id}", cookies=admin_cookies)
    p3 = prev_resp3.json()
    assert p3["total_commissions"] == 0.0
    assert p3["total_net"] == initial_net
    recip3 = next(r for r in p3["recipients"] if r["employee_id"] == emp_id)
    assert recip3["final_payment_amount"] == 15000.0


def test_payroll_adjustment_validation_rules(app_client, admin_cookies, seed_env):
    """Tests validation: positive amount, unsupported type, and duplicate external references."""
    emp_id = seed_env["employee_id"]

    resp = app_client.post(
        "/api/finance/payroll/previews",
        json={
            "period_label": "2026-10",
            "period_start": "2026-10-01",
            "period_end": "2026-10-31",
            "external_funding_account_id": seed_env["ext_bank_id"],
            "internal_funding_account_id": seed_env["int_bank_id"],
        },
        cookies=admin_cookies,
    )
    preview_id = resp.json()["preview_id"]

    # Negative / zero amount should fail
    bad_amt = app_client.post(
        f"/api/finance/payroll/previews/{preview_id}/adjustments",
        json={"employee_id": emp_id, "amount": -100.0, "type": "BONUS", "payment_source": "INT"},
        cookies=admin_cookies,
    )
    assert bad_amt.status_code == 422

    # Unsupported deduction type should fail in this release
    bad_type = app_client.post(
        f"/api/finance/payroll/previews/{preview_id}/adjustments",
        json={"employee_id": emp_id, "amount": 100.0, "type": "TAX_DEDUCTION", "payment_source": "INT"},
        cookies=admin_cookies,
    )
    assert bad_type.status_code == 422

    # Duplicate external reference should return 409 Conflict
    first_ok = app_client.post(
        f"/api/finance/payroll/previews/{preview_id}/adjustments",
        json={
            "employee_id": emp_id,
            "amount": 250.0,
            "type": "BONUS",
            "payment_source": "INT",
            "external_reference": "REF-UNIQUE-999",
        },
        cookies=admin_cookies,
    )
    assert first_ok.status_code == 201

    dup = app_client.post(
        f"/api/finance/payroll/previews/{preview_id}/adjustments",
        json={
            "employee_id": emp_id,
            "amount": 300.0,
            "type": "BONUS",
            "payment_source": "INT",
            "external_reference": "REF-UNIQUE-999",
        },
        cookies=admin_cookies,
    )
    assert dup.status_code == 409


def test_payroll_run_creation_preserves_adjustments(app_client, admin_cookies, seed_env):
    """Tests that create_run attaches preview adjustments into PayrollAdjustmentDB and lines."""
    emp_id = seed_env["employee_id"]

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
    preview = resp.json()
    preview_id = preview["preview_id"]

    # Add a Sales Commission of $600.00
    app_client.post(
        f"/api/finance/payroll/previews/{preview_id}/adjustments",
        json={
            "employee_id": emp_id,
            "type": "COMMISSION",
            "direction": "ADDITION",
            "amount": 600.0,
            "payment_source": "EXT",
            "description": "November Deals Commission",
        },
        cookies=admin_cookies,
    )

    # Refresh preview
    p_updated = app_client.get(f"/api/finance/payroll/previews/{preview_id}", cookies=admin_cookies).json()

    # Create run from preview
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
    run = create_resp.json()

    assert run["total_commissions"] == 600.0
    assert len(run["adjustments"]) == 1
    assert run["adjustments"][0]["amount"] == 600.0
    assert run["adjustments"][0]["type"] == "COMMISSION"
    assert run["adjustments"][0]["payment_source"] == "EXT"


def test_source_specific_readiness_rules(app_client, admin_cookies, seed_env):
    """Verifies that INT-only employees without bank details are NOT warned, while EXT without bank details blocks."""
    with get_db_context() as db:
        # 1. INT-only employee with NO bank account
        emp_int = EmployeeDB(
            name="Ian Internal",
            email="ian.int@voyance.health",
            dept="Operations",
            job_role="Cashier",
            status="active",
        )
        db.add(emp_int)
        db.flush()
        plan_int = EmployeeCompensationPlanDB(
            employee_id=emp_int.id,
            component_type="internal_usd_cash",
            amount=3000.0,
            currency="USD",
            effective_start_date="2026-01-01",
        )
        db.add(plan_int)

        # 2. EXT-only employee with NO bank account
        emp_ext = EmployeeDB(
            name="Evan External",
            email="evan.ext@voyance.health",
            dept="Consulting",
            job_role="Advisor",
            status="active",
        )
        db.add(emp_ext)
        db.flush()
        plan_ext = EmployeeCompensationPlanDB(
            employee_id=emp_ext.id,
            component_type="external_usd",
            amount=8000.0,
            currency="USD",
            effective_start_date="2026-01-01",
        )
        db.add(plan_ext)
        db.commit()

        int_id = emp_int.id
        ext_id = emp_ext.id

    resp = app_client.post(
        "/api/finance/payroll/previews",
        json={
            "period_label": "2026-12",
            "period_start": "2026-12-01",
            "period_end": "2026-12-31",
            "external_funding_account_id": seed_env["ext_bank_id"],
            "internal_funding_account_id": seed_env["int_bank_id"],
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 200, resp.text
    preview = resp.json()

    recipients = preview["recipients"]
    ian_recip = next(r for r in recipients if r["employee_id"] == int_id)
    evan_recip = next(r for r in recipients if r["employee_id"] == ext_id)

    # Ian (INT-only) MUST NOT have any bank warnings or blockers
    assert ian_recip["readiness"]["status"] == "READY"
    assert len(ian_recip["readiness"]["issues"]) == 0

    # Evan (EXT-only) MUST have a BLOCKER for missing wire details
    assert evan_recip["readiness"]["status"] == "BLOCKER"
    assert any("wire" in issue.lower() or "bank" in issue.lower() for issue in evan_recip["readiness"]["issues"])

    # Entire preview has blocking exception due to Evan, but not due to Ian
    assert preview["has_blocking_exceptions"] is True
    exceptions = preview["exceptions"]
    assert not any(e.get("employee_id") == int_id for e in exceptions)
    assert any(e.get("employee_id") == ext_id and e.get("severity") == "blocking" for e in exceptions)


def test_stale_preview_rejection_and_immutability(app_client, admin_cookies, seed_env):
    """Verifies that stale preview version submissions are rejected with 409, maker-checker is enforced, and adjustments become immutable."""
    emp_id = seed_env["employee_id"]

    # Ensure only emp_id is active so no blocking exceptions occur from other staff
    with get_db_context() as db:
        for e in db.query(EmployeeDB).all():
            if e.id != emp_id:
                e.status = "Inactive"
            else:
                e.status = "Active"
        db.commit()

    # 1. Create preview
    prev_resp = app_client.post(
        "/api/finance/payroll/previews",
        json={
            "period_label": "2027-01",
            "period_start": "2027-01-01",
            "period_end": "2027-01-31",
            "external_funding_account_id": seed_env["ext_bank_id"],
            "internal_funding_account_id": seed_env["int_bank_id"],
        },
        cookies=admin_cookies,
    )
    assert prev_resp.status_code == 200
    p = prev_resp.json()
    preview_id = p["preview_id"]
    v1 = p["preview_version"]

    # 2. Add an adjustment (increments preview_version to v2)
    adj_resp = app_client.post(
        f"/api/finance/payroll/previews/{preview_id}/adjustments",
        json={
            "employee_id": emp_id,
            "type": "BONUS",
            "amount": 750.0,
            "payment_source": "INT",
            "description": "New year bonus",
        },
        cookies=admin_cookies,
    )
    assert adj_resp.status_code == 201
    adj_id = adj_resp.json()["id"]

    # 3. Attempt to submit with stale version v1 -> should return 409 Conflict
    stale_sub = app_client.post(
        "/api/finance/payroll/runs",
        json={
            "period_label": "2027-01",
            "period_start": "2027-01-01",
            "period_end": "2027-01-31",
            "preview_id": preview_id,
            "preview_version": v1,  # Stale!
            "submit_for_approval": True,
        },
        cookies=admin_cookies,
    )
    assert stale_sub.status_code == 409
    assert "stale" in stale_sub.json()["detail"].lower() or "changed" in stale_sub.json()["detail"].lower()

    # 4. Submit with current version (v1 + 1 = 2) -> succeeds
    ok_sub = app_client.post(
        "/api/finance/payroll/runs",
        json={
            "period_label": "2027-01",
            "period_start": "2027-01-01",
            "period_end": "2027-01-31",
            "preview_id": preview_id,
            "preview_version": v1 + 1,
            "submit_for_approval": True,
        },
        cookies=admin_cookies,
    )
    assert ok_sub.status_code == 201
    run = ok_sub.json()
    run_id = run["id"]
    assert run["status"] == "submitted"
    assert run["total_additions"] == 750.0
    assert len(run["adjustments"]) == 1
    assert run["adjustments"][0]["status"] == "SUBMITTED"

    # 5. Maker-checker enforcement: Submitter cannot approve their own run
    # (admin@hrflow.test created it, so approving as admin with allow_self_approval=False fails)
    import auth as auth_module
    import config as config_module
    submitter_token = auth_module.create_session_token("preparer@voyance.health", "admin", 99, name="Preparer")
    checker_token = auth_module.create_session_token("checker@voyance.health", "admin", 98, name="Checker")
    submitter_cookies = {config_module.Config.SESSION_COOKIE_NAME: submitter_token}
    checker_cookies = {config_module.Config.SESSION_COOKIE_NAME: checker_token}

    # Create run as preparer
    prep_prev = app_client.post(
        "/api/finance/payroll/previews",
        json={
            "period_label": "2027-02",
            "period_start": "2027-02-01",
            "period_end": "2027-02-28",
            "external_funding_account_id": seed_env["ext_bank_id"],
            "internal_funding_account_id": seed_env["int_bank_id"],
        },
        cookies=submitter_cookies,
    )
    p2_id = prep_prev.json()["preview_id"]
    p2_run = app_client.post(
        "/api/finance/payroll/runs",
        json={
            "period_label": "2027-02",
            "period_start": "2027-02-01",
            "period_end": "2027-02-28",
            "preview_id": p2_id,
            "submit_for_approval": True,
        },
        cookies=submitter_cookies,
    )
    assert p2_run.status_code == 201
    p2_run_id = p2_run.json()["id"]

    # Preparer attempts self-approval -> 400 Bad Request
    self_app = app_client.post(f"/api/finance/payroll/runs/{p2_run_id}/approve", cookies=submitter_cookies)
    assert self_app.status_code == 400
    assert "maker-checker" in self_app.json()["detail"].lower()

    # Checker approves -> 200 OK
    check_app = app_client.post(f"/api/finance/payroll/runs/{p2_run_id}/approve", cookies=checker_cookies)
    assert check_app.status_code == 200
    assert check_app.json()["status"] == "approved"

    # 6. Verify audit logs recorded
    from models_db import AuditLogDB
    with get_db_context() as db:
        logs = db.query(AuditLogDB).filter(AuditLogDB.action.like("payroll.%")).all()
        actions = [l.action for l in logs]
        assert "payroll.adjustment.created" in actions
        assert "payroll.run.submitted" in actions
        assert "payroll.run.approved" in actions


def test_export_payroll_run_csv(app_client, admin_cookies, seed_env):
    """Verifies that approved net-payment run can be exported to CSV with all required columns."""
    emp_id = seed_env["employee_id"]

    prev = app_client.post(
        "/api/finance/payroll/previews",
        json={
            "period_label": "2027-03",
            "period_start": "2027-03-01",
            "period_end": "2027-03-31",
            "external_funding_account_id": seed_env["ext_bank_id"],
            "internal_funding_account_id": seed_env["int_bank_id"],
        },
        cookies=admin_cookies,
    )
    p_id = prev.json()["preview_id"]

    # Add commission
    app_client.post(
        f"/api/finance/payroll/previews/{p_id}/adjustments",
        json={"employee_id": emp_id, "type": "COMMISSION", "amount": 1500.0, "payment_source": "EXT"},
        cookies=admin_cookies,
    )

    # Create run
    run_resp = app_client.post(
        "/api/finance/payroll/runs",
        json={
            "period_label": "2027-03",
            "period_start": "2027-03-01",
            "period_end": "2027-03-31",
            "preview_id": p_id,
            "submit_for_approval": False,
        },
        cookies=admin_cookies,
    )
    assert run_resp.status_code == 201
    run_id = run_resp.json()["id"]

    # Export CSV
    exp_resp = app_client.get(f"/api/finance/payroll/runs/{run_id}/export", cookies=admin_cookies)
    assert exp_resp.status_code == 200
    assert exp_resp.headers["content-type"].startswith("text/csv")
    csv_text = exp_resp.text
    assert "Employee ID,Employee Name,Department,Base INT,Base EXT,Commissions,Bonuses,Other Additions,Final INT,Final EXT,Final Payment,Payment Status,Payment Reference" in csv_text
    assert "Alice Adjustments" in csv_text
    assert "1500.00" in csv_text


