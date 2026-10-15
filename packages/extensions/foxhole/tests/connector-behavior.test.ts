import assert from 'node:assert/strict';
import test from 'node:test';
import {
    resolveConnectorBehavior,
    resolveConnectorBehaviorFromStructure,
} from '../app/plugins/foxhole/nixie/connector-behavior.ts';
import { usesPipeCurveScale } from '../app/plugins/foxhole/nixie/pipe-spline-constraints.ts';

test('resolveConnectorBehavior prefers manifest connector behavior over codename fallback', () => {
    const fromManifest = resolveConnectorBehavior('minespline', { behavior: { mineSpline: false, trimSpan: true } });
    assert.equal(fromManifest.mineSpline, false);
    assert.equal(fromManifest.trimSpan, true);

    const unknownWithManifest = resolveConnectorBehavior('not-a-real-asset', { behavior: { powerline: true } });
    assert.equal(unknownWithManifest.powerline, true);
    assert.equal(unknownWithManifest.trimSpan, false);

    const authoredRoad = resolveConnectorBehavior('dirtroad', {
        behavior: { socketSnapping: true, renderEndCaps: false },
    });
    assert.equal(authoredRoad.socketSnapping, true);
    assert.equal(authoredRoad.renderEndCaps, false);

    const authoredGreatMarchRoad = resolveConnectorBehavior('greatmarchroad', {
        behavior: { socketSnapping: true, renderEndCaps: false },
    });
    assert.equal(authoredGreatMarchRoad.socketSnapping, true);
    assert.equal(authoredGreatMarchRoad.renderEndCaps, false);
});

test('resolveConnectorBehaviorFromStructure reads structure connector behavior', () => {
    const behavior = resolveConnectorBehaviorFromStructure({
        id: 'minespline',
        connector: { behavior: { mineSpline: true } },
    });
    assert.equal(behavior.mineSpline, true);
    assert.equal(behavior.trimSpan, false);
});

test('resolveConnectorBehavior codename fallback covers spline families', () => {
    assert.equal(resolveConnectorBehavior('railtracksplinebiarc').railForkEndCaps, true);
    assert.equal(resolveConnectorBehavior('facilitypipe').pipeCurveScale, true);
    assert.equal(resolveConnectorBehavior('facilitypipe').pipeExtension, true);
    assert.equal(resolveConnectorBehavior('facilitypipeunderground').undergroundPipe, true);
    assert.equal(resolveConnectorBehavior('facilitypipeunderground').pipeCurveScale, true);
    assert.equal(resolveConnectorBehavior('facilitypipeunderground').pipeExtension, true);
    assert.equal(resolveConnectorBehavior('facilitypipeunderground').socketSnapping, true);
    assert.equal(resolveConnectorBehavior('facilitypipeoverhead').socketSnapping, true);
    assert.equal(resolveConnectorBehavior('fieldbridge').socketSnapping, true);
    assert.equal(resolveConnectorBehavior('fieldpier').socketSnapping, true);
    assert.equal(resolveConnectorBehavior('facilitycatwalkbridge').socketSnapping, true);
    assert.equal(resolveConnectorBehavior('facilitypipeoverhead').pipeCurveScale, true);
    assert.equal(resolveConnectorBehavior('facilitypipeoverhead').pipeExtension, true);
    assert.equal(resolveConnectorBehavior('cranerailtrackspline').railTrack, false);
});

test('usesPipeCurveScale reads manifest connector behavior', () => {
    assert.equal(usesPipeCurveScale('spline', 'otherpipe', { behavior: { pipeCurveScale: true } }), true);
    assert.equal(usesPipeCurveScale('spline', 'facilitypipe', { behavior: { pipeCurveScale: false } }), false);
    assert.equal(usesPipeCurveScale('spline', 'facilitypipeunderground'), true);
});
