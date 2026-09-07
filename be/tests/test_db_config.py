"""
test_db_config.py
Tests verifying database engine configuration, dialect selection (DB_TYPE),
and URL construction for SQLite and PostgreSQL.
"""
import importlib
import pytest
from unittest.mock import patch, MagicMock


def _fresh_config(monkeypatch, **env_overrides):
    monkeypatch.setenv("SECRET_KEY", "test-secret-key-12345")
    monkeypatch.setenv("ENVIRONMENT", "development")
    monkeypatch.setenv("STORAGE_ENGINE", "sql")
    monkeypatch.setenv("DB_TYPE", "sqlite")
    monkeypatch.setenv("DATABASE_URL", "")

    for k, v in env_overrides.items():
        if v is None:
            monkeypatch.setenv(k, "")
        else:
            monkeypatch.setenv(k, str(v))

    import config as config_module
    importlib.reload(config_module)
    return config_module.Config


def test_db_type_sqlite_default(monkeypatch):
    Config = _fresh_config(monkeypatch, DB_TYPE="sqlite")
    assert Config.DB_TYPE == "sqlite"
    assert Config.DATABASE_URL.startswith("sqlite:///")
    assert Config.DATABASE_URL.endswith("hrflow.db")
    Config.validate()


def test_db_type_sqlite_custom_path(monkeypatch):
    Config = _fresh_config(monkeypatch, DB_TYPE="sqlite", SQLITE_PATH="/tmp/test_custom.db")
    assert Config.DATABASE_URL == "sqlite:////tmp/test_custom.db"
    Config.validate()


def test_db_type_postgres_discrete_params(monkeypatch):
    Config = _fresh_config(
        monkeypatch,
        DB_TYPE="postgres",
        POSTGRES_USER="hr_admin",
        POSTGRES_PASSWORD="secure_password",
        POSTGRES_HOST="db.internal",
        POSTGRES_PORT="5433",
        POSTGRES_DB="hrflow_prod",
    )
    assert Config.DB_TYPE == "postgres"
    assert Config.DATABASE_URL == "postgresql://hr_admin:secure_password@db.internal:5433/hrflow_prod"
    Config.validate()


def test_explicit_database_url_takes_precedence(monkeypatch):
    custom_url = "postgresql://override_user:pass@127.0.0.1:5432/override_db"
    Config = _fresh_config(monkeypatch, DB_TYPE="sqlite", DATABASE_URL=custom_url)
    assert Config.DATABASE_URL == custom_url


def test_validate_rejects_invalid_db_type(monkeypatch):
    Config = _fresh_config(monkeypatch, DB_TYPE="oracle")
    with pytest.raises(RuntimeError, match="DB_TYPE must be 'sqlite', 'postgres', or 'postgresql'"):
        Config.validate()


def test_validate_rejects_invalid_storage_engine(monkeypatch):
    Config = _fresh_config(monkeypatch, STORAGE_ENGINE="couchdb")
    with pytest.raises(RuntimeError, match="STORAGE_ENGINE 'couchdb' is not supported. HRFlow operates exclusively on SQL"):
        Config.validate()


def test_validate_rejects_sheets_as_storage_engine(monkeypatch):
    Config = _fresh_config(monkeypatch, STORAGE_ENGINE="sheets")
    with pytest.raises(RuntimeError, match="STORAGE_ENGINE 'sheets' is not supported. HRFlow operates exclusively on SQL"):
        Config.validate()



def test_validate_rejects_mismatched_scheme_for_postgres(monkeypatch):
    Config = _fresh_config(
        monkeypatch,
        STORAGE_ENGINE="sql",
        DB_TYPE="postgres",
        DATABASE_URL="sqlite:///./mismatch.db",
    )
    with pytest.raises(RuntimeError, match="does not start with postgresql://"):
        Config.validate()


def test_validate_rejects_mismatched_scheme_for_sqlite(monkeypatch):
    Config = _fresh_config(
        monkeypatch,
        STORAGE_ENGINE="sql",
        DB_TYPE="sqlite",
        DATABASE_URL="postgresql://user:pass@localhost:5432/db",
    )
    with pytest.raises(RuntimeError, match="does not start with sqlite"):
        Config.validate()


def test_db_get_engine_sqlite_kwargs(monkeypatch):
    import db
    db._engine = None

    _fresh_config(monkeypatch, DB_TYPE="sqlite", DATABASE_URL="sqlite:///:memory:")
    with patch("db.create_engine") as mock_create_engine:
        mock_create_engine.return_value = MagicMock()
        db.get_engine()
        mock_create_engine.assert_called_once()
        args, kwargs = mock_create_engine.call_args
        assert args[0] == "sqlite:///:memory:"
        assert kwargs["connect_args"] == {"check_same_thread": False}
        assert kwargs["pool_pre_ping"] is True


def test_db_get_engine_postgres_kwargs(monkeypatch):
    import db
    db._engine = None

    pg_url = "postgresql://user:pass@localhost:5432/db"
    _fresh_config(
        monkeypatch,
        DB_TYPE="postgres",
        DATABASE_URL=pg_url,
        DB_POOL_SIZE="15",
        DB_MAX_OVERFLOW="25",
        DB_POOL_RECYCLE="900",
    )
    with patch("db.create_engine") as mock_create_engine:
        mock_create_engine.return_value = MagicMock()
        db.get_engine()
        mock_create_engine.assert_called_once()
        args, kwargs = mock_create_engine.call_args
        assert args[0] == pg_url
        assert kwargs["pool_size"] == 15
        assert kwargs["max_overflow"] == 25
        assert kwargs["pool_recycle"] == 900
        assert kwargs["pool_pre_ping"] is True
