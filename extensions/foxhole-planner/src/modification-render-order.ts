import {
    FOXHOLE_MODIFICATION_VARIANT_LAYER_RULES,
    FOXHOLE_MODIFICATION_VARIANT_RENDER_PRIORITY,
    FOXHOLE_MODIFICATION_VARIANT_RENDER_PRIORITY_DEFAULT,

} from './render-lanes.ts';
import type { FoxholeModificationTextureLayer } from './render-lanes.ts';

export type {
    FoxholeModificationTextureLayer,
} from './render-lanes.ts';

export interface FoxholeModificationRenderOrderSelection {
    slot: { id: string; name: string; x?: number | null; y?: number | null; z?: number | null; };
    variant: { id: string; };
}

export interface FoxholeModificationTextureLayerOptions {
    profileType?: string | null;
    useStructureRenderLayers?: boolean;
}

const TEXTURE_LAYER_ORDER = new Map<FoxholeModificationTextureLayer, number>([
    ['lower', 0],
    ['base', 1],
    ['roof', 2],
    ['upper', 3],
    ['trenchDefense', 4],
]);

function normalizeVariantId(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

export function isFoxholeRoofModification(variant: { id?: string; }): boolean {
    const id = normalizeVariantId(variant.id);
    return id === 'ladder' || id === 'trenchroof';
}

function normalizeProfileType(value: unknown): string {
    return String(value ?? '').trim().toLowerCase();
}

function resolveDeclaredModificationTextureLayer(
    profileType: string,
    variantId: string,
): FoxholeModificationTextureLayer | null {
    for (const rule of FOXHOLE_MODIFICATION_VARIANT_LAYER_RULES) {
        if ('profileType' in rule && rule.profileType && normalizeProfileType(rule.profileType) !== profileType) {
            continue;
        }

        if (rule.variantIds.some(candidate => normalizeVariantId(candidate) === variantId)) {
            return rule.layer;
        }
    }

    return null;
}

function resolveFallbackModificationTextureLayer(slotZ: number): FoxholeModificationTextureLayer {
    return Number.isFinite(slotZ) && slotZ <= -80 ? 'lower' : 'upper';
}

export function resolveFoxholeModificationRenderPriority(variantId: string): number {
    const normalizedVariantId = normalizeVariantId(variantId);
    return FOXHOLE_MODIFICATION_VARIANT_RENDER_PRIORITY[normalizedVariantId]
        ?? FOXHOLE_MODIFICATION_VARIANT_RENDER_PRIORITY_DEFAULT;
}

export function resolveFoxholeModificationTextureLayer(
    slot: { z?: number | null; componentType?: string; },
    variant: { id: string; },
    options: FoxholeModificationTextureLayerOptions = {},
): FoxholeModificationTextureLayer {
    const variantId = normalizeVariantId(variant.id);
    const profileType = normalizeProfileType(options.profileType);
    const declaredLayer = resolveDeclaredModificationTextureLayer(profileType, variantId);
    if (declaredLayer === 'trenchDefense') {
        return declaredLayer;
    }
    if (options.useStructureRenderLayers === false) {
        return 'base';
    }

    if (variantId === 'ladder') return 'roof';
    if (slot.componentType === 'BPFortInfraModSlot_C') return 'base';
    // Fort stairs climb onto the bunker roof; trench-end stairs stay below it.
    if (variantId === 'stairs' && slot.componentType === 'BPFortStairsModSlot_C') return 'upper';
    if (declaredLayer) {
        return declaredLayer;
    }

    return resolveFallbackModificationTextureLayer(Number(slot.z ?? NaN));
}

export function compareFoxholeModificationRenderOrder(
    left: FoxholeModificationRenderOrderSelection,
    right: FoxholeModificationRenderOrderSelection,
    options: FoxholeModificationTextureLayerOptions = {},
): number {
    const leftLayer = resolveFoxholeModificationTextureLayer(left.slot, left.variant, options);
    const rightLayer = resolveFoxholeModificationTextureLayer(right.slot, right.variant, options);
    const leftOrder = TEXTURE_LAYER_ORDER.get(leftLayer) ?? 0;
    const rightOrder = TEXTURE_LAYER_ORDER.get(rightLayer) ?? 0;
    if (leftOrder !== rightOrder) {
        return leftOrder - rightOrder;
    }

    const leftPriority = resolveFoxholeModificationRenderPriority(String(left.variant.id ?? ''));
    const rightPriority = resolveFoxholeModificationRenderPriority(String(right.variant.id ?? ''));
    if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
    }

    const leftZ = Number(left.slot.z ?? 0);
    const rightZ = Number(right.slot.z ?? 0);
    if (leftZ !== rightZ) {
        return leftZ - rightZ;
    }

    const leftY = Number(left.slot.y ?? 0);
    const rightY = Number(right.slot.y ?? 0);
    if (leftY !== rightY) {
        return leftY - rightY;
    }

    const leftX = Number(left.slot.x ?? 0);
    const rightX = Number(right.slot.x ?? 0);
    if (leftX !== rightX) {
        return leftX - rightX;
    }

    return String(left.variant.id ?? '').localeCompare(String(right.variant.id ?? ''));
}
