const clean = name => (name ?? '').replace(/(?:\.\d{3})+$/, '').toLowerCase();
const tankStopMeshes = ['TankStopT3_1', 'TankStopT3_2', 'TankStopT3_3', 'TankStopT3_4'];
const mineMeshes = {
    minespline: ['CraterS'],
    infantryminespline: ['InfantryMinePickup', 'CraterS'],
    tankminespline: ['AntiTankMinePickup', 'CraterS'],
    waterminespline: ['Seamines', 'Bouy01'],
    surfacewaterminespline: ['SmallSeaMine'],
};
const sandbagMeshes = {
    sandbaghalfspline: ['SandbagSpline01', 'SandbagSpline02', 'SandbagSpline03', 'SandbagSpline04'],
    sandbagfullspline: ['SandbagFullSpline01', 'SandbagFullSpline02', 'SandbagFullSpline03', 'SandbagFullSpline04'],
};

/** Use the same X-forward prototype as the planar render for a standalone authored spline. */
export function orientSpatialStandaloneSpline(input, span, id) {
    const visibleMeshIds = document => {
        const ids = [];
        const visit = node => {
            if (node.visible === false) return;
            if (node.meshId) ids.push(node.meshId);
            (node.children ?? []).forEach(visit);
        };
        document.scene.roots.forEach(visit);
        return ids;
    };
    const meshes = visibleMeshIds(input);
    const spanMeshes = visibleMeshIds(span);
    if (meshes.length !== 1 || spanMeshes.length !== 1 || meshes[0] !== spanMeshes[0] || span.render?.repeatAxis !== 'x') {
        throw new Error(`The authored spatial spline span does not match the standalone mesh for ${id}.`);
    }
    return { ...input, scene: span.scene, assets: span.assets };
}

/** Resolve authored roles against actual exported mesh indices, never assumed Blender order. */
export function spatialConnectorProfile(id, document, exported, scene) {
    const meshes = document.meshes ?? [];
    const part = (names, occurrence = 0, required = true) => {
        const candidates = meshes.map((mesh, index) => ({ mesh, index })).filter(({ mesh }) => names.some(name => clean(mesh.name) === name.toLowerCase()));
        const found = candidates[occurrence];
        if (!found) { if (!required) return undefined; throw new Error(`Missing spatial ${id} mesh role: ${names.join('/')}`); }
        const node = document.nodes.find(node => node.mesh === found.index);
        const origin = exported.meshParts?.find(part => part.name === node?.name)?.origin;
        if (!origin?.every(Number.isFinite) || origin.length !== 3) throw new Error(`Missing spatial ${id} origin: ${node?.name}`);
        return { meshIndex: found.index, origin };
    };
    const profile = { version: 1, parts: {} };
    if (id === 'facilitypipeoverhead') {
        profile.parts.span = part(['PipelineoverheadConnect', 'PipelineoverheadConnectInsulated']);
        profile.parts.start = part(['Pipelineoverhead', 'PipelineoverheadInsulated']);
        profile.parts.end = part(['Pipelineoverhead', 'PipelineoverheadInsulated'], 1);
        const nodes = [];
        const visit = node => { nodes.push(node); (node.children ?? []).forEach(visit); };
        scene.scene.roots.forEach(visit);
        const endpoint = nodes.find(node => node.name === 'FrontSocket')?.unrealLocationCentimeters;
        if (!endpoint || !(endpoint[0] > 0)) throw new Error('Missing overhead endpoint reference');
        profile.endOrigin = [endpoint[0] * .32, -endpoint[1] * .32, endpoint[2] * .32];
    } else if (id === 'facilityroad') {
        profile.parts.span = part(['FacilityRoad_Test']);
    } else if (/^(?:small)?railtrackspline(?:biarc|foundation|town)?$/.test(id)) {
        const small = id.startsWith('small');
        profile.parts.rail = part([small ? 'SmallGaugeTrack_Rail' : 'Railway_Rail']);
        profile.parts.sleeper = part([small ? 'SmallGaugeTrack_Tie' : 'Railway_Tie']);
        const railSwitch = part(['SK_RailTrackSwitch'], 0, false);
        if (railSwitch) profile.parts.switch = railSwitch;
        const bed = part([small ? 'SmallGaugeTrack_Trackbed01' : 'Railway_Trackbed_01'], 0, false);
        if (bed) profile.parts.bed = bed;
    } else if (id === 'barbedwirespline') {
        profile.parts.coil = part(['BarbedWireSpline_100']);
        profile.parts.post = part(['BarbedWirePillar']);
    } else if (id === 'barbedwirewallspline') {
        profile.parts.wire = part(['BarbedWireFence02']);
        profile.parts.startWire = part(['BarbedWireFence01']);
        profile.parts.endWire = part(['BarbedWireFence03']);
        profile.parts.post = part(['BarbedWireFencePillar03']);
        profile.parts.middle = part(['BarbedWireFencePillar01']);
    } else if (id === 'trenchconnectorbuildsite') {
        const caps = [part(['TrenchBuildsite02Side01']), part(['TrenchBuildsite02Side01'], 1)]
            .sort((a, b) => a.origin[0] - b.origin[0]);
        const ropes = [part(['TrenchBuildsite02SideRope01']), part(['TrenchBuildsite02SideRope01'], 1)]
            .sort((a, b) => a.origin[1] - b.origin[1]);
        [profile.parts.start, profile.parts.end] = caps;
        [profile.parts.leftRope, profile.parts.rightRope] = ropes;
    } else if (id === 'tankstopsplinet3' || Object.hasOwn(mineMeshes, id)) {
        const markers = id === 'tankstopsplinet3' ? tankStopMeshes : mineMeshes[id];
        markers.forEach((name, index) => {
            profile.parts[`marker${index + 1}`] = part([name]);
        });
    } else if (Object.hasOwn(sandbagMeshes, id)) {
        sandbagMeshes[id].forEach((name, index) => {
            profile.parts[`marker${index + 1}`] = part([name]);
        });
        if (id === 'sandbagfullspline') profile.parts.start = part(['SandbagSpline01']);
    } else return undefined;
    return profile;
}

