export type AppView = 'inspector' | 'dashboard' | 'workers' | 'settings';
export type RunOperation = 'poll' | 'refresh' | 'clear-cache' | 'prepare' | 'check' | 'publish';
export interface RunStatus {
  running: boolean; polling: boolean; operation: RunOperation | null;
  stage: string; detail: string; percent: number; startedAt: number | null; finishedAt: number | null; nextPollAt: number | null;
  rendered: number; renderTotal: number; exported: number; exportTotal: number;
  workers: { type: string; id: string; detail: string; completed: number; total: number }[];
  logs: string[];
}
export interface ToolSettings {
  nodePath: string; intervalMinutes: number; steamUsername: string; blenderPath: string;
  minimumAvailableMemoryGiB: number; nixieEnabled: boolean; startMinimized: boolean; startWithWindows: boolean;
  assetsRoot: string; outputRoot: string; endpoint: string; bucket: string; publicBaseUrl: string; prefix: string; concurrency: number;
}
export interface ToolInfo {
  settings: ToolSettings; windows: boolean; legacyRunning: boolean;
  steamCredentials: boolean; notificationCredentials: boolean; assetCredentials: boolean;
  latestBuild: string; successfulBuild: string; lastError: string | null;
  prepared: { planPath: string; releaseUrl: string; files: number; bytes: number } | null;
}
export interface CredentialInput { steamPassword?: string; webhook?: string; accessKeyId?: string; secretAccessKey?: string }
export interface MonitorApi {
  status(): Promise<RunStatus>;
  info(): Promise<ToolInfo>;
  save(settings: ToolSettings): Promise<ToolInfo>;
  credentials(input: CredentialInput): Promise<ToolInfo>;
  action(action: RunOperation | 'start' | 'pause' | 'cancel' | 'logs' | 'output' | 'retire'): Promise<void>;
  onStatus(callback: (status: RunStatus) => void): () => void;
  onView(callback: (view: AppView) => void): () => void;
}
