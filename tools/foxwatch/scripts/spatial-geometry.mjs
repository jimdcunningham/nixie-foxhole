/** Private FoxWatch geometry packing helpers, mirrored locally for bounded experiments. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';

const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const hash = b => createHash('sha256').update(b).digest('hex');

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);

function accessorData(source, id) {
    const a = source.doc.accessors[id];
    assert.ok(!a.sparse && components[a.type] && sizes[a.componentType]);
    const size = components[a.type] * sizes[a.componentType];
    const view = source.doc.bufferViews[a.bufferView];
    const stride = view.byteStride ?? size;
    const data = Buffer.alloc(a.count * size);
    for (let i = 0; i < a.count; i++) {
        const offset = (a.byteOffset ?? 0) + i * stride;
        source.views[a.bufferView].copy(data, i * size, offset, offset + size);
    }
    return { accessor: structuredClone(a), data, size };
}

function floatArray(data) {
    return new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4);
}

function bounds(source) {
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    const minKeys = [], maxKeys = [];
    for (const mesh of source.doc.meshes) {
        for (const p of mesh.primitives) {
            const { data, accessor } = accessorData(source, p.attributes.POSITION);
            assert.equal(accessor.componentType, 5126);
            const f = floatArray(data);
            for (let i = 0; i < f.length; i++) {
                const axis = i % 3;
                if (f[i] < min[axis]) {
                    min[axis] = f[i];
                    minKeys[axis] = data.subarray(Math.floor(i / 3) * 12, Math.floor(i / 3) * 12 + 12).toString('base64');
                }
                if (f[i] > max[axis]) {
                    max[axis] = f[i];
                    maxKeys[axis] = data.subarray(Math.floor(i / 3) * 12, Math.floor(i / 3) * 12 + 12).toString('base64');
                }
            }
        }
    }
    // One power-of-two grid across the whole asset preserves coincident boundaries.
    return { min, max, extrema: new Set([...minKeys, ...maxKeys]), extent: Math.max(...max.map((v, i) => v - min[i])) };
}

function indicesFrom(stream) {
    const result = new Uint32Array(stream.accessor.count);
    for (let i = 0; i < result.length; i++) {
        result[i] = stream.accessor.componentType === 5123 ? stream.data.readUInt16LE(i * 2) : stream.data.readUInt32LE(i * 4);
    }
    return result;
}

function triangleKeys(indices) {
    const keys = [];
    for (let i = 0; i < indices.length; i += 3) {
        const [a, b, c] = indices.subarray(i, i + 3);
        keys.push([`${a},${b},${c}`, `${b},${c},${a}`, `${c},${a},${b}`].sort()[0]);
    }
    return keys.sort();
}

function faceCross(positions, a, b, c) {
    const u = [0, 1, 2].map(k => positions[b * 3 + k] - positions[a * 3 + k]);
    const v = [0, 1, 2].map(k => positions[c * 3 + k] - positions[a * 3 + k]);
    return [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
}

function protectFineDetails(source, step) {
    const protectedKeys = new Set();
    if (!step) {
        return protectedKeys;
    }
    const meshes = source.doc.meshes.flatMap(mesh => mesh.primitives.map(p => {
        const s = accessorData(source, p.attributes.POSITION);
        const original = Float32Array.from(floatArray(s.data));
        return { original, rounded: Float32Array.from(original, v => Math.round(v / step) * step),
            keys: Array.from({ length: s.accessor.count }, (_, i) => s.data.subarray(i * 12, (i + 1) * 12).toString('base64')),
            indices: indicesFrom(accessorData(source, p.indices)) };
    }));
    // Restore coincident positions together, including across UV/material seams and meshes.
    // Every round restores more original vertices, so this converges without widening error bounds.
    let changed;
    do {
        changed = false;
        for (const m of meshes) {
            for (let i = 0; i < m.keys.length; i++) {
                if (protectedKeys.has(m.keys[i])) {
                    m.rounded.set(m.original.subarray(i * 3, i * 3 + 3), i * 3);
                }
            }
            for (let i = 0; i < m.indices.length; i += 3) {
                const ids = m.indices.subarray(i, i + 3);
                const a = faceCross(m.original, ...ids), b = faceCross(m.rounded, ...ids);
                if (a.some(v => v !== 0) && a.reduce((sum, v, k) => sum + v * b[k], 0) <= 0) {
                    for (const id of ids) {
                        if (!protectedKeys.has(m.keys[id])) {
                            protectedKeys.add(m.keys[id]);
                            changed = true;
                        }
                    }
                }
            }
        }
    } while (changed);
    return protectedKeys;
}

function curvedPositionKeys(source, maxExtent = 1) {
    const keys = new Set(), nodes = [], parents = [], idsByKey = new Map();
    const find = id => {
        while (parents[id] !== id) {
            parents[id] = parents[parents[id]];
            id = parents[id];
        }
        return id;
    };
    const nodeFor = (data, id) => {
        const key = data.subarray(id * 12, id * 12 + 12).toString('base64');
        if (!idsByKey.has(key)) {
            const index = nodes.length;
            idsByKey.set(key, index);
            nodes.push({ key, position: [0, 1, 2].map(k => data.readFloatLE(id * 12 + k * 4)) });
            parents.push(index);
        }
        return idsByKey.get(key);
    };
    for (const mesh of source.doc.meshes) {
        for (const primitive of mesh.primitives) {
            if (primitive.attributes.NORMAL === undefined) {
                continue;
            }
            const positions = accessorData(source, primitive.attributes.POSITION);
            const normals = accessorData(source, primitive.attributes.NORMAL);
            assert.equal(normals.accessor.componentType, 5126);
            const n = floatArray(normals.data);
            const indices = indicesFrom(accessorData(source, primitive.indices));
            for (let i = 0; i < indices.length; i += 3) {
                const ids = indices.subarray(i, i + 3);
                const bends = [[0, 1], [1, 2], [2, 0]].some(([a, b]) => {
                    const va = Array.from(n.subarray(ids[a] * 3, ids[a] * 3 + 3));
                    const vb = Array.from(n.subarray(ids[b] * 3, ids[b] * 3 + 3));
                    const length = Math.hypot(...va) * Math.hypot(...vb);
                    if (!length) {
                        return false;
                    }
                    const cosine = va.reduce((sum, value, k) => sum + value * vb[k], 0) / length;
                    return cosine < Math.cos(Math.PI / 180) && cosine > 0.5;
                });
                if (bends) {
                    const vertices = Array.from(ids, id => nodeFor(positions.data, id));
                    parents[find(vertices[1])] = find(vertices[0]);
                    parents[find(vertices[2])] = find(vertices[0]);
                }
            }
        }
    }
    const groups = new Map();
    for (const [index, node] of nodes.entries()) {
        const id = find(index);
        if (!groups.has(id)) {
            groups.set(id, { min: [...node.position], max: [...node.position], keys: [] });
        }
        const group = groups.get(id);
        group.keys.push(node.key);
        for (let k = 0; k < 3; k++) {
            group.min[k] = Math.min(group.min[k], node.position[k]);
            group.max[k] = Math.max(group.max[k], node.position[k]);
        }
    }
    for (const group of groups.values()) {
        if (Math.max(...group.max.map((v, k) => v - group.min[k])) <= maxExtent) {
            for (const key of group.keys) {
                keys.add(key);
            }
        }
    }
    return keys;
}

function updateBounds(stream) {
    const a = stream.accessor;
    if (!a.min && !a.max) {
        return;
    }
    const width = components[a.type];
    const min = Array(width).fill(Infinity), max = Array(width).fill(-Infinity);
    const readers = { 5120: 'readInt8', 5121: 'readUInt8', 5122: 'readInt16LE', 5123: 'readUInt16LE', 5125: 'readUInt32LE', 5126: 'readFloatLE' };
    for (let i = 0; i < a.count * width; i++) {
        const value = stream.data[readers[a.componentType]](i * sizes[a.componentType]);
        min[i % width] = Math.min(min[i % width], value);
        max[i % width] = Math.max(max[i % width], value);
    }
    a.min = min;
    a.max = max;
}

function optimize(source, profile) {
    assert.ok(profile.simplify === undefined || profile.simplify >= 0.5, 'Do not retain fewer than 50% of triangles.');
    const doc = structuredClone(source.doc);
    doc.bufferViews = [];
    doc.accessors = [];
    doc.buffers = [];
    const contents = [], configurations = [], viewKeys = new Map();
    const stats = { triangles: 0, sourceVertices: 0, vertices: 0, maxPositionErrorMetres: 0,
        maxNormalAngleDegrees: 0, maxTangentAngleDegrees: 0, maxUvErrorTexelsAt512: 0, maxSimplifierErrorMetres: 0,
        newCollapsedTriangles: 0, newReversedTriangles: 0, emptyPrimitiveFallbacks: 0, curvatureLockedVertices: 0, boundsLockedVertices: 0 };
    const assetBounds = bounds(source);
    const positionStep = profile.positionBits ? 2 ** Math.floor(Math.log2(assetBounds.extent / (2 ** profile.positionBits - 1))) : 0;
    stats.positionStepMetres = positionStep;
    const protectedKeys = protectFineDetails(source, positionStep);
    const curvedKeys = profile.protectCurves ? curvedPositionKeys(source, profile.curveMaxExtent ?? 1) : new Set();
    stats.protectedFineDetailPositions = protectedKeys.size;
    stats.curvatureLockedPositions = curvedKeys.size;
    const addView = (data, config = {}) => {
        const key = `${JSON.stringify(config)}:${hash(data)}`;
        if (viewKeys.has(key)) {
            return viewKeys.get(key);
        }
        const id = contents.length;
        contents.push(data);
        configurations.push(config);
        viewKeys.set(key, id);
        return id;
    };
    for (const image of doc.images ?? []) {
        image.bufferView = addView(source.views[image.bufferView]);
    }
    for (const [mi, mesh] of source.doc.meshes.entries()) {
        for (const [pi, p] of mesh.primitives.entries()) {
            assert.ok((p.mode ?? 4) === 4 && p.indices !== undefined && !p.targets?.length);
            assert.notEqual(doc.materials?.[p.material]?.alphaMode, 'BLEND', 'triangle reordering requires opaque or masked surfaces');
            const streams = Object.fromEntries(Object.entries(p.attributes).map(([name, id]) => [name, accessorData(source, id)]));
            const vertexCount = streams.POSITION.accessor.count;
            const originalPositions = Float32Array.from(floatArray(streams.POSITION.data));
            const originalTuples = Array.from({ length: vertexCount }, (_, i) =>
                Buffer.concat(Object.values(streams).map(s => s.data.subarray(i * s.size, (i + 1) * s.size))).toString('base64'));
            stats.sourceVertices += vertexCount;
            for (const [name, stream] of Object.entries(streams)) {
                assert.equal(stream.accessor.count, vertexCount);
                if (!profile.positionBits || stream.accessor.componentType !== 5126) {
                    continue;
                }
                const step = name === 'POSITION'
                    ? positionStep
                    : ['NORMAL', 'TANGENT'].includes(name)
                        ? 2 ** (1 - profile.vectorBits)
                        : name.startsWith('TEXCOORD_') ? 2 ** -profile.uvBits : 0;
                if (!step) {
                    continue;
                }
                const original = Float32Array.from(floatArray(stream.data));
                const rounded = floatArray(stream.data);
                const width = components[stream.accessor.type];
                for (let i = 0; i < rounded.length; i++) {
                    rounded[i] = Math.round(original[i] / step) * step;
                }
                if (name === 'POSITION') {
                    for (let i = 0; i < vertexCount; i++) {
                        const key = Buffer.from(original.buffer, i * 12, 12).toString('base64');
                        if (protectedKeys.has(key)) {
                            rounded.set(original.subarray(i * 3, i * 3 + 3), i * 3);
                        }
                    }
                }
                for (let i = 0; i < vertexCount; i++) {
                    let error2 = 0, dot = 0, lenA = 0, lenB = 0;
                    const n = ['NORMAL', 'TANGENT'].includes(name) ? 3 : width;
                    for (let c = 0; c < n; c++) {
                        const a = original[i * width + c], r = rounded[i * width + c];
                        error2 += (r - a) ** 2;
                        dot += a * r;
                        lenA += a * a;
                        lenB += r * r;
                    }
                    if (name === 'POSITION') {
                        stats.maxPositionErrorMetres = Math.max(stats.maxPositionErrorMetres, Math.sqrt(error2));
                    }
                    if (name.startsWith('TEXCOORD_')) {
                        stats.maxUvErrorTexelsAt512 = Math.max(stats.maxUvErrorTexelsAt512, Math.sqrt(error2) * 512);
                    }
                    if (name === 'NORMAL' || name === 'TANGENT') {
                        const angle = lenA && lenB ? Math.acos(Math.max(-1, Math.min(1, dot / Math.sqrt(lenA * lenB)))) * 180 / Math.PI : 0;
                        const key = name === 'NORMAL' ? 'maxNormalAngleDegrees' : 'maxTangentAngleDegrees';
                        stats[key] = Math.max(stats[key], angle);
                    }
                    if (name === 'TANGENT') {
                        assert.equal(original[i * width + 3], rounded[i * width + 3], 'tangent handedness');
                    }
                }
            }
            let indices = indicesFrom(accessorData(source, p.indices));
            assert.ok(indices.every(i => i < vertexCount));
            const roundedPositions = floatArray(streams.POSITION.data);
            for (let i = 0; i < indices.length; i += 3) {
                const a = faceCross(originalPositions, ...indices.subarray(i, i + 3));
                const b = faceCross(roundedPositions, ...indices.subarray(i, i + 3));
                if (a.some(v => v !== 0)) {
                    if (b.every(v => v === 0)) {
                        stats.newCollapsedTriangles++;
                    } else if (a.reduce((sum, v, k) => sum + v * b[k], 0) < 0) {
                        stats.newReversedTriangles++;
                    }
                }
            }
            // Weld only vertices whose complete retained attribute tuples are byte-identical.
            const tuples = new Map(), dedup = new Uint32Array(vertexCount), representatives = [];
            for (let i = 0; i < vertexCount; i++) {
                const tuple = originalTuples[i];
                if (!tuples.has(tuple)) {
                    tuples.set(tuple, tuples.size);
                    representatives.push(i);
                }
                dedup[i] = tuples.get(tuple);
            }
            indices = indices.map(i => dedup[i]);
            for (const s of Object.values(streams)) {
                const data = Buffer.alloc(representatives.length * s.size);
                representatives.forEach((old, i) => s.data.copy(data, i * s.size, old * s.size, (old + 1) * s.size));
                s.data = data;
                s.accessor.count = representatives.length;
            }
            if (profile.simplify) {
                const names = Object.keys(streams).filter(n => n !== 'POSITION');
                const width = names.reduce((sum, n) => sum + components[streams[n].accessor.type], 0);
                const attributes = new Float32Array(representatives.length * width);
                // Keep one original extremum per bound, including its coincident seam
                // vertices. Bounds drive native model sizing and must not shrink when
                // simplification removes a shallow bump or a small outer feature.
                const vertexLocks = Uint8Array.from(representatives, old => {
                    const key = Buffer.from(originalPositions.buffer, old * 12, 12).toString('base64');
                    const curve = curvedKeys.has(key), bound = assetBounds.extrema.has(key);
                    stats.curvatureLockedVertices += Number(curve);
                    stats.boundsLockedVertices += Number(bound);
                    return curve || bound ? 1 : 0;
                });
                const weights = names.flatMap(n => Array(components[streams[n].accessor.type]).fill(n.startsWith('TEXCOORD') ? (profile.uvWeight ?? 1) : (profile.attributeWeight ?? 0.25)));
                for (let i = 0; i < representatives.length; i++) {
                    let offset = i * width;
                    for (const n of names) {
                        const s = streams[n], a = s.accessor;
                        for (let c = 0; c < components[a.type]; c++) {
                            const value = a.componentType === 5126
                                ? s.data.readFloatLE(i * s.size + c * 4)
                                : a.componentType === 5121 ? s.data.readUInt8(i * s.size + c) : s.data.readUInt16LE(i * s.size + c * 2);
                            attributes[offset++] = a.normalized ? value / (a.componentType === 5121 ? 255 : 65535) : value;
                        }
                    }
                }
                // Aggressive trials allow seam collapse and unlocked borders; component pruning remains off.
                const [simplified, error] = MeshoptSimplifier.simplifyWithAttributes(indices, floatArray(streams.POSITION.data), 3,
                    attributes, width, weights, vertexLocks, Math.max(3, Math.floor(indices.length * profile.simplify / 3) * 3), profile.error ?? 0.001,
                    profile.permissive ? ['Permissive'] : ['LockBorder']);
                stats.maxSimplifierErrorMetres = Math.max(stats.maxSimplifierErrorMetres, error * MeshoptSimplifier.getScale(floatArray(streams.POSITION.data), 3));
                // glTF accessors need a positive count. Retain a tiny primitive if the trial removes it entirely.
                if (simplified.length) {
                    indices = simplified;
                } else {
                    stats.emptyPrimitiveFallbacks++;
                }
            }
            const before = Uint32Array.from(indices);
            const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, true);
            assert.deepEqual(triangleKeys(before.map(i => remap[i])), triangleKeys(indices), 'triangle topology and winding preserved by reorder');
            for (const s of Object.values(streams)) {
                const data = Buffer.alloc(unique * s.size);
                for (let i = 0; i < s.accessor.count; i++) {
                    if (remap[i] < unique) {
                        s.data.copy(data, remap[i] * s.size, i * s.size, (i + 1) * s.size);
                        assert.ok(data.subarray(remap[i] * s.size, (remap[i] + 1) * s.size).equals(s.data.subarray(i * s.size, (i + 1) * s.size)));
                    }
                }
                s.data = data;
                s.accessor.count = unique;
            }
            stats.vertices += unique;
            stats.triangles += indices.length / 3;
            const outputPrimitive = doc.meshes[mi].primitives[pi];
            for (const [name, s] of Object.entries(streams)) {
                updateBounds(s);
                s.accessor.bufferView = addView(s.data, { mode: 'ATTRIBUTES', stride: s.size, count: unique, target: 34962 });
                delete s.accessor.byteOffset;
                outputPrimitive.attributes[name] = doc.accessors.length;
                doc.accessors.push(s.accessor);
            }
            const type = unique <= 65535 ? 5123 : 5125, size = sizes[type];
            const indexBytes = Buffer.alloc(indices.length * size);
            indices.forEach((v, i) => type === 5123 ? indexBytes.writeUInt16LE(v, i * size) : indexBytes.writeUInt32LE(v, i * size));
            outputPrimitive.indices = doc.accessors.length;
            doc.accessors.push({ bufferView: addView(indexBytes, { mode: 'TRIANGLES', stride: size, count: indices.length, target: 34963 }),
                componentType: type, count: indices.length, type: 'SCALAR' });
        }
    }
    assert.equal(stats.newCollapsedTriangles, 0, 'precision reduction must preserve fine triangle surfaces');
    assert.equal(stats.newReversedTriangles, 0, 'precision reduction must preserve face orientation');
    return { doc, contents, configurations, stats };
}

function serialize(doc, binary) {
    const json = Buffer.from(JSON.stringify(doc));
    const j = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 32)]);
    const b = Buffer.concat([binary, Buffer.alloc((4 - binary.length % 4) % 4)]);
    const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
    header.writeUInt32LE(0x46546c67);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(28 + j.length + b.length, 8);
    header.writeUInt32LE(j.length, 12);
    header.writeUInt32LE(0x4e4f534a, 16);
    binHeader.writeUInt32LE(b.length);
    binHeader.writeUInt32LE(0x004e4942, 4);
    return Buffer.concat([header, j, binHeader, b]);
}

function pack(model, compressed = true) {
    const doc = structuredClone(model.doc), chunks = [];
    let length = 0, decoded = 0;
    doc.bufferViews = [];
    doc.extensionsUsed = (doc.extensionsUsed ?? []).filter(e => e !== 'EXT_meshopt_compression');
    doc.extensionsRequired = (doc.extensionsRequired ?? []).filter(e => e !== 'EXT_meshopt_compression');
    for (const [id, data] of model.contents.entries()) {
        const cfg = model.configurations[id];
        let content = data, mode = cfg.mode;
        if (compressed && mode) {
            const encoded = mode === 'ATTRIBUTES'
                ? MeshoptEncoder.encodeVertexBufferLevel(data, cfg.count, cfg.stride, 3, 0)
                : MeshoptEncoder.encodeGltfBuffer(data, cfg.count, cfg.stride, mode, 0);
            if (encoded.length < data.length) {
                content = Buffer.from(encoded);
            } else {
                mode = undefined;
            }
        } else {
            mode = undefined;
        }
        const padding = Buffer.alloc((4 - length % 4) % 4);
        chunks.push(padding);
        length += padding.length;
        const view = { buffer: 0, byteOffset: length, byteLength: data.length, ...(cfg.target ? { target: cfg.target } : {}) };
        if (mode) {
            const checked = Buffer.alloc(data.length);
            MeshoptDecoder.decodeGltfBuffer(checked, cfg.count, cfg.stride, content, mode, 'NONE');
            // TRIANGLES can rotate a triangle's vertices; winding and full vertex tuples stay intact.
            if (mode === 'TRIANGLES') {
                const read = bytes => Uint32Array.from({ length: cfg.count }, (_, i) => cfg.stride === 2 ? bytes.readUInt16LE(i * 2) : bytes.readUInt32LE(i * 4));
                assert.deepEqual(triangleKeys(read(checked)), triangleKeys(read(data)));
            } else {
                assert.ok(checked.equals(data), 'attribute codec round trip must be byte-exact');
            }
            decoded += (4 - decoded % 4) % 4;
            view.buffer = 1;
            view.byteOffset = decoded;
            decoded += data.length;
            view.extensions = { EXT_meshopt_compression: { buffer: 0, byteOffset: length, byteLength: content.length,
                count: cfg.count, byteStride: cfg.stride, mode, filter: 'NONE' } };
        }
        if (cfg.attributeByteStride) {
            view.byteStride = cfg.attributeByteStride;
        }
        doc.bufferViews.push(view);
        chunks.push(content);
        length += content.length;
    }
    chunks.push(Buffer.alloc((4 - length % 4) % 4));
    const binary = Buffer.concat(chunks);
    doc.buffers = [{ byteLength: binary.length }];
    if (decoded) {
        doc.buffers.push({ byteLength: decoded, extensions: { EXT_meshopt_compression: { fallback: true } } });
        doc.extensionsUsed.push('EXT_meshopt_compression');
        doc.extensionsRequired.push('EXT_meshopt_compression');
    }
    return serialize(doc, binary);
}

export { optimize, pack };

/** Store the exact Int16 normal/tangent values that Nixie's renderer would upload. */
function compactVertexVectors(model) {
    const vectorIds = new Map();
    for (const mesh of model.doc.meshes) {
        for (const primitive of mesh.primitives) {
            for (const semantic of ['NORMAL', 'TANGENT']) {
                const id = primitive.attributes[semantic];
                if (id !== undefined) {
                    vectorIds.set(id, semantic);
                }
            }
        }
    }
    const converted = new Map();
    let decodedVertexBytesSaved = 0;
    for (const [id, semantic] of vectorIds) {
        const accessor = model.doc.accessors[id];
        const viewId = accessor.bufferView;
        const width = semantic === 'NORMAL' ? 3 : 4;
        assert.equal(accessor.componentType, 5126);
        assert.equal(accessor.type, `VEC${width}`);
        assert.equal(accessor.byteOffset ?? 0, 0);
        const key = `${viewId}:${width}`;
        let compactViewId = converted.get(key);
        if (compactViewId === undefined) {
            const original = model.contents[viewId];
            assert.equal(original.length, accessor.count * width * 4);
            const data = Buffer.alloc(accessor.count * 8);
            for (let vertex = 0; vertex < accessor.count; vertex++) {
                for (let component = 0; component < width; component++) {
                    const value = original.readFloatLE((vertex * width + component) * 4);
                    assert.ok(Number.isFinite(value));
                    data.writeInt16LE(Math.trunc(Math.max(-1, Math.min(1, value)) * 32767), vertex * 8 + component * 2);
                }
            }
            // Complete-view deduplication can make positions and normals share one view.
            // Preserve the original view if any non-vector accessor still needs its float data.
            const shared = model.doc.accessors.some((a, otherId) => a.bufferView === viewId && !vectorIds.has(otherId));
            compactViewId = shared ? model.contents.length : viewId;
            model.contents[compactViewId] = data;
            model.configurations[compactViewId] = { ...model.configurations[viewId], stride: 8, attributeByteStride: 8 };
            decodedVertexBytesSaved += shared ? -data.length : original.length - data.length;
            converted.set(key, compactViewId);
        }
        accessor.bufferView = compactViewId;
        accessor.componentType = 5122;
        accessor.normalized = true;
        delete accessor.min;
        delete accessor.max;
    }
    return { normalBits: 16, tangentBits: 16, convertedViews: converted.size, decodedVertexBytesSaved };
}

