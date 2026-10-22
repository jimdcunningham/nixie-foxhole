import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const here=import.meta.dirname,require=createRequire(import.meta.url);
await build({entryPoints:{viewer:path.join(here,'viewer.mjs'),'texture-worker':path.join(here,'runtime/texture-worker.mjs'),'resource-worker':path.join(here,'runtime/resource-worker.mjs'),'decode-worker':path.join(here,'authoring/decode-worker.mjs'),'geometry-recipe-worker':path.join(here,'authoring/geometry-recipe-worker.mjs')},outdir:path.join(here,'dist'),outExtension:{'.js':'.mjs'},bundle:true,format:'esm',platform:'browser',target:'es2022',loader:{'.wasm':'file'},assetNames:'[name]-[hash]',plugins:[{name:'worker-urls',setup(api){api.onLoad({filter:/(compact-provider|terrain-texture-pool)\.mjs$/},async args=>({contents:(await fs.readFile(args.path,'utf8')).replaceAll("'../authoring/decode-worker.mjs'","'./decode-worker.mjs'").replaceAll("'../authoring/geometry-recipe-worker.mjs'","'./geometry-recipe-worker.mjs'"),loader:'js',resolveDir:path.dirname(args.path)}));}},{name:'wasm-urls',setup(api){api.onResolve({filter:/\.wasm\?url$/},args=>({path:require.resolve(args.path.slice(0,-4))}));}}],logLevel:'warning'});
await fs.copyFile(path.join(here,'viewer.html'),path.join(here,'dist/viewer.html'));
