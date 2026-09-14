"""
be/tests/test_finance_transfer_composer.py
Tests for Story 5.3: Transfer and withdrawal composer
- AC 1: User cannot create a transfer from an account to itself.
- AC 2: FX direction and both resulting amounts are unambiguous (preview and calculation).
- AC 3: Both legs post atomically for internal transfers.
- AC 4: In-transit transfers can be matched without creating duplicate legs.
- Fees and preview endpoint.
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
    TransactionCategoryDB,
    PaymentTypeDB,
)
from finance.services.transfers_service import TransfersService
from finance.schemas import (
    AccountTransferCreate,
    TransferPreviewRequest,
    TransferMatchRequest,
)
from main import app
from deps import get_current_user


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

    # Seed admin user
    session.add(models_db.UserDB(email="finance.admin@example.com", role="admin"))

    # Seed Bank Accounts
    usd_acc = FinanceBankAccountDB(
        account_name="Chase Operating USD",
        bank_name="Chase",
        account_number="98765432101",
        currency="USD",
        opening_balance=10000.0,
        current_balance=10000.0,
        account_type="bank",
        is_active=True,
    )
    egp_acc = FinanceBankAccountDB(
        account_name="CIB Operating EGP",
        bank_name="CIB",
        account_number="98765432102",
        currency="EGP",
        opening_balance=50000.0,
        current_balance=50000.0,
        account_type="bank",
        is_active=True,
    )
    usd_savings = FinanceBankAccountDB(
        account_name="Chase Treasury USD",
        bank_name="Chase",
        account_number="98765432103",
        currency="USD",
        opening_balance=25000.0,
        current_balance=25000.0,
        account_type="bank",
        is_active=True,
    )
    session.add_all([usd_acc, egp_acc, usd_savings])

    # Seed categories and payment types
    cat_transfer = TransactionCategoryDB(name="Transfer", kind="transfer", is_active=True)
    cat_fee = TransactionCategoryDB(name="Bank Fees", kind="cost", is_active=True)
    pt_int = PaymentTypeDB(name="Internal Transfer", code="INTTRANS", is_active=True)
    pt_fx = PaymentTypeDB(name="USD to EGP Conversion", code="USDTOEGP", is_active=True)
    pt_out = PaymentTypeDB(name="Outbound Transfer", code="OUTBOUND_TRANS", is_active=True)
    pt_in = PaymentTypeDB(name="Inbound Transfer", code="INBOUND_TRANS", is_active=True)
    session.add_all([cat_transfer, cat_fee, pt_int, pt_fx, pt_out, pt_in])

    session.commit()
    yield session
    session.close()


@pytest.fixture
def client(db_session):
    def override_get_db():
        yield db_session

    def override_get_current_user():
        return {"email": "finance.admin@example.com", "role": "admin"}

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = override_get_current_user

    with TestClient(app) as test_client:
        yield test_client

    app.dependency_overrides.clear()


def test_ac1_same_account_transfer_rejected(db_session):
    """AC 1: User cannot create a transfer from an account to itself."""
    service = TransfersService(db_session)
    usd_acc = db_session.query(FinanceBankAccountDB).filter_by(account_name="Chase Operating USD").first()

    with pytest.raises(HTTPException) as exc_info:
        service.create_transfer(
            AccountTransferCreate(
                from_account_id=usd_acc.id,
                to_account_id=usd_acc.id,
                date="2026-09-14",
                from_amount=500.0,
                from_currency="USD",
                to_currency="USD",
                transfer_type="internal",
            ),
            created_by="tester",
        )
    assert exc_info.value.status_code == 400
    assert "cannot be the same" in exc_info.value.detail.lower()


def test_ac2_fx_direction_and_preview_unambiguous(client, db_session):
    """AC 2: FX direction and both resulting amounts are unambiguous in preview and calculation."""
    usd_acc = db_session.query(FinanceBankAccountDB).filter_by(account_name="Chase Operating USD").first()
    egp_acc = db_session.query(FinanceBankAccountDB).filter_by(account_name="CIB Operating EGP").first()

    res = client.post(
        "/api/finance/transfers/preview",
        json={
            "transfer_type": "same_bank_fx",
            "from_account_id": usd_acc.id,
            "to_account_id": egp_acc.id,
            "from_amount": 1000.0,
            "fx_rate": 48.50,
            "fee": 15.0,
            "date": "2026-09-14",
        },
    )
    assert res.status_code == 200
    data = res.json()

    assert data["is_valid"] is True
    assert data["from_currency"] == "USD"
    assert data["to_currency"] == "EGP"
    assert data["to_projected_balance"] == 50000.0 + 48500.0
    # From balance: 10000 - 1000 - 15 fee = 8985.0
    assert data["from_projected_balance"] == 8985.0
    assert "1 USD = 48.5000 EGP" in data["explicit_fx_direction"]
    assert data["implied_rate"] == 48.50
    assert len(data["journal_preview"]) == 3  # Outflow, Fee, Inflow


def test_ac3_both_legs_post_atomically_for_internal_transfer(client, db_session):
    """AC 3: Both legs post atomically for internal transfers."""
    src = db_session.query(FinanceBankAccountDB).filter_by(account_name="Chase Operating USD").first()
    dst = db_session.query(FinanceBankAccountDB).filter_by(account_name="Chase Treasury USD").first()

    res = client.post(
        "/api/finance/transfers",
        json={
            "transfer_type": "internal",
            "from_account_id": src.id,
            "to_account_id": dst.id,
            "date": "2026-09-14",
            "from_amount": 2000.0,
            "from_currency": "USD",
            "to_currency": "USD",
            "note": "Internal Treasury Funding",
        },
    )
    assert res.status_code == 201
    transfer_data = res.json()
    assert transfer_data["settlement_status"] == "settled"

    # Refresh accounts
    db_session.refresh(src)
    db_session.refresh(dst)
    assert src.current_balance == 8000.0
    assert dst.current_balance == 27000.0

    # Verify both ledger transactions linked to this transfer
    txs = db_session.query(LedgerTransactionDB).filter_by(linked_transfer_id=transfer_data["id"]).all()
    assert len(txs) == 2
    out_leg = next(t for t in txs if t.direction == "out")
    in_leg = next(t for t in txs if t.direction == "in")
    assert out_leg.account_id == src.id
    assert out_leg.amount == 2000.0
    assert in_leg.account_id == dst.id
    assert in_leg.amount == 2000.0


def test_ac4_in_transit_transfers_can_be_matched_without_duplicates(client, db_session):
    """AC 4: In-transit transfers can be matched without creating duplicate legs."""
    src = db_session.query(FinanceBankAccountDB).filter_by(account_name="Chase Operating USD").first()
    dst = db_session.query(FinanceBankAccountDB).filter_by(account_name="Chase Treasury USD").first()

    # 1. Create in-transit transfer (outflow only confirmed)
    res = client.post(
        "/api/finance/transfers",
        json={
            "transfer_type": "external_linked",
            "from_account_id": src.id,
            "to_account_id": None,
            "date": "2026-09-14",
            "from_amount": 1500.0,
            "from_currency": "USD",
            "confirmed_leg": "from_only",
            "exchange_reference": "WIRE-2026-0914-01",
            "note": "Intercompany wire in-transit",
        },
    )
    assert res.status_code == 201
    transfer = res.json()
    assert transfer["settlement_status"] == "in_transit"
    transfer_id = transfer["id"]

    # Only 1 ledger leg created so far
    txs_before = db_session.query(LedgerTransactionDB).filter_by(linked_transfer_id=transfer_id).all()
    assert len(txs_before) == 1
    assert txs_before[0].direction == "out"
    assert txs_before[0].account_id == src.id

    # 2. Match in-transit transfer with destination account
    match_res = client.post(
        f"/api/finance/transfers/{transfer_id}/match",
        json={
            "target_account_id": dst.id,
            "received_amount": 1500.0,
            "settled_date": "2026-09-15",
            "note": "Received and confirmed in Chase Treasury",
        },
    )
    assert match_res.status_code == 200
    matched_data = match_res.json()
    assert matched_data["settlement_status"] == "settled"
    assert matched_data["to_account_id"] == dst.id

    # Verify exactly 2 ledger transactions now exist (outflow + new inflow, no duplicate outflow)
    txs_after = db_session.query(LedgerTransactionDB).filter_by(linked_transfer_id=transfer_id).all()
    assert len(txs_after) == 2
    out_legs = [t for t in txs_after if t.direction == "out"]
    in_legs = [t for t in txs_after if t.direction == "in"]
    assert len(out_legs) == 1
    assert len(in_legs) == 1
    assert in_legs[0].account_id == dst.id
    assert in_legs[0].amount == 1500.0

    # 3. Trying to match again is rejected
    repeat_res = client.post(
        f"/api/finance/transfers/{transfer_id}/match",
        json={"target_account_id": dst.id},
    )
    assert repeat_res.status_code == 400
    assert "already fully settled" in repeat_res.json()["detail"]
