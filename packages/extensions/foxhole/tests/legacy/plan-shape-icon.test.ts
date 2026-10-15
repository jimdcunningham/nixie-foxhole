import assert from 'node:assert/strict';
import test from 'node:test';
import {
    LegacyPlanImporter,
    mapLegacyPlanIconEntity,
    mapLegacyPlanShapeEntity,
    parseLegacyColor,
    resolveLegacyLabelStyle,
    resolveLegacyShapeStyle,
} from '../../app/plugins/foxhole/legacy/index.ts';
import {
    buildFoxholeItemCatalog,
    buildFoxholeStructureCatalog,
} from '../../app/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeManifest } from '../../app/plugins/foxhole/nixie/manifest.ts';

const BASE_ASSETS_URL = '/foxhole/assets/';
const NIXIE_ICON_NODE_TYPE = 'nixieIcon';
const manifest = getFoxholeManifest(BASE_ASSETS_URL);
const structureCatalog = buildFoxholeStructureCatalog(manifest);
const itemCatalog = buildFoxholeItemCatalog(manifest);

test('legacy style baking merges type defaults with deltas', () => {
    const rectangle = resolveLegacyShapeStyle('rectangle', { fill: true, fillColor: '#1F6FEB' });
    assert.equal(rectangle.fill, true);
    assert.equal(rectangle.fillColor, '#1F6FEB');
    assert.equal(rectangle.border, false);
    assert.equal(rectangle.lineWidth, 8);

    const icon = resolveLegacyShapeStyle('icon', null);
    assert.equal(icon.fill, true);
    assert.equal(icon.fillColor, '#0B0B0B');
    assert.equal(icon.lineColor, '#00FF00');

    const label = resolveLegacyLabelStyle({ fontSize: 40 });
    assert.equal(label.fontSize, 40);
    assert.equal(label.fontFamily, 'Arial');
    assert.equal(parseLegacyColor('#1F6FEB'), 0x1F6FEB);
});

test('confirmed polygon clipboard maps defaults like legacy regenerate', () => {
    const mapped = mapLegacyPlanShapeEntity({
        id: 9,
        type: 'polygon',
        x: 0,
        y: 700,
        rotation: 0,
        layer: 0,
        sortOffset: 0,
        polygon: [0, 0, 220, 20, 160, 160, -20, 120],
    });
    assert.ok(mapped.snapshot);
    const state = mapped.snapshot.state as {
        x?: number;
        y?: number;
        alpha?: number;
        commands?: Array<{
            kind?: string;
            points?: number[];
            fill?: { color?: number; alpha?: number; };
            stroke?: { color?: number; width?: number; alpha?: number; alignment?: number; };
        }>;
    };
    // BBox min of local polygon is (-20, 0) → world origin (-20, 700)
    assert.equal(state.x, -20);
    assert.equal(state.y, 700);
    assert.equal(state.alpha, 0.5);
    const command = state.commands?.[0];
    assert.equal(command?.kind, 'polygon');
    assert.deepEqual(command?.points, [20, 0, 240, 20, 180, 160, 0, 120]);
    assert.equal(command?.fill?.color, 0xFFFFFF);
    assert.equal(command?.fill?.alpha, 1);
    // regenerate() hardcodes polygon stroke width to 6 (not style.lineWidth)
    assert.equal(command?.stroke?.color, 0xFFFFFF);
    assert.equal(command?.stroke?.width, 6);
    assert.equal(command?.stroke?.alpha, 1);
    assert.equal(command?.stroke?.alignment, 0.5);
});

test('confirmed rectangle clipboard maps fill/stroke/alpha like Nixie', () => {
    const mapped = mapLegacyPlanShapeEntity({
        id: 13,
        type: 'rectangle',
        x: 1800,
        y: 700,
        rotation: 0,
        layer: 0,
        sortOffset: 0,
        width: 280,
        height: 160,
        shapeStyle: {
            alpha: 0.85,
            fill: true,
            fillColor: '#1F6FEB',
            border: true,
            lineWidth: 60,
        },
    });
    assert.ok(mapped.snapshot);
    const state = mapped.snapshot.state as {
        x?: number;
        y?: number;
        alpha?: number;
        commands?: Array<{
            kind?: string;
            x?: number;
            y?: number;
            width?: number;
            height?: number;
            fill?: { color?: number; alpha?: number; };
            stroke?: { color?: number; width?: number; alpha?: number; alignment?: number; };
        }>;
    };
    assert.equal(state.x, 1800);
    assert.equal(state.y, 700);
    assert.equal(state.alpha, 0.85);
    const command = state.commands?.[0];
    assert.equal(command?.kind, 'rect');
    assert.equal(command?.x, 0);
    assert.equal(command?.y, 0);
    assert.equal(command?.width, 280);
    assert.equal(command?.height, 160);
    assert.equal(command?.fill?.color, 0x1F6FEB);
    assert.equal(command?.fill?.alpha, 1);
    assert.equal(command?.stroke?.color, 0x1F6FEB);
    assert.equal(command?.stroke?.width, 60);
    assert.equal(command?.stroke?.alpha, 1);
    assert.equal(command?.stroke?.alignment, 0.5);
});

