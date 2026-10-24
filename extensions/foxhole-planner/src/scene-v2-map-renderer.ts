import type { NixieExperimentalDocumentRenderRequestV1, NixieExperimentalDocumentRenderResultV1, NixieExtensionRenderNodeV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import maps from '#foxhole-scene-v2-maps';
import { foxholeSceneV2MapBounds, FOXHOLE_MAP_TEXTURE_DIRECTORIES } from './scene-v2-map-metadata.ts';
import { renderFoxholePlanningMapIcons } from './scene-v2-map-icons.ts';

export function renderFoxholePlanningMap(request: NixieExperimentalDocumentRenderRequestV1): NixieExperimentalDocumentRenderResultV1 {
    const settings = request.settings;
    const enabled = (key: string, fallback = false) => typeof settings[`foxhole.map.${key}`] === 'boolean' ? settings[`foxhole.map.${key}`] === true : fallback;
    const root: NixieExtensionRenderNodeV1 = { id: 'planning-map', kind: 'group', children: [] };
    if (!enabled('enabled')) {
        return { contractVersion: 1, plan: { schemaVersion: 1, root } };
    }
    const regionKeys = String(settings['foxhole.map.regionKeys'] ?? '').split(',').map(value => value.trim()).filter(Boolean);
    const regions = maps.regions.filter(region => !regionKeys.length || regionKeys.includes(region.key));
    const bounds = foxholeSceneV2MapBounds(maps, regionKeys, enabled('background', true));
    if (enabled('background', true)) {
        root.children.push({ id: 'world-background', kind: 'sprite', resourceId: enabled('darkBackground', true) ? maps.background.dark : maps.background.light,
            width: maps.worldSize.width, height: maps.worldSize.height, anchorX: 0.5, anchorY: 0.5 });
    }
    const scale = request.viewport.renderScale;
    const labelScale = Math.min(scale, 200) * 0.7;
    const regionScale = Math.min(scale, 240) * 0.85;
    const majorAlpha = scale < 125 ? 1 : 1 - (scale - 125) / 15;
    const text = (id: string, value: string, x: number, y: number, size: number, textScale: number, alpha: number): NixieExtensionRenderNodeV1 => ({
        id, kind: 'text', text: value, x, y, anchorX: 0.5, anchorY: 0.5, scaleX: textScale, scaleY: textScale, alpha: Math.max(0, Math.min(1, alpha)),
        style: { fontFamily: 'Jost', fontSize: size, fill: 0xffffff, experimentalStroke: { contractVersion: 1, color: 0x505050, width: 4 } },
    });
    for (const region of regions) {
        const base = enabled('base_map') ? 'base' : enabled('colors') ? 'topo' : enabled('base_map_full') ? 'full' : 'terrain';
        const prefix = region.textureKey.toLowerCase();
        const children: NixieExtensionRenderNodeV1[] = [{ id: `terrain-${prefix}`, kind: 'sprite', resourceId: region.textures[base],
            width: maps.regionWidth, height: maps.regionHeight, anchorX: 0.5, anchorY: 0.5 }];
        for (const layer of Object.keys(FOXHOLE_MAP_TEXTURE_DIRECTORIES).slice(4) as Array<keyof typeof FOXHOLE_MAP_TEXTURE_DIRECTORIES>) {
            const setting = ({ roadsTiers: 'roads_tiers', darkRdz: 'dark_rdz', railBridge: 'rail_bridge', underwaterRocks: 'underwater_rocks_stripes' } as Record<string, string>)[layer] ?? layer;
            if (enabled(setting)) {
                children.push({ id: `${layer}-${prefix}`, kind: 'sprite', resourceId: region.textures[layer], width: maps.regionWidth, height: maps.regionHeight, anchorX: 0.5, anchorY: 0.5 });
            }
        }
        root.children.push({ id: `region-${region.textureKey.toLowerCase()}`, kind: 'group', x: region.x, y: region.y, children });
    }
    const regionLabels: NixieExtensionRenderNodeV1[] = [], majorLabels: NixieExtensionRenderNodeV1[] = [], minorLabels: NixieExtensionRenderNodeV1[] = [];
    // Native icon, district, town and region-name layers have a fixed order above terrain/borders.
    for (const region of regions) {
        const id = region.textureKey.toLowerCase();
        if (enabled('borders', true)) {
            root.children.push({ id: `border-${id}`, kind: 'graphics', x: region.x, y: region.y,
                commands: [{ op: 'polygon', points: [{ x: -maps.regionWidth / 2, y: 0 }, { x: -maps.regionWidth / 4, y: -maps.regionHeight / 2 },
                    { x: maps.regionWidth / 4, y: -maps.regionHeight / 2 }, { x: maps.regionWidth / 2, y: 0 },
                    { x: maps.regionWidth / 4, y: maps.regionHeight / 2 }, { x: -maps.regionWidth / 4, y: maps.regionHeight / 2 }] },
                { op: 'stroke', color: 0x000000, width: 2 * scale }] });
        }
        if (enabled('names', true)) {
            regionLabels.push(text(`name-${id}`, region.name, region.x, region.y, 40, regionScale, Math.max(0.35, (1 - majorAlpha) / 2)));
        }
        if (scale < 350) {
            for (const [index, label] of region.labels.entries()) {
                const major = label.mapMarkerType === 'Major';
                if (!enabled(major ? 'majorLabels' : 'minorLabels', true)) {
                    continue;
                }
                const alpha = major ? Math.max(0.15, majorAlpha) : Math.min(0.35, scale < 75 ? 1 : 1 - (scale - 75) / 15);
                (major ? majorLabels : minorLabels).push(text(`label-${id}-${index}`, String(label.text ?? ''), region.x - maps.regionWidth / 2 + Number(label.x ?? 0) * maps.regionWidth,
                    region.y - maps.regionHeight / 2 + Number(label.y ?? 0) * maps.regionHeight, major ? 32 : 26, labelScale, alpha));
            }
        }
    }
    root.children.push(...renderFoxholePlanningMapIcons(maps, regions, settings, scale), ...minorLabels, ...majorLabels, ...regionLabels);
    const number = (key: string) => Number(settings[`foxhole.map.crop.${key}`] ?? 0);
    const clip = enabled('crop.enabled') && number('width') > 0 && number('height') > 0
        ? { minX: number('x'), minY: number('y'), maxX: number('x') + number('width'), maxY: number('y') + number('height') }
        : undefined;
    return { contractVersion: 1, plan: { schemaVersion: 1, root }, worldBounds: bounds, ...(clip ? { clip } : {}) };
}
