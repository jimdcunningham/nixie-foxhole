import assert from 'node:assert/strict';
import test from 'node:test';
import {
    allowsConnectorRotationHandles,
    getFoxholeSplineConnectorConstraints,
} from '../app/plugins/foxhole/nixie/spline-connector.ts';
import {
    resolveSplineConnectorFixturePlacement,
    SPLINE_CONNECTOR_GALLERY_VARIATION_COUNT,
} from '../app/plugins/foxhole/nixie/spline-connector-snapshot-gallery.ts';

const straightStructure = {
    id: 'fieldbridge',
    connector: {
        pathStyle: 'straight-telescoping',
        minLengthCm: 300,
        maxLengthCm: 2000,
        minRadiusCm: 50,
    },
} as const;

const curvedStructure = {
    id: 'facilitypipe',
    connector: {
        pathStyle: 'spline',
        splineComponentName: 'SplineConnector',
        minLengthCm: 300,
        maxLengthCm: 2000,
        minRadiusCm: 50,
    },
} as const;

test('straight-telescoping fixtures keep aligned endpoint rotations', () => {
    const constraints = getFoxholeSplineConnectorConstraints({
        foxholeKey: 'fieldbridge',
        minLength: 96,
        maxLength: 640,
        minRadius: 16,
        maxRadius: 640,
        maxBuffer: 96,
        curveT: 0,
        start: { x: 0, y: 0, rotation: 0 },
        end: { x: 120, y: 0, rotation: 0 },
    }, 'straight-telescoping');

    const placement = resolveSplineConnectorFixturePlacement(3, 'fieldbridge', straightStructure, constraints);
    assert.equal(placement.start.rotation, placement.end.rotation);
    assert.equal(allowsConnectorRotationHandles('straight-telescoping', 'fieldbridge'), false);
});

test('curved fixtures vary endpoint rotations for spline connectors', () => {
    const constraints = getFoxholeSplineConnectorConstraints({
        foxholeKey: 'facilitypipe',
        minLength: 96,
        maxLength: 640,
        minRadius: 16,
        maxRadius: 640,
        maxBuffer: 96,
        curveT: 0,
        start: { x: 0, y: 0, rotation: 0 },
        end: { x: 120, y: 0, rotation: 0 },
    }, 'spline');

    const straight = resolveSplineConnectorFixturePlacement(1, 'facilitypipe', curvedStructure, constraints);
    const curved = resolveSplineConnectorFixturePlacement(6, 'facilitypipe', curvedStructure, constraints);
    assert.notEqual(straight.start.rotation, curved.start.rotation);
    assert.notEqual(straight.end.rotation, curved.end.rotation);
});

test('gallery exposes eight deterministic variations per asset', () => {
    assert.equal(SPLINE_CONNECTOR_GALLERY_VARIATION_COUNT, 8);
});
