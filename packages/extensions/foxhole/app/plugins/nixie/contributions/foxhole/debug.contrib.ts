import { defineContribution, submenu } from '#nixie/plugins/nixie/registry/index.ts';
import {
    NIXIE_DEBUG_MENU_ID,
    NIXIE_OVERLAYS_DEBUG_MENU_ID,
    NIXIE_OVERLAYS_DEBUG_VOLUMES_MENU_ID,
    NIXIE_OVERLAYS_MENU_ID,
    NIXIE_OVERLAYS_RANGES_MENU_ID,
    NIXIE_OVERLAYS_STRUCTURES_MENU_ID,
} from '#nixie/plugins/nixie/registry/menu-ids.ts';
import type { NixieCommandContext } from '#nixie/plugins/nixie/registry/types.ts';
import { FOXHOLE_NIGHTTIME_RANGES_SETTING_ID, FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID } from '#foxhole/plugins/foxhole/nixie/night-ranges.ts';
import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import type { NixieProjectOperation } from '#nixie/plugins/nixie/project.ts';
import { layoutCenterPointsInGrid } from '#nixie/plugins/nixie/board/utils/grid-layout.ts';
import { createFoxholeAssetsBaseUrl, getFoxholeItemCatalog, getFoxholeStructureCatalog } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import type { FoxholeStructureAsset } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import {
    FOXHOLE_COMMANDS_SETTINGS_PAGE_SECTION,
    withCommandSettingsPageSection,
} from '#foxhole/plugins/foxhole/nixie/settings-page-sections.ts';
import {
    FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS,
    FOXHOLE_STRUCTURE_VOLUME_OVERLAY_DEFINITIONS,
} from '#foxhole/plugins/foxhole/nixie/structure-debug-settings.ts';
import {
    FOXHOLE_RANGE_DEBUG_SETTING_KEYS,
    FOXHOLE_RANGE_OVERLAY_DEFINITIONS,
    FOXHOLE_RANGE_SETTING_KEYS,
    readFoxholeRangeSettingsFromGetter,
} from '#foxhole/plugins/foxhole/nixie/range-settings.ts';
import {
    FOXHOLE_TACTICAL_LINE_PRESETS,

} from '#foxhole/plugins/foxhole/nixie/tactical-line.ts';
import type { FoxholeTacticalLineCap, FoxholeTacticalLineCurveMode, FoxholeTacticalLineDecoratorMode, FoxholeTacticalLineDecoratorSide, FoxholeTacticalLinePresetId, FoxholeTacticalLineState, FoxholeTacticalLineStrokeStyle } from '#foxhole/plugins/foxhole/nixie/tactical-line.ts';
import { createFoxholeTacticalLineSnapshot } from '#foxhole/plugins/foxhole/nixie/tactical-line-snapshot.ts';
import {
    buildSplineConnectorFixtureSnapshot,
    getSplineConnectorCatalogEntries,
    getSplineConnectorSnapshotBounds,
    resolveSplineConnectorFixtureCellSize,
    SPLINE_CONNECTOR_GALLERY_CELL_PADDING_X,
    SPLINE_CONNECTOR_GALLERY_CELL_PADDING_Y,
    SPLINE_CONNECTOR_GALLERY_COLUMNS,
    SPLINE_CONNECTOR_GALLERY_MIN_CELL_HEIGHT,
    SPLINE_CONNECTOR_GALLERY_MIN_CELL_WIDTH,
    SPLINE_CONNECTOR_GALLERY_VARIATION_COUNT,
} from '#foxhole/plugins/foxhole/nixie/spline-connector-snapshot-gallery.ts';
import type { FoxholeSplineConnectorState } from '#foxhole/plugins/foxhole/nixie/spline-connector.ts';
import { createFoxholeStructureAssetSnapshot } from '#foxhole/plugins/foxhole/nixie/structure-asset-snapshot.ts';
import { resolveFoxholeDebugProductionCargoSelection } from '#foxhole/plugins/foxhole/nixie/debug-production-cargo-gallery.ts';
import { createFoxholeProductionSlotVariantKey, getFoxholeProductionIndex } from '#foxhole/plugins/foxhole/nixie/production/index.ts';
import { FOXHOLE_ASSET_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/types.ts';
import type { FoxholeStructureState } from '#foxhole/plugins/foxhole/nixie/types.ts';
import { setFoxholeModificationSlotVariantSelection } from '#foxhole/plugins/foxhole/nixie/modification-slots.ts';
import type { FoxholeManifestStructure } from '#foxhole/plugins/foxhole/nixie/manifest.ts';
import {
    buildFoxholeWarDebugToastPreview,
    clearFoxholeWarDebugPreset,
    FOXHOLE_WAR_DEBUG_PRESET_DEFINITIONS,
    FOXHOLE_WAR_DEBUG_TOAST_PREVIEW_DEFINITIONS,
    getFoxholeWarDebugPresetRef,
    setFoxholeWarDebugPreset,
} from '#foxhole/composables/foxholeWarDebugState.ts';
import { previewFoxholePlaybackEventToast } from '#foxhole/composables/useFoxholePlaybackEventService.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';

type PointTuple = readonly [number, number];

const FOXHOLE_DEBUG_MENU_ID = 'debug.foxhole';
const GALLERY_COLUMNS = 5;
const GALLERY_ROWS = 5;
const GALLERY_COUNT = GALLERY_COLUMNS * GALLERY_ROWS;
const GALLERY_CELL_WIDTH = 360;
const GALLERY_CELL_HEIGHT = 220;
const SOCKET_SNAPSHOT_COLUMNS = 5;
const SOCKET_SNAPSHOT_CELL_PADDING = 112;
const SOCKET_SNAPSHOT_MIN_CELL_HEIGHT = 220;
const SOCKET_SNAPSHOT_MIN_CELL_WIDTH = 300;
const HITBOX_SNAPSHOT_COLUMNS = 6;
const HITBOX_SNAPSHOT_CELL_PADDING = 768;
const HITBOX_SNAPSHOT_MIN_CELL_HEIGHT = 1024;
const HITBOX_SNAPSHOT_MIN_CELL_WIDTH = 1024;
const PRODUCTION_CARGO_SNAPSHOT_CELL_PADDING = 96;
const PRODUCTION_CARGO_SNAPSHOT_MIN_CELL_WIDTH = 180;
const PRODUCTION_CARGO_SNAPSHOT_MIN_CELL_HEIGHT = 140;
const CAMERA_FIT_PADDING_PX = 96;
const DECORATOR_MODES: readonly FoxholeTacticalLineDecoratorMode[] = ['none', 'semicircle', 'triangle', 'tick', 'block', 'cross', 'arrow'];
const DECORATOR_SIDES: readonly FoxholeTacticalLineDecoratorSide[] = ['left', 'both', 'right'];
const CAP_MODES: readonly FoxholeTacticalLineCap[] = ['none', 'arrow', 'flag', 'circle'];
const STROKE_STYLES: readonly FoxholeTacticalLineStrokeStyle[] = ['solid', 'dashed'];
const CURVE_MODES: readonly FoxholeTacticalLineCurveMode[] = ['polyline', 'smooth'];
const FOXHOLE_ASSET_BASE_URL = createFoxholeAssetsBaseUrl('/');
const FOXHOLE_STRUCTURE_CATALOG = getFoxholeStructureCatalog(FOXHOLE_ASSET_BASE_URL);
const FOXHOLE_ITEM_CATALOG = getFoxholeItemCatalog(FOXHOLE_ASSET_BASE_URL);
const FOXHOLE_PRODUCTION_INDEX = getFoxholeProductionIndex(FOXHOLE_ASSET_BASE_URL);
const foxholeWarDebugPreset = getFoxholeWarDebugPresetRef();

function areAllStructureVolumesEnabled(): boolean {
    const settingsStore = useNixieSettingsStore();
    return FOXHOLE_STRUCTURE_VOLUME_OVERLAY_DEFINITIONS.every(definition => settingsStore.getValueOr(definition.settingId, undefined) === true);
}

function setAllStructureVolumesEnabled(value: boolean): void {
    const settingsStore = useNixieSettingsStore();
    for (const definition of FOXHOLE_STRUCTURE_VOLUME_OVERLAY_DEFINITIONS) {
        settingsStore.setValue(definition.settingId, value);
    }
}

interface TacticalLineFixtureInput {
    presetId: FoxholeTacticalLinePresetId;
    anchorX: number;
    anchorY: number;
    patternIndex: number;
    seed: number;
    key: string;
    state?: Partial<FoxholeTacticalLineState>;
}

interface WorldBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

function getViewportCenter(context: NixieCommandContext): PointTuple {
    const viewport = context.session.viewportRef.value;
    if (!viewport?.center) {
        return [0, 0];
    }

    return [viewport.center.x, viewport.center.y];
}

function flattenPoints(points: readonly PointTuple[]): number[] {
    const flattened: number[] = [];
    for (const [x, y] of points) {
        flattened.push(x, y);
    }
    return flattened;
}

function mulberry32(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
        state += 0x6D2B79F5;
        let next = Math.imul(state ^ (state >>> 15), 1 | state);
        next ^= next + Math.imul(next ^ (next >>> 7), 61 | next);
        return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
    };
}

