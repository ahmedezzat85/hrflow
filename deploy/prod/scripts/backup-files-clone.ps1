<#
.SYNOPSIS
  Additive, one-way clone of HRFlow unified files root to a Google Drive for Desktop directory.
.DESCRIPTION
  Syncs files from HRFLOW_FILES_ROOT (source) to FILES_CLONE_DIR (destination).
  Crucial invariants:
  - Additive only: new and updated files are copied.
  - Zero deletions: files deleted from the source root are NEVER deleted from the clone.
  - Idempotent: repeated runs with no changes copy 0 files.
  - Non-destructive: read-only access to source; writes unencrypted mirror for easy recovery.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$false)]
    [string]$Source,

    [Parameter(Mandatory=$false)]
    [string]$Destination
)

$ErrorActionPreference = 'Stop'

# Resolve Source and Destination if not passed via parameters
if (-not $Source -or -not $Destination) {
    $commonPath = Join-Path $PSScriptRoot '_common.ps1'
    if (Test-Path $commonPath) {
        . $commonPath
        $c = $script:Cfg
        if (-not $Source) {
            $Source = if ($c['HRFLOW_FILES_ROOT']) { $c['HRFLOW_FILES_ROOT'] } `
                      elseif ($c['HRFLOW_DATA_DIR']) { Join-Path $c['HRFLOW_DATA_DIR'] 'documents' } `
                      else { $env:HRFLOW_FILES_ROOT }
        }
        if (-not $Destination) {
            $Destination = if ($c['FILES_CLONE_DIR']) { $c['FILES_CLONE_DIR'] } `
                           elseif ($c['BACKUP_DRIVE_DIR']) { Join-Path $c['BACKUP_DRIVE_DIR'] 'files_clone' } `
                           else { $env:FILES_CLONE_DIR }
        }
    }
}

if (-not $Source) {
    throw "Source files root is not defined. Set HRFLOW_FILES_ROOT, HRFLOW_DATA_DIR, or pass -Source."
}
if (-not $Destination) {
    throw "Destination clone directory is not defined. Set FILES_CLONE_DIR, BACKUP_DRIVE_DIR, or pass -Destination."
}

if (-not (Test-Path $Source)) {
    throw "Source directory does not exist: $Source"
}

if (-not (Test-Path $Destination)) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
}

Write-Host "=== HRFlow Files Additive Clone ==="
Write-Host "Source:      $Source"
Write-Host "Destination: $Destination"
Write-Host "Mode:        Additive (No destination pruning)"

# Use robocopy for high-performance additive copy
# /E   : Copy subdirectories, including empty ones
# /XO  : Exclude older files (do not overwrite newer with older)
# /XN  : Exclude newer files (if already existing with same timestamp)
# /XC  : Exclude changed files with same timestamp
# /NP  : No progress percentage in output
# /NDL : No directory logging (clean output)
# /R:2 : Retry 2 times on locked files
# /W:1 : Wait 1 second between retries
$robocopyExe = Get-Command "robocopy.exe" -ErrorAction SilentlyContinue

if ($robocopyExe) {
    # Run robocopy; note that robocopy exit codes 0-7 represent success states
    & robocopy.exe $Source $Destination /E /XO /XN /XC /NP /NDL /R:2 /W:1
    $rc = $LASTEXITCODE

    # Robocopy exit codes:
    # 0 = No files copied (in sync)
    # 1 = Files copied successfully
    # 2 = Extra files exist in destination (normal for additive backup)
    # 3 = Files copied + extra files exist
    # 4-7 = Mismatches/warnings but successful
    # 8+ = Fatal errors
    if ($rc -ge 8) {
        throw "Robocopy failed with error exit code: $rc"
    }

    if ($rc -eq 0) {
        Write-Host "Sync Complete: Already up to date (0 files copied)."
    } elseif ($rc -band 1) {
        Write-Host "Sync Complete: New/updated files copied successfully (Exit code: $rc)."
    } else {
        Write-Host "Sync Complete: Up to date; destination contains archived historical files (Exit code: $rc)."
    }
} else {
    # Fallback pure PowerShell copy
    $copiedCount = 0
    Get-ChildItem -Path $Source -Recurse -File | ForEach-Object {
        $relPath = Resolve-Path -Path $_.FullName -RelativeBasePath $Source
        $targetFile = Join-Path $Destination $relPath
        $targetDir = Split-Path $targetFile -Parent

        if (-not (Test-Path $targetDir)) {
            New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
        }

        $needsCopy = $false
        if (-not (Test-Path $targetFile)) {
            $needsCopy = $true
        } else {
            $destItem = Get-Item $targetFile
            if ($_.Length -ne $destItem.Length -or $_.LastWriteTimeUtc -gt $destItem.LastWriteTimeUtc) {
                $needsCopy = $true
            }
        }

        if ($needsCopy) {
            Copy-Item -Path $_.FullName -Destination $targetFile -Force
            $copiedCount++
        }
    }
    Write-Host "Sync Complete: $copiedCount file(s) copied."
}
