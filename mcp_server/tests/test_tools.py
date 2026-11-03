import json

import httpx
import pytest

import tools
from config import ConfigError, load_config
from conftest import KEY, TOKEN
from hrflow_client import HRFlowError

ENV = {"HRFLOW_BASE_URL": "http://localhost:80/", "HRFLOW_API_TOKEN": TOKEN, "HRFLOW_MCP_KEY": KEY}


def _item(**over):
    base = dict(employee_id=2, leave_type="Annual Leave", start_date="2019-03-03", end_date="2019-03-05", decision="Approved",
                source_kind="email", source_ref="Re: leave", confidence="high")
    base.update(over)
    return tools.HistoryItem(**base)


# ---- configuration ---------------------------------------------------------------------------------------------

def test_config_loads_and_trims_the_base_url():
    assert load_config(ENV).base_url == "http://localhost:80"


@pytest.mark.parametrize("change,fragment", [
    ({"HRFLOW_BASE_URL": ""}, "HRFLOW_BASE_URL"),
    ({"HRFLOW_BASE_URL": "localhost"}, "http"),
    ({"HRFLOW_API_TOKEN": "abc"}, "hrf_"),
    ({"HRFLOW_MCP_KEY": "short"}, "at least"),
    ({"HRFLOW_MCP_KEY": TOKEN + "x" * 40, "HRFLOW_API_TOKEN": TOKEN + "x" * 40}, "different"),
    ({"MCP_PORT": "abc"}, "MCP_PORT"),
])
def test_config_rejects_bad_values(change, fragment):
    with pytest.raises(ConfigError) as exc:
        load_config({**ENV, **change})
    assert fragment in str(exc.value)


# ---- read tools ------------------------------------------------------------------------------------------------

def test_find_employee_returns_only_the_minimal_keys(client):
    rows = tools.find_employee(client, "sar")
    assert rows == [{"id": 2, "name": "Sara Ali", "email": "sara@x.test", "status": "Active", "job_role": "Nurse"}]
    for row in tools.find_employee(client, "sa"):
        assert set(row) == set(tools.EMPLOYEE_KEYS)
        assert "salary" not in json.dumps(row) and "SECRET-ID" not in json.dumps(row)


def test_find_employee_needs_two_characters_and_caps_results(client, fake):
    with pytest.raises(HRFlowError):
        tools.find_employee(client, "s")
    fake.routes[("GET", "/api/employees")] = (200, [{"id": i, "name": f"Sam {i}", "email": f"s{i}@x.test"} for i in range(30)])
    assert len(tools.find_employee(client, "sam")) == tools.MAX_FIND_RESULTS


def test_list_leave_filters_and_keeps_only_leave_keys(client, fake):
    fake.routes[("GET", "/api/vacations/history")] = (200, [
        {"id": 1, "employee_id": 2, "type": "Annual Leave", "start_date": "2019-03-03", "end_date": "2019-03-05", "days": 3,
         "status": "Approved", "submitted_by": "hr@x.test"},
        {"id": 2, "employee_id": 2, "type": "Sick Leave", "start_date": "2020-01-05", "end_date": "2020-01-05", "days": 1, "status": "Approved"},
    ])
    assert [r["id"] for r in tools.list_leave(client, 2)] == [1, 2]
    assert [r["id"] for r in tools.list_leave(client, 2, from_date="2020-01-01")] == [2]
    assert [r["id"] for r in tools.list_leave(client, 2, to_date="2019-12-31")] == [1]
    assert [r["id"] for r in tools.list_leave(client, 2, leave_type="Sick Leave")] == [2]
    assert set(tools.list_leave(client, 2)[0]) == set(tools.LEAVE_KEYS)
    assert fake.calls[-1].url.params["employee_id"] == "2"
    with pytest.raises(HRFlowError):
        tools.list_leave(client, 2, leave_type="Maternity")


