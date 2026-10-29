"""
be/scripts/audit_db_integrity.py
Read-only data-quality audit for the database redesign (Stage 0). Reports rows that break the rules later stages
will enforce with constraints, and cached values that have drifted from their source. Changes nothing.

Run it against a COPY of production before each stage, with the same environment as the app:
    python scripts/audit_db_integrity.py            # human-readable report
    python scripts/audit_db_integrity.py --json     # machine-readable
Exit code is 0 when no findings, 1 when there are findings (so it can gate a migration), 2 on an error.
"""
import json
import os
import re
import sys
from collections import defaultdict
from datetime import date
from typing import Callable, Dict, List

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import inspect, text  # noqa: E402

from db import get_engine  # noqa: E402
import models_db  # noqa: E402,F401 - registers every model so relationships resolve

SAMPLE = 5
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH_RE = re.compile(r"^\d{4}-\d{2}$")

# Tables whose effective-dated rows must not overlap, grouped by these columns.
EFFECTIVE_TABLES = [
    ("finance_employee_compensation_plans", ("employee_id", "component_type")),
    ("employee_social_insurance", ("employee_id",)),
    ("employee_tax_method", ("employee_id",)),
]


class Audit:
    def __init__(self, conn):
        self.conn = conn
        self.inspector = inspect(conn)
        self.tables = set(self.inspector.get_table_names())
        self._cols: Dict[str, set] = {}
        self.sections: List[dict] = []

    def cols(self, table: str) -> set:
        if table not in self._cols:
            self._cols[table] = {c["name"] for c in self.inspector.get_columns(table)} if table in self.tables else set()
        return self._cols[table]

    def has(self, table: str, *columns: str) -> bool:
        return table in self.tables and set(columns) <= self.cols(table)

    def rows(self, sql: str, **params):
        return [dict(r._mapping) for r in self.conn.execute(text(sql), params)]

    def add(self, key: str, title: str, items: List[dict], note: str = ""):
        self.sections.append({"key": key, "title": title, "count": len(items), "sample": items[:SAMPLE], "note": note})


def check_effective_overlaps(a: Audit):
    for table, group in EFFECTIVE_TABLES:
        need = list(group) + ["id", "effective_start_date", "effective_end_date"]
        if not a.has(table, *need):
            continue
        by_key = defaultdict(list)
        for r in a.rows(f"SELECT {', '.join(need)} FROM {table} ORDER BY effective_start_date, id"):
            by_key[tuple(r[g] for g in group)].append(r)
        findings = []
        for key, rows in by_key.items():
            for i, first in enumerate(rows):
                for second in rows[i + 1:]:
                    end = first["effective_end_date"] or "9999-12-31"
                    if second["effective_start_date"] <= end:
                        findings.append({"group": dict(zip(group, key)), "row_a": first["id"], "row_b": second["id"],
                                         "a": f"{first['effective_start_date']}..{first['effective_end_date'] or 'open'}",
                                         "b": f"{second['effective_start_date']}..{second['effective_end_date'] or 'open'}"})
        a.add(f"overlap:{table}", f"Overlapping effective ranges in {table}", findings,
              "Overlapping plan rows double-count pay in current_pay_map.")


def check_bad_dates(a: Audit):
    """Values the date CHECK constraints (finance/date_checks.py, migration 0067) would refuse."""
    from finance import date_checks
    for table, cols in date_checks.DATE_COLUMNS.items():
        for column, may_be_empty in cols.items():
            if not a.has(table, column, "id"):
                continue
            expression = date_checks.check_expression(column, may_be_empty)
            bad = [{"id": r["id"], "value": r["v"]} for r in a.rows(f"SELECT id, {column} AS v FROM {table} WHERE NOT ({expression})")]
            a.add(f"date:{table}.{column}", f"Invalid date in {table}.{column}", bad,
                  "Migration 0067 stops while any of these exist." if bad else "")


