export type FoxholeFaction = 'c' | 'w' | null;

export function normalizeFoxholeFaction(value: unknown): FoxholeFaction {
    if (value === 'c' || value === 'w') {
        return value;
    }

    return null;
}
