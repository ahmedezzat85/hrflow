"""
be/tests/test_sqlite_to_postgres_migration.py
Tests verifying the SQLite -> PostgreSQL data migration script and SQL-primary dual-write behavior.
"""
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from db import Base
from models_db import (
    EmployeeDB,
    UserDB,
    EmployeeBankAccountDB,
    SalaryHistoryDB,
    InvoiceDB,
)
from scripts.migrate_sqlite_to_postgres import migrate_data
from repositories.dual.employees import DualWriteEmployeeRepository
from repositories.dual.bank import DualWriteBankRepository
from repositories.sql.employees import SqlEmployeeRepository
from repositories.sql.bank import SqlBankRepository
from repositories.sheets.employees import SheetsEmployeeRepository
from repositories.sheets.bank import SheetsBankRepository


@pytest.fixture
def source_and_dest_dbs(tmp_path):
    src_file = tmp_path / "src.db"
    dst_file = tmp_path / "dst.db"

    src_url = f"sqlite:///{src_file}"
    dst_url = f"sqlite:///{dst_file}"

    src_engine = create_engine(src_url, connect_args={"check_same_thread": False})
    dst_engine = create_engine(dst_url, connect_args={"check_same_thread": False})

    Base.metadata.create_all(bind=src_engine)
    Base.metadata.create_all(bind=dst_engine)

    # Seed source database
    SrcSession = sessionmaker(bind=src_engine)
    with SrcSession() as db:
        emp = EmployeeDB(
            id=1,
            name="John Doe",
            email="john@example.com",
            role="employee",
            salary=5000.0,
            status="Active",
        )
        db.add(emp)

        user = UserDB(
            id=1,
            email="john@example.com",
            role="employee",
            employee_id=1,
        )
        db.add(user)

        bank = EmployeeBankAccountDB(
            id=1,
            employee_id=1,
            bank_name="HSBC",
            iban="EG1234567890123456",
            swift_code="HSBCEG",
        )
        db.add(bank)

        sal = SalaryHistoryDB(
            id=1,
            employee_id=1,
            date="2026-01-01",
            previous_salary=4000.0,
            new_salary=5000.0,
            reason="Annual Raise",
        )
        db.add(sal)

        inv = InvoiceDB(
            id=1,
            employee_id=1,
            employee_name="John Doe",
            invoice_number="260101",
            payment_year=2026,
            payment_month=1,
            amount_usd=5000.0,
            status="generated",
        )
        db.add(inv)
        db.commit()

    yield src_url, dst_url, src_engine, dst_engine

    Base.metadata.drop_all(bind=src_engine)
    Base.metadata.drop_all(bind=dst_engine)


def test_sqlite_to_postgres_migration_dry_run(source_and_dest_dbs):
    src_url, dst_url, _, dst_engine = source_and_dest_dbs

    stats = migrate_data(source_url=src_url, dest_url=dst_url, dry_run=True)
    assert stats["dry_run"] is True
    assert stats["tables"]["employees"] == 1
    assert stats["tables"]["users"] == 1
    assert stats["tables"]["employee_bank_accounts"] == 1
    assert stats["total_records"] >= 5

    # Verify destination remains empty
    DstSession = sessionmaker(bind=dst_engine)
    with DstSession() as db:
        assert db.query(EmployeeDB).count() == 0
        assert db.query(UserDB).count() == 0


def test_sqlite_to_postgres_migration_execution_and_idempotency(source_and_dest_dbs):
    src_url, dst_url, _, dst_engine = source_and_dest_dbs

    # 1. Run migration
    stats = migrate_data(source_url=src_url, dest_url=dst_url, dry_run=False)
    assert stats["total_records"] >= 5

    DstSession = sessionmaker(bind=dst_engine)
    with DstSession() as db:
        emp = db.query(EmployeeDB).filter(EmployeeDB.id == 1).first()
        assert emp is not None
        assert emp.name == "John Doe"
        assert emp.salary == 5000.0

        user = db.query(UserDB).filter(UserDB.email == "john@example.com").first()
        assert user is not None
        assert user.employee_id == 1

        bank = db.query(EmployeeBankAccountDB).filter(EmployeeBankAccountDB.employee_id == 1).first()
        assert bank is not None
        assert bank.iban == "EG1234567890123456"

        sal = db.query(SalaryHistoryDB).filter(SalaryHistoryDB.id == 1).first()
        assert sal is not None
        assert sal.new_salary == 5000.0

    # 2. Run migration again (idempotency check)
    stats2 = migrate_data(source_url=src_url, dest_url=dst_url, dry_run=False)
    assert stats2["total_records"] == stats["total_records"]

    with DstSession() as db:
        assert db.query(EmployeeDB).count() == 1
        assert db.query(UserDB).count() == 1


def test_dual_write_reads_from_sql_primary(fake_sheets_client, tmp_path):
    from db import reset_engine_for_testing

    db_file = tmp_path / "dual_test.db"
    db_url = f"sqlite:///{db_file}"
    reset_engine_for_testing(db_url)
    engine = create_engine(db_url, connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)

    # In SQL: Employee is "Alice SQL"
    sql_emp_repo = SqlEmployeeRepository()
    emp_id = sql_emp_repo.create({"name": "Alice SQL", "email": "alice@test.com", "salary": 3000.0})

    # In Sheets: Employee is "Alice Stale Sheets"
    sheets_emp_repo = SheetsEmployeeRepository(client=fake_sheets_client)
    fake_sheets_client.append_row("Employees", {"id": emp_id, "name": "Alice Stale Sheets", "email": "alice@test.com", "salary": 2000.0})

    # Dual write repo (default primary = SQL)
    dual_repo = DualWriteEmployeeRepository(primary=sql_emp_repo, shadow=sheets_emp_repo)

    # Read should return the fresh SQL version
    fetched = dual_repo.get_by_id(emp_id)
    assert fetched["name"] == "Alice SQL"
    assert fetched["salary"] == 3000.0

    reset_engine_for_testing(None)
