export type FoxholeHitboxMetrics = { width: number; height: number; anchorX: number; anchorY: number };
export type FoxholeClipboardHitbox = { points: number[]; name: string; role: 'solid' | 'hurt' | 'sensor' | 'custom' };
export function isFoxholeHitboxPasteContextCurrent(before: { hostId: string; revision: number | undefined; canvas: unknown; metrics: FoxholeHitboxMetrics },
    after: { hostId: string | undefined; revision: number | undefined; canvas: unknown; metrics: FoxholeHitboxMetrics | null; current: boolean }): boolean {
    return after.current && before.hostId === after.hostId && before.revision === after.revision && before.canvas === after.canvas && !!after.metrics
        && (['width', 'height', 'anchorX', 'anchorY'] as const).every(key => before.metrics[key] === after.metrics![key]);
}
export function serializeFoxholeHitboxClipboard(hitboxes: readonly { pointsFlat: number[]; name: string; role: string }[], metrics: FoxholeHitboxMetrics): string {
    return JSON.stringify({ kind: 'foxhole-hitboxes', version: 1, polygons: hitboxes.map(hitbox => ({ name: hitbox.name, role: hitbox.role,
        points: hitbox.pointsFlat.map((point, index) => index % 2 ? point / metrics.height + metrics.anchorY : point / metrics.width + metrics.anchorX) })) });
}
export function parseFoxholeHitboxClipboard(value: string, metrics: FoxholeHitboxMetrics): FoxholeClipboardHitbox[] {
    try {
        const payload: unknown = JSON.parse(value);
        if (!payload || typeof payload !== 'object') return [];
        const record = payload as { kind?: unknown; version?: unknown; polygons?: unknown };
        if (record.kind !== 'foxhole-hitboxes' || record.version !== 1 || !Array.isArray(record.polygons)) return [];
        return record.polygons.slice(0, 128).flatMap(item => {
            if (!item || typeof item !== 'object') return [];
            const polygon = item as { points?: unknown; name?: unknown; role?: unknown };
            if (!Array.isArray(polygon.points) || polygon.points.length < 6 || polygon.points.length > 4096 || polygon.points.length % 2
                || !polygon.points.every(value => typeof value === 'number' && Number.isFinite(value))) return [];
            const points = polygon.points.map((point: number, index: number) => index % 2
                ? (point - metrics.anchorY) * metrics.height : (point - metrics.anchorX) * metrics.width);
            const role = polygon.role === 'hurt' || polygon.role === 'sensor' || polygon.role === 'custom' ? polygon.role : 'solid';
            const name = typeof polygon.name === 'string' ? polygon.name.trim() : '';
            return [{ points, role, name }];
        });
    } catch { return []; }
}
