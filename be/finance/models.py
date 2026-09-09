"""
be/finance/models.py
SQLAlchemy ORM models for the Finance domain.
Follows Phase 3 specifications and 00-architecture-blueprint.md conventions.
Targeting both SQLite (dev) and PostgreSQL (staging/prod).
"""
from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Text,
    DateTime,
    Boolean,
    ForeignKey,
    Index,
)
from sqlalchemy.orm import relationship

from db import Base


class CustomerDB(Base):
    __tablename__ = "finance_customers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    contact_email = Column(String(255), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    tax_id = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    invoices = relationship("SalesInvoiceDB", back_populates="customer")


class VendorDB(Base):
    __tablename__ = "finance_vendors"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False)
    contact_email = Column(String(255), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    tax_id = Column(String(100), nullable=True)
    category = Column(String(100), default="General")
    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    bills = relationship("BillDB", back_populates="vendor")
    subscriptions = relationship("SubscriptionDB", back_populates="vendor")


class SalesInvoiceDB(Base):
    __tablename__ = "finance_sales_invoices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    customer_id = Column(Integer, ForeignKey("finance_customers.id", ondelete="RESTRICT"), nullable=False, index=True)
    invoice_number = Column(String(50), unique=True, nullable=False, index=True)
    issue_date = Column(String(20), nullable=False)
    due_date = Column(String(20), nullable=False)
    status = Column(String(30), default="draft", nullable=False, index=True)  # draft/sent/paid/overdue/void
    currency = Column(String(10), default="USD", nullable=False)
    subtotal = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    total = Column(Float, default=0.0)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    customer = relationship("CustomerDB", back_populates="invoices")
    lines = relationship("SalesInvoiceLineDB", back_populates="invoice", cascade="all, delete-orphan")
    payments = relationship("PaymentDB", back_populates="sales_invoice", foreign_keys="PaymentDB.related_invoice_id")


class SalesInvoiceLineDB(Base):
    __tablename__ = "finance_sales_invoice_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    invoice_id = Column(Integer, ForeignKey("finance_sales_invoices.id", ondelete="CASCADE"), nullable=False, index=True)
    description = Column(String(255), nullable=False)
    quantity = Column(Float, default=1.0)
    unit_price = Column(Float, default=0.0)
    line_total = Column(Float, default=0.0)

    invoice = relationship("SalesInvoiceDB", back_populates="lines")


class BillDB(Base):
    __tablename__ = "finance_bills"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vendor_id = Column(Integer, ForeignKey("finance_vendors.id", ondelete="RESTRICT"), nullable=False, index=True)
    bill_number = Column(String(50), nullable=False, index=True)
    category = Column(String(100), default="Operating Expense")
    issue_date = Column(String(20), nullable=False)
    due_date = Column(String(20), nullable=False)
    status = Column(String(30), default="unpaid", nullable=False, index=True)  # unpaid/paid/overdue/void
    currency = Column(String(10), default="USD", nullable=False)
    subtotal = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    total = Column(Float, default=0.0)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    vendor = relationship("VendorDB", back_populates="bills")
    lines = relationship("BillLineDB", back_populates="bill", cascade="all, delete-orphan")
    payments = relationship("PaymentDB", back_populates="bill", foreign_keys="PaymentDB.related_bill_id")


class BillLineDB(Base):
    __tablename__ = "finance_bill_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    bill_id = Column(Integer, ForeignKey("finance_bills.id", ondelete="CASCADE"), nullable=False, index=True)
    description = Column(String(255), nullable=False)
    quantity = Column(Float, default=1.0)
    unit_price = Column(Float, default=0.0)
    line_total = Column(Float, default=0.0)

    bill = relationship("BillDB", back_populates="lines")


class TransactionCategoryDB(Base):
    __tablename__ = "finance_transaction_categories"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), unique=True, nullable=False, index=True)
    kind = Column(String(20), default="other", nullable=False)  # revenue | cost | transfer | other
    is_active = Column(Boolean, default=True, nullable=False)
    sort_order = Column(Integer, default=0, nullable=False)
    is_petty = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    transactions = relationship("LedgerTransactionDB", back_populates="category")


class PaymentTypeDB(Base):
    __tablename__ = "finance_payment_types"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False)
    code = Column(String(50), unique=True, nullable=False, index=True)
    requires_cheque_number = Column(Boolean, default=False, nullable=False)
    requires_bank_fee_flag = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    transactions = relationship("LedgerTransactionDB", back_populates="payment_type")


