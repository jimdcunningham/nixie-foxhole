import type { RunStatus, RunOperation } from '../shared/monitor.js';

export interface Runner {
  (operation: RunOperation, line: (value: string) => void): Promise<number>;
}

/** One operation owns the runner. The poll interval starts at completion, never start. */
export class RunController {
  status: RunStatus = {
    running: false, polling: false, operation: null, stage: 'Stopped', detail: 'Automatic polling is stopped.',
    percent: 0, startedAt: null, finishedAt: null, nextPollAt: null, workers: [], logs: [],
    rendered: 0, renderTotal: 0, exported: 0, exportTotal: 0,
  };
  intervalMinutes = 10;
  private runner: Runner;
  private changed: () => void;
  private now: () => number;
  constructor(runner: Runner, changed: () => void = () => {}, now = Date.now) {
    this.runner = runner; this.changed = changed; this.now = now;
  }
  polling(enabled: boolean) {
    this.status.polling = enabled;
    this.status.nextPollAt = enabled && !this.status.running ? this.now() : null;
    this.changed();
  }
  async tick() {
    if (this.status.polling && !this.status.running && this.status.nextPollAt !== null && this.now() >= this.status.nextPollAt)
      await this.run('poll');
  }
  async run(operation: RunOperation) {
    if (this.status.running) throw new Error('A FoxWatch operation is already running.');
    Object.assign(this.status, { running: true, operation, stage: 'Starting', detail: operation,
      percent: 0, startedAt: this.now(), finishedAt: null, nextPollAt: null, workers: [], logs: [],
      rendered: 0, renderTotal: 0, exported: 0, exportTotal: 0 });
    this.changed();
    try {
      const code = await this.runner(operation, value => this.line(value));
      if (code !== 0) throw new Error(`FoxWatch ${operation} exited with code ${code}. See the run log.`);
      this.status.stage = 'Complete';
      this.status.detail = operation === 'prepare' ? 'Assets prepared for review. Nothing uploaded.'
        : operation === 'check' ? 'Prepared upload verified. Nothing uploaded.' : `${operation} completed successfully.`;
      this.status.percent = 100;
    } catch (error) {
      this.status.stage = 'Failed'; this.status.detail = error instanceof Error ? error.message : String(error);
    } finally {
      this.status.running = false; this.status.finishedAt = this.now();
      this.status.nextPollAt = this.status.polling ? this.now() + this.intervalMinutes * 60_000 : null;
      this.changed();
    }
  }
  line(value: string) {
    this.status.logs.push(value.slice(0, 4000));
    if (this.status.logs.length > 300) this.status.logs.shift();
    const position = value.indexOf('FOXWATCH_PROGRESS ');
    try {
      if (position >= 0) {
        const item = JSON.parse(value.slice(position + 18));
        if (typeof item.stage === 'string') this.status.stage = item.stage;
        if (typeof item.detail === 'string') this.status.detail = item.detail;
        if (Number.isFinite(item.overallPercent)) this.status.percent = Math.max(this.status.percent, Math.min(99, item.overallPercent));
        if (item.kind === 'blender-start') this.status.renderTotal = item.sceneTotal ?? 0;
        if (Number.isFinite(item.completedScenes)) this.status.rendered = item.completedScenes;
        if (String(item.kind).startsWith('spatial-')) {
          this.status.exportTotal = item.assetTotal ?? 0; this.status.exported = item.completedAssets ?? 0;
          if (item.active && typeof item.active === 'object') {
            this.status.workers = this.status.workers.filter(worker => worker.type !== '3D');
            for (const [id, detail] of Object.entries(item.active)) this.worker('3D', id, String(detail), 0, 0);
          }
        }
        if (String(item.kind).startsWith('blender-') && item.worker !== undefined)
          this.worker('Blender', String(item.worker), item.reason ? `${item.reason}: ${item.detail ?? ''}` : item.sceneEntry ?? item.detail ?? item.kind, item.scene ?? 0, item.sceneTotal ?? 0);
        if (this.status.exportTotal) this.status.percent = Math.max(this.status.percent, Math.min(90, 40 + 25 * this.status.exported / this.status.exportTotal + 25 * (this.status.renderTotal ? this.status.rendered / this.status.renderTotal : 0)));
      } else if (value.startsWith('asset-publication: ')) {
        const item = JSON.parse(value.slice(19));
        this.status.stage = `Assets · ${item.phase}`;
        this.status.detail = item.total ? `${item.completed ?? 0} / ${item.total} objects` : item.phase;
        if (item.total) this.status.percent = Math.max(this.status.percent, Math.min(99, 100 * (item.completed ?? 0) / item.total));
      } else {
        for (const [match, stage, percent] of [
          ['Checking Steam branch metadata', 'Checking Steam', 2], ['Acquiring Steam', 'Acquiring Game Build', 5],
          ['Generating FoxWatch manifest', 'Preparing Manifest', 25], ['Deep asset cache', 'Preparing Assets', 40],
          ['Deep refresh: rendering', 'Rendering', 50], ['publish-manifest:', 'Finalizing Local Assets', 92],
        ] as const) if (value.includes(match)) { this.status.stage = stage; this.status.detail = value; this.status.percent = Math.max(this.status.percent, percent); }
      }
    } catch { /* Unstructured or partial output still belongs in the log. */ }
    this.changed();
  }
  private worker(type: string, id: string, detail: string, completed: number, total: number) {
    const worker = { type, id, detail, completed, total };
    const index = this.status.workers.findIndex(row => row.type === type && row.id === id);
    if (index < 0) this.status.workers.push(worker); else this.status.workers[index] = worker;
  }
}
