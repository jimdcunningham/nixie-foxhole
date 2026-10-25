/** Expand compact source conventions once, against real published files. */
export async function materializePublishedRoleAssociations(manifest, available) {
    for (const [id, modification] of Object.entries(manifest.shared?.modifications ?? {})) {
        if (!modification || typeof modification !== 'object' || Array.isArray(modification)) continue;
        const pathId = id.replace(/(-[a-f0-9]{12})-\d+$/, '$1');
        const root = '/foxhole/assets/shared/modifications/' + pathId + '/' + pathId;
        const icons = {...modification.icons};
        if (!icons.default && await available(root + '.icon.default.webp')) icons.default = root + '.icon.default.webp';
        if (!icons.rendered && await available(root + '.icon.rendered.webp')) icons.rendered = root + '.icon.rendered.webp';
        modification.icons = icons;
    }
    for (const asset of manifest.assets ?? []) {
        const icon = asset.icons?.default;
        if (typeof icon !== 'string' || !icon.endsWith('.icon.default.webp')) continue;
        const root = icon.slice(0, -'.icon.default.webp'.length);
        for (const role of ['destroyed','packaged']) {
            const node = asset[role];
            if (!node || typeof node !== 'object' || Array.isArray(node)) continue;
            if (!node.sprite?.source && !node.textureUrl && await available(root + '.' + role + '.texture.webp')) {
                node.sprite = {...node.sprite, source:root + '.' + role + '.texture.webp'};
            }
        }
    }
    return manifest;
}
