import { shallowRef } from 'vue';
import type { FoxholeManifestMarkedCargoOverlay } from './manifest.ts';
import {
    normalizeMarkedCargoOverlayOffset,

} from './marked-cargo-overlay.ts';
import type { MarkedCargoOverlayLocalOffset } from './marked-cargo-overlay.ts';

const devOverridesByFoxholeKey = shallowRef(new Map<string, FoxholeManifestMarkedCargoOverlay>());

function normalizeFoxholeKey(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase();
}

function isDevMarkedCargoOverlayEnabled(): boolean {
    return import.meta.dev;
}

export function getFoxholeMarkedCargoOverlayDevOverride(
    foxholeKey: string | null | undefined,
): FoxholeManifestMarkedCargoOverlay | null {
    if (!isDevMarkedCargoOverlayEnabled()) {
        return null;
    }

    const normalizedKey = normalizeFoxholeKey(foxholeKey);
    if (!normalizedKey) {
        return null;
    }

    return devOverridesByFoxholeKey.value.get(normalizedKey) ?? null;
}

export function setFoxholeMarkedCargoOverlayDevOverride(
    foxholeKey: string | null | undefined,
    patch: Partial<FoxholeManifestMarkedCargoOverlay> | null,
): void {
    if (!isDevMarkedCargoOverlayEnabled()) {
        return;
    }

    const normalizedKey = normalizeFoxholeKey(foxholeKey);
    if (!normalizedKey) {
        return;
    }

    const nextOverrides = new Map(devOverridesByFoxholeKey.value);

    if (!patch) {
        nextOverrides.delete(normalizedKey);
        devOverridesByFoxholeKey.value = nextOverrides;
        return;
    }

    const next = { ...(nextOverrides.get(normalizedKey) ?? {}) };

    if ('offsetX' in patch) {
        if (typeof patch.offsetX === 'number' && Number.isFinite(patch.offsetX)) {
            next.offsetX = patch.offsetX;
        } else {
            delete next.offsetX;
        }
    }

    if ('offsetY' in patch) {
        if (typeof patch.offsetY === 'number' && Number.isFinite(patch.offsetY)) {
            next.offsetY = patch.offsetY;
        } else {
            delete next.offsetY;
        }
    }

    if (Object.keys(next).length === 0) {
        nextOverrides.delete(normalizedKey);
    } else {
        nextOverrides.set(normalizedKey, next);
    }

    devOverridesByFoxholeKey.value = nextOverrides;
}

export function resolveFoxholeMarkedCargoOverlayLocalOffset(options: {
    foxholeKey: string | null | undefined;
    manifestOverlay?: FoxholeManifestMarkedCargoOverlay | null;
}): MarkedCargoOverlayLocalOffset {
    const manifestOffset = normalizeMarkedCargoOverlayOffset(options.manifestOverlay);
    const devOverride = getFoxholeMarkedCargoOverlayDevOverride(options.foxholeKey);

    return {
        x: typeof devOverride?.offsetX === 'number' ? devOverride.offsetX : manifestOffset.x,
        y: typeof devOverride?.offsetY === 'number' ? devOverride.offsetY : manifestOffset.y,
    };
}

export function useFoxholeMarkedCargoOverlayDevOverrides() {
    return {
        devOverridesByFoxholeKey,
        getFoxholeMarkedCargoOverlayDevOverride,
        setFoxholeMarkedCargoOverlayDevOverride,
        resolveFoxholeMarkedCargoOverlayLocalOffset,
    };
}
