import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function checkBackground(electron, executablePath, project, base, env) {
  const profile = path.join(base, 'background-profile');
  await mkdir(profile, { recursive: true });
  await writeFile(path.join(profile, 'monitor.json'), JSON.stringify({ startMinimized: true, polling: false }));
  const app = await electron.launch({ executablePath, args: [project, '--background', '--user-data-dir=' + profile], env });
  try {
    const page = await app.firstWindow();
    await page.getByRole('tree').waitFor();
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    await promisify(execFile)(executablePath, [project, '--user-data-dir=' + profile], { env, windowsHide: true, timeout: 15000 });
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), true);
  } finally { await app.close(); }
}
