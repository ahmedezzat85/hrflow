import pytest
from db import get_session_factory
from core.rbac_seed import seed_rbac

@pytest.fixture
def db_session():
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.close()

@pytest.fixture(autouse=True)
def init_rbac(app_client, db_session):
    seed_rbac(db_session)

def test_correlation_id_propagation(app_client, admin_cookies):
    correlation_id = "cor-test-uuid-9841"
    headers = {"X-Correlation-ID": correlation_id}

    response = app_client.get("/api/finance/feature-flags", headers=headers, cookies=admin_cookies)
    assert response.status_code == 200
    assert response.headers.get("X-Correlation-ID") == correlation_id
    assert response.headers.get("X-Request-ID") == correlation_id

def test_feature_flags_retrieval_and_toggle(app_client, admin_cookies):
    # 1. Retrieve current feature flags
    res = app_client.get("/api/finance/feature-flags", cookies=admin_cookies)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    flags = data["flags"]
    assert "phase8_guided_payroll" in flags
    assert "mobile_priority_ui" in flags
    assert data["total_count"] >= 9

    # 2. Toggle a feature flag safely
    toggle_payload = {"flags": {"mobile_priority_ui": False}}
    patch_res = app_client.patch("/api/finance/feature-flags", json=toggle_payload, cookies=admin_cookies)
    assert patch_res.status_code == 200
    assert patch_res.json()["flags"]["mobile_priority_ui"] is False

    # 3. Restore flag
    restore_payload = {"flags": {"mobile_priority_ui": True}}
    app_client.patch("/api/finance/feature-flags", json=restore_payload, cookies=admin_cookies)

def test_feature_flags_permission_check(app_client, employee_cookies):
    # Employee without finance.settings.write should be rejected with 403
    toggle_payload = {"flags": {"phase8_guided_payroll": False}}
    res = app_client.patch("/api/finance/feature-flags", json=toggle_payload, cookies=employee_cookies)
    assert res.status_code == 403

def test_observability_metrics_retrieval(app_client, admin_cookies):
    res = app_client.get("/api/finance/observability/metrics", cookies=admin_cookies)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "healthy"
    assert "uptime_seconds" in data
    assert "total_commands" in data
    assert "reconciliation_throughput_lps" in data
    assert "rollout_stage" in data
