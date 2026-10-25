import {createHash} from 'node:crypto';
import {validateTarget,portablePath} from './asset-pack-publication.mjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = row => [row.decodedSha256,row.decodedBytes,row.mediaType].join(':');
const validHash = value => /^[a-f0-9]{64}$/.test(value);
const validSize = value => Number.isSafeInteger(value) && value >= 0 && value <= 512 * 1024 ** 2;

/** Metadata is discovered with LIST/HEAD; this helper cannot write to storage. */
export async function inspectExistingAssetObjects({target: input, transport, concurrency = 8, signal, onProgress = () => {}}) {
    const target = validateTarget(input);
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw Error('Invalid inspection concurrency');
    const listed = await transport.list(signal), objects = new Array(listed.length); let cursor = 0, completed = 0;
    await Promise.all(Array.from({length:Math.min(concurrency,listed.length)},async()=>{
        while(cursor < listed.length){
            signal?.throwIfAborted(); const index=cursor++, row=listed[index];
            portablePath(row.key); if (!row.key.startsWith(target.prefix+'/')) throw Error('Storage listing escaped target prefix');
            const metadata=await transport.head(row.key,signal);
            if(metadata) objects[index]={key:row.key,...metadata};
            if(++completed % 500===0) onProgress({phase:'inspect-existing',completed,total:listed.length});
        }
    }));
    return {schemaVersion:1,target,capturedAt:new Date().toISOString(),objects:objects.filter(Boolean).sort((a,b)=>a.key.localeCompare(b.key,'en'))};
}

export function existingAssetObjects(inventory, input) {
    const target = validateTarget(input), byIdentity = new Map(), byKey = new Map();
    if (inventory === undefined) return {byIdentity,byKey};
    if (inventory.schemaVersion!==1 || JSON.stringify(validateTarget(inventory.target))!==JSON.stringify(target)
        || !Array.isArray(inventory.objects) || inventory.objects.length>100000) throw Error('Existing-object inventory differs from publication target');
    for(const row of inventory.objects){
        portablePath(row.key); if(!row.key.startsWith(target.prefix+'/') || byKey.has(row.key)) throw Error('Invalid existing-object key');
        byKey.set(row.key,row);
        // Unversioned roots and mutable channels are not immutable asset candidates.
        if(!/[a-f0-9]{64}/.test(row.key) && !row.key.startsWith(target.prefix+'/releases/')) continue;
        if(!validHash(row.sha256)||!validHash(row.decodedSha256)||!validSize(row.bytes)||!validSize(row.decodedBytes)
            || !['image/webp','model/gltf-binary','application/json'].includes(row.mediaType)
            || ![undefined,'br','gzip'].includes(row.contentEncoding)
            || !/(?:^|,)\s*immutable\s*(?:,|$)/i.test(row.cacheControl??'')) continue;
        const key=identity(row), rows=byIdentity.get(key)??[]; rows.push(row); byIdentity.set(key,rows);
    }
    const priority = row => row.key.startsWith(target.prefix+'/objects/') ? 0 : row.key.startsWith(target.prefix+'/world/content/') ? 1 : 2;
    for(const rows of byIdentity.values()) rows.sort((a,b)=>priority(a)-priority(b)||a.key.length-b.key.length||a.key.localeCompare(b.key,'en'));
    return {byIdentity,byKey,proof:{sha256:hash(Buffer.from(JSON.stringify(inventory))),objects:inventory.objects.length,capturedAt:inventory.capturedAt}};
}
export const existingAssetIdentity = identity;
