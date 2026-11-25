"""
be/tests/test_csv_formula_injection.py
CSV exports neutralise spreadsheet formulas in text cells and leave numbers alone (audit 2026-11, finding M-1).
"""
import csv
import io

from finance.services.excel_exporter import sanitize_csv_cell
from services.export import format_csv
from test_finance_payroll_adjustments import seed_env  # noqa: F401  (fixture)

FORMULA = '=HYPERLINK("http://evil.example","click")'


def test_text_that_would_run_as_a_formula_is_prefixed():
    for value in (FORMULA, "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\tTAB", "\rCR"):
        assert sanitize_csv_cell(value) == "'" + value


def test_numbers_and_plain_text_are_unchanged():
    for value in ("-12.50", "+20", "1,500.00", "0", "Alice", "", "—", "INV-001"):
        assert sanitize_csv_cell(value) == value
    assert sanitize_csv_cell(-3.5) == -3.5
    assert sanitize_csv_cell(None) is None


def test_dataset_csv_neutralises_formulas_but_keeps_negative_amounts():
    data = format_csv(["Name", "Note", "Amount", "Delta"], [[FORMULA, "@risk", -250.5, "-40"]])
    row = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))[1]
    assert row == ["'" + FORMULA, "'@risk", "-250.50", "-40"]


def test_payroll_run_csv_neutralises_a_formula_in_the_employee_name(app_client, admin_cookies, seed_env):
    from fx_test_helpers import seed_usd_egp_rate
    from db import get_db_context
    seed_usd_egp_rate(50.0)
    from models_db import EmployeeDB
    with get_db_context() as db:
        emp = db.get(EmployeeDB, seed_env["employee_id"])
        emp.name = FORMULA
        db.commit()

    prev = app_client.post(
        "/api/finance/payroll/previews",
        json={"period_label": "2027-03", "period_start": "2027-03-01", "period_end": "2027-03-31",
              "external_funding_account_id": seed_env["ext_bank_id"],
              "internal_funding_account_id": seed_env["int_bank_id"]},
        cookies=admin_cookies,
    )
    assert prev.status_code in (200, 201), prev.text
    run = app_client.post(
        "/api/finance/payroll/runs",
        json={"period_label": "2027-03", "period_start": "2027-03-01", "period_end": "2027-03-31",
              "preview_id": prev.json()["preview_id"], "submit_for_approval": False},
        cookies=admin_cookies,
    )
    assert run.status_code == 201, run.text

    exp = app_client.get(f"/api/finance/payroll/runs/{run.json()['id']}/export", cookies=admin_cookies)
    assert exp.status_code == 200
    rows = list(csv.reader(io.StringIO(exp.text)))
    line = next(r for r in rows[1:] if r[0] == str(seed_env["employee_id"]))
    assert line[1] == "'" + FORMULA
    assert all(not cell.startswith(("=", "@")) for cell in line)
