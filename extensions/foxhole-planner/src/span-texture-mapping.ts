export interface SpanTextureMapping {
    repeatLength: number;
    intervalCm?: number;
}

export function mapSpanTextureUAlong(arcDistance: number, mapping: SpanTextureMapping): number {
    return arcDistance / Math.max(8, mapping.repeatLength);
}
