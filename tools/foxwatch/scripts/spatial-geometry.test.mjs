import assert from 'node:assert/strict';
import test from 'node:test';
import { MeshoptDecoder } from 'meshoptimizer';
import { optimize, optimizeSpatialGeometry, optimizeSpatialPrecision } from './spatial-geometry.mjs';

function fixture() {
    const position = new Float32Array([-1.234567, 0, 0, 1.123456, 0, 0, 0.123456, 1.111111, 0,
        0, 0, 0, 0.000001, 0, 0, 0, 0.000001, 0]);
    const normal = Float32Array.from({ length: 18 }, (_, i) => i % 3 === 2 ? 1 : 0);
    const uv = Float32Array.from({ length: 12 }, (_, i) => (i * 0.137) % 1);
    const tangent = Float32Array.from({ length: 24 }, (_, i) => i % 4 === 0 || i % 4 === 3 ? 1 : 0);
    const colors = new Uint8Array(24).fill(123);
    const indices = new Uint16Array([0, 1, 2, 3, 4, 5]);
    const image = Buffer.from('unchanged embedded texture bytes');
    const data = [position, normal, uv, tangent, colors, indices, image].map(a => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
    const chunks = [], views = [];
    let length = 0;
    for (const bytes of data) {
        const padding = Buffer.alloc((4 - length % 4) % 4);
        chunks.push(padding, bytes);
        length += padding.length;
        views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
        length += bytes.length;
    }
    chunks.push(Buffer.alloc((4 - length % 4) % 4));
    const binary = Buffer.concat(chunks);
    const doc = { asset: { version: '2.0', extras: { nixieModelAnchor: { version: 1, width: 10, height: 10, depth: 10 } } },
        buffers: [{ byteLength: binary.length }], bufferViews: views,
        accessors: [
            { bufferView: 0, count: 6, componentType: 5126, type: 'VEC3', min: [-1.234567, 0, 0], max: [1.123456, 1.111111, 0] },
            { bufferView: 1, count: 6, componentType: 5126, type: 'VEC3' },
            { bufferView: 2, count: 6, componentType: 5126, type: 'VEC2' },
            { bufferView: 3, count: 6, componentType: 5126, type: 'VEC4' },
            { bufferView: 4, count: 6, componentType: 5121, normalized: true, type: 'VEC4' },
            { bufferView: 5, count: 6, componentType: 5123, type: 'SCALAR' },
        ],
        images: [{ bufferView: 6, mimeType: 'image/webp' }], textures: [{ extensions: { EXT_texture_webp: { source: 0 } } }],
        materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
        nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ material: 0, attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TANGENT: 3, COLOR_0: 4 }, indices: 5 }] }],
    };
    return { doc, binary, image };
}

function decodeViews(doc, binary) {
    return doc.bufferViews.map(view => {
        const extension = view.extensions?.EXT_meshopt_compression;
        if (!extension) {
            return binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
        }
        const output = Buffer.alloc(extension.count * extension.byteStride);
        MeshoptDecoder.decodeGltfBuffer(output, extension.count, extension.byteStride,
            binary.subarray(extension.byteOffset, extension.byteOffset + extension.byteLength), extension.mode, extension.filter);
        return output;
    });
}

test('precision16 keeps tiny nonzero faces, winding, attributes, textures and authored metadata', async () => {
    const { doc, binary, image } = fixture();
    const original = structuredClone(doc), originalBytes = Buffer.from(binary);
    const result = await optimizeSpatialPrecision(doc, binary);
    await MeshoptDecoder.ready;
    const views = decodeViews(doc, result.binary);
    const primitive = doc.meshes[0].primitives[0];
    assert.equal(result.precisionOptimization.triangles, 2);
    assert.equal(result.precisionOptimization.newCollapsedTriangles, 0);
    assert.equal(result.precisionOptimization.newReversedTriangles, 0);
    assert.ok(result.precisionOptimization.protectedFineDetailPositions >= 3);
    assert.ok(result.precisionOptimization.maxPositionErrorMetres < 0.0001);
    assert.ok(views[doc.images[0].bufferView].equals(image));
    for (const key of ['asset', 'nodes', 'materials', 'textures']) {
        assert.deepEqual(doc[key], original[key]);
    }
    const positions = views[doc.accessors[primitive.attributes.POSITION].bufferView];
    const indices = views[doc.accessors[primitive.indices].bufferView];
    for (let i = 0; i < 6; i += 3) {
        const ids = [0, 1, 2].map(k => indices.readUInt16LE((i + k) * 2));
        const points = ids.map(id => [0, 1, 2].map(k => positions.readFloatLE(id * 12 + k * 4)));
        const signedArea = (points[1][0] - points[0][0]) * (points[2][1] - points[0][1])
            - (points[1][1] - points[0][1]) * (points[2][0] - points[0][0]);
        assert.ok(signedArea > 0, 'both original faces retain positive winding and nonzero area');
    }
    const colors = views[doc.accessors[primitive.attributes.COLOR_0].bufferView];
    assert.ok(colors.every(value => value === 123));
    assert.ok(binary.equals(originalBytes));
});

