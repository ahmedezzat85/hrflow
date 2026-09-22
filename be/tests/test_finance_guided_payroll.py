"""
be/tests/test_finance_guided_payroll.py
Unit tests for Story 8.1 Guided Payroll Run:
Readiness exceptions, maker-checker approval, finalization lock,
partial payment failure recovery, GL journal posting, and employee payslips.
"""
import pytest
from datetime import datetime
from fastapi.testclient import TestClient

from models_db import EmployeeDB, EmployeeBankAccountDB, UserDB
from finance.models import (
    PayrollRunDB,
    PayrollLineDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
    TransactionCategoryDB,
    PaymentTypeDB,
    EmployeeCompensationPlanDB,
)
from db import get_session_factory


@pytest.fixture
def db_session():
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def seed_payroll_env(db_session):
    """Seeds test bank account, categories, and employees for payroll runs."""
    # Ensure bank account
    bank = db_session.query(FinanceBankAccountDB).filter_by(account_number="CHASE-PAY-01").first()
    if not bank:
        bank = FinanceBankAccountDB(
            account_name="JPMorgan Chase Payroll",
            bank_name="JPMorgan Chase",
            account_number="CHASE-PAY-01",
            currency="USD",
            opening_balance=250000.0,
            current_balance=250000.0,
            is_active=True,
        )
        db_session.add(bank)
        db_session.flush()

    # Ensure transaction category
    cat = db_session.query(TransactionCategoryDB).filter_by(name="Salaries & Wages").first()
    if not cat:
        cat = TransactionCategoryDB(name="Salaries & Wages", kind="cost", is_active=True, sort_order=1)
        db_session.add(cat)

    # Ensure payment type
    pt = db_session.query(PaymentTypeDB).filter_by(code="OUTBOUND_TRANS").first()
    if not pt:
        pt = PaymentTypeDB(name="Outbound Wire", code="OUTBOUND_TRANS", is_active=True)
        db_session.add(pt)

    # Clean existing payroll runs & test employees
    db_session.query(PayrollLineDB).delete()
    db_session.query(PayrollRunDB).delete()
    db_session.query(EmployeeCompensationPlanDB).delete()
    db_session.query(EmployeeBankAccountDB).delete()
    db_session.query(EmployeeDB).filter(EmployeeDB.email.like("%@payrolltest.com")).delete()
    for emp in db_session.query(EmployeeDB).all():
        emp.status = "Inactive"
    db_session.commit()

    # Create 3 test employees:
    # 1. Clean employee with verified bank details and active compensation plan
    e1 = EmployeeDB(
        name="Alice Engineer",
        email="alice@payrolltest.com",
        role="employee",
        dept="Engineering",
        salary=10000.0,
        status="Active",
    )
    db_session.add(e1)
    db_session.flush()

    b1 = EmployeeBankAccountDB(
        employee_id=e1.id,
        bank_name="Chase",
        iban="US99CHAS021000021987654321",
    )
    db_session.add(b1)

    p1 = EmployeeCompensationPlanDB(
        employee_id=e1.id,
        component_type="internal_usd_cash",
        amount=10000.0,
        currency="USD",
        effective_start_date="2026-01-01",
    )
    db_session.add(p1)

    # 2. Employee missing bank account (triggers blocking exception) with active compensation plan
    e2 = EmployeeDB(
        name="Bob Designer",
        email="bob@payrolltest.com",
        role="employee",
        dept="Product",
        salary=8000.0,
        status="Active",
    )
    db_session.add(e2)
    db_session.flush()

    p2 = EmployeeCompensationPlanDB(
        employee_id=e2.id,
        component_type="external_usd",
        amount=8000.0,
        currency="USD",
        effective_start_date="2026-01-01",
    )
    db_session.add(p2)

    # 3. Employee without compensation plan (triggers blocking exception)
    e3 = EmployeeDB(
        name="Charlie Intern",
        email="charlie@payrolltest.com",
        role="employee",
        dept="Operations",
        salary=0.0,
        status="Active",
    )
    db_session.add(e3)
    db_session.flush()

    b3 = EmployeeBankAccountDB(
        employee_id=e3.id,
        bank_name="Wells Fargo",
        iban="US44WELL121140399123456789",
    )
    db_session.add(b3)
    db_session.commit()

    return {
        "bank_id": bank.id,
        "emp1_id": e1.id,
        "emp2_id": e2.id,
        "emp3_id": e3.id,
    }


