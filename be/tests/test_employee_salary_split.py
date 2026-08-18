"""
test_employee_salary_split.py
Backend tests for Stage 1 of docs/analysis/salary-advanced-plan.md:
EmployeeCreate/EmployeeUpdate split into internal_salary_usd /
external_salary_usd, with a derived legacy `salary` total maintained for
backward compatibility with not-yet-migrated frontend code.
"""


def test_create_employee_requires_both_salary_components(app_client, admin_cookies):
    resp = app_client.post("/api/employees", json={
        "name": "New Hire", "email": "newhire@hrflow.test", "dept": "Engineering",
        "job_role": "Developer", "internal_salary_usd": 1000,
        # external_salary_usd intentionally omitted
    }, cookies=admin_cookies)
    assert resp.status_code == 422


def test_create_employee_zero_is_a_valid_component_value(app_client, admin_cookies, fake_sheets_client):
    resp = app_client.post("/api/employees", json={
        "name": "Internal Only", "email": "internalonly@hrflow.test", "dept": "Engineering",
        "job_role": "Developer", "internal_salary_usd": 1500, "external_salary_usd": 0,
    }, cookies=admin_cookies)
    assert resp.status_code == 201
    new_id = resp.json()["id"]
    employees = fake_sheets_client.get_all_records("Employees")
    emp = next(e for e in employees if e["id"] == new_id)
    assert emp["internal_salary_usd"] == 1500
    assert emp["external_salary_usd"] == 0
    assert emp["salary"] == 1500


def test_create_employee_derives_legacy_salary_as_sum(app_client, admin_cookies, fake_sheets_client):
    resp = app_client.post("/api/employees", json={
        "name": "Split Pay", "email": "splitpay@hrflow.test", "dept": "Engineering",
        "job_role": "Developer", "internal_salary_usd": 1000, "external_salary_usd": 500,
    }, cookies=admin_cookies)
    assert resp.status_code == 201
    new_id = resp.json()["id"]
    employees = fake_sheets_client.get_all_records("Employees")
    emp = next(e for e in employees if e["id"] == new_id)
    assert emp["salary"] == 1500


def test_update_single_component_recomputes_total_with_other_component(app_client, admin_cookies, fake_sheets_client):
    fake_sheets_client.append_row("Employees", {
        "id": 99, "name": "Existing", "email": "existing@hrflow.test", "role": "employee",
        "dept": "Sales", "job_role": "Rep", "salary": 1500, "join_date": "2024-01-01",
        "status": "Active", "vac_total": 21, "vac_used": 0, "next_raise": "2027-01-01",
        "employment_state": "Full-Time", "internal_salary_usd": 1000, "external_salary_usd": 500,
    })
    resp = app_client.put("/api/employees/99", json={"internal_salary_usd": 1200}, cookies=admin_cookies)
    assert resp.status_code == 200
    employees = fake_sheets_client.get_all_records("Employees")
    emp = next(e for e in employees if e["id"] == 99)
    assert emp["internal_salary_usd"] == 1200
    assert emp["external_salary_usd"] == 500
    assert emp["salary"] == 1700


def test_update_unrelated_field_does_not_touch_salary(app_client, admin_cookies, fake_sheets_client):
    fake_sheets_client.append_row("Employees", {
        "id": 98, "name": "Existing2", "email": "existing2@hrflow.test", "role": "employee",
        "dept": "Sales", "job_role": "Rep", "salary": 1500, "join_date": "2024-01-01",
        "status": "Active", "vac_total": 21, "vac_used": 0, "next_raise": "2027-01-01",
        "employment_state": "Full-Time", "internal_salary_usd": 1000, "external_salary_usd": 500,
    })
    resp = app_client.put("/api/employees/98", json={"dept": "Marketing"}, cookies=admin_cookies)
    assert resp.status_code == 200
    employees = fake_sheets_client.get_all_records("Employees")
    emp = next(e for e in employees if e["id"] == 98)
    assert emp["dept"] == "Marketing"
    assert emp["salary"] == 1500
