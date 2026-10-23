import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
export const BUILD_INPUT_PATHS=['manifest.v1.json','models/manifest.v1.json','maps/map-data.v1.json',
    ...['de','fr','pt','ru','zh'].map(locale=>'localizations/'+locale+'.json')];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function readVerifiedBuildInput(receipt,fetcher=fetch){
    const response=await fetcher(receipt.url,{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok||!response.body||receipt.byteLength>8*1024**2)throw Error('Build input unavailable or oversized');
    const chunks=[];let length=0;
    for await(const chunk of response.body){length+=chunk.length;if(length>receipt.byteLength)throw Error('Build input exceeds receipt');chunks.push(chunk);}
    const bytes=Buffer.concat(chunks);
    if(length!==receipt.byteLength||hash(bytes)!==receipt.sha256)throw Error('Build input integrity mismatch');
    return bytes;
}
export async function prepareBuildInputs({pin,output,library,fetcher=fetch}){
    if(!pin.buildMetadata)throw Error('Publish derived Planner build metadata first');
    library??=await (await import('../src/asset-release.ts')).loadFoxholeAssetRelease(pin.publication);
    let downloadedBytes=0,reusedBytes=0;
    for(const name of BUILD_INPUT_PATHS){
        const location=library.files.get(name);if(!location)throw Error('Missing published build input: '+name);
        const receipt={url:location.url,sha256:location.entry.sha256,byteLength:location.entry.byteLength};
        const destination=path.join(output,name);
        const previous=await fs.readFile(destination).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
        if(previous){if(previous.length!==receipt.byteLength||hash(previous)!==receipt.sha256)throw Error('Existing build input differs from pin: '+name);reusedBytes+=previous.length;continue;}
        const bytes=await readVerifiedBuildInput(receipt,fetcher);JSON.parse(bytes);
        await fs.mkdir(path.dirname(destination),{recursive:true});
        const temporary=destination+'.'+randomUUID()+'.tmp';await fs.writeFile(temporary,bytes,{flag:'wx'});await fs.rename(temporary,destination);
        downloadedBytes+=bytes.length;
    }
    // Verify the derived document before a build can depend on its pin.
    await readVerifiedBuildInput(pin.buildMetadata,fetcher);
    return {files:BUILD_INPUT_PATHS.length,downloadedBytes,reusedBytes};
}
async function run(){
    const {values}=parseArgs({options:{output:{type:'string'},expected:{type:'string'},'identity-only':{type:'boolean'}}});
    const extension=path.resolve(import.meta.dirname,'..');
    const bytes=await fs.readFile(path.join(extension,'src/asset-release-pin.json')),assetPin=hash(bytes);
    if(values.expected&&values.expected!==assetPin)throw Error('Requested asset pin differs from the pinned source revision');
    const started=performance.now();
    const result=values['identity-only']?{}:await prepareBuildInputs({pin:JSON.parse(bytes),output:path.resolve(values.output??path.join(extension,'../../packages/extensions/foxhole/public/foxhole/assets'))});
    console.log(JSON.stringify({assetPin,...result,seconds:(performance.now()-started)/1000}));
    if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,'pin='+assetPin+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await run();
