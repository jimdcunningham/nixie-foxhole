/** Optional, geometry-derived shadow projection in FoxWatch's texture sidecar. */
export interface FoxholeContactShadowProjection {
    textureUrl: string;
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
    surfaceWidth: number;
    surfaceHeight: number;
    surfaceOffsetX: number;
    surfaceOffsetY: number;
}

const metadataLoads = new Map<string, Promise<FoxholeContactShadowProjection | null>>();

export function resolveFoxholeTextureSidecarUrl(textureUrl: string): string | null {
    return /\.texture(?:\.[a-z0-9_-]+)?\.webp(?:\?|$)/i.test(textureUrl)
        ? textureUrl.replace(/\.webp(?=\?|$)/i, '.json')
        : null;
}

export function resolveFoxholeContactShadowProjection(
    textureUrl: string,
    value: unknown,
): FoxholeContactShadowProjection | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const surface = value as Record<string, unknown>;
    const shadow = surface.contactShadow as Record<string, unknown> | undefined;
    if (!shadow || (shadow.profile !== 'topdown-contact-v1' && shadow.profile !== 'topdown-contact-v2')) {
        return null;
    }
    const file = String(shadow.file ?? '');
    // Sidecars can only reference a sibling image, never another host or path.
    if (!/^[a-z0-9_.-]+\.shadow\.webp$/i.test(file)) {
        return null;
    }
    const values = [shadow.width, shadow.height, shadow.offsetX, shadow.offsetY,
        surface.width, surface.height, surface.offsetX, surface.offsetY];
    if (!values.every(number => typeof number === 'number' && Number.isFinite(number))) {
        return null;
    }
    const [width, height, offsetX, offsetY, surfaceWidth, surfaceHeight, surfaceOffsetX, surfaceOffsetY] = values as number[];
    if (width <= 0 || height <= 0 || surfaceWidth <= 0 || surfaceHeight <= 0) {
        return null;
    }
    const path = textureUrl.replace(/[^/?]+(?=\?|$)/, file);
    return { textureUrl: path, width, height, offsetX, offsetY,
        surfaceWidth, surfaceHeight, surfaceOffsetX, surfaceOffsetY };
}

export function loadFoxholeContactShadowProjection(textureUrl: string): Promise<FoxholeContactShadowProjection | null> {
    const sidecarUrl = resolveFoxholeTextureSidecarUrl(textureUrl);
    if (!sidecarUrl) {
        return Promise.resolve(null);
    }
    const previous = metadataLoads.get(textureUrl);
    if (previous) {
        return previous;
    }
    const load = fetch(sidecarUrl)
        .then(async response => response.ok
            ? resolveFoxholeContactShadowProjection(textureUrl, await response.json())
            : null)
        .catch(() => null);
    metadataLoads.set(textureUrl, load);
    return load;
}

/** Return the shadow center relative to the existing surface sprite's origin. */
export function resolveFoxholeContactShadowCenter(
    projection: FoxholeContactShadowProjection,
    anchorX: number,
    anchorY: number,
): { x: number; y: number; } {
    return {
        x: projection.surfaceWidth * (0.5 - anchorX) + projection.offsetX - projection.surfaceOffsetX,
        y: projection.surfaceHeight * (0.5 - anchorY) + projection.offsetY - projection.surfaceOffsetY,
    };
}
