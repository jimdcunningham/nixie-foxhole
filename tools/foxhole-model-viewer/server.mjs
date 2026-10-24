import { studioRoot, hostRequire } from './host-paths.mjs';
import { pathToFileURL } from 'node:url';
const { createServer } = await import(pathToFileURL(hostRequire.resolve('vite')).href);
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const repositoryRoot = studioRoot;
async function serveComparisonAssets(req, res, next) {
    try {
        if (req.url === '/measurements.json') {
            const batch = JSON.parse(await readFile(resolve(repositoryRoot, 'artifacts/facility-spatial-policy/batch/results.json')));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ review: batch.review, control: batch.control, blockedAssets: batch.blockedAssets }));
            return;
        }
        const reviewMatch = /^\/models\/(review|control)\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.(exportdefault|lossless)\.glb$/.exec(req.url ?? '');
        if (reviewMatch) {
            const batch = JSON.parse(await readFile(resolve(repositoryRoot, 'artifacts/facility-spatial-policy/batch/results.json')));
            const row = batch[reviewMatch[1]].rows.find(row => row.id === reviewMatch[2] && row.profile === reviewMatch[3]);
            if (!row) { res.statusCode = 404; res.end('Model is outside the review dataset'); return; }
            const directory = reviewMatch[1] === 'review' ? 'packages/extensions/foxhole/public/foxhole/assets' : 'artifacts/facility-spatial-policy/batch/control';
            const bytes = await readFile(resolve(repositoryRoot, directory, row.path));
            res.setHeader('Content-Type', 'model/gltf-binary');
            res.setHeader('Content-Length', bytes.length);
            res.end(bytes);
            return;
        }
        next();
    } catch (error) {
        res.statusCode = 500;
        res.end(error.message);
    }
}
const server = await createServer({
    configFile: false,
    root: import.meta.dirname,
    server: { host: '127.0.0.1', port: 4187, strictPort: true, fs: { allow: [repositoryRoot, resolve(import.meta.dirname, '../..')] } },
    resolve: { alias: [
        { find: '#nixie-host', replacement: resolve(studioRoot, 'packages/nixie') },
        { find: '../../extensions/foxhole-planner', replacement: resolve(import.meta.dirname, '../../extensions/foxhole-planner') },
        { find: /^pixi\.js(.*)$/, replacement: resolve(studioRoot, 'node_modules/pixi.js') + '$1' },
        { find: '@nixiejs/extension-sdk/experimental/scene-v2', replacement: resolve(studioRoot, 'packages/extension-sdk/dist/experimental/scene-v2.js') },
        { find: '@nixiejs/extension-sdk', replacement: resolve(studioRoot, 'packages/extension-sdk/dist/index.js') },
        { find: '@pixi/3d', replacement: resolve(studioRoot, 'node_modules/@pixi/3d') },
    ] },
    optimizeDeps: { include: ['pixi.js', 'pixi.js/unsafe-eval', '@pixi/3d'] },
    plugins: [{ name: 'comparison-assets', configureServer(vite) {
        vite.middlewares.use(serveComparisonAssets);
    } }],
});
await server.listen();
console.info('GLB comparison viewer: http://127.0.0.1:4187');
