import {Assets} from 'pixi.js';
import native from '../authoring/native-smoke-texture.json' with {type:'json'};
export async function nativeSmokeCloudTexture(baseUrl,{loadTexture=url=>Assets.load(url),onAsset=()=>{}}={}){
 const url=new URL(native.path,new URL('../',new URL(baseUrl,globalThis.location?.href))).href;onAsset(url);
 const texture=await loadTexture(url);texture.source.alphaMode='no-premultiply-alpha';texture.source.style.addressMode='repeat';return texture;
}
