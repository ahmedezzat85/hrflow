"""
be/tests/test_finance_categories_payment_types.py
Tests for Phase 0: Extensible Lookups (Categories & Payment Types)
Verifies:
- Categories full CRUD and deactivation
- Payment types full CRUD and deactivation
- Name/code uniqueness and validation
- Dynamic category creation and immediate usability
- Historical transaction category preservation on deactivation and rename (ID reference integrity)
- RBAC authorization on /api/finance/categories and /api/finance/payment-types
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db import Base
import models_db
from finance.models import (
    TransactionCategoryDB,
    PaymentTypeDB,
    FinanceBankAccountDB,
    LedgerTransactionDB,
)
from finance.repositories.categories_repository import CategoriesRepository
from finance.repositories.payment_types_repository import PaymentTypesRepository
from finance.repositories.accounts_repository import AccountsRepository
from finance.repositories.ledger_repository import LedgerRepository
from finance.services.categories_service import CategoriesService
from finance.services.payment_types_service import PaymentTypesService
from finance.services.ledger_service import LedgerService
from finance.schemas import (
    CategoryCreate,
    CategoryUpdate,
    PaymentTypeCreate,
    PaymentTypeUpdate,
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


def test_categories_crud_and_deactivation(db_session):
    """Verifies category create, read, update (rename, kind, is_petty), and deactivation."""
    repo = CategoriesRepository(db_session)
    service = CategoriesService(repo)

    # 1. Create category
    cat = service.create_category(
        CategoryCreate(
            name="Office Kitchen",
            kind="cost",
            is_petty=True,
            sort_order=5,
        )
    )
    assert cat.id is not None
    assert cat.name == "Office Kitchen"
    assert cat.kind == "cost"
    assert cat.is_petty is True
    assert cat.is_active is True

    # 2. Duplicate name rejected
    with pytest.raises(Exception) as exc_info:
        service.create_category(CategoryCreate(name="Office Kitchen"))
    assert "already exists" in str(exc_info.value)

    # 3. Update category (rename and sort_order)
    updated = service.update_category(
        cat.id,
        CategoryUpdate(name="Kitchen & Beverages", sort_order=1),
    )
    assert updated.name == "Kitchen & Beverages"
    assert updated.sort_order == 1

    # 4. Deactivate category
    deactivated = service.deactivate_category(cat.id)
    assert deactivated.is_active is False

    # Active filter excludes deactivated
    active_cats = service.list_categories(is_active=True)
    assert not any(c.id == cat.id for c in active_cats)

    # Inactive filter includes it
    inactive_cats = service.list_categories(is_active=False)
    assert any(c.id == cat.id for c in inactive_cats)


def test_payment_types_crud_and_validation(db_session):
    """Verifies payment types create, read, update, and deactivation."""
    repo = PaymentTypesRepository(db_session)
    service = PaymentTypesService(repo)

    # 1. Create payment type
    pt = service.create_payment_type(
        PaymentTypeCreate(
            name="Bank Cheque",
            code="CHK_VIP",
            requires_cheque_number=True,
            requires_bank_fee_flag=False,
        )
    )
    assert pt.id is not None
    assert pt.code == "CHK_VIP"
    assert pt.requires_cheque_number is True
    assert pt.is_active is True

    # 2. Duplicate code rejected
    with pytest.raises(Exception) as exc_info:
        service.create_payment_type(PaymentTypeCreate(name="Other", code="chk_vip"))
    assert "already exists" in str(exc_info.value)

    # 3. Update
    updated = service.update_payment_type(
        pt.id,
        PaymentTypeUpdate(name="VIP Company Cheque", requires_bank_fee_flag=True),
    )
    assert updated.name == "VIP Company Cheque"
    assert updated.requires_bank_fee_flag is True

    # 4. Deactivate
    deactivated = service.deactivate_payment_type(pt.id)
    assert deactivated.is_active is False


def test_category_id_reference_integrity_on_rename_and_deactivate(db_session):
    """
    Phase 0 Verification Requirement:
    - Add a new category and confirm it's immediately usable in transaction entry.
    - Deactivate a category with existing transactions; confirm those transactions still display
      the category name correctly, and the category no longer appears in the active dropdown.
    - Rename a category; confirm historical transactions show the new name.
    """
    cat_repo = CategoriesRepository(db_session)
    cat_service = CategoriesService(cat_repo)
    pt_repo = PaymentTypesRepository(db_session)
    pt_service = PaymentTypesService(pt_repo)
    acc_repo = AccountsRepository(db_session)
    ledger_repo = LedgerRepository(db_session)
    ledger_service = LedgerService(ledger_repo, acc_repo, cat_repo, pt_repo)

    # 1. Add new category and payment type
    cat = cat_service.create_category(CategoryCreate(name="R&D Lab Equipment", kind="cost", is_petty=False))
    pt = pt_service.create_payment_type(PaymentTypeCreate(name="Direct Debit", code="DIR_DEBIT"))

    account = acc_repo.create({
        "account_name": "R&D Bank Account",
        "bank_name": "CIB",
        "account_number": "RD-12345",
        "currency": "USD",
        "opening_balance": 50000.0,
    })

    # 2. Record transaction using the newly created category immediately
    tx = ledger_service.record_manual_transaction(
        account_id=account.id,
        payload=LedgerTransactionCreate(
            date="2026-09-01",
            amount=3200.0,
            direction="out",
            category_id=cat.id,
            payment_type_id=pt.id,
            description="3D Printer nozzles",
        ),
        user_email="engineer@voyance.health",
    )
    assert tx.category_name == "R&D Lab Equipment"
    assert tx.payment_type_code == "DIR_DEBIT"

    # 3. Deactivate category: transaction still displays the name, but category is absent from active list
    cat_service.deactivate_category(cat.id)

    # Transaction read still resolves the name
    fetched_tx = ledger_service.get_transaction(tx.id)
    assert fetched_tx.category_name == "R&D Lab Equipment"

    # Active dropdown query excludes deactivated category
    active_options = cat_service.list_categories(is_active=True)
    assert not any(c.id == cat.id for c in active_options)

    # 4. Rename category: historical transaction automatically reflects the new name
    cat_service.update_category(cat.id, CategoryUpdate(name="Advanced R&D Hardware"))

    fetched_tx_after_rename = ledger_service.get_transaction(tx.id)
    assert fetched_tx_after_rename.category_name == "Advanced R&D Hardware"


def test_categories_and_payment_types_api_endpoints(app_client, admin_cookies, employee_cookies):
    """Verifies REST endpoints for categories and payment types, with RBAC protection."""
    # 1. Admin can list categories
    res = app_client.get("/api/finance/categories", cookies=admin_cookies)
    assert res.status_code == 200
    categories = res.json()
    assert isinstance(categories, list)

    # 2. Admin can create and update category
    create_res = app_client.post(
        "/api/finance/categories",
        json={"name": "API Test Category", "kind": "cost", "is_petty": True},
        cookies=admin_cookies,
    )
    assert create_res.status_code == 201
    cat_id = create_res.json()["id"]

    patch_res = app_client.patch(
        f"/api/finance/categories/{cat_id}",
        json={"name": "API Test Category Renamed"},
        cookies=admin_cookies,
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["name"] == "API Test Category Renamed"

    # 3. Admin can list and create payment type
    pt_res = app_client.get("/api/finance/payment-types", cookies=admin_cookies)
    assert pt_res.status_code == 200

    create_pt = app_client.post(
        "/api/finance/payment-types",
        json={"name": "Wire Transfer", "code": "WIRE_SPECIAL"},
        cookies=admin_cookies,
    )
    assert create_pt.status_code == 201

    # 4. Employee is rejected (403)
    emp_res = app_client.get("/api/finance/categories", cookies=employee_cookies)
    assert emp_res.status_code == 403

    emp_pt_res = app_client.get("/api/finance/payment-types", cookies=employee_cookies)
    assert emp_pt_res.status_code == 403

    # 5. Unauthenticated rejected (401)
    unauth_res = app_client.get("/api/finance/categories")
    assert unauth_res.status_code == 401
