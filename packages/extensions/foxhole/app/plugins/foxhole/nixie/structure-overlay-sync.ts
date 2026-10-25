import * as PIXI from 'pixi.js';
import { watch } from 'vue';
import type { WatchStopHandle } from 'vue';
import {
    activeNixiePlacementPreviewTransforms,
    activeNixieStructureModificationHoverPreview,
    activeNixieViewport,
} from '#nixie/plugins/nixie/runtime/shared-state.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import type { FoxholeStructureNode } from '#foxhole/plugins/nixie/board/types/foxhole-structure.ts';
import { FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS } from '#foxhole/plugins/foxhole/nixie/structure-debug-settings.ts';
import { boardPerfMeasure } from '#nixie/utils/nixie-board-perf.ts';
import {
    buildFoxholeSocketNetworkIndex,
    resolveFoxholeSocketNetworkUnionForNode,
} from './structure-socket-networks.ts';
import type { FoxholeSocketNetworkIndex } from './structure-socket-networks.ts';

export interface FoxholeStructureOverlaySyncContext {
    hoveredNodeId: string | null;
    showAllSockets: boolean;
}

const mountedStructures = new Set<FoxholeStructureNode>();
const dirtyStructures = new Set<FoxholeStructureNode>();
const structuresById = new Map<string, FoxholeStructureNode>();
type FoxholeRoofHoverHost = PIXI.Container & Pick<FoxholeStructureNode,
    'boardId' | 'containsWorldPoint' | 'getBunkerRoofHoverNetworkNode' | 'setBunkerRoofHoverFaded' | 'advanceBunkerRoofHoverFade'>;
const roofHoverHostsById = new Map<string, FoxholeRoofHoverHost>();
const fadedBunkerRoofIds = new Set<string>();
const fadingBunkerRoofs = new Set<FoxholeRoofHoverHost>();
let bunkerNetworkIndex: FoxholeSocketNetworkIndex | null = null;
let bunkerNetworkDirty = true;
let bunkerHoverFrame = 0;
let bunkerHoverPoint: { canvas: HTMLCanvasElement; x: number; y: number; } | null = null;
let bunkerHoverListenersInstalled = false;
let bunkerRoofFadeTickerInstalled = false;

let tickerInstalled = false;
let watchersInstalled = false;
let watcherStops: WatchStopHandle[] = [];

function tickBunkerRoofFades(ticker: PIXI.Ticker): void {
    for (const structure of fadingBunkerRoofs) {
        if (structure.destroyed || roofHoverHostsById.get(String(structure.boardId)) !== structure
            || !structure.advanceBunkerRoofHoverFade(ticker.deltaMS)) {
            fadingBunkerRoofs.delete(structure);
        }
    }
    if (fadingBunkerRoofs.size === 0) {
        PIXI.Ticker.shared.remove(tickBunkerRoofFades);
        bunkerRoofFadeTickerInstalled = false;
    }
}

function setBunkerRoofHoverFaded(nodeId: string, faded: boolean): void {
    const structure = roofHoverHostsById.get(nodeId);
    if (!structure || !structure.setBunkerRoofHoverFaded(faded)) {
        return;
    }
    fadingBunkerRoofs.add(structure);
    if (!bunkerRoofFadeTickerInstalled) {
        PIXI.Ticker.shared.add(tickBunkerRoofFades);
        bunkerRoofFadeTickerInstalled = true;
    }
}

function clearBunkerRoofHover(): void {
    bunkerHoverPoint = null;
    if (bunkerHoverFrame) {
        cancelAnimationFrame(bunkerHoverFrame);
        bunkerHoverFrame = 0;
    }
    for (const nodeId of fadedBunkerRoofIds) {
        setBunkerRoofHoverFaded(nodeId, false);
    }
    fadedBunkerRoofIds.clear();
}

