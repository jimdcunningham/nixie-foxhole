import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import { NIXIE_URL_SPRITE_NODE_TYPE } from '#nixie/plugins/nixie/contributions/assets/shared/url-sprite.ts';
import {
    buildNixieLocalProjectAssetObjectUrl,
} from '#nixie/utils/nixie-local-project-assets.ts';
import { isNixieOfflineProjectId } from '#nixie/utils/nixie-project-surfaces.ts';
import type { NixieProjectAssetSummary } from '#nixie/utils/nixie-project-assets.ts';
import {
    isNixieProjectSvgImageMimeType,
    normalizeNixieProjectAssetDisplayName,
    normalizeNixieProjectAssetMimeType,
    resolveNixieProjectImageMimeTypeFromFilename,
} from '#nixie/utils/nixie-project-assets.ts';
import {
    legacyStyleNumber,
    resolveLegacyShapeStyle,
} from './plan-legacy-styles.ts';
import { resolveLegacyTintBrightness } from './plan-tint.ts';
import type { LegacyPlanArchiveAsset, LegacyPlanEntity } from './plan-types.ts';

const DEG_TO_RAD = Math.PI / 180;

function buildProjectAssetObjectUrl(
    projectId: string,
    assetId: string,
    options?: { format?: 'svg' | null; },
): string {
    if (isNixieOfflineProjectId(projectId)) {
        return buildNixieLocalProjectAssetObjectUrl(projectId, assetId, null, options);
    }
    const objectUrl = `/api/nixie/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}/object`;
    if (options?.format === 'svg') {
        return `${objectUrl}?format=svg`;
    }
    return objectUrl;
}

export type LegacyPlanPendingImage = {
    legacyId: number;
    textureFile: string | null;
    textureData: string | null;
    name: string | null;
    x: number;
    y: number;
    z?: number;
    rotationDeg: number;
    width: number;
    height: number;
    alpha: number;
    locked: boolean;
    tint?: number;
    brightness?: number;
};

export type LegacyPlanImageMappingResult = {
    pendingImages: LegacyPlanPendingImage[];
    unresolvedTextureFiles: string[];
};

function normalizeTextureFile(value: unknown): string | null {
    const normalized = String(value ?? '').trim().replace(/\\/gu, '/');
    if (!normalized) {
        return null;
    }
    const parts = normalized.split('/');
    return parts[parts.length - 1] || null;
}

function decodeDataUrlOrBase64(textureData: string): { bytes: Uint8Array; mimeType: string; filename: string; } | null {
    const trimmed = textureData.trim();
    if (!trimmed) {
        return null;
    }

    const dataUrlMatch = trimmed.match(/^data:([^;,]+)?(;base64)?,(.*)$/isu);
    if (dataUrlMatch) {
        const mimeType = String(dataUrlMatch[1] || 'image/png').trim() || 'image/png';
        const isBase64 = Boolean(dataUrlMatch[2]);
        const payload = dataUrlMatch[3] || '';
        try {
            if (isBase64) {
                const binary = atob(payload);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i += 1) {
                    bytes[i] = binary.charCodeAt(i);
                }
                return {
                    bytes,
                    mimeType,
                    filename: `inline.${mimeType.includes('jpeg') || mimeType.includes('jpg') ? 'jpg' : mimeType.includes('webp') ? 'webp' : mimeType.includes('gif') ? 'gif' : mimeType.includes('svg') ? 'svg' : 'png'}`,
                };
            }
            const bytes = new TextEncoder().encode(decodeURIComponent(payload));
            return { bytes, mimeType, filename: 'inline.bin' };
        } catch {
            return null;
        }
    }

    try {
        const binary = atob(trimmed);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) {
            bytes[i] = binary.charCodeAt(i);
        }
        return { bytes, mimeType: 'image/png', filename: 'inline.png' };
    } catch {
        return null;
    }
}

/**
 * Collect legacy `type: "image"` entities for later project-asset offload.
 */
export function collectLegacyPlanPendingImages(
    entities: readonly LegacyPlanEntity[] | null | undefined,
): LegacyPlanPendingImage[] {
    const pending: LegacyPlanPendingImage[] = [];
    for (const entity of entities ?? []) {
        if (String(entity.type ?? '').trim() !== 'image') {
            continue;
        }
        const style = resolveLegacyShapeStyle('rectangle', entity.shapeStyle ?? null);
        const tintBrightness = resolveLegacyTintBrightness(entity);
        pending.push({
            legacyId: Number(entity.id),
            textureFile: normalizeTextureFile(entity.textureFile),
            textureData: typeof entity.textureData === 'string' && entity.textureData.trim()
                ? entity.textureData.trim()
                : null,
            name: typeof entity.name === 'string' && entity.name.trim() ? entity.name.trim() : null,
            x: Number(entity.x ?? 0) || 0,
            y: Number(entity.y ?? 0) || 0,
            z: entity.z != null && Number.isFinite(Number(entity.z)) ? Number(entity.z) : undefined,
            rotationDeg: Number(entity.rotation ?? 0) || 0,
            width: Math.max(1, Math.abs(Number(entity.width ?? 0)) || 1),
            height: Math.max(1, Math.abs(Number(entity.height ?? 0)) || 1),
            alpha: legacyStyleNumber(style, 'alpha', 1),
            locked: entity.locked === true,
            ...tintBrightness,
        });
    }
    return pending;
}

