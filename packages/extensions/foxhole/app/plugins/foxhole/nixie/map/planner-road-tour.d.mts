import type { BakedRegion } from '@nixie/foxhole-world';
import type { PlannerRoadTourStatus } from './road-tour-state.ts';

type Point = { x: number; y: number; z: number; };
type Pose = { position: Point; target: Point; };
type NativePose = { position: number[]; target: number[]; };
type RegionPosition = { x: number; y: number; };
export function nativeTourPose(pose: Pose, position: RegionPosition): NativePose;
export function plannerTourPose(pose: NativePose, position: RegionPosition): Pose;
export function createPlannerRoadTour(options: {
    canvas: HTMLCanvasElement;
    getRegions(): { id: string; label?: string; position: RegionPosition; scene: BakedRegion; }[];
    getOptions(): { region: string; speed: number; view: string; shakeStrength?: number; };
    readPose(): (Pose & { projection: string; }) | null;
    writePose(pose: Pose | null): boolean;
    setCameraShake?(strength: number): void;
    viewMode(): 'flat' | '2d' | '3d';
    onStatus(status: PlannerRoadTourStatus): void;
    hidden?(): boolean;
    now?(): number;
}): { toggleCameraShake(): void; start(): Promise<void>; pause(): void; next(): void; stop(): void; restore(): void; update(deltaMS: number): void; destroy(): void; };
