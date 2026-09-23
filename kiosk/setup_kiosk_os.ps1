# Run from an ELEVATED PowerShell while signed in as the kiosk user (HKCU settings land on whoever runs it).
#
#   setup_kiosk_os.ps1 -Role touch        # touch screen PCs: full touch lockdown
#   setup_kiosk_os.ps1 -Role projector    # projector PC: power, notifications, updates, Chrome policies
#   setup_kiosk_os.ps1 -Role touch -Undo  # put everything back

param(
    [Parameter(Mandatory)][ValidateSet('touch', 'projector')][string]$Role,
    [switch]$Undo
)

$ErrorActionPreference = 'Stop'
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) { throw 'Run this from an elevated (Administrator) PowerShell.' }

$script:problems = 0
Write-Output ''
Write-Output ("=== Qin Mausoleum map - {0} lockdown ({1}) for user {2} ===" -f $Role, $(if ($Undo) { 'UNDO' } else { 'APPLY' }), $env:USERNAME)

function Set-Reg {
    param($Path, $Name, $Value, $UndoValue = $null, $Type = 'DWord')
    if (-not (Test-Path $Path)) { New-Item -Path $Path -Force | Out-Null }
    if ($Undo -and $null -eq $UndoValue) {
        Remove-ItemProperty -Path $Path -Name $Name -ErrorAction SilentlyContinue
        Write-Output ("  removed  {0}\{1}" -f $Path, $Name)
        return
    }
    $want = if ($Undo) { $UndoValue } else { $Value }
    Set-ItemProperty -Path $Path -Name $Name -Value $want -Type $Type
    $got = (Get-ItemProperty -Path $Path -Name $Name).$Name
    if ("$got" -ne "$want") { $script:problems++; Write-Warning ("  {0}\{1} reads back {2}, wanted {3}" -f $Path, $Name, $got, $want) }
    else { Write-Output ("  ok       {0}\{1} = {2}" -f $Path, $Name, $want) }
}

function Section($title) { Write-Output ''; Write-Output "[$title]" }

if ($Role -eq 'touch') {
    Section 'Edge swipes (Start, Widgets, Notification Centre, Task View)'
    Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\EdgeUI' 'AllowEdgeSwipe' 0
    $edgeUI = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\EdgeUI'
    Set-Reg $edgeUI 'DisableCharmsHint' 1 0
    Set-Reg $edgeUI 'DisableTaskSwitchHint' 1 0
    Set-Reg $edgeUI 'DisableTLCorner' 1 0
    Set-Reg $edgeUI 'DisableStartSwipeRightEdge' 1 0
    Set-Reg 'HKCU:\Software\Microsoft\TouchInput' 'DisableEdgeSwipe' 1 0

    Section 'Three- and four-finger touch gestures'
    Set-Reg 'HKCU:\Control Panel\Desktop' 'TouchGestureSetting' 0 1

    Section 'Press-and-hold right-click'
    Set-Reg 'HKCU:\Software\Microsoft\Wisp\Touch' 'TouchMode_hold' 0 1
    Set-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PressAndHold' 'PressAndHoldDelay' 0 1000

    Section 'Touch feedback and touch keyboard'
    Set-Reg 'HKCU:\Software\Microsoft\TouchInput' 'ShowTouchFeedback' 0 1
    Set-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Accessibility' 'TouchIndicator' 0 0
    Set-Reg 'HKCU:\Software\Microsoft\TabletTip\1.7' 'EnableDesktopModeAutoInvoke' 0 1
    Set-Reg 'HKCU:\Software\Microsoft\TabletTip\1.7' 'TipbandDesiredVisibility' 0 1

    Section 'Tablet mode prompts'
    Set-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell' 'ConvertibleSlateModePromptPreference' 0 1

    Section 'Ctrl+Alt+Del menu (Sign out stays available for staff)'
    $sys = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\System'
    Set-Reg $sys 'DisableTaskMgr' 1
    Set-Reg $sys 'DisableLockWorkstation' 1
    Set-Reg $sys 'DisableChangePassword' 1
    Set-Reg 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System' 'HideFastUserSwitching' 1

    Section 'Taskbar auto-hide'
    $taskbar = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\StuckRects3'
    try {
        $blob = (Get-ItemProperty -Path $taskbar -Name Settings).Settings
        $blob[8] = if ($Undo) { $blob[8] -band (-bnot 1) } else { $blob[8] -bor 1 }
        Set-ItemProperty -Path $taskbar -Name Settings -Value $blob
        Write-Output ("  ok       taskbar auto-hide {0}" -f $(if ($Undo) { 'off' } else { 'on' }))
    } catch { $script:problems++; Write-Warning "  could not change taskbar auto-hide: $_" }
}

Section 'Notifications'
Set-Reg 'HKCU:\Software\Policies\Microsoft\Windows\Explorer' 'DisableNotificationCenter' 1
Set-Reg 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications' 'ToastEnabled' 0 1
Set-Reg 'HKCU:\Software\Policies\Microsoft\Windows\CloudContent' 'DisableWindowsSpotlightFeatures' 1
Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\CloudContent' 'DisableWindowsConsumerFeatures' 1

Section 'Windows Update: no restarts while signed in, active hours 06:00-23:00'
Set-Reg 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' 'NoAutoRebootWithLoggedOnUsers' 1
Set-Reg 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' 'ActiveHoursStart' 6 8
Set-Reg 'HKLM:\SOFTWARE\Microsoft\WindowsUpdate\UX\Settings' 'ActiveHoursEnd' 23 17

Section 'Power and screensaver'
$minutes = if ($Undo) { 15 } else { 0 }
foreach ($setting in 'monitor-timeout-ac', 'standby-timeout-ac', 'hibernate-timeout-ac') {
    powercfg /change $setting $minutes | Out-Null
    Write-Output ("  ok       powercfg {0} = {1}" -f $setting, $minutes)
}
powercfg /hibernate $(if ($Undo) { 'on' } else { 'off' }) | Out-Null
Set-Reg 'HKCU:\Control Panel\Desktop' 'ScreenSaveActive' '0' '1' 'String'

Section 'Chrome policies (machine-wide: this PC only runs the exhibit)'
$chrome = 'HKLM:\SOFTWARE\Policies\Google\Chrome'
$policies = [ordered]@{
    DeveloperToolsAvailability = 2; IncognitoModeAvailability = 1; BrowserSignin = 0; BrowserAddPersonEnabled = 0
    BrowserGuestModeEnabled = 0; TranslateEnabled = 0; PasswordManagerEnabled = 0; AutofillAddressEnabled = 0
    AutofillCreditCardEnabled = 0; DownloadRestrictions = 3; PrintingEnabled = 0; AllowFileSelectionDialogs = 0
    HideFirstRunExperience = 1; PromotionalTabsEnabled = 0; DefaultNotificationsSetting = 2; MetricsReportingEnabled = 0
    FullscreenAllowed = 1
}
foreach ($name in $policies.Keys) { Set-Reg $chrome $name $policies[$name] }

Write-Output ''
if ($script:problems) { Write-Warning "$($script:problems) setting(s) did not read back correctly - see warnings above." }
else { Write-Output 'All settings read back correctly. Reboot for everything to take effect.' }
exit $script:problems
