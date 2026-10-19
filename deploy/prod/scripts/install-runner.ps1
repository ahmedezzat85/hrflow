<#
.SYNOPSIS  Installs the GitHub Actions self-hosted runner that deploys HRFlow on this PC (one time).
.DESCRIPTION
  Registers the runner with the label hrflow-prod and starts it at every Windows sign-in (per-user startup entry, runs as
  your own user, so it can reach Docker Desktop). Docker Desktop must also start at sign-in.
  The registration token is short lived; create it with:
      gh api -X POST repos/<owner>/<repo>/actions/runners/registration-token --jq .token
.EXAMPLE   .\install-runner.ps1 -RepoUrl https://github.com/ahmedezzat85/hrflow -Token <token>
#>
param(
    [Parameter(Mandatory)][string]$RepoUrl,
    [Parameter(Mandatory)][string]$Token,
    [string]$Dir = 'D:\services\actions-runner',
    [string]$Name = 'hrflow-prod-pc',
    [string]$RunnerZip   # optional: path of an already downloaded actions-runner-win-x64-*.zip
)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Dir | Out-Null
if (-not (Test-Path (Join-Path $Dir 'config.cmd'))) {
    if (-not $RunnerZip) { throw 'Pass -RunnerZip (download actions-runner-win-x64 from https://github.com/actions/runner/releases and check its SHA-256).' }
    Expand-Archive -Path $RunnerZip -DestinationPath $Dir -Force
}
Push-Location $Dir
try {
    & .\config.cmd --url $RepoUrl --token $Token --name $Name --labels hrflow-prod --work _work --unattended --replace
    if ($LASTEXITCODE) { throw 'runner configuration failed' }
} finally { Pop-Location }
$run = Join-Path $Dir 'run.cmd'
# Per-user startup entry (no administrator rights needed): runs as you, so it can reach Docker Desktop
New-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'HRFlowGitHubRunner' -Value "`"$run`"" -PropertyType String -Force | Out-Null
Start-Process -FilePath $run -WorkingDirectory $Dir -WindowStyle Hidden
Write-Host "Runner '$Name' installed in $Dir and started. It restarts at every sign-in."
