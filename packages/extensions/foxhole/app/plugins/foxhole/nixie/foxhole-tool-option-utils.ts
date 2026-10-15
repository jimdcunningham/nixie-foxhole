/** Keep property edits sparse; omitted fields must not reset to defaults. */
export function pickProvidedOptionFields<TPatch extends object>(options: object, normalized: TPatch): Partial<TPatch> {
    return Object.fromEntries(Object.entries(normalized).filter(([key]) =>
        Object.prototype.hasOwnProperty.call(options, key))) as Partial<TPatch>;
}

export function readEnumOption<TValue extends string>(value: unknown, allowed: readonly TValue[], fallback: TValue): TValue {
    return allowed.includes(value as TValue) ? value as TValue : fallback;
}

export function readNumberOption(value: unknown, fallback: number, minimum = Number.NEGATIVE_INFINITY, maximum = Number.POSITIVE_INFINITY): number {
    const parsed = Number(value);
    return Math.min(maximum, Math.max(minimum, Number.isFinite(parsed) ? parsed : fallback));
}

export function readBooleanOption(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

export function readColorOption(value: unknown, fallback: number): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.min(0xFFFFFF, Math.round(value)));
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value.trim().replace(/^#/, ''), 16);
        if (Number.isFinite(parsed)) {
            return Math.max(0, Math.min(0xFFFFFF, parsed));
        }
    }
    return fallback;
}
