import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import { createNixieIconAssetSnapshot } from '#nixie/plugins/nixie/contributions/assets/shared/icon-asset.ts';
import type { NixieIconLabelPosition } from '#nixie/plugins/nixie/contributions/assets/shared/icon.ts';
import type { FoxholeItemCatalog, FoxholeStructureCatalog } from '../nixie/catalog.ts';
import type { LegacyPlanEntity } from './plan-types.ts';
import {
    legacyStyleBoolean,
    legacyStyleNumber,
    parseLegacyColor,
    resolveLegacyShapeStyle,
} from './plan-legacy-styles.ts';

const DEG_TO_RAD = Math.PI / 180;

/** Legacy icon keys that no longer exist in Nixie — drop silently on import. */
export const LEGACY_DEPRECATED_ICON_KEYS = new Set([
    'radioaircraft',
]);

export type LegacyIconMappingResult = {
    snapshot: BoardNodeSnapshot | null;
    consumedFields: string[];
    unresolvedKey?: string;
    reason?: string;
};

function normalizeKey(value: unknown): string {
    return String(value ?? '').trim();
}

function resolveIconAsset(
    key: string,
    itemCatalog: FoxholeItemCatalog,
    structureCatalog: FoxholeStructureCatalog,
): { textureUrl: string; label: string; foxholeKey: string; } | null {
    const normalized = key.trim();
    if (!normalized) {
        return null;
    }
    const lower = normalized.toLowerCase();
    const item = itemCatalog.assetByKey[normalized]
        ?? itemCatalog.assetByKey[lower]
        ?? null;
    if (item?.iconUrl) {
        return {
            textureUrl: item.iconUrl,
            label: item.name || normalized,
            foxholeKey: item.foxholeKey,
        };
    }
    const structure = structureCatalog.assetByKey[normalized]
        ?? structureCatalog.assetByKey[lower]
        ?? null;
    if (structure?.iconUrl) {
        return {
            textureUrl: structure.iconUrl,
            label: structure.name || normalized,
            foxholeKey: structure.foxholeKey,
        };
    }
    return null;
}

function mapLabelPosition(value: unknown): NixieIconLabelPosition {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'top' || normalized === 'bottom') {
        return normalized;
    }
    return 'bottom';
}

/**
 * Map a legacy `type: "icon"` entity into a Nixie `nixieIcon` board snapshot.
 */
export function mapLegacyPlanIconEntity(
    entity: LegacyPlanEntity,
    itemCatalog: FoxholeItemCatalog,
    structureCatalog: FoxholeStructureCatalog,
): LegacyIconMappingResult {
    if (String(entity.type ?? '').trim() !== 'icon') {
        return { snapshot: null, consumedFields: [], reason: 'not_icon' };
    }

    const key = normalizeKey(entity.key);
    if (!key) {
        return { snapshot: null, consumedFields: [], reason: 'missing_icon_key' };
    }

    if (LEGACY_DEPRECATED_ICON_KEYS.has(key.toLowerCase())) {
        return {
            snapshot: null,
            consumedFields: ['type', 'key'],
            reason: 'deprecated_icon_key',
        };
    }

    const resolved = resolveIconAsset(key, itemCatalog, structureCatalog);
    if (!resolved) {
        return {
            snapshot: null,
            consumedFields: [],
            unresolvedKey: key,
            reason: 'unresolved_icon_key',
        };
    }

    const style = resolveLegacyShapeStyle('icon', entity.shapeStyle ?? null);
    const width = Math.max(1, Math.abs(Number(entity.width ?? 128)) || 128);
    const height = Math.max(1, Math.abs(Number(entity.height ?? 128)) || 128);
    const showLabel = legacyStyleBoolean(style, 'label', false);
    const entityName = typeof entity.name === 'string' && entity.name.trim()
        ? entity.name.trim()
        : resolved.label;

    const snapshot = createNixieIconAssetSnapshot({
        id: `legacy-${entity.id}`,
        key: resolved.foxholeKey,
        textureUrl: resolved.textureUrl,
        label: showLabel ? entityName : '',
        x: Number(entity.x ?? 0),
        y: Number(entity.y ?? 0),
        z: entity.z != null ? Number(entity.z) : undefined,
        rotation: Number(entity.rotation ?? 0) * DEG_TO_RAD,
        alpha: legacyStyleNumber(style, 'alpha', 1),
        locked: entity.locked === true,
        width,
        height,
        backgroundColor: legacyStyleBoolean(style, 'fill', true)
            ? parseLegacyColor(style.fillColor, 0x0B0B0B)
            : 0x000000,
        borderColor: legacyStyleBoolean(style, 'border', true)
            ? parseLegacyColor(style.lineColor, 0x00FF00)
            : 0x000000,
        borderWidth: legacyStyleBoolean(style, 'border', true)
            ? Math.max(0, legacyStyleNumber(style, 'lineWidth', 3))
            : 0,
        cornerRadius: Math.max(0, legacyStyleNumber(style, 'lineRadius', 0)),
        iconTint: parseLegacyColor(style.iconColor, 0xFFFFFF),
        labelPosition: showLabel ? mapLabelPosition(style.labelPosition) : null,
        labelColor: parseLegacyColor(style.labelColor, 0xFFFFFF),
        labelSize: legacyStyleNumber(style, 'labelSize', 28),
        showFrame: legacyStyleBoolean(style, 'fill', true) || legacyStyleBoolean(style, 'border', true),
    });

    return {
        snapshot,
        consumedFields: ['key', 'width', 'height', 'shapeStyle', 'name'],
    };
}
