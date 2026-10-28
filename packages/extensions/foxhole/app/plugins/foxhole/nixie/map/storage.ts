import localforage from 'localforage';
import { createFoxholeObserverMapStorage, isFoxholeObserverDocument, selectFoxholeObserverWarData } from './memory-storage.mjs';

// An observer is a separate document, but same-origin IndexedDB is shared with
// the editor. Copy safe cached data on demand, then keep all writes local.
const observer = isFoxholeObserverDocument(typeof window === 'undefined' ? undefined : window);
const warStorage = localforage.createInstance({ name: 'warAPI' });
const playbackStorage = localforage.createInstance({ name: 'warAPI', storeName: 'playbackFrames' });

export const foxholeWarApiStorage = observer
    ? createFoxholeObserverMapStorage(warStorage, selectFoxholeObserverWarData)
    : warStorage;

export const foxholePlaybackFrameStorage = observer
    ? createFoxholeObserverMapStorage(playbackStorage)
    : playbackStorage;