/** Opt-in packing for a baked, embedded, uncompressed static glTF. */
export async function optimizeSpatialGeometry(document, binary, profile = 'precision16') {
    assert.ok(['precision16', 'curved50-compact16'].includes(profile), `Unknown geometry profile: ${profile}`);
    assert.ok(!document.skins?.length && !document.animations?.length, 'Precision packing requires a baked static model.');
    assert.ok(document.buffers?.length === 1 && !document.buffers[0].uri, 'Precision packing requires one embedded input buffer.');
    const views = document.bufferViews.map(view => {
        assert.ok(view.buffer === 0 && !view.extensions?.EXT_meshopt_compression, 'Precision packing requires decoded input views.');
        const start = view.byteOffset ?? 0;
        assert.ok(Number.isInteger(start) && start >= 0 && Number.isInteger(view.byteLength) && view.byteLength >= 0
            && start + view.byteLength <= binary.length, 'Input view is outside its embedded buffer.');
        return Buffer.from(binary.subarray(start, start + view.byteLength));
    });
    const compact = profile === 'curved50-compact16';
    const model = optimize({ doc: document, views }, { positionBits: 16, vectorBits: 12, uvBits: 16,
        ...(compact ? { simplify: 0.5, protectCurves: true, attributeWeight: 1 } : {}) });
    const compactVertexOptimization = compact ? compactVertexVectors(model) : undefined;
    const bytes = pack(model);
    const jsonLength = bytes.readUInt32LE(12);
    const packedDocument = JSON.parse(bytes.subarray(20, 20 + jsonLength));
    const packedBinary = bytes.subarray(28 + jsonLength);
    if (compactVertexOptimization?.convertedViews) {
        for (const key of ['extensionsUsed', 'extensionsRequired']) {
            packedDocument[key] = [...new Set([...(packedDocument[key] ?? []), 'KHR_mesh_quantization'])];
        }
    }
    Object.assign(document, packedDocument);
    return { binary: packedBinary, bytesSaved: binary.length - packedBinary.length,
        decodedGeometryBytes: packedDocument.buffers[1]?.byteLength ?? 0,
        precisionOptimization: model.stats,
        ...(compactVertexOptimization ? { compactVertexOptimization } : {}) };
}

/** Preserve the accepted precision-only API and profile. */
export async function optimizeSpatialPrecision(document, binary) {
    return optimizeSpatialGeometry(document, binary, 'precision16');
}
