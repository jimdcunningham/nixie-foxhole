import { isNixieCoreTransformDataV2, readNixieCoreTransformV2 } from '@nixiejs/extension-sdk/scene-v2';
import type { NixieComponentEntitySnapshotV1 as Entity, NixieCoreTransformDataV2,
    NixieTransformV1 } from '@nixiejs/extension-sdk/scene-v2';

const finite = (value: unknown, fallback = 0) => typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/** SDK-owned canonical data, with an explicit compatibility branch for older Studio component documents. */
export function readFoxholeSceneV2CoreTransform(entity: Entity): NixieCoreTransformDataV2 | null {
    const native = readNixieCoreTransformV2(entity);
    if (native) return native;
    const transforms = entity.components.filter(component => component.ownerId === 'nixie.core' && component.componentId === 'transform');
    const spatials = entity.components.filter(component => component.ownerId === 'nixie.core' && component.componentId === 'spatial-transform');
    if (transforms.length > 1 || spatials.length > 1
        || transforms.some(component => component.version !== 1 || !component.definitionAvailable)
        || spatials.some(component => component.version !== 1 || !component.definitionAvailable)) return null;
    const planar = transforms[0]?.data, spatial = spatials[0]?.data;
    return {
        position: { x: finite(planar?.x), y: finite(planar?.y), z: finite(spatial?.elevation) },
        rotation: { x: finite(spatial?.rotationX), y: finite(spatial?.rotationY), z: finite(planar?.rotation) },
        scale: { x: finite(planar?.scaleX, 1), y: finite(planar?.scaleY, 1), z: finite(spatial?.scaleZ, 1) },
    };
}

/** Detached computation only; extensions never persist core transform components. */
export function withFoxholeSceneV2TransformProposal(entity: Entity, proposed: Partial<NixieTransformV1>, elevation?: number): Entity {
    const current = readFoxholeSceneV2CoreTransform(entity);
    if (!current) throw new Error('The transform proposal requires available supported core components');
    const transform = entity.components.find(component => component.ownerId === 'nixie.core' && component.componentId === 'transform');
    if (transform?.version === 2) {
        const data = { position: { ...current.position, ...(proposed.x === undefined ? {} : { x: proposed.x }),
            ...(proposed.y === undefined ? {} : { y: proposed.y }), ...(elevation === undefined ? {} : { z: elevation }) },
        rotation: { ...current.rotation, ...(proposed.rotation === undefined ? {} : { z: proposed.rotation }) },
        scale: { ...current.scale, ...(proposed.scaleX === undefined ? {} : { x: proposed.scaleX }), ...(proposed.scaleY === undefined ? {} : { y: proposed.scaleY }) } };
        if (!isNixieCoreTransformDataV2(data)) throw new Error('The proposed native transform is invalid');
        return { ...entity, components: entity.components.map(component => component === transform ? { ...component, data } : component) };
    }
    if (elevation !== undefined && !Number.isFinite(elevation)) throw new Error('The proposed height must be finite');
    const spatial = entity.components.find(component => component.ownerId === 'nixie.core' && component.componentId === 'spatial-transform');
    const components = entity.components.map(component => component === transform ? { ...component, data: { ...component.data, ...proposed } }
        : component === spatial && elevation !== undefined ? { ...component, data: { ...component.data, elevation } } : component);
    if (elevation !== undefined && !spatial) components.push({ ownerId: 'nixie.core', componentId: 'spatial-transform', version: 1,
        definitionAvailable: true, data: { elevation, rotationX: 0, rotationY: 0, scaleZ: 1 } });
    return { ...entity, components };
}