test('shape mapper creates graphics and text snapshots', () => {
    const text = mapLegacyPlanShapeEntity({
        id: 1,
        type: 'text',
        x: 10,
        y: 20,
        label: 'Hello',
    });
    assert.ok(text.snapshot);
    assert.equal(text.snapshot.type, 'text');
    assert.equal((text.snapshot.state as { text?: string; }).text, 'Hello');
    assert.equal((text.snapshot.state as { anchorX?: number; }).anchorX, 0.5);
    assert.equal((text.snapshot.state as { anchorY?: number; }).anchorY, 0.5);

    const rectangle = mapLegacyPlanShapeEntity({
        id: 2,
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        shapeStyle: { fill: true, fillColor: '#FFFFFF', border: true, lineWidth: 4 },
    });
    assert.ok(rectangle.snapshot);
    assert.equal(rectangle.snapshot.type, 'graphics');
    assert.equal((rectangle.snapshot.state as { commands?: Array<{ kind?: string; }>; }).commands?.[0]?.kind, 'rect');

    const defaultRectangle = mapLegacyPlanShapeEntity({
        id: 4,
        type: 'rectangle',
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        // legacy defaults: fill false, border false → still paints fill
    });
    assert.ok(defaultRectangle.snapshot);
    const defaultFill = (defaultRectangle.snapshot.state as {
        commands?: Array<{ fill?: { alpha?: number; }; }>;
    }).commands?.[0]?.fill;
    assert.equal(defaultFill?.alpha, 1);

    const line = mapLegacyPlanShapeEntity({
        id: 3,
        type: 'line',
        x: 100,
        y: 100,
        points: [{ x: 0, y: 0 }, { x: 50, y: 25 }],
    });
    assert.ok(line.snapshot);
    assert.equal(line.snapshot.type, 'foxholeBinocularLine');
    assert.equal((line.snapshot.state as { strokeWidth?: number; }).strokeWidth, 14);
    assert.equal((line.snapshot.state as { startCap?: string; }).startCap, 'arrow');
    assert.equal((line.snapshot.state as { endCap?: string; }).endCap, 'arrow');
    assert.equal((line.snapshot.state as { showDistance?: boolean; }).showDistance, false);
    assert.equal((line.snapshot.state as { endpointRadius?: number; }).endpointRadius, 0);
});

test('confirmed line defaults map to binocular node with both caps', () => {
    const mapped = mapLegacyPlanShapeEntity({
        id: 7,
        type: 'line',
        x: 0,
        y: 700,
        points: [{ x: 0, y: 0 }, { x: 280, y: 40 }],
    });
    assert.ok(mapped.snapshot);
    const state = mapped.snapshot.state as {
        strokeColor?: number;
        strokeWidth?: number;
        startCap?: string;
        endCap?: string;
        showDistance?: boolean;
        showAzimuth?: boolean;
        scaleWithZoom?: boolean;
        endpointRadius?: number;
    };
    assert.equal(mapped.snapshot.type, 'foxholeBinocularLine');
    assert.equal(state.strokeColor, 0xFFFFFF);
    assert.equal(state.strokeWidth, 14);
    assert.equal(state.startCap, 'arrow');
    assert.equal(state.endCap, 'arrow');
    assert.equal(state.showDistance, false);
    assert.equal(state.showAzimuth, false);
    assert.equal(state.scaleWithZoom, false);
    assert.equal(state.endpointRadius, 0);
});

test('confirmed binoline key maps binocular defaults', () => {
    const mapped = mapLegacyPlanShapeEntity({
        id: 8,
        type: 'line',
        key: 'binoline',
        x: 100,
        y: 200,
        points: [{ x: 0, y: 0 }, { x: 160, y: 0 }],
    });
    assert.ok(mapped.snapshot);
    const state = mapped.snapshot.state as {
        strokeColor?: number;
        strokeWidth?: number;
        startCap?: string;
        endCap?: string;
        showDistance?: boolean;
        showAzimuth?: boolean;
        scaleWithZoom?: boolean;
        endpointRadius?: number;
        labelBackgroundColor?: number;
    };
    assert.equal(mapped.snapshot.type, 'foxholeBinocularLine');
    assert.equal(state.strokeColor, 0x77E5C3);
    assert.equal(state.strokeWidth, 2);
    assert.equal(state.startCap, 'circle');
    assert.equal(state.endCap, 'arrow');
    assert.equal(state.showDistance, true);
    assert.equal(state.showAzimuth, true);
    assert.equal(state.scaleWithZoom, true);
    assert.equal(state.endpointRadius, 0);
    assert.equal(state.labelBackgroundColor, 0x529E87);
});

