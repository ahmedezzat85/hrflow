<#
.SYNOPSIS  Turns the HRFlow GitHub Actions runner into a Windows service that starts at boot (one time, as Administrator).
.DESCRIPTION
  Today the runner starts through a per-user sign-in entry (see install-runner.ps1), so it only exists while someone is
  signed in. As a Windows service it starts when Windows boots, runs without a visible window, survives sign-out, and is
  restarted by Windows if it crashes.

  What the script does:
    1. Refuses to run without Administrator rights, or while a deploy job is running on this runner.
    2. Stops the current runner and removes its sign-in startup entry (so two runners never listen at once).
    3. Removes the local runner configuration and registers the same runner (same name, label hrflow-prod) again as a
       service that runs as YOUR Windows account (it needs to reach Docker). You are asked for that account's password;
       it is passed to the runner's own configuration command and is not stored by this script.
    4. Sets the service to start automatically (delayed, after the network and other services) and to restart itself
       after a failure, then starts it.

  Docker: the deploy needs Docker, and Docker Desktop only runs inside a signed-in session. The service starts at boot,
  but a deploy that arrives before Docker Desktop is running stops safely at the backup step (nothing is changed) and can
  simply be re-run. Keep Docker Desktop set to start at sign-in.

  The registration token is short lived (about an hour). Create it with:
      gh api -X POST repos/ahmedezzat85/hrflow/actions/runners/registration-token --jq .token
  If anything fails after step 2 the runner is unregistered locally; run this script again with a new token.

.PARAMETER DryRun  Only print what would be done; change nothing (no Administrator rights needed).
.NOTES
  Windows blocks PowerShell scripts by default ("running scripts is disabled on this system"). Start this script through
  powershell.exe with a bypass for this one run; no setting on the PC is changed:
      powershell -NoProfile -ExecutionPolicy Bypass -File .\install-runner-service.ps1 -Token <token> -DryRun
.EXAMPLE   powershell -NoProfile -ExecutionPolicy Bypass -File .\install-runner-service.ps1 -Token <token> -DryRun
.EXAMPLE   powershell -NoProfile -ExecutionPolicy Bypass -File .\install-runner-service.ps1 -Token <token>
#>
param(
    [Parameter(Mandatory)][string]$Token,
    [string]$RepoUrl = 'https://github.com/ahmedezzat85/hrflow',
    [string]$Dir = 'D:\services\actions-runner',
    [string]$Name = 'hrflow-prod-pc',
    [string]$Account = "$env:USERDOMAIN\$env:USERNAME",
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

function Step([string]$Text) { Write-Host "`n== $Text" -ForegroundColor Cyan }
function Run([string]$What, [scriptblock]$Action) {
    if ($DryRun) { Write-Host "[dry run] $What" } else { Write-Host $What; & $Action }
}

$config = Join-Path $Dir 'config.cmd'
if (-not (Test-Path $config)) { throw "No runner found in $Dir (config.cmd is missing). Install it first with install-runner.ps1." }

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin -and -not $DryRun) { throw 'Run this script from an elevated PowerShell (right-click > Run as administrator).' }

Step 'Checks'
if (Get-Process -Name 'Runner.Worker' -ErrorAction SilentlyContinue) {
    throw 'A job is running on this runner right now (Runner.Worker). Wait for it to finish, then run this script again.'
}
$existing = Get-Service -Name 'actions.runner.*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*$Name*" }
if ($existing) { throw "A runner service already exists: $($existing.Name). Nothing to do." }
# Docker Desktop creates a local 'docker-users' group on some installs; when it exists the account should be in it.
if (Get-LocalGroup -Name 'docker-users' -ErrorAction SilentlyContinue) {
    $shortName = ($Account -split '\\')[-1]
    $members = @(Get-LocalGroupMember -Group 'docker-users' -ErrorAction SilentlyContinue | ForEach-Object { ($_.Name -split '\\')[-1] })
    if ($members -notcontains $shortName) {
        Write-Warning "$Account is not in the local 'docker-users' group. Docker may refuse the service's commands; add the account to that group (and sign in again) if deploys fail with a Docker permission error."
    }
}
Write-Host "Runner folder: $Dir`nRunner name:   $Name`nService runs as: $Account"

$plainPassword = ''
if (-not $DryRun) {
    $secure = Read-Host -Prompt "Windows password of $Account (needed for the service to run as that account)" -AsSecureString
    $plainPassword = [System.Net.NetworkCredential]::new('', $secure).Password
    if (-not $plainPassword) { throw 'A password is required to run the service as your account.' }
}

Step 'Stop the sign-in runner'
Run 'Stopping Runner.Listener' { Get-Process -Name 'Runner.Listener' -ErrorAction SilentlyContinue | Stop-Process -Force }
Run 'Removing the HRFlowGitHubRunner sign-in entry' {
    Remove-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'HRFlowGitHubRunner' -ErrorAction SilentlyContinue
}

Step 'Register the runner as a service'
Push-Location $Dir
try {
    Run 'config.cmd remove --local' { & $config remove --local; if ($LASTEXITCODE) { throw 'config.cmd remove --local failed' } }
    Run "config.cmd --url $RepoUrl --name $Name --labels hrflow-prod --runasservice --windowslogonaccount $Account --replace" {
        & $config --unattended --url $RepoUrl --token $Token --name $Name --labels hrflow-prod --work _work --replace `
            --runasservice --windowslogonaccount $Account --windowslogonpassword $plainPassword
        if ($LASTEXITCODE) { throw 'runner service registration failed (check the token is new, and the account password is right)' }
    }
} finally { Pop-Location; $plainPassword = $null }

Step 'Start at boot, restart on failure'
if ($DryRun) {
    Write-Host '[dry run] sc.exe config <service> start= delayed-auto'
    Write-Host '[dry run] sc.exe failure <service> reset= 86400 actions= restart/60000/restart/60000/restart/60000'
    Write-Host '[dry run] Start-Service <service>'
} else {
    $svc = Get-Service -Name 'actions.runner.*' | Where-Object { $_.DisplayName -like "*$Name*" } | Select-Object -First 1
    if (-not $svc) { throw 'The runner service was not created. See the config.cmd output above.' }
    & sc.exe config $svc.Name start= delayed-auto | Out-Null
    & sc.exe failure $svc.Name reset= 86400 actions= restart/60000/restart/60000/restart/60000 | Out-Null
    if ($svc.Status -ne 'Running') { Start-Service -Name $svc.Name }
    $svc.Refresh()
    Write-Host "`nService '$($svc.Name)' is $($svc.Status), start type: automatic (delayed)."
    Write-Host 'Check GitHub > Settings > Actions > Runners: hrflow-prod-pc should show Idle within a minute.'
}
