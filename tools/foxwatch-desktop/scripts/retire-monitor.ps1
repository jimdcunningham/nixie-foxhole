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
Remove-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'Nixie FoxWatch Monitor' -ErrorAction SilentlyContinue
