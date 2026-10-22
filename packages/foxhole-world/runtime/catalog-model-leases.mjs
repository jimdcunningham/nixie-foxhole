import {Assets} from 'pixi.js';
import {loadCatalogModel} from './catalog-model.mjs';
import {createSourceLeasePool} from './source-leases.mjs';
const pool=createSourceLeasePool();
export const createCatalogModelLease=({load=loadCatalogModel,unload=url=>Assets.unload(url)}={})=>pool.lease({load,unload});
