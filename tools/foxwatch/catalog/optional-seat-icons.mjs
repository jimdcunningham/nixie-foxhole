/** Optional mount-role artwork is not an asset's required default icon. */
export async function omitUnavailableSeatIcons(manifest, available) {
    const missing = new Set();
    for (const asset of manifest.assets ?? []) for (const seat of asset.vehicleSeats ?? []) {
        const url = seat.mc?.iconUrl;
        if (typeof url === 'string' && !await available(url)) {
            missing.add(url);
            delete seat.mc.iconUrl;
        }
    }
    return [...missing].sort();
}