def test_payroll_preview_and_exception_detection(app_client, admin_cookies, seed_payroll_env):
    """Verifies that payroll preview computes totals, identifies blocking exceptions, and previews GL journal."""
    res = app_client.post(
        "/api/finance/payroll/runs/preview",
        json={
            "period_label": "2026-09",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
            "bank_account_id": seed_payroll_env["bank_id"],
        },
        cookies=admin_cookies,
    )
    assert res.status_code == 200
    data = res.json()

    assert data["period_label"] == "2026-09"
    assert data["headcount"] == 3
    assert data["total_net"] == 18000.0  # 10000 + 8000 + 0

    # Verify blocking exceptions are detected
    assert data["has_blocking_exceptions"] is True
    excs = data["exceptions"]
    assert len(excs) >= 2
    titles = [e["title"] for e in excs]
    assert "Missing Bank Wire Details" in titles
    assert "No Active Compensation Plan" in titles

    bank_exc = next(e for e in excs if e["title"] == "Missing Bank Wire Details")
    assert bank_exc["severity"] == "blocking"
    plan_exc = next(e for e in excs if e["title"] == "No Active Compensation Plan")
    assert plan_exc["severity"] == "blocking"


def test_payroll_approval_blocked_by_exceptions(app_client, admin_cookies, seed_payroll_env):
    """Verifies that an attempt to approve a payroll run with unresolved blocking exceptions is rejected."""
    # Create draft run
    create_res = app_client.post(
        "/api/finance/payroll/runs",
        json={
            "period_label": "2026-09",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
            "bank_account_id": seed_payroll_env["bank_id"],
        },
        cookies=admin_cookies,
    )
    assert create_res.status_code == 201
    run_id = create_res.json()["id"]

    # Attempt to approve
    app_res = app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=admin_cookies)
    assert app_res.status_code == 400
    assert "blocking exception" in app_res.json()["detail"].lower()


def test_payroll_approval_allowed_with_warning_only_exceptions(app_client, admin_cookies, db_session, seed_payroll_env):
    """Verifies that non-blocking warnings do not prevent payroll creation or approval."""
    # Resolve Charlie's missing plan and Bob's missing bank account so no blockers remain
    p3 = EmployeeCompensationPlanDB(
        employee_id=seed_payroll_env["emp3_id"],
        component_type="internal_usd_cash",
        amount=2500.0,
        currency="USD",
        effective_start_date="2026-01-01",
    )
    db_session.add(p3)
    b2 = EmployeeBankAccountDB(
        employee_id=seed_payroll_env["emp2_id"],
        bank_name="Chase",
        iban="US12CHAS021000021111222333",
    )
    db_session.add(b2)
    prior_run = PayrollRunDB(
        period_label="2026-10",
        period_start="2026-10-01",
        period_end="2026-10-31",
        payment_date="2026-10-31",
        status="approved",
        headcount=3,
        total_net=50000.0,
    )
    db_session.add(prior_run)
    db_session.commit()

    # Preview run - should have no blocking exceptions but should have a warning (LARGE_VARIANCE)
    prev_res = app_client.post(
        "/api/finance/payroll/runs/preview",
        json={
            "period_label": "2026-11",
            "period_start": "2026-11-01",
            "period_end": "2026-11-30",
            "bank_account_id": seed_payroll_env["bank_id"],
        },
        cookies=admin_cookies,
    )
    assert prev_res.status_code == 200
    prev_data = prev_res.json()
    assert prev_data["has_blocking_exceptions"] is False
    assert any(e["severity"] == "warning" for e in prev_data["exceptions"])

    # Create run and approve - should succeed
    create_res = app_client.post(
        "/api/finance/payroll/runs",
        json={
            "period_label": "2026-11",
            "period_start": "2026-11-01",
            "period_end": "2026-11-30",
            "bank_account_id": seed_payroll_env["bank_id"],
        },
        cookies=admin_cookies,
    )
    assert create_res.status_code == 201
    run_id = create_res.json()["id"]

    app_res = app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=admin_cookies)
    assert app_res.status_code == 200
    assert app_res.json()["status"] == "approved"


