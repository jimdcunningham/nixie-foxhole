import { z } from 'zod';
import { normalizeFoxholeFaction } from './types.ts';
import type { FoxholeFaction } from './types.ts';

export const DEFAULT_PUBLISHED_FOXHOLE_ASSETS_BASE_URL = '/foxhole/assets/';
const DEFAULT_CATEGORY_ID = 'structures';
const DEFAULT_CATEGORY_NAME = 'Structures';
// TODO: Remove this compatibility scale once Foxwatch emits canonical board-space dimensions.
const LEGACY_FOXHOLE_TEXTURE_SCALE = 32 / 52.8;

const localizedTextSchema = z.object({
    id: z.string().min(1),
    fallback: z.string(),
});

const localizedTextManifestInputSchema = z.union([
    localizedTextSchema,
    z.object({
        id: z.string(),
        fallback: z.string(),
    }),
    z.string().transform(value => ({
        id: '',
        fallback: value,
    })),
]);

const localizedTextBundleSchema = z.object({
    locale: z.string().min(1),
    strings: z.record(z.string(), z.string()),
});

const localizationIndexSchema = z.object({
    defaultLocale: z.string().min(1).default('en'),
    availableLocales: z.array(z.string().min(1)).default(['en']),
    files: z.record(z.string(), z.string()).default({}),
});

const optionalStringSchema = z.string().nullish().transform(value => {
    const normalized = String(value ?? '').trim();
    return normalized || undefined;
});
const optionalNumberSchema = z.number().nullish().transform(value => value ?? undefined);
const optionalBooleanSchema = z.boolean().nullish().transform(value => value ?? undefined);

function normalizeStructureColorHex(value: unknown): string | undefined {
    const normalized = String(value ?? '')
        .trim()
        .replace(/^0x/i, '')
        .replace(/^#/, '')
        .replace(/[^a-fA-F0-9]/g, '')
        .toLowerCase();

    return normalized.length === 6 || normalized.length === 8
        ? normalized
        : undefined;
}

function getDefaultLocaleStrings(source: Record<string, unknown>): Record<string, string> {
    const localizations = Array.isArray(source.localizations) ? source.localizations : [];
    const englishBundle = localizations.find(bundle => (
        bundle
        && typeof bundle === 'object'
        && String((bundle as { locale?: unknown; }).locale ?? '').trim().toLowerCase() === 'en'
    ));
    const fallbackBundle = englishBundle ?? localizations[0];
    if (!fallbackBundle || typeof fallbackBundle !== 'object') {
        return {};
    }

    const strings = (fallbackBundle as { strings?: unknown; }).strings;
    return strings && typeof strings === 'object' && !Array.isArray(strings)
        ? strings as Record<string, string>
        : {};
}

function compactLocalizationId(value: string): string {
    return value.trim()
        .replace(/^foxhole:/, '')
        .replace(/^structure:/, 'asset:')
        .replace(/:modification:/g, ':mod:')
        .replace(/:description$/, ':desc');
}

function createLocalizationLookupKeys(value: string): string[] {
    const trimmedValue = value.trim();
    const compactValue = compactLocalizationId(trimmedValue);
    const keys = new Set([trimmedValue, compactValue]);
    const legacyValue = compactValue
        .replace(/:mod:/g, ':modification:')
        .replace(/:desc$/, ':description');

    keys.add(`foxhole:${legacyValue}`);
    if (legacyValue.startsWith('asset:')) {
        keys.add(`foxhole:${legacyValue.replace(/^asset:/, 'structure:')}`);
    }

    return [...keys].filter(Boolean);
}

function compactTechId(value: unknown): unknown {
    if (typeof value !== 'string') {
        return value;
    }

    return value.trim().replace(/^ETechID::/, '');
}

function compactEnumToken(value: unknown, prefix: RegExp): unknown {
    if (typeof value !== 'string') {
        return value;
    }

    const normalized = value.trim().replace(prefix, '');
    return normalized ? normalized.toLowerCase() : normalized;
}

function compactConnectorMeshMode(value: unknown): unknown {
    return compactEnumToken(value, /^ESplineConnectorMeshMode::/);
}

function compactSplineMeshAxis(value: unknown): unknown {
    return compactEnumToken(value, /^ESplineMeshAxis::/);
}

function hydrateLocalizedTextInput(
    value: unknown,
    strings: Record<string, string>,
    options: {
        missingFallback?: string;
    } = {},
): unknown {
    if (typeof value === 'string') {
        const trimmedValue = value.trim();
        if (!trimmedValue) {
            return value;
        }

        const compactId = compactLocalizationId(trimmedValue);
        for (const lookupKey of createLocalizationLookupKeys(compactId)) {
            const fallback = strings[lookupKey];
            if (typeof fallback === 'string') {
                return {
                    id: compactId,
                    fallback,
                };
            }
        }

        return compactId.includes(':')
            ? {
                id: compactId,
                fallback: options.missingFallback ?? trimmedValue,
            }
            : value;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    const id = String(source.id ?? '').trim();
    if (!id) {
        return value;
    }

    const compactId = compactLocalizationId(id);
    if (typeof source.fallback === 'string') {
        return compactId === id
            ? value
            : {
                ...source,
                id: compactId,
            };
    }

    return {
        ...source,
        id: compactId,
        fallback: createLocalizationLookupKeys(id)
            .map(key => strings[key])
            .find(entry => typeof entry === 'string') ?? '',
    };
}

function hydrateSplineComponentConfigInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        componentName: source.componentName ?? source.n,
        distance: source.distance ?? source.d,
        relativeLocation: source.relativeLocation ?? source.loc,
        relativeRotation: source.relativeRotation ?? source.rot,
    };
}

function hydrateConnectorInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        pathMode: source.pathMode,
        minRadiusCm: source.minRadiusCm ?? source.minR,
        maxRadiusCm: source.maxRadiusCm ?? source.maxR,
        maxBufferCm: source.maxBufferCm ?? source.buffer,
        minBufferCm: source.minBufferCm ?? source.minBuffer,
        enforceSplineModeCornerRadius: source.enforceSplineModeCornerRadius ?? source.enforceRadius,
        maxArcAngleDeg: source.maxArcAngleDeg ?? source.maxArc,
        maxTargetAngleDeg: source.maxTargetAngleDeg ?? source.maxTargetAngle,
        maxSlopeAngleDeg: source.maxSlopeAngleDeg ?? source.maxSlope,
        pathStyle: source.pathStyle,
        meshConfigs: Array.isArray(source.meshConfigs)
            ? source.meshConfigs.map(meshConfig => {
                if (!meshConfig || typeof meshConfig !== 'object' || Array.isArray(meshConfig)) {
                    return meshConfig;
                }

                const sourceMeshConfig = meshConfig as Record<string, unknown>;
                const { meshPaths: _meshPaths, ...restMeshConfig } = sourceMeshConfig;
                return {
                    ...restMeshConfig,
                    mode: compactConnectorMeshMode(sourceMeshConfig.mode),
                    splineMeshAxis: compactSplineMeshAxis(sourceMeshConfig.splineMeshAxis ?? sourceMeshConfig.axis),
                    nativeMeshLengthCm: sourceMeshConfig.nativeMeshLengthCm ?? sourceMeshConfig.length,
                    startOffset: sourceMeshConfig.startOffset ?? sourceMeshConfig.start,
                    endOffset: sourceMeshConfig.endOffset ?? sourceMeshConfig.end,
                    fillRemainder: sourceMeshConfig.fillRemainder,
                    extendSplineToMinLength: sourceMeshConfig.extendSplineToMinLength ?? sourceMeshConfig.extendToMinLength,
                    splineStartOffset: sourceMeshConfig.splineStartOffset ?? sourceMeshConfig.splineStart,
                    splineEndOffset: sourceMeshConfig.splineEndOffset ?? sourceMeshConfig.splineEnd,
                    splineBoundaryMin: sourceMeshConfig.splineBoundaryMin ?? sourceMeshConfig.boundaryMin,
                    splineBoundaryMax: sourceMeshConfig.splineBoundaryMax ?? sourceMeshConfig.boundaryMax,
                    splineMaterialScaling: sourceMeshConfig.splineMaterialScaling ?? sourceMeshConfig.materialScale,
                    relativeLocation: sourceMeshConfig.relativeLocation ?? sourceMeshConfig.loc,
                    relativeScale: sourceMeshConfig.relativeScale ?? sourceMeshConfig.scale,
                };
            })
            : source.meshConfigs,
        componentConfigs: Array.isArray(source.componentConfigs)
            ? source.componentConfigs.map(hydrateSplineComponentConfigInput)
            : (Array.isArray(source.configs) ? source.configs.map(hydrateSplineComponentConfigInput) : source.componentConfigs),
    };
}

function hydrateSocketTagInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        mask: source.mask ?? source.m,
        category: source.category ?? source.c,
        tag: source.tag ?? source.g,
    };
}

function hydrateBuildSocketInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        name: source.name ?? source.n,
        componentType: source.componentType ?? source.c,
        pipeType: source.pipeType ?? source.p,
        socketTags: Array.isArray(source.socketTags)
            ? source.socketTags.map(hydrateSocketTagInput)
            : (Array.isArray(source.t) ? source.t.map(hydrateSocketTagInput) : source.socketTags),
        integrityBonus: source.integrityBonus ?? source.ib,
        breachFace: source.breachFace ?? source.bf,
        x: source.x,
        y: source.y,
        z: source.z,
        rotation: source.rotation ?? source.r,
    };
}

function isLandscapeCheckSocketInput(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return false;
    }

    const source = value as Record<string, unknown>;
    const name = String(source.name ?? source.n ?? '').trim();
    return /^LandscapeCheck(?:Socket)?\d*$/i.test(name);
}

function hydrateRailCouplerInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        name: source.name ?? source.n,
        x: source.x,
        y: source.y,
        z: source.z,
        rotation: source.rotation ?? source.r,
    };
}

function hydrateStructureVolumeInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        name: source.name ?? source.n,
        label: source.label ?? source.l,
        category: source.category ?? source.g,
        componentType: source.componentType ?? source.c,
        x: source.x ?? 0,
        y: source.y ?? 0,
        z: source.z ?? 0,
        width: source.width ?? source.w,
        length: source.length ?? source.d,
        height: source.height ?? source.h,
        rotation: source.rotation ?? source.r ?? 0,
    };
}

function hydrateVehicleSeatInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        name: source.name ?? source.n,
        componentType: source.componentType ?? source.c,
        seatType: source.seatType ?? source.t,
        seatDirection: source.seatDirection ?? source.d,
        mountCodeName: source.mountCodeName ?? source.m,
        mountComponent: hydrateVehicleSeatMountComponentInput(source.mountComponent ?? source.mc),
        x: source.x,
        y: source.y,
        z: source.z,
        rotation: source.rotation ?? source.r,
    };
}

function hydrateVehicleSeatMountComponentInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        packagePath: source.packagePath,
        codeName: source.codeName,
        displayName: source.displayName,
        iconUrl: source.iconUrl,
        ammoName: source.ammoName,
        compatibleAmmoNames: Array.isArray(source.compatibleAmmoNames) ? source.compatibleAmmoNames : source.compatibleAmmoNames,
        isMultiWeapon: source.isMultiWeapon,
    };
}

function hydrateSpotlightInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        name: source.name ?? source.n,
        componentType: source.componentType ?? source.c,
        lightType: source.lightType ?? source.t,
        x: source.x,
        y: source.y,
        z: source.z,
        rotation: source.rotation ?? source.r,
        planarProjectionScale: source.planarProjectionScale ?? source.ps,
        outerConeAngle: source.outerConeAngle ?? source.o,
        innerConeAngle: source.innerConeAngle ?? source.i,
        attenuationRadius: source.attenuationRadius ?? source.a,
        intensity: source.intensity ?? source.v,
        lightColor: source.lightColor ?? source.lc,
        sourceRadius: source.sourceRadius ?? source.sr,
        softSourceRadius: source.softSourceRadius ?? source.ssr,
        sourceLength: source.sourceLength ?? source.sl,
    };
}

function hydrateFuelTankInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        codeName: source.codeName ?? source.c,
        capacity: source.capacity ?? source.q,
    };
}

function hydrateHoldProfileInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        mode: source.mode ?? source.m,
        capacity: source.capacity ?? source.c,
        stackLimit: source.stackLimit ?? source.s,
        allowedItems: source.allowedItems ?? source.a,
        itemQuantityLimits: source.itemQuantityLimits ?? source.l,
        allowsAnyItem: source.allowsAnyItem ?? source.aa,
    };
}

function hydrateRecipeResourceInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        quantity: source.quantity ?? source.q,
        limit: source.limit ?? source.l,
    };
}

function hydrateRecipeResourceMapInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .map(([resourceId, resource]) => [resourceId, hydrateRecipeResourceInput(resource)]));
}

function hydrateConversionEntryInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        id: source.id,
        itemInput: hydrateRecipeResourceMapInput(source.itemInput ?? source.ii),
        crateInput: hydrateRecipeResourceMapInput(source.crateInput ?? source.ci),
        liquidInput: hydrateRecipeResourceMapInput(source.liquidInput ?? source.li),
        itemOutput: hydrateRecipeResourceMapInput(source.itemOutput ?? source.io),
        crateOutput: hydrateRecipeResourceMapInput(source.crateOutput ?? source.co),
        liquidOutput: hydrateRecipeResourceMapInput(source.liquidOutput ?? source.lo),
        duration: source.duration ?? source.d,
        powerDelta: source.powerDelta ?? source.p,
        bConsumeResourceNodes: source.bConsumeResourceNodes ?? source.rn,
    };
}

function hydrateRangeInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        type: source.type ?? source.t,
        codeName: source.codeName ?? source.c,
        x: source.x,
        y: source.y,
        rotation: source.rotation ?? source.r,
        arc: source.arc ?? source.a,
        min: source.min ?? source.mn,
        max: source.max ?? source.mx,
        reach: source.reach,
        overlap: source.overlap ?? source.o,
    };
}

function hydrateStructureRenderLayerInput(value: unknown): unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        id: source.id ?? source.i,
        textureUrl: source.textureUrl ?? source.u,
        width: source.width ?? source.w,
        height: source.height ?? source.h,
        anchorX: source.anchorX ?? source.ax,
        anchorY: source.anchorY ?? source.ay,
        offsetX: source.offsetX ?? source.ox,
        offsetY: source.offsetY ?? source.oy,
        componentName: source.componentName ?? source.cn,
        componentTags: Array.isArray(source.componentTags)
            ? source.componentTags
            : (Array.isArray(source.ct) ? source.ct : []),
    };
}

function hydrateStructureColorVariantInput(value: unknown): unknown {
    if (typeof value === 'string') {
        return {
            hex: value,
        };
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        hex: source.hex ?? source.id ?? source.colorHex ?? source.color,
        textureUrl: source.textureUrl ?? source.texture ?? source.u,
        previewUrl: source.previewUrl ?? source.preview ?? source.p,
        renderedIconUrl: source.renderedIconUrl ?? source.previewIconUrl ?? source.iconRenderedUrl ?? source.i,
    };
}

function hydrateStructurePayloadInput(value: unknown): Record<string, unknown> | unknown {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        cost: hydrateRecipeResourceMapInput(source.cost),
        // These are terrain-validation probes rather than connectable structure sockets.
        buildSockets: Array.isArray(source.buildSockets)
            ? source.buildSockets.filter(socket => !isLandscapeCheckSocketInput(socket)).map(hydrateBuildSocketInput)
            : source.buildSockets,
        railCouplers: Array.isArray(source.railCouplers) ? source.railCouplers.map(hydrateRailCouplerInput) : source.railCouplers,
        selectionPolygons: source.selectionPolygons,
        lineOfSightPolygons: source.lineOfSightPolygons,
        structureVolumes: Array.isArray(source.structureVolumes) ? source.structureVolumes.map(hydrateStructureVolumeInput) : source.structureVolumes,
        vehicleSeats: Array.isArray(source.vehicleSeats) ? source.vehicleSeats.map(hydrateVehicleSeatInput) : source.vehicleSeats,
        spotlights: Array.isArray(source.spotlights) ? source.spotlights.map(hydrateSpotlightInput) : source.spotlights,
        fuelTanks: Array.isArray(source.fuelTanks) ? source.fuelTanks.map(hydrateFuelTankInput) : source.fuelTanks,
        holdProfile: source.holdProfile && typeof source.holdProfile === 'object' && !Array.isArray(source.holdProfile)
            ? hydrateHoldProfileInput(source.holdProfile)
            : source.holdProfile,
        conversionEntries: Array.isArray(source.conversionEntries) ? source.conversionEntries.map(hydrateConversionEntryInput) : source.conversionEntries,
        ranges: Array.isArray(source.ranges) ? source.ranges.map(hydrateRangeInput) : source.ranges,
        renderLayers: Array.isArray(source.renderLayers) ? source.renderLayers.map(hydrateStructureRenderLayerInput) : source.renderLayers,
        colors: Array.isArray(source.colors) ? source.colors.map(hydrateStructureColorVariantInput) : source.colors,
    };
}

function getPublishedAssetTypeName(asset: Record<string, unknown>): 'items' | 'structures' | 'vehicles' {
    if (asset.isVehicle === true) {
        return 'vehicles';
    }

    if (asset.isItem === true) {
        return 'items';
    }

    return 'structures';
}

function createGeneratedAssetUrl(asset: Record<string, unknown>, suffix: string): string {
    const assetId = String(asset.id ?? '').trim();
    return `${DEFAULT_PUBLISHED_FOXHOLE_ASSETS_BASE_URL}types/${getPublishedAssetTypeName(asset)}/${assetId}/${assetId}${suffix}.webp`;
}

function createGeneratedColorVariantAssetUrl(asset: Record<string, unknown>, suffix: string, colorHex: string): string {
    return createGeneratedAssetUrl(asset, `${suffix}.${colorHex}`);
}

function getStructureColorHexesFromAsset(asset: Record<string, unknown>): string[] {
    const colors = Array.isArray(asset.colors) ? asset.colors : [];
    const seen = new Set<string>();
    const orderedHexes: string[] = [];

    for (const color of colors) {
        const normalizedHex = typeof color === 'string'
            ? normalizeStructureColorHex(color)
            : normalizeStructureColorHex((color as { hex?: unknown; id?: unknown; }).hex ?? (color as { id?: unknown; }).id);
        if (!normalizedHex || seen.has(normalizedHex)) {
            continue;
        }

        seen.add(normalizedHex);
        orderedHexes.push(normalizedHex);
    }

    return orderedHexes;
}

function findSourceStructureColorVariant(asset: Record<string, unknown>, colorHex: string): Record<string, unknown> {
    const normalizedHex = normalizeStructureColorHex(colorHex);
    if (!normalizedHex) {
        return {};
    }

    const colors = Array.isArray(asset.colors) ? asset.colors : [];
    const matchedColor = colors.find(color => {
        if (!color || typeof color !== 'object' || Array.isArray(color)) {
            return false;
        }

        return normalizeStructureColorHex((color as { hex?: unknown; id?: unknown; }).hex ?? (color as { id?: unknown; }).id) === normalizedHex;
    });

    return matchedColor && typeof matchedColor === 'object' && !Array.isArray(matchedColor)
        ? matchedColor as Record<string, unknown>
        : {};
}

function hydrateStructureColors(asset: Record<string, unknown>): Record<string, unknown>[] {
    return getStructureColorHexesFromAsset(asset).map(colorHex => {
        const sourceVariant = findSourceStructureColorVariant(asset, colorHex);
        return {
            ...sourceVariant,
            hex: colorHex,
            textureUrl: sourceVariant.textureUrl ?? createGeneratedColorVariantAssetUrl(asset, '.texture', colorHex),
            previewUrl: sourceVariant.previewUrl ?? createGeneratedColorVariantAssetUrl(asset, '.preview', colorHex),
            renderedIconUrl: sourceVariant.renderedIconUrl ?? createGeneratedColorVariantAssetUrl(asset, '.icon.rendered', colorHex),
        };
    });
}

function createGeneratedSharedModificationAssetUrl(sharedModificationId: string, suffix: string): string {
    const assetPathId = sharedModificationId.trim().replace(/(-[a-f0-9]{12})-\d+$/, '$1');
    return `${DEFAULT_PUBLISHED_FOXHOLE_ASSETS_BASE_URL}shared/modifications/${assetPathId}/${assetPathId}${suffix}.webp`;
}

function createGeneratedHostModificationAssetUrl(structureId: string, modificationId: string, suffix: string): string {
    return `${DEFAULT_PUBLISHED_FOXHOLE_ASSETS_BASE_URL}types/structures/${structureId}/modifications/${modificationId}/${modificationId}${suffix}.webp`;
}

function collectModificationVisualUrls(variant: Record<string, unknown>): string[] {
    const urls: string[] = [];
    const previewUrl = typeof variant.previewUrl === 'string' ? variant.previewUrl : '';
    if (previewUrl) {
        urls.push(previewUrl);
    }

    const sprite = variant.sprite && typeof variant.sprite === 'object' && !Array.isArray(variant.sprite)
        ? variant.sprite as Record<string, unknown>
        : null;
    if (typeof sprite?.source === 'string' && sprite.source.trim().length > 0) {
        urls.push(sprite.source);
    }

    const icons = variant.icons && typeof variant.icons === 'object' && !Array.isArray(variant.icons)
        ? variant.icons as Record<string, unknown>
        : null;
    for (const iconUrl of [icons?.default, icons?.rendered, variant.iconUrl]) {
        if (typeof iconUrl === 'string' && iconUrl.trim().length > 0) {
            urls.push(iconUrl);
        }
    }

    const renderLayers = Array.isArray(variant.renderLayers) ? variant.renderLayers : [];
    for (const layer of renderLayers) {
        if (!layer || typeof layer !== 'object') {
            continue;
        }

        const layerRecord = layer as Record<string, unknown>;
        for (const layerUrl of [layerRecord.textureUrl, layerRecord.u]) {
            if (typeof layerUrl === 'string' && layerUrl.trim().length > 0) {
                urls.push(layerUrl);
            }
        }
    }

    return urls;
}

function variantHasHostLocalModificationVisuals(structureId: string, variant: Record<string, unknown>): boolean {
    const normalizedStructureId = String(structureId ?? '').trim().toLowerCase();
    if (!normalizedStructureId) {
        return false;
    }

    const hostPrefix = `${DEFAULT_PUBLISHED_FOXHOLE_ASSETS_BASE_URL}types/structures/${normalizedStructureId}/modifications/`;
    return collectModificationVisualUrls(variant).some(url => url.toLowerCase().includes(hostPrefix));
}

export function normalizeFoxholePackagedPalletKey(value: unknown): string | null {
    const normalized = String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '');
    if (!normalized) {
        return null;
    }

    return normalized === 'small'
        ? 'normal'
        : normalized;
}

function hydrateSharedModificationVisualInput(sharedModificationId: string, modification: Record<string, unknown>): Record<string, unknown> {
    const sourceIcons = modification.icons && typeof modification.icons === 'object' && !Array.isArray(modification.icons)
        ? modification.icons as Record<string, unknown>
        : {};
    const sourceSprite = modification.sprite && typeof modification.sprite === 'object' && !Array.isArray(modification.sprite)
        ? modification.sprite as Record<string, unknown>
        : {};
    const defaultIconUrl = typeof sourceIcons.default === 'string' && sourceIcons.default.trim().length > 0
        ? sourceIcons.default
        : createGeneratedSharedModificationAssetUrl(sharedModificationId, '.icon.default');

    return {
        ...modification,
        icons: {
            ...sourceIcons,
            default: defaultIconUrl,
            rendered: sourceIcons.rendered ?? createGeneratedSharedModificationAssetUrl(sharedModificationId, '.icon.rendered'),
        },
        previewUrl: modification.previewUrl ?? createGeneratedSharedModificationAssetUrl(sharedModificationId, '.preview'),
        sprite: {
            ...sourceSprite,
            source: sourceSprite.source ?? createGeneratedSharedModificationAssetUrl(sharedModificationId, '.texture'),
        },
    };
}

function hydrateStructureIcons(asset: Record<string, unknown>): Record<string, unknown> {
    const sourceIcons = asset.icons && typeof asset.icons === 'object' && !Array.isArray(asset.icons)
        ? asset.icons as Record<string, unknown>
        : {};
    const colorVariants = hydrateStructureColors(asset);
    const defaultColorVariant = colorVariants[0];
    const defaultIconUrl = sourceIcons.default ?? asset.iconUrl;

    if (asset.isItem === true) {
        return {
            ...(defaultIconUrl ? { default: defaultIconUrl } : {}),
            rendered: sourceIcons.rendered ?? asset.previewIconUrl,
        };
    }

    return {
        ...(defaultIconUrl ? { default: defaultIconUrl } : {}),
        rendered: sourceIcons.rendered ?? asset.previewIconUrl ?? defaultColorVariant?.renderedIconUrl ?? createGeneratedAssetUrl(asset, '.icon.rendered'),
    };
}

