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
    CATEGORY_PALETTE,
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


def test_category_color_lifecycle_and_validation(app_client, admin_cookies):
    """
    BE-1 Acceptance:
    - Every category returned in GET /api/finance/categories has a non-null color from CATEGORY_PALETTE.
    - Category can be created with explicit color and without color (auto-assigned mod 8).
    - Invalid color on create or update returns 422.
    - Updating with color=None preserves current color (no reset).
    """
    # 1. Listing categories: all have non-null color from allowed palette
    res = app_client.get("/api/finance/categories", cookies=admin_cookies)
    assert res.status_code == 200
    cats = res.json()
    assert len(cats) > 0
    for c in cats:
        assert c.get("color") in CATEGORY_PALETTE

    initial_count = len(cats)

    # 2. Create with explicit valid color
    create_res = app_client.post(
        "/api/finance/categories",
        json={"name": "Color Test Explicit", "kind": "cost", "color": "teal"},
        cookies=admin_cookies,
    )
    assert create_res.status_code == 201
    explicit_cat = create_res.json()
    assert explicit_cat["color"] == "teal"
    cat_id = explicit_cat["id"]

    # 3. Create without color: assigns palette slot (count mod 8)
    expected_slot_color = CATEGORY_PALETTE[(initial_count + 1) % len(CATEGORY_PALETTE)]
    create_no_color = app_client.post(
        "/api/finance/categories",
        json={"name": "Color Test Auto", "kind": "cost"},
        cookies=admin_cookies,
    )
    assert create_no_color.status_code == 201
    assert create_no_color.json()["color"] == expected_slot_color

    # 4. Create with invalid color returns 422
    invalid_create = app_client.post(
        "/api/finance/categories",
        json={"name": "Color Test Invalid", "kind": "cost", "color": "chartreuse"},
        cookies=admin_cookies,
    )
    assert invalid_create.status_code == 422

    # 5. Update with new valid color
    patch_res = app_client.patch(
        f"/api/finance/categories/{cat_id}",
        json={"color": "ochre"},
        cookies=admin_cookies,
    )
    assert patch_res.status_code == 200
    assert patch_res.json()["color"] == "ochre"

    # 6. Update with invalid color returns 422
    patch_invalid = app_client.patch(
        f"/api/finance/categories/{cat_id}",
        json={"color": "magenta"},
        cookies=admin_cookies,
    )
    assert patch_invalid.status_code == 422

    # 7. Update with color=None preserves current color (no reset)
    patch_null = app_client.patch(
        f"/api/finance/categories/{cat_id}",
        json={"name": "Color Test Explicit Renamed", "color": None},
        cookies=admin_cookies,
    )
    assert patch_null.status_code == 200
    assert patch_null.json()["name"] == "Color Test Explicit Renamed"
    assert patch_null.json()["color"] == "ochre"


def test_migration_0035_category_color_up_and_down(tmp_path):
    """Verifies Alembic migration 0035_category_color upgrade and downgrade on an isolated SQLite database."""
    import importlib.util
    import os
    import sqlalchemy as sa
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    be_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(be_dir, "migrations", "versions", "0035_category_color.py")
    spec = importlib.util.spec_from_file_location("mig_0035", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    engine = sa.create_engine(f"sqlite:///{tmp_path / 'test_mig.db'}")
    with engine.begin() as conn:
        conn.execute(sa.text(
            "CREATE TABLE finance_transaction_categories ("
            "id INTEGER PRIMARY KEY, "
            "name VARCHAR(100), "
            "kind VARCHAR(20), "
            "is_active BOOLEAN, "
            "sort_order INTEGER, "
            "is_petty BOOLEAN, "
            "created_at TIMESTAMP)"
        ))
        conn.execute(sa.text(
            "INSERT INTO finance_transaction_categories (id, name, kind, is_active, sort_order, is_petty) VALUES "
            "(1, 'Cat A', 'cost', 1, 10, 0), "
            "(2, 'Cat B', 'cost', 1, 5, 0), "
            "(3, 'Cat C', 'cost', 1, 20, 0), "
            "(4, 'Cat D', 'cost', 1, 1, 0)"
        ))

    # Run upgrade
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.upgrade()

    with engine.connect() as conn:
        insp = sa.inspect(conn)
        cols = {c["name"] for c in insp.get_columns("finance_transaction_categories")}
        assert "color" in cols

        # Check color ordering: sort_order ASC, id ASC -> id 4 (sort_order 1), id 2 (sort_order 5), id 1 (sort_order 10), id 3 (sort_order 20)
        rows = conn.execute(sa.text(
            "SELECT id, color FROM finance_transaction_categories ORDER BY sort_order ASC, id ASC"
        )).fetchall()
        assert rows[0] == (4, CATEGORY_PALETTE[0])
        assert rows[1] == (2, CATEGORY_PALETTE[1])
        assert rows[2] == (1, CATEGORY_PALETTE[2])
        assert rows[3] == (3, CATEGORY_PALETTE[3])

    # Run downgrade
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            mod.downgrade()

    with engine.connect() as conn:
        insp = sa.inspect(conn)
        cols = {c["name"] for c in insp.get_columns("finance_transaction_categories")}
        assert "color" not in cols

