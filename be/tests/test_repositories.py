"""
be/tests/test_repositories.py
Unit tests verifying the repository abstractions and the dependency injection wiring (SQL repositories only).
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
