import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function inspect(path) {
    const bytes = await readFile(path), length = bytes.readUInt32LE(12);
    const document = JSON.parse(bytes.subarray(20, 20 + length).toString('utf8')), binary = bytes.subarray(28 + length);
    const images = [];
    for (const image of document.images ?? []) {
        const view = document.bufferViews[image.bufferView];
        assert.ok(view, 'Only embedded verified images are supported');
        const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
        const metadata = await sharp(bytes).metadata();
        images.push({ name: image.name, bytes: bytes.length, sha256: hash(bytes), width: metadata.width, height: metadata.height,
            estimatedRgbaBytes: metadata.width * metadata.height * 4 });
    }
    return { document, binary, bytes: bytes.length, sha256: hash(bytes), images,
        decodedGeometryBytes: (document.bufferViews ?? []).filter(view => view.extensions?.EXT_meshopt_compression)
            .reduce((sum, view) => sum + view.byteLength, 0) };
}


const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a, b) {
    const out = Array(16).fill(0);
    for (let column = 0; column < 4; column++) for (let row = 0; row < 4; row++)
        for (let k = 0; k < 4; k++) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
    return out;
}
function matrix(node) {
    if (node.matrix) return node.matrix;
    const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1], t = node.translation ?? [0, 0, 0];
    return [(1 - 2 * (y*y + z*z))*sx, 2*(x*y + z*w)*sx, 2*(x*z - y*w)*sx, 0,
        2*(x*y - z*w)*sy, (1 - 2*(x*x + z*z))*sy, 2*(y*z + x*w)*sy, 0,
        2*(x*z + y*w)*sz, 2*(y*z - x*w)*sz, (1 - 2*(x*x + y*y))*sz, 0, ...t, 1];
}
function worldNodes(artifact) {
    const result = new Map(), doc = artifact.document;
    const visit = (index, parent) => { const node = doc.nodes[index], world = multiply(parent, matrix(node));
        result.set(index, world); for (const child of node.children ?? []) visit(child, world); };
    for (const index of doc.scenes[doc.scene ?? 0].nodes) visit(index, identity());
    return result;
}
function positions(artifact, accessorId) {
    const doc = artifact.document, accessor = doc.accessors[accessorId], view = doc.bufferViews[accessor.bufferView];
    const compression = view.extensions?.EXT_meshopt_compression;
    let data;
    if (compression) {
        data = Buffer.alloc(view.byteLength);
        MeshoptDecoder.decodeGltfBuffer(data, compression.count, compression.byteStride,
            artifact.binary.subarray(compression.byteOffset ?? 0, (compression.byteOffset ?? 0) + compression.byteLength), compression.mode, compression.filter);
    } else data = artifact.binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const types = { 5120: [1, 'readInt8', 127], 5121: [1, 'readUInt8', 255], 5122: [2, 'readInt16LE', 32767],
        5123: [2, 'readUInt16LE', 65535], 5126: [4, 'readFloatLE', 1] };
    const [size, method, divisor] = types[accessor.componentType], stride = view.byteStride ?? size * 3, points = [];
    for (let i = 0; i < accessor.count; i++) points.push([0, 1, 2].map(axis => {
        const value = data[method]((accessor.byteOffset ?? 0) + stride * i + axis * size);
        return accessor.normalized ? Math.max(-1, value / divisor) : value;
    }));
    return points;
}
function meshBounds(artifact, world, meshId) {
    const low = [Infinity, Infinity, Infinity], high = [-Infinity, -Infinity, -Infinity];
    for (const primitive of artifact.document.meshes[meshId].primitives) for (const p of positions(artifact, primitive.attributes.POSITION)) {
        const point = [0, 1, 2].map(axis => world[axis]*p[0] + world[4+axis]*p[1] + world[8+axis]*p[2] + world[12+axis]);
        for (let axis = 0; axis < 3; axis++) { low[axis] = Math.min(low[axis], point[axis]); high[axis] = Math.max(high[axis], point[axis]); }
    }
    return [...low, ...high];
}
function combineBounds(bounds) {
    return [0, 1, 2].map(axis => Math.min(...bounds.map(bound => bound[axis])))
        .concat([3, 4, 5].map(axis => Math.max(...bounds.map(bound => bound[axis]))));
}

