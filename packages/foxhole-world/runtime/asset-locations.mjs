let locations=null;
/** Trusted compiled integration only; viewer defaults remain self-contained. */
export function configureWorldAssetLocations(value){locations=value;}
export function hasPinnedWorldAssets(){return locations!==null;}
export function resolveWorldAsset(baseUrl,path){return locations?locations.resolve(path):new URL(path,new URL('../',new URL(baseUrl,globalThis.location?.href))).href;}
export function fetchWorldAsset(url,options){return locations?locations.fetch(String(url),options):fetch(url,options);}

export function retainWorldAsset(url){return locations?.retain?.(String(url))??(()=>{});}
