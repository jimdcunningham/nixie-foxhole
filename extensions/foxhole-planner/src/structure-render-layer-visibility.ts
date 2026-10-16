import { isFoxholeBunkerSpotlightLayer } from './bunker-spotlights.ts';

interface FoxholeManifestBuildSocket {
    name: string;
    componentType?: string;
    socketTags?: Array<{ tag?: string; }>;
}
interface FoxholeStructureRenderLayerAsset {
    id: string;
    componentTags?: string[];
}
function normalizeFoxholeBuildSocketName(name: unknown): string {
    const normalized = String(name ?? '').trim().replace(/_GEN_VARIABLE$/i, '');
    return normalized.includes(':') ? normalized.slice(normalized.lastIndexOf(':') + 1).trim() : normalized;
}

function normalizeSocketTag(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase();
}

function resolveFoxholeBuildSocketTagName(
    socket: Pick<FoxholeManifestBuildSocket, 'name' | 'socketTags' | 'componentType'>,
): string | null {
    // Emplacement diagonal sockets share Left/Right compatibility tags with
    // cardinal sockets, but each opens its own independently authored wall.
    if (/^TrenchEmpCommonSockets:/i.test(String(socket.name ?? '').trim())) {
        const direction = normalizeFoxholeBuildSocketName(socket.name).match(/^(FrontRight|FrontLeft|BackRight|BackLeft|Front|Back|Left|Right)Socket$/i)?.[1];
        if (direction) {
            return direction.toLowerCase();
        }
    }

    for (const socketTag of socket.socketTags ?? []) {
        const normalizedTag = normalizeFortVisibilityTag(socketTag.tag)
            ?? normalizeSocketTag(socketTag.tag);
        if (normalizedTag) {
            return normalizedTag;
        }
    }

    const internalSocketName = normalizeFoxholeBuildSocketName(socket.name).toLowerCase();
    if (internalSocketName === 'frontleftinternalsocket' || internalSocketName === 'backrightinternalsocket') {
        return internalSocketName.slice(0, -'socket'.length);
    }

    const fortEntrenchmentTag = resolveFortEntrenchmentSocketVisibilityTag(socket);
    if (fortEntrenchmentTag) {
        return fortEntrenchmentTag;
    }

    const trenchEntrenchmentTag = resolveTrenchSocketVisibilityTag(socket);
    if (trenchEntrenchmentTag) {
        return trenchEntrenchmentTag;
    }

    const socketName = String(socket.name ?? '').trim();
    const match = socketName.match(/^(.+?)Socket(\d*)$/i);
    if (!match?.[1]) {
        return null;
    }

    const baseTag = normalizeSocketTag(match[1]);
    const suffix = match[2] ?? '';
    return suffix ? `${baseTag}${suffix}` : baseTag;
}

function resolveFortEntrenchmentSocketVisibilityTag(
    socket: Pick<FoxholeManifestBuildSocket, 'name' | 'componentType'>,
): string | null {
    const haystack = `${String(socket.name ?? '').trim()}:${String(socket.componentType ?? '').trim()}`.toLowerCase();
    if (haystack.includes('backfort')) {
        return 'back';
    }
    if (haystack.includes('frontfort')) {
        return 'front';
    }
    if (haystack.includes('leftfort')) {
        return 'left';
    }
    if (haystack.includes('rightfort')) {
        return 'right';
    }

    return null;
}

function resolveTrenchSocketVisibilityTag(
    socket: Pick<FoxholeManifestBuildSocket, 'name' | 'componentType'>,
): string | null {
    const socketName = String(socket.name ?? '').trim();
    if (/\w+Socket\d+$/i.test(socketName)) {
        return null;
    }

    const haystack = `${socketName}:${String(socket.componentType ?? '').trim()}`.toLowerCase();
    if (haystack.includes('backsocket')) {
        return 'back';
    }
    if (haystack.includes('frontsocket')) {
        return 'front';
    }
    if (haystack.includes('leftsocket')) {
        return 'left';
    }
    if (haystack.includes('rightsocket')) {
        return 'right';
    }

    return null;
}

