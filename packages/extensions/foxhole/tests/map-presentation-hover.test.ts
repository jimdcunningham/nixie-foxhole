import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../app/plugins/foxhole/nixie/map/renderer.ts', import.meta.url), 'utf8');
const methods = ['hoverPresentation', 'setHoveredIcon', 'clearHoveredIcon'].map(name => {
    const match = source.match(new RegExp(`    (?:private )?${name}\\([\\s\\S]*?\\n    }`));
    assert.ok(match);
    return match[0];
}).join('\n');

test('projected icons use the original custom card payload and clear foreign or disabled targets', () => {
    const popover = { value: null as any };
    const shown: unknown[] = [];
    const Renderer = runInNewContext(stripTypeScriptTypes(`class Renderer { ${methods} }; Renderer;`), {
        canvasHoverPopover: popover,
        showCanvasHoverPopover(owner: unknown, content: unknown, point: unknown) { popover.value = { owner, content, point }; shown.push(content); },
        moveCanvasHoverPopover(owner: unknown, point: unknown) { assert.equal(popover.value.owner, owner); popover.value.point = point; },
        hideCanvasHoverPopover(owner: unknown) { if (popover.value?.owner === owner) popover.value = null; },
    });
    const renderer = new Renderer();
    let enabled = true, overCanvas = true;
    renderer.context = { readMapSettings: () => ({ enabled }) };
    renderer.isPointerOverCanvas = () => overCanvas;
    renderer.root = {};
    renderer.presentationHoverData = new WeakMap();
    const icon = { parent: renderer.root }, sprite = { parent: icon }, point = { x: 200, y: 300 };
    renderer.presentationHoverData.set(icon, { iconName: 'Factory', categoryLabel: 'Structure', factionLabel: 'Wardens', factionColor: 0x245682,
        isScorched: true, iconUrl: '/factory-icon.webp', previewUrl: '/factory-preview.webp' });
    renderer.hoverPresentation(sprite, point);
    assert.equal(JSON.stringify(popover.value.content), JSON.stringify({ kind: 'map-icon', name: 'Factory', category: 'Structure', faction: 'Wardens', factionColor: 0x245682,
        scorched: true, iconUrl: '/factory-icon.webp', previewUrl: '/factory-preview.webp' }));
    renderer.hoverPresentation(sprite, { x: 210, y: 310 });
    assert.equal(shown.length, 1, 'pointer movement repositions the existing native card');
    renderer.hoverPresentation({ parent: renderer.root }, point);
    assert.equal(popover.value, null);
    renderer.hoverPresentation(sprite, point);
    enabled = false;
    renderer.hoverPresentation(sprite, point);
    assert.equal(popover.value, null);
    enabled = true;
    overCanvas = false;
    renderer.hoverPresentation(sprite, point);
    assert.equal(popover.value, null);
    overCanvas = true;
    renderer.hoverPresentation(sprite, point);
    renderer.hoverPresentation(null, point);
    assert.equal(popover.value, null);
});
