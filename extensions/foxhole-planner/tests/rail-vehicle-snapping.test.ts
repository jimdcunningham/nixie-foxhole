import assert from 'node:assert/strict';
import test from 'node:test';
import { parseNixieExtensionManifestV1, parseNixieExtensionRenderPlanV1, parseNixieRenderPresentationV1 } from '@nixiejs/extension-sdk';
import type { NixieComponentEntitySnapshotV1, NixieTransformFinalizeRequestV1 } from '@nixiejs/extension-sdk/scene-v2';
import { nearestPointOnSegment, matchesNixieTransformFinalizerV1, parseNixieSceneV2DocumentV1, parseNixieSimulationColliderV1, parseNixieSimulationEffectsV1, parseNixieSimulationPathV1, parseNixieSimulationRoutingV1,
    parseNixieTransformFinalizerV1, parseNixieTransformFinalizeResultV1 } from '@nixiejs/extension-sdk/scene-v2';
import manifest from '../nixie.extension.json' with { type: 'json' };
import { finalizeFoxholeRailVehicleSnap, railCouplers } from '../src/rail-vehicle-snapping.ts';
import { foxholeRailVehicleBogies } from '../src/rail-vehicle-rigs.ts';
import { foxholeRailCouplerHook } from '../src/rail-coupler-hooks.ts';
import { FOXHOLE_HEIGHT_RENDER_LANES, FOXHOLE_STRUCTURE_RENDER_LANES, foxholeRenderLane, resolveFoxholeAssetHeightLane } from '../src/render-lanes.ts';
import { sampleFoxholeSceneV2Connector } from '../src/scene-v2-connector-path.ts';
import { createFoxholeSpatialProjection } from '../src/scene-v2-spatial-transforms.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';
import { fitFoxholeRailWheelbase } from '../src/rail-wheelbase.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { fixedRailNetwork, nearbyFixedRailRegions } from '../src/fixed-region-rails.ts';
import fixedRailData from '../src/fixed-region-rail-centerlines.json' with { type: 'json' };
import { finalizeFoxholeSceneV2Transform } from '../src/scene-v2-transform-finalizer.ts';
import { resolveFoxholeSpatialSplineAttachments } from '../src/scene-v2-spatial-attachments.ts';
import assets from '../src/scene-v2-assets-node.ts';

const ownerId = 'nixie.foxhole-planner';

test('rail seat points cover both small-gauge ends and follow the owning bogie on articulated cars', () => {
    for (const id of ['smalltrainengine', 'smalltrainmaterial', 'smalltrainresource', 'smalltrainshipping', 'smalltrainliquid']) {
        const model = assets[id]!.model!;
        const front = foxholeRailCouplerHook(id, 1, model), rear = foxholeRailCouplerHook(id, -1, model);
        assert.ok(front && rear);
        assert.equal(front.modelAttachment.nodeName, 'rail-body');
        assert.ok(front.point[0] > 0 && rear.point[0] < 0);
        assert.ok(Math.abs(front.point[2] - 17.08) < 0.02);
    }
    for (const [id, front, rear] of [['trainhospital', 'rail-bogie-rear', 'rail-bogie-front'],
        ['trainlrartillery', 'rail-bogie-front', 'rail-bogie-rear']] as const) {
        const model = assets[id]!.model!;
        assert.equal(foxholeRailCouplerHook(id, 1, model)?.modelAttachment.nodeName, front);
        assert.equal(foxholeRailCouplerHook(id, -1, model)?.modelAttachment.nodeName, rear);
    }
});

test('rail seats and their owning pivots include the rendered model anchor', () => {
    const anchor = [5, -4, 7] as const;
    for (const id of ['traincoal', 'trainlrartillery', 'trainhospital']) {
        const model = { resourceId: 'foxhole.model.' + id, width: 200, height: 150, depth: 100, offsetX: 0, offsetY: 0, offsetZ: 75 };
        const [offsetX, offsetY, z] = anchor;
        for (const end of [-1, 1] as const) {
            const centered = foxholeRailCouplerHook(id, end, model)!;
            const shifted = foxholeRailCouplerHook(id, end, { ...model, offsetX, offsetY, offsetZ: model.height / 2 + z })!;
            assert.deepEqual(shifted.point, centered.point.map((value, axis) => value + anchor[axis]!));
            assert.deepEqual(shifted.modelAttachment.pivot, id === 'traincoal' ? [0, 0, 0]
                : centered.modelAttachment.pivot.map((value, axis) => value + anchor[axis]!));
        }
    }
});

test('small-gauge wheels and locomotive drive gear use the same signed travel cycle', () => {
    const ids = ['smalltrainengine', 'smalltrainmaterial', 'smalltrainresource', 'smalltrainshipping', 'smalltrainliquid'];
    for (const id of ids) {
        const entity = request(id, []).context.entities[0]!;
        const spatial = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity)).spatial!;
        const wheels = spatial.modelDistanceRotations!;
        assert.deepEqual(wheels.map(wheel => wheel.nodeName), ['rail-wheel-f', 'rail-wheel-b']);
        assert.ok(wheels.every(wheel => wheel.axis === 'z' && wheel.radiansPerUnit === -1 / (32 * .362)));
        if (id !== 'smalltrainengine') {
            assert.equal(spatial.modelDistancePoseCycles, undefined);
            continue;
        }
        const [gear] = spatial.modelDistancePoseCycles!;
        assert.ok(gear);
        assert.ok(Math.abs(gear.distancePerCycle * wheels[0]!.radiansPerUnit + 2 * Math.PI) < 1e-10);
        assert.equal(gear.tracks.length, 14);
        assert.ok(gear.tracks.every(track => track.samples[0]?.every(value => value === 0)));
        const quarter = gear.tracks.find(track => track.nodeName === 'rail-link-small-coupling-l')!;
        assert.deepEqual(quarter.samples[quarter.samples.length / 4], [-.25905, .25905, 0]);
    }
});

test('only supported upright hooks advertise a tip for their end link', () => {
    const effect = (assetId: string, end: 'front' | 'rear', supported: boolean) => {
        const entity = request(assetId, []).context.entities[0]!;
        return parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity, {
            contractVersion: 1, entities: [entity], settings: {
                'nixie.scene.simulationModelAttachments': supported ? '2' : true,
            },
        })).spatial?.simulationEffects?.find(effect => effect.id === 'coupler-' + end);
    };
    const front = effect('trainhospital', 'front', true)!;
    assert.ok(front.chainHookTip && front.chainHookTip[2] > front.point[2]);
    assert.equal(front.modelAttachment?.nodeName, 'rail-bogie-rear');
    assert.equal(effect('trainhospital', 'front', false)?.chainHookTip, undefined);
    assert.equal(effect('traininfantry', 'rear', true)?.chainHookTip, undefined);
    assert.equal(effect('smalltrainengine', 'front', true)?.chainEndPlane, 'vertical');
    assert.equal(effect('smalltrainengine', 'front', true)?.chainHookTip, undefined);
});
const component = (componentId: string, data: NixieComponentEntitySnapshotV1['components'][number]['data'], owner = ownerId) =>
    ({ ownerId: owner, componentId, version: 1, definitionAvailable: true, data });

function track(foxholeKey: string, entityId = 'track', y = 0): NixieComponentEntitySnapshotV1 {
    return { entityId, revision: 1, components: [
        component('transform', { x: 0, y, rotation: 0 }, 'nixie.core'),
        component('spatial-transform', { elevation: 32 }, 'nixie.core'),
        component('spline-connector', {
            foxholeKey, startX: 0, startY: 0, startRotation: 0, endX: 400, endY: 0, endRotation: 0,
            minLength: 160, maxLength: 1600, minRadius: 160, maxRadius: 1200, maxBuffer: 0, curveT: 1, blueprint: false,
        }),
    ] };
}

function request(assetId: string, tracks: NixieComponentEntitySnapshotV1[]): NixieTransformFinalizeRequestV1 {
    return { contractVersion: 1, entityId: 'vehicle', interaction: 'placement',
        transform: { x: 173, y: 10, rotation: 3, scaleX: 1, scaleY: 1 },
        context: { contractVersion: 1, entities: [
            { entityId: 'vehicle', revision: 1, components: [
                component('asset', { catalogId: 'foxhole.structures', assetId }),
                component('transform', { x: 400, y: 400, rotation: 0 }, 'nixie.core'),
            ] },
            ...tracks,
        ] },
    };
}

