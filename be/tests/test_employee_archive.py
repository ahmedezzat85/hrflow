"""
be/tests/test_employee_archive.py
Employees can be archived and unarchived: status "Archived" while archived, the saved status comes back, the linked login is
archived and restored, archived employees leave current payroll and new salary documents, and migration 0061 adds the state.
"""
import os
import sqlite3
import subprocess
import sys
from datetime import date

import pytest

from conftest import create_test_user
from fx_test_helpers import seed_usd_egp_rate
from pay_test_helpers import seed_plan
from services.salary_payment_docs import SalaryPaymentDocEligibilityError, check_eligibility

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _new_employee(client, cookies, email, status="Active"):
    resp = client.post("/api/employees", json={
        "name": "Archive Test", "email": email, "legal_name": "Archive Test", "phone": "01000000000",
        "address_line_1": "1 Street", "status": status,
    }, cookies=cookies)
    assert resp.status_code in (200, 201), resp.text
    return resp.json()["id"]


def _get(client, cookies, emp_id):
    return client.get(f"/api/employees/{emp_id}", cookies=cookies).json()


def test_archive_and_unarchive_restore_the_saved_status(app_client, admin_cookies):
    emp = _new_employee(app_client, admin_cookies, "arch1@hrflow.test", status="On Leave")
    assert _get(app_client, admin_cookies, emp)["archived"] is False

    done = app_client.post(f"/api/employees/{emp}/archive", cookies=admin_cookies)
    assert done.status_code == 200, done.text
    body = _get(app_client, admin_cookies, emp)
    assert body["archived"] is True and body["status"] == "Archived" and body["archived_at"]

    back = app_client.post(f"/api/employees/{emp}/unarchive", cookies=admin_cookies)
    assert back.status_code == 200, back.text
    body = _get(app_client, admin_cookies, emp)
    assert body["archived"] is False and body["status"] == "On Leave" and body["archived_at"] is None


def test_archiving_twice_or_unarchiving_a_current_employee_is_refused(app_client, admin_cookies):
    emp = _new_employee(app_client, admin_cookies, "arch2@hrflow.test")
    assert app_client.post(f"/api/employees/{emp}/unarchive", cookies=admin_cookies).status_code == 409
    assert app_client.post(f"/api/employees/{emp}/archive", cookies=admin_cookies).status_code == 200
    assert app_client.post(f"/api/employees/{emp}/archive", cookies=admin_cookies).status_code == 409
    assert app_client.post("/api/employees/999999/archive", cookies=admin_cookies).status_code == 404


def test_an_admin_cannot_archive_their_own_employee(app_client, admin_cookies):
    # the seeded admin user is linked to employee 1
    resp = app_client.post("/api/employees/1/archive", cookies=admin_cookies)
    assert resp.status_code == 409
    assert _get(app_client, admin_cookies, 1)["archived"] is False


def test_the_linked_login_is_archived_with_the_employee_and_restored(app_client, admin_cookies):
    emp = _new_employee(app_client, admin_cookies, "arch3@hrflow.test")
    cookies = create_test_user("arch3@hrflow.test", role_key="employee", employee_id=emp)
    assert app_client.get("/api/auth/me", cookies=cookies).status_code == 200
    app_client.post(f"/api/employees/{emp}/archive", cookies=admin_cookies)
    blocked = app_client.get("/api/auth/me", cookies=cookies)
    assert blocked.status_code == 403 and "archived" in blocked.json()["detail"].lower()
    app_client.post(f"/api/employees/{emp}/unarchive", cookies=admin_cookies)
    assert app_client.get("/api/auth/me", cookies=cookies).status_code == 200


def test_the_status_field_cannot_be_set_to_archived_directly(app_client, admin_cookies):
    emp = _new_employee(app_client, admin_cookies, "arch4@hrflow.test")
    resp = app_client.put(f"/api/employees/{emp}", json={"status": "Archived"}, cookies=admin_cookies)
    assert resp.status_code == 422
    assert _get(app_client, admin_cookies, emp)["status"] == "Active"


def test_delete_of_an_employee_with_pay_history_points_to_archive(app_client, admin_cookies):
    emp = _new_employee(app_client, admin_cookies, "arch5@hrflow.test")
    seed_plan(emp, internal=1000.0, external=0.0)
    resp = app_client.delete(f"/api/employees/{emp}", cookies=admin_cookies)
    assert resp.status_code == 409 and "Archive them instead" in resp.json()["detail"]


def test_an_archived_employee_is_left_out_of_a_current_payroll_run(app_client, admin_cookies):
    emp = _new_employee(app_client, admin_cookies, "arch6@hrflow.test")
    seed_plan(emp, internal=1000.0, external=0.0)
    seed_usd_egp_rate(50.0)
    for other in app_client.get("/api/employees", cookies=admin_cookies).json():   # a run needs a plan for every active employee
        if other["id"] != emp:
            seed_plan(other["id"], internal=100.0, external=0.0)
    today = date.today()
    period = {"period_label": today.strftime("%Y-%m"), "period_start": today.replace(day=1).isoformat(),
              "period_end": today.replace(day=28).isoformat()}

    def headcount():
        resp = app_client.post("/api/finance/payroll/runs/generate", json=period, cookies=admin_cookies)
        assert resp.status_code == 201, resp.text
        run = app_client.get(f"/api/finance/payroll/runs/{resp.json()['id']}", cookies=admin_cookies).json()
        return {line["employee_id"] for line in run.get("lines", [])}

    assert emp in headcount()
    app_client.post(f"/api/employees/{emp}/archive", cookies=admin_cookies)
    assert emp not in headcount()


def test_an_archived_employee_gets_no_new_salary_document():
    base = {"external_salary_usd": 500.0, "invoice_id": "05", "legal_name": "A B", "address_line_1": "1 Street"}
    assert check_eligibility(base) == "05"
    with pytest.raises(SalaryPaymentDocEligibilityError, match="archived"):
        check_eligibility({**base, "archived": True})


# --- migration 0061 ---------------------------------------------------------------------------------------------

def _alembic(url, *args):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr[-1500:]


def _cols(path):
    with sqlite3.connect(path) as conn:
        return {r[1] for r in conn.execute("PRAGMA table_info(employees)")}


def test_migration_0061_adds_and_drops_the_archived_columns(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "head")
    assert {"archived_at", "archived_by"} <= _cols(path)
    _alembic(url, "downgrade", "0060_payroll_line_tax_amount")
    assert not {"archived_at", "archived_by"} & _cols(path)
    _alembic(url, "upgrade", "head")
    assert "archived_at" in _cols(path)
