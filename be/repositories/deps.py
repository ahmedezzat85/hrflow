"""
be/repositories/deps.py
FastAPI dependency providers for domain repositories.
HRFlow operates exclusively on SQL (PostgreSQL/SQLite via SQLAlchemy) as its database engine.
Google Sheets is used solely as an export destination.
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
# SQL Repositories (exclusive operational engine)
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


def get_employee_repo() -> EmployeeRepository:
    return SqlEmployeeRepository()


def get_salary_repo() -> SalaryRepository:
    return SqlSalaryRepository()


def get_bank_repo() -> BankRepository:
    return SqlBankRepository()


def get_company_document_repo() -> CompanyDocumentRepository:
    return SqlCompanyDocumentRepository()


def get_insurance_repo() -> InsuranceRepository:
    return SqlInsuranceRepository()


def get_request_repo() -> RequestRepository:
    return SqlRequestRepository()


def get_vacation_repo() -> VacationRepository:
    return SqlVacationRepository()


def get_invoice_repo() -> InvoiceRepository:
    return SqlInvoiceRepository()


def get_audit_repo() -> AuditRepository:
    return SqlAuditRepository()


def get_user_repo() -> UserRepository:
    return SqlUserRepository()