for (const [region, count, suffix] of [['westgate', 15, 'foundation_6:end'], ['greatmarch', 10, 'spline3_9:start']] as const) {
    test(`${region} accepts an end extension and large vehicles retain their rail route after a save round trip`, () => {
        const fixed = fixedRailNetwork(region)!;
        assert.equal(fixed.rails.length, count);
        const endpoint = fixed.endpoints.find(value => value.id.endsWith(suffix))!;
        assert.ok(endpoint);
        const [x, y, elevation] = endpoint.point;
        const heading = endpoint.rotation;
        const settings = { [`foxhole.map.fixedRails.${region}`]: true };
        const extension = track('railtrackspline', `${region}-extension`);
        Object.assign(extension.components[0]!.data, { x, y, rotation: heading });
        extension.components[1]!.data.elevation = elevation;
        const context = { contractVersion: 1 as const, entities: [extension], settings };
        const proposal: NixieTransformFinalizeRequestV1 = { contractVersion: 1, entityId: extension.entityId,
            transform: { x, y, rotation: heading, scaleX: 1, scaleY: 1 }, interaction: 'placement', context,
            geometryGesture: { phase: 'commit', handleId: 'start', worldPoint: { x, y, z: elevation },
                hoveredEntityIds: [], snappingEnabled: true } };
        const snapped = finalizeFoxholeSceneV2Transform(proposal);
        const patch = snapped.transaction?.operations.find(operation => operation.op === 'patch' && operation.componentId === 'spline-connector');
        assert.equal(patch?.op === 'patch' && patch.set?.startFixedRailEnd, endpoint.id);
        assert.equal(snapped.transaction?.operations.every(operation => operation.entityId === extension.entityId), true);
        Object.assign(extension.components[2]!.data, patch?.op === 'patch' ? patch.set : {});
        extension.components[2]!.data.endX = 640;
        const competing = { ...extension, entityId: 'second-extension', components: structuredClone(extension.components) };
        delete competing.components[2]!.data.startFixedRailEnd;
        const unavailable = finalizeFoxholeSceneV2Transform({ ...proposal, entityId: competing.entityId,
            context: { ...context, entities: [competing, extension] } });
        assert.ok(!unavailable.transaction?.operations.some(operation => operation.op === 'patch' && operation.set?.startFixedRailEnd));
        const trackContext = { ...context, settings: undefined };
        const attached = resolveFoxholeSpatialSplineAttachments(extension,
            extension.components[2]!.data as unknown as FoxholeSceneV2SplineConnectorData, trackContext, assets);
        assert.ok(Math.abs(attached.startZ) < 0.001);
        assert.ok(Math.abs(attached.startRotation) < 0.001);

        const rail = fixed.rails.find(rail => rail.id === endpoint.railId)!;
        const sample = endpoint.end === 'start' ? rail.points : [...rail.points].reverse();
        let remaining = 285;
        let spawn = sample.at(-1)!;
        for (let i = 1; i < sample.length; i++) {
            const from = sample[i - 1]!, to = sample[i]!;
            const length = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
            if (remaining <= length) {
                spawn = [from[0] + (to[0] - from[0]) * remaining / length,
                    from[1] + (to[1] - from[1]) * remaining / length, from[2] + (to[2] - from[2]) * remaining / length];
                break;
            }
            remaining -= length;
        }
        const [railX, railY, railZ] = spawn;
        const snapVehicle = (id: string, entities: NixieComponentEntitySnapshotV1[]) => {
            const draft = request(id, entities);
            draft.context.settings = settings;
            Object.assign(draft.transform, { x: railX, y: railY, rotation: heading });
            draft.context.entities[0]!.components.push(component('spatial-transform', { elevation: railZ + 11.52 }, 'nixie.core'));
            return finalizeFoxholeRailVehicleSnap(draft);
        };
        for (const id of ['trainengine', 'trainflatbed']) {
            const result = snapVehicle(id, [extension]);
            const add = result.transaction?.operations.find(operation => operation.op === 'add' && operation.componentId === 'rail-attachment');
            assert.ok(add?.op === 'add', id);
            const entities = [extension, { entityId: 'vehicle', revision: 0, components: [component('rail-attachment', add.data)] }];
            const savedEntities = entities.map(entity => ({ ...entity, components: entity.components.map(({ definitionAvailable, ...entry }) => entry) }));
            const document = parseNixieSceneV2DocumentV1(JSON.parse(JSON.stringify({ type: 'scene-v2', contractVersion: 1, entities: savedEntities })));
            const saved = document.entities[1]!.components[0]!.data;
            assert.equal(saved.fixedRail, rail.id);
            assert.equal(document.entities[0]!.components[2]!.data.startFixedRailEnd, endpoint.id);
            const path = parseNixieSimulationPathV1(saved.simulationPath);
            assert.deepEqual(path.sources, [extension.entityId]);
            assert.equal(path.drive?.manual?.passive === true, id !== 'trainengine');
            const across = ([px, py]: number[]) => (px! - x) * Math.cos(heading) + (py! - y) * Math.sin(heading);
            assert.ok(across(path.frames[0]!.position) < -100);
            assert.ok(across(path.frames.at(-1)!.position) > 100);
            assert.ok(path.drive?.manual && path.drive.manual.startDistance > 0
                && path.drive.manual.startDistance < path.frames.at(-1)!.distance);
        }
        assert.equal(snapVehicle('smalltrainengine', [extension]).transaction, undefined);
    });
}

test('each region with visible rails accepts an open-end extension and standard-gauge rolling stock', () => {
    for (const [id, dataset] of Object.entries(fixedRailData)) {
        const network = fixedRailNetwork(id);
        assert.equal(network?.rails.length, dataset.rails.length, id);
        const endpoint = network?.endpoints[0];
        assert.ok(endpoint, id);
        const [x, y, elevation] = endpoint.point;
        const rotation = endpoint.rotation;
        const extension = track('railtrackspline');
        Object.assign(extension.components[0]!.data, { x, y, rotation });
        extension.components[1]!.data.elevation = elevation;
        const context = { contractVersion: 1 as const, entities: [extension], settings: { [`foxhole.map.fixedRails.${id}`]: true } };
        assert.deepEqual(nearbyFixedRailRegions(context, x, y), [id]);
        const result = finalizeFoxholeSceneV2Transform({ contractVersion: 1, entityId: extension.entityId,
            transform: { x, y, rotation, scaleX: 1, scaleY: 1 }, interaction: 'placement', context,
            geometryGesture: { phase: 'commit', handleId: 'start', worldPoint: { x, y, z: elevation }, hoveredEntityIds: [], snappingEnabled: true } });
        assert.ok(result.transaction?.operations.some(op => op.op === 'patch' && op.set?.startFixedRailEnd === endpoint.id), id);

        const rail = network!.rails.find(candidate => candidate.id === endpoint.railId)!;
        const [x0, y0, z0] = rail.points[Math.floor(rail.points.length / 2)]!;
        for (const asset of ['trainengine', 'trainflatbed']) {
            const proposal = request(asset, []);
            proposal.context.settings = context.settings;
            Object.assign(proposal.transform, { x: x0, y: y0, rotation });
            proposal.context.entities[0]!.components.push(component('spatial-transform', { elevation: z0 + 11.52 }, 'nixie.core'));
            const snapped = finalizeFoxholeRailVehicleSnap(proposal);
            assert.ok(snapped.transaction?.operations.some(op => op.op === 'add' && op.componentId === 'rail-attachment'
                && typeof op.data.fixedRail === 'string' && op.data.fixedRail.startsWith(`${id}:`)), `${id} ${asset}`);
            delete proposal.context.settings;
            assert.equal(finalizeFoxholeRailVehicleSnap(proposal).transaction, undefined, `inactive ${id} ${asset}`);
        }
    }
});

test('the live socket setting gates a track-spline finalizer for each rail vehicle', () => {
    parseNixieExtensionManifestV1(manifest);
    const railVehicles = Object.entries(assets).filter(([, asset]) => asset.category === 'trains');
    for (const id of [...railVehicles.map(([id]) => id), 'largecrane']) {
        const finalizer = manifest.contributes.transformFinalizers.map(parseNixieTransformFinalizerV1)
            .find(item => item.match.data?.assetId === id);
        assert.ok(finalizer, id);
        assert.equal(finalizer.previewAware, true);
        assert.equal(finalizer.enabledSettingId, 'foxhole.viewport.socketSnapping');
        assert.equal(finalizer.candidateQuery.match.componentId, id.startsWith('train') ? 'asset' : 'spline-connector');
        assert.ok(matchesNixieTransformFinalizerV1(request(id, []).context.entities[0]!, finalizer));
    }
});

