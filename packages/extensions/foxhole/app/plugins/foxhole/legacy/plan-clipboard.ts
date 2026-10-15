import { compressLegacyLzma, decompressLegacyLzma } from './plan-lzma.ts';
import { LEGACY_PLAN_CURRENT_VERSION } from './plan-types.ts';
import type { LegacyPlanSave } from './plan-types.ts';

export const LEGACY_PLAN_CLIPBOARD_PLAIN_PREFIX = 'data:plan;plain,';
export const LEGACY_PLAN_CLIPBOARD_BASE64_PREFIX = 'data:plan;base64,';

function decodeBase64ToBytes(base64: string): Uint8Array {
    if (typeof atob === 'function') {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index++) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    }

    return Uint8Array.from(Buffer.from(base64, 'base64'));
}

function encodeBytesToBase64(bytes: Uint8Array): string {
    if (typeof btoa === 'function') {
        let binary = '';
        for (let index = 0; index < bytes.length; index++) {
            binary += String.fromCharCode(bytes[index]!);
        }
        return btoa(binary);
    }

    return Buffer.from(bytes).toString('base64');
}

function parseLegacyPlanSaveJson(text: string): LegacyPlanSave {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        throw new Error(`Failed to parse legacy plan clipboard JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Legacy plan clipboard JSON must be an object');
    }
    const record = parsed as Record<string, unknown>;
    if (!Array.isArray(record.entities)) {
        throw new Error('Legacy plan clipboard JSON is missing entities');
    }
    return parsed as LegacyPlanSave;
}

export function isLegacyPlanClipboardText(value: string): boolean {
    if (typeof value !== 'string') {
        return false;
    }
    const trimmed = value.trim();
    return trimmed.startsWith(LEGACY_PLAN_CLIPBOARD_PLAIN_PREFIX)
        || trimmed.startsWith(LEGACY_PLAN_CLIPBOARD_BASE64_PREFIX);
}

/**
 * Parse a legacy Foxhole Planner clipboard string (`data:plan;plain,` / `data:plan;base64,`).
 */
export function parseLegacyPlanClipboardText(value: string): LegacyPlanSave {
    const trimmed = String(value ?? '').trim();
    if (trimmed.startsWith(LEGACY_PLAN_CLIPBOARD_PLAIN_PREFIX)) {
        return parseLegacyPlanSaveJson(trimmed.slice(LEGACY_PLAN_CLIPBOARD_PLAIN_PREFIX.length));
    }
    if (trimmed.startsWith(LEGACY_PLAN_CLIPBOARD_BASE64_PREFIX)) {
        const base64 = trimmed.slice(LEGACY_PLAN_CLIPBOARD_BASE64_PREFIX.length);
        const bytes = decodeBase64ToBytes(base64);
        const jsonText = decompressLegacyLzma(bytes);
        return parseLegacyPlanSaveJson(jsonText);
    }
    throw new Error('Clipboard text is not a legacy Foxhole plan payload');
}

/**
 * Serialize a legacy selection save as a pasteable clipboard string.
 */
export function serializeLegacyPlanClipboardText(
    save: Pick<LegacyPlanSave, 'entities'> & Partial<LegacyPlanSave>,
    options: { compressed?: boolean; } = {},
): string {
    const payload: LegacyPlanSave = {
        version: save.version ?? LEGACY_PLAN_CURRENT_VERSION,
        entities: save.entities ?? [],
    };
    const json = JSON.stringify(payload);
    if (options.compressed) {
        const compressed = compressLegacyLzma(json, 1);
        return `${LEGACY_PLAN_CLIPBOARD_BASE64_PREFIX}${encodeBytesToBase64(compressed)}`;
    }
    return `${LEGACY_PLAN_CLIPBOARD_PLAIN_PREFIX}${json}`;
}
