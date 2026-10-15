import type { NixieExtensionRenderNodeV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { FoxholeSceneV2MapMetadata } from './scene-v2-map-metadata.ts';

type MapRegion = FoxholeSceneV2MapMetadata['regions'][number];
export function renderFoxholePlanningMapIcons(metadata: FoxholeSceneV2MapMetadata, regions: readonly MapRegion[],
    settings: Readonly<Record<string, boolean | number | string>>, renderScale: number): NixieExtensionRenderNodeV1[] {
    if (settings['foxhole.map.icons'] === false || renderScale >= 350) {
        return [];
    }
    const blacklist = new Set(String(settings['foxhole.map.iconBlacklist'] ?? '').split(',').map(value => value.trim()).filter(Boolean));
    const iconScale = Math.min(renderScale, 200) * 0.7;
    return regions.flatMap(region => region.staticIcons.flatMap((icon, index): NixieExtensionRenderNodeV1[] => {
        const key = String(icon.iconType);
        const definition = metadata.icons[key];
        if (!definition?.resourceId || blacklist.has(key) || settings[`foxhole.map.iconCategories.${definition.category}`] === false) {
            return [];
        }
        const team = icon.teamId === 'COLONIALS' ? 0x516C4B : icon.teamId === 'WARDENS' ? 0x245682 : null;
        const tint = ((icon.flags ?? 0) & 0x10) !== 0
            ? 0x9a4e52
            : team
                ?? (settings['foxhole.map.coloredIcons'] === true && definition.color !== null ? definition.color : 0xffffff);
        const id = `map-icon-${region.textureKey.toLowerCase()}-${index}`;
        const faction = icon.teamId === 'COLONIALS' ? 'Colonials' : icon.teamId === 'WARDENS' ? 'Wardens' : '';
        const detail = [faction, ((icon.flags ?? 0) & 0x10) !== 0 ? 'Scorched' : ''].filter(Boolean).join(' · ');
        const detailColor = icon.teamId === 'COLONIALS' ? 0x9ACB76 : icon.teamId === 'WARDENS' ? 0x7BB8EC : undefined;
        const children: NixieExtensionRenderNodeV1[] = [];
        if (icon.flags && icon.teamId && (icon.flags & 0x01) !== 0) {
            children.push({ id: `${id}-team`, kind: 'graphics', alpha: 0.35,
                commands: [{ op: 'circle', x: 0, y: 0, radius: 30 }, { op: 'fill', color: team ?? 0x9fa29f }, { op: 'stroke', color: 0x080808, width: 2 }] });
        }
        // Native strategic icons use their decoded natural texture dimensions.
        children.push({ id: `${id}-image`, kind: 'sprite', resourceId: definition.resourceId, anchorX: 0.5, anchorY: 0.5, tint });
        return [{ id, kind: 'group', x: region.x - metadata.regionWidth / 2 + icon.x * metadata.regionWidth,
            y: region.y - metadata.regionHeight / 2 + icon.y * metadata.regionHeight, scaleX: iconScale, scaleY: iconScale,
            experimentalPresentation: { contractVersion: 1, tooltip: { contractVersion: 1, title: definition.name, category: definition.tooltipCategory,
                iconResourceId: definition.resourceId, ...(definition.previewResourceId ? { previewResourceId: definition.previewResourceId, previewOnShift: true } : {}),
                ...(detail ? { detail } : {}), ...(detailColor === undefined ? {} : { detailColor }) } }, children }];
    }));
}
