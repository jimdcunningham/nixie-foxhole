/** Keep native marker order independent of object insertion order. */
export function resolveIntervalMarkerVariantIds(layerIds: Iterable<string>, tankStop: boolean): string[] {
    const available = new Set(layerIds);
    if (!tankStop) {
        return ['span', 'spanalt'].filter(id => available.has(id));
    }
    return [...available].flatMap(id => {
        if (id === 'span') return [{ id, index: 0 }];
        if (id === 'spanalt') return [{ id, index: 1 }];
        const match = /^spanalt([0-9]+)$/u.exec(id);
        const index = match ? Number(match[1]) : NaN;
        return Number.isSafeInteger(index) && index >= 2 ? [{ id, index }] : [];
    }).sort((a, b) => a.index - b.index).map(row => row.id);
}
