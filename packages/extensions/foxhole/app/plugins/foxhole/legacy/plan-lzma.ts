import LZMA from './lzma-browser.js';
import { LEGACY_BLUEPRINT_LIMITS } from '#nixie/utils/legacy-blueprint-archive-bounds.ts';

/**
 * Browser-safe LZMA helpers (vendored from game-kitchen lzma_worker).
 * Do not import the npm `lzma` package in client code — it requires Node `path`/`__dirname`.
 */

export function decompressLegacyLzma(bytes: Uint8Array | number[], bounded = false): string {
    const input = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
    if (bounded) {
        if (input.length < 13) {
            throw new Error('Truncated LZMA header.');
        }
        const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
        const properties = input[0]!;
        const lc = properties % 9;
        const lp = Math.floor(properties / 9) % 5;
        const size = view.getBigUint64(5, true);
        if (properties >= 225 || lc + lp > 8 || view.getUint32(1, true) > LEGACY_BLUEPRINT_LIMITS.projectBytes
            || (size !== 0xffffffffffffffffn && size > BigInt(LEGACY_BLUEPRINT_LIMITS.projectBytes))) {
            throw new Error('LZMA allocation exceeds import limit.');
        }
    }
    const result = bounded ? LZMA.decompressBounded(input, LEGACY_BLUEPRINT_LIMITS.projectBytes, LEGACY_BLUEPRINT_LIMITS.elapsedMs) : LZMA.decompress(input);
    if (typeof result !== 'string') {
        throw new Error('Failed to decompress LZMA payload: unexpected result type');
    }
    return result;
}

export function compressLegacyLzma(text: string, level = 1): Uint8Array {
    const result = LZMA.compress(text, level);
    if (!result || typeof result === 'string') {
        throw new Error('Failed to compress LZMA payload: unexpected result type');
    }
    return result instanceof Uint8Array ? result : Uint8Array.from(result as number[]);
}
