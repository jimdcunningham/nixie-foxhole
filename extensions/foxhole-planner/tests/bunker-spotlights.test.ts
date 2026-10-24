import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import type { NixieExperimentalComponentEntitySnapshotV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import assets from '../src/scene-v2-assets-node.ts';
import { isFoxholeBunkerSpotlightLayer, resolveFoxholeBunkerSpotlightLights } from '../src/bunker-spotlights.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { FOXHOLE_STRUCTURE_RENDER_LANES } from '../src/render-lanes.ts';
import { resolveFoxholeStructureRenderLane, shouldShowFoxholeStructureRenderLayer } from '../src/structure-render-layer-visibility.ts';

const poweredNight = { 'foxhole.ranges.nighttime': true, 'foxhole.ranges.poweredSpotlights': true };
const eligible = ['rifleait2', 'rifleait3', 'mgait2', 'mgait3', 'atgunait2', 'atgunait3'];
const render = (assetId: string, settings: Record<string, boolean>, appearance: { destroyed?: boolean; packaged?: boolean; blueprint?: boolean; } = {}) => {
    const entity: NixieExperimentalComponentEntitySnapshotV1 = { entityId: assetId, revision: 1, components: [
        { ownerId: 'nixie.foxhole-planner', componentId: 'asset', version: 1, definitionAvailable: true,
            data: { catalogId: 'foxhole.structures', assetId } },
        { ownerId: 'nixie.foxhole-planner', componentId: 'appearance', version: 1, definitionAvailable: true, data: appearance },
    ] };
    return parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity, { contractVersion: 1, entities: [entity], settings }));
};

test('all six powered bunker garrisons publish separate lamp parts above the guns and roofs', () => {
    for (const id of eligible) {
        const asset = assets[id]!;
        const lampLayers = Object.keys(asset.renderLayers).filter(id => isFoxholeBunkerSpotlightLayer({ id }, asset.codeName));
        assert.deepEqual(lampLayers.sort(), ['basemesh', 'topmesh']);
        const nodes = render(id, {}).root.children;
        for (const layerId of lampLayers) {
            assert.equal(resolveFoxholeStructureRenderLane({ id: layerId }, asset.codeName), 'spotlight');
            const lamp = nodes.find(node => node.id === `structure-layer-${layerId}`)!;
            assert.equal(lamp.laneId, FOXHOLE_STRUCTURE_RENDER_LANES.spotlight.laneId);
            assert.ok(lamp.laneOrder! > FOXHOLE_STRUCTURE_RENDER_LANES.trenchDefense.laneOrder);
            assert.equal(shouldShowFoxholeStructureRenderLayer({ id: layerId }, new Set(),
                { structureCodeName: asset.codeName, hideRoofs: true }), false);
        }
        assert.equal(nodes.some(node => node.id === 'bunker-spotlight-glow'), false);
    }
});

test('powered night lights have a bounded glow without changing the asset selection footprint', () => {
    for (const id of eligible) {
        const day = render(id, {});
        const night = render(id, poweredNight);
        const glow = night.root.children.find(node => node.id === 'bunker-spotlight-glow');
        assert.ok(glow?.kind === 'group');
        assert.equal(glow.laneId, FOXHOLE_STRUCTURE_RENDER_LANES.spotlight.laneId);
        assert.equal(glow.experimentalPresentation?.excludeFromBounds, true);
        assert.deepEqual(night.experimentalSelectionGeometry, day.experimentalSelectionGeometry);
        const light = glow.children[0];
        assert.ok(light?.kind === 'group');
        assert.deepEqual(light.children.map(node => node.id), ['light-beam-0']);
        const beam = light.children[0];
        assert.ok(beam?.kind === 'graphics');
        const gradient = beam.commands.find(command => command.op === 'fill-radial-gradient');
        assert.ok(gradient?.op === 'fill-radial-gradient');
        assert.equal(gradient.colorStops.at(-1)?.alpha, 0);
        const resolved = resolveFoxholeBunkerSpotlightLights(assets[id]!.spotlights, assets[id]!.renderLayers.topmesh)[0]!;
        assert.equal(light.x, resolved.x);
        assert.equal(light.y, resolved.y);
        assert.equal(light.rotation, resolved.rotation);
        assert.equal(render(id, { ...poweredNight, 'foxhole.structure.useStaticRender': true }).root.children
            .some(node => node.id === 'bunker-spotlight-glow'), true);
    }
});

test('daytime, unpowered, hidden roofs and nonoperational appearances extinguish the lamp', () => {
    const settingsCases: Record<string, boolean>[] = [{ 'foxhole.ranges.nighttime': true }, { 'foxhole.ranges.poweredSpotlights': true },
        { ...poweredNight, 'foxhole.structure.hideRoofs': true }];
    for (const id of eligible) {
        for (const settings of settingsCases) {
            assert.equal(render(id, settings).root.children.some(node => node.id === 'bunker-spotlight-glow'), false);
        }
        for (const appearance of [{ destroyed: true }, { packaged: true }, { blueprint: true }]) {
            assert.equal(render(id, poweredNight, appearance).root.children.some(node => node.id === 'bunker-spotlight-glow'), false);
        }
    }
    for (const id of ['rifleait1', 'mgait1', 'atgunait1', 'riflepillbox', 'mgpillbox', 'atpillbox', 'isgpillbox']) {
        assert.equal(render(id, poweredNight).root.children.some(node => node.id === 'bunker-spotlight-glow'), false);
        assert.equal(isFoxholeBunkerSpotlightLayer({ id: 'topmesh' }, assets[id]!.codeName), false);
    }
});

test('all refreshed garrisons use extracted lighting data rather than the legacy preview fallback', () => {
    for (const id of eligible) {
        const asset = assets[id]!;
        assert.equal(asset.spotlights?.length, 1, id);
        const [light] = resolveFoxholeBunkerSpotlightLights(asset.spotlights, asset.renderLayers.topmesh);
        assert.equal(light!.authored, true, id);
        assert.equal(light!.beam.coneLength, 22.75 * 32, id);
        assert.equal(light!.beam.beamColorHex.toLowerCase(), 'ffdea4', id);
        assert.equal(light!.beam.lightFalloffExponent, 8, id);
        assert.equal(light!.beam.useInverseSquaredFalloff, false, id);
        assert.ok(Math.abs(light!.rotation) < 0.00001, id);
        assert.ok(Math.abs(light!.x - (id === 'atgunait2' ? 80 : 20) / 100 * 32) < 0.00001, id);
    }
});
