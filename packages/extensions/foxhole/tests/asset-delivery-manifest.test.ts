import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {foxholeManifestSchema} from '../app/plugins/foxhole/nixie/manifest-schema.ts';
function fixture() {
    const raw=JSON.parse(readFileSync(new URL('../public/foxhole/assets/manifest.v1.json',import.meta.url),'utf8'));
    raw.assets=[structuredClone(raw.assets.find((asset:{id:string})=>asset.id==='hospital'))];
    const asset=raw.assets[0];asset.colors=[];delete asset.destroyed;delete asset.previewUrl;delete asset.previewIconUrl;delete asset.renderedIconUrl;
    asset.icons={default:asset.icons.default};
    return raw;
}
test('private hydration uses a declared rendered icon and otherwise the default without inventing image paths',()=>{
    const raw=fixture(),defaultIcon=raw.assets[0].icons.default;
    const fallback=foxholeManifestSchema.parse(raw).assets[0]!;
    assert.equal(fallback.icons?.rendered,undefined);assert.equal(fallback.previewUrl,defaultIcon);
    const rendered='/foxhole/assets/types/structures/hospital/hospital.icon.rendered.webp';
    raw.assets[0].icons.rendered=rendered;
    const available=foxholeManifestSchema.parse(raw).assets[0]!;
    assert.equal(available.icons?.rendered,rendered);assert.equal(available.previewUrl,rendered);
    raw.assets[0].icons={};
    const placeholder=foxholeManifestSchema.parse(raw).assets[0]!;
    assert.equal(placeholder.icons?.rendered,undefined);assert.equal(placeholder.previewUrl,undefined);
});
test('shared modification previews alias declared rendered icons and do not infer renderability',()=>{
    const raw=fixture(),rendered='/foxhole/assets/shared/modifications/fixture/icon.rendered.webp',defaultIcon='/foxhole/assets/shared/modifications/fixture/icon.default.webp';
    raw.shared.modifications={fixture:{icons:{default:defaultIcon,rendered},sprite:{source:'/foxhole/assets/shared/modifications/fixture/texture.webp',width:10,height:10}}};
    const actual=foxholeManifestSchema.parse(raw).shared.modifications.fixture!;
    assert.equal(actual.previewUrl,rendered);assert.equal(actual.icons?.rendered,rendered);
    delete raw.shared.modifications.fixture.icons.rendered;
    const fallback=foxholeManifestSchema.parse(raw).shared.modifications.fixture!;
    assert.equal(fallback.previewUrl,defaultIcon);assert.equal(fallback.icons?.rendered,undefined);
});