function hydrateStructureVariants(asset: Record<string, unknown>): Record<string, unknown> {
    const sourceVariants = asset.variants && typeof asset.variants === 'object' && !Array.isArray(asset.variants)
        ? asset.variants as Record<string, unknown>
        : {};
    const sourceDefaultVariant = sourceVariants.default && typeof sourceVariants.default === 'object' && !Array.isArray(sourceVariants.default)
        ? sourceVariants.default as Record<string, unknown>
        : {};
    const colorVariants = hydrateStructureColors(asset);
    const defaultColorVariant = colorVariants[0];

    if (asset.isItem === true) {
        const textureUrl = sourceDefaultVariant.textureUrl;
        return {
            ...sourceVariants,
            ...(typeof textureUrl === 'string' && textureUrl.trim().length > 0
                ? {
                    default: {
                        ...sourceDefaultVariant,
                        textureUrl,
                    },
                }
                : {}),
        };
    }

    return {
        ...sourceVariants,
        default: {
            ...sourceDefaultVariant,
            textureUrl: sourceDefaultVariant.textureUrl ?? defaultColorVariant?.textureUrl ?? createGeneratedAssetUrl(asset, '.texture'),
        },
    };
}

function hydrateDestroyedVisualInput(asset: Record<string, unknown>): unknown {
    if (!asset.destroyed || typeof asset.destroyed !== 'object' || Array.isArray(asset.destroyed)) {
        return asset.destroyed;
    }

    const destroyed = asset.destroyed as Record<string, unknown>;
    const sourceIcons = destroyed.icons && typeof destroyed.icons === 'object' && !Array.isArray(destroyed.icons)
        ? destroyed.icons as Record<string, unknown>
        : {};
    const sourceSprite = destroyed.sprite && typeof destroyed.sprite === 'object' && !Array.isArray(destroyed.sprite)
        ? destroyed.sprite as Record<string, unknown>
        : {};
    const renderedIconUrl = sourceIcons.rendered ?? destroyed.previewIconUrl ?? createGeneratedAssetUrl(asset, '.destroyed.icon.rendered');

    return {
        ...destroyed,
        icons: {
            ...sourceIcons,
            rendered: renderedIconUrl,
        },
        previewIconUrl: destroyed.previewIconUrl ?? renderedIconUrl,
        previewUrl: destroyed.previewUrl ?? createGeneratedAssetUrl(asset, '.destroyed.preview'),
        sprite: {
            ...sourceSprite,
            source: sourceSprite.source ?? destroyed.textureUrl ?? createGeneratedAssetUrl(asset, '.destroyed.texture'),
            width: sourceSprite.width ?? destroyed.textureWidth,
            height: sourceSprite.height ?? destroyed.textureHeight,
            anchorX: sourceSprite.anchorX ?? destroyed.anchorX,
            anchorY: sourceSprite.anchorY ?? destroyed.anchorY,
            offsetX: sourceSprite.offsetX ?? destroyed.offsetX,
            offsetY: sourceSprite.offsetY ?? destroyed.offsetY,
        },
    };
}

function hydratePackagedVisualInput(asset: Record<string, unknown>): unknown {
    if (!asset.packaged || typeof asset.packaged !== 'object' || Array.isArray(asset.packaged)) {
        return asset.packaged;
    }

    const packaged = asset.packaged as Record<string, unknown>;
    const sourceSprite = packaged.sprite && typeof packaged.sprite === 'object' && !Array.isArray(packaged.sprite)
        ? packaged.sprite as Record<string, unknown>
        : {};
    const hasExplicitSpriteMetrics = [
        sourceSprite.width ?? packaged.textureWidth,
        sourceSprite.height ?? packaged.textureHeight,
        sourceSprite.anchorX ?? packaged.anchorX,
        sourceSprite.anchorY ?? packaged.anchorY,
        sourceSprite.offsetX ?? packaged.offsetX,
        sourceSprite.offsetY ?? packaged.offsetY,
    ].some(value => value !== undefined && value !== null);
    const normalizedSprite = {
        ...sourceSprite,
        source: sourceSprite.source ?? packaged.textureUrl ?? (hasExplicitSpriteMetrics ? createGeneratedAssetUrl(asset, '.packaged.texture') : undefined),
        width: sourceSprite.width ?? packaged.textureWidth,
        height: sourceSprite.height ?? packaged.textureHeight,
        anchorX: sourceSprite.anchorX ?? packaged.anchorX,
        anchorY: sourceSprite.anchorY ?? packaged.anchorY,
        offsetX: sourceSprite.offsetX ?? packaged.offsetX,
        offsetY: sourceSprite.offsetY ?? packaged.offsetY,
    };
    const hasExplicitSprite = Object.values(normalizedSprite).some(value => value !== undefined && value !== null);

    return {
        ...packaged,
        ...(hasExplicitSprite
            ? {
                sprite: normalizedSprite,
            }
            : {}),
    };
}

const textureVariantSchema = z.object({
    textureUrl: z.string().min(1),
});

const spriteSchema = z.object({
    width: optionalNumberSchema,
    height: optionalNumberSchema,
    anchorX: z.number().default(0.5),
    anchorY: z.number().default(0.5),
    offsetX: z.number().default(0),
    offsetY: z.number().default(0),
});

const structureRenderLayerSchema = z.object({
    id: z.string().min(1),
    textureUrl: optionalStringSchema,
    width: optionalNumberSchema,
    height: optionalNumberSchema,
    anchorX: optionalNumberSchema,
    anchorY: optionalNumberSchema,
    offsetX: optionalNumberSchema,
    offsetY: optionalNumberSchema,
    componentName: optionalStringSchema,
    componentTags: z.array(z.string()).default([]),
});

const hitPolygonSchema = z.object({
    shape: z.array(z.number()).default([]),
});

const powerGridInfoSchema = z.object({
    powerDelta: optionalNumberSchema,
    maxConnections: optionalNumberSchema,
});

const connectorMeshConfigSchema = z.object({
    mode: optionalStringSchema,
    meshPaths: z.array(z.string()).default([]),
    splineMeshAxis: optionalStringSchema,
    nativeMeshLengthCm: optionalNumberSchema,
    interval: optionalNumberSchema,
    startOffset: optionalNumberSchema,
    endOffset: optionalNumberSchema,
    fillRemainder: optionalBooleanSchema,
    extendSplineToMinLength: optionalBooleanSchema,
    splineStartOffset: z.array(z.number()).nullish().transform(value => value ?? undefined),
    splineEndOffset: z.array(z.number()).nullish().transform(value => value ?? undefined),
    splineBoundaryMin: optionalNumberSchema,
    splineBoundaryMax: optionalNumberSchema,
    splineMaterialScaling: z.array(z.number()).nullish().transform(value => value ?? undefined),
    relativeLocation: z.array(z.number()).nullish().transform(value => value ?? undefined),
    relativeScale: z.array(z.number()).nullish().transform(value => value ?? undefined),
});

const splineComponentConfigSchema = z.object({
    componentName: optionalStringSchema,
    distance: optionalNumberSchema,
    relativeLocation: z.array(z.number()).nullish().transform(value => value ?? undefined),
    relativeRotation: z.array(z.number()).nullish().transform(value => value ?? undefined),
});

const connectorBehaviorSchema = z.object({
    trimSpan: optionalBooleanSchema,
    fieldConnectorSpan: optionalBooleanSchema,
    mineSpline: optionalBooleanSchema,
    railTrack: optionalBooleanSchema,
    railForkEndCaps: optionalBooleanSchema,
    powerline: optionalBooleanSchema,
    pipeCurveScale: optionalBooleanSchema,
    pipeExtension: optionalBooleanSchema,
    undergroundPipe: optionalBooleanSchema,
    socketSnapping: optionalBooleanSchema,
    tankStop: optionalBooleanSchema,
    renderEndCaps: optionalBooleanSchema,
});

const connectorSchema = z.object({
    kind: optionalStringSchema,
    isConnector: optionalBooleanSchema,
    isManualConnector: optionalBooleanSchema,
    splineComponentName: optionalStringSchema,
    frontSocketName: optionalStringSchema,
    backSocketName: optionalStringSchema,
    minLengthCm: optionalNumberSchema,
    maxLengthCm: optionalNumberSchema,
    minWidthCm: optionalNumberSchema,
    pathMode: optionalStringSchema,
    defaultTargetUnrealLocationCm: z.array(z.number()).nullish().transform(value => value ?? undefined),
    minRadiusCm: optionalNumberSchema,
    maxRadiusCm: optionalNumberSchema,
    maxBufferCm: optionalNumberSchema,
    minBufferCm: optionalNumberSchema,
    enforceSplineModeCornerRadius: optionalBooleanSchema,
    maxArcAngleDeg: optionalNumberSchema,
    maxTargetAngleDeg: optionalNumberSchema,
    maxSlopeAngleDeg: optionalNumberSchema,
    pathStyle: optionalStringSchema,
    meshConfigs: z.array(connectorMeshConfigSchema).default([]),
    componentConfigs: z.array(splineComponentConfigSchema).default([]),
    behavior: connectorBehaviorSchema.nullish().transform(value => value ?? undefined),
});

const structureRangeSchema = z.object({
    type: z.string().min(1),
    codeName: optionalStringSchema,
    x: optionalNumberSchema,
    y: optionalNumberSchema,
    rotation: optionalNumberSchema,
    arc: optionalNumberSchema,
    min: optionalNumberSchema,
    max: optionalNumberSchema,
    reach: optionalNumberSchema,
    overlap: optionalNumberSchema,
});

const socketTagSchema = z.object({
    mask: optionalNumberSchema,
    category: optionalNumberSchema,
    tag: optionalStringSchema,
});

const buildSocketSchema = z.object({
    name: optionalStringSchema,
    componentType: optionalStringSchema,
    pipeType: optionalStringSchema,
    socketTags: z.array(socketTagSchema).default([]),
    integrityBonus: optionalBooleanSchema,
    breachFace: optionalBooleanSchema,
    x: optionalNumberSchema,
    y: optionalNumberSchema,
    z: optionalNumberSchema,
    rotation: optionalNumberSchema,
});

const emplacementLocationSchema = z.object({
    x: optionalNumberSchema,
    y: optionalNumberSchema,
    z: optionalNumberSchema,
});

const railCouplerSchema = z.object({
    name: optionalStringSchema,
    x: optionalNumberSchema,
    y: optionalNumberSchema,
    z: optionalNumberSchema,
    rotation: optionalNumberSchema,
});

const structureVolumeSchema = z.object({
    name: z.string().default(''),
    label: z.string().default(''),
    category: z.string().default('other'),
    componentType: optionalStringSchema,
    x: z.number().default(0),
    y: z.number().default(0),
    z: z.number().default(0),
    width: optionalNumberSchema,
    length: optionalNumberSchema,
    height: optionalNumberSchema,
    rotation: z.number().default(0),
});

const vehicleSeatSchema = z.object({
    name: optionalStringSchema,
    componentType: optionalStringSchema,
    seatType: optionalStringSchema,
    seatDirection: optionalStringSchema,
    mountCodeName: optionalStringSchema,
    mountComponent: z.object({
        packagePath: optionalStringSchema,
        codeName: optionalStringSchema,
        displayName: optionalStringSchema,
        iconUrl: optionalStringSchema,
        ammoName: optionalStringSchema,
        compatibleAmmoNames: z.array(z.string()).default([]),
        isMultiWeapon: z.boolean().default(false),
    }).nullish().transform(value => value ?? undefined),
    x: optionalNumberSchema,
    y: optionalNumberSchema,
    z: optionalNumberSchema,
    rotation: optionalNumberSchema,
});

const spotlightSchema = z.object({
    name: optionalStringSchema,
    componentType: optionalStringSchema,
    lightType: optionalStringSchema,
    x: optionalNumberSchema,
    y: optionalNumberSchema,
    z: optionalNumberSchema,
    rotation: optionalNumberSchema,
    planarProjectionScale: optionalNumberSchema,
    outerConeAngle: optionalNumberSchema,
    innerConeAngle: optionalNumberSchema,
    attenuationRadius: optionalNumberSchema,
    intensity: optionalNumberSchema,
    lightColor: optionalStringSchema,
    sourceRadius: optionalNumberSchema,
    softSourceRadius: optionalNumberSchema,
    sourceLength: optionalNumberSchema,
});

const fuelTankSchema = z.object({
    codeName: z.string().min(1),
    capacity: optionalNumberSchema,
});

const stockpileSchema = z.object({
    totalItemCapacity: optionalNumberSchema,
    totalCrateCapacity: optionalNumberSchema,
    itemCategoryFilter: optionalNumberSchema,
    itemQuantityLimits: z.record(z.string(), z.number()).nullish().transform(value => value ?? undefined),
    validItems: z.array(z.string().min(1)).nullish().transform(value => value ?? undefined),
});