function updateBunkerRoofHover(): void {
    bunkerHoverFrame = 0;
    const point = bunkerHoverPoint;
    const viewport = activeNixieViewport.value;
    if (!point || !viewport || document.elementFromPoint(point.x, point.y) !== point.canvas) {
        clearBunkerRoofHover();
        return;
    }

    if (bunkerNetworkDirty || !bunkerNetworkIndex) {
        bunkerNetworkIndex = buildFoxholeSocketNetworkIndex(
            [...roofHoverHostsById.values()]
                .filter(structure => !structure.destroyed)
                .flatMap(structure => structure.getBunkerRoofHoverNetworkNode() ?? []),
            'roof-hover',
        );
        bunkerNetworkDirty = false;
    }

    const bounds = point.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) {
        clearBunkerRoofHover();
        return;
    }
    const world = viewport.toWorld(new PIXI.Point(
        (point.x - bounds.left) * viewport.screenWidth / bounds.width,
        (point.y - bounds.top) * viewport.screenHeight / bounds.height,
    ));
    let hoveredId: string | null = null;
    for (const nodeId of bunkerNetworkIndex.unionIdByNodeId.keys()) {
        const structure = roofHoverHostsById.get(nodeId);
        if (!structure || structure.destroyed) {
            continue;
        }
        let parent: PIXI.Container | null = structure;
        while (parent && parent !== viewport) {
            parent = parent.parent;
        }
        if (parent === viewport && structure.containsWorldPoint(world, { viewport, worldPerPx: 1 / viewport.scale.x })) {
            hoveredId = nodeId;
        }
    }

    const union = hoveredId ? resolveFoxholeSocketNetworkUnionForNode(bunkerNetworkIndex, hoveredId) : null;
    const nextIds = new Set(union?.memberNodeIds ?? []);
    for (const nodeId of fadedBunkerRoofIds) {
        if (!nextIds.has(nodeId)) {
            setBunkerRoofHoverFaded(nodeId, false);
        }
    }
    for (const nodeId of nextIds) {
        if (!fadedBunkerRoofIds.has(nodeId)) {
            setBunkerRoofHoverFaded(nodeId, true);
        }
    }
    fadedBunkerRoofIds.clear();
    for (const nodeId of nextIds) {
        fadedBunkerRoofIds.add(nodeId);
    }
}

function onBunkerRoofPointerMove(event: PointerEvent): void {
    const canvas = event.target;
    if (event.buttons || !(canvas instanceof HTMLCanvasElement)
        || document.elementFromPoint(event.clientX, event.clientY) !== canvas) {
        clearBunkerRoofHover();
        return;
    }
    bunkerHoverPoint = { canvas, x: event.clientX, y: event.clientY };
    queueBunkerRoofHoverUpdate();
}

function queueBunkerRoofHoverUpdate(): void {
    if (bunkerHoverPoint && !bunkerHoverFrame) {
        bunkerHoverFrame = requestAnimationFrame(updateBunkerRoofHover);
    }
}

function onBunkerRoofWheel(event: WheelEvent): void {
    const canvas = event.target;
    if (!(canvas instanceof HTMLCanvasElement)
        || document.elementFromPoint(event.clientX, event.clientY) !== canvas) {
        clearBunkerRoofHover();
        return;
    }
    bunkerHoverPoint = { canvas, x: event.clientX, y: event.clientY };
    queueBunkerRoofHoverUpdate();
}

function onBunkerRoofPointerDown(event: PointerEvent): void {
    const canvas = event.target;
    if (event.button === 0 && canvas instanceof HTMLCanvasElement
        && document.elementFromPoint(event.clientX, event.clientY) === canvas) {
        return;
    }
    clearBunkerRoofHover();
}

function installBunkerRoofHoverListeners(): void {
    if (bunkerHoverListenersInstalled || typeof window === 'undefined') {
        return;
    }
    window.addEventListener('pointermove', onBunkerRoofPointerMove, true);
    window.addEventListener('pointerdown', onBunkerRoofPointerDown, true);
    window.addEventListener('wheel', onBunkerRoofWheel, true);
    window.addEventListener('blur', clearBunkerRoofHover);
    bunkerHoverListenersInstalled = true;
}