test('confirmed explicit line style maps orange label background without endpoint dots', () => {
    const mapped = mapLegacyPlanShapeEntity({
        id: 16,
        type: 'line',
        x: 2700,
        y: 700,
        points: [{ x: 0, y: 0 }, { x: 260, y: -60 }],
        shapeStyle: {
            fillColor: '#FF6B4A',
            lineWidth: 18,
            frontArrow: true,
            backArrow: false,
            showDist: true,
        },
    });
    assert.ok(mapped.snapshot);
    const state = mapped.snapshot.state as {
        strokeColor?: number;
        strokeWidth?: number;
        startCap?: string;
        endCap?: string;
        showDistance?: boolean;
        showAzimuth?: boolean;
        scaleWithZoom?: boolean;
        endpointRadius?: number;
        labelBackgroundColor?: number;
        labelBackgroundAlpha?: number;
    };
    assert.equal(state.strokeColor, 0xFF6B4A);
    assert.equal(state.strokeWidth, 18);
    assert.equal(state.startCap, 'arrow');
    assert.equal(state.endCap, 'none');
    assert.equal(state.showDistance, true);
    assert.equal(state.showAzimuth, false);
    assert.equal(state.scaleWithZoom, false);
    assert.equal(state.endpointRadius, 0);
    assert.equal(state.labelBackgroundColor, 0xB04A33);
    assert.equal(state.labelBackgroundAlpha, 0.85);
});

test('icon mapper resolves rainuniformc and reports unknown keys', () => {
    const resolved = mapLegacyPlanIconEntity({
        id: 10,
        type: 'icon',
        key: 'rainuniformc',
        width: 128,
        height: 128,
        x: 5,
        y: 6,
    }, itemCatalog, structureCatalog);
    assert.ok(resolved.snapshot);
    assert.equal(resolved.snapshot.type, NIXIE_ICON_NODE_TYPE);
    assert.ok(String((resolved.snapshot.state as { textureUrl?: string; }).textureUrl ?? '').length > 0);
    assert.equal((resolved.snapshot.state as { frameWidth?: number; }).frameWidth, 128);

    const missing = mapLegacyPlanIconEntity({
        id: 11,
        type: 'icon',
        key: 'not_a_real_icon_key_zzz',
        width: 128,
        height: 128,
    }, itemCatalog, structureCatalog);
    assert.equal(missing.snapshot, null);
    assert.equal(missing.unresolvedKey, 'not_a_real_icon_key_zzz');

    const deprecated = mapLegacyPlanIconEntity({
        id: 12,
        type: 'icon',
        key: 'radioaircraft',
        width: 128,
        height: 128,
    }, itemCatalog, structureCatalog);
    assert.equal(deprecated.snapshot, null);
    assert.equal(deprecated.reason, 'deprecated_icon_key');
    assert.equal(deprecated.unresolvedKey, undefined);
});

test('importer wires mixed shapes and icons into boardSnapshots', async () => {
    const save = {
        version: '1.0.5',
        name: 'Shapes And Icons',
        entities: [
            {
                id: 1,
                type: 'rectangle',
                x: 0,
                y: 0,
                width: 120,
                height: 80,
                shapeStyle: { fill: true, fillColor: '#336699' },
            },
            {
                id: 2,
                type: 'text',
                x: 0,
                y: -100,
                label: 'Label',
            },
            {
                id: 3,
                type: 'icon',
                key: 'rainuniformc',
                width: 128,
                height: 128,
                x: 200,
                y: 0,
            },
            {
                id: 4,
                type: 'image',
                x: 400,
                y: 0,
                width: 64,
                height: 64,
                textureFile: 'missing-on-purpose.png',
            },
            {
                id: 5,
                type: 'icon',
                key: 'missing_icon_xyz',
                width: 64,
                height: 64,
            },
        ],
    };

    const importer = new LegacyPlanImporter({ structureCatalog, itemCatalog });
    const result = await importer.importSave(save);

    assert.ok(result.boardSnapshots.length >= 3);
    assert.ok(result.boardSnapshots.some(snapshot => snapshot.type === 'graphics'));
    assert.ok(result.boardSnapshots.some(snapshot => snapshot.type === 'text'));
    assert.ok(result.boardSnapshots.some(snapshot => snapshot.type === NIXIE_ICON_NODE_TYPE));
    assert.equal(result.report.importedShapeCounts.rectangle, 1);
    assert.equal(result.report.importedShapeCounts.text, 1);
    assert.equal(result.report.importedShapeCounts.icon, 1);
    assert.equal(result.pendingImages.length, 1);
    assert.deepEqual(result.report.unresolvedImageKeys, ['missing-on-purpose.png']);
    assert.equal(result.report.skippedEntityTypes.image, undefined);
    assert.ok(result.report.unresolvedIconKeys.includes('missing_icon_xyz'));
    assert.equal(result.report.hasBlockingFindings, false);
});
