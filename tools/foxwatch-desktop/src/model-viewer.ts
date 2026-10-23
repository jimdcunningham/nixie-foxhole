import 'pixi.js/unsafe-eval';
import type { ModelBounds, PreviewCamera } from '../shared/asset-diff';
import { Application, Assets, type WebGLRenderer } from 'pixi.js';
import { installCsp3dUniforms } from './csp-3d-uniforms';
import {
  AmbientLight,
  Camera3D,
  DirectionalLight,
  Model3D,
  View3D,
  type Scene3DSource,
} from '@pixi/3d';

let activePreviews = 0;

export async function createModelPreview(
  host: HTMLElement,
  bytes: Uint8Array,
  cancelled: () => boolean,
  onCameraChange?: (camera: PreviewCamera) => void,
) {
  const app = new Application();
  activePreviews++;
  let released = false;
  const destroyApplication = () => {
    if (released) return;
    released = true;
    // Outgoing and staged previews briefly share Pixi's global shader cache.
    // Only the last renderer may release it.
    app.destroy(
      { removeView: true, releaseGlobalResources: --activePreviews === 0 },
      { children: true },
    );
  };
  try {
    await app.init({
      width: Math.max(1, host.clientWidth),
      height: Math.max(1, host.clientHeight),
      preference: 'webgl',
      antialias: true,
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
      autoStart: false,
      background: 0x1c2026,
    });
  } catch (cause) {
    activePreviews--;
    throw cause;
  }
  if (cancelled()) {
    destroyApplication();
    return;
  }
  installCsp3dUniforms(app.renderer as WebGLRenderer);
  host.append(app.canvas);
  const view = new View3D({
    autoResize: true,
    camera: new Camera3D({ fov: 45, near: 0.01, far: 10000 }),
    toneMapping: 'none',
    environment: { skyColor: 0xffffff, groundColor: 0x808b97, intensity: 0.5 },
  });
  const ambient = new AmbientLight({ color: 0xffffff, intensity: 1.5 });
  const sun = new DirectionalLight({ color: 0xfff7ed, intensity: 2.5 });
  sun.rotation.set(0.4, -0.7, 0);
  view.root.addChild(ambient, sun);
  app.stage.addChild(view);
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: 'model/gltf-binary' }),
  );
  let model: Model3D | undefined;
  let loaded = false;
  let observer: ResizeObserver | undefined;
  const events = new AbortController();
  function destroy() {
    events.abort();
    observer?.disconnect();
    if (model) {
      model.unload();
      model.destroy();
    }
    if (loaded) void Assets.unload(url).catch(() => {});
    URL.revokeObjectURL(url);
    destroyApplication();
  }
  try {
    const source = await Assets.load<Scene3DSource>({
      src: url,
      parser: 'glb',
    });
    loaded = true;
    if (cancelled()) {
      destroy();
      return;
    }
    model = new Model3D({ source, autoUpdate: false });
    view.root.addChild(model);
    const bounds = model.getLocalBounds();
    let center = {
      x: (bounds.min.x + bounds.max.x) / 2,
      y: (bounds.min.y + bounds.max.y) / 2,
      z: (bounds.min.z + bounds.max.z) / 2,
    };
    let radius = Math.max(
      0.01,
      Math.hypot(
        bounds.max.x - bounds.min.x,
        bounds.max.y - bounds.min.y,
        bounds.max.z - bounds.min.z,
      ) / 2,
    );
    if (![center.x, center.y, center.z, radius].every(Number.isFinite))
      throw new Error('The model does not contain renderable geometry.');
    let yaw = -0.65,
      pitch = 0.35,
      distance = radius * 3;
    const target = { ...center };
    const draw = (notify = true) => {
      const horizontal = distance * Math.cos(pitch);
      view.camera.position.set(
        target.x + Math.sin(yaw) * horizontal,
        target.y + Math.sin(pitch) * distance,
        target.z + Math.cos(yaw) * horizontal,
      );
      view.camera.near = Math.max(0.0001, distance / 1000);
      view.camera.far = Math.max(distance * 20, radius * 30);
      view.camera.lookAt(target);
      app.render();
      if (notify) onCameraChange?.({yaw,pitch,distance,target:{...target}});
    };
    const reset = (aspectOverride?: number) => {
      yaw = -0.65;
      pitch = 0.35;
      Object.assign(target, center);
      const aspect = typeof aspectOverride === 'number' ? aspectOverride : Math.max(
        0.1,
        host.clientWidth / Math.max(1, host.clientHeight),
      );
      const halfFov = Math.atan(Math.tan(Math.PI / 8) * Math.min(1, aspect));
      distance = (radius / Math.sin(halfFov)) * 1.1;
      draw();
    };
    let drag: { x: number; y: number; pan: boolean } | null = null;
    host.addEventListener('contextmenu', (event) => event.preventDefault(), {
      signal: events.signal,
    });
    host.addEventListener(
      'pointerdown',
      (event) => {
        host.setPointerCapture(event.pointerId);
        drag = {
          x: event.clientX,
          y: event.clientY,
          pan: event.button !== 0 || event.shiftKey,
        };
      },
      { signal: events.signal },
    );
    host.addEventListener(
      'pointermove',
      (event) => {
        if (!drag) return;
        const dx = event.clientX - drag.x,
          dy = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (drag.pan) {
          const scale = distance / Math.max(1, host.clientHeight);
          target.x -= Math.cos(yaw) * dx * scale;
          target.z += Math.sin(yaw) * dx * scale;
          target.y += dy * scale;
        } else {
          yaw -= dx * 0.006;
          pitch = Math.max(-1.45, Math.min(1.45, pitch + dy * 0.006));
        }
        draw();
      },
      { signal: events.signal },
    );
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'])
      host.addEventListener(
        name,
        () => {
          drag = null;
        },
        { signal: events.signal },
      );
    host.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        distance = Math.max(
          radius * 0.05,
          Math.min(radius * 100, distance * Math.exp(event.deltaY * 0.001)),
        );
        draw();
      },
      { passive: false, signal: events.signal },
    );
    observer = new ResizeObserver(() => {
      if (host.clientWidth && host.clientHeight) {
        app.renderer.resize(host.clientWidth, host.clientHeight);
        draw(false);
      }
    });
    observer.observe(host);
    reset();
    return {
      destroy,
      reset,
      bounds: { min: {x:bounds.min.x,y:bounds.min.y,z:bounds.min.z}, max: {x:bounds.max.x,y:bounds.max.y,z:bounds.max.z} } as ModelBounds,
      setCamera(camera: PreviewCamera) {
        yaw = camera.yaw; pitch = camera.pitch; distance = camera.distance; Object.assign(target,camera.target); draw(false);
      },
      setFrame(frame: ModelBounds, aspect?: number) {
        center = {x:(frame.min.x+frame.max.x)/2,y:(frame.min.y+frame.max.y)/2,z:(frame.min.z+frame.max.z)/2};
        radius = Math.max(.01,Math.hypot(frame.max.x-frame.min.x,frame.max.y-frame.min.y,frame.max.z-frame.min.z)/2);
        reset(aspect);
      },
      statistics: `${model.children.length.toLocaleString()} mesh groups`,
    };
  } catch (cause) {
    destroy();
    throw cause;
  }
}
