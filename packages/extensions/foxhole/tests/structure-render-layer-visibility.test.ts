import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import {
    isFoxholeRoofRenderLayer,
    isFoxholeFloorDetailRenderLayer,
    isFoxholeFloorRenderLayer,
    isFoxholeTopRenderLayer,
    isFoxholeWallRenderLayer,
    isFoxholeDirtRenderLayer,
    isFoxholeCornerRenderLayer,
    resolveFoxholeOccupiedSocketTags,
    resolveFoxholeStructureRenderLane,
    shouldCompositeFoxholeStructureBaseTexture,
    shouldRenderFoxholeRoofAboveWalls,
    shouldShowFoxholeStructureRenderLayer,
} from '../app/plugins/foxhole/nixie/structure-render-layer-visibility.ts';
import {
    createFoxholeFlatTopOctagonPoints,
    createFoxholeStructureFloorMaskPoints,
    createFoxholeCornerWallMaskPoints,
    isFoxholeTrenchEmplacementCodeName,
} from '../app/plugins/foxhole/nixie/structure-floor-mask.ts';

test('foundation render layers stay beneath facilities, including borders and pillars', () => {
    for (const structureCodeName of [
        'Foundation012x2T1', 'Foundation012x2T3',
        'Foundation011x2T1', 'Foundation011x2T3',
        'Foundation01T1', 'Foundation01T3',
        'Foundation02T1', 'Foundation02T3',
    ]) {
        for (const id of ['floor', 'backborder0', 'frontborder1', 'leftborder', 'rightborder', 'frontleftpillar', 'centerborder']) {
            assert.equal(resolveFoxholeStructureRenderLane({ id }, structureCodeName), 'floor', `${structureCodeName}:${id}`);
        }
    }
    assert.equal(resolveFoxholeStructureRenderLane({ id: 'frontwall' }, 'FortT1'), 'walls');
});

test('trench corner pieces render above walls for every tier', () => {
    for (const tier of [1, 2, 3]) {
        const structure = `TrenchT${tier}`;
        for (const id of ['cornerbackleft', 'cornerbackright', 'cornerfrontleft', 'cornerfrontright']) {
            assert.equal(resolveFoxholeStructureRenderLane({ id }, structure), 'corners', `${structure}:${id}`);
        }
        assert.equal(resolveFoxholeStructureRenderLane({ id: 'frontwall' }, structure), 'walls');
        assert.equal(resolveFoxholeStructureRenderLane({ id: 'dirtcornerfrontleft' }, structure), 'dirt');
    }
    assert.equal(resolveFoxholeStructureRenderLane({ id: 'cornerfrontleft' }, 'FortT1'), 'walls');
});

test('trench emplacement floor masks use a flat-top regular octagon', () => {
    const points = createFoxholeFlatTopOctagonPoints(200);
    assert.equal(points.length, 8);

    const minimumY = Math.min(...points.map(point => point.y));
    const topPoints = points.filter(point => Math.abs(point.y - minimumY) < 0.000001);
    assert.equal(topPoints.length, 2);
    assert.ok(topPoints[0]!.x < 0);
    assert.ok(topPoints[1]!.x > 0);

    for (const point of points) {
        assert.ok(Math.abs(Math.hypot(point.x, point.y) - 100) < 0.000001);
    }
});

test('trench emplacement floor masks are limited to the three completed tiers', () => {
    assert.equal(isFoxholeTrenchEmplacementCodeName('TrenchEmpT1'), true);
    assert.equal(isFoxholeTrenchEmplacementCodeName('trenchempt3'), true);
    assert.equal(isFoxholeTrenchEmplacementCodeName('TrenchEmpDestroyedT1'), false);
    assert.equal(isFoxholeTrenchEmplacementCodeName('TrenchT2'), false);
});

test('shouldCompositeFoxholeStructureBaseTexture keeps floor-only layers additive', () => {
    assert.equal(shouldCompositeFoxholeStructureBaseTexture([{ id: 'floor' }]), true);
    assert.equal(shouldCompositeFoxholeStructureBaseTexture([{ id: 'Floor' }]), true);
    assert.equal(shouldCompositeFoxholeStructureBaseTexture([]), false);
    assert.equal(shouldCompositeFoxholeStructureBaseTexture([
        { id: 'floor' },
        { id: 'frontwall' },
    ]), false);
});

test('resolveFoxholeOccupiedSocketTags maps occupied sockets to tag names', () => {
    const occupiedSocketKeys = new Set(['foundation-a:BackSocket']);
    const tags = resolveFoxholeOccupiedSocketTags(
        [{
            name: 'BackSocket',
            socketTags: [{ mask: 65536, category: 65536, tag: 'Back' }],
        }, {
            name: 'FrontSocket',
            socketTags: [{ mask: 65536, category: 65536, tag: 'Front' }],
        }],
        occupiedSocketKeys,
        'foundation-a',
    );

    assert.equal(tags.has('back'), true);
    assert.equal(tags.has('front'), false);
});

test('resolveFoxholeOccupiedSocketTags recognizes legacy attachment aliases', () => {
    const tags = resolveFoxholeOccupiedSocketTags(
        [{
            name: 'FortCommon:BackFortSocket',
            socketTags: [{ mask: 1024, category: 4, tag: 'Back' }],
        }],
        new Set(['fort-1:BackFortSocket']),
        'fort-1',
    );

    assert.deepEqual([...tags], ['back']);
});

