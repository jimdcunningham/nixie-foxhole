import assert from 'node:assert/strict';
import test from 'node:test';
import {
    DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE,
    isUndergroundPipe,
    resolveDefaultEndRotation,
    resolveHybridPipeBezierEndRotation,
    resolveSplineConnectorCurveT,
    getFoxholeSplineConnectorConstraints,
    resolveTrimDisplayRotation,
    resolveStraightConnectorFrontTrimRotation,
    shouldRenderConnectorEndCapLayers,
    allowsConnectorRotationHandles,
    resolveEffectiveConnectorPathStyle,
    isPowerlineConnector,
    usesFacilityPipeGuidePath,
    usesRailTrackForkEndCaps,
    usesTrimSpanSplineConnector,
    usesFieldConnectorSpan,
    usesSocketFacingEndRotation,
    resolveConnectorRampSpriteAnchor,
    isTankStopSplineConnector,
    resolveIntervalMarkerDistances,
    resolveCenteredMeshConfigIntervalBoundaryDistances,
    resolveMeshConfigIntervalMarkerDistances,
    usesIntervalMarkerSpan,
    usesMineSplineConnector,
    usesSplineConnectorSocketSnapping,
    resolveConnectorSocketOutwardRotation,
    resolveConnectorSocketSnapStemRotation,
    resolveConnectorAttachmentStatusVisualRotation,
    resolveConnectorEndpointVisualRotation,
    requiresStraightConnectorSocketAlignment,
    shouldSynchronizeStraightConnectorEndpointRotations,
    shouldTintInvalidSplinePath,
} from '../app/plugins/foxhole/nixie/spline-connector.ts';
import { resolveFoxholeSplinePlacementPreview } from '../app/plugins/foxhole/nixie/spline-connector-placement.ts';
import { isFoxholePowerlineOverLength } from '../app/plugins/foxhole/nixie/powerline-stroke.ts';
import {
    resolvePipeConstraintOptions,
    resolvePipeSplineConstraints,
    usesPipeCurveScale,
} from '../app/plugins/foxhole/nixie/pipe-spline-constraints.ts';
import {
    resolveCenteredTextureRepeatDistanceOffset,
    sampleConnectorSplinePath,
} from '../app/plugins/foxhole/nixie/spline-ribbon-mesh.ts';
import {
    resolveFacilityPipeSideSocketPlacements,
    resolveConnectorSpanCrossHalfWidth,
    resolveConnectorSpanTextureMapping,
    resolveConnectorSpanInsets,
    resolveLandWallLayerMeshConfig,
    resolveStraightConnectorEndpointRotations,
    sampleConnectorPath,
    usesStraightSampledConnectorPath,
} from '../app/plugins/foxhole/nixie/pipe-connector-path.ts';
import {
    isFoxholePowerSocketConnectionAvailable,
    isStraightConnectorSocketSnapAligned,
    resolveHoveredFoxholePowerSocketTarget,
    resolveFoxholePowerlineSelectionQuad,
    resolveFoxholeSplinePowerlineGeometry,
    resolvePowerlineEndpointRotationsAfterDetach,
    reconcileFoxholeConnectorAttachments,
    shouldLockFoxholeConnectorEndpointToSocketAxis,
} from '../app/plugins/foxhole/nixie/connector.ts';

function projectQuadExtents(
    quad: ReadonlyArray<{ x: number; y: number; }>,
    angle: number,
): { length: number; thickness: number; } {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const along = quad.map(point => (point.x * cos) + (point.y * sin));
    const across = quad.map(point => (point.x * sin) - (point.y * cos));
    return {
        length: Math.max(...along) - Math.min(...along),
        thickness: Math.max(...across) - Math.min(...across),
    };
}

test('socket-snapped power lines reach overlength targets while free placement and other connectors stay clamped', () => {
    const state = {
        ...DEFAULT_FOXHOLE_SPLINE_CONNECTOR_STATE,
        foxholeKey: 'powerline', minLength: 1, maxLength: 100,
        minRadius: 1, maxRadius: 100, maxBuffer: 0, curveT: 0,
        start: { x: 0, y: 0, rotation: 0 }, end: { x: 20, y: 0, rotation: 0 },
    };
    const cursor = { x: 150, y: 0 };
    const snapped = { local: cursor, rotation: 0 };
    const session = () => ({ phase: 'pick-end' as const });

    const powerline = resolveFoxholeSplinePlacementPreview(state, session(), cursor, { snapped });
    const free = resolveFoxholeSplinePlacementPreview(state, session(), cursor, {});
    const pipe = resolveFoxholeSplinePlacementPreview({ ...state, foxholeKey: 'facilitypipe' },
        session(), cursor, { snapped });

    assert.deepEqual({ x: powerline.end.x, y: powerline.end.y }, cursor);
    assert.equal(isFoxholePowerlineOverLength(powerline.start, powerline.end, state.maxLength), true);
    assert.equal(free.end.x, state.maxLength);
    assert.equal(pipe.end.x, state.maxLength);
});

