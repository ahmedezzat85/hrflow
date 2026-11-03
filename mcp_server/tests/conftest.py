import os
import sys

import httpx
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from config import Config  # noqa: E402
from hrflow_client import HRFlowClient  # noqa: E402

TOKEN = "hrf_test-token-that-must-never-appear-in-output"
KEY = "k" * 40


class FakeHRFlow:
    """Records what the MCP server sends and answers like HRFlow's API. Replace `routes` entries per test."""

    def __init__(self):
        self.calls = []
        self.routes = {
            ("GET", "/api/health"): (200, {"status": "ok"}),
            ("GET", "/api/auth/me"): (200, {"portal": "admin"}),
            ("GET", "/api/employees"): (200, [
                {"id": 2, "name": "Sara Ali", "email": "sara@x.test", "status": "Active", "job_role": "Nurse",
                 "salary": 9999, "external_salary_usd": 5, "id_number": "SECRET-ID", "address_line_1": "1 Road",
                 "vac_total": 21, "dept": "Care"},
                {"id": 3, "name": "Saeed Omar", "email": "saeed@x.test", "status": "Archived", "job_role": "Tech", "salary": 1},
            ]),
        }

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.calls.append(request)
        route = self.routes.get((request.method, request.url.path))
        if callable(route):
            return route(request)
        if route is None:
            return httpx.Response(404, json={"detail": "Not found"})
        status, body = route
        return httpx.Response(status, json=body)


@pytest.fixture
def fake():
    return FakeHRFlow()


@pytest.fixture
def client(fake):
    return HRFlowClient("http://hrflow.test", TOKEN, transport=httpx.MockTransport(fake.handler))


@pytest.fixture
def config():
    return Config(base_url="http://hrflow.test", api_token=TOKEN, mcp_key=KEY, port=8765, public_host="mcp.example.test")
