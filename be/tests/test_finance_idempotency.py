"""
be/tests/test_finance_idempotency.py
Tests for Story 0.4: Safe financial command framework
- IdempotencyService caching, replay, and in-progress concurrency
- API Idempotency-Key header support preventing duplicate records
- Reason capture on destructive actions (void invoice, void bill, delete manual transaction)
- Protection of linked financial transactions from deletion
"""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from db import Base, get_db
import models_db
from finance.models import (
    FinanceBankAccountDB,
    LedgerTransactionDB,
    AccountTransferDB,
    SalesInvoiceDB,
    BillDB,
)
from finance.services.idempotency import IdempotencyService
from main import app
from deps import get_current_user


def test_idempotency_service_unit():
    service = IdempotencyService(ttl_seconds=60)
    counter = {"count": 0}

    def operation():
        counter["count"] += 1
        return {"result": f"call_{counter['count']}"}

    # First execution executes operation
    res1 = service.execute_idempotent("key-123", "user@test.com", "/api/test", operation)
    assert res1 == {"result": "call_1"}
    assert counter["count"] == 1

    # Replay with same key returns cached result without re-executing
    res2 = service.execute_idempotent("key-123", "user@test.com", "/api/test", operation)
    assert res2 == {"result": "call_1"}
    assert counter["count"] == 1

    # New key executes operation again
    res3 = service.execute_idempotent("key-456", "user@test.com", "/api/test", operation)
    assert res3 == {"result": "call_2"}
    assert counter["count"] == 2

    # Failing operation does not lock future retries
    def failing_op():
        raise ValueError("Something went wrong")

    with pytest.raises(ValueError):
        service.execute_idempotent("fail-key", "user@test.com", "/api/test", failing_op)

    # Retry after failure works
    res_retry = service.execute_idempotent("fail-key", "user@test.com", "/api/test", operation)
    assert res_retry == {"result": "call_3"}


@pytest.fixture
def db_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    session.add(models_db.UserDB(email="finance.admin@example.com", role="admin"))
    usd_acc = FinanceBankAccountDB(
        account_name="USD Operating",
        bank_name="Chase",
        account_number="1111",
        account_type="bank",
        currency="USD",
        current_balance=10000.0,
        is_active=True,
    )
    cust = models_db.Base.metadata.tables.get("finance_customers")
    from finance.models import CustomerDB, VendorDB
    customer = CustomerDB(name="Acme Corp")
    vendor = VendorDB(name="Cloud Host")
    session.add_all([usd_acc, customer, vendor])
    session.commit()

    yield session
    session.close()


@pytest.fixture
def client(db_session):
    def override_get_db():
        yield db_session

    def override_get_current_user():
        return {
            "email": "finance.admin@example.com",
            "role": "admin",
            "permissions": ["finance.invoice.read", "finance.invoice.write", "finance.bill.read", "finance.bill.write", "finance.account.read", "finance.account.write"],
        }

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_invoice_creation_idempotency(client, db_session):
    payload = {
        "customer_id": 1,
        "invoice_number": "INV-IDEMP-001",
        "issue_date": "2026-09-13",
        "due_date": "2026-10-13",
        "currency": "USD",
        "status": "draft",
        "lines": [
            {"description": "Consulting", "quantity": 10.0, "unit_price": 150.0, "line_total": 1500.0}
        ],
    }

    headers = {"Idempotency-Key": "test-key-inv-001"}

    # First request creates the invoice
    resp1 = client.post("/api/finance/invoices", json=payload, headers=headers)
    assert resp1.status_code == 201
    data1 = resp1.json()
    assert data1["invoice_number"] == "INV-IDEMP-001"

    # Second request with SAME idempotency key returns cached response and doesn't duplicate
    resp2 = client.post("/api/finance/invoices", json=payload, headers=headers)
    assert resp2.status_code == 201
    data2 = resp2.json()
    assert data2["id"] == data1["id"]

    # Verify only 1 record exists in DB
    invoices = db_session.query(SalesInvoiceDB).filter_by(invoice_number="INV-IDEMP-001").all()
    assert len(invoices) == 1


def test_invoice_void_reason(client, db_session):
    # Create invoice
    payload = {
        "customer_id": 1,
        "invoice_number": "INV-VOID-001",
        "issue_date": "2026-09-13",
        "due_date": "2026-10-13",
        "currency": "USD",
        "status": "draft",
        "lines": [],
    }
    resp = client.post("/api/finance/invoices", json=payload)
    assert resp.status_code == 201
    inv_id = resp.json()["id"]

    # Void invoice with reason
    void_resp = client.delete(f"/api/finance/invoices/{inv_id}?reason=Duplicate+billing+mistake")
    assert void_resp.status_code == 200
    inv = db_session.query(SalesInvoiceDB).filter_by(id=inv_id).first()
    assert inv.status == "void"
    assert "Duplicate billing mistake" in inv.notes


def test_bill_void_reason(client, db_session):
    payload = {
        "vendor_id": 1,
        "bill_number": "BILL-VOID-001",
        "issue_date": "2026-09-13",
        "due_date": "2026-10-13",
        "currency": "USD",
        "status": "unpaid",
        "lines": [],
    }
    resp = client.post("/api/finance/bills", json=payload)
    assert resp.status_code == 201
    bill_id = resp.json()["id"]

    # Void bill with reason
    void_resp = client.delete(f"/api/finance/bills/{bill_id}?reason=Service+cancelled")
    assert void_resp.status_code == 200
    bill = db_session.query(BillDB).filter_by(id=bill_id).first()
    assert bill.status == "void"
    assert "Service cancelled" in bill.notes


def test_ledger_transaction_protection(client, db_session):
    # Create manual transaction
    tx_manual = LedgerTransactionDB(
        account_id=1,
        date="2026-09-13",
        amount=100.0,
        direction="out",
        currency="USD",
        source="manual",
        description="Office supplies",
        running_balance=9900.0,
    )
    # Create linked transaction (e.g. from invoice payment)
    tx_linked = LedgerTransactionDB(
        account_id=1,
        date="2026-09-13",
        amount=500.0,
        direction="in",
        currency="USD",
        source="invoice_payment",
        linked_invoice_id=99,
        description="Invoice payment",
        running_balance=10400.0,
    )
    db_session.add_all([tx_manual, tx_linked])
    db_session.commit()

    # Deleting linked transaction must be rejected with 400
    del_linked = client.delete(f"/api/finance/transactions/{tx_linked.id}?reason=Accidental")
    assert del_linked.status_code == 400
    assert "manual" in del_linked.json()["detail"].lower() or "linked" in del_linked.json()["detail"].lower()

    # Deleting manual transaction succeeds and accepts reason
    del_manual = client.delete(f"/api/finance/transactions/{tx_manual.id}?reason=Typo+correction")
    assert del_manual.status_code == 200
    assert del_manual.json()["reason"] == "Typo correction"