test('a small locomotive authors a shared drive for every small-gauge car', () => {
    const line = track('smallrailtrackspline', 'small-line');
    Object.assign(line.components.at(-1)!.data, { endX: 2000, maxLength: 2100 });
    const proposal = request('smalltrainengine', [line]);
    proposal.interaction = 'planar-translation';
    let station = 1000;
    Object.assign(proposal.transform, { x: station, y: 0, rotation: 0 });
    proposal.context.entities[0]!.components.push(component('rail-attachment', { rail: 'small-line', station, reversed: false }));
    let rear = Math.abs(railCouplers(assets.smalltrainengine!, 'small').find(port => port.point.x < 0)!.point.x);
    for (const id of ['smalltrainmaterial', 'smalltrainresource', 'smalltrainshipping', 'smalltrainliquid']) {
        const sockets = railCouplers(assets[id]!, 'small');
        station -= rear + sockets.find(port => port.point.x > 0)!.point.x + 1;
        rear = Math.abs(sockets.find(port => port.point.x < 0)!.point.x);
        proposal.context.entities.push({ entityId: id, revision: 1, components: [
            component('asset', { catalogId: 'foxhole.structures', assetId: id }),
            component('rail-attachment', { rail: 'small-line', station, reversed: false }),
            component('transform', { x: station, y: 0, rotation: 0 }, 'nixie.core'),
        ] });
    }
    const result = finalizeFoxholeRailVehicleSnap(proposal);
    const paths = result.transaction?.operations.flatMap(operation => operation.op === 'patch' && operation.set?.simulationPath
        ? [parseNixieSimulationPathV1(operation.set.simulationPath)] : []);
    assert.equal(paths?.length, 5);
    for (const path of paths!) {
        assert.equal(path.drive?.leader, 'vehicle');
        assert.ok(path.frames.at(-1)!.position[0] > path.frames[0]!.position[0] + 100);
    }
});

test('ordinary train drag previews snap to the committed pose without rebuilding the drive', () => {
    const proposal = { ...request('trainengine', [track('railtrackspline')]), interaction: 'planar-translation' as const };
    const committed = finalizeFoxholeRailVehicleSnap(proposal);
    const preview = finalizeFoxholeRailVehicleSnap({ ...proposal, preview: true });
    assert.deepEqual(preview.transform, committed.transform);
    assert.equal(preview.transform.y, 0);
    assert.equal(preview.transaction, undefined);
    assert.ok(committed.transaction?.operations.some(operation => operation.op === 'add' && operation.data.simulationPath));
});

test('the Black Bolt vents from both front cylinders at idle and on departure', () => {
    const engine = request('trainengine', []).context.entities[0]!;
    const render = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(engine));
    const effects = render.spatial?.simulationEffects ?? [];
    for (const side of ['left', 'right'] as const) {
        const idle = effects.find(effect => effect.id === `cylinder-idle-${side}`)!;
        const start = effects.find(effect => effect.id === `cylinder-start-${side}`)!;
        assert.equal(idle.trigger, 'idle');
        assert.equal(start.trigger, 'start');
        assert.deepEqual(start.point, idle.point);
        assert.equal(Math.sign(start.point[1]), side === 'left' ? -1 : 1);
        assert.equal(start.particle?.velocitySpace, 'entity');
        assert.equal(Math.sign(start.particle!.velocity[1]), Math.sign(start.point[1]));
        assert.ok(start.particle!.opacity > idle.particle!.opacity);
        assert.ok(start.particle!.endSize > idle.particle!.endSize);
    }
});

test('the Black Bolt pins the crawl pitch when the host and SDK support it', () => {
    const engine = request('trainengine', []).context.entities[0]!;
    const base = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(engine))
        .spatial!.simulationEffects!.find(effect => effect.id === 'exhaust')!;
    assert.equal(Object.hasOwn(base.sound!, 'distancePlayback'), false);
    const tuned = { ...base, sound: { ...base.sound!, distancePlayback: {
        referenceSpeed: 3.4 * base.interval!, rate: 1.2, variation: 0, minDuration: .85, maxDuration: .85,
    } } };
    let expected = base;
    try {
        expected = parseNixieSimulationEffectsV1([tuned])[0]!;
    } catch {
        // The released SDK still needs to be able to build and test the fallback.
    }
    const render = renderFoxholeSceneV2Entity(engine, { contractVersion: 1, entities: [engine],
        settings: { 'nixie.scene.distanceSoundPlayback': true } });
    assert.deepEqual(parseNixieExtensionRenderPlanV1(render).spatial!.simulationEffects!
        .find(effect => effect.id === 'exhaust'), expected);
});

test('the Black Bolt offers a repeating bell alongside its one-shot whistle', () => {
    const engine = request('trainengine', []).context.entities[0]!;
    const readCues = (supported: boolean) => parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(engine, {
        contractVersion: 1, entities: [engine], settings: { 'nixie.scene.loopedSimulationCue': supported },
    })).spatial!.simulationEffects!.filter(effect => effect.trigger === 'cue');
    const [whistle, bell] = readCues(false);
    assert.equal(whistle?.id, 'whistle');
    assert.equal(bell?.id, 'bell');
    const loopingBell = { ...bell!, loop: true, interval: 1.25, sound: { ...bell!.sound!, resourceId: 'foxhole.audio.steam-bell-loop', gain: .28 } };
    let expected = bell;
    try {
        expected = parseNixieSimulationEffectsV1([loopingBell])[0]!;
    } catch {
        // Older SDKs retain the original one-shot.
    }
    assert.deepEqual(readCues(true), [whistle, expected]);
});

test('the cruise mix adds wheel sound to the Black Bolt and unpowered cars', () => {
    const effects = (assetId: string, supported: boolean) => {
        const entity = request(assetId, []).context.entities[0]!;
        return parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity, {
            contractVersion: 1, entities: [entity], settings: { 'nixie.scene.motionSoundMix': supported },
        })).spatial?.simulationEffects ?? [];
    };
    const rolling = { id: 'rail-rolling', point: [0, 0, 12], trigger: 'moving',
        sound: { resourceId: 'foxhole.audio.rail-rolling', gain: .22, range: 1400,
            speedGain: { startSpeed: 16, endSpeed: 176, startGain: 0, endGain: 1 } } };
    let declared;
    try {
        declared = parseNixieSimulationEffectsV1([rolling])[0];
    } catch {
        // An older host or SDK still renders rail vehicles without the new mix.
    }
    const engine = effects('trainengine', true);
    const wagon = effects('trainhospital', true);
    assert.deepEqual(wagon.find(effect => effect.id === rolling.id), declared);
    assert.equal(engine.find(effect => effect.id === rolling.id)?.sound?.gain, declared && .5);
    assert.equal(Object.hasOwn(engine.find(effect => effect.id === 'exhaust')!.sound!, 'speedGain'), !!declared);
    assert.equal(effects('trainhospital', false).some(effect => effect.id === rolling.id), false);
});

test('re-snapping a Black Bolt refreshes an older parked flatbed on its running line', () => {
    const main = track('railtrackspline', 'main');
    main.components.at(-1)!.data.endX = 2200;
    const flatbed: NixieComponentEntitySnapshotV1 = { entityId: 'old-flatbed', revision: 1, components: [
        component('asset', { catalogId: 'foxhole.structures', assetId: 'trainflatbed' }),
        component('transform', { x: 1030, y: 0, rotation: 0 }, 'nixie.core'),
        component('rail-attachment', { rail: 'main', station: 1030, reversed: false,
            simulationCollider: { center: [0, 0, 50], halfExtents: [135, 50, 50] } }),
    ] };
    const proposal = request('trainengine', [main, flatbed]);
    Object.assign(proposal.transform, { x: 600, y: 0, rotation: 0 });
    const result = finalizeFoxholeRailVehicleSnap({ ...proposal, interaction: 'planar-translation' });
    const patch = result.transaction?.operations.find(operation => operation.entityId === flatbed.entityId
        && operation.componentId === 'rail-attachment');
    if (patch?.op !== 'patch') assert.fail('Expected the parked flatbed attachment to be refreshed');
    const path = parseNixieSimulationPathV1(patch.set?.simulationPath);
    assert.equal(path.drive?.manual?.passive, true);
    assert.deepEqual(path.sources, ['main']);
    assert.ok(patch.set?.simulationCollider);
    assert.equal(patch.set?.station, undefined);
});

test('every Locomotives asset snaps only to its own gauge', () => {
    for (const [id, asset] of Object.entries(assets)) {
        if (asset.category !== 'trains') continue;
        const small = id.startsWith('smalltrain');
        const own = track(small ? 'smallrailtrackspline' : 'railtrackspline');
        const wrong = track(small ? 'railtrackspline' : 'smallrailtrackspline');
        assert.equal(finalizeFoxholeRailVehicleSnap(request(id, [own])).transform.elevation, 32 + (small ? 20 : 36) * 0.32, id);
        assert.equal(finalizeFoxholeRailVehicleSnap(request(id, [wrong])).transform.elevation, undefined, id);
    }
});

