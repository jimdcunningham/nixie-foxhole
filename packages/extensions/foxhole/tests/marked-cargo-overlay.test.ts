import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { shouldHideCargoForStructureHoverPreview } from '../app/plugins/foxhole/nixie/structure-modification-hover-preview.ts';
import {
    resolveMarkedCargoIconSizing,
    resolveMarkedCargoOverlayColumnPositions,
} from '../app/plugins/foxhole/nixie/marked-cargo-overlay.ts';

test('cargo and production hover fading preserves visibility and restores only the hovered tile', () => {
    const source = readFileSync(new URL('../app/plugins/nixie/board/types/foxhole-structure.ts', import.meta.url), 'utf8');
    const body = source.match(/private syncCargoTileHoverAlpha\(\): void \{([\s\S]*?)\n {4}\}/)?.[1];
    assert.ok(body);
    let now = 0;
    const popover: { value: { owner: object; } | null; } = { value: null };
    const sync = runInNewContext(`(function() {${body}})`, {
        canvasHoverPopover: popover, activeNixieStructureModificationHoverPreview: { value: null },
        shouldHideCargoForStructureHoverPreview, BUNKER_ROOF_HOVER_ALPHA: 0.25,
        BUNKER_ROOF_HOVER_FADE_MS: 110, performance: { now: () => now },
    });
    const cargo = { alpha: 1, onRender: undefined as (() => void) | undefined };
    const production = { alpha: 1, onRender: undefined as (() => void) | undefined };
    const subject = { boardId: 'bunker', bunkerCargoHoverFaded: true, cargoTileHoverTargets: new WeakMap(),
        markedCargoOverlay: { visible: true, children: [cargo] }, productionOutputOverlay: { visible: true, children: [production] } };
    sync.call(subject);
    assert.equal(cargo.alpha, 1);
    now = 55;
    cargo.onRender?.();
    production.onRender?.();
    assert.equal(cargo.alpha, 0.625);
    popover.value = { owner: cargo };
    sync.call(subject);
    now = 165;
    cargo.onRender?.();
    production.onRender?.();
    assert.equal(cargo.alpha, 1);
    assert.equal(production.alpha, 0.25);
    assert.equal(subject.markedCargoOverlay.visible, true);
    assert.equal(subject.productionOutputOverlay.visible, true);
    subject.bunkerCargoHoverFaded = false;
    sync.call(subject);
    now = 275;
    production.onRender?.();
    assert.equal(production.alpha, 1);
});

test('production and cargo icon grids occupy separate left and right columns', () => {
    const sizing = resolveMarkedCargoIconSizing({ count: 1, assetWidthPx: 240, assetHeightPx: 160 });
    const columns = resolveMarkedCargoOverlayColumnPositions({
        cargoCount: 1,
        cargoSizing: sizing,
        productionCount: 1,
        productionSizing: sizing,
    });

    assert.ok(columns.productionX < 0);
    assert.ok(columns.cargoX > 0);
    assert.equal(columns.productionX, -columns.cargoX);
});

test('a lone icon grid remains centered on its structure', () => {
    const sizing = resolveMarkedCargoIconSizing({ count: 1 });
    assert.deepEqual(resolveMarkedCargoOverlayColumnPositions({
        cargoCount: 0,
        cargoSizing: sizing,
        productionCount: 1,
        productionSizing: sizing,
    }), { cargoX: 0, productionX: 0 });
});
