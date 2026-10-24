import { parseNixieExperimentalAssetPackIndexV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalAssetPackEntryV1 } from '@nixiejs/extension-sdk';
export function createPlannerRemoteResourceIndex(
    bindings: readonly { path: string; source: string; }[],
    library: { files: Map<string, { entry: NixieExperimentalAssetPackEntryV1; }>; entries: Map<string, NixieExperimentalAssetPackEntryV1>; },
) {
    const entries = new Map(library.entries);
    for (const binding of bindings) {
        const location = library.files.get(binding.source);
        if (!location) throw new Error('The pinned release does not contain ' + binding.source);
        const entry = { ...location.entry, path: binding.path, sourcePath: location.entry.sourcePath ?? location.entry.path };
        const previous = entries.get(entry.path);
        if (previous && JSON.stringify(previous) !== JSON.stringify(entry)) throw new Error('Conflicting remote resource alias: ' + entry.path);
        entries.set(entry.path, entry);
    }
    const index = parseNixieExperimentalAssetPackIndexV1({ contractVersion: 1, assets: [...entries.values()].sort((a, b) => a.path.localeCompare(b.path, 'en')) });
    if (new TextEncoder().encode(JSON.stringify(index)).length > 8 * 1024 * 1024) throw new Error('Planner resource aliases exceed the SDK index budget.');
    return index;
}

export { parseNixieExperimentalAssetPackIndexV1 };