function randomBetween(random: () => number, min: number, max: number): number {
    return min + ((max - min) * random());
}

function buildPatternedPoints(anchorX: number, anchorY: number, patternIndex: number, seed: number): number[] {
    const random = mulberry32(seed);
    const width = randomBetween(random, 150, 245);
    const crest = randomBetween(random, 22, 70);
    const sway = randomBetween(random, 12, 48);
    const points: PointTuple[] = [];
    const steps = 4 + (patternIndex % 2);
    for (let index = 0; index <= steps; index += 1) {
        const t = index / steps;
        const x = anchorX + (t * width);
        let y = anchorY;

        switch (patternIndex % 5) {
            case 0:
                y += Math.sin(t * Math.PI * 2) * crest;
                break;
            case 1:
                y += (index % 2 === 0 ? -1 : 1) * crest;
                break;
            case 2:
                y += Math.sin(t * Math.PI) * crest;
                y += ((t - 0.5) * sway);
                break;
            case 3:
                y += Math.cos(t * Math.PI * 1.5) * (crest * 0.78);
                y += Math.sin(t * Math.PI * 3) * (crest * 0.26);
                break;
            case 4:
            default:
                y += ((t - 0.5) * sway);
                y += Math.sin((t + 0.15) * Math.PI * 2.5) * (crest * 0.6);
                break;
        }

        points.push([x, y]);
    }

    return flattenPoints(points);
}

function getSnapshotBounds(snapshot: BoardNodeSnapshot<FoxholeTacticalLineState>): WorldBounds {
    const state = snapshot.state;
    const points = state.points;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (let index = 0; index < points.length; index += 2) {
        const x = state.x + points[index]!;
        const y = state.y + points[index + 1]!;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }

    const padding = Math.max(
        state.strokeWidth * 4,
        state.decoratorSize * 1.6,
        24,
    );

    return {
        minX: minX - padding,
        minY: minY - padding,
        maxX: maxX + padding,
        maxY: maxY + padding,
    };
}

function unionBounds(bounds: readonly WorldBounds[]): WorldBounds | null {
    if (!bounds.length) {
        return null;
    }

    const firstBounds = bounds[0]!;

    return bounds.slice(1).reduce<WorldBounds>((accumulator, entry) => ({
        minX: Math.min(accumulator.minX, entry.minX),
        minY: Math.min(accumulator.minY, entry.minY),
        maxX: Math.max(accumulator.maxX, entry.maxX),
        maxY: Math.max(accumulator.maxY, entry.maxY),
    }), firstBounds);
}

