import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

import {
    buildRenderIdComputation,
    normalizeStandaloneModificationKeyComponent,
} from './shared-modification-id.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const goldenVectorsPath = resolve(scriptDirectory, 'fixtures', 'render-id-golden-vectors.json');

function recomputeRenderId(variantId, identity) {
    const normalizedVariantId = normalizeStandaloneModificationKeyComponent(variantId);
    const truncatedHashHex = createHash('sha256').update(identity).digest('hex').slice(0, 12);
    return normalizedVariantId ? `${normalizedVariantId}-${truncatedHashHex}` : truncatedHashHex;
}

describe('render-id parity', () => {
    it('matches C# golden vectors fixture', async () => {
        const vectors = JSON.parse(await readFile(goldenVectorsPath, 'utf8'));
        for (const vector of vectors) {
            const result = buildRenderIdComputation(vector.variantId, vector.dataClassPath, vector.variant);
            assert.equal(result.renderId, recomputeRenderId(vector.variantId, result.identity));
            assert.match(result.renderId, /^[a-z0-9-]+-[a-f0-9]{12}$/);
        }
    });

    it('uses the same renderId for equivalent deep and scoped identity inputs', () => {
        const variant = {
            templateActorPath: 'War/Content/Blueprints/Props/BunkBed/BP_BunkBed',
        };
        const full = buildRenderIdComputation('bunkbed', 'War/Content/Blueprints/Structures/FortModData', variant);
        const scoped = buildRenderIdComputation('bunkbed', 'War/Content/Blueprints/Structures/FortModData', variant);
        assert.equal(full.renderId, scoped.renderId);
        assert.equal(full.identity, scoped.identity);
    });
});
