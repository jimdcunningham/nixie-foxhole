import type { NixieComponentEntitySnapshotV1, NixieExtensionRenderNodeV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { FoxholeSceneV2AssetMetadata, FoxholeSceneV2ModificationVariantMetadata } from './scene-v2-asset-metadata.ts';
import { FOXHOLE_STRUCTURE_RENDER_LANES, foxholeRenderLane } from './render-lanes.ts';

export const FOXHOLE_HITBOX_SETTING_ID = 'foxhole.debug.structure.hitboxes';

function validPoints(value: unknown): value is number[] {
    return Array.isArray(value) && value.length >= 6 && value.length <= 4096 && value.length % 2 === 0
        && value.every(number => typeof number === 'number' && Number.isFinite(number) && Math.abs(number) <= 1_000_000);
}

export function resolveFoxholeDefaultHitboxPolygons(asset: FoxholeSceneV2AssetMetadata, variants: readonly FoxholeSceneV2ModificationVariantMetadata[]): number[][] {
    const variantPolygons = variants.find(variant => (variant.lineOfSightPolygons ?? []).some(polygon => validPoints(polygon.shape)))?.lineOfSightPolygons;
    return (variantPolygons ?? asset.lineOfSightPolygons ?? []).flatMap(polygon =>
        validPoints(polygon.shape) ? [polygon.shape.map(point => point * 32)] : []);
}

/** Match Scene V1: authored children supersede modification and base extracted polygons. */
export function renderFoxholeHitboxOverlays(subject: NixieComponentEntitySnapshotV1,
    asset: FoxholeSceneV2AssetMetadata, variants: FoxholeSceneV2ModificationVariantMetadata[],
    entities: readonly NixieComponentEntitySnapshotV1[], settings: Readonly<Record<string, boolean>>): NixieExtensionRenderNodeV1[] {
    if (settings[FOXHOLE_HITBOX_SETTING_ID] !== true) return [];
    const authored = entities.flatMap(child => {
        const hierarchy = child.components.find(c => c.ownerId === 'nixie.core' && c.componentId === 'hierarchy' && c.definitionAvailable);
        const hitbox = child.components.find(c => c.ownerId === 'nixie.core' && c.componentId === 'hitbox' && c.definitionAvailable);
        if (hierarchy?.data.parentId !== subject.entityId || !hitbox || !validPoints(hitbox.data.points)) return [];
        const hasBasis = typeof hitbox.data.basisWidth === 'number' && hitbox.data.basisWidth > 0
            && typeof hitbox.data.basisHeight === 'number' && hitbox.data.basisHeight > 0;
        const width = hasBasis ? hitbox.data.basisWidth as number : asset.width;
        const height = hasBasis ? hitbox.data.basisHeight as number : asset.height;
        const sx = width > 0 ? asset.width / width : 1, sy = height > 0 ? asset.height / height : 1;
        return [hitbox.data.points.map((point, i) => point * (i % 2 ? sy : sx))];
    });
    const polygons = authored.length ? authored : resolveFoxholeDefaultHitboxPolygons(asset, variants);
    const children: NixieExtensionRenderNodeV1[] = polygons.slice(0, 128).map((points, index) => ({
        id: `structure-hitbox-${index}`, kind: 'graphics', commands: [
            { op: 'polygon', points: Array.from({ length: points.length / 2 }, (_, i) => ({ x: points[i * 2]!, y: points[i * 2 + 1]! })), close: true },
            { op: 'fill', color: 0xf59e0b, alpha: 0.16 }, { op: 'stroke', color: 0xf59e0b, alpha: 0.9, width: 2 },
        ],
    }));
    return children.length ? [{ id: 'structure-hitboxes', kind: 'group', ...foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug),
        presentation: { contractVersion: 1, excludeFromBounds: true }, children }] : [];
}
