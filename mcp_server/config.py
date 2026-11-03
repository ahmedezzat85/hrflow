"""Settings of the HRFlow MCP server, read from environment variables only (see .env.example)."""
import os
from dataclasses import dataclass
from typing import Mapping, Optional

MIN_KEY_LENGTH = 32


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class Config:
    base_url: str          # HRFlow as seen from this PC, e.g. http://localhost:80 (never the public hostname)
    api_token: str         # personal access token of one HRFlow user (be/scripts/manage_api_tokens.py)
    mcp_key: str           # the key claude.ai presents; independent of the token
    port: int
    public_host: Optional[str]   # hostname of the tunnel, allowed in the Host check


def load_config(env: Mapping[str, str] = os.environ) -> Config:
    def need(name: str) -> str:
        value = (env.get(name) or "").strip()
        if not value:
            raise ConfigError(f"{name} is required (see mcp_server/.env.example).")
        return value

    base_url = need("HRFLOW_BASE_URL").rstrip("/")
    if not base_url.startswith(("http://", "https://")):
        raise ConfigError("HRFLOW_BASE_URL must start with http:// or https://.")
    token = need("HRFLOW_API_TOKEN")
    if not token.startswith("hrf_"):
        raise ConfigError("HRFLOW_API_TOKEN must be a token made by scripts/manage_api_tokens.py (starts with hrf_).")
    key = need("HRFLOW_MCP_KEY")
    if len(key) < MIN_KEY_LENGTH:
        raise ConfigError(f"HRFLOW_MCP_KEY must be at least {MIN_KEY_LENGTH} characters of random text.")
    if key == token:
        raise ConfigError("HRFLOW_MCP_KEY and HRFLOW_API_TOKEN must be different secrets.")
    try:
        port = int(env.get("MCP_PORT") or 8765)
    except ValueError:
        raise ConfigError("MCP_PORT must be a number.")
    return Config(base_url=base_url, api_token=token, mcp_key=key, port=port,
                  public_host=(env.get("MCP_PUBLIC_HOST") or "").strip() or None)
