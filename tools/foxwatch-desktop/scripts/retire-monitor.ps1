$ErrorActionPreference = 'Stop'
# Ask the old application to finish its active run and exit. Never kill its work.
try {
    $signal = [System.Threading.EventWaitHandle]::OpenExisting('Local\Nixie.FoxWatch.Monitor.Exit')
    try { [void]$signal.Set() } finally { $signal.Dispose() }
} catch [System.Threading.WaitHandleCannotBeOpenedException] { }
$deadline = [DateTime]::UtcNow.AddSeconds(10)
while ((Get-Process -Name FoxWatchMonitor -ErrorAction SilentlyContinue) -and [DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Milliseconds 200
}
if (Get-Process -Name FoxWatchMonitor -ErrorAction SilentlyContinue) {
    throw 'The legacy monitor is finishing its run. Wait for it to exit, then retry.'
}
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$startup = (Get-ItemProperty -LiteralPath $runKey -Name 'Nixie FoxWatch Monitor' -ErrorAction SilentlyContinue).'Nixie FoxWatch Monitor'
if ($startup -and $startup -match 'FoxWatchMonitor\.exe') {
    Remove-ItemProperty -LiteralPath $runKey -Name 'Nixie FoxWatch Monitor' -ErrorAction SilentlyContinue
}
