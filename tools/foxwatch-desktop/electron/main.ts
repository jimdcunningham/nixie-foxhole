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
import { AssetDirectory } from './asset-directory.js';
import { readAssetPreview } from './preview-file.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
let window: BrowserWindow;
let directory: AssetDirectory | null = null;
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
  directory = opened;
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

async function launch() {
  await app.whenReady();
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
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
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
    return source(id).list(relativePath(relative));
  });
  ipcMain.handle(
    'assets:preview',
    async (event, id: unknown, relative: unknown) => {
      authorize(event);
      const logical = relativePath(relative);
      return readAssetPreview(await source(id).resolve(logical), logical);
    },
  );
  ipcMain.handle('assets:inspect', (event, id: unknown, relative: unknown) => {
    authorize(event);
    return source(id).inspect(relativePath(relative));
  });
  ipcMain.handle(
    'assets:reveal',
    async (event, id: unknown, relative: unknown) => {
      authorize(event);
      shell.showItemInFolder(await source(id).resolve(relativePath(relative)));
    },
  );
  ipcMain.handle(
    'assets:context',
    async (event, id: unknown, relative: unknown) => {
      authorize(event);
      const current = source(id);
      const target = await current.resolve(relativePath(relative));
      const info = await import('node:fs/promises').then((fs) =>
        fs.stat(target),
      );
      const context: MenuItemConstructorOptions[] = [
        ...(info.isDirectory()
          ? [
              {
                label: 'Open in Windows Explorer',
                click: () =>
                  void report(async () => {
                    const error = await shell.openPath(target);
                    if (error) throw new Error(error);
                  }),
              },
            ]
          : []),
        {
          label: 'Reveal in Windows Explorer',
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
