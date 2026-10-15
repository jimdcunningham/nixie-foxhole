import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';

const hook = registerHooks({ resolve(specifier, context, next) {
    const root = specifier.startsWith('#foxhole/') ? '../../app/' : specifier.startsWith('#nixie/') ? '../../../../nixie/app/' : null;
    return root ? { url: new URL(root + specifier.slice(specifier.indexOf('/') + 1), import.meta.url).href, shortCircuit: true }
        : next(specifier, context);
} });
const { createRangeStatePatchFromOptions } = await import('../../app/plugins/foxhole/nixie/range-tool-options.ts');
const { createTacticalLineStatePatchFromOptions } = await import('../../app/plugins/foxhole/nixie/tactical-line-tool-options.ts');
const { createBinocularLineStatePatchFromOptions } = await import('../../app/plugins/foxhole/nixie/binocular-line-tool-options.ts');
hook.deregister();

for (const [name, patchOptions] of [
    ['range', createRangeStatePatchFromOptions],
    ['tactical line', createTacticalLineStatePatchFromOptions],
    ['binocular line', createBinocularLineStatePatchFromOptions],
] as const) {
    test(`${name} consecutive property edits preserve earlier style changes`, () => {
        let state = { strokeWidth: 7, strokeAlpha: 0.8, strokeColor: 0xc084fc, scaleWithZoom: true };
        state = { ...state, ...patchOptions({ strokeWidth: 9 }) };
        state = { ...state, ...patchOptions({ strokeAlpha: 0.5 }) };
        state = { ...state, ...patchOptions({ scaleWithZoom: false }) };
        assert.deepEqual(state, { strokeWidth: 9, strokeAlpha: 0.5, strokeColor: 0xc084fc, scaleWithZoom: false });
        assert.deepEqual(patchOptions({}), {});
        assert.deepEqual(patchOptions({ strokeWidth: -5 }), { strokeWidth: 1 });
        assert.deepEqual(patchOptions({ strokeColor: '#abcdef' }), { strokeColor: 0xabcdef });
    });
}

test('range dash edits preserve width, fill, and label settings', () => {
    const initial = { strokeWidth: 9, strokeDashLength: 18, strokeDashGap: 8, fillAlpha: 0.3, labelColor: 0xffffff };
    assert.deepEqual({ ...initial, ...createRangeStatePatchFromOptions({ strokeDashGap: 14 }) },
        { ...initial, strokeDashGap: 14 });
});
