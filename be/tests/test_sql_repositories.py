"""
be/tests/test_sql_repositories.py
Unit tests testing SQLAlchemy-backed SQL repositories and Dual-Write shadow-mode
repositories on an isolated test SQLite database.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db import Base, reset_engine_for_testing
from repositories.sql.employees import SqlEmployeeRepository
from repositories.sql.salary import SqlSalaryRepository
from repositories.sql.bank import SqlBankRepository
from repositories.sql.documents import SqlCompanyDocumentRepository
from repositories.sql.insurance import SqlInsuranceRepository
from repositories.sql.requests import SqlRequestRepository
from repositories.sql.vacations import SqlVacationRepository
from repositories.sql.invoices import SqlInvoiceRepository
from repositories.sql.audit import SqlAuditRepository
from repositories.sql.auth import SqlUserRepository
from repositories.dual.employees import DualWriteEmployeeRepository
from repositories.sheets.employees import SheetsEmployeeRepository


@pytest.fixture(autouse=True)
def setup_test_sql_db(tmp_path):
    db_file = tmp_path / "test_sql.db"
    db_url = f"sqlite:///{db_file}"
    reset_engine_for_testing(db_url)
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)
    reset_engine_for_testing(None)


def test_sql_employee_and_user_repository():
    emp_repo = SqlEmployeeRepository()
    user_repo = SqlUserRepository()

    emp_id = emp_repo.create({
        "name": "Sarah Connor",
        "email": "sarah@hrflow.test",
        "dept": "Operations",
        "job_role": "Director",
        "internal_salary_usd": 4000.0,
        "external_salary_usd": 2000.0,
        "join_date": "2026-01-01",
        "status": "Active",
    })
    assert emp_id > 0

    emp = emp_repo.get_by_id(emp_id)
    assert emp["name"] == "Sarah Connor"
    assert emp["salary"] == 6000.0
    assert emp["internal_salary_usd"] == 4000.0
    assert emp["external_salary_usd"] == 2000.0

    # Test auto-created user
    user = user_repo.find_by_email("sarah@hrflow.test")
    assert user is not None
    assert user["employee_id"] == emp_id
    assert user["role"] == "employee"

    # Test update
    emp_repo.update(emp_id, {"internal_salary_usd": 4500.0})
    updated = emp_repo.get_by_id(emp_id)
    assert updated["internal_salary_usd"] == 4500.0
    assert updated["salary"] == 6500.0

    # Test notes
    note_id = emp_repo.create_note(emp_id, {"date": "2026-08-20", "category": "Review", "note": "Excellent", "created_by": "admin@hrflow.test"})
    notes = emp_repo.get_notes(emp_id)
    assert len(notes) == 1
    assert notes[0]["note"] == "Excellent"
    assert emp_repo.delete_note(note_id) is True
    assert len(emp_repo.get_notes(emp_id)) == 0

    # Test documents
    doc_id = emp_repo.create_document(emp_id, {"name": "Contract.pdf", "file_type": "pdf", "drive_file_id": "drv_123"})
    docs = emp_repo.get_documents(emp_id)
    assert len(docs) == 1
    assert docs[0]["name"] == "Contract.pdf"
    assert emp_repo.get_document_by_id(doc_id) is not None
    assert emp_repo.delete_document(doc_id) is True
    assert emp_repo.get_document_by_id(doc_id) is None

    # Test delete employee
    assert emp_repo.delete(emp_id) is True
    assert emp_repo.get_by_id(emp_id) is None


def test_sql_salary_repository():
    emp_repo = SqlEmployeeRepository()
    emp_id = emp_repo.create({
        "name": "Kyle Reese",
        "email": "kyle@hrflow.test",
        "internal_salary_usd": 3000.0,
        "external_salary_usd": 1000.0,
    })

    salary_repo = SqlSalaryRepository()
    result = salary_repo.apply_raise(
        employee_id=emp_id,
        new_internal=3500.0,
        new_external=1200.0,
        effective_date="2026-08-20",
        reason="Promotion",
        actor_email="admin@hrflow.test",
    )
    assert result["new_salary"] == 4700.0
    assert result["internal_delta_amount"] == 500.0
    assert result["external_delta_amount"] == 200.0

    history = salary_repo.get_history(employee_id=emp_id)
    assert len(history) == 1
    assert history[0]["new_salary"] == 4700.0


def test_sql_bank_repository():
    emp_repo = SqlEmployeeRepository()
    emp_id = emp_repo.create({
        "name": "John Connor",
        "email": "john@hrflow.test",
    })

    bank_repo = SqlBankRepository()
    action, record_id = bank_repo.upsert(
        employee_id=emp_id,
        bank_name="QNB Alahli",
        iban="EG12345678901234567890",
        swift_code="QNBAEGCX",
        actor_email="admin@hrflow.test",
    )
    assert action == "create"
    assert record_id is not None

    masked = bank_repo.get_by_employee_id(emp_id, reveal=False)
    assert masked["has_details"] is True
    assert masked["iban"] == "*" * 18 + "7890"

    revealed = bank_repo.get_by_employee_id(emp_id, reveal=True)
    assert revealed["iban"] == "EG12345678901234567890"


def test_sql_company_documents_repository():
    doc_repo = SqlCompanyDocumentRepository()
    doc_id = doc_repo.create({
        "name": "Employee Handbook 2026",
        "file_type": "pdf",
        "category": "Handbook",
        "drive_file_id": "drive_handbook_id",
    })
    assert doc_id > 0

    doc = doc_repo.get_by_id(doc_id)
    assert doc is not None
    assert doc["name"] == "Employee Handbook 2026"

    all_docs = doc_repo.list_all()
    assert len(all_docs) == 1
    assert all_docs[0]["id"] == str(doc_id)

    assert doc_repo.delete(doc_id) is True
    assert doc_repo.get_by_id(doc_id) is None


def test_sql_insurance_and_requests_synchronization():
    emp_repo = SqlEmployeeRepository()
    emp_id = emp_repo.create({
        "name": "Marcus Wright",
        "email": "marcus@hrflow.test",
    })

    ins_repo = SqlInsuranceRepository()
    cat_id = ins_repo.create_category("Dental", 10000.0)
    assert cat_id > 0

    cats = ins_repo.list_categories()
    assert len(cats) == 1
    assert cats[0]["name"] == "Dental"

    claim_id = ins_repo.create_claim(
        claim_data={
            "employee_id": emp_id,
            "employee_name": "Marcus Wright",
            "category": "Dental",
            "provider": "Dental Clinic",
            "amount": 2500.0,
            "date": "2026-08-22",
            "status": "Pending",
        },
        request_data={
            "employee_id": emp_id,
            "employee_name": "Marcus Wright",
            "details": "Dental claim - EGP 2500.0",
            "date": "2026-08-22",
            "status": "Pending",
        },
    )
    assert claim_id > 0

    # Action claim -> verify sync to request
    req_repo = SqlRequestRepository()
    assert ins_repo.action_claim(claim_id, "Approved", "admin@hrflow.test") is True

    claim = ins_repo.get_claim_by_id(claim_id)
    assert claim["status"] == "Approved"

    reqs = req_repo.list_requests(scoped_employee_id=emp_id)
    assert len(reqs) == 1
    assert reqs[0]["status"] == "Approved"


def test_sql_vacation_repository_and_sync():
    emp_repo = SqlEmployeeRepository()
    emp_id = emp_repo.create({
        "name": "Grace",
        "email": "grace@hrflow.test",
    })

    vac_repo = SqlVacationRepository()
    req_repo = SqlRequestRepository()

    vac_id = vac_repo.create_vacation_request(
        vacation_data={
            "employee_id": emp_id,
            "type": "Annual Leave",
            "start_date": "2026-09-01",
            "end_date": "2026-09-05",
            "days": 5,
            "status": "Pending",
        },
        request_data={
            "employee_id": emp_id,
            "employee_name": "Grace",
            "details": "Annual Leave: 2026-09-01 to 2026-09-05",
            "date": "2026-08-22",
            "status": "Pending",
        },
    )
    assert vac_id > 0

    # Action request -> verify sync to vacation
    reqs = req_repo.list_requests(scoped_employee_id=emp_id)
    assert len(reqs) == 1
    req_id = reqs[0]["id"]

    assert req_repo.action_request(req_id, "Approved", "admin@hrflow.test") is True

    vacs = vac_repo.get_history(scoped_employee_id=emp_id)
    assert len(vacs) == 1
    assert vacs[0]["status"] == "Approved"


def test_sql_invoice_and_audit_repositories():
    inv_repo = SqlInvoiceRepository()
    inv_id = inv_repo.create({
        "employee_id": 1,
        "employee_name": "Consultant One",
        "invoice_number": "260108",
        "payment_year": 2026,
        "payment_month": 8,
        "amount_usd": 3500.0,
        "currency": "USD",
        "status": "generated",
    })
    assert inv_id > 0

    existing = inv_repo.find_existing(1, 2026, 8)
    assert existing is not None
    assert existing["invoice_number"] == "260108"

    audit_repo = SqlAuditRepository()
    audit_repo.log("invoice.generate", "admin@hrflow.test", "invoice", inv_id, "amount=3500")
    logs = audit_repo.list_all()
    assert len(logs) == 1
    assert logs[0]["action"] == "invoice.generate"


def test_dual_write_employee_repository(fake_sheets_client):
    primary = SheetsEmployeeRepository(client=fake_sheets_client)
    shadow = SqlEmployeeRepository()
    dual = DualWriteEmployeeRepository(primary=primary, shadow=shadow)

    emp_id = dual.create({
        "name": "Dual Write Test",
        "email": "dual@hrflow.test",
        "internal_salary_usd": 2000.0,
        "external_salary_usd": 1000.0,
    })
    assert emp_id > 0

    # Primary has record
    primary_emp = primary.get_by_id(emp_id)
    assert primary_emp is not None
    assert primary_emp["name"] == "Dual Write Test"

    # Shadow SQL has record
    shadow_emp = shadow.get_by_id(emp_id)
    assert shadow_emp is not None
    assert shadow_emp["name"] == "Dual Write Test"
    assert shadow_emp["salary"] == 3000.0
