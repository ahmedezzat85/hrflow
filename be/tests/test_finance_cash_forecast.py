"""
be/tests/test_finance_cash_forecast.py
Unit and Integration tests for Cash Position & Forecast (Story 2.3).
Covers:
- Separate book, available, and reconciled balances across bank accounts.
- Factoring uncleared issued cheques and pending transfers into available balance.
- 30/60/90-day horizon projections separating confirmed contractual vs expected items.
- Partial payment handling for sales invoices and bills.
- Strict exclusion of draft/unapproved items from projections.
- Multi-currency disclosure and FX warnings without fabricated conversions.
- API endpoint GET /api/finance/reports/cash-forecast.
"""
import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient

import models_db  # Ensures all ORM models including EmployeeDB are registered in SQLAlchemy mapper
from finance.models import (
    FinanceBankAccountDB,
    CustomerDB,
    SalesInvoiceDB,
    PaymentDB,
    VendorDB,
    BillDB,
    SubscriptionDB,
    PayrollRunDB,
    AccountTransferDB,
    BankStatementImportDB,
    StatementLineDB,
    FinanceChequeDB,
)
from finance.services.forecast_service import CashForecastService


@pytest.fixture
def db_session(tmp_path):
    test_db_file = tmp_path / "test_forecast.db"
    test_db_url = f"sqlite:///{test_db_file}"
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from db import Base
    engine = create_engine(test_db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def seed_forecast_data(session):
    today = datetime.utcnow().date()
    today_str = today.strftime("%Y-%m-%d")
    in_15_days = (today + timedelta(days=15)).strftime("%Y-%m-%d")
    in_45_days = (today + timedelta(days=45)).strftime("%Y-%m-%d")
    in_75_days = (today + timedelta(days=75)).strftime("%Y-%m-%d")
    past_10_days = (today - timedelta(days=10)).strftime("%Y-%m-%d")

    # Clean existing finance test rows for isolation
    session.query(PaymentDB).delete()
    session.query(SalesInvoiceDB).delete()
    session.query(BillDB).delete()
    session.query(SubscriptionDB).delete()
    session.query(PayrollRunDB).delete()
    session.query(AccountTransferDB).delete()
    session.query(StatementLineDB).delete()
    session.query(BankStatementImportDB).delete()
    session.query(FinanceChequeDB).delete()
    session.query(FinanceBankAccountDB).delete()
    session.query(CustomerDB).delete()
    session.query(VendorDB).delete()
    session.commit()

    # 1. Accounts
    acc1 = FinanceBankAccountDB(
        account_name="Main USD Operating",
        bank_name="Chase",
        account_number="CHK-1001",
        currency="USD",
        opening_balance=100000.0,
        current_balance=100000.0,
        is_active=True,
    )
    acc2 = FinanceBankAccountDB(
        account_name="Cairo EGP Operating",
        bank_name="CIB",
        account_number="EGP-2002",
        currency="EGP",
        opening_balance=500000.0,
        current_balance=500000.0,
        is_active=True,
    )
    session.add_all([acc1, acc2])
    session.flush()

    # Uncleared cheque issued on acc1 ($5,000)
    chq = FinanceChequeDB(
        account_id=acc1.id,
        cheque_number="CHQ-9001",
        amount=5000.0,
        currency="USD",
        payee="Supplier LLC",
        fiscal_year=2026,
        status="issued",
        issue_date=today_str,
    )
    # Cleared cheque on acc1 ($2,000) -> should not deduct from available
    chq_cleared = FinanceChequeDB(
        account_id=acc1.id,
        cheque_number="CHQ-9002",
        amount=2000.0,
        currency="USD",
        payee="Office Supplies",
        fiscal_year=2026,
        status="cleared",
        issue_date=past_10_days,
    )
    session.add_all([chq, chq_cleared])

    # Pending outgoing transfer on acc1 ($10,000)
    tr = AccountTransferDB(
        from_account_id=acc1.id,
        to_account_id=acc2.id,
        date=today_str,
        from_amount=10000.0,
        from_currency="USD",
        to_amount=500000.0,
        to_currency="EGP",
        confirmed_leg="from_only",
    )
    session.add(tr)

    # Reconciled statement on acc1
    stmt = BankStatementImportDB(
        account_id=acc1.id,
        period_month="2026-08",
        status="reconciled",
        total_lines_count=1,
        matched_lines_count=1,
    )
    session.add(stmt)
    session.flush()
    stmt_line = StatementLineDB(
        import_id=stmt.id,
        raw_date="2026-08-31",
        raw_amount=95000.0,
        direction="in",
        raw_description="Closing confirmed balance",
        status="matched",
    )
    session.add(stmt_line)

    # 2. Customers & Invoices
    cust = CustomerDB(name="Acme Corp", contact_email="acme@example.com")
    session.add(cust)
    session.flush()

    # Invoice 1: Due in 15 days, total $20,000, paid $5,000 -> remaining $15,000 (confirmed 30d inflow)
    inv1 = SalesInvoiceDB(
        customer_id=cust.id,
        invoice_number="INV-2026-001",
        issue_date=today_str,
        due_date=in_15_days,
        subtotal=20000.0,
        tax_amount=0.0,
        total=20000.0,
        currency="USD",
        status="sent",
    )
    session.add(inv1)
    session.flush()
    p1 = PaymentDB(
        direction="incoming",
        related_invoice_id=inv1.id,
        bank_account_id=acc1.id,
        payment_date=today_str,
        amount=5000.0,
        currency="USD",
    )
    session.add(p1)

    # Invoice 2: Overdue by 10 days, total $8,000 -> remaining $8,000 (expected 30d inflow, certainty overdue)
    inv2 = SalesInvoiceDB(
        customer_id=cust.id,
        invoice_number="INV-2026-002",
        issue_date=past_10_days,
        due_date=past_10_days,
        subtotal=8000.0,
        tax_amount=0.0,
        total=8000.0,
        currency="USD",
        status="overdue",
    )
    session.add(inv2)

    # Invoice 3: Draft invoice $50,000 -> MUST BE EXCLUDED
    inv_draft = SalesInvoiceDB(
        customer_id=cust.id,
        invoice_number="INV-DRAFT-999",
        issue_date=today_str,
        due_date=in_15_days,
        subtotal=50000.0,
        tax_amount=0.0,
        total=50000.0,
        currency="USD",
        status="draft",
    )
    session.add(inv_draft)

    # 3. Vendors & Bills
    vend = VendorDB(name="Global Cloud Hosting", contact_email="billing@cloud.example.com")
    session.add(vend)
    session.flush()

    # Bill 1: Due in 45 days, total $12,000, paid $2,000 -> remaining $10,000 (confirmed 60d outflow)
    b1 = BillDB(
        vendor_id=vend.id,
        bill_number="BILL-2026-01",
        issue_date=today_str,
        due_date=in_45_days,
        subtotal=12000.0,
        tax_amount=0.0,
        total=12000.0,
        currency="USD",
        status="open",
    )
    session.add(b1)
    session.flush()
    bp1 = PaymentDB(
        direction="outgoing",
        related_bill_id=b1.id,
        bank_account_id=acc1.id,
        payment_date=today_str,
        amount=2000.0,
        currency="USD",
    )
    session.add(bp1)

    # Bill 2: Draft bill $30,000 -> MUST BE EXCLUDED
    b_draft = BillDB(
        vendor_id=vend.id,
        bill_number="BILL-DRAFT-02",
        issue_date=today_str,
        due_date=in_15_days,
        subtotal=30000.0,
        tax_amount=0.0,
        total=30000.0,
        currency="USD",
        status="draft",
    )
    session.add(b_draft)

    # 4. Recurring Subscription: $1,500 monthly recurring, renewal in 15 days
    sub = SubscriptionDB(
        vendor_id=vend.id,
        name="AWS Infrastructure",
        billing_cycle="monthly",
        amount=1500.0,
        currency="USD",
        next_renewal_date=in_15_days,
        is_active=True,
    )
    session.add(sub)

    # 5. Payroll: Approved payroll run $25,000 due in 15 days (confirmed outflow)
    pr = PayrollRunDB(
        period_label="September 2026",
        period_start=today_str,
        period_end=in_15_days,
        total_gross=30000.0,
        total_net=25000.0,
        total_employer_cost=32000.0,
        status="approved",
    )
    session.add(pr)

    session.commit()


def test_balances_distinction(db_session):
    seed_forecast_data(db_session)
    service = CashForecastService(db_session)
    result = service.get_cash_forecast(currency="USD")

    # Check accounts
    assert len(result.accounts) == 1
    acc = result.accounts[0]
    assert acc.currency == "USD"
    # Book balance = $100,000
    assert acc.book_balance == 100000.0
    # Uncleared cheque: $5,000
    assert acc.uncleared_cheques_amount == 5000.0
    # Pending transfer: $10,000
    assert acc.pending_transfers_amount == 10000.0
    # Available balance = 100000 - 5000 - 10000 = 85,000
    assert acc.available_balance == 85000.0
    # Reconciled balance from matched statement line = 95,000
    assert acc.reconciled_balance == 95000.0


def test_horizon_projections_and_partial_payments(db_session):
    seed_forecast_data(db_session)
    service = CashForecastService(db_session)
    result = service.get_cash_forecast(currency="USD")

    # In 30 days:
    # Inflows:
    # - INV-2026-001: remaining $15,000 (confirmed)
    # - INV-2026-002: remaining $8,000 (expected/overdue)
    # Outflows:
    # - Payroll September: $25,000 (confirmed)
    # - AWS Subscription cycle 0: $1,500 (expected)
    h30 = result.horizons["30_days"]
    assert h30.confirmed_inflows == 15000.0
    assert h30.expected_inflows == 8000.0
    assert h30.total_inflows == 23000.0

    assert h30.confirmed_outflows == 25000.0
    assert h30.expected_outflows == 1500.0
    assert h30.total_outflows == 26500.0
    assert h30.net_cash_flow == round(23000.0 - 26500.0, 2)  # -3500.0

    # In 31-60 days:
    # Outflows:
    # - Bill 1: remaining $10,000 (confirmed)
    # - AWS Subscription cycle 1: $1,500 (expected)
    h60 = result.horizons["60_days"]
    assert h60.confirmed_outflows == 10000.0
    assert h60.expected_outflows == 1500.0
    assert h60.total_outflows == 11500.0


def test_draft_exclusion_and_obligations_drilldown(db_session):
    seed_forecast_data(db_session)
    service = CashForecastService(db_session)
    result = service.get_cash_forecast(currency="USD")

    # Draft invoice $50,000 and draft bill $30,000 must NOT be in obligations
    refs = [o.reference for o in result.material_obligations]
    assert "INV-DRAFT-999" not in refs
    assert "BILL-DRAFT-02" not in refs

    # Confirmed obligations must have target routes
    inv1_ob = next(o for o in result.material_obligations if o.reference == "INV-2026-001")
    assert inv1_ob.target_route == "a-finance-invoices"
    assert inv1_ob.amount == 15000.0
    assert inv1_ob.status == "confirmed"

    bill1_ob = next(o for o in result.material_obligations if o.reference == "BILL-2026-01")
    assert bill1_ob.target_route == "a-finance-bills"
    assert bill1_ob.amount == 10000.0


def test_multi_currency_warning(db_session):
    seed_forecast_data(db_session)
    service = CashForecastService(db_session)
    # All currencies
    result_all = service.get_cash_forecast(currency="all")
    assert "USD" in result_all.current_cash_by_currency
    assert "EGP" in result_all.current_cash_by_currency
    assert len(result_all.fx_warnings) > 0
    assert "Multi-currency forecast aggregates values within native currencies" in result_all.fx_warnings[0]

    # Specific currency USD
    result_usd = service.get_cash_forecast(currency="USD")
    assert len(result_usd.fx_warnings) == 0


def test_api_cash_forecast_endpoint(app_client, admin_cookies, db_session):
    seed_forecast_data(db_session)
    from main import app
    from db import get_db
    app.dependency_overrides[get_db] = lambda: db_session
    try:
        res = app_client.get("/api/finance/reports/cash-forecast?currency=USD", cookies=admin_cookies)
        assert res.status_code == 200
        data = res.json()
        assert "accounts" in data
        assert "horizons" in data
        assert "30_days" in data["horizons"]
        assert "60_days" in data["horizons"]
        assert "90_days" in data["horizons"]
        assert "material_obligations" in data
        assert "assumptions" in data
        assert len(data["material_obligations"]) > 0
        assert data["currency"] == "USD"
    finally:
        app.dependency_overrides.pop(get_db, None)