test('angled fort socket hides its angled wall and dirt layers', () => {
    const tags = resolveFoxholeOccupiedSocketTags(
        [{
            name: 'FortCornerCommonSockets:AngleFortSocket',
            componentType: 'BuildSocketComponent',
            socketTags: [{ mask: 1024, category: 4, tag: 'Angle' }],
        }],
        new Set(['fort-corner:AngleFortSocket']),
        'fort-corner',
    );

    assert.deepEqual([...tags], ['angle']);
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'anglewall', componentTags: ['Angle'] },
            tags,
            { structureCodeName: 'FortCornerT2' },
        ),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'dirttriangle', componentTags: ['Angle', 'Dirt'] },
            tags,
            { structureCodeName: 'FortCornerT2' },
        ),
        false,
    );
});

test('T3 short-wall caps clip at an occupied diagonal without losing exterior wall width', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/foxhole/assets/manifest.v1.json', import.meta.url), 'utf8'));
    const asset = manifest.assets.find((item: { id: string; }) => item.id === 'fortcornert3');
    for (const id of ['wallangle1', 'wallangle2']) {
        const source = asset.renderLayers.find((item: { i: string; }) => item.i === id);
        const layer = { id, width: source.w, height: source.h, offsetX: source.ox ?? 0, offsetY: source.oy ?? 0 };
        const points = createFoxholeCornerWallMaskPoints(asset.codeName, layer, 320, new Set(['angle']));
        assert.ok(points.length >= 3);
        assert.ok(points.every(point => point.x + point.y <= 320 * (1 - 1 / Math.SQRT2) + 0.000001));
        assert.ok(points.some(point => point.x > 160 || point.y > 160));
        assert.deepEqual(createFoxholeCornerWallMaskPoints(asset.codeName, layer, 320, new Set()), []);
        assert.deepEqual(createFoxholeCornerWallMaskPoints('FortCornerT2', layer, 320, new Set(['angle'])), []);
    }
});

test('only occupied fort corners retain a runtime floor mask', () => {
    const floor = { width: 475, height: 465, offsetX: 2.648, offsetY: -4.615 };
    for (const tier of [1, 2, 3]) {
        assert.deepEqual(createFoxholeStructureFloorMaskPoints(`FortT${tier}`, floor), []);
        const corner = createFoxholeStructureFloorMaskPoints(`FortCornerT${tier}`, floor);
        assert.deepEqual(corner, []);
        const connected = createFoxholeStructureFloorMaskPoints(`FortCornerT${tier}`, floor, 320, new Set(['angle']));
        assert.equal(connected.length, 5);
        const manifest = JSON.parse(readFileSync(new URL('../public/foxhole/assets/manifest.v1.json', import.meta.url), 'utf8'));
        const asset = manifest.assets.find((item: { id: string; }) => item.id === `fortcornert${tier}`);
        const socket = asset.buildSockets.find((item: { n: string; }) => item.n.endsWith(':AngleFortSocket'));
        // Published socket positions are centimetres; texture space is 64px/m.
        assert.ok(Math.abs(connected[2]!.x + connected[2]!.y - (socket.x + socket.y) * 0.64) < 0.001);
        assert.ok(Math.abs(connected[2]!.x + connected[2]!.y - 320 * (1 - 1 / Math.SQRT2)) < 0.000001);
        assert.ok(Math.abs(connected[3]!.x + connected[3]!.y - 320 * (1 - 1 / Math.SQRT2)) < 0.000001);
        assert.deepEqual(createFoxholeStructureFloorMaskPoints(`FortCornerT${tier}`, floor, 320, new Set(['back', 'frontleftinternal'])), corner);
        assert.deepEqual(createFoxholeStructureFloorMaskPoints(`FortCornerT${tier}`, floor, 160, new Set(['angle'])),
            connected.map(point => ({ x: point.x / 2, y: point.y / 2 })));
    }
    assert.deepEqual(createFoxholeStructureFloorMaskPoints('FortDestroyedT1', floor), []);
    assert.deepEqual(createFoxholeStructureFloorMaskPoints('TrenchT2', floor), []);
    const emplacement = createFoxholeStructureFloorMaskPoints('TrenchEmpT2', floor, 160);
    assert.equal(emplacement.length, 8);
    assert.ok(Math.abs(Math.max(...emplacement.map(point => point.x)) - 139.2) < 1e-6);
    assert.ok(Math.abs(Math.min(...emplacement.map(point => point.y)) + 139.2) < 1e-6);
});

