"""
test_config_validation.py
Direct unit tests for Config.validate() - the fail-fast startup check
added in Phase 1. See docs/analysis/security-analysis-plan.md, findings
#1 and #4/#6.
"""
import importlib
import pytest


def _fresh_config(monkeypatch, **env_overrides):
    for key in ("SECRET_KEY", "ENVIRONMENT", "ALLOWED_ORIGINS", "ALLOWED_WORKSPACE_DOMAIN"):
        monkeypatch.delenv(key, raising=False)
    for key, value in env_overrides.items():
        monkeypatch.setenv(key, value)
    import config as config_module
    importlib.reload(config_module)
    return config_module.Config


def test_validate_raises_when_secret_key_is_missing(monkeypatch):
    Config = _fresh_config(monkeypatch)
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        Config.validate()


def test_validate_raises_when_secret_key_is_the_known_placeholder(monkeypatch):
    Config = _fresh_config(monkeypatch, SECRET_KEY="change-this-secret-in-production")
    with pytest.raises(RuntimeError, match="SECRET_KEY"):
        Config.validate()


def test_validate_passes_with_a_real_secret_in_development(monkeypatch):
    Config = _fresh_config(monkeypatch, SECRET_KEY="a-real-random-secret-value")
    Config.validate()


def test_validate_raises_in_production_with_wildcard_cors(monkeypatch):
    Config = _fresh_config(
        monkeypatch, SECRET_KEY="a-real-random-secret-value", ENVIRONMENT="production",
        ALLOWED_ORIGINS="*", ALLOWED_WORKSPACE_DOMAIN="hrflow.example.com",
    )
    with pytest.raises(RuntimeError, match="ALLOWED_ORIGINS"):
        Config.validate()


def test_validate_raises_in_production_without_workspace_domain(monkeypatch):
    Config = _fresh_config(
        monkeypatch, SECRET_KEY="a-real-random-secret-value", ENVIRONMENT="production",
        ALLOWED_ORIGINS="https://app.hrflow.example.com",
    )
    with pytest.raises(RuntimeError, match="ALLOWED_WORKSPACE_DOMAIN"):
        Config.validate()


def test_validate_passes_in_production_with_all_settings_correct(monkeypatch):
    Config = _fresh_config(
        monkeypatch, SECRET_KEY="a-real-random-secret-value", ENVIRONMENT="production",
        ALLOWED_ORIGINS="https://app.hrflow.example.com", ALLOWED_WORKSPACE_DOMAIN="hrflow.example.com",
    )
    Config.validate()


def test_cookie_secure_flag_follows_environment(monkeypatch):
    dev_config = _fresh_config(monkeypatch, SECRET_KEY="x", ENVIRONMENT="development")
    assert dev_config.COOKIE_SECURE is False
    prod_config = _fresh_config(monkeypatch, SECRET_KEY="x", ENVIRONMENT="production")
    assert prod_config.COOKIE_SECURE is True
