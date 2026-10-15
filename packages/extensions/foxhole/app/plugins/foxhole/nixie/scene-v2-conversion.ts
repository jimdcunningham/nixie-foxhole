import type {
    NixieSceneV1ConversionIssue,
    NixieSceneV1NodeConverter,
} from '#nixie/utils/nixie-scene-v2-conversion.ts';
import {
    applyFoxholeTacticalLinePreset,
    FOXHOLE_TACTICAL_LINE_NODE_TYPE,
    normalizeTacticalLinePoints,
} from './tactical-line.ts';
import { FOXHOLE_CONNECTOR_NODE_TYPE } from './connector.ts';
import {
    DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE,
    FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE,
} from './spline-connector.ts';
import {
    DEFAULT_FOXHOLE_RANGE_STATE,
    FOXHOLE_RANGE_NODE_TYPE,
    normalizeFoxholeRangePoints,
} from './range.ts';
import {
    DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE,
    FOXHOLE_BINOCULAR_LINE_NODE_TYPE,
    normalizeFoxholeBinocularLinePoints,
} from './binocular-line.ts';
import {
    DEFAULT_FOXHOLE_TRIANGULATION_STATE,
    FOXHOLE_TRIANGULATION_NODE_TYPE,
    normalizeFoxholeTriangulationEdgePoints,
    resolveFoxholeTriangulationFit,
} from './triangulation.ts';
import { getFoxholeManifest } from './manifest.ts';
import { resolveFoxholeStockpileSelectionGroups, stockpileSelectionsToEntries } from './stockpile-groups.ts';
import { resolveConnectorEndpointSocketNames } from './connector-behavior.ts';
import {
    clampMarkedItemCodenames,
    isFoxholeBuildSiteKey,
    normalizeMarkedItemCodenames,
    resolveFoxholeHoldProfileMarkedItemLimit,
} from './hold-profile.ts';
import { normalizeFoxholeColorHex, normalizeFoxholeFaction } from './types.ts';

