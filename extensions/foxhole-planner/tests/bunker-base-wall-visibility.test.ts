import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveFoxholeOccupiedSocketTags, shouldShowFoxholeStructureRenderLayer } from '../src/structure-render-layer-visibility.ts';

for (const tier of [1, 2, 3]) {
    test(`bunker base tier ${tier} opens only its connected side panels`, () => {
        const authored: { renderLayers: Array<{ id: string; componentTags?: string[]; }>; } = JSON.parse(readFileSync(new URL(`../../../tools/foxwatch/asset-overrides/fortbaset${tier}/manifest.json`, import.meta.url), 'utf8'));
        for (const side of ['Front', 'Back', 'Left']) {
            const socket = { name: side + (tier === 1 ? 'FortSocket' : 'Socket'), socketTags: [{ tag: `Dirt${side}` }, { tag: `Side${side}` }] };
            const occupied = resolveFoxholeOccupiedSocketTags([socket], new Set([`base:${socket.name}`]), 'base');
            assert.deepEqual([...occupied], [side.toLowerCase()]);
            for (const layer of authored.renderLayers) {
                const visible = shouldShowFoxholeStructureRenderLayer(layer, occupied, { structureCodeName: `FortBaseT${tier}` });
                assert.equal(visible, layer.id !== `side${side.toLowerCase()}` && layer.id !== `dirt${side.toLowerCase()}`, `${side}:${layer.id}`);
                assert.equal(shouldShowFoxholeStructureRenderLayer(layer, new Set(), { structureCodeName: `FortBaseT${tier}` }), true, `detached:${layer.id}`);
            }
            assert.ok(authored.renderLayers.some(layer => layer.id === `side${side.toLowerCase()}`));
            assert.ok(authored.renderLayers.some(layer => layer.id === `side${side.toLowerCase()}static` && !layer.componentTags?.length));
        }
        assert.ok(authored.renderLayers.some(layer => layer.id === 'base' && !layer.componentTags?.length));
    });
}
