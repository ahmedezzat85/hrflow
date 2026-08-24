"""
be/repositories/deps.py
FastAPI dependency providers for domain repositories.
Dynamically resolves to Sheets, Dual-Write, or SQL implementations based on Config.STORAGE_ENGINE.
"""
from config import Config
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
# Sheets Repositories
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

# SQL Repositories
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

# Dual-Write Repositories
from repositories.dual.employees import DualWriteEmployeeRepository
from repositories.dual.salary import DualWriteSalaryRepository
from repositories.dual.bank import DualWriteBankRepository
from repositories.dual.documents import DualWriteCompanyDocumentRepository
from repositories.dual.insurance import DualWriteInsuranceRepository
from repositories.dual.requests import DualWriteRequestRepository
from repositories.dual.vacations import DualWriteVacationRepository
from repositories.dual.invoices import DualWriteInvoiceRepository
from repositories.dual.audit import DualWriteAuditRepository
from repositories.dual.auth import DualWriteUserRepository


def get_employee_repo() -> EmployeeRepository:
    mode = Config.STORAGE_ENGINE
    if mode == "sql":
        return SqlEmployeeRepository()
    elif mode == "dual":
        return DualWriteEmployeeRepository()
    return SheetsEmployeeRepository()


def get_salary_repo() -> SalaryRepository:
    mode = Config.STORAGE_ENGINE
    if mode == "sql":
        return SqlSalaryRepository()
    elif mode == "dual":
        return DualWriteSalaryRepository()
    return SheetsSalaryRepository()


def get_bank_repo() -> BankRepository:
    mode = Config.STORAGE_ENGINE
    if mode == "sql":
        return SqlBankRepository()
    elif mode == "dual":
        return DualWriteBankRepository()
    return SheetsBankRepository()


def get_company_document_repo() -> CompanyDocumentRepository:
    mode = Config.STORAGE_ENGINE
    if mode == "sql":
        return SqlCompanyDocumentRepository()
    elif mode == "dual":
        return DualWriteCompanyDocumentRepository()
    return SheetsCompanyDocumentRepository()


def get_insurance_repo() -> InsuranceRepository:
    mode = Config.STORAGE_ENGINE
    if mode == "sql":
        return SqlInsuranceRepository()
    elif mode == "dual":
        return DualWriteInsuranceRepository()
    return SheetsInsuranceRepository()


def get_request_repo() -> RequestRepository:
    mode = Config.STORAGE_ENGINE
    if mode == "sql":
        return SqlRequestRepository()
    elif mode == "dual":
        return DualWriteRequestRepository()
    return SheetsRequestRepository()


def get_vacation_repo() -> VacationRepository:
    mode = Config.STORAGE_ENGINE
    if mode == "sql":
        return SqlVacationRepository()
    elif mode == "dual":
        return DualWriteVacationRepository()
    return SheetsVacationRepository()


def get_invoice_repo() -> InvoiceRepository:
    mode = Config.STORAGE_ENGINE
    if mode == "sql":
        return SqlInvoiceRepository()
    elif mode == "dual":
        return DualWriteInvoiceRepository()
    return SheetsInvoiceRepository()


def get_audit_repo() -> AuditRepository:
    mode = Config.STORAGE_ENGINE
    if mode == "sql":
        return SqlAuditRepository()
    elif mode == "dual":
        return DualWriteAuditRepository()
    return SheetsAuditRepository()


def get_user_repo() -> UserRepository:
    mode = Config.STORAGE_ENGINE
    if mode == "sql":
        return SqlUserRepository()
    elif mode == "dual":
        return DualWriteUserRepository()
    return SheetsUserRepository()