const FOXHOLE_SCENE_V1_NODE_TYPES = new Set(['foxholeAsset', 'foxholeStructure']);
const FOXHOLE_SCENE_V2_OWNER_ID = 'nixie.foxhole-planner';
const FOXHOLE_ASSET_ICON_PATH_PATTERN = /\/foxhole\/assets\/types\/[^/]+\/([a-z0-9-]+)\/\1\.icon\.[a-z0-9-]+\.webp$/u;
let foxholeSceneV2RenderableAssetIds: ReadonlySet<string> | undefined;
let foxholeSceneV2ModificationKeysByAsset: ReadonlyMap<string, ReadonlySet<string>> | undefined;
let foxholeSceneV2AppearanceSupportByAsset: ReadonlyMap<string, {
    factions: ReadonlySet<string>;
    colors: ReadonlySet<string>;
    destroyed: boolean;
    packaged: boolean;
    blueprint: boolean;
}> | undefined;
let foxholeSceneV2CargoSupportByAsset: ReadonlyMap<string, { limit: number | null; }> | undefined;
let foxholeSceneV2ItemIdsByCodeName: ReadonlyMap<string, string> | undefined;
let foxholeSceneV2SocketAssetIds: ReadonlySet<string> | undefined;
const FOXHOLE_STATE_KEYS = [
    'foxholeKey',
    'faction',
    'colorHex',
    'destroyed',
    'packaged',
    'blueprint',
    'tint',
    'brightness',
    'anchorX',
    'anchorY',
    'modificationVariantIds',
    'socketAttachments',
    'markedItemCodenames',
    'markedStockpileItems',
    'productionOrders',
    'disableProduction',
    'maintenanceFilters',
    'baseUpgrades',
] as const;
const TACTICAL_LINE_STATE_KEYS = [
    'id',
    'label',
    'description',
    'points',
    'scaleWithZoom',
    'curveMode',
    'strokeColor',
    'strokeWidth',
    'strokeAlpha',
    'strokeStyle',
    'strokeDashLength',
    'strokeDashGap',
    'startCap',
    'endCap',
    'decoratorMode',
    'decoratorSide',
    'decoratorSize',
    'decoratorSpacing',
    'decoratorFill',
    'decoratorColor',
    'decoratorAlpha',
    'presetId',
] as const;
const CONNECTOR_STATE_KEYS = [
    'foxholeKey',
    'points',
    'startSocketName',
    'endSocketName',
    'startAttachment',
    'endAttachment',
] as const;
const SPLINE_CONNECTOR_STATE_KEYS = [
    'foxholeKey',
    'start',
    'end',
    'minLength',
    'maxLength',
    'minRadius',
    'maxRadius',
    'maxBuffer',
    'curveT',
    'maxTargetAngleDeg',
    'maxArcAngleDeg',
    'startSocketName',
    'endSocketName',
    'startAttachment',
    'endAttachment',
    'socketAttachments',
    'modificationVariantIds',
    'blueprint',
    'tint',
    'brightness',
] as const;
const RANGE_STATE_KEYS = [
    'points',
    'sweepAngle',
    'scaleWithZoom',
    'strokeColor',
    'strokeWidth',
    'strokeAlpha',
    'strokeStyle',
    'strokeDashLength',
    'strokeDashGap',
    'fillColor',
    'fillAlpha',
    'showCenterAxis',
    'showRadius',
    'showAngle',
    'labelColor',
    'labelFontSize',
    'labelBackgroundColor',
    'labelBackgroundAlpha',
    'labelPadding',
    'labelStrokeWidth',
    'centerMarkerRadius',
    'meterPixels',
    'decimals',
] as const;
const BINOCULAR_LINE_STATE_KEYS = [
    'points',
    'scaleWithZoom',
    'strokeColor',
    'strokeWidth',
    'strokeAlpha',
    'multiSegmentAlpha',
    'showDistance',
    'showAzimuth',
    'showAzimuthArrows',
    'labelColor',
    'labelFontSize',
    'labelBackgroundColor',
    'labelBackgroundAlpha',
    'labelPadding',
    'labelStrokeWidth',
    'endpointRadius',
    'startCap',
    'endCap',
    'meterPixels',
    'decimals',
] as const;
const TRIANGULATION_STATE_KEYS = [
    'edgePoints',
    'scaleWithZoom',
    'strokeColor',
    'strokeWidth',
    'strokeAlpha',
    'strokeStyle',
    'strokeDashLength',
    'strokeDashGap',
    'fillColor',
    'fillAlpha',
    'spokeAlpha',
    'edgeLineAlpha',
    'showSpokes',
    'showRadius',
    'showEdgeMarkers',
    'labelColor',
    'labelFontSize',
    'labelBackgroundColor',
    'labelBackgroundAlpha',
    'labelPadding',
    'labelStrokeWidth',
    'centerMarkerRadius',
    'edgeMarkerRadius',
    'meterPixels',
    'decimals',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getFoxholeSceneV2RenderableAssetIds(): ReadonlySet<string> {
    return foxholeSceneV2RenderableAssetIds ??= new Set(
        getFoxholeManifest('/foxhole/assets/').assets.map(asset => asset.id),
    );
}

function getFoxholeSceneV2ModificationKeys(assetId: string): ReadonlySet<string> {
    foxholeSceneV2ModificationKeysByAsset ??= new Map(
        getFoxholeManifest('/foxhole/assets/').assets.map(asset => [
            asset.id,
            new Set(asset.modificationSlots.flatMap(slot => (
                Object.keys(slot.variants).map(variantId => `${slot.name}\u0000${variantId}`)
            ))),
        ]),
    );
    return foxholeSceneV2ModificationKeysByAsset.get(assetId) ?? new Set<string>();
}

function getFoxholeSceneV2AppearanceSupport(assetId: string) {
    foxholeSceneV2AppearanceSupportByAsset ??= new Map(
        getFoxholeManifest('/foxhole/assets/').assets.map(asset => [asset.id, {
            factions: new Set((['c', 'w'] as const).filter(faction => Boolean(asset.variants[faction]?.textureUrl))),
            colors: new Set((asset.colors ?? []).map(color => color.hex.toLowerCase())),
            destroyed: Boolean(
                asset.destroyed?.sprite?.source
                ?? asset.destroyed?.textureUrl
                ?? asset.destroyedStructureCodeName,
            ),
            packaged: Boolean(asset.packaged),
            blueprint: asset.canBlueprint === true,
        }]),
    );
    return foxholeSceneV2AppearanceSupportByAsset.get(assetId) ?? {
        factions: new Set<string>(),
        colors: new Set<string>(),
        destroyed: false,
        packaged: false,
        blueprint: false,
    };
}

function getFoxholeSceneV2CargoSupport(assetId: string): { limit: number | null; } {
    foxholeSceneV2CargoSupportByAsset ??= new Map(
        getFoxholeManifest('/foxhole/assets/').assets.map(asset => [asset.id, {
            limit: resolveFoxholeHoldProfileMarkedItemLimit(asset.holdProfile),
        }]),
    );
    return foxholeSceneV2CargoSupportByAsset.get(assetId) ?? { limit: null };
}

function getFoxholeSceneV2ItemIdsByCodeName(): ReadonlyMap<string, string> {
    return foxholeSceneV2ItemIdsByCodeName ??= new Map(
        getFoxholeManifest('/foxhole/assets/').assets.flatMap(asset => (
            asset.isItem && asset.codeName
                ? [[asset.codeName.toLocaleLowerCase(), asset.id] as const]
                : []
        )),
    );
}

function getFoxholeSceneV2SocketAssetIds(): ReadonlySet<string> {
    return foxholeSceneV2SocketAssetIds ??= new Set(
        getFoxholeManifest('/foxhole/assets/').assets.flatMap(asset => (
            asset.buildSockets.length > 0 ? [asset.id] : []
        )),
    );
}

function resolveFoxholeIconAssetId(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().replaceAll('\\', '/').split(/[?#]/u, 1)[0]?.toLowerCase() ?? '';
    const assetId = FOXHOLE_ASSET_ICON_PATH_PATTERN.exec(normalized)?.[1] ?? '';
    return getFoxholeSceneV2RenderableAssetIds().has(assetId) ? assetId : null;
}

function normalizedText(value: unknown): string {
    return String(value ?? '').trim();
}

function hasEntries(value: unknown): boolean {
    return isRecord(value) ? Object.keys(value).length > 0 : Array.isArray(value) && value.length > 0;
}

function unsupportedStateIssue(message: string): Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'> {
    return { code: 'unsupported-state', message };
}

interface FoxholeSceneV2SocketAttachment {
    localSocketName: string;
    targetEntityId: string;
    targetSocketName: string;
}

function convertSocketAttachments(
    value: unknown,
    resolveEntityId: (sourceNodeId: string) => string | null,
): {
    attachments: FoxholeSceneV2SocketAttachment[];
    issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>>;
} {
    if (value === undefined || value === null) {
        return { attachments: [], issues: [] };
    }
    if (!isRecord(value)) {
        return {
            attachments: [],
            issues: [unsupportedStateIssue('Foxhole socket attachments are malformed and remain only in legacy source data.')],
        };
    }

    const issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>> = [];
    const attachments: FoxholeSceneV2SocketAttachment[] = [];
    const entries = Object.entries(value);
    for (const [rawLocalSocketName, rawAttachment] of entries.slice(0, 128)) {
        const localSocketName = normalizedText(rawLocalSocketName);
        const sourceNodeId = isRecord(rawAttachment)
            ? normalizedText(rawAttachment.nodeId)
            : null;
        const targetSocketName = isRecord(rawAttachment)
            ? normalizedText(rawAttachment.socketName)
            : null;
        if (!localSocketName
            || localSocketName.length > 256
            || !sourceNodeId
            || sourceNodeId.length > 256
            || !targetSocketName
            || targetSocketName.length > 256) {
            issues.push(unsupportedStateIssue(
                `Foxhole socket attachment ${rawLocalSocketName || '(unnamed)'} is malformed and remains only in legacy source data.`,
            ));
            continue;
        }

        const targetEntityId = resolveEntityId(sourceNodeId);
        if (!targetEntityId) {
            issues.push(unsupportedStateIssue(
                `Foxhole socket attachment ${localSocketName} references a missing or ambiguous node; its unresolved source ID was preserved.`,
            ));
        }
        attachments.push({
            localSocketName,
            targetEntityId: targetEntityId ?? sourceNodeId,
            targetSocketName,
        });
    }
    if (entries.length > 128) {
        issues.push(unsupportedStateIssue(
            'Foxhole socket attachments exceed the Scene V2 component limit; additional links remain only in legacy source data.',
        ));
    }

    if (attachments.length > 0) {
        issues.push(unsupportedStateIssue(
            'Foxhole socket topology is preserved in Scene V2 and structure sockets can be authored by dragging; network statistics are not exposed yet.',
        ));
    }
    return { attachments, issues };
}

function convertTacticalLineState(state: Record<string, unknown>): {
    data: Record<string, unknown> | null;
    issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>>;
} {
    const issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>> = [];
    if (!Array.isArray(state.points)
        || state.points.length < 4
        || state.points.length > 2048
        || state.points.length % 2 !== 0
        || !state.points.every(value => (
            typeof value === 'number'
            && Number.isFinite(value)
            && Math.abs(value) <= 1_000_000_000
        ))) {
        return {
            data: null,
            issues: [unsupportedStateIssue('Foxhole tactical line points are malformed and remain only in legacy source data.')],
        };
    }

    const presetIds = new Set(['frontline', 'advance', 'fallback', 'fortified', 'cross']);
    const presetId = typeof state.presetId === 'string' && presetIds.has(state.presetId)
        ? state.presetId
        : 'frontline';
    if (state.presetId !== undefined && state.presetId !== presetId) {
        issues.push(unsupportedStateIssue('Foxhole tactical line presetId is invalid; Scene V2 used the frontline fallback.'));
    }
    const defaults = applyFoxholeTacticalLinePreset({}, presetId);
    const enumValue = <T extends string>(
        key: string,
        allowed: readonly T[],
        fallback: T,
    ): T => {
        const value = state[key];
        if (value === undefined) {
            return fallback;
        }
        if (typeof value === 'string' && allowed.includes(value as T)) {
            return value as T;
        }
        issues.push(unsupportedStateIssue(`Foxhole tactical line ${key} is invalid; Scene V2 used the ${fallback} fallback.`));
        return fallback;
    };
    const numericValue = (key: string, fallback: number, min: number, max: number, integer = false): number => {
        const value = state[key];
        if (value === undefined) {
            return fallback;
        }
        if (typeof value === 'number'
            && Number.isFinite(value)
            && value >= min
            && value <= max
            && (!integer || Number.isInteger(value))) {
            return value;
        }
        issues.push(unsupportedStateIssue(`Foxhole tactical line ${key} is invalid; Scene V2 used a safe fallback.`));
        return fallback;
    };
    const booleanValue = (key: string, fallback: boolean): boolean => {
        const value = state[key];
        if (value === undefined) {
            return fallback;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        issues.push(unsupportedStateIssue(`Foxhole tactical line ${key} is invalid; Scene V2 used a safe fallback.`));
        return fallback;
    };

    return {
        data: {
            points: normalizeTacticalLinePoints(state.points),
            scaleWithZoom: booleanValue('scaleWithZoom', defaults.scaleWithZoom),
            curveMode: enumValue('curveMode', ['polyline', 'smooth'], defaults.curveMode),
            strokeColor: numericValue('strokeColor', defaults.strokeColor, 0, 0xFFFFFF, true),
            strokeWidth: numericValue('strokeWidth', defaults.strokeWidth, 0.1, 4096),
            strokeAlpha: numericValue('strokeAlpha', defaults.strokeAlpha, 0, 1),
            strokeStyle: enumValue('strokeStyle', ['solid', 'dashed'], defaults.strokeStyle),
            strokeDashLength: numericValue('strokeDashLength', defaults.strokeDashLength, 0.1, 1_000_000),
            strokeDashGap: numericValue('strokeDashGap', defaults.strokeDashGap, 0.1, 1_000_000),
            startCap: enumValue('startCap', ['none', 'arrow', 'flag', 'circle'], defaults.startCap),
            endCap: enumValue('endCap', ['none', 'arrow', 'flag', 'circle'], defaults.endCap),
            decoratorMode: enumValue('decoratorMode', ['none', 'semicircle', 'triangle', 'tick', 'block', 'cross', 'arrow'], defaults.decoratorMode),
            decoratorSide: enumValue('decoratorSide', ['left', 'right', 'both'], defaults.decoratorSide),
            decoratorSize: numericValue('decoratorSize', defaults.decoratorSize, 0.1, 1_000_000),
            decoratorSpacing: numericValue('decoratorSpacing', defaults.decoratorSpacing, 0.1, 1_000_000),
            decoratorFill: booleanValue('decoratorFill', defaults.decoratorFill),
            decoratorColor: numericValue('decoratorColor', defaults.decoratorColor, 0, 0xFFFFFF, true),
            decoratorAlpha: numericValue('decoratorAlpha', defaults.decoratorAlpha, 0, 1),
            presetId,
        },
        issues,
    };
}

function convertConnectorState(
    state: Record<string, unknown>,
    resolveEntityId: (sourceNodeId: string) => string | null,
): {
    data: Record<string, unknown> | null;
    issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>>;
} {
    const issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>> = [];
    const foxholeKey = normalizedText(state.foxholeKey);
    if (!foxholeKey || foxholeKey.length > 128) {
        return {
            data: null,
            issues: [unsupportedStateIssue('Foxhole connector has no valid asset key and remains only in legacy source data.')],
        };
    }
    if (!Array.isArray(state.points)
        || state.points.length < 4
        || state.points.length > 2048
        || state.points.length % 2 !== 0
        || !state.points.every(value => (
            typeof value === 'number'
            && Number.isFinite(value)
            && Math.abs(value) <= 1_000_000_000
        ))) {
        return {
            data: null,
            issues: [unsupportedStateIssue('Foxhole connector points are malformed and remain only in legacy source data.')],
        };
    }

    const optionalText = (key: 'startSocketName' | 'endSocketName'): string | undefined => {
        const value = normalizedText(state[key]);
        if (!value) {
            return undefined;
        }
        if (value.length <= 256) {
            return value;
        }
        issues.push(unsupportedStateIssue(`Foxhole connector ${key} is too long and remains only in legacy source data.`));
        return undefined;
    };
    const attachment = (key: 'startAttachment' | 'endAttachment'): { nodeId: string; socketName: string; } | undefined => {
        const value = state[key];
        if (value === undefined || value === null) {
            return undefined;
        }
        if (isRecord(value)) {
            const nodeId = normalizedText(value.nodeId);
            const socketName = normalizedText(value.socketName);
            if (nodeId && nodeId.length <= 256 && socketName && socketName.length <= 256) {
                const targetEntityId = resolveEntityId(nodeId);
                if (targetEntityId) {
                    return { nodeId: targetEntityId, socketName };
                }
                issues.push(unsupportedStateIssue(`Foxhole connector ${key} references a missing or ambiguous node and remains only in legacy source data.`));
                return { nodeId, socketName };
            }
        }
        issues.push(unsupportedStateIssue(`Foxhole connector ${key} is malformed and remains only in legacy source data.`));
        return undefined;
    };
    const startSocketName = optionalText('startSocketName');
    const endSocketName = optionalText('endSocketName');
    const startAttachment = attachment('startAttachment');
    const endAttachment = attachment('endAttachment');

    return {
        data: {
            foxholeKey,
            points: [...state.points],
            ...(startSocketName ? { startSocketName } : {}),
            ...(endSocketName ? { endSocketName } : {}),
            ...(startAttachment ? { startAttachment } : {}),
            ...(endAttachment ? { endAttachment } : {}),
        },
        issues,
    };
}

function convertSplineConnectorState(
    state: Record<string, unknown>,
    resolveEntityId: (sourceNodeId: string) => string | null,
): {
    data: Record<string, unknown> | null;
    modifications: Array<{ slotId: string; variantId: string; }>;
    socketAttachments: FoxholeSceneV2SocketAttachment[];
    issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>>;
} {
    const issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>> = [];
    const foxholeKey = normalizedText(state.foxholeKey);
    if (!foxholeKey || foxholeKey.length > 128) {
        return {
            data: null,
            modifications: [],
            socketAttachments: [],
            issues: [unsupportedStateIssue('Foxhole spline connector has no valid asset key and remains only in legacy source data.')],
        };
    }

    const endpoint = (key: 'start' | 'end'): {
        x: number;
        y: number;
        rotation: number;
        handleLength?: number;
    } | null => {
        const value = state[key];
        if (!isRecord(value)
            || typeof value.x !== 'number'
            || !Number.isFinite(value.x)
            || Math.abs(value.x) > 1_000_000_000
            || typeof value.y !== 'number'
            || !Number.isFinite(value.y)
            || Math.abs(value.y) > 1_000_000_000
            || typeof value.rotation !== 'number'
            || !Number.isFinite(value.rotation)
            || Math.abs(value.rotation) > 1_000_000_000) {
            issues.push(unsupportedStateIssue(`Foxhole spline connector ${key} endpoint is malformed and remains only in legacy source data.`));
            return null;
        }
        const handleLength = value.handleLength;
        if (handleLength !== undefined
            && (typeof handleLength !== 'number'
                || !Number.isFinite(handleLength)
                || handleLength < 1
                || handleLength > 1_000_000_000)) {
            issues.push(unsupportedStateIssue(`Foxhole spline connector ${key} handle length is invalid and Scene V2 used its constrained default.`));
        }
        return {
            x: value.x,
            y: value.y,
            rotation: value.rotation,
            ...(typeof handleLength === 'number'
                && Number.isFinite(handleLength)
                && handleLength >= 1
                && handleLength <= 1_000_000_000
                ? { handleLength }
                : {}),
        };
    };
    const start = endpoint('start');
    const end = endpoint('end');
    if (!start || !end) {
        return { data: null, modifications: [], socketAttachments: [], issues };
    }

    const finiteNumber = (
        key: string,
        fallback: number,
        min: number,
        max: number,
    ): number => {
        const value = state[key];
        if (value === undefined) {
            return fallback;
        }
        if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) {
            return value;
        }
        issues.push(unsupportedStateIssue(`Foxhole spline connector ${key} is invalid and Scene V2 used a safe fallback.`));
        return fallback;
    };
    const optionalNumber = (key: string, min: number, max: number): number | undefined => {
        const value = state[key];
        if (value === undefined || value === null) {
            return undefined;
        }
        if (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max) {
            return value;
        }
        issues.push(unsupportedStateIssue(`Foxhole spline connector ${key} is invalid and remains only in legacy source data.`));
        return undefined;
    };
    const optionalText = (key: 'startSocketName' | 'endSocketName'): string | undefined => {
        const value = normalizedText(state[key]);
        if (!value) {
            return undefined;
        }
        if (value.length <= 256) {
            return value;
        }
        issues.push(unsupportedStateIssue(`Foxhole spline connector ${key} is too long and remains only in legacy source data.`));
        return undefined;
    };
    const attachment = (key: 'startAttachment' | 'endAttachment'): {
        nodeId: string;
        socketName: string;
    } | undefined => {
        const value = state[key];
        if (value === undefined || value === null) {
            return undefined;
        }
        if (isRecord(value)) {
            const nodeId = normalizedText(value.nodeId);
            const socketName = normalizedText(value.socketName);
            if (nodeId && nodeId.length <= 256 && socketName && socketName.length <= 256) {
                const targetEntityId = resolveEntityId(nodeId);
                if (targetEntityId) {
                    return { nodeId: targetEntityId, socketName };
                }
                issues.push(unsupportedStateIssue(`Foxhole spline connector ${key} references a missing or ambiguous node and remains only in legacy source data.`));
                return { nodeId, socketName };
            }
        }
        issues.push(unsupportedStateIssue(`Foxhole spline connector ${key} is malformed and remains only in legacy source data.`));
        return undefined;
    };

    const socketAttachments = convertSocketAttachments(state.socketAttachments, resolveEntityId);
    issues.push(...socketAttachments.issues);
    const modifications = isRecord(state.modificationVariantIds)
        ? Object.entries(state.modificationVariantIds).flatMap(([slotId, variantId]) => {
            const normalizedSlotId = normalizedText(slotId);
            const normalizedVariantId = normalizedText(variantId);
            return normalizedSlotId && normalizedSlotId.length <= 128
                && normalizedVariantId && normalizedVariantId.length <= 128
                ? [{ slotId: normalizedSlotId, variantId: normalizedVariantId }]
                : [];
        })
        : [];
    if (hasEntries(state.modificationVariantIds)
        && modifications.length !== Object.keys(state.modificationVariantIds as Record<string, unknown>).length) {
        issues.push(unsupportedStateIssue('Some Foxhole spline connector modification selections were malformed and remain only in legacy source data.'));
    }

    const minLength = finiteNumber('minLength', DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE.minLength, 1, 1_000_000_000);
    const maxLength = finiteNumber(
        'maxLength',
        Math.max(minLength, DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE.maxLength),
        minLength,
        1_000_000_000,
    );
    const minRadius = finiteNumber('minRadius', DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE.minRadius, 1, 1_000_000_000);
    const maxRadius = finiteNumber('maxRadius', Math.max(minRadius, DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE.maxRadius), minRadius, 1_000_000_000);
    const startAttachment = attachment('startAttachment');
    const endAttachment = attachment('endAttachment');
    const inferredSocketNames = resolveConnectorEndpointSocketNames(foxholeKey);
    const startSocketName = optionalText('startSocketName') ?? inferredSocketNames.backSocketName;
    const endSocketName = optionalText('endSocketName') ?? inferredSocketNames.frontSocketName;
    const tint = optionalNumber('tint', 0, 0xFFFFFF);
    const brightness = optionalNumber('brightness', 0, 4);
    const maxTargetAngleDeg = optionalNumber('maxTargetAngleDeg', 0, 360);
    // Authored FoxWatch connectors use -1 to disable arc constraints. V1 only
    // applies positive limits; omission preserves that behavior in the V2 schema.
    const maxArcAngleDeg = state.maxArcAngleDeg === -1 ? undefined : optionalNumber('maxArcAngleDeg', 0, 360);

    return {
        data: {
            foxholeKey,
            startX: start.x,
            startY: start.y,
            startRotation: start.rotation,
            ...(start.handleLength === undefined ? {} : { startHandleLength: start.handleLength }),
            endX: end.x,
            endY: end.y,
            endRotation: end.rotation,
            ...(end.handleLength === undefined ? {} : { endHandleLength: end.handleLength }),
            minLength,
            maxLength,
            minRadius,
            maxRadius,
            maxBuffer: finiteNumber('maxBuffer', DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE.maxBuffer, 0, 1_000_000_000),
            curveT: finiteNumber('curveT', DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE.curveT, 0, 1),
            ...(maxTargetAngleDeg === undefined ? {} : { maxTargetAngleDeg }),
            ...(maxArcAngleDeg === undefined ? {} : { maxArcAngleDeg }),
            ...(startSocketName ? { startSocketName } : {}),
            ...(endSocketName ? { endSocketName } : {}),
            ...(startAttachment
                ? {
                    startAttachmentNodeId: startAttachment.nodeId,
                    startAttachmentSocketName: startAttachment.socketName,
                }
                : {}),
            ...(endAttachment
                ? {
                    endAttachmentNodeId: endAttachment.nodeId,
                    endAttachmentSocketName: endAttachment.socketName,
                }
                : {}),
            blueprint: state.blueprint === true,
            ...(tint === undefined ? {} : { tint }),
            ...(brightness === undefined ? {} : { brightness }),
        },
        modifications,
        socketAttachments: socketAttachments.attachments,
        issues,
    };
}

function convertRangeState(state: Record<string, unknown>): {
    data: Record<string, unknown> | null;
    issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>>;
} {
    const issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>> = [];
    if (!Array.isArray(state.points)
        || state.points.length !== 4
        || !state.points.every(value => (
            typeof value === 'number'
            && Number.isFinite(value)
            && Math.abs(value) <= 1_000_000_000
        ))) {
        return {
            data: null,
            issues: [unsupportedStateIssue('Foxhole range points are malformed and remain only in legacy source data.')],
        };
    }

    const numericValue = (key: keyof typeof DEFAULT_FOXHOLE_RANGE_STATE, min: number, max: number, integer = false): number => {
        const fallback = DEFAULT_FOXHOLE_RANGE_STATE[key] as number;
        const value = state[key];
        if (value === undefined) {
            return fallback;
        }
        if (typeof value === 'number'
            && Number.isFinite(value)
            && value >= min
            && value <= max
            && (!integer || Number.isInteger(value))) {
            return value;
        }
        issues.push(unsupportedStateIssue(`Foxhole range ${key} is invalid; Scene V2 used a safe fallback.`));
        return fallback;
    };
    const booleanValue = (key: keyof typeof DEFAULT_FOXHOLE_RANGE_STATE): boolean => {
        const fallback = DEFAULT_FOXHOLE_RANGE_STATE[key] as boolean;
        const value = state[key];
        if (value === undefined) {
            return fallback;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        issues.push(unsupportedStateIssue(`Foxhole range ${key} is invalid; Scene V2 used a safe fallback.`));
        return fallback;
    };
    let strokeStyle = DEFAULT_FOXHOLE_RANGE_STATE.strokeStyle;
    if (state.strokeStyle === 'solid' || state.strokeStyle === 'dashed') {
        strokeStyle = state.strokeStyle;
    } else if (state.strokeStyle !== undefined) {
        issues.push(unsupportedStateIssue('Foxhole range strokeStyle is invalid; Scene V2 used a safe fallback.'));
    }

    return {
        data: {
            points: normalizeFoxholeRangePoints(state.points),
            sweepAngle: numericValue('sweepAngle', 1, 360),
            scaleWithZoom: booleanValue('scaleWithZoom'),
            strokeColor: numericValue('strokeColor', 0, 0xFFFFFF, true),
            strokeWidth: numericValue('strokeWidth', 1, 4096),
            strokeAlpha: numericValue('strokeAlpha', 0, 1),
            strokeStyle,
            strokeDashLength: numericValue('strokeDashLength', 1, 1_000_000),
            strokeDashGap: numericValue('strokeDashGap', 1, 1_000_000),
            fillColor: numericValue('fillColor', 0, 0xFFFFFF, true),
            fillAlpha: numericValue('fillAlpha', 0, 1),
            showCenterAxis: booleanValue('showCenterAxis'),
            showRadius: booleanValue('showRadius'),
            showAngle: booleanValue('showAngle'),
            labelColor: numericValue('labelColor', 0, 0xFFFFFF, true),
            labelFontSize: numericValue('labelFontSize', 6, 4096),
            labelBackgroundColor: numericValue('labelBackgroundColor', 0, 0xFFFFFF, true),
            labelBackgroundAlpha: numericValue('labelBackgroundAlpha', 0, 1),
            labelPadding: numericValue('labelPadding', 0, 4096),
            labelStrokeWidth: numericValue('labelStrokeWidth', 0, 4096),
            centerMarkerRadius: numericValue('centerMarkerRadius', 1, 4096),
            meterPixels: numericValue('meterPixels', 1, 1_000_000),
            decimals: numericValue('decimals', 0, 4, true),
        },
        issues,
    };
}

function convertBinocularLineState(state: Record<string, unknown>): {
    data: Record<string, unknown> | null;
    issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>>;
} {
    const issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>> = [];
    if (!Array.isArray(state.points)
        || state.points.length < 4
        || state.points.length > 2048
        || state.points.length % 2 !== 0
        || !state.points.every(value => (
            typeof value === 'number'
            && Number.isFinite(value)
            && Math.abs(value) <= 1_000_000_000
        ))) {
        return {
            data: null,
            issues: [unsupportedStateIssue('Foxhole binocular line points are malformed and remain only in legacy source data.')],
        };
    }

    const numericValue = (
        key: keyof typeof DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE,
        min: number,
        max: number,
        integer = false,
    ): number => {
        const fallback = DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE[key] as number;
        const value = state[key];
        if (value === undefined) {
            return fallback;
        }
        if (typeof value === 'number'
            && Number.isFinite(value)
            && value >= min
            && value <= max
            && (!integer || Number.isInteger(value))) {
            return value;
        }
        issues.push(unsupportedStateIssue(`Foxhole binocular line ${key} is invalid; Scene V2 used a safe fallback.`));
        return fallback;
    };
    const booleanValue = (key: keyof typeof DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE): boolean => {
        const fallback = DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE[key] as boolean;
        const value = state[key];
        if (value === undefined) {
            return fallback;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        issues.push(unsupportedStateIssue(`Foxhole binocular line ${key} is invalid; Scene V2 used a safe fallback.`));
        return fallback;
    };
    const endCap = (key: 'startCap' | 'endCap'): 'none' | 'arrow' | 'circle' => {
        const value = state[key];
        if (value === undefined) {
            return DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE[key];
        }
        if (value === 'none' || value === 'arrow' || value === 'circle') {
            return value;
        }
        issues.push(unsupportedStateIssue(`Foxhole binocular line ${key} is invalid; Scene V2 used a safe fallback.`));
        return DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE[key];
    };

    return {
        data: {
            points: normalizeFoxholeBinocularLinePoints(state.points),
            scaleWithZoom: booleanValue('scaleWithZoom'),
            strokeColor: numericValue('strokeColor', 0, 0xFFFFFF, true),
            strokeWidth: numericValue('strokeWidth', 1, 4096),
            strokeAlpha: numericValue('strokeAlpha', 0, 1),
            multiSegmentAlpha: numericValue('multiSegmentAlpha', 0, 1),
            showDistance: booleanValue('showDistance'),
            showAzimuth: booleanValue('showAzimuth'),
            showAzimuthArrows: booleanValue('showAzimuthArrows'),
            labelColor: numericValue('labelColor', 0, 0xFFFFFF, true),
            labelFontSize: numericValue('labelFontSize', 6, 4096),
            labelBackgroundColor: numericValue('labelBackgroundColor', 0, 0xFFFFFF, true),
            labelBackgroundAlpha: numericValue('labelBackgroundAlpha', 0, 1),
            labelPadding: numericValue('labelPadding', 0, 4096),
            labelStrokeWidth: numericValue('labelStrokeWidth', 0, 4096),
            endpointRadius: numericValue('endpointRadius', 0, 4096),
            startCap: endCap('startCap'),
            endCap: endCap('endCap'),
            meterPixels: numericValue('meterPixels', 1, 1_000_000),
            decimals: numericValue('decimals', 0, 4, true),
        },
        issues,
    };
}

function convertTriangulationState(state: Record<string, unknown>): {
    data: Record<string, unknown> | null;
    issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>>;
} {
    const issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>> = [];
    if (!Array.isArray(state.edgePoints)
        || state.edgePoints.length < 6
        || state.edgePoints.length > 2048
        || state.edgePoints.length % 2 !== 0
        || !state.edgePoints.every(value => (
            typeof value === 'number'
            && Number.isFinite(value)
            && Math.abs(value) <= 1_000_000_000
        ))) {
        return {
            data: null,
            issues: [unsupportedStateIssue('Foxhole triangulation edge points are malformed and remain only in legacy source data.')],
        };
    }
    const edgePoints = normalizeFoxholeTriangulationEdgePoints(state.edgePoints);
    if (!resolveFoxholeTriangulationFit({ x: 0, y: 0, edgePoints })) {
        return {
            data: null,
            issues: [unsupportedStateIssue('Foxhole triangulation edge points cannot form a stable circle and remain only in legacy source data.')],
        };
    }

    const numericValue = (
        key: keyof typeof DEFAULT_FOXHOLE_TRIANGULATION_STATE,
        min: number,
        max: number,
        integer = false,
    ): number => {
        const fallback = DEFAULT_FOXHOLE_TRIANGULATION_STATE[key] as number;
        const value = state[key];
        if (value === undefined) {
            return fallback;
        }
        if (typeof value === 'number'
            && Number.isFinite(value)
            && value >= min
            && value <= max
            && (!integer || Number.isInteger(value))) {
            return value;
        }
        issues.push(unsupportedStateIssue(`Foxhole triangulation ${key} is invalid; Scene V2 used a safe fallback.`));
        return fallback;
    };
    const booleanValue = (key: keyof typeof DEFAULT_FOXHOLE_TRIANGULATION_STATE): boolean => {
        const fallback = DEFAULT_FOXHOLE_TRIANGULATION_STATE[key] as boolean;
        const value = state[key];
        if (value === undefined) {
            return fallback;
        }
        if (typeof value === 'boolean') {
            return value;
        }
        issues.push(unsupportedStateIssue(`Foxhole triangulation ${key} is invalid; Scene V2 used a safe fallback.`));
        return fallback;
    };
    let strokeStyle = DEFAULT_FOXHOLE_TRIANGULATION_STATE.strokeStyle;
    if (state.strokeStyle === 'solid' || state.strokeStyle === 'dashed') {
        strokeStyle = state.strokeStyle;
    } else if (state.strokeStyle !== undefined) {
        issues.push(unsupportedStateIssue('Foxhole triangulation strokeStyle is invalid; Scene V2 used a safe fallback.'));
    }

    return {
        data: {
            edgePoints,
            scaleWithZoom: booleanValue('scaleWithZoom'),
            strokeColor: numericValue('strokeColor', 0, 0xFFFFFF, true),
            strokeWidth: numericValue('strokeWidth', 1, 4096),
            strokeAlpha: numericValue('strokeAlpha', 0, 1),
            strokeStyle,
            strokeDashLength: numericValue('strokeDashLength', 1, 1_000_000),
            strokeDashGap: numericValue('strokeDashGap', 1, 1_000_000),
            fillColor: numericValue('fillColor', 0, 0xFFFFFF, true),
            fillAlpha: numericValue('fillAlpha', 0, 1),
            spokeAlpha: numericValue('spokeAlpha', 0, 1),
            edgeLineAlpha: numericValue('edgeLineAlpha', 0, 1),
            showSpokes: booleanValue('showSpokes'),
            showRadius: booleanValue('showRadius'),
            showEdgeMarkers: booleanValue('showEdgeMarkers'),
            labelColor: numericValue('labelColor', 0, 0xFFFFFF, true),
            labelFontSize: numericValue('labelFontSize', 6, 4096),
            labelBackgroundColor: numericValue('labelBackgroundColor', 0, 0xFFFFFF, true),
            labelBackgroundAlpha: numericValue('labelBackgroundAlpha', 0, 1),
            labelPadding: numericValue('labelPadding', 0, 4096),
            labelStrokeWidth: numericValue('labelStrokeWidth', 0, 4096),
            centerMarkerRadius: numericValue('centerMarkerRadius', 1, 4096),
            edgeMarkerRadius: numericValue('edgeMarkerRadius', 1, 4096),
            meterPixels: numericValue('meterPixels', 1, 1_000_000),
            decimals: numericValue('decimals', 0, 4, true),
        },
        issues,
    };
}

export const convertFoxholeSceneV1NodeToV2: NixieSceneV1NodeConverter = ({ entityId, node, resolveEntityId }) => {
    const iconAssetId = node.type === 'nixieIcon'
        ? resolveFoxholeIconAssetId(node.state.textureUrl)
        : null;
    if (iconAssetId) {
        return {
            supported: true,
            handledStateKeys: ['textureUrl'],
            components: [{
                ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
                componentId: 'asset',
                version: 1,
                data: {
                    catalogId: 'foxhole.icons',
                    assetId: iconAssetId,
                },
            }],
        };
    }
    if (node.type === FOXHOLE_TRIANGULATION_NODE_TYPE) {
        const converted = convertTriangulationState(node.state);
        return {
            supported: converted.data !== null,
            handledStateKeys: [...TRIANGULATION_STATE_KEYS],
            issues: converted.issues,
            components: converted.data
                ? [{
                    ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
                    componentId: 'triangulation',
                    version: 1,
                    data: converted.data,
                }]
                : [],
        };
    }
    if (node.type === FOXHOLE_BINOCULAR_LINE_NODE_TYPE) {
        const converted = convertBinocularLineState(node.state);
        return {
            supported: converted.data !== null,
            handledStateKeys: [...BINOCULAR_LINE_STATE_KEYS],
            issues: converted.issues,
            components: converted.data
                ? [{
                    ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
                    componentId: 'binocular-line',
                    version: 1,
                    data: converted.data,
                }]
                : [],
        };
    }
    if (node.type === FOXHOLE_RANGE_NODE_TYPE) {
        const converted = convertRangeState(node.state);
        return {
            supported: converted.data !== null,
            handledStateKeys: [...RANGE_STATE_KEYS],
            issues: converted.issues,
            components: converted.data
                ? [{
                    ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
                    componentId: 'range',
                    version: 1,
                    data: converted.data,
                }]
                : [],
        };
    }
    if (node.type === FOXHOLE_CONNECTOR_NODE_TYPE) {
        const converted = convertConnectorState(node.state, resolveEntityId);
        return {
            supported: converted.data !== null,
            handledStateKeys: [...CONNECTOR_STATE_KEYS],
            issues: converted.issues,
            components: converted.data
                ? [{
                    ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
                    componentId: 'connector',
                    version: 1,
                    data: converted.data,
                }]
                : [],
        };
    }
    if (node.type === FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE) {
        const converted = convertSplineConnectorState(node.state, resolveEntityId);
        return {
            supported: converted.data !== null,
            handledStateKeys: [...SPLINE_CONNECTOR_STATE_KEYS],
            issues: converted.issues,
            components: converted.data
                ? [{
                    ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
                    componentId: 'spline-connector',
                    version: 1,
                    data: converted.data,
                }, ...(converted.modifications.length > 0
                    ? [{
                        ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
                        componentId: 'modification',
                        version: 1,
                        data: { selections: converted.modifications },
                    }]
                    : []), ...(converted.socketAttachments.length > 0
                    ? [{
                        ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
                        componentId: 'socket-attachments',
                        version: 1,
                        data: { attachments: converted.socketAttachments },
                    }]
                    : [])]
                : [],
        };
    }
    if (node.type === FOXHOLE_TACTICAL_LINE_NODE_TYPE) {
        const converted = convertTacticalLineState(node.state);
        return {
            supported: converted.data !== null,
            handledStateKeys: [...TACTICAL_LINE_STATE_KEYS],
            issues: converted.issues,
            components: converted.data
                ? [{
                    ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
                    componentId: 'tactical-line',
                    version: 1,
                    data: converted.data,
                }]
                : [],
        };
    }
    if (!FOXHOLE_SCENE_V1_NODE_TYPES.has(node.type)) {
        return null;
    }

    const state = node.state;
    const assetId = normalizedText(state.foxholeKey);
    if (!assetId) {
        return {
            supported: false,
            handledStateKeys: [...FOXHOLE_STATE_KEYS],
            issues: [unsupportedStateIssue('Foxhole asset has no asset key and cannot be instantiated by Scene V2.')],
        };
    }

    const selections = isRecord(state.modificationVariantIds)
        ? Object.entries(state.modificationVariantIds).flatMap(([slotId, variantId]) => {
            const normalizedSlotId = normalizedText(slotId);
            const normalizedVariantId = normalizedText(variantId);
            return normalizedSlotId && normalizedVariantId
                ? [{ slotId: normalizedSlotId, variantId: normalizedVariantId }]
                : [];
        })
        : [];
    const issues: Array<Omit<NixieSceneV1ConversionIssue, 'nodeId' | 'nodePath' | 'nodeType'>> = [];
    const supportedModificationKeys = getFoxholeSceneV2ModificationKeys(assetId);
    for (const selection of selections) {
        if (!supportedModificationKeys.has(`${selection.slotId}\u0000${selection.variantId}`)) {
            issues.push(unsupportedStateIssue(
                `Foxhole modification visuals for ${selection.slotId}/${selection.variantId} are unavailable and remain in legacy source data.`,
            ));
        }
    }
    const orders = Array.isArray(state.productionOrders)
        ? state.productionOrders.flatMap((value, index) => {
            if (!isRecord(value)) {
                issues.push(unsupportedStateIssue(`Production order ${index + 1} is malformed and remains only in legacy source data.`));
                return [];
            }
            const recipeId = normalizedText(value.recipeId);
            if (!recipeId) {
                issues.push(unsupportedStateIssue(`Production order ${index + 1} has no recipe ID and remains only in legacy source data.`));
                return [];
            }
            const cycles = Number(value.cycles);
            const label = normalizedText(value.label);
            return [{
                id: `${entityId}.order.${index + 1}`,
                recipeId,
                ...(value.parent === true ? { parent: true } : {}),
                ...(Number.isSafeInteger(cycles) && cycles > 0 ? { cycles } : {}),
                ...(label ? { label } : {}),
            }];
        })
        : [];

    const appearanceSupport = getFoxholeSceneV2AppearanceSupport(assetId);
    const appearance: Record<string, boolean | number | string> = {};
    const faction = normalizeFoxholeFaction(state.faction);
    if (faction) {
        appearance.faction = faction;
        if (!appearanceSupport.factions.has(faction)) {
            issues.push(unsupportedStateIssue(`Foxhole faction ${faction} has no published Scene V2 texture for this asset and remains in legacy source data.`));
        }
    } else if (state.faction !== undefined && state.faction !== null) {
        issues.push(unsupportedStateIssue('Foxhole faction is malformed and remains only in legacy source data.'));
    }
    const colorHex = normalizeFoxholeColorHex(state.colorHex);
    if (colorHex && colorHex.length === 6) {
        appearance.colorHex = colorHex;
        if (!appearanceSupport.colors.has(colorHex)) {
            issues.push(unsupportedStateIssue(`Foxhole color ${colorHex} has no published Scene V2 texture for this asset and remains in legacy source data.`));
        }
    } else if (normalizedText(state.colorHex)) {
        issues.push(unsupportedStateIssue('Foxhole custom color is malformed or unsupported and remains only in legacy source data.'));
    }
    const packaged = state.packaged === true;
    if (packaged) {
        appearance.packaged = true;
        if (!appearanceSupport.packaged) {
            issues.push(unsupportedStateIssue('Foxhole packaged appearance has no published Scene V2 visual for this asset and remains in legacy source data.'));
        }
    } else if (state.destroyed === true) {
        appearance.destroyed = true;
        if (!appearanceSupport.destroyed) {
            issues.push(unsupportedStateIssue('Foxhole destroyed appearance has no published Scene V2 visual for this asset and remains in legacy source data.'));
        }
    }
    if (!packaged && state.blueprint === true) {
        appearance.blueprint = true;
        if (!appearanceSupport.blueprint) {
            issues.push(unsupportedStateIssue('Foxhole blueprint appearance is not supported by this asset and remains in legacy source data.'));
        }
    }
    const optionalAppearanceNumber = (
        key: 'tint' | 'brightness' | 'anchorX' | 'anchorY',
        fallback: number,
        minimum: number,
        maximum: number,
        integer = false,
    ): void => {
        const value = state[key];
        if (value === undefined || value === null || value === fallback) {
            return;
        }
        if (typeof value === 'number'
            && Number.isFinite(value)
            && value >= minimum
            && value <= maximum
            && (!integer || Number.isInteger(value))) {
            appearance[key] = value;
            return;
        }
        issues.push(unsupportedStateIssue(`Foxhole ${key} is malformed and remains only in legacy source data.`));
    };
    optionalAppearanceNumber('tint', 0xFFFFFF, 0, 0xFFFFFF, true);
    optionalAppearanceNumber('brightness', 1, 0, 4);
    optionalAppearanceNumber('anchorX', 0.5, -10, 10);
    optionalAppearanceNumber('anchorY', 0.5, -10, 10);

    const cargoLimit = getFoxholeSceneV2CargoSupport(assetId).limit;
    const stockpileGroups = resolveFoxholeStockpileSelectionGroups(getFoxholeManifest('/foxhole/assets/').assets.find(asset => asset.id === assetId)?.stockpiles);
    const markedCargo = isFoxholeBuildSiteKey(assetId)
        ? []
        : clampMarkedItemCodenames(
            normalizeMarkedItemCodenames(state.markedItemCodenames),
            cargoLimit,
        ).slice(0, 64);
    const itemIdsByCodeName = getFoxholeSceneV2ItemIdsByCodeName();
    const supportedCargo = markedCargo.filter(codeName => {
        if (stockpileGroups.some(group => group.allowed.some(code => code.toLowerCase() === codeName.toLowerCase()))) return true;
        if (itemIdsByCodeName.has(codeName.toLocaleLowerCase())) {
            return true;
        }
        issues.push(unsupportedStateIssue(
            `Foxhole stored item ${codeName} has no published Scene V2 icon and remains only in legacy source data.`,
        ));
        return false;
    });

    const socketAttachments = convertSocketAttachments(state.socketAttachments, resolveEntityId);
    issues.push(...socketAttachments.issues);

    const unsupportedFlags = [
        ['maintenance filters', hasEntries(state.maintenanceFilters)],
        ['legacy base upgrades', hasEntries(state.baseUpgrades)],
    ] as const;
    for (const [label, present] of unsupportedFlags) {
        if (present) {
            issues.push(unsupportedStateIssue(`Foxhole ${label} is not represented by Scene V2 yet and remains in legacy source data.`));
        }
    }

    const renderable = getFoxholeSceneV2RenderableAssetIds().has(assetId);
    if (!renderable) {
        issues.push(unsupportedStateIssue(`Foxhole asset ${assetId} has no Scene V2 product renderer yet.`));
    }

    return {
        supported: renderable,
        handledStateKeys: [...FOXHOLE_STATE_KEYS],
        issues,
        components: [{
            ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
            componentId: 'asset',
            version: 1,
            data: { catalogId: 'foxhole.structures', assetId },
        }, ...(Object.keys(appearance).length > 0
            ? [{
                ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
                componentId: 'appearance',
                version: 1,
                data: appearance,
            }]
            : []), {
            ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
            componentId: 'modification',
            version: 1,
            data: { selections },
        }, {
            ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
            componentId: 'cargo',
            version: 1,
            data: { items: supportedCargo,
                ...(stockpileGroups.length
                    ? { stockpileItems: stockpileSelectionsToEntries(
                        stockpileGroups,
                        state.markedStockpileItems, state.markedItemCodenames,
                    ) } : {}),
            },
        }, ...(getFoxholeSceneV2SocketAssetIds().has(assetId)
            ? [{
                ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
                componentId: 'socket-attachments',
                version: 1,
                data: { attachments: socketAttachments.attachments },
            }]
            : []), {
            ownerId: FOXHOLE_SCENE_V2_OWNER_ID,
            componentId: 'production-order',
            version: 1,
            data: {
                orders,
                ...(state.disableProduction === true ? { disabled: true } : {}),
            },
        }],
    };
};
