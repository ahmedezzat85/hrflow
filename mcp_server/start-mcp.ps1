# Starts the HRFlow MCP server in this window. Ctrl+C (or stop-mcp.ps1) switches the endpoint off.
# Needs a Python 3.10+ environment with mcp_server\requirements.txt installed; pass it with -Python if it is not on PATH.
param([string]$Python = "python")
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $here ".mcp.pid"
if (-not (Test-Path (Join-Path $here ".env"))) {
  Write-Host "mcp_server\.env is missing. Copy .env.example to .env and fill it in." -ForegroundColor Red
  exit 1
}
Set-Content -Path $pidFile -Value $PID
try {
  & $Python (Join-Path $here "server.py")
} finally {
  Remove-Item $pidFile -ErrorAction SilentlyContinue
}