const args = process.argv.slice(2);
const option = key => args.find(arg => arg.startsWith('--' + key + '='))?.slice(key.length + 3)
    ?? (args.includes('--' + key) ? args[args.indexOf('--' + key) + 1] : undefined);
const outputRoot = resolve(option('output-root') ?? 'packages/extensions/foxhole/public/foxhole/assets');
const baselineRoot = resolve(option('baseline-root') ?? 'tools/foxwatch/tmp/shared-model-parts-baseline');
const ids = (option('only') ?? 'facilityrefinery1,facilityfactoryaircraft,facilityfactoryammo,facilityvehiclefactory1,facilitycrane').split(',');
const manifest = JSON.parse(await readFile(resolve(outputRoot, 'models/manifest.v1.json'), 'utf8'));
const report = { schemaVersion: 1, assets: {}, sharedParts: {}, totals: { beforeBytes: 0, afterHostBytes: 0, afterSharedBytes: 0,
    beforeDecodedGeometryBytes: 0, afterHostDecodedGeometryBytes: 0, afterSharedDecodedGeometryBytes: 0,
    beforeTextureRgbaBytes: 0, afterHostTextureRgbaBytes: 0, afterSharedTextureRgbaBytes: 0 } };
for (const id of ids) {
    const metadata = manifest.assets[id], before = await inspect(resolve(baselineRoot, id + '.glb'));
    const after = await inspect(resolve(outputRoot, metadata.path)), parts = metadata.modelParts;
    assert.ok(parts?.version === 1 && parts.parts.length > 0 && parts.parts.length <= 128, 'Missing bounded shared references: ' + id);
    assert.deepEqual(after.document.asset.extras.nixieModelParts, parts, 'Manifest/GLB dependency mismatch: ' + id);
    assert.deepEqual(after.document.asset.extras.nixieModelAnchor, before.document.asset.extras.nixieModelAnchor, 'Anchor changed: ' + id);
    assert.equal(after.sha256, metadata.sha256, 'Host bytes do not match manifest: ' + id);
    assert.deepEqual(after.document.asset.extras.nixieStructuralProfile, before.document.asset.extras.nixieStructuralProfile, 'Structural visibility profile changed: ' + id);
    const sourcePattern = /^facility/.test(id) ? /PowerLineAttachment/i : /FortT2Wall01/i;
    assert.ok(!(after.document.meshes ?? []).some(mesh => sourcePattern.test(mesh.name)), 'Redundant embedded shared mesh: ' + id);
    const originalWorlds = worldNodes(before), originalBounds = [];
    for (const [index, world] of originalWorlds) {
        const node = before.document.nodes[index];
        if (node.mesh !== undefined && sourcePattern.test(before.document.meshes[node.mesh].name))
            originalBounds.push(meshBounds(before, world, node.mesh));
    }
    const afterWorlds = worldNodes(after), placementErrors = [];
    for (const part of parts.parts) {
        const nodes = (after.document.nodes ?? []).filter(node => node.name === part.nodeName);
        assert.equal(nodes.length, 1, 'Placeholder must resolve exactly once: ' + part.nodeName);
        assert.equal(nodes[0].mesh, undefined, 'Placeholder retains a redundant mesh');
        const entry = Object.entries(manifest.sharedParts ?? {}).find(([, shared]) => shared.resourceId === part.resourceId);
        assert.ok(entry, 'Missing canonical dependency: ' + part.resourceId);
        const [key, shared] = entry;
        if (!report.sharedParts[key]) {
            const artifact = await inspect(resolve(outputRoot, shared.path));
            assert.equal(artifact.sha256, shared.sha256, 'Canonical bytes do not match manifest');
            assert.equal(artifact.document.asset.extras?.nixieModelParts, undefined, 'Nested parts are not supported');
            assert.equal(artifact.document.asset.extras?.nixieModelAnchor, undefined, 'Canonical geometry must retain its local origin');
            report.sharedParts[key] = { resourceId: shared.resourceId, path: shared.path, bytes: artifact.bytes, sha256: artifact.sha256,
                decodedGeometryBytes: artifact.decodedGeometryBytes, images: artifact.images };
            report.totals.afterSharedBytes += artifact.bytes;
            report.totals.afterSharedDecodedGeometryBytes += artifact.decodedGeometryBytes;
            report.totals.afterSharedTextureRgbaBytes += artifact.images.reduce((sum, image) => sum + image.estimatedRgbaBytes, 0);
        }
        const canonical = await inspect(resolve(outputRoot, shared.path)), canonicalBounds = [];
        const hostIndex = after.document.nodes.indexOf(nodes[0]), placement = afterWorlds.get(hostIndex);
        for (const [index, world] of worldNodes(canonical)) {
            const node = canonical.document.nodes[index];
            if (node.mesh !== undefined) canonicalBounds.push(meshBounds(canonical, multiply(placement, world), node.mesh));
        }
        const actual = combineBounds(canonicalBounds);
        const errors = originalBounds.map(bound => Math.max(...bound.map((value, axis) => Math.abs(value - actual[axis]))));
        const error = Math.min(...errors);
        assert.ok(error < 0.003, 'Canonical placement differs from original geometry by ' + error + ' metres: ' + id + ':' + part.nodeName);
        originalBounds.splice(errors.indexOf(error), 1);
        placementErrors.push(error);
        const beforeImages = new Set(before.images.map(image => image.sha256));
        assert.ok(canonical.images.every(image => beforeImages.has(image.sha256)), 'Canonical material/image payload changed: ' + id);
        // The connector's texture set is exclusive to it in this trial. Wall materials
        // remain embedded where other host geometry uses them; report that residual.
        if (/^facility/.test(id)) {
            const hashes = new Set(report.sharedParts[key].images.map(image => image.sha256));
            assert.ok(!after.images.some(image => hashes.has(image.sha256)), 'Redundant embedded connector image: ' + id);
        }
    }
    assert.equal(originalBounds.length, 0, 'Original shared placements were not all replaced: ' + id);
    report.assets[id] = { beforeBytes: before.bytes, afterBytes: after.bytes, afterSha256: after.sha256, placements: parts.parts.length, maximumPlacementBoundsErrorMetres: Math.max(...placementErrors),
        beforeDecodedGeometryBytes: before.decodedGeometryBytes, afterDecodedGeometryBytes: after.decodedGeometryBytes,
        beforeImages: before.images, afterImages: after.images };
    report.totals.beforeBytes += before.bytes;
    report.totals.afterHostBytes += after.bytes;
    report.totals.beforeDecodedGeometryBytes += before.decodedGeometryBytes;
    report.totals.afterHostDecodedGeometryBytes += after.decodedGeometryBytes;
    report.totals.beforeTextureRgbaBytes += before.images.reduce((sum, image) => sum + image.estimatedRgbaBytes, 0);
    report.totals.afterHostTextureRgbaBytes += after.images.reduce((sum, image) => sum + image.estimatedRgbaBytes, 0);
}
report.totals.savedBytes = report.totals.beforeBytes - report.totals.afterHostBytes - report.totals.afterSharedBytes;
report.totals.savedPercent = 100 * report.totals.savedBytes / report.totals.beforeBytes;
report.totals.beforeRequests = ids.length;
report.totals.afterRequests = ids.length + Object.keys(report.sharedParts).length;
const path = resolve(option('report') ?? 'tools/foxwatch/tmp/shared-model-parts-inspection.v1.json');
await writeFile(path, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ report: path, totals: report.totals, sharedParts: Object.keys(report.sharedParts).length, assets: ids.length }, null, 2));
