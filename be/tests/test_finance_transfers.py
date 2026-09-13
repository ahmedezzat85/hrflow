"""
be/tests/test_finance_transfers.py
Unit and integration tests for Phase 3 Account Transfers:
- Same-Bank FX conversions (dual leg, cross-currency, fx_rate)
- Internal moves between owned accounts (dual leg, same currency)
- External-linked transfers (single confirmed leg with exchange_reference)
- Validation rules and constraints
- Continuous running balance recalculations
- REST API endpoint integration
"""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db import Base, get_db
import models_db
from finance.models import (
    FinanceBankAccountDB,
    LedgerTransactionDB,
    AccountTransferDB,
    TransactionCategoryDB,
    PaymentTypeDB,
)
from finance.repositories.accounts_repository import AccountsRepository
from finance.repositories.ledger_repository import LedgerRepository
from finance.repositories.transfers_repository import TransfersRepository
from finance.services.transfers_service import TransfersService
from finance.schemas import AccountTransferCreate
from main import app
from deps import get_current_user


@pytest.fixture
def db_session():
    """Isolated in-memory SQLite session with foreign keys enabled."""
    from sqlalchemy.pool import StaticPool
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        echo=False,
    )

    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Seed admin user
    session.add(models_db.UserDB(email="finance.admin@example.com", role="admin"))

    # Seed basic payment types
    session.add_all([
        PaymentTypeDB(name="Internal Transfer", code="INTTRANS", is_active=True),
        PaymentTypeDB(name="USD to EGP Conversion", code="USDTOEGP", is_active=True),
        PaymentTypeDB(name="Inbound Transfer", code="INBOUND_TRANS", is_active=True),
        PaymentTypeDB(name="Outbound Transfer", code="OUTBOUND_TRANS", is_active=True),
    ])
    session.commit()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)



@pytest.fixture
def test_client(db_session):
    """FastAPI TestClient with overridden get_db and admin auth."""
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    def override_get_current_user():
        return {
            "email": "finance.admin@example.com",
            "name": "Finance Admin",
            "role": "admin",
            "roles": ["admin"],
        }

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user
    client = TestClient(app)
    try:
        yield client
    finally:
        app.dependency_overrides.clear()


def test_same_bank_fx_transfer(db_session):
    """
    Verifies same-bank FX transfer (mirroring USDTOEGP):
    - Outflow on source USD account, Inflow on target EGP account.
    - Stored fx_rate and converted to_amount.
    - Continuous running balances recalculated on both accounts.
    """
    acc_repo = AccountsRepository(db_session)
    usd_acc = acc_repo.create({
        "account_name": "CIB USD Current",
        "bank_name": "CIB",
        "account_number": "CIB-USD-001",
        "currency": "USD",
        "opening_balance": 10000.0,
    })
    egp_acc = acc_repo.create({
        "account_name": "CIB EGP Operating",
        "bank_name": "CIB",
        "account_number": "CIB-EGP-001",
        "currency": "EGP",
        "opening_balance": 50000.0,
    })

    service = TransfersService(db_session)
    transfer = service.create_transfer(
        AccountTransferCreate(
            from_account_id=usd_acc.id,
            to_account_id=egp_acc.id,
            date="2026-09-05",
            from_amount=1000.0,
            from_currency="USD",
            fx_rate=48.5,
            transfer_type="same_bank_fx",
            exchange_reference="CIB-FX-2026-001",
            note="Quarterly FX Conversion",
        ),
        created_by="finance.admin@example.com",
    )

    assert transfer.id is not None
    assert transfer.transfer_type == "same_bank_fx"
    assert transfer.from_amount == 1000.0
    assert transfer.to_amount == 48500.0
    assert transfer.fx_rate == 48.5
    assert transfer.outflow_transaction_id is not None
    assert transfer.inflow_transaction_id is not None

    # Check USD ledger leg
    usd_tx = db_session.query(LedgerTransactionDB).filter(LedgerTransactionDB.id == transfer.outflow_transaction_id).first()
    assert usd_tx is not None
    assert usd_tx.account_id == usd_acc.id
    assert usd_tx.direction == "out"
    assert usd_tx.amount == 1000.0
    assert usd_tx.currency == "USD"
    assert usd_tx.running_balance == 9000.0
    assert usd_tx.source == "transfer"
    assert usd_tx.linked_transfer_id == transfer.id

    # Check EGP ledger leg
    egp_tx = db_session.query(LedgerTransactionDB).filter(LedgerTransactionDB.id == transfer.inflow_transaction_id).first()
    assert egp_tx is not None
    assert egp_tx.account_id == egp_acc.id
    assert egp_tx.direction == "in"
    assert egp_tx.amount == 48500.0
    assert egp_tx.currency == "EGP"
    assert egp_tx.running_balance == 98500.0
    assert egp_tx.source == "transfer"
    assert egp_tx.linked_transfer_id == transfer.id

    # Check accounts current_balance
    db_session.refresh(usd_acc)
    db_session.refresh(egp_acc)
    assert usd_acc.current_balance == 9000.0
    assert egp_acc.current_balance == 98500.0


