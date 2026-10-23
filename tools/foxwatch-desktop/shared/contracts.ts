export interface AssetRoot {
  id: string;
  name: string;
  path: string;
}
export type AssetKind = 'image' | 'model' | 'data' | 'text' | 'audio' | 'file';
export type AssetChange = 'added' | 'modified' | 'deleted';
export interface ReviewSummary {
  approvedAt: string | null;
  comparedAt: string | null;
  added: number;
  modified: number;
  deleted: number;
  unchanged: number;
}
export interface AssetEntry {
  change?: AssetChange;
  fromBaseline?: boolean;
  path: string;
  name: string;
  label: string;
  directory: boolean;
  kind: AssetKind;
}
export interface AssetDetails extends AssetEntry {
  absolutePath: string;
  bytes: number;
  modifiedAt: string;
  extension: string;
}
export interface InspectorApi {
  monitor: import('./monitor.js').MonitorApi;
  fileManagerName: string;
  published(
    action: 'info' | 'check' | 'download' | 'cancel' | 'open',
    scope: PublishedScope,
  ): Promise<PublishedStatus>;
  onPublished(callback: () => void): () => void;
  onPublishedProgress(callback: (value: PublishedStatus) => void): () => void;
  review(
    rootId: string,
    action: 'summary' | 'approve' | 'compare',
  ): Promise<ReviewSummary>;
  onReview(callback: (action: 'approve' | 'compare') => void): () => void;
  onReviewProgress(
    callback: (progress: {
      phase: string;
      completed: number;
      total: number;
    }) => void,
  ): () => void;
  getRoot(): Promise<AssetRoot | null>;
  chooseRoot(): Promise<AssetRoot | null>;
  list(rootId: string, path: string): Promise<AssetEntry[]>;
  inspect(rootId: string, path: string): Promise<AssetDetails>;
  preview(rootId: string, path: string): Promise<AssetPreview>;
  contextMenu(rootId: string, path: string): Promise<void>;
  reveal(rootId: string, path: string): Promise<void>;
  onRootChanged(callback: (root: AssetRoot) => void): () => void;
  onRefresh(callback: () => void): () => void;
  onToggleSidebar(callback: () => void): () => void;
}

export type AssetPreview =
  | { type: 'image' | 'model'; bytes: Uint8Array; mime: string }
  | { type: 'text'; text: string; truncated: boolean; json: boolean }
  | { type: 'unsupported'; message: string };

export interface ReleaseReceipt {
  url: string;
  sha256: string;
  byteLength: number;
}
export type PublishedScope = 'all' | 'catalog';
export interface PublishedInfo {
  release: ReleaseReceipt;
  source: 'channel' | 'bundled';
  scope: PublishedScope;
  files: number;
  bytes: number;
  downloadedAt: string;
  assetsPath: string;
  baseUrl: string;
}
export interface PublishedStatus {
  phase: 'idle' | 'checking' | 'ready' | 'downloading' | 'complete' | 'error';
  current: PublishedInfo | null;
  candidate: Omit<PublishedInfo, 'downloadedAt' | 'assetsPath'> | null;
  completed: number;
  reused: number;
  message: string;
}