test('split top-down train cars keep the body fixed and steer each bogie on a curve', t => {
    const rail = track('railtrackspline');
    Object.assign(rail.components.at(-1)!.data, { endX: 1050, endY: 700, endRotation: Math.PI / 2 });
    for (const assetId of ['trainhospital', 'trainlrartillery']) {
        const metadata = assets[assetId]!;
        const previous = metadata.renderLayers;
        t.after(() => { metadata.renderLayers = previous; });
        const parts = [...foxholeRailVehicleBogies[assetId]!, { nodeName: 'rail-body', pivot: 0 }];
        metadata.renderLayers = Object.fromEntries(parts.map(({ nodeName, pivot }) => [nodeName, {
            resourceId: `foxhole.visual.${assetId}-layer-${nodeName}`,
            width: 120, height: 100, anchorX: .5, anchorY: .5, offsetX: pivot * 32 + 8, offsetY: 0,
        }]));
        const proposal = request(assetId, [rail]);
        const vehicle = proposal.context.entities[0]!;
        vehicle.components.push(component('rail-attachment', { rail: 'track', station: 650, reversed: false }));
        const { x, y, rotation, elevation } = finalizeFoxholeRailVehicleSnap({
            ...proposal, interaction: 'transform', followedEntityId: 'track',
        }).transform;
        Object.assign(vehicle.components[1]!.data, { x, y, rotation });
        vehicle.components.push(component('spatial-transform', { elevation: elevation! }, 'nixie.core'));

        const context = { contractVersion: 1 as const, entities: proposal.context.entities };
        const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(vehicle, context));
        assert.equal(plan.root.kind, 'group');
        const nodes = plan.root.children.filter(node => parts.some(part => part.nodeName === node.id));
        assert.deepEqual(nodes.map(node => node.id), ['rail-bogie-front', 'rail-bogie-rear', 'rail-body']);
        const body = nodes[2]!;
        const bogieLane = foxholeRenderLane(FOXHOLE_STRUCTURE_RENDER_LANES.railBogie);
        for (const bogie of nodes.slice(0, 2)) {
            assert.deepEqual({ laneId: bogie.laneId, laneOrder: bogie.laneOrder }, bogieLane);
        }
        assert.equal(body.laneId, FOXHOLE_STRUCTURE_RENDER_LANES.vehicle.laneId);
        assert.ok(bogieLane.laneOrder > FOXHOLE_HEIGHT_RENDER_LANES.rail.laneOrder);
        assert.ok(bogieLane.laneOrder < body.laneOrder!);
        assert.ok(bogieLane.laneOrder < resolveFoxholeAssetHeightLane('trainengine')!.laneOrder);
        assert.equal(nodes[2]!.rotation, 0);
        assert.equal(nodes[2]!.x, 8);
        assert.ok(Math.abs(nodes[0]!.rotation!) > 0.03);
        assert.ok(Math.abs(nodes[1]!.rotation!) > 0.03);
        assert.ok(nodes[0]!.rotation! * nodes[1]!.rotation! < 0);
        assert.ok(!plan.root.children.some(node => node.id === 'building-texture'));

        const animated = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(vehicle,
            { ...context, settings: { 'nixie.scene.planarModelMotion': true } })).root.children;
        for (const bogie of foxholeRailVehicleBogies[assetId]!) {
            const group = animated.find(node => node.id === bogie.nodeName)!;
            assert.deepEqual({ laneId: group.laneId, laneOrder: group.laneOrder }, bogieLane);
            const presentation = { contractVersion: 1 as const,
                simulationModelNode: { nodeName: bogie.nodeName, unitsPerMetre: 32, restX: bogie.pivot * 32, restY: 0 } };
            try {
                parseNixieRenderPresentationV1(presentation);
            } catch {
                assert.equal(group.kind, 'sprite');
                continue;
            }
            assert.equal(group.kind, 'group');
            assert.deepEqual(group.presentation, presentation);
            assert.equal(group.children[0]?.x, 8, 'artwork is positioned relative to the pivot');
        }
        assert.equal(animated.find(node => node.id === 'rail-body')?.kind, 'sprite');

        delete metadata.renderLayers['rail-bogie-rear'];
        const fallback = renderFoxholeSceneV2Entity(vehicle, context).root;
        assert.equal(fallback.kind, 'group');
        assert.ok(fallback.children.some(node => node.id === 'building-texture'));
        assert.ok(fallback.children.every(node => !parts.some(part => part.nodeName === node.id)));
    }
});

test('the large locomotive supplies a manual drive over a straight-to-curved rail joint', () => {
    const approach = track('railtrackspline', 'approach');
    const bend = track('railtrackspline', 'bend');
    Object.assign(approach.components[0]!.data, { x: -400 });
    Object.assign(bend.components.at(-1)!.data, { endX: 650, endY: 240, endRotation: 0.6,
        startAttachmentNodeId: 'approach', startAttachmentSocketName: 'FrontSocket' });
    const proposal = request('trainengine', [approach, bend]);
    Object.assign(proposal.transform, { x: -220, y: 0, rotation: 0 });
    const result = finalizeFoxholeRailVehicleSnap(proposal);
    const operation = result.transaction?.operations[0];
    if (operation?.op !== 'add') assert.fail('Expected a snapped rail attachment');
    const path = parseNixieSimulationPathV1(operation.data.simulationPath);
    assert.deepEqual(path.sources, ['approach', 'bend']);
    assert.equal(path.drive?.leader, 'vehicle');
    assert.ok(path.drive.manual);
    const wheelSpan = parseNixieSimulationColliderV1(operation.data.simulationCollider).wheelSpan!;
    assert.ok(wheelSpan[0] < -100 && wheelSpan[1] > 78);
    assert.equal(path.frames.find(frame => frame.distance === path.drive!.manual!.startDistance)?.position[0], -220);
    assert.ok(path.frames.at(-1)!.position[1] > 50);
    const straddling = path.frames.find(frame => frame.position[0] > 20 && frame.position[0] < 80);
    assert.ok(straddling, 'the chassis crosses the joint while its rear wheel contact remains on the approach');
    const rearIndex = path.modelNodes!.indexOf('rail-bogie-rear') * 6;
    const rear = straddling.modelOffsets!.slice(rearIndex, rearIndex + 6);
    const [x, y] = straddling.position;
    const along = (-1.92332 + rear[0]! - 1.3397 * Math.cos(rear[4]!)) * 32;
    const lateral = (rear[2]! + 1.3397 * Math.sin(rear[4]!)) * 32;
    const contactX = x + Math.cos(straddling.heading) * along - Math.sin(straddling.heading) * lateral;
    const contactY = y + Math.sin(straddling.heading) * along + Math.cos(straddling.heading) * lateral;
    assert.ok(contactX < 0 && Math.abs(contactY) < 0.7, JSON.stringify({ contactX, contactY }));
    assert.ok(path.frames.some(frame => Math.abs(frame.modelOffsets![rearIndex + 4]!) > 0.04));
});

test('Tempest playback keeps both bogies on separate rails while crossing the joint', () => {
    const approach = track('railtrackspline', 'approach');
    const bend = track('railtrackspline', 'bend');
    Object.assign(approach.components[0]!.data, { x: -900 });
    Object.assign(approach.components.at(-1)!.data, { endX: 900 });
    Object.assign(bend.components.at(-1)!.data, { endX: 980, endY: 260, endRotation: 0.58,
        startAttachmentNodeId: 'approach', startAttachmentSocketName: 'FrontSocket' });
    const proposal = request('trainlrartillery', [approach, bend]);
    Object.assign(proposal.transform, { x: -520, y: 0, rotation: 0 });
    const operation = finalizeFoxholeRailVehicleSnap(proposal).transaction?.operations[0];
    if (operation?.op !== 'add') assert.fail('Expected a snapped rail attachment');
    const path = parseNixieSimulationPathV1(operation.data.simulationPath);
    assert.deepEqual(path.sources, ['approach', 'bend']);
    assert.equal(path.drive?.manual?.passive, true);
    assert.equal(path.frames.find(frame => frame.distance === path.drive?.manual?.startDistance)?.position[0], -520);
    const frame = path.frames.find(frame => frame.position[0] > 20 && frame.position[0] < 80);
    assert.ok(frame);
    const centerlines = [
        [{ x: -900, y: 0 }, { x: 0, y: 0 }],
        sampleFoxholeSceneV2Connector(bend.components.at(-1)!.data as unknown as FoxholeSceneV2SplineConnectorData,
            assets.railtrackspline).points,
    ];
    const railsUnderWheels = new Set<number>();
    for (const bogie of foxholeRailVehicleBogies.trainlrartillery!) {
        const node = path.modelNodes?.indexOf(bogie.nodeName) ?? -1;
        assert.ok(node >= 0);
        const pose = { translation: frame.modelOffsets!.slice(node * 6, node * 6 + 3),
            rotation: frame.modelOffsets!.slice(node * 6 + 3, node * 6 + 6) };
        assert.ok(Math.abs(pose.rotation[1]) > 0.02);
        for (const axle of bogie.wheelOffsets) {
            const [x, y] = frame.position;
            const along = 32 * (bogie.pivot + pose.translation[0] + Math.cos(pose.rotation[1]) * axle);
            const lateral = 32 * (pose.translation[2] - Math.sin(pose.rotation[1]) * axle);
            const contact = { x: x + Math.cos(frame.heading) * along - Math.sin(frame.heading) * lateral,
                y: y + Math.sin(frame.heading) * along + Math.cos(frame.heading) * lateral };
            const distances = centerlines.map(points => Math.min(...points.slice(1)
                .map((end, i) => nearestPointOnSegment(contact, points[i]!, end).distance)));
            const closest = Math.min(...distances);
            assert.ok(closest < 0.7, `${bogie.nodeName} axle was ${closest} units off the rail`);
            railsUnderWheels.add(distances.indexOf(closest));
        }
    }
    assert.equal(railsUnderWheels.size, 2);
});

