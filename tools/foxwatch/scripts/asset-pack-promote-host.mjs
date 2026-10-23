import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {brotliCompressSync,constants} from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {acquireProcessLock} from './process-lock.mjs';
import {readPublicationConfig,publishAssetPublication} from './asset-pack-publisher.mjs';
import {validateTarget} from './asset-pack-publication.mjs';
import {createAssetPublicationS3} from './asset-pack-s3.mjs';
import {loadAssetPublicationCredentials} from './asset-pack-credentials.mjs';
import {readPinnedAssetJson,loadFoxholeAssetRelease} from '../../../extensions/foxhole-planner/src/asset-release.ts';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function retargetRelease(release,oldDirectory,newDirectory){
    const copy=structuredClone(release);
    const move=url=>{if(!url.startsWith(oldDirectory))throw Error('Release URL escapes the existing publication');return newDirectory+url.slice(oldDirectory.length);};
    copy.worldBaseUrl=move(copy.worldBaseUrl);
    for(const row of Object.values(copy.packs)){row.pack.manifest.url=move(row.pack.manifest.url);row.mapping.url=move(row.mapping.url);}
    return copy;
}
export async function prepareHostPromotion({pin,target,outputRoot,read=readPinnedAssetJson}){
    validateTarget(target);
    const oldDirectory=new URL('./',pin.publication.url).href,newDirectory=new URL(target.prefix+'/',target.publicBaseUrl).href;
    const root=retargetRelease(await read(pin.publication),oldDirectory,newDirectory);
    const decoded=Buffer.from(JSON.stringify(root)),encoded=brotliCompressSync(decoded,{params:{[constants.BROTLI_PARAM_QUALITY]:5}});
    const rootKey='release-'+hash(encoded)+'.json';
    const publication={url:new URL(rootKey,newDirectory).href,sha256:hash(decoded),byteLength:decoded.length};
    const derived=await read(pin.buildMetadata);derived.publicationSha256=publication.sha256;
    const derivedBytes=Buffer.from(JSON.stringify(derived)),derivedHash=hash(derivedBytes);
    const derivedKey='objects/raw/'+derivedHash+'/'+hash(Buffer.from('application/json')).slice(0,12)+'/asset.json';
    const buildMetadata={url:new URL(derivedKey,newDirectory).href,sha256:derivedHash,byteLength:derivedBytes.length};
    const resourcePack=structuredClone(pin.resourcePack);resourcePack.manifest.url=new URL(resourcePack.manifest.url).href.replace(oldDirectory,newDirectory);
    const directory=path.join(outputRoot,'host-promotion-'+randomUUID());await fs.mkdir(path.join(directory,'payload'),{recursive:true});
    const objects=[];
    for(const row of [{key:derivedKey,bytes:derivedBytes,decoded:derivedBytes,phase:'assets'},{key:rootKey,bytes:encoded,decoded,phase:'release',contentEncoding:'br'}]){
        const sha256=hash(row.bytes),file='payload/'+sha256+'.bin';await fs.writeFile(path.join(directory,file),row.bytes,{flag:'wx'});
        objects.push({relativeKey:row.key,phase:row.phase,sha256,bytes:row.bytes.length,mediaType:'application/json',...(row.contentEncoding?{contentEncoding:row.contentEncoding}:{}),
            decodedSha256:hash(row.decoded),decodedBytes:row.decoded.length,key:target.prefix+'/'+row.key,file,cacheControl:'public, max-age=31536000, immutable'});
    }
    const plan={schemaVersion:1,target,inventorySha256:pin.publication.sha256,release:publication,objects,
        summary:{sourceFiles:2,objects:2,bytes:objects.reduce((n,row)=>n+row.bytes,0),packs:Object.keys(root.packs).length}};
    await fs.writeFile(path.join(directory,'plan.json'),JSON.stringify({...plan,planSha256:hash(Buffer.from(JSON.stringify(plan)))},null,2)+'\n');
    return {directory,planPath:path.join(directory,'plan.json'),pin:{...pin,publication,resourcePack,buildMetadata}};
}
async function run(){
    const {values}=parseArgs({options:{'public-base-url':{type:'string'},upload:{type:'boolean'}}});
    if(!values['public-base-url'])throw Error('Pass --public-base-url https://assets.example.com/');
    const root=path.resolve(import.meta.dirname,'../../..'),configPath=path.join(root,'tools/foxwatch/local/asset-publication.json');
    const config=await readPublicationConfig(configPath,root),pinPath=path.join(root,'extensions/foxhole-planner/src/asset-release-pin.json');
    const pin=JSON.parse(await fs.readFile(pinPath,'utf8')),target=validateTarget({...config.target,publicBaseUrl:values['public-base-url']});
    const prepared=await prepareHostPromotion({pin,target,outputRoot:config.outputRoot});
    if(values.upload){
        if(config.credentialEnvFile)process.loadEnvFile(path.resolve(root,config.credentialEnvFile));
        const transport=createAssetPublicationS3(target,await loadAssetPublicationCredentials(config,root));
        try{await publishAssetPublication({planPath:prepared.planPath,transport});}finally{transport.close();}
        await loadFoxholeAssetRelease(prepared.pin.publication);await readPinnedAssetJson(prepared.pin.buildMetadata);
        await readPinnedAssetJson(prepared.pin.resourcePack.manifest);
        await fs.writeFile(pinPath,JSON.stringify(prepared.pin,null,2)+'\n');
        const local=JSON.parse(await fs.readFile(configPath,'utf8'));local.target=target;
        await fs.writeFile(configPath,JSON.stringify(local,null,2)+'\n');
        await fs.writeFile(path.join(config.outputRoot,'latest-plan.json'),JSON.stringify({planPath:prepared.planPath},null,2)+'\n');
    }
    console.log(JSON.stringify({status:values.upload?'promoted':'prepared',...prepared}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const release=acquireProcessLock(path.resolve(import.meta.dirname,'../tmp/foxwatch-refresh.lock.json'),'FoxWatch host promotion');try{await run();}finally{release();}
}
