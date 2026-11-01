import { spawn } from 'node:child_process';
import { readdir, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const planner = join(root, 'extensions/foxhole-planner');
const [command, ...flags] = process.argv.slice(2);
const npmCli = process.env.npm_execpath;
const catalog = join(root, 'packages/extensions/foxhole/public/foxhole/assets/catalog.v1.json');
const env = {...process.env};
// Contributor checks use the checked-in release pin and the public fixture location.
for (const name of ['NIXIE_FOXHOLE_CATALOG_FILE', 'NIXIE_FOXHOLE_CATALOG_PIN_FILE', 'NIXIE_FOXHOLE_ASSETS_ROOT']) {
    delete env[name];
}

async function run(executable, args, cwd = root) {
    await new Promise((accept, reject) => {
        const child = spawn(executable, args, {cwd, env, stdio: 'inherit', windowsHide: true});
        child.once('error', reject);
        child.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(args.join(' ') + ' failed (' + (signal ?? code) + ').')));
    });
}
async function npm(args, cwd = root) { await run(process.execPath, [npmCli, ...args], cwd); }
async function script(name) { await npm(['run', name, '--workspaces=false'], planner); }
async function fixtures() { console.log('Preparing pinned source metadata and geometry fixtures (about 1.2 GB on first use)...'); await run(process.execPath, ['build/prepare-publication-inputs.mjs'], planner); }
async function assertLocalDependencies(directory) {
    const modules = join(directory, 'node_modules');
    const target = await realpath(modules).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!target) return;
    const child = relative(root, target);
    if (child === '..' || child.startsWith('..' + sep) || resolve(root, child) !== target) {
        throw new Error('Dependency directory points outside this checkout: ' + modules + '. Use a separate public-repo clone for contributor setup.');
    }
}

try {
    if (!npmCli) throw new Error('Run through npm: npm run setup:planner, fixtures:planner, dev:planner, or check:planner.');
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Planner contribution tooling requires Node.js 24.');
    if (!['setup', 'fixtures', 'dev', 'check'].includes(command) || flags.some(flag => command !== 'setup' || flag !== '--tests')) {
        throw new Error('Usage: npm run setup:planner [-- --tests], fixtures:planner, dev:planner, or check:planner.');
    }
    if (command === 'setup') {
        await assertLocalDependencies(root);
        await assertLocalDependencies(planner);
        // Shared FoxWatch authoring helpers resolve their Node dependencies at the repo root.
        // Neither install runs lifecycle scripts, .NET, Blender, or Electron builds.
        await npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
        await npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--workspaces=false'], planner);
        await run(process.execPath, ['build/prepare-catalog-input.mjs'], planner);
        if (flags.includes('--tests')) await fixtures();
        console.log('Planner setup complete. Run npm run dev:planner, or npm run check:planner for the full contribution checks.');
    } else if (command === 'fixtures') {
        await fixtures();
    } else if (command === 'dev') {
        await realpath(catalog).catch(() => { throw new Error('Run npm run setup:planner before starting the watcher.'); });
        await script('dev');
    } else {
        await fixtures();
        const buildTests = (await readdir(join(planner, 'build'))).filter(name => name.endsWith('.test.mjs')).sort();
        await run(process.execPath, ['--test', ...buildTests.map(name => 'build/' + name)], planner);
        await script('typecheck');
        await script('test');
        await script('build');
        await script('pack');
        await run(process.execPath, ['build/verify-publication-package.mjs', 'artifacts/extension.nxext'], planner);
    }
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
}