def check_duplicates(a: Audit):
    if a.has("finance_bills", "bill_number", "status", "is_duplicate_override"):
        a.add("dup:bills", "Bill number used by more than one bill (Drafts and duplicate overrides excluded)", a.rows(
            "SELECT bill_number, COUNT(*) AS n, MIN(id) AS first_id FROM finance_bills "
            "WHERE bill_number IS NOT NULL AND bill_number <> '' AND status <> 'draft' AND is_duplicate_override = :f "
            "GROUP BY bill_number HAVING COUNT(*) > 1", f=False),
            "Migration 0056 adds a unique index on this rule and stops while any of these exist.")
    if a.has("finance_payroll_runs", "period_label", "status"):
        a.add("dup:payroll_runs", "Several non-cancelled payroll runs for one period", a.rows(
            "SELECT period_label, COUNT(*) AS n FROM finance_payroll_runs WHERE status <> 'cancelled' "
            "GROUP BY period_label HAVING COUNT(*) > 1"))
    if a.has("finance_payroll_lines", "payroll_run_id", "employee_id", "compensation_type"):
        a.add("dup:payroll_lines", "Base pay line (external_usd / internal_usd_cash) twice for one employee in one payroll run", a.rows(
            "SELECT payroll_run_id, employee_id, compensation_type, COUNT(*) AS n FROM finance_payroll_lines "
            "WHERE compensation_type IN ('external_usd', 'internal_usd_cash') "
            "GROUP BY payroll_run_id, employee_id, compensation_type HAVING COUNT(*) > 1"),
            "Commission and bonus lines may repeat by design. Migration 0057 adds a unique index on the base pay lines.")
    if a.has("salary_payment_docs", "employee_id", "payment_year", "payment_month", "status"):
        a.add("dup:salary_docs", "Several generated salary documents for one employee and month", a.rows(
            "SELECT employee_id, payment_year, payment_month, COUNT(*) AS n FROM salary_payment_docs "
            "WHERE status = 'generated' GROUP BY employee_id, payment_year, payment_month HAVING COUNT(*) > 1"))
    if a.has("users", "email") and a.has("employees", "email"):
        a.add("dup:email_case", "Users or employees whose emails differ only by case", a.rows(
            "SELECT LOWER(email) AS email, COUNT(*) AS n FROM users GROUP BY LOWER(email) HAVING COUNT(*) > 1 "
            "UNION ALL SELECT LOWER(email), COUNT(*) FROM employees GROUP BY LOWER(email) HAVING COUNT(*) > 1"))


def check_cached_values(a: Audit):
    if a.has("employees", "vac_used", "id") and a.has("vacation_history", "employee_id", "days", "status", "start_date"):
        year = str(date.today().year)
        approved = {r["employee_id"]: r["days"] or 0 for r in a.rows(
            "SELECT employee_id, SUM(days) AS days FROM vacation_history WHERE LOWER(status) = 'approved' "
            "AND start_date LIKE :y GROUP BY employee_id", y=f"{year}%")}
        items = []
        for e in a.rows("SELECT id, name, vac_used FROM employees"):
            if int(e["vac_used"] or 0) != int(approved.get(e["id"], 0)):
                items.append({"employee_id": e["id"], "name": e["name"], "vac_used": e["vac_used"],
                              f"approved_days_{year}": approved.get(e["id"], 0)})
        a.add("cache:vac_used", "employees.vac_used differs from approved vacation days this year", items,
              "Stage 1 derives vac_used from vacation_history.")
    if a.has("employees", "next_raise", "id") and a.has("salary_history", "employee_id", "date"):
        a.add("cache:next_raise", "employees.next_raise is not one year after the latest pay change", a.rows(
            "SELECT e.id AS employee_id, e.next_raise, MAX(h.date) AS latest_change FROM employees e "
            "JOIN salary_history h ON h.employee_id = e.id GROUP BY e.id, e.next_raise "
            "HAVING e.next_raise IS NOT NULL AND e.next_raise <> '' AND "
            "e.next_raise <> strftime('%Y-%m-%d', MAX(h.date), '+365 days')")
              if a.conn.dialect.name == "sqlite" else [],
              "Checked on SQLite only. Stage 1 derives next_raise from salary_history.")
    if a.has("finance_bills", "amount_paid", "id") and a.has("finance_payments", "related_bill_id", "amount", "is_reversed"):
        a.add("cache:amount_paid", "finance_bills.amount_paid differs from the sum of live payments", a.rows(
            "SELECT b.id AS bill_id, b.bill_number, b.amount_paid, COALESCE(SUM(p.amount), 0) AS payments_sum "
            "FROM finance_bills b LEFT JOIN finance_payments p ON p.related_bill_id = b.id AND p.is_reversed = :f "
            "GROUP BY b.id, b.bill_number, b.amount_paid "
            "HAVING ABS(COALESCE(b.amount_paid, 0) - COALESCE(SUM(p.amount), 0)) > 0.005", f=False))
    if a.has("finance_bank_accounts", "current_balance", "id"):
        _check_balances(a)


def _check_balances(a: Audit):
    """Stored current_balance and every stored running_balance against the balance rule in finance/balances.py."""
    from sqlalchemy.orm import Session
    from finance import balances

    with Session(a.conn) as db:
        drift = balances.find_drift(db)
    a.add("cache:balances", "Stored account balances (current_balance or ledger running_balance) differ from the ledger", [
        {"account_id": d["account_id"], "name": d["account_name"], **d["current_balance"],
         "running_balance_rows_off": d["running_balance_rows"], "first_bad_rows": d["first_bad_rows"]} for d in drift],
        "Any ledger write on the account recomputes both copies; or call LedgerRepository.recalculate_account_running_balances(account_id).")