test('fixed bunker room floors use their FoxWatch baked clipping without runtime masks', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/foxhole/assets/manifest.v1.json', import.meta.url), 'utf8'));
    const ids = [
        'ammoroomt2', 'ammoroomt3',
        'artilleryait1', 'artilleryait2', 'artilleryait3',
        'atgunait1', 'atgunait2', 'atgunait3',
        'engineroomt2', 'engineroomt3',
        'fortradart1', 'fortradart2', 'fortradart3',
        'fortrampt1', 'fortrampt2', 'fortrampt3',
        'medicalroomt1', 'medicalroomt2', 'medicalroomt3',
        'mgait1', 'mgait2', 'mgait3',
        'observationbunkert1', 'observationbunkert2', 'observationbunkert3',
        'rifleait1', 'rifleait2', 'rifleait3',
        'fortfirepitt1', 'fortfirepitt2', 'fortfirepitt3',
        'fortartillerysheltert2', 'fortartillerysheltert3',
        'weatherstation',
    ];
    for (const id of ids) {
        const asset = manifest.assets.find((item: { id: string; }) => item.id === id);
        assert.ok(asset, id);
        const layer = asset.renderLayers.find((item: { i: string; }) => isFoxholeFloorRenderLayer({ id: item.i }, asset.codeName));
        assert.ok(layer, `${id}:floor`);
        const floor = { width: layer.w, height: layer.h, offsetX: layer.ox ?? 0, offsetY: layer.oy ?? 0 };
        assert.deepEqual(createFoxholeStructureFloorMaskPoints(asset.codeName, floor), [], id);
    }
    // T1 artillery shelter is not published yet.
    assert.deepEqual(createFoxholeStructureFloorMaskPoints('FortArtilleryShelterT1', {
        width: 475, height: 465, offsetX: 2.648, offsetY: -4.615,
    }), []);
});

test('flame bunker floors and pipe inputs render independently', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/foxhole/assets/manifest.v1.json', import.meta.url), 'utf8'));
    for (const id of ['fortflamet2', 'fortflamet3']) {
        const asset = manifest.assets.find((item: { id: string; }) => item.id === id);
        assert.ok(asset, id);
        const layer = asset.renderLayers.find((item: { i: string; }) => item.i === 'floor');
        const pipe = asset.renderLayers.find((item: { i: string; }) => /^inputmesh\d+$/.test(item.i));
        assert.ok(pipe, `${id}:pipe`);
        const floor = { width: layer.w, height: layer.h, offsetX: layer.ox ?? 0, offsetY: layer.oy ?? 0 };
        assert.ok(floor.height <= 465, `${id}:floor excludes exterior pipe`);
        assert.deepEqual(createFoxholeStructureFloorMaskPoints(asset.codeName, floor), [], id);
        assert.equal(resolveFoxholeStructureRenderLane({ id: pipe.i, componentTags: pipe.ct ?? [] }, asset.codeName), 'corners');
        assert.equal(shouldShowFoxholeStructureRenderLayer({ id: pipe.i, componentTags: pipe.ct ?? [] }, new Set(), {
            structureCodeName: asset.codeName, hideFloors: true, hideWalls: true, hideDirt: true,
        }), true, `${id}:pipe stays visible above hidden floor, walls, and dirt`);
    }
});

for (const assetId of ['fortcornert1', 'fortcornert2', 'fortcornert3']) {
    test(`${assetId} short sides follow internal sockets and corner posts follow the angled face`, () => {
        const manifest = JSON.parse(readFileSync(new URL('../public/foxhole/assets/manifest.v1.json', import.meta.url), 'utf8'));
        const asset = manifest.assets.find((item: { id: string; }) => item.id === assetId);
        const sockets = asset.buildSockets.map((socket: { n: string; t?: { g?: string; }[]; }) => ({
            name: socket.n, socketTags: socket.t?.map(tag => ({ tag: tag.g })),
        }));
        for (const [socketName, layerIds] of [
            ['FrontLeftInternalSocket', ['wallangle1', 'cornerfrontleft', 'cornerfrontleft1', 'dirtcornerfrontleft', 'dirtcornerfrontleftfort', 'dirtcornerfrontlefttrench']],
            ['BackRightInternalSocket', ['wallangle2', 'cornerbackright', 'cornerbackright1', 'dirtcornerbackright', 'dirtcornerbackrightfort', 'dirtcornerbackrighttrench']],
        ] as const) {
            for (const layerId of layerIds) {
                const source = asset.renderLayers.find((layer: { i: string; }) => layer.i === layerId);
                if (!source) {
                    assert.ok(layerId !== 'wallangle1' && layerId !== 'wallangle2', `Missing short wall: ${assetId}:${layerId}`);
                    continue;
                }
                const layer = { id: source.i, componentTags: source.ct ?? [] };
                for (const occupiedSocket of ['', 'BackFortSocket', 'LeftFortSocket', 'AngleFortSocket', 'FrontLeftInternalSocket', 'BackRightInternalSocket']) {
                    const tags = resolveFoxholeOccupiedSocketTags(sockets, new Set(occupiedSocket ? [`corner:FortCornerCommonSockets:${occupiedSocket}`] : []), 'corner');
                    const hidden = occupiedSocket === socketName || (/^corner(?:frontleft|backright)1$/.test(layerId) && occupiedSocket === 'AngleFortSocket');
                    assert.equal(shouldShowFoxholeStructureRenderLayer(layer, tags, { structureCodeName: asset.codeName }), !hidden, `${layerId}:${occupiedSocket || 'empty'}`);
                }
            }
        }
    });
}