test('powerline selection quad grows along its chord without growing cross-axis thickness', () => {
    const shortEnd = { x: 100, y: 100 };
    const longEnd = { x: 200, y: 200 };
    const angle = Math.atan2(shortEnd.y, shortEnd.x);
    const shortExtents = projectQuadExtents(
        resolveFoxholePowerlineSelectionQuad({ x: 0, y: 0 }, shortEnd, 3),
        angle,
    );
    const longExtents = projectQuadExtents(
        resolveFoxholePowerlineSelectionQuad({ x: 0, y: 0 }, longEnd, 3),
        angle,
    );

    assert.ok(longExtents.length > shortExtents.length);
    assert.ok(Math.abs(shortExtents.thickness - 3) < 1e-9);
    assert.ok(Math.abs(longExtents.thickness - 3) < 1e-9);
});

test('free-rotating connector endpoints keep radial length limits without locking to a socket axis', () => {
    assert.equal(shouldLockFoxholeConnectorEndpointToSocketAxis({
        usesStraightChord: true,
        foxholeKey: 'powerline',
        oppositeEndpointAttached: true,
        activeEndpointSnapped: false,
    }), false);
    for (const foxholeKey of ['wallsplinet1', 'wallsplinet2', 'wallsplinet3']) {
        assert.equal(shouldLockFoxholeConnectorEndpointToSocketAxis({
            usesStraightChord: true,
            foxholeKey,
            oppositeEndpointAttached: true,
            activeEndpointSnapped: false,
        }), false);
    }
    assert.equal(shouldLockFoxholeConnectorEndpointToSocketAxis({
        usesStraightChord: true,
        foxholeKey: 'facilitypipeoverhead',
        oppositeEndpointAttached: true,
        activeEndpointSnapped: false,
    }), true);
    assert.equal(shouldLockFoxholeConnectorEndpointToSocketAxis({
        usesStraightChord: true,
        foxholeKey: 'facilitycatwalkbridge',
        oppositeEndpointAttached: true,
        activeEndpointSnapped: false,
    }), true);
});

test('field connectors only accept socket snaps along their straight chord', () => {
    assert.equal(requiresStraightConnectorSocketAlignment('fieldbridge'), true);
    assert.equal(requiresStraightConnectorSocketAlignment('fieldpier'), true);
    assert.equal(requiresStraightConnectorSocketAlignment('facilitypipeoverhead'), true);
    assert.equal(requiresStraightConnectorSocketAlignment('facilitycatwalkbridge'), true);
    assert.equal(requiresStraightConnectorSocketAlignment('powerline'), false);
    assert.equal(requiresStraightConnectorSocketAlignment('wallsplinet1'), false);
    assert.equal(requiresStraightConnectorSocketAlignment('wallsplinet2'), false);
    assert.equal(requiresStraightConnectorSocketAlignment('wallsplinet3'), false);

    assert.equal(isStraightConnectorSocketSnapAligned({
        foxholeKey: 'fieldbridge',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 0 },
        endpointTangentRotation: 0,
    }), true);
    assert.equal(isStraightConnectorSocketSnapAligned({
        foxholeKey: 'fieldpier',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 100 },
        endpointTangentRotation: 0,
    }), false);
    assert.equal(isStraightConnectorSocketSnapAligned({
        foxholeKey: 'wallsplinet1',
        start: { x: 0, y: 0 },
        end: { x: 100, y: 100 },
        endpointTangentRotation: 0,
    }), true);
});

test('detached powerline endpoints rotate back onto the persisted chord', () => {
    const rotations = resolvePowerlineEndpointRotationsAfterDetach({
        start: { x: 0, y: 0, rotation: -0.25 },
        end: { x: 100, y: 100, rotation: 0 },
        detachedStart: false,
        detachedEnd: true,
    });

    assert.equal(rotations.startRotation, -0.25);
    assert.ok(Math.abs(rotations.endRotation - (Math.PI / 4)) < 0.001);
});

test('reloaded powerline socket indicators ignore stale endpoint rotations', () => {
    const staleStart = { x: 0, y: 0, rotation: -0.25 };
    const staleEnd = { x: 100, y: 100, rotation: 0 };

    assert.ok(Math.abs(
        resolveConnectorEndpointVisualRotation('start', staleStart, staleEnd, 'powerline')
        - (Math.PI / 4),
    ) < 0.001);
    assert.ok(Math.abs(
        resolveConnectorEndpointVisualRotation('end', staleStart, staleEnd, 'powerline')
        - (Math.PI / 4),
    ) < 0.001);
});

test('field connector socket indicators follow the straight chord after snapping', () => {
    const staleStart = { x: 0, y: 0, rotation: -0.25 };
    const staleEnd = { x: 100, y: 0, rotation: 0.2 };

    assert.equal(resolveConnectorEndpointVisualRotation('start', staleStart, staleEnd, 'fieldbridge'), 0);
    assert.equal(resolveConnectorEndpointVisualRotation('end', staleStart, staleEnd, 'fieldbridge'), 0);
    assert.equal(resolveConnectorEndpointVisualRotation('start', staleStart, staleEnd, 'fieldpier'), 0);
    assert.equal(resolveConnectorEndpointVisualRotation('end', staleStart, staleEnd, 'fieldpier'), 0);
    assert.equal(resolveConnectorAttachmentStatusVisualRotation(0.2, 'fieldbridge'), -0.2);
    assert.equal(resolveConnectorAttachmentStatusVisualRotation(-0.15, 'fieldpier'), 0.15);
    assert.equal(resolveConnectorAttachmentStatusVisualRotation(0.2, 'powerline'), 0);
});

