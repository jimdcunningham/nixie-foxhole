import assert from 'node:assert/strict';
import test from 'node:test';
import {
    compareFoxholeModificationRenderOrder,
    isFoxholeRoofModification,
    resolveFoxholeModificationTextureLayer,
} from '../app/plugins/foxhole/nixie/modification-render-order.ts';

test('Hide Roofs identifies trench roofs and ladders without hiding trench defenses', () => {
    for (const id of ['trenchroof', 'ladder', ' TrenchRoof ']) assert.equal(isFoxholeRoofModification({ id }), true);
    for (const id of ['barbedwire', 'sandbags', 'bridge', 'stairs']) assert.equal(isFoxholeRoofModification({ id }), false);
});

test('fort stairs render above roof and walls while trench stairs remain lower', () => {
    assert.equal(resolveFoxholeModificationTextureLayer({ z: -160, componentType: 'BPFortStairsModSlot_C' }, { id: 'stairs' }), 'upper');
    assert.equal(resolveFoxholeModificationTextureLayer({ z: -160, componentType: 'BPTrenchEndModSlot_C' }, { id: 'stairs' }), 'lower');
});

test('ladder uses the roof lane above bunker interior furniture', () => {
    assert.equal(resolveFoxholeModificationTextureLayer({ z: -160 }, { id: 'ladder' }), 'roof');
    assert.equal(resolveFoxholeModificationTextureLayer({ componentType: 'BPFortInfraModSlot_C' }, { id: 'desk' }), 'base');
});

test('resolveFoxholeModificationTextureLayer places trench defenses above bridges', () => {
    const trenchOptions = { profileType: 'Trench', useStructureRenderLayers: true };

    assert.equal(
        resolveFoxholeModificationTextureLayer({ z: -160 }, { id: 'bridge' }, trenchOptions),
        'upper',
    );
    assert.equal(
        resolveFoxholeModificationTextureLayer({ z: null }, { id: 'sandbags' }, trenchOptions),
        'trenchDefense',
    );
    assert.equal(
        resolveFoxholeModificationTextureLayer({ z: null }, { id: 'barbedwire' }, trenchOptions),
        'trenchDefense',
    );
    assert.equal(resolveFoxholeModificationTextureLayer({ z: null }, { id: 'sandbags' },
        { profileType: 'Fort', useStructureRenderLayers: true }), 'upper');
    assert.equal(resolveFoxholeModificationTextureLayer({ z: null }, { id: 'barbedwire' },
        { profileType: 'Trench', useStructureRenderLayers: false }), 'trenchDefense');
});

test('compareFoxholeModificationRenderOrder draws trench defenses after bridges', () => {
    const options = { profileType: 'Trench', useStructureRenderLayers: true };
    const bridge = {
        slot: { id: 'BridgeModSlot', name: 'BridgeModSlot', x: 0, y: 0, z: -160 },
        variant: { id: 'bridge' },
    };
    const berm = {
        slot: { id: 'LeftMiddleDefenseModSlot', name: 'LeftMiddleDefenseModSlot', x: 165, y: -220, z: null },
        variant: { id: 'sandbags' },
    };

    assert.ok(compareFoxholeModificationRenderOrder(berm, bridge, options) > 0);
    assert.ok(compareFoxholeModificationRenderOrder(bridge, berm, options) < 0);
});
