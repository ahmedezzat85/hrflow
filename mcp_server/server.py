"""Starts the HRFlow MCP server. Stopping this process (Ctrl+C, or stop-mcp.ps1) switches the endpoint off.

    python server.py            # reads mcp_server/.env, then the environment
"""
import logging
import os
import sys

import uvicorn

from app import build_app
from config import Config, ConfigError, load_config
from hrflow_client import HRFlowClient, HRFlowError


def _load_dotenv(path: str) -> None:
    if not os.path.isfile(path):
        return
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                name, value = line.split("=", 1)
                os.environ.setdefault(name.strip(), value.strip().strip('"').strip("'"))


def main() -> int:
    _load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        config: Config = load_config()
    except ConfigError as exc:
        print(f"Configuration error: {exc}", file=sys.stderr)
        return 2

    client = HRFlowClient(config.base_url, config.api_token)
    try:
        client.check_ready()
    except HRFlowError as exc:
        print(f"HRFlow is not ready at {config.base_url}: {exc}", file=sys.stderr)
        return 3

    print(f"HRFlow MCP server on 127.0.0.1:{config.port}. Point the tunnel at it. Ctrl+C switches it off.", file=sys.stderr)
    # access_log is off: uvicorn would print the URL, which can contain the key.
    uvicorn.run(build_app(config, client), host="127.0.0.1", port=config.port, access_log=False, log_level="warning")
    return 0


if __name__ == "__main__":
    sys.exit(main())