test('resolveFoxholeOccupiedSocketTags maps trench sockets to directional tags', () => {
    const occupiedSocketKeys = new Set(['trench-a:TrenchCommon:BackSocket']);
    const tags = resolveFoxholeOccupiedSocketTags(
        [{
            name: 'TrenchCommon:BackSocket',
            componentType: 'BuildSocketComponent',
            socketTags: [{ mask: 1024, category: 4 }],
        }],
        occupiedSocketKeys,
        'trench-a',
    );

    assert.equal(tags.has('back'), true);
});

test('resolveFoxholeOccupiedSocketTags normalizes catwalk Hide tags', () => {
    const tags = resolveFoxholeOccupiedSocketTags(
        [{
            name: 'FrontSocket',
            componentType: 'BuildSocketComponent',
            socketTags: [{ mask: 67108864, category: 100663296, tag: 'FrontHide' }],
        }],
        new Set(['catwalk-platform:FrontSocket']),
        'catwalk-platform',
    );

    assert.deepEqual([...tags], ['front']);
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'fronttrim', componentTags: ['Front'] },
            tags,
            { structureCodeName: 'FacilityCatwalkPlatform' },
        ),
        false,
    );
});

test('shouldShowFoxholeStructureRenderLayer hides trench wall layers with matching occupied tags', () => {
    const occupiedBack = new Set(['back']);

    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'backwall', componentTags: ['Back'] }, occupiedBack),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'cornerbackleft', componentTags: ['Back', 'Left'] }, occupiedBack),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'frontwall', componentTags: ['Front'] }, occupiedBack),
        true,
    );
});

test('shouldShowFoxholeStructureRenderLayer swaps trench side walls for open wall layers when connected', () => {
    const occupiedLeft = new Set(['left']);
    const unoccupied = new Set<string>();

    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'leftwall', componentTags: ['Left'] }, occupiedLeft),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'openwallleft', componentTags: ['Left'] }, occupiedLeft),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'leftwall', componentTags: ['Left'] }, unoccupied),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'openwallleft', componentTags: ['Left'] }, unoccupied),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'openwallright', componentTags: ['Right'] }, new Set(['left'])),
        false,
    );
});

test('shouldShowFoxholeStructureRenderLayer keeps trench corner pillars visible for side attachments', () => {
    const occupiedLeft = new Set(['left']);
    const occupiedBack = new Set(['back']);

    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'cornerbackleft', componentTags: ['Back', 'Left'] },
            occupiedLeft,
            { structureCodeName: 'TrenchT2' },
        ),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'cornerfrontleft', componentTags: ['Front', 'Left'] },
            occupiedLeft,
            { structureCodeName: 'TrenchT2' },
        ),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'cornerbackleft', componentTags: ['Back', 'Left'] },
            occupiedBack,
            { structureCodeName: 'TrenchT2' },
        ),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'cornerfrontleft', componentTags: ['Front', 'Left'] },
            new Set(['front']),
            { structureCodeName: 'TrenchT2' },
        ),
        false,
    );
});

test('resolveFoxholeOccupiedSocketTags maps fort entrenchment sockets to directional tags', () => {
    const occupiedSocketKeys = new Set(['fort-a:FortCommon:BackFortSocket']);
    const tags = resolveFoxholeOccupiedSocketTags(
        [{
            name: 'FortCommon:BackFortSocket',
            componentType: 'BPBackFortSocket_C',
            socketTags: [{ mask: 1024, category: 4 }],
        }, {
            name: 'FortCommon:FrontFortSocket',
            componentType: 'BPFrontFortSocket_C',
            socketTags: [{ mask: 1024, category: 4 }],
        }],
        occupiedSocketKeys,
        'fort-a',
    );

    assert.equal(tags.has('back'), true);
    assert.equal(tags.has('front'), false);
});

test('resolveFoxholeOccupiedSocketTags prefers explicit socket tag metadata over fort name parsing', () => {
    const occupiedSocketKeys = new Set(['fort-a:BackFortSocket']);
    const tags = resolveFoxholeOccupiedSocketTags(
        [{
            name: 'BackFortSocket',
            componentType: 'BPBackFortSocket_C',
            socketTags: [{ mask: 1024, category: 4, tag: 'Back' }],
        }],
        occupiedSocketKeys,
        'fort-a',
    );

    assert.equal(tags.has('back'), true);
});

test('shouldShowFoxholeStructureRenderLayer maps fort side tags for corner layers', () => {
    const occupiedBack = new Set(['back']);

    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'cornerbackleft', componentTags: ['SideBack', 'SideLeft'] },
            occupiedBack,
        ),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'cornerfrontleft', componentTags: ['SideFront', 'SideLeft'] },
            occupiedBack,
        ),
        true,
    );
});

test('shouldShowFoxholeStructureRenderLayer hides fort mod slot wall layers', () => {
    const occupiedBack = new Set(['back']);

    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'backwall', componentTags: ['Back'] }, occupiedBack),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'frontwall', componentTags: ['Front'] }, occupiedBack),
        true,
    );
});

test('shouldShowFoxholeStructureRenderLayer hides fort wall layers with matching occupied tags', () => {
    const occupiedBack = new Set(['back']);

    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'backwall', componentTags: ['Back'] }, occupiedBack),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'frontwall', componentTags: ['Front'] }, occupiedBack),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'floor', componentTags: [] }, occupiedBack),
        true,
    );
});