test('powerline attachment reconciliation keeps target-facing snap rotation', () => {
    const powerTags = [{ mask: BigInt(131072), category: BigInt(262144) }];
    const result = reconcileFoxholeConnectorAttachments({
        connectorNodeId: 'line',
        endSocketName: 'FrontSocket',
        movingSockets: [{
            nodeId: 'line',
            socketName: 'FrontSocket',
            x: 100,
            y: 100,
            rotation: Math.PI,
            socketTags: powerTags,
        }],
        targets: [{
            nodeId: 'building',
            sockets: [{
                nodeId: 'building',
                socketName: 'PowerSocket',
                x: 100,
                y: 100,
                rotation: 0,
                socketTags: powerTags,
            }],
            attachments: {},
        }],
    });

    assert.deepEqual(result.endAttachment, {
        nodeId: 'building',
        socketName: 'PowerSocket',
    });
    assert.deepEqual(result.targetAttachmentsByNode.get('building'), {
        PowerSocket: { nodeId: 'line', socketName: 'FrontSocket' },
    });
});

test('powerline handle drags preserve target-facing snap rotations for reconciliation', () => {
    assert.equal(shouldSynchronizeStraightConnectorEndpointRotations({
        pathStyle: 'straight-telescoping',
        foxholeKey: 'powerline',
        startAttached: false,
        endAttached: false,
    }), false);
    assert.equal(shouldSynchronizeStraightConnectorEndpointRotations({
        pathStyle: 'straight-telescoping',
        foxholeKey: 'facilitypipeoverhead',
        startAttached: false,
        endAttached: false,
    }), true);
    assert.equal(shouldSynchronizeStraightConnectorEndpointRotations({
        pathStyle: 'straight-telescoping',
        foxholeKey: 'facilitypipeoverhead',
        startAttached: true,
        endAttached: false,
    }), false);
    assert.equal(shouldSynchronizeStraightConnectorEndpointRotations({
        pathStyle: 'interval',
        foxholeKey: 'waterminespline',
        startAttached: false,
        endAttached: false,
    }), true);
});

test('power socket capacity permits four pole links and preserves the moving endpoint slot', () => {
    const connections = [0, 1, 2, 3].map(index => ({
        connectorNodeId: `line-${index}`,
        connectorSocketName: 'StartSocket',
        attachment: { nodeId: 'pole', socketName: 'PowerSocket' },
    }));

    assert.equal(isFoxholePowerSocketConnectionAvailable({
        targetNodeId: 'pole',
        targetSocketName: 'PowerSocket',
        maxConnections: 4,
        connections,
        movingConnectorNodeId: 'new-line',
        movingConnectorSocketName: 'StartSocket',
    }), false);
    assert.equal(isFoxholePowerSocketConnectionAvailable({
        targetNodeId: 'pole',
        targetSocketName: 'PowerSocket',
        maxConnections: 4,
        connections,
        movingConnectorNodeId: 'line-3',
        movingConnectorSocketName: 'StartSocket',
    }), true);
    assert.equal(isFoxholePowerSocketConnectionAvailable({
        targetNodeId: 'factory',
        targetSocketName: 'PowerSocket',
        maxConnections: 1,
        connections: connections.slice(0, 1).map(connection => ({
            ...connection,
            attachment: { nodeId: 'factory', socketName: 'PowerSocket' },
        })),
        movingConnectorNodeId: 'new-line',
        movingConnectorSocketName: 'EndSocket',
    }), false);
});

test('structure hover chooses an available power socket even away from the socket point', () => {
    const powerTags = [{ mask: BigInt(131072), category: BigInt(262144) }];
    const socket = resolveHoveredFoxholePowerSocketTarget(
        { x: 500, y: 500 },
        [{
            collectSnapSocketPoints: () => [{
                nodeId: 'full-building',
                socketName: 'PowerSocket',
                x: 10,
                y: 10,
                rotation: 0,
                socketTags: powerTags,
            }],
        }, {
            collectSnapSocketPoints: () => [{
                nodeId: 'available-building',
                socketName: 'PowerSocket',
                x: 20,
                y: 20,
                rotation: 0,
                socketTags: powerTags,
            }],
        }],
        {} as never,
        undefined,
        candidate => candidate.nodeId === 'available-building',
    );

    assert.equal(socket?.nodeId, 'available-building');
});

const start = { x: 0, y: 0, rotation: 0 };
const end = { x: 120, y: 0, rotation: 0 };

