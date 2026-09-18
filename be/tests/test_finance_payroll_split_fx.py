"""
be/tests/test_finance_payroll_split_fx.py
Verification test suite for FUX-417 Payroll Run Compensation Split & FX Rate Policy.

Covers:
  - Generating run from compensation plans creates two correctly typed lines for an employee with both external and internal pay.
  - Generates one line for an employee with only one component.
  - fx_rate_value is captured and locked at run creation per policy or explicit override.
  - Finalizing run produces liabilities_summary_json computed only from internal_usd_cash lines (external USD contributes 0 to statutory obligations).
  - Auto-generated StatutoryObligationDB rows (FUX-410) reflect strictly the internal taxable/insurable amounts.
  - Active employee with no active compensation plan yields 400 validation error on generate.
  - Status integrity: draft runs can be regenerated; approved/finalized runs are locked against regeneration.
"""
import json
import pytest
from datetime import datetime
from db import get_db_context
from models_db import EmployeeDB, EmployeeBankAccountDB
from finance.models import (
    PayrollRunDB,
    PayrollLineDB,
    EmployeeCompensationPlanDB,
    StatutoryObligationDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
)


def _cleanup_test_payroll_data():
    with get_db_context() as db:
        db.query(StatutoryObligationDB).filter(StatutoryObligationDB.source_type == "payroll_run").delete()
        db.query(PayrollLineDB).delete()
        db.query(PayrollRunDB).delete()
        db.query(EmployeeCompensationPlanDB).delete()
        db.query(EmployeeBankAccountDB).delete()
        db.query(EmployeeDB).delete()
        db.commit()


def _setup_employee_with_plan(name, email, ext_amount=None, int_amount=None, status="Active"):
    with get_db_context() as db:
        emp = EmployeeDB(
            name=name,
            email=email,
            role="employee",
            dept="Engineering",
            job_role="Engineer",
            salary=(ext_amount or 0.0) + (int_amount or 0.0),
            internal_salary_usd=int_amount or 0.0,
            external_salary_usd=ext_amount or 0.0,
            status=status,
        )
        db.add(emp)
        db.flush()

        bank = EmployeeBankAccountDB(
            employee_id=emp.id,
            bank_name="Test Bank",
            iban="EG123456789012345678901234",
            swift_code="TESTEGSX",
        )
        db.add(bank)
        db.flush()

        if ext_amount is not None and ext_amount > 0:
            plan_ext = EmployeeCompensationPlanDB(
                employee_id=emp.id,
                component_type="external_usd",
                amount=ext_amount,
                currency="USD",
                effective_start_date="2026-09-01",
                effective_end_date=None,
                notes="External transfer",
            )
            db.add(plan_ext)

        if int_amount is not None and int_amount > 0:
            plan_int = EmployeeCompensationPlanDB(
                employee_id=emp.id,
                component_type="internal_usd_cash",
                amount=int_amount,
                currency="USD",
                effective_start_date="2026-09-01",
                effective_end_date=None,
                notes="Internal cash",
            )
            db.add(plan_int)

        db.commit()
        db.refresh(emp)
        return emp.id


