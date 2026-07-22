param(
    [string]$AppExe,
    [Parameter(Mandatory = $true)] [string]$ProjectRoot,
    [Parameter(Mandatory = $true)] [string]$ServiceBuildId,
    [Parameter(Mandatory = $true)] [int]$ListenPort,
    [Parameter(Mandatory = $true)] [int]$MaxPort,
    [string]$FallbackScript
)

$ErrorActionPreference = "Stop"
$launcherProcessId = $PID
if ($AppExe) {
    $AppExe = [IO.Path]::GetFullPath($AppExe)
}
$FallbackScript = if ($FallbackScript) { [IO.Path]::GetFullPath($FallbackScript) } else { $null }
$ProjectRoot = [IO.Path]::GetFullPath($ProjectRoot)
$mutexKey = if ($AppExe) { $AppExe } elseif ($FallbackScript) { $FallbackScript } else { $ProjectRoot }
$mutexName = "Local\MathFacultyLauncher-" + (($mutexKey.ToLowerInvariant()) -replace "[^a-z0-9]", "_")
$mutex = New-Object System.Threading.Mutex($false, $mutexName)
$ownsMutex = $false

function Get-HealthyPort {
    param([int]$Port)
    try {
        $health = Invoke-RestMethod -UseBasicParsing -Uri ("http://127.0.0.1:{0}/api/health" -f $Port) -TimeoutSec 1
        if ("$($health.version)" -eq "$ServiceBuildId" -and "$($health.status)" -eq "ok") {
            return $Port
        }
    } catch {}
    return $null
}

function Find-HealthyPort {
    for ($port = $ListenPort; $port -le $MaxPort; $port++) {
        $healthy = Get-HealthyPort $port
        if ($null -ne $healthy) { return $healthy }
    }
    return $null
}

function Get-OwnProcesses {
    @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
        if ([int]$_.ProcessId -eq $launcherProcessId) { return $false }
        $matchesExecutable = $AppExe -and $_.ExecutablePath -and ([IO.Path]::GetFullPath($_.ExecutablePath) -ieq $AppExe)
        $matchesFallback = $FallbackScript -and $_.CommandLine -and ($_.CommandLine -like ("*{0}*" -f $FallbackScript))
        $matchesExecutable -or $matchesFallback
    })
}

function Stop-OwnProcesses {
    foreach ($process in @(Get-OwnProcesses)) {
        Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 700
}

function Get-ServerLogPaths {
    $logDirectory = Join-Path $ProjectRoot "logs"
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    return @{
        stdout = Join-Path $logDirectory "server.stdout.log"
        stderr = Join-Path $logDirectory "server.stderr.log"
    }
}

function Stop-OrphanProcesses {
    param([int]$Port)
    $processes = @(Get-OwnProcesses)
    if ($processes.Count -eq 0) { return }

    $keep = New-Object 'System.Collections.Generic.HashSet[int]'
    foreach ($listener in @(Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) {
        [void]$keep.Add([int]$listener.OwningProcess)
    }
    if ($keep.Count -eq 0) { return }

    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($process in $processes) {
            $processId = [int]$process.ProcessId
            $parentId = [int]$process.ParentProcessId
            if (($keep.Contains($parentId) -or $keep.Contains($processId)) -and $keep.Add($parentId)) {
                $changed = $true
            }
            if ($keep.Contains($parentId) -and $keep.Add($processId)) { $changed = $true }
        }
    }

    foreach ($process in $processes) {
        if (-not $keep.Contains([int]$process.ProcessId)) {
            Stop-Process -Id ([int]$process.ProcessId) -Force -ErrorAction SilentlyContinue
        }
    }
}

function Open-Service([int]$Port) {
    $url = "http://127.0.0.1:{0}/" -f $Port
    Start-Process -FilePath "explorer.exe" -ArgumentList @($url)
}

try {
    try {
        $ownsMutex = $mutex.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
        $ownsMutex = $true
    }

    if (-not $ownsMutex) {
        for ($attempt = 0; $attempt -lt 120; $attempt++) {
            $port = Find-HealthyPort
            if ($null -ne $port) {
                Open-Service $port
                exit 0
            }
            Start-Sleep -Seconds 1
        }
        Write-Error "Another launcher is running, but service version $ServiceBuildId was not found."
        exit 2
    }

    $port = Find-HealthyPort
    if ($null -ne $port) {
        Stop-OrphanProcesses $port
        Open-Service $port
        exit 0
    }

    Stop-OwnProcesses
    $logPaths = Get-ServerLogPaths
    if ($AppExe -and (Test-Path -LiteralPath $AppExe -PathType Leaf)) {
        Start-Process -FilePath $AppExe -ArgumentList @(
            "--project-root", $ProjectRoot,
            "--no-browser",
            "--port", ([string]$ListenPort)
        ) -WorkingDirectory $ProjectRoot -WindowStyle Hidden `
          -RedirectStandardOutput $logPaths.stdout -RedirectStandardError $logPaths.stderr
    } elseif ($FallbackScript -and (Test-Path -LiteralPath $FallbackScript -PathType Leaf)) {
        Start-Process -FilePath "py" -ArgumentList @(
            "-3", "-X", "utf8", $FallbackScript,
            "--project-root", $ProjectRoot,
            "--no-browser",
            "--port", ([string]$ListenPort)
        ) -WorkingDirectory $ProjectRoot -WindowStyle Hidden `
          -RedirectStandardOutput $logPaths.stdout -RedirectStandardError $logPaths.stderr
    } else {
        Write-Error "Executable or Python fallback not found: $AppExe"
        exit 3
    }

    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        $port = Find-HealthyPort
        if ($null -ne $port) {
            Open-Service $port
            exit 0
        }
        Start-Sleep -Seconds 1
    }
    Write-Error "Failed to start version $ServiceBuildId; checked ports $ListenPort-$MaxPort."
    exit 4
} finally {
    if ($ownsMutex) {
        try { $mutex.ReleaseMutex() } catch {}
    }
    $mutex.Dispose()
}
