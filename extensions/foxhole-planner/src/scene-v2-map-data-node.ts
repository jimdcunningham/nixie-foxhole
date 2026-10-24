import {data, catalog} from '../build/catalog-node.ts';
export const foxholeMapResources = catalog.sharedResources.filter(row => row.id.startsWith('map.'))
    .map(row => ({...row, id: 'foxhole.map.' + row.id.slice(4)}));
export default data.maps;
