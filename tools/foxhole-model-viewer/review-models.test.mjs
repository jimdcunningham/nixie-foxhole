import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { hostModule } from './host-paths.mjs';
import { reviewModelPlan, reviewAssemblyOptions } from './review-models.mjs';

const report = JSON.parse(await readFile(new URL(hostModule('artifacts/facility-spatial-policy/batch/results.json'))));
for (const [name, dataset] of Object.entries({ review: report.review, control: report.control })) {
    test(`${name} assembles every default and upgrade from declared resources at authored offsets`, () => {
        for (const base of dataset.rows.filter(row => row.id === row.assetId)) {
            for (const selected of ['', ...reviewAssemblyOptions(dataset, base.id).map(option => option.value)]) {
                const plan = reviewModelPlan(dataset, base.id, selected);
                assert.ok(plan.length > 0);
                const expectedParts = (base.assembly?.slots ?? []).flatMap(slot => {
                    const part = slot.options.find(option => option.part.resourceId === selected)?.part ?? slot.default;
                    return part ? [part] : [];
                });
                assert.deepEqual(plan.map(row => row.resourceId), [
                    ...(expectedParts.some(part => part.replacesBase) ? [] : [base.resourceId]),
                    ...expectedParts.map(part => part.resourceId),
                ]);
                for (const row of plan) {
                    const source = dataset.rows.find(source => source.id === row.id);
                    for (const key of ['width', 'height', 'depth', 'offsetX', 'offsetY', 'offsetZ']) assert.equal(row[key], source[key]);
                }
            }
        }
        assert.throws(() => reviewModelPlan(dataset, 'powerline'), /No review model/);
    });
}
test('every new default and upgrade has a full-triangle comparison control', () => {
    for (const base of report.review.rows.filter(row => row.newlyExported && row.id === row.assetId)) {
        for (const selected of ['', ...reviewAssemblyOptions(report.review, base.id).map(option => option.value)]) {
            const packed = reviewModelPlan(report.review, base.id, selected);
            const full = reviewModelPlan(report.control, base.id, selected);
            assert.deepEqual(packed.map(row => row.id), full.map(row => row.id));
            assert.equal(packed.reduce((sum, row) => sum + row.sourceTriangles, 0), full.reduce((sum, row) => sum + row.triangles, 0));
        }
    }
});