def test_internal_move_transfer(db_session):
    """
    Verifies internal transfer between 2 owned accounts with identical currency (INTTRANS):
    - 1:1 amount debited and credited.
    - Both balances updated.
    """
    acc_repo = AccountsRepository(db_session)
    source_acc = acc_repo.create({
        "account_name": "Main Checking USD",
        "bank_name": "Chase",
        "account_number": "CHASE-001",
        "currency": "USD",
        "opening_balance": 15000.0,
    })
    target_acc = acc_repo.create({
        "account_name": "Reserve Savings USD",
        "bank_name": "Chase",
        "account_number": "CHASE-002",
        "currency": "USD",
        "opening_balance": 5000.0,
    })

    service = TransfersService(db_session)
    transfer = service.create_transfer(
        AccountTransferCreate(
            from_account_id=source_acc.id,
            to_account_id=target_acc.id,
            date="2026-09-06",
            from_amount=4000.0,
            from_currency="USD",
            transfer_type="internal",
            note="Reserve allocation",
        ),
        created_by="finance.admin@example.com",
    )

    assert transfer.transfer_type == "internal"
    assert transfer.from_amount == 4000.0
    assert transfer.to_amount == 4000.0
    assert transfer.fx_rate is None

    db_session.refresh(source_acc)
    db_session.refresh(target_acc)
    assert source_acc.current_balance == 11000.0
    assert target_acc.current_balance == 9000.0


def test_external_linked_transfer_single_leg(db_session):
    """
    Verifies external-linked transfer posting only confirmed single leg:
    - Only from_only leg posts outflow.
    - exchange_reference is recorded.
    """
    acc_repo = AccountsRepository(db_session)
    local_acc = acc_repo.create({
        "account_name": "CIB EGP Operating",
        "bank_name": "CIB",
        "account_number": "CIB-EGP-999",
        "currency": "EGP",
        "opening_balance": 100000.0,
    })

    service = TransfersService(db_session)
    transfer = service.create_transfer(
        AccountTransferCreate(
            from_account_id=local_acc.id,
            to_account_id=None,
            date="2026-09-07",
            from_amount=25000.0,
            from_currency="EGP",
            to_amount=500.0,
            to_currency="USD",
            fx_rate=50.0,
            transfer_type="external_linked",
            confirmed_leg="from_only",
            exchange_reference="BROKER-REF-2026-X1",
            note="Remittance sent to international partner",
        ),
        created_by="finance.admin@example.com",
    )

    assert transfer.transfer_type == "external_linked"
    assert transfer.confirmed_leg == "from_only"
    assert transfer.outflow_transaction_id is not None
    assert transfer.inflow_transaction_id is None

    db_session.refresh(local_acc)
    assert local_acc.current_balance == 75000.0

    # Verify transaction leg
    tx = db_session.query(LedgerTransactionDB).filter(LedgerTransactionDB.id == transfer.outflow_transaction_id).first()
    assert tx.direction == "out"
    assert tx.amount == 25000.0
    assert tx.reference == "BROKER-REF-2026-X1"


def test_transfer_validations(db_session):
    """
    Verifies transfer business logic rejections:
    - Same account from and to.
    - Inactive accounts.
    - Internal move with mismatching currencies.
    - Same-bank FX with missing fx_rate/to_amount.
    """
    acc_repo = AccountsRepository(db_session)
    acc1 = acc_repo.create({
        "account_name": "USD 1",
        "bank_name": "CIB",
        "account_number": "1",
        "currency": "USD",
        "opening_balance": 1000.0,
    })
    acc2 = acc_repo.create({
        "account_name": "EGP 1",
        "bank_name": "CIB",
        "account_number": "2",
        "currency": "EGP",
        "opening_balance": 1000.0,
    })
    inactive_acc = acc_repo.create({
        "account_name": "Inactive USD",
        "bank_name": "CIB",
        "account_number": "3",
        "currency": "USD",
        "opening_balance": 1000.0,
    })
    inactive_acc.is_active = False
    db_session.commit()

    service = TransfersService(db_session)

    # 1. Transfer to self
    with pytest.raises(HTTPException) as exc:
        service.create_transfer(
            AccountTransferCreate(
                from_account_id=acc1.id,
                to_account_id=acc1.id,
                date="2026-09-01",
                from_amount=100.0,
                from_currency="USD",
                transfer_type="internal",
            )
        )
    assert exc.value.status_code == 400
    assert "cannot be the same" in exc.value.detail

    # 2. Inactive account
    with pytest.raises(HTTPException) as exc:
        service.create_transfer(
            AccountTransferCreate(
                from_account_id=inactive_acc.id,
                to_account_id=acc1.id,
                date="2026-09-01",
                from_amount=100.0,
                from_currency="USD",
                transfer_type="internal",
            )
        )
    assert exc.value.status_code == 400
    assert "inactive" in exc.value.detail

    # 3. Internal transfer with different currencies
    with pytest.raises(HTTPException) as exc:
        service.create_transfer(
            AccountTransferCreate(
                from_account_id=acc1.id,
                to_account_id=acc2.id,
                date="2026-09-01",
                from_amount=100.0,
                from_currency="USD",
                to_currency="EGP",
                transfer_type="internal",
            )
        )
    assert exc.value.status_code == 400
    assert "identical currencies" in exc.value.detail

    # 4. Same-bank FX missing fx_rate and to_amount
    with pytest.raises(HTTPException) as exc:
        service.create_transfer(
            AccountTransferCreate(
                from_account_id=acc1.id,
                to_account_id=acc2.id,
                date="2026-09-01",
                from_amount=100.0,
                from_currency="USD",
                to_currency="EGP",
                transfer_type="same_bank_fx",
            )
        )
    assert exc.value.status_code == 400
    assert "requires either fx_rate or to_amount" in exc.value.detail


