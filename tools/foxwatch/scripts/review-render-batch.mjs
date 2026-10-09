import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, relative, join, dirname } from 'node:path';
import sharp from 'sharp';

const options = Object.fromEntries(process.argv.slice(2).reduce((entries, value, index, args) => {
    if (value.startsWith('--')) entries.push([value.slice(2), args[index + 1]]);
    return entries;
}, []));
if (!options.baseline || !options.candidate || !options.output) {
    throw new Error('Usage: node review-render-batch.mjs --baseline <asset root> --candidate <asset root> --output <review directory>');
}
const baselineRoot = resolve(options.baseline), candidateRoot = resolve(options.candidate), outputRoot = resolve(options.output);
await mkdir(join(outputRoot, 'images'), { recursive: true });
const projectionFiles = [];
async function walk(directory) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
        const filename = join(directory, item.name);
        if (item.isDirectory()) {
            if (item.name !== 'cache') await walk(filename);
        } else if (item.name.endsWith('.texture.json')) projectionFiles.push(filename);
    }
}
await walk(candidateRoot);
projectionFiles.sort();
const records = [];
for (const [index, filename] of projectionFiles.entries()) {
    const key = relative(candidateRoot, filename).replaceAll('\\', '/');
    const candidate = JSON.parse(await readFile(filename, 'utf8'));
    let baseline;
    try { baseline = JSON.parse(await readFile(join(baselineRoot, key), 'utf8')); } catch { continue; }
    const beforePath = join(baselineRoot, key).replace(/\.json$/, '.webp');
    const afterPath = filename.replace(/\.json$/, '.webp');
    const before = await sharp(beforePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const after = await sharp(afterPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let filled = 0, removed = 0;
    if (before.info.width === after.info.width && before.info.height === after.info.height) {
        for (let pixel = 3; pixel < before.data.length; pixel += 4) {
            if (before.data[pixel] < 8 && after.data[pixel] > 128) filled++;
            if (after.data[pixel] < 8 && before.data[pixel] > 128) removed++;
        }
    }
    const shadow = candidate.contactShadow;
    const projections = [baseline, candidate, ...(shadow ? [shadow] : [])];
    const x0 = Math.floor(Math.min(...projections.map(p => -p.anchorPixelX)));
    const y0 = Math.floor(Math.min(...projections.map(p => -p.anchorPixelY)));
    const x1 = Math.ceil(Math.max(...projections.map(p => p.width - p.anchorPixelX)));
    const y1 = Math.ceil(Math.max(...projections.map(p => p.height - p.anchorPixelY)));
    const width = x1 - x0, height = y1 - y0;
    const place = (input, projection) => ({ input, left: Math.round(-x0 - projection.anchorPixelX), top: Math.round(-y0 - projection.anchorPixelY) });
    const ground = { create: { width, height, channels: 4, background: '#555650' } };
    for (const [name, layers] of [
        ['before', [place(beforePath, baseline)]],
        ['after', [...(shadow ? [place(join(dirname(filename), shadow.file), shadow)] : []), place(afterPath, candidate)]],
    ]) {
        const assembly = await sharp(ground).composite(layers).png().toBuffer();
        await sharp(assembly).resize(500, 380, { fit: 'contain', background: '#555650' }).png().toFile(join(outputRoot, 'images', `${index}-${name}.png`));
    }
    records.push({ key, index, kind: key.includes('/components/') ? 'Component' : key.includes('/modifications/') ? 'Modification' : 'Asset',
        shadow: Boolean(shadow), filled, removed,
        frameChanged: ['width', 'height', 'anchorPixelX', 'anchorPixelY'].some(field => Math.abs(candidate[field] - baseline[field]) > 0.001) });
}
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const cards = records.map(record => `<article data-kind="${record.kind}" data-key="${escape(record.key)}"><h2>${escape(record.key.replace(/\/[^/]+\.texture\.json$/, ''))}</h2><div class="comparison"><img src="images/${record.index}-before.png" alt="Baseline"><div class="after"><img src="images/${record.index}-after.png" alt="Shared Profile"></div><input type="range" min="0" max="100" value="50" aria-label="Compare ${escape(record.key)}"></div><div class="legend"><span>Baseline</span><span>Shared Profile</span></div><p>${record.shadow ? 'Contact Shadow' : 'Surface Lighting'} · Mask Changes: ${record.filled + record.removed}${record.frameChanged ? ' · FRAME CHANGED' : ''}</p></article>`).join('');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Foxhole Render Review</title><style>
*{box-sizing:border-box}body{margin:0;background:#090b0c;color:#dae0e3;font:14px system-ui,sans-serif}header{padding:30px 32px 20px;position:sticky;top:0;background:#090b0cf5;z-index:2;border-bottom:1px solid #242b2e}h1{margin:0 0 8px;font-size:26px}header p{color:#91a3ac;margin:0 0 18px}.controls{display:flex;gap:12px;flex-wrap:wrap}select,input[type=search]{color:#dae0e3;background:#151b1e;border:1px solid #354149;border-radius:6px;padding:9px;font:inherit}input[type=search]{flex:1;min-width:200px}main{padding:24px 32px;display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:24px;max-width:1800px;margin:auto}article{min-width:0;background:#111618;border:1px solid #273136;border-radius:10px;padding:18px}h2{font-size:13px;font-weight:500;overflow-wrap:anywhere;color:#adbdc5;margin:0 0 14px;min-height:32px}.comparison{position:relative;background:#555650;aspect-ratio:500/380;overflow:hidden;border-radius:6px}.comparison>img,.after img{display:block;width:100%;height:100%;object-fit:contain}.after{position:absolute;inset:0;clip-path:inset(0 0 0 50%)}.comparison input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:ew-resize}.comparison:after{content:'';position:absolute;left:var(--divider,50%);top:0;bottom:0;width:1px;background:#45d6c5;pointer-events:none}.legend{display:flex;justify-content:space-between;color:#829ba7;font-size:12px;margin-top:8px}article p{font-size:12px;color:#829ba7;margin:14px 0 0}article[hidden]{display:none}</style>
<header><h1>Foxhole Render Review</h1><p>${records.length} render comparisons · shared lighting and contact profile. Drag each image to compare.</p><div class="controls"><select id="kind" aria-label="Render Type"><option>Asset</option><option>Component</option><option>Modification</option><option>All</option></select><input type="search" id="search" placeholder="Filter by asset or component…" aria-label="Filter Renders"></div></header><main>${cards}</main><script>
const cards=[...document.querySelectorAll('article')],kind=document.querySelector('#kind'),search=document.querySelector('#search');function filter(){const query=search.value.toLowerCase();cards.forEach(card=>card.hidden=(kind.value!=='All'&&card.dataset.kind!==kind.value)||!card.dataset.key.toLowerCase().includes(query))}kind.addEventListener('change',filter);search.addEventListener('input',filter);document.querySelectorAll('input[type=range]').forEach(input=>input.addEventListener('input',()=>{input.parentElement.querySelector('.after').style.clipPath='inset(0 0 0 '+input.value+'%)';input.parentElement.style.setProperty('--divider',input.value+'%')}));filter();</script></html>`;
await writeFile(join(outputRoot, 'index.html'), html);
await writeFile(join(outputRoot, 'report.json'), JSON.stringify(records, null, 2));
console.log(JSON.stringify({ comparisons: records.length, maskChanges: records.filter(record => record.filled || record.removed), frameChanges: records.filter(record => record.frameChanged), html: join(outputRoot, 'index.html') }, null, 2));
