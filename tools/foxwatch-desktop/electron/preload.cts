import { contextBridge, ipcRenderer } from 'electron';
import type { AssetRoot, InspectorApi } from '../shared/contracts.js';

function subscribe<T>(
  channel: string,
  callback: (value: T) => void,
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) =>
    callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
const api: InspectorApi = {
  monitor: {
    status: () => ipcRenderer.invoke('monitor:status'),
    info: () => ipcRenderer.invoke('monitor:info'),
    save: value => ipcRenderer.invoke('monitor:save', value),
    credentials: value => ipcRenderer.invoke('monitor:credentials', value),
    action: action => ipcRenderer.invoke('monitor:action', action),
    onStatus: callback => subscribe('monitor:status', callback),
    onView: callback => subscribe('app:view', callback),
  },
  fileManagerName:
    process.platform === 'darwin'
      ? 'Finder'
      : process.platform === 'win32'
        ? 'Explorer'
        : 'File Manager',
  published: (action, scope) =>
    ipcRenderer.invoke('published:action', action, scope),
  onPublished: (callback) => subscribe('published:open', callback),
  onPublishedProgress: (callback) => subscribe('published:progress', callback),
  review: (id, action) => ipcRenderer.invoke('assets:review', id, action),
  onReview: (callback) => subscribe('review:run', callback),
  onReviewProgress: (callback) => subscribe('review:progress', callback),
  getRoot: () => ipcRenderer.invoke('assets:root'),
  chooseRoot: () => ipcRenderer.invoke('assets:choose'),
  list: (id, path) => ipcRenderer.invoke('assets:list', id, path),
  inspect: (id, path) => ipcRenderer.invoke('assets:inspect', id, path),
  preview: (id, path) => ipcRenderer.invoke('assets:preview', id, path),
  contextMenu: (id, path) => ipcRenderer.invoke('assets:context', id, path),
  reveal: (id, path) => ipcRenderer.invoke('assets:reveal', id, path),
  onRootChanged: (callback) => subscribe<AssetRoot>('assets:changed', callback),
  onRefresh: (callback) => subscribe<void>('assets:refresh', callback),
  onToggleSidebar: (callback) => subscribe<void>('assets:sidebar', callback),
};
contextBridge.exposeInMainWorld('foxwatch', api);
