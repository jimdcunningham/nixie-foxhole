import {loadFoxholeCatalogLibrary, type FoxholeCatalogPin} from '../shared/catalog-library.mjs';
import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import {
  copyFile,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  createBrotliCompress,
  createBrotliDecompress,
  constants as zlibConstants,
} from 'node:zlib';
import type {
  PublishedInfo,
  PublishedScope,
  ReleaseReceipt,
} from '../shared/contracts.js';

interface FileReceipt {
  url: string;
  path: string;
  sha256: string;
  byteLength: number;
}
export interface PublishedPlan {
  release: ReleaseReceipt;
  source: 'channel' | 'bundled';
  scope: PublishedScope;
  files: FileReceipt[];
  baseUrl: string;
  bytes: number;
}
interface Options {
  root: string;
  pin: FoxholeCatalogPin;
  channelUrl: string;
  fetcher?: typeof fetch;
}
const digest = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const MAX_FILE = 512 * 1024 ** 2;
const portable = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 512 &&
  /^[A-Za-z0-9_./-]+$/.test(value) &&
  value
    .split('/')
    .every(
      (part) =>
        !!part &&
        part !== '.' &&
        part !== '..' &&
        !part.startsWith('.') &&
        !part.endsWith('.') &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part),
    );
function receipt(value: any, maximum = MAX_FILE): ReleaseReceipt {
  if (
    !value ||
    typeof value.url !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.byteLength) ||
    value.byteLength < 0 ||
    value.byteLength > maximum
  )
    throw new Error('Invalid published receipt.');
  return { url: value.url, sha256: value.sha256, byteLength: value.byteLength };
}
async function fileHash(file: string) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(temporary, JSON.stringify(value), { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
async function concurrent<T>(
  rows: T[],
  task: (row: T) => Promise<void>,
  count = 6,
) {
  let cursor = 0,
    failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(count, rows.length) }, async () => {
      while (cursor < rows.length && !failure) {
        const row = rows[cursor++]!;
        try {
          await task(row);
        } catch (error) {
          failure ??= error;
        }
      }
    }),
  );
  if (failure) throw failure;
}

