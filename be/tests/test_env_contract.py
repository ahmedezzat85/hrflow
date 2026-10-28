"""
Guards the configuration contract: every environment variable the backend reads must be
documented in the repo-root templates and passed through by the production compose file,
so no setting is silently ignored (or silently decided) in production.
"""
import os
import re

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Read by config.py but intentionally NOT passed by compose: derived from other settings there.
NOT_PASSED_BY_COMPOSE = {"DATABASE_URL", "SQLITE_PATH"}
# Fixed inside the container, so intentionally absent from .env.prod.example.
FIXED_BY_CONTAINER = {
    "STORAGE_ENGINE", "DB_TYPE", "POSTGRES_HOST", "POSTGRES_PORT", "HRFLOW_FILES_ROOT",
    "LOG_FILE_PATH", "GOOGLE_CREDENTIALS_FILE", "INVOICE_TEMPLATE_PATH",
} | NOT_PASSED_BY_COMPOSE


def _read(*parts):
    with open(os.path.join(REPO_ROOT, *parts), encoding="utf-8") as fh:
        return fh.read()


def _backend_variables():
    names = set(re.findall(r'os\.getenv\(\s*"([A-Z0-9_]+)"', _read("be", "config.py")))
    names |= set(re.findall(r'os\.getenv\(\s*"([A-Z0-9_]+)"', _read("be", "finance", "services", "payroll_service.py")))
    names.discard("LOCAL_STORAGE_PATH")  # deprecated alias of HRFLOW_FILES_ROOT
    return names


def _template_names(filename):
    text = _read(filename)
    return set(re.findall(r"^#?\s*([A-Z][A-Z0-9_]+)=", text, flags=re.MULTILINE))


def test_dev_template_documents_every_backend_variable():
    missing = _backend_variables() - _template_names(".env.example")
    assert not missing, f".env.example is missing: {sorted(missing)}"


def test_prod_template_documents_every_configurable_variable():
    missing = _backend_variables() - FIXED_BY_CONTAINER - _template_names(".env.prod.example")
    assert not missing, f".env.prod.example is missing: {sorted(missing)}"


def test_compose_passes_every_backend_variable_to_the_app():
    compose = _read("deploy", "prod", "docker-compose.yml")
    app_block = compose.split("  app:", 1)[1].split("\n  web:", 1)[0]
    passed = set(re.findall(r"^\s{6}([A-Z][A-Z0-9_]+):", app_block, flags=re.MULTILINE))
    missing = _backend_variables() - NOT_PASSED_BY_COMPOSE - passed
    assert not missing, f"docker-compose.yml does not pass to the app: {sorted(missing)}"


def test_no_stray_backend_env_file_is_referenced():
    assert not os.path.exists(os.path.join(REPO_ROOT, "be", ".env.example"))
