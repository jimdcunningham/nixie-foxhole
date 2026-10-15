export function resolveFoxholeLocalizedText(
    strings: Record<string, string>,
    localizationId: string | null | undefined,
    fallback: string | null | undefined,
): string {
    const key = String(localizationId ?? '').trim();
    if (key && typeof strings[key] === 'string') {
        const localizedValue = strings[key].trim();
        if (localizedValue) {
            return localizedValue;
        }
    }

    return String(fallback ?? '').trim();
}