function uninstallBunkerRoofHoverListeners(): void {
    if (!bunkerHoverListenersInstalled) {
        return;
    }
    window.removeEventListener('pointermove', onBunkerRoofPointerMove, true);
    window.removeEventListener('pointerdown', onBunkerRoofPointerDown, true);
    window.removeEventListener('wheel', onBunkerRoofWheel, true);
    window.removeEventListener('blur', clearBunkerRoofHover);
    bunkerHoverListenersInstalled = false;
    clearBunkerRoofHover();
}

function resolveOverlaySyncContext(): FoxholeStructureOverlaySyncContext {
    const preview = activeNixieStructureModificationHoverPreview.value;
    const settingsStore = useNixieSettingsStore();

    return {
        hoveredNodeId: preview?.nodeId ? String(preview.nodeId) : null,
        showAllSockets: settingsStore.getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.allSockets, false) === true,
    };
}

function markDirtyById(nodeId: string): void {
    const structure = structuresById.get(String(nodeId));
    if (!structure || structure.destroyed) {
        return;
    }

    dirtyStructures.add(structure);
    ensureStructureOverlaySyncTicker();
}

function ensureOverlaySyncWatchers(): void {
    if (watchersInstalled) {
        return;
    }

    watchersInstalled = true;
    watcherStops = [
        watch(activeNixieViewport, (viewport, _previous, onCleanup) => {
            clearBunkerRoofHover();
            viewport?.on('moved', queueBunkerRoofHoverUpdate);
            viewport?.on('zoomed', queueBunkerRoofHoverUpdate);
            onCleanup(() => {
                viewport?.off('moved', queueBunkerRoofHoverUpdate);
                viewport?.off('zoomed', queueBunkerRoofHoverUpdate);
            });
        }, { immediate: true }),
        watch(activeNixieStructureModificationHoverPreview, (next, prev) => {
            if (prev?.nodeId) {
                markDirtyById(String(prev.nodeId));
            }
            if (next?.nodeId) {
                markDirtyById(String(next.nodeId));
            }
        }),
        watch(activeNixiePlacementPreviewTransforms, (next, prev) => {
            const nextIds = Object.keys(next ?? {});
            const prevIds = Object.keys(prev ?? {});
            if (nextIds.length === 1) {
                const movingStructure = structuresById.get(nextIds[0]!);
                if (movingStructure && !movingStructure.destroyed) {
                    // Browser placement uses a transient preview transform rather
                    // than SelectionTool. Keep its LOS in the same fill-only live
                    // mode, so outlines wait for the placement to settle.
                    syncFoxholeLineOfSightOverlays(movingStructure);
                    return;
                }
            }
            if (nextIds.length > 0) {
                markAllFoxholeStructureOverlaysDirty();
                return;
            }
            if (prevIds.length > 0) {
                markAllFoxholeStructureOverlaysDirty();
            }
        }),
        watch(() => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideRoofsOnHover, false), enabled => {
            if (enabled === true) {
                installBunkerRoofHoverListeners();
            } else {
                uninstallBunkerRoofHoverListeners();
            }
        }),
    ];
    if (useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideRoofsOnHover, false) === true) {
        installBunkerRoofHoverListeners();
    }
}

function teardownOverlaySyncWatchers(): void {
    if (!watchersInstalled) {
        return;
    }

    for (const stop of watcherStops) {
        stop();
    }
    watcherStops = [];
    watchersInstalled = false;
    uninstallBunkerRoofHoverListeners();
}

function tickAllStructures(): void {
    boardPerfMeasure('overlay', () => {
        const context = resolveOverlaySyncContext();
        const targets = [...dirtyStructures];
        dirtyStructures.clear();

        for (const structure of targets) {
            if (structure.destroyed) {
                mountedStructures.delete(structure);
                structuresById.delete(String(structure.boardId));
                unregisterFoxholeRoofHoverHost(structure);
                continue;
            }

            structure.runOverlaySyncTick(context);
        }

        if (mountedStructures.size === 0) {
            uninstallStructureOverlaySyncTicker();
            if (roofHoverHostsById.size === 0) {
                teardownOverlaySyncWatchers();
            }
            return;
        }

        if (dirtyStructures.size === 0) {
            uninstallStructureOverlaySyncTicker();
        }
    });
}

