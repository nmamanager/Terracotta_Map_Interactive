#   Projector PC:     .\install.ps1 -Role projector -Monitor 1
#   Touch screen PC:  .\install.ps1 -Role touch -Screen 2 -Hub 192.168.10.50

param(
    [Parameter(Mandatory)][ValidateSet('touch', 'projector')][string]$Role,
    [ValidateSet(1, 2, 3)][int]$Screen = 1,
    [string]$Hub = 'localhost',
    [int]$Monitor = 0,
    [int]$IdleSeconds = 90,
    [switch]$SkipLockdown
)

$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this from an elevated (Administrator) PowerShell.' }
if ($Role -eq 'touch' -and $Hub -eq 'localhost') { Write-Warning 'Touch PC with -Hub localhost: lines will only work if the hub runs on this PC (single-PC testing).' }

$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe" | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Install Google Chrome first.' }
if ($Role -eq 'projector' -and -not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js LTS first (winget install OpenJS.NodeJS.LTS), then open a new PowerShell.' }

$station = [ordered]@{ role = $Role; screen = $Screen; hub = $Hub; monitor = $Monitor; idleSeconds = $IdleSeconds }
$station | ConvertTo-Json | Set-Content -Path (Join-Path $PSScriptRoot 'station.json') -Encoding UTF8
Write-Output "Wrote station.json: $($station | ConvertTo-Json -Compress)"

if (-not $SkipLockdown) { & (Join-Path $PSScriptRoot 'setup_kiosk_os.ps1') -Role $Role }

if ($Role -eq 'projector') {
    Get-NetFirewallRule -DisplayName 'TCW Map hub' -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName 'TCW Map hub' -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Domain, Private, Public | Out-Null
    Write-Output 'Firewall: inbound TCP 8080 allowed for the hub.'
}

$user = "$env:USERDOMAIN\$env:USERNAME"
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $PSScriptRoot 'launch_kiosk.ps1')`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$trigger.Delay = 'PT20S'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'TCW Map Kiosk' -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Output "Registered logon task 'TCW Map Kiosk' for $user (starts 20s after sign-in)."

Write-Output ''
Write-Output 'Next: set this account to sign in automatically (Sysinternals Autologon, see docs\INSTALL.md), then reboot.'
