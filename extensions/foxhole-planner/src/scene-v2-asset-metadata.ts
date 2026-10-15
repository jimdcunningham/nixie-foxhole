import { resolveFoxholeModificationTextureAnchor } from './modification-anchor.ts';
import { readNativeSplineSurface } from './native-spline-surface.ts';
import type { NativeSplineSurface } from './native-spline-surface.ts';
import { resolveFoxholeStockpileSelectionGroups } from './stockpile-groups.ts';
import { readFoxholeAuthoredSpotlight } from './spotlight-beam.ts';
import type { FoxholeAuthoredSpotlight } from './spotlight-beam.ts';
import { isFoxholeModificationSlotTierEligible } from './modification-tier.ts';
import { resolveFoxholeEmplacementModificationSplineEnd } from './modification-spline.ts';
import type { NixieExperimentalProductAttributeV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { resolveConnectorBehavior, resolveConnectorEndpointSocketNames, resolveConnectorVisualPathStyle } from './connector-behavior.ts';
import { createFoxholeStatisticsRecipe } from './production-statistics.ts';
import type { FoxholePublishedProductionEntry, FoxholeStatisticsRecipe, FoxholeStatisticsStructure } from './production-statistics.ts';
import { normalizeFoxholeStatisticsCost, resolveFoxholeStatisticsCosts } from './resource-statistics.ts';
import type { FoxholeResourceStatisticsMetadata } from './resource-statistics.ts';
import type { FoxholeBunkerStatisticsMetadata } from './bunker-statistics.ts';
import type { FoxholeBunkerStatisticsSocket } from './bunker-statistics-sockets.ts';
import type { FoxholeBunkerDestructionWeaponInput } from './bunker-statistics-destruction.ts';

export interface FoxholeSceneV2ModificationVariantMetadata {
    description?: string;
    browserIcon?: FoxholeSceneV2AssetMetadata['browserIcon'];
    browserPreview?: FoxholeSceneV2AssetMetadata['browserPreview'];
    overlaySockets?: FoxholeBunkerStatisticsSocket[];
    selectionPolygons?: Array<{ shape: number[]; }>;
    id?: string;
    label?: string;
    resourceId: string;
    width: number;
    height: number;
    anchorX: number;
    anchorY: number;
    offsetX: number;
    offsetY: number;
    isUpgrade: boolean;
}

export interface FoxholeSceneV2ModificationSlotMetadata {
    componentType?: string;
    linkedSocketNames?: string[];
    id?: string;
    name?: string;
    z?: number | null;
    x: number;
    y: number;
    rotation: number;
    splineEnd?: { x: number; y: number; };
    variants: Record<string, FoxholeSceneV2ModificationVariantMetadata>;
}

export interface FoxholeSceneV2VisualMetadata {
    nativeSurface?: NativeSplineSurface;
    resourceId: string;
    width: number;
    height: number;
    anchorX: number;
    anchorY: number;
    offsetX: number;
    offsetY: number;
}

export interface FoxholeSceneV2PackagedMetadata {
    structure?: FoxholeSceneV2VisualMetadata;
    pallet?: FoxholeSceneV2VisualMetadata & { rotation: number; };
}

export interface FoxholeSceneV2CargoMetadata {
    groups?: import('./stockpile-groups.ts').FoxholeStockpileSelectionGroup[];
    limit: number | null;
    retainsWhenPackaged: boolean;
    offsetX: number;
    offsetY: number;
    allowsAnyItem?: boolean;
    allowedItems?: string[];
}

export interface FoxholeSceneV2BuildSocketMetadata {
    name: string;
    x: number;
    y: number;
    z?: number;
    rotation: number;
    breachFace?: boolean;
    integrityBonus?: boolean;
    componentType?: string;
    socketTags?: Array<{ mask: number; category: number; tag?: string; }>;
}

export interface FoxholeSceneV2ConnectorMeshMetadata {
    mode: string;
    interval: number;
    startOffset: number;
    endOffset: number;
    relativeLocation?: number[];
    materialScale?: number[];
}

export interface FoxholeSceneV2ConnectorMetadata {
    pathStyle: string;
    behavior?: import('./connector-behavior.ts').FoxholeConnectorBehaviorManifest;
    enforceSplineModeCornerRadius?: boolean;
    meshConfigs: FoxholeSceneV2ConnectorMeshMetadata[];
    spline?: boolean;
    backSocketName?: string;
    frontSocketName?: string;
    minLengthCm?: number;
    maxLengthCm?: number;
    minRadiusCm?: number;
    maxRadiusCm?: number;
    maxBufferCm?: number;
    maxTargetAngleDeg?: number;
    maxArcAngleDeg?: number;
}

export interface FoxholeSceneV2AssetMetadata {
    model?: import('./scene-v2-models.ts').FoxholeSceneV2ModelMetadata;
    browserAttributes?: NixieExperimentalProductAttributeV1[];
    description?: string;
    categoryOrder?: number;
    order?: number;
    browserIcon?: { resourceId: string; frame: { x: number; y: number; width: number; height: number; }; };
    browserPreview?: { resourceId: string; frame: { x: number; y: number; width: number; height: number; }; };
    ranges?: FoxholeSceneV2StructureRange[];
    overlaySockets?: FoxholeBunkerStatisticsSocket[];
    overlayRailCouplers?: FoxholeBunkerStatisticsSocket[];
    selectionPolygons?: Array<{ shape: number[]; }>;
    /** Authored Foxhole build footprint polygons in metres from the asset origin. */
    footprintPolygons?: Array<{ shape: number[]; }>;
    /** Static facility placement requires authored foundation coverage. */
    requiresFoundation?: boolean;
    selectionDestroyed?: { width: number; height: number; offsetX: number; offsetY: number; selectionPolygons?: Array<{ shape: number[]; }>; };
    selectionPackaged?: { width: number; height: number; offsetX: number; offsetY: number; };
    bunker?: FoxholeBunkerStatisticsMetadata;
    statistics?: FoxholeResourceStatisticsMetadata;
    production?: FoxholeStatisticsStructure;
    powerSocketMaxConnections?: number;
    profileType?: string;
    isRailVehicle?: boolean;
    label: string;
    codeName: string;
    category: string;
    categoryLabel?: string;
    keywords: string[];
    isItem: boolean;
    supportsProduction?: boolean;
    faction?: 'c' | 'w';
    tier?: number | null;
    techId?: string;
    isVehicle?: boolean;
    isBunker?: boolean;
    isFacility?: boolean;
    isWorldStructure?: boolean;
    isUpgrade?: boolean;
    hasHigherTierSibling?: boolean;
    parentStructureId?: string | null;
    downgradeStructureId?: string | null;
    implicitUpgradeTier?: number | null;
    width: number;
    height: number;
    x: number;
    y: number;
    canBlueprint: boolean;
    breachable?: boolean;
    structuralGarrison?: boolean;
    isDestroyed?: boolean;
    isBreached?: boolean;
    factionVariants: Partial<Record<'c' | 'w', FoxholeSceneV2VisualMetadata>>;
    colorVariants: Record<string, FoxholeSceneV2VisualMetadata>;
    destroyed?: FoxholeSceneV2VisualMetadata;
    destroyedAssetId?: string;
    packaged?: FoxholeSceneV2PackagedMetadata;
    cargo?: FoxholeSceneV2CargoMetadata;
    connector?: FoxholeSceneV2ConnectorMetadata;
    buildSockets: FoxholeSceneV2BuildSocketMetadata[];
    spotlights?: FoxholeAuthoredSpotlight[];
    renderLayers: Record<string, FoxholeSceneV2VisualMetadata & { componentTags?: string[]; }>;
    modifications: Record<string, FoxholeSceneV2ModificationSlotMetadata>;
}

export interface FoxholeSceneV2ModificationResourceSource {
    id: string;
    sourceUrl: string;
}

export interface FoxholeSceneV2VisualResourceSource {
    id: string;
    sourceUrl: string;
}

interface PublishedFoxholeSprite {
    source?: string;
    width?: number;
    height?: number;
    textureWidth?: number;
    textureHeight?: number;
    anchorX?: number;
    anchorY?: number;
    offsetX?: number;
    offsetY?: number;
}

interface PublishedFoxholeRenderLayer {
    ns?: unknown;
    i?: string;
    u?: string;
    w?: number;
    h?: number;
    ax?: number | null;
    ay?: number | null;
    ox?: number | null;
    oy?: number | null;
    ct?: string[];
}

interface PublishedFoxholeConnectorMesh {
    mode?: string;
    interval?: number;
    start?: number;
    end?: number;
    relativeLocation?: number[];
    materialScale?: number[];
}

interface PublishedFoxholeConnector {
    pathStyle?: string;
    behavior?: import('./connector-behavior.ts').FoxholeConnectorBehaviorManifest;
    enforceSplineModeCornerRadius?: boolean;
    enforceRadius?: boolean;
    meshConfigs?: PublishedFoxholeConnectorMesh[];
    splineComponentName?: string;
    backSocketName?: string;
    frontSocketName?: string;
    minLengthCm?: number;
    maxLengthCm?: number;
    minRadiusCm?: number;
    minR?: number;
    maxRadiusCm?: number;
    maxR?: number;
    maxBufferCm?: number;
    buffer?: number;
    maxTargetAngleDeg?: number;
    maxTargetAngle?: number;
    maxArcAngleDeg?: number;
    maxArc?: number;
}

interface PublishedFoxholeTextureVariant {
    textureUrl?: string;
}

interface PublishedFoxholeColorVariant {
    hex?: string;
    textureUrl?: string;
    previewUrl?: string;
}

interface PublishedFoxholeDestroyedVisual extends PublishedFoxholeSprite {
    textureUrl?: string;
    sprite?: PublishedFoxholeSprite;
}

interface PublishedFoxholePackagedVisual extends PublishedFoxholeDestroyedVisual {
    shippableType?: string;
    palletOffset?: { x?: number; y?: number; rotationDegrees?: number; };
}

interface PublishedFoxholePackagingVisual extends PublishedFoxholeSprite {
    textureUrl?: string;
}

interface PublishedFoxholeHoldProfile {
    itemQuantityLimits?: Record<string, number>;
    mode?: 'stockpile' | 'crate-stockpile' | 'inventory' | 'fuel-tank';
    capacity?: number;
    allowsAnyItem?: boolean;
    allowedItems?: string[];
}

export interface FoxholeSceneV2StructureRange {
    type: string;
    codeName?: string;
    x?: number | null;
    y?: number | null;
    rotation?: number | null;
    arc?: number | null;
    min?: number | null;
    max?: number | null;
    reach?: number | null;
    overlap?: number | null;
}

interface PublishedFoxholeRange extends Partial<FoxholeSceneV2StructureRange> {
    t?: string; c?: string; r?: number; a?: number; mn?: number; mx?: number; o?: number;
}

interface PublishedFoxholeBuildSocket {
    name?: string;
    n?: string;
    x?: number;
    y?: number;
    z?: number;
    pipeType?: string;
    p?: string;
    rotation?: number;
    r?: number;
    componentType?: string;
    c?: string;
    breachFace?: boolean;
    bf?: boolean;
    integrityBonus?: boolean;
    ib?: boolean;
    socketTags?: Array<{ mask?: number; category?: number; m?: number; c?: number; tag?: string; g?: string; }>;
    t?: Array<{ mask?: number; category?: number; m?: number; c?: number; tag?: string; g?: string; }>;
}

interface PublishedFoxholeConversionEntry extends FoxholePublishedProductionEntry {
    id?: number;
    itemOutput?: Record<string, unknown>;
    crateOutput?: Record<string, unknown>;
    liquidOutput?: Record<string, unknown>;
    io?: Record<string, unknown>;
    co?: Record<string, unknown>;
    lo?: Record<string, unknown>;
}

interface PublishedFoxholeModificationVariant {
    previewUrl?: string;
    description?: string;
    icons?: { default?: string; rendered?: string; };
    buildSockets?: PublishedFoxholeBuildSocket[];
    selectionPolygons?: Array<{ shape: number[]; }>;
    cost?: Record<string, unknown>;
    name?: string;
    upgradeName?: string;
    sharedModificationId?: string;
    sprite?: PublishedFoxholeSprite;
    isUpgrade?: boolean;
    conversionEntries?: PublishedFoxholeConversionEntry[];
}

interface PublishedFoxholeModificationSlot {
    componentType?: string;
    name?: string;
    x?: number;
    y?: number;
    z?: number;
    linkedSocketNames?: string[];
    rotation?: number;
    variants?: Record<string, PublishedFoxholeModificationVariant>;
}

export interface PublishedFoxholeAssetForSceneV2 {
    stockpiles?: import('./stockpile-groups.ts').NativeStockpileGroup[];
    spotlights?: unknown[];
    bIsBuiltOnFoundation?: boolean;
    bIsBuiltOnLandscape?: boolean;
    vehicleSeats?: unknown[];
    stockpile?: { totalItemCapacity?: number; totalCrateCapacity?: number; };
    previewUrl?: string;
    description?: string;
    ranges?: PublishedFoxholeRange[];
    maxHealth?: number | null;
    cost?: Record<string, unknown>;
    legacyKey?: string;
    liquidCapacity?: number | null;
    decays?: boolean | null;
    decaySupplyDrain?: number | null;
    repairCost?: number | null;
    inventorySlots?: number | null;
    fuelTanks?: Array<{ capacity?: number | null; q?: number | null; }>;
    structuralIntegrity?: number | null;
    parentStructureId?: string | null;
    maxOrders?: number | null;
    powerGridInfo?: { maxConnections?: number | null; powerDelta?: number | null; };
    id: string;
    codeName?: string;
    name?: string;
    faction?: string | null;
    tier?: number | null;
    techId?: string;
    isVehicle?: boolean;
    isBunker?: boolean;
    isFacility?: boolean;
    isWorldStructure?: boolean;
    isUpgrade?: boolean;
    upgradeStructureCodeName?: string;
    upgradeStructureId?: string;
    conversionCodeNames?: string[];
    profileType?: string;
    wheelBase?: number;
    railCouplers?: unknown[];
    selectionPolygons?: Array<{ shape: number[]; }>;
    footprintPolygons?: Array<{ shape: number[]; }>;
    categoryId?: string;
    isItem?: boolean;
    icons?: { default?: string; rendered?: string; };
    sprite?: PublishedFoxholeSprite;
    variants?: {
        default?: PublishedFoxholeTextureVariant;
        c?: PublishedFoxholeTextureVariant;
        w?: PublishedFoxholeTextureVariant;
    };
    colors?: PublishedFoxholeColorVariant[];
    canBlueprint?: boolean;
    breachable?: boolean;
    structuralGarrison?: boolean;
    isDestroyed?: boolean;
    isBreached?: boolean;
    destroyedStructureCodeName?: string;
    destroyed?: PublishedFoxholeDestroyedVisual;
    packaged?: PublishedFoxholePackagedVisual;
    holdProfile?: PublishedFoxholeHoldProfile;
    markedCargoOverlay?: { offsetX?: number; offsetY?: number; };
    connector?: PublishedFoxholeConnector;
    buildSockets?: PublishedFoxholeBuildSocket[];
    renderLayers?: PublishedFoxholeRenderLayer[];
    conversionEntries?: PublishedFoxholeConversionEntry[];
    modifications?: PublishedFoxholeModificationSlot[];
}

export interface PublishedFoxholeManifestForSceneV2 {
    categories?: Array<{ id: string; name?: string; order?: number; }>;
    localizations?: Array<{ locale: string; strings: Record<string, string>; }>;
    shared?: {
        bunkerDestruction?: { weapons?: Record<string, FoxholeBunkerDestructionWeaponInput>; };
        modifications?: Record<string, PublishedFoxholeModificationVariant>;
        packaging?: Record<string, PublishedFoxholePackagingVisual>;
    };
    assets?: PublishedFoxholeAssetForSceneV2[];
}

const safeAssetIdPattern = /^[a-z0-9-]{1,128}$/u;
const FOXHOLE_BOARD_SPRITE_SCALE = 0.5;

function humanizeAssetId(value: string): string {
    return value
        .replace(/[_-]+/gu, ' ')
        .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
        .replace(/([A-Za-z])(\d)/gu, '$1 $2')
        .replace(/(\d)([A-Za-z])/gu, '$1 $2')
        .replace(/\s+/gu, ' ')
        .trim()
        .replace(/^./u, character => character.toUpperCase());
}

function publishedTier(asset: PublishedFoxholeAssetForSceneV2, strings: Record<string, string>): number | null {
    if (typeof asset.tier === 'number' && Number.isFinite(asset.tier)) {
        return asset.tier;
    }
    const match = asset.codeName?.match(/T(\d+)$/iu) ?? strings[asset.name ?? '']?.match(/\(Tier\s+(\d+)\)$/iu);
    return match ? Number(match[1]) : null;
}

function overlaySocketMetadata(sockets: readonly PublishedFoxholeBuildSocket[] | undefined): FoxholeBunkerStatisticsSocket[] {
    return (sockets ?? []).map(socket => ({ name: String(socket.name ?? socket.n ?? '').trim(),
        x: socket.x, y: socket.y, z: socket.z, rotation: socket.rotation ?? socket.r,
        componentType: socket.componentType ?? socket.c, pipeType: socket.pipeType ?? socket.p,
        integrityBonus: socket.integrityBonus ?? socket.ib, breachFace: socket.breachFace ?? socket.bf,
        socketTags: (socket.socketTags ?? socket.t ?? []).map(tag => ({ mask: tag.mask ?? tag.m ?? 0, category: tag.category ?? tag.c ?? 0, tag: tag.tag ?? tag.g })) }));
}

function finiteNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function sharedModificationSourceUrl(sharedModificationId: string): string {
    const assetPathId = sharedModificationId.trim().replace(/(-[a-f0-9]{12})-\d+$/u, '$1');
    return `/foxhole/assets/shared/modifications/${assetPathId}/${assetPathId}.texture.webp`;
}

function safeModificationResourceId(value: string): string {
    if (!safeAssetIdPattern.test(value)) {
        throw new Error(`Foxhole Scene V2 modification resource ID is not portable: ${value}`);
    }
    return value;
}

function visualResourceSourceUrl(value: unknown): string {
    const sourceUrl = String(value ?? '').trim();
    return sourceUrl.startsWith('/foxhole/assets/') && sourceUrl.endsWith('.webp') ? sourceUrl : '';
}

function createVisualMetadata(
    resourceId: string,
    visual: PublishedFoxholeSprite,
    fallback: PublishedFoxholeSprite,
): FoxholeSceneV2VisualMetadata | null {
    const width = finiteNumber(visual.width, finiteNumber(fallback.width, Number.NaN));
    const height = finiteNumber(visual.height, finiteNumber(fallback.height, Number.NaN));
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
        return null;
    }
    return {
        resourceId,
        width: width * FOXHOLE_BOARD_SPRITE_SCALE,
        height: height * FOXHOLE_BOARD_SPRITE_SCALE,
        anchorX: finiteNumber(visual.anchorX, finiteNumber(fallback.anchorX, 0.5)),
        anchorY: finiteNumber(visual.anchorY, finiteNumber(fallback.anchorY, 0.5)),
        offsetX: finiteNumber(visual.offsetX, finiteNumber(fallback.offsetX)) * FOXHOLE_BOARD_SPRITE_SCALE,
        offsetY: finiteNumber(visual.offsetY, finiteNumber(fallback.offsetY)) * FOXHOLE_BOARD_SPRITE_SCALE,
    };
}