function focusBounds(context: NixieCommandContext, boundsEntries: readonly WorldBounds[]): void {
    const viewport = context.session.viewportRef.value;
    if (!viewport || boundsEntries.length === 0) {
        return;
    }

    const bounds = unionBounds(boundsEntries);
    if (!bounds) {
        return;
    }

    const availableWidth = Math.max(1, viewport.screenWidth - (CAMERA_FIT_PADDING_PX * 2));
    const availableHeight = Math.max(1, viewport.screenHeight - (CAMERA_FIT_PADDING_PX * 2));
    const boundsWidth = Math.max(1, bounds.maxX - bounds.minX);
    const boundsHeight = Math.max(1, bounds.maxY - bounds.minY);
    const fitScale = Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight);
    const minPanSafeScale = Math.max(
        viewport.screenWidth / Math.max(1, viewport.worldWidth),
        viewport.screenHeight / Math.max(1, viewport.worldHeight),
    );

    context.session.cameraTo({
        time: 220,
        position: {
            x: (bounds.minX + bounds.maxX) * 0.5,
            y: (bounds.minY + bounds.maxY) * 0.5,
        },
        scale: Math.max(fitScale, minPanSafeScale),
    });
}

function buildTacticalLineSnapshot(input: TacticalLineFixtureInput): BoardNodeSnapshot<FoxholeTacticalLineState> {
    return createFoxholeTacticalLineSnapshot({
        points: buildPatternedPoints(input.anchorX, input.anchorY, input.patternIndex, input.seed),
        presetId: input.presetId,
        key: input.key,
        state: input.state,
    });
}

function buildGallerySnapshots(context: NixieCommandContext): BoardNodeSnapshot<FoxholeTacticalLineState>[] {
    const [centerX, centerY] = getViewportCenter(context);
    const positions = layoutCenterPointsInGrid(
        Array.from({ length: GALLERY_COUNT }, () => ({
            width: GALLERY_CELL_WIDTH,
            height: GALLERY_CELL_HEIGHT,
        })),
        {
            columns: GALLERY_COLUMNS,
            centerX: centerX - 120,
            centerY,
        },
    );
    const presets = FOXHOLE_TACTICAL_LINE_PRESETS.map(preset => preset.id);

    return Array.from({ length: GALLERY_COUNT }, (_, index) => {
        const position = positions[index]!;
        const column = index % GALLERY_COLUMNS;
        const row = Math.floor(index / GALLERY_COLUMNS);
        const presetId = presets[index % presets.length]!;
        const decoratorMode = DECORATOR_MODES[index % DECORATOR_MODES.length]!;
        const decoratorSide = DECORATOR_SIDES[index % DECORATOR_SIDES.length]!;
        const startCap = CAP_MODES[(index + row) % CAP_MODES.length]!;
        const endCap = CAP_MODES[(index + column + 1) % CAP_MODES.length]!;
        const strokeStyle = STROKE_STYLES[(index + row) % STROKE_STYLES.length]!;
        const curveMode = CURVE_MODES[(index + column) % CURVE_MODES.length]!;
        const scaleWithZoom = index % 4 !== 0;

        return buildTacticalLineSnapshot({
            presetId,
            anchorX: position.x,
            anchorY: position.y,
            patternIndex: index,
            seed: 1000 + index,
            key: `Tactical Snapshot ${index + 1}`,
            state: {
                curveMode,
                strokeStyle,
                startCap,
                endCap,
                decoratorMode: strokeStyle === 'dashed' ? 'none' : decoratorMode,
                decoratorSide,
                scaleWithZoom,
                strokeWidth: 5 + (index % 5),
                strokeDashLength: 16 + ((index % 4) * 4),
                strokeDashGap: 10 + ((index % 3) * 3),
                decoratorSize: 12 + ((index % 5) * 2),
                decoratorSpacing: 20 + ((index % 4) * 8),
            },
        });
    });
}

function pickRandom<TValue>(random: () => number, values: readonly TValue[]): TValue {
    return values[Math.floor(random() * values.length)]!;
}

function buildSplineConnectorGallerySnapshots(context: NixieCommandContext): BoardNodeSnapshot<FoxholeSplineConnectorState>[] {
    const entries = getSplineConnectorCatalogEntries(FOXHOLE_STRUCTURE_CATALOG);
    if (!entries.length) {
        return [];
    }

    const sizes = entries.flatMap(entry => Array.from(
        { length: SPLINE_CONNECTOR_GALLERY_VARIATION_COUNT },
        (_, variationIndex) => resolveSplineConnectorFixtureCellSize(entry, variationIndex),
    ));
    const [centerX, centerY] = getViewportCenter(context);
    const positions = layoutCenterPointsInGrid(sizes, {
        columns: SPLINE_CONNECTOR_GALLERY_COLUMNS,
        centerX: centerX - 160,
        centerY,
        cellPaddingX: SPLINE_CONNECTOR_GALLERY_CELL_PADDING_X,
        cellPaddingY: SPLINE_CONNECTOR_GALLERY_CELL_PADDING_Y,
        minCellWidth: SPLINE_CONNECTOR_GALLERY_MIN_CELL_WIDTH,
        minCellHeight: SPLINE_CONNECTOR_GALLERY_MIN_CELL_HEIGHT,
    });

    return entries.flatMap((entry, entryIndex) => Array.from(
        { length: SPLINE_CONNECTOR_GALLERY_VARIATION_COUNT },
        (_, variationIndex) => {
            const position = positions[(entryIndex * SPLINE_CONNECTOR_GALLERY_VARIATION_COUNT) + variationIndex];
            if (!position) {
                return null;
            }

            return buildSplineConnectorFixtureSnapshot(entry, variationIndex, position);
        },
    ).filter((snapshot): snapshot is BoardNodeSnapshot<FoxholeSplineConnectorState> => snapshot != null));
}

