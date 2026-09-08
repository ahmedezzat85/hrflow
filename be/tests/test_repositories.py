"""
be/tests/test_repositories.py
Unit tests verifying repository abstractions, concrete Sheets implementations,
and dependency injection wiring for Phase 0 of the database redesign.
"""
import pytest
from repositories.interfaces import (
    EmployeeRepository,
    SalaryRepository,
    BankRepository,
    CompanyDocumentRepository,
    InsuranceRepository,
    RequestRepository,
    VacationRepository,
    InvoiceRepository,
    AuditRepository,
    UserRepository,
)
from repositories.sheets.employees import SheetsEmployeeRepository
from repositories.sheets.salary import SheetsSalaryRepository
from repositories.sheets.employee_bank_accounts import SheetsBankRepository
from repositories.sheets.documents import SheetsCompanyDocumentRepository
from repositories.sheets.insurance import SheetsInsuranceRepository
from repositories.sheets.requests import SheetsRequestRepository
from repositories.sheets.vacations import SheetsVacationRepository
from repositories.sheets.salary_payment_docs import SheetsInvoiceRepository
from repositories.sheets.audit import SheetsAuditRepository
from repositories.sheets.auth import SheetsUserRepository
from repositories.deps import (
    get_employee_repo,
    get_salary_repo,
    get_bank_repo,
    get_company_document_repo,
    get_insurance_repo,
    get_request_repo,
    get_vacation_repo,
    get_invoice_repo,
    get_audit_repo,
    get_user_repo,
)


def test_repository_dependency_injection_returns_interfaces():
    assert isinstance(get_employee_repo(), EmployeeRepository)
    assert isinstance(get_salary_repo(), SalaryRepository)
    assert isinstance(get_bank_repo(), BankRepository)
    assert isinstance(get_company_document_repo(), CompanyDocumentRepository)
    assert isinstance(get_insurance_repo(), InsuranceRepository)
    assert isinstance(get_request_repo(), RequestRepository)
    assert isinstance(get_vacation_repo(), VacationRepository)
    assert isinstance(get_invoice_repo(), InvoiceRepository)
    assert isinstance(get_audit_repo(), AuditRepository)
    assert isinstance(get_user_repo(), UserRepository)


def test_employee_repository_crud(fake_sheets_client):
    repo = SheetsEmployeeRepository(client=fake_sheets_client)
    emp_id = repo.create({
        "name": "Test Engineer",
        "email": "engineer@hrflow.test",
        "dept": "Engineering",
        "job_role": "Backend Developer",
        "internal_salary_usd": 3000.0,
        "external_salary_usd": 1500.0,
        "join_date": "2026-08-01",
        "status": "Active",
        "vac_total": 21,
    })
    assert emp_id > 0

    emp = repo.get_by_id(emp_id)
    assert emp is not None
    assert emp["name"] == "Test Engineer"
    assert emp["salary"] == 4500.0
    assert emp["internal_salary_usd"] == 3000.0
    assert emp["external_salary_usd"] == 1500.0

    # Test update salary component recomputes total
    repo.update(emp_id, {"internal_salary_usd": 3500.0})
    updated = repo.get_by_id(emp_id)
    assert updated["internal_salary_usd"] == 3500.0
    assert updated["salary"] == 5000.0

    # Test list
    all_emps = repo.list_all()
    assert any(e["id"] == emp_id for e in all_emps)

    scoped_emps = repo.list_all(scoped_employee_id=emp_id)
    assert len(scoped_emps) == 1
    assert scoped_emps[0]["id"] == emp_id

    # Test delete
    assert repo.delete(emp_id) is True
    assert repo.get_by_id(emp_id) is None


def test_salary_repository_apply_raise(fake_sheets_client):
    emp_repo = SheetsEmployeeRepository(client=fake_sheets_client)
    emp_id = emp_repo.create({
        "name": "Salary Test",
        "email": "salary@hrflow.test",
        "dept": "Ops",
        "job_role": "Specialist",
        "internal_salary_usd": 2000.0,
        "external_salary_usd": 1000.0,
    })

    salary_repo = SheetsSalaryRepository(client=fake_sheets_client)
    result = salary_repo.apply_raise(
        employee_id=emp_id,
        new_internal=2500.0,
        new_external=1200.0,
        effective_date="2026-08-15",
        reason="Annual Performance",
        actor_email="admin@hrflow.test",
    )
    assert result["new_salary"] == 3700.0
    assert result["internal_delta_amount"] == 500.0
    assert result["external_delta_amount"] == 200.0

    history = salary_repo.get_history(employee_id=emp_id)
    assert len(history) >= 1
    assert history[-1]["new_salary"] == 3700.0


def test_bank_repository_upsert_and_masking(fake_sheets_client):
    emp_repo = SheetsEmployeeRepository(client=fake_sheets_client)
    emp_id = emp_repo.create({
        "name": "Bank Test",
        "email": "bank@hrflow.test",
        "dept": "Finance",
        "job_role": "Analyst",
        "internal_salary_usd": 1000.0,
        "external_salary_usd": 500.0,
    })

    bank_repo = SheetsBankRepository(client=fake_sheets_client)
    # Non-existent
    initial = bank_repo.get_by_employee_id(emp_id)
    assert initial["has_details"] is False

    # Create
    action, record_id = bank_repo.upsert(
        employee_id=emp_id,
        bank_name="CIB Egypt",
        iban="EG11223344556677889900",
        swift_code="CIBEEGCX",
        actor_email="admin@hrflow.test",
    )
    assert action == "create"
    assert record_id is not None

    # Get masked
    masked = bank_repo.get_by_employee_id(emp_id, reveal=False)
    assert masked["has_details"] is True
    assert masked["iban"] == "*" * 18 + "9900"

    # Get revealed
    revealed = bank_repo.get_by_employee_id(emp_id, reveal=True)
    assert revealed["iban"] == "EG11223344556677889900"


def test_user_repository_find_by_email(fake_sheets_client):
    user_repo = SheetsUserRepository(client=fake_sheets_client)
    admin_user = user_repo.find_by_email("admin@hrflow.test")
    assert admin_user is not None
    assert admin_user["role"] == "admin"

    non_existent = user_repo.find_by_email("unknown@nobody.com")
    assert non_existent is None


def test_no_direct_sheets_client_imports_in_routers():
    import glob
    import os

    router_files = glob.glob(os.path.join(os.path.dirname(__file__), "..", "routers", "*.py"))
    assert len(router_files) > 0

    for router_path in router_files:
        with open(router_path, "r", encoding="utf-8") as f:
            content = f.read()
        assert "import sheets_client" not in content, f"{router_path} directly imports sheets_client"
        assert "from sheets_client" not in content, f"{router_path} directly imports from sheets_client"
