function cutout(material, folder, albedo, mask, channel, cutoff, {
    resizeMask = false, materialFolder = 'Environment/Props', colorRamp,
} = {}) {
    const texture = name => `War/Content/Textures/${folder}/${name}.${name}`;
    return {
        material: `War/Content/Materials/${materialFolder}/${material}.uasset`,
        albedo: texture(albedo),
        mask: `Textures/${folder}/${mask}.png`,
        source: texture(mask),
        channel,
        cutoff,
        resizeMask,
        colorRamp,
    };
}

// The pine Use Alpha branch samples Materiality blue, while StreetLamp's
// Props material samples the alpha channel of RoughnessUVTexture.
export const nativeCutoutRules = [
    cutout('BirchBushSnow', 'Foliage', 'BirchBushSnowA', 'BirchBushSnowM', 2, .333),
    cutout('BirchBushSmall', 'Foliage', 'BirchBushThinA', 'BirchBranchThinM', 2, .333),
    cutout('PineBranchDead', 'Props', 'PineBranchDeadA', 'PineBranchDeadM', 2, .333, { resizeMask: true }),
    cutout('PineBranch02Dead', 'Props', 'PineBranch02DeadA', 'PineBranch02DeadM', 2, .333, { resizeMask: true }),
    cutout('StreetLamp', 'Props', 'StreetlampA', 'StreetlampM', 3, .3333),
    cutout('GrassBladesSnow', 'Environment', 'GrassA', 'GrassM', 2, .333, { materialFolder: 'Environment' }),
    cutout('Hay', 'Props', 'HayRepeating01A', 'HayRepeating01M', 3, .3333, { resizeMask: true }),
    cutout('Weathervein', 'Props', 'WeatherveinA', 'WeatherveinM', 3, .3333),
    // These GrassBlades instances use the atlas alpha and the authored leaf colors.
    cutout('IVy', 'Foliage', 'FoliageMap', 'FoliageMap', 3, .333, {
        materialFolder: 'Environment',
        colorRamp: [[.074786, .095, .0627], [.024675, .035, .027051]],
    }),
    cutout('IVy2', 'Foliage', 'FoliageMap', 'FoliageMap', 3, .333, {
        materialFolder: 'Environment',
        colorRamp: [[.053985, .06, .006246], [.13053, .135417, .007963]],
    }),
];
