import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  nativeImage,
  Tray,
  shell,
} from 'electron';
import type { IpcMainInvokeEvent, MenuItemConstructorOptions } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MonitorService } from './monitor-service.js';
import type { AppView } from '../shared/monitor.js';
import { PublishedLibrary, type PublishedPlan } from './published-library.js';
import type { PublishedStatus } from '../shared/contracts.js';
import { AssetReview } from './asset-review.js';
import { AssetDirectory } from './asset-directory.js';
import { readAssetPreview } from './preview-file.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
let window: BrowserWindow;
let monitor: MonitorService;
let tray: Tray;
let quitting = false;
let quitWhenIdle = false;
let notifyTimer: ReturnType<typeof setTimeout> | undefined;
const showWindow = () => { window.show(); if (window.isMinimized()) window.restore(); window.focus(); };
const navigate = (view: AppView) => { showWindow(); window.webContents.send('app:view', view); };
function loginSettings(enabled: boolean) {
  if (process.platform !== 'win32') return;
  app.setLoginItemSettings({ openAtLogin: enabled, name: 'Nixie FoxWatch Monitor', path: process.execPath,
    args: app.isPackaged ? ['--background'] : [path.resolve(here, '../..'), '--background'] });
}
function monitorChanged() {
  if (!monitor || !window || window.isDestroyed()) return;
  if (quitWhenIdle && !monitor.controller.status.running) { quitting = true; app.quit(); return; }
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = undefined;
    if (window.isDestroyed()) return;
    const status = monitor.controller.status;
    window.webContents.send('monitor:status', status);
    window.setProgressBar(status.running ? (status.percent ? status.percent / 100 : 2) : -1);
    tray?.setToolTip(`FoxWatch — ${status.stage}${status.running ? ' · ' + Math.round(status.percent) + '%' : ''}`);
    updateTray();
  }, 200);
}
function updateTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open FoxWatch', click: showWindow },
    { label: 'Dashboard', click: () => navigate('dashboard') },
    { label: monitor.controller.status.polling ? 'Pause Polling' : 'Start Polling',
      click: () => void report(() => monitor.action(monitor.controller.status.polling ? 'pause' : 'start')) },
    { label: 'Settings…', click: () => navigate('settings') },
    { type: 'separator' }, { label: 'Quit FoxWatch', click: () => app.quit() },
  ]));
}
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
  monitor = new MonitorService(repo, app.getPath('userData'), monitorChanged);
  await monitor.initialize();
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
  window.on('ready-to-show', () => {
    if (!process.argv.includes('--background') || !monitor.settings.startMinimized) window.show();
  });
  window.on('close', event => { if (!quitting) { event.preventDefault(); window.hide(); } });
  // A real native tray icon keeps the controller reachable with every window hidden.
  const pixels = Buffer.alloc(32 * 32 * 4);
  for (let y = 3; y < 29; y++) for (let x = 3; x < 29; x++) {
    const offset = (y * 32 + x) * 4;
    const glyph = (x >= 9 && x <= 12 && y >= 8 && y <= 24) || (x >= 9 && x <= 23 && y >= 8 && y <= 11) || (x >= 9 && x <= 20 && y >= 15 && y <= 18);
    pixels[offset] = glyph ? 232 : 77; pixels[offset + 1] = glyph ? 244 : 112;
    pixels[offset + 2] = glyph ? 241 : 92; pixels[offset + 3] = 255;
  }
  const icon = nativeImage.createFromBitmap(pixels, { width: 32, height: 32, scaleFactor: 1 });
  tray = new Tray(icon);
  tray.setToolTip('FoxWatch');
  tray.on('double-click', showWindow);
  tray.on('click', showWindow);
  updateTray();
  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('before-quit', event => {
    if (quitting) return;
    if (monitor.controller.status.running) {
      event.preventDefault();
      if (!quitWhenIdle) void dialog.showMessageBox(window, { type: 'question', buttons: ['Keep Running', 'Quit After Run'], defaultId: 0,
        message: 'FoxWatch is still working.', detail: 'Quit after the active run finishes? Closing the window keeps FoxWatch running in the tray.' }).then(result => {
          if (result.response === 1) { quitWhenIdle = true; monitor.stopScheduling(); monitorChanged(); }
        });
    } else quitting = true;
  });
  app.on('will-quit', () => { publishedAbort?.abort(new Error('FoxWatch is closing.')); monitor.dispose(); clearTimeout(notifyTimer); tray.destroy(); });
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
    { label: '&Run', submenu: [
      { label: 'Start Polling', click: () => void report(() => monitor.action('start')) },
      { label: 'Pause Polling', click: () => void report(() => monitor.action('pause')) },
      { label: 'Refresh Latest Build', click: () => void report(() => monitor.action('refresh')) },
      { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => navigate('settings') },
    ] },
    { label: '&Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    {
      label: '&View',
      submenu: [
        { label: 'Asset Inspector', accelerator: 'CmdOrCtrl+1', click: () => navigate('inspector') },
        { label: 'Dashboard', accelerator: 'CmdOrCtrl+2', click: () => navigate('dashboard') },
        { label: 'Workers & Logs', accelerator: 'CmdOrCtrl+3', click: () => navigate('workers') },
        { type: 'separator' },
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
                'FoxWatch · 0.1.0\nSteam build monitoring, asset generation, inspection, and publishing.',
            }),
        },
      ],
    },
  ];
  if (process.platform === 'darwin') menu.unshift({ role: 'appMenu' });
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  ipcMain.handle('monitor:status', event => { authorize(event); return monitor.controller.status; });
  ipcMain.handle('monitor:info', event => { authorize(event); return monitor.info(); });
  ipcMain.handle('monitor:save', async (event, value) => {
    authorize(event);
    if (value?.startWithWindows !== monitor.settings.startWithWindows && await monitor.legacyRunning()) throw new Error('Retire the legacy monitor before enabling Windows startup.');
    const startupChanged = value?.startWithWindows !== monitor.settings.startWithWindows;
    await monitor.save(value); if (startupChanged) loginSettings(value.startWithWindows); return monitor.info();
  });
  ipcMain.handle('monitor:credentials', async (event, value) => { authorize(event); await monitor.credentials(value); return monitor.info(); });
  ipcMain.handle('monitor:action', async (event, action) => {
    authorize(event);
    if (action === 'logs' || action === 'output') {
      const target = action === 'logs' ? path.join(repo, 'tools/foxwatch/local/logs') : path.resolve(repo, monitor.settings.outputRoot);
      await mkdir(target, { recursive: true }); const error = await shell.openPath(target); if (error) throw new Error(error); return;
    }
    if (!['start','pause','cancel','poll','refresh','clear-cache','prepare','check','publish','retire'].includes(action)) throw new Error('Invalid FoxWatch action.');
    if (['cancel','clear-cache','publish','retire'].includes(action)) {
      const messages: Record<string, [string,string]> = {
        cancel: ['Cancel the active run?', 'This stops the process tree and pauses polling. Generated outputs already written are retained.'],
        'clear-cache': ['Clear generation caches?', 'Steam installations, settings, logs, rendered outputs, and published assets are preserved.'],
        publish: ['Publish the prepared asset release?', 'This uploads the prepared snapshot and updates the public stable channel after verification. It does not approve a local baseline or update the extension build pin.'],
        retire: ['Retire the legacy monitor?', 'Ask it to finish active work and exit, then remove its old Windows startup entry. Enable Windows startup here to replace it.'],
      };
      const [message, detail] = messages[action]!;
      const result = await dialog.showMessageBox(window, { type: 'question', message, detail, buttons: ['Cancel', 'Continue'], defaultId: 0, cancelId: 0 });
      if (result.response !== 1) return;
    }
    await monitor.action(action);
  });
  monitor.startTimer();
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
  ipcMain.handle('assets:comparison', async (event, id: unknown, relative: unknown) => {
    authorize(event);
    const logical = relativePath(relative);
    const pair = await currentReview(id).comparison(logical);
    const preview = async (asset: import('../shared/contracts.js').AssetDetails | null) => {
      if (!asset) return null;
      try { return { asset, preview: await readAssetPreview(asset.absolutePath, logical, 8 * 1024 * 1024) }; }
      catch (cause) { return { asset, preview: { type: 'unsupported', message: cause instanceof Error ? cause.message : String(cause) } }; }
    };
    const [before, after] = await Promise.all([preview(pair.before), preview(pair.after)]);
    return { approvedAt: pair.approvedAt, before, after };
  });
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
  // Window close hides to tray; only an explicit Quit ends background polling.
}
if (!app.requestSingleInstanceLock()) app.quit();
else void launch().catch((error) => {
  console.error(error);
  dialog.showErrorBox(
    'FoxWatch Could Not Start',
    error instanceof Error ? error.message : String(error),
  );
  app.exit(1);
});