interface SocketAssetFixtureEntry {
    asset: FoxholeStructureAsset;
    structure: FoxholeManifestStructure;
    label: string;
    modificationVariantIds?: Record<string, string>;
}

interface HitboxAssetFixtureEntry {
    asset: FoxholeStructureAsset;
    structure: FoxholeManifestStructure;
    label: string;
    modificationVariantIds?: Record<string, string>;
}

function buildSocketAssetFixture(context: NixieCommandContext): {
    snapshots: BoardNodeSnapshot[];
    bounds: WorldBounds[];
} {
    const baseEntries = FOXHOLE_STRUCTURE_CATALOG.assets
        .map(asset => ({
            asset,
            structure: FOXHOLE_STRUCTURE_CATALOG.structureByKey[asset.foxholeKey],
            label: asset.name,
        }))
        .filter((entry): entry is SocketAssetFixtureEntry => (entry.structure?.buildSockets.length ?? 0) > 0);
    const modificationEntries = FOXHOLE_STRUCTURE_CATALOG.assets.flatMap(asset => {
        const structure = FOXHOLE_STRUCTURE_CATALOG.structureByKey[asset.foxholeKey];
        if (!structure) {
            return [];
        }

        return asset.modificationSlots.flatMap(slot => slot.variants
            .filter(variant => variant.buildSockets.length > 0)
            .map<SocketAssetFixtureEntry>(variant => ({
                asset,
                structure,
                label: `${asset.name} — ${variant.name}`,
                modificationVariantIds: setFoxholeModificationSlotVariantSelection({}, slot, variant.id),
            })));
    });
    const entries = [...baseEntries, ...modificationEntries];
    const [centerX, centerY] = getViewportCenter(context);
    const positions = layoutCenterPointsInGrid(entries.map(({ asset }) => ({
        width: Math.max(SOCKET_SNAPSHOT_MIN_CELL_WIDTH, (asset.width ?? 0) + SOCKET_SNAPSHOT_CELL_PADDING),
        height: Math.max(SOCKET_SNAPSHOT_MIN_CELL_HEIGHT, (asset.height ?? 0) + SOCKET_SNAPSHOT_CELL_PADDING),
    })), {
        columns: SOCKET_SNAPSHOT_COLUMNS,
        centerX,
        centerY,
    });

    const snapshots: BoardNodeSnapshot[] = [];
    const bounds: WorldBounds[] = [];
    for (const [index, entry] of entries.entries()) {
        const position = positions[index];
        if (!position) {
            continue;
        }

        const parentAsset = entry.asset.parentStructureId
            ? FOXHOLE_STRUCTURE_CATALOG.assetByKey[entry.asset.parentStructureId] ?? null
            : null;
        snapshots.push(createFoxholeStructureAssetSnapshot({
            asset: entry.asset,
            structure: entry.structure,
            parentAsset,
            label: entry.label,
            modificationVariantIds: entry.modificationVariantIds,
            x: position.x,
            y: position.y,
        }));

        const halfWidth = Math.max(SOCKET_SNAPSHOT_MIN_CELL_WIDTH, (entry.asset.width ?? 0) + SOCKET_SNAPSHOT_CELL_PADDING) * 0.5;
        const halfHeight = Math.max(SOCKET_SNAPSHOT_MIN_CELL_HEIGHT, (entry.asset.height ?? 0) + SOCKET_SNAPSHOT_CELL_PADDING) * 0.5;
        bounds.push({
            minX: position.x - halfWidth,
            minY: position.y - halfHeight,
            maxX: position.x + halfWidth,
            maxY: position.y + halfHeight,
        });
    }

    return { snapshots, bounds };
}

function buildProductionCargoAssetFixture(context: NixieCommandContext): {
    snapshots: BoardNodeSnapshot[];
    bounds: WorldBounds[];
} {
    const entries: Array<{ snapshot: BoardNodeSnapshot<FoxholeStructureState>; width: number; height: number; }> = [];
    for (const asset of FOXHOLE_STRUCTURE_CATALOG.assets) {
        const structure = FOXHOLE_STRUCTURE_CATALOG.structureByKey[asset.foxholeKey];
        if (!structure || asset.isDestroyed || asset.intactStructureId || asset.hideInList) {
            continue;
        }
        const parentAsset = asset.parentStructureId
            ? FOXHOLE_STRUCTURE_CATALOG.assetByKey[asset.parentStructureId] ?? null
            : null;
        const variants = [
            { label: asset.name, modificationVariantIds: undefined },
            ...asset.modificationSlots.flatMap(slot => slot.variants.flatMap(variant => {
                const recipeKey = createFoxholeProductionSlotVariantKey(structure.id, slot.id, variant.id);
                if (!FOXHOLE_PRODUCTION_INDEX.modificationRecipeIdsBySlotVariantKey[recipeKey]?.length) {
                    return [];
                }
                return [{
                    label: `${asset.name} — ${variant.name}`,
                    modificationVariantIds: setFoxholeModificationSlotVariantSelection({}, slot, variant.id),
                }];
            })),
        ];
        for (const variant of variants) {
            const snapshot = createFoxholeStructureAssetSnapshot({
                asset,
                structure,
                parentAsset,
                label: variant.label,
                modificationVariantIds: variant.modificationVariantIds,
                x: 0,
                y: 0,
            });
            if (snapshot.type !== FOXHOLE_ASSET_NODE_TYPE) {
                continue;
            }
            const state = snapshot.state as FoxholeStructureState;
            const selection = resolveFoxholeDebugProductionCargoSelection({
                foxholeKey: state.foxholeKey,
                modificationVariantIds: state.modificationVariantIds,
                structureCatalog: FOXHOLE_STRUCTURE_CATALOG,
                itemCatalog: FOXHOLE_ITEM_CATALOG,
                productionIndex: FOXHOLE_PRODUCTION_INDEX,
            });
            if (!selection || (variant.modificationVariantIds
                && !selection.productionOrders[0]?.recipeId.startsWith('modification:'))) {
                continue;
            }
            state.markedItemCodenames = selection.markedItemCodenames;
            state.productionOrders = selection.productionOrders;
            const placedAsset = FOXHOLE_STRUCTURE_CATALOG.assetByKey[state.foxholeKey] ?? asset;
            entries.push({
                snapshot: snapshot as BoardNodeSnapshot<FoxholeStructureState>,
                width: Math.max(PRODUCTION_CARGO_SNAPSHOT_MIN_CELL_WIDTH,
                    (placedAsset.width ?? 0) + PRODUCTION_CARGO_SNAPSHOT_CELL_PADDING),
                height: Math.max(PRODUCTION_CARGO_SNAPSHOT_MIN_CELL_HEIGHT,
                    (placedAsset.height ?? 0) + PRODUCTION_CARGO_SNAPSHOT_CELL_PADDING),
            });
        }
    }

    const [centerX, centerY] = getViewportCenter(context);
    const positions = layoutCenterPointsInGrid(entries.map(entry => ({ width: entry.width, height: entry.height })), {
        centerX,
        centerY,
    });
    const snapshots: BoardNodeSnapshot[] = [];
    const bounds: WorldBounds[] = [];
    for (const [index, entry] of entries.entries()) {
        const position = positions[index];
        if (!position) {
            continue;
        }
        entry.snapshot.state.x = position.x;
        entry.snapshot.state.y = position.y;
        snapshots.push(entry.snapshot);
        bounds.push({
            minX: position.x - entry.width / 2,
            minY: position.y - entry.height / 2,
            maxX: position.x + entry.width / 2,
            maxY: position.y + entry.height / 2,
        });
    }
    return { snapshots, bounds };
}

