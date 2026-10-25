import {retainWorldAsset} from './asset-locations.mjs';
import {Assets} from 'pixi.js';
import {loadCatalogModel} from './catalog-model.mjs';
import {createSourceLeasePool} from './source-leases.mjs';
const pool=createSourceLeasePool();
export function createCatalogModelLease({load=loadCatalogModel,unload=url=>Assets.unload(url)}={}){
 const lease=pool.lease({load,unload}),held=new Map();let released=false;
 return {get(url){if(released)return lease.get(url);if(!held.has(url))held.set(url,retainWorldAsset(url));return lease.get(url);},
  release(){if(released)return;released=true;lease.release();for(const release of held.values())release();held.clear();}};
}