/** Public HTTPS only. No S3 credentials, generation runtime, or platform binaries. */
export class PublishedLibrary {
  readonly baseUrl: string;
  private root: string;
  private pin: FoxholeCatalogPin;
  private channel: string;
  private fetcher: typeof fetch;
  constructor(options: Options) {
    this.root = path.resolve(options.root);
    this.pin = options.pin;
    this.baseUrl = new URL('foxhole-planner/', this.pin.baseUrl).href;
    this.channel = options.channelUrl;
    this.fetcher = options.fetcher ?? fetch;
    this.url(this.pin.catalog.url);
    this.url(this.channel);
  }
  private url(value: string) {
    const url = new URL(value),
      base = new URL(this.baseUrl);
    if (
      url.protocol !== 'https:' ||
      url.origin !== base.origin ||
      !url.pathname.startsWith(base.pathname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      /%/.test(url.pathname)
    )
      throw new Error(
        'Published URLs must stay inside the trusted HTTPS assets directory.',
      );
    return url.href;
  }
  private async response(url: string, signal: AbortSignal) {
    let error: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      signal.throwIfAborted();
      try {
        const result = await this.fetcher(this.url(url), {
          signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
          redirect: 'error',
          headers: {
            'Accept-Encoding': 'br, gzip, deflate',
            ...(url === this.channel ? { 'Cache-Control': 'no-cache' } : {}),
          },
        });
        if (
          result.ok ||
          result.status === 404 ||
          (result.status < 500 && result.status !== 429)
        )
          return result;
        await result.body?.cancel();
        throw new Error('Asset service returned HTTP ' + result.status);
      } catch (cause) {
        error = cause;
        signal.throwIfAborted();
      }
    }
    throw error;
  }
  private async metadata(ref: ReleaseReceipt, signal: AbortSignal) {
    receipt(ref, 16 * 1024 ** 2);
    const response = await this.response(ref.url, signal);
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error(
        'Could not fetch release metadata (HTTP ' + response.status + ').',
      );
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of Readable.fromWeb(response.body)) {
      bytes += chunk.length;
      if (bytes > ref.byteLength)
        throw new Error('Release metadata exceeds its receipt.');
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    if (bytes !== ref.byteLength || digest(body) !== ref.sha256)
      throw new Error('Release metadata checksum does not match.');
    return JSON.parse(body.toString('utf8'));
  }
  async current(): Promise<PublishedInfo | null> {
    try {
      const pointer = path.join(this.root, 'current.json');
      if ((await stat(pointer)).size > 16384)
        throw new Error('The downloaded-library index is invalid.');
      const info: PublishedInfo = JSON.parse(await readFile(pointer, 'utf8'));
      receipt(info.release, 16 * 1024 ** 2);
      const relative = path
        .relative(this.root, info.assetsPath)
        .split(path.sep)
        .join('/');
      if (
        !/^releases[/][a-f0-9-]{36}[/]assets$/.test(relative) ||
        info.baseUrl !== this.baseUrl ||
        !['all', 'catalog'].includes(info.scope) ||
        !Number.isSafeInteger(info.files) ||
        info.files < 0 ||
        info.files > 100000
      )
        throw new Error('The downloaded-library index is invalid.');
      const canonical = await realpath(info.assetsPath),
        root = await realpath(this.root);
      if (!canonical.startsWith(root + path.sep))
        throw new Error('The downloaded library is outside its cache.');
      return { ...info, assetsPath: canonical };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return null;
    }
  }
  async check(
    scope: PublishedScope,
    signal: AbortSignal,
    progress: (message: string) => void = () => {},
  ): Promise<PublishedPlan> {
    if (scope !== 'all' && scope !== 'catalog')
      throw new Error('Invalid download scope.');
    progress('Checking published release…');
    const response = await this.response(this.channel, signal);
    let pin = this.pin,
      source: PublishedPlan['source'] = 'bundled';
    if (response.status === 404) await response.body?.cancel();
    else {
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error(
          'Could not check the published channel (HTTP ' +
            response.status +
            ').',
        );
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of Readable.fromWeb(response.body)) {
        length += chunk.length;
        if (length > 16384) throw new Error('Published channel is too large.');
        chunks.push(Buffer.from(chunk));
      }
      const channel = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (channel.schemaVersion !== 1)
        throw new Error('Invalid published channel.');
      pin = channel.pin;
      if (!pin?.catalog || new URL('foxhole-planner/', pin.baseUrl).href !== this.baseUrl) throw new Error('Channel pin differs from trusted HTTPS asset root.');
      this.url(pin.catalog.url);
      source = 'channel';
    }
    const library = await loadFoxholeCatalogLibrary(pin, <T>(ref: ReleaseReceipt) => this.metadata(ref, signal) as Promise<T>);
    const release = receipt(pin.completion ?? pin.catalog, 16 * 1024 ** 2);
    this.url(release.url);
    if (pin.completion) {
      const completion = await this.metadata(pin.completion, signal);
      if (completion.schemaVersion !== 1 || completion.format !== 'foxwatch-product-catalog-release-v1'
          || !['url','sha256','byteLength'].every(key => completion.catalog?.[key] === pin.catalog[key as keyof ReleaseReceipt])) {
        throw new Error('Catalog completion differs from pin.');
      }
    }
    const files = new Map<string, FileReceipt>(), folded = new Set<string>();
    for (const [logical, location] of library.files) {
      if (scope === 'catalog' && logical.startsWith('world/')) continue;
      if (!portable(logical) || folded.has(logical.toLowerCase())) throw new Error('A published path is not portable or unique.');
      folded.add(logical.toLowerCase());
      files.set(logical, {path: logical, url: this.url(location.url), sha256: location.entry.sha256, byteLength: location.entry.byteLength});
    }
    if (!files.size) throw new Error('The catalog has no matching assets.');
    const rows = [...files.values()];
    return {
      release,
      source,
      scope,
      baseUrl: this.baseUrl,
      files: rows,
      bytes: rows.reduce((sum, row) => sum + row.byteLength, 0),
    };
  }
  async download(
    plan: PublishedPlan,
    signal: AbortSignal,
    progress: (info: {
      completed: number;
      total: number;
      reused: number;
      path: string;
    }) => void = () => {},
  ): Promise<PublishedInfo> {
    receipt(plan.release, 16 * 1024 ** 2);
    if (
      plan.baseUrl !== this.baseUrl ||
      !['all', 'catalog'].includes(plan.scope)
    )
      throw new Error('The release source changed. Check for updates again.');
    await mkdir(this.root, { recursive: true });
    const root = await realpath(this.root),
      id = randomUUID(),
      stage = path.join(root, 'staging', id),
      assets = path.join(stage, 'assets');
    await mkdir(assets, { recursive: true });
    let completed = 0,
      reused = 0;
    const jobs = new Map<string, Promise<{ file: string; reused: boolean }>>();
    const ensureObject = (row: FileReceipt) => {
      const compressed = row.path.startsWith('world/content/br/');
      const key = row.sha256 + (compressed ? '.br' : '.raw');
      const existing = jobs.get(key);
      if (existing) return existing;
      const job = (async () => {
        const object = path.join(root, 'objects', key),
          temporary = object + '.' + randomUUID() + '.tmp';
        await mkdir(path.dirname(object), { recursive: true });
        try {
          if (compressed) {
            const input = createReadStream(object),
              decoded = input.pipe(createBrotliDecompress());
            input.on('error', (error) => decoded.destroy(error));
            const checksum = createHash('sha256');
            let size = 0;
            try {
              for await (const chunk of decoded) {
                size += chunk.length;
                if (size > row.byteLength) {
                  decoded.destroy();
                  input.destroy();
                  throw new Error('Cached asset exceeds its receipt.');
                }
                checksum.update(chunk);
              }
            } finally {
              input.destroy();
              decoded.destroy();
            }
            if (
              size === row.byteLength &&
              checksum.digest('hex') === row.sha256
            )
              return { file: object, reused: true };
          } else if (
            (await stat(object)).size === row.byteLength &&
            (await fileHash(object)) === row.sha256
          )
            return { file: object, reused: true };
        } catch (error) {
          if (signal.aborted) throw error;
        }
        try {
          const response = await this.response(row.url, signal);
          if (!response.ok || !response.body) {
            await response.body?.cancel();
            throw new Error(
              'Could not download ' +
                row.path +
                ' (HTTP ' +
                response.status +
                ').',
            );
          }
          const hash = createHash('sha256');
          let bytes = 0;
          await pipeline(
            Readable.fromWeb(response.body),
            new Transform({
              transform(chunk, _encoding, done) {
                bytes += chunk.length;
                if (bytes > row.byteLength) {
                  done(new Error('Asset exceeds its published size.'));
                  return;
                }
                hash.update(chunk);
                done(null, chunk);
              },
            }),
            ...(compressed
              ? [
                  createBrotliCompress({
                    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
                  }),
                ]
              : []),
            createWriteStream(temporary, { flags: 'wx' }),
            { signal },
          );
          if (bytes !== row.byteLength || hash.digest('hex') !== row.sha256)
            throw new Error('Asset checksum does not match: ' + row.path);
          await rename(temporary, object);
          return { file: object, reused: false };
        } finally {
          await unlink(temporary).catch((error) => {
            if (error.code !== 'ENOENT') throw error;
          });
        }
      })();
      jobs.set(key, job);
      return job;
    };
    try {
      await concurrent(plan.files, async (row) => {
        signal.throwIfAborted();
        if (
          !portable(row.path) ||
          !/^[a-f0-9]{64}$/.test(row.sha256) ||
          !Number.isSafeInteger(row.byteLength) ||
          row.byteLength < 0 ||
          row.byteLength > MAX_FILE
        )
          throw new Error('Invalid published file.');
        const object = await ensureObject(row),
          destination = path.join(assets, ...row.path.split('/'));
        await mkdir(path.dirname(destination), { recursive: true });
        await copyFile(object.file, destination, constants.COPYFILE_FICLONE);
        if (object.reused) reused++;
        progress({
          completed: ++completed,
          total: plan.files.length,
          reused,
          path: row.path,
        });
      });
      signal.throwIfAborted();
      const info: PublishedInfo = {
        release: plan.release,
        source: plan.source,
        scope: plan.scope,
        files: plan.files.length,
        bytes: plan.bytes,
        downloadedAt: new Date().toISOString(),
        assetsPath: path.join(root, 'releases', id, 'assets'),
        baseUrl: this.baseUrl,
      };
      await atomicJson(path.join(assets, '.foxwatch-published.json'), info);
      await mkdir(path.join(root, 'releases'), { recursive: true });
      await rename(stage, path.join(root, 'releases', id));
      await atomicJson(path.join(root, 'current.json'), info);
      return info;
    } catch (error) {
      // Only remove the random staging directory created by this operation.
      const canonical = await realpath(stage).catch(() => null);
      if (
        canonical &&
        path.dirname(canonical) === path.join(root, 'staging') &&
        path.basename(canonical) === id
      )
        await rm(canonical, { recursive: true, force: true });
      throw error;
    }
  }
}
