import type { NixieExperimentalDocumentRenderRequestV1, NixieExperimentalDocumentRenderResultV1, NixieExtensionGraphicsCommandV1, NixieExtensionRenderNodeV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import maps from '#foxhole-scene-v2-maps';

const CELL = 125 * 32;
export function renderFoxholePlanningGrid(request: NixieExperimentalDocumentRenderRequestV1): NixieExperimentalDocumentRenderResultV1 {
    const root = { id: 'planning-grid', kind: 'group' as const, children: [] as NixieExtensionRenderNodeV1[] };
    const settings = request.settings, scale = request.viewport.renderScale;
    if (settings['foxhole.map.enabled'] !== true || settings['foxhole.map.grid'] !== true || scale >= 100) {
        return { contractVersion: 1, plan: { schemaVersion: 1, root } };
    }
    const keys = String(settings['foxhole.map.regionKeys'] ?? '').split(',').map(value => value.trim()).filter(Boolean);
    const regions = maps.regions.filter(region => !keys.length || keys.includes(region.key));
    const viewport = request.viewport.visibleBounds;
    const pointer = request.viewport.pointer ?? { x: viewport ? (viewport.minX + viewport.maxX) / 2 : 0, y: viewport ? (viewport.minY + viewport.maxY) / 2 : 0 };
    const region = [...regions].sort((left, right) => Math.hypot(left.x - pointer.x, left.y - pointer.y) - Math.hypot(right.x - pointer.x, right.y - pointer.y))[0];
    if (!region) {
        return { contractVersion: 1, plan: { schemaVersion: 1, root } };
    }
    const left = region.x - maps.regionWidth / 2, top = region.y - maps.regionHeight / 2;
    const labelScale = Math.min(scale, 240) * 0.85, subScale = Math.min(24, labelScale);
    const line = (x1: number, y1: number, x2: number, y2: number): NixieExtensionGraphicsCommandV1[] => [{ op: 'move-to', x: x1, y: y1 }, { op: 'line-to', x: x2, y: y2 }];
    const stroke: NixieExtensionGraphicsCommandV1 = { op: 'stroke', width: Math.min(100, 2 * scale), color: 0x000000, alpha: 0.1 };
    const lines: NixieExtensionGraphicsCommandV1[] = [];
    const text = (id: string, value: string, x: number, y: number, anchorX: number, anchorY: number, multiplier = labelScale, alpha = 1): NixieExtensionRenderNodeV1 => ({
        id, kind: 'text', text: value, x, y, anchorX, anchorY, scaleX: multiplier, scaleY: multiplier, alpha,
        style: { fontFamily: 'Jost', fontSize: 28, fill: 0xffffff },
    });
    const stickyTop = viewport ? viewport.minY + 36 * scale - top : -500;
    const stickyLeft = viewport ? viewport.minX + 36 * scale - left : -700;
    const children: NixieExtensionRenderNodeV1[] = [];
    for (let column = 0; column <= 17; column++) {
        lines.push(...line(column * CELL, 0, column * CELL, maps.regionHeight));
        if (column > 0) {
            children.push(text(`grid-column-${column}`, String.fromCharCode(64 + column), column * CELL - CELL / 2,
                Math.min(Math.max(-500, stickyTop), maps.regionHeight - CELL / 2), 0.5, 1));
        }
    }
    for (let row = 0; row <= 15; row++) {
        lines.push(...line(0, row * CELL, maps.regionWidth, row * CELL));
        if (row < 15) {
            children.push(text(`grid-row-${row}`, String(row + 1), Math.min(Math.max(-700, stickyLeft), maps.regionWidth - CELL / 2), row * CELL + CELL / 2, 1, 0.5));
        }
    }
    const cell = { x: Math.floor((pointer.x - left) / CELL) * CELL, y: Math.floor((pointer.y - top) / CELL) * CELL };
    const sublines: NixieExtensionGraphicsCommandV1[] = [];
    const subchildren: NixieExtensionRenderNodeV1[] = [];
    for (let row = 0; row <= 3; row++) {
        sublines.push(...line(0, row * CELL / 3, CELL, row * CELL / 3));
        if (row < 3) {
            for (let column = 1; column <= 3; column++) {
                subchildren.push(text(`grid-subcell-${row}-${column}`, String((2 - row) * 3 + column),
                    column * CELL / 3 - CELL / 6, row * CELL / 3 + CELL / 6, 0.5, 0.5, subScale, 0.85));
            }
        }
    }
    for (let column = 0; column <= 3; column++) {
        sublines.push(...line(column * CELL / 3, 0, column * CELL / 3, CELL));
    }
    root.children.push({ id: 'grid-background', kind: 'graphics', x: left, y: top, commands: [{ op: 'rect', x: 0, y: 0, width: maps.regionWidth, height: maps.regionHeight }, { op: 'fill', color: 0xffffff, alpha: 0.05 }] },
        { id: 'grid-region', kind: 'group', x: left, y: top, children: [{ id: 'grid-lines', kind: 'graphics', commands: [...lines, stroke] }, ...children,
            { id: 'grid-subcells', kind: 'group', ...cell, children: [{ id: 'grid-sublines', kind: 'graphics', commands: [...sublines, stroke] }, ...subchildren] }] });
    const number = (key: string) => Number(settings[`foxhole.map.crop.${key}`] ?? 0);
    const clip = settings['foxhole.map.crop.enabled'] === true && number('width') > 0 && number('height') > 0
        ? { minX: number('x'), minY: number('y'), maxX: number('x') + number('width'), maxY: number('y') + number('height') }
        : undefined;
    return { contractVersion: 1, plan: { schemaVersion: 1, root }, ...(clip ? { clip } : {}) };
}
