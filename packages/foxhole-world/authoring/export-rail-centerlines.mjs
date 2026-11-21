import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { regionIdForKey } from '../runtime/region-id.mjs';

const add = (a, b) => a.map((value, i) => value + b[i]);
const sub = (a, b) => a.map((value, i) => value - b[i]);
const scale = (a, factor) => a.map(value => value * factor);
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const length = a => Math.hypot(...a);
const unit = a => scale(a, 1 / length(a));

function sampleArc(origin, tangent, end) {
    const chord = sub(end, origin);
    const along = dot(chord, tangent);
    const across = sub(chord, scale(tangent, along));
    const width = length(across);
    if (width < 1e-5) return { metres: length(chord), points: [origin, end] };
    const normal = unit(across);
    const angle = 2 * Math.atan2(width, along);
    const radius = dot(chord, chord) / (2 * width);
    const metres = angle * radius;
    const steps = Math.max(1, Math.ceil(metres / 0.25));
    const points = Array.from({ length: steps }, (_, i) => {
        const theta = angle * i / steps;
        return add(origin, add(scale(tangent, radius * Math.sin(theta)), scale(normal, radius * (1 - Math.cos(theta)))));
    });
    return { metres, points: [...points, end] };
}

function sampleBiarc(start, startDirection, end, endDirection) {
    const chord = sub(end, start);
    const a = 2 * (1 - dot(startDirection, endDirection));
    const b = 2 * dot(chord, add(startDirection, endDirection));
    const c = dot(chord, chord);
    const distance = 2 * c / (b + Math.sqrt(b * b + 4 * a * c));
    const join = scale(add(add(start, end), scale(sub(startDirection, endDirection), distance)), 0.5);
    const first = sampleArc(start, startDirection, join);
    const second = sampleArc(end, scale(endDirection, -1), join);
    return { metres: first.metres + second.metres, points: [...first.points, ...second.points.reverse().slice(1)] };
}

// Match endpoint positions and curve lengths against the render bake before emitting route data.
export function exportRailCenterlines(render, sockets) {
    const nativeByName = new Map(sockets.map(rail => [rail.name, rail]));
    return render.actors.filter(actor => !actor.hidden).map(actor => {
        const native = nativeByName.get(actor.name);
        if (!native?.front || !native.back || native.type !== actor.type) throw new Error('Missing native rail ' + actor.name);
        const [start, end] = length(sub(native.back.slice(12, 15), actor.start)) < 0.01
            && length(sub(native.front.slice(12, 15), actor.end)) < 0.01 ? [native.back, native.front] : [native.front, native.back];
        const coincident = length(sub(start.slice(12, 15), end.slice(12, 15))) < 0.01;
        const chord = sub(actor.end, actor.start);
        const straightStub = coincident && Math.abs(length(chord) - actor.metres) < 0.01
            && Math.abs(dot(unit(start.slice(0, 3)), unit(chord))) > 0.9999;
        if (length(sub(start.slice(12, 15), actor.start)) > 0.01
            || (!straightStub && length(sub(end.slice(12, 15), actor.end)) > 0.01)) {
            throw new Error('Rail endpoints differ from the render bake for ' + actor.name);
        }
        const planar = point => [point[0], 0, point[2]];
        const forward = matrix => scale(unit(planar(matrix)), Math.sign(dot(planar(matrix), chord)));
        const curve = sampleBiarc(planar(actor.start), forward(start), planar(actor.end), forward(end));
        const rise = actor.end[1] - actor.start[1];
        let station = 0;
        const points = curve.points.map((point, i) => {
            if (i) station += length(sub(point, curve.points[i - 1]));
            return [point[0], actor.start[1] + rise * Math.min(1, station / curve.metres), point[2]];
        });
        points[points.length - 1] = actor.end;
        curve.metres = Math.hypot(curve.metres, rise);
        if (!Number.isFinite(curve.metres) || Math.abs(curve.metres - actor.metres) > 0.03) {
            throw new Error('Rail length differs from the render bake for ' + actor.name + ' (' + curve.metres + ' vs ' + actor.metres + ')');
        }
        return { id: actor.name.toLowerCase(), points: points.map(point => point.map(value => Number(value.toFixed(5)))) };
    });
}

