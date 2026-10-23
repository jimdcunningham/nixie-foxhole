import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { triangleGlb, whitePng } from '../tests/preview-fixtures.mjs';
export async function checkPublishedLibrary(app, page, project) {
  const base = 'https://assets.nixiejs.com/foxhole-planner/';
  const objects = new Map();
  const add = (name, body) => {
    const url = new URL(name, base).href;
    const bytes = Buffer.isBuffer(body)
      ? body
      : Buffer.from(JSON.stringify(body));
    objects.set(url, bytes.toString('base64'));
    return {
      url,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      byteLength: bytes.length,
    };
  };
  const file = (logical, name, bytes) => {
    const ref = add(name, bytes);
    return {
      logical,
      path: name,
      sha256: ref.sha256,
      byteLength: ref.byteLength,
    };
  };
  const files = [
    file(
      'types/structures/factory/factory.glb',
      'objects/model.glb',
      triangleGlb(),
    ),
    file(
      'types/structures/factory/factory.preview.webp',
      'objects/image.webp',
      whitePng(),
    ),
    file(
      'metadata.json',
      'objects/metadata.json',
      Buffer.from('{"version":1}'),
    ),
  ];
  const index = add('smoke-pack.json', {
    contractVersion: 1,
    assets: files.map(({ logical, ...row }) => row),
  });
  const mapping = add('smoke-mapping.json', {
    schemaVersion: 1,
    files: Object.fromEntries(
      files.map((row) => [row.logical, { path: row.path }]),
    ),
  });
  const release = add('smoke-release.json', {
    schemaVersion: 1,
    format: 'foxwatch-asset-release-v1',
    worldBaseUrl: new URL('world/', base).href,
    packs: { catalog: { pack: { manifest: index }, mapping } },
    bootstrap: {},
  });
  add('channels/stable.json', { schemaVersion: 1, release });
  await app.evaluate(
    async (_, { module, objects }) => {
      const { PublishedLibrary } = process
          .getBuiltinModule('module')
          .createRequire(module)(
          process.getBuiltinModule('url').fileURLToPath(module),
        ),
        original = PublishedLibrary.prototype.response;
      globalThis.restorePublishedTransport = () => {
        PublishedLibrary.prototype.response = original;
      };
      const files = new Map(objects);
      PublishedLibrary.prototype.response = async function (url, signal) {
        signal.throwIfAborted();
        const value = files.get(url);
        return new Response(value ? Buffer.from(value, 'base64') : null, {
          status: value ? 200 : 404,
        });
      };
    },
    {
      module: pathToFileURL(
        path.join(project, 'dist-electron/electron/published-library.js'),
      ).href,
      objects: [...objects],
    },
  );
  try {
    const previous = await page.evaluate(() => window.foxwatch.getRoot());
    await page
      .getByRole('button', { name: 'Download Published Assets', exact: true })
      .click();
    await page
      .getByRole('heading', { name: 'Published Assets', exact: true })
      .waitFor();
    await page
      .getByRole('button', { name: 'Check for Updates', exact: true })
      .click();
    await page.getByText('3 files', { exact: true }).waitFor();
    await page
      .getByRole('button', { name: 'Download & Open', exact: true })
      .click();
    await page
      .getByText('Download complete. The published library is open.', {
        exact: true,
      })
      .waitFor();
    const current = await page.evaluate(() => window.foxwatch.getRoot());
    assert.notEqual(current.path, previous.path);
    assert.match(current.path, /published-library/);
    await page
      .getByRole('button', { name: 'Close Published Assets', exact: true })
      .click();
    await page.getByRole('treeitem', { name: 'types', exact: true }).click();
    await page
      .getByRole('treeitem', { name: 'structures', exact: true })
      .click();
    await page.getByRole('treeitem', { name: 'factory', exact: true }).click();
    await page
      .getByRole('treeitem', { name: 'factory.glb', exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector('.asset-preview')?.getAttribute('aria-busy') ===
          'false' && !!document.querySelector('.model-viewport canvas'),
    );
    assert.equal(
      (
        await page.evaluate(async () => {
          const root = await window.foxwatch.getRoot();
          return window.foxwatch.review(root.id, 'summary');
        })
      ).approvedAt,
      null,
      'downloading does not approve assets',
    );
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()
        .items.find((item) => item.label === '&Review')
        .submenu.items.find(
          (item) => item.label === 'Approve Current Assets as Baseline',
        )
        .click(),
    );
    await page.getByText('0 Changes', { exact: true }).waitFor();
    await page
      .getByRole('button', { name: 'Download Published Assets', exact: true })
      .click();
    await page
      .getByRole('button', { name: 'Download & Open', exact: true })
      .click();
    await page
      .getByText('Download complete. The published library is open.', {
        exact: true,
      })
      .waitFor();
    const reopened = await page.evaluate(() => window.foxwatch.getRoot());
    assert.notEqual(reopened.path, current.path);
    assert.ok(
      (
        await page.evaluate(async () => {
          const root = await window.foxwatch.getRoot();
          return window.foxwatch.review(root.id, 'summary');
        })
      ).approvedAt,
      'approved baseline follows the library across downloaded snapshots',
    );
    await page
      .getByRole('button', { name: 'Close Published Assets', exact: true })
      .click();
  } finally {
    await app.evaluate(() => globalThis.restorePublishedTransport());
  }
}
