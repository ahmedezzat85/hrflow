"""
be/tests/test_payroll_real_actors.py
Payroll approvals record real people only, and maker-checker cannot be skipped (audit 2026-11, finding H-6).
"""
import json

import pytest
from fastapi import HTTPException

from finance.models import PayrollRunDB
from finance.services.payroll_service import PayrollService
from models_db import AuditLogDB


@pytest.fixture
def db(app_client):
    from db import get_session_factory
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()


def _run(db, created_by="maker@hrflow.test", status="draft", submitted_by=None):
    run = PayrollRunDB(period_label="2031-01", period_start="2031-01-01", period_end="2031-01-31", status=status,
                       created_by=created_by, submitted_by=submitted_by, exceptions_json="[]")
    db.add(run)
    db.commit()
    return run.id


@pytest.mark.parametrize("call", ["submit", "approve", "finalize", "pay"])
def test_no_actor_no_transition_and_no_placeholder(db, call):
    run_id = _run(db, status={"submit": "draft", "approve": "submitted", "finalize": "approved", "pay": "finalized"}[call])
    svc = PayrollService(db)
    fn = {"submit": svc.submit_run, "approve": svc.approve_run, "finalize": svc.finalize_run, "pay": svc.execute_payment}[call]
    with pytest.raises(HTTPException) as exc:
        fn(run_id, user_email=None)
    assert exc.value.status_code == 400 and "signed-in user" in exc.value.detail
    db.expire_all()
    run = db.get(PayrollRunDB, run_id)
    # Nothing was recorded in anyone's name (the old code wrote preparer@/admin@/payroll@hrflow.test here)
    assert (run.submitted_by, run.approved_by, run.finalized_by, run.paid_by) == (None, None, None, None)


def test_the_creator_cannot_approve_a_draft_they_never_submitted(db):
    run_id = _run(db, created_by="maker@hrflow.test")
    with pytest.raises(HTTPException) as exc:
        PayrollService(db).approve_run(run_id, user_email="Maker@HRflow.test")
    assert exc.value.status_code == 400 and "maker-checker" in exc.value.detail.lower()
    db.expire_all()
    assert db.get(PayrollRunDB, run_id).status == "draft"


def test_another_user_approves_and_is_recorded_as_given(db):
    run_id = _run(db, created_by="maker@hrflow.test", status="submitted", submitted_by="maker@hrflow.test")
    out = PayrollService(db).approve_run(run_id, user_email="checker@hrflow.test")
    assert out["status"] == "approved"
    db.expire_all()
    assert db.get(PayrollRunDB, run_id).approved_by == "checker@hrflow.test"
    audit = db.query(AuditLogDB).filter_by(action="payroll.run.approved", target_id=str(run_id)).one()
    assert json.loads(audit.details)["self_approved"] is False


def test_allowed_self_approval_is_marked_in_the_audit(db):
    run_id = _run(db, created_by="solo@hrflow.test", status="submitted", submitted_by="solo@hrflow.test")
    PayrollService(db).approve_run(run_id, user_email="solo@hrflow.test", allow_self_approval=True)
    audit = db.query(AuditLogDB).filter_by(action="payroll.run.approved", target_id=str(run_id)).one()
    assert json.loads(audit.details)["self_approved"] is True


def test_maker_checker_switched_off_still_records_self_approval(db, monkeypatch):
    monkeypatch.setenv("ENFORCE_MAKER_CHECKER", "false")
    run_id = _run(db, created_by="solo@hrflow.test", status="submitted", submitted_by="solo@hrflow.test")
    PayrollService(db).approve_run(run_id, user_email="solo@hrflow.test")
    audit = db.query(AuditLogDB).filter_by(action="payroll.run.approved", target_id=str(run_id)).one()
    assert json.loads(audit.details)["self_approved"] is True
