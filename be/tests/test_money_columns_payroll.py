"""
be/tests/test_money_columns_payroll.py
Stage 5b-3a: payroll money columns are exact NUMERIC (finance/money.py); migration 0065 converts them and stops with a list when a
value would be rounded.
"""
import os
import sqlite3
import subprocess
import sys


from finance import models as fm

BE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RATE_COLUMNS = {
    fm.PayrollRunDB: {"fx_rate_value"},
    fm.PayrollLineDB: {"employee_rate_snapshot", "employer_rate_snapshot", "fx_rate_snapshot", "tax_rate_snapshot"},
    fm.PayrollRateSettingsDB: {"employee_rate", "employer_rate"},
}
MONEY_COLUMNS = {
    fm.PayrollRunDB: {"total_gross", "total_tax", "total_deductions", "total_net", "total_employer_cost", "total_employee_tax_egp",
                      "total_social_insurance_egp", "total_flat_tax_egp"},
    fm.PayrollLineDB: {"base_salary", "allowances_total", "deductions_total", "net_pay", "employer_cost_extra", "insured_base_snapshot",
                       "configured_internal_salary_usd_snapshot", "insured_base_egp_snapshot", "base_gross_egp", "variable_gross_egp",
                       "employee_social_insurance_egp", "employer_social_insurance_egp", "employee_tax_egp",
                       "employee_social_insurance_usd_equivalent", "employee_tax_usd_equivalent", "final_internal_net_egp",
                       "final_internal_payment_usd", "taxable_gross_egp", "annual_taxed_salary_egp", "annual_tax_egp"},
    fm.PayrollAdjustmentDB: {"amount"},
    fm.EmployeeCompensationPlanDB: {"amount"},
    fm.PayrollTaxSettingsDB: {"tax_limit_p_egp"},
}


def test_payroll_columns_use_the_money_types():
    for model, names in MONEY_COLUMNS.items():
        for name in names:
            col = model.__table__.c[name]
            assert (col.type.precision, col.type.scale, col.type.asdecimal) == (18, 4, False), f"{model.__tablename__}.{name}"
    for model, names in RATE_COLUMNS.items():
        for name in names:
            col = model.__table__.c[name]
            assert (col.type.precision, col.type.scale, col.type.asdecimal) == (18, 8, False), f"{model.__tablename__}.{name}"


def _alembic(url, *args, expect_ok=True):
    done = subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BE_DIR, env=dict(os.environ, DATABASE_URL=url),
                          capture_output=True, text=True)
    if expect_ok:
        assert done.returncode == 0, done.stderr[-1500:]
    return done


def _decl(path, table, column):
    with sqlite3.connect(path) as conn:
        return next(r[2] for r in conn.execute(f"PRAGMA table_info({table})") if r[1] == column).upper()


def test_migration_0065_changes_the_declared_types_and_back(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    _alembic(url, "upgrade", "head")
    assert _decl(path, "finance_payroll_lines", "net_pay") == "NUMERIC(18, 4)"
    assert _decl(path, "finance_payroll_lines", "fx_rate_snapshot") == "NUMERIC(18, 8)"
    assert _decl(path, "finance_payroll_runs", "total_net") == "NUMERIC(18, 4)"
    assert _decl(path, "finance_employee_compensation_plans", "amount") == "NUMERIC(18, 4)"
    _alembic(url, "downgrade", "0064_money_bills_invoices_payments")
    assert _decl(path, "finance_payroll_lines", "net_pay") == "FLOAT"
    assert _decl(path, "finance_employee_compensation_plans", "amount") == "FLOAT"
    _alembic(url, "upgrade", "head")


def test_migration_0065_stops_and_lists_values_that_would_be_rounded(tmp_path):
    path = tmp_path / "m.db"
    url = f"sqlite:///{path.as_posix()}"
    # A fresh chain builds finance tables from the current models (migration 0013), so the column is already NUMERIC:
    # go up and back down to get the float column an older database has.
    _alembic(url, "upgrade", "head")
    _alembic(url, "downgrade", "0064_money_bills_invoices_payments")
    assert _decl(path, "finance_employee_compensation_plans", "amount") == "FLOAT"
    with sqlite3.connect(path) as conn:
        conn.execute("INSERT INTO employees (id, name, email) VALUES (1, 'E', 'e@hrflow.test')")
        conn.execute("INSERT INTO finance_employee_compensation_plans (employee_id, component_type, amount, currency, salary_basis, "
                     "effective_start_date, notes) VALUES (1, 'internal_usd_cash', 1000.123456, 'USD', 'NET', '2026-01-01', '')")
        conn.commit()
    done = _alembic(url, "upgrade", "head", expect_ok=False)
    assert done.returncode != 0 and "finance_employee_compensation_plans.amount: 1 value(s) have more than 4 decimals" in done.stderr
    assert _decl(path, "finance_employee_compensation_plans", "amount") == "FLOAT"