export function resolveFoxholeOccupiedSocketTags(
    buildSockets: readonly Pick<FoxholeManifestBuildSocket, 'name' | 'socketTags'>[],
    occupiedSocketKeys: ReadonlySet<string>,
    nodeId: string,
): ReadonlySet<string> {
    const occupiedTags = new Set<string>();
    const normalizedNodeId = String(nodeId ?? '').trim();
    if (!normalizedNodeId) {
        return occupiedTags;
    }

    const occupiedSocketNames = new Set(
        [...occupiedSocketKeys].flatMap(key => {
            const prefix = `${normalizedNodeId}:`;
            if (!key.startsWith(prefix)) {
                return [];
            }

            const socketName = normalizeFoxholeBuildSocketName(key.slice(prefix.length)).toLowerCase();
            return socketName ? [socketName] : [];
        }),
    );

    for (const socket of buildSockets) {
        const socketName = String(socket.name ?? '').trim();
        const socketLookupName = normalizeFoxholeBuildSocketName(socketName).toLowerCase();
        if (!socketLookupName || !occupiedSocketNames.has(socketLookupName)) {
            continue;
        }

        const resolvedTag = resolveFoxholeBuildSocketTagName(socket);
        if (resolvedTag) {
            occupiedTags.add(resolvedTag);
        }
    }

    return occupiedTags;
}

function shouldHideRenderLayerForOccupiedTag(
    layer: Pick<FoxholeStructureRenderLayerAsset, 'componentTags' | 'id'>,
    occupiedTag: string,
    structureCodeName: string | null | undefined,
): boolean {
    const normalizedLayerId = normalizeSocketTag(layer.id);
    const normalizedOccupiedTag = normalizeSocketTag(occupiedTag);
    if (!normalizedOccupiedTag) {
        return false;
    }

    // Corner foundations tag exterior side borders with Center for mesh grouping.
    // Only the diagonal junction trim should hide when the center socket is occupied.
    if (normalizedOccupiedTag === 'center' && normalizedLayerId !== 'centerborder') {
        return false;
    }

    // Concrete intersection corners also form the approach sides between the
    // 3 m interior and 5 m sockets. Removing them opens gaps beside a joined trench.
    if (normalizeSocketTag(structureCodeName) === 'trenchintt3' && normalizedLayerId.startsWith('corner')) {
        return false;
    }

    // Straight trench side attachments swap to open walls but keep corner pillars.
    // Intersections instead remove trim for either adjoining socket direction.
    if (isTrenchCornerRenderLayer(layer, structureCodeName)) {
        return normalizedOccupiedTag === 'back' || normalizedOccupiedTag === 'front';
    }

    return true;
}

function isTrenchCornerRenderLayer(
    layer: Pick<FoxholeStructureRenderLayerAsset, 'componentTags' | 'id'>,
    structureCodeName: string | null | undefined,
): boolean {
    if (!normalizeSocketTag(structureCodeName).startsWith('trench')) {
        return false;
    }

    if (/^trenchintt[123]$/.test(normalizeSocketTag(structureCodeName))) {
        return false;
    }

    if (!normalizeSocketTag(layer.id).startsWith('corner')) {
        return false;
    }

    const rawTags = layer.componentTags ?? [];
    if (rawTags.length === 0) {
        return false;
    }

    // Fort corners use Side* tags; trench corners use plain Back/Front/Left/Right.
    return !rawTags.some(tag => /^side/i.test(String(tag).trim()));
}

function normalizeFortVisibilityTag(value: string | null | undefined): string | null {
    const normalizedTag = normalizeSocketTag(value);
    if (!normalizedTag) {
        return null;
    }

    if (normalizedTag.startsWith('side') && normalizedTag.length > 4) {
        return normalizedTag.slice(4);
    }

    const directionalMatch = normalizedTag.match(/^(back|front|left|right|angle|center)(\d*)(?:hide)?$/);
    if (directionalMatch?.[1]) {
        return `${directionalMatch[1]}${directionalMatch[2] ?? ''}`;
    }

    return null;
}

function isTrenchOpenWallRenderLayer(layerId: string | null | undefined): boolean {
    return normalizeSocketTag(layerId).startsWith('openwall');
}

