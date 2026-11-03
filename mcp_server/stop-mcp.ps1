# Switches the MCP endpoint off by stopping the server started with start-mcp.ps1.
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$pidFile = Join-Path $here ".mcp.pid"
if (-not (Test-Path $pidFile)) { Write-Host "No MCP server is recorded as running."; exit 0 }
$serverPid = [int](Get-Content $pidFile)
# The recorded PID is the PowerShell window running the script; stop it and the python process under it.
Get-CimInstance Win32_Process -Filter "ParentProcessId=$serverPid" | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Stop-Process -Id $serverPid -Force -ErrorAction SilentlyContinue
Remove-Item $pidFile -ErrorAction SilentlyContinue
Write-Host "HRFlow MCP server stopped. The endpoint is off."
