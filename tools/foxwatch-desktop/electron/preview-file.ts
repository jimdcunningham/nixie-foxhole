import { open } from 'node:fs/promises';
import { brotliDecompressSync } from 'node:zlib';
import path from 'node:path';
import type { AssetPreview } from '../shared/contracts.js';

const MAX_BYTES = 32 * 1024 * 1024;
const TEXT_BYTES = 1024 * 1024;

/** Keep model loading self-contained and adapt the WebP extension for the beta loader. */
export function prepareGlb(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.byteLength < 28 || bytes.byteLength > MAX_BYTES)
    throw new Error(
      'The model exceeds the 32 MB preview limit or is incomplete.',
    );
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const binary = 20 + jsonLength;
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    binary + 8 > bytes.byteLength ||
    view.getUint32(binary + 4, true) !== 0x004e4942 ||
    binary + 8 + view.getUint32(binary, true) !== bytes.byteLength
  )
    throw new Error('This file is not a complete GLB 2.0 model.');
  const document = JSON.parse(
    new TextDecoder().decode(bytes.subarray(20, binary)),
  );
  if (
    !Array.isArray(document.buffers) ||
    document.buffers.length > 2 ||
    document.buffers.some((buffer: { uri?: string }) => buffer.uri) ||
    document.images?.some((image: { uri?: string }) => image.uri) ||
    document.extensionsRequired?.includes('KHR_draco_mesh_compression')
  )
    throw new Error(
      'This preview supports GLB models with embedded buffers and textures.',
    );
  let decodedBytes = 0;
  for (const buffer of document.buffers) {
    if (
      !Number.isSafeInteger(buffer.byteLength) ||
      buffer.byteLength < 0 ||
      buffer.byteLength > 128 * 1024 * 1024
    )
      throw new Error('The model declares an oversized buffer.');
  }
  for (const buffer of document.bufferViews ?? []) {
    if (!Number.isSafeInteger(buffer.byteLength) || buffer.byteLength < 0)
      throw new Error('The model declares an invalid buffer view.');
    const encoded =
      buffer.extensions?.EXT_meshopt_compression ??
      buffer.extensions?.KHR_meshopt_compression;
    if (encoded) {
      const size = encoded.count * encoded.byteStride;
      if (
        !Number.isSafeInteger(encoded.count) ||
        encoded.count <= 0 ||
        !Number.isInteger(encoded.byteStride) ||
        encoded.byteStride <= 0 ||
        encoded.byteStride > 256 ||
        !Number.isSafeInteger(size) ||
        size !== buffer.byteLength
      )
        throw new Error('The model declares invalid compressed geometry.');
    }
    decodedBytes += buffer.byteLength;
  }
  if (decodedBytes > 128 * 1024 * 1024)
    throw new Error('The model exceeds the decoded geometry preview limit.');
  for (const texture of document.textures ?? []) {
    const source = texture.extensions?.EXT_texture_webp?.source;
    if (source !== undefined) {
      if (
        !Number.isInteger(source) ||
        document.images?.[source]?.mimeType !== 'image/webp'
      )
        throw new Error('The model has an invalid WebP texture.');
      texture.source = source;
    }
  }
  const json = new TextEncoder().encode(JSON.stringify(document));
  const padded = Math.ceil(json.byteLength / 4) * 4;
  const result = new Uint8Array(20 + padded + bytes.byteLength - binary);
  result.set(bytes.subarray(0, 20));
  const resultView = new DataView(result.buffer);
  resultView.setUint32(8, result.byteLength, true);
  resultView.setUint32(12, padded, true);
  result.fill(32, 20, 20 + padded);
  result.set(json, 20);
  result.set(bytes.subarray(binary), 20 + padded);
  return result;
}

function imageMime(bytes: Uint8Array, extension: string): string | null {
  const prefix = Buffer.from(bytes.subarray(0, 16));
  if (
    prefix.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return 'image/png';
  if (
    prefix.toString('ascii', 0, 4) === 'RIFF' &&
    prefix.toString('ascii', 8, 12) === 'WEBP'
  )
    return 'image/webp';
  if (prefix[0] === 255 && prefix[1] === 216 && prefix[2] === 255)
    return 'image/jpeg';
  if (prefix.toString('ascii', 0, 3) === 'GIF') return 'image/gif';
  if (extension === '.svg') return 'image/svg+xml';
  return null;
}

export async function readAssetPreview(
  file: string,
  logicalPath: string,
  textLimit = TEXT_BYTES,
): Promise<AssetPreview> {
  if (!Number.isSafeInteger(textLimit) || textLimit < 1 || textLimit > 8 * TEXT_BYTES) throw new Error('Invalid text preview budget.');
  const extension = path.extname(logicalPath).toLowerCase();
  const text = ['.json', '.md', '.txt', '.csv', '.yaml', '.yml'].includes(
    extension,
  );
  const image = ['.png', '.webp', '.jpg', '.jpeg', '.gif', '.svg'].includes(
    extension,
  );
  if (!text && !image && extension !== '.glb')
    return {
      type: 'unsupported',
      message: 'A preview is not available for this file format yet.',
    };
  const compressed = logicalPath
    .replaceAll('\\', '/')
    .startsWith('world/content/br/');
  const handle = await open(file, 'r');
  let bytes: Buffer;
  let truncated = false;
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('Select a file to preview.');
    if ((!text || compressed) && info.size > MAX_BYTES)
      throw new Error('This file exceeds the 32 MB preview limit.');
    const length =
      text && !compressed ? Math.min(info.size, textLimit) : info.size;
    bytes = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await handle.read(
        bytes,
        offset,
        length - offset,
        offset,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    bytes = bytes.subarray(0, offset);
    truncated = offset < info.size;
  } finally {
    await handle.close();
  }
  if (compressed)
    bytes = brotliDecompressSync(bytes, { maxOutputLength: MAX_BYTES });
  if (text) {
    truncated ||= bytes.byteLength > textLimit;
    const content = new TextDecoder().decode(bytes.subarray(0, textLimit));
    if (content.includes('\0'))
      return {
        type: 'unsupported',
        message: 'This file contains binary data.',
      };
    return {
      type: 'text',
      text: content,
      truncated,
      json: extension === '.json',
    };
  }
  if (image) {
    const mime = imageMime(bytes, extension);
    if (!mime) throw new Error('This file does not contain a supported image.');
    return { type: 'image', bytes: new Uint8Array(bytes), mime };
  }
  return { type: 'model', bytes: prepareGlb(bytes), mime: 'model/gltf-binary' };
}
