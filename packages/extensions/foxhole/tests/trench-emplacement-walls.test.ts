import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import { resolveFoxholeOccupiedSocketTags, shouldShowFoxholeStructureRenderLayer }
    from '../app/plugins/foxhole/nixie/structure-render-layer-visibility.ts';
import { createFoxholeStructureFloorMaskPoints, createFoxholeCornerWallMaskPoints, createFoxholeTrenchEmplacementMaskPolygons }
    from '../app/plugins/foxhole/nixie/structure-floor-mask.ts';

const catalog = buildFoxholeStructureCatalog(getFoxholeManifest('/foxhole/assets/'));
const directions = ['Front', 'FrontRight', 'Right', 'BackRight', 'Back', 'BackLeft', 'Left', 'FrontLeft'];

test('emplacement sockets resolve all eight wall directions independently', () => {
    for (const tier of [1, 2, 3]) {
        const structure = catalog.structureByKey[`trenchempt${tier}`]!;
        for (const direction of directions) {
            const socket = structure.buildSockets.find(candidate => candidate.name.endsWith(`:${direction}Socket`))!;
            assert.ok(socket);
            assert.deepEqual([...resolveFoxholeOccupiedSocketTags(structure.buildSockets,
                new Set([`emplacement:${socket.name}`]), 'emplacement')], [direction.toLowerCase()]);
        }
    }
});

test('occupied approaches reveal underground corner ends without revealing adjacent unconnected tips', () => {
    // One authored corner carries branches toward two neighboring socket faces.
    const corner = { id: 'corner1', width: 160, height: 160, offsetX: -130, offsetY: -55 };
    const closed = createFoxholeCornerWallMaskPoints('TrenchEmpT1', corner, 160, new Set());
    const connected = createFoxholeCornerWallMaskPoints('TrenchEmpT1', corner, 160, new Set(['back']));
    assert.ok(Math.abs(Math.min(...closed.map(point => point.x)) + 142.4) < 1e-6);
    assert.ok(Math.abs(Math.min(...connected.map(point => point.x)) + 160) < 1e-6);
    assert.ok(connected.every(point => (-point.x - point.y) / Math.SQRT2 < 160), 'The unoccupied BackLeft branch cannot reach its socket');
    assert.ok(connected.every(point => (-point.x + point.y) / Math.SQRT2 < 160), 'The unoccupied BackRight branch cannot reach its socket');
    const polygons = createFoxholeTrenchEmplacementMaskPolygons('TrenchEmpT1', corner, 160, 'walls', new Set(['back']));
    assert.ok(Math.abs(Math.min(...polygons.flat().map(point => point.x)) + 160) < 1e-6);
    assert.ok(polygons.flat().every(point => point.x >= -210 && point.x <= -50 && point.y >= -135 && point.y <= 25), 'Mesh pieces stay inside the authored texture');
    const concrete = { id: 'corner1', width: 100, height: 100, offsetX: 70, offsetY: 145 };
    assert.deepEqual(createFoxholeCornerWallMaskPoints('TrenchEmpT3', concrete, 160, new Set(['right'])),
        createFoxholeCornerWallMaskPoints('TrenchEmpT3', concrete, 160, new Set()), 'A connection must not shrink the thicker concrete corner');
});

test('occupied emplacement sockets open only their matching wall and omit exterior dirt', () => {
    for (const tier of [1, 2, 3]) {
        const asset = catalog.assetByKey[`trenchempt${tier}`]!;
        for (const direction of directions) {
            const tag = direction.toLowerCase();
            const wall = asset.renderLayers.find(layer => layer.id === `${tag}wall`);
            assert.ok(wall, `Tier ${tier} needs a separate ${direction} wall`);
            assert.deepEqual(wall.componentTags, [direction]);
            const occupied = new Set([tag]);
            for (const layer of asset.renderLayers) {
                assert.equal(shouldShowFoxholeStructureRenderLayer(layer, occupied, { structureCodeName: asset.codeName }),
                    layer.id !== `${tag}wall` && !layer.id.startsWith('dirt'), `${tier} ${direction} ${layer.id}`);
            }
        }
        assert.equal(asset.renderLayers.filter(layer => /^corner\d+$/.test(layer.id)).length, 8);
        const occupied = new Set(directions.map(direction => direction.toLowerCase()));
        assert.equal(asset.renderLayers.filter(layer => layer.id.endsWith('wall')
            && shouldShowFoxholeStructureRenderLayer(layer, occupied, { structureCodeName: asset.codeName })).length, 0);
    }
});

test('emplacement floors tuck under walls and reach only the occupied socket directions', () => {
    for (const tier of [1, 2, 3]) {
        const asset = catalog.assetByKey[`trenchempt${tier}`]!;
        const floor = asset.renderLayers.find(layer => layer.id === 'floor')!;
        const surface = { width: floor.width * 0.5, height: floor.height * 0.5,
            offsetX: (floor.offsetX ?? 0) * 0.5, offsetY: (floor.offsetY ?? 0) * 0.5 };
        const closed = createFoxholeStructureFloorMaskPoints(asset.codeName, surface, 160);
        const closedLimit = [134.4, 139.2, 150.4][tier - 1]!;
        assert.ok(Math.abs(Math.max(...closed.map(point => point.x)) - closedLimit) < 1e-6);
        assert.ok(Math.abs(Math.min(...closed.map(point => point.y)) + closedLimit) < 1e-6, 'Clip around the wall origin, including offset T2 flooring');
        for (const [index, direction] of directions.entries()) {
            const points = createFoxholeStructureFloorMaskPoints(asset.codeName, surface, 160, new Set([direction.toLowerCase()]));
            const angle = index * Math.PI / 4;
            const normalX = Math.cos(angle), normalY = Math.sin(angle);
            const projection = Math.max(...points.map(point => point.x * normalX + point.y * normalY));
            assert.ok(Math.abs(projection - 160) < 1e-6);
            for (const point of points) {
                const insideCore = directions.every((_side, otherIndex) => {
                    const otherAngle = otherIndex * Math.PI / 4;
                    return point.x * Math.cos(otherAngle) + point.y * Math.sin(otherAngle) <= closedLimit + 1e-6;
                });
                const depth = point.x * normalX + point.y * normalY;
                const width = Math.abs(-point.x * normalY + point.y * normalX);
                assert.ok(insideCore || (depth >= closedLimit - 1e-6 && depth <= 160 + 1e-6 && width <= 48 + 1e-6),
                    'Exposed flooring must lie inside the 3 m occupied passage');
            }
        }
    }
});

test('emplacement wall and post masks cut outward tips while retaining the authored wall centers', () => {
    for (const tier of [1, 2, 3]) {
        const asset = catalog.assetByKey[`trenchempt${tier}`]!;
        const limit = [142.4, 150.4, 169.6][tier - 1]!;
        for (const layer of asset.renderLayers.filter(candidate => candidate.id.endsWith('wall') || /^corner\d+$/.test(candidate.id))) {
            const points = createFoxholeCornerWallMaskPoints(asset.codeName, { id: layer.id,
                width: layer.width * 0.5, height: layer.height * 0.5,
                offsetX: (layer.offsetX ?? 0) * 0.5, offsetY: (layer.offsetY ?? 0) * 0.5 }, 160, new Set());
            assert.ok(points.length >= 3, `${tier} ${layer.id} must retain a visible part`);
            for (let index = 0; index < 8; index++) {
                const angle = index * Math.PI / 4;
                assert.ok(points.every(point => point.x * Math.cos(angle) + point.y * Math.sin(angle) <= limit + 1e-6));
            }
        }
    }
});
