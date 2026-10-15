import assert from 'node:assert/strict';
import test from 'node:test';
import {
    blendConnectorPathSamples,
    enforceRigidPipeEndpoints,
    resolveExtensionEndpoints,
    sampleExtensionPipePath,
} from '../app/plugins/foxhole/nixie/pipe-extension-path.ts';

const cmToPx = 32 / 100;
const pipeConstraints = {
    minLength: 300 * cmToPx,
    minRadius: 50 * cmToPx,
    maxRadius: 300 * cmToPx,
    maxBuffer: 300 * cmToPx,
    curveT: 0,
};

test('resolveExtensionEndpoints places depart and arrive on handle axes', () => {
    const endRotation = Math.atan2(100, 200) + Math.PI;
    const extension = resolveExtensionEndpoints(
        { x: 0, y: 0, rotation: Math.PI / 2 },
        { x: 200, y: 100, rotation: endRotation },
        pipeConstraints,
    );

    assert.ok(Math.abs(extension.depart.x - extension.start.x) < 0.01);
    assert.ok(extension.depart.y > extension.start.y);

    const arriveStep = {
        x: extension.arrive.x - extension.end.x,
        y: extension.arrive.y - extension.end.y,
    };
    const arriveLength = Math.hypot(arriveStep.x, arriveStep.y);
    const arriveAlignment = ((arriveStep.x / arriveLength) * Math.cos(endRotation))
        + ((arriveStep.y / arriveLength) * Math.sin(endRotation));
    assert.ok(Math.abs(arriveLength - extension.extension) < 0.01);
    assert.ok(arriveAlignment > 0.99);
    assert.equal(extension.extension, pipeConstraints.maxBuffer * 0.5);
});

test('sampleExtensionPipePath builds an L-shaped extension chord path', () => {
    const start = { x: 0, y: 0, rotation: Math.PI / 2 };
    const endRotation = Math.atan2(100, 200) + Math.PI;
    const end = { x: 200, y: 100, rotation: endRotation };
    const sampled = sampleExtensionPipePath(start, end, pipeConstraints);
    const extension = resolveExtensionEndpoints(start, end, pipeConstraints);

    const firstStep = {
        x: sampled.points[1]!.x - sampled.points[0]!.x,
        y: sampled.points[1]!.y - sampled.points[0]!.y,
    };
    const firstLength = Math.hypot(firstStep.x, firstStep.y);
    const firstAlignment = ((firstStep.x / firstLength) * Math.cos(start.rotation))
        + ((firstStep.y / firstLength) * Math.sin(start.rotation));
    assert.ok(firstAlignment > 0.99);

    const lastIndex = sampled.points.length - 1;
    const lastStep = {
        x: sampled.points[lastIndex]!.x - sampled.points[lastIndex - 1]!.x,
        y: sampled.points[lastIndex]!.y - sampled.points[lastIndex - 1]!.y,
    };
    const lastLength = Math.hypot(lastStep.x, lastStep.y);
    const chordRotation = Math.atan2(end.y - start.y, end.x - start.x);
    const lastAlignment = ((lastStep.x / lastLength) * Math.cos(chordRotation))
        + ((lastStep.y / lastLength) * Math.sin(chordRotation));
    assert.ok(lastAlignment > 0.99);

    const middleLength = Math.hypot(
        extension.arrive.x - extension.depart.x,
        extension.arrive.y - extension.depart.y,
    );
    assert.ok(sampled.totalLength > middleLength);
});

test('sampleExtensionPipePath smooths junctions between legs', () => {
    const start = { x: 0, y: 0, rotation: Math.PI / 2 };
    const end = { x: 200, y: 100, rotation: Math.atan2(100, 200) + Math.PI };
    const sharp = resolveExtensionEndpoints(start, end, pipeConstraints);
    const sampled = sampleExtensionPipePath(start, end, pipeConstraints);

    assert.ok(sampled.points.length > 12);

    const hitsSharpDepart = sampled.points.some(point => (
        Math.hypot(point.x - sharp.depart.x, point.y - sharp.depart.y) < 0.01
    ));
    const hitsSharpArrive = sampled.points.some(point => (
        Math.hypot(point.x - sharp.arrive.x, point.y - sharp.arrive.y) < 0.01
    ));
    assert.ok(!hitsSharpDepart);
    assert.ok(!hitsSharpArrive);
});

test('sampleExtensionPipePath stays colinear when handles align with the chord', () => {
    const sampled = sampleExtensionPipePath(
        { x: 0, y: 0, rotation: 0 },
        { x: 220, y: 0, rotation: Math.PI },
        pipeConstraints,
    );

    assert.ok(Math.abs(sampled.totalLength - 220) < 2);
    for (const point of sampled.points) {
        assert.ok(Math.abs(point.y) < 0.01);
    }
});

test('enforceRigidPipeEndpoints flips backward-facing rotations', () => {
    const adjusted = enforceRigidPipeEndpoints(
        { x: 0, y: 0, rotation: Math.PI },
        { x: 120, y: 0, rotation: 0 },
    );

    assert.ok(Math.abs(adjusted.start.rotation) < 0.001);
    assert.ok(Math.abs(adjusted.end.rotation) < 0.001);
});

test('blendConnectorPathSamples returns endpoints at curveT extremes', () => {
    const start = { x: 0, y: 0, rotation: Math.PI / 2 };
    const end = { x: 200, y: 100, rotation: 0 };
    const rigid = sampleExtensionPipePath(start, end, pipeConstraints);
    const curved = sampleExtensionPipePath(start, end, { ...pipeConstraints, curveT: 1 });

    assert.equal(blendConnectorPathSamples(rigid, curved, 0).totalLength, rigid.totalLength);
    assert.equal(blendConnectorPathSamples(rigid, curved, 1).totalLength, curved.totalLength);
});