function ensureStructureOverlaySyncTicker(): void {
    ensureOverlaySyncWatchers();

    if (tickerInstalled) {
        return;
    }

    PIXI.Ticker.shared.add(tickAllStructures);
    tickerInstalled = true;
}

function uninstallStructureOverlaySyncTicker(): void {
    if (!tickerInstalled) {
        return;
    }

    PIXI.Ticker.shared.remove(tickAllStructures);
    tickerInstalled = false;
}

/** Queue one structure for overlay sync on the next ticker pass. */
export function markFoxholeStructureOverlayDirty(structure: FoxholeStructureNode): void {
    if (structure.destroyed) {
        return;
    }

    dirtyStructures.add(structure);
    ensureStructureOverlaySyncTicker();
}

/** Queue specific structures by board id (e.g. placement-preview movers). */
export function markFoxholeStructureOverlaysDirtyByIds(nodeIds: readonly string[]): void {
    for (const nodeId of nodeIds) {
        markDirtyById(String(nodeId));
    }
}

/**
 * Queue every mounted structure. Used when socket occupancy / scene cache
 * invalidates so render-layer visibility can catch up without polling at idle.
 */
export function markAllFoxholeStructureOverlaysDirty(): void {
    invalidateFoxholeRoofHoverNetwork();
    for (const structure of mountedStructures) {
        if (!structure.destroyed) {
            dirtyStructures.add(structure);
        }
    }

    if (dirtyStructures.size > 0) {
        ensureStructureOverlaySyncTicker();
    }
}

/** Tier/visibility changes can alter hover membership without a mount or pointer move. */
export function invalidateFoxholeRoofHoverNetwork(): void {
    bunkerNetworkDirty = true;
    if (bunkerHoverPoint && !bunkerHoverFrame) {
        bunkerHoverFrame = requestAnimationFrame(updateBunkerRoofHover);
    }
}

/**
 * Refresh just the range masks during a live transform. Unlike the normal
 * overlay ticker this does not rebuild sockets, modification previews, or
 * render-layer visibility, so it can run at pointer-move cadence.
 */
export function syncFoxholeLineOfSightOverlays(movingStructure: FoxholeStructureNode): void {
    for (const structure of mountedStructures) {
        if (!structure.destroyed) {
            structure.syncLiveLineOfSightMask(movingStructure);
        }
    }
}

export function registerFoxholeStructureOverlaySync(structure: FoxholeStructureNode): void {
    mountedStructures.add(structure);
    structuresById.set(String(structure.boardId), structure);
    registerFoxholeRoofHoverHost(structure);
    markFoxholeStructureOverlayDirty(structure);
}

export function unregisterFoxholeStructureOverlaySync(structure: FoxholeStructureNode): void {
    mountedStructures.delete(structure);
    dirtyStructures.delete(structure);
    structuresById.delete(String(structure.boardId));
    unregisterFoxholeRoofHoverHost(structure);
    if (mountedStructures.size === 0) {
        uninstallStructureOverlaySyncTicker();
    }
}

/** Spline connectors share roof hover without joining the fixed-structure overlay ticker. */
export function registerFoxholeRoofHoverHost(structure: FoxholeRoofHoverHost): void {
    roofHoverHostsById.set(String(structure.boardId), structure);
    bunkerNetworkDirty = true;
    ensureOverlaySyncWatchers();
}

export function unregisterFoxholeRoofHoverHost(structure: FoxholeRoofHoverHost): void {
    if (roofHoverHostsById.get(String(structure.boardId)) !== structure) {
        return;
    }
    structure.setBunkerRoofHoverFaded(false, true);
    fadingBunkerRoofs.delete(structure);
    if (fadingBunkerRoofs.size === 0 && bunkerRoofFadeTickerInstalled) {
        PIXI.Ticker.shared.remove(tickBunkerRoofFades);
        bunkerRoofFadeTickerInstalled = false;
    }
    fadedBunkerRoofIds.delete(String(structure.boardId));
    bunkerNetworkDirty = true;
    roofHoverHostsById.delete(String(structure.boardId));

    if (roofHoverHostsById.size === 0 && mountedStructures.size === 0) {
        teardownOverlaySyncWatchers();
    }
}
