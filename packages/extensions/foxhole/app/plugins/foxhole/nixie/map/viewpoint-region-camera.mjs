// A viewpoint supplies its own camera; selecting its region must not fit over it.
const pendingSelections = new WeakMap();
export function preserveViewpointRegionCamera(runtime, regionKeys) {
    pendingSelections.set(runtime, regionKeys.split(',').map(key => key.trim()).filter(Boolean).sort().join('|'));
}
export function consumeViewpointRegionCamera(runtime, selection) {
    if (!pendingSelections.has(runtime)) return false;
    const pending = pendingSelections.get(runtime);
    pendingSelections.delete(runtime);
    return pending === selection;
}
