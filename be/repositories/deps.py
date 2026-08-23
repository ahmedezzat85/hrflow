"""
be/repositories/deps.py
FastAPI dependency providers for domain repositories.
Returns concrete Sheets-backed repositories during Phase 0.
"""
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
from repositories.sheets.bank import SheetsBankRepository
from repositories.sheets.documents import SheetsCompanyDocumentRepository
from repositories.sheets.insurance import SheetsInsuranceRepository
from repositories.sheets.requests import SheetsRequestRepository
from repositories.sheets.vacations import SheetsVacationRepository
from repositories.sheets.invoices import SheetsInvoiceRepository
from repositories.sheets.audit import SheetsAuditRepository
from repositories.sheets.auth import SheetsUserRepository


def get_employee_repo() -> EmployeeRepository:
    return SheetsEmployeeRepository()


def get_salary_repo() -> SalaryRepository:
    return SheetsSalaryRepository()


def get_bank_repo() -> BankRepository:
    return SheetsBankRepository()


def get_company_document_repo() -> CompanyDocumentRepository:
    return SheetsCompanyDocumentRepository()


def get_insurance_repo() -> InsuranceRepository:
    return SheetsInsuranceRepository()


def get_request_repo() -> RequestRepository:
    return SheetsRequestRepository()


def get_vacation_repo() -> VacationRepository:
    return SheetsVacationRepository()


def get_invoice_repo() -> InvoiceRepository:
    return SheetsInvoiceRepository()


def get_audit_repo() -> AuditRepository:
    return SheetsAuditRepository()


def get_user_repo() -> UserRepository:
    return SheetsUserRepository()
