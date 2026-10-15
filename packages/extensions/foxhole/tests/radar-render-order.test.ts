import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { orderFoxholeStructureRenderLayers, resolveFoxholeStructureRenderLane } from '../app/plugins/foxhole/nixie/structure-render-layer-visibility.ts';
import { renderFoxholeSceneV2Entity } from '../../../../extensions/foxhole-planner/src/scene-v2-renderers.ts';
import { FOXHOLE_STRUCTURE_RENDER_LANES } from '../../../../extensions/foxhole-planner/src/render-lanes.ts';

const catalog = getFoxholeStructureCatalog('/foxhole/assets/');

function render(assetId: string, settings: Record<string, boolean> = {}) {
    const entity = { entityId: assetId, revision: 1, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId } },
    ] };
    return renderFoxholeSceneV2Entity(entity, { contractVersion: 1, entities: [entity], settings });
}

for (const tier of [1, 2, 3]) {
    test(`radar bunker tier ${tier} draws its intact assembly over the concrete roof without changing roof controls`, () => {
        const key = `fortradart${tier}`;
        const plan = render(key);
        const roofRows = plan.root.children.filter(node => node.laneId === FOXHOLE_STRUCTURE_RENDER_LANES.roof.laneId);
        const roofIndex = roofRows.findIndex(node => node.id === 'structure-layer-roof');
        const radarIndex = roofRows.findIndex(node => node.id === 'structure-layer-radarmesh');
        assert.ok(roofIndex >= 0);
        assert.ok(radarIndex > roofIndex, 'the opaque roof must be drawn before the intact radar assembly');
        const asset = catalog.assetByKey[key]!;
        const original = asset.renderLayers.slice();
        const nativeRoofRows = orderFoxholeStructureRenderLayers(asset.renderLayers, asset.codeName)
            .filter(layer => resolveFoxholeStructureRenderLane(layer, asset.codeName) === 'roof');
        assert.deepEqual(nativeRoofRows.map(layer => `structure-layer-${layer.id}`), roofRows.map(node => node.id));
        assert.deepEqual(asset.renderLayers, original, 'ordering must not mutate the published catalog');
        const hidden = render(key, { 'foxhole.structure.hideRoofs': true });
        assert.equal(hidden.root.children.some(node => node.id === 'structure-layer-radarmesh'), false);
        assert.equal(hidden.root.children.some(node => node.id === 'structure-layer-roof'), false);
        const staticPlan = render(key, { 'foxhole.structure.useStaticRender': true });
        assert.equal(staticPlan.root.children.some(node => node.id.startsWith('structure-layer-')), false);
        assert.ok(staticPlan.root.children.some(node => node.kind === 'sprite' && node.resourceId === `foxhole.asset.${key}`));
    });
}

test('representative non-radar structures retain their published order within each render lane', () => {
    for (const key of ['fortt3', 'fortcornert3', 'rifleait3', 'weatherstation', 'fortlargeradar', 'fortflamet3']) {
        const asset = catalog.assetByKey[key]!;
        const plan = render(key);
        assert.equal(orderFoxholeStructureRenderLayers(asset.renderLayers, asset.codeName), asset.renderLayers);
        const groups = Object.groupBy(plan.root.children.filter(node => node.id.startsWith('structure-layer-')), node => node.laneId ?? 'default');
        for (const [lane, nodes] of Object.entries(groups)) {
            const actual = nodes!.map(node => node.id);
            const ids = new Set(actual);
            const expected = asset.renderLayers.map(layer => `structure-layer-${layer.id}`).filter(id => ids.has(id));
            assert.deepEqual(actual, expected, `${key}:${lane}`);
        }
    }
});