function resolveLayerSocketVisibilityTags(
    layer: Pick<FoxholeStructureRenderLayerAsset, 'componentTags' | 'id'>,
    structureCodeName: string | null | undefined,
): string[] {
    // These short, non-breachable sides connect through internal corner sockets.
    // Published corner trim has neighboring exterior tags, while the walls have none.
    const structureId = normalizeSocketTag(structureCodeName);
    if (/^trenchempt[123]$/.test(structureId)) {
        return (layer.componentTags ?? []).map(normalizeSocketTag)
            .filter(tag => /^(front|back|left|right|frontright|frontleft|backright|backleft)$/.test(tag));
    }
    if (structureId === 'fortcornert1' || structureId === 'fortcornert2' || structureId === 'fortcornert3') {
        const layerId = normalizeSocketTag(layer.id);
        if (/^cornerfrontleft1?$/.test(layerId)) {
            return layerId === 'cornerfrontleft1' ? ['frontleftinternal', 'angle'] : ['frontleftinternal'];
        }
        if (/^cornerbackright1?$/.test(layerId)) {
            return layerId === 'cornerbackright1' ? ['backrightinternal', 'angle'] : ['backrightinternal'];
        }
        if (layerId === 'wallangle1' || /^dirtcornerfrontleft(?:fort|trench)?$/.test(layerId)) {
            return ['frontleftinternal'];
        }
        if (layerId === 'wallangle2' || /^dirtcornerbackright(?:fort|trench)?$/.test(layerId)) {
            return ['backrightinternal'];
        }
    }
    return (layer.componentTags ?? [])
        .map(tag => normalizeFortVisibilityTag(tag))
        .filter((tag): tag is string => Boolean(tag));
}

function layerMatchesOccupiedSocketTags(
    layer: Pick<FoxholeStructureRenderLayerAsset, 'componentTags' | 'id'>,
    occupiedSocketTags: ReadonlySet<string>,
    structureCodeName: string | null | undefined,
): boolean {
    const componentTags = resolveLayerSocketVisibilityTags(layer, structureCodeName);
    if (componentTags.length === 0) {
        return false;
    }

    return componentTags.some(tag =>
        occupiedSocketTags.has(tag) && shouldHideRenderLayerForOccupiedTag(layer, tag, structureCodeName));
}

// These authored components sit above the interior, but their source names
// do not carry the usual Roof tag. Keep the aliases scoped to each asset.
const additionalRoofLayerIdsByStructure: Readonly<Record<string, readonly string[]>> = {
    fortlargeradar: ['roofmesh', 'skeletalmesh'],
    intelcenter: ['roofbasemesh', 'roofmesh', 'skeletalmesh'],
    lrartillery: ['roofmesh', 'skeletalmesh'],
    weatherstation: ['roofbasemesh', 'roofmesh', 'skeletalmesh', 'staticmesh'],
    fortartillerysheltert2: ['artilleryshelterroof'],
    fortartillerysheltert3: ['artilleryshelterroof'],
    observationbunkert1: ['observationbunkert1', 'teamflagmesh'],
    observationbunkert2: ['observationbunkert2', 'teamflagmesh'],
    observationbunkert3: ['observationbunkert3', 'teamflagmesh'],
    atgunait2: ['basemesh', 'topmesh'],
    atgunait3: ['basemesh', 'topmesh'],
    mgait2: ['basemesh', 'topmesh'],
    mgait3: ['basemesh', 'topmesh'],
    rifleait2: ['basemesh', 'topmesh'],
    rifleait3: ['basemesh', 'topmesh'],
};

export function isFoxholeRoofRenderLayer(
    layer: Pick<FoxholeStructureRenderLayerAsset, 'id' | 'componentTags'>,
    structureCodeName?: string | null,
): boolean {
    const layerId = normalizeSocketTag(layer.id);
    const structureId = normalizeSocketTag(structureCodeName);

    return layerId === 'roof'
        || (structureId.startsWith('artilleryai') && layerId === 'mesh')
        || (structureId.startsWith('medicalroom') && layerId === 'blanket')
        || (additionalRoofLayerIdsByStructure[structureId]?.includes(layerId) ?? false)
        || (layer.componentTags ?? []).some(tag => normalizeSocketTag(tag) === 'roof');
}

