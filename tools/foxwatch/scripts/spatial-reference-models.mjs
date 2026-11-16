const referenceMeshes = {
    // These base pickups have no static mesh assigned to their extracted scene.
    // Use the native crate and fuel-can meshes used by their physical counterparts.
    crate: 'War/Content/Meshes/ItemCrate.glb',
    flamebackpackammo: 'War/Content/Meshes/Weapons/FlameAmmo.glb',
    // BPShippable selects GlobalShippableInfo.NormalSizeConfig.Base at runtime.
    shippable: 'War/Content/Meshes/Shippables/ShippingContainerNormalExposed.glb',
};

const itemIconRoot = 'War/Content/Textures/UI/ItemIcons';
const referenceIcons = {
    excavation: `${itemIconRoot}/ShovelIcon.png`,
    prototypekit: `${itemIconRoot}/PrototypeKitIcon.png`,
    reservepower: `${itemIconRoot}/ReservePower.png`,
};
const oilDecalMask = 'War/Content/Textures/Decal/Decal512.png';

export function spatialReferencePackages(onlyIds) {
    const includes = id => onlyIds == null || onlyIds.includes(id);
    const packages = assets => Object.entries(assets).filter(([id]) => includes(id))
        .map(([, source]) => source.slice(0, -4));
    return {
        meshPackagePaths: packages({ ...referenceMeshes, tankstopsplinet3: 'War/Content/Meshes/Pickups/TankStopT3_3.glb' })
            .concat(includes('tankstopsplinet3') ? ['War/Content/Meshes/Pickups/TankStopT3_4'] : []),
        texturePackagePaths: packages({ ...referenceIcons, oilfield: oilDecalMask }),
    };
}

export function prepareSpatialReferenceScene(id, input) {
    const sourcePath = Object.hasOwn(referenceMeshes, id) ? referenceMeshes[id] : undefined;
    const icon = Object.hasOwn(referenceIcons, id) ? referenceIcons[id] : undefined;
    // Oil is an Unreal deferred ground decal. Use its blue opacity mask and the
    // main decal's 800 cm half-extents on a surface just above the scene floor.
    const primitive = id === 'oilfield'
        ? { type: 'spatial_reference_surface', texture: oilDecalMask, width: 16, z: 0.01, maskChannel: 2 }
        : icon && { type: 'spatial_reference_surface', texture: icon, width: 1, z: 0.08, plate: true };
    if (!sourcePath && !primitive) return input;
    const hasMesh = nodes => nodes.some(node => node.visible !== false
        && (node.meshId || node.primitive || hasMesh(node.children ?? [])));
    if (hasMesh(input.scene.roots)) return input;

    const scene = structuredClone(input);
    const meshId = `spatial-reference-${id}`;
    if (sourcePath) {
        scene.render = { ...scene.render, materialMode: 'sidecar' };
        scene.assets.meshes.push({ id: meshId, sourcePath, exportUrl: sourcePath,
            ...(id === 'crate' ? { materialSidecarNameOverride: 'War/Content/Materials/AmmoCrate' } : {}) });
    }
    scene.scene.roots.push({
        id: meshId, name: sourcePath ? sourcePath.split('/').at(-1).slice(0, -4) : id,
        ...(sourcePath ? { meshId } : { primitive }),
        visible: true, children: [],
        unrealLocationCentimeters: [0, 0, 0],
        unrealRotationDegrees: [0, 0, 0],
        scale: [1, 1, 1],
    });
    return scene;
}
