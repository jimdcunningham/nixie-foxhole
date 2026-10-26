import assert from 'node:assert/strict';

export async function checkMonitor(app, page) {
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await page.getByRole('heading', { name: 'Dashboard', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Start Polling', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Steam Username', { exact: true }).waitFor();
  assert.equal(await page.getByLabel(/Steam Password/).inputValue(), '');
  assert.equal(await page.getByLabel(/R2 Secret Access Key/).inputValue(), '');
  // Exercise the real settings IPC without changing OS startup or shared config.
  const initialSettings = await page.evaluate(async () => (await window.foxwatch.monitor.info()).settings);
  await app.evaluate(({app}) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json');
    const {MonitorService} = require('./dist-electron/electron/monitor-service.js');
    const originalSave = MonitorService.prototype.save, originalLogin = app.setLoginItemSettings;
    app.__startupCalls = [];
    app.setLoginItemSettings = options => { app.__startupCalls.push(options); };
    MonitorService.prototype.save = async function(value) { this.settings = {...value}; };
    app.__restoreStartupCheck = () => { MonitorService.prototype.save = originalSave; app.setLoginItemSettings = originalLogin; delete app.__startupCalls; delete app.__restoreStartupCheck; };
  });
  try {
    await page.getByLabel('Start With Windows', {exact:true}).check();
    await page.getByLabel('Start Minimized at Login', {exact:true}).check();
    for (let count = 1; count <= 2; count++) {
      await page.getByRole('button', {name:'Save Settings',exact:true}).click();
      await page.waitForFunction(() => document.querySelector('.tool-notice[role=status]')?.textContent === 'Settings saved.');
      const calls = await app.evaluate(({app}) => app.__startupCalls);
      assert.equal(calls.length,count);
      assert.equal(calls.at(-1).openAtLogin,true);
      assert.equal(calls.at(-1).name,'Nixie FoxWatch Monitor');
      assert.equal(calls.at(-1).args.at(-1),'--background');
      const runtime = await app.evaluate(({app}) => ({ packaged: app.isPackaged, executable: process.execPath }));
      assert.equal(calls.at(-1).path, runtime.executable);
      assert.equal(calls.at(-1).args.length, runtime.packaged ? 1 : 2);
    }
  } finally {
    // The mocked save restores only the isolated controller's in-memory settings.
    await page.evaluate(settings => window.foxwatch.monitor.save(settings), initialSettings);
    await app.evaluate(({app}) => app.__restoreStartupCheck());
  }

  await app.evaluate(({ Menu }) => {
    Menu.getApplicationMenu().items.find(item => item.label === '&Run').submenu.items.find(item => item.label === 'Settings…').click();
  });
  await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('monitor:status', {
      running: true, polling: true, operation: 'refresh', stage: 'Rendering', detail: 'Rendering hospital', percent: 61,
      startedAt: Date.now() - 90000, finishedAt: null, nextPollAt: null, rendered: 20, renderTotal: 100, exported: 7, exportTotal: 10,
      workers: [{ type: 'Blender', id: '1', detail: 'Hospital', completed: 2, total: 10 }], logs: ['Fake worker output — no real generation'],
    });
  });
  await page.getByRole('button', { name: 'Workers & Logs', exact: true }).click();
  await page.getByRole('cell', { name: 'Hospital', exact: true }).waitFor();
  assert.match(await page.locator('.run-output').innerText(), /no real generation/);
  await page.getByRole('button', { name: 'Assets', exact: true }).click();
  assert.equal(await page.locator('.run-strip progress').getAttribute('value'), '61');
  assert.equal(await page.locator('.file-heading h1').innerText(), 'hospital.glb');
  const hidden = await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.close(); return { visible: window.isVisible(), destroyed: window.isDestroyed() }; });
  assert.deepEqual(hidden, { visible: false, destroyed: false });
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].show(); });
  // Restore real controller state; synthetic UI progress never starts the runner.
  const status = await page.evaluate(() => window.foxwatch.monitor.status());
  await app.evaluate(({ BrowserWindow }, status) => BrowserWindow.getAllWindows()[0].webContents.send('monitor:status', status), status);
}