def check_payment_ledger_link(a: Audit):
    if a.has("finance_payments", "ledger_transaction_id", "is_reversed", "id"):
        # Stage 2b: payments carry a real link to the ledger row they posted
        a.add("link:payment_no_ledger", "Live payments with no ledger row linked (older payments the migration could not match)", a.rows(
            "SELECT p.id AS payment_id, p.related_bill_id, p.related_invoice_id, p.payment_date, p.amount FROM finance_payments p "
            "WHERE p.is_reversed = :f AND p.ledger_transaction_id IS NULL", f=False))
        if a.has("finance_ledger_transactions", "source", "id"):
            a.add("link:ledger_no_payment", "Bill/invoice payment ledger rows that no payment points at", a.rows(
                "SELECT l.id AS ledger_id, l.source, l.linked_bill_id, l.linked_invoice_id, l.date, l.amount "
                "FROM finance_ledger_transactions l WHERE l.source IN ('invoice_payment', 'bill_payment') "
                "AND NOT EXISTS (SELECT 1 FROM finance_payments p WHERE p.ledger_transaction_id = l.id)"))
        return
    if not (a.has("finance_payments", "id", "bank_account_id", "payment_date", "amount", "is_reversed")
            and a.has("finance_ledger_transactions", "account_id", "date", "amount", "linked_bill_id", "linked_invoice_id")):
        return
    a.add("link:payment_no_ledger", "Live bill/invoice payments with no matching ledger row", a.rows(
        "SELECT p.id AS payment_id, p.related_bill_id, p.related_invoice_id, p.payment_date, p.amount "
        "FROM finance_payments p WHERE p.is_reversed = :f AND (p.related_bill_id IS NOT NULL OR p.related_invoice_id IS NOT NULL) "
        "AND NOT EXISTS (SELECT 1 FROM finance_ledger_transactions l WHERE l.account_id = p.bank_account_id "
        "AND l.date = p.payment_date AND ABS(l.amount - p.amount) < 0.005 "
        "AND (l.linked_bill_id = p.related_bill_id OR l.linked_invoice_id = p.related_invoice_id))", f=False),
        "Heuristic match on account, date, amount and link. Stage 2 adds a real payment-to-ledger link.")
    a.add("link:ledger_no_payment", "Bill/invoice payment ledger rows with no matching payment", a.rows(
        "SELECT l.id AS ledger_id, l.source, l.linked_bill_id, l.linked_invoice_id, l.date, l.amount "
        "FROM finance_ledger_transactions l WHERE l.source IN ('invoice_payment', 'bill_payment') "
        "AND NOT EXISTS (SELECT 1 FROM finance_payments p WHERE p.bank_account_id = l.account_id "
        "AND p.payment_date = l.date AND ABS(l.amount - p.amount) < 0.005 "
        "AND (p.related_bill_id = l.linked_bill_id OR p.related_invoice_id = l.linked_invoice_id))"))


def check_orphans(a: Audit):
    if a.conn.dialect.name == "sqlite":
        bad = [dict(r._mapping) for r in a.conn.execute(text("PRAGMA foreign_key_check"))]
        a.add("fk:violations", "SQLite foreign key violations (rows pointing at missing parents)", bad)
    if a.has("finance_payroll_adjustments", "employee_id") and "employees" in a.tables:
        a.add("orphan:adjustment_employee", "Payroll adjustments for an employee that does not exist", a.rows(
            "SELECT id, employee_id FROM finance_payroll_adjustments WHERE employee_id NOT IN (SELECT id FROM employees)"))
    if a.has("finance_payroll_lines", "tax_settings_version_id") and "finance_payroll_tax_settings" in a.tables:
        a.add("orphan:line_tax_version", "Payroll lines pointing at a missing tax settings version", a.rows(
            "SELECT id, tax_settings_version_id FROM finance_payroll_lines WHERE tax_settings_version_id IS NOT NULL "
            "AND tax_settings_version_id NOT IN (SELECT id FROM finance_payroll_tax_settings)"))
    if a.has("finance_ledger_transactions", "payee_type", "payee_id"):
        a.add("orphan:payee", "Ledger rows whose vendor/employee payee no longer exists", a.rows(
            "SELECT id, payee_type, payee_id FROM finance_ledger_transactions WHERE payee_id IS NOT NULL AND "
            "((payee_type = 'vendor' AND payee_id NOT IN (SELECT id FROM finance_vendors)) OR "
            "(payee_type = 'employee' AND payee_id NOT IN (SELECT id FROM employees)))"))
    if a.has("finance_statutory_obligations", "source_type", "source_id"):
        a.add("orphan:statutory_source", "Statutory obligations whose payroll-run source no longer exists", a.rows(
            "SELECT id, source_type, source_id FROM finance_statutory_obligations WHERE source_type = 'payroll_run' "
            "AND source_id IS NOT NULL AND source_id NOT IN (SELECT id FROM finance_payroll_runs)"))