function simplifyRailSamples(points) {
    if (points.length <= 4) return points;
    const keep = new Set([0, 1, points.length - 2, points.length - 1]);
    const spans = [[1, points.length - 2]];
    while (spans.length) {
        const [first, last] = spans.pop();
        const start = points[first];
        const delta = sub(points[last], start);
        const squaredLength = dot(delta, delta);
        let error = 0.003 ** 2;
        let split = -1;
        for (let i = first + 1; i < last; i++) {
            const fromStart = sub(points[i], start);
            const fraction = squaredLength ? Math.min(1, Math.max(0, dot(fromStart, delta) / squaredLength)) : 0;
            const deviation = sub(fromStart, scale(delta, fraction));
            const squaredError = dot(deviation, deviation);
            if (squaredError <= error) continue;
            error = squaredError;
            split = i;
        }
        if (split >= 0) {
            keep.add(split);
            spans.push([first, split], [split, last]);
        }
    }
    return points.filter((_, i) => keep.has(i));
}

async function readRailRegions(world) {
    const { maps } = JSON.parse(await readFile(new URL('../../../tools/foxwatch/asset-overrides/map-regions.json', import.meta.url), 'utf8'));
    const mapKeys = new Map(Object.keys(maps).map(mapKey => [regionIdForKey(mapKey), mapKey]));
    const { regions } = JSON.parse(await readFile(join(world, 'index.json'), 'utf8'));
    const read = async receipt => {
        const encoded = await readFile(join(world, receipt.path));
        const bytes = receipt.encoding === 'br' ? brotliDecompressSync(encoded) : encoded;
        if (createHash('sha256').update(bytes).digest('hex') !== receipt.decodedHash) {
            throw new Error('World content receipt does not match ' + receipt.path);
        }
        return JSON.parse(bytes);
    };
    const result = [];
    for (const [id, value] of Object.entries(regions)) {
        const { resources } = await read(value.manifest);
        const receipt = resources[`${id}/world-fixes/rails/render.json`]?.resource;
        if (!receipt) continue;
        const render = await read(receipt);
        if (!render.visibleConnectors) continue;
        const mapKey = mapKeys.get(id);
        if (!mapKey) throw new Error('Missing map key for rail region ' + id);
        result.push({ id, mapKey, render });
    }
    return result;
}

async function writeRailDataset(regions, audit, output) {
    const entries = [];
    for (const { id, mapKey, render } of regions) {
        const sockets = JSON.parse(await readFile(join(audit, mapKey, 'rail-endpoints.json'), 'utf8'));
        const rails = exportRailCenterlines(render, sockets);
        if (rails.length !== render.visibleConnectors) throw new Error('Rail count disagrees with render data in ' + id);
        const records = rails.map(rail => JSON.stringify(id === 'westgate' ? rail : { ...rail, points: simplifyRailSamples(rail.points) }));
        entries.push(`  ${JSON.stringify(id)}: { "mapKey": ${JSON.stringify(mapKey)}, "rails": [\n    ${records.join(',\n    ')}\n  ] }`);
    }
    await writeFile(output, '{\n' + entries.join(',\n') + '\n}\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [, , render, sockets, output] = process.argv;
    if (render === '--list-maps' && sockets && output) {
        await writeFile(output, (await readRailRegions(sockets)).map(region => region.mapKey).join('\n') + '\n');
    } else if (render === '--regions' && sockets && output && process.argv[5]) {
        await writeRailDataset(await readRailRegions(sockets), output, process.argv[5]);
    } else {
        if (!render || !sockets || !output) throw new Error('Expected render metadata, native rail endpoints, and an output path.');
        const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
        const rails = exportRailCenterlines(await readJson(render), await readJson(sockets));
        await writeFile(output, '[\n' + rails.map(rail => '  ' + JSON.stringify(rail)).join(',\n') + '\n]\n');
    }
}