const holdProfileModeSchema = z.enum(['stockpile', 'crate-stockpile', 'inventory', 'fuel-tank']);

const holdProfileSchema = z.object({
    mode: holdProfileModeSchema,
    capacity: optionalNumberSchema,
    stackLimit: optionalNumberSchema,
    allowedItems: z.array(z.string().min(1)).nullish().transform(value => value ?? undefined),
    itemQuantityLimits: z.record(z.string(), z.number()).nullish().transform(value => value ?? undefined),
    allowsAnyItem: optionalBooleanSchema,
});

const markedCargoOverlaySchema = z.object({
    offsetX: optionalNumberSchema,
    offsetY: optionalNumberSchema,
});

const recipeResourceSchema = z.object({
    quantity: z.number(),
    limit: optionalNumberSchema,
});

const recipeResourceMapSchema = z.record(z.string(), recipeResourceSchema);

const conversionEntrySchema = z.object({
    id: optionalNumberSchema,
    itemInput: recipeResourceMapSchema.default({}),
    crateInput: recipeResourceMapSchema.default({}),
    liquidInput: recipeResourceMapSchema.default({}),
    itemOutput: recipeResourceMapSchema.default({}),
    crateOutput: recipeResourceMapSchema.default({}),
    liquidOutput: recipeResourceMapSchema.default({}),
    duration: optionalNumberSchema,
    powerDelta: optionalNumberSchema,
    bConsumeResourceNodes: optionalBooleanSchema,
});

const modificationVariantIconsManifestSchema = z.object({
    default: optionalStringSchema,
    rendered: optionalStringSchema,
});

const modificationVariantSpriteManifestSchema = spriteSchema.extend({
    source: z.string().min(1),
});

function normalizeModificationSlotVariantInput(value: unknown): unknown {
    if (!value || typeof value !== 'object') {
        return value;
    }

    const source = value as Record<string, unknown>;
    const sourceName = source.name;
    const sourceDescription = source.description;
    const sourceIcons = source.icons && typeof source.icons === 'object'
        ? source.icons as Record<string, unknown>
        : null;
    const sourceSprite = source.sprite && typeof source.sprite === 'object'
        ? source.sprite as Record<string, unknown>
        : null;
    const spriteSource = String(sourceSprite?.source ?? source.textureUrl ?? '').trim();
    const defaultIconUrl = String(sourceIcons?.default ?? source.iconUrl ?? '').trim();
    const renderedIconUrl = String(sourceIcons?.rendered ?? source.renderedIconUrl ?? source.iconUrl ?? '').trim();

    return hydrateStructurePayloadInput({
        ...source,
        name: typeof sourceName === 'object' && sourceName !== null
            ? sourceName
            : {
                id: String(source.nameLocalizationId ?? '').trim(),
                fallback: String(sourceName ?? '').trim(),
            },
        description: typeof sourceDescription === 'object' && sourceDescription !== null
            ? sourceDescription
            : {
                id: String(source.descriptionLocalizationId ?? '').trim(),
                fallback: String(sourceDescription ?? '').trim(),
            },
        icons: {
            default: defaultIconUrl || undefined,
            rendered: renderedIconUrl || undefined,
        },
        sprite: spriteSource
            ? {
                source: spriteSource,
                width: sourceSprite?.width ?? source.textureWidth,
                height: sourceSprite?.height ?? source.textureHeight,
                anchorX: sourceSprite?.anchorX ?? source.anchorX,
                anchorY: sourceSprite?.anchorY ?? source.anchorY,
                offsetX: sourceSprite?.offsetX ?? source.offsetX,
                offsetY: sourceSprite?.offsetY ?? source.offsetY,
            }
            : undefined,
    });
}

const sharedModificationManifestEntryObjectSchema = z.object({
    modificationId: optionalStringSchema,
    name: localizedTextManifestInputSchema,
    description: localizedTextManifestInputSchema,
    subTypeIconUrl: optionalStringSchema,
    requiredSocketConnectionMask: optionalNumberSchema,
    hiddenBySocketConnectionMask: optionalNumberSchema,
    showInBuildSite: optionalBooleanSchema,
    useTemplateActor: optionalBooleanSchema,
    powerGridInfo: powerGridInfoSchema.nullish().transform(value => value ?? undefined),
    buildSockets: z.array(buildSocketSchema).default([]),
    footprintPolygons: z.array(hitPolygonSchema).default([]),
    selectionPolygons: z.array(hitPolygonSchema).default([]),
    lineOfSightPolygons: z.array(hitPolygonSchema).default([]),
    fuelTanks: z.array(fuelTankSchema).default([]),
    conversionEntries: z.array(conversionEntrySchema).default([]),
    cost: recipeResourceMapSchema.default({}),
    totalCost: recipeResourceMapSchema.optional(),
    icons: modificationVariantIconsManifestSchema.nullish().transform(value => value ?? undefined),
    previewUrl: optionalStringSchema,
    previewDirection: optionalStringSchema,
    sprite: modificationVariantSpriteManifestSchema.nullish().transform(value => value ?? undefined),
    renderLayers: z.array(structureRenderLayerSchema).optional(),
    isUpgrade: optionalBooleanSchema,
    upgradeName: optionalStringSchema,
    parentStructureId: optionalStringSchema,
    rootStructureId: optionalStringSchema,
    appliedModificationId: optionalStringSchema,
});

const sharedModificationManifestEntrySchema = z.preprocess(
    normalizeModificationSlotVariantInput,
    sharedModificationManifestEntryObjectSchema,
);

const modificationManifestSchema = z.object({
    name: localizedTextManifestInputSchema,
    description: localizedTextManifestInputSchema,
    powerGridInfo: powerGridInfoSchema.nullish().transform(value => value ?? undefined),
    buildSockets: z.array(buildSocketSchema).default([]),
    footprintPolygons: z.array(hitPolygonSchema).default([]),
    fuelTanks: z.array(fuelTankSchema).default([]),
    conversionEntries: z.array(conversionEntrySchema).default([]),
    cost: recipeResourceMapSchema.default({}),
    totalCost: recipeResourceMapSchema.optional(),
    textureUrl: optionalStringSchema,
    iconUrl: optionalStringSchema,
    previewUrl: optionalStringSchema,
    previewDirection: optionalStringSchema,
    textureWidth: optionalNumberSchema,
    textureHeight: optionalNumberSchema,
    anchorX: optionalNumberSchema,
    anchorY: optionalNumberSchema,
    offsetX: optionalNumberSchema,
    offsetY: optionalNumberSchema,
    isUpgrade: optionalBooleanSchema,
    upgradeName: optionalStringSchema,
    parentStructureId: optionalStringSchema,
    rootStructureId: optionalStringSchema,
    appliedModificationId: optionalStringSchema,
});

const modificationSlotVariantManifestSchema = z.preprocess(
    normalizeModificationSlotVariantInput,
    sharedModificationManifestEntryObjectSchema.extend({
        sharedModificationId: optionalStringSchema,
        renderId: optionalStringSchema,
        // Identity inputs: retained so publish can recompute/validate renderId after parse.
        templateActorPath: optionalStringSchema,
        templateMeshPath: optionalStringSchema,
        previewMeshPath: optionalStringSchema,
        dataClassPath: optionalStringSchema,
    }),
);

const modificationSlotManifestSchema = z.object({
    name: z.string(),
    componentType: z.string(),
    x: optionalNumberSchema,
    y: optionalNumberSchema,
    z: optionalNumberSchema,
    rotation: optionalNumberSchema,
    isLinkedToSocket: z.boolean().default(false),
    linkedSocketNames: z.array(z.string()).default([]),
    blockedByModSlotNames: z.array(z.string()).default([]),
    variants: z.record(z.string(), modificationSlotVariantManifestSchema).default({}),
});

const structureIconsManifestSchema = z.object({
    default: optionalStringSchema,
    rendered: optionalStringSchema,
});

const structureColorVariantManifestSchema = z.preprocess(value => {
    if (typeof value === 'string') {
        return {
            hex: value,
        };
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    return {
        ...source,
        hex: source.hex ?? source.id ?? source.colorHex ?? source.color,
        textureUrl: source.textureUrl ?? source.texture ?? source.u,
        previewUrl: source.previewUrl ?? source.preview ?? source.p,
        renderedIconUrl: source.renderedIconUrl ?? source.previewIconUrl ?? source.iconRenderedUrl ?? source.i,
    };
}, z.object({
    hex: z.preprocess(value => normalizeStructureColorHex(value), z.string().min(1)),
    textureUrl: optionalStringSchema,
    previewUrl: optionalStringSchema,
    renderedIconUrl: optionalStringSchema,
}));

const structureDestroyedManifestSchema = z.object({
    componentName: optionalStringSchema,
    icons: structureIconsManifestSchema.nullish().transform(value => value ?? undefined),
    iconUrl: optionalStringSchema,
    previewIconUrl: optionalStringSchema,
    previewUrl: optionalStringSchema,
    previewIsIconFallback: optionalBooleanSchema,
    previewDirection: optionalStringSchema,
    textureUrl: optionalStringSchema,
    textureWidth: optionalNumberSchema,
    textureHeight: optionalNumberSchema,
    anchorX: optionalNumberSchema,
    anchorY: optionalNumberSchema,
    offsetX: optionalNumberSchema,
    offsetY: optionalNumberSchema,
    sprite: modificationVariantSpriteManifestSchema.nullish().transform(value => value ?? undefined),
});

const packagedPalletOffsetSchema = z.object({
    x: optionalNumberSchema,
    y: optionalNumberSchema,
    rotationDegrees: optionalNumberSchema,
});

const sharedPackagedPalletManifestEntrySchema = z.preprocess(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return value;
    }

    const source = value as Record<string, unknown>;
    const sourceSprite = source.sprite && typeof source.sprite === 'object' && !Array.isArray(source.sprite)
        ? source.sprite as Record<string, unknown>
        : {};

    return {
        ...source,
        textureUrl: source.textureUrl ?? sourceSprite.source,
        width: source.width ?? sourceSprite.width,
        height: source.height ?? sourceSprite.height,
        anchorX: source.anchorX ?? sourceSprite.anchorX,
        anchorY: source.anchorY ?? sourceSprite.anchorY,
        offsetX: source.offsetX ?? sourceSprite.offsetX,
        offsetY: source.offsetY ?? sourceSprite.offsetY,
    };
}, z.object({
    textureUrl: optionalStringSchema,
    width: optionalNumberSchema,
    height: optionalNumberSchema,
    anchorX: optionalNumberSchema,
    anchorY: optionalNumberSchema,
    offsetX: optionalNumberSchema,
    offsetY: optionalNumberSchema,
}));

const structurePackagedManifestSchema = z.object({
    meshPackagePath: optionalStringSchema,
    shippableType: optionalStringSchema.transform(value => value?.toLowerCase()),
    crateStructureId: optionalStringSchema,
    palletOffset: packagedPalletOffsetSchema.nullish().transform(value => value ?? undefined),
    icons: structureIconsManifestSchema.nullish().transform(value => value ?? undefined),
    iconUrl: optionalStringSchema,
    previewIconUrl: optionalStringSchema,
    previewUrl: optionalStringSchema,
    previewIsIconFallback: optionalBooleanSchema,
    previewDirection: optionalStringSchema,
    textureUrl: optionalStringSchema,
    textureWidth: optionalNumberSchema,
    textureHeight: optionalNumberSchema,
    anchorX: optionalNumberSchema,
    anchorY: optionalNumberSchema,
    offsetX: optionalNumberSchema,
    offsetY: optionalNumberSchema,
    sprite: modificationVariantSpriteManifestSchema.nullish().transform(value => value ?? undefined),
});