def check_attachments(a: Audit):
    parents = ["subscription_charge_id", "statement_import_id", "ledger_transaction_id", "cheque_id", "checkpoint_id", "sales_invoice_id"]
    if a.has("finance_attachments", "id", *parents):
        total = " + ".join(f"CASE WHEN {p} IS NULL THEN 0 ELSE 1 END" for p in parents)
        a.add("attach:parents", "Attachments with zero or several parents", a.rows(
            f"SELECT id, ({total}) AS parent_count FROM finance_attachments WHERE ({total}) <> 1"),
            "Stage 4 adds a CHECK for exactly one parent.")


def check_duplicate_text(a: Audit):
    if a.has("finance_bills", "category", "category_id") and "finance_transaction_categories" in a.tables:
        a.add("dup:bill_category", "Bills whose category text differs from their category row", a.rows(
            "SELECT b.id, b.category, c.name AS category_row FROM finance_bills b JOIN finance_transaction_categories c "
            "ON c.id = b.category_id WHERE b.category IS NOT NULL AND b.category <> c.name"),
            "Stage 2 drops the text column.")
    if a.has("users", "employee_id", "email") and a.has("employees", "email"):
        a.add("dup:user_employee_email", "Users linked to an employee with a different email", a.rows(
            "SELECT u.id AS user_id, u.email AS user_email, e.email AS employee_email FROM users u "
            "JOIN employees e ON e.id = u.employee_id WHERE LOWER(u.email) <> LOWER(e.email)"))
    if a.has("employees", "role"):
        a.add("info:employee_role", "Distinct employees.role values (read only by the export)", a.rows(
            "SELECT role, COUNT(*) AS n FROM employees GROUP BY role"))


def check_payroll_headcount(a: Audit):
    if a.has("finance_payroll_runs", "id", "headcount") and a.has("finance_payroll_lines", "payroll_run_id", "employee_id"):
        a.add("cache:headcount", "Payroll runs whose headcount differs from distinct employees on their lines", a.rows(
            "SELECT r.id AS run_id, r.period_label, r.headcount, COUNT(DISTINCT l.employee_id) AS line_employees "
            "FROM finance_payroll_runs r LEFT JOIN finance_payroll_lines l ON l.payroll_run_id = r.id "
            "GROUP BY r.id, r.period_label, r.headcount HAVING COALESCE(r.headcount, 0) <> COUNT(DISTINCT l.employee_id)"))


CHECKS: List[Callable[[Audit], None]] = [
    check_effective_overlaps, check_bad_dates, check_duplicates, check_cached_values,
    check_payment_ledger_link, check_orphans, check_attachments, check_duplicate_text, check_payroll_headcount,
]

# Sections reported for information only; they never fail the run.
INFORMATIONAL = {"info:employee_role"}


def run_audit(conn) -> List[dict]:
    audit = Audit(conn)
    for check in CHECKS:
        check(audit)
    return audit.sections


def main(argv: List[str]) -> int:
    as_json = "--json" in argv
    try:
        with get_engine().connect() as conn:
            sections = run_audit(conn)
    except Exception as exc:  # noqa: BLE001 - a CLI report must say what failed, not trace
        print(f"Audit failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    findings = sum(s["count"] for s in sections if s["key"] not in INFORMATIONAL)
    if as_json:
        print(json.dumps({"findings": findings, "sections": sections}, indent=2, default=str))
    else:
        for s in sections:
            if not s["count"]:
                continue
            print(f"[{s['count']}] {s['title']}" + (" (informational)" if s["key"] in INFORMATIONAL else ""))
            if s["note"]:
                print(f"    note: {s['note']}")
            for item in s["sample"]:
                print(f"    {item}")
            if s["count"] > len(s["sample"]):
                print(f"    ... and {s['count'] - len(s['sample'])} more")
        print(f"\n{findings} finding(s) across {sum(1 for s in sections if s['count'] and s['key'] not in INFORMATIONAL)} check(s)."
              if findings else "\nNo findings.")
    return 1 if findings else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
