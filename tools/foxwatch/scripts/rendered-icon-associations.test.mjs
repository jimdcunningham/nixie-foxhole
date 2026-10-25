import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import sharp from 'sharp';
import {normalizeRenderedIconAssociations, publishedRenderedIconValidator} from './rendered-icon-associations.mjs';
test('Hospital, destroyed badges and no-model assets reuse real icons without separate previews', async t => {
    const root=await fs.mkdtemp(path.join(tmpdir(),'foxwatch-icons-'));
    t.after(()=>fs.rm(root,{recursive:true,force:true}));
    const url=name=>'/foxhole/assets/'+name;
    const normal='types/structures/hospital/hospital.icon.rendered.webp';
    const destroyed='types/structures/hospital/hospital.destroyed.icon.rendered.webp';
    for(const file of [normal,destroyed]){
        await fs.mkdir(path.dirname(path.join(root,file)),{recursive:true});
        await sharp({create:{width:256,height:256,channels:4,background:file===normal?'#427044':'#ff0000'}}).webp({lossless:true}).toFile(path.join(root,file));
    }
    const manifest={assets:[{id:'hospital',icons:{default:url(normal.replace('.icon.rendered','.icon.default'))},previewUrl:url(normal.replace('.icon.rendered','.preview')),
        destroyed:{icons:{default:url(destroyed.replace('.icon.rendered','.icon.default')),rendered:url(destroyed)},previewUrl:url(destroyed.replace('.icon.rendered','.preview'))}},
        {id:'resource',icons:{default:url('resource.icon.default.webp')},previewUrl:url('resource.preview.webp')} ]};
    const normalized=await normalizeRenderedIconAssociations(manifest,publishedRenderedIconValidator(root));
    assert.equal(normalized.assets[0].icons.rendered,url(normal));
    assert.equal(normalized.assets[0].previewUrl,url(normal));
    assert.equal(normalized.assets[0].destroyed.previewUrl,url(destroyed));
    assert.equal(normalized.assets[1].icons.rendered,undefined);
    assert.equal(normalized.assets[1].previewUrl,manifest.assets[1].icons.default);
    assert.equal(JSON.stringify(normalized).includes('.preview.webp'),false);
    assert.notDeepEqual(normalized,manifest,'source data is not mutated');
    const valid=publishedRenderedIconValidator(root);
    assert.equal(await valid('/foxhole/assets/../escape.webp'),false);
    assert.equal(await valid('https://evil.test/icon.webp'),false);
    const blank='blank.icon.rendered.webp';
    await sharp({create:{width:256,height:256,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).webp({lossless:true}).toFile(path.join(root,blank));
    assert.equal(await valid(url(blank)),false);
});

test('compact shared icons and destroyed/packaged textures are declared only when real outputs exist',async()=>{
 const shared='/foxhole/assets/shared/modifications/door-123456789abc/door-123456789abc';
 const base='/foxhole/assets/types/structures/hospital/hospital';
 const files=new Set([shared+'.icon.default.webp',shared+'.icon.rendered.webp',base+'.destroyed.texture.webp']);
 const input={shared:{modifications:{'door-123456789abc':{sprite:{width:10}}}},assets:[{id:'hospital',icons:{default:base+'.icon.default.webp'},destroyed:{sprite:{width:20}},packaged:{shippableType:'normal'}}]};
 const result=await normalizeRenderedIconAssociations(input,url=>files.has(url));
 assert.equal(result.shared.modifications['door-123456789abc'].icons.default,shared+'.icon.default.webp');
 assert.equal(result.shared.modifications['door-123456789abc'].icons.rendered,shared+'.icon.rendered.webp');
 assert.equal(result.shared.modifications['door-123456789abc'].previewUrl,shared+'.icon.rendered.webp');
 assert.equal(result.assets[0].destroyed.sprite.source,base+'.destroyed.texture.webp');
 assert.equal(result.assets[0].destroyed.icons,undefined,'a texture does not imply rendered icon availability');
 assert.equal(result.assets[0].packaged.sprite,undefined,'missing texture output is not invented');
 assert.equal(input.shared.modifications['door-123456789abc'].icons,undefined,'source remains unchanged');
});