test('facility pipe side sockets follow the path midpoint with opposing normals', () => {
    const sockets = resolveFacilityPipeSideSocketPlacements(
        start,
        end,
        { minLength: 1, maxLength: 1000, curveT: 0 },
        'spline',
        'facilitypipe',
        { lateralOffset: 10 },
    );

    assert.deepEqual(sockets.map(socket => socket.name), ['LeftSocket', 'RightSocket']);
    assert.ok(Math.abs((sockets[0]?.x ?? 0) - 60) < 0.01);
    assert.ok(Math.abs((sockets[0]?.y ?? 0) + 10) < 0.01);
    assert.ok(Math.abs((sockets[1]?.y ?? 0) - 10) < 0.01);
    assert.ok(Math.abs((sockets[0]?.rotation ?? 0) + (Math.PI * 0.5)) < 0.01);
    assert.ok(Math.abs((sockets[1]?.rotation ?? 0) - (Math.PI * 0.5)) < 0.01);

    assert.deepEqual(resolveFacilityPipeSideSocketPlacements(
        start,
        end,
        { minLength: 1, maxLength: 1000, curveT: 0 },
        'spline',
        'facilitypipeunderground',
    ), []);
});

test('resolveConnectorSpanCrossHalfWidth uses span texture height', () => {
    assert.equal(
        resolveConnectorSpanCrossHalfWidth({ height: 40 } as never, 0.5),
        10,
    );
});

test('rail tracks repeat the complete generated span texture without runtime UV clipping', () => {
    const mapping = resolveConnectorSpanTextureMapping(
        { width: 345 } as never,
        {
            meshConfigs: [{
                mode: 'spline',
                nativeMeshLengthCm: 1000.157,
                interval: 100,
            }],
        } as never,
        345,
        'spline',
    );

    assert.deepEqual(mapping, {
        repeatLength: 172.5,
    });
});

test('land walls repeat their complete centered render instead of a blueprint interval length', () => {
    const connector = {
        meshConfigs: [
            { mode: 'interval', interval: 100, startOffset: 20, endOffset: 70 },
            { mode: 'interval', interval: 200, startOffset: 100, endOffset: 100 },
            { mode: 'interval', interval: 200, startOffset: 200, endOffset: 0 },
        ],
    } as never;

    assert.deepEqual(resolveConnectorSpanTextureMapping(
        { width: 138 } as never,
        connector,
        138,
        'straight-telescoping',
        { foxholeKey: 'wallsplinet2' },
    ), {
        repeatLength: 69,
    });
    assert.deepEqual(resolveConnectorSpanInsets(
        'straight-telescoping',
        connector,
        undefined,
        undefined,
        { foxholeKey: 'wallsplinet2' },
    ), {
        startInset: 0,
        endInset: 0,
    });
});

test('land wall detail layers follow their own authored intervals', () => {
    const connector = {
        meshConfigs: [
            { mode: 'interval', interval: 100, startOffset: 20, endOffset: 70 },
            { mode: 'interval', interval: 200, startOffset: 100, endOffset: 100 },
            { mode: 'interval', interval: 200, startOffset: 200, endOffset: 0 },
        ],
    } as never;
    const sixMetersInBoardPixels = 600 * (32 / 100);

    const barbedWire = resolveMeshConfigIntervalMarkerDistances(
        resolveLandWallLayerMeshConfig(connector, 'barbedwire'),
        sixMetersInBoardPixels,
    );
    const middlePillars = resolveCenteredMeshConfigIntervalBoundaryDistances(
        resolveLandWallLayerMeshConfig(connector, 'middlepillars'),
        sixMetersInBoardPixels,
    );

    assert.equal(barbedWire.length, 6);
    assert.deepEqual(middlePillars.map(marker => marker.distance), [64, 128]);
});

test('land wall repeat remainders are split symmetrically between end pillars', () => {
    assert.equal(resolveCenteredTextureRepeatDistanceOffset(160, 64), -16);
    assert.deepEqual(resolveCenteredMeshConfigIntervalBoundaryDistances(
        { interval: 200 } as never,
        160,
    ).map(marker => marker.distance), [16, 80, 144]);
});

test('isUndergroundPipe identifies underground facility pipes', () => {
    assert.equal(isUndergroundPipe('facilitypipeunderground'), true);
    assert.equal(isUndergroundPipe('facilitypipe'), false);
});

test('usesSocketFacingEndRotation applies to ground pipes only', () => {
    assert.equal(usesSocketFacingEndRotation('facilitypipe'), true);
    assert.equal(usesSocketFacingEndRotation('facilitypipeunderground'), false);
    assert.equal(usesSocketFacingEndRotation('smallrailtrackspline'), false);
});

test('resolveDefaultEndRotation uses opposite conventions for ground and underground pipes', () => {
    const ground = resolveDefaultEndRotation(start, end, 'facilitypipe');
    const underground = resolveDefaultEndRotation(start, end, 'facilitypipeunderground');
    assert.ok(Math.abs(Math.abs(ground) - Math.PI) < 0.001);
    assert.ok(Math.abs(underground) < 0.001);
    assert.ok(Math.abs(ground - underground - Math.PI) < 0.001 || Math.abs(ground - underground + Math.PI) < 0.001);
});

test('usesFacilityPipeGuidePath includes ground and underground facility pipes', () => {
    assert.equal(usesFacilityPipeGuidePath('facilitypipe'), true);
    assert.equal(usesFacilityPipeGuidePath('facilitypipeunderground'), true);
    assert.equal(usesFacilityPipeGuidePath('smallrailtrackspline'), false);
});

