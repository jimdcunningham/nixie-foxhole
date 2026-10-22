import { shallowRef } from 'vue';
export interface PlannerRoadTourStatus {
    attached: boolean; canRun: boolean; canShake: boolean; shaking: boolean; state: string; region: string;
    regions: { id: string; label: string; }[];
    error: string | null; canRestore: boolean;
}
export const plannerRoadTourStatus = shallowRef<PlannerRoadTourStatus>({ attached: false, canRun: false, canShake: false, shaking: false, state: 'idle', region: '', regions: [], error: null, canRestore: false });
export const plannerRoadTourOptions = shallowRef({ region: '', speed: 12, view: 'variety', shakeStrength: .35 });
interface Actions { toggleCameraShake(): void; start(): void | Promise<void>; pause(): void; next(): void; stop(): void; restore(): void; }
export const plannerRoadTourActions = shallowRef<Actions | null>(null);
