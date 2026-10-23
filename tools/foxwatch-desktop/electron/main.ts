import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
} from 'electron';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublishedLibrary, type PublishedPlan } from './published-library.js';
import type { PublishedStatus } from '../shared/contracts.js';
import { AssetReview } from './asset-review.js';
import { AssetDirectory } from './asset-directory.js';
import { readAssetPreview } from './preview-file.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
let window: BrowserWindow;
let directory: AssetDirectory | null = null;
let review: AssetReview | null = null;
let reviewRunning = false;
let library: PublishedLibrary;
let publishedPlan: PublishedPlan | null = null;
let publishedAbort: AbortController | null = null;
let publishedStatus: PublishedStatus = {
  phase: 'idle',
  current: null,
  candidate: null,
  completed: 0,
  reused: 0,
  message: '',
};
const publishStatus = () => {
  if (window && !window.isDestroyed())
    window.webContents.send('published:progress', publishedStatus);
};
const devUrl = process.env.FOXWATCH_DESKTOP_DEV_URL;
const pageUrl = new URL(
  devUrl ?? new URL('../../dist/index.html', import.meta.url).href,
).href;

function authorize(event: IpcMainInvokeEvent) {
  if (
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== pageUrl
  )
    throw new Error('Unknown inspector window.');
}
function source(id: unknown): AssetDirectory {
  if (!directory || id !== directory.root.id)
    throw new Error(
      'The open assets directory changed. Refresh the inspector.',
    );
  return directory;
}
function relativePath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32768)
    throw new Error('Invalid asset path.');
  return value;
}
function currentReview(id: unknown) {
  source(id);
  if (!review) throw new Error('No review directory is open.');
  return review;
}
async function openDirectory(target: string, persist = false) {
  const opened = await AssetDirectory.open(target);
  if (persist) {
    const settings = path.join(app.getPath('userData'), 'inspector.json');
    await mkdir(path.dirname(settings), { recursive: true });
    await writeFile(
      settings + '.tmp',
      JSON.stringify({ assetsDirectory: opened.root.path }),
    );
    await rename(settings + '.tmp', settings);
  }
  let reviewIdentity: string | undefined;
  const libraryRoot = path.join(app.getPath('userData'), 'published-library');
  const fromLibrary = path.relative(libraryRoot, opened.root.path);
  if (
    fromLibrary &&
    !fromLibrary.startsWith('..') &&
    !path.isAbsolute(fromLibrary)
  ) {
    const metadata = JSON.parse(
      await readFile(
        path.join(opened.root.path, '.foxwatch-published.json'),
        'utf8',
      ),
    );
    reviewIdentity = 'published:' + library.baseUrl + ':' + metadata.scope;
  }
  const openedReview = await AssetReview.open(
    opened,
    path.join(app.getPath('userData'), 'baselines'),
    reviewIdentity,
  );
  directory = opened;
  review = openedReview;
  window?.setTitle(`FoxWatch — ${opened.root.path}`);
  window?.webContents.send('assets:changed', opened.root);
  return opened.root;
}
async function chooseDirectory() {
  const result = await dialog.showOpenDialog(window, {
    title: 'Open Assets Directory',
    defaultPath: directory?.root.path,
    properties: ['openDirectory'],
    buttonLabel: 'Open Assets',
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return openDirectory(result.filePaths[0], true);
}
async function report(task: () => Promise<unknown>) {
  try {
    await task();
  } catch (error) {
    dialog.showErrorBox(
      'FoxWatch',
      error instanceof Error ? error.message : 'The operation failed.',
    );
  }
}

async function handlePublishedAction(action: unknown, scope: unknown) {
  if (scope !== 'all' && scope !== 'catalog')
    throw new Error('Invalid library scope.');
  if (action === 'info') return publishedStatus;
  if (action === 'cancel') {
    publishedAbort?.abort(new Error('Download cancelled.'));
    return publishedStatus;
  }
  if (action === 'open') {
    const current = await library.current();
    if (!current) throw new Error('Download a published library first.');
    await openDirectory(current.assetsPath, true);
    return publishedStatus;
  }
  if (action !== 'check' && action !== 'download')
    throw new Error('Invalid published-library action.');
  if (publishedAbort)
    throw new Error('A library operation is already running.');
  const controller = new AbortController();
  publishedAbort = controller;
  try {
    if (action === 'check') {
      publishedPlan = null;
      publishedStatus = {
        ...publishedStatus,
        phase: 'checking',
        candidate: null,
        message: 'Checking published assets…',
      };
      publishStatus();
      const plan = await library.check(scope, controller.signal, (message) => {
        publishedStatus.message = message;
        publishStatus();
      });
      publishedPlan = plan;
      publishedStatus = {
        ...publishedStatus,
        phase: 'ready',
        candidate: {
          release: plan.release,
          source: plan.source,
          scope: plan.scope,
          files: plan.files.length,
          bytes: plan.bytes,
          baseUrl: plan.baseUrl,
        },
        message:
          'Ready to download. Existing local and generated files will be kept.',
      };
    } else {
      if (!publishedPlan || publishedPlan.scope !== scope)
        throw new Error('Check for updates before downloading.');
      publishedStatus = {
        ...publishedStatus,
        phase: 'downloading',
        completed: 0,
        reused: 0,
        message: 'Downloading and verifying assets…',
      };
      publishStatus();
      const info = await library.download(
        publishedPlan,
        controller.signal,
        (progress) => {
          publishedStatus.completed = progress.completed;
          publishedStatus.reused = progress.reused;
          publishedStatus.message = `${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()} files · ${progress.reused.toLocaleString()} reused`;
          if (
            progress.completed % 10 === 0 ||
            progress.completed === progress.total
          )
            publishStatus();
        },
      );
      await openDirectory(info.assetsPath, true);
      publishedStatus = {
        ...publishedStatus,
        phase: 'complete',
        current: info,
        message: 'Download complete. The published library is open.',
      };
    }
    publishStatus();
    return publishedStatus;
  } catch (cause) {
    publishedStatus = {
      ...publishedStatus,
      phase: 'error',
      message: cause instanceof Error ? cause.message : String(cause),
    };
    publishStatus();
    throw cause;
  } finally {
    publishedAbort = null;
  }
}

async function launch() {
  await app.whenReady();
  const bundled = JSON.parse(
    await readFile(path.join(here, '../shared/release-pin.json'), 'utf8'),
  );
  library = new PublishedLibrary({
    root: path.join(app.getPath('userData'), 'published-library'),
    pin: bundled.publication,
    channelUrl: new URL(
      'channels/stable.json',
      new URL('.', bundled.publication.url),
    ).href,
  });
  publishedStatus.current = await library.current();
  app.on('before-quit', () =>
    publishedAbort?.abort(new Error('FoxWatch is closing.')),
  );
  nativeTheme.themeSource = 'dark';
  window = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 760,
    minHeight: 480,
    title: 'FoxWatch',
    backgroundColor: '#191b20',
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.on('ready-to-show', () => window.show());
  const menu: MenuItemConstructorOptions[] = [
    {
      label: '&File',
      submenu: [
        {
          label: 'Open Assets Directory…',
          accelerator: 'CmdOrCtrl+O',
          click: () => void report(chooseDirectory),
        },
        {
          label: 'Download Published Assets…',
          click: () => window.webContents.send('published:open'),
        },
        {
          label: 'Open Downloaded Assets',
          click: () =>
            void report(async () => {
              const current = await library.current();
              if (!current)
                throw new Error('Download a published library first.');
              await openDirectory(current.assetsPath, true);
            }),
        },
        {
          label: 'Open Generated Assets',
          click: () =>
            void report(() =>
              openDirectory(
                path.join(
                  repo,
                  'packages/extensions/foxhole/public/foxhole/assets',
                ),
                true,
              ),
            ),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '&Review',
      submenu: [
        {
          label: 'Compare With Approved Baseline',
          click: () => window.webContents.send('review:run', 'compare'),
        },
        {
          label: 'Approve Current Assets as Baseline',
          click: () => window.webContents.send('review:run', 'approve'),
        },
      ],
    },
    { label: '&Edit', submenu: [{ role: 'copy' }, { role: 'selectAll' }] },
    {
      label: '&View',
      submenu: [
        {
          label: 'Refresh Assets',
          accelerator: 'CmdOrCtrl+R',
          click: () => window.webContents.send('assets:refresh'),
        },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+B',
          click: () => window.webContents.send('assets:sidebar'),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: '&Help',
      submenu: [
        {
          label: 'About FoxWatch',
          click: () =>
            void dialog.showMessageBox(window, {
              type: 'info',
              title: 'About FoxWatch',
              message: 'FoxWatch',
              detail:
                'Asset Inspector · 0.1.0\nRead-only inspection of local generated assets.',
            }),
        },
      ],
    },
  ];
  if (process.platform === 'darwin') menu.unshift({ role: 'appMenu' });
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  ipcMain.handle(
    'assets:review',
    async (event, id: unknown, action: unknown) => {
      authorize(event);
      const current = currentReview(id);
      if (action === 'summary') return current.summary();
      if (action !== 'approve' && action !== 'compare')
        throw new Error('Invalid review action.');
      if (reviewRunning) throw new Error('An asset review is already running.');
      reviewRunning = true;
      try {
        return await current[action]((phase, completed, total) => {
          if (
            (completed % 25 === 0 || completed === total) &&
            directory?.root.id === id
          )
            window.webContents.send('review:progress', {
              phase,
              completed,
              total,
            });
        });
      } finally {
        reviewRunning = false;
      }
    },
  );
  ipcMain.handle(
    'published:action',
    (event, action: unknown, scope: unknown) => {
      authorize(event);
      return handlePublishedAction(action, scope);
    },
  );
  ipcMain.handle('assets:root', (event) => {
    authorize(event);
    return directory?.root ?? null;
  });
  ipcMain.handle('assets:choose', (event) => {
    authorize(event);
    return chooseDirectory();
  });
  ipcMain.handle('assets:list', (event, id: unknown, relative: unknown) => {
    authorize(event);
    return currentReview(id).list(relativePath(relative));
  });
  ipcMain.handle(
    'assets:preview',
    async (event, id: unknown, relative: unknown) => {
      authorize(event);
      const logical = relativePath(relative);
      return readAssetPreview(
        await currentReview(id).resolve(logical),
        logical,
      );
    },
  );
  ipcMain.handle('assets:inspect', (event, id: unknown, relative: unknown) => {
    authorize(event);
    return currentReview(id).inspect(relativePath(relative));
  });
  ipcMain.handle(
    'assets:reveal',
    async (event, id: unknown, relative: unknown) => {
      authorize(event);
      shell.showItemInFolder(
        await currentReview(id).resolve(relativePath(relative)),
      );
    },
  );
  ipcMain.handle(
    'assets:context',
    async (event, id: unknown, relative: unknown) => {
      authorize(event);
      const current = currentReview(id);
      const target = await current.resolve(relativePath(relative));
      const info = await import('node:fs/promises').then((fs) =>
        fs.stat(target),
      );
      const context: MenuItemConstructorOptions[] = [
        ...(info.isDirectory()
          ? [
              {
                label:
                  process.platform === 'darwin'
                    ? 'Open in Finder'
                    : process.platform === 'win32'
                      ? 'Open in Windows Explorer'
                      : 'Open in File Manager',
                click: () =>
                  void report(async () => {
                    const error = await shell.openPath(target);
                    if (error) throw new Error(error);
                  }),
              },
            ]
          : []),
        {
          label:
            process.platform === 'darwin'
              ? 'Reveal in Finder'
              : process.platform === 'win32'
                ? 'Reveal in Windows Explorer'
                : 'Reveal in File Manager',
          click: () => shell.showItemInFolder(target),
        },
      ];
      await new Promise<void>((resolve) =>
        Menu.buildFromTemplate(context).popup({ window, callback: resolve }),
      );
    },
  );
  const explicit = process.argv.indexOf('--assets');
  let initial = explicit >= 0 ? process.argv[explicit + 1] : undefined;
  if (!initial) {
    try {
      initial = JSON.parse(
        await readFile(
          path.join(app.getPath('userData'), 'inspector.json'),
          'utf8',
        ),
      ).assetsDirectory;
    } catch {
      /* First launch. */
    }
  }
  try {
    await openDirectory(
      initial ??
        path.join(repo, 'packages/extensions/foxhole/public/foxhole/assets'),
    );
  } catch {
    /* The folder picker stays available if assets are absent. */
  }
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(path.resolve(here, '../../dist/index.html'));
  app.on('window-all-closed', () => app.quit());
}
void launch().catch((error) => {
  console.error(error);
  dialog.showErrorBox(
    'FoxWatch Could Not Start',
    error instanceof Error ? error.message : String(error),
  );
  app.exit(1);
});
