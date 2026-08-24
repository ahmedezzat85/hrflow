"""
be/scripts/backfill_sheets_to_sql.py
Idempotent backfill script to migrate all historical records from Google Sheets
into PostgreSQL / SQLite relational database.

Usage:
    python scripts/backfill_sheets_to_sql.py
"""
import sys
import os
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sheets_client
from db import get_db_context, init_db
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


def _safe_float(val, default=0.0) -> float:
    if val is None or val == "":
        return default
    try:
        cleaned = str(val).replace("$", "").replace("EGP", "").replace(",", "").strip()
        return float(cleaned)
    except (ValueError, TypeError):
        return default


def _safe_int(val, default=0) -> int:
    if val is None or val == "":
        return default
    try:
        return int(float(str(val).strip()))
    except (ValueError, TypeError):
        return default


def backfill_all(client=None) -> dict:
    start_time = time.time()
    client = client or sheets_client.get_client()
    init_db()

    stats = {
        "employees": 0,
        "users": 0,
        "salary_history": 0,
        "bank_accounts": 0,
        "employee_notes": 0,
        "employee_documents": 0,
        "company_documents": 0,
        "insurance_categories": 0,
        "insurance_claims": 0,
        "requests": 0,
        "vacation_history": 0,
        "invoices": 0,
        "audit_log": 0,
    }

    with get_db_context() as db:
        # 1. Employees & Users
        emp_rows = client.get_all_records("Employees")
        for r in emp_rows:
            emp_id = _safe_int(r.get("id"))
            if not emp_id:
                continue
            internal = _safe_float(r.get("internal_salary_usd"))
            external = _safe_float(r.get("external_salary_usd"))
            total_salary = _safe_float(r.get("salary")) or (internal + external)

            emp = db.query(EmployeeDB).filter(EmployeeDB.id == emp_id).first()
            if not emp:
                emp = EmployeeDB(id=emp_id)
                db.add(emp)

            emp.name = str(r.get("name") or "").strip()
            emp.email = str(r.get("email") or "").strip()
            emp.role = str(r.get("role") or "employee").strip()
            emp.dept = str(r.get("dept") or "").strip()
            emp.job_role = str(r.get("job_role") or "").strip()
            emp.salary = total_salary
            emp.internal_salary_usd = internal
            emp.external_salary_usd = external
            emp.join_date = str(r.get("join_date") or "").strip()
            emp.status = str(r.get("status") or "Active").strip()
            emp.vac_total = _safe_int(r.get("vac_total"), 21)
            emp.vac_used = _safe_int(r.get("vac_used"), 0)
            emp.next_raise = str(r.get("next_raise") or "").strip()
            emp.employment_state = str(r.get("employment_state") or "Full-Time").strip()
            emp.invoice_id = str(r.get("invoice_id") or "").strip()
            emp.address_line_1 = str(r.get("address_line_1") or "").strip()
            emp.address_line_2 = str(r.get("address_line_2") or "").strip()
            stats["employees"] += 1

        db.flush()

        # Users tab
        user_rows = client.get_all_records("Users")
        for r in user_rows:
            email = str(r.get("email") or "").strip()
            if not email:
                continue
            emp_id = _safe_int(r.get("employee_id")) or None
            user = db.query(UserDB).filter(UserDB.email == email).first()
            if not user:
                user = UserDB(email=email)
                db.add(user)
            user.role = str(r.get("role") or "employee").strip()
            user.employee_id = emp_id
            stats["users"] += 1

        # 2. Salary History
        sal_rows = client.get_all_records("SalaryHistory")
        for r in sal_rows:
            row_id = _safe_int(r.get("id"))
            emp_id = _safe_int(r.get("employee_id"))
            if not row_id or not emp_id:
                continue
            sh = db.query(SalaryHistoryDB).filter(SalaryHistoryDB.id == row_id).first()
            if not sh:
                sh = SalaryHistoryDB(id=row_id)
                db.add(sh)
            sh.employee_id = emp_id
            sh.date = str(r.get("date") or "")
            sh.previous_salary = _safe_float(r.get("previous_salary"))
            sh.new_salary = _safe_float(r.get("new_salary"))
            sh.pct_change = str(r.get("pct_change") or "")
            sh.reason = str(r.get("reason") or "")
            sh.applied_by = str(r.get("applied_by") or "")
            sh.previous_internal_usd = _safe_float(r.get("previous_internal_usd"))
            sh.previous_external_usd = _safe_float(r.get("previous_external_usd"))
            sh.new_internal_usd = _safe_float(r.get("new_internal_usd"))
            sh.new_external_usd = _safe_float(r.get("new_external_usd"))
            stats["salary_history"] += 1

        # 3. Bank Accounts
        bank_rows = client.get_all_records("EmployeeBankAccounts")
        for r in bank_rows:
            emp_id = _safe_int(r.get("employee_id"))
            if not emp_id:
                continue
            bank = db.query(EmployeeBankAccountDB).filter(EmployeeBankAccountDB.employee_id == emp_id).first()
            if not bank:
                bank = EmployeeBankAccountDB(employee_id=emp_id)
                db.add(bank)
            bank.bank_name = str(r.get("bank_name") or "").strip()
            bank.iban = str(r.get("iban") or "").strip()
            bank.swift_code = str(r.get("swift_code") or "").strip()
            bank.updated_by = str(r.get("updated_by") or "").strip()
            bank.updated_at = str(r.get("updated_at") or "").strip()
            stats["bank_accounts"] += 1

        # 4. Employee Notes
        note_rows = client.get_all_records("EmployeeNotes")
        for r in note_rows:
            row_id = _safe_int(r.get("id"))
            emp_id = _safe_int(r.get("employee_id"))
            if not row_id or not emp_id:
                continue
            note = db.query(EmployeeNoteDB).filter(EmployeeNoteDB.id == row_id).first()
            if not note:
                note = EmployeeNoteDB(id=row_id)
                db.add(note)
            note.employee_id = emp_id
            note.date = str(r.get("date") or "")
            note.category = str(r.get("category") or "General")
            note.note = str(r.get("note") or "")
            note.created_by = str(r.get("created_by") or "")
            stats["employee_notes"] += 1

        # 5. Employee Documents
        doc_rows = client.get_all_records("EmployeeDocuments")
        for r in doc_rows:
            row_id = _safe_int(r.get("id"))
            emp_id = _safe_int(r.get("employee_id"))
            if not row_id or not emp_id:
                continue
            doc = db.query(EmployeeDocumentDB).filter(EmployeeDocumentDB.id == row_id).first()
            if not doc:
                doc = EmployeeDocumentDB(id=row_id)
                db.add(doc)
            doc.employee_id = emp_id
            doc.name = str(r.get("name") or "")
            doc.file_type = str(r.get("file_type") or "")
            doc.drive_file_id = str(r.get("drive_file_id") or "")
            doc.view_url = str(r.get("view_url") or "")
            doc.download_url = str(r.get("download_url") or "")
            doc.uploaded_by = str(r.get("uploaded_by") or "")
            doc.uploaded_at = str(r.get("uploaded_at") or "")
            stats["employee_documents"] += 1

        # 6. Company Documents
        cdoc_rows = client.get_all_records("CompanyDocuments")
        for r in cdoc_rows:
            row_id = _safe_int(r.get("id"))
            if not row_id:
                continue
            cdoc = db.query(CompanyDocumentDB).filter(CompanyDocumentDB.id == row_id).first()
            if not cdoc:
                cdoc = CompanyDocumentDB(id=row_id)
                db.add(cdoc)
            cdoc.name = str(r.get("name") or "")
            cdoc.file_type = str(r.get("file_type") or "")
            cdoc.category = str(r.get("category") or "General")
            cdoc.drive_file_id = str(r.get("drive_file_id") or "")
            cdoc.view_url = str(r.get("view_url") or "")
            cdoc.download_url = str(r.get("download_url") or "")
            cdoc.uploaded_by = str(r.get("uploaded_by") or "")
            cdoc.uploaded_at = str(r.get("uploaded_at") or "")
            stats["company_documents"] += 1

        # 7. Insurance Categories
        cat_rows = client.get_all_records("InsuranceCategories")
        for r in cat_rows:
            row_id = _safe_int(r.get("id"))
            name = str(r.get("name") or "").strip()
            if not name:
                continue
            cat = None
            if row_id:
                cat = db.query(InsuranceCategoryDB).filter(InsuranceCategoryDB.id == row_id).first()
            if not cat:
                cat = db.query(InsuranceCategoryDB).filter(InsuranceCategoryDB.name == name).first()
            if not cat:
                cat = InsuranceCategoryDB(id=row_id if row_id else None, name=name)
                db.add(cat)
            else:
                cat.name = name
            cat.annual_limit = _safe_float(r.get("annual_limit"))
            stats["insurance_categories"] += 1

        # 8. Insurance Claims
        claim_rows = client.get_all_records("InsuranceClaims")
        for r in claim_rows:
            row_id = _safe_int(r.get("id"))
            emp_id = _safe_int(r.get("employee_id"))
            if not row_id or not emp_id:
                continue
            claim = db.query(InsuranceClaimDB).filter(InsuranceClaimDB.id == row_id).first()
            if not claim:
                claim = InsuranceClaimDB(id=row_id)
                db.add(claim)
            claim.employee_id = emp_id
            claim.employee_name = str(r.get("employee_name") or "")
            claim.category = str(r.get("category") or "")
            claim.provider = str(r.get("provider") or "")
            claim.amount = _safe_float(r.get("amount"))
            claim.date = str(r.get("date") or "")
            claim.status = str(r.get("status") or "Pending")
            claim.document_url = str(r.get("document_url") or "")
            claim.submitted_by = str(r.get("submitted_by") or "")
            stats["insurance_claims"] += 1

        # 9. Requests
        req_rows = client.get_all_records("Requests")
        for r in req_rows:
            row_id = _safe_int(r.get("id"))
            emp_id = _safe_int(r.get("employee_id"))
            if not row_id or not emp_id:
                continue
            req = db.query(RequestDB).filter(RequestDB.id == row_id).first()
            if not req:
                req = RequestDB(id=row_id)
                db.add(req)
            req.employee_id = emp_id
            req.employee_name = str(r.get("employee_name") or "")
            req.type = str(r.get("type") or "")
            req.details = str(r.get("details") or "")
            req.date = str(r.get("date") or "")
            req.status = str(r.get("status") or "Pending")
            req.reviewed_by = str(r.get("reviewed_by") or "")
            req.reviewed_at = str(r.get("reviewed_at") or "")
            req.submitted_by = str(r.get("submitted_by") or "")
            stats["requests"] += 1

        # 10. Vacation History
        vac_rows = client.get_all_records("VacationHistory")
        for r in vac_rows:
            row_id = _safe_int(r.get("id"))
            emp_id = _safe_int(r.get("employee_id"))
            if not row_id or not emp_id:
                continue
            vac = db.query(VacationHistoryDB).filter(VacationHistoryDB.id == row_id).first()
            if not vac:
                vac = VacationHistoryDB(id=row_id)
                db.add(vac)
            vac.employee_id = emp_id
            vac.type = str(r.get("type") or "")
            vac.start_date = str(r.get("start_date") or "")
            vac.end_date = str(r.get("end_date") or "")
            vac.days = _safe_int(r.get("days"), 1)
            vac.status = str(r.get("status") or "Pending")
            vac.submitted_by = str(r.get("submitted_by") or "")
            stats["vacation_history"] += 1

        # 11. Invoices
        inv_rows = client.get_all_records("Invoices")
        for r in inv_rows:
            row_id = _safe_int(r.get("id"))
            emp_id = _safe_int(r.get("employee_id"))
            if not row_id or not emp_id:
                continue
            inv = db.query(InvoiceDB).filter(InvoiceDB.id == row_id).first()
            if not inv:
                inv = InvoiceDB(id=row_id)
                db.add(inv)
            inv.employee_id = emp_id
            inv.employee_name = str(r.get("employee_name") or "")
            inv.invoice_number = str(r.get("invoice_number") or "")
            inv.payment_year = _safe_int(r.get("payment_year"))
            inv.payment_month = _safe_int(r.get("payment_month"))
            inv.invoice_date = str(r.get("invoice_date") or "")
            inv.amount_usd = _safe_float(r.get("amount_usd"))
            inv.currency = str(r.get("currency") or "USD")
            inv.document_name = str(r.get("document_name") or "")
            inv.drive_file_id = str(r.get("drive_file_id") or "")
            inv.drive_web_url = str(r.get("drive_web_url") or "")
            inv.template_version = str(r.get("template_version") or "v1")
            inv.status = str(r.get("status") or "generated")
            inv.failure_reason = str(r.get("failure_reason") or "")
            inv.generated_by = str(r.get("generated_by") or "")
            inv.created_at = str(r.get("created_at") or "")
            stats["invoices"] += 1

        # 12. Audit Log
        audit_rows = client.get_all_records("AuditLog")
        for r in audit_rows:
            row_id = _safe_int(r.get("id"))
            if not row_id:
                continue
            entry = db.query(AuditLogDB).filter(AuditLogDB.id == row_id).first()
            if not entry:
                entry = AuditLogDB(id=row_id)
                db.add(entry)
            entry.timestamp = str(r.get("timestamp") or "")
            entry.actor_email = str(r.get("actor_email") or "")
            entry.action = str(r.get("action") or "")
            entry.target_type = str(r.get("target_type") or "")
            entry.target_id = str(r.get("target_id") or "")
            entry.details = str(r.get("details") or "")
            stats["audit_log"] += 1

    elapsed = round(time.time() - start_time, 2)
    stats["elapsed_seconds"] = elapsed
    return stats


if __name__ == "__main__":
    print("Starting Google Sheets -> SQL Backfill...")
    results = backfill_all()
    print("Backfill completed successfully:")
    for k, v in results.items():
        print(f"  {k}: {v}")
