import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { submenu } from '#nixie/plugins/nixie/registry/index.ts';
import * as menuIds from '#nixie/plugins/nixie/registry/menu-ids.ts';
import { FOXHOLE_RANGE_OVERLAY_DEFINITIONS } from '../../app/plugins/foxhole/nixie/range-settings.ts';
import { FOXHOLE_STRUCTURE_VOLUME_OVERLAY_DEFINITIONS } from '../../app/plugins/foxhole/nixie/structure-debug-settings.ts';

const source = readFileSync(new URL('../../app/plugins/nixie/contributions/foxhole/debug.contrib.ts', import.meta.url), 'utf8');
const declaration = source.match(/ {4}menus: (\[[\s\S]*\]),\r?\n\}\);/)![1];
const menus = runInNewContext(transformSync(`const menus = ${declaration}; menus;`, { loader: 'ts' }).code, {
    ...menuIds,
    FOXHOLE_DEBUG_MENU_ID: 'debug.foxhole',
    FOXHOLE_RANGE_OVERLAY_DEFINITIONS, FOXHOLE_STRUCTURE_VOLUME_OVERLAY_DEFINITIONS,
    FOXHOLE_WAR_DEBUG_PRESET_DEFINITIONS: [{ label: 'Scenario' }],
    FOXHOLE_WAR_DEBUG_TOAST_PREVIEW_DEFINITIONS: [{ label: 'Preview' }],
    submenu,
});

interface BadgeMenuItem {
    type?: string;
    label?: string;
    menu?: string;
    commandId?: string;
    accessibleInDev?: boolean;
    children?: BadgeMenuItem[];
}

function visit(item: BadgeMenuItem, check: (item: BadgeMenuItem) => void): void {
    if (item.type === 'separator') {
        return;
    }
    check(item);
    for (const child of item.children ?? []) {
        visit(child, check);
    }
}

test('Foxhole debug overlays and nested War previews carry their own DEV badge metadata', () => {
    let count = 0;
    for (const entry of menus) {
        const privateMenu = entry.menu.startsWith('overlays.debug') || entry.menu === 'debug.foxhole'
            || entry.item.menu === 'debug.foxhole' || entry.item.menu === 'overlays.debug';
        if (!privateMenu) {
            continue;
        }
        visit(entry.item, item => {
            if (item.commandId) {
                return; // Command rows inherit the existing command availability metadata.
            }
            assert.equal(item.accessibleInDev, true, item.label);
            count++;
        });
    }
    assert.ok(count > 25, `expected generated volumes and nested previews, got ${count}`);
});

test('public Foxhole overlays remain ordinary controls without DEV labels', () => {
    let count = 0;
    for (const entry of menus) {
        if (!['overlays.structures', 'overlays.ranges'].includes(entry.menu)) {
            continue;
        }
        visit(entry.item, item => {
            assert.notEqual(item.accessibleInDev, true, item.label);
            count++;
        });
    }
    assert.ok(count > 10);
});
