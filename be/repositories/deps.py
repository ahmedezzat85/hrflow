"""
be/repositories/deps.py
FastAPI dependency providers for domain repositories.
HRFlow operates exclusively on SQL (PostgreSQL/SQLite via SQLAlchemy) as its database engine.
Google Sheets is used solely as an export destination.
"""
from repositories.interfaces import (
    EmployeeRepository,
    SalaryRepository,
    EmployeeBankAccountRepository,
    BankRepository,
    CompanyDocumentRepository,
    InsuranceRepository,
    RequestRepository,
    VacationRepository,
    SalaryPaymentDocRepository,
    InvoiceRepository,
    AuditRepository,
    UserRepository,
)
# SQL Repositories (exclusive operational engine)
from repositories.sql.employees import SqlEmployeeRepository
from repositories.sql.salary import SqlSalaryRepository
from repositories.sql.employee_bank_accounts import SqlEmployeeBankAccountRepository, SqlBankRepository
from repositories.sql.documents import SqlCompanyDocumentRepository
from repositories.sql.insurance import SqlInsuranceRepository
from repositories.sql.requests import SqlRequestRepository
from repositories.sql.vacations import SqlVacationRepository
from repositories.sql.salary_payment_docs import SqlSalaryPaymentDocRepository, SqlInvoiceRepository
from repositories.sql.audit import SqlAuditRepository
from repositories.sql.auth import SqlUserRepository


def get_employee_repo() -> EmployeeRepository:
    return SqlEmployeeRepository()


def get_salary_repo() -> SalaryRepository:
    return SqlSalaryRepository()


def get_employee_bank_repo() -> EmployeeBankAccountRepository:
    return SqlEmployeeBankAccountRepository()

# Backward compatibility alias
get_bank_repo = get_employee_bank_repo


def get_company_document_repo() -> CompanyDocumentRepository:
    return SqlCompanyDocumentRepository()


def get_insurance_repo() -> InsuranceRepository:
    return SqlInsuranceRepository()


def get_request_repo() -> RequestRepository:
    return SqlRequestRepository()


def get_vacation_repo() -> VacationRepository:
    return SqlVacationRepository()


def get_salary_payment_doc_repo() -> SalaryPaymentDocRepository:
    return SqlSalaryPaymentDocRepository()

# Backward compatibility alias
get_invoice_repo = get_salary_payment_doc_repo


def get_audit_repo() -> AuditRepository:
    return SqlAuditRepository()


def get_user_repo() -> UserRepository:
    return SqlUserRepository()
