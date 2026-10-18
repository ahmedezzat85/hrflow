# Shared helpers for HRFlow production scripts. Dot-source this file.
$ErrorActionPreference = 'Continue'  # native tools write progress to stderr; exit codes are checked explicitly
$script:RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$script:ComposeFile = Join-Path $script:RepoRoot 'deploy\prod\docker-compose.yml'
$script:EnvFile = if ($env:HRFLOW_ENV_FILE) { $env:HRFLOW_ENV_FILE } else { 'D:\services\hrflow-prod\.env' }

function Read-EnvFile([string]$Path) {
    if (-not (Test-Path $Path)) { throw "Env file not found: $Path" }
    $h = @{}
    Get-Content $Path | ForEach-Object {
        if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { $h[$Matches[1]] = $Matches[2].Trim() }
    }
    return $h
}
$script:Cfg = Read-EnvFile $script:EnvFile

function Invoke-Compose { & docker compose --env-file $script:EnvFile -f $script:ComposeFile @args; if ($LASTEXITCODE) { throw "docker compose failed ($LASTEXITCODE)" } }
function Get-ContainerId([string]$Service) { $id = (& docker compose --env-file $script:EnvFile -f $script:ComposeFile ps -q $Service); if (-not $id) { throw "Service '$Service' is not running" }; return $id }
