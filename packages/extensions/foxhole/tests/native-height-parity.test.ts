/* eslint-disable @typescript-eslint/no-explicit-any -- Execute actual renderer methods without initializing the editor. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { Container, Graphics } from 'pixi.js';
import * as lanes from '../app/plugins/foxhole/nixie/render-lanes.ts';
import { getBoardPickRenderRank } from '../../../nixie/app/plugins/nixie/board/utils/pick-render-rank.ts';

const source = readFileSync(new URL('../app/plugins/nixie/board/types/foxhole-structure.ts', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('structure.ts', source, ts.ScriptTarget.Latest, true);
const methods: string[] = [];
function visit(node: ts.Node): void {
    if (ts.isMethodDeclaration(node) && ['getBoardRenderParticipants', 'createSharedLaneParticipant'].includes(node.name.getText(parsed))) {
        methods.push(node.getText(parsed).replace(/^(?:override|private)\s+/, ''));
    }
    ts.forEachChild(node, visit);
}
visit(parsed);
const executable = ts.transpileModule(`class Renderer { ${methods.join('\n')} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const Renderer = new Function(...Object.keys(lanes), `${executable}; return Renderer;`)(...Object.values(lanes));

test('Native physical pieces use the same height policy as the portable renderer without ranges changing picks', () => {
    for (const id of ['foundation012x2t3', 'facilityrefinery1', 'weatherstation', 'truckc', 'shippingcontainer',
        'facilitycatwalkplatform', 'powerpole', 'playerc', 'crane', 'largecrane']) {
        for (const layered of [false, true]) {
            const node: any = new Renderer();
            Object.assign(node, {
                boardState: { foxholeKey: id }, getBoardRenderLocalOrder: () => 0,
                getEffectiveStructureReplacementSelection: () => null, getResolvedAsset: () => ({}),
                getResolvedStructure: () => ({ codeName: id }),
                isRailVehicleStructure: () => false, isUsingStructureRenderLayers: () => layered,
                isCompositingBaseTextureWithRenderLayers: () => false,
            });
            for (const field of ['structureFloorTextureOverlay', 'lowerModificationTextureOverlay', 'structureWallTextureOverlay',
                'modificationTextureOverlay', 'trenchDefenseTextureOverlay', 'structureDirtTextureOverlay', 'structureRoofTextureOverlay',
                'roofModificationTextureOverlay', 'structureCornerTextureOverlay', 'upperModificationTextureOverlay',
                'packagedPalletTextureOverlay', 'contactShadowOverlay', 'floorDetailTextureOverlay', 'bunkerSpotlightOverlay', 'hitboxDebugOverlay']) {
                node[field] = new Container();
            }
            const painted = () => new Graphics().rect(0, 0, 20, 20).fill(0xffffff);
            node.spriteObject = painted();
            node.structureFloorTextureOverlay = painted();
            node.structureWallTextureOverlay = painted();
            node.structureCornerTextureOverlay = painted();
            node.rangeOverlay = painted();
            const participants = node.getBoardRenderParticipants();
            const rank = getBoardPickRenderRank(participants);
            const expected = lanes.resolveFoxholeAssetHeightLane(id)
                ?? (layered ? lanes.FOXHOLE_STRUCTURE_RENDER_LANES.corners : lanes.FOXHOLE_STRUCTURE_RENDER_LANES.base);
            assert.equal(rank.laneOrder, expected.laneOrder, `${id}, layered=${layered}`);
            assert.equal(participants.find((entry: any) => entry.id === 'structure-ranges').affectsPickRank, false);
            for (const entry of participants) {
                entry.displayObject.destroy({ children: true });
            }
        }
    }
});
