const width = 2048;
const height = 1776;
const texturePath = 'War/Content/Textures/UI/HexMaps/Processed/MapDeadlandsHex.uasset';
// Pin the tested Deadlands header from the Foxhole map exporter's texture template.
const headerHash = 'c993458f322dd75e91d28a6ec8a577689ed3c4a8fb5e1bccb000fadf46ed7a59';
const textureFooter = new Uint8Array(28);
const footerFields = new DataView(textureFooter.buffer);
footerFields.setUint32(0, width, true);
footerFields.setUint32(4, height, true);
footerFields.setUint32(8, 1, true); // One mip.
footerFields.setUint32(16, 15, true);
footerFields.setUint32(24, 0x9e2a83c1, true); // Unreal package magic.
const weights = [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64];

/**
 * Fit opaque BC7 mode 6 blocks by alternating between index assignment and
 * least-squares RGB endpoints. Keep the original candidate unless error falls.
 */
function refineOpaqueBlock(rgba, offsets, endpoints, indices, candidate, candidateIndices) {
    const error = (colors, assignments) => {
        let total = 0;
        for (let pixel = 0; pixel < 16; pixel++) {
            const weight = weights[assignments[pixel]];
            for (let c = 0; c < 3; c++) {
                const decoded = ((64 - weight) * colors[c] + weight * colors[c + 4] + 32) >> 6;
                total += (decoded - rgba[offsets[pixel] + c]) ** 2;
            }
        }
        return total;
    };
    let best = error(endpoints, indices);
    if (best === 0) return;
    candidateIndices.set(indices);
    for (let pass = 0; pass < 4; pass++) {
        let aa = 0;
        let ab = 0;
        let bb = 0;
        for (const index of candidateIndices) {
            const b = weights[index];
            const a = 64 - b;
            aa += a * a;
            ab += a * b;
            bb += b * b;
        }
        const determinant = aa * bb - ab * ab;
        if (!determinant) break;

        let lengthSquared = 0;
        for (let c = 0; c < 3; c++) {
            let ap = 0;
            let bp = 0;
            for (let pixel = 0; pixel < 16; pixel++) {
                const b = weights[candidateIndices[pixel]];
                const value = rgba[offsets[pixel] + c];
                ap += (64 - b) * value;
                bp += b * value;
            }
            // Both endpoint parity bits are odd so decoded alpha stays 255.
            const first = 64 * (bb * ap - ab * bp) / determinant;
            const last = 64 * (aa * bp - ab * ap) / determinant;
            candidate[c] = 2 * Math.max(0, Math.min(127, Math.round((first - 1) / 2))) + 1;
            candidate[c + 4] = 2 * Math.max(0, Math.min(127, Math.round((last - 1) / 2))) + 1;
            lengthSquared += (candidate[c + 4] - candidate[c]) ** 2;
        }
        for (let pixel = 0; pixel < 16; pixel++) {
            let dot = 0;
            for (let c = 0; c < 3; c++) {
                dot += (rgba[offsets[pixel] + c] - candidate[c]) * (candidate[c + 4] - candidate[c]);
            }
            const weight = lengthSquared ? 64 * dot / lengthSquared : 0;
            let index = 0;
            while (index < 15 && weight > (weights[index] + weights[index + 1]) / 2) index++;
            candidateIndices[pixel] = index;
        }
        const next = error(candidate, candidateIndices);
        if (next >= best) break;
        best = next;
        for (let c = 0; c < 3; c++) {
            endpoints[c] = candidate[c];
            endpoints[c + 4] = candidate[c + 4];
        }
        indices.set(candidateIndices);
    }
}

