export const FOXHOLE_COMPLETE_CATALOG_SETTINGS: Record<string, boolean | string> = { 'foxhole.assets.filter.tier': '3', 'foxhole.assets.filter.showPreviousTiers': true,
    'foxhole.assets.filter.upgrades': true, 'foxhole.assets.filter.destroyed': true, 'foxhole.assets.filter.breached': true,
    'foxhole.assets.filter.3dReady': false, 'foxhole.assets.filter.faction': 'all',
    ...Object.fromEntries(['bunkers', 'facilities', 'vehicles', 'world', 'items'].map(kind => [`foxhole.assets.filter.category.${kind}`, true])) };