test('resolveFoxholeOccupiedSocketTags derives numbered tag names from socket names when tag metadata is missing', () => {
    const occupiedSocketKeys = new Set(['foundation-a:BackSocket0']);
    const tags = resolveFoxholeOccupiedSocketTags(
        [{
            name: 'BackSocket0',
            socketTags: [{ mask: 65536, category: 65536 }],
        }],
        occupiedSocketKeys,
        'foundation-a',
    );

    assert.equal(tags.has('back0'), true);
});

test('shouldShowFoxholeStructureRenderLayer hides trims with matching occupied tags', () => {
    const occupiedTags = new Set(['back']);

    assert.equal(shouldShowFoxholeStructureRenderLayer({ id: 'backborder', componentTags: [] }, occupiedTags), true);
    assert.equal(shouldShowFoxholeStructureRenderLayer({ id: 'backborder', componentTags: ['Back'] }, occupiedTags), false);
    assert.equal(shouldShowFoxholeStructureRenderLayer({ id: 'frontborder', componentTags: ['Front'] }, occupiedTags), true);
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'backleftpillar', componentTags: ['Back', 'Left'] }, occupiedTags),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'backleftpillar', componentTags: ['Back', 'Left'] }, new Set(['left'])),
        false,
    );
});

test('shouldShowFoxholeStructureRenderLayer only hides centerborder for occupied center sockets', () => {
    const occupiedCenter = new Set(['center']);

    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'centerborder', componentTags: ['Center'] }, occupiedCenter),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'frontborder', componentTags: ['Center'] }, occupiedCenter),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'rightborder', componentTags: ['Center'] }, occupiedCenter),
        true,
    );
});

test('shouldShowFoxholeStructureRenderLayer hides only the matching 1x2 left corner pillar', () => {
    const occupiedLeft0 = new Set(['left']);
    const occupiedLeft1 = new Set(['left2']);

    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'backleftpillar', componentTags: ['Back', 'Left'] },
            occupiedLeft0,
        ),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'frontleftpillar', componentTags: ['Front', 'Left2'] },
            occupiedLeft0,
        ),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'backleftpillar', componentTags: ['Back', 'Left'] },
            occupiedLeft1,
        ),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'frontleftpillar', componentTags: ['Front', 'Left2'] },
            occupiedLeft1,
        ),
        false,
    );
});

test('shouldShowFoxholeStructureRenderLayer hides only the matching 1x2 right corner pillar', () => {
    const occupiedRight0 = new Set(['right2']);
    const occupiedRight1 = new Set(['right']);

    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'frontrightpillar', componentTags: ['Front', 'Right2'] },
            occupiedRight0,
        ),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'backrightpillar', componentTags: ['Back', 'Right'] },
            occupiedRight0,
        ),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'frontrightpillar', componentTags: ['Front', 'Right2'] },
            occupiedRight1,
        ),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'backrightpillar', componentTags: ['Back', 'Right'] },
            occupiedRight1,
        ),
        false,
    );
});

test('isFoxholeRoofRenderLayer matches roof layer ids', () => {
    assert.equal(isFoxholeRoofRenderLayer({ id: 'roof' }), true);
    assert.equal(isFoxholeRoofRenderLayer({ id: 'Roof' }), true);
    assert.equal(isFoxholeRoofRenderLayer({ id: 'floor' }), false);
    assert.equal(isFoxholeRoofRenderLayer({ id: 'trenchroof' }), false);
    assert.equal(isFoxholeRoofRenderLayer({ id: 'fortt1gunai', componentTags: ['Roof'] }), true);
});

test('overhead components of radar, artillery, weather, and observation structures hide with roofs', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/foxhole/assets/manifest.v1.json', import.meta.url), 'utf8'));
    const roofParts: Record<string, string[]> = {
        fortlargeradar: ['roofmesh', 'skeletalmesh'],
        intelcenter: ['roofbasemesh', 'roofmesh', 'skeletalmesh'],
        lrartillery: ['roofmesh', 'skeletalmesh'],
        weatherstation: ['roofbasemesh', 'roofmesh', 'skeletalmesh', 'staticmesh'],
        fortartillerysheltert2: ['roof', 'artilleryshelterroof'],
        fortartillerysheltert3: ['roof', 'artilleryshelterroof'],
        observationbunkert1: ['roof', 'observationbunkert1'],
        observationbunkert2: ['roof', 'observationbunkert2'],
        observationbunkert3: ['roof', 'observationbunkert3'],
        atgunait2: ['roof', 'skelmesh', 'basemesh', 'topmesh'],
        atgunait3: ['roof', 'skelmesh', 'basemesh', 'topmesh'],
        mgait1: ['mesh'],
        mgait2: ['mesh', 'roof', 'basemesh', 'topmesh'],
        mgait3: ['mesh', 'roof', 'basemesh', 'topmesh'],
        rifleait1: ['fortt1gunai'],
        rifleait2: ['fortt1gunai', 'basemesh', 'topmesh'],
        rifleait3: ['fortt1gunai', 'basemesh', 'topmesh'],
    };
    for (const [id, roofLayerIds] of Object.entries(roofParts)) {
        const asset = manifest.assets.find((item: { id: string; }) => item.id === id);
        assert.ok(asset, id);
        for (const layer of asset.renderLayers) {
            const candidate = { id: layer.i, componentTags: layer.ct ?? [] };
            const isRoof = roofLayerIds.includes(layer.i);
            assert.equal(isFoxholeRoofRenderLayer(candidate, asset.codeName), isRoof, `${id}:${layer.i}`);
            assert.equal(shouldShowFoxholeStructureRenderLayer(candidate, new Set(), {
                structureCodeName: asset.codeName,
                hideRoofs: true,
            }), !isRoof, `${id}:${layer.i}:hidden`);
        }
    }
    assert.equal(isFoxholeRoofRenderLayer({ id: 'skeletalmesh' }, 'EngineRoomT2'), false);
    assert.equal(isFoxholeRoofRenderLayer({ id: 'artilleryshelter' }, 'FortArtilleryShelterT2'), false);
});