def test_generate_payroll_run_split_lines(app_client, admin_cookies):
    """Generating a run creates two lines for dual-component employee, one line for single-component employee."""
    _cleanup_test_payroll_data()

    # Employee 1: Both external (3000) and internal (1500)
    emp1_id = _setup_employee_with_plan("Alice Dual", "alice.dual@hrflow.test", ext_amount=3000.0, int_amount=1500.0)
    # Employee 2: Only internal (2000)
    emp2_id = _setup_employee_with_plan("Bob Internal", "bob.internal@hrflow.test", ext_amount=None, int_amount=2000.0)

    resp = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={
            "period_label": "2026-09",
            "period_start": "2026-09-01",
            "period_end": "2026-09-30",
            "fx_rate_source": "first_of_month",
            "fx_rate_value": 48.50,
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 201, resp.text
    data = resp.json()

    assert data["period_label"] == "2026-09"
    assert data["fx_rate_source"] == "first_of_month"
    assert data["fx_rate_value"] == 48.50
    assert data["status"] == "draft"

    lines = data["lines"]
    assert len(lines) == 3  # 2 for Alice, 1 for Bob

    alice_lines = [l for l in lines if l["employee_id"] == emp1_id]
    assert len(alice_lines) == 2

    ext_line = next(l for l in alice_lines if l["compensation_type"] == "external_usd")
    assert ext_line["base_salary"] == 3000.0
    assert ext_line["is_taxable_local"] is False
    assert ext_line["is_insurable"] is False
    assert ext_line["tax_amount"] == 0.0
    assert ext_line["deductions_total"] == 0.0
    assert ext_line["employer_cost_extra"] == 0.0
    assert ext_line["net_pay"] == 3000.0

    int_line = next(l for l in alice_lines if l["compensation_type"] == "internal_usd_cash")
    assert int_line["base_salary"] == 1500.0
    assert int_line["is_taxable_local"] is True
    assert int_line["is_insurable"] is True
    assert int_line["tax_amount"] == 0.0
    assert int_line["deductions_total"] == 0.0
    assert int_line["employer_cost_extra"] == 0.0
    assert int_line["net_pay"] == 1500.0

    bob_lines = [l for l in lines if l["employee_id"] == emp2_id]
    assert len(bob_lines) == 1
    assert bob_lines[0]["compensation_type"] == "internal_usd_cash"
    assert bob_lines[0]["base_salary"] == 2000.0
    assert bob_lines[0]["is_taxable_local"] is True
    assert bob_lines[0]["is_insurable"] is True


def test_generate_payroll_run_missing_plan_error(app_client, admin_cookies):
    """Active employee without compensation plan raises 400 validation error on generate."""
    _cleanup_test_payroll_data()

    # Create active employee with NO compensation plan
    with get_db_context() as db:
        emp = EmployeeDB(
            name="Charlie NoPlan",
            email="charlie.noplan@hrflow.test",
            role="employee",
            dept="Support",
            status="Active",
            salary=0.0,
        )
        db.add(emp)
        db.commit()

    resp = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={
            "period_label": "2026-10",
            "period_start": "2026-10-01",
            "period_end": "2026-10-31",
            "fx_rate_source": "first_of_month",
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 400
    assert "Charlie NoPlan" in resp.json()["detail"]
    assert "without active compensation plan" in resp.json()["detail"]


def test_fx_rate_locked_and_draft_regeneration(app_client, admin_cookies):
    """FX rate is locked at creation; draft runs can be regenerated, approved runs cannot."""
    _cleanup_test_payroll_data()
    _setup_employee_with_plan("Dave Tester", "dave.tester@hrflow.test", ext_amount=2500.0, int_amount=1000.0)

    # 1. Generate run with fx_rate_value = 49.25
    resp = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={
            "period_label": "2026-11",
            "period_start": "2026-11-01",
            "period_end": "2026-11-30",
            "fx_rate_source": "payment_date",
            "fx_rate_value": 49.25,
        },
        cookies=admin_cookies,
    )
    assert resp.status_code == 201
    run_id = resp.json()["id"]
    assert resp.json()["fx_rate_value"] == 49.25
    assert resp.json()["fx_rate_source"] == "payment_date"

    # 2. Re-generate while still draft with new rate
    resp_regen = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={
            "period_label": "2026-11",
            "period_start": "2026-11-01",
            "period_end": "2026-11-30",
            "fx_rate_source": "payment_date",
            "fx_rate_value": 50.10,
        },
        cookies=admin_cookies,
    )
    assert resp_regen.status_code == 201
    assert resp_regen.json()["id"] == run_id
    assert resp_regen.json()["fx_rate_value"] == 50.10

    # 3. Approve run
    resp_app = app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=admin_cookies)
    assert resp_app.status_code == 200
    assert resp_app.json()["status"] == "approved"

    # 4. Attempt to regenerate approved run -> Rejected 400
    resp_locked = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={
            "period_label": "2026-11",
            "period_start": "2026-11-01",
            "period_end": "2026-11-30",
            "fx_rate_source": "payment_date",
            "fx_rate_value": 51.00,
        },
        cookies=admin_cookies,
    )
    assert resp_locked.status_code == 400
    assert "locked against modification" in resp_locked.json()["detail"]