def test_payroll_approval_finalization_immutability(app_client, admin_cookies, db_session, seed_payroll_env):
    """Resolves exceptions, tests maker-checker approval, and verifies finalization lock."""
    # Resolve exceptions by adding bank account for Bob and salary/compensation plan for Charlie
    b2 = EmployeeBankAccountDB(
        employee_id=seed_payroll_env["emp2_id"],
        bank_name="Chase",
        iban="US55CHAS123456789012345678",
    )
    db_session.add(b2)
    charlie = db_session.query(EmployeeDB).filter_by(id=seed_payroll_env["emp3_id"]).first()
    charlie.salary = 3000.0
    p3 = EmployeeCompensationPlanDB(
        employee_id=seed_payroll_env["emp3_id"],
        component_type="internal_usd_cash",
        amount=3000.0,
        currency="USD",
        effective_start_date="2026-01-01",
    )
    db_session.add(p3)
    db_session.commit()

    # Create clean run
    create_res = app_client.post(
        "/api/finance/payroll/runs",
        json={
            "period_label": "2026-10",
            "period_start": "2026-10-01",
            "period_end": "2026-10-31",
            "bank_account_id": seed_payroll_env["bank_id"],
        },
        cookies=admin_cookies,
    )
    assert create_res.status_code == 201
    run_id = create_res.json()["id"]
    assert create_res.json()["status"] == "draft"

    # Approve run
    app_res = app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=admin_cookies)
    assert app_res.status_code == 200
    assert app_res.json()["status"] == "approved"
    assert app_res.json()["approved_at"] is not None

    # Finalize run
    fin_res = app_client.post(f"/api/finance/payroll/runs/{run_id}/finalize", cookies=admin_cookies)
    assert fin_res.status_code == 200
    assert fin_res.json()["status"] == "finalized"
    assert fin_res.json()["finalized_at"] is not None


def test_payroll_partial_payment_recovery(app_client, admin_cookies, db_session, seed_payroll_env):
    """Tests payment disbursement with simulated partial failure, followed by successful recovery."""
    # Ensure all 3 employees are clean
    b2 = EmployeeBankAccountDB(
        employee_id=seed_payroll_env["emp2_id"],
        bank_name="Chase",
        iban="US55CHAS123456789012345678",
    )
    db_session.add(b2)
    charlie = db_session.query(EmployeeDB).filter_by(id=seed_payroll_env["emp3_id"]).first()
    charlie.salary = 3000.0
    p3 = EmployeeCompensationPlanDB(
        employee_id=seed_payroll_env["emp3_id"],
        component_type="internal_usd_cash",
        amount=3000.0,
        currency="USD",
        effective_start_date="2026-01-01",
    )
    db_session.add(p3)
    db_session.commit()

    # Create, approve, and finalize run
    create_res = app_client.post(
        "/api/finance/payroll/runs",
        json={
            "period_label": "2026-11",
            "period_start": "2026-11-01",
            "period_end": "2026-11-30",
            "bank_account_id": seed_payroll_env["bank_id"],
        },
        cookies=admin_cookies,
    )
    run_id = create_res.json()["id"]
    app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=admin_cookies)
    app_client.post(f"/api/finance/payroll/runs/{run_id}/finalize", cookies=admin_cookies)

    # 1. Execute payment with simulated failure on emp2
    pay_res = app_client.post(
        f"/api/finance/payroll/runs/{run_id}/pay",
        json={
            "bank_account_id": seed_payroll_env["bank_id"],
            "simulate_partial_failure_ids": [seed_payroll_env["emp2_id"]],
        },
        cookies=admin_cookies,
    )
    assert pay_res.status_code == 200
    pay_data = pay_res.json()
    assert pay_data["status"] == "partially_paid"

    lines = pay_data["lines"]
    emp2_line = next(l for l in lines if l["employee_id"] == seed_payroll_env["emp2_id"])
    assert emp2_line["payment_status"] == "failed"
    assert emp2_line["failure_reason"] is not None

    emp1_line = next(l for l in lines if l["employee_id"] == seed_payroll_env["emp1_id"])
    assert emp1_line["payment_status"] == "paid"

    # 2. Retry failed payment only
    retry_res = app_client.post(
        f"/api/finance/payroll/runs/{run_id}/pay",
        json={
            "bank_account_id": seed_payroll_env["bank_id"],
            "retry_failed_only": True,
        },
        cookies=admin_cookies,
    )
    assert retry_res.status_code == 200
    retry_data = retry_res.json()
    assert retry_data["status"] == "paid"
    assert all(l["payment_status"] == "paid" for l in retry_data["lines"])


