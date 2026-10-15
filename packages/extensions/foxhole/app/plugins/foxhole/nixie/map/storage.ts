import localforage from 'localforage';

export const foxholeWarApiStorage = localforage.createInstance({
    name: 'warAPI',
});

export const foxholePlaybackFrameStorage = localforage.createInstance({
    name: 'warAPI',
    storeName: 'playbackFrames',
});
