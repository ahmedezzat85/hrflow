"""
be/tests/test_finance_ledger.py
Unit and integration tests for Phase 1 of Bank Accounts, Ledger & Cheques:
- Extended bank account model (account_type, country)
- LedgerTransaction model and repository
- Balance recomputation (point-in-time calculation)
- Automatic ledger posting from invoice and bill payments
- Migration backfill verification
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db import Base
import models_db
from finance.models import (
    FinanceBankAccountDB,
    LedgerTransactionDB,
    TransactionCategoryDB,
    PaymentTypeDB,
    CustomerDB,
    VendorDB,
    SalesInvoiceDB,
    BillDB,
    PaymentDB,
)
from finance.repositories.accounts_repository import AccountsRepository
from finance.repositories.ledger_repository import LedgerRepository
from finance.repositories.invoices_repository import InvoicesRepository
from finance.repositories.bills_repository import BillsRepository
from finance.services.accounts_service import AccountsService
from finance.services.ledger_service import LedgerService
from finance.schemas import (
    BankAccountCreate,
    BankAccountUpdate,
    LedgerTransactionCreate,
)


@pytest.fixture
def db_session():
    """Isolated in-memory SQLite session with foreign keys enabled."""
    engine = create_engine("sqlite:///:memory:", echo=False)

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


def test_extended_bank_account_attributes(db_session):
    """Verifies account_type (bank | cash) and country on bank accounts."""
    repo = AccountsRepository(db_session)
    service = AccountsService(repo)

    # 1. Bank account in Egypt
    bank_acc = service.create_account(
        BankAccountCreate(
            account_name="CIB Operating",
            bank_name="Commercial International Bank",
            account_number="1234567890",
            currency="EGP",
            opening_balance=100000.0,
            account_type="bank",
            country="Egypt",
        )
    )
    assert bank_acc.account_type == "bank"
    assert bank_acc.country == "Egypt"
    assert bank_acc.current_balance == 100000.0

    # 2. Cash account (e.g. petty cash held at office)
    cash_acc = service.create_account(
        BankAccountCreate(
            account_name="Office Safe Cash",
            bank_name="Company Safe",
            account_number="CASH-SAFE-01",
            currency="EGP",
            opening_balance=25000.0,
            account_type="cash",
            country="Egypt",
        )
    )
    assert cash_acc.account_type == "cash"
    assert cash_acc.country == "Egypt"
    assert cash_acc.current_balance == 25000.0

    # 3. Update country
    updated = service.update_account(
        bank_acc.id,
        BankAccountUpdate(country="Egypt - Cairo Branch"),
    )
    assert updated.country == "Egypt - Cairo Branch"


def test_manual_ledger_transaction_updates_balance(db_session):
    """
    Verifies that creating manual LedgerTransaction updates current_balance
    correctly for both 'in' and 'out' directions.
    """
    accounts_repo = AccountsRepository(db_session)
    ledger_repo = LedgerRepository(db_session)
    ledger_service = LedgerService(ledger_repo, accounts_repo)

    account = accounts_repo.create({
        "account_name": "Chase Operating USD",
        "bank_name": "JPMorgan Chase",
        "account_number": "9876543210",
        "currency": "USD",
        "opening_balance": 10000.0,
        "account_type": "bank",
        "country": "US",
    })

    assert account.current_balance == 10000.0

    # 1. Manual transaction 'in' (e.g. ad-hoc capital injection or interest)
    tx_in = ledger_service.record_manual_transaction(
        account_id=account.id,
        payload=LedgerTransactionCreate(
            date="2026-09-01",
            amount=5000.0,
            direction="in",
            currency="USD",
            category="revenue",
            description="Capital injection",
            source="manual",
        ),
        user_email="admin@voyance.health",
    )
    assert tx_in.running_balance == 15000.0
    assert tx_in.direction == "in"
    assert tx_in.source == "manual"
    assert tx_in.created_by == "admin@voyance.health"

    db_session.refresh(account)
    assert account.current_balance == 15000.0

    # 2. Manual transaction 'out' (e.g. bank fee)
    tx_out = ledger_service.record_manual_transaction(
        account_id=account.id,
        payload=LedgerTransactionCreate(
            date="2026-09-02",
            amount=250.0,
            direction="out",
            currency="USD",
            category="cost",
            description="Monthly wire service fee",
            source="manual",
        ),
        user_email="admin@voyance.health",
    )
    assert tx_out.running_balance == 14750.0
    assert tx_out.direction == "out"

    db_session.refresh(account)
    assert account.current_balance == 14750.0


def test_balance_recomputation_point_in_time(db_session):
    """
    Verifies compute_balance given an account and an as_of date:
    opening_balance + signed sum of transactions up to that date.
    """
    accounts_repo = AccountsRepository(db_session)
    ledger_repo = LedgerRepository(db_session)
    service = AccountsService(accounts_repo)

    account = accounts_repo.create({
        "account_name": "HSBC EGP",
        "bank_name": "HSBC",
        "account_number": "1122334455",
        "currency": "EGP",
        "opening_balance": 50000.0,
    })

    # Day 1: +20,000
    ledger_repo.create_transaction(account.id, {
        "date": "2026-08-10",
        "amount": 20000.0,
        "direction": "in",
        "description": "August retainer",
    })
    # Day 2: -5,000
    ledger_repo.create_transaction(account.id, {
        "date": "2026-08-15",
        "amount": 5000.0,
        "direction": "out",
        "description": "Office supplies",
    })
    # Day 3: +10,000 in September
    ledger_repo.create_transaction(account.id, {
        "date": "2026-09-01",
        "amount": 10000.0,
        "direction": "in",
        "description": "September retainer",
    })

    # As of 2026-08-12: 50,000 + 20,000 = 70,000
    bal_mid_aug = service.compute_balance_as_of(account.id, as_of_date="2026-08-12")
    assert bal_mid_aug == 70000.0

    # As of 2026-08-31: 50,000 + 20,000 - 5,000 = 65,000
    bal_end_aug = service.compute_balance_as_of(account.id, as_of_date="2026-08-31")
    assert bal_end_aug == 65000.0

    # As of today / all: 50,000 + 20,000 - 5,000 + 10,000 = 75,000
    bal_total = service.compute_balance_as_of(account.id)
    assert bal_total == 75000.0

    # Current cached balance matches total
    db_session.refresh(account)
    assert account.current_balance == 75000.0


def test_invoice_and_bill_payments_auto_post_to_ledger(db_session):
    """
    Verifies that recording payments via InvoicesRepository and BillsRepository
    automatically creates linked LedgerTransaction records and keeps balances synchronized.
    """
    acc_repo = AccountsRepository(db_session)
    inv_repo = InvoicesRepository(db_session)
    bill_repo = BillsRepository(db_session)

    account = acc_repo.create({
        "account_name": "Main USD Account",
        "bank_name": "Chase",
        "account_number": "5566778899",
        "currency": "USD",
        "opening_balance": 1000.0,
    })

    # Create Customer and Invoice
    cust = CustomerDB(name="Hospital Alpha")
    db_session.add(cust)
    db_session.flush()

    inv = inv_repo.create(
        {
            "customer_id": cust.id,
            "invoice_number": "INV-2026-001",
            "issue_date": "2026-09-01",
            "due_date": "2026-09-30",
            "currency": "USD",
        },
        [{"description": "AI PACS integration", "quantity": 1, "unit_price": 5000.0}],
    )

    # Record invoice payment of 5000 USD
    inv_pmt = inv_repo.record_payment({
        "bank_account_id": account.id,
        "related_invoice_id": inv.id,
        "amount": 5000.0,
        "payment_date": "2026-09-05",
        "direction": "incoming",
        "currency": "USD",
    })

    # Verify bank account balance updated
    db_session.refresh(account)
    assert account.current_balance == 6000.0

    # Verify corresponding ledger transaction was created
    ledger_tx_in = (
        db_session.query(LedgerTransactionDB)
        .filter(LedgerTransactionDB.linked_invoice_id == inv.id)
        .first()
    )
    assert ledger_tx_in is not None
    assert ledger_tx_in.account_id == account.id
    assert ledger_tx_in.amount == 5000.0
    assert ledger_tx_in.direction == "in"
    assert ledger_tx_in.source == "invoice_payment"
    assert ledger_tx_in.running_balance == 6000.0

    # Create Vendor and Bill
    vendor = VendorDB(name="AWS Cloud")
    db_session.add(vendor)
    db_session.flush()

    bill = bill_repo.create(
        {
            "vendor_id": vendor.id,
            "bill_number": "BILL-AWS-001",
            "category": "Cloud Infrastructure",
            "issue_date": "2026-09-02",
            "due_date": "2026-09-20",
            "currency": "USD",
        },
        [{"description": "GPU instances", "quantity": 1, "unit_price": 1200.0}],
    )

    # Record bill payment of 1200 USD
    bill_pmt = bill_repo.record_payment({
        "bank_account_id": account.id,
        "related_bill_id": bill.id,
        "amount": 1200.0,
        "payment_date": "2026-09-08",
        "direction": "outgoing",
        "currency": "USD",
    })

    # Verify bank account balance updated
    db_session.refresh(account)
    assert account.current_balance == 4800.0

    # Verify corresponding ledger transaction was created
    ledger_tx_out = (
        db_session.query(LedgerTransactionDB)
        .filter(LedgerTransactionDB.linked_bill_id == bill.id)
        .first()
    )
    assert ledger_tx_out is not None
    assert ledger_tx_out.account_id == account.id
    assert ledger_tx_out.amount == 1200.0
    assert ledger_tx_out.direction == "out"
    assert ledger_tx_out.source == "bill_payment"
    assert ledger_tx_out.running_balance == 4800.0


def test_migration_backfill_logic(db_session):
    """
    Simulates the migration backfill logic:
    Given existing invoice and bill payments in finance_payments,
    confirming that backfilled ledger transactions match the final current_balance.
    """
    acc = FinanceBankAccountDB(
        account_name="Seed Bank Account",
        bank_name="CIB",
        account_number="SEED-ACC-1",
        currency="EGP",
        opening_balance=10000.0,
        current_balance=10000.0,
    )
    db_session.add(acc)
    db_session.flush()

    # Seed 2 payments directly in PaymentDB (simulating pre-Phase 1 state)
    p1 = PaymentDB(
        direction="incoming",
        amount=4000.0,
        currency="EGP",
        payment_date="2026-07-01",
        bank_account_id=acc.id,
        reference="Pre-existing invoice payment",
    )
    p2 = PaymentDB(
        direction="outgoing",
        amount=1500.0,
        currency="EGP",
        payment_date="2026-07-15",
        bank_account_id=acc.id,
        reference="Pre-existing bill payment",
    )
    db_session.add_all([p1, p2])
    # Pre-existing current_balance was 10000 + 4000 - 1500 = 12500
    acc.current_balance = 12500.0
    db_session.commit()

    # Seed default categories and payment types for backfill
    cat_rev = TransactionCategoryDB(name="Revenue", kind="revenue")
    cat_cost = TransactionCategoryDB(name="Other", kind="other")
    pt_in = PaymentTypeDB(name="Inbound Transfer", code="INBOUND_TRANS")
    pt_out = PaymentTypeDB(name="Outbound Transfer", code="OUTBOUND_TRANS")
    db_session.add_all([cat_rev, cat_cost, pt_in, pt_out])
    db_session.flush()

    # Run backfill calculation
    payments = (
        db_session.query(PaymentDB)
        .filter(PaymentDB.bank_account_id == acc.id)
        .order_by(PaymentDB.payment_date.asc(), PaymentDB.id.asc())
        .all()
    )

    running_balance = acc.opening_balance
    for p in payments:
        if p.direction == "incoming":
            running_balance += p.amount
            direction = "in"
            source = "invoice_payment"
            cat_id = cat_rev.id
            pt_id = pt_in.id
        else:
            running_balance -= p.amount
            direction = "out"
            source = "bill_payment"
            cat_id = cat_cost.id
            pt_id = pt_out.id

        tx = LedgerTransactionDB(
            account_id=acc.id,
            date=p.payment_date,
            amount=p.amount,
            direction=direction,
            currency=p.currency,
            category_id=cat_id,
            payment_type_id=pt_id,
            reference=p.reference or "",
            description=p.reference or "",
            source=source,
            running_balance=round(running_balance, 4),
            created_by="migration_backfill",
        )
        db_session.add(tx)

    db_session.commit()

    # Verify ledger entries count and running balances
    ledger_entries = (
        db_session.query(LedgerTransactionDB)
        .filter(LedgerTransactionDB.account_id == acc.id)
        .order_by(LedgerTransactionDB.date.asc())
        .all()
    )
    assert len(ledger_entries) == 2
    assert ledger_entries[0].running_balance == 14000.0
    assert ledger_entries[1].running_balance == 12500.0

    # Verify recomputed balance from ledger equals current_balance
    repo = AccountsRepository(db_session)
    assert repo.compute_balance(acc.id) == acc.current_balance


def test_manual_transaction_edit_recalculates_running_balances(db_session):
    """
    Verifies that editing a manual transaction updates its values and automatically
    recomputes continuous running balances for all subsequent transactions and the account.
    """
    accounts_repo = AccountsRepository(db_session)
    ledger_repo = LedgerRepository(db_session)
    ledger_service = LedgerService(ledger_repo, accounts_repo)

    acc = accounts_repo.create({
        "account_name": "Ledger Test Bank",
        "bank_name": "CIB",
        "account_number": "LEDGER-001",
        "currency": "USD",
        "opening_balance": 10000.0,
    })

    # Day 1: +5,000 -> 15,000
    tx1 = ledger_service.record_manual_transaction(
        acc.id,
        LedgerTransactionCreate(
            date="2026-09-01",
            amount=5000.0,
            direction="in",
            currency="USD",
            description="Day 1 deposit",
        ),
    )
    # Day 2: -2,000 -> 13,000
    tx2 = ledger_service.record_manual_transaction(
        acc.id,
        LedgerTransactionCreate(
            date="2026-09-02",
            amount=2000.0,
            direction="out",
            currency="USD",
            description="Day 2 expense",
        ),
    )
    # Day 3: -1,000 -> 12,000
    tx3 = ledger_service.record_manual_transaction(
        acc.id,
        LedgerTransactionCreate(
            date="2026-09-03",
            amount=1000.0,
            direction="out",
            currency="USD",
            description="Day 3 expense",
        ),
    )

    db_session.refresh(acc)
    assert acc.current_balance == 12000.0

    # Edit Day 2 expense: change from 2,000 to 4,000
    from finance.schemas import LedgerTransactionUpdate
    updated_tx2 = ledger_service.update_manual_transaction(
        tx2.id,
        LedgerTransactionUpdate(amount=4000.0),
    )
    assert updated_tx2.amount == 4000.0
    assert updated_tx2.running_balance == 11000.0  # 10,000 + 5,000 - 4,000 = 11,000

    # Verify Day 3 running balance was recalculated to 10,000
    refreshed_tx3 = ledger_service.get_transaction(tx3.id)
    assert refreshed_tx3.running_balance == 10000.0  # 11,000 - 1,000 = 10,000

    # Verify account current_balance was updated to 10,000
    db_session.refresh(acc)
    assert acc.current_balance == 10000.0


def test_manual_transaction_delete_recalculates_running_balances(db_session):
    """
    Verifies that deleting a manual transaction removes it and recalculates continuous running balances.
    """
    accounts_repo = AccountsRepository(db_session)
    ledger_repo = LedgerRepository(db_session)
    ledger_service = LedgerService(ledger_repo, accounts_repo)

    acc = accounts_repo.create({
        "account_name": "Delete Test Bank",
        "bank_name": "Chase",
        "account_number": "DEL-001",
        "currency": "USD",
        "opening_balance": 5000.0,
    })

    # Day 1: +2,000 -> 7,000
    tx1 = ledger_service.record_manual_transaction(
        acc.id,
        LedgerTransactionCreate(date="2026-09-01", amount=2000.0, direction="in"),
    )
    # Day 2: -1,500 -> 5,500
    tx2 = ledger_service.record_manual_transaction(
        acc.id,
        LedgerTransactionCreate(date="2026-09-02", amount=1500.0, direction="out"),
    )
    # Day 3: +500 -> 6,000
    tx3 = ledger_service.record_manual_transaction(
        acc.id,
        LedgerTransactionCreate(date="2026-09-03", amount=500.0, direction="in"),
    )

    db_session.refresh(acc)
    assert acc.current_balance == 6000.0

    # Delete tx2 (-1,500)
    res = ledger_service.delete_manual_transaction(tx2.id)
    assert res["id"] == tx2.id

    # Verify Day 3 running balance is now 5,000 + 2,000 + 500 = 7,500
    refreshed_tx3 = ledger_service.get_transaction(tx3.id)
    assert refreshed_tx3.running_balance == 7500.0

    db_session.refresh(acc)
    assert acc.current_balance == 7500.0


def test_non_manual_transaction_edit_delete_rejected(db_session):
    """
    Verifies that non-manual transactions (e.g. invoice/bill payment, transfers)
    cannot be directly edited or deleted via transaction endpoints.
    """
    from fastapi import HTTPException
    accounts_repo = AccountsRepository(db_session)
    ledger_repo = LedgerRepository(db_session)
    ledger_service = LedgerService(ledger_repo, accounts_repo)

    acc = accounts_repo.create({
        "account_name": "Lock Test Bank",
        "bank_name": "CIB",
        "account_number": "LOCK-001",
        "currency": "USD",
        "opening_balance": 1000.0,
    })

    # Create non-manual transaction
    non_manual_tx = ledger_repo.create_transaction(
        acc.id,
        {
            "date": "2026-09-01",
            "amount": 500.0,
            "direction": "in",
            "source": "transfer",
            "description": "Internal FX transfer leg",
        },
    )

    from finance.schemas import LedgerTransactionUpdate
    with pytest.raises(HTTPException) as exc_edit:
        ledger_service.update_manual_transaction(
            non_manual_tx.id,
            LedgerTransactionUpdate(amount=600.0),
        )
    assert exc_edit.value.status_code == 400
    assert "Only manual transactions can be edited" in exc_edit.value.detail

    with pytest.raises(HTTPException) as exc_del:
        ledger_service.delete_manual_transaction(non_manual_tx.id)
    assert exc_del.value.status_code == 400
    assert "Only manual transactions can be deleted" in exc_del.value.detail


def test_petty_summary_rollup(db_session):
    """
    Verifies the petty-summary endpoint rollup:
    Sums and groups transactions for categories flagged is_petty=True.
    """
    accounts_repo = AccountsRepository(db_session)
    ledger_repo = LedgerRepository(db_session)
    ledger_service = LedgerService(ledger_repo, accounts_repo)

    acc = accounts_repo.create({
        "account_name": "Petty Cash Box",
        "bank_name": "Office Safe",
        "account_number": "SAFE-EGP-1",
        "currency": "EGP",
        "opening_balance": 5000.0,
        "account_type": "cash",
    })

    cat_transport = TransactionCategoryDB(name="Transportation", kind="cost", is_petty=True)
    cat_kitchen = TransactionCategoryDB(name="Kitchen Supplies", kind="cost", is_petty=True)
    cat_rent = TransactionCategoryDB(name="Rent", kind="cost", is_petty=False)
    db_session.add_all([cat_transport, cat_kitchen, cat_rent])
    db_session.flush()

    # 2 Transportation costs: 150 + 250 = 400
    ledger_repo.create_transaction(acc.id, {
        "date": "2026-09-01",
        "amount": 150.0,
        "direction": "out",
        "category_id": cat_transport.id,
        "description": "Taxi to client",
    })
    ledger_repo.create_transaction(acc.id, {
        "date": "2026-09-03",
        "amount": 250.0,
        "direction": "out",
        "category_id": cat_transport.id,
        "description": "Uber airport",
    })

    # 1 Kitchen cost: 300
    ledger_repo.create_transaction(acc.id, {
        "date": "2026-09-02",
        "amount": 300.0,
        "direction": "out",
        "category_id": cat_kitchen.id,
        "description": "Coffee and milk",
    })

    # 1 Non-petty cost (Rent: 2000) - should NOT be included in petty summary
    ledger_repo.create_transaction(acc.id, {
        "date": "2026-09-01",
        "amount": 2000.0,
        "direction": "out",
        "category_id": cat_rent.id,
        "description": "Monthly rent",
    })

    summary = ledger_service.get_petty_summary(acc.id)
    assert summary.account_id == acc.id
    assert summary.total_out == 700.0  # 150 + 250 + 300
    assert summary.net_amount == -700.0
    assert len(summary.transactions) == 3

    by_cat_dict = {item.category_name: item for item in summary.by_category}
    assert "Transportation" in by_cat_dict
    assert by_cat_dict["Transportation"].total_out == 400.0
    assert by_cat_dict["Transportation"].count == 2

    assert "Kitchen Supplies" in by_cat_dict
    assert by_cat_dict["Kitchen Supplies"].total_out == 300.0
    assert by_cat_dict["Kitchen Supplies"].count == 1

    assert "Rent" not in by_cat_dict