test('resolveDefaultEndRotation aligns underground pipe ends with the chord', () => {
    const rotation = resolveDefaultEndRotation(start, end, 'facilitypipeunderground');
    assert.ok(Math.abs(rotation) < 0.001);
});

test('resolveTrimDisplayRotation aligns ground pipe front trim with path tangent', () => {
    const rotation = resolveTrimDisplayRotation(Math.PI, 'end', 'facilitypipe');
    assert.ok(Math.abs(rotation) < 0.001);
});

test('resolveHybridPipeBezierEndRotation aligns curved pipe tangents with trim display', () => {
    const endRotation = resolveDefaultEndRotation(start, end, 'facilitypipe');
    const bezierEndRotation = resolveHybridPipeBezierEndRotation(endRotation, 'facilitypipe');
    const trimRotation = resolveTrimDisplayRotation(endRotation, 'end', 'facilitypipe');
    assert.ok(Math.abs(bezierEndRotation - trimRotation) < 0.001);
    assert.ok(Math.abs(resolveHybridPipeBezierEndRotation(endRotation, 'facilitypipeunderground') - endRotation) < 0.001);
});

test('resolveTrimDisplayRotation keeps underground trim rotation unchanged', () => {
    const rotation = resolveTrimDisplayRotation(0.4, 'end', 'facilitypipeunderground');
    assert.ok(Math.abs(rotation - 0.4) < 0.001);
});

test('rail track end caps stay hidden until fork topology is modeled', () => {
    assert.equal(usesRailTrackForkEndCaps('railtracksplinebiarc'), true);
    assert.equal(usesRailTrackForkEndCaps('smallrailtracksplinebiarc'), true);
    assert.equal(usesRailTrackForkEndCaps('railtrackspline'), false);
    assert.equal(usesRailTrackForkEndCaps('railtracksplinefoundation'), false);
    assert.equal(usesRailTrackForkEndCaps('cranerailtrackspline'), false);
    assert.equal(shouldRenderConnectorEndCapLayers('railtrackspline'), false);
    assert.equal(shouldRenderConnectorEndCapLayers('railtracksplinebiarc'), false);
    assert.equal(shouldRenderConnectorEndCapLayers('smallrailtracksplinebiarc'), false);
    assert.equal(shouldRenderConnectorEndCapLayers('facilitypipe'), true);
});

test('underground pipes use spline path style and rotation handles', () => {
    assert.equal(resolveEffectiveConnectorPathStyle('endpoints-only', 'facilitypipeunderground'), 'spline');
    assert.equal(allowsConnectorRotationHandles('endpoints-only', 'facilitypipeunderground'), true);
    assert.equal(allowsConnectorRotationHandles('spline', 'facilitypipeunderground'), true);
});

test('cranerail and interval connectors omit rotation handles', () => {
    assert.equal(allowsConnectorRotationHandles('interval', 'cranerailtrackspline'), false);
    assert.equal(allowsConnectorRotationHandles('spline', 'cranerailtrackspline'), false);
    assert.equal(allowsConnectorRotationHandles('spline', 'facilityroad'), true);
    assert.equal(allowsConnectorRotationHandles('straight-telescoping', 'facilitypipeoverhead'), false);
    assert.equal(allowsConnectorRotationHandles('straight-telescoping', 'fieldbridge'), false);
    assert.equal(allowsConnectorRotationHandles('straight-telescoping', 'wallsplinet1'), false);
    assert.equal(allowsConnectorRotationHandles('endpoints-only', 'powerline'), false);
    assert.equal(isPowerlineConnector('powerline'), true);
    assert.equal(allowsConnectorRotationHandles('spline', 'powerline'), false);
});

test('reference roads do not imply unverified rotation limits with an invalid tint', () => {
    for (const road of [
        'dirtroad',
        'gravelroad',
        'greatmarchroad',
        'packeddirtroad',
        'snowdirtroad',
        'snowgravelroad',
        'snowpackeddirtroad',
    ]) {
        assert.equal(shouldTintInvalidSplinePath(road), false, road);
    }
    assert.equal(shouldTintInvalidSplinePath('facilityroad'), true);
});

test('crane rail keeps interval repetition on a straight sampled chord', () => {
    assert.equal(usesStraightSampledConnectorPath('interval', 'cranerailtrackspline'), true);
    assert.equal(usesStraightSampledConnectorPath('interval', 'waterminespline'), true);
    assert.equal(usesStraightSampledConnectorPath('interval', 'facilityroad'), false);

    const sampled = sampleConnectorPath(
        { x: 0, y: 0, rotation: Math.PI / 2 },
        { x: 240, y: 0, rotation: -Math.PI / 2 },
        { minLength: 0, maxLength: 1000, curveT: 1 },
        'interval',
        { foxholeKey: 'cranerailtrackspline' },
    );

    assert.ok(sampled.points.length >= 2);
    assert.ok(sampled.points.every(point => Math.abs(point.y) < 1e-9));
    assert.deepEqual(sampled.points[0], { x: 0, y: 0 });
    assert.deepEqual(sampled.points.at(-1), { x: 240, y: 0 });
});

