import {materializePublishedRoleAssociations} from './materialize-role-associations.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/** Validate real published output; model presence never implies a rendered icon. */
export function publishedRenderedIconValidator(assetsRoot) {
    const pending = new Map();
    return url => {
        if (typeof url !== 'string' || !url.startsWith('/foxhole/assets/')) return Promise.resolve(false);
        if (!pending.has(url)) pending.set(url, (async () => {
            const relative = url.slice('/foxhole/assets/'.length);
            if (!/^[A-Za-z0-9_./-]+\.webp$/.test(relative) || relative.split('/').some(part => part === '.' || part === '..')) return false;
            try {
                const root = await fs.realpath(assetsRoot), actual = await fs.realpath(path.join(root, relative));
                const local = path.relative(root, actual);
                if (path.isAbsolute(local) || local === '..' || local.startsWith('..' + path.sep)) return false;
                const stats = await sharp(await fs.readFile(actual)).stats();
                return !stats.channels[3] || stats.channels[3].max > 0;
            } catch { return false; }
        })());
        return pending.get(url);
    };
}

/** Preview remains a presentation field and aliases the final composited icon. */
export async function normalizeRenderedIconAssociations(manifest, available) {
    async function visit(value) {
        if (Array.isArray(value)) {
            const result = [];
            for (const row of value) result.push(await visit(row));
            return result;
        }
        if (!value || typeof value !== 'object') return value;
        const next = {};
        for (const [key, row] of Object.entries(value)) next[key] = await visit(row);
        const icons = value.icons && !Array.isArray(value.icons) && typeof value.icons === 'object' ? value.icons : null;
        if (!icons && !Object.hasOwn(value, 'previewUrl') && !Object.hasOwn(value, 'renderedIconUrl') && !Object.hasOwn(value, 'previewIconUrl')) return next;
        const defaultIcon = icons?.default ?? value.iconUrl;
        const infer = (url, pattern) => typeof url === 'string' && pattern.test(url) ? url.replace(pattern, '.icon.rendered') : null;
        const candidates = [icons?.rendered, value.renderedIconUrl, value.previewIconUrl, value.colors?.[0]?.renderedIconUrl,
            infer(defaultIcon, /\.icon\.default(?=[.-])/i), infer(value.previewUrl, /\.preview(?=[.-])/i),
        ].filter(candidate => typeof candidate === 'string');
        let rendered;
        for (const candidate of new Set(candidates)) if (await available(candidate)) { rendered = candidate; break; }
        if (icons) {
            next.icons = {...next.icons};
            if (rendered) next.icons.rendered = rendered;
            else delete next.icons.rendered;
        }
        if (Object.hasOwn(value, 'renderedIconUrl')) next.renderedIconUrl = rendered;
        if (Object.hasOwn(value, 'previewIconUrl')) next.previewIconUrl = rendered;
        next.previewUrl = rendered ?? defaultIcon;
        return next;
    }
    return visit(await materializePublishedRoleAssociations(structuredClone(manifest), available));
}