test('every published bunker spotlight component hides with roofs', () => {
    const manifest = JSON.parse(readFileSync(new URL('../public/foxhole/assets/manifest.v1.json', import.meta.url), 'utf8'));
    let spotlightLayerCount = 0;
    for (const asset of manifest.assets.filter((item: { isBunker?: boolean; }) => item.isBunker)) {
        for (const layer of asset.renderLayers ?? []) {
            if (!String(layer.cn ?? '').startsWith('FortSpotLight:')) {
                continue;
            }
            spotlightLayerCount++;
            assert.equal(isFoxholeRoofRenderLayer({ id: layer.i, componentTags: layer.ct ?? [] }, asset.codeName), true, `${asset.id}:${layer.i}`);
        }
    }
    assert.equal(spotlightLayerCount, 12);
});

test('shouldShowFoxholeStructureRenderLayer hides fort corners when either adjacent wall is connected', () => {
    const corners = [
        { id: 'cornerbackleft', componentTags: ['Back', 'Left'], adjacentTags: ['back', 'left'] },
        { id: 'cornerbackright', componentTags: ['Back', 'Right'], adjacentTags: ['back', 'right'] },
        { id: 'cornerfrontleft', componentTags: ['Front', 'Left'], adjacentTags: ['front', 'left'] },
        { id: 'cornerfrontright', componentTags: ['Front', 'Right'], adjacentTags: ['front', 'right'] },
    ];

    for (const corner of corners) {
        for (const adjacentTag of corner.adjacentTags) {
            assert.equal(
                shouldShowFoxholeStructureRenderLayer(
                    corner,
                    new Set([adjacentTag]),
                    { structureCodeName: 'FortT3' },
                ),
                false,
                `${corner.id} should hide for occupied ${adjacentTag}`,
            );
        }
    }

    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            corners[0],
            new Set(['front']),
            { structureCodeName: 'FortT3' },
        ),
        true,
    );
});

test('isFoxholeFloorRenderLayer matches authored floor layers', () => {
    assert.equal(isFoxholeFloorRenderLayer({ id: 'floor' }), true);
    assert.equal(isFoxholeFloorRenderLayer({ id: 'Floor' }), true);
    assert.equal(isFoxholeFloorRenderLayer({ id: 'floormesh' }, 'WeatherStation'), true);
    assert.equal(isFoxholeFloorRenderLayer({ id: 'floormesh' }, 'IntelCenter'), false);
    assert.equal(resolveFoxholeStructureRenderLane({ id: 'floormesh' }, 'WeatherStation'), 'floor');
    assert.equal(resolveFoxholeStructureRenderLane({ id: 'floormesh' }, 'IntelCenter'), 'walls');
    assert.equal(shouldShowFoxholeStructureRenderLayer({ id: 'floormesh' }, new Set(), {
        structureCodeName: 'WeatherStation', hideFloors: true,
    }), false);
    assert.equal(isFoxholeFloorRenderLayer({ id: 'frontwall' }), false);
});

test('isFoxholeFloorDetailRenderLayer keeps ammo shelves directly above floors', () => {
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'ammoroom' }), true);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'AmmoRoom' }), true);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'roof' }), false);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'frontwall' }), false);
});

test('bunker base floor door stays beneath its roof', () => {
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'floordoor' }, 'FortBaseT1'), true);
    assert.equal(resolveFoxholeStructureRenderLane({ id: 'floordoor', componentTags: [] }, 'FortBaseT1'), 'floor');
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'floordoor' }, 'FortBaseT2'), false);
});

test('isFoxholeFloorDetailRenderLayer keeps engine generators directly above floors', () => {
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'skeletalmesh' }, 'EngineRoomT2'), true);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'skeletalmesh' }, 'EngineRoomT3'), true);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'skeletalmesh' }, 'IntelCenter'), false);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'skeletalmesh' }, 'WeatherStation'), false);
});

test('isFoxholeFloorDetailRenderLayer keeps flame emplacement machinery directly above floors', () => {
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'fortflame' }, 'FortFlameT2'), true);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'fortflame' }, 'FortFlameT3'), true);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'fortflame' }, 'FortT2'), false);
});

test('isFoxholeFloorDetailRenderLayer keeps medical-room shelves directly above floors', () => {
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'medicalroommesh' }, 'MedicalRoomT1'), true);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'medicalroommesh' }, 'MedicalRoomT2'), true);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'medicalroommesh' }, 'MedicalRoomT3'), true);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'blanket' }, 'MedicalRoomT2'), false);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'staticmesh' }, 'MedicalRoomT2'), false);
});