class FinanceBankAccountDB(Base):
    __tablename__ = "finance_bank_accounts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    account_name = Column(String(100), nullable=False)
    bank_name = Column(String(100), nullable=True)  # Nullable for cash accounts
    account_number = Column(String(100), nullable=False)
    currency = Column(String(10), default="USD", nullable=False)
    opening_balance = Column(Float, default=0.0)
    current_balance = Column(Float, default=0.0)
    account_type = Column(String(20), default="bank", nullable=False)  # bank | cash
    country = Column(String(100), default="Egypt", nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    payments = relationship("PaymentDB", back_populates="bank_account")
    ledger_transactions = relationship(
        "LedgerTransactionDB",
        back_populates="account",
        cascade="all, delete-orphan",
        order_by="LedgerTransactionDB.date.asc(), LedgerTransactionDB.id.asc()",
    )


# Alias for clean domain referencing
BankAccountDB = FinanceBankAccountDB


class LedgerTransactionDB(Base):
    __tablename__ = "finance_ledger_transactions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="RESTRICT"), nullable=False, index=True)
    date = Column(String(20), nullable=False, index=True)  # YYYY-MM-DD
    amount = Column(Float, nullable=False)
    direction = Column(String(20), nullable=False)  # in / out
    currency = Column(String(10), default="USD", nullable=False)
    category_id = Column(Integer, ForeignKey("finance_transaction_categories.id", ondelete="SET NULL"), nullable=True, index=True)
    payment_type_id = Column(Integer, ForeignKey("finance_payment_types.id", ondelete="SET NULL"), nullable=True, index=True)
    reference = Column(String(255), default="", nullable=False)
    description = Column(String(255), default="", nullable=False)
    fx_rate = Column(Float, nullable=True)
    source = Column(String(50), nullable=False, index=True)
    # sources: manual | invoice_payment | bill_payment | transfer | cheque | subscription_charge | statement_import
    linked_invoice_id = Column(Integer, ForeignKey("finance_sales_invoices.id", ondelete="SET NULL"), nullable=True, index=True)
    linked_bill_id = Column(Integer, ForeignKey("finance_bills.id", ondelete="SET NULL"), nullable=True, index=True)
    running_balance = Column(Float, default=0.0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    created_by = Column(String(255), nullable=True)

    account = relationship("FinanceBankAccountDB", back_populates="ledger_transactions")
    category = relationship("TransactionCategoryDB", back_populates="transactions")
    payment_type = relationship("PaymentTypeDB", back_populates="transactions")
    linked_invoice = relationship("SalesInvoiceDB")
    linked_bill = relationship("BillDB")


# Alias for clean domain referencing
FinanceLedgerTransactionDB = LedgerTransactionDB


class PaymentDB(Base):
    __tablename__ = "finance_payments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    direction = Column(String(20), nullable=False)  # incoming / outgoing
    related_invoice_id = Column(Integer, ForeignKey("finance_sales_invoices.id", ondelete="SET NULL"), nullable=True, index=True)
    related_bill_id = Column(Integer, ForeignKey("finance_bills.id", ondelete="SET NULL"), nullable=True, index=True)
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default="USD", nullable=False)
    payment_date = Column(String(20), nullable=False, index=True)  # YYYY-MM-DD
    bank_account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="RESTRICT"), nullable=False, index=True)
    method = Column(String(50), default="bank_transfer")  # bank_transfer/cash/card/other
    reference = Column(String(100), default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    sales_invoice = relationship("SalesInvoiceDB", back_populates="payments", foreign_keys=[related_invoice_id])
    bill = relationship("BillDB", back_populates="payments", foreign_keys=[related_bill_id])
    bank_account = relationship("FinanceBankAccountDB", back_populates="payments")


class SubscriptionDB(Base):
    __tablename__ = "finance_subscriptions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    vendor_id = Column(Integer, ForeignKey("finance_vendors.id", ondelete="RESTRICT"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default="USD", nullable=False)
    billing_cycle = Column(String(20), default="monthly")  # monthly/quarterly/yearly
    next_renewal_date = Column(String(20), nullable=False)
    auto_generate_bill = Column(Boolean, default=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    vendor = relationship("VendorDB", back_populates="subscriptions")


class PayrollRunDB(Base):
    __tablename__ = "finance_payroll_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    period_label = Column(String(20), nullable=False, index=True)  # e.g. "2026-09"
    period_start = Column(String(20), nullable=False)
    period_end = Column(String(20), nullable=False)
    status = Column(String(30), default="draft", nullable=False, index=True)  # draft/approved/paid
    total_gross = Column(Float, default=0.0)
    total_tax = Column(Float, default=0.0)
    total_deductions = Column(Float, default=0.0)
    total_net = Column(Float, default=0.0)
    total_employer_cost = Column(Float, default=0.0)
    bank_account_id = Column(Integer, ForeignKey("finance_bank_accounts.id", ondelete="SET NULL"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    approved_at = Column(DateTime, nullable=True)
    paid_at = Column(DateTime, nullable=True)

    lines = relationship("PayrollLineDB", back_populates="payroll_run", cascade="all, delete-orphan")
    bank_account = relationship("FinanceBankAccountDB")


class PayrollLineDB(Base):
    __tablename__ = "finance_payroll_lines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    payroll_run_id = Column(Integer, ForeignKey("finance_payroll_runs.id", ondelete="CASCADE"), nullable=False, index=True)
    employee_id = Column(Integer, ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False, index=True)
    base_salary = Column(Float, default=0.0)
    allowances_total = Column(Float, default=0.0)
    deductions_total = Column(Float, default=0.0)
    tax_amount = Column(Float, default=0.0)
    net_pay = Column(Float, default=0.0)
    employer_cost_extra = Column(Float, default=0.0)
    snapshot_notes = Column(Text, default="")
    created_at = Column(DateTime, default=datetime.utcnow)

    payroll_run = relationship("PayrollRunDB", back_populates="lines")
    employee = relationship("EmployeeDB")