def test_list_holidays_checks_the_year(client, fake):
    fake.routes[("GET", "/api/holidays")] = (200, [{"id": 1, "name": "Labour Day", "start_date": "2026-05-01", "end_date": "2026-05-01", "created_by": "x"}])
    assert tools.list_holidays(client, 2026) == [{"name": "Labour Day", "start_date": "2026-05-01", "end_date": "2026-05-01"}]
    with pytest.raises(HRFlowError):
        tools.list_holidays(client, 1999)


# ---- staging tools ---------------------------------------------------------------------------------------------

def test_every_request_carries_the_token_and_only_the_token(client, fake):
    tools.find_employee(client, "sara")
    assert fake.calls[-1].headers["authorization"] == f"Bearer {TOKEN}"


def test_validate_sends_typed_items(client, fake):
    fake.routes[("POST", "/api/history-import/validate")] = (200, {"ok": True, "items": [{"index": 0, "ok": True, "days": 3, "errors": [], "warnings": []}]})
    out = tools.validate_history_items(client, [_item()])
    assert out["ok"] is True and out["items"][0]["days"] == 3
    sent = json.loads(fake.calls[-1].content)["items"][0]
    assert sent["employee_id"] == 2 and sent["leave_type"] == "Annual Leave" and sent["confidence"] == "high"


def test_stage_sends_the_idempotency_key_and_returns_the_review_hint(client, fake):
    fake.routes[("POST", "/api/history-import/batches")] = (201, {"id": 7, "label": "2019", "counts": {"staged": 1, "accepted": 0, "rejected": 0}, "items": [
        {"id": 11, "employee_id": 2, "employee_name": "Sara Ali", "leave_type": "Annual Leave", "start_date": "2019-03-03",
         "end_date": "2019-03-05", "days": 3, "decision": "Approved", "status": "staged", "confidence": "high", "warnings": [],
         "blocked_by": [], "evidence_excerpt": "private text", "source_ref": "x"}]})
    out = tools.stage_history_items(client, "2019", [_item()], "batch-2019-001")
    assert fake.calls[-1].headers["idempotency-key"] == "batch-2019-001"
    assert out["staged"] is True and out["batch_id"] == 7 and "person must now accept" in out["next_step"]
    assert set(out["items"][0]) == set(tools.ITEM_KEYS)


def test_stage_requires_a_real_idempotency_key(client):
    with pytest.raises(HRFlowError):
        tools.stage_history_items(client, "x", [_item()], "short")


def test_invalid_items_come_back_as_a_report_not_an_error(client, fake):
    report = [{"index": 0, "ok": False, "days": 0, "warnings": [], "errors": ["Employee not found."]}]
    fake.routes[("POST", "/api/history-import/batches")] = (422, {"detail": {"message": "Some items are not valid.", "report": report}})
    out = tools.stage_history_items(client, "x", [_item()], "batch-2019-001")
    assert out == {"staged": False, "report": report}


def test_item_model_rejects_unknown_types_and_oversized_text():
    with pytest.raises(Exception):
        _item(leave_type="Maternity")
    with pytest.raises(Exception):
        _item(evidence_excerpt="x" * 501)


# ---- failures never leak the token ----------------------------------------------------------------------------

@pytest.mark.parametrize("status,fragment", [(401, "expired or revoked"), (403, "not allowed"), (500, "error (500)")])
def test_errors_are_plain_and_never_contain_the_token(client, fake, status, fragment):
    fake.routes[("GET", "/api/employees")] = (status, {"detail": "boom"} if status == 500 else {})
    with pytest.raises(HRFlowError) as exc:
        tools.find_employee(client, "sara")
    assert fragment in str(exc.value) or "boom" in str(exc.value)
    assert TOKEN not in str(exc.value)


def test_unreachable_hrflow_is_reported_without_internals():
    from hrflow_client import HRFlowClient

    def boom(request):
        raise httpx.ConnectError("connection refused to http://hrflow.test with token " + TOKEN)

    broken = HRFlowClient("http://hrflow.test", TOKEN, transport=httpx.MockTransport(boom))
    with pytest.raises(HRFlowError) as exc:
        tools.find_employee(broken, "sara")
    assert str(exc.value) == "HRFlow could not be reached. Is it running?"