test('a turnout along an open line bakes matching alternate poses for both vehicles', () => {
    const main = track('railtrackspline', 'main');
    Object.assign(main.components[0]!.data, { x: -1400 });
    Object.assign(main.components.at(-1)!.data, { endX: 3600, maxLength: 4000 });
    const branch = track('railtrackspline', 'branch');
    Object.assign(branch.components[0]!.data, { x: 400 });
    Object.assign(branch.components.at(-1)!.data, { endX: 1300, endY: 360, endRotation: .4,
        startAttachmentNodeId: 'main', startAttachmentSocketName: 'RailPath-5000-f' });
    const proposal = request('trainengine', [main, branch]);
    proposal.context.entities.push({ entityId: 'cannon', revision: 1, components: [
        component('asset', { catalogId: 'foxhole.structures', assetId: 'trainlrartillery' }),
        component('transform', { x: -840, y: 0, rotation: 0 }, 'nixie.core'),
        component('rail-attachment', { rail: 'main', station: 560, reversed: false }),
    ] });
    Object.assign(proposal.transform, { x: -288, y: 0, rotation: 0 });
    proposal.geometryGesture = { handleId: 'product-placement-port', phase: 'commit', snappingEnabled: true,
        worldPoint: { x: -477, y: 0, z: 77.44 }, hoveredEntityIds: ['cannon'] };
    const result = parseNixieTransformFinalizeResultV1(finalizeFoxholeRailVehicleSnap(proposal));
    const routes = result.transaction?.operations.flatMap(operation => operation.op === 'add'
        && operation.componentId === 'rail-simulation-routing' ? parseNixieSimulationRoutingV1(operation.data.simulationRouting) : []) ?? [];
    assert.equal(routes.length, 2);
    const [engine, cannon] = routes;
    assert.equal(engine!.id, 'branch');
    assert.deepEqual(engine!.start, cannon!.start);
    assert.equal(engine!.start?.occupancyRadius, 48);
    assert.equal(engine!.start?.id, 'main:RailPath-5000-f');
    assert.equal(engine!.end, undefined);
    assert.equal(engine!.frames.at(-1)!.distance, cannon!.frames.at(-1)!.distance);
    assert.ok(engine!.frames.at(-1)!.position[1] > 200);
    assert.ok(cannon!.frames.at(-1)!.position[1] > 40);
});

test('a Black Bolt added at the Tempest front coupler drives both vehicles through a curve', () => {
    const approach = track('railtrackspline', 'approach');
    const bend = track('railtrackspline', 'bend');
    Object.assign(approach.components[0]!.data, { x: -1300 });
    Object.assign(approach.components.at(-1)!.data, { endX: 1300 });
    Object.assign(bend.components.at(-1)!.data, { endX: 980, endY: 290, endRotation: .55,
        startAttachmentNodeId: 'approach', startAttachmentSocketName: 'FrontSocket' });
    const proposal = request('trainengine', [approach, bend]);
    const cannon = { entityId: 'cannon', revision: 1, components: [
        component('asset', { catalogId: 'foxhole.structures', assetId: 'trainlrartillery' }),
        component('transform', { x: -740, y: 0, rotation: 0 }, 'nixie.core'),
        component('rail-attachment', { rail: 'approach', station: 560, reversed: false }),
    ] };
    proposal.context.entities.push(cannon);
    Object.assign(proposal.transform, { x: -188, y: 0, rotation: 0 });
    proposal.geometryGesture = { handleId: 'product-placement-port', phase: 'commit', snappingEnabled: true,
        worldPoint: { x: -377, y: 0, z: 77.44 }, hoveredEntityIds: ['cannon'] };
    const result = finalizeFoxholeRailVehicleSnap(proposal);
    const [engine, trailer] = result.transaction?.operations ?? [];
    if (engine?.op !== 'add' || trailer?.op !== 'patch') assert.fail('Expected both coupled attachments');
    assert.ok(engine.data.simulationCollider);
    assert.ok(trailer.set?.simulationCollider);
    const enginePath = parseNixieSimulationPathV1(engine.data.simulationPath);
    const cannonPath = parseNixieSimulationPathV1(trailer.set?.simulationPath);
    assert.deepEqual(enginePath.drive, cannonPath.drive);
    assert.equal(enginePath.drive?.leader, 'vehicle');
    assert.ok(enginePath.drive?.manual && enginePath.drive.manual.startDistance > 0);
    assert.equal(enginePath.drive.manual.loop, false);
    assert.equal(enginePath.frames.length, cannonPath.frames.length);
    assert.ok(enginePath.frames.at(-1)!.position[1] > 40);
    const engineRear = railCouplers(assets.trainengine!, 'standard').find(port => port.name === 'RearCoupler')!.point;
    const cannonFront = railCouplers(assets.trainlrartillery!, 'standard').find(port => port.name === 'FrontCoupler')!.point;
    for (const [index, lead] of enginePath.frames.entries()) {
        const trailing = cannonPath.frames[index]!;
        assert.equal(lead.distance, trailing.distance);
        const dx = lead.position[0] + engineRear.x * Math.cos(lead.heading)
            - trailing.position[0] - cannonFront.x * Math.cos(trailing.heading);
        const dy = lead.position[1] + engineRear.x * Math.sin(lead.heading)
            - trailing.position[1] - cannonFront.x * Math.sin(trailing.heading);
        const gap = Math.hypot(dx, dy);
        const slack = lead.distance === enginePath.drive.manual.startDistance ? .11 : .3 * 32 + .02;
        assert.ok(Math.abs(gap - 16) < slack, `coupler gap at station ${lead.distance}: ${gap}`);
        assert.equal(trailing.modelOffsets?.length, cannonPath.modelNodes!.length * 6);
    }
});

