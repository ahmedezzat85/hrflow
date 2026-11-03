"""The front door: key check in three forms, bare 404s, rate limits, log redaction, and the tool list over real MCP."""
import json
import logging

import pytest
from starlette.testclient import TestClient

import app as app_module
from conftest import KEY, TOKEN

MCP_HEADERS = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"}
INIT = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
        "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}}}


@pytest.fixture
def web(config, client):
    with TestClient(app_module.build_app(config, client, requests_per_minute=50, failures_per_minute=5),
                    base_url="http://127.0.0.1:8765") as c:
        yield c


def _sse_json(response):
    for line in response.text.splitlines():
        if line.startswith("data:"):
            return json.loads(line[5:])
    return response.json()


def _open_session(web, headers):
    r = web.post("/mcp", headers={**MCP_HEADERS, **headers}, json=INIT)
    assert r.status_code == 200, r.text
    session = {"mcp-session-id": r.headers["mcp-session-id"], "mcp-protocol-version": "2025-06-18"}
    web.post("/mcp", headers={**MCP_HEADERS, **headers, **session}, json={"jsonrpc": "2.0", "method": "notifications/initialized"})
    return {**headers, **session}


def _call(web, headers, method, params=None, id=2):
    r = web.post("/mcp", headers={**MCP_HEADERS, **headers}, json={"jsonrpc": "2.0", "id": id, "method": method, "params": params or {}})
    assert r.status_code == 200, r.text
    return _sse_json(r)["result"]


# ---- the key ---------------------------------------------------------------------------------------------------

def test_no_key_or_wrong_key_gets_a_bare_404(web):
    for headers, path in [({}, "/mcp"), ({"Authorization": "Bearer nope"}, "/mcp"), ({"X-API-Key": "nope"}, "/mcp"), ({}, "/wrong/mcp")]:
        r = web.post(path, headers={**MCP_HEADERS, **headers}, json=INIT)
        assert r.status_code == 404 and r.content == b""


@pytest.mark.parametrize("headers,path", [
    ({"Authorization": f"Bearer {KEY}"}, "/mcp"),
    ({"X-API-Key": KEY}, "/mcp"),
    ({}, f"/{KEY}/mcp"),
])
def test_each_key_form_opens_the_door(web, headers, path):
    r = web.post(path, headers={**MCP_HEADERS, **headers}, json=INIT)
    assert r.status_code == 200 and "hrflow" in r.text


def test_the_hrflow_token_is_not_a_key(web):
    assert web.post("/mcp", headers={**MCP_HEADERS, "Authorization": f"Bearer {TOKEN}"}, json=INIT).status_code == 404


def test_repeated_wrong_keys_are_rate_limited_per_client(web):
    codes = [web.post("/mcp", headers={**MCP_HEADERS, "CF-Connecting-IP": "9.9.9.9"}, json=INIT).status_code for _ in range(7)]
    assert codes[:5] == [404] * 5 and codes[5:] == [429, 429]
    # another client is unaffected, and the right key still works for the first one
    assert web.post("/mcp", headers={**MCP_HEADERS, "CF-Connecting-IP": "8.8.8.8"}, json=INIT).status_code == 404
    assert web.post("/mcp", headers={**MCP_HEADERS, "CF-Connecting-IP": "9.9.9.9", "Authorization": f"Bearer {KEY}"}, json=INIT).status_code == 200


def test_overall_request_limit(config, client):
    with TestClient(app_module.build_app(config, client, requests_per_minute=3), base_url="http://127.0.0.1:8765") as c:
        codes = [c.post("/mcp", headers={**MCP_HEADERS, "Authorization": f"Bearer {KEY}"}, json=INIT).status_code for _ in range(5)]
    assert codes[:3] == [200] * 3 and codes[3:] == [429, 429]


def test_the_key_never_reaches_the_logs(web, caplog):
    caplog.set_level(logging.DEBUG)
    web.post(f"/{KEY}/mcp", headers=MCP_HEADERS, json=INIT)
    web.post(f"/{KEY}xx/mcp", headers=MCP_HEADERS, json=INIT)
    web.post("/mcp", headers={**MCP_HEADERS, "Authorization": f"Bearer {KEY}"}, json=INIT)
    # The test client logs what it sends; only this server's own output matters
    text = " | ".join(r.getMessage() for r in caplog.records if not r.name.startswith(("httpx", "httpcore")))
    assert "<KEY>" in text and KEY not in text and TOKEN not in text


def test_the_sliding_window_forgets_old_events():
    now = [0.0]
    window = app_module.SlidingWindow(2, 60, clock=lambda: now[0])
    assert window.hit("a") and window.hit("a") and not window.hit("a")
    now[0] = 61
    assert window.hit("a")


# ---- the tools over MCP ----------------------------------------------------------------------------------------

def test_the_exposed_tools_are_exactly_the_planned_set_and_none_can_approve(web):
    session = _open_session(web, {"Authorization": f"Bearer {KEY}"})
    names = {t["name"] for t in _call(web, session, "tools/list")["tools"]}
    assert names == {"find_employee", "list_leave", "list_holidays", "list_leave_types",
                     "validate_history_items", "stage_history_items", "get_import_batch"}


def test_a_tool_call_goes_through_with_the_token_and_returns_minimal_data(web, fake):
    session = _open_session(web, {"X-API-Key": KEY})
    result = _call(web, session, "tools/call", {"name": "find_employee", "arguments": {"query": "sara"}}, id=3)
    text = json.dumps(result)
    assert "Sara Ali" in text and "9999" not in text and "SECRET-ID" not in text
    assert fake.calls[-1].headers["authorization"] == f"Bearer {TOKEN}"


def test_a_tool_failure_is_reported_as_an_error_result(web, fake):
    fake.routes[("GET", "/api/employees")] = (401, {})
    session = _open_session(web, {"Authorization": f"Bearer {KEY}"})
    result = _call(web, session, "tools/call", {"name": "find_employee", "arguments": {"query": "sara"}}, id=3)
    assert result["isError"] is True and "expired or revoked" in json.dumps(result) and TOKEN not in json.dumps(result)
