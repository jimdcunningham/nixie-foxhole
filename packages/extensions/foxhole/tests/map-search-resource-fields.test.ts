import assert from 'node:assert/strict';
import test from 'node:test';
import { buildFoxholeMapSearchDataset } from '../app/plugins/foxhole/nixie/map/search.ts';

test('buildFoxholeMapSearchDataset includes live resource icons as resource_field places', () => {
    const dataset = buildFoxholeMapSearchDataset({
        DrownedValeHex: {
            labels: {
                version: 1,
                items: [
                    {
                        text: 'Sop Fields',
                        x: 0.4,
                        y: 0.5,
                        mapMarkerType: 'Minor',
                    },
                ],
            },
            icons: {
                version: 1,
                items: [
                    { iconType: 20, x: 0.55, y: 0.48 },
                    { iconType: 21, x: 0.6, y: 0.5 },
                ],
            },
        },
    }, { visibleRegionKeys: ['DrownedValeHex'] });

    assert.equal(dataset.hasResourceIconData, true);
    assert.ok(dataset.entries.some(entry => (
        entry.type === 'district' && entry.label === 'Sop Fields'
    )));
    assert.ok(dataset.entries.some(entry => (
        entry.type === 'resource_field' && entry.label === 'Salvage Field'
    )));
    assert.ok(dataset.entries.some(entry => (
        entry.type === 'resource_field' && entry.label === 'Component Field'
    )));
});