const structureManifestSchema = z.preprocess(value => {
    if (!value || typeof value !== 'object') {
        return value;
    }
    const source = value as Record<string, unknown>;
    const legacyKey = String(
        source.legacyKey
        ?? source.legacyBuildingKey
        ?? (Array.isArray(source.legacyKeys) ? source.legacyKeys[0] : '')
        ?? '',
    ).trim();
    const sourceIcons = source.icons && typeof source.icons === 'object'
        ? source.icons as Record<string, unknown>
        : null;
    const sourceModifications = source.modifications;
    const canonicalModifications = sourceModifications && !Array.isArray(sourceModifications) && typeof sourceModifications === 'object'
        ? sourceModifications as Record<string, unknown>
        : null;
    const publishedModificationSlots = Array.isArray(source.modificationSlots)
        ? source.modificationSlots
        : (Array.isArray(sourceModifications) ? sourceModifications : []);
    const defaultIconUrl = String(
        sourceIcons?.default
        ?? source.iconUrl
        ?? '',
    ).trim();
    const renderedIconUrl = String(
        sourceIcons?.rendered
        ?? source.previewIconUrl
        ?? '',
    ).trim();
    const buildOrder = Number(
        source.buildOrder
        ?? source.sortOrder
        ?? 0,
    );
    return {
        ...source,
        buildOrder,
        legacyKey: legacyKey || undefined,
        modifications: canonicalModifications ?? {},
        modificationSlots: publishedModificationSlots,
        destroyed: source.destroyed && typeof source.destroyed === 'object'
            ? {
                ...(source.destroyed as Record<string, unknown>),
                componentName: String(
                    (source.destroyed as Record<string, unknown>)?.componentName
                    ?? source.destroyedComponentName
                    ?? '',
                ).trim() || undefined,
            }
            : (String(source.destroyedComponentName ?? '').trim()
                ? { componentName: String(source.destroyedComponentName).trim() }
                : undefined),
        icons: {
            default: defaultIconUrl || undefined,
            rendered: renderedIconUrl || undefined,
        },
    };
}, z.object({
    id: z.string().min(1),
    codeName: z.string().min(1),
    legacyKey: optionalStringSchema,
    name: localizedTextSchema,
    description: localizedTextSchema,
    categoryId: z.string().min(1),
    buildOrder: z.number().default(0),
    subTypeIconUrl: optionalStringSchema,
    icons: structureIconsManifestSchema.nullish().transform(value => value ?? undefined),
    iconUrl: optionalStringSchema,
    previewIconUrl: optionalStringSchema,
    previewUrl: optionalStringSchema,
    previewIsIconFallback: optionalBooleanSchema,
    previewDirection: optionalStringSchema,
    clipFloor: optionalBooleanSchema,
    clipFloorZ: optionalNumberSchema,
    isVehicle: optionalBooleanSchema,
    isBunker: optionalBooleanSchema,
    isFacility: optionalBooleanSchema,
    isWorldStructure: optionalBooleanSchema,
    isDestroyed: optionalBooleanSchema,
    isBreached: optionalBooleanSchema,
    canBlueprint: optionalBooleanSchema,
    isItem: optionalBooleanSchema,
    upgradeStructureCodeName: optionalStringSchema,
    conversionCodeNames: z.array(z.string()).default([]),
    destroyedStructureCodeName: optionalStringSchema,
    sprite: spriteSchema.default({
        width: undefined,
        height: undefined,
        anchorX: 0.5,
        anchorY: 0.5,
        offsetX: 0,
        offsetY: 0,
    }),
    renderLayers: z.array(structureRenderLayerSchema).optional(),
    colors: z.array(structureColorVariantManifestSchema).optional(),
    variants: z.object({
        default: textureVariantSchema.nullish().transform(value => value ?? undefined),
        c: textureVariantSchema.nullish().transform(value => value ?? undefined),
        w: textureVariantSchema.nullish().transform(value => value ?? undefined),
    }).default({
        default: undefined,
        c: undefined,
        w: undefined,
    }),
    destroyed: structureDestroyedManifestSchema.nullish().transform(value => value ?? undefined),
    packaged: structurePackagedManifestSchema.nullish().transform(value => value ?? undefined),
    faction: z.union([z.literal('c'), z.literal('w')]).nullish().transform(value => value ?? undefined),
    tier: optionalNumberSchema,
    techId: optionalStringSchema,
    powerGridInfo: powerGridInfoSchema.nullish().transform(value => value ?? undefined),
    connector: connectorSchema.nullish().transform(value => value ?? undefined),
    buildSockets: z.array(buildSocketSchema).default([]),
    footprintPolygons: z.array(hitPolygonSchema).default([]),
    selectionPolygons: z.array(hitPolygonSchema).default([]),
    lineOfSightPolygons: z.array(hitPolygonSchema).default([]),
    structureVolumes: z.array(structureVolumeSchema).default([]),
    emplacementLocation: emplacementLocationSchema.nullish().transform(value => value ?? undefined),
    railCouplers: z.array(railCouplerSchema).default([]),
    wheelBase: optionalNumberSchema,
    trackGauge: z.union([z.literal('small'), z.literal('standard')]).nullish().transform(value => value ?? undefined),
    vehicleSeats: z.array(vehicleSeatSchema).default([]),
    spotlights: z.array(spotlightSchema).default([]),
    fuelTanks: z.array(fuelTankSchema).default([]),
    conversionEntries: z.array(conversionEntrySchema).default([]),
    nextRecipeId: z.number().int().nonnegative().nullish(),
    ranges: z.array(structureRangeSchema).default([]),
    modifications: z.record(z.string(), modificationManifestSchema).default({}),
    modificationSlots: z.array(modificationSlotManifestSchema).default([]),
    cost: recipeResourceMapSchema.default({}),
    totalCost: recipeResourceMapSchema.optional(),
    repairCost: optionalNumberSchema,
    structuralIntegrity: optionalNumberSchema,
    breachable: optionalBooleanSchema,
    structuralGarrison: optionalBooleanSchema,
    inventorySlots: optionalNumberSchema,
    decaySupplyDrain: optionalNumberSchema,
    decays: optionalBooleanSchema,
    liquidCapacity: optionalNumberSchema,
    stockpile: stockpileSchema.nullish().transform(value => value ?? undefined),
    holdProfile: holdProfileSchema.nullish().transform(value => value ?? undefined),
    markedCargoOverlay: markedCargoOverlaySchema.nullish().transform(value => value ?? undefined),
    maxHealth: optionalNumberSchema,
    maxOrders: optionalNumberSchema,
    buildLocationType: optionalStringSchema,
    profileType: optionalStringSchema,
    armourType: optionalStringSchema,
    mapIntelligenceType: optionalStringSchema,
    bIsBuiltOnFoundation: optionalBooleanSchema,
    bBuildOnWater: optionalBooleanSchema,
    bIsBuiltOnLandscape: optionalBooleanSchema,
    supportsEmplacedStructures: z.boolean().default(false),
    isEmplacedWeapon: z.boolean().default(false),
    hideInList: z.boolean().default(false),
    isUpgrade: z.boolean().default(false),
    upgradeName: optionalStringSchema,
    parentStructureId: optionalStringSchema,
    rootStructureId: optionalStringSchema,
    appliedModificationId: optionalStringSchema,
}));

const itemManifestSchema = z.preprocess(value => {
    if (!value || typeof value !== 'object') {
        return value;
    }
    const source = value as Record<string, unknown>;
    const legacyKey = String(
        source.legacyKey
        ?? (Array.isArray(source.legacyKeys) ? source.legacyKeys[0] : '')
        ?? '',
    ).trim();
    const buildOrder = Number(
        source.buildOrder
        ?? source.sortOrder
        ?? 0,
    );
    return {
        ...source,
        buildOrder,
        legacyKey: legacyKey || undefined,
    };
}, z.object({
    id: z.string().min(1),
    codeName: z.string().min(1),
    legacyKey: optionalStringSchema,
    name: localizedTextSchema,
    description: localizedTextSchema,
    categoryId: z.string().min(1),
    buildOrder: z.number().default(0),
    subTypeIconUrl: optionalStringSchema,
    iconUrl: optionalStringSchema,
    previewUrl: optionalStringSchema,
}));

function createStructureLikeAssetFromLegacyItem(value: unknown): Record<string, unknown> {
    const parsed = itemManifestSchema.parse(value);
    const defaultTextureUrl = parsed.previewUrl ?? parsed.iconUrl ?? undefined;
    return {
        id: parsed.id,
        codeName: parsed.codeName,
        ...(parsed.legacyKey ? { legacyKey: parsed.legacyKey } : {}),
        ...(parsed.subTypeIconUrl ? { subTypeIconUrl: parsed.subTypeIconUrl } : {}),
        name: parsed.name,
        description: parsed.description,
        categoryId: parsed.categoryId,
        buildOrder: parsed.buildOrder,
        ...(parsed.iconUrl || parsed.previewUrl
            ? {
                icons: {
                    ...(parsed.iconUrl ? { default: parsed.iconUrl } : {}),
                    ...((parsed.previewUrl ?? parsed.iconUrl) ? { rendered: parsed.previewUrl ?? parsed.iconUrl } : {}),
                },
            }
            : {}),
        ...(parsed.previewUrl ? { previewUrl: parsed.previewUrl } : {}),
        isVehicle: false,
        isItem: true,
        sprite: {
            width: null,
            height: null,
            anchorX: 0.5,
            anchorY: 0.5,
            offsetX: 0,
            offsetY: 0,
        },
        variants: {
            ...(defaultTextureUrl ? { default: { textureUrl: defaultTextureUrl } } : {}),
        },
        buildSockets: [],
        footprintPolygons: [],
        selectionPolygons: [],
        lineOfSightPolygons: [],
        structureVolumes: [],
        vehicleSeats: [],
        spotlights: [],
        fuelTanks: [],
        conversionEntries: [],
        ranges: [],
        modifications: [],
        hideInList: false,
        isUpgrade: false,
    };
}

const categoryManifestSchema = z.object({
    id: z.string().min(1),
    name: localizedTextSchema,
    iconUrl: optionalStringSchema,
    order: z.number().default(0),
});

const bunkerDestructionDamageTypeSchema = z.object({
    name: optionalStringSchema,
    description: optionalStringSchema,
    multipliers: z.record(z.string(), z.number()).nullish().transform(value => value ?? undefined),
    profiles: z.record(z.string(), z.number()).nullish().transform(value => value ?? undefined),
});

const bunkerDestructionWeaponSchema = z.object({
    name: optionalStringSchema,
    codeName: optionalStringSchema,
    damage: optionalNumberSchema,
    damageType: bunkerDestructionDamageTypeSchema.nullish().transform(value => value ?? undefined),
});

const bunkerDestructionManifestSchema = z.object({
    weapons: z.record(z.string(), bunkerDestructionWeaponSchema).default({}),
});

const sharedManifestSchema = z.object({
    modifications: z.record(z.string(), sharedModificationManifestEntrySchema).default({}),
    packaging: z.record(z.string(), sharedPackagedPalletManifestEntrySchema).default({}),
    bunkerDestruction: bunkerDestructionManifestSchema.default({ weapons: {} }),
});