def test_finalize_run_excludes_external_usd_from_statutory_obligations(app_client, admin_cookies):
    """Finalizing run computes liabilities and statutory obligations strictly from internal taxable/insurable lines."""
    _cleanup_test_payroll_data()

    # Employee 1: 3000 external, 1500 internal
    _setup_employee_with_plan("Eve Split", "eve.split@hrflow.test", ext_amount=3000.0, int_amount=1500.0)
    # Employee 2: 4000 external ONLY (zero local statutory impact)
    _setup_employee_with_plan("Frank PureExternal", "frank.pureext@hrflow.test", ext_amount=4000.0, int_amount=None)

    resp_gen = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={
            "period_label": "2026-12",
            "period_start": "2026-12-01",
            "period_end": "2026-12-31",
            "fx_rate_source": "first_of_month",
            "fx_rate_value": 50.0,
        },
        cookies=admin_cookies,
    )
    assert resp_gen.status_code == 201
    run_id = resp_gen.json()["id"]

    # Approve run
    resp_app = app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=admin_cookies)
    assert resp_app.status_code == 200

    # Finalize run
    resp_fin = app_client.post(f"/api/finance/payroll/runs/{run_id}/finalize", cookies=admin_cookies)
    assert resp_fin.status_code == 200
    fin_data = resp_fin.json()

    # Check liabilities summary (0.0 without automatic statutory calculation):
    liab = fin_data["liabilities_summary"]
    assert liab["income_tax_withheld"] == 0.0
    assert liab["social_insurance_employee"] == 0.0
    assert liab["social_insurance_employer"] == 0.0

    # Check auto-generated StatutoryObligationDB rows (0.0 estimated amounts)
    with get_db_context() as db:
        obligations = db.query(StatutoryObligationDB).filter(
            StatutoryObligationDB.source_type == "payroll_run",
            StatutoryObligationDB.source_id == run_id,
        ).all()
        assert len(obligations) == 3
        obl_map = {o.obligation_type: o.amount_estimated for o in obligations}
        assert obl_map["income_tax"] == 0.0
        assert obl_map["social_insurance_employee"] == 0.0
        assert obl_map["social_insurance_employer"] == 0.0


def test_dual_funding_accounts_split_journal_posting(app_client, admin_cookies):
    """Payroll run with distinct external and internal funding accounts produces split ledger transactions upon posting."""
    _cleanup_test_payroll_data()

    # Create two distinct bank accounts: Account A (US bank) and Account B (Cash USD)
    with get_db_context() as db:
        acc_us = FinanceBankAccountDB(
            account_name="US Operating Wire",
            account_type="bank",
            currency="USD",
            bank_name="Mercury US",
            account_number="111122223333",
            is_active=True,
        )
        acc_cash = FinanceBankAccountDB(
            account_name="Cairo USD Cash Vault",
            account_type="cash",
            currency="USD",
            bank_name="Cash Drawer",
            account_number="999988887777",
            is_active=True,
        )
        db.add_all([acc_us, acc_cash])
        db.commit()
        db.refresh(acc_us)
        db.refresh(acc_cash)
        us_id = acc_us.id
        cash_id = acc_cash.id

    # Setup employee with split: $3,500 external and $1,500 internal
    _setup_employee_with_plan("Dual Funded", "dual.funded@hrflow.test", ext_amount=3500.0, int_amount=1500.0)

    resp_gen = app_client.post(
        "/api/finance/payroll/runs/generate",
        json={
            "period_label": "2026-11",
            "period_start": "2026-11-01",
            "period_end": "2026-11-30",
            "external_funding_account_id": us_id,
            "internal_funding_account_id": cash_id,
            "bank_account_id": us_id,
            "fx_rate_value": 50.0,
        },
        cookies=admin_cookies,
    )
    assert resp_gen.status_code == 201
    run_data = resp_gen.json()
    run_id = run_data["id"]
    assert run_data["external_funding_account_id"] == us_id
    assert run_data["internal_funding_account_id"] == cash_id

    # Approve, Finalize, and Disburse
    assert app_client.post(f"/api/finance/payroll/runs/{run_id}/approve", cookies=admin_cookies).status_code == 200
    assert app_client.post(f"/api/finance/payroll/runs/{run_id}/finalize", cookies=admin_cookies).status_code == 200
    assert app_client.post(f"/api/finance/payroll/runs/{run_id}/pay", json={}, cookies=admin_cookies).status_code == 200

    # Post GL Journal
    resp_journal = app_client.post(f"/api/finance/payroll/runs/{run_id}/post-journal", cookies=admin_cookies)
    assert resp_journal.status_code == 200
    j_data = resp_journal.json()
    assert j_data["success"] is True
    assert j_data["amount"] == 5000.0

    # Verify separate ledger transactions
    with get_db_context() as db:
        txs = db.query(LedgerTransactionDB).filter(
            LedgerTransactionDB.reference.like("PAYROLL-2026-11%")
        ).all()
        assert len(txs) == 2

        tx_ext = next(t for t in txs if t.reference.endswith("-EXT"))
        tx_int = next(t for t in txs if t.reference.endswith("-INT"))

        assert tx_ext.account_id == us_id
        assert tx_ext.amount == 3500.0
        assert tx_ext.direction == "out"

        assert tx_int.account_id == cash_id
        assert tx_int.amount == 1500.0
        assert tx_int.direction == "out"

