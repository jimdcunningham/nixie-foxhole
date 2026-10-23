import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CredentialInput, RunOperation, ToolInfo, ToolSettings } from '../shared/monitor.js';
import { RunController } from './run-controller.js';

const exec = promisify(execFile);
async function json(file: string, fallback: any = {}) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
}
async function atomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file + '.desktop.tmp', JSON.stringify(value, null, 2) + '\n');
  await rename(file + '.desktop.tmp', file);
}

/** Electron owns scheduling; the existing CLI continues to own all pipeline business logic. */
export class MonitorService {
  controller: RunController;
  settings!: ToolSettings;
  private repo: string;
  private profile: string;
  private changed: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private child?: ReturnType<typeof spawn>;
  private cancelled = false;
  private actionPending = false;
  private config: any = {};
  private publication: any = {};
  private local: string;
  private scripts: string;
  constructor(repo: string, profile: string, changed: () => void) {
    this.repo = repo; this.profile = profile; this.changed = changed;
    this.local = path.join(repo, 'tools/foxwatch/local');
    this.scripts = path.join(repo, 'tools/foxwatch/scripts');
    this.controller = new RunController((operation, line) => this.run(operation, line), changed);
  }
  private module(name: string): Promise<any> { return import(pathToFileURL(path.join(this.scripts, name + '.mjs')).href); }
  async initialize() {
    this.config = await json(path.join(this.local, 'monitor.config.v1.json'));
    this.publication = await json(path.join(this.local, 'asset-publication.json'), await json(path.join(this.repo, 'config/asset-publication.example.json')));
    const host = await json(path.join(this.local, 'monitor-app/host.config.v1.json'));
    const saved = await json(path.join(this.profile, 'monitor.json'));
    this.settings = {
      nodePath: saved.nodePath ?? host.nodePath ?? 'node', intervalMinutes: this.config.intervalMinutes ?? 10,
      steamUsername: this.config.steamUsername ?? '', blenderPath: this.config.blenderPath ?? '',
      minimumAvailableMemoryGiB: this.config.minimumAvailableMemoryGiB ?? 12, nixieEnabled: !!this.config.nixieEnabled,
      startMinimized: saved.startMinimized ?? false, startWithWindows: saved.startWithWindows ?? false,
      assetsRoot: this.publication.assetsRoot ?? '', outputRoot: this.publication.outputRoot ?? '',
      endpoint: this.publication.target?.endpoint ?? '', bucket: this.publication.target?.bucket ?? '',
      publicBaseUrl: this.publication.target?.publicBaseUrl ?? '', prefix: this.publication.target?.prefix ?? '',
      concurrency: this.publication.concurrency ?? 4,
    };
    this.controller.intervalMinutes = this.settings.intervalMinutes;
    // First adoption is paused. Later launches retain the explicit polling preference.
    this.controller.polling(process.platform === 'win32' && saved.polling === true);
  }
  startTimer() { this.timer = setInterval(() => void (this.actionPending ? Promise.resolve() : this.controller.tick()), 1000); }
  dispose() { clearInterval(this.timer); }
  stopScheduling() { this.dispose(); this.controller.polling(false); }
  private idle() { if (this.actionPending || this.controller.status.running) throw new Error('Wait for the active FoxWatch operation to finish.'); }
  private async persist() { await atomic(path.join(this.profile, 'monitor.json'), {
    nodePath: this.settings.nodePath, startMinimized: this.settings.startMinimized,
    startWithWindows: this.settings.startWithWindows, polling: this.controller.status.polling,
  }); }
  async legacyRunning(): Promise<boolean> {
    if (process.platform !== 'win32') return false;
    const { stdout } = await exec('tasklist.exe', ['/FI', 'IMAGENAME eq FoxWatchMonitor.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000 });
    return /^"FoxWatchMonitor\.exe"/im.test(stdout);
  }
  async info(): Promise<ToolInfo> {
    const state = await json(path.join(this.local, 'state/monitor-state.v1.json'));
    const secrets = await json(path.join(this.local, 'credentials/monitor.secrets.dpapi.v1.json'));
    const branch = state.branches?.[state.selectedBranch];
    let prepared: ToolInfo['prepared'] = null;
    try {
      const pointer = await json(path.resolve(this.repo, this.settings.outputRoot, 'latest-plan.json'));
      if (pointer.planPath) {
        const plan = await json(pointer.planPath);
        prepared = { planPath: pointer.planPath, releaseUrl: plan.release.url, files: plan.summary.sourceFiles, bytes: plan.summary.bytes };
      }
    } catch { /* Missing/incomplete plan is not ready for publication. */ }
    return { settings: { ...this.settings }, windows: process.platform === 'win32', legacyRunning: await this.legacyRunning(),
      steamCredentials: !!secrets.encryptedSteamPassword, notificationCredentials: !!secrets.encryptedNixieWebhook,
      assetCredentials: !!this.publication.credentialFile && await stat(path.resolve(this.repo, this.publication.credentialFile)).then(() => true, () => false),
      latestBuild: state.selectedBuildId ? `${state.selectedBranch} · ${state.selectedBuildId}` : 'No completed poll',
      successfulBuild: branch?.successfulBuildId ?? 'None', lastError: branch?.lastError ?? null, prepared };
  }
  async save(value: ToolSettings) {
    this.idle(); this.actionPending = true;
    try { await this.saveSettings(value); } finally { this.actionPending = false; }
  }
  private async saveSettings(value: ToolSettings) {
    if (process.platform !== 'win32') throw new Error('Generation and publishing settings require Windows. Inspection and downloads remain available.');
    if (!value || typeof value !== 'object') throw new Error('Invalid settings.');
    for (const key of ['nodePath','steamUsername','blenderPath','assetsRoot','outputRoot','endpoint','bucket','publicBaseUrl','prefix'] as const)
      if (typeof value[key] !== 'string' || /[\r\n\0]/.test(value[key]) || value[key].length > 32768) throw new Error('Invalid setting: ' + key);
    for (const key of ['startWithWindows','startMinimized','nixieEnabled'] as const) if (typeof value[key] !== 'boolean') throw new Error('Invalid setting: ' + key);
    if (!Number.isInteger(value.intervalMinutes) || value.intervalMinutes < 5 || value.intervalMinutes > 1440) throw new Error('Polling interval must be 5–1440 minutes.');
    if (!Number.isInteger(value.concurrency) || value.concurrency < 1 || value.concurrency > 16) throw new Error('Upload concurrency must be 1–16.');
    if (!Number.isFinite(value.minimumAvailableMemoryGiB) || value.minimumAvailableMemoryGiB < 0 || value.minimumAvailableMemoryGiB > 1024) throw new Error('Invalid memory guard.');
    if (!path.isAbsolute(value.nodePath) || !(await stat(value.nodePath)).isFile()) throw new Error('Choose an installed Node executable.');
    const { validateMonitorConfig } = await this.module('steam-monitor-core');
    const config = validateMonitorConfig({ ...this.config, schemaVersion: 1, branchMode: 'latest', steamAppId: '505460',
      intervalMinutes: value.intervalMinutes, steamUsername: value.steamUsername, blenderPath: value.blenderPath,
      minimumAvailableMemoryGiB: value.minimumAvailableMemoryGiB, nixieEnabled: value.nixieEnabled, updatedAt: new Date().toISOString() });
    const { validateTarget } = await this.module('asset-pack-publication');
    const target = validateTarget({ endpoint: value.endpoint, bucket: value.bucket, publicBaseUrl: value.publicBaseUrl, prefix: value.prefix });
    if (!value.assetsRoot.trim() || !value.outputRoot.trim()) throw new Error('Assets and output directories are required.');
    const publication = { ...this.publication, schemaVersion: 1, assetsRoot: value.assetsRoot, outputRoot: value.outputRoot, target, concurrency: value.concurrency };
    await atomic(path.join(this.local, 'monitor.config.v1.json'), config);
    await atomic(path.join(this.local, 'asset-publication.json'), publication);
    this.config = config; this.publication = publication; this.settings = { ...value };
    this.controller.intervalMinutes = value.intervalMinutes;
    await this.persist();
  }
  async credentials(value: CredentialInput) {
    this.idle(); this.actionPending = true;
    try { await this.saveCredentials(value); } finally { this.actionPending = false; }
  }
  private async saveCredentials(value: CredentialInput) {
    if (!value || typeof value !== 'object') throw new Error('Invalid credential input.');
    for (const [key, secret] of Object.entries(value)) if (!['steamPassword','webhook','accessKeyId','secretAccessKey'].includes(key) || typeof secret !== 'string' || secret.length > 16000) throw new Error('Invalid credential input.');
    if (!!value.accessKeyId !== !!value.secretAccessKey) throw new Error('Enter both asset credential fields.');
    const { transformAssetCredentialSecret: encrypt } = await this.module('asset-pack-credentials');
    const file = path.join(this.local, 'credentials/monitor.secrets.dpapi.v1.json');
    const secrets = await json(file, { schemaVersion: 1 });
    if (value.webhook) { const core = await this.module('steam-monitor-core'); core.validateNixieWebhookUrl(value.webhook); }
    if (value.steamPassword) secrets.encryptedSteamPassword = await encrypt('encrypt-stdin', value.steamPassword);
    if (value.webhook) secrets.encryptedNixieWebhook = await encrypt('encrypt-stdin', value.webhook);
    if (value.steamPassword || value.webhook) await atomic(file, secrets);
    if (value.accessKeyId && value.secretAccessKey) {
      const encrypted = await encrypt('encrypt-stdin', JSON.stringify({ accessKeyId: value.accessKeyId, secretAccessKey: value.secretAccessKey }));
      const relative = 'tools/foxwatch/local/asset-publication.credentials.dpapi';
      const destination = path.join(this.repo, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination + '.desktop.tmp', encrypted.trim());
      await rename(destination + '.desktop.tmp', destination);
      this.publication.credentialFile = relative;
      await atomic(path.join(this.local, 'asset-publication.json'), this.publication);
    }
  }
  async action(action: RunOperation | 'start' | 'pause' | 'cancel' | 'retire') {
    if (this.actionPending) throw new Error('A FoxWatch action is already pending.');
    if (action === 'pause') {
      this.actionPending = true;
      try { this.controller.polling(false); await this.persist(); } finally { this.actionPending = false; }
      return;
    }
    if (action === 'cancel') {
      this.cancelled = true;
      this.controller.polling(false); await this.persist();
      if (this.child?.pid) {
        this.cancelled = true;
        await exec('taskkill.exe', ['/PID', String(this.child.pid), '/T', '/F'], { windowsHide: true, timeout: 15000 });
      }
      return;
    }
    this.idle();
    if (process.platform !== 'win32') throw new Error('Steam polling, generation, and publishing require Windows.');
    this.actionPending = true;
    try {
      if (action === 'retire') {
        await exec('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', path.join(this.repo, 'tools/foxwatch-desktop/scripts/retire-monitor.ps1')], { windowsHide: true, timeout: 20000 });
        return;
      }
      if (await this.legacyRunning()) throw new Error('Retire the legacy monitor in Settings first so only one app polls for builds.');
      if (action === 'start') {
        const { validateMonitorConfig } = await this.module('steam-monitor-core'); validateMonitorConfig(this.config);
        this.controller.polling(true); await this.persist();
      } else void this.controller.run(action);
    } finally { this.actionPending = false; }
  }
  private async run(operation: RunOperation, line: (value: string) => void): Promise<number> {
    this.cancelled = false;
    if (await this.legacyRunning()) throw new Error('The legacy monitor is running. Retire it in Settings before starting work.');
    const commands: Record<RunOperation, string[]> = {
      poll: ['monitor-once'], refresh: ['monitor-now','--force-refresh'], 'clear-cache': ['clear-cache'],
      prepare: ['assets-prepare'], check: ['assets-publish'], publish: ['assets-publish','--upload'],
    };
    const args = commands[operation];
    if (['prepare','check','publish'].includes(operation)) args.push('--config',path.join(this.local,'asset-publication.json'));
    await mkdir(path.join(this.local, 'logs'), { recursive: true });
    const { redactSensitiveText } = await this.module('steam-monitor-core');
    if (this.cancelled) throw new Error('Run cancelled. Automatic polling is paused.');
    const log = createWriteStream(path.join(this.local, 'logs', `desktop-${new Date().toISOString().replace(/[:.]/g,'-')}.log`));
    let logError: Error | null = null; log.on('error', error => { logError = error; });
    return await new Promise<number>((resolve, reject) => {
      const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
      const child = spawn(this.settings.nodePath, [path.join(this.repo,'tools/foxwatch/run-foxwatch.mjs'),...args], {
        cwd: this.repo, env, windowsHide: true, stdio: ['ignore','pipe','pipe'],
      });
      this.child = child;
      for (const stream of [child.stdout!,child.stderr!]) {
        const reader = createInterface({ input: stream });
        reader.on('line', text => { const safe = redactSensitiveText(text).slice(0,16000); log.write(safe + '\n'); line(safe); });
      }
      child.once('error', error => { this.child = undefined; log.end(); reject(error); });
      child.once('close', code => {
        this.child = undefined; log.end();
        if (this.cancelled) reject(new Error('Run cancelled. Automatic polling is paused.'));
        else if (logError) reject(new Error('Could not save the run log: ' + logError.message));
        else resolve(code ?? 1);
      });
    });
  }
}
