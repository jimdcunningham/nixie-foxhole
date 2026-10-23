import type { UniformGroup, WebGLRenderer } from 'pixi.js';

type Values = Record<string, unknown>;
type Sync = (
  data: unknown,
  values: Values,
  renderer: WebGLRenderer,
  ...rest: unknown[]
) => void;
type Generator = (group: UniformGroup, data: Values) => Sync;

/** Pixi's static CSP uploader has no handlers for @pixi/3d's custom math parsers.
 * Feed its existing typed-array handlers instead, without eval or global patches.
 * This hook is intentionally overridable by Pixi's unsafe-eval compatibility entry.
 */
export function installCsp3dUniforms(renderer: WebGLRenderer) {
  const system = renderer.uniformGroup as unknown as {
    _generateUniformsSync: Generator;
  };
  const generate = system._generateUniformsSync;
  system._generateUniformsSync = function (group, data) {
    const structures = { ...group.uniformStructures } as Record<
      string,
      { type: string; size?: number; value: unknown }
    >;
    const adapters: Array<[string, (value: unknown) => Float32Array]> = [];
    for (const [name, uniform] of Object.entries(structures)) {
      const value = uniform.value as {
        elements?: Float32Array;
        x?: number;
        y?: number;
        z?: number;
        r?: number;
        g?: number;
        b?: number;
      };
      let adapt: ((value: unknown) => Float32Array) | undefined;
      if (
        (uniform.type === 'mat4x4<f32>' || uniform.type === 'mat3x3<f32>') &&
        value?.elements
      ) {
        adapt = (value) => (value as { elements: Float32Array }).elements;
      } else if (
        uniform.type === 'vec3<f32>' &&
        uniform.size === 1 &&
        value?.x !== undefined
      ) {
        const array = new Float32Array(3);
        adapt = (value) => {
          const v = value as { x: number; y: number; z: number };
          array.set([v.x, v.y, v.z]);
          return array;
        };
      } else if (uniform.type === 'vec3<f32>' && value?.r !== undefined) {
        const array = new Float32Array(3);
        adapt = (value) => {
          const v = value as { r: number; g: number; b: number };
          array.set([v.r, v.g, v.b]);
          return array;
        };
      }
      if (adapt) {
        structures[name] = { ...uniform, value: adapt(uniform.value) };
        adapters.push([name, adapt]);
      }
    }
    const sync = generate.call(
      this,
      { ...group, uniformStructures: structures } as UniformGroup,
      data,
    );
    if (!adapters.length) return sync;
    const normalized: Values = {};
    return (data, values, renderer, ...rest) => {
      Object.assign(normalized, values);
      for (const [name, adapt] of adapters)
        normalized[name] = adapt(values[name]);
      sync(data, normalized, renderer, ...rest);
    };
  };
}
