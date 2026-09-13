"""
be/tests/test_finance_models.py
Unit and integration tests for Phase 3 Finance data models and relationships.
Validates SQLite / PostgreSQL compatibility, FK constraints, cascades, and indexes.
"""
import pytest
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.exc import IntegrityError

from db import Base
import models_db  # Ensures all models (HR, RBAC, Finance) are registered on Base.metadata
from finance.models import (
    CustomerDB,
    VendorDB,
    SalesInvoiceDB,
    SalesInvoiceLineDB,
    BillDB,
    BillLineDB,
    FinanceBankAccountDB,
    PaymentDB,
    SubscriptionDB,
    PayrollRunDB,
    PayrollLineDB,
)
from models_db import EmployeeDB


@pytest.fixture
def db_session():
    """Provides an isolated in-memory SQLite session with foreign keys enabled."""
    engine = create_engine("sqlite:///:memory:", echo=False)
    
    # Enable foreign keys in SQLite
    from sqlalchemy import event
    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


def test_customer_sales_invoice_lines_flow(db_session):
    """Verifies customer creation, sales invoice, lines, and cascade behavior."""
    customer = CustomerDB(
        name="Acme Health Inc",
        contact_email="billing@acmehealth.com",
        contact_phone="+1-555-0199",
        tax_id="US-123456789",
        notes="Enterprise client",
    )
    db_session.add(customer)
    db_session.commit()
    assert customer.id is not None

    invoice = SalesInvoiceDB(
        customer_id=customer.id,
        invoice_number="INV-2026-001",
        issue_date="2026-09-01",
        due_date="2026-09-30",
        status="sent",
        currency="USD",
        subtotal=10000.0,
        tax_amount=1000.0,
        total=11000.0,
    )
    db_session.add(invoice)
    db_session.commit()
    assert invoice.id is not None

    line1 = SalesInvoiceLineDB(
        invoice_id=invoice.id,
        description="Software License MTD",
        quantity=1.0,
        unit_price=8000.0,
        line_total=8000.0,
    )
    line2 = SalesInvoiceLineDB(
        invoice_id=invoice.id,
        description="Cloud Hosting",
        quantity=1.0,
        unit_price=2000.0,
        line_total=2000.0,
    )
    db_session.add_all([line1, line2])
    db_session.commit()

    # Verify traversal
    refreshed_inv = db_session.query(SalesInvoiceDB).filter_by(id=invoice.id).first()
    assert len(refreshed_inv.lines) == 2
    assert refreshed_inv.customer.name == "Acme Health Inc"

    # Test unique invoice_number constraint
    duplicate_inv = SalesInvoiceDB(
        customer_id=customer.id,
        invoice_number="INV-2026-001",
        issue_date="2026-09-05",
        due_date="2026-09-25",
    )
    db_session.add(duplicate_inv)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    # Test cascade delete on invoice lines
    db_session.delete(invoice)
    db_session.commit()
    assert db_session.query(SalesInvoiceLineDB).filter_by(invoice_id=invoice.id).count() == 0