def test_transfer_chronological_running_balances(db_session):
    """
    Verifies that inserting a transfer back-dated between existing transactions
    correctly recalculates continuous running balances for both accounts.
    """
    acc_repo = AccountsRepository(db_session)
    ledger_repo = LedgerRepository(db_session)

    acc1 = acc_repo.create({
        "account_name": "Chron Source",
        "bank_name": "Bank",
        "account_number": "C-1",
        "currency": "USD",
        "opening_balance": 10000.0,
    })
    acc2 = acc_repo.create({
        "account_name": "Chron Target",
        "bank_name": "Bank",
        "account_number": "C-2",
        "currency": "USD",
        "opening_balance": 5000.0,
    })

    # Day 1: 2026-09-01
    ledger_repo.create_transaction(acc1.id, {"date": "2026-09-01", "amount": 2000.0, "direction": "in", "source": "manual"})
    # Day 3: 2026-09-03
    t3 = ledger_repo.create_transaction(acc1.id, {"date": "2026-09-03", "amount": 1000.0, "direction": "out", "source": "manual"})

    # Prior state: 10,000 + 2,000 - 1,000 = 11,000
    db_session.refresh(acc1)
    assert acc1.current_balance == 11000.0

    # Insert transfer on Day 2: 2026-09-02 for 3,000 USD
    service = TransfersService(db_session)
    service.create_transfer(
        AccountTransferCreate(
            from_account_id=acc1.id,
            to_account_id=acc2.id,
            date="2026-09-02",
            from_amount=3000.0,
            from_currency="USD",
            transfer_type="internal",
        )
    )

    # Now Day 3 running balance on acc1 should be:
    # 10,000 (opening) + 2,000 (day 1) - 3,000 (transfer day 2) - 1,000 (day 3) = 8,000
    refreshed_t3 = ledger_repo.get_by_id(t3.id)
    assert refreshed_t3.running_balance == 8000.0

    db_session.refresh(acc1)
    db_session.refresh(acc2)
    assert acc1.current_balance == 8000.0
    assert acc2.current_balance == 8000.0  # 5,000 + 3,000 = 8,000


def test_transfers_api_endpoints(test_client, db_session):
    """
    Tests REST API endpoints via TestClient:
    - POST /api/finance/transfers
    - GET /api/finance/transfers
    - GET /api/finance/transfers/{id}
    """
    acc_repo = AccountsRepository(db_session)
    a1 = acc_repo.create({
        "account_name": "API USD",
        "bank_name": "HSBC",
        "account_number": "H-1",
        "currency": "USD",
        "opening_balance": 20000.0,
    })
    a2 = acc_repo.create({
        "account_name": "API EGP",
        "bank_name": "HSBC",
        "account_number": "H-2",
        "currency": "EGP",
        "opening_balance": 10000.0,
    })

    # 1. POST transfer
    payload = {
        "from_account_id": a1.id,
        "to_account_id": a2.id,
        "date": "2026-09-08",
        "from_amount": 2000.0,
        "from_currency": "USD",
        "fx_rate": 49.0,
        "transfer_type": "same_bank_fx",
        "exchange_reference": "HSBC-FX-88",
        "note": "API test transfer",
    }
    resp = test_client.post("/api/finance/transfers", json=payload)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    transfer_id = data["id"]
    assert data["from_account_name"] == "API USD"
    assert data["to_account_name"] == "API EGP"
    assert data["to_amount"] == 98000.0
    assert data["outflow_transaction_id"] is not None
    assert data["inflow_transaction_id"] is not None

    # 2. GET transfers list
    list_resp = test_client.get(f"/api/finance/transfers?account_id={a1.id}")
    assert list_resp.status_code == 200
    items = list_resp.json()
    assert len(items) == 1
    assert items[0]["id"] == transfer_id

    # 3. GET transfer by ID
    get_resp = test_client.get(f"/api/finance/transfers/{transfer_id}")
    assert get_resp.status_code == 200
    assert get_resp.json()["exchange_reference"] == "HSBC-FX-88"
