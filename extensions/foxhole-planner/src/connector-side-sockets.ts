import { samplePointAlongSplinePath } from '@nixie/extension-sdk/experimental/scene-v2';

/** Native pipe side sockets follow the arc midpoint and cross-section edges. */
export function resolveFacilityPipeSideSocketsFromPath(path: {
    points: readonly { x: number; y: number; }[];
    lengths: readonly number[];
    totalLength: number;
}, lateralOffset = 0): Array<{ name: 'LeftSocket' | 'RightSocket'; x: number; y: number; rotation: number; }> {
    const midpoint = samplePointAlongSplinePath(path.points, path.lengths, path.totalLength * 0.5);
    if (!midpoint) {
        return [];
    }
    const offset = Math.max(0, Number(lateralOffset));
    return (['LeftSocket', 'RightSocket'] as const).map((name, index) => {
        const rotation = midpoint.tangent + (index === 0 ? -Math.PI : Math.PI) * 0.5;
        return { name, x: midpoint.x + Math.cos(rotation) * offset, y: midpoint.y + Math.sin(rotation) * offset, rotation };
    });
}
