export function isDestroyedTrenchConnectorId(id) {
    return /^trenchconnectordestroyedt[123]$/iu.test(String(id ?? '').trim());
}

export function hasAuthoredDestroyedTrenchConnectorLayers(structure) {
    return isDestroyedTrenchConnectorId(structure?.id)
        && Array.isArray(structure.renderLayers)
        && structure.renderLayers.some(layer => String(layer?.componentName ?? '').trim());
}