test('minefields ignore endpoint rotations and sample a straight chord', () => {
    const sampled = sampleConnectorPath(
        { x: 0, y: 0, rotation: Math.PI / 2 },
        { x: 240, y: 0, rotation: -Math.PI / 2 },
        { minLength: 0, maxLength: 1000, curveT: 1 },
        'interval',
        { foxholeKey: 'waterminespline' },
    );

    assert.ok(sampled.points.every(point => Math.abs(point.y) < 1e-9));
    assert.deepEqual(sampled.points[0], { x: 0, y: 0 });
    assert.deepEqual(sampled.points.at(-1), { x: 240, y: 0 });
});

test('interval connectors with max arc constraints expose rotation handles', () => {
    assert.equal(allowsConnectorRotationHandles('interval', 'sandbaghalfspline'), true);
    assert.equal(allowsConnectorRotationHandles('interval', 'sandbagfullspline'), true);
    const curvedSandbag = sampleConnectorPath(
        { x: 0, y: 0, rotation: Math.PI / 2 },
        { x: 240, y: 0, rotation: -Math.PI / 2 },
        { minLength: 134.4, maxLength: 320, minRadius: 16, curveT: 1 },
        'interval', { foxholeKey: 'sandbaghalfspline' },
    );
    assert.ok(curvedSandbag.points.some(point => point.y > 1));
    assert.equal(allowsConnectorRotationHandles('interval', 'tankstopsplinet3', { maxArcAngleDeg: 135 }), true);
    assert.equal(allowsConnectorRotationHandles('interval', 'minespline'), false);
    assert.equal(allowsConnectorRotationHandles('interval', 'infantryminespline'), false);
    assert.equal(allowsConnectorRotationHandles('interval', 'tankminespline'), false);
    assert.equal(allowsConnectorRotationHandles('interval', 'surfacewaterminespline', { maxArcAngleDeg: -1 }), false);
    assert.equal(allowsConnectorRotationHandles('interval', 'waterminespline', { maxArcAngleDeg: 360 }), false);
});

test('resolveFoxholeSplinePowerlineGeometry anchors start at origin', () => {
    const geometry = resolveFoxholeSplinePowerlineGeometry({
        attachedStart: { x: 40, y: 50 },
        attachedEnd: { x: 140, y: 50 },
    });
    assert.deepEqual(geometry, {
        x: 40,
        y: 50,
        start: { x: 0, y: 0, rotation: 0 },
        end: { x: 100, y: 0, rotation: 0 },
    });
});

test('mine spline connectors use interval marker placement', () => {
    assert.equal(usesMineSplineConnector('minespline'), true);
    assert.equal(usesMineSplineConnector('infantryminespline'), true);
    assert.equal(usesMineSplineConnector('waterminespline'), true);
    assert.equal(usesMineSplineConnector('surfacewaterminespline'), true);
    assert.equal(usesMineSplineConnector('tankminespline'), true);
    assert.equal(usesTrimSpanSplineConnector('barbedwirespline'), true);
    assert.equal(usesTrimSpanSplineConnector('waterwallsplinet1'), true);
});

test('Barbed Wire uses curved handles and repeats its full extracted coil span', () => {
    const style = resolveEffectiveConnectorPathStyle('straight-telescoping', 'barbedwirespline');
    assert.equal(style, 'spline');
    assert.equal(allowsConnectorRotationHandles(style, 'barbedwirespline'), true);
    assert.equal(resolveConnectorSpanTextureMapping({ width: 247 }, {
        meshConfigs: [{ mode: 'interval', interval: 70 }],
    }, 247, style).repeatLength, 123.5);
    const curved = sampleConnectorPath(
        { x: 0, y: 0, rotation: -0.5 }, { x: 240, y: 0, rotation: 0.5 },
        { minLength: 96, maxLength: 320, defaultHandleLength: 96, curveT: 1 }, style,
        { foxholeKey: 'barbedwirespline' },
    );
    assert.ok(Math.abs(curved.points[Math.floor(curved.points.length / 2)]!.y) > 5);
    assert.deepEqual(resolveConnectorSpanInsets(style, undefined, { width: 32 }, { width: 32 },
        { foxholeKey: 'barbedwirespline' }), { startInset: 0, endInset: 0 });
    assert.deepEqual(resolveConnectorSpanInsets(style, undefined, { width: 32 }, { width: 32 },
        { foxholeKey: 'facilitypipe' }), { startInset: 13, endInset: 13 });
    assert.equal(resolveEffectiveConnectorPathStyle('straight-telescoping', 'facilitypipeoverhead'), 'straight-telescoping');
});

test('interval marker splines place repeating sprites instead of warped span meshes', () => {
    const connector = {
        pathStyle: 'interval',
        meshConfigs: [{
            mode: 'interval',
            interval: 375,
            nativeMeshLengthCm: 206.242,
        }],
    };
    assert.equal(usesIntervalMarkerSpan('interval', connector), true);
    assert.equal(usesIntervalMarkerSpan('interval', {
        pathStyle: 'interval',
        meshConfigs: [
            { mode: 'spline', nativeMeshLengthCm: 260 },
            { mode: 'interval', interval: 231.5 },
        ],
    }), false);

    const intervalPixels = 375 * (32 / 100);
    const markers = resolveIntervalMarkerDistances(connector, intervalPixels, 'interval', 2);
    assert.equal(markers.length, 2);
    assert.equal(markers[0]?.meshIndex, 0);
    assert.equal(markers[1]?.meshIndex, 1);
});

