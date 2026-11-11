"""
be/tests/test_payroll_revert_to_draft.py
A submitted, approved or finalized payroll run can be sent back to draft on the server (not only on screen),
so edits are accepted again. Once payment has started it can no longer be reverted.
"""
from db import get_db_context
from finance.models import PayrollRunDB
from models_db import AuditLogDB
from test_finance_payroll_posting import RUNS, _account, _finalized_run
from test_finance_payroll_split_fx import _cleanup_test_payroll_data, _setup_employee_with_plan


def _run(run_id):
    with get_db_context() as db:
        r = db.query(PayrollRunDB).filter(PayrollRunDB.id == run_id).first()
        return {"status": r.status, "approved_by": r.approved_by, "finalized_by": r.finalized_by, "finalized_at": r.finalized_at}


def test_finalized_run_reverts_to_draft_and_accepts_edits_again(app_client, admin_cookies):
    _cleanup_test_payroll_data()
    bank = _account("RV Bank A", "USD", "bank", 10000.0)
    _setup_employee_with_plan("Revert Emp", "revert.emp@hrflow.test", ext_amount=1000.0)
    run_id = _finalized_run(app_client, admin_cookies, "2027-05", ext_id=bank, int_id=bank, bank_id=bank)
    assert _run(run_id)["status"] == "finalized"
    # a finalized run refuses edits
    assert app_client.post(f"{RUNS}/{run_id}/refresh", cookies=admin_cookies).status_code == 400

    resp = app_client.post(f"{RUNS}/{run_id}/revert-to-draft", json={"reason": "Wrong bonus entered"}, cookies=admin_cookies)
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "draft"
    saved = _run(run_id)
    assert saved["status"] == "draft" and saved["approved_by"] is None and saved["finalized_by"] is None and saved["finalized_at"] is None

    # it is persisted (a reload still sees a draft), editable, and can go through approval again
    assert app_client.get(f"{RUNS}/{run_id}", cookies=admin_cookies).json()["status"] == "draft"
    assert app_client.post(f"{RUNS}/{run_id}/refresh", cookies=admin_cookies).status_code == 200
    assert app_client.post(f"{RUNS}/{run_id}/approve", cookies=admin_cookies).status_code == 200
    assert app_client.post(f"{RUNS}/{run_id}/finalize", cookies=admin_cookies).status_code == 200

    with get_db_context() as db:
        audit = db.query(AuditLogDB).filter(AuditLogDB.action == "payroll.run.reverted_to_draft", AuditLogDB.target_id == str(run_id)).first()
        assert audit is not None and "Wrong bonus entered" in (audit.details or "")


def test_revert_needs_a_reason_and_a_run_that_is_not_already_a_draft(app_client, admin_cookies):
    _cleanup_test_payroll_data()
    bank = _account("RV Bank B", "USD", "bank", 10000.0)
    _setup_employee_with_plan("Reason Emp", "reason.emp@hrflow.test", ext_amount=1000.0)
    run_id = _finalized_run(app_client, admin_cookies, "2027-06", ext_id=bank, int_id=bank, bank_id=bank)
    assert app_client.post(f"{RUNS}/{run_id}/revert-to-draft", json={"reason": "no"}, cookies=admin_cookies).status_code == 422
    assert app_client.post(f"{RUNS}/{run_id}/revert-to-draft", json={}, cookies=admin_cookies).status_code == 422
    assert app_client.post(f"{RUNS}/{run_id}/revert-to-draft", json={"reason": "Fix the amounts"}, cookies=admin_cookies).status_code == 200
    again = app_client.post(f"{RUNS}/{run_id}/revert-to-draft", json={"reason": "Fix the amounts"}, cookies=admin_cookies)
    assert again.status_code == 400 and "already a draft" in again.json()["detail"]


def test_a_paid_run_cannot_be_reverted(app_client, admin_cookies):
    _cleanup_test_payroll_data()
    bank = _account("RV Bank C", "USD", "bank", 10000.0)
    _setup_employee_with_plan("Paid Emp", "paid.emp@hrflow.test", ext_amount=1000.0)
    run_id = _finalized_run(app_client, admin_cookies, "2027-07", ext_id=bank, int_id=bank, bank_id=bank)
    assert app_client.post(f"{RUNS}/{run_id}/pay", json={}, cookies=admin_cookies).status_code == 200
    resp = app_client.post(f"{RUNS}/{run_id}/revert-to-draft", json={"reason": "Too late to change"}, cookies=admin_cookies)
    assert resp.status_code == 400
    assert _run(run_id)["status"] == "paid"


def test_revert_is_an_approver_action(app_client, admin_cookies, employee_cookies):
    _cleanup_test_payroll_data()
    bank = _account("RV Bank D", "USD", "bank", 10000.0)
    _setup_employee_with_plan("Guard Emp", "guard.emp@hrflow.test", ext_amount=1000.0)
    run_id = _finalized_run(app_client, admin_cookies, "2027-08", ext_id=bank, int_id=bank, bank_id=bank)
    resp = app_client.post(f"{RUNS}/{run_id}/revert-to-draft", json={"reason": "Not allowed"}, cookies=employee_cookies)
    assert resp.status_code == 403
    assert _run(run_id)["status"] == "finalized"
