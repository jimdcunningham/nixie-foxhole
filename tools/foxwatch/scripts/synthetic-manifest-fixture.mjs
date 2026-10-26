/** Authored synthetic schema input; never reads extracted game output. */
export function createSyntheticManifest(assets = [{id: 'fixture'}]) {
    return {
        schemaVersion: '1.0.0', source: {kind: 'foxwatch'}, categories: [], localizations: [],
        assets: assets.map(asset => ({
            codeName: 'SyntheticFixture', categoryId: 'structures',
            name: {id: 'fixture.name', fallback: 'Synthetic Fixture'},
            description: {id: 'fixture.description', fallback: ''}, ...asset,
        })),
    };
}
