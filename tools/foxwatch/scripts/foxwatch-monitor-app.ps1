param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('install', 'open', 'status', 'uninstall')]
    [string]$Action,

    [string]$ExecutablePath,
    [string]$SettingsPath,
    [switch]$StartPaused,
    [string]$ValueName = 'Nixie FoxWatch Monitor'
)

$ErrorActionPreference = 'Stop'
$runKeyPath = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'

function Get-StartMinimized {
    if (-not $SettingsPath -or -not (Test-Path -LiteralPath $SettingsPath -PathType Leaf)) {
        return $true
    }
    try {
        $settings = Get-Content -LiteralPath $SettingsPath -Raw | ConvertFrom-Json
        if ($null -ne $settings.startMinimized) {
            return [bool]$settings.startMinimized
        }
    }
    catch {
        Write-Warning "Unable to read the FoxWatch monitor settings; defaulting to start minimized: $($_.Exception.Message)"
    }
    return $true
}

switch ($Action) {
    'install' {
        if (-not $ExecutablePath -or -not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
            throw "ExecutablePath must identify the published FoxWatch monitor executable: $ExecutablePath"
        }
        if (-not (Test-Path -LiteralPath $runKeyPath)) {
            New-Item -Path $runKeyPath -Force | Out-Null
        }
        $startMinimized = Get-StartMinimized
        $startupCommand = if ($startMinimized) { '"{0}" --background' -f $ExecutablePath } else { '"{0}"' -f $ExecutablePath }
        Set-ItemProperty -LiteralPath $runKeyPath -Name $ValueName -Value $startupCommand
        $startArguments = @()
        if ($startMinimized) { $startArguments += '--background' }
        if ($StartPaused) { $startArguments += '--paused' }
        if ($startArguments.Count -gt 0) {
            Start-Process -FilePath $ExecutablePath -ArgumentList $startArguments -WindowStyle Hidden
        }
        else {
            Start-Process -FilePath $ExecutablePath
        }
        [Console]::Out.Write("installed`t$ExecutablePath")
    }
    'open' {
        if (-not $ExecutablePath -or -not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
            throw "FoxWatch monitor executable is not installed: $ExecutablePath"
        }
        Start-Process -FilePath $ExecutablePath
        [Console]::Out.Write("opened`t$ExecutablePath")
    }
    'status' {
        $startupCommand = (Get-ItemProperty -LiteralPath $runKeyPath -Name $ValueName -ErrorAction SilentlyContinue).$ValueName
        $running = @(Get-Process -Name 'FoxWatchMonitor' -ErrorAction SilentlyContinue).Count -gt 0
        $startup = if ($startupCommand) { 'enabled' } else { 'disabled' }
        $processState = if ($running) { 'running' } else { 'stopped' }
        [Console]::Out.Write("$processState`tstartup=$startup")
    }
    'uninstall' {
        Remove-ItemProperty -LiteralPath $runKeyPath -Name $ValueName -ErrorAction SilentlyContinue
        if ($ExecutablePath -and (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
            $targetProcesses = @(Get-Process -Name 'FoxWatchMonitor' -ErrorAction SilentlyContinue | Where-Object {
                $_.Path -and ([System.IO.Path]::GetFullPath($_.Path) -eq [System.IO.Path]::GetFullPath($ExecutablePath))
            })
            Start-Process -FilePath $ExecutablePath -ArgumentList '--exit' -WindowStyle Hidden -Wait
            $deadline = [DateTime]::UtcNow.AddSeconds(10)
            while ($targetProcesses.Count -gt 0 -and [DateTime]::UtcNow -lt $deadline) {
                Start-Sleep -Milliseconds 200
                $targetProcesses = @($targetProcesses | Where-Object { -not $_.HasExited })
            }
            if ($targetProcesses.Count -gt 0) {
                throw 'FoxWatch Monitor is finishing an active run. Wait for it to exit, then run the installer again.'
            }
        }
        [Console]::Out.Write("uninstalled`t$ValueName")
    }
}