test('isFoxholeFloorDetailRenderLayer keeps fire-pit hearths directly above floors', () => {
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'firepitmesh' }, 'FortFirePitT1'), true);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'firepitmesh' }, 'FortFirePitT2'), true);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'firepitmesh' }, 'FortFirePitT3'), true);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'roof' }, 'FortFirePitT2'), false);
    assert.equal(isFoxholeFloorDetailRenderLayer({ id: 'firepitmesh' }, 'FortT2'), false);
});

test('shouldRenderFoxholeRoofAboveWalls elevates bunker base roofs above their flattened bases', () => {
    assert.equal(shouldRenderFoxholeRoofAboveWalls({ id: 'roof' }, 'FortT2'), true);
    assert.equal(shouldRenderFoxholeRoofAboveWalls({ id: 'roof' }, 'FortBaseT2'), true);
    assert.equal(shouldRenderFoxholeRoofAboveWalls({ id: 'roof' }, 'FortBaseT3'), true);
    assert.equal(shouldRenderFoxholeRoofAboveWalls({ id: 'fortt2roofangledirt02' }, 'FortCornerT2'), true);
    assert.equal(shouldRenderFoxholeRoofAboveWalls({ id: 'roof' }, 'FortT1'), false);
    assert.equal(shouldRenderFoxholeRoofAboveWalls({ id: 'roof' }, 'FortT3'), false);
    assert.equal(shouldRenderFoxholeRoofAboveWalls({ id: 'frontwall' }, 'FortT2'), false);
});

test('resolveFoxholeStructureRenderLane routes bunker base roofs after their flattened bases', () => {
    assert.equal(resolveFoxholeStructureRenderLane({ id: 'roof' }, 'FortT2'), 'walls');
    assert.equal(resolveFoxholeStructureRenderLane({ id: 'base' }, 'FortBaseT2'), 'walls');
    assert.equal(resolveFoxholeStructureRenderLane({ id: 'roof' }, 'FortBaseT2'), 'walls');
    assert.equal(resolveFoxholeStructureRenderLane({ id: 'base' }, 'FortBaseT3'), 'walls');
    assert.equal(resolveFoxholeStructureRenderLane({ id: 'roof' }, 'FortBaseT3'), 'walls');
    assert.equal(
        resolveFoxholeStructureRenderLane(
            { id: 'fortt2roofangledirt02', componentTags: ['Angle', 'Roof'] },
            'FortCornerT2',
        ),
        'walls',
    );
    assert.equal(resolveFoxholeStructureRenderLane({ id: 'roof' }, 'FortT1'), 'roof');
    assert.equal(resolveFoxholeStructureRenderLane({ id: 'roof' }, 'FortT3'), 'roof');
    assert.equal(resolveFoxholeStructureRenderLane({ id: 'frontwall', componentTags: ['Front'] }, 'FortT2'), 'walls');
});

test('isFoxholeTopRenderLayer identifies components above bunker roofs', () => {
    assert.equal(isFoxholeTopRenderLayer({ componentTags: ['Top'] }), true);
    assert.equal(isFoxholeTopRenderLayer({ componentTags: ['Roof'] }), false);
});

test('isFoxholeTopRenderLayer keeps AT gun meshes above their roofs and walls', () => {
    assert.equal(isFoxholeTopRenderLayer({ id: 'skelmesh', componentTags: ['Roof'] }, 'ATGunAIT1'), true);
    assert.equal(isFoxholeTopRenderLayer({ id: 'skelmesh', componentTags: ['Roof'] }, 'ATGunAIT2'), true);
    assert.equal(isFoxholeTopRenderLayer({ id: 'skelmesh', componentTags: ['Roof'] }, 'ATGunAIT3'), true);
    assert.equal(isFoxholeTopRenderLayer({ id: 'mesh' }, 'ArtilleryAIT1'), false);
    assert.equal(isFoxholeTopRenderLayer({ id: 'roof', componentTags: ['Roof'] }, 'ATGunAIT3'), false);
});

test('isFoxholeTopRenderLayer keeps MG gun meshes above their roofs and walls', () => {
    assert.equal(isFoxholeTopRenderLayer({ id: 'mesh', componentTags: ['Roof'] }, 'MGAIT1'), true);
    assert.equal(isFoxholeTopRenderLayer({ id: 'mesh', componentTags: ['Roof'] }, 'MGAIT2'), true);
    assert.equal(isFoxholeTopRenderLayer({ id: 'mesh', componentTags: ['Roof'] }, 'MGAIT3'), true);
    assert.equal(isFoxholeTopRenderLayer({ id: 'roof' }, 'MGAIT2'), false);
    assert.equal(isFoxholeTopRenderLayer({ id: 'mesh' }, 'ArtilleryAIT1'), false);
});

test('isFoxholeTopRenderLayer keeps flame emplacement pipes above roofs and walls', () => {
    assert.equal(isFoxholeTopRenderLayer({ id: 'inputmesh0' }, 'FortFlameT2'), true);
    assert.equal(isFoxholeTopRenderLayer({ id: 'inputmesh1' }, 'FortFlameT3'), true);
    assert.equal(isFoxholeTopRenderLayer({ id: 'inputmesh0' }, 'FortT2'), false);
    assert.equal(isFoxholeTopRenderLayer({ id: 'fortflame' }, 'FortFlameT3'), false);
});

