import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, resolve, relative, extname } from 'node:path';
import { VisualOutputCache } from './visual-output-cache.mjs';
import { writeJsonAtomic } from './pipeline-core.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

/** Resolve the same qualified paths and unique material names used by Blender. */
export class SpatialDependencies {
    constructor(root) { this.root = root; this.files = null; }
    async index() {
        if (!this.files) {
            const walk = async directory => (await Promise.all((await readdir(directory, { withFileTypes: true }))
                .map(entry => entry.isDirectory() ? walk(resolve(directory, entry.name)) : resolve(directory, entry.name)))).flat();
            this.files = await walk(this.root);
        }
        return this.files;
    }
    async asset(source) {
        if (!source) return null;
        const suffixes = [source.replaceAll('\\', '/').replace(/^\/+/, '')];
        if (suffixes[0].startsWith('assets/foxhole/')) suffixes.push(suffixes[0].slice(15));
        for (const suffix of suffixes) {
            const direct = resolve(this.root, suffix);
            try { if ((await stat(direct)).isFile()) return direct; } catch (error) { if (error.code !== 'ENOENT') throw error; }
            const match = (await this.index()).find(file => relative(this.root, file).replaceAll('\\', '/').toLowerCase().endsWith(suffix.toLowerCase()));
            if (match) return match;
        }
        return null;
    }
    async material(name) {
        const normalized = name.replace(/\.\d{3}$/, '').replaceAll('\\', '/');
        if (normalized.includes('/')) {
            if (normalized.startsWith('/') || normalized.includes(':') || normalized.split('/').some(part => part === '.' || part === '..')) return null;
            const extension = extname(normalized);
            if (extension && !['.uasset', '.json'].includes(extension.toLowerCase())) return null;
            const file = resolve(this.root, extension ? normalized.slice(0, -extension.length) + '.json' : normalized + '.json');
            try { return (await stat(file)).isFile() ? file : null; } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
        }
        const matches = (await this.index()).filter(file => basename(file).toLowerCase() === `${normalized}.json`.toLowerCase());
        return matches.length === 1 ? matches[0] : null;
    }
    async scene(document) {
        const dependencies = {};
        const add = async (label, file) => { dependencies[label] = file ? [file, hash(await readFile(file))] : null; };
        const names = new Set();
        for (const mesh of document.assets?.meshes ?? []) {
            const source = mesh.exportUrl || mesh.sourcePath;
            const file = await this.asset(source);
            await add(`mesh:${source}`, file);
            if (!file) throw new Error(`Missing spatial source mesh: ${source}`);
            const bytes = await readFile(file);
            const gltf = JSON.parse(extname(file).toLowerCase() === '.gltf' ? bytes.toString('utf8')
                : bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8'));
            for (const material of gltf.materials ?? []) if (material.name) names.add(material.name);
            for (const resource of [...gltf.images ?? [], ...gltf.buffers ?? []]) {
                if (!resource.uri || resource.uri.startsWith('data:')) continue;
                if (/^[a-z]+:/i.test(resource.uri)) throw new Error('Remote glTF resources cannot be content verified');
                await add(`gltf:${source}:${resource.uri}`, resolve(dirname(file), decodeURIComponent(resource.uri)));
            }
            if (mesh.materialSidecarNameOverride) names.add(mesh.materialSidecarNameOverride);
            for (const overrides of Object.values(mesh.materialSidecarNameOverridesByVariant ?? {})) {
                for (const name of Object.values(overrides)) if (name) names.add(name);
            }
        }
        for (const material of document.assets?.materials ?? []) {
            const source = material.exportUrl || material.sourcePath;
            if (source) await add(`asset:${source}`, await this.asset(source));
        }
        for (const name of [...names].sort()) {
            const file = await this.material(name);
            await add(`material:${name}`, file);
            if (!file) continue;
            const material = JSON.parse(await readFile(file, 'utf8'));
            for (const [key, reference] of Object.entries(material.Textures ?? {})) {
                if (reference) await add(`texture:${name}:${key}:${reference}`, await this.asset(reference.split('.')[0] + '.png'));
            }
        }
        return dependencies;
    }
}

export class SpatialModelCache {
    static async create(directory, sources, versions) {
        const cache = new SpatialModelCache();
        cache.directory = directory;
        cache.outputs = await VisualOutputCache.create(directory, sources, versions);
        return cache;
    }
    identity(id, inputs, settings, paths) {
        const metadataPath = resolve(this.directory, `${id}.metadata.json`);
        return { ...this.outputs.identity(id, [Buffer.from(JSON.stringify(inputs))], settings, [...paths, metadataPath]), metadataPath };
    }
    async lookup(identity) {
        if (!await this.outputs.matches(identity)) return null;
        return JSON.parse(await readFile(identity.metadataPath, 'utf8'));
    }
    async record(identity, metadata) {
        await writeJsonAtomic(identity.metadataPath, metadata);
        await this.outputs.record(identity);
    }
}
