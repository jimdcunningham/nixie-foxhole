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
  getRoot: () => ipcRenderer.invoke('assets:root'),
  chooseRoot: () => ipcRenderer.invoke('assets:choose'),
  list: (id, path) => ipcRenderer.invoke('assets:list', id, path),
  inspect: (id, path) => ipcRenderer.invoke('assets:inspect', id, path),
  contextMenu: (id, path) => ipcRenderer.invoke('assets:context', id, path),
  reveal: (id, path) => ipcRenderer.invoke('assets:reveal', id, path),
  onRootChanged: (callback) => subscribe<AssetRoot>('assets:changed', callback),
  onRefresh: (callback) => subscribe<void>('assets:refresh', callback),
  onToggleSidebar: (callback) => subscribe<void>('assets:sidebar', callback),
};
contextBridge.exposeInMainWorld('foxwatch', api);
