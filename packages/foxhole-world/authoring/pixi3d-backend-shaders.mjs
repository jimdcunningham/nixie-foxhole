// Studio uses the public backend entry points. The standalone FoxWatch viewer
// still carries a beta that exposes these same shader bits from the root.
import * as core from '@pixi/3d';
import * as gpu from '@pixi/3d/webgpu';
import * as gl from '@pixi/3d/webgl';

export const globalBitGpu = Reflect.get(gpu, 'globalBitGpu') ?? Reflect.get(core, 'globalBitGpu');
export const shadowBitsGpu = Reflect.get(gpu, 'shadowBitsGpu') ?? Reflect.get(core, 'shadowBitsGpu');
export const shadowBitsGl = Reflect.get(gl, 'shadowBitsGl') ?? Reflect.get(core, 'shadowBitsGl');