test('trim-span spline connectors are recognized for placement', () => {
    assert.equal(usesTrimSpanSplineConnector('fieldbridge'), true);
    assert.equal(usesTrimSpanSplineConnector('fieldpier'), true);
    assert.equal(usesTrimSpanSplineConnector('facilitycatwalkbridge'), true);
    assert.equal(usesTrimSpanSplineConnector('wallsplinet2'), true);
    assert.equal(usesTrimSpanSplineConnector('railtrackspline'), false);
});

test('field connectors use handle-to-handle span placement', () => {
    assert.equal(usesFieldConnectorSpan('fieldbridge'), true);
    assert.equal(usesFieldConnectorSpan('fieldpier'), true);
    assert.equal(usesFieldConnectorSpan('facilitycatwalkbridge'), true);
    assert.equal(usesFieldConnectorSpan('wallsplinet1'), false);
});

test('straight telescoping front trim uses chord rotation for field connectors', () => {
    const backRotation = 0.25;
    const frontRotation = resolveStraightConnectorFrontTrimRotation(backRotation, 'fieldbridge');
    assert.ok(Math.abs(frontRotation - backRotation) < 0.001);
    assert.equal(resolveStraightConnectorFrontTrimRotation(backRotation, 'wallsplinet1'), backRotation);
});

test('field connector ramp anchors pin handle-side edge at spline endpoint', () => {
    const layer = { width: 20, anchorX: 1, anchorY: 0.25 };
    assert.deepEqual(resolveConnectorRampSpriteAnchor(layer, 'back'), { x: 1, y: 0.25 });
    assert.deepEqual(resolveConnectorRampSpriteAnchor(layer, 'front'), { x: 0, y: 0.25 });
});

test('rotation-handle splines use full curve tension', () => {
    const state = {
        foxholeKey: 'facilityroad',
        curveT: 0,
        minLength: 100,
        maxLength: 200,
        minRadius: 20,
        maxRadius: 200,
        maxBuffer: 10,
        start: { x: 0, y: 0, rotation: 0 },
        end: { x: 100, y: 0, rotation: 0 },
    };
    assert.equal(resolveSplineConnectorCurveT(state, 'spline'), 1);
    assert.equal(resolveSplineConnectorCurveT({ ...state, foxholeKey: 'facilitypipe' }, 'spline'), 0);
});

test('rotation-handle splines distribute their curve across the chord', () => {
    const state = {
        foxholeKey: 'dirtroad',
        curveT: 0,
        minLength: 100,
        maxLength: 1000,
        minRadius: 20,
        maxRadius: 1000,
        maxBuffer: 64,
        start: { x: 0, y: 0, rotation: Math.PI / 3 },
        end: { x: 1000, y: 0, rotation: Math.PI / 3 },
    };
    const constraints = getFoxholeSplineConnectorConstraints(state as any, 'spline');
    const sampled = sampleConnectorSplinePath(state.start, state.end, constraints);
    const quarter = sampled.points[Math.floor((sampled.points.length - 1) * 0.25)]!;
    const threeQuarter = sampled.points[Math.floor((sampled.points.length - 1) * 0.75)]!;

    assert.equal(constraints.defaultHandleLength, 400);
    assert.equal(constraints.maxBuffer, undefined);
    assert.ok(quarter.y > 80);
    assert.ok(threeQuarter.y < -80);

    const pipeConstraints = getFoxholeSplineConnectorConstraints({
        ...state,
        foxholeKey: 'facilitypipe',
    } as any, 'spline');
    assert.equal(pipeConstraints.defaultHandleLength, 64);
    assert.equal(pipeConstraints.maxBuffer, 64);
});

test('resolveConnectorSocketSnapStemRotation offsets back sockets by pi', () => {
    assert.ok(Math.abs(resolveConnectorSocketSnapStemRotation('start', 0, 0) - Math.PI) < 0.001);
    assert.ok(Math.abs(resolveConnectorSocketSnapStemRotation('end', 0, 0)) < 0.001);
    assert.ok(Math.abs(
        resolveConnectorSocketSnapStemRotation('start', 0, 0)
        - resolveConnectorSocketSnapStemRotation('end', 0, 0)
        - Math.PI,
    ) < 0.001 || Math.abs(
        resolveConnectorSocketSnapStemRotation('start', 0, 0)
        - resolveConnectorSocketSnapStemRotation('end', 0, 0)
        + Math.PI,
    ) < 0.001);
});

test('resolveConnectorSocketOutwardRotation faces ground pipe endpoints in opposite directions', () => {
    const startRotation = 0;
    const endRotation = resolveDefaultEndRotation(start, end, 'facilitypipe');
    const startOutward = resolveConnectorSocketOutwardRotation('start', startRotation, 'facilitypipe');
    const endOutward = resolveConnectorSocketOutwardRotation('end', endRotation, 'facilitypipe');
    assert.ok(Math.abs(startOutward - Math.PI) < 0.001);
    assert.ok(Math.abs(endOutward) < 0.001);
    assert.ok(Math.abs(startOutward - endOutward - Math.PI) < 0.001
        || Math.abs(startOutward - endOutward + Math.PI) < 0.001);
});