function buildHitboxAssetFixture(context: NixieCommandContext): {
    snapshots: BoardNodeSnapshot[];
    bounds: WorldBounds[];
} {
    const entries = FOXHOLE_STRUCTURE_CATALOG.assets
        .flatMap(asset => {
            const structure = FOXHOLE_STRUCTURE_CATALOG.structureByKey[asset.foxholeKey];
            if (!structure) {
                return [];
            }

            const baseEntries: HitboxAssetFixtureEntry[] = structure.lineOfSightPolygons.length > 0
                ? [{ asset, structure, label: asset.name }]
                : [];
            const upgradeEntries = asset.modificationSlots.flatMap(slot => slot.variants
                .filter(variant => variant.lineOfSightPolygons.length > 0)
                .map(variant => ({
                    asset,
                    structure,
                    label: `${asset.name} — ${variant.name}`,
                    modificationVariantIds: { [slot.id]: variant.id },
                })));
            return [...baseEntries, ...upgradeEntries];
        })
        .sort((left, right) => left.label.localeCompare(right.label));
    const [centerX, centerY] = getViewportCenter(context);
    const sizes = entries.map(({ asset }) => ({
        width: Math.max(HITBOX_SNAPSHOT_MIN_CELL_WIDTH, (asset.width ?? 0) + HITBOX_SNAPSHOT_CELL_PADDING),
        height: Math.max(HITBOX_SNAPSHOT_MIN_CELL_HEIGHT, (asset.height ?? 0) + HITBOX_SNAPSHOT_CELL_PADDING),
    }));
    const positions = layoutCenterPointsInGrid(sizes, {
        columns: HITBOX_SNAPSHOT_COLUMNS,
        centerX,
        centerY,
    });
    const snapshots: BoardNodeSnapshot[] = [];
    const bounds: WorldBounds[] = [];

    for (const [index, entry] of entries.entries()) {
        const position = positions[index];
        const size = sizes[index];
        if (!position || !size) {
            continue;
        }

        const parentAsset = entry.asset.parentStructureId
            ? FOXHOLE_STRUCTURE_CATALOG.assetByKey[entry.asset.parentStructureId] ?? null
            : null;
        snapshots.push(createFoxholeStructureAssetSnapshot({
            asset: entry.asset,
            structure: entry.structure,
            parentAsset,
            label: entry.label,
            modificationVariantIds: entry.modificationVariantIds,
            x: position.x,
            y: position.y,
        }));
        bounds.push({
            minX: position.x - (size.width * 0.5),
            minY: position.y - (size.height * 0.5),
            maxX: position.x + (size.width * 0.5),
            maxY: position.y + (size.height * 0.5),
        });
    }

    return { snapshots, bounds };
}

function buildRandomSnapshots(context: NixieCommandContext): BoardNodeSnapshot<FoxholeTacticalLineState>[] {
    const [centerX, centerY] = getViewportCenter(context);
    const positions = layoutCenterPointsInGrid(
        Array.from({ length: GALLERY_COUNT }, () => ({
            width: GALLERY_CELL_WIDTH,
            height: GALLERY_CELL_HEIGHT,
        })),
        {
            columns: GALLERY_COLUMNS,
            centerX: centerX - 120,
            centerY,
        },
    );
    const random = mulberry32(Math.floor(Date.now() % 2147483647));
    const presets = FOXHOLE_TACTICAL_LINE_PRESETS.map(preset => preset.id);

    return Array.from({ length: GALLERY_COUNT }, (_, index) => {
        const position = positions[index]!;
        const column = index % GALLERY_COLUMNS;
        const row = Math.floor(index / GALLERY_COLUMNS);
        const strokeStyle = pickRandom(random, STROKE_STYLES);
        const decoratorMode = strokeStyle === 'dashed'
            ? 'none'
            : pickRandom(random, DECORATOR_MODES.filter(entry => entry !== 'none'));

        return buildTacticalLineSnapshot({
            presetId: pickRandom(random, presets),
            anchorX: position.x + randomBetween(random, -26, 26),
            anchorY: position.y + randomBetween(random, -30, 30),
            patternIndex: index + Math.floor(random() * 5),
            seed: 5000 + Math.floor(random() * 100000),
            key: `Random Tactical Line ${index + 1}`,
            state: {
                curveMode: pickRandom(random, CURVE_MODES),
                strokeStyle,
                startCap: pickRandom(random, CAP_MODES),
                endCap: pickRandom(random, CAP_MODES),
                decoratorMode,
                decoratorSide: pickRandom(random, DECORATOR_SIDES),
                scaleWithZoom: random() > 0.15,
                strokeWidth: 4 + Math.floor(random() * 6),
                strokeAlpha: 1,
                strokeDashLength: 14 + Math.floor(random() * 16),
                strokeDashGap: 8 + Math.floor(random() * 12),
                decoratorSize: 10 + Math.floor(random() * 14),
                decoratorSpacing: 18 + Math.floor(random() * 24),
                decoratorFill: random() > 0.25,
                decoratorAlpha: 1,
            },
        });
    });
}