test('an existing mixed eleven-vehicle train is rebuilt as one drive with its original facing and spacing', () => {
    const main = track('railtrackspline', 'main');
    Object.assign(main.components.at(-1)!.data, { endX: 9500, maxLength: 10000 });
    const branch = track('railtrackspline', 'branch');
    Object.assign(branch.components[0]!.data, { x: 6650 });
    Object.assign(branch.components.at(-1)!.data, { endX: 4800, endY: 950, endRotation: .3, maxLength: 5200,
        startAttachmentNodeId: 'main', startAttachmentSocketName: 'RailPath-7000-f' });
    const proposal = request('trainengine', [main, branch]);
    proposal.interaction = 'planar-translation';
    Object.assign(proposal.transform, { x: 4100, y: 0, rotation: 0 });
    const subject = proposal.context.entities[0]!;
    subject.components.push(component('rail-attachment', { rail: 'main', station: 4100, reversed: false }));
    const cars = ['traincoal', 'trainflatbed', 'trainflatbed', 'trainflatbed', 'traincombatcarc',
        'trainhospital', 'trainlrartillery', 'traininfantry', 'traincombatcarw', 'traincaboose'];
    let station = 4100;
    let rear = 188.8;
    for (const [index, car] of cars.entries()) {
        const reversed = car === 'trainhospital';
        const sockets = railCouplers(assets[car]!, 'standard');
        const towardEngine = sockets.find(socket => reversed ? socket.point.x < 0 : socket.point.x > 0)!;
        station -= rear + Math.abs(towardEngine.point.x) + 2;
        rear = Math.abs(sockets.find(socket => socket !== towardEngine)!.point.x);
        proposal.context.entities.push({ entityId: `car-${index}`, revision: 1, components: [
            component('asset', { catalogId: 'foxhole.structures', assetId: car }),
            component('rail-attachment', { rail: 'main', station, reversed }),
            component('transform', { x: station, y: 0, rotation: reversed ? Math.PI : 0 }, 'nixie.core'),
        ] });
    }
    // Same gauge and track, with a free gap to the last coupler.
    proposal.context.entities.push({ entityId: 'parked-car', revision: 1, components: [
        component('asset', { catalogId: 'foxhole.structures', assetId: 'traincaboose' }),
        component('rail-attachment', { rail: 'main', station: station - 420, reversed: false }),
    ] });
    const result = parseNixieTransformFinalizeResultV1(finalizeFoxholeRailVehicleSnap(proposal));
    const operations = result.transaction!.operations.filter(operation => operation.componentId === 'rail-attachment');
    assert.equal(operations.length, 11);
    const routes = result.transaction!.operations.flatMap(operation =>
        operation.op === 'add' && operation.componentId === 'rail-simulation-routing'
            ? parseNixieSimulationRoutingV1(operation.data.simulationRouting) : []);
    assert.equal(routes.length, 11);
    for (const route of routes) {
        assert.deepEqual(route.start, routes[0]!.start);
        assert.equal(route.frames.at(-1)!.distance, routes[0]!.frames.at(-1)!.distance);
        assert.ok(route.frames.at(-1)!.position[1] > 30);
    }
    const paths = operations.map(operation => {
        assert.equal(operation.op, 'patch');
        const path = parseNixieSimulationPathV1(operation.set!.simulationPath);
        return [operation.entityId, path] as const;
    });
    const leader = paths.find(([id]) => id === 'vehicle')![1];
    assert.equal(leader.speed, 8 * 32);
    assert.ok(leader.speed / leader.drive!.acceleration < 21, 'the full train should reach top speed in about 20 seconds');
    const start = leader.drive!.manual!.startDistance;
    for (const [id, path] of paths) {
        assert.deepEqual(path.drive, leader.drive);
        assert.equal(path.frames.at(-1)!.distance, leader.frames.at(-1)!.distance);
        assert.equal(path.sources.length, 11);
        const atRest = path.frames.find(frame => frame.distance === start)!;
        const entity = proposal.context.entities.find(entry => entry.entityId === id)!;
        const parked = entity.components.find(entry => entry.componentId === 'rail-attachment')!.data;
        assert.ok(Math.abs(atRest.position[0] - Number(parked.station)) < .001);
        assert.ok(Math.abs(Math.cos(atRest.heading) - (parked.reversed ? -1 : 1)) < 1e-8);
        assert.ok(path.frames.at(-1)!.position[0] > atRest.position[0] + 100);
        const assetId = entity.components.find(entry => entry.componentId === 'asset')!.data.assetId;
        if (assetId === 'trainhospital' || assetId === 'trainlrartillery') {
            const routing = result.transaction!.operations.find(operation => operation.entityId === id
                && operation.componentId === 'rail-simulation-routing');
            assert.equal(routing?.op, 'add');
            const branchPath = parseNixieSimulationRoutingV1(routing.data.simulationRouting)[0]!;
            const front = branchPath.modelNodes!.indexOf('rail-bogie-front');
            const rear = branchPath.modelNodes!.indexOf('rail-bogie-rear');
            assert.ok(front >= 0 && rear >= 0);
            assert.ok(branchPath.frames.some(frame => frame.modelOffsets![front * 6 + 4]! * frame.modelOffsets![rear * 6 + 4]! < -0.0001),
                `${assetId} must bring both independent bogie angles into playback on the curve`);
        }
    }

    for (const operation of operations) {
        assert.equal(operation.op, 'patch');
        const entity = proposal.context.entities.find(entry => entry.entityId === operation.entityId)!;
        Object.assign(entity.components.find(entry => entry.componentId === 'rail-attachment')!.data, operation.set);
    }
    const detached = finalizeFoxholeRailVehicleSnap({ ...proposal, entityId: 'car-1',
        transform: { ...proposal.transform, y: 150 } }).transaction!.operations;
    assert.ok(detached.some(operation => operation.entityId === 'car-1' && operation.op === 'remove'));
    const remaining = detached.find(operation => operation.entityId === 'vehicle');
    assert.equal(remaining?.op, 'patch');
    assert.deepEqual(parseNixieSimulationPathV1(remaining.set!.simulationPath).sources, ['main', 'car-0']);
    const parked = detached.filter(operation => operation.op === 'patch' && operation.componentId === 'rail-attachment'
        && operation.set?.simulationPath && parseNixieSimulationPathV1(operation.set.simulationPath).drive?.manual?.passive);
    assert.equal(parked.length, 8);
});

test('coupler placement advances from the existing car along a curved rail', () => {
    const curved = track('railtrackspline');
    Object.assign(curved.components.at(-1)!.data, { endX: 450, endY: 300, endRotation: Math.PI / 2 });
    const proposal = request('trainflatbed', [curved, track('smallrailtrackspline', 'wrong')]);
    const height = 32 + 36 * 0.32;
    proposal.transform = { ...proposal.transform, x: 260, y: 0, rotation: 0 };
    proposal.geometryGesture = { phase: 'preview', handleId: 'product-placement-port', snappingEnabled: true,
        worldPoint: { x: 0, y: 0, z: height }, hoveredEntityIds: [] };
    const result = finalizeFoxholeRailVehicleSnap(proposal).transform;
    assert.equal(result.elevation, height);
    assert.ok(result.y > 10 && result.x < 260, JSON.stringify(result));
    assert.ok(result.rotation! > 0.1);
    proposal.transform.x = 2000;
    assert.equal(finalizeFoxholeRailVehicleSnap(proposal).transform.elevation, undefined);
});

test('coupler placement rejects a Tempest with an unsupported axle or an occupied berth', () => {
    const rail = track('railtrackspline');
    const spline = rail.components.at(-1)!.data;
    Object.assign(spline, { endX: 900, maxLength: 2500 });
    const height = 32 + 36 * .32;
    const parked = (entityId: string, x: number): NixieComponentEntitySnapshotV1 => ({
        entityId, revision: 1, components: [
            component('asset', { assetId: 'trainflatbed', catalogId: 'foxhole.structures' }),
            component('transform', { x, y: 0, rotation: 0 }, 'nixie.core'),
            component('spatial-transform', { elevation: height }, 'nixie.core'),
            component('rail-attachment', { rail: rail.entityId, station: x, reversed: false }),
        ],
    });
    const anchor = parked('anchor', 300);
    const proposal = request('trainlrartillery', [rail, anchor]);
    Object.assign(proposal.transform, { x: 850, y: 0, rotation: 0 });
    const place = (phase: 'preview' | 'commit') => finalizeFoxholeRailVehicleSnap({
        ...proposal, geometryGesture: { phase, handleId: 'product-placement-port', snappingEnabled: true,
            worldPoint: { x: 300, y: 0, z: height }, hoveredEntityIds: [anchor.entityId] },
    });
    assert.equal(place('preview').transform.elevation, undefined);
    assert.equal(place('commit').transaction, undefined);

    spline.endX = 1500;
    assert.equal(place('preview').transform.elevation, height);
    const valid = place('commit');
    assert.equal(valid.transform.elevation, height);
    assert.ok(valid.transaction?.operations.some(operation => operation.op === 'add' && operation.entityId === proposal.entityId
        && operation.componentId === 'rail-attachment'));

    proposal.context.entities.push(parked('blocker', 900));
    assert.equal(place('preview').transform.elevation, undefined);
    assert.equal(place('commit').transaction, undefined);
});

test('the axle chord keeps both axle centers on a curve at the authored spacing', () => {
    const radius = 180, wheelbase = 163.2;
    const sample = (distance: number): [number, number, number] => [
        radius * Math.sin(distance / radius), radius * (1 - Math.cos(distance / radius)), 42,
    ];
    const pose = fitFoxholeRailWheelbase(wheelbase, sample);
    assert.ok(pose);
    assert.ok(pose.point[1] > 15, 'a tangent centered on the spline leaves both axles outside the curve');
    for (const direction of [-1, 1]) {
        const axleX = pose.point[0] + direction * wheelbase / 2 * Math.cos(pose.heading);
        const axleY = pose.point[1] + direction * wheelbase / 2 * Math.sin(pose.heading);
        assert.ok(Math.abs(Math.hypot(axleX, axleY - radius) - radius) < 0.1);
    }
});

test('large cranes snap to crane rails and locomotives ignore them', () => {
    const craneTrack = track('cranerailtrackspline');
    const pose = finalizeFoxholeRailVehicleSnap(request('largecrane', [track('railtrackspline', 'wrong', 10), craneTrack])).transform;
    assert.equal(pose.x, 173);
    assert.equal(pose.y, 0);
    // The crane's model is grounded at its wheels. The track mesh puts the
    // running surface 26.506 cm above the spline origin.
    const railHeight = 26.506 * 0.32;
    assert.ok(Math.abs(pose.elevation! - (32 + railHeight)) < 0.001);
    for (const id of ['trainengine', 'smalltrainengine']) {
        assert.deepEqual(finalizeFoxholeRailVehicleSnap(request(id, [craneTrack])).transform, { x: 173, y: 10 });
    }
    assert.deepEqual(finalizeFoxholeRailVehicleSnap(request('largecrane', [track('smallrailtrackspline')])).transform, { x: 173, y: 10 });
});

