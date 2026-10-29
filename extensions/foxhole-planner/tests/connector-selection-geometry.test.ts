import assert from 'node:assert/strict';
import assets from '../src/scene-v2-assets-node.ts';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { parseNixieExtensionRenderPlanV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { renderFoxholeSceneV2SplineConnector } from '../src/scene-v2-spline-connectors.ts';
import test from 'node:test';
import { parseNixieExperimentalSelectionGeometryV1 } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { resolveFoxholeConnectorSelectionGeometry } from '../src/connector-selection-geometry.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';

const data: FoxholeSceneV2SplineConnectorData = { foxholeKey: 'powerline', startX: 10, startY: 20, startRotation: 0,
    endX: 110, endY: 120, endRotation: Math.PI, minLength: 0, maxLength: 1000, minRadius: 0, maxRadius: 1000,
    maxBuffer: 0, curveT: 0, blueprint: false };
test('power-line selection uses its oriented core stroke and every connector retains its endpoint midpoint', () => {
    const before = structuredClone(data);
    const geometry = resolveFoxholeConnectorSelectionGeometry(data);
    assert.deepEqual(geometry.transformOrigin, { x: 60, y: 70 });
    assert.equal(geometry.frameAngle, Math.PI / 4);
    assert.equal(geometry.localQuad?.length, 4);
    assert.deepEqual(parseNixieExperimentalSelectionGeometryV1(geometry), geometry);
    assert.deepEqual(data, before);
    assert.deepEqual(resolveFoxholeConnectorSelectionGeometry({ ...data, foxholeKey: 'facilitypipe' }), { contractVersion: 1,
        transformOrigin: { x: 60, y: 70 } });
    assert.ok(resolveFoxholeConnectorSelectionGeometry({ ...data, endX: 10, endY: 20 }).localQuad);
});

for (const key of ['facilitypipeoverhead', 'cranerailtrackspline', 'facilitycatwalkbridge', 'fieldbridge', 'fieldpier',
    'wallsplinet1', 'wallsplinet2', 'wallsplinet3', 'waterwallsplinet1', 'minespline', 'infantryminespline', 'tankminespline',
    'waterminespline', 'surfacewaterminespline']) {
    test(key + ' selection frame follows its endpoint angle and encloses the rendered span', () => {
        const asset = assets[key]!;
        assert.ok(asset);
        for (const angle of [Math.PI / 4, -Math.PI / 3, Math.PI]) {
            const input = { ...data, foxholeKey: key, startX: 12, startY: -30, endX: 12 + Math.cos(angle) * 500,
                endY: -30 + Math.sin(angle) * 500, startRotation: angle, endRotation: angle, minLength: 48, minRadius: 0 };
            const content = renderFoxholeSceneV2SplineConnector(input, asset);
            const geometry = resolveFoxholeConnectorSelectionGeometry(input, asset, content);
            assert.ok(geometry.localQuad, key);
            assert.ok(Math.abs(geometry.frameAngle! - angle) < 1e-10);
            assert.deepEqual(parseNixieExperimentalSelectionGeometryV1(geometry), geometry);
            const project = (point: { x: number; y: number; }) => ({ x: point.x * Math.cos(angle) + point.y * Math.sin(angle),
                y: -point.x * Math.sin(angle) + point.y * Math.cos(angle) });
            const quad = geometry.localQuad.map(project);
            const minX = Math.min(...quad.map(p => p.x)), maxX = Math.max(...quad.map(p => p.x));
            const minY = Math.min(...quad.map(p => p.y)), maxY = Math.max(...quad.map(p => p.y));
            assert.ok(Math.abs(quad[0]!.y - quad[1]!.y) < 1e-8);
            assert.ok(Math.abs(quad[1]!.x - quad[2]!.x) < 1e-8);
            for (const node of content) {
                if (node.kind !== 'mesh') continue;
                for (let index = 0; index < node.positions.length; index += 2) {
                    const point = project({ x: node.positions[index]!, y: node.positions[index + 1]! });
                    assert.ok(point.x >= minX - 1e-7 && point.x <= maxX + 1e-7 && point.y >= minY - 1e-7 && point.y <= maxY + 1e-7);
                }
            }
        }
    });
}

test('the oriented frame includes transformed endpoint fittings and uses their actual anchors', () => {
    const asset = assets.facilitypipeoverhead!;
    const visual = asset.renderLayers.backtrim!;
    const geometry = resolveFoxholeConnectorSelectionGeometry({ ...data, foxholeKey: 'facilitypipeoverhead', endY: 20 }, asset, [
        { id: 'cap', kind: 'sprite', resourceId: visual.resourceId, x: 0, y: 0,
            rotation: Math.PI / 2, scaleX: 0.5, scaleY: 0.5, anchorX: 1, anchorY: 0 },
    ]);
    assert.ok(geometry.localQuad);
    assert.ok(Math.abs(Math.min(...geometry.localQuad.map(p => p.x)) + visual.height) < 1e-7);
    assert.ok(Math.abs(Math.min(...geometry.localQuad.map(p => p.y)) + visual.width) < 1e-7);
});

test('curved connectors retain their existing bounds treatment', () => {
    for (const key of ['facilitypipe', 'facilitypipeunderground', 'smallrailtrackspline', 'facilityroad']) {
        const asset = assets[key]!;
        const input = { ...data, foxholeKey: key };
        const geometry = resolveFoxholeConnectorSelectionGeometry(input, asset, renderFoxholeSceneV2SplineConnector(input, asset));
        assert.equal(geometry.localQuad, undefined);
        assert.equal(geometry.frameAngle, undefined);
    }
});

test('the entity renderer publishes oriented bounds from visible content rather than its socket guides', () => {
    for (const key of ['facilitypipeoverhead', 'cranerailtrackspline', 'fieldbridge']) {
        const input = { ...data, foxholeKey: key };
        const plan = parseNixieExtensionRenderPlanV1(renderFoxholeSceneV2Entity({ entityId: 'angled-span', revision: 1,
            components: [{ ownerId: 'nixie.foxhole-planner', componentId: 'spline-connector', version: 1,
                definitionAvailable: true, data: JSON.parse(JSON.stringify(input)) }] }));
        const expected = resolveFoxholeConnectorSelectionGeometry(input, assets[key], renderFoxholeSceneV2SplineConnector(input, assets[key]));
        assert.deepEqual(plan.experimentalSelectionGeometry?.localQuad, expected.localQuad);
        assert.equal(plan.experimentalSelectionGeometry?.frameAngle, Math.PI / 4);
    }
});
