import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer({
  server: { host: '127.0.0.1', port: 5187, strictPort: false },
});
await server.listen();
const url = server.resolvedUrls.local[0];
const env = { ...process.env, FOXWATCH_DESKTOP_DEV_URL: url };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  windowsHide: false,
});
const close = async () => {
  await server.close();
};
child.on('error', async (error) => {
  console.error(error);
  await close();
  process.exitCode = 1;
});
child.on('exit', async (code) => {
  await close();
  process.exitCode = code ?? 0;
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    child.kill();
    void close();
  });
