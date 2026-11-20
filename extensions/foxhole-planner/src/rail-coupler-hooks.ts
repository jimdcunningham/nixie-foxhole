import type { FoxholeSceneV2AssetMetadata } from './scene-v2-asset-metadata.ts';
import { FOXHOLE_BOARD_UNITS_PER_METRE as UNITS_PER_METRE } from './scene-v2-footprints.ts';

type ModelPoint = readonly [number, number, number];
type HookSeat = { point: ModelPoint; bogie?: { nodeName: string; pivot: ModelPoint } };
type VehicleHooks = { front: HookSeat; rear?: HookSeat };

function bodyPair(x: number, height: number, lateral = 0, rearX = -x): VehicleHooks {
    return { front: { point: [x, height, lateral] }, rear: { point: [rearX, height, lateral] } };
}

// Rest-frame glTF coordinates in metres. Standard hook points sit just above the lower inner face.
// Small-gauge couplers are horizontal eyes. Their points sit at the centers of the openings.
const hooks: Readonly<Record<string, VehicleHooks>> = {
    trainengine: bodyPair(5.7147, -1.6967),
    trainflatbed: bodyPair(4.0855, 0.4168),
    traincombatcarc: bodyPair(4.4685, -1.2937),
    traincombatcarw: bodyPair(5.9546, -1.445),
    traincoal: bodyPair(2.3814, -1.013, 0, -2.6992),
    // Both blueprints still define rear interaction ports. The exported meshes only provide measured front seats.
    traincaboose: { front: { point: [4.0855, -1.8961, 0] } },
    traininfantry: { front: { point: [4.0855, -1.2769, 0] } },
    trainhospital: {
        front: { point: [10.5122, -1.6557, 0], bogie: { nodeName: 'rail-bogie-rear', pivot: [7.75662, -1.366038, 0] } },
        rear: { point: [-10.5122, -1.6557, 0], bogie: { nodeName: 'rail-bogie-front', pivot: [-7.756619, -1.366043, 0] } },
    },
    trainlrartillery: {
        front: { point: [11.1731, -2.0478, -0.1456], bogie: { nodeName: 'rail-bogie-front', pivot: [8.237305, -1.760132, -0.145523] } },
        rear: { point: [-11.1731, -2.0478, -0.1456], bogie: { nodeName: 'rail-bogie-rear', pivot: [-8.220646, -1.760132, -0.145526] } },
    },
    smalltrainengine: bodyPair(2.022, -0.6498),
    smalltrainmaterial: bodyPair(1.9536, -0.5868, 0, -1.8772),
    smalltrainresource: bodyPair(2.0295, -0.5562, 0, -1.8012),
    smalltrainshipping: bodyPair(2.132, -0.9762, -0.0102, -1.6987),
    smalltrainliquid: bodyPair(2.132, -0.9628, 0, -1.6987),
};

export function foxholeRailCouplerHook(assetId: string, end: -1 | 1, model: NonNullable<FoxholeSceneV2AssetMetadata['model']>) {
    const seat = hooks[assetId]?.[end === 1 ? 'front' : 'rear'];
    if (!seat) return undefined;
    // The renderer adds this catalog anchor to the glTF mesh. The seat and the
    // bogie pivot need the same translation before applying their model pose.
    const scenePoint = ([x, y, z]: ModelPoint): [number, number, number] =>
        [(model.offsetX ?? 0) + x * UNITS_PER_METRE, (model.offsetY ?? 0) + z * UNITS_PER_METRE,
            (model.offsetZ ?? model.height / 2) + y * UNITS_PER_METRE];
    // The articulated rail-body node cancels the catalog anchor in its rest pose.
    const pivot: [number, number, number] = seat.bogie ? scenePoint(seat.bogie.pivot) : [0, 0, 0];
    // The standard cars share the same hook mesh. Its lip is 23 mm out and 107 mm up from the seat.
    const tip = assetId.startsWith('smalltrain') ? undefined
        : scenePoint([seat.point[0] + end * 0.0232, seat.point[1] + 0.107, seat.point[2]]);
    return { point: scenePoint(seat.point), tip, modelAttachment: {
        nodeName: seat.bogie?.nodeName ?? 'rail-body', pivot, unitsPerModelUnit: UNITS_PER_METRE,
    } };
}
