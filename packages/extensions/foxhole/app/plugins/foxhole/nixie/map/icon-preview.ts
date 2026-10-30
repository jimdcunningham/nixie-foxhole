/** Public markers identify tiers, but not a particular Safe House or Relic Base. */
export function resolveFoxholeMapIconPreviewAsset(iconType: string | number, fallback: string | null, flags = 0, residentAsset: string | null = null): string | null {
    const type = Number(iconType);
    if (type >= 56 && type <= 58) return `${flags & 0x04 ? 'destroyed' : ''}townbase${type - 55}`;
    if (type === 35) return residentAsset && /^town.*garrison/i.test(residentAsset) ? residentAsset : null;
    if (type === 45) return residentAsset && /^(?:destroyed)?relicbase[123]$/.test(residentAsset) ? residentAsset : null;
    return fallback;
}