test('an attached large crane keeps its running height when the track is raised', () => {
    const craneTrack = track('cranerailtrackspline');
    const proposal = request('largecrane', [craneTrack]);
    const attachment = finalizeFoxholeRailVehicleSnap(proposal).transaction?.operations[0];
    if (attachment?.op !== 'add') assert.fail('Expected a crane rail attachment.');
    proposal.context.entities[0]!.components.push(component('rail-attachment', attachment.data));
    craneTrack.components.find(component => component.componentId === 'spatial-transform')!.data.elevation = 80;
    const pose = finalizeFoxholeRailVehicleSnap({ ...proposal, interaction: 'transform', followedEntityId: craneTrack.entityId }).transform;
    assert.ok(Math.abs(pose.elevation! - (80 + 26.506 * 0.32)) < 0.001);
});

test('locomotives align with their gauge even when a closer track has the wrong gauge', () => {
    for (const [asset, matching, wrong] of [
        ['trainengine', 'railtracksplinefoundation', 'smallrailtrackspline'],
        ['smalltrainengine', 'smallrailtracksplinebiarc', 'railtracksplinetown'],
    ] as const) {
        const proposal = request(asset, [track(wrong, 'wrong', 10), track(matching)]);
        const pose = finalizeFoxholeRailVehicleSnap(proposal).transform;
        assert.ok(Math.abs(pose.x - 173) < 1e-8);
        assert.ok(Math.abs(pose.y) < 1e-8);
        assert.equal(pose.elevation, 32 + (asset === 'smalltrainengine' ? 20 : 36) * 0.32);
        assert.ok(Math.abs(pose.rotation! - Math.PI) < 1e-8);
        assert.deepEqual(finalizeFoxholeRailVehicleSnap(request(asset, [track(wrong)])).transform, { x: 173, y: 10 });
    }
});

test('translation can snap at the end of a track and never alters explicit transforms or group moves', () => {
    const proposal = request('trainengine', [track('railtrackspline')]);
    proposal.transform.x = 408;
    assert.equal(finalizeFoxholeRailVehicleSnap({ ...proposal, interaction: 'planar-translation' }).transform.x, 400);
    const unchanged = { x: 408, y: 10 };
    assert.deepEqual(finalizeFoxholeRailVehicleSnap({ ...proposal, interaction: 'transform' }).transform, unchanged);
    assert.deepEqual(finalizeFoxholeRailVehicleSnap({ ...proposal, movingEntityIds: ['vehicle', 'other'] }).transform, unchanged);
});

test('rails remain selectable and do not contribute a product placement menu', () => {
    for (const key of ['railtracksplinefoundation', 'smallrailtrackspline', 'cranerailtrackspline']) {
        const entity = track(key);
        const plan = renderFoxholeSceneV2Entity(entity, { contractVersion: 1, entities: [entity],
            settings: { 'nixie.scene.productPlacementPorts': true, 'nixie.scene.pathPlacement': true } });
        assert.ok(plan.spatial);
        assert.equal(plan.selectionGeometry?.pathPlacement, undefined);
        assert.equal(plan.selectionGeometry?.productPlacementPorts, undefined);
    }
});

test('vehicle couplers offer all and only the matching gauge with per-car docking poses', () => {
    const vehicles = Object.entries(assets).filter(([, asset]) => asset.category === 'trains');
    for (const [id] of vehicles) {
        const entity = request(id, []).context.entities[0]!;
        const base = { contractVersion: 1 as const, entities: [entity] };
        const enabled = { ...base, settings: { 'nixie.scene.productPlacementPorts': true } };
        assert.equal(renderFoxholeSceneV2Entity(entity, base).selectionGeometry?.productPlacementPorts, undefined);
        const ports = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(entity, enabled)).selectionGeometry?.productPlacementPorts;
        assert.equal(ports?.length, 2, id);
        const compatible = vehicles.filter(([other]) => other.startsWith('smalltrain') === id.startsWith('smalltrain'))
            .map(([other]) => `asset.${other}`).sort();
        for (const port of ports!) {
            assert.equal(port.placementSound, 'foxhole.audio.coupler-clank');
            assert.deepEqual(Object.keys(port.products).sort(), compatible, id);
            const nextCenter = port.products[`asset.${id}`]!;
            assert.equal(Math.sign(nextCenter.x), Math.sign(port.point.x), id);
            assert.ok(Math.abs(nextCenter.x) > Math.abs(port.point.x), id);
            assert.equal(nextCenter.z, 0);
        }
    }
});

test('a snapped vehicle follows its saved station and facing after the rail moves and rotates', () => {
    const rail = track('railtrackspline');
    const proposal = request('trainengine', [rail]);
    const snap = finalizeFoxholeRailVehicleSnap(proposal);
    const add = snap.transaction?.operations[0];
    assert.equal(add?.op, 'add');
    if (add?.op !== 'add') assert.fail();
    assert.equal(add.data.rail, rail.entityId);
    assert.ok(Math.abs(Number(add.data.station) - 173) < 1e-8);
    assert.equal(add.data.reversed, true);
    proposal.context.entities[0]!.components.push(component('rail-attachment', add.data));

    Object.assign(rail.components[0]!.data, { x: 500, y: 600, rotation: Math.PI / 2 });
    Object.assign(rail.components[1]!.data, { elevation: 70 });
    const follow = finalizeFoxholeRailVehicleSnap({ ...proposal, followedEntityId: rail.entityId, interaction: 'transform' });
    assert.ok(Math.abs(follow.transform.x - 500) < 1e-8);
    assert.ok(Math.abs(follow.transform.y - 773) < 1e-8);
    assert.ok(Math.abs(follow.transform.rotation! - 3 * Math.PI / 2) < 1e-8);
    assert.equal(follow.transform.elevation, 70 + 36 * 0.32);
    assert.equal(follow.transaction, undefined);

    const detach = finalizeFoxholeRailVehicleSnap({ ...proposal, interaction: 'planar-translation',
        transform: { ...proposal.transform, x: -400, y: -400 } });
    assert.equal(detach.transaction?.operations[0]?.op, 'remove');
});

test('committing a connected rail edit rebakes the train path without rebuilding it during preview', () => {
    const approach = track('railtrackspline', 'approach');
    const extension = track('railtrackspline', 'extension');
    Object.assign(approach.components[0]!.data, { x: -1000 });
    Object.assign(approach.components.at(-1)!.data, { endX: 1000 });
    Object.assign(extension.components.at(-1)!.data, { endX: 1000,
        startAttachmentNodeId: 'approach', startAttachmentSocketName: 'FrontSocket' });
    const proposal = request('trainengine', [approach, extension]);
    Object.assign(proposal.transform, { x: -550, y: 0, rotation: 0 });
    const add = finalizeFoxholeRailVehicleSnap(proposal).transaction?.operations[0];
    if (add?.op !== 'add') assert.fail('Expected an initial rail attachment');
    const oldPath = parseNixieSimulationPathV1(add.data.simulationPath);
    assert.deepEqual(oldPath.sources, ['approach', 'extension']);
    proposal.context.entities[0]!.components.push(component('rail-attachment', add.data));

    Object.assign(extension.components[1]!.data, { elevation: 132 });
    const follow = { ...proposal, interaction: 'transform' as const, followedEntityId: 'approach' };
    assert.equal(finalizeFoxholeRailVehicleSnap({ ...follow, followPhase: 'preview' }).transaction, undefined);
    const patch = finalizeFoxholeRailVehicleSnap({ ...follow, followPhase: 'commit' }).transaction?.operations[0];
    if (patch?.op !== 'patch') assert.fail('Expected a rebuilt rail attachment');
    const path = parseNixieSimulationPathV1(patch.set?.simulationPath);
    assert.deepEqual(path.sources, oldPath.sources);
    assert.ok(path.frames.at(-1)!.position[2] > oldPath.frames.at(-1)!.position[2] + 20);
});

test('the Black Bolt can complete a loop larger than the local discovery radius', () => {
    const count = 36;
    const radius = 5100;
    const railId = (index: number) => `loop-${index}`;
    const point = (index: number) => {
        const angle = index % count * 2 * Math.PI / count;
        return { x: radius * Math.cos(angle), y: radius * Math.sin(angle), angle };
    };
    const rails = Array.from({ length: count }, (_, index) => {
        const rail = track('railtrackspline', railId(index));
        const start = point(index), end = point(index + 1);
        Object.assign(rail.components[0]!.data, { x: start.x, y: start.y });
        Object.assign(rail.components.at(-1)!.data, { endX: end.x - start.x, endY: end.y - start.y,
            startRotation: start.angle + Math.PI / 2, endRotation: end.angle + Math.PI / 2,
            startAttachmentNodeId: railId((index + count - 1) % count), startAttachmentSocketName: 'FrontSocket' });
        return rail;
    });
    const proposal = request('trainengine', rails);
    const middle = point(0.5);
    Object.assign(proposal.transform, { x: middle.x, y: middle.y, rotation: middle.angle + Math.PI / 2 });
    const add = finalizeFoxholeRailVehicleSnap(proposal).transaction?.operations[0];
    if (add?.op !== 'add') assert.fail('Expected a rail attachment');
    const path = parseNixieSimulationPathV1(add.data.simulationPath);
    assert.equal(path.drive?.manual?.loop, true);
    assert.equal(path.sources?.length, count);
    assert.ok(path.frames.at(-1)!.distance > 30_000);
});

