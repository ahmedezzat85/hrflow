<#
.SYNOPSIS  Restore an encrypted HRFlow backup into the running production stack.
.EXAMPLE   .\restore.ps1 -File D:\services\hrflow-prod\backups\hrflow-20261016-020000.tar.gz.enc
.NOTES     DESTRUCTIVE: replaces the current database contents and documents. Stop users first.
#>
param([Parameter(Mandatory)][string]$File, [switch]$Force)
. "$PSScriptRoot\_common.ps1"
$c = $script:Cfg
if (-not (Test-Path $File)) { throw "Backup not found: $File" }
if (-not $c['BACKUP_PASSPHRASE']) { throw 'BACKUP_PASSPHRASE must be set in the env file' }
if (-not $Force) { if ((Read-Host "This REPLACES the production database and documents. Type RESTORE to continue") -ne 'RESTORE') { throw 'Aborted' } }
$stage = Join-Path $env:TEMP "hrflow-restore-$(Get-Date -Format yyyyMMddHHmmss)"
New-Item -ItemType Directory -Force $stage | Out-Null
try {
    $src = Split-Path $File -Parent; $leaf = Split-Path $File -Leaf
    $env:BACKUP_PASSPHRASE = $c['BACKUP_PASSPHRASE']
    & docker run --rm -e BACKUP_PASSPHRASE -v "${src}:/in:ro" -v "${stage}:/stage" `
        --entrypoint sh "hrflow-app:$(if ($c['HRFLOW_VERSION']) { $c['HRFLOW_VERSION'] } else { 'latest' })" -c `
        "set -e; openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass env:BACKUP_PASSPHRASE -in /in/$leaf | tar -xzf - -C /stage"
    if ($LASTEXITCODE) { throw 'decryption failed (wrong passphrase or corrupted file)' }
    $env:BACKUP_PASSPHRASE = $null

    Invoke-Compose stop web app
    $pg = Get-ContainerId 'postgres'
    & docker cp (Join-Path $stage 'db.dump') "${pg}:/tmp/db.dump"; if ($LASTEXITCODE) { throw 'docker cp failed' }
    & docker exec $pg sh -c 'PGPASSWORD="$APP_DB_PASSWORD" pg_restore -U "$APP_DB_USER" -d "$APP_DB_NAME" --clean --if-exists --no-owner /tmp/db.dump; rm -f /tmp/db.dump'
    if ($LASTEXITCODE) { Write-Warning "pg_restore reported issues (exit $LASTEXITCODE); review output above." }

    $docs = Join-Path $c['HRFLOW_DATA_DIR'] 'documents'
    if (Test-Path (Join-Path $stage 'documents')) {
        Get-ChildItem $docs -Force | Remove-Item -Recurse -Force
        Copy-Item (Join-Path $stage 'documents\*') $docs -Recurse -Force
    }
    Invoke-Compose up -d
    Write-Host 'Restore complete.'
} finally {
    $env:BACKUP_PASSPHRASE = $null
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}
