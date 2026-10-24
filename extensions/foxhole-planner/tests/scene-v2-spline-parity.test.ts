import assert from 'node:assert/strict';
import test from 'node:test';
import assets from '#foxhole-scene-v2-assets';
import { SPLINE_PATH_INVALID_TINT } from '@nixiejs/extension-sdk/experimental/scene-v2';
import { renderFoxholeSceneV2SplineConnector } from '../src/scene-v2-spline-connectors.ts';
import type { FoxholeSceneV2SplineConnectorData } from '../src/scene-v2-spline-connectors.ts';

const connector = (foxholeKey: string, patch: Partial<FoxholeSceneV2SplineConnectorData> = {}): FoxholeSceneV2SplineConnectorData => ({
    foxholeKey, startX: 0, startY: 0, startRotation: 0, endX: 500, endY: 0, endRotation: 0,
    minLength: 48, maxLength: 100000, minRadius: 24, maxRadius: 24, maxBuffer: 0, curveT: 1, blueprint: false, ...patch,
});

test('powerline stroke turns red beyond its maximum length and recovers when shortened', () => {
    const strokeColor = (endX: number) => {
        const path = renderFoxholeSceneV2SplineConnector(connector('powerline', { endX, maxLength: 500 }))[0];
        if (!path || path.kind !== 'graphics') {
            throw new Error('Expected a powerline graphics path.');
        }
        return path.commands.find(command => command.op === 'stroke')?.color;
    };

    assert.equal(strokeColor(501), SPLINE_PATH_INVALID_TINT);
    assert.equal(strokeColor(500), 0x000000);
});

test('tank stop markers use V1 centered anchors without applying authored offsets twice', () => {
    const nodes = renderFoxholeSceneV2SplineConnector(connector('tankstopsplinet3'), assets.tankstopsplinet3);
    const markers = nodes.filter(node => node.id.startsWith('spline-connector-interval'));
    assert.ok(markers.length > 2);
    for (const node of markers) {
        assert.equal(node.kind, 'sprite');
        if (node.kind === 'sprite') {
            assert.equal(node.anchorX, 0.5);
            assert.equal(node.anchorY, 0.5);
            assert.equal(node.y, 0);
        }
    }
});

test('tank stops cycle every published native marker variant in mesh order', () => {
    const original = assets.tankstopsplinet3!;
    const span = original.renderLayers.span!;
    const expanded = {
        ...original,
        renderLayers: {
            ...original.renderLayers,
            spanalt3: { ...span, resourceId: 'native-marker-four' },
            spanalt2: { ...span, resourceId: 'native-marker-three' },
        },
    };
    const resources = (asset: typeof original) => renderFoxholeSceneV2SplineConnector(
        connector('tankstopsplinet3'), asset,
    ).filter(node => node.id.startsWith('spline-connector-interval'))
        .map(node => node.kind === 'sprite' ? node.resourceId : 'unexpected');
    assert.deepEqual(resources(expanded).slice(0, 5), [
        span.resourceId, original.renderLayers.spanalt!.resourceId,
        'native-marker-three', 'native-marker-four', span.resourceId,
    ]);
    const legacy = { ...original, renderLayers: { span, spanalt: original.renderLayers.spanalt! } };
    assert.deepEqual(resources(legacy).slice(0, 5), [
        span.resourceId, original.renderLayers.spanalt!.resourceId,
        span.resourceId, original.renderLayers.spanalt!.resourceId, span.resourceId,
    ]);
});

test('land walls include the shared centered middle pillars and barbed wire ribbon', () => {
    const nodes = renderFoxholeSceneV2SplineConnector(connector('wallsplinet1'), assets.wallsplinet1);
    assert.ok(nodes.some(node => node.id.startsWith('spline-connector-middle-pillar')));
    assert.ok(nodes.some(node => node.id === 'spline-connector-barbed-wire' && node.kind === 'mesh'));
});

test('attached bridge endpoints omit their approach ramps without hiding the opposite ramp', () => {
    const nodes = renderFoxholeSceneV2SplineConnector(connector('fieldbridge', { startAttachmentNodeId: 'bridge-host' }), assets.fieldbridge);
    assert.ok(!nodes.some(node => node.id === 'spline-connector-back-ramp'));
    assert.ok(nodes.some(node => node.id === 'spline-connector-front-ramp'));
});

test('bridge pillars render above the approach ramps as in V1', () => {
    const nodes = renderFoxholeSceneV2SplineConnector(connector('fieldbridge'), assets.fieldbridge);
    const ramp = nodes.findIndex(node => node.id === 'spline-connector-front-ramp');
    const pillar = nodes.findIndex(node => node.id === 'spline-connector-front-trim');
    assert.ok(ramp >= 0 && pillar > ramp);
});

test('invalid pipe angles override custom and blueprint tints as in V1', () => {
    const nodes = renderFoxholeSceneV2SplineConnector(connector('facilitypipe', { maxTargetAngleDeg: 45, blueprint: true, tint: 0xFFFFFF }), assets.facilitypipe);
    const textured = nodes.filter(node => node.kind === 'sprite' || node.kind === 'mesh');
    assert.ok(textured.length > 0);
    assert.ok(textured.every(node => 'tint' in node && node.tint === SPLINE_PATH_INVALID_TINT));
});

test('nonzero pipe spans preserve native radius validation and underground exemptions', () => {
    const span = { startX: -120, startY: -20, startRotation: 0, endX: 120, endY: 20, endRotation: 0.25 };
    assert.equal(assets.facilitypipe?.connector?.enforceSplineModeCornerRadius, true);
    const pipe = renderFoxholeSceneV2SplineConnector(connector('facilitypipe', { ...span, minLength: 96, maxLength: 640,
        minRadius: 16, maxRadius: 96, maxBuffer: 96, curveT: 0 }), assets.facilitypipe);
    assert.ok(pipe.filter(node => node.kind === 'sprite' || node.kind === 'mesh').every(node => node.tint === SPLINE_PATH_INVALID_TINT));
    for (const key of ['facilitypipeunderground', 'facilitypipeoverhead']) {
        const nodes = renderFoxholeSceneV2SplineConnector(connector(key, { ...span, maxTargetAngleDeg: key.includes('underground') ? 1 : undefined }), assets[key]);
        assert.ok(nodes.filter(node => node.kind === 'sprite' || node.kind === 'mesh').every(node => node.tint !== SPLINE_PATH_INVALID_TINT));
    }
});
