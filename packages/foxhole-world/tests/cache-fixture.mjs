export function memoryWorldCaches() {
    const namespaces = new Map(), writes = [], reads = [];
    const rows = name => {if (!namespaces.has(name)) namespaces.set(name,new Map()); return namespaces.get(name);};
    const key = value => typeof value === 'string' ? value : value.url;
    return {namespaces, writes, reads, rows, api: {open: async name => ({
        match: async value => {reads.push({name,key:key(value)}); return rows(name).get(key(value))?.clone();},
        keys: async () => [...rows(name).keys()].map(url => new Request(url)),
        put: async (value,response) => {writes.push({name,key:key(value)}); rows(name).set(key(value),response);},
        delete: async value => rows(name).delete(key(value)),
    })}};
}
