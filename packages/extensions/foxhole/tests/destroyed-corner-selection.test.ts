import assert from 'node:assert/strict';
import test from 'node:test';
import { getFoxholeManifest } from '../app/plugins/foxhole/nixie/manifest.ts';
import type { FoxholeManifestStructure } from '../app/plugins/foxhole/nixie/manifest.ts';
import {
    buildFoxholeStructureSelectionGeometry,
    isPointInsideFoxholeStructureSelectionGeometry,
} from '../app/plugins/nixie/board/types/foxhole-structure-selection.ts';
import { convertNixieSceneV1ToV2 } from '../../../nixie/desktop-extensions/scene-v2-conversion.ts';
import { convertFoxholeSceneV1NodeToV2 } from '../app/plugins/foxhole/nixie/scene-v2-conversion.ts';
import { foxholeSceneV2StateAdapter } from '../app/plugins/foxhole/nixie/scene-v2-state-adapter.ts';
import assets from '../../../../extensions/foxhole-planner/src/scene-v2-assets-node.ts';
import { renderFoxholeSceneV2Entity } from '../../../../extensions/foxhole-planner/src/scene-v2-renderers.ts';

const manifest = getFoxholeManifest('/foxhole/assets/');

function geometry(structure: FoxholeManifestStructure) {
    return buildFoxholeStructureSelectionGeometry({ structure, selectionPolygons: structure.selectionPolygons,
        sprite: { width: structure.sprite.width * 0.5, height: structure.sprite.height * 0.5,
            anchorX: structure.sprite.anchorX, anchorY: structure.sprite.anchorY,
            offsetX: structure.sprite.offsetX * 0.5, offsetY: structure.sprite.offsetY * 0.5 },
        pixelsPerUnit: 32 })!;
}

function entity(foxholeKey: string, destroyed: boolean) {
    const converted = convertNixieSceneV1ToV2([{ id: 'corner', type: 'foxholeAsset', state: {
        foxholeKey, destroyed, x: 123, y: -47, rotation: 37 * Math.PI / 180,
    }, children: [] }], { nodeConverters: [convertFoxholeSceneV1NodeToV2] });
    const initial = converted.content.entities[0]!;
    return { ...initial, components: initial.components.map(component => ({ ...component, definitionAvailable: true })) };
}

for (const tier of [1, 2, 3]) {
    test(`published destroyed corner tier ${tier} excludes its cutout in Native hit geometry and retains occupied arms`, () => {
        const intactKey = `fortcornert${tier}`;
        const wreckKey = `fortcornerdestroyedt${tier}`;
        const intact = manifest.assets.find(asset => asset.id === intactKey)!;
        const wreck = manifest.assets.find(asset => asset.id === wreckKey)!;
        assert.equal(wreck.upgradeStructureCodeName?.toLowerCase(), intactKey);
        const intactGeometry = geometry(intact);
        const wreckGeometry = geometry(wreck);
        for (const point of [{ x: 64, y: -64 }, { x: -64, y: 64 }, { x: 0, y: 0 }]) {
            assert.equal(isPointInsideFoxholeStructureSelectionGeometry(point.x, point.y, intactGeometry), true);
            assert.equal(isPointInsideFoxholeStructureSelectionGeometry(point.x, point.y, wreckGeometry), true);
        }
        // This point lies inside the sprite rectangle, but beyond the diagonal
        // cut edge of the actual corner footprint.
        assert.equal(isPointInsideFoxholeStructureSelectionGeometry(64, 64, wreckGeometry), false);
        assert.equal(isPointInsideFoxholeStructureSelectionGeometry(100, 80, wreckGeometry), false);
        assert.deepEqual(wreckGeometry.hitPolygons, intactGeometry.hitPolygons);
        assert.equal(wreckGeometry.hitBoxes.length, 0);
        assert.deepEqual(wreck.selectionPolygons, intact.selectionPolygons);

        const standalone = entity(wreckKey, false);
        const appearance = entity(intactKey, true);
        assert.deepEqual(foxholeSceneV2StateAdapter.selectionLocalBounds!(standalone, 1), wreckGeometry.bounds);
        assert.deepEqual(foxholeSceneV2StateAdapter.selectionLocalBounds!(appearance, 1), wreckGeometry.bounds);
        assert.deepEqual(assets[wreckKey]!.selectionPolygons, wreck.selectionPolygons);
        assert.deepEqual(assets[intactKey]!.selectionDestroyed!.selectionPolygons, wreck.selectionPolygons);
        assert.deepEqual(renderFoxholeSceneV2Entity(standalone).experimentalSelectionGeometry!.localBounds, wreckGeometry.bounds);
        assert.deepEqual(renderFoxholeSceneV2Entity(appearance).experimentalSelectionGeometry!.localBounds, wreckGeometry.bounds);
    });
}
