import type { NixieExtensionGraphicsCommandV1, NixieExtensionRenderNodeV1, NixieExperimentalSpatialMarkerV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { resolveFoxholeEffectiveStructureSocketSources } from './effective-structure-sockets.ts';
import type { FoxholeBunkerStatisticsSocket } from './bunker-statistics-sockets.ts';
import type { FoxholeSceneV2AssetMetadata, FoxholeSceneV2ModificationVariantMetadata } from './scene-v2-asset-metadata.ts';
import { FOXHOLE_STRUCTURE_RENDER_LANES, foxholeRenderLane } from './render-lanes.ts';

export const FOXHOLE_SOCKET_DISPLAY_SETTING_IDS = ['foxhole.debug.structure.powerSockets', 'foxhole.debug.structure.pipeSockets', 'foxhole.debug.structure.socketLabels'] as const;
export const FOXHOLE_ALL_SOCKETS_SETTING_ID = 'foxhole.debug.structure.allSockets';
export type FoxholeSocketDisplayKind = 'power' | 'pipe' | 'generic';
export type FoxholePipeDisplayFlow = 'input' | 'output' | 'bidirectional';
export const FOXHOLE_POWER_SOCKET_COLOR = 0xFFD800;
export const FOXHOLE_PIPE_SOCKET_COLORS = { input: 0xFF2A2A, output: 0x3DDC4E, bidirectional: 0x3D8BFF };

/** Use the same effective socket sources and visibility rules as the flat view, retaining authored height. */
export function renderFoxholeSpatialSocketMarkers(asset: FoxholeSceneV2AssetMetadata,
    variants: readonly FoxholeSceneV2ModificationVariantMetadata[], attachments: unknown,
    settings: Readonly<Record<string, boolean>>, appearance: { destroyed: boolean; packaged: boolean; }): NixieExperimentalSpatialMarkerV1[] {
    if (appearance.destroyed || appearance.packaged) {
        return [];
    }
    const occupied = new Set(Array.isArray(attachments)
        ? attachments.flatMap(value => value && typeof value === 'object'
            && !Array.isArray(value) && typeof value.localSocketName === 'string'
            ? [value.localSocketName]
            : [])
        : []);
    // Power sockets may accept multiple cables; a single occupied row does not necessarily exhaust the port.
    if (Array.isArray(attachments)) {
        for (const socket of resolveFoxholeEffectiveStructureSocketSources(asset, variants)) {
            const count = attachments.filter(value => value && typeof value === 'object' && !Array.isArray(value)
                && value.localSocketName === socket.name).length;
            if (resolveFoxholeSocketDisplayKind(socket) === 'power' && count < Math.max(1, asset.powerSocketMaxConnections ?? 1)) {
                occupied.delete(socket.name);
            }
        }
    }
    const markers: NixieExperimentalSpatialMarkerV1[] = resolveFoxholeStructureDisplaySockets(asset, variants, occupied, settings).slice(0, 128).map((entry, index) => ({
        id: `socket-${index}`, point: [entry.x, entry.y, Number(entry.socket.z ?? 0) * 0.32],
        color: entry.kind === 'power' ? FOXHOLE_POWER_SOCKET_COLOR : FOXHOLE_PIPE_SOCKET_COLORS[entry.flow], label: entry.socket.name.slice(0, 128),
    }));
    for (const socket of resolveFoxholeEffectiveStructureSocketSources(asset, variants)) {
        if (settings[FOXHOLE_ALL_SOCKETS_SETTING_ID] !== true || markers.length >= 128 || resolveFoxholeSocketDisplayKind(socket) !== 'generic' || occupied.has(socket.name)
            || !socket.socketTags.some(tag => tag.mask > 0 && tag.category > 0)) continue;
        markers.push({ id: `socket-${markers.length}`, point: [Number(socket.x ?? 0) * 0.32, Number(socket.y ?? 0) * 0.32, Number(socket.z ?? 0) * 0.32],
            color: 0x9bd3df, label: socket.name.slice(0, 128) });
    }
    return markers;
}

export function resolveFoxholeSocketDisplayKind(socket: FoxholeBunkerStatisticsSocket): FoxholeSocketDisplayKind {
    const tags = socket.socketTags.filter(tag => Number.isSafeInteger(tag.mask) && tag.mask > 0 && Number.isSafeInteger(tag.category) && tag.category > 0);
    if (socket.name.includes('PowerSocket') || String(socket.componentType ?? '').includes('Power')
        || tags.some(tag => (BigInt(tag.mask) & 131072n) !== 0n)) {
        return 'power';
    }
    if (String(socket.pipeType ?? '').trim() || /Pipe(?:Input|Output)/i.test(socket.name) || String(socket.componentType ?? '').includes('Pipeline')
        || tags.some(tag => (tag.category === 2048 && [16795648, 16779264].includes(tag.mask))
            || (tag.category === 16384 && [2048, 16779264].includes(tag.mask)) || (tag.category === 16777216 && tag.mask === 18432))) {
        return 'pipe';
    }
    return 'generic';
}

export function resolveFoxholeSocketDisplayFlow(socket: FoxholeBunkerStatisticsSocket): FoxholePipeDisplayFlow {
    const type = String(socket.pipeType ?? '').trim().toLowerCase();
    return type === 'input' || type === 'output' ? type : 'bidirectional';
}

export function resolveFoxholeStructureDisplaySockets(asset: FoxholeSceneV2AssetMetadata,
    variants: readonly FoxholeSceneV2ModificationVariantMetadata[], occupied: ReadonlySet<string>, settings: Readonly<Record<string, boolean>>) {
    const raw = resolveFoxholeEffectiveStructureSocketSources(asset, variants);
    return raw.flatMap(socket => {
        const kind = resolveFoxholeSocketDisplayKind(socket);
        if (occupied.has(socket.name) || (kind === 'power' && settings[FOXHOLE_SOCKET_DISPLAY_SETTING_IDS[0]] === false)
            || (kind === 'pipe' && settings[FOXHOLE_SOCKET_DISPLAY_SETTING_IDS[1]] === false) || kind === 'generic') {
            return [];
        }
        const x = Number(socket.x ?? 0) / 100 * 32;
        const y = Number(socket.y ?? 0) / 100 * 32;
        const rotation = Number(socket.rotation ?? 0) * Math.PI / 180;
        if (![x, y, rotation].every(Number.isFinite)) {
            return [];
        }
        return [{ socket, kind, x, y, rotation, flow: resolveFoxholeSocketDisplayFlow(socket) }];
    });
}

function socketLabel(name: string, componentType: string | null | undefined, fallback: string): string {
    const value = name.trim() || String(componentType ?? '').trim();
    const stripped = value.slice(value.lastIndexOf(':') + 1).replace(/_C$/i, '').replace(/Component$/i, '').replace(/_GEN_VARIABLE$/i, '');
    return stripped.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim() || stripped || fallback;
}

function pipeCommands(flow: FoxholePipeDisplayFlow): NixieExtensionGraphicsCommandV1[] {
    const left = 9;
    const right = left + (flow === 'bidirectional' ? 32 : 22);
    const commands: NixieExtensionGraphicsCommandV1[] = [
        { op: 'rect', x: 0, y: -13, width: 5, height: 26 }, { op: 'fill', color: FOXHOLE_PIPE_SOCKET_COLORS[flow], alpha: 1 },
        { op: 'move-to', x: flow === 'output' ? left : left + 10, y: 0 },
        { op: 'line-to', x: flow === 'input' ? right : right - 10, y: 0 },
        { op: 'stroke', color: 0xffffff, width: 5, alpha: 1, cap: 'butt', join: 'miter' },
    ];
    const head = (tip: number, direction: number) => {
        commands.push({ op: 'polygon', points: [{ x: tip, y: 0 }, { x: tip - direction * 10, y: -7 }, { x: tip - direction * 10, y: 7 }], close: true },
            { op: 'fill', color: 0xffffff, alpha: 1 });
    };
    if (flow !== 'output') {
        head(left, -1);
    }
    if (flow !== 'input') {
        head(right, 1);
    }
    return commands;
}

// Bootstrap Icons lightning (MIT), matching the bundled source path's Pixi
// 8.20.1 polygon. Rounded SVG arcs are flattened once, without a runtime SVG
// parser or a texture resource. https://github.com/twbs/icons/blob/main/LICENSE.md
export const FOXHOLE_SOCKET_LIGHTNING_POINTS: readonly number[] = [5.52, 0.359, 5.590193497134145, 0.21305515518997964, 5.840168545091762, 0.026094650571678736, 6, 0, 10, 0, 10.117894829321138, 0.014183720608598602, 10.32496572111496, 0.12032025151425021, 10.405317445078234, 0.2077500471624889, 10.462797233059163, 0.31165597906548465, 10.497886169079628, 0.5416822471087837, 10.474, 0.658, 8.694, 6, 12.5, 6, 12.639007474731402, 6.019593886682177, 12.870645491504568, 6.164000310792449, 12.949436742150004, 6.280185237733269, 12.992857016013582, 6.413683096308331, 12.964800522610533, 6.685201455387136, 12.895, 6.807, 5.895, 15.807, 5.764905698601395, 15.924837840090351, 5.436424491928209, 15.997005359845184, 5.268916857187877, 15.94455084509908, 5.129782364283831, 15.837537403429895, 5.000234798392308, 15.527173935514263, 5.0219999999999985, 15.353, 6.823, 9.5, 3.5, 9.5, 3.3842112915609115, 9.486483597122394, 3.1797550324957653, 9.384234560456305, 3.0994825142746736, 9.299700301323178, 3.040956942272541, 9.198881277470704, 3.0003826899393067, 8.973912485373543, 3.02, 8.859];
const LIGHTNING_POINTS = FOXHOLE_SOCKET_LIGHTNING_POINTS;

export function renderFoxholeSocketIndicatorGroups(sockets: ReturnType<typeof resolveFoxholeStructureDisplaySockets>,
    showLabels: boolean, prefixBase = 'structure-socket', rawNames = false): NixieExtensionRenderNodeV1[] {
    const children = sockets.map((entry, index): NixieExtensionRenderNodeV1 => {
        const prefix = `${prefixBase}-${index}`;
        const content: NixieExtensionRenderNodeV1[] = entry.kind === 'power'
            ? [{ id: `${prefix}-square`, kind: 'graphics', commands: [
                { op: 'rect', x: -4.5, y: -4.5, width: 9, height: 9 }, { op: 'fill', color: FOXHOLE_POWER_SOCKET_COLOR, alpha: 1 },
            ] }, { id: `${prefix}-bolt`, kind: 'group', experimentalPresentation: { contractVersion: 1, worldUpright: true }, children: [{
                id: `${prefix}-bolt-path`, kind: 'graphics', x: -11, y: -30.5, scaleX: 22 / 16, scaleY: 22 / 16,
                commands: [{ op: 'polygon', points: Array.from({ length: LIGHTNING_POINTS.length / 2 }, (_, point) => ({ x: LIGHTNING_POINTS[point * 2]!, y: LIGHTNING_POINTS[point * 2 + 1]! })), close: true },
                    { op: 'fill', color: 0xffffff, alpha: 1 }],
            }] }]
            : [{ id: `${prefix}-pipe`, kind: 'graphics', commands: pipeCommands(entry.flow) }];
        if (showLabels) {
            const directionX = Math.cos(entry.rotation);
            const side = directionX >= 0 ? 1 : -1;
            content.push({ id: `${prefix}-label`, kind: 'text', text: rawNames ? entry.socket.name : socketLabel(entry.socket.name, entry.socket.componentType, entry.kind),
                x: directionX * 36 + side * 6, y: Math.sin(entry.rotation) * 36 - 10, anchorX: side > 0 ? 0 : 1, anchorY: 0.5,
                experimentalPresentation: { contractVersion: 1, worldUpright: true }, style: { fontFamily: 'monospace', fontSize: 11, fontWeight: '700',
                    fill: entry.kind === 'power' ? FOXHOLE_POWER_SOCKET_COLOR : FOXHOLE_PIPE_SOCKET_COLORS[entry.flow],
                    experimentalStroke: { contractVersion: 1, color: 0x081018, width: 3, join: 'round' } } });
        }
        return { id: prefix, kind: 'group', x: entry.x, y: entry.y, rotation: entry.rotation, children: content };
    });
    return children;
}

export function renderFoxholeStructureSocketOverlays(asset: FoxholeSceneV2AssetMetadata,
    variants: readonly FoxholeSceneV2ModificationVariantMetadata[], attachments: unknown,
    settings: Readonly<Record<string, boolean>>, appearance: { destroyed: boolean; packaged: boolean; }): NixieExtensionRenderNodeV1[] {
    if (appearance.destroyed || appearance.packaged) {
        return [];
    }
    const occupied = new Set(Array.isArray(attachments)
        ? attachments.flatMap(value => value && typeof value === 'object'
            && !Array.isArray(value) && typeof value.localSocketName === 'string'
            ? [value.localSocketName]
            : [])
        : []);
    const sockets = resolveFoxholeStructureDisplaySockets(asset, variants, occupied, settings);
    if (!sockets.length) {
        return [];
    }
    const children = renderFoxholeSocketIndicatorGroups(sockets, settings[FOXHOLE_SOCKET_DISPLAY_SETTING_IDS[2]] === true);
    return [{ id: 'structure-socket-overlays', kind: 'group', ...foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug),
        experimentalPresentation: { contractVersion: 1, excludeFromBounds: true }, children }];
}
