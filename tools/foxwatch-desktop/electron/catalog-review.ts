import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import type { AssetChange, AssetComparison, AssetVersion, CatalogReview } from '../shared/contracts.js';
import { previewBytes } from './preview-file.js';
import { assetKind, readableName } from './asset-directory.js';

type FileReceipt = { url: string; entry: { sha256: string; byteLength: number } };
type Result = {
  before: { version: string; sha256: string }; after: { sha256: string };
  changes: { path: string; status: AssetChange; before: FileReceipt | null; after: FileReceipt | null }[];
};
interface Payload { key: string; file: string; contentEncoding?: string; decodedSha256: string; decodedBytes: number }
const limit = 32 * 1024 ** 2;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function publishedBytes({ url, entry }: FileReceipt) {
  const location = new URL(url);
  if (location.protocol !== 'https:' || location.username || location.password) throw new Error('Invalid published asset URL.');
  const response = await fetch(location, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error('Published asset unavailable (HTTP ' + response.status + ').');
  const bytes = Buffer.alloc(entry.byteLength);
  let offset = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.byteLength > bytes.length) throw new Error('Published asset exceeds the catalog size.');
      bytes.set(value, offset);
      offset += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return bytes.subarray(0, offset);
}

async function preparedBytes(directory: string, receipt: FileReceipt, payload: Payload | undefined) {
  if (!payload || payload.decodedSha256 !== receipt.entry.sha256 || payload.decodedBytes !== receipt.entry.byteLength) {
    throw new Error('Prepared asset is missing or differs from the catalog.');
  }
  const file = await realpath(path.resolve(directory, payload.file));
  const relative = path.relative(directory, file);
  if (!relative.startsWith('payload' + path.sep) || path.isAbsolute(relative)) throw new Error('Invalid prepared asset path.');
  const info = await stat(file);
  if (!info.isFile() || info.size > limit) throw new Error('Prepared asset exceeds the 32 MB preview limit.');
  const encoded = await readFile(file);
  if (payload.contentEncoding === 'br') return brotliDecompressSync(encoded, { maxOutputLength: limit });
  if (payload.contentEncoding === 'gzip') return gunzipSync(encoded, { maxOutputLength: limit });
  if (payload.contentEncoding) throw new Error('Unsupported prepared asset encoding.');
  return encoded;
}

export class CatalogReviewService {
  private active?: { id: string; result: Result; directory: string; payload: Map<string, Payload> };
  private request = 0;
  constructor(private repo: string) {}

  async review(planPath?: string, label = (file: string, directory: boolean) => readableName(path.posix.basename(file), directory)): Promise<CatalogReview | null> {
    const request = ++this.request;
    if (!planPath) { this.active = undefined; return null; }
    const directory = await realpath(path.dirname(planPath));
    const { reviewPreparedPlannerCatalog } = await import(pathToFileURL(path.join(this.repo,
      'tools/foxwatch/catalog/release-comparison.mjs')).href);
    const result: Result = await reviewPreparedPlannerCatalog(directory);
    const plan = JSON.parse(await readFile(path.join(directory, 'plan.json'), 'utf8'));
    const { planSha256, ...body } = plan;
    if (hash(Buffer.from(JSON.stringify(body))) !== planSha256 || !Array.isArray(plan.objects)) {
      throw new Error('Prepared publication plan integrity mismatch.');
    }
    const payload = new Map<string, Payload>(plan.objects.map((row: Payload) => [row.key, row]));
    const catalog = path.posix.join(plan.target.prefix, 'objects', result.after.sha256 + '.json');
    if (payload.get(catalog)?.decodedSha256 !== result.after.sha256) throw new Error('Prepared plan and reviewed catalog differ.');
    const id = request.toString();
    if (request === this.request) this.active = { id, result, directory, payload };
    const folders = new Map<string, string>();
    const changes = result.changes.map(({ path: file, status }) => {
      for (let parent = path.posix.dirname(file); parent !== '.'; parent = path.posix.dirname(parent)) {
        if (folders.has(parent)) break;
        folders.set(parent, label(parent, true));
      }
      const name = path.posix.basename(file);
      return { path: file, change: status, name, label: label(file, false), kind: assetKind(name), directory: false };
    });
    return { id, version: result.before.version, sha256: result.after.sha256, changes, folderLabels: Object.fromEntries(folders) };
  }

  async preview(reviewId: unknown, file: unknown): Promise<AssetComparison> {
    const active = this.active;
    if (!active || reviewId !== active.id || typeof file !== 'string') throw new Error('This catalog review has changed.');
    const row = active.result.changes.find(change => change.path === file);
    if (!row) throw new Error('Catalog change unavailable.');
    const [before, after] = await Promise.all([
      this.resourcePreview(file, row.before, active),
      this.resourcePreview(file, row.after, active, true),
    ]);
    return { approvedAt: null, labels: { before: 'Planner ' + active.result.before.version, after: 'Prepared Build' }, before, after };
  }

  private async resourcePreview(file: string, resource: FileReceipt | null, active: NonNullable<CatalogReviewService['active']>, prepared = false): Promise<AssetVersion | null> {
    if (!resource) return null;
    const { url, entry: { byteLength, sha256 } } = resource;
    const name = path.posix.basename(file);
    const asset = { path: file, label: readableName(name, false), name, directory: false, kind: assetKind(name),
      absolutePath: url, bytes: byteLength, modifiedAt: '', extension: path.posix.extname(file) };
    try {
      if (byteLength > limit) throw new Error('This asset exceeds the 32 MB preview limit.');
      const key = new URL(url).pathname.slice(1);
      const bytes = prepared
        ? await preparedBytes(active.directory, resource, active.payload.get(key))
        : await publishedBytes(resource);
      if (bytes.length !== byteLength || hash(bytes) !== sha256) throw new Error('Preview bytes differ from the catalog.');
      return { asset, preview: previewBytes(bytes, file, 8 * 1024 ** 2) };
    } catch (error) {
      return { asset, preview: { type: 'unsupported', message: error instanceof Error ? error.message : String(error) } };
    }
  }
}