test('resolveConnectorSocketOutwardRotation keeps underground end sockets outward aligned', () => {
    const endRotation = resolveDefaultEndRotation(start, end, 'facilitypipeunderground');
    const endOutward = resolveConnectorSocketOutwardRotation('end', endRotation, 'facilitypipeunderground');
    assert.ok(Math.abs(endOutward) < 0.001);
});

test('overhead pipe socket indicators face outward after straight-chord normalization', () => {
    const staleStart = { x: 0, y: 0, rotation: -0.25 };
    const staleEnd = { x: 100, y: 0, rotation: 0.2 };
    const startVisualRotation = resolveConnectorEndpointVisualRotation(
        'start',
        staleStart,
        staleEnd,
        'facilitypipeoverhead',
    );
    const endVisualRotation = resolveConnectorEndpointVisualRotation(
        'end',
        staleStart,
        staleEnd,
        'facilitypipeoverhead',
    );
    const startOutward = resolveConnectorSocketOutwardRotation(
        'start',
        startVisualRotation,
        'facilitypipeoverhead',
    );
    const endOutward = resolveConnectorSocketOutwardRotation(
        'end',
        endVisualRotation,
        'facilitypipeoverhead',
    );

    assert.ok(Math.abs(startOutward - Math.PI) < 0.001);
    assert.ok(Math.abs(endOutward) < 0.001);
});

test('overhead pipe snapping keeps its persisted front socket facing outward', () => {
    const rotations = resolveStraightConnectorEndpointRotations(
        { x: 0, y: 0, rotation: -0.25 },
        { x: 100, y: 0, rotation: 0.2 },
        'facilitypipeoverhead',
    );
    const endOutward = resolveConnectorSocketSnapStemRotation(
        'end',
        rotations.endRotation,
        0,
        'facilitypipeoverhead',
    );

    assert.ok(Math.abs(endOutward) < 0.001);
});

test('usesSplineConnectorSocketSnapping covers power lines, bridges, walls, pipes, catwalks, and rail tracks', () => {
    assert.equal(usesSplineConnectorSocketSnapping('powerline'), true);
    assert.equal(usesSplineConnectorSocketSnapping('fieldbridge'), true);
    assert.equal(usesSplineConnectorSocketSnapping('fieldpier'), true);
    assert.equal(usesSplineConnectorSocketSnapping('wallsplinet1'), true);
    assert.equal(usesSplineConnectorSocketSnapping('wallsplinet2'), true);
    assert.equal(usesSplineConnectorSocketSnapping('wallsplinet3'), true);
    assert.equal(usesSplineConnectorSocketSnapping('facilitypipe'), true);
    assert.equal(usesSplineConnectorSocketSnapping('facilitypipeunderground'), true);
    assert.equal(usesSplineConnectorSocketSnapping('facilitypipeoverhead'), true);
    assert.equal(usesSplineConnectorSocketSnapping('facilitycatwalkbridge'), true);
    assert.equal(usesSplineConnectorSocketSnapping('smallrailtracksplinefoundation'), true);
    assert.equal(usesSplineConnectorSocketSnapping('railtrackspline'), true);
    assert.equal(usesSplineConnectorSocketSnapping('cranerailtrackspline'), false);
    assert.equal(usesSplineConnectorSocketSnapping('barbedwirespline'), true);
});

test('interval arc connectors keep full curveT through pipe constraint resolution', () => {
    const pathStyle = 'interval';
    const start = { x: 0, y: 0, rotation: -Math.PI / 4 };
    const end = { x: 480, y: 0, rotation: Math.PI / 4 };
    const state = {
        foxholeKey: 'tankstopsplinet3',
        minLength: 48,
        maxLength: 482,
        minRadius: 1,
        maxRadius: 482,
        maxBuffer: 120,
        curveT: 0,
        start,
        end,
    };
    const base = getFoxholeSplineConnectorConstraints(state as any, pathStyle);
    const constraints = resolvePipeSplineConstraints(
        base,
        resolvePipeConstraintOptions(state as any, pathStyle),
        { usePipeCurveScale: usesPipeCurveScale(pathStyle, state.foxholeKey) },
    );

    assert.equal(resolveSplineConnectorCurveT(state as any, pathStyle), 1);
    assert.equal(constraints.curveT, 1);

    const straight = sampleConnectorSplinePath({ x: 0, y: 0, rotation: 0 }, { x: 480, y: 0, rotation: 0 }, constraints);
    const curved = sampleConnectorSplinePath(start, end, constraints);
    const midIndex = Math.floor(curved.points.length / 2);
    const straightMidY = straight.points[midIndex]?.y ?? 0;
    const curvedMidY = curved.points[midIndex]?.y ?? 0;

    assert.equal(straightMidY, 0);
    assert.ok(Math.abs(curvedMidY) > 8);
    assert.ok(curved.totalLength > straight.totalLength);
});
