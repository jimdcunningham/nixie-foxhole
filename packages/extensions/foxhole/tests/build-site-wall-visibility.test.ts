import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { canFoxholeSocketConnectionOpenWalls } from '../app/plugins/foxhole/nixie/socket-wall-visibility.ts';
import { resolveStructureAssetHoverTargetKey } from '../app/plugins/foxhole/nixie/structure-modification-hover-preview.ts';

const buildSites = ['fortbuildsite', 'fortcornerbuildsite', 'trenchbuildsite', 'trenchintbuildsite', 'trenchempbuildsite', 'trenchconnectorbuildsite'];
function methods(file: string, names: string[]) {
    const source = ts.createSourceFile(file, readFileSync(new URL('../app/plugins/nixie/board/types/' + file, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
    const declaration = source.statements.find(ts.isClassDeclaration)!;
    const bodies = declaration.members.filter(member => ts.isMethodDeclaration(member) && names.includes(member.name.getText(source))).map(member => member.getText(source)).join('\n');
    return new Function('canFoxholeSocketConnectionOpenWalls', 'resolveStructureAssetHoverTargetKey', 'activeNixieStructureModificationHoverPreview', ts.transpileModule(`class Host {
        getResolvedRenderStructure() { return { id: this.boardState.foxholeKey }; }
        getResolvedRenderKey() { return this.boardState.foxholeKey; }
        ${bodies} } return Host;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(
        canFoxholeSocketConnectionOpenWalls, resolveStructureAssetHoverTargetKey, { value: null });
}
const Structure = methods('foxhole-structure.ts', ['getLocalAttachmentOccupancyKeys', 'getWallVisibilityNeighborKey']);
const Connector = methods('foxhole-spline-connector.ts', ['getWallVisibilityAttachments']);

test('all build sites preserve structure walls without changing actual socket occupancy', () => {
    for (const site of buildSites) for (const reversed of [false, true]) {
        const host = new Structure();
        host.boardId = 'self'; host.boardState = { foxholeKey: reversed ? site : 'trencht3' };
        const attachment = { nodeId: 'neighbor', socketName: 'BackSocket' };
        host.getNormalizedSocketAttachments = () => ({ FrontSocket: attachment });
        const neighbor = { boardId: 'neighbor', boardState: { foxholeKey: reversed ? 'fortt3' : site }, children: [] };
        host.getTopBoardContainer = () => ({ children: [{ children: [neighbor] }] });
        assert.equal(host.getLocalAttachmentOccupancyKeys().size, 1);
        assert.equal(host.getLocalAttachmentOccupancyKeys(true).size, 0);
        host.boardState.foxholeKey = 'trencht3'; neighbor.boardState.foxholeKey = 'fortt3';
        assert.equal(host.getLocalAttachmentOccupancyKeys(true).size, 1);
    }
});

test('connector wall previews ignore build sites and restore normal occupancy for completed neighbors', () => {
    for (const site of buildSites) {
        const host = new Connector(); host.boardState = { foxholeKey: 'trenchconnectort3' };
        const attachments = { BackSocket: { nodeId: 'neighbor', socketName: 'FrontSocket' } };
        host.getEndpointOccupancyAttachments = () => attachments;
        const neighbor = { boardState: { foxholeKey: site } };
        host.findBoardNodeById = () => neighbor;
        assert.deepEqual(host.getWallVisibilityAttachments(), {});
        assert.equal(Object.keys(attachments).length, 1);
        neighbor.boardState.foxholeKey = 'trencht1';
        assert.deepEqual(host.getWallVisibilityAttachments(), attachments);
        host.boardState.foxholeKey = site;
        assert.deepEqual(host.getWallVisibilityAttachments(), {});
    }
});
