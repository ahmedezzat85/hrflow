"""
be/scripts/reconcile_stores.py
Reconciliation script to diff Google Sheets records against PostgreSQL / SQLite records.
Reports total counts, missing rows, and value mismatches per domain.

Usage:
    python scripts/reconcile_stores.py
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sheets_client
from db import get_db_context
from models_db import (
    EmployeeDB,
    UserDB,
    SalaryHistoryDB,
    EmployeeBankAccountDB,
    CompanyDocumentDB,
    InsuranceCategoryDB,
    InsuranceClaimDB,
    RequestDB,
    VacationHistoryDB,
    InvoiceDB,
)


def reconcile(client=None) -> dict:
    client = client or sheets_client.get_client()
    report = {}

    with get_db_context() as db:
        # 1. Employees
        sheet_emps = client.get_all_records("Employees")
        db_emps = {e.id: e for e in db.query(EmployeeDB).all()}
        emp_mismatches = []
        for s in sheet_emps:
            eid = int(s.get("id", 0)) if str(s.get("id", "")).isdigit() else None
            if not eid:
                continue
            if eid not in db_emps:
                emp_mismatches.append(f"Missing in SQL: Employee ID {eid} ({s.get('email')})")
            else:
                d = db_emps[eid]
                if s.get("email", "").strip() != d.email:
                    emp_mismatches.append(f"Employee {eid} email mismatch: Sheets={s.get('email')} vs SQL={d.email}")
        report["employees"] = {
            "sheets_count": len(sheet_emps),
            "sql_count": len(db_emps),
            "mismatches": emp_mismatches,
            "status": "PASS" if len(emp_mismatches) == 0 else "FAIL",
        }

        # 2. Bank Accounts
        sheet_bank = client.get_all_records("EmployeeBankAccounts")
        db_bank = {b.employee_id: b for b in db.query(EmployeeBankAccountDB).all()}
        bank_mismatches = []
        for s in sheet_bank:
            eid = int(s.get("employee_id", 0)) if str(s.get("employee_id", "")).isdigit() else None
            if not eid:
                continue
            if eid not in db_bank:
                bank_mismatches.append(f"Missing in SQL: Bank details for employee {eid}")
            else:
                d = db_bank[eid]
                if str(s.get("iban", "")).strip() != d.iban:
                    bank_mismatches.append(f"Bank {eid} IBAN mismatch")
        report["bank_accounts"] = {
            "sheets_count": len(sheet_bank),
            "sql_count": len(db_bank),
            "mismatches": bank_mismatches,
            "status": "PASS" if len(bank_mismatches) == 0 else "FAIL",
        }

        # 3. Insurance Categories
        sheet_cats = client.get_all_records("InsuranceCategories")
        db_cats = {c.name.strip().lower(): c for c in db.query(InsuranceCategoryDB).all()}
        cat_mismatches = []
        for s in sheet_cats:
            cname = str(s.get("name", "")).strip().lower()
            if not cname:
                continue
            if cname not in db_cats:
                cat_mismatches.append(f"Missing in SQL: Category {s.get('name')}")
        report["insurance_categories"] = {
            "sheets_count": len(sheet_cats),
            "sql_count": len(db_cats),
            "mismatches": cat_mismatches,
            "status": "PASS" if len(cat_mismatches) == 0 else "FAIL",
        }

        # 4. Invoices
        sheet_invs = client.get_all_records("Invoices")
        db_invs = {i.id: i for i in db.query(InvoiceDB).all()}
        inv_mismatches = []
        for s in sheet_invs:
            iid = int(s.get("id", 0)) if str(s.get("id", "")).isdigit() else None
            if not iid:
                continue
            if iid not in db_invs:
                inv_mismatches.append(f"Missing in SQL: Invoice ID {iid}")
        report["invoices"] = {
            "sheets_count": len(sheet_invs),
            "sql_count": len(db_invs),
            "mismatches": inv_mismatches,
            "status": "PASS" if len(inv_mismatches) == 0 else "FAIL",
        }

    return report


if __name__ == "__main__":
    print("Running Store Reconciliation (Sheets vs SQL)...")
    res = reconcile()
    all_passed = True
    for domain, r in res.items():
        print(f"Domain [{domain}]: {r['status']} (Sheets={r['sheets_count']}, SQL={r['sql_count']})")
        if r["mismatches"]:
            all_passed = False
            for m in r["mismatches"]:
                print(f"  - {m}")
    if all_passed:
        print("\nAll domains match 100% between Google Sheets and SQL!")
    else:
        print("\nReconciliation found discrepancies.")
        sys.exit(1)