function encodeBc7(rgba) {
    const output = new Uint8Array(width * height);
    const offsets = new Uint32Array(16);
    const indices = new Uint8Array(16);
    const endpoints = new Uint8Array(8);
    const candidate = new Uint8Array(8);
    const candidateIndices = new Uint8Array(16);
    let block = 0;
    let bit = 0;

    function write(value, count) {
        const byte = block + (bit >> 3);
        const shift = bit & 7;
        output[byte] |= value << shift;
        if (shift + count > 8) output[byte + 1] |= value >> (8 - shift);
        bit += count;
    }

    for (let y = 0; y < height; y += 4) {
        for (let x = 0; x < width; x += 4) {
            let opaque = true;
            let low = Infinity;
            let high = -Infinity;
            let start = 0;
            let end = 0;
            for (let pixel = 0; pixel < 16; pixel++) {
                const offset = ((y + (pixel >> 2)) * width + x + (pixel & 3)) * 4;
                offsets[pixel] = offset;
                opaque &&= rgba[offset + 3] === 255;
                const score = rgba[offset] + rgba[offset + 1] + rgba[offset + 2] + 4 * rgba[offset + 3];
                if (score < low) { low = score; start = offset; }
                if (score > high) { high = score; end = offset; }
            }
            const startParity = rgba[start + 3] & 1;
            const endParity = rgba[end + 3] & 1;
            for (let channel = 0; channel < 4; channel++) {
                endpoints[channel] = (rgba[start + channel] & 254) | startParity;
                endpoints[channel + 4] = (rgba[end + channel] & 254) | endParity;
            }
            let lengthSquared = 0;
            for (let channel = 0; channel < 4; channel++) {
                lengthSquared += (endpoints[channel + 4] - endpoints[channel]) ** 2;
            }
            for (let pixel = 0; pixel < 16; pixel++) {
                let dot = 0;
                for (let channel = 0; channel < 4; channel++) {
                    dot += (rgba[offsets[pixel] + channel] - endpoints[channel])
                        * (endpoints[channel + 4] - endpoints[channel]);
                }
                const weight = lengthSquared ? 64 * dot / lengthSquared : 0;
                let index = 0;
                while (index < 15 && weight > (weights[index] + weights[index + 1]) / 2) index++;
                indices[pixel] = index;
            }
            // Keep the established encoding for transparent and hex boundary blocks.
            if (opaque) refineOpaqueBlock(rgba, offsets, endpoints, indices, candidate, candidateIndices);
            // Mode 6 omits the high bit of the first index. Swap endpoints if needed.
            const swap = indices[0] >= 8;
            bit = 0;
            write(64, 7);
            for (let channel = 0; channel < 4; channel++) {
                write(endpoints[channel + (swap ? 4 : 0)] >> 1, 7);
                write(endpoints[channel + (swap ? 0 : 4)] >> 1, 7);
            }
            write(swap ? endParity : startParity, 1);
            write(swap ? startParity : endParity, 1);
            for (let pixel = 0; pixel < 16; pixel++) {
                write(swap ? 15 - indices[pixel] : indices[pixel], pixel === 0 ? 3 : 4);
            }
            block += 16;
        }
    }
    return output;
}

function pakString(value) {
    const bytes = new TextEncoder().encode(value + '\0');
    const result = new Uint8Array(4 + bytes.length);
    new DataView(result.buffer).setUint32(0, bytes.length, true);
    result.set(bytes, 4);
    return result;
}

async function storedPakEntry(data) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
    const record = new Uint8Array(53);
    const view = new DataView(record.buffer);
    view.setBigUint64(8, BigInt(data.length), true);
    view.setBigUint64(16, BigInt(data.length), true);
    record.set(hash, 28);
    return record;
}

/**
 * Build a single stored entry using the UE version 3 Pak format.
 * @param {Uint8Array | Uint8ClampedArray} rgba
 * @param {ArrayBuffer} cookedHeader
 */
export async function buildDeadlandsPak(rgba, cookedHeader) {
    if (rgba.length !== width * height * 4) throw new Error('Expected a 2048 × 1776 RGBA map image.');
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', cookedHeader));
    const hex = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
    if (hex !== headerHash) throw new Error('Choose the supported MapDeadlandsHex cooked header.');
    const cooked = new Uint8Array(cookedHeader.byteLength + width * height + textureFooter.length);
    cooked.set(new Uint8Array(cookedHeader));
    cooked.set(encodeBc7(rgba), cookedHeader.byteLength);
    cooked.set(textureFooter, cooked.length - textureFooter.length);

    const record = await storedPakEntry(cooked);
    const mount = pakString('../../../');
    const path = pakString(texturePath);
    const index = new Uint8Array(mount.length + 4 + path.length + record.length);
    index.set(mount);
    new DataView(index.buffer).setUint32(mount.length, 1, true);
    index.set(path, mount.length + 4);
    index.set(record, index.length - record.length);

    const footer = new Uint8Array(44);
    const view = new DataView(footer.buffer);
    view.setUint32(0, 0x5a6f12e1, true);
    view.setUint32(4, 3, true);
    view.setBigUint64(8, BigInt(record.length + cooked.length), true);
    view.setBigUint64(16, BigInt(index.length), true);
    footer.set(new Uint8Array(await crypto.subtle.digest('SHA-1', index)), 24);
    return new Blob([record, cooked, index, footer], { type: 'application/octet-stream' });
}

export { encodeBc7 };