test('unbaked, external, compressed and out-of-range inputs fail before mutating the input document', async () => {
    for (const mutate of [
        doc => {
            doc.skins = [{}];
        },
        doc => {
            doc.animations = [{}];
        },
        doc => {
            doc.buffers[0].uri = 'outside.bin';
        },
        doc => {
            doc.bufferViews[0].extensions = { EXT_meshopt_compression: {} };
        },
        doc => {
            doc.bufferViews[0].byteLength = 999999;
        },
    ]) {
        const { doc, binary } = fixture();
        mutate(doc);
        const original = structuredClone(doc);
        await assert.rejects(optimizeSpatialPrecision(doc, binary));
        assert.deepEqual(doc, original);
    }
});

test('combined profile keeps curved tiny faces and stores renderer-equivalent vectors with tangent handedness', async () => {
    const { doc, binary, image } = fixture();
    const normalView = doc.bufferViews[1], tangentView = doc.bufferViews[3];
    for (let vertex = 0; vertex < 6; vertex++) {
        const angle = vertex * 0.1;
        binary.writeFloatLE(Math.sin(angle), normalView.byteOffset + vertex * 12);
        binary.writeFloatLE(Math.cos(angle), normalView.byteOffset + vertex * 12 + 8);
        binary.writeFloatLE(vertex % 2 ? -1 : 1, tangentView.byteOffset + vertex * 16 + 12);
    }
    const source = { doc, views: decodeViews(doc, binary) };
    const curve = optimize(source, { positionBits: 16, vectorBits: 12, uvBits: 16, simplify: 0.5, protectCurves: true, attributeWeight: 1 });
    const before = structuredClone(doc);
    const result = await optimizeSpatialGeometry(doc, binary, 'curved50-compact16');
    const views = decodeViews(doc, result.binary);
    const primitive = doc.meshes[0].primitives[0], reference = curve.doc.meshes[0].primitives[0];
    assert.equal(result.precisionOptimization.triangles, curve.stats.triangles);
    assert.ok(result.precisionOptimization.curvatureLockedVertices >= 3);
    assert.equal(result.precisionOptimization.newCollapsedTriangles, 0);
    assert.equal(result.precisionOptimization.newReversedTriangles, 0);
    assert.ok(doc.extensionsRequired.includes('KHR_mesh_quantization'));
    assert.equal(result.compactVertexOptimization.convertedViews, 2);
    for (const name of ['POSITION', 'TEXCOORD_0', 'COLOR_0']) {
        assert.deepEqual(views[doc.accessors[primitive.attributes[name]].bufferView],
            curve.contents[curve.doc.accessors[reference.attributes[name]].bufferView]);
    }
    for (const name of ['NORMAL', 'TANGENT']) {
        const accessor = doc.accessors[primitive.attributes[name]];
        const floats = curve.contents[curve.doc.accessors[reference.attributes[name]].bufferView];
        const width = name === 'NORMAL' ? 3 : 4;
        assert.equal(accessor.componentType, 5122);
        assert.equal(accessor.normalized, true);
        assert.equal(doc.bufferViews[accessor.bufferView].byteStride, 8);
        const integers = views[accessor.bufferView];
        for (let vertex = 0; vertex < accessor.count; vertex++) {
            for (let component = 0; component < width; component++) {
                const value = floats.readFloatLE((vertex * width + component) * 4);
                assert.equal(integers.readInt16LE(vertex * 8 + component * 2), Math.trunc(Math.max(-1, Math.min(1, value)) * 32767));
            }
            if (name === 'NORMAL') {
                assert.equal(integers.readInt16LE(vertex * 8 + 6), 0);
            }
        }
    }
    assert.ok(views[doc.images[0].bufferView].equals(image));
    for (const name of ['asset', 'nodes', 'materials', 'textures']) {
        assert.deepEqual(doc[name], before[name]);
    }
});

test('compacting vectors preserves float positions when identical views were deduplicated', async () => {
    const { doc, binary } = fixture();
    // The same byte values can be authored as both positions and normals.
    const values = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1];
    values.forEach((value, index) => binary.writeFloatLE(value, doc.bufferViews[0].byteOffset + index * 4));
    doc.accessors[1].bufferView = 0;
    const original = { doc: structuredClone(doc), views: decodeViews(doc, binary) };
    const curve = optimize(original, { positionBits: 16, vectorBits: 12, uvBits: 16, simplify: 0.5, protectCurves: true, attributeWeight: 1 });
    const curvePrimitive = curve.doc.meshes[0].primitives[0];
    assert.equal(curve.doc.accessors[curvePrimitive.attributes.POSITION].bufferView,
        curve.doc.accessors[curvePrimitive.attributes.NORMAL].bufferView, 'fixture must exercise a shared float view');
    const result = await optimizeSpatialGeometry(doc, binary, 'curved50-compact16');
    const primitive = doc.meshes[0].primitives[0], reference = curve.doc.meshes[0].primitives[0];
    const views = decodeViews(doc, result.binary);
    const position = doc.accessors[primitive.attributes.POSITION];
    assert.equal(position.componentType, 5126);
    assert.notEqual(position.bufferView, doc.accessors[primitive.attributes.NORMAL].bufferView);
    assert.deepEqual(views[position.bufferView], curve.contents[curve.doc.accessors[reference.attributes.POSITION].bufferView]);
});

test('unknown packing profiles reject before mutation', async () => {
    const { doc, binary } = fixture(), original = structuredClone(doc);
    await assert.rejects(optimizeSpatialGeometry(doc, binary, 'simplify25'), /Unknown geometry profile/);
    assert.deepEqual(doc, original);
});
