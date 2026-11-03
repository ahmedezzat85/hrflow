"""A thin client for the HRFlow REST API. The MCP server only ever talks to HRFlow through this class, with a personal
access token, so HRFlow's own permission checks and audit apply to every call. The token never leaves this module."""
from typing import Any, Dict, Optional

import httpx


class HRFlowError(Exception):
    """A failure the tool reports to Claude. The message never contains the token."""

    def __init__(self, message: str, status: Optional[int] = None, detail: Any = None):
        super().__init__(message)
        self.status = status
        self.detail = detail


class HRFlowClient:
    def __init__(self, base_url: str, api_token: str, transport: Optional[httpx.BaseTransport] = None, timeout: float = 15.0):
        self._http = httpx.Client(base_url=base_url, timeout=timeout, transport=transport,
                                  headers={"Authorization": f"Bearer {api_token}", "Accept": "application/json"})

    def request(self, method: str, path: str, *, params: Optional[Dict[str, Any]] = None, json: Any = None,
                headers: Optional[Dict[str, str]] = None) -> Any:
        try:
            response = self._http.request(method, path, params=params, json=json, headers=headers)
        except httpx.HTTPError:
            raise HRFlowError("HRFlow could not be reached. Is it running?")
        try:
            body = response.json()
        except ValueError:
            body = None
        if response.status_code >= 400:
            detail = body.get("detail") if isinstance(body, dict) else None
            if response.status_code == 401:
                raise HRFlowError("HRFlow refused the API token (expired or revoked). Make a new one on the server.", 401)
            if response.status_code == 403:
                raise HRFlowError("HRFlow says this token is not allowed to do that.", 403)
            text = detail if isinstance(detail, str) else (detail or {}).get("message") if isinstance(detail, dict) else None
            raise HRFlowError(text or f"HRFlow returned an error ({response.status_code}).", response.status_code, detail)
        return body

    def get(self, path: str, **kwargs) -> Any:
        return self.request("GET", path, **kwargs)

    def post(self, path: str, **kwargs) -> Any:
        return self.request("POST", path, **kwargs)

    def check_ready(self) -> None:
        """Startup check: HRFlow answers and accepts the token. Raises HRFlowError otherwise."""
        self.get("/api/health")
        self.get("/api/auth/me")
