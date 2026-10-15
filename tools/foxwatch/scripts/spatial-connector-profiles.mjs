const clean = name => (name ?? '').replace(/(?:\.\d{3})+$/, '').toLowerCase();

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
    } else if (/^(?:small)?railtrackspline(?:biarc|foundation|town)?$/.test(id)) {
        const small = id.startsWith('small');
        profile.parts.rail = part([small ? 'SmallGaugeTrack_Rail' : 'Railway_Rail']);
        profile.parts.sleeper = part([small ? 'SmallGaugeTrack_Tie' : 'Railway_Tie']);
        const bed = part([small ? 'SmallGaugeTrack_Trackbed01' : 'Railway_Trackbed_01'], 0, false);
        if (bed) profile.parts.bed = bed;
    } else if (id === 'barbedwirespline') {
        profile.parts.coil = part(['BarbedWireSpline_100']);
        profile.parts.post = part(['BarbedWirePillar']);
    } else if (id === 'barbedwirewallspline') {
        profile.parts.wire = part(['BarbedWireFence02']);
        profile.parts.post = part(['BarbedWireFencePillar03']);
        profile.parts.middle = part(['BarbedWireFencePillar01']);
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
    scene.scene.roots.forEach(normalize);
    if (id !== 'barbedwirewallspline') return scene;
    const sourcePath = 'War/Content/Meshes/Environment/Splines/BarbedWireFencePillar01.glb';
    const meshId = 'spatial-fence-middle';
    scene.assets.meshes.push({ id: meshId, sourcePath, exportUrl: sourcePath });
    scene.scene.roots.push({ id: `${id}:spatial-middle-prototype`, name: 'SpatialMiddlePost', visible: true,
        meshId, children: [], unrealLocationCentimeters: [0,0,0], unrealRotationDegrees: [0,0,0], scale: [1,1,1] });
    return scene;
}
