# -Headless runs everything without a visible window, for testing the watchdog on a dev PC.
param([switch]$Headless)

$ErrorActionPreference = 'Stop'
$Root = Split-Path $PSScriptRoot -Parent
$Station = Get-Content (Join-Path $PSScriptRoot 'station.json') -Raw | ConvertFrom-Json
$Logs = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force $Logs | Out-Null
$ChromeProfile = Join-Path $Root 'chrome-profile'
$Port = 8080

function Log($msg) {
    $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
    Add-Content -Path (Join-Path $Logs ('kiosk-{0}.log' -f (Get-Date -Format 'yyyyMMdd'))) -Value $line
    Write-Host $line
}

function Find-Chrome {
    foreach ($p in "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") {
        if (Test-Path $p) { return $p }
    }
    throw 'Google Chrome is not installed.'
}

function Get-ProcessByCommandLine($name, $fragment) {
    Get-CimInstance Win32_Process -Filter "Name = '$name'" | Where-Object { $_.CommandLine -like "*$fragment*" } | Select-Object -First 1
}

$Url = if ($Station.role -eq 'projector') {
    "http://localhost:$Port/projector/"
} else {
    $page = (Join-Path $Root 'app\touch\index.html') -replace '\\', '/'
    "file:///${page}?screen=$($Station.screen)&hub=$($Station.hub):$Port&idle=$($Station.idleSeconds)"
}

Add-Type -AssemblyName System.Windows.Forms
function Get-MonitorOrigin {
    $screens = [System.Windows.Forms.Screen]::AllScreens | Sort-Object { $_.Bounds.X }
    $i = [Math]::Min([int]$Station.monitor, $screens.Count - 1)
    $b = $screens[$i].Bounds
    Log ("monitor {0} of {1}: {2}x{3} at {4},{5}" -f $i, $screens.Count, $b.Width, $b.Height, $b.X, $b.Y)
    return "$($b.X),$($b.Y)"
}

$ChromeExe = Find-Chrome
$ChromeFlags = @(
    '--kiosk', "--user-data-dir=$ChromeProfile", '--no-first-run', '--no-default-browser-check', '--noerrdialogs',
    '--disable-infobars', '--disable-session-crashed-bubble', '--disable-translate', '--disable-sync', '--disable-extensions',
    '--disable-default-apps', '--disable-notifications', '--disable-hang-monitor', '--disable-pinch', '--hide-scrollbars',
    '--overscroll-history-navigation=0', '--touch-events=enabled', '--autoplay-policy=no-user-gesture-required',
    '--block-new-web-contents', '--check-for-update-interval=31536000',
    '--disable-features=TranslateUI,Translate,OverscrollHistoryNavigation,TouchpadOverscrollHistoryNavigation,ExperimentalFullscreenExitUI,FullscreenExitUI,HardwareMediaKeyHandling'
)
if ($Headless) { $ChromeFlags += '--headless=new' }

function Start-Chrome {
    $existing = Get-ProcessByCommandLine 'chrome.exe' $ChromeProfile
    if ($existing) { Log "adopting running Chrome pid $($existing.ProcessId)"; return Get-Process -Id $existing.ProcessId }
    # A crashed Chrome leaves a lock and 'restore pages' state behind; clear both so it opens cleanly.
    Remove-Item (Join-Path $ChromeProfile 'SingletonLock') -Force -ErrorAction SilentlyContinue
    $prefs = Join-Path $ChromeProfile 'Default\Preferences'
    if (Test-Path $prefs) { (Get-Content $prefs -Raw) -replace '"exit_type":"Crashed"', '"exit_type":"Normal"' | Set-Content $prefs -NoNewline }
    # Windows PowerShell joins -ArgumentList with bare spaces, so quote anything that contains one.
    $chromeArgs = ($ChromeFlags + @("--window-position=$(Get-MonitorOrigin)", $Url)) | ForEach-Object { if ($_ -match ' ') { $_ -replace '^(--[^=]+=)?(.*)$', '$1"$2"' } else { $_ } }
    Log "starting Chrome: $Url"
    return Start-Process -FilePath $ChromeExe -ArgumentList $chromeArgs -PassThru
}

function Start-Hub {
    $existing = Get-ProcessByCommandLine 'node.exe' 'hub.mjs'
    if ($existing) { Log "adopting running hub pid $($existing.ProcessId)"; return Get-Process -Id $existing.ProcessId }
    $node = (Get-Command node -ErrorAction Stop).Source
    $hub = Join-Path $Root 'server\hub.mjs'
    Log 'starting hub'
    return Start-Process -FilePath 'cmd.exe' -ArgumentList "/c `"`"$node`" `"$hub`" --port $Port >> `"$Logs\hub.log`" 2>&1`"" -WindowStyle Hidden -PassThru
}

function Wait-Hub {
    for ($i = 0; $i -lt 40; $i++) {
        # A raw TCP connect: Invoke-WebRequest to localhost can stall on proxy detection in Windows PowerShell.
        $tcp = New-Object System.Net.Sockets.TcpClient
        try { if ($tcp.ConnectAsync('127.0.0.1', $Port).Wait(1000) -and $tcp.Connected) { return } } catch {} finally { $tcp.Dispose() }
        Start-Sleep -Milliseconds 500
    }
    Log 'hub did not answer within 20s; starting Chrome anyway (it reconnects on its own)'
}

Log "=== launch_kiosk: role=$($Station.role) screen=$($Station.screen) hub=$($Station.hub) monitor=$($Station.monitor) ==="
$hubProc = $null
if ($Station.role -eq 'projector') { $hubProc = Start-Hub; Wait-Hub }
$chromeProc = Start-Chrome
$FirstRetrySeconds = 2
$MaxRetrySeconds = 60
$HealthyAfterSeconds = 60
$watch = @{
    chrome = @{ proc = $chromeProc; since = Get-Date; wait = $FirstRetrySeconds; start = { Start-Chrome } }
}
if ($hubProc) { $watch.hub = @{ proc = $hubProc; since = Get-Date; wait = $FirstRetrySeconds; start = { Start-Hub } } }

while ($true) {
    Start-Sleep -Seconds 2
    foreach ($name in @($watch.Keys)) {
        $w = $watch[$name]
        if (-not $w.proc.HasExited) {
            if (((Get-Date) - $w.since).TotalSeconds -gt $HealthyAfterSeconds) { $w.wait = $FirstRetrySeconds }
            continue
        }
        Log "$name exited; restarting in $($w.wait)s"
        Start-Sleep -Seconds $w.wait
        $w.wait = [Math]::Min($w.wait * 2, $MaxRetrySeconds)
        $w.proc = & $w.start
        $w.since = Get-Date
    }
}
