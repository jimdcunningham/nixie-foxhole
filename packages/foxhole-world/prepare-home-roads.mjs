import fs from 'node:fs/promises';
import path from 'node:path';

const float = 5126, unsigned = 5125;
export async function prepareHomeRoads(native) {
    const root = path.join(native, 'roads');
    const [vertexBytes, indexBytes, metadata] = await Promise.all([
        fs.readFile(path.join(root, 'vertices.bin')),
        fs.readFile(path.join(root, 'indices.bin')),
        fs.readFile(path.join(root, 'roads.json'), 'utf8').then(JSON.parse),
    ]);
    const count = vertexBytes.length / 20;
    if (metadata.errors.length || !Number.isInteger(count) || indexBytes.length % 12) throw Error('Incomplete FoxWatch road extraction');
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), uvs = new Float32Array(count * 2);
    const min = [Infinity,Infinity,Infinity], max = [-Infinity,-Infinity,-Infinity];
    for (let i = 0; i < count; i++) {
        const at = vertexBytes.subarray(i * 20, i * 20 + 20);
        positions.set([at.readFloatLE(0), at.readFloatLE(4), -at.readFloatLE(8)], i * 3);
        for (let axis = 0; axis < 3; axis++) {
            const x = positions[i * 3 + axis];
            min[axis] = Math.min(min[axis],x);
            max[axis] = Math.max(max[axis],x);
        }
        uvs.set([at.readFloatLE(12), at.readFloatLE(16)], i * 2);
    }
    const indices = new Map();
    for (const component of metadata.components) for (const section of component.sections) {
        const list = indices.get(section.material) ?? [];
        if (section.count % 3 || section.start + section.count > component.indexCount) throw Error('Invalid road material section');
        const from = component.indexOffset + section.start;
        for (let i = from; i < from + section.count; i += 3) {
            const a = indexBytes.readUInt32LE(i * 4), b = indexBytes.readUInt32LE(i * 4 + 8), c = indexBytes.readUInt32LE(i * 4 + 4);
            if (Math.max(a,b,c) >= count) throw Error('Road index out of range');
            list.push(a,b,c);
            const ux=positions[b*3]-positions[a*3], uy=positions[b*3+1]-positions[a*3+1], uz=positions[b*3+2]-positions[a*3+2];
            const vx=positions[c*3]-positions[a*3], vy=positions[c*3+1]-positions[a*3+1], vz=positions[c*3+2]-positions[a*3+2];
            const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
            for (const j of [a,b,c]) { normals[j*3]+=nx; normals[j*3+1]+=ny; normals[j*3+2]+=nz; }
        }
        indices.set(section.material,list);
    }
    if ([...indices.values()].reduce((n,list)=>n+list.length,0) !== indexBytes.length/4) throw Error('Incomplete road material coverage');
    for (let i = 0; i < normals.length; i += 3) {
        const len = Math.hypot(normals[i],normals[i+1],normals[i+2]);
        if (len > 0) for (let a = 0; a < 3; a++) normals[i+a] /= len;
        else normals[i+1] = 1;
    }
    const doc = {asset:{version:'2.0',generator:'FoxWatch home region prep'},scene:0,scenes:[{nodes:[0]}],
        nodes:[{name:'Native Home Roads',mesh:0}],meshes:[{primitives:[]}],materials:[],images:[],textures:[],
        bufferViews:[],accessors:[],buffers:[{byteLength:0}]};
    const chunks = [];
    let offset = 0;
    function view(data, target) {
        const index = doc.bufferViews.length;
        const pad = (4 - data.byteLength % 4) % 4;
        doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:data.byteLength,...(target ? {target} : {})});
        chunks.push(Buffer.from(data.buffer,data.byteOffset,data.byteLength));
        if (pad) chunks.push(Buffer.alloc(pad));
        offset += data.byteLength + pad;
        return index;
    }
    function accessor(data, componentType, type, count, bounds) {
        const index = doc.accessors.length;
        doc.accessors.push({bufferView:view(data,componentType===unsigned?34963:34962),componentType,type,count,...bounds});
        return index;
    }
    const attributes = {POSITION:accessor(positions,float,'VEC3',count,{min,max}),
        NORMAL:accessor(normals,float,'VEC3',count),TEXCOORD_0:accessor(uvs,float,'VEC2',count)};
    const textureIds = new Map();
    async function texture(file) {
        if (!textureIds.has(file)) {
            const source = doc.images.length;
            doc.images.push({bufferView:view(await fs.readFile(path.join(native,file))),mimeType:'image/png'});
            textureIds.set(file,doc.textures.length);
            doc.textures.push({source});
        }
        return {index:textureIds.get(file)};
    }
    for (const [key, list] of indices) {
        const source = metadata.materials[key];
        const material = doc.materials.length;
        const pbr = {metallicFactor:0,roughnessFactor:1};
        if (source?.file) pbr.baseColorTexture = await texture(source.file);
        else pbr.baseColorFactor = [.52,.45,.37,1];
        doc.materials.push({name:key.split('/').at(-1),doubleSided:true,pbrMetallicRoughness:pbr,
            ...(source?.normalFile ? {normalTexture:await texture(source.normalFile)} : {})});
        doc.meshes[0].primitives.push({attributes,indices:accessor(Uint32Array.from(list),unsigned,'SCALAR',list.length),material});
    }
    doc.buffers[0].byteLength = offset;
    const json = Buffer.from(JSON.stringify(doc));
    const padding = Buffer.alloc((4 - json.length % 4) % 4,32);
    const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
    header.writeUInt32LE(0x46546c67,0); header.writeUInt32LE(2,4);
    header.writeUInt32LE(28+json.length+padding.length+offset,8);
    header.writeUInt32LE(json.length+padding.length,12); header.writeUInt32LE(0x4e4f534a,16);
    binHeader.writeUInt32LE(offset,0); binHeader.writeUInt32LE(0x004e4942,4);
    return Buffer.concat([header,json,padding,binHeader,...chunks]);
}