export function isFoxholeFloorRenderLayer(
    layer: Pick<FoxholeStructureRenderLayerAsset, 'id'>,
    structureCodeName?: string | null,
): boolean {
    const layerId = normalizeSocketTag(layer.id);
    return layerId === 'floor'
        || (layerId === 'floormesh' && normalizeSocketTag(structureCodeName) === 'weatherstation');
}

export function isFoxholeFloorDetailRenderLayer(
    layer: Pick<FoxholeStructureRenderLayerAsset, 'id'>,
    structureCodeName?: string | null,
): boolean {
    const layerId = normalizeSocketTag(layer.id);
    const structureId = normalizeSocketTag(structureCodeName);

    return layerId === 'ammoroom'
        || (structureId === 'fortbaset1' && layerId === 'floordoor')
        || (
            structureId.startsWith('engineroom')
            && layerId === 'skeletalmesh'
        )
        || (
            structureId.startsWith('fortflame')
            && layerId === 'fortflame'
        )
        || (
            structureId.startsWith('medicalroom')
            && layerId === 'medicalroommesh'
        )
        || (
            structureId.startsWith('fortfirepit')
            && layerId === 'firepitmesh'
        );
}

export function shouldRenderFoxholeRoofAboveWalls(
    layer: Pick<FoxholeStructureRenderLayerAsset, 'id'>,
    structureCodeName?: string | null,
): boolean {
    const structureId = normalizeSocketTag(structureCodeName);
    const layerId = normalizeSocketTag(layer.id);

    // Tier 2/3 bunker bases publish their non-roof geometry as one base layer,
    // so their roofs must draw after that layer to remain visible.
    return ((structureId === 'fortt2' || structureId === 'fortbaset2' || structureId === 'fortbaset3') && layerId === 'roof')
        || (structureId === 'fortcornert2' && layerId === 'fortt2roofangledirt02');
}

export function shouldCompositeFoxholeStructureBaseTexture(
    layers: readonly Pick<FoxholeStructureRenderLayerAsset, 'id'>[],
): boolean {
    return layers.length > 0 && layers.every(layer => isFoxholeFloorRenderLayer(layer));
}

export function isFoxholeTopRenderLayer(
    layer: Pick<FoxholeStructureRenderLayerAsset, 'componentTags'> & Partial<Pick<FoxholeStructureRenderLayerAsset, 'id'>>,
    structureCodeName?: string | null,
): boolean {
    return (layer.componentTags ?? []).some(tag => normalizeSocketTag(tag) === 'top')
        || (
            normalizeSocketTag(structureCodeName).startsWith('atgunai')
            && normalizeSocketTag(layer.id) === 'skelmesh'
        )
        || (
            normalizeSocketTag(structureCodeName).startsWith('mgai')
            && normalizeSocketTag(layer.id) === 'mesh'
        )
        || (
            normalizeSocketTag(structureCodeName).startsWith('fortflame')
            && /^inputmesh\d+$/.test(normalizeSocketTag(layer.id))
        );
}

export type FoxholeStructureRenderLane = 'floor' | 'dirt' | 'roof' | 'walls' | 'corners' | 'spotlight';

export function orderFoxholeStructureRenderLayers<T extends Pick<FoxholeStructureRenderLayerAsset, 'id'>>(
    layers: readonly T[],
    structureCodeName?: string | null,
): readonly T[] {
    if (!/^fortradart[123]$/.test(normalizeSocketTag(structureCodeName))) {
        return layers;
    }
    // The intact radar assembly sits above the opaque concrete roof. Both
    // share the roof lane, so their published alphabetical order is incorrect.
    return [...layers.filter(layer => normalizeSocketTag(layer.id) === 'roof'),
        ...layers.filter(layer => normalizeSocketTag(layer.id) !== 'roof')];
}