export const foxholeManifestSchema = z.preprocess(value => {
    if (!value || typeof value !== 'object') {
        return value;
    }

    const source = value as Record<string, unknown>;
    const defaultLocaleStrings = getDefaultLocaleStrings(source);
    const sourceCategories = Array.isArray(source.categories) ? source.categories : [];
    const hasLegacyCategoryFilters = sourceCategories.some(category => (
        category
        && typeof category === 'object'
        && !Array.isArray(category)
        && Array.isArray((category as { filters?: unknown; }).filters)
    ));
    const legacyCategorySignalById = new Map(sourceCategories
        .filter(category => category && typeof category === 'object' && !Array.isArray(category))
        .map(category => {
            const sourceCategory = category as Record<string, unknown>;
            return [String(sourceCategory.id ?? '').trim(), sourceCategory] as const;
        })
        .filter(([categoryId]) => categoryId.length > 0));
    const sourceShared = source.shared && typeof source.shared === 'object'
        ? source.shared as Record<string, unknown>
        : null;
    const sharedModifications = sourceShared?.modifications && typeof sourceShared.modifications === 'object' && !Array.isArray(sourceShared.modifications)
        ? sourceShared.modifications as Record<string, unknown>
        : {};
    const sharedPackaging = sourceShared?.packaging && typeof sourceShared.packaging === 'object' && !Array.isArray(sourceShared.packaging)
        ? sourceShared.packaging as Record<string, unknown>
        : {};
    const sharedBunkerDestruction = sourceShared?.bunkerDestruction && typeof sourceShared.bunkerDestruction === 'object' && !Array.isArray(sourceShared.bunkerDestruction)
        ? sourceShared.bunkerDestruction as Record<string, unknown>
        : {};
    const hydratedSharedModifications = Object.fromEntries(Object.entries(sharedModifications).map(([sharedModificationId, modification]) => {
        if (!modification || typeof modification !== 'object' || Array.isArray(modification)) {
            return [sharedModificationId, modification];
        }

        const sourceModification = modification as Record<string, unknown>;
        return [sharedModificationId, {
            ...(hydrateStructurePayloadInput(sourceModification) as Record<string, unknown>),
            ...hydrateSharedModificationVisualInput(sharedModificationId, sourceModification),
            name: hydrateLocalizedTextInput(sourceModification.name, defaultLocaleStrings),
            description: hydrateLocalizedTextInput(sourceModification.description, defaultLocaleStrings, { missingFallback: '' }),
            previewDirection: sourceModification.previewDirection ?? 'se',
        }];
    }));
    const hydratedSharedPackaging = Object.fromEntries(Object.entries(sharedPackaging)
        .map(([sharedPackagingId, pallet]) => {
            const normalizedSharedPackagingId = normalizeFoxholePackagedPalletKey(sharedPackagingId);
            if (!normalizedSharedPackagingId) {
                return null;
            }

            return [normalizedSharedPackagingId, pallet] as const;
        })
        .filter(Boolean) as Array<readonly [string, unknown]>);
    const assets = Array.isArray(source.assets)
        ? source.assets
        : (Array.isArray(source.structures) ? source.structures : []);
    const legacyItems = Array.isArray(source.items)
        ? source.items.map(createStructureLikeAssetFromLegacyItem)
        : [];
    const hydratedAssets = [...assets, ...legacyItems].map(asset => {
        if (!asset || typeof asset !== 'object') {
            return asset;
        }

        const sourceAsset = asset as Record<string, unknown>;
        const legacyCategorySignalSource = legacyCategorySignalById.get(String(sourceAsset.categoryId ?? '').trim());
        const hasLegacyAssetFilters = Array.isArray(sourceAsset.filters);
        const shouldBackfillLegacySignals = hasLegacyCategoryFilters || hasLegacyAssetFilters;
        const assetSignalSource = sourceAsset as Pick<FoxholeCategoryLike, LegacySignalKey | 'filters'>;
        const categorySignalSource = legacyCategorySignalSource as Pick<FoxholeCategoryLike, LegacySignalKey | 'filters'> | undefined;
        const assetIsBunker = resolveLegacySignalFlag(
            [assetSignalSource],
            'isBunker',
            'bunkers',
        );
        const assetIsFacility = resolveLegacySignalFlag(
            [assetSignalSource],
            'isFacility',
            'facilities',
        );
        const assetIsWorldStructure = resolveLegacySignalFlag(
            [assetSignalSource],
            'isWorldStructure',
            'world',
        );
        const categoryIsBunker = resolveLegacySignalFlag(
            [categorySignalSource],
            'isBunker',
            'bunkers',
        );
        const categoryIsFacility = resolveLegacySignalFlag(
            [categorySignalSource],
            'isFacility',
            'facilities',
        );
        const categoryIsWorldStructure = resolveLegacySignalFlag(
            [categorySignalSource],
            'isWorldStructure',
            'world',
        );
        const categorySignalCount = Number(categoryIsBunker) + Number(categoryIsFacility) + Number(categoryIsWorldStructure);
        const shouldUseCategorySignals = shouldBackfillLegacySignals && categorySignalCount === 1;
        const isBunker = assetIsBunker || (shouldUseCategorySignals && categoryIsBunker);
        const isFacility = assetIsFacility || (shouldUseCategorySignals && categoryIsFacility);
        const isWorldStructure = assetIsWorldStructure
            || (shouldUseCategorySignals && categoryIsWorldStructure)
            || (
                shouldBackfillLegacySignals
                && sourceAsset.isItem !== true
                && sourceAsset.isVehicle !== true
                && !isBunker
                && !isFacility
            );
        const hydratedColors = hydrateStructureColors(sourceAsset);
        const defaultColorVariant = hydratedColors[0];
        const hydratedAsset = {
            ...(hydrateStructurePayloadInput(sourceAsset) as Record<string, unknown>),
            name: hydrateLocalizedTextInput(sourceAsset.name, defaultLocaleStrings),
            description: hydrateLocalizedTextInput(sourceAsset.description, defaultLocaleStrings, { missingFallback: '' }),
            techId: compactTechId(sourceAsset.techId),
            colors: hydratedColors,
            icons: hydrateStructureIcons(sourceAsset),
            ...(isBunker ? { isBunker: true } : {}),
            ...(isFacility ? { isFacility: true } : {}),
            ...(isWorldStructure ? { isWorldStructure: true } : {}),
            previewUrl: sourceAsset.previewUrl ?? (
                sourceAsset.isItem === true
                    ? undefined
                    : defaultColorVariant?.previewUrl ?? createGeneratedAssetUrl(sourceAsset, '.preview')
            ),
            previewDirection: sourceAsset.previewDirection ?? 'se',
            clipFloor: sourceAsset.clipFloor ?? (
                sourceAsset.isVehicle === true || sourceAsset.isItem === true
                    ? false
                    : true
            ),
            connector: hydrateConnectorInput(sourceAsset.connector),
            variants: hydrateStructureVariants(sourceAsset),
            destroyed: hydrateDestroyedVisualInput(sourceAsset),
            packaged: hydratePackagedVisualInput(sourceAsset),
        };
        const sourceSlots = Array.isArray(sourceAsset.modificationSlots)
            ? sourceAsset.modificationSlots
            : (Array.isArray(sourceAsset.modifications) ? sourceAsset.modifications : null);
        if (!Array.isArray(sourceSlots) || sourceSlots.length === 0) {
            return hydratedAsset;
        }

        const hydratedSlots = sourceSlots.map(slot => {
            if (!slot || typeof slot !== 'object') {
                return slot;
            }

            const sourceSlot = slot as Record<string, unknown>;
            const sourceVariants = sourceSlot.variants && typeof sourceSlot.variants === 'object' && !Array.isArray(sourceSlot.variants)
                ? sourceSlot.variants as Record<string, unknown>
                : {};
            const hydratedVariants = Object.fromEntries(Object.entries(sourceVariants).map(([variantId, variantValue]) => {
                if (!variantValue || typeof variantValue !== 'object') {
                    return [variantId, variantValue];
                }

                const sourceVariant = variantValue as Record<string, unknown>;
                const sharedModificationId = String(sourceVariant.sharedModificationId ?? '').trim();
                const sharedVariant = sharedModificationId
                    ? hydratedSharedModifications[sharedModificationId]
                    : null;
                const structureId = String(sourceAsset.id ?? '').trim();
                const hasHostLocalVisuals = variantHasHostLocalModificationVisuals(structureId, sourceVariant);
                if (!sharedVariant || typeof sharedVariant !== 'object') {
                    return [variantId, {
                        ...(hydrateStructurePayloadInput(sourceVariant) as Record<string, unknown>),
                        name: hydrateLocalizedTextInput(sourceVariant.name, defaultLocaleStrings),
                        description: hydrateLocalizedTextInput(sourceVariant.description, defaultLocaleStrings, { missingFallback: '' }),
                        previewDirection: sourceVariant.previewDirection ?? 'se',
                    }];
                }

                const hydratedSourceVariant = hydrateStructurePayloadInput(sourceVariant) as Record<string, unknown>;
                const sharedVariantCost = (sharedVariant as Record<string, unknown>).cost;
                const localVariantCost = hydratedSourceVariant.cost;
                if (
                    sharedVariantCost
                    && typeof sharedVariantCost === 'object'
                    && !Array.isArray(sharedVariantCost)
                    && Object.keys(sharedVariantCost).length > 0
                    && localVariantCost
                    && typeof localVariantCost === 'object'
                    && !Array.isArray(localVariantCost)
                    && Object.keys(localVariantCost).length === 0
                ) {
                    delete hydratedSourceVariant.cost;
                }

                // Host-local fingerprints (e.g. overhead pipe insulation) keep co-located
                // pixels. Do not inherit shared preview/icon/sprite URLs from a stale
                // sharedModificationId that still points at another host's bake.
                if (hasHostLocalVisuals) {
                    const {
                        icons: _sharedIcons,
                        previewUrl: _sharedPreviewUrl,
                        sprite: _sharedSprite,
                        previewDirection: _sharedPreviewDirection,
                        sharedModificationId: _sharedModificationId,
                        ...sharedNonVisual
                    } = sharedVariant as Record<string, unknown>;

                    const modificationFolderId = String(variantId ?? '').trim().toLowerCase();
                    const hostPreviewUrl = createGeneratedHostModificationAssetUrl(structureId, modificationFolderId, '.preview');
                    const hostTextureUrl = createGeneratedHostModificationAssetUrl(structureId, modificationFolderId, '.texture');
                    const existingIcons = hydratedSourceVariant.icons && typeof hydratedSourceVariant.icons === 'object'
                        ? hydratedSourceVariant.icons as Record<string, unknown>
                        : {};
                    const existingSprite = hydratedSourceVariant.sprite && typeof hydratedSourceVariant.sprite === 'object'
                        ? hydratedSourceVariant.sprite as Record<string, unknown>
                        : {};

                    return [variantId, {
                        ...sharedNonVisual,
                        ...hydratedSourceVariant,
                        name: hydrateLocalizedTextInput(
                            sourceVariant.name ?? (sharedVariant as Record<string, unknown>).name,
                            defaultLocaleStrings,
                        ),
                        description: hydrateLocalizedTextInput(
                            sourceVariant.description ?? (sharedVariant as Record<string, unknown>).description,
                            defaultLocaleStrings,
                            { missingFallback: '' },
                        ),
                        previewUrl: hydratedSourceVariant.previewUrl ?? hostPreviewUrl,
                        icons: {
                            ...existingIcons,
                            default: existingIcons.default
                                ?? hydratedSourceVariant.iconUrl
                                ?? hostPreviewUrl,
                            rendered: existingIcons.rendered ?? hostPreviewUrl,
                        },
                        sprite: {
                            ...existingSprite,
                            source: existingSprite.source ?? hostTextureUrl,
                        },
                    }];
                }

                return [variantId, {
                    ...(sharedVariant as Record<string, unknown>),
                    ...hydratedSourceVariant,
                    name: hydrateLocalizedTextInput(
                        sourceVariant.name ?? (sharedVariant as Record<string, unknown>).name,
                        defaultLocaleStrings,
                    ),
                    description: hydrateLocalizedTextInput(
                        sourceVariant.description ?? (sharedVariant as Record<string, unknown>).description,
                        defaultLocaleStrings,
                        { missingFallback: '' },
                    ),
                    sharedModificationId,
                }];
            }));

            return {
                ...sourceSlot,
                variants: hydratedVariants,
            };
        });

        return {
            ...(hydratedAsset as Record<string, unknown>),
            modificationSlots: hydratedSlots,
        };
    });

    const hydratedCategories = sourceCategories.map(category => {
        if (!category || typeof category !== 'object' || Array.isArray(category)) {
            return category;
        }

        const sourceCategory = category as Record<string, unknown>;
        return {
            ...sourceCategory,
            name: hydrateLocalizedTextInput(sourceCategory.name, defaultLocaleStrings),
        };
    });

    return {
        ...source,
        shared: {
            ...(sourceShared ?? {}),
            modifications: hydratedSharedModifications,
            packaging: hydratedSharedPackaging,
            bunkerDestruction: {
                weapons: sharedBunkerDestruction.weapons && typeof sharedBunkerDestruction.weapons === 'object' && !Array.isArray(sharedBunkerDestruction.weapons)
                    ? sharedBunkerDestruction.weapons
                    : {},
            },
        },
        categories: hydratedCategories,
        assets: hydratedAssets,
    };
}, z.object({
    schemaVersion: z.literal('1.0.0'),
    source: z.object({
        kind: z.literal('foxwatch'),
    }),
    shared: sharedManifestSchema.default({ modifications: {}, packaging: {}, bunkerDestruction: { weapons: {} } }),
    categories: z.array(categoryManifestSchema),
    assets: z.array(structureManifestSchema),
    localizations: z.array(localizedTextBundleSchema),
    localizationIndex: localizationIndexSchema.optional(),
}));

