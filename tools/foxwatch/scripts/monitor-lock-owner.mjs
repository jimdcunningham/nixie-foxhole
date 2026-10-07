import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import process from 'node:process';

const execFileAsync = promisify(execFile);

export function matchesMonitorLockOwner(lock, owner, runnerScriptPath) {
    if (!owner) return false;
    const lockStartedAt = Date.parse(lock.startedAt);
    const processStartedAt = Date.parse(owner.startedAt);
    const normalize = value => String(value ?? '').replaceAll('/', '\\').toLowerCase();
    return Number.isFinite(lockStartedAt) && Number.isFinite(processStartedAt)
        && processStartedAt <= lockStartedAt
        && normalize(owner.commandLine).includes(normalize(runnerScriptPath));
}

export async function isMonitorLockOwnerAlive(lock, runnerScriptPath) {
    const pid = Number(lock.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid FoxWatch monitor lock PID.');
    if (process.platform !== 'win32') {
        try { process.kill(pid, 0); return true; }
        catch (error) { return error?.code === 'EPERM'; }
    }
    // A PID alone is insufficient after Stop kills the owning process tree.
    // Query failures propagate: never retire a lock whose owner is unknown.
    const command = `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}' -ErrorAction Stop; if ($p) { $started = (Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o'); @{ commandLine = $p.CommandLine; startedAt = $started } | ConvertTo-Json -Compress } else { 'null' }`;
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
    const owner = JSON.parse(stdout.trim());
    if (owner && !owner.commandLine) throw new Error('FoxWatch monitor lock owner command cannot be verified.');
    if (owner && (!Number.isFinite(Date.parse(lock.startedAt)) || !Number.isFinite(Date.parse(owner.startedAt)))) {
        throw new Error('FoxWatch monitor lock owner start time cannot be verified.');
    }
    return matchesMonitorLockOwner(lock, owner, runnerScriptPath);
}
