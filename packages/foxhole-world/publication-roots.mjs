import flags from './authoring/native-flag-textures.json' with {type:'json'};
import smoke from './authoring/native-smoke-texture.json' with {type:'json'};
import foliage from './authoring/native-foliage-masks.json' with {type:'json'};

/** Runtime adapters use these same authored descriptors. Keep their roots in publication/retention graphs. */
export function worldRuntimePublicationRoots() {
    return [
        ...Object.entries(flags.textures).map(([team, ref]) => ({...ref, id: `faction-flag:${team}`})),
        {...smoke, id: 'smoke-cloud-mask'},
        ...foliage.materials.map((row, index) => ({...row.resource, path: `world/${row.resource.path}`, id: `foliage-mask:${index}`})),
    ];
}
