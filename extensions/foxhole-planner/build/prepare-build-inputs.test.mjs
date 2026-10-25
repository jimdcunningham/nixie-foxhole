import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareBuildInputs,readVerifiedBuildInput,BUILD_INPUT_PATHS,assetPinIdentity} from './prepare-build-inputs.mjs';
const receipt=(url,bytes)=>({url,sha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length});
test('empty clean build input directory receives only verified JSON and rejects stale local files',async t=>{
 const output=await fs.mkdtemp(path.join(os.tmpdir(),'foxhole-build-inputs-'));t.after(()=>fs.rm(output,{recursive:true,force:true}));
 const bytes=Buffer.from('{"version":1}'),locations=new Map(BUILD_INPUT_PATHS.map(name=>[name,{url:'https://assets.test/'+name,entry:receipt('',bytes)}]));
 const pin={schemaVersion:1},requests=[];
 const fetcher=async url=>{requests.push(url);return new Response(bytes);};
 const first=await prepareBuildInputs({pin,output,library:{files:locations},fetcher});
 assert.equal(first.files,8);assert.equal(first.downloadedBytes,bytes.length*8);
 assert.equal((await prepareBuildInputs({pin,output,library:{files:locations},fetcher})).downloadedBytes,0);
 assert.equal(requests.length,8,'cached JSON is reused without another derived-metadata publication');
 await fs.writeFile(path.join(output,BUILD_INPUT_PATHS[0]),'changed');
 await assert.rejects(prepareBuildInputs({pin,output,library:{files:locations},fetcher}),/differs from pin/);
 await assert.rejects(readVerifiedBuildInput({...receipt('https://assets.test/input.json',bytes),byteLength:1},fetcher),/exceeds/);
 await assert.rejects(readVerifiedBuildInput({...receipt('https://assets.test/input.json',bytes),sha256:'a'.repeat(64)},fetcher),/integrity/);
});


test('identity checks work before SDK installation in prepared desktop jobs',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'foxhole-pin-only-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'build'));await fs.mkdir(path.join(root,'src'));
 await fs.copyFile(fileURLToPath(new URL('./prepare-build-inputs.mjs',import.meta.url)),path.join(root,'build/prepare-build-inputs.mjs'));
 const bytes=Buffer.from('{"schemaVersion":1}'),sha=createHash('sha256').update(bytes).digest('hex');await fs.writeFile(path.join(root,'src/catalog-release-pin.json'),bytes);
 const script=path.join(root,'build/prepare-build-inputs.mjs');
 const result=execFileSync(process.execPath,[script,'--identity-only','--expected',sha],{encoding:'utf8',env:{...process.env,GITHUB_OUTPUT:''}});
 assert.equal(JSON.parse(result).assetPin,sha);
 assert.throws(()=>execFileSync(process.execPath,[script,'--identity-only','--expected','0'.repeat(64)],{stdio:'pipe'}),/Command failed/);
});


test('asset pin identity ignores checkout line endings and JSON whitespace',()=>{
 const linux=Buffer.from('{"schemaVersion":1,"url":"https://assets.test/index.json"}\n');
 const windows=Buffer.from('{\r\n  "schemaVersion": 1,\r\n  "url": "https://assets.test/index.json"\r\n}\r\n');
 assert.equal(assetPinIdentity(linux),assetPinIdentity(windows));
 assert.notEqual(assetPinIdentity(linux),assetPinIdentity(Buffer.from('{"schemaVersion":2,"url":"https://assets.test/index.json"}')));
});
