"""
be/scripts/reconcile_stores.py
Reconciliation script to diff Google Sheets records against PostgreSQL / SQLite records.
Reports total counts, missing rows, and value mismatches across all domains.

Usage:
    python scripts/reconcile_stores.py [--domain DOMAIN]
"""
import sys
import os
import argparse

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sheets_client
from db import get_db_context
from models_db import (
    EmployeeDB,
    UserDB,
    SalaryHistoryDB,
    EmployeeBankAccountDB,
    EmployeeNoteDB,
    EmployeeDocumentDB,
    CompanyDocumentDB,
    InsuranceCategoryDB,
    InsuranceClaimDB,
    RequestDB,
    VacationHistoryDB,
    InvoiceDB,
    AuditLogDB,
)


def reconcile(client=None, domain: str = "all") -> dict:
    client = client or sheets_client.get_client()
    report = {}
    target_domain = (domain or "all").lower().strip()

    with get_db_context() as db:
        # 1. Employees
        if target_domain in ("all", "employees"):
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
        if target_domain in ("all", "bank", "bank_accounts"):
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

        # 3. Salary History
        if target_domain in ("all", "salary", "salary_history"):
            sheet_sal = client.get_all_records("SalaryHistory")
            db_sal = {s.id: s for s in db.query(SalaryHistoryDB).all()}
            sal_mismatches = []
            for s in sheet_sal:
                sid = int(s.get("id", 0)) if str(s.get("id", "")).isdigit() else None
                if not sid:
                    continue
                if sid not in db_sal:
                    sal_mismatches.append(f"Missing in SQL: SalaryHistory ID {sid}")
            report["salary_history"] = {
                "sheets_count": len(sheet_sal),
                "sql_count": len(db_sal),
                "mismatches": sal_mismatches,
                "status": "PASS" if len(sal_mismatches) == 0 else "FAIL",
            }

        # 4. Employee Notes
        if target_domain in ("all", "notes", "employee_notes"):
            sheet_notes = client.get_all_records("EmployeeNotes")
            db_notes = {n.id: n for n in db.query(EmployeeNoteDB).all()}
            note_mismatches = []
            for s in sheet_notes:
                nid = int(s.get("id", 0)) if str(s.get("id", "")).isdigit() else None
                if not nid:
                    continue
                if nid not in db_notes:
                    note_mismatches.append(f"Missing in SQL: EmployeeNote ID {nid}")
            report["employee_notes"] = {
                "sheets_count": len(sheet_notes),
                "sql_count": len(db_notes),
                "mismatches": note_mismatches,
                "status": "PASS" if len(note_mismatches) == 0 else "FAIL",
            }

        # 5. Documents (Employee + Company)
        if target_domain in ("all", "documents", "employee_documents"):
            sheet_edocs = client.get_all_records("EmployeeDocuments")
            db_edocs = {d.id: d for d in db.query(EmployeeDocumentDB).all()}
            edoc_mismatches = []
            for s in sheet_edocs:
                did = int(s.get("id", 0)) if str(s.get("id", "")).isdigit() else None
                if not did:
                    continue
                if did not in db_edocs:
                    edoc_mismatches.append(f"Missing in SQL: EmployeeDocument ID {did}")
            report["employee_documents"] = {
                "sheets_count": len(sheet_edocs),
                "sql_count": len(db_edocs),
                "mismatches": edoc_mismatches,
                "status": "PASS" if len(edoc_mismatches) == 0 else "FAIL",
            }

        if target_domain in ("all", "documents", "company_documents"):
            sheet_cdocs = client.get_all_records("CompanyDocuments")
            db_cdocs = {d.id: d for d in db.query(CompanyDocumentDB).all()}
            cdoc_mismatches = []
            for s in sheet_cdocs:
                did = int(s.get("id", 0)) if str(s.get("id", "")).isdigit() else None
                if not did:
                    continue
                if did not in db_cdocs:
                    cdoc_mismatches.append(f"Missing in SQL: CompanyDocument ID {did}")
            report["company_documents"] = {
                "sheets_count": len(sheet_cdocs),
                "sql_count": len(db_cdocs),
                "mismatches": cdoc_mismatches,
                "status": "PASS" if len(cdoc_mismatches) == 0 else "FAIL",
            }

        # 6. Insurance Categories & Claims
        if target_domain in ("all", "insurance", "insurance_categories"):
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

        if target_domain in ("all", "insurance", "insurance_claims"):
            sheet_claims = client.get_all_records("InsuranceClaims")
            db_claims = {c.id: c for c in db.query(InsuranceClaimDB).all()}
            claim_mismatches = []
            for s in sheet_claims:
                cid = int(s.get("id", 0)) if str(s.get("id", "")).isdigit() else None
                if not cid:
                    continue
                if cid not in db_claims:
                    claim_mismatches.append(f"Missing in SQL: InsuranceClaim ID {cid}")
            report["insurance_claims"] = {
                "sheets_count": len(sheet_claims),
                "sql_count": len(db_claims),
                "mismatches": claim_mismatches,
                "status": "PASS" if len(claim_mismatches) == 0 else "FAIL",
            }

        # 7. Requests
        if target_domain in ("all", "requests"):
            sheet_reqs = client.get_all_records("Requests")
            db_reqs = {r.id: r for r in db.query(RequestDB).all()}
            req_mismatches = []
            for s in sheet_reqs:
                rid = int(s.get("id", 0)) if str(s.get("id", "")).isdigit() else None
                if not rid:
                    continue
                if rid not in db_reqs:
                    req_mismatches.append(f"Missing in SQL: Request ID {rid}")
            report["requests"] = {
                "sheets_count": len(sheet_reqs),
                "sql_count": len(db_reqs),
                "mismatches": req_mismatches,
                "status": "PASS" if len(req_mismatches) == 0 else "FAIL",
            }

        # 8. Vacation History
        if target_domain in ("all", "vacations", "vacation_history"):
            sheet_vacs = client.get_all_records("VacationHistory")
            db_vacs = {v.id: v for v in db.query(VacationHistoryDB).all()}
            vac_mismatches = []
            for s in sheet_vacs:
                vid = int(s.get("id", 0)) if str(s.get("id", "")).isdigit() else None
                if not vid:
                    continue
                if vid not in db_vacs:
                    vac_mismatches.append(f"Missing in SQL: VacationHistory ID {vid}")
            report["vacation_history"] = {
                "sheets_count": len(sheet_vacs),
                "sql_count": len(db_vacs),
                "mismatches": vac_mismatches,
                "status": "PASS" if len(vac_mismatches) == 0 else "FAIL",
            }

        # 9. Invoices
        if target_domain in ("all", "invoices"):
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

        # 10. Audit Log
        if target_domain in ("all", "audit", "audit_log"):
            sheet_audit = client.get_all_records("AuditLog")
            db_audit = {a.id: a for a in db.query(AuditLogDB).all()}
            audit_mismatches = []
            for s in sheet_audit:
                aid = int(s.get("id", 0)) if str(s.get("id", "")).isdigit() else None
                if not aid:
                    continue
                if aid not in db_audit:
                    audit_mismatches.append(f"Missing in SQL: AuditLog ID {aid}")
            report["audit_log"] = {
                "sheets_count": len(sheet_audit),
                "sql_count": len(db_audit),
                "mismatches": audit_mismatches,
                "status": "PASS" if len(audit_mismatches) == 0 else "FAIL",
            }

    return report