function mergeModificationVariant(
    shared: PublishedFoxholeModificationVariant | undefined,
    variant: PublishedFoxholeModificationVariant,
): PublishedFoxholeModificationVariant {
    return {
        ...shared,
        ...variant,
        sprite: {
            ...(shared?.sprite ?? {}),
            ...(variant.sprite ?? {}),
        },
    };
}

function createCargoMetadata(asset: PublishedFoxholeAssetForSceneV2): FoxholeSceneV2CargoMetadata | undefined {
    const profile = asset.holdProfile;
    if (!profile) {
        return undefined;
    }
    const capacity = finiteNumber(profile.capacity, Number.NaN);
    const limit = profile.mode === 'fuel-tank'
        ? 1
        : (profile.mode === 'inventory' || profile.mode === 'crate-stockpile')
            && Number.isFinite(capacity)
            && capacity > 0
            ? capacity
            : null;
    return {
        limit,
        groups: resolveFoxholeStockpileSelectionGroups(asset.stockpiles),
        retainsWhenPackaged: profile.mode === 'stockpile'
            || profile.mode === 'crate-stockpile'
            || profile.mode === 'fuel-tank',
        offsetX: finiteNumber(asset.markedCargoOverlay?.offsetX),
        offsetY: finiteNumber(asset.markedCargoOverlay?.offsetY),
        allowsAnyItem: profile.allowsAnyItem === true,
        allowedItems: [...(profile.allowedItems ?? [])],
    };
}

