import assert from 'node:assert/strict';
import test from 'node:test';
import {
    applyOrientationToLegacySockets,
    cardinalFortSocketName,
    matchSocketsByScore,
    scoreSocketPair,
} from '../../tools/legacy-plans/generate-socket-id-map.mjs';
import {
    LEGACY_PLAN_SOCKET_MATCH_META,
    resolveLegacyPlanSocketMatchMeta,
    resolveLegacyPlanSocketName,
} from '../../app/plugins/foxhole/legacy/plan-socket-id-map.ts';

test('scoreSocketPair prefers position over matching rotation for foundation cardinals', () => {
    const origin = { x: 2.5, y: 2.5 };
    // Legacy left edge (-X): rotation 270 matches Nixie LeftSocket, but position matches BackSocket.
    const legacy = { id: 0, x: 0, y: 2.5, rotation: 270, name: '' };
    const back = { name: 'BackSocket', preferredName: 'BackSocket', x: -250, y: 0, rotation: 180 };
    const left = { name: 'LeftSocket', preferredName: 'LeftSocket', x: 0, y: -250, rotation: -90 };

    const backScore = scoreSocketPair(legacy, back, origin);
    const leftScore = scoreSocketPair(legacy, left, origin);

    assert.equal(backScore.distCm, 0);
    assert.ok(backScore.distCm < leftScore.distCm);
    assert.ok(backScore.score > leftScore.score, 'position-aligned BackSocket should beat rotation-aligned LeftSocket');
});

test('matchSocketsByScore maps foundation 1x1 to Back/Left/Front/Right', () => {
    const legacy = [
        { id: 0, x: 0, y: 2.5, rotation: 270 },
        { id: 1, x: 2.5, y: 0, rotation: 0 },
        { id: 2, x: 5, y: 2.5, rotation: 90 },
        { id: 3, x: 2.5, y: 5, rotation: 180 },
    ];
    const nixie = [
        { name: 'BackSocket', preferredName: 'BackSocket', x: -250, y: 0, rotation: 180 },
        { name: 'FrontSocket', preferredName: 'FrontSocket', x: 250, y: 0, rotation: 0 },
        { name: 'LeftSocket', preferredName: 'LeftSocket', x: 0, y: -250, rotation: -90 },
        { name: 'RightSocket', preferredName: 'RightSocket', x: 0, y: 250, rotation: 90 },
    ];

    const result = matchSocketsByScore(legacy, nixie);
    assert.equal(result.method, 'position-frame');
    assert.equal(result.confidence, 'high');
    assert.deepEqual(result.mapping, {
        0: 'BackSocket',
        1: 'LeftSocket',
        2: 'FrontSocket',
        3: 'RightSocket',
    });
});

test('matchSocketsByScore uses fort cardinals when Fort* sockets exist', () => {
    const legacy = [
        { id: 0, x: 2.5, y: 0, rotation: 0 },
        { id: 1, x: 5, y: 2.5, rotation: 90 },
        { id: 2, x: 2.5, y: 5, rotation: 180 },
        { id: 3, x: 0, y: 2.5, rotation: 270 },
    ];
    const nixie = [
        { name: 'FrontFortSocket', preferredName: 'FrontFortSocket', x: 250, y: 0, rotation: 0 },
        { name: 'RightFortSocket', preferredName: 'RightFortSocket', x: 0, y: 250, rotation: 90 },
        { name: 'BackFortSocket', preferredName: 'BackFortSocket', x: -250, y: 0, rotation: 180 },
        { name: 'LeftFortSocket', preferredName: 'LeftFortSocket', x: 0, y: -250, rotation: -90 },
    ];

    const result = matchSocketsByScore(legacy, nixie);
    assert.equal(result.method, 'fort-cardinal');
    assert.deepEqual(result.mapping, {
        0: 'FrontFortSocket',
        1: 'RightFortSocket',
        2: 'BackFortSocket',
        3: 'LeftFortSocket',
    });
});

test('applyOrientationToLegacySockets then score recovers foundation 1x2 Front/Back', () => {
    const legacy = applyOrientationToLegacySockets([
        { id: 0, x: 0, y: 2.5, rotation: 270 },
        { id: 1, x: 2.5, y: 0, rotation: 0 },
        { id: 2, x: 5, y: 2.5, rotation: 90 },
        { id: 3, x: 5, y: 7.5, rotation: 90 },
        { id: 4, x: 2.5, y: 10, rotation: 180 },
        { id: 5, x: 0, y: 7.5, rotation: 270 },
    ], 90);
    const nixie = [
        { name: 'FrontSocket', preferredName: 'FrontSocket', x: 500, y: 0, rotation: 0 },
        { name: 'RightSocket0', preferredName: 'RightSocket0', x: 250, y: 250, rotation: 90 },
        { name: 'RightSocket1', preferredName: 'RightSocket1', x: -250, y: 250, rotation: 90 },
        { name: 'BackSocket', preferredName: 'BackSocket', x: -500, y: 0, rotation: 180 },
        { name: 'LeftSocket0', preferredName: 'LeftSocket0', x: -250, y: -250, rotation: -90 },
        { name: 'LeftSocket1', preferredName: 'LeftSocket1', x: 250, y: -250, rotation: -90 },
    ];

    const result = matchSocketsByScore(legacy, nixie);
    assert.equal(result.confidence, 'high');
    assert.equal(result.mapping[1], 'FrontSocket');
    assert.equal(result.mapping[4], 'BackSocket');
});

test('generated socket map keeps foundation and fort regressions', () => {
    assert.equal(resolveLegacyPlanSocketName('foundation01t1', 0), 'BackSocket');
    assert.equal(resolveLegacyPlanSocketName('foundation01t1', 2), 'FrontSocket');
    assert.equal(resolveLegacyPlanSocketName('fortt1', 0), 'LeftFortSocket');
    assert.equal(resolveLegacyPlanSocketName('facilitypipe', 0), 'BackSocket');
    assert.equal(resolveLegacyPlanSocketName('facilitypipe', 2), 'FrontSocket');

    const foundationMeta = resolveLegacyPlanSocketMatchMeta('foundation01t1');
    assert.ok(foundationMeta);
    assert.equal(foundationMeta.confidence, 'high');
    assert.ok(String(foundationMeta.method).includes('position-frame'));

    assert.ok(Object.keys(LEGACY_PLAN_SOCKET_MATCH_META).length > 50);
});

test('cardinalFortSocketName covers the four authored rotations', () => {
    assert.equal(cardinalFortSocketName(0), 'FrontFortSocket');
    assert.equal(cardinalFortSocketName(90), 'RightFortSocket');
    assert.equal(cardinalFortSocketName(180), 'BackFortSocket');
    assert.equal(cardinalFortSocketName(270), 'LeftFortSocket');
});
