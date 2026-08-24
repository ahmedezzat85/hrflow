"""
be/models_db.py
SQLAlchemy ORM models for HRFlow PostgreSQL / SQLite schema.
Faithfully maps domain entities and tables from Phase 0 repository contracts.
"""
from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Text,
    DateTime,
    ForeignKey,
    Index,
)
from sqlalchemy.orm import relationship

from db import Base


class UserDB(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    role = Column(String(50), nullable=False, default="employee")
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    employee = relationship("EmployeeDB", back_populates="user", foreign_keys=[employee_id])


class EmployeeDB(Base):
    __tablename__ = "employees"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    role = Column(String(50), default="employee")
    dept = Column(String(100), default="")
    job_role = Column(String(100), default="")
    salary = Column(Float, default=0.0)
    internal_salary_usd = Column(Float, default=0.0)
    external_salary_usd = Column(Float, default=0.0)
    join_date = Column(String(20), default="")
    status = Column(String(50), default="Active")
    vac_total = Column(Integer, default=21)
    vac_used = Column(Integer, default=0)
    next_raise = Column(String(20), default="")
    employment_state = Column(String(50), default="Full-Time")
    invoice_id = Column(String(20), default="")
    address_line_1 = Column(String(255), default="")
    address_line_2 = Column(String(255), default="")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("UserDB", back_populates="employee", uselist=False)
    bank_account = relationship("EmployeeBankAccountDB", back_populates="employee", uselist=False, cascade="all, delete-orphan")
    notes = relationship("EmployeeNoteDB", back_populates="employee", cascade="all, delete-orphan")
    documents = relationship("EmployeeDocumentDB", back_populates="employee", cascade="all, delete-orphan")
    salary_history = relationship("SalaryHistoryDB", back_populates="employee", cascade="all, delete-orphan")
    claims = relationship("InsuranceClaimDB", back_populates="employee", cascade="all, delete-orphan")
    requests = relationship("RequestDB", back_populates="employee", cascade="all, delete-orphan")
    vacations = relationship("VacationHistoryDB", back_populates="employee", cascade="all, delete-orphan")
    invoices = relationship("InvoiceDB", back_populates="employee", cascade="all, delete-orphan")


class SalaryHistoryDB(Base):
    __tablename__ = "salary_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(String(20), nullable=False)
    previous_salary = Column(Float, default=0.0)
    new_salary = Column(Float, default=0.0)
    pct_change = Column(String(20), default="")
    reason = Column(String(255), default="")
    applied_by = Column(String(255), default="")
    previous_internal_usd = Column(Float, default=0.0)
    previous_external_usd = Column(Float, default=0.0)
    new_internal_usd = Column(Float, default=0.0)
    new_external_usd = Column(Float, default=0.0)
    created_at = Column(DateTime, default=datetime.utcnow)

    employee = relationship("EmployeeDB", back_populates="salary_history")


class EmployeeBankAccountDB(Base):
    __tablename__ = "employee_bank_accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    bank_name = Column(String(255), nullable=False)
    iban = Column(String(100), nullable=False)
    swift_code = Column(String(50), default="")
    updated_by = Column(String(255), default="")
    updated_at = Column(String(50), default="")

    employee = relationship("EmployeeDB", back_populates="bank_account")


class EmployeeNoteDB(Base):
    __tablename__ = "employee_notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(String(20), nullable=False)
    category = Column(String(100), default="General")
    note = Column(Text, default="")
    created_by = Column(String(255), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    employee = relationship("EmployeeDB", back_populates="notes")


class EmployeeDocumentDB(Base):
    __tablename__ = "employee_documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    file_type = Column(String(50), nullable=False)
    drive_file_id = Column(String(255), nullable=False)
    view_url = Column(Text, default="")
    download_url = Column(Text, default="")
    uploaded_by = Column(String(255), default="")
    uploaded_at = Column(String(50), default="")

    employee = relationship("EmployeeDB", back_populates="documents")


class CompanyDocumentDB(Base):
    __tablename__ = "company_documents"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    file_type = Column(String(50), nullable=False)
    category = Column(String(100), default="General")
    drive_file_id = Column(String(255), nullable=False)
    view_url = Column(Text, default="")
    download_url = Column(Text, default="")
    uploaded_by = Column(String(255), default="")
    uploaded_at = Column(String(50), default="")


class InsuranceCategoryDB(Base):
    __tablename__ = "insurance_categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    annual_limit = Column(Float, default=0.0)


class InsuranceClaimDB(Base):
    __tablename__ = "insurance_claims"

    id = Column(Integer, primary_key=True, autoincrement=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_name = Column(String(255), default="")
    category = Column(String(100), nullable=False)
    provider = Column(String(255), default="")
    amount = Column(Float, default=0.0)
    date = Column(String(20), nullable=False)
    status = Column(String(50), default="Pending", index=True)
    document_url = Column(Text, default="")
    submitted_by = Column(String(255), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    employee = relationship("EmployeeDB", back_populates="claims")


class RequestDB(Base):
    __tablename__ = "requests"

    id = Column(Integer, primary_key=True, autoincrement=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_name = Column(String(255), default="")
    type = Column(String(100), nullable=False, index=True)
    details = Column(Text, default="")
    date = Column(String(20), nullable=False)
    status = Column(String(50), default="Pending", index=True)
    reviewed_by = Column(String(255), default="")
    reviewed_at = Column(String(50), default="")
    submitted_by = Column(String(255), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    employee = relationship("EmployeeDB", back_populates="requests")


class VacationHistoryDB(Base):
    __tablename__ = "vacation_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    type = Column(String(100), nullable=False)
    start_date = Column(String(20), nullable=False)
    end_date = Column(String(20), nullable=False)
    days = Column(Integer, default=1)
    status = Column(String(50), default="Pending", index=True)
    submitted_by = Column(String(255), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    employee = relationship("EmployeeDB", back_populates="vacations")


class InvoiceDB(Base):
    __tablename__ = "invoices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_name = Column(String(255), default="")
    invoice_number = Column(String(50), nullable=False, index=True)
    payment_year = Column(Integer, nullable=False, index=True)
    payment_month = Column(Integer, nullable=False, index=True)
    invoice_date = Column(String(20), default="")
    amount_usd = Column(Float, default=0.0)
    currency = Column(String(10), default="USD")
    document_name = Column(String(255), default="")
    drive_file_id = Column(String(255), default="")
    drive_web_url = Column(Text, default="")
    template_version = Column(String(20), default="v1")
    status = Column(String(50), default="generated", index=True)
    failure_reason = Column(String(255), default="")
    generated_by = Column(String(255), default="")
    created_at = Column(String(50), default="")

    employee = relationship("EmployeeDB", back_populates="invoices")

    __table_args__ = (
        Index("ix_invoices_emp_period", "employee_id", "payment_year", "payment_month"),
    )


class AuditLogDB(Base):
    __tablename__ = "audit_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(String(50), nullable=False, index=True)
    actor_email = Column(String(255), default="")
    action = Column(String(100), nullable=False, index=True)
    target_type = Column(String(100), default="")
    target_id = Column(String(100), default="")
    details = Column(Text, default="")
