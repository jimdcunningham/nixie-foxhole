import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('Statistics uses flush resource lists without hover-card wrappers', () => {
    const source = readFileSync(new URL('../app/components/nixie/foxhole/FoxholeSceneStatsSidebarPanel.vue', import.meta.url), 'utf8');
    assert.doesNotMatch(source, /FoxholeCostCard/);
    const lists = source.match(/<FoxholeCostBreakdownList\s[\s\S]*?\/>/g) ?? [];
    for (const entries of ['costBreakdownEntries', 'maintenanceBreakdownEntries', 'productionInputEntries', 'productionOutputEntries']) {
        const list = lists.find(tag => tag.includes(`:entries="${entries}"`));
        assert.ok(list, entries);
        assert.match(list, /\sflush\s/);
    }
    assert.match(source, /:entries="productionOutputEntries"\s+quantityTone="gain"/);
});