test('isFoxholeWallRenderLayer identifies wall layers without matching exterior dirt', () => {
    assert.equal(isFoxholeWallRenderLayer({ id: 'frontwall', componentTags: ['Front'] }), true);
    assert.equal(isFoxholeWallRenderLayer({ id: 'openwallleft', componentTags: ['Left'] }), true);
    assert.equal(isFoxholeWallRenderLayer({ id: 'sideleft', componentTags: ['Left'] }), true);
    assert.equal(isFoxholeWallRenderLayer({ id: 'sideright', componentTags: ['Right'] }), true);
    assert.equal(isFoxholeWallRenderLayer({ id: 'dirtfront', componentTags: ['Front'] }), false);
    assert.equal(isFoxholeWallRenderLayer({ id: 'cornerfrontleft', componentTags: ['Front', 'Left'] }), false);
});

test('dirt and structural corner render-layer helpers stay independent', () => {
    assert.equal(isFoxholeDirtRenderLayer({ id: 'dirtfront', componentTags: ['Front'] }), true);
    assert.equal(isFoxholeDirtRenderLayer({ id: 'dirtcornerfrontleft', componentTags: ['Front', 'Left'] }), true);
    assert.equal(isFoxholeCornerRenderLayer({ id: 'cornerfrontleft', componentTags: ['Front', 'Left'] }), true);
    assert.equal(isFoxholeCornerRenderLayer({ id: 'dirtcornerfrontleft', componentTags: ['Front', 'Left'] }), false);
});

test('shouldShowFoxholeStructureRenderLayer hides dirt and corners independently', () => {
    const unoccupied = new Set<string>();

    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'dirtcornerfrontleft', componentTags: ['Front', 'Left'] }, unoccupied, { hideDirt: true }),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'cornerfrontleft', componentTags: ['Front', 'Left'] }, unoccupied, { hideDirt: true }),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'cornerfrontleft', componentTags: ['Front', 'Left'] }, unoccupied, { hideCorners: true }),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'dirtcornerfrontleft', componentTags: ['Front', 'Left'] }, unoccupied, { hideCorners: true }),
        true,
    );
});

test('shouldShowFoxholeStructureRenderLayer hides only walls when hideWalls is enabled', () => {
    const unoccupied = new Set<string>();

    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'frontwall', componentTags: ['Front'] }, unoccupied, { hideWalls: true }),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'sideleft', componentTags: ['Left'] }, unoccupied, { hideWalls: true }),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'dirtfront', componentTags: ['Front'] }, unoccupied, { hideWalls: true }),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'floor' }, unoccupied, { hideWalls: true }),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'roof' }, unoccupied, { hideWalls: true }),
        true,
    );
});

test('shouldShowFoxholeStructureRenderLayer hides only floors when hideFloors is enabled', () => {
    const unoccupied = new Set<string>();

    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'floor' }, unoccupied, { hideFloors: true }),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'frontwall', componentTags: ['Front'] }, unoccupied, { hideFloors: true }),
        true,
    );
});

test('shouldShowFoxholeStructureRenderLayer hides roof layers when hideRoofs is enabled', () => {
    const unoccupied = new Set<string>();

    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'roof' }, unoccupied),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'roof' }, unoccupied, { hideRoofs: false }),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'roof' }, unoccupied, { hideRoofs: true }),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'fortt1gunai', componentTags: ['Roof'] }, unoccupied, { hideRoofs: true }),
        false,
    );
    for (const structureCodeName of ['ArtilleryAIT1', 'ArtilleryAIT2', 'ArtilleryAIT3']) {
        assert.equal(
            shouldShowFoxholeStructureRenderLayer(
                { id: 'mesh' },
                unoccupied,
                { hideRoofs: true, structureCodeName },
            ),
            false,
        );
    }
    for (const structureCodeName of ['MedicalRoomT1', 'MedicalRoomT2', 'MedicalRoomT3']) {
        assert.equal(
            shouldShowFoxholeStructureRenderLayer(
                { id: 'blanket' },
                unoccupied,
                { hideRoofs: true, structureCodeName },
            ),
            false,
        );
    }
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'floor' }, unoccupied, { hideRoofs: true }),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'frontwall', componentTags: ['Front'] }, unoccupied, { hideRoofs: true }),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'cornerfrontleft', componentTags: ['Front', 'Left'] },
            unoccupied,
            { hideRoofs: true },
        ),
        true,
    );
});

test('shouldShowFoxholeStructureRenderLayer keeps occupied-socket rules when hideRoofs is set', () => {
    const occupiedBack = new Set(['back']);

    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'backwall', componentTags: ['Back'] },
            occupiedBack,
            { hideRoofs: true },
        ),
        false,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer(
            { id: 'frontwall', componentTags: ['Front'] },
            occupiedBack,
            { hideRoofs: true },
        ),
        true,
    );
    assert.equal(
        shouldShowFoxholeStructureRenderLayer({ id: 'roof' }, occupiedBack, { hideRoofs: true }),
        false,
    );
});
