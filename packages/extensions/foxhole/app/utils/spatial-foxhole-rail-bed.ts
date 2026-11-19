import { Container3D, Vector3 } from '@pixi/3d';
import type { Matrix4, Scene3DSource } from '@pixi/3d';
import type { NixieSpatialNodeV1 } from '@nixiejs/extension-sdk/scene-v2';
import { readNixieSceneV2ModelAnchor } from '#nixie-internal/app/plugins/nixie/scene-v2/spatial-model-resource.ts';
import type { NixieInternalRailPresentation } from '#nixie-internal/desktop-extensions/internal-scene-v2-adapters.ts';
import { buildNixieSpatialPath, createNixieSpatialRoutePreview, deformNixieSpatialPath, destroyNixieSpatialPath } from '#nixie-internal/app/plugins/nixie/scene-v2/spatial-path-model.ts';
import type { SpatialPathCutout } from '#nixie-internal/app/plugins/nixie/scene-v2/spatial-path-model.ts';
import { createFoxholeRailJunctionCutout } from './spatial-foxhole-rail-junction.ts';
import type { SpatialRailDeck } from './spatial-foxhole-rail-junction.ts';

type ModelPath = Extract<NixieSpatialNodeV1, { kind: 'model-path' }>;
type Point = readonly [number, number, number];
const zero: Point = [0, 0, 0];
const MAX_SUPPORTS_PER_PROFILE = 128;

interface ModelDocument {
    meshes?: Array<{ name?: string; primitives?: Array<{ material?: number }> }>;
    materials?: Array<{ name?: string }>;
}
const railMeshMetadata = new WeakMap<object, { names: string[]; deckPrimitives: boolean[][] }>();

export function readFoxholeRailModel(source: object, document: unknown): void {
    const { meshes, materials } = document as ModelDocument;
    const names = meshes?.map(mesh => mesh.name ?? '') ?? [];
    if (names.some(name => /^(?:SmallGaugeTrack_Trackbed|Railway_Trackbed_)/u.test(name))) {
        const deckPrimitives = meshes!.map(mesh => mesh.primitives?.map(primitive =>
            primitive.material !== undefined && materials?.[primitive.material]?.name === 'TrainTrackBed') ?? []);
        railMeshMetadata.set(source, { names, deckPrimitives });
    }
}

function isFoxholeRailSpan(node: NixieSpatialNodeV1): node is ModelPath {
    return node.kind === 'model-path' && node.id === 'rail-span';
}


export interface RailBedProfile {
    flat: number;
    raised: number;
    tall: number;
    shoulder: number;
    flatClearance: number;
    raisedClearance: number;
    requireBothSides: boolean;
    supports: ReadonlyMap<number, number>;
    supportPitch: number;
}

export function resolveFoxholeRailBedProfile(meshNames: readonly string[], small: boolean): RailBedProfile | undefined {
    const prefix = small ? 'SmallGaugeTrack_Trackbed' : 'Railway_Trackbed_';
    const index = (meshName: string) => meshNames.findIndex(name => name.replace(/(?:\.\d{3})+$/u, '') === meshName);
    const flat = index(prefix + '01'), raised = index(prefix + '02'), tall = index(prefix + '03');
    if (flat < 0 || raised < 0 || tall < 0) return undefined;
    const support = (variant: string) => index(small ? `SmallGaugeTrack_Trackbed${variant}side` : `Railway_Trackbed${variant}_side`);
    // Blueprint surface deltas (cm) converted to Studio units at 32 units/m.
    return { flat, raised, tall, shoulder: small ? 40 : 90, flatClearance: (small ? 40 : 50) * .32,
        raisedClearance: (small ? 100 : 230) * .32, requireBothSides: !small,
        supports: new Map([[raised, support('02')], [tall, support('03')]]),
        supportPitch: (small ? 115 : 256) * .32 };
}

function railPathDistances(points: readonly number[]) {
    const lengths = [0];
    for (let index = 3; index < points.length; index += 3) {
        lengths.push(lengths.at(-1)! + Math.hypot(points[index]! - points[index - 3]!,
            points[index + 1]! - points[index - 2]!, points[index + 2]! - points[index - 1]!));
    }
    return lengths;
}