def test_payroll_gl_journal_posting_and_payslips(app_client, admin_cookies, employee_cookies, db_session, seed_payroll_env):
    """Tests balanced GL journal posting and employee self-service payslip retrieval."""
    # Ensure clean employee 1
    charlie = db_session.query(EmployeeDB).filter_by(id=seed_payroll_env["emp3_id"]).first()
    charlie.salary = 3000.0
    p3 = EmployeeCompensationPlanDB(
        employee_id=seed_payroll_env["emp3_id"],
        component_type="internal_usd_cash",
        amount=3000.0,
        currency="USD",
        effective_start_date="2026-01-01",
    )
    db_session.add(p3)
    b2 = EmployeeBankAccountDB(
        employee_id=seed_payroll_env["emp2_id"],
        bank_name="Chase",
        iban="US55CHAS123456789012345678",
    )
    db_session.add(b2)
    db_session.commit()

    create_res = app_client.post(
        "/api/finance/payroll/runs",
        json={
            "period_label": "2026-12",
            "period_start": "2026-12-01",
            "period_end": "2026-12-31",
            "bank_account_id": seed_payroll_env["bank_id"],
        },
        cookies=admin_cookies,
    )
    run_id = create_res.json()["id"]
    app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=admin_cookies)
    app_client.post(f"/api/finance/payroll/runs/{run_id}/finalize", cookies=admin_cookies)
    app_client.post(f"/api/finance/payroll/runs/{run_id}/pay", json={}, cookies=admin_cookies)

    # Post GL journal
    journal_res = app_client.post(f"/api/finance/payroll/runs/{run_id}/post-journal", cookies=admin_cookies)
    assert journal_res.status_code == 200
    j_data = journal_res.json()
    assert j_data["success"] is True
    assert j_data["journal_transaction_id"] is not None

    # Verify idempotency
    journal_res2 = app_client.post(f"/api/finance/payroll/runs/{run_id}/post-journal", cookies=admin_cookies)
    assert journal_res2.status_code == 200
    assert journal_res2.json()["is_already_posted"] is True

    # Employee payslip check
    ps_res = app_client.get(f"/api/finance/payroll/runs/{run_id}/payslips/{seed_payroll_env['emp1_id']}", cookies=admin_cookies)
    assert ps_res.status_code == 200
    ps_data = ps_res.json()
    assert ps_data["employee_name"] == "Alice Engineer"
    assert ps_data["net_pay"] == 10000.0
    assert ps_data["amount"] == 10000.0
    assert ps_data["status"] == "paid"


def test_maker_checker_segregation_blocks_self_approval(app_client, admin_cookies, db_session, seed_payroll_env):
    """Verifies that the user who submitted a payroll run cannot approve it."""
    # Ensure all 3 employees are clean
    b2 = EmployeeBankAccountDB(
        employee_id=seed_payroll_env["emp2_id"],
        bank_name="Chase",
        iban="US55CHAS123456789012345678",
    )
    db_session.add(b2)
    charlie = db_session.query(EmployeeDB).filter_by(id=seed_payroll_env["emp3_id"]).first()
    charlie.salary = 3000.0
    p3 = EmployeeCompensationPlanDB(
        employee_id=seed_payroll_env["emp3_id"],
        component_type="internal_usd_cash",
        amount=3000.0,
        currency="USD",
        effective_start_date="2026-01-01",
    )
    db_session.add(p3)
    db_session.commit()

    # Create run
    create_res = app_client.post(
        "/api/finance/payroll/runs",
        json={
            "period_label": "2026-08",
            "period_start": "2026-08-01",
            "period_end": "2026-08-31",
            "bank_account_id": seed_payroll_env["bank_id"],
        },
        cookies=admin_cookies,
    )
    assert create_res.status_code == 201
    run_id = create_res.json()["id"]

    # Submit run by admin
    sub_res = app_client.post(f"/api/finance/payroll/runs/{run_id}/submit", cookies=admin_cookies)
    assert sub_res.status_code == 200
    assert sub_res.json()["status"] == "submitted"
    assert sub_res.json()["submitted_by"] == "admin@hrflow.test"

    # Admin attempts to self-approve - must be rejected with 400 Maker-checker violation
    app_res = app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=admin_cookies)
    assert app_res.status_code == 400
    assert "maker-checker" in app_res.json()["detail"].lower()


def test_payroll_preview_blocking_exception_for_missing_plan(app_client, admin_cookies, db_session, seed_payroll_env):
    """Verifies that employees without compensation plans produce blocking exceptions and no preview lines."""
    res = app_client.post(
        "/api/finance/payroll/runs/preview",
        json={
            "period_label": "2026-09",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
            "bank_account_id": seed_payroll_env["bank_id"],
        },
        cookies=admin_cookies,
    )
    assert res.status_code == 200
    data = res.json()

    # Charlie has no compensation plan, so should have blocking exception
    charlie_exc = [e for e in data["exceptions"] if e["employee_id"] == seed_payroll_env["emp3_id"]]
    assert len(charlie_exc) == 1
    assert charlie_exc[0]["severity"] == "blocking"
    assert charlie_exc[0]["title"] == "No Active Compensation Plan"

    # Charlie should NOT have any lines computed (no flat fallback formula)
    charlie_lines = [l for l in data["lines"] if l["employee_id"] == seed_payroll_env["emp3_id"]]
    assert len(charlie_lines) == 0

    # Alice and Bob have plans, so their lines exist
    alice_lines = [l for l in data["lines"] if l["employee_id"] == seed_payroll_env["emp1_id"]]
    bob_lines = [l for l in data["lines"] if l["employee_id"] == seed_payroll_env["emp2_id"]]
    assert len(alice_lines) == 1
    assert len(bob_lines) == 1
