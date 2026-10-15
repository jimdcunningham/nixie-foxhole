import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * Mirrors the angular proximity scorer in generate-orientation-map.mjs for a
 * focused regression: facilitymodificationcenter must prefer +90 over 180.
 */
function normalizeRotationDeg(value) {
    let deg = Number(value);
    if (!Number.isFinite(deg)) {
        return 0;
    }
    while (deg > 180) {
        deg -= 360;
    }
    while (deg <= -180) {
        deg += 360;
    }
    return deg;
}

function rotationDelta(a, b) {
    return Math.abs(normalizeRotationDeg(a - b));
}

function rotatePoint(x, y, degrees) {
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    return {
        x: x * cos - y * sin,
        y: x * sin + y * cos,
    };
}

function polarAngleDeg(x, y) {
    return normalizeRotationDeg((Math.atan2(y, x) * 180) / Math.PI);
}

function scoreOffset(legacySocket, nixieSocket, offset) {
    const rotated = rotatePoint(legacySocket.x, legacySocket.y, offset);
    const legacyRot = normalizeRotationDeg(legacySocket.rotation + offset);
    const legacyRadius = Math.hypot(rotated.x, rotated.y);
    const nixieRadius = Math.hypot(nixieSocket.x, nixieSocket.y);
    const angleDelta = rotationDelta(polarAngleDeg(rotated.x, rotated.y), polarAngleDeg(nixieSocket.x, nixieSocket.y));
    const angleScore = Math.max(0, 180 - angleDelta);
    const scale = nixieRadius / legacyRadius;
    const dist = Math.hypot(rotated.x * scale - nixieSocket.x, rotated.y * scale - nixieSocket.y);
    const posScore = Math.max(0, 200 - (dist / nixieRadius) * 200);
    const rotScore = Math.max(0, 180 - rotationDelta(legacyRot, nixieSocket.rotation));
    const aspectBonus = Math.abs(offset) === 90 ? 60 : -60;
    return {
        offset,
        angleDelta,
        score: angleScore * 3 + posScore * 1.5 + rotScore * 0.35 + aspectBonus,
    };
}

test('facilitymodificationcenter power socket prefers +90 over 180 by angular proximity', () => {
    const legacy = { x: 0.98, y: 1.34, rotation: 0 };
    const nixie = { x: -609.679, y: 380.508, rotation: -180 };
    const scores = [0, 90, -90, 180].map(offset => scoreOffset(legacy, nixie, offset))
        .sort((left, right) => right.score - left.score);

    assert.equal(scores[0]?.offset, 90);
    assert.ok(scores[0].angleDelta < 10, `expected tight angle match, got ${scores[0].angleDelta}`);
    const oneEighty = scores.find(entry => entry.offset === 180);
    assert.ok(oneEighty && scores[0].score > oneEighty.score);
});
