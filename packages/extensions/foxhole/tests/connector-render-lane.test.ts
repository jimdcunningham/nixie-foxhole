import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import {
    FOXHOLE_BOARD_RENDER_LANE_STACK,
    FOXHOLE_LEGACY_CONNECTOR_RENDER_LANE,
    FOXHOLE_POWERLINE_RENDER_LANE,
    FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE,
    FOXHOLE_SPLINE_SHADOW_RENDER_LANE,
    FOXHOLE_STRUCTURE_RENDER_LANES,
    resolveFoxholeConnectorRenderLane,
    resolveFoxholeStructurePrimaryRenderLane,
} from '../app/plugins/foxhole/nixie/render-lanes.ts';

test('insulation retains the overhead connector lane for the actual pipe visual', () => {
    const source = ts.createSourceFile('connector.ts', readFileSync(new URL('../app/plugins/nixie/board/types/foxhole-spline-connector.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const nodeClass = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'FoxholeSplineConnectorNode') as ts.ClassDeclaration;
    const method = nodeClass.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'getBoardRenderParticipants')!;
    const code = ts.transpile(`class Methods { ${method.getText(source)} }; return Methods.prototype;`, { target: ts.ScriptTarget.ES2022 });
    const prototype = new Function('resolveFoxholeConnectorRenderLane', 'FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE', 'hasSplineContactShadow', code)(
        resolveFoxholeConnectorRenderLane, FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE, () => false,
    );
    for (const modifications of [{}, { UpgradeSlotComponent: 'insulation' }]) {
        const visual = {};
        const node = Object.assign(Object.create(prototype), {
            boardState: { foxholeKey: 'facilitypipeoverhead', modificationVariantIds: modifications },
            boardVisual: visual, getBoardRenderLocalOrder: () => 0,
        });
        const participant = node.getBoardRenderParticipants().find((entry: { id: string; }) => entry.id === 'default');
        assert.equal(participant.displayObject, visual);
        assert.equal(participant.laneId, 'foxhole:connector:overhead-pipe');
        assert.equal(participant.laneOrder, 120);
    }
});

test('overhead pipelines render above facilities and rail vehicles but below cranes', () => {
    for (const fallback of [FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE, FOXHOLE_LEGACY_CONNECTOR_RENDER_LANE]) {
        const lane = resolveFoxholeConnectorRenderLane('facilitypipeoverhead', fallback);
        assert.ok(lane.laneOrder > FOXHOLE_STRUCTURE_RENDER_LANES.base.laneOrder);
        assert.ok(lane.laneOrder > FOXHOLE_STRUCTURE_RENDER_LANES.vehicle.laneOrder);
        assert.ok(lane.laneOrder < FOXHOLE_STRUCTURE_RENDER_LANES.crane.laneOrder);
        assert.ok(FOXHOLE_BOARD_RENDER_LANE_STACK.some(entry => entry.laneId === lane.laneId));
    }
});

test('foxhole board render lane stack is ordered bottom-to-top', () => {
    for (let index = 1; index < FOXHOLE_BOARD_RENDER_LANE_STACK.length; index += 1) {
        const previous = FOXHOLE_BOARD_RENDER_LANE_STACK[index - 1]!;
        const current = FOXHOLE_BOARD_RENDER_LANE_STACK[index]!;

        assert.ok(
            current.laneOrder > previous.laneOrder
            || (current.laneOrder === previous.laneOrder && current.laneId > previous.laneId),
            `expected ${current.label} to render above ${previous.label}`,
        );
    }
});

test('connectors render below exterior structure components', () => {
    assert.ok(FOXHOLE_SPLINE_SHADOW_RENDER_LANE.laneOrder > FOXHOLE_STRUCTURE_RENDER_LANES.dirt.laneOrder);
    assert.ok(FOXHOLE_SPLINE_SHADOW_RENDER_LANE.laneOrder < FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE.laneOrder);
    assert.ok(FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE.laneOrder > FOXHOLE_STRUCTURE_RENDER_LANES.modification.laneOrder);
    assert.ok(FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE.laneOrder < FOXHOLE_STRUCTURE_RENDER_LANES.vehicle.laneOrder);
    assert.ok(FOXHOLE_STRUCTURE_RENDER_LANES.vehicle.laneOrder > FOXHOLE_STRUCTURE_RENDER_LANES.base.laneOrder);
    assert.ok(FOXHOLE_STRUCTURE_RENDER_LANES.base.laneOrder < FOXHOLE_STRUCTURE_RENDER_LANES.corners.laneOrder);
    assert.equal(
        FOXHOLE_LEGACY_CONNECTOR_RENDER_LANE.laneOrder,
        FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE.laneOrder,
    );
});

test('trench defenses render above every other trench visual', () => {
    const lanes = FOXHOLE_STRUCTURE_RENDER_LANES;
    assert.ok(lanes.trenchDefense.laneOrder > lanes.dirt.laneOrder);
    assert.ok(lanes.trenchDefense.laneOrder > lanes.base.laneOrder);
    assert.ok(lanes.trenchDefense.laneOrder > lanes.corners.laneOrder);
    assert.ok(lanes.trenchDefense.laneOrder > lanes.upperModification.laneOrder);
});

test('cranes and power lines render above facilities while the Sky Hauler stays on top', () => {
    const facility = resolveFoxholeStructurePrimaryRenderLane('facilityrefinery1');
    const crane = resolveFoxholeStructurePrimaryRenderLane('crane');
    const facilityCrane = resolveFoxholeStructurePrimaryRenderLane('facilitycrane');
    const skyHauler = resolveFoxholeStructurePrimaryRenderLane('largecrane');
    const powerline = resolveFoxholeConnectorRenderLane('powerline', FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE);

    assert.equal(facility, FOXHOLE_STRUCTURE_RENDER_LANES.base);
    assert.equal(crane, facilityCrane);
    assert.equal(powerline, FOXHOLE_POWERLINE_RENDER_LANE);
    assert.ok(crane.laneOrder > FOXHOLE_STRUCTURE_RENDER_LANES.upperModification.laneOrder);
    assert.ok(powerline.laneOrder < crane.laneOrder);
    assert.ok(skyHauler.laneOrder > powerline.laneOrder);
    assert.equal(resolveFoxholeStructurePrimaryRenderLane('trainengine', true), FOXHOLE_STRUCTURE_RENDER_LANES.vehicle);
    assert.ok(resolveFoxholeConnectorRenderLane('railtrackspline', FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE).laneOrder < FOXHOLE_SPLINE_CONNECTOR_RENDER_LANE.laneOrder);
    assert.equal(resolveFoxholeConnectorRenderLane('powerline', FOXHOLE_LEGACY_CONNECTOR_RENDER_LANE), FOXHOLE_POWERLINE_RENDER_LANE);
});

test('hitbox authoring overlays render above every Foxhole structure lane', () => {
    const hitboxLane = FOXHOLE_STRUCTURE_RENDER_LANES.hitboxDebug;
    for (const lane of FOXHOLE_BOARD_RENDER_LANE_STACK) {
        if (lane === hitboxLane) {
            continue;
        }
        assert.ok(hitboxLane.laneOrder > lane.laneOrder);
    }
});