def main():
    parser = argparse.ArgumentParser(description="Reconcile Google Sheets records with SQL database.")
    parser.add_argument(
        "--domain",
        type=str,
        default="all",
        help="Target domain to reconcile (e.g. 'employees', 'salary', 'bank', 'documents', 'insurance', 'requests', 'vacations', 'invoices', 'audit', or 'all')",
    )
    args = parser.parse_args()

    print(f"Running Store Reconciliation (Sheets vs SQL, domain: {args.domain})...")
    res = reconcile(domain=args.domain)
    all_passed = True

    print("\n" + "=" * 70)
    print(f"{'Domain':<24} | {'Status':<6} | {'Sheets':<8} | {'SQL':<8}")
    print("-" * 70)
    for domain, r in res.items():
        print(f"{domain:<24} | {r['status']:<6} | {r['sheets_count']:<8} | {r['sql_count']:<8}")
        if r["mismatches"]:
            all_passed = False
            for m in r["mismatches"][:5]:
                print(f"    - {m}")
            if len(r["mismatches"]) > 5:
                print(f"    ... and {len(r['mismatches']) - 5} more")
    print("=" * 70)

    if all_passed:
        print("\n[SUCCESS] All checked domains match 100% between Google Sheets and SQL!")
    else:
        print("\n[DISCREPANCY] Reconciliation found differences between stores.")
        sys.exit(1)


if __name__ == "__main__":
    main()