export function resolveFoxholeRailBedSections(points: readonly number[], profile: RailBedProfile,
    startDelta: readonly number[], endDelta: readonly number[], clearance: (point: Point) => number) {
    const sections: Array<{ meshIndex: number; start: number; end: number; }> = [];
    const lengths = railPathDistances(points);
    const length = lengths.at(-1)!;
    if (!length) return { length, sections };
    const samples = Math.min(64, Math.ceil(length / 16));
    let segment = 1;
    for (let sample = 0; sample < samples; sample++) {
        const start = length * sample / samples;
        const end = length * (sample + 1) / samples;
        const distance = (start + end) / 2;
        while (lengths[segment]! < distance) segment++;
        const from = (segment - 1) * 3;
        const weight = distance / length;
        const t = (distance - lengths[segment - 1]!) / (lengths[segment]! - lengths[segment - 1]!);
        const local = ([0, 1, 2] as const).map(axis => (points[from + axis]! * (1 - t) + points[from + axis + 3]! * t)
            * (axis === 1 ? -1 : 1) + startDelta[axis]! * (1 - weight) + endDelta[axis]! * weight);
        const segmentWeight = (lengths[segment]! - lengths[segment - 1]!) / length;
        const dx = points[from + 3]! - points[from]! + (endDelta[0]! - startDelta[0]!) * segmentWeight;
        const dy = points[from + 1]! - points[from + 4]! + (endDelta[1]! - startDelta[1]!) * segmentWeight;
        const lateral = profile.shoulder / (Math.hypot(dx, dy) || 1);
        const leftPoint: Point = [local[0]! - dy * lateral, local[1]! + dx * lateral, local[2]!];
        const rightPoint: Point = [local[0]! + dy * lateral, local[1]! - dx * lateral, local[2]!];
        const left = clearance(leftPoint), right = clearance(rightPoint);
        const highest = Math.max(left, right), lowest = Math.min(left, right);
        const meshIndex = highest < profile.flatClearance ? profile.flat
            : highest <= profile.raisedClearance && (!profile.requireBothSides || lowest >= 40 * .32) ? profile.raised
            : profile.tall;
        const previous = sections.at(-1);
        if (previous?.meshIndex === meshIndex) previous.end = end;
        else sections.push({ meshIndex, start, end });
    }
    return { length, sections };
}

export function describeFoxholeSpatialRailDeck(node: NixieSpatialNodeV1, matrix: Matrix4, deformations: readonly [readonly number[], readonly number[]] = [zero, zero]): SpatialRailDeck | undefined {
    if (!isFoxholeRailSpan(node)) return undefined;
    const gauge = /^foxhole\.model\.(small)?railtrackspline(?:biarc|foundation|town)?$/u.exec(node.resourceId);
    if (!gauge) return undefined;
    const [start, end] = deformations;
    const lengths = railPathDistances(node.points);
    const length = lengths.at(-1)!;
    if (!length) return undefined;
    const points: Point[] = [];
    const world = new Vector3();
    for (let index = 0; index < lengths.length; index++) {
        const t = lengths[index]! / length;
        const offset = index * 3;
        world.set(node.points[offset]! + start[0]! * (1 - t) + end[0]! * t,
            -node.points[offset + 1]! + start[1]! * (1 - t) + end[1]! * t,
            node.points[offset + 2]! + start[2]! * (1 - t) + end[2]! * t).applyAffineMatrix4(matrix);
        points.push([world.x, world.y, world.z]);
    }
    // Measure the ballast footprint, excluding the rim and buttress overhangs.
    // Using the widest metal profile would cut both outer walls where the two tracks run alongside each other.
    const m = matrix.elements;
    const scale = Math.max(Math.hypot(m[0]!, m[1]!), Math.hypot(m[4]!, m[5]!));
    return { points, halfWidth: (gauge[1] ? 38 : 84) * scale };
}

/** Trusted presentation for the existing Foxhole rail-bed path. Its GLB retains all native bed variants. */
export class NixieFoxholeRailBed {
    readonly root = new Container3D({ label: 'spatial-path:rail-bed' });
    start: readonly number[] = zero;
    end: readonly number[] = zero;
    #sampleKey = '';
    #sectionKey = 'flat';
    #previewKey = '';
    #meshPoints: readonly number[];

    static create(node: NixieSpatialNodeV1, source: Scene3DSource | undefined) {
        if (node.kind !== 'model-path' || node.id !== 'rail-bed' || !source) return undefined;
        const match = /^foxhole\.model\.(small)?railtrackspline(?:biarc)?$/u.exec(node.resourceId);
        const meshes = railMeshMetadata.get(source);
        const profile = match && meshes && resolveFoxholeRailBedProfile(meshes.names, !!match[1]);
        return meshes && profile && profile.flat === node.meshIndex
            ? new NixieFoxholeRailBed(node, source, profile, meshes.deckPrimitives) : undefined;
    }

    private constructor(private node: ModelPath, private readonly source: Scene3DSource,
        private readonly profile: RailBedProfile, private readonly deckPrimitives: readonly (readonly boolean[])[]) {
        this.#meshPoints = node.points;
        this.root.addChild(buildNixieSpatialPath(node, source));
    }

    canRetarget(node: NixieSpatialNodeV1, source: Scene3DSource | undefined): node is ModelPath {
        return source === this.source && node.kind === 'model-path'
            && node.id === this.node.id && node.resourceId === this.node.resourceId && node.meshIndex === this.node.meshIndex
            && node.unitsPerMetre === this.node.unitsPerMetre;
    }

    retarget(node: ModelPath): void {
        this.node = node;
    }

