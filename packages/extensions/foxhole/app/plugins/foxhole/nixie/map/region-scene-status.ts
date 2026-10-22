import { shallowRef } from 'vue';
export const foxholeRegionSceneStatus = shallowRef<{ phase: string; regionCount?: number; readyRegions?: number; failedRegions?: number; loadingRegions?: number; region?: string; error?: string; downloadBytes?: number; totalBytes?: number; readyMs?: number; firstVisibleMs?: number; }>({ phase: 'idle' });
