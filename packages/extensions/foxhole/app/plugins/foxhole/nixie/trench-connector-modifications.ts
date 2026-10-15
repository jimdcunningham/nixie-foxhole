import type { FoxholeStructureAsset } from './catalog.ts';
import type { TrenchEndpoint } from './trench-connector.ts';
import { getFoxholeSelectedModificationSlotVariants, normalizeFoxholeModificationSelectionMap } from './modification-slots.ts';
import { resolveModificationHoverPreviewSelections } from './structure-modification-hover-preview.ts';
import type { FoxholeModificationHoverPreviewState } from './structure-modification-hover-preview.ts';
import { clipPiece, intervalPieces, nativePiece, offsetEndpoint, pieceFrame, stripPieces, trenchRoofPolygon } from './trench-connector-pieces.ts';
import type { TrenchPiece, TrenchPieceFrame } from './trench-connector-pieces.ts';

export type TrenchModificationVisual = TrenchPiece;

export function resolveTrenchConnectorModifications(options: {
    asset?: FoxholeStructureAsset;
    selections?: Record<string, string>;
    hover?: FoxholeModificationHoverPreviewState | null;
    nodeId: string;
    start: TrenchEndpoint;
    end: TrenchEndpoint;
    hideRoofs?: boolean;
}): TrenchModificationVisual[] {
    const { asset, start, end } = options;
    if (!asset) return [];
    const saved = normalizeFoxholeModificationSelectionMap(options.selections);
    const hoverState = options.hover?.nodeId === options.nodeId ? options.hover : null;
    const hoverSlot = hoverState ? asset.modificationSlotById[hoverState.slotId] : undefined;
    const hoverVariant = hoverSlot?.variantById[hoverState?.variantId ?? ''];
    const hover = hoverSlot && hoverVariant && !hoverVariant.isUpgrade ? { slot: hoverSlot, variant: hoverVariant } : null;
    const selections = resolveModificationHoverPreviewSelections(asset, saved, hover);
    return getFoxholeSelectedModificationSlotVariants(asset.modificationSlots, selections).flatMap(({ slot, variant }) => {
        const roof = variant.id === 'trenchroof';
        if (!variant.textureUrl || variant.isUpgrade || (roof && options.hideRoofs)) return [];
        if (!roof && variant.id !== 'sandbags' && variant.id !== 'barbedwire') return [];
        const layers = asset.renderLayers;
        const id = `mod:${slot.id}:${variant.id}`;
        const alpha = hover?.slot.id === slot.id && saved[slot.id] !== variant.id ? 0.65 : 1;
        if (roof) {
            return roofPieces(layers, id, start, end, alpha);
        }
        const side = (slot.y ?? 0) < 0 ? -1 : 1;
        // Defense slots sit 15cm inside each endpoint and 220cm off centre.
        const a = offsetEndpoint(side < 0 ? start : end, side * 70.4, side < 0 ? 4.8 : -4.8);
        const b = offsetEndpoint(side < 0 ? end : start, side * 70.4, side < 0 ? -4.8 : 4.8);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        if (variant.id === 'sandbags') {
            const frames = Array.from({ length: 4 }, (_, i) => pieceFrame(layers, `TrenchConnectorSandbagsAngledSpline0${i + 1}`)).filter((f): f is TrenchPieceFrame => !!f);
            const pieces = intervalPieces(frames, id, a, b, 25.6, { start: 25.6, end: 12.8, fromEnd: side > 0, alpha });
            const cap = pieceFrame(layers, 'TrenchConnectorSandbagsAngledSplineEnd');
            if (cap) pieces.push(nativePiece(cap, `${id}:start`, { x: a.x + Math.cos(angle) * 8, y: a.y + Math.sin(angle) * 8 }, angle + Math.PI, alpha),
                nativePiece(cap, `${id}:end`, { x: b.x - Math.cos(angle) * 8, y: b.y - Math.sin(angle) * 8 }, angle, alpha));
            return pieces;
        }
        const tier = asset.foxholeKey.slice(-1);
        const post = pieceFrame(layers, `TrenchBarbedWirePillarT${tier}`);
        const wire = pieceFrame(layers, `TrenchBarbedWireT${tier}`);
        // Preserve barb spacing in the top-down render: repeat native wire
        // sections and crop the remainder, independently of the endpoint posts.
        const pieces: TrenchPiece[] = [];
        if (wire) pieces.push(...stripPieces(wire, `${id}:wire`, a, b, alpha, undefined, side > 0));
        if (post) pieces.push(nativePiece(post, `${id}:start`, a, angle, alpha), nativePiece(post, `${id}:end`, b, angle, alpha));
        return pieces;
    }).sort((a, b) => Number(a.id.includes('Roof')) - Number(b.id.includes('Roof')));
}

function roofPieces(layers: readonly TrenchPieceFrame[], id: string, start: TrenchEndpoint, end: TrenchEndpoint, alpha: number): TrenchPiece[] {
    const panel = pieceFrame(layers, 'TrenchT3RoofSurface') ?? pieceFrame(layers, 'TrenchT3Roof01');
    if (!panel) return [];
    const polygon = trenchRoofPolygon(start, end);
    const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const angle = Math.atan2(end.y - start.y, end.x - start.x), c = Math.cos(angle), s = Math.sin(angle);
    // Tile the native roof section in the polygon's plane, then clip the actual
    // geometry. UVs remain affine across both triangles, with no skewed panels.
    const along = polygon.map(p => (p.x - center.x) * c + (p.y - center.y) * s);
    const min = Math.min(...along), max = Math.max(...along);
    const pieces = stripPieces(panel, `${id}:panel`, { x: center.x + c * min, y: center.y + s * min }, { x: center.x + c * max, y: center.y + s * max }, alpha, undefined, false, true)
        .map(p => clipPiece(p, polygon));
    for (const suffix of ['', 'Top']) {
        const frames = Array.from({ length: 3 }, (_, i) => pieceFrame(layers, `TrenchT3RoofTrim0${i + 1}${suffix}`)).filter((f): f is TrenchPieceFrame => !!f);
        pieces.push(...intervalPieces(frames, `${id}:trim${suffix}`, start, end, 79.36, { start: 39.68, end: 39.68, center: true, alpha }).map(p => clipPiece(p, polygon)));
    }
    const cap = pieceFrame(layers, 'TrenchT3RoofEnd');
    if (cap) {
        // The source mesh pivot is 500cm from its end; use the blueprint's
        // opposing +/-500cm offsets instead of centring the image on a socket.
        pieces.push(nativePiece(cap, `${id}:start`, offsetEndpoint(start, 0, 160), start.rotation + Math.PI, alpha),
            nativePiece(cap, `${id}:end`, offsetEndpoint(end, 0, -160), end.rotation, alpha));
    }
    return pieces.filter(p => p.positions.length >= 6);
}