export type FoxholeManifest = z.infer<typeof foxholeManifestSchema>;
export type FoxholeManifestCategory = z.infer<typeof categoryManifestSchema>;
export type FoxholeManifestStructure = z.infer<typeof structureManifestSchema>;
export type FoxholeLocalizationBundle = z.infer<typeof localizedTextBundleSchema>;
export type FoxholeLocalizationIndex = z.infer<typeof localizationIndexSchema>;
export type FoxholeManifestPowerGridInfo = z.infer<typeof powerGridInfoSchema>;
export type FoxholeManifestConnectorMeshConfig = z.infer<typeof connectorMeshConfigSchema>;
export type FoxholeManifestSplineComponentConfig = z.infer<typeof splineComponentConfigSchema>;
export type FoxholeManifestConnectorBehavior = z.infer<typeof connectorBehaviorSchema>;
export type FoxholeManifestConnector = z.infer<typeof connectorSchema>;
export type FoxholeManifestStructureColorVariant = z.infer<typeof structureColorVariantManifestSchema>;
export type FoxholeManifestStructureRenderLayer = z.infer<typeof structureRenderLayerSchema>;
export type FoxholeManifestRange = z.infer<typeof structureRangeSchema>;
export type FoxholeManifestSocketTag = z.infer<typeof socketTagSchema>;
export type FoxholeManifestBuildSocket = z.infer<typeof buildSocketSchema>;
export type FoxholeManifestHitPolygon = z.infer<typeof hitPolygonSchema>;
export type FoxholeManifestEmplacementLocation = z.infer<typeof emplacementLocationSchema>;
export type FoxholeManifestRailCoupler = z.infer<typeof railCouplerSchema>;
export type FoxholeManifestStructureVolume = z.infer<typeof structureVolumeSchema>;
export type FoxholeManifestVehicleSeat = z.infer<typeof vehicleSeatSchema>;
export type FoxholeManifestSpotlight = z.infer<typeof spotlightSchema>;
export type FoxholeManifestFuelTank = z.infer<typeof fuelTankSchema>;
export type FoxholeManifestStockpile = z.infer<typeof stockpileSchema>;
export type FoxholeManifestHoldProfile = z.infer<typeof holdProfileSchema>;
export type FoxholeManifestMarkedCargoOverlay = z.infer<typeof markedCargoOverlaySchema>;
export type FoxholeManifestRecipeResource = z.infer<typeof recipeResourceSchema>;
export type FoxholeManifestConversionEntry = z.infer<typeof conversionEntrySchema>;
export type FoxholeManifestModification = z.infer<typeof modificationManifestSchema>;
export type FoxholeManifestModificationSlot = z.infer<typeof modificationSlotManifestSchema>;
export type FoxholeManifestModificationSlotVariant = z.infer<typeof modificationSlotVariantManifestSchema>;
export type FoxholeManifestBunkerDestruction = z.infer<typeof bunkerDestructionManifestSchema>;
export type FoxholeManifestBunkerDestructionWeapon = z.infer<typeof bunkerDestructionWeaponSchema>;

type FoxholeTextureSource = string | {
    src?: string | Record<string, string>;
    width?: number;
    height?: number;
    offset?: {
        x?: number;
        y?: number;
    };
} | null | undefined;

interface FoxholeCategoryLike {
    name?: string;
    icon?: string;
    isBunker?: boolean;
    isFacility?: boolean;
    isWorldStructure?: boolean;
    filters?: string[];
}

interface FoxholeUpgradeLike {
    reference?: string;
    name?: string;
    description?: string;
    category?: string;
    categoryOrder?: number;
    hideInList?: boolean;
    preview?: boolean;
    texture?: FoxholeTextureSource;
    icon?: string;
    upgradeName?: string;
    isBunker?: boolean;
    isFacility?: boolean;
    isWorldStructure?: boolean;
    filters?: string[];
}

interface FoxholeBuildingLike {
    name?: string;
    description?: string;
    category?: string;
    categoryOrder?: number;
    parentKey?: string;
    parent?: FoxholeBuildingLike;
    texture?: FoxholeTextureSource;
    icon?: string;
    faction?: FoxholeFaction;
    tier?: number | number[];
    techId?: string;
    isBunker?: boolean;
    isFacility?: boolean;
    isWorldStructure?: boolean;
    filters?: string[];
    hideInList?: boolean;
    preview?: boolean;
    upgradeName?: string;
    upgrades?: Record<string, FoxholeUpgradeLike>;
    codeName?: string;
}

interface FoxholeResourceLike {
    name?: string;
    description?: string;
    category?: string;
    categoryOrder?: number;
    icon?: string;
    isBunker?: boolean;
    isFacility?: boolean;
    isWorldStructure?: boolean;
    filters?: string[];
    codeName?: string;
}

interface FoxholeDataLike {
    categories?: Record<string, FoxholeCategoryLike>;
    buildings?: Record<string, FoxholeBuildingLike>;
    resources?: Record<string, FoxholeResourceLike>;
}

type LegacySignalKey = 'isBunker' | 'isFacility' | 'isWorldStructure';

function hasLegacyFilterSignal(filters: unknown, filterId: string): boolean {
    return Array.isArray(filters)
        && filters.some(entry => String(entry ?? '').trim() === filterId);
}

function resolveLegacySignalFlag(
    sources: Array<Pick<FoxholeCategoryLike, LegacySignalKey | 'filters'> | null | undefined>,
    propertyKey: LegacySignalKey,
    filterId: string,
): boolean {
    return sources.some(source => source?.[propertyKey] === true || hasLegacyFilterSignal(source?.filters, filterId));
}

function trimSlashes(value: string): string {
    return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

export function createFoxholeAssetsBaseUrl(appBaseUrl = '/'): string {
    const normalizedAppBaseUrl = `${trimSlashes(String(appBaseUrl || '/'))}/`.replace(/^\/$/, '/');
    return `${normalizedAppBaseUrl}foxhole/assets/`;
}

function createAssetDirResolver(baseAssetsUrl: string) {
    const textureAssetsPath = `${baseAssetsUrl}game/Textures/`;

    return (value: string | null | undefined, dir = textureAssetsPath): string | null => {
        const source = String(value ?? '').trim();
        if (!source) {
            return null;
        }

        const index = source.indexOf('../');
        if (index === -1) {
            return source;
        }

        return `${source.substring(0, index)}${dir}${source.substring(index + 3)}`;
    };
}

function pickFirstDefined<T>(entries: Array<T | undefined | null>): T | undefined {
    for (const entry of entries) {
        if (entry !== undefined && entry !== null) {
            return entry;
        }
    }

    return undefined;
}

function getBuildingChain(buildings: Record<string, FoxholeBuildingLike>, building: FoxholeBuildingLike | undefined): FoxholeBuildingLike[] {
    if (!building) {
        return [];
    }

    const chain: FoxholeBuildingLike[] = [building];
    const visited = new Set<FoxholeBuildingLike>(chain);
    let currentParentKey = building.parentKey;

    while (currentParentKey) {
        const parent = buildings[currentParentKey];
        if (!parent || visited.has(parent)) {
            break;
        }

        chain.push(parent);
        visited.add(parent);
        currentParentKey = parent.parentKey;
    }

    return chain;
}

function normalizeTextureVariants(
    source: FoxholeTextureSource,
    resolveAssetDir: ReturnType<typeof createAssetDirResolver>,
): Partial<Record<'default' | 'c' | 'w', { textureUrl: string; }>> {
    if (!source) {
        return {};
    }

    if (typeof source === 'string') {
        const resolved = resolveAssetDir(source);
        return resolved ? { default: { textureUrl: resolved } } : {};
    }

    if (typeof source.src === 'string') {
        const resolved = resolveAssetDir(source.src);
        return resolved ? { default: { textureUrl: resolved } } : {};
    }

    const entries = typeof source.src === 'object' && source.src !== null
        ? source.src
        : {};

    const fallback = resolveAssetDir(entries.default ?? entries.c ?? entries.w ?? Object.values(entries)[0]);
    const colonial = resolveAssetDir(entries.c ?? entries.colonial ?? entries.default) ?? fallback;
    const warden = resolveAssetDir(entries.w ?? entries.warden ?? entries.default) ?? fallback;

    return {
        ...(fallback ? { default: { textureUrl: fallback } } : {}),
        ...(colonial && colonial !== fallback ? { c: { textureUrl: colonial } } : {}),
        ...(warden && warden !== fallback ? { w: { textureUrl: warden } } : {}),
    };
}

function normalizeTextureDimensions(source: FoxholeTextureSource): {
    width: number | null;
    height: number | null;
    offsetX: number;
    offsetY: number;
} {
    if (!source || typeof source === 'string') {
        return {
            width: null,
            height: null,
            offsetX: 0,
            offsetY: 0,
        };
    }

    return {
        width: typeof source.width === 'number' && Number.isFinite(source.width)
            ? source.width * LEGACY_FOXHOLE_TEXTURE_SCALE
            : null,
        height: typeof source.height === 'number' && Number.isFinite(source.height)
            ? source.height * LEGACY_FOXHOLE_TEXTURE_SCALE
            : null,
        offsetX: Number(source.offset?.x ?? 0) * LEGACY_FOXHOLE_TEXTURE_SCALE,
        offsetY: Number(source.offset?.y ?? 0) * LEGACY_FOXHOLE_TEXTURE_SCALE,
    };
}

function normalizeTierValue(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }

    if (Array.isArray(value)) {
        const first = value.find(entry => typeof entry === 'number' && Number.isFinite(entry));
        return typeof first === 'number' ? first : null;
    }

    return null;
}

function createLocalizationId(domain: 'structure' | 'item' | 'category', id: string, field: 'name' | 'description'): string {
    return `foxhole:${domain}:${id}:${field}`;
}

function normalizeInternalId(value: string | null | undefined, fallback: string): string {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        return fallback;
    }

    return normalized.toLowerCase();
}

function createFoxholeStructurePreviewUrl(baseAssetsUrl: string, legacyKey: string): string {
    return `${baseAssetsUrl}game/Textures/UI/Previews/${legacyKey}.webp`;
}

function resolveFoxholeStructurePreviewKey(
    buildings: Record<string, FoxholeBuildingLike>,
    buildingKey: string,
): string | null {
    let currentKey = String(buildingKey ?? '').trim();
    const visited = new Set<string>();

    while (currentKey && !visited.has(currentKey)) {
        visited.add(currentKey);
        const building = buildings[currentKey];
        if (!building) {
            return null;
        }
        if (building.preview === true) {
            return currentKey;
        }

        currentKey = String(building.parentKey ?? '').trim();
    }

    return null;
}

function buildLocalizedText(id: string, fallback: string, bundle: Map<string, string>) {
    bundle.set(id, fallback);
    return {
        id,
        fallback,
    };
}

