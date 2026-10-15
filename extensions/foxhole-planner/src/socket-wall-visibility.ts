/** Construction sockets connect for snapping, but never open finished walls. */
export function canFoxholeSocketConnectionOpenWalls(selfKey: unknown, neighborKey: unknown): boolean {
    const isBuildSite = (key: unknown) => String(key ?? '').trim().toLowerCase().includes('buildsite');
    return !isBuildSite(selfKey) && !isBuildSite(neighborKey);
}