/** Keep the interior fence-post prototype available even in the minimum-length source scene. */
export function prepareSpatialConnectorScene(id, input) {
    const scene = structuredClone(input);
    const normalize = node => {
        // Render-bundle spans were stretched for a sample length. Profiles repeat
        // their original axial geometry, keeping cross-section and texture density.
        if (/^(?:PipelineoverheadConnect(?:Insulated)?|(?:SmallGaugeTrack|Railway)_(?:Rail|Trackbed.*)|BarbedWireFence02)$/i.test(node.name ?? '')
            && node.id?.includes(':spline-mesh-') && node.scale) node.scale[0] = 1;
        (node.children ?? []).forEach(normalize);
    };
    if (id === 'facilityroad') {
        const meshes = new Set(scene.assets.meshes.filter(mesh => /(?:^|[\\/])FacilityRoadEnd\.glb$/iu.test(mesh.sourcePath)).map(mesh => mesh.id));
        const dropCaps = nodes => nodes.filter(node => !meshes.has(node.meshId)).map(node => ({
            ...node, children: dropCaps(node.children ?? []),
        }));
        scene.scene.roots = dropCaps(scene.scene.roots);
        scene.assets.meshes = scene.assets.meshes.filter(mesh => !meshes.has(mesh.id));
    }
    scene.scene.roots.forEach(normalize);
    if (id === 'tankstopsplinet3') {
        const existing = new Set();
        const visit = node => {
            if (node.meshId && node.visible !== false) existing.add(clean(node.name));
            (node.children ?? []).forEach(visit);
        };
        scene.scene.roots.forEach(visit);
        for (const [index, name] of tankStopMeshes.entries()) {
            if (existing.has(clean(name))) continue;
            const meshId = `spatial-tank-stop-${index + 1}`;
            const sourcePath = `War/Content/Meshes/Pickups/${name}.glb`;
            scene.assets.meshes.push({ id: meshId, sourcePath, exportUrl: sourcePath });
            scene.scene.roots.push({ id: `${id}:${meshId}`, name, visible: true, meshId, children: [],
                unrealLocationCentimeters: [375 * index, 0, 0], unrealRotationDegrees: [0, 0, 0], scale: [1, 1, 1] });
        }
    }
    if (id !== 'barbedwirewallspline') return scene;
    const sourcePath = 'War/Content/Meshes/Environment/Splines/BarbedWireFencePillar01.glb';
    const meshId = 'spatial-fence-middle';
    scene.assets.meshes.push({ id: meshId, sourcePath, exportUrl: sourcePath });
    scene.scene.roots.push({ id: `${id}:spatial-middle-prototype`, name: 'SpatialMiddlePost', visible: true,
        meshId, children: [], unrealLocationCentimeters: [0,0,0], unrealRotationDegrees: [0,0,0], scale: [1,1,1] });
    return scene;
}
