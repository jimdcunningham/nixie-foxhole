import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const json = async file => JSON.parse(await fs.readFile(file,'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const lower = value => value?.toLowerCase() ?? '';
const textureAt = (material, names) => names.map(name => material?.textures[name]?.path).find(Boolean);
const baseNames = ['PM_Diffuse','Albedo','Diffuse','Diffuse 1','Base Color','BaseColor','A','a','A-Base'];
const normalNames = ['PM_Normals','Normal','Normals 1','Normal Map','N','N-Base'];

export async function prepareHomeModelWriter(native, sourceRoot, add) {
    const sources = new Map((await json(path.join(sourceRoot,'material-source.json'))).map(row => [row.path,row.file]));
    const inspection = (await json(path.join(sourceRoot,'material-inspection.json'))).materials;
    const materials = new Map();
    for (const material of inspection) {
        const key = lower(material.name);
        const matches = materials.get(key) ?? [];
        matches.push(material);
        materials.set(key,matches);
    }
    const deferred = new Map((await json(path.join(native,'deferred-textures.json'))).map(row => [row.file,row.source]));
    const registered = new Set();
    const prepared = new Map();
    async function resource(file, data) {
        if (!registered.has(file)) {
            await add(file,data);
            registered.add(file);
        }
    }
    async function resolveTexture(source) {
        const file = sources.get(source);
        if (!file) return;
        const key = 'model-textures/' + hash(source) + '.png';
        if (!registered.has(key)) await resource(key, await fs.readFile(path.join(sourceRoot,file)));
        return '../' + key;
    }
    return async function prepareModel(prototype) {
        const id = hash(JSON.stringify([prototype.file,prototype.materials]));
        if (prepared.has(id)) return prepared.get(id);
        const bytes = await fs.readFile(path.join(native,prototype.file));
        const jsonSize = bytes.readUInt32LE(12);
        const doc = JSON.parse(bytes.subarray(20,20+jsonSize));
        const binary = bytes.subarray(28+jsonSize);
        if (bytes.readUInt32LE(0) !== 0x46546c67 || bytes.readUInt32LE(20+jsonSize) !== binary.length
            || doc.buffers?.length !== 1 || doc.images?.length) throw Error('Unexpected native model layout: '+prototype.file);
        const binaryName = hash(binary) + '.bin';
        doc.buffers[0].uri = binaryName;
        await resource('models/'+binaryName,binary);
        doc.images = [];
        doc.textures = [];
        const textureIds = new Map();
        async function bind(source) {
            if (!source) return;
            if (!textureIds.has(source)) {
                const uri = await resolveTexture(source);
                if (!uri) return;
                textureIds.set(source,doc.textures.length);
                doc.textures.push({source:doc.images.length});
                doc.images.push({uri});
            }
            return {index:textureIds.get(source)};
        }
        for (const material of doc.materials ?? []) {
            const slot = prototype.materials?.find(row => lower(row.name) === lower(material.name));
            const matches = materials.get(lower(slot?.name ?? material.name)) ?? [];
            const inspected = matches.find(row => lower(row.path) === lower(slot?.source))
                ?? matches.find(row => slot?.diffuse && Object.values(row.textures).some(texture => texture?.path === deferred.get(slot.diffuse)))
                ?? (matches.length === 1 ? matches[0] : undefined);
            const diffuse = deferred.get(slot?.diffuse) ?? textureAt(inspected,baseNames);
            const normal = deferred.get(slot?.normal) ?? textureAt(inspected,normalNames);
            const pbr = material.pbrMetallicRoughness ??= {};
            const colorTexture = await bind(diffuse);
            const normalTexture = await bind(normal);
            if (diffuse && !colorTexture && deferred.has(slot?.diffuse)) throw Error('Missing extracted model texture '+diffuse);
            if (normal && !normalTexture && deferred.has(slot?.normal)) throw Error('Missing extracted model normal '+normal);
            if (colorTexture) {
                pbr.baseColorTexture = colorTexture;
                pbr.baseColorFactor = [1,1,1,1];
            } else {
                const color = inspected?.colors?.BaseColor ?? inspected?.colors?.Color ?? inspected?.colors?.Tint;
                if (/^Black(?:_\d+)?$/i.test(material.name)) pbr.baseColorFactor = [.02,.02,.02,1];
                if (color && [color.R,color.G,color.B].every(Number.isFinite)) pbr.baseColorFactor = [color.R,color.G,color.B,1];
            }
            if (normalTexture) material.normalTexture = normalTexture;
            if (slot?.masked || inspected?.blend === 'BLEND_Masked') {
                material.alphaMode = 'MASK';
                material.alphaCutoff = .5;
            }
            pbr.metallicFactor = 0;
            pbr.roughnessFactor = 1;
        }
        const file = 'models/'+id+'.gltf';
        await resource(file,Buffer.from(JSON.stringify(doc)));
        prepared.set(id,file);
        return file;
    };
}

export async function writeHomeModelRequests(nativeRoot, sourceRoot) {
    const requests = new Set(), names = new Set();
    for (const region of ['homeregionc','homeregionw']) {
        const native = path.join(nativeRoot,region);
        for (const texture of await json(path.join(native,'deferred-textures.json'))) requests.add(texture.source);
        for (const file of ['scene-full.json','scene-extra.json','scene-bridges.json']) {
            for (const prototype of (await json(path.join(native,file))).prototypes) {
                for (const slot of prototype.materials ?? []) if (slot.name) names.add(slot.name);
            }
        }
    }
    await fs.mkdir(sourceRoot,{recursive:true});
    await fs.writeFile(path.join(sourceRoot,'material-names.json'),JSON.stringify([...names]));
    const inspectionPath = path.join(sourceRoot,'material-inspection.json');
    const inspection = await json(inspectionPath).catch(error => {if(error.code!=='ENOENT')throw error;return {materials:[]};});
    for (const material of inspection.materials) {
        for (const source of [textureAt(material,baseNames),textureAt(material,normalNames)]) if (source) requests.add(source);
    }
    await fs.writeFile(path.join(sourceRoot,'material-texture-requests.json'),JSON.stringify([...requests]));
}