export function resolveFoxholeStructureRenderLane(
    layer: Pick<FoxholeStructureRenderLayerAsset, 'id' | 'componentTags'>,
    structureCodeName?: string | null,
): FoxholeStructureRenderLane {
    const layerId = normalizeSocketTag(layer.id);

    // Foundations are ground surfaces: their borders and pillars must stay
    // underneath facilities even when the foundation is placed later.
    if (normalizeSocketTag(structureCodeName).startsWith('foundation')) {
        return 'floor';
    }

    if (isFoxholeBunkerSpotlightLayer(layer, structureCodeName)) {
        return 'spotlight';
    }

    if (isFoxholeFloorRenderLayer(layer, structureCodeName)) {
        return 'floor';
    }
    if (layerId === 'dirt') {
        return 'dirt';
    }
    if (layerId === 'roof') {
        return shouldRenderFoxholeRoofAboveWalls(layer, structureCodeName) ? 'walls' : 'roof';
    }
    if (layerId === 'corners') {
        return 'corners';
    }
    if (isFoxholeFloorDetailRenderLayer(layer, structureCodeName)) {
        return 'floor';
    }
    if (isFoxholeDirtRenderLayer(layer)) {
        return 'dirt';
    }
    if (/^trench(?:int|emp)?t[123]$/.test(normalizeSocketTag(structureCodeName)) && isFoxholeCornerRenderLayer(layer)) {
        return 'corners';
    }
    if (isFoxholeTopRenderLayer(layer, structureCodeName)) {
        return 'corners';
    }
    if (shouldRenderFoxholeRoofAboveWalls(layer, structureCodeName)) {
        return 'walls';
    }
    if (isFoxholeRoofRenderLayer(layer)) {
        return 'roof';
    }
    return 'walls';
}

export function isFoxholeWallRenderLayer(
    layer: Pick<FoxholeStructureRenderLayerAsset, 'id' | 'componentTags'>,
): boolean {
    const layerId = normalizeSocketTag(layer.id);

    return layerId.includes('wall')
        || layerId === 'sideleft'
        || layerId === 'sideright'
        || (layer.componentTags ?? []).some(tag => normalizeSocketTag(tag) === 'wall');
}

export function isFoxholeDirtRenderLayer(
    layer: Pick<FoxholeStructureRenderLayerAsset, 'id' | 'componentTags'>,
): boolean {
    return normalizeSocketTag(layer.id).startsWith('dirt')
        || (layer.componentTags ?? []).some(tag => normalizeSocketTag(tag) === 'dirt');
}

export function isFoxholeCornerRenderLayer(
    layer: Pick<FoxholeStructureRenderLayerAsset, 'id' | 'componentTags'>,
): boolean {
    return !isFoxholeDirtRenderLayer(layer)
        && (normalizeSocketTag(layer.id).includes('corner')
            || (layer.componentTags ?? []).some(tag => normalizeSocketTag(tag) === 'corner'));
}

export function shouldShowFoxholeStructureRenderLayer(
    layer: Pick<FoxholeStructureRenderLayerAsset, 'componentTags' | 'id'>,
    occupiedSocketTags: ReadonlySet<string>,
    options?: {
        hideRoofs?: boolean;
        hideFloors?: boolean;
        hideWalls?: boolean;
        hideDirt?: boolean;
        hideCorners?: boolean;
        structureCodeName?: string | null;
    },
): boolean {
    if (/^trenchempt[123]$/i.test(String(options?.structureCodeName ?? '').trim()) && isFoxholeDirtRenderLayer(layer)) {
        return false;
    }
    if (options?.hideRoofs === true && isFoxholeRoofRenderLayer(layer, options.structureCodeName)) {
        return false;
    }

    if (options?.hideFloors === true && isFoxholeFloorRenderLayer(layer, options.structureCodeName)) {
        return false;
    }

    if (options?.hideWalls === true && isFoxholeWallRenderLayer(layer)) {
        return false;
    }

    if (options?.hideDirt === true && isFoxholeDirtRenderLayer(layer)) {
        return false;
    }

    if (options?.hideCorners === true && isFoxholeCornerRenderLayer(layer)) {
        return false;
    }

    const componentTags = resolveLayerSocketVisibilityTags(layer, options?.structureCodeName);
    if (componentTags.length === 0) {
        return true;
    }

    const matchesOccupied = layerMatchesOccupiedSocketTags(
        layer,
        occupiedSocketTags,
        options?.structureCodeName,
    );
    if (isTrenchOpenWallRenderLayer(layer.id)) {
        return matchesOccupied;
    }

    return !matchesOccupied;
}