function conversionEntryOutputs(entry: PublishedFoxholeConversionEntry): string[] {
    return [...new Set([
        ...Object.keys(entry.itemOutput ?? entry.io ?? {}),
        ...Object.keys(entry.crateOutput ?? entry.co ?? {}),
        ...Object.keys(entry.liquidOutput ?? entry.lo ?? {}),
    ].map(value => value.trim()).filter(Boolean))];
}

function conversionEntryOrdinal(entry: PublishedFoxholeConversionEntry, index: number): number {
    return typeof entry.id === 'number' && Number.isFinite(entry.id) ? entry.id : index;
}

export function createFoxholeSceneV2AssetMetadata(
    manifest: PublishedFoxholeManifestForSceneV2,
): {
    assets: Record<string, FoxholeSceneV2AssetMetadata>;
    productionOutputsByRecipeId: Record<string, string[]>;
    productionRecipesById: Record<string, FoxholeStatisticsRecipe>;
    bunkerDestructionWeapons: Record<string, FoxholeBunkerDestructionWeaponInput>;
    modificationResources: FoxholeSceneV2ModificationResourceSource[];
    browserImageSources: string[];
    visualResources: FoxholeSceneV2VisualResourceSource[];
} {
    const resources = new Map<string, string>();
    const visualResources = new Map<string, string>();
    const sharedModifications = manifest.shared?.modifications ?? {};
    const publishedAssets = manifest.assets ?? [];
    const strings = manifest.localizations?.find(localization => localization.locale === 'en')?.strings ?? {};
    const browserImages = new Map<string, number>();
    const browserImage = (source: string | undefined): FoxholeSceneV2AssetMetadata['browserIcon'] => {
        if (!source) {
            return undefined;
        }
        if (!source.startsWith('/foxhole/assets/') || !source.endsWith('.webp') || source.includes('..')) {
            throw new Error('Invalid library image source.');
        }
        let index = browserImages.get(source);
        if (index === undefined) {
            index = browserImages.size;
            browserImages.set(source, index);
        }
        return { resourceId: `foxhole.browser.${Math.floor(index / 64)}`, frame: { x: (index % 8) * 256, y: Math.floor(index % 64 / 8) * 256, width: 256, height: 256 } };
    };
    const categoryOrders = new Map((manifest.categories ?? []).map((category, index) => [category.id, category.order ?? index]));
    const categoryLabels = new Map((manifest.categories ?? []).map(category => [
        category.id, strings[category.name ?? ''] || humanizeAssetId(category.id),
    ]));
    const productionOutputsByRecipeId: Record<string, string[]> = {};
    const productionRecipesById: Record<string, FoxholeStatisticsRecipe> = {};
    const assetsByCodeName = new Map(publishedAssets.map(asset => [String(asset.codeName ?? '').trim().toLowerCase(), asset]));
    const assetsById = new Map(publishedAssets.map(asset => [asset.id, asset]));
    const lowerTierById = new Map<string, string>();
    for (const source of publishedAssets) {
        if (source.isUpgrade || source.isDestroyed || source.isBreached) continue;
        const target = assetsById.get(source.upgradeStructureId ?? '')
            ?? assetsByCodeName.get(String(source.upgradeStructureCodeName ?? '').trim().toLowerCase());
        if (target && target.id !== source.id && !lowerTierById.has(target.id)) lowerTierById.set(target.id, source.id);
    }
    const conversionTargets = new Set(publishedAssets.flatMap(asset => asset.conversionCodeNames ?? [])
        .map(codeName => codeName.toLowerCase()));
    const addVisualResource = (id: string, sourceUrlValue: unknown): string | null => {
        const safeId = safeModificationResourceId(id);
        const sourceUrl = visualResourceSourceUrl(sourceUrlValue);
        if (!sourceUrl) {
            return null;
        }
        const existingSource = visualResources.get(safeId);
        if (existingSource && existingSource !== sourceUrl) {
            throw new Error(`Foxhole Scene V2 visual resource collision: ${safeId}`);
        }
        visualResources.set(safeId, sourceUrl);
        return `foxhole.visual.${safeId}`;
    };
    const assets = Object.fromEntries(publishedAssets.map((asset, assetIndex) => {
        if (!safeAssetIdPattern.test(asset.id)) {
            throw new Error(`Foxhole Scene V2 asset ID is not portable: ${asset.id}`);
        }
        const sprite = asset.sprite;
        if (typeof sprite?.width !== 'number' || typeof sprite.height !== 'number') {
            throw new Error(`Foxhole Scene V2 asset metadata is incomplete: ${asset.id}`);
        }
        const factionVariants = Object.fromEntries((['c', 'w'] as const).flatMap(faction => {
            const resourceId = addVisualResource(`${asset.id}-faction-${faction}`, asset.variants?.[faction]?.textureUrl);
            const visual = resourceId ? createVisualMetadata(resourceId, sprite, sprite) : null;
            return visual ? [[faction, visual]] : [];
        })) as Partial<Record<'c' | 'w', FoxholeSceneV2VisualMetadata>>;
        const colorVariants = Object.fromEntries((asset.colors ?? []).flatMap(color => {
            const colorHex = String(color.hex ?? '').trim().replace(/^#/u, '').toLowerCase();
            if (!/^[a-f0-9]{6}$/u.test(colorHex)) {
                return [];
            }
            const resourceId = addVisualResource(`${asset.id}-color-${colorHex}`, color.textureUrl);
            const visual = resourceId ? createVisualMetadata(resourceId, sprite, sprite) : null;
            return visual ? [[colorHex, visual]] : [];
        }));
        const destroyedSource = visualResourceSourceUrl(asset.destroyed?.sprite?.source ?? asset.destroyed?.textureUrl);
        const destroyedResourceId = destroyedSource
            ? addVisualResource(`${asset.id}-destroyed`, destroyedSource)
            : null;
        const destroyedSprite = asset.destroyed?.sprite ?? asset.destroyed;
        let destroyed = destroyedResourceId && destroyedSprite
            ? createVisualMetadata(destroyedResourceId, destroyedSprite, sprite)
            : null;
        const relatedDestroyed = !destroyed
            ? assetsByCodeName.get(String(asset.destroyedStructureCodeName ?? '').trim().toLowerCase())
            : undefined;
        if (!destroyed) {
            const related = relatedDestroyed;
            if (related?.sprite && safeAssetIdPattern.test(related.id)) {
                destroyed = createVisualMetadata(`foxhole.asset.${related.id}`, related.sprite, related.sprite);
            }
        }
        const packagedSource = visualResourceSourceUrl(asset.packaged?.sprite?.source ?? asset.packaged?.textureUrl);
        const packagedResourceId = packagedSource
            ? addVisualResource(`${asset.id}-packaged`, packagedSource)
            : null;
        const packagedStructure = packagedResourceId && asset.packaged
            ? createVisualMetadata(packagedResourceId, asset.packaged.sprite ?? asset.packaged, sprite)
            : null;
        const packagingId = String(asset.packaged?.shippableType ?? '').trim().toLowerCase();
        const packaging = packagingId ? manifest.shared?.packaging?.[packagingId] : undefined;
        const palletResourceId = packaging
            ? addVisualResource(`packaging-${packagingId}`, packaging.textureUrl)
            : null;
        const palletBase = palletResourceId && packaging
            ? createVisualMetadata(palletResourceId, packaging, packaging)
            : null;
        const palletOffset = asset.packaged?.palletOffset;
        const packagedPallet = palletBase
            ? {
                ...palletBase,
                offsetX: palletBase.offsetX + finiteNumber(palletOffset?.x) * FOXHOLE_BOARD_SPRITE_SCALE,
                offsetY: palletBase.offsetY + finiteNumber(palletOffset?.y) * FOXHOLE_BOARD_SPRITE_SCALE,
                rotation: finiteNumber(palletOffset?.rotationDegrees) * (Math.PI / 180),
            }
            : null;
        const points = (asset.selectionPolygons ?? []).flatMap(polygon => polygon.shape.length >= 6 && polygon.shape.length % 2 === 0 && polygon.shape.every(Number.isFinite) ? [polygon.shape] : []);
        const xs = points.flatMap(shape => shape.filter((_, index) => index % 2 === 0).map(x => x * 32));
        const ys = points.flatMap(shape => shape.filter((_, index) => index % 2 === 1).map(y => y * 32));
        const selectionBounds = { minX: xs.length ? Math.min(...xs) : finiteNumber(sprite.offsetX) * 0.5 - sprite.width * 0.25,
            maxX: xs.length ? Math.max(...xs) : finiteNumber(sprite.offsetX) * 0.5 + sprite.width * 0.25,
            minY: ys.length ? Math.min(...ys) : finiteNumber(sprite.offsetY) * 0.5 - sprite.height * 0.25,
            maxY: ys.length ? Math.max(...ys) : finiteNumber(sprite.offsetY) * 0.5 + sprite.height * 0.25 };
        let supportsProduction = Boolean(asset.conversionEntries?.length);
        const eligibleModificationSlots = (asset.modifications ?? [])
            .filter(slot => isFoxholeModificationSlotTierEligible(slot.componentType, publishedTier(asset, strings)));
        const modifications = Object.fromEntries(eligibleModificationSlots.map((slot, slotIndex) => {
            const slotId = String(slot.name ?? '').trim();
            if (!slotId) {
                throw new Error(`Foxhole Scene V2 modification slot is missing a name: ${asset.id}[${slotIndex}]`);
            }
            const variants = Object.fromEntries(Object.entries(slot.variants ?? {}).map(([variantId, variant], variantIndex) => {
                const sharedModificationId = String(variant.sharedModificationId ?? '').trim();
                const shared = sharedModificationId ? sharedModifications[sharedModificationId] : undefined;
                const resolved = mergeModificationVariant(shared, variant);
                (resolved.conversionEntries ?? []).forEach((entry, entryIndex) => {
                    supportsProduction = true;
                    const normalizedVariantId = variantId.trim();
                    if (!normalizedVariantId) {
                        return;
                    }
                    const recipeId = `modification:${asset.id}:${slotId}:${normalizedVariantId}:recipe:${conversionEntryOrdinal(entry, entryIndex)}`;
                    productionOutputsByRecipeId[recipeId] = conversionEntryOutputs(entry);
                    productionRecipesById[recipeId] = createFoxholeStatisticsRecipe(recipeId, asset.id, entry, normalizedVariantId);
                });
                const resolvedSprite = resolved.sprite;
                if (typeof resolvedSprite?.width !== 'number' || typeof resolvedSprite.height !== 'number') {
                    throw new Error(`Foxhole Scene V2 modification metadata is incomplete: ${asset.id}/${slotId}/${variantId}`);
                }
                const resourceSuffix = safeModificationResourceId(sharedModificationId
                    ? `shared-${sharedModificationId}`
                    : `${asset.id}-${slotIndex}-${variantIndex}`);
                const sourceUrl = String(resolvedSprite.source ?? (sharedModificationId
                    ? sharedModificationSourceUrl(sharedModificationId)
                    : '')).trim();
                if (!sourceUrl.startsWith('/foxhole/assets/') || !sourceUrl.endsWith('.webp')) {
                    throw new Error(`Foxhole Scene V2 modification texture is unavailable: ${asset.id}/${slotId}/${variantId}`);
                }
                const existingSource = resources.get(resourceSuffix);
                if (existingSource && existingSource !== sourceUrl) {
                    throw new Error(`Foxhole Scene V2 modification resource collision: ${resourceSuffix}`);
                }
                resources.set(resourceSuffix, sourceUrl);
                return [variantId, {
                    browserIcon: browserImage(resolved.icons?.default),
                    browserPreview: browserImage(resolved.previewUrl ?? resolved.icons?.rendered),
                    description: strings[resolved.description ?? '']?.trim() || undefined,
                    id: variantId,
                    overlaySockets: overlaySocketMetadata(resolved.buildSockets),
                    resourceId: `foxhole.mod.${resourceSuffix}`,
                    width: resolvedSprite.width * FOXHOLE_BOARD_SPRITE_SCALE,
                    height: resolvedSprite.height * FOXHOLE_BOARD_SPRITE_SCALE,
                    anchorX: finiteNumber(resolvedSprite.anchorX, 0.5),
                    anchorY: finiteNumber(resolvedSprite.anchorY, 0.5),
                    offsetX: finiteNumber(resolvedSprite.offsetX) * FOXHOLE_BOARD_SPRITE_SCALE,
                    offsetY: finiteNumber(resolvedSprite.offsetY) * FOXHOLE_BOARD_SPRITE_SCALE,
                    selectionPolygons: resolved.selectionPolygons ?? [],
                    isUpgrade: resolved.isUpgrade === true,
                    label: strings[resolved.name ?? '']?.trim() || resolved.upgradeName?.trim() || humanizeAssetId(variantId),
                } satisfies FoxholeSceneV2ModificationVariantMetadata];
            }));
            const anchor = resolveFoxholeModificationTextureAnchor({ ...slot, name: slotId }, selectionBounds,
                (asset.buildSockets ?? []).map(socket => ({ name: String(socket.name ?? socket.n ?? ''), x: socket.x, y: socket.y, rotation: socket.rotation ?? socket.r })));
            const splineEnd = resolveFoxholeEmplacementModificationSplineEnd(asset.id, { ...slot, name: slotId }, selectionBounds,
                (asset.buildSockets ?? []).map(socket => ({ name: String(socket.name ?? socket.n ?? ''), x: socket.x, y: socket.y })));
            return [slotId, {
                id: slotId, name: slotId, z: slot.z ?? null,
                componentType: slot.componentType,
                linkedSocketNames: slot.linkedSocketNames ?? [],
                x: anchor.x,
                y: anchor.y,
                rotation: finiteNumber(slot.rotation) * (Math.PI / 180),
                ...(splineEnd ? { splineEnd } : {}),
                variants,
            } satisfies FoxholeSceneV2ModificationSlotMetadata];
        }));
        const renderLayers = Object.fromEntries((asset.renderLayers ?? []).flatMap((layer, layerIndex) => {
            const layerId = String(layer.i ?? '').trim().toLowerCase();
            if (!safeAssetIdPattern.test(layerId)) {
                return [];
            }
            const resourceId = addVisualResource(`${asset.id}-layer-${layerId}`, layer.u);
            if (!resourceId) {
                return [];
            }
            const visual = createVisualMetadata(resourceId, {
                width: layer.w,
                height: layer.h,
                anchorX: layer.ax ?? 0.5,
                anchorY: layer.ay ?? 0.5,
                offsetX: layer.ox ?? 0,
                offsetY: layer.oy ?? 0,
            }, sprite);
            if (!visual) {
                throw new Error(`Foxhole Scene V2 render layer metadata is incomplete: ${asset.id}/${layerId || layerIndex}`);
            }
            const nativeSurface = readNativeSplineSurface(layer.ns);
            return [[layerId, { ...visual, ...(nativeSurface ? { nativeSurface } : {}), componentTags: layer.ct ?? [] }]];
        }));
        if (/^sandbag(?:half|full)spline$/iu.test(asset.id) && !renderLayers.span) {
            const resourceId = addVisualResource(`${asset.id}-layer-span`,
                asset.variants?.default?.textureUrl
                    ?? `/foxhole/assets/types/structures/${asset.id}/${asset.id}.texture.webp`);
            const visual = resourceId ? createVisualMetadata(resourceId, {
                width: sprite.width, height: sprite.height,
                anchorX: 0.5, anchorY: 0.5, offsetX: 0, offsetY: 0,
            }, sprite) : null;
            if (visual) {
                renderLayers.span = { ...visual, componentTags: [] };
            }
        }
        (asset.conversionEntries ?? []).forEach((entry, entryIndex) => {
            const recipeId = `structure:${asset.id}:recipe:${conversionEntryOrdinal(entry, entryIndex)}`;
            productionOutputsByRecipeId[recipeId] = conversionEntryOutputs(entry);
            productionRecipesById[recipeId] = createFoxholeStatisticsRecipe(recipeId, asset.id, entry);
        });
        const cargo = createCargoMetadata(asset);
        const connector = asset.connector
            ? {
                pathStyle: resolveConnectorVisualPathStyle(asset.connector.pathStyle, asset.id) ?? '',
                spline: asset.connector.splineComponentName === 'SplineConnector'
                    || /^sandbag(?:half|full)spline$/iu.test(asset.id)
                    || resolveConnectorBehavior(asset.id, asset.connector).trimSpan
                    || resolveConnectorBehavior(asset.id, asset.connector).mineSpline,
                ...resolveConnectorEndpointSocketNames(asset.id, asset.connector),
                minLengthCm: asset.connector.minLengthCm,
                maxLengthCm: asset.connector.maxLengthCm,
                minRadiusCm: asset.connector.minRadiusCm ?? asset.connector.minR,
                maxRadiusCm: asset.connector.maxRadiusCm ?? asset.connector.maxR,
                maxBufferCm: asset.connector.maxBufferCm ?? asset.connector.buffer,
                maxTargetAngleDeg: asset.connector.maxTargetAngleDeg ?? asset.connector.maxTargetAngle,
                maxArcAngleDeg: asset.connector.maxArcAngleDeg ?? asset.connector.maxArc,
                ...(asset.connector.behavior ? { behavior: { ...asset.connector.behavior } } : {}),
                enforceSplineModeCornerRadius: (asset.connector.enforceSplineModeCornerRadius ?? asset.connector.enforceRadius) === true,
                meshConfigs: (asset.connector.meshConfigs ?? []).map(config => ({
                    mode: String(config.mode ?? '').trim().toLowerCase(),
                    interval: Math.max(0, finiteNumber(config.interval) * 0.32),
                    startOffset: Math.max(0, finiteNumber(config.start) * 0.32),
                    endOffset: Math.max(0, finiteNumber(config.end) * 0.32),
                    ...(config.relativeLocation ? { relativeLocation: config.relativeLocation.map(value => finiteNumber(value)) } : {}),
                    ...(config.materialScale ? { materialScale: config.materialScale.map(value => finiteNumber(value)) } : {}),
                })),
            } satisfies FoxholeSceneV2ConnectorMetadata
            : undefined;
        const buildSockets = (asset.buildSockets ?? []).flatMap(socket => {
            const name = String(socket.name ?? socket.n ?? '').trim();
            if (!name) {
                return [];
            }
            return [{
                name,
                x: finiteNumber(socket.x) * 0.32,
                y: finiteNumber(socket.y) * 0.32,
                ...(socket.z === undefined ? {} : { z: finiteNumber(socket.z) * 0.32 }),
                rotation: finiteNumber(socket.rotation ?? socket.r) * (Math.PI / 180),
                componentType: String(socket.componentType ?? socket.c ?? ''),
                breachFace: (socket.breachFace ?? socket.bf) === true,
                integrityBonus: (socket.integrityBonus ?? socket.ib) !== false,
                socketTags: (socket.socketTags ?? socket.t ?? []).flatMap(tag => {
                    const mask = finiteNumber(tag.mask ?? tag.m, Number.NaN);
                    const category = finiteNumber(tag.category ?? tag.c, Number.NaN);
                    return Number.isSafeInteger(mask) && mask > 0 && Number.isSafeInteger(category) && category > 0
                        ? [{ mask, category, ...((tag.tag ?? tag.g) ? { tag: tag.tag ?? tag.g } : {}) }]
                        : (tag.tag ?? tag.g)
                            ? [{ mask: 0, category: 0, tag: tag.tag ?? tag.g }]
                            : [];
                }),
            }];
        });
        const selectionAlternative = (alternative: PublishedFoxholeSprite & { sprite?: PublishedFoxholeSprite; } | undefined, fallback = sprite) => alternative
            ? {
                width: finiteNumber(alternative.sprite?.width ?? alternative.textureWidth, fallback.width) * FOXHOLE_BOARD_SPRITE_SCALE,
                height: finiteNumber(alternative.sprite?.height ?? alternative.textureHeight, fallback.height) * FOXHOLE_BOARD_SPRITE_SCALE,
                offsetX: finiteNumber(alternative.sprite?.offsetX ?? alternative.offsetX, finiteNumber(fallback.offsetX)) * FOXHOLE_BOARD_SPRITE_SCALE,
                offsetY: finiteNumber(alternative.sprite?.offsetY ?? alternative.offsetY, finiteNumber(fallback.offsetY)) * FOXHOLE_BOARD_SPRITE_SCALE,
            }
            : undefined;
        const requiresFoundation = asset.isFacility === true
            && asset.bIsBuiltOnLandscape === false
            && ['facility', 'power', 'mining', 'liquids'].includes(asset.categoryId ?? '')
            && connector?.spline !== true;
        return [asset.id, {
            selectionPolygons: asset.selectionPolygons ?? [],
            footprintPolygons: asset.footprintPolygons ?? [],
            requiresFoundation,
            selectionDestroyed: relatedDestroyed?.sprite
                ? { ...selectionAlternative(relatedDestroyed, relatedDestroyed.sprite)!, selectionPolygons: relatedDestroyed.selectionPolygons ?? [] }
                : selectionAlternative(asset.destroyed),
            selectionPackaged: selectionAlternative(asset.packaged),
            label: strings[asset.name ?? '']?.trim() || humanizeAssetId(asset.codeName ?? asset.id),
            description: strings[asset.description ?? '']?.trim() || undefined,
            categoryOrder: categoryOrders.get(asset.categoryId ?? '') ?? 0,
            order: assetIndex * 10,
            browserIcon: browserImage(asset.icons?.default),
            // Compact published manifests omit conventional preview URLs. Match
            // the authored card preview rather than substituting the library icon.
            browserPreview: browserImage(asset.previewUrl ?? (asset.isItem
                ? asset.icons?.rendered ?? asset.icons?.default
                : asset.colors?.[0]?.previewUrl
                    ?? `/foxhole/assets/types/${asset.isVehicle ? 'vehicles' : 'structures'}/${asset.id}/${asset.id}.preview${asset.colors?.[0]?.hex ? `.${asset.colors[0].hex.replace(/^#/, '').toLowerCase()}` : ''}.webp`)),
            browserAttributes: [asset.inventorySlots ? `Slots: ${Math.round(asset.inventorySlots)}` : '',
                requiresFoundation ? 'Requires Foundation' : '', asset.vehicleSeats?.length ? `Seats: ${asset.vehicleSeats.length}` : '',
                asset.decays ? 'Decays' : '', asset.liquidCapacity ? `Liquid: ${asset.liquidCapacity.toLocaleString('en-US')}` : '',
                (() => {
                    const fuel = (asset.fuelTanks ?? []).reduce((total, tank) => total + finiteNumber(tank.capacity ?? tank.q), 0)
                        || (asset.holdProfile?.mode === 'fuel-tank'
                            ? asset.holdProfile.capacity
                            ?? Object.values(asset.holdProfile.itemQuantityLimits ?? {}).reduce((sum, capacity) => sum + capacity, 0)
                            : 0);
                    return fuel ? `Fuel: ${fuel.toLocaleString('en-US')}` : '';
                })(),
                Math.max(asset.stockpile?.totalItemCapacity ?? 0, asset.stockpile?.totalCrateCapacity ?? 0)
                    ? `Stockpile: ${Math.max(asset.stockpile?.totalItemCapacity ?? 0, asset.stockpile?.totalCrateCapacity ?? 0).toLocaleString('en-US')}`
                    : '',
                asset.powerGridInfo?.powerDelta
                    ? `${asset.powerGridInfo.powerDelta > 0 ? '+' : ''}${Number.isInteger(asset.powerGridInfo.powerDelta / 1000)
                        ? asset.powerGridInfo.powerDelta / 1000
                        : (asset.powerGridInfo.powerDelta / 1000).toFixed(1)} MW`
                    : '',
            ].flatMap((label, index) => label
                ? [{ label, icon: ['ph:grid-nine-fill', 'ph:buildings-fill', 'ph:seat-fill',
                    'ph:shield-warning-fill', 'ph:drop-fill', 'ph:gas-pump-fill', 'ph:archive-box-fill', 'nx:lightning'][index]!,
                tone: index === 7 ? 'warning' as const : 'accent' as const }]
                : []),
            codeName: asset.codeName?.trim() || asset.id,
            category: asset.categoryId?.trim() || 'uncategorized',
            categoryLabel: categoryLabels.get(asset.categoryId ?? '') || humanizeAssetId(asset.categoryId || 'Uncategorized'),
            keywords: [...new Set([
                asset.id,
                asset.codeName?.trim() ?? '',
                humanizeAssetId(asset.codeName ?? asset.id),
                asset.categoryId?.trim() ?? '',
            ].filter(Boolean))],
            isItem: asset.isItem === true,
            supportsProduction,
            ...(asset.faction === 'c' || asset.faction === 'w' ? { faction: asset.faction } : {}),
            tier: publishedTier(asset, strings),
            techId: asset.techId ?? '',
            parentStructureId: asset.parentStructureId ?? null,
            downgradeStructureId: lowerTierById.get(asset.id) ?? null,
            isVehicle: asset.isVehicle === true || asset.profileType?.trim().toLowerCase() === 'vehicleproxy',
            isBunker: asset.isBunker === true,
            isFacility: asset.isFacility === true,
            isWorldStructure: asset.isWorldStructure === true,
            isUpgrade: asset.isUpgrade === true || conversionTargets.has((asset.codeName ?? asset.id).toLowerCase()),
            hasHigherTierSibling: asset.isUpgrade !== true && (() => {
                const target = assetsById.get(asset.upgradeStructureId ?? '')
                    ?? assetsByCodeName.get((asset.upgradeStructureCodeName ?? '').toLowerCase());
                if (target && target.id !== asset.id && target.isUpgrade !== true) {
                    return true;
                }
                const tier = publishedTier(asset, strings);
                const family = (asset.codeName ?? '').replace(/T\d+$/iu, '').toLowerCase();
                const nameFamily = (strings[asset.name ?? ''] ?? '').replace(/\s*\(Tier\s+\d+\)$/iu, '').toLowerCase();
                return tier !== null && publishedAssets.some(candidate => candidate.id !== asset.id && candidate.isUpgrade !== true
                    && candidate.categoryId === asset.categoryId && (candidate.faction ?? null) === (asset.faction ?? null)
                    && (publishedTier(candidate, strings) ?? -1) > tier
                    && (family
                        ? (candidate.codeName ?? '').replace(/T\d+$/iu, '').toLowerCase() === family
                        : Boolean(nameFamily) && (strings[candidate.name ?? ''] ?? '').replace(/\s*\(Tier\s+\d+\)$/iu, '').toLowerCase() === nameFamily));
            })(),
            implicitUpgradeTier: (() => {
                const match = (asset.upgradeStructureCodeName ?? asset.upgradeStructureId ?? '').match(/T(\d+)$/iu);
                return match ? Number(match[1]) : null;
            })(),
            profileType: asset.profileType,
            production: { maxOrders: asset.maxOrders ?? null, parentStructureId: asset.parentStructureId ?? null, powerDelta: asset.powerGridInfo?.powerDelta ?? null },
            statistics: { cost: normalizeFoxholeStatisticsCost(asset.cost),
                modificationCosts: Object.fromEntries(eligibleModificationSlots.map((slot, slotIndex) => [String(slot.name ?? slotIndex),
                    Object.fromEntries(Object.entries(slot.variants ?? {}).map(([variantId, variant]) => {
                        const shared = variant.sharedModificationId ? sharedModifications[variant.sharedModificationId] : null;
                        const cost = variant.cost && Object.keys(variant.cost).length ? variant.cost : shared?.cost ?? variant.cost;
                        return [variantId, normalizeFoxholeStatisticsCost(cost)];
                    }))])), parentId: asset.parentStructureId ?? null, upgradeCodeName: asset.upgradeStructureCodeName,
                canBackfillUpgrade: asset.isUpgrade !== true && asset.isDestroyed !== true && asset.isBreached !== true,
                legacyKey: asset.legacyKey, liquidCapacity: asset.liquidCapacity, powerDelta: asset.powerGridInfo?.powerDelta,
                decays: asset.decays, decaySupplyDrain: asset.decaySupplyDrain, repairCost: asset.repairCost, inventorySlots: asset.inventorySlots,
                fuelCapacity: (asset.fuelTanks ?? []).reduce((total, tank) => total + finiteNumber(tank.capacity), 0), structuralIntegrity: asset.structuralIntegrity },
            ranges: (asset.ranges ?? []).flatMap(range => {
                const type = String(range.type ?? range.t ?? '').trim();
                return type
                    ? [{ type, codeName: range.codeName ?? range.c, x: range.x, y: range.y, rotation: range.rotation ?? range.r,
                        arc: range.arc ?? range.a, min: range.min ?? range.mn, max: range.max ?? range.mx, reach: range.reach, overlap: range.overlap ?? range.o }]
                    : [];
            }),
            overlaySockets: overlaySocketMetadata(asset.buildSockets),
            overlayRailCouplers: (asset.railCouplers ?? []).flatMap(value => {
                if (!value || typeof value !== 'object' || Array.isArray(value)) {
                    return [];
                }
                const coupler = value as Record<string, unknown>;
                const name = String(coupler.name ?? coupler.n ?? '').trim();
                return name
                    ? [{ name, componentType: 'RailCouplerUseComponent', socketTags: [],
                        x: finiteNumber(coupler.x), y: finiteNumber(coupler.y), z: finiteNumber(coupler.z),
                        rotation: finiteNumber(coupler.rotation ?? coupler.r, name === 'RearCoupler' ? 180 : 0) }]
                    : [];
            }),
            bunker: { codeName: asset.codeName?.trim() || asset.id, profileType: asset.profileType, isDestroyed: asset.isDestroyed, isBreached: asset.isBreached,
                breachable: asset.breachable, structuralGarrison: asset.structuralGarrison, maxHealth: asset.maxHealth, repairCost: asset.repairCost,
                structuralIntegrity: asset.structuralIntegrity, sockets: (asset.buildSockets ?? []).flatMap(socket => {
                    const name = String(socket.name ?? socket.n ?? '').trim();
                    return name
                        ? [{ name, x: socket.x ?? 0, y: socket.y ?? 0, z: socket.z ?? 0, rotation: socket.rotation ?? socket.r ?? 0,
                            componentType: socket.componentType ?? socket.c, pipeType: socket.pipeType, integrityBonus: socket.integrityBonus ?? socket.ib,
                            breachFace: socket.breachFace ?? socket.bf, socketTags: (socket.socketTags ?? socket.t ?? []).map(tag => ({
                                mask: tag.mask ?? tag.m ?? 0, category: tag.category ?? tag.c ?? 0, tag: tag.tag ?? tag.g,
                            })) }]
                        : [];
                }) },
            isRailVehicle: Number(asset.wheelBase ?? 0) > 0 || (asset.railCouplers?.length ?? 0) > 0,
            ...(Number.isFinite(asset.powerGridInfo?.maxConnections)
                ? { powerSocketMaxConnections: Math.max(1, Math.trunc(Number(asset.powerGridInfo!.maxConnections))) }
                : {}),
            width: sprite.width * FOXHOLE_BOARD_SPRITE_SCALE,
            height: sprite.height * FOXHOLE_BOARD_SPRITE_SCALE,
            x: finiteNumber(sprite.offsetX) * FOXHOLE_BOARD_SPRITE_SCALE,
            y: finiteNumber(sprite.offsetY) * FOXHOLE_BOARD_SPRITE_SCALE,
            canBlueprint: asset.canBlueprint === true,
            breachable: asset.breachable === true,
            structuralGarrison: asset.structuralGarrison === true,
            isDestroyed: asset.isDestroyed === true,
            isBreached: asset.isBreached === true,
            factionVariants,
            colorVariants,
            ...(destroyed ? { destroyed } : {}),
            ...(/^trenchconnectort[123]$/u.test(asset.id)
                && assetsByCodeName.has(String(asset.destroyedStructureCodeName ?? '').trim().toLowerCase())
                ? { destroyedAssetId: assetsByCodeName.get(String(asset.destroyedStructureCodeName).trim().toLowerCase())!.id }
                : {}),
            ...(packagedStructure || packagedPallet
                ? {
                    packaged: {
                        ...(packagedStructure ? { structure: packagedStructure } : {}),
                        ...(packagedPallet ? { pallet: packagedPallet } : {}),
                    },
                }
                : {}),
            ...(cargo ? { cargo } : {}),
            ...(connector ? { connector } : {}),
            buildSockets,
            spotlights: (asset.spotlights ?? []).flatMap(value => {
                const light = readFoxholeAuthoredSpotlight(value);
                return light ? [light] : [];
            }),
            renderLayers,
            modifications,
        } satisfies FoxholeSceneV2AssetMetadata];
    }));
    resolveFoxholeStatisticsCosts(assets, productionRecipesById);
    return {
        assets,
        productionOutputsByRecipeId,
        productionRecipesById,
        bunkerDestructionWeapons: { ...(manifest.shared?.bunkerDestruction?.weapons ?? {}) },
        modificationResources: [...resources].map(([id, sourceUrl]) => ({ id, sourceUrl })),
        browserImageSources: [...browserImages.keys()],
        visualResources: [...visualResources].map(([id, sourceUrl]) => ({ id, sourceUrl })),
    };
}
