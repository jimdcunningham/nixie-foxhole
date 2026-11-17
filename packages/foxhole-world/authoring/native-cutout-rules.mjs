function cutout(material, folder, albedo, mask, channel, cutoff, resizeMask = false) {
    const texture = name => `War/Content/Textures/${folder}/${name}.${name}`;
    return {
        material: `War/Content/Materials/Environment/Props/${material}.uasset`,
        albedo: texture(albedo),
        mask: `Textures/${folder}/${mask}.png`,
        source: texture(mask),
        channel,
        cutoff,
        resizeMask,
    };
}

// The pine Use Alpha branch samples Materiality blue, while StreetLamp's
// Props material samples the alpha channel of RoughnessUVTexture.
export const nativeCutoutRules = [
    cutout('BirchBushSnow', 'Foliage', 'BirchBushSnowA', 'BirchBushSnowM', 2, .333),
    cutout('BirchBushSmall', 'Foliage', 'BirchBushThinA', 'BirchBranchThinM', 2, .333),
    cutout('PineBranchDead', 'Props', 'PineBranchDeadA', 'PineBranchDeadM', 2, .333, true),
    cutout('PineBranch02Dead', 'Props', 'PineBranch02DeadA', 'PineBranch02DeadM', 2, .333, true),
    cutout('StreetLamp', 'Props', 'StreetlampA', 'StreetlampM', 3, .3333),
];