test('a shortened rail clamps the vehicle to the end and a reshaped rail changes its pose', () => {
    const rail = track('railtrackspline');
    const proposal = request('trainflatbed', [rail]);
    const snap = finalizeFoxholeRailVehicleSnap(proposal);
    const add = snap.transaction?.operations[0];
    if (add?.op !== 'add') assert.fail();
    proposal.context.entities[0]!.components.push(component('rail-attachment', add.data));
    const follow = { ...proposal, followedEntityId: rail.entityId, interaction: 'transform' as const };
    Object.assign(rail.components.at(-1)!.data, { endX: 350, endY: 260, endRotation: Math.PI / 2 });
    const curved = finalizeFoxholeRailVehicleSnap(follow);
    assert.ok(curved.transform.y > 10);
    assert.notEqual(curved.transform.rotation, snap.transform.rotation);

    Object.assign(rail.components.at(-1)!.data, { endX: 150, endY: 0, endRotation: 0 });
    assert.ok(Math.abs(finalizeFoxholeRailVehicleSnap(follow).transform.x - 150) < 1e-8);
});

test('long rolling stock steers the two bogies independently through the spatial render plan', () => {
    for (const assetId of ['trainflatbed', 'trainhospital', 'trainlrartillery']) {
        const curved = track('railtrackspline');
        Object.assign(curved.components.at(-1)!.data, { endX: 1050, endY: 700, endRotation: Math.PI / 2 });
        const proposal = request(assetId, [curved]);
        const vehicle = proposal.context.entities[0]!;
        vehicle.components.push(component('rail-attachment', { rail: 'track', station: 650, reversed: false }));
        const { x, y, rotation, elevation } = finalizeFoxholeRailVehicleSnap({
            ...proposal, interaction: 'transform', followedEntityId: 'track',
        }).transform;
        Object.assign(vehicle.components[1]!.data, { x, y, rotation });
        vehicle.components.push(component('spatial-transform', { elevation: elevation! }, 'nixie.core'));
        assert.equal(renderFoxholeSceneV2Entity(vehicle, proposal.context).spatial?.modelNodeTransforms, undefined);
        const context = { ...proposal.context, settings: { 'nixie.scene.modelNodeTransforms': true } };
        const poses = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(vehicle, context)).spatial?.modelNodeTransforms;
        assert.equal(poses?.length, 2, assetId);
        assert.deepEqual(poses?.map(pose => pose.nodeName), ['rail-bogie-front', 'rail-bogie-rear'], assetId);
        assert.ok(poses![0]!.rotation[1] * poses![1]!.rotation[1] < 0, JSON.stringify({ assetId, poses }));

        Object.assign(curved.components.at(-1)!.data, { endX: 1300, endY: 0, endRotation: 0 });
        const straight = finalizeFoxholeRailVehicleSnap({ ...proposal, interaction: 'transform', followedEntityId: 'track' });
        Object.assign(vehicle.components[1]!.data, straight.transform);
        const straightPoses = renderFoxholeSceneV2Entity(vehicle, context).spatial?.modelNodeTransforms;
        assert.ok(straightPoses?.every(pose => Math.abs(pose.rotation[1]) < 1e-6), assetId);
    }
});

test('bogie poses do not hold moved cars at their old rail station', () => {
    const rail = track('railtrackspline');
    Object.assign(rail.components.at(-1)!.data, { endX: 1300, maxLength: 2500 });
    const proposal = request('trainlrartillery', [rail]);
    const vehicle = proposal.context.entities[0]!;
    vehicle.components.push(component('rail-attachment', { rail: 'track', station: 650, reversed: false }));
    const parked = finalizeFoxholeRailVehicleSnap({ ...proposal, interaction: 'transform', followedEntityId: 'track' }).transform;
    Object.assign(vehicle.components[1]!.data, { x: parked.x, y: parked.y, rotation: parked.rotation });
    vehicle.components.push(component('spatial-transform', { elevation: parked.elevation! }, 'nixie.core'));
    const context = { ...proposal.context, settings: { 'nixie.scene.modelNodeTransforms': true } };
    const render = () => renderFoxholeSceneV2Entity(vehicle, context).spatial?.modelNodeTransforms;
    assert.equal(render()?.length, 2);

    // A multi-selection gizmo move preserves the saved station during preview.
    vehicle.components[1]!.data.y = parked.y + 140;
    assert.equal(render(), undefined);

    Object.assign(vehicle.components[1]!.data, { y: parked.y, rotation: parked.rotation! + Math.PI / 2 });
    assert.equal(render(), undefined);

    Object.assign(vehicle.components[1]!.data, { y: parked.y + 140, rotation: parked.rotation });
    rail.components[0]!.data.y = 140;
    assert.equal(render()?.length, 2, 'moving the car and its rail together keeps articulation');
});

test('long cars keep both bogie poses when a secondary rail is reshaped', () => {
    for (const assetId of ['trainhospital', 'trainlrartillery']) {
        const approach = track('railtrackspline', 'approach');
        Object.assign(approach.components[0]!.data, { x: -900 });
        Object.assign(approach.components.at(-1)!.data, { endX: 900, maxLength: 2500 });
        const continuation = track('railtrackspline', 'continuation');
        Object.assign(continuation.components.at(-1)!.data, {
            endX: 900, endY: 340, endRotation: 0.55, maxLength: 2500,
            startAttachmentNodeId: 'approach', startAttachmentSocketName: 'FrontSocket',
        });
        const unrelated = track('railtrackspline', 'straighter');
        const proposal = request(assetId, [approach, continuation, unrelated]);
        Object.assign(proposal.transform, { x: -110, y: 0, rotation: 0 });
        const snap = finalizeFoxholeRailVehicleSnap(proposal);
        const attachment = snap.transaction?.operations[0];
        if (attachment?.op !== 'add') assert.fail('Expected a multi-rail attachment');
        assert.deepEqual(attachment.data.route, ['continuation'], assetId);
        const vehicle = proposal.context.entities[0]!;
        vehicle.components.push(component('rail-attachment', attachment.data));
        vehicle.components.push(component('spatial-transform', { elevation: snap.transform.elevation! }, 'nixie.core'));
        const context = { ...proposal.context, entities: [vehicle, approach, continuation],
            settings: { 'nixie.scene.modelNodeTransforms': true } };
        const resolve = () => {
            const followed = finalizeFoxholeRailVehicleSnap({ ...proposal, context, interaction: 'transform', followedEntityId: 'approach' });
            Object.assign(vehicle.components[1]!.data, followed.transform);
            const poses = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity(vehicle, context)).spatial?.modelNodeTransforms;
            const projection = createFoxholeSpatialProjection(context.entities);
            const rails = [approach, continuation].map(entity => sampleFoxholeSceneV2Connector(
                entity.components.at(-1)!.data as unknown as FoxholeSceneV2SplineConnectorData, assets.railtrackspline,
            ).points.map(point => {
                const [x, y] = projection.toWorld(entity, [point.x, point.y, 0]);
                return { x, y };
            }));
            const supportingRails = new Set<number>();
            for (const bogie of foxholeRailVehicleBogies[assetId]!) {
                const pose = poses?.find(pose => pose.nodeName === bogie.nodeName);
                assert.ok(pose, bogie.nodeName);
                const [tx, , ty] = pose.translation, yaw = -pose.rotation[1];
                for (const axle of bogie.wheelOffsets) {
                    const [x, y] = projection.toWorld(vehicle,
                        [(bogie.pivot + tx + Math.cos(yaw) * axle) * 32, (ty + Math.sin(yaw) * axle) * 32, 0]);
                    const distances = rails.map(rail => Math.min(...rail.slice(1).map((end, index) =>
                        nearestPointOnSegment({ x, y }, rail[index]!, end).distance)));
                    const closest = Math.min(...distances);
                    assert.ok(closest < 0.7, `${assetId} ${bogie.nodeName} axle is ${closest} units from the centerline`);
                    supportingRails.add(distances.indexOf(closest));
                }
            }
            assert.equal(supportingRails.size, 2, assetId);
            return poses;
        };
        const before = resolve();
        assert.equal(before?.length, 2, assetId);
        Object.assign(continuation.components.at(-1)!.data, { endY: 520, endRotation: 0.92 });
        const after = resolve();
        assert.equal(after?.length, 2, assetId);
        assert.notDeepEqual(after, before, assetId);
    }
});