export function findLegacyPlanArchiveAsset(
    assets: readonly LegacyPlanArchiveAsset[],
    textureFile: string | null | undefined,
): LegacyPlanArchiveAsset | null {
    const basename = normalizeTextureFile(textureFile);
    if (!basename) {
        return null;
    }
    const direct = assets.find(asset => {
        const path = String(asset.path ?? '').replace(/\\/gu, '/');
        return path === `assets/${basename}` || path.endsWith(`/${basename}`) || path === basename;
    });
    return direct ?? null;
}

export function createLegacyPlanImageFile(options: {
    pending: LegacyPlanPendingImage;
    assets: readonly LegacyPlanArchiveAsset[];
}): { file: File; source: 'archive' | 'textureData'; } | { unresolved: string; } {
    if (options.pending.textureFile) {
        const asset = findLegacyPlanArchiveAsset(options.assets, options.pending.textureFile);
        if (asset) {
            const mimeType = resolveNixieProjectImageMimeTypeFromFilename(options.pending.textureFile) || 'application/octet-stream';
            const copy = new Uint8Array(asset.bytes);
            return {
                file: new File([copy], options.pending.textureFile, { type: mimeType }),
                source: 'archive',
            };
        }
    }

    if (options.pending.textureData) {
        const decoded = decodeDataUrlOrBase64(options.pending.textureData);
        if (decoded) {
            const filename = options.pending.textureFile
                || options.pending.name
                || decoded.filename;
            return {
                file: new File([new Uint8Array(decoded.bytes)], filename, { type: decoded.mimeType }),
                source: 'textureData',
            };
        }
    }

    return {
        unresolved: options.pending.textureFile || `legacy-image-${options.pending.legacyId}`,
    };
}

export function createLegacyPlanImageSpriteSnapshot(options: {
    projectId: string;
    asset: Pick<NixieProjectAssetSummary, 'id' | 'displayName' | 'originalFilename' | 'mimeType' | 'width' | 'height'>;
    pending: LegacyPlanPendingImage;
}): BoardNodeSnapshot {
    const displayName = normalizeNixieProjectAssetDisplayName(
        options.pending.name || options.asset.displayName,
        options.asset.originalFilename,
    );
    const mimeType = normalizeNixieProjectAssetMimeType(options.asset.mimeType);
    const isSvg = isNixieProjectSvgImageMimeType(mimeType);

    return {
        id: `legacy-${options.pending.legacyId}`,
        type: NIXIE_URL_SPRITE_NODE_TYPE,
        key: displayName || options.pending.textureFile || 'Image',
        state: {
            x: options.pending.x,
            y: options.pending.y,
            z: options.pending.z,
            rotation: options.pending.rotationDeg * DEG_TO_RAD,
            visible: true,
            alpha: options.pending.alpha,
            scaleX: 1,
            scaleY: 1,
            locked: options.pending.locked,
            textureUrl: buildProjectAssetObjectUrl(
                options.projectId,
                options.asset.id,
                { format: isSvg ? 'svg' : null },
            ),
            projectAssetId: options.asset.id,
            // Legacy stores board display size on the entity.
            width: options.pending.width,
            height: options.pending.height,
            anchorX: 0.5,
            anchorY: 0.5,
            mediaType: mimeType === 'image/gif' ? 'gif' : 'image',
            ...(options.pending.tint != null ? { tint: options.pending.tint } : {}),
            ...(options.pending.brightness != null ? { brightness: options.pending.brightness } : {}),
        },
        children: [],
    };
}

/**
 * Resolve which pending images can be materialized from archive bytes / inline data.
 */
export function inspectLegacyPlanImageSources(
    pendingImages: readonly LegacyPlanPendingImage[],
    assets: readonly LegacyPlanArchiveAsset[],
): LegacyPlanImageMappingResult {
    const unresolvedTextureFiles: string[] = [];
    for (const pending of pendingImages) {
        const resolved = createLegacyPlanImageFile({ pending, assets });
        if ('unresolved' in resolved) {
            unresolvedTextureFiles.push(resolved.unresolved);
        }
    }
    return {
        pendingImages: [...pendingImages],
        unresolvedTextureFiles: [...new Set(unresolvedTextureFiles)].sort(),
    };
}
