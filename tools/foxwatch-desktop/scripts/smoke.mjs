import { _electron as electron } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { triangleGlb, whitePng } from '../tests/preview-fixtures.mjs';
const require = createRequire(import.meta.url);
const project = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const base = await mkdtemp(path.join(os.tmpdir(), 'foxwatch-desktop-smoke-'));
const root = path.join(base, 'assets');
await mkdir(path.join(root, 'structures/hospital'), { recursive: true });
await writeFile(
  path.join(root, 'structures/hospital/hospital.glb'),
  triangleGlb(),
);
await writeFile(
  path.join(root, 'structures/hospital/hospital.preview.webp'),
  whitePng(),
);
await mkdir(path.join(root, 'many'));
for (let start = 0; start < 1200; start += 100)
  await Promise.all(
    Array.from({ length: 100 }, (_, index) =>
      writeFile(
        path.join(
          root,
          'many',
          `asset-${String(start + index).padStart(4, '0')}.json`,
        ),
        '{}',
      ),
    ),
  );
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  executablePath: require('electron'),
  args: [
    project,
    '--assets',
    root,
    '--user-data-dir=' + path.join(base, 'profile'),
  ],
  env,
  timeout: 30000,
});
const errors = [];
let page;
try {
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.getByRole('treeitem', { name: 'structures', exact: true }).click();
  await page.getByRole('treeitem', { name: 'hospital', exact: true }).click();
  await page
    .getByRole('treeitem', { name: 'hospital.glb', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'hospital.glb', exact: true })
    .waitFor();
  await page.locator('.model-viewport canvas').waitFor();
  await page.locator('.model-message').waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('.file-heading h1').innerText(),
    'hospital.glb',
  );
  const modelCanvas = page.locator('.model-viewport canvas');
  const originalView = await modelCanvas.screenshot();
  const bounds = await modelCanvas.boundingBox();
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width / 2 + 80,
    bounds.y + bounds.height / 2 + 20,
    { steps: 8 },
  );
  await page.mouse.up();
  assert.notDeepEqual(await modelCanvas.screenshot(), originalView);
  await page.getByRole('button', { name: 'Reset View', exact: true }).click();
  await page.getByRole('tree').focus();
  await page.keyboard.press('ArrowDown');
  await page
    .getByRole('heading', { name: 'hospital.preview.webp', exact: true })
    .waitFor();
  await page.keyboard.press('ArrowUp');
  await page
    .getByRole('heading', { name: 'hospital.glb', exact: true })
    .waitFor();
  const isolation = await page.evaluate(() => ({
    node: typeof window.require,
    bridge: typeof window.foxwatch.list,
  }));
  assert.deepEqual(isolation, { node: 'undefined', bridge: 'function' });
  const nativeMenus = await app.evaluate(({ Menu }) =>
    Menu.getApplicationMenu().items.map((item) => item.label),
  );
  assert.deepEqual(nativeMenus, ['&File', '&Edit', '&View', '&Help']);
  await app.evaluate(({ Menu, shell }) => {
    globalThis.contexts = [];
    globalThis.explorer = [];
    shell.showItemInFolder = (target) =>
      globalThis.explorer.push(['reveal', target]);
    shell.openPath = async (target) => {
      globalThis.explorer.push(['open', target]);
      return '';
    };
    Menu.prototype.popup = function (options) {
      globalThis.contexts.push(this.items.map((item) => item.label));
      this.items[0].click();
      options.callback?.();
    };
  });
  await page
    .getByRole('treeitem', { name: 'hospital.glb', exact: true })
    .click({ button: 'right' });
  await page.waitForTimeout(100);
  await page
    .getByRole('treeitem', { name: 'hospital', exact: true })
    .click({ button: 'right' });
  await page.waitForTimeout(100);
  const contexts = await app.evaluate(() => ({
    menus: globalThis.contexts,
    targets: globalThis.explorer,
  }));
  assert.deepEqual(contexts.menus, [
    ['Reveal in Windows Explorer'],
    ['Open in Windows Explorer', 'Reveal in Windows Explorer'],
  ]);
  assert.deepEqual(contexts.targets, [
    ['reveal', path.join(root, 'structures/hospital/hospital.glb')],
    ['open', path.join(root, 'structures/hospital')],
  ]);
  await writeFile(
    path.join(root, 'structures/hospital/hospital.texture.json'),
    '{}',
  );
  await page
    .getByRole('button', { name: 'Refresh Assets', exact: true })
    .click();
  await page
    .getByRole('treeitem', { name: 'hospital.texture.json', exact: true })
    .waitFor();
  await page
    .getByRole('treeitem', { name: 'hospital.preview.webp', exact: true })
    .click();
  await page
    .getByRole('img', { name: 'hospital.preview.webp', exact: true })
    .waitFor();
  await page.getByText('16 × 16', { exact: true }).waitFor();
  await page
    .getByRole('button', { name: 'Show in Explorer', exact: true })
    .click();
  assert.deepEqual(await app.evaluate(() => globalThis.explorer.at(-1)), [
    'reveal',
    path.join(root, 'structures/hospital/hospital.preview.webp'),
  ]);
  await page
    .getByRole('button', { name: 'Collapse Folders', exact: true })
    .click();
  await page.getByRole('treeitem', { name: 'many', exact: true }).click();
  assert.ok((await page.getByRole('treeitem').count()) < 70);
  await page.getByRole('tree').focus();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'asset-1199.json' }).waitFor();
  assert.ok((await page.getByRole('treeitem').count()) < 70);
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(800, 560),
  );

  await page.getByLabel('File Contents').waitFor();
  assert.equal(
    (await page.getByLabel('File Contents').innerText()).trim(),
    '{}',
  );
  const escaped = await page.evaluate(async () => {
    const root = await window.foxwatch.getRoot();
    try {
      await window.foxwatch.inspect(root.id, '../outside.txt');
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(escaped, true);
  const profile = await app.evaluate(({ app }) => app.getPath('userData'));
  assert.equal(profile, path.join(base, 'profile'));
  const before = await page.evaluate(() => window.foxwatch.getRoot());
  await app.evaluate(({ dialog }) => {
    dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
  });
  await page
    .getByRole('button', { name: 'Open Assets Directory', exact: true })
    .click();
  assert.equal(
    (await page.evaluate(() => window.foxwatch.getRoot())).id,
    before.id,
  );
  const alternate = path.join(base, 'alternate');
  await mkdir(alternate);
  await writeFile(path.join(alternate, 'second.glb'), triangleGlb());
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, alternate);
  await page
    .getByRole('button', { name: 'Open Assets Directory', exact: true })
    .click();
  await page
    .getByRole('treeitem', { name: 'second.glb', exact: true })
    .waitFor();
  const stale = await page.evaluate(async (id) => {
    try {
      await window.foxwatch.list(id, '');
      return false;
    } catch {
      return true;
    }
  }, before.id);
  assert.equal(stale, true);
  await page.getByRole('treeitem', { name: 'second.glb', exact: true }).click();
  await page
    .getByRole('heading', { name: 'second.glb', exact: true })
    .waitFor();
  const settings = JSON.parse(
    await (
      await import('node:fs/promises')
    ).readFile(path.join(profile, 'inspector.json'), 'utf8'),
  );
  assert.equal(settings.assetsDirectory, alternate);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      checks: [
        'native menus',
        'sandboxed bridge',
        'lazy folder expansion',
        'single-click selection',
        'native Explorer context menus and targets',
        'refresh',
        'image and GLB previews',
        'virtualized 1200-file folder',
        'keyboard navigation',
        'narrow window',
        'IPC path boundary',
        'direct Explorer reveal',
        'cancelled folder picker',
        'switch directory',
        'stale root rejection',
        'persisted directory',
      ],
      errors,
    }),
  );
} catch (cause) {
  console.error(
    JSON.stringify({
      errors,
      screen: await page
        ?.locator('body')
        .innerText()
        .catch(() => ''),
    }),
  );
  throw cause;
} finally {
  await app.close();
  await rm(base, { recursive: true, force: true });
}
