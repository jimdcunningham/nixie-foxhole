import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { NixieSceneV2ComponentHost } from '../../../nixie/desktop-extensions/scene-v2-component-host.ts';
import { NIXIE_SCENE_V2_CORE_COMPONENTS } from '../../../nixie/desktop-extensions/scene-v2-core-components.ts';
import { convertNixieSceneV1ToV2 } from '../../../nixie/desktop-extensions/scene-v2-conversion.ts';
import { convertFoxholeSceneV1NodeToV2 } from '../app/plugins/foxhole/nixie/scene-v2-conversion.ts';
import { getFoxholeStructureCatalog } from '../app/plugins/foxhole/nixie/catalog.ts';
import { projectFoxholeMaintenanceSceneV1, projectFoxholeMaintenanceSceneV2 } from '../app/plugins/foxhole/nixie/maintenance-supply-scene.ts';
import { resolveFoxholeMaintenanceCoverage } from '../app/plugins/foxhole/nixie/maintenance-supply.ts';

const transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, visible: true, alpha: 1 };
const asset = (id: string, foxholeKey: string, state: Record<string, unknown> = {}) => ({
    id, type: 'foxholeAsset', state: { ...transform, foxholeKey, ...state }, children: [],
});

test('maintenance coverage uses world positions through transformed parents in both scenes', () => {
    const source = [{ id: 'layer', type: 'layer', state: { ...transform, x: 400, y: -200, rotation: Math.PI / 2, scaleX: 2 }, children: [
        asset('tunnel', 'maintenancetunnel'), asset('near', 'facilityfactoryammo', { x: 10 * 32 }),
        asset('outside', 'facilityfactoryammo', { x: 30 * 32 }), asset('packaged', 'facilityfactoryammo', { packaged: true }),
    ] }];
    const catalog = getFoxholeStructureCatalog('/foxhole/assets/');
    assert.ok(catalog.structureByKey.facilityfactoryammo);
    const legacy = projectFoxholeMaintenanceSceneV1(source, catalog);
    const converted = convertNixieSceneV1ToV2(source, { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
    const manifest = JSON.parse(readFileSync(new URL('../../../../extensions/foxhole-planner/nixie.extension.json', import.meta.url), 'utf8'));
    const host = new NixieSceneV2ComponentHost();
    host.registerExtension('nixie.core', NIXIE_SCENE_V2_CORE_COMPONENTS);
    host.registerExtension('nixie.foxhole-planner', manifest.contributes.experimentalComponents);
    host.replaceDocument(converted.content);
    const modern = projectFoxholeMaintenanceSceneV2(host.listEntities(), catalog);
    for (const candidates of [legacy, modern]) {
        const tunnel = candidates.find(candidate => candidate.assetId === 'maintenancetunnel')!;
        assert.equal(tunnel.x, 400);
        assert.equal(tunnel.y, -200);
        const covered = resolveFoxholeMaintenanceCoverage(tunnel, candidates, { range: 25, exclusions: [] });
        assert.deepEqual(covered.structures.map(candidate => candidate.assetId), ['maintenancetunnel', 'facilityfactoryammo']);
        assert.equal(resolveFoxholeMaintenanceCoverage(tunnel, candidates, { range: 25, exclusions: ['facility'] }).structures.length, 1);
    }
});

test('unknown tunnel filter fields retain a conversion warning and their original source', () => {
    const source = asset('tunnel', 'maintenancetunnel', { maintenanceFilters: { range: 70, exclusions: ['defenses'], futureFilter: true } });
    const result = convertNixieSceneV1ToV2([source], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
    assert.ok(result.report.issues.some(issue => issue.severity === 'warning' && issue.message.includes('maintenance filters')));
    const saved = result.content.entities[0]!.components.find(component => component.componentId === 'legacy-source');
    assert.deepEqual(JSON.parse(String(saved?.data.snapshotJson)).state.maintenanceFilters, source.state.maintenanceFilters);
});
