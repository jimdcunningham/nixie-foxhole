export interface AssetRoot {
  id: string;
  name: string;
  path: string;
}
export type AssetKind = 'image' | 'model' | 'data' | 'text' | 'audio' | 'file';
export interface AssetEntry {
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
  getRoot(): Promise<AssetRoot | null>;
  chooseRoot(): Promise<AssetRoot | null>;
  list(rootId: string, path: string): Promise<AssetEntry[]>;
  inspect(rootId: string, path: string): Promise<AssetDetails>;
  contextMenu(rootId: string, path: string): Promise<void>;
  reveal(rootId: string, path: string): Promise<void>;
  onRootChanged(callback: (root: AssetRoot) => void): () => void;
  onRefresh(callback: () => void): () => void;
  onToggleSidebar(callback: () => void): () => void;
}