    preview(): boolean {
        const key = JSON.stringify([this.node.points, this.start, this.end]);
        if (key === this.#previewKey) return false;
        this.#previewKey = key;
        if (this.#meshPoints.length === this.node.points.length && this.#meshPoints.every((value, i) => value === this.node.points[i])) {
            for (const child of this.root.children) deformNixieSpatialPath(child as Container3D, this.start, this.end);
        } else {
            const deform = createNixieSpatialRoutePreview(this.#meshPoints, this.node.points, this.start, this.end);
            for (const child of this.root.children) deform(child as Container3D);
        }
        this.#sampleKey = '';
        return true;
    }

    sync(matrix: Matrix4, floor: number, elevationAt: (x: number, y: number) => number | null, refreshTerrain: boolean,
        neighbors: readonly SpatialRailDeck[]): boolean {
        const key = JSON.stringify([this.node.points, Array.from(matrix.elements), this.start, this.end, floor, neighbors]);
        if (key === this.#sampleKey && !refreshTerrain) return false;
        this.#previewKey = '';
        this.#sampleKey = key;
        const world = new Vector3();
        const { length, sections } = resolveFoxholeRailBedSections(this.node.points, this.profile, this.start, this.end, point => {
            world.set(...point).applyAffineMatrix4(matrix);
            return world.z - (elevationAt(world.x, -world.y) ?? floor);
        });
        const flat = sections.length === 1 && sections[0]!.meshIndex === this.profile.flat;
        const sectionKey = neighbors.length ? JSON.stringify([sections, key]) : flat ? 'flat' : JSON.stringify(sections);
        const changed = sectionKey !== this.#sectionKey || this.#meshPoints.length !== this.node.points.length
            || this.#meshPoints.some((value, i) => value !== this.node.points[i]);
        if (changed) {
            const replacement: Container3D[] = [];
            try {
                const wallCutout = createFoxholeRailJunctionCutout(neighbors, matrix, this.start, this.end, true);
                const supportCutout = createFoxholeRailJunctionCutout(neighbors, matrix, this.start, this.end, false);
                const supports = new Map<number, Array<{ distance: number }>>();
                const routes: NonNullable<Parameters<typeof buildNixieSpatialPath>[2]> = new Map();
                const anchorX = readNixieSceneV2ModelAnchor(this.source)?.offsetX ?? 0;
                for (const { meshIndex, start, end } of sections) {
                    const cutout: SpatialPathCutout | undefined = wallCutout && supportCutout
                        ? (vertices, indices, centerAt, primitiveIndex) => {
                            const clip = this.deckPrimitives[meshIndex]?.[primitiveIndex] === false ? supportCutout : wallCutout;
                            return clip(vertices, indices, centerAt, primitiveIndex);
                        } : undefined;
                    replacement.push(buildNixieSpatialPath(flat ? this.node
                        : { ...this.node, meshIndex, startInset: start, endInset: length - end }, this.source, routes, cutout));
                    const support = this.profile.supports.get(meshIndex) ?? -1;
                    if (support < 0 || end - start < this.profile.supportPitch) continue;
                    const geometry = this.source.geometries[support];
                    if (!geometry?.length) continue;
                    const minX = Math.min(...geometry.map(part => part.bounds3D.min.x)) * this.node.unitsPerMetre + anchorX;
                    const maxX = Math.max(...geometry.map(part => part.bounds3D.max.x)) * this.node.unitsPerMetre + anchorX;
                    const instances = supports.get(support) ?? [];
                    // The native copied range leaves one full support interval at the end.
                    const endClearance = Math.max(maxX, this.profile.supportPitch);
                    for (let station = start + Math.max(0, -minX); instances.length < MAX_SUPPORTS_PER_PROFILE
                        && station + endClearance <= end + 1e-6; station += this.profile.supportPitch) {
                        instances.push({ distance: station });
                    }
                    if (instances.length) supports.set(support, instances);
                }
                for (const [meshIndex, instances] of supports) {
                    replacement.push(buildNixieSpatialPath({ ...this.node, meshIndex, instances, sourceOrigin: [0, 0, 0] }, this.source, routes, supportCutout));
                }
            } catch (error) {
                replacement.forEach(destroyNixieSpatialPath);
                throw error;
            }
            this.#sectionKey = sectionKey;
            this.#meshPoints = this.node.points;
            for (const child of [...this.root.children]) destroyNixieSpatialPath(child as Container3D);
            for (const child of replacement) this.root.addChild(child);
        }
        for (const child of this.root.children) deformNixieSpatialPath(child as Container3D, this.start, this.end);
        return changed;
    }
}

export const foxholeRailPresentation: NixieInternalRailPresentation = {
    readModel: readFoxholeRailModel,
    isSpan: isFoxholeRailSpan,
    describeDeck: describeFoxholeSpatialRailDeck,
    createBed: (node, source) => NixieFoxholeRailBed.create(node, source),
};
