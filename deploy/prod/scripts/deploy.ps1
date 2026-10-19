<#
.SYNOPSIS  Deploy a release version to the local production stack, with backup, health check and rollback.
.DESCRIPTION
  1. Records the version that is running now (for rollback)
  2. Takes an encrypted backup (aborts the deploy if the backup fails)
  3. Builds the new images while the old ones keep running
  4. Starts the new version (the app applies database migrations on start)
  5. Waits for /api/health; if it does not become healthy, switches back to the previous version
  On success the deployed version is written to HRFLOW_VERSION in the production env file.
.EXAMPLE   .\deploy.ps1 -Version v1.2.0
#>
param(
    [Parameter(Mandatory)][ValidatePattern('^v\d+\.\d+\.\d+([-.][0-9A-Za-z.]+)?$')][string]$Version,
    [string]$HealthUrl = 'http://localhost/api/health',
    [int]$HealthTimeoutSec = 180
)
. "$PSScriptRoot\_common.ps1"
$ErrorActionPreference = 'Continue'

function Test-Healthy {
    try { return ((Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 5).StatusCode -eq 200) } catch { return $false }
}
function Wait-Healthy([int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) { if (Test-Healthy) { return $true }; Start-Sleep -Seconds 5 }
    return $false
}

# 1. What is running now?
$prev = $null
$appId = (& docker compose --env-file $script:EnvFile -f $script:ComposeFile ps -q app 2>$null)
if ($appId) {
    $img = (& docker inspect --format '{{.Config.Image}}' $appId 2>$null)
    if ($img -match ':(.+)$') { $prev = $Matches[1] }
}
Write-Host "Deploying $Version (currently running: $(if ($prev) { $prev } else { 'nothing' }))"

# 2. Backup first (uses the image that is running now)
if ($prev) { $env:HRFLOW_VERSION = $prev }
# Bring the database container in line with the current compose file before backing up (data volume is untouched)
& docker compose --env-file $script:EnvFile -f $script:ComposeFile up -d postgres
if ($LASTEXITCODE -ne 0) { throw 'Could not start the database container; deploy aborted' }
$pgDeadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $pgDeadline) { $st = (& docker inspect --format '{{.State.Health.Status}}' (& docker compose --env-file $script:EnvFile -f $script:ComposeFile ps -q postgres) 2>$null); if ($st -eq 'healthy') { break }; Start-Sleep -Seconds 3 }
try { & "$PSScriptRoot\backup.ps1" } catch { throw "Backup failed, deploy aborted: $($_.Exception.Message)" }
if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { throw "Backup failed (exit $LASTEXITCODE), deploy aborted" }

# 3. Build the new images (retry: base images and packages come from the internet)
$env:HRFLOW_VERSION = $Version
$built = $false
foreach ($i in 1..3) {
    & docker compose --env-file $script:EnvFile -f $script:ComposeFile build
    if ($LASTEXITCODE -eq 0) { $built = $true; break }
    Write-Warning "Build attempt $i failed; retrying"; Start-Sleep -Seconds 15
}
if (-not $built) { throw "Image build failed; the running version ($prev) was not touched" }

# 4. Start the new version
Invoke-Compose up -d

# 5. Health check, rollback on failure
if (Wait-Healthy $HealthTimeoutSec) {
    $content = Get-Content $script:EnvFile -Raw
    if ($content -match '(?m)^HRFLOW_VERSION=') { $content = [regex]::Replace($content, '(?m)^HRFLOW_VERSION=.*$', "HRFLOW_VERSION=$Version") }
    else { $content = $content.TrimEnd() + "`nHRFLOW_VERSION=$Version`n" }
    [System.IO.File]::WriteAllText($script:EnvFile, $content)
    Write-Host "Deployed $Version and healthy."
    exit 0
}

Write-Warning "$Version did not become healthy within $HealthTimeoutSec s"
& docker compose --env-file $script:EnvFile -f $script:ComposeFile logs --tail 40 app
if ($prev) {
    Write-Warning "Rolling back to $prev"
    $env:HRFLOW_VERSION = $prev
    Invoke-Compose up -d
    if (Wait-Healthy 120) { Write-Warning "Rolled back to $prev and healthy. The failed release was $Version." }
    else { Write-Warning "Rollback did not become healthy either. Restore the backup taken at the start of this deploy: scripts\restore.ps1 -File <backup>" }
}
exit 1
