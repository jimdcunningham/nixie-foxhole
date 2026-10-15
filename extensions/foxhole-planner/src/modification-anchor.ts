export interface FoxholeModificationAnchorSlot {
    name: string;
    x?: number | null;
    y?: number | null;
    z?: number | null;
    rotation?: number | null;
    linkedSocketNames?: readonly string[];
}
export interface FoxholeModificationAnchorSocket {
    name: string;
    x?: number | null;
    y?: number | null;
    rotation?: number | null;
}

/** V1 uses 32 board pixels per metre and centres slot positions on selection bounds. */
export function resolveFoxholeModificationTextureAnchor(
    slot: FoxholeModificationAnchorSlot,
    bounds: { minX: number; minY: number; maxX: number; maxY: number; },
    sockets: readonly FoxholeModificationAnchorSocket[] = [],
): { x: number; y: number; } {
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    // Published transforms omit zero axes. One authored axis still defines a
    // position. A Z-only transform also has authored zero X/Y (fort stairs).
    // Only an entirely absent transform needs the linked-socket fallback.
    const rawX = Number(slot.x ?? 0);
    const rawY = Number(slot.y ?? 0);
    if ((slot.x != null || slot.y != null || slot.z != null || slot.rotation != null)
        && Number.isFinite(rawX) && Number.isFinite(rawY)) {
        return { x: rawX * 0.32 - centerX, y: rawY * 0.32 - centerY };
    }
    const normalize = (name: string) => name.split(':').at(-1)!.trim().toLowerCase();
    const names = new Set(slot.linkedSocketNames?.map(normalize));
    const matched = sockets.filter(socket => names.has(normalize(socket.name)));
    if (!matched.length) {
        return { x: centerX, y: centerY };
    }
    const position = matched.reduce((sum, socket) => ({ x: sum.x + Number(socket.x ?? 0) * 0.32 - centerX,
        y: sum.y + Number(socket.y ?? 0) * 0.32 - centerY, rotation: sum.rotation + Number(socket.rotation ?? 0) * Math.PI / 180 }), { x: 0, y: 0, rotation: 0 });
    const rotation = position.rotation / matched.length;
    const distance = slot.name.toLowerCase().includes('end') ? 28 : 18;
    return { x: position.x / matched.length + Math.cos(rotation) * distance,
        y: position.y / matched.length + Math.sin(rotation) * distance };
}

/** Place a cropped 64px/metre texture at its slot in the 32px/metre Scene. */
export function resolveFoxholeModificationTexturePosition(
    slot: FoxholeModificationAnchorSlot,
    bounds: { minX: number; minY: number; maxX: number; maxY: number; },
    sockets: readonly FoxholeModificationAnchorSocket[],
    visual: { offsetX?: number | null; offsetY?: number | null; rotationDegrees?: number | null; },
): { x: number; y: number; } {
    const anchor = resolveFoxholeModificationTextureAnchor(slot, bounds, sockets);
    const rotation = Number(visual.rotationDegrees ?? 0) * Math.PI / 180;
    const offsetX = Number(visual.offsetX ?? 0) * 0.5;
    const offsetY = Number(visual.offsetY ?? 0) * 0.5;
    // Cropping offsets are in the modification's local frame, so rotate them
    // with the texture before translating to the host slot.
    return {
        x: anchor.x + offsetX * Math.cos(rotation) - offsetY * Math.sin(rotation),
        y: anchor.y + offsetX * Math.sin(rotation) + offsetY * Math.cos(rotation),
    };
}
