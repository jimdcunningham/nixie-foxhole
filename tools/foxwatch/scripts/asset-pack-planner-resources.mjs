import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {brotliCompressSync, constants} from 'node:zlib';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {acquireProcessLock} from './process-lock.mjs';
import {parseNixieExperimentalAssetPackIndexV1} from '../../../extensions/foxhole-planner/build/remote-resource-bindings.ts';
import {readPublicationConfig, publishAssetPublication} from './asset-pack-publisher.mjs';
import {validateTarget} from './asset-pack-publication.mjs';
import {createAssetPublicationS3} from './asset-pack-s3.mjs';
import {loadAssetPublicationCredentials} from './asset-pack-credentials.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Publish one metadata-only overlay. Bulk bytes stay in the original immutable release. */
export async function preparePlannerResourcePublication({index,target,publication,outputRoot,payloads=[],buildMetadata}) {
    const decoded=Buffer.from(JSON.stringify(parseNixieExperimentalAssetPackIndexV1(index)));
    if(decoded.length>8*1024**2)throw Error('Planner runtime index exceeds its SDK budget');
    const encoded=brotliCompressSync(decoded,{params:{[constants.BROTLI_PARAM_QUALITY]:5}});
    const sha256=hash(encoded),relativeKey='planner-resources-'+sha256+'.json';
    const directory=path.join(outputRoot,'planner-resources-'+randomUUID());
    await fs.mkdir(path.join(directory,'payload'),{recursive:true});
    const object={relativeKey,phase:'release',sha256,bytes:encoded.length,mediaType:'application/json',contentEncoding:'br',
        decodedSha256:hash(decoded),decodedBytes:decoded.length,key:target.prefix+'/'+relativeKey,file:'payload/'+sha256+'.bin',
        cacheControl:'public, max-age=31536000, immutable'};
    await fs.writeFile(path.join(directory,object.file),encoded,{flag:'wx'});
    const resourcePack={contractVersion:1,id:'foxhole.runtime',manifest:{url:new URL(object.key,target.publicBaseUrl).href,sha256:object.decodedSha256,byteLength:decoded.length}};
    const objects=[];
    for(const payload of payloads) {
        const sha256=hash(payload.bytes),entry=index.assets.find(row=>row.path===payload.path);
        if(!entry||entry.sha256!==sha256||entry.byteLength!==payload.bytes.length)throw Error('Unindexed runtime payload');
        const file='payload/'+sha256+'.bin';await fs.writeFile(path.join(directory,file),payload.bytes);
        objects.push({relativeKey:payload.path,phase:'assets',sha256,bytes:payload.bytes.length,mediaType:entry.mediaType,
            decodedSha256:sha256,decodedBytes:payload.bytes.length,key:target.prefix+'/'+payload.path,file,cacheControl:object.cacheControl});
    }
    objects.push(object);
    const plan={schemaVersion:1,target,inventorySha256:publication.sha256,release:resourcePack.manifest,objects,
        summary:{sourceFiles:payloads.length,objects:objects.length,bytes:objects.reduce((sum,row)=>sum+row.bytes,0),packs:1}};
    await fs.writeFile(path.join(directory,'plan.json'),JSON.stringify({...plan,planSha256:hash(Buffer.from(JSON.stringify(plan)))},null,2)+'\n');
    await fs.writeFile(path.join(directory,'extension-pin.json'),JSON.stringify({schemaVersion:1,publication,resourcePack,...(buildMetadata?{buildMetadata}:{})},null,2)+'\n');
    return {directory,planPath:path.join(directory,'plan.json'),resourcePack};
}
async function run() {
    const {values}=parseArgs({options:{config:{type:'string'},upload:{type:'boolean'},'update-pin':{type:'boolean'}}});
    if(values['update-pin']&&!values.upload)throw Error('Updating the extension pin requires a successful upload');
    const root=path.resolve(import.meta.dirname,'../../..');
    const config=await readPublicationConfig(path.resolve(root,values.config??'tools/foxwatch/local/asset-publication.json'),root);
    const latest=JSON.parse(await fs.readFile(path.join(config.outputRoot,'latest-plan.json'),'utf8'));
    const plan=JSON.parse(await fs.readFile(latest.planPath,'utf8'));
    if(JSON.stringify(validateTarget(config.target))!==JSON.stringify(plan.target))throw Error('Config target differs from the prepared library; prepare a new publication');
    const publication=plan.release;
    const {loadFoxholeAssetRelease}=await import('../../../extensions/foxhole-planner/src/asset-release.ts');
    const {readSceneV2AssetSources,sceneV2RemoteResourceBindings}=await import('../../../extensions/foxhole-planner/vite.config.ts');
    const {createPlannerRemoteResourceIndex}=await import('../../../extensions/foxhole-planner/build/remote-resource-bindings.ts');
    const library=await loadFoxholeAssetRelease(publication);
    const sources=await readSceneV2AssetSources({deriveModelLayers:true});
    const {createBrowserAtlas}=await import('../../../extensions/foxhole-planner/build/browser-atlas-images.ts');
    const payloads=[];
    for(let start=0;start<sources.browserImageSources.length;start+=64) {
        const bytes=await createBrowserAtlas(sources.browserImageSources.slice(start,start+64).map(source=>path.resolve(config.assetsRoot,source.slice('/foxhole/assets/'.length))));
        const sha256=hash(bytes),key='objects/raw/'+sha256+'/'+hash(Buffer.from('image/webp')).slice(0,12)+'/asset.webp';
        const entry={path:key,sha256,byteLength:bytes.length,mediaType:'image/webp'};
        library.entries.set(key,entry);library.files.set('__planner/browser/'+start/64+'.webp',{url:new URL(config.target.prefix+'/'+key,config.target.publicBaseUrl).href,entry});
        if(!payloads.some(row=>row.path===key))payloads.push({path:key,bytes});
    }
    const extractorSource=await fs.readFile(path.join(root,'extensions/foxhole-planner/src/model-layer-nodes.ts'),'utf8');
    const modelLayers={schemaVersion:1,publicationSha256:publication.sha256,extractorSha256:hash(Buffer.from(extractorSource.replaceAll('\r\n','\n'))),models:{}};
    for(const model of sources.models){
        const asset=sources.metadata[model.assetId];
        if(!asset?.model||!/^Foundation/i.test(asset.codeName)||model.id!==model.assetId)continue;
        const bytes=await fs.readFile(path.join(config.assetsRoot,model.path));
        if(hash(bytes)!==library.files.get(model.path)?.entry.sha256)throw Error('Local foundation differs from publication: '+model.assetId);
        modelLayers.models[model.assetId]={path:model.path,...(asset.modelLayerNodes?{modelLayerNodes:asset.modelLayerNodes}:{}),
            ...(asset.foundationSurfaceZ!==undefined?{foundationSurfaceZ:asset.foundationSurfaceZ}:{})};
    }
    const metadataBytes=Buffer.from(JSON.stringify(modelLayers)),metadataHash=hash(metadataBytes);
    const metadataPath='objects/raw/'+metadataHash+'/'+hash(Buffer.from('application/json')).slice(0,12)+'/asset.json';
    library.entries.set(metadataPath,{path:metadataPath,sha256:metadataHash,byteLength:metadataBytes.length,mediaType:'application/json'});
    payloads.push({path:metadataPath,bytes:metadataBytes});
    const buildMetadata={url:new URL(config.target.prefix+'/'+metadataPath,config.target.publicBaseUrl).href,sha256:metadataHash,byteLength:metadataBytes.length};
    const index=createPlannerRemoteResourceIndex(sceneV2RemoteResourceBindings(sources),library);
    const prepared=await preparePlannerResourcePublication({index,target:config.target,publication,outputRoot:config.outputRoot,payloads,buildMetadata});
    if(values.upload) {
        if(config.credentialEnvFile)process.loadEnvFile(path.resolve(root,config.credentialEnvFile));
        const transport=createAssetPublicationS3(config.target,await loadAssetPublicationCredentials(config,root));
        try { await publishAssetPublication({planPath:prepared.planPath,transport,concurrency:config.concurrency??8,onProgress:progress=>console.log(JSON.stringify(progress))}); }
        finally {transport.close();}
        if(values['update-pin'])await fs.copyFile(path.join(prepared.directory,'extension-pin.json'),path.join(root,'extensions/foxhole-planner/src/asset-release-pin.json'));
    }
    console.log(JSON.stringify({status:values.upload?'published':'prepared',...prepared,indexEntries:index.assets.length}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const release=acquireProcessLock(path.resolve(import.meta.dirname,'../tmp/foxwatch-refresh.lock.json'),'FoxWatch asset publication');
 try{await run();}finally{release();}
}
