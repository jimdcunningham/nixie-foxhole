import { createHash } from 'node:crypto';

const connectorAssets = new Set(['facilityrefinery1', 'facilityfactoryaircraft', 'facilityfactoryammo', 'facilityvehiclefactory1', 'facilitycrane']);
const wallAssets = new Set(['fortt2', 'fortcornert2', 'mgait2', 'atgunait2']);
const connectorSourcePath = 'War/Content/Meshes/Structures/PowerLineAttachment.glb';
const wallSourcePath = 'War/Content/Meshes/Structures/FortTrenches/FortT2Wall01.glb';
export const MAX_SHARED_MODEL_PARTS = 128;
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, stable(entry)])) : value;
export const sharedPartDigest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');

/** Keep a bounded source-backed trial; no mesh-name-only catalog rollout. */
export async function prepareSpatialSharedParts(assetId, input, { dependencies, settings }) {
    const sourcePath = connectorAssets.has(assetId) ? connectorSourcePath : wallAssets.has(assetId) ? wallSourcePath : undefined;
    if (!sourcePath) return { document: input, parts: [] };
    const document = structuredClone(input), parts = [], assets = new Map((document.assets?.meshes ?? []).map(mesh => [mesh.id, mesh]));
    let ordinal = 0;
    const visit = async (node, visible = true) => {
        visible &&= node.visible !== false;
        const mesh = assets.get(node.meshId);
        if (visible && mesh && (mesh.exportUrl || mesh.sourcePath) === sourcePath) {
            if (node.pose || node.poseVariants || node.attachBoneName || node.debugColor || node.variantIds?.length || node.children?.length)
                throw Error('Shared model trial requires an unposed static source leaf: ' + node.id);
            const canonicalMesh = { ...mesh, id: 'shared-source' };
            const canonical = {
                structure: { id: 'shared-part', name: 'Shared Part' },
                render: { materialMode: document.render?.materialMode, transparentBackground: true, clipFloor: false },
                assets: { meshes: [canonicalMesh], materials: [] },
                scene: { roots: [{ id: 'shared-part', name: 'Shared Part', visible: true, meshId: canonicalMesh.id,
                    location: [0, 0, 0], rotationEulerDegrees: [0, 0, 0], scale: [1, 1, 1], children: [] }] },
            };
            delete canonical.render.clipBounds;
            // File locations are machine-local; only qualified labels and file bytes identify a part.
            const resolved = await dependencies.scene(canonical);
            const content = Object.fromEntries(Object.entries(resolved).map(([label, value]) => [label, value?.[1] ?? null]));
            const digest = sharedPartDigest({ version: 1, mesh: canonicalMesh, render: canonical.render, content, settings });
            const id = 'shared.' + digest, resourceId = 'foxhole.model.' + id, nodeName = 'shared-part-' + String(ordinal++).padStart(4, '0');
            node.spatialSharedPart = { nodeName, resourceId };
            parts.push({ id, resourceId, nodeName, canonical, digest });
            if (parts.length > MAX_SHARED_MODEL_PARTS) throw Error('Shared model trial exceeds 128 placements');
        }
        for (const child of node.children ?? []) await visit(child, visible);
    };
    for (const root of document.scene.roots) await visit(root);
    return { document, parts };
}

export function sharedModelPath(id) {
    if (!/^shared\.[a-f0-9]{64}$/.test(id)) throw Error('Invalid canonical shared model identity');
    return 'shared/models/' + id.slice(7) + '.glb';
}

export function referencedSharedParts(manifest) {
    const references = new Set([...Object.values(manifest.assets ?? {}), ...Object.values(manifest.resources ?? {})]
        .flatMap(model => model.modelParts?.parts ?? []).map(part => part.resourceId));
    return Object.fromEntries(Object.entries(manifest.sharedParts ?? {}).filter(([, part]) => references.has(part.resourceId)));
}

/** Every durable incremental manifest includes the complete currently referenced closure. */
export function mergeSharedPartPublications(manifest, publications) {
    return referencedSharedParts({ ...manifest, sharedParts: { ...manifest.sharedParts, ...publications } });
}
