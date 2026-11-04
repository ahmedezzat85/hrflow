"""Official holidays: management, visibility, and exclusion from leave days."""
from datetime import date

from services.leave_days import count_leave_days, holiday_dates


def _add(app_client, cookies, **over):
    body = {"name": "Revolution Day", "start_date": "2026-09-02", "end_date": "2026-09-03", **over}
    return app_client.post("/api/holidays", json=body, cookies=cookies)


def test_count_leave_days_skips_weekend_and_holidays():
    # Tue 2026-09-01 .. Sat 09-05: Fri and Sat are the weekend
    assert count_leave_days(date(2026, 9, 1), date(2026, 9, 5)) == 3
    off = holiday_dates([{"start_date": "2026-09-02", "end_date": "2026-09-03"}])
    assert count_leave_days(date(2026, 9, 1), date(2026, 9, 5), off) == 1
    # a holiday on a weekend day removes nothing more
    assert count_leave_days(date(2026, 9, 1), date(2026, 9, 5), holiday_dates([{"start_date": "2026-09-04", "end_date": "2026-09-04"}])) == 3


def test_admin_manages_holidays_and_employee_reads(app_client, admin_cookies, employee_cookies):
    res = _add(app_client, admin_cookies)
    assert res.status_code == 201
    hid = res.json()["id"]

    listed = app_client.get("/api/holidays?year=2026", cookies=employee_cookies)
    assert listed.status_code == 200
    assert [h["name"] for h in listed.json()] == ["Revolution Day"]
    assert app_client.get("/api/holidays?year=2025", cookies=employee_cookies).json() == []

    assert _add(app_client, employee_cookies).status_code == 403
    assert app_client.put(f"/api/holidays/{hid}", json={"name": "X", "start_date": "2026-09-02"}, cookies=employee_cookies).status_code == 403
    assert app_client.delete(f"/api/holidays/{hid}", cookies=employee_cookies).status_code == 403

    upd = app_client.put(f"/api/holidays/{hid}", json={"name": "Renamed", "start_date": "2026-09-02"}, cookies=admin_cookies)
    assert upd.status_code == 200
    row = app_client.get("/api/holidays?year=2026", cookies=admin_cookies).json()[0]
    assert (row["name"], row["end_date"]) == ("Renamed", "2026-09-02")

    assert app_client.delete(f"/api/holidays/{hid}", cookies=admin_cookies).status_code == 200
    assert app_client.delete(f"/api/holidays/{hid}", cookies=admin_cookies).status_code == 404


def test_holiday_validation(app_client, admin_cookies):
    assert _add(app_client, admin_cookies, name="  ").status_code == 422
    assert _add(app_client, admin_cookies, start_date="not-a-date").status_code == 422
    assert _add(app_client, admin_cookies, start_date="2026-09-05", end_date="2026-09-01").status_code == 422


def test_vacation_request_excludes_holidays(app_client, admin_cookies, employee_cookies, fake_sheets_client):
    assert _add(app_client, admin_cookies).status_code == 201   # Wed 2026-09-02 and Thu 09-03
    payload = {"employee_name": "Employee Two", "leave_type": "Annual Leave", "start_date": "2026-09-01", "end_date": "2026-09-05"}
    res = app_client.post("/api/vacations/request", json=payload, cookies=employee_cookies)
    assert res.status_code == 201
    vac = next(v for v in fake_sheets_client.get_all_records("VacationHistory") if v["id"] == res.json()["id"])
    assert vac["days"] == 1

    only_off = {**payload, "start_date": "2026-09-02", "end_date": "2026-09-03"}
    refused = app_client.post("/api/vacations/request", json=only_off, cookies=employee_cookies)
    assert refused.status_code == 422
    assert "holidays" in refused.json()["detail"]