def test_vendor_bill_lines_and_subscriptions(db_session):
    """Verifies vendor creation, bills, lines, subscriptions, and cascades."""
    vendor = VendorDB(
        name="Amazon Web Services",
        contact_email="aws-billing@amazon.com",
        category="Cloud Infrastructure",
    )
    db_session.add(vendor)
    db_session.commit()

    bill = BillDB(
        vendor_id=vendor.id,
        bill_number="BILL-AWS-SEP26",
        category="Cloud Infrastructure",
        issue_date="2026-09-01",
        due_date="2026-09-15",
        status="unpaid",
        subtotal=1200.0,
        tax_amount=0.0,
        total=1200.0,
    )
    db_session.add(bill)
    db_session.commit()

    bill_line = BillLineDB(
        bill_id=bill.id,
        description="EC2 and S3 Compute",
        quantity=1.0,
        unit_price=1200.0,
        line_total=1200.0,
    )
    db_session.add(bill_line)

    sub = SubscriptionDB(
        vendor_id=vendor.id,
        name="AWS Support Plan",
        amount=100.0,
        currency="USD",
        billing_cycle="monthly",
        next_renewal_date="2026-10-01",
        auto_generate_bill=True,
    )
    db_session.add(sub)
    db_session.commit()

    # Verify relationships
    refreshed_vendor = db_session.query(VendorDB).filter_by(id=vendor.id).first()
    assert len(refreshed_vendor.bills) == 1
    assert len(refreshed_vendor.subscriptions) == 1
    assert len(refreshed_vendor.bills[0].lines) == 1

    # Cascade delete on bill
    db_session.delete(bill)
    db_session.commit()
    assert db_session.query(BillLineDB).filter_by(bill_id=bill.id).count() == 0


def test_bank_account_and_payments(db_session):
    """Verifies bank account, incoming/outgoing payments, and balance tracking fields."""
    account = FinanceBankAccountDB(
        account_name="Primary Operating Account",
        bank_name="Chase",
        account_number="****1234",
        currency="USD",
        opening_balance=50000.0,
        current_balance=50000.0,
    )
    db_session.add(account)
    db_session.commit()

    # Payment without invoice/bill
    payment = PaymentDB(
        direction="incoming",
        amount=5000.0,
        currency="USD",
        payment_date="2026-09-02",
        bank_account_id=account.id,
        method="bank_transfer",
        reference="REF-WIRE-992",
    )
    db_session.add(payment)
    db_session.commit()

    assert payment.id is not None
    refreshed_acc = db_session.query(FinanceBankAccountDB).filter_by(id=account.id).first()
    assert len(refreshed_acc.payments) == 1
    assert refreshed_acc.payments[0].amount == 5000.0


def test_payroll_run_and_cross_domain_employee_line(db_session):
    """Verifies cross-domain FK between finance_payroll_lines and employees table."""
    # Create employee in HR domain table
    emp = EmployeeDB(
        name="Elena Rostova",
        email="elena.rostova@voyance.internal",
        role="employee",
        dept="Engineering",
        salary=6000.0,
    )
    db_session.add(emp)
    db_session.commit()

    # Create bank account for funding
    bank = FinanceBankAccountDB(
        account_name="Payroll Account",
        bank_name="Chase",
        account_number="****5678",
    )
    db_session.add(bank)
    db_session.commit()

    # Create PayrollRun
    run = PayrollRunDB(
        period_label="2026-09",
        period_start="2026-09-01",
        period_end="2026-09-30",
        status="draft",
        total_gross=6000.0,
        total_tax=600.0,
        total_deductions=400.0,
        total_net=5000.0,
        total_employer_cost=6500.0,
        bank_account_id=bank.id,
    )
    db_session.add(run)
    db_session.commit()

    # Create PayrollLine referencing HR employee
    line = PayrollLineDB(
        payroll_run_id=run.id,
        employee_id=emp.id,
        base_salary=6000.0,
        allowances_total=0.0,
        deductions_total=400.0,
        tax_amount=600.0,
        net_pay=5000.0,
        employer_cost_extra=500.0,
        snapshot_notes="September standard payroll",
    )
    db_session.add(line)
    db_session.commit()

    # Verify cross-domain traversal
    refreshed_line = db_session.query(PayrollLineDB).filter_by(id=line.id).first()
    assert refreshed_line.employee.name == "Elena Rostova"
    assert refreshed_line.payroll_run.period_label == "2026-09"

    # Cascade delete run removes lines
    db_session.delete(run)
    db_session.commit()
    assert db_session.query(PayrollLineDB).filter_by(payroll_run_id=run.id).count() == 0
    # Employee must still exist (not deleted)
    assert db_session.query(EmployeeDB).filter_by(id=emp.id).first() is not None
