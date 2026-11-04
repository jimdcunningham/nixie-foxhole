import { parseHitboxClipboard, serializeHitboxClipboard } from '#nixie/plugins/nixie/board/utils/hitbox-clipboard.ts';
import type { HitboxHostMetrics } from '#nixie/plugins/nixie/board/utils/hitbox-metrics.ts';
export { isHitboxPasteContextCurrent as isFoxholeHitboxPasteContextCurrent } from '#nixie/plugins/nixie/board/utils/hitbox-clipboard.ts';

export type FoxholeHitboxMetrics = HitboxHostMetrics;
export type FoxholeClipboardHitbox = ReturnType<typeof parseHitboxClipboard>[number];

export function serializeFoxholeHitboxClipboard(hitboxes: Parameters<typeof serializeHitboxClipboard>[1], metrics: FoxholeHitboxMetrics): string {
    return serializeHitboxClipboard('foxhole-hitboxes', hitboxes, metrics);
}

export function parseFoxholeHitboxClipboard(value: string, metrics: FoxholeHitboxMetrics): FoxholeClipboardHitbox[] {
    return parseHitboxClipboard('foxhole-hitboxes', value, metrics);
}
