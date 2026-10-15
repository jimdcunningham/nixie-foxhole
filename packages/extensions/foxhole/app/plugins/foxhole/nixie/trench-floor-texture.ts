import { DOMAdapter, Texture } from 'pixi.js';

const interiors = new WeakMap<Texture, Texture>();
export const TRENCH_CONCRETE_FLOOR_INSET = { x: 16, y: 8 };

/** Crop the baked slab rim once; never modify the shared regular-trench texture. */
export function trenchConcreteFloorInterior(texture: Texture): Texture {
    const cached = interiors.get(texture);
    if (cached && !cached.destroyed) return cached;
    const { x, y } = TRENCH_CONCRETE_FLOOR_INSET;
    const width = texture.width - x * 2, height = texture.height - y * 2;
    if (width <= 0 || height <= 0 || !texture.source.resource) return texture;
    const canvas = DOMAdapter.get().createCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) return texture;
    context.drawImage(texture.source.resource as CanvasImageSource, texture.frame.x + x, texture.frame.y + y, width, height, 0, 0, width, height);
    const interior = Texture.from(canvas);
    interior.source.style.addressMode = 'mirror-repeat';
    interiors.set(texture, interior);
    return interior;
}
