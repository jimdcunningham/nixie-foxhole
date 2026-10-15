export const BLUEPRINT_MODERATION_POLICY = 'text-images-v1';
export type ModerationResult = { flagged: boolean; categories: Record<string, unknown>; };

export function requireBlueprintModerationResult(value: unknown, kind: 'text' | 'image'): ModerationResult {
    const result = value as { flagged?: unknown; categories?: Record<string, unknown>; category_applied_input_types?: Record<string, unknown>; } | null;
    const required = kind === 'image'
        ? ['sexual', 'violence/graphic', 'self-harm', 'self-harm/intent', 'self-harm/instructions']
        : ['sexual', 'sexual/minors', 'hate', 'hate/threatening', 'harassment', 'harassment/threatening', 'violence/graphic', 'self-harm', 'self-harm/intent', 'self-harm/instructions'];
    if (!result || typeof result.flagged !== 'boolean' || required.some(key =>
        typeof result.categories?.[key] !== 'boolean' || !Array.isArray(result.category_applied_input_types?.[key])
        || !(result.category_applied_input_types![key] as unknown[]).includes(kind))) {
        throw new Error('Content safety service did not check all required categories for this input.');
    }
    return result as ModerationResult;
}

export function blueprintModerationFlags(result: ModerationResult): string[] {
    // Fictional military plans routinely depict weapons/combat. Graphic violence and threats still go to review.
    const ignored = new Set(['violence', 'illicit']);
    const flags = Object.entries(result.categories).filter(([key, value]) => value === true && !ignored.has(key)).map(([key]) => key);
    if (result.flagged && !Object.values(result.categories).some(value => value === true)) {
        flags.push('provider-flag');
    }
    return flags;
}

export function blueprintTextChunks(value: unknown, maxChars = 6_000): string[] {
    const strings: string[] = [];
    const queue = [value];
    let chars = 0;
    const machineFields = new Set(['id', 'key', 'type', 'textureFile', 'textureData', 'color', 'fill', 'stroke', 'game', 'version']);
    while (queue.length) {
        const item = queue.pop();
        if (typeof item === 'string') {
            if (!item.trim()) {
                continue;
            }
            chars += item.length;
            if (chars > 256_000) {
                throw new Error('Project text exceeds the automatic review limit.');
            }
            strings.push(item);
        } else if (Array.isArray(item)) {
            queue.push(...item);
        } else if (item && typeof item === 'object') {
            for (const [key, child] of Object.entries(item)) {
                if (!machineFields.has(key)) {
                    queue.push(child);
                }
            }
        }
    }
    const text = strings.join('\n');
    const chunks: string[] = [];
    for (let offset = 0; offset < text.length; offset += maxChars) {
        chunks.push(text.slice(offset, offset + maxChars));
    }
    return chunks;
}
