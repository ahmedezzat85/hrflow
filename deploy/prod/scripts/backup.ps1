<#
.SYNOPSIS  Encrypted backup of the HRFlow production database + uploaded documents.
.DESCRIPTION
  1. pg_dump (custom format) of the application database
  2. tar.gz of the documents volume
  3. AES-256 (PBKDF2) encryption with BACKUP_PASSPHRASE, done inside a throwaway container
  4. Copy to BACKUP_LOCAL_DIR and BACKUP_DRIVE_DIR, prune to BACKUP_KEEP newest files
  Plaintext never leaves the staging folder, which is deleted at the end.
#>
. "$PSScriptRoot\_common.ps1"
$c = $script:Cfg
foreach ($k in 'BACKUP_PASSPHRASE','BACKUP_LOCAL_DIR','HRFLOW_DATA_DIR') { if (-not $c[$k]) { throw "$k must be set in the env file" } }
$keep = if ($c['BACKUP_KEEP']) { [int]$c['BACKUP_KEEP'] } else { 30 }
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$name = "hrflow-$ts.tar.gz.enc"
$stage = Join-Path $env:TEMP "hrflow-backup-$ts"
New-Item -ItemType Directory -Force $stage, $c['BACKUP_LOCAL_DIR'] | Out-Null
try {
    $pg = Get-ContainerId 'postgres'
    & docker exec $pg sh -c 'PGPASSWORD="$APP_DB_PASSWORD" pg_dump -U "$APP_DB_USER" -d "$APP_DB_NAME" -Fc -f /tmp/db.dump'
    if ($LASTEXITCODE) { throw 'pg_dump failed' }
    & docker cp "${pg}:/tmp/db.dump" (Join-Path $stage 'db.dump'); if ($LASTEXITCODE) { throw 'docker cp failed' }
    & docker exec $pg rm -f /tmp/db.dump | Out-Null

    $env:BACKUP_PASSPHRASE = $c['BACKUP_PASSPHRASE']
    & docker run --rm -e BACKUP_PASSPHRASE `
        -v "${stage}:/stage" -v "$($c['HRFLOW_DATA_DIR'])/documents:/documents:ro" -v "$($c['BACKUP_LOCAL_DIR']):/out" `
        --entrypoint sh "hrflow-app:$(if ($env:HRFLOW_VERSION) { $env:HRFLOW_VERSION } elseif ($c['HRFLOW_VERSION']) { $c['HRFLOW_VERSION'] } else { 'latest' })" -c `
        "set -e; tar -czf - -C /stage db.dump -C / documents | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass env:BACKUP_PASSPHRASE -out /out/$name"
    if ($LASTEXITCODE) { throw 'encryption/archive step failed' }
    $env:BACKUP_PASSPHRASE = $null

    $local = Join-Path $c['BACKUP_LOCAL_DIR'] $name
    if ((Get-Item $local).Length -lt 1024) { throw 'backup file suspiciously small' }
    (Get-FileHash $local -Algorithm SHA256).Hash | Set-Content "$local.sha256"
    $targets = @($c['BACKUP_LOCAL_DIR'])
    if ($c['BACKUP_DRIVE_DIR']) {
        New-Item -ItemType Directory -Force $c['BACKUP_DRIVE_DIR'] | Out-Null
        Copy-Item $local, "$local.sha256" $c['BACKUP_DRIVE_DIR']
        $targets += $c['BACKUP_DRIVE_DIR']
    } else { Write-Warning 'BACKUP_DRIVE_DIR not set: backup exists only on this PC.' }
    foreach ($d in $targets) {
        Get-ChildItem $d -Filter 'hrflow-*.tar.gz.enc' | Sort-Object Name -Descending | Select-Object -Skip $keep | ForEach-Object {
            Remove-Item $_.FullName, "$($_.FullName).sha256" -ErrorAction SilentlyContinue
        }
    }
    Write-Host "Backup OK: $name ($([math]::Round((Get-Item $local).Length/1MB,2)) MB)"
} finally {
    $env:BACKUP_PASSPHRASE = $null
    Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
}