export function createLocaleCandidates(locale: string | null | undefined): string[] {
    const normalized = String(locale ?? '').trim().toLowerCase();
    if (!normalized) {
        return ['en'];
    }

    const language = normalized.split(/[-_]/, 1)[0]?.trim() ?? '';
    return Array.from(new Set([
        normalized,
        language,
        'en',
    ].filter(Boolean)));
}
export function rebaseFoxholeManifestAssetUrls(
    manifest: FoxholeManifest,
    fromBaseAssetsUrl: string,
    toBaseAssetsUrl: string,
): FoxholeManifest {
    const normalizedFromBase = `${trimSlashes(String(fromBaseAssetsUrl ?? ''))}/`.replace(/^\/$/, '/');
    const normalizedToBase = `${trimSlashes(String(toBaseAssetsUrl ?? ''))}/`.replace(/^\/$/, '/');
    if (normalizedFromBase === normalizedToBase) {
        return manifest;
    }

    const rebaseUrl = (value: string | null): string | null => {
        if (!value) {
            return value;
        }
        return value.startsWith(normalizedFromBase)
            ? `${normalizedToBase}${value.slice(normalizedFromBase.length)}`
            : value;
    };

    return foxholeManifestSchema.parse({
        ...manifest,
        ...(manifest.localizationIndex
            ? {
                localizationIndex: {
                    ...manifest.localizationIndex,
                    files: Object.fromEntries(
                        Object.entries(manifest.localizationIndex.files).map(([locale, value]) => [
                            locale,
                            rebaseUrl(value) ?? value,
                        ]),
                    ),
                },
            }
            : {}),
        shared: {
            modifications: Object.fromEntries(Object.entries(manifest.shared?.modifications ?? {}).map(([sharedModificationId, modification]) => [sharedModificationId, {
                ...modification,
                subTypeIconUrl: rebaseUrl(modification.subTypeIconUrl ?? null),
                icons: modification.icons
                    ? {
                        default: rebaseUrl(modification.icons.default ?? null),
                        rendered: rebaseUrl(modification.icons.rendered ?? null),
                    }
                    : undefined,
                previewUrl: rebaseUrl(modification.previewUrl ?? null),
                sprite: modification.sprite
                    ? {
                        ...modification.sprite,
                        source: rebaseUrl(modification.sprite.source) ?? modification.sprite.source,
                    }
                    : undefined,
            }])),
            packaging: Object.fromEntries(Object.entries(manifest.shared?.packaging ?? {}).map(([sharedPackagingId, pallet]) => [sharedPackagingId, {
                ...pallet,
                textureUrl: rebaseUrl(pallet.textureUrl ?? null),
            }])),
            bunkerDestruction: {
                weapons: Object.fromEntries(Object.entries(manifest.shared?.bunkerDestruction?.weapons ?? {})),
            },
        },
        categories: manifest.categories.map(category => ({
            ...category,
            iconUrl: rebaseUrl(category.iconUrl ?? null),
        })),
        assets: manifest.assets.map(structure => {
            const structureColors = structure.colors ?? [];

            return {
                ...structure,
                subTypeIconUrl: rebaseUrl(structure.subTypeIconUrl ?? null),
                ...(structure.icons
                    ? {
                        icons: {
                            default: rebaseUrl(structure.icons.default ?? null),
                            rendered: rebaseUrl(structure.icons.rendered ?? null),
                        },
                    }
                    : {}),
                iconUrl: rebaseUrl(structure.iconUrl ?? null),
                previewIconUrl: rebaseUrl(structure.previewIconUrl ?? null),
                previewUrl: rebaseUrl(structure.previewUrl ?? null),
                destroyed: structure.destroyed
                    ? {
                        ...structure.destroyed,
                        ...(structure.destroyed.icons
                            ? {
                                icons: {
                                    default: rebaseUrl(structure.destroyed.icons.default ?? null),
                                    rendered: rebaseUrl(structure.destroyed.icons.rendered ?? null),
                                },
                            }
                            : {}),
                        iconUrl: rebaseUrl(structure.destroyed.iconUrl ?? null),
                        previewIconUrl: rebaseUrl(structure.destroyed.previewIconUrl ?? null),
                        previewUrl: rebaseUrl(structure.destroyed.previewUrl ?? null),
                        sprite: structure.destroyed.sprite
                            ? {
                                ...structure.destroyed.sprite,
                                source: rebaseUrl(structure.destroyed.sprite.source) ?? structure.destroyed.sprite.source,
                            }
                            : undefined,
                    }
                    : undefined,
                packaged: structure.packaged
                    ? {
                        ...structure.packaged,
                        ...(structure.packaged.icons
                            ? {
                                icons: {
                                    default: rebaseUrl(structure.packaged.icons.default ?? null),
                                    rendered: rebaseUrl(structure.packaged.icons.rendered ?? null),
                                },
                            }
                            : {}),
                        iconUrl: rebaseUrl(structure.packaged.iconUrl ?? null),
                        previewIconUrl: rebaseUrl(structure.packaged.previewIconUrl ?? null),
                        previewUrl: rebaseUrl(structure.packaged.previewUrl ?? null),
                        sprite: structure.packaged.sprite
                            ? {
                                ...structure.packaged.sprite,
                                source: rebaseUrl(structure.packaged.sprite.source) ?? structure.packaged.sprite.source,
                            }
                            : undefined,
                    }
                    : undefined,
                ...(structureColors.length > 0
                    ? {
                        colors: structureColors.map(color => ({
                            ...color,
                            textureUrl: rebaseUrl(color.textureUrl ?? null),
                            previewUrl: rebaseUrl(color.previewUrl ?? null),
                            renderedIconUrl: rebaseUrl(color.renderedIconUrl ?? null),
                        })),
                    }
                    : {}),
                renderLayers: (structure.renderLayers ?? []).map(layer => ({
                    ...layer,
                    textureUrl: rebaseUrl(layer.textureUrl) ?? layer.textureUrl,
                })),
                variants: {
                    ...(structure.variants.default ? { default: { textureUrl: rebaseUrl(structure.variants.default.textureUrl) ?? structure.variants.default.textureUrl } } : {}),
                    ...(structure.variants.c ? { c: { textureUrl: rebaseUrl(structure.variants.c.textureUrl) ?? structure.variants.c.textureUrl } } : {}),
                    ...(structure.variants.w ? { w: { textureUrl: rebaseUrl(structure.variants.w.textureUrl) ?? structure.variants.w.textureUrl } } : {}),
                },
                modifications: Object.fromEntries(Object.entries(structure.modifications ?? {}).map(([modificationId, modification]) => [modificationId, {
                    ...modification,
                    textureUrl: rebaseUrl(modification.textureUrl ?? null),
                    iconUrl: rebaseUrl(modification.iconUrl ?? null),
                    previewUrl: rebaseUrl(modification.previewUrl ?? null),
                }])),
                modificationSlots: structure.modificationSlots.map(slot => ({
                    ...slot,
                    variants: Object.fromEntries(Object.entries(slot.variants).map(([variantId, variant]) => [variantId, {
                        ...variant,
                        name: variant.name,
                        description: variant.description,
                        subTypeIconUrl: rebaseUrl(variant.subTypeIconUrl ?? null),
                        icons: variant.icons
                            ? {
                                default: rebaseUrl(variant.icons.default ?? null),
                                rendered: rebaseUrl(variant.icons.rendered ?? null),
                            }
                            : undefined,
                        previewUrl: rebaseUrl(variant.previewUrl ?? null),
                        sprite: variant.sprite
                            ? {
                                ...variant.sprite,
                                source: rebaseUrl(variant.sprite.source) ?? variant.sprite.source,
                            }
                            : undefined,
                        renderLayers: Array.isArray(variant.renderLayers)
                            ? variant.renderLayers.map(layer => ({
                                ...layer,
                                textureUrl: rebaseUrl(layer.textureUrl) ?? layer.textureUrl,
                            }))
                            : variant.renderLayers,
                    }])),
                })),
            };
        }),
    });
}

function buildFoxholeManifestFromLegacyData(data: FoxholeDataLike, baseAssetsUrl: string): FoxholeManifest {
    const resolveAssetDir = createAssetDirResolver(baseAssetsUrl);
    const categories = data.categories ?? {};
    const buildings = data.buildings ?? {};
    const resources = data.resources ?? {};
    const strings = new Map<string, string>();

    const manifestCategories = Object.keys(categories).map((categoryKey, index) => {
        const category = categories[categoryKey] ?? {};
        return {
            id: categoryKey,
            name: buildLocalizedText(
                createLocalizationId('category', categoryKey, 'name'),
                String(category.name ?? categoryKey).trim() || categoryKey,
                strings,
            ),
            iconUrl: resolveAssetDir(category.icon ?? null),
            order: index,
        };
    });

    const manifestStructures = Object.entries(buildings).map(([legacyBuildingKey, building]) => {
        const buildingChain = getBuildingChain(buildings, building);
        const categoryId = String(pickFirstDefined(buildingChain.map(entry => entry.category)) ?? DEFAULT_CATEGORY_ID).trim() || DEFAULT_CATEGORY_ID;
        const canonicalId = normalizeInternalId(pickFirstDefined(buildingChain.map(entry => entry.codeName)), legacyBuildingKey);
        const displayName = String(pickFirstDefined(buildingChain.map(entry => entry.name)) ?? legacyBuildingKey).trim() || legacyBuildingKey;
        const description = String(pickFirstDefined(buildingChain.map(entry => entry.description)) ?? '').trim();
        const buildOrder = Number(pickFirstDefined(buildingChain.map(entry => entry.categoryOrder)) ?? 0);
        const previewLegacyKey = resolveFoxholeStructurePreviewKey(buildings, legacyBuildingKey);
        const textureVariants = normalizeTextureVariants(
            pickFirstDefined(buildingChain.map(entry => entry.texture)),
            resolveAssetDir,
        );
        const spriteData = pickFirstDefined(
            buildingChain
                .map(entry => normalizeTextureDimensions(entry.texture))
                .filter(entry => entry.width !== null || entry.height !== null),
        ) ?? {
            width: null,
            height: null,
            offsetX: 0,
            offsetY: 0,
        };
        const iconUrl = resolveAssetDir(pickFirstDefined(buildingChain.map(entry => entry.icon)) ?? null);
        const category = categories[categoryId];
        const signalSources = [...buildingChain, category];
        const isBunker = resolveLegacySignalFlag(signalSources, 'isBunker', 'bunkers');
        const isFacility = resolveLegacySignalFlag(signalSources, 'isFacility', 'facilities');
        const isWorldStructure = resolveLegacySignalFlag(signalSources, 'isWorldStructure', 'world');
        const upgradeName = String(pickFirstDefined(buildingChain.map(entry => entry.upgradeName)) ?? '').trim() || null;
        const firstEntry = buildingChain[0];
        const isUpgrade = Boolean(
            upgradeName
            || (firstEntry
                && 'parent' in firstEntry
                && firstEntry.parent
                && (!('parentKey' in firstEntry) || !firstEntry.parentKey)),
        );

        return {
            id: canonicalId,
            codeName: String(pickFirstDefined(buildingChain.map(entry => entry.codeName)) ?? canonicalId),
            ...(canonicalId !== legacyBuildingKey ? { legacyKey: legacyBuildingKey } : {}),
            name: buildLocalizedText(createLocalizationId('structure', canonicalId, 'name'), displayName, strings),
            description: buildLocalizedText(createLocalizationId('structure', canonicalId, 'description'), description, strings),
            categoryId,
            buildOrder,
            ...(iconUrl ? { iconUrl } : {}),
            ...((previewLegacyKey
                ? createFoxholeStructurePreviewUrl(baseAssetsUrl, previewLegacyKey)
                : (textureVariants.default?.textureUrl ?? textureVariants.c?.textureUrl ?? textureVariants.w?.textureUrl ?? iconUrl))
                ? {
                    previewUrl: previewLegacyKey
                        ? createFoxholeStructurePreviewUrl(baseAssetsUrl, previewLegacyKey)
                        : (textureVariants.default?.textureUrl ?? textureVariants.c?.textureUrl ?? textureVariants.w?.textureUrl ?? iconUrl),
                }
                : {}),
            sprite: {
                ...(spriteData.width !== null ? { width: spriteData.width } : {}),
                ...(spriteData.height !== null ? { height: spriteData.height } : {}),
                anchorX: 0.5,
                anchorY: 0.5,
                offsetX: spriteData.offsetX,
                offsetY: spriteData.offsetY,
            },
            variants: textureVariants,
            ...(normalizeFoxholeFaction(pickFirstDefined(buildingChain.map(entry => entry.faction)) ?? null)
                ? { faction: normalizeFoxholeFaction(pickFirstDefined(buildingChain.map(entry => entry.faction)) ?? null) }
                : {}),
            ...(normalizeTierValue(pickFirstDefined(buildingChain.map(entry => entry.tier))) !== null
                ? { tier: normalizeTierValue(pickFirstDefined(buildingChain.map(entry => entry.tier))) }
                : {}),
            ...((String(pickFirstDefined(buildingChain.map(entry => entry.techId)) ?? '').trim() || null)
                ? { techId: String(pickFirstDefined(buildingChain.map(entry => entry.techId)) ?? '').trim() }
                : {}),
            ...(isBunker ? { isBunker: true } : {}),
            ...(isFacility ? { isFacility: true } : {}),
            ...(isWorldStructure ? { isWorldStructure: true } : {}),
            hideInList: buildingChain.some(entry => entry.hideInList === true),
            isUpgrade,
            ...(upgradeName ? { upgradeName } : {}),
        };
    });

    const manifestItems = Object.entries(resources).map(([legacyResourceKey, resource]) => {
        const canonicalId = normalizeInternalId(resource.codeName, legacyResourceKey);
        const categoryId = String(resource.category ?? '').trim() || 'items';
        const name = String(resource.name ?? legacyResourceKey).trim() || legacyResourceKey;
        const description = String(resource.description ?? '').trim();
        const iconUrl = resolveAssetDir(resource.icon ?? null);

        return {
            id: canonicalId,
            codeName: String(resource.codeName ?? canonicalId),
            ...(canonicalId !== legacyResourceKey ? { legacyKey: legacyResourceKey } : {}),
            name: buildLocalizedText(createLocalizationId('item', canonicalId, 'name'), name, strings),
            description: buildLocalizedText(createLocalizationId('item', canonicalId, 'description'), description, strings),
            categoryId,
            buildOrder: Number(resource.categoryOrder ?? 0),
            ...(iconUrl
                ? {
                    icons: {
                        default: iconUrl,
                        rendered: iconUrl,
                    },
                }
                : {}),
            ...(iconUrl ? { previewUrl: iconUrl } : {}),
            isVehicle: false,
            isItem: true,
            sprite: {
                width: null,
                height: null,
                anchorX: 0.5,
                anchorY: 0.5,
                offsetX: 0,
                offsetY: 0,
            },
            variants: {
                ...(iconUrl ? { default: { textureUrl: iconUrl } } : {}),
            },
            buildSockets: [],
            footprintPolygons: [],
            structureVolumes: [],
            fuelTanks: [],
            conversionEntries: [],
            ranges: [],
            modifications: {},
            modificationSlots: [],
            hideInList: false,
            isUpgrade: false,
        };
    });

    return foxholeManifestSchema.parse({
        schemaVersion: '1.0.0',
        source: {
            kind: 'foxwatch',
        },
        categories: manifestCategories,
        assets: [...manifestStructures, ...manifestItems],
        localizations: [{
            locale: 'en',
            strings: Object.fromEntries(strings.entries()),
        }],
    });
}
