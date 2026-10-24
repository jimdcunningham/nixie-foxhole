/** Private exported blueprint metadata belongs to the product, not the host renderer. */
export function readFoxholeModelLightHints(document: unknown): Map<string, { shadows: boolean; poweredIntensity?: number }> {
    const object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : undefined;
    const nodes = object(document)?.nodes;
    const hints = new Map<string, { shadows: boolean; poweredIntensity?: number }>();
    for (const node of Array.isArray(nodes) ? nodes : []) {
        const row = object(node);
        const hint = object(object(row?.extras)?.nixieBlueprintLight);
        if (!hint || typeof row?.name !== 'string' || !row.name) continue;
        const value: { shadows: boolean; poweredIntensity?: number } = { shadows: object(hint.source)?.castShadows === true };
        // Only this exported lamp identity may recover intensity from an authored-off source.
        if (hint.sourceName === 'FortSpotLight:Light' && typeof hint.candela === 'number'
            && Number.isFinite(hint.candela) && hint.candela > 0 && hint.candela <= 1e12) value.poweredIntensity = hint.candela;
        hints.set(row.name, value);
    }
    return hints;
}