async function createSnapshotsBatch<TState extends Record<string, unknown>>(
    context: NixieCommandContext,
    snapshots: readonly BoardNodeSnapshot<TState>[],
    reason: string,
    label: string,
    focusEntries?: readonly WorldBounds[],
): Promise<void> {
    if (!context.capabilities.canEdit || snapshots.length === 0) {
        return;
    }

    const parentId = await context.resolveCreationParentId(undefined, `${reason}:target`);
    const operations: NixieProjectOperation[] = snapshots.map(snapshot => ({
        type: 'create',
        node: snapshot,
        ...(parentId ? { parentId } : {}),
    }));
    const inverseOperations: NixieProjectOperation[] = snapshots
        .map<NixieProjectOperation>(snapshot => ({
            type: 'delete',
            nodeId: String(snapshot.id),
        }))
        .reverse();

    const created = await context.project.executeBatch(operations, inverseOperations, reason, label);
    if (!created) {
        return;
    }

    const ids = snapshots.map(snapshot => String(snapshot.id));
    context.setSelectedNodeIds(ids, `${reason}:select`);
    focusBounds(context, focusEntries ?? []);
}

export default defineContribution({
    commands: withCommandSettingsPageSection([
        {
            id: 'foxhole.debug.generateTacticalLineSnapshot',
            type: 'editor',
            icon: 'ph:images',
            name: 'Generate Tactical Line Snapshot',
            description: 'Create a deterministic gallery of tactical line variants for visual review.',
            availableWhen: { accessibleInDev: true },
            enabled: context => context.capabilities.canEdit,
            run: async context => {
                const snapshots = buildGallerySnapshots(context);
                await createSnapshotsBatch(
                    context,
                    snapshots,
                    'command:foxhole.debug.generate-tactical-line-snapshot',
                    'Generate Tactical Line Snapshot',
                    snapshots.map(getSnapshotBounds),
                );
            },
        },
        {
            id: 'foxhole.debug.generateSplineConnectorSnapshot',
            type: 'editor',
            icon: 'ph:bezier-curve',
            name: 'Generate Spline Connector Snapshot',
            description: 'Create a deterministic gallery of spline connector variants for each spline-backed asset.',
            availableWhen: { accessibleInDev: true },
            enabled: context => context.capabilities.canEdit,
            run: async context => {
                const snapshots = buildSplineConnectorGallerySnapshots(context);
                await createSnapshotsBatch(
                    context,
                    snapshots,
                    'command:foxhole.debug.generate-spline-connector-snapshot',
                    'Generate Spline Connector Snapshot',
                    snapshots.map(getSplineConnectorSnapshotBounds),
                );
            },
        },
        {
            id: 'foxhole.debug.generateSocketAssetSnapshot',
            type: 'editor',
            icon: 'ph:plugs-connected',
            name: 'Generate Socket Asset Snapshot',
            description: 'Create one of every Foxhole asset with at least one extracted socket for visual QA.',
            availableWhen: { accessibleInDev: true },
            enabled: context => context.capabilities.canEdit,
            run: async context => {
                const fixture = buildSocketAssetFixture(context);
                await createSnapshotsBatch(
                    context,
                    fixture.snapshots,
                    'command:foxhole.debug.generate-socket-asset-snapshot',
                    'Generate Socket Asset Snapshot',
                    fixture.bounds,
                );
            },
        },
        {
            id: 'foxhole.debug.generateHitboxAssetSnapshot',
            type: 'editor',
            icon: 'ph:polygon',
            name: 'Generate Hitbox Asset Snapshot',
            description: 'Create a generously spaced grid of every Foxhole asset with authored hitbox polygons for visual QA.',
            availableWhen: { accessibleInDev: true },
            enabled: context => context.capabilities.canEdit,
            run: async context => {
                const fixture = buildHitboxAssetFixture(context);
                await createSnapshotsBatch(
                    context,
                    fixture.snapshots,
                    'command:foxhole.debug.generate-hitbox-asset-snapshot',
                    'Generate Hitbox Asset Snapshot',
                    fixture.bounds,
                );
            },
        },
        {
            id: 'foxhole.debug.spawnProductionCargoAssets',
            type: 'editor',
            icon: 'ph:package',
            name: 'Spawn Storage & Production Assets',
            description: 'Create Foxhole assets that support storage or production with sample selections visible for layout review.',
            availableWhen: { accessibleInDev: true },
            enabled: context => context.capabilities.canEdit,
            run: async context => {
                const fixture = buildProductionCargoAssetFixture(context);
                if (fixture.snapshots.length === 0) {
                    return;
                }
                useNixieSettingsStore().setValue(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.markedCargo, true);
                await createSnapshotsBatch(
                    context,
                    fixture.snapshots,
                    'command:foxhole.debug.spawn-production-cargo-assets',
                    'Spawn Storage & Production Assets',
                    fixture.bounds,
                );
            },
        },
        {
            id: 'foxhole.debug.generateRandomTacticalLines',
            type: 'editor',
            icon: 'ph:shuffle',
            name: 'Generate Random Tactical Lines',
            description: 'Create a batch of varied tactical lines with randomized shapes and styling.',
            availableWhen: { accessibleInDev: true },
            enabled: context => context.capabilities.canEdit,
            run: async context => {
                const snapshots = buildRandomSnapshots(context);
                await createSnapshotsBatch(
                    context,
                    snapshots,
                    'command:foxhole.debug.generate-random-tactical-lines',
                    'Generate Random Tactical Lines',
                    snapshots.map(getSnapshotBounds),
                );
            },
        },
    ], FOXHOLE_COMMANDS_SETTINGS_PAGE_SECTION),
    menus: [
        {
            menu: NIXIE_DEBUG_MENU_ID,
            order: 320,
            item: {
                commandId: 'foxhole.debug.spawnProductionCargoAssets',
            },
        },
        {
            menu: NIXIE_OVERLAYS_STRUCTURES_MENU_ID,
            order: -710,
            item: submenu('Ranges', NIXIE_OVERLAYS_RANGES_MENU_ID, {
                icon: 'ph:crosshair-simple',
            }),
        },
        {
            menu: NIXIE_OVERLAYS_STRUCTURES_MENU_ID,
            order: -705,
            item: { type: 'separator' },
        },
        {
            menu: NIXIE_OVERLAYS_RANGES_MENU_ID,
            order: 12,
            item: {
                type: 'checkbox',
                label: 'Nighttime Ranges',
                icon: 'ph:moon',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_NIGHTTIME_RANGES_SETTING_ID, undefined) === true,
                closeOnClick: false,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_NIGHTTIME_RANGES_SETTING_ID);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_RANGES_MENU_ID,
            order: 14,
            item: {
                type: 'checkbox',
                label: 'Powered Spotlights',
                icon: 'ph:flashlight',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID, undefined) === true,
                closeOnClick: false,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_POWERED_SPOTLIGHTS_SETTING_ID);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_RANGES_MENU_ID,
            order: 10,
            item: {
                type: 'checkbox',
                label: 'Selection Ranges',
                icon: 'ph:cursor-click',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_RANGE_SETTING_KEYS.selectionOnly, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_RANGE_SETTING_KEYS.selectionOnly);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_RANGES_MENU_ID,
            order: 20,
            item: { type: 'separator' },
        },
        ...Object.entries(FOXHOLE_RANGE_OVERLAY_DEFINITIONS).map(([key, definition], index) => ({
            menu: NIXIE_OVERLAYS_RANGES_MENU_ID,
            order: 30 + index,
            item: {
                type: 'checkbox' as const,
                label: definition.label,
                icon: definition.icon,
                checked: () => readFoxholeRangeSettingsFromGetter(settingId => useNixieSettingsStore().getValueOr(settingId, undefined)).overlays[key as keyof typeof FOXHOLE_RANGE_OVERLAY_DEFINITIONS],
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_RANGE_SETTING_KEYS[key as keyof typeof FOXHOLE_RANGE_OVERLAY_DEFINITIONS]);
                },
            },
        })),
        {
            menu: NIXIE_OVERLAYS_STRUCTURES_MENU_ID,
            order: -700,
            item: {
                type: 'checkbox',
                label: 'Storage and Production Outputs',
                icon: 'ph:package',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.markedCargo, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.markedCargo);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_MENU_ID,
            order: -700,
            item: submenu('Foxhole', NIXIE_OVERLAYS_STRUCTURES_MENU_ID, {
                icon: 'ph:puzzle-piece',
            }),
        },
        {
            menu: NIXIE_OVERLAYS_MENU_ID,
            order: -600,
            item: {
                type: 'submenu',
                label: 'Debug',
                icon: 'ph:bug',
                accessibleInDev: true,
                menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 10,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'Hitboxes',
                icon: 'ph:polygon',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hitboxes, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hitboxes);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 15,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'Placement Warnings',
                icon: 'ph:warning',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.placementWarnings, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.placementWarnings);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 20,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'Line of Sight',
                icon: 'ph:eye',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.lineOfSight, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.lineOfSight);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 22,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'Vehicle Weapon Ranges',
                icon: 'ph:crosshair-simple',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_RANGE_DEBUG_SETTING_KEYS.vehicleWeapons, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_RANGE_DEBUG_SETTING_KEYS.vehicleWeapons);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 30,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'All Sockets',
                icon: 'ph:plugs-connected',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.allSockets, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.allSockets);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 25,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'Socket Labels',
                icon: 'ph:text-t',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.socketLabels, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.socketLabels);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 30,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'Modification Slots',
                icon: 'ph:square',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.modificationSlots, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.modificationSlots);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 40,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'Vehicle Seats',
                icon: 'ph:seat',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.vehicleSeats, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.vehicleSeats);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 50,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'Spotlights',
                icon: 'ph:flashlight',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.spotlights, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.spotlights);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 53,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'Use Static Render',
                icon: 'ph:image-square',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.useStaticRender, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.useStaticRender);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 54,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'Hide Floor',
                icon: 'ph:selection-background',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideFloors, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideFloors);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 55,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'Hide Walls',
                icon: 'ph:wall',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideWalls, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideWalls);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 56,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'Hide Dirt',
                icon: 'ph:mountains',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideDirt, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideDirt);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 57,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'Hide Corners',
                icon: 'ph:corner-down-right',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideCorners, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideCorners);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 60,
            item: {
                type: 'separator',
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_MENU_ID,
            order: 70,
            item: {
                type: 'submenu',
                label: 'Structure Volumes',
                menu: NIXIE_OVERLAYS_DEBUG_VOLUMES_MENU_ID,
                accessibleInDev: true,
                icon: 'ph:cube-focus',
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_VOLUMES_MENU_ID,
            order: 10,
            item: {
                type: 'checkbox',
                accessibleInDev: true,
                label: 'All Structure Volumes',
                icon: 'ph:cube-focus',
                checked: () => areAllStructureVolumesEnabled(),
                onClick: () => {
                    setAllStructureVolumesEnabled(!areAllStructureVolumesEnabled());
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_DEBUG_VOLUMES_MENU_ID,
            order: 20,
            item: {
                type: 'separator',
            },
        },
        ...FOXHOLE_STRUCTURE_VOLUME_OVERLAY_DEFINITIONS.map((definition, index) => ({
            menu: NIXIE_OVERLAYS_DEBUG_VOLUMES_MENU_ID,
            order: 30 + index,
            item: {
                type: 'checkbox' as const,
                accessibleInDev: true,
                label: definition.label,
                icon: definition.icon,
                checked: () => useNixieSettingsStore().getValueOr(definition.settingId, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(definition.settingId);
                },
            },
        })),
        {
            menu: NIXIE_OVERLAYS_STRUCTURES_MENU_ID,
            order: 20,
            item: {
                type: 'checkbox',
                label: 'Power Sockets',
                icon: 'ph:cell-tower',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.powerSockets, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.powerSockets);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_STRUCTURES_MENU_ID,
            order: 30,
            item: {
                type: 'checkbox',
                label: 'Pipe Sockets',
                icon: 'ph:pipe',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.pipeSockets, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.pipeSockets);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_STRUCTURES_MENU_ID,
            order: 35,
            item: {
                type: 'checkbox',
                label: 'Breach Indicators',
                icon: 'ph:shield-warning',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.breachIndicators, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.breachIndicators);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_STRUCTURES_MENU_ID,
            order: 40,
            item: {
                type: 'checkbox',
                label: 'Hide Roofs',
                icon: 'ph:house-line',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideRoofs, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideRoofs);
                },
            },
        },
        {
            menu: NIXIE_OVERLAYS_STRUCTURES_MENU_ID,
            order: 45,
            item: {
                type: 'checkbox',
                label: 'Hide Roofs on Hover',
                icon: 'ph:eye',
                checked: () => useNixieSettingsStore().getValueOr(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideRoofsOnHover, undefined) === true,
                onClick: () => {
                    useNixieSettingsStore().toggle(FOXHOLE_STRUCTURE_DEBUG_SETTING_IDS.hideRoofsOnHover);
                },
            },
        },
        {
            menu: 'debug',
            order: 100,
            item: {
                type: 'submenu',
                label: 'Foxhole',
                menu: FOXHOLE_DEBUG_MENU_ID,
                accessibleInDev: true,
                icon: 'nx:hexagon-bars',
            },
        },
        {
            menu: FOXHOLE_DEBUG_MENU_ID,
            order: 100,
            item: {
                type: 'submenu',
                label: 'Foxhole War Panel',
                accessibleInDev: true,
                icon: 'ph:pulse',
                children: [
                    {
                        type: 'submenu',
                        label: 'Presets',
                        accessibleInDev: true,
                        icon: 'ph:tree-structure',
                        availableWhen: { when: 'project' },
                        children: [
                            {
                                type: 'checkbox',
                                label: 'Live Data',
                                accessibleInDev: true,
                                icon: 'ph:radio',
                                checked: () => foxholeWarDebugPreset.value === null,
                                onClick: () => {
                                    clearFoxholeWarDebugPreset();
                                },
                            },
                            ...FOXHOLE_WAR_DEBUG_PRESET_DEFINITIONS.map(definition => ({
                                type: 'checkbox' as const,
                                label: definition.label,
                                accessibleInDev: true,
                                icon: 'ph:film-slate',
                                checked: () => foxholeWarDebugPreset.value?.id === definition.id,
                                onClick: () => {
                                    setFoxholeWarDebugPreset(definition.id);
                                },
                            })),
                        ],
                    },
                    {
                        type: 'submenu',
                        label: 'Toast Preview',
                        accessibleInDev: true,
                        icon: 'ph:bell-ringing',
                        children: FOXHOLE_WAR_DEBUG_TOAST_PREVIEW_DEFINITIONS.map(definition => ({
                            label: definition.label,
                            accessibleInDev: true,
                            icon: 'ph:bell',
                            closeOnClick: false,
                            onClick: () => {
                                const event = buildFoxholeWarDebugToastPreview(definition.id);
                                if (!event) {
                                    return;
                                }

                                previewFoxholePlaybackEventToast(event);
                            },
                        })),
                    },
                ],
            },
        },
        {
            menu: FOXHOLE_DEBUG_MENU_ID,
            order: 200,
            item: {
                type: 'separator',
            },
        },
        {
            menu: FOXHOLE_DEBUG_MENU_ID,
            order: 220,
            item: {
                commandId: 'foxhole.debug.generateTacticalLineSnapshot',
            },
        },
        {
            menu: FOXHOLE_DEBUG_MENU_ID,
            order: 230,
            item: {
                commandId: 'foxhole.debug.generateRandomTacticalLines',
            },
        },
        {
            menu: FOXHOLE_DEBUG_MENU_ID,
            order: 240,
            item: {
                commandId: 'foxhole.debug.generateSplineConnectorSnapshot',
            },
        },
        {
            menu: FOXHOLE_DEBUG_MENU_ID,
            order: 250,
            item: {
                commandId: 'foxhole.debug.generateSocketAssetSnapshot',
            },
        },
        {
            menu: FOXHOLE_DEBUG_MENU_ID,
            order: 260,
            item: {
                commandId: 'foxhole.debug.generateHitboxAssetSnapshot',
            },
        },
    ],
});
