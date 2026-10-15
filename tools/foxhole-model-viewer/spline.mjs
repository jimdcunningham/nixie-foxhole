import { Application, Texture } from 'pixi.js';
import { View3D, Geometry3D, Mesh3D, Material3D, PlaneGeometry, DirectionalLight, AmbientLight } from '@pixi/3d';
import { buildNixieSpatialSweepGeometry } from '#nixie-host/app/plugins/nixie/scene-v2/spatial-sweep-geometry.ts';
import { NixieSceneV2Camera3D } from '#nixie-host/app/plugins/nixie/scene-v2/spatial-camera.ts';
import { sampleFoxholeSceneV2Connector } from '../../extensions/foxhole-planner/src/scene-v2-connector-path.ts';
import { createFoxholeSceneV2SplineProductData } from '../../extensions/foxhole-planner/src/scene-v2-connector-products.ts';

const $ = id => document.getElementById(id);
const fixture = await (await fetch('/spline-fixture.json')).json();
const element = $('view'), app = new Application();
await app.init({ width: element.clientWidth, height: element.clientHeight, preference: 'webgl', antialias: true,
    resolution: Math.min(devicePixelRatio, 1.5), autoDensity: true, autoStart: false, background: 0x343b44 });
element.append(app.canvas);
const view = new View3D({ autoResize: true, camera: new NixieSceneV2Camera3D({ near: 0.01, far: 1000 }),
    environment: { skyColor: 0xffffff, groundColor: 0xa3a09a, intensity: 0.25, up: { x: 0, y: 0, z: 1 } },
    toneMapping: 'none', shadowFilter: 'pcf-high' });
app.stage.addChild(view);
const sun = new DirectionalLight({ color: 0xfff5eb, intensity: 3, castShadow: true });
sun.rotation.set(0.35, -0.45, 0);
view.root.addChild(sun, new AmbientLight({ intensity: 0.8 }), new Mesh3D({ geometry: new PlaneGeometry({ width: 50, height: 50 }),
    material: new Material3D({ baseColor: 0x383838, metallic: 0, roughness: 1 }), castShadow: false, receiveShadow: true }));
const pattern = document.createElement('canvas'); pattern.width = pattern.height = 64;
const context = pattern.getContext('2d'); context.fillStyle = '#b0bec8'; context.fillRect(0, 0, 64, 64);
context.fillStyle = '#3e5265'; context.fillRect(0, 0, 32, 32); context.fillRect(32, 32, 32, 32);
const texture = Texture.from(pattern); texture.source.style.addressMode = 'repeat';
const material = new Material3D({ baseColorTexture: texture, metallic: 0.35, roughness: 0.55 });
let mesh = null, yaw = -0.85, pitch = 0.6, distance = 20, target = { x: 5, y: -1.5, z: 1 };
function render() {
    const horizontal = distance * Math.cos(pitch);
    view.camera.position.set(target.x + Math.cos(yaw) * horizontal, target.y + Math.sin(yaw) * horizontal,
        target.z + Math.sin(pitch) * distance);
    view.camera.lookAt(target); app.render();
}
function rebuild() {
    const startTime = performance.now();
    const length = +$('length').value, offset = +$('offset').value, bend = +$('bend').value, rise = +$('rise').value, angle = +$('angle').value;
    for (const [id, value] of Object.entries({ length, offset, bend, rise, angle })) $(id + '-value').textContent = `${value}${id === 'angle' ? '°' : id === 'bend' ? '' : 'm'}`;
    const data = { ...createFoxholeSceneV2SplineProductData('facilitypipe', fixture.connector),
        endX: length * 32, endY: offset * 32, endRotation: angle * Math.PI / 180, curveT: bend };
    const sampled = sampleFoxholeSceneV2Connector(data, fixture);
    $('path-line').setAttribute('points', sampled.points.map(point => `${point.x / 32},${point.y / 32}`).join(' '));
    const points = sampled.points.map((point, index) => ({ x: point.x / 32, y: -point.y / 32,
        z: 0.3 + rise * (sampled.totalLength ? sampled.lengths[index] / sampled.totalLength : 0) }));
    try {
        const buffers = buildNixieSpatialSweepGeometry(points, { radius: 0.12, radialSegments: 24, textureRepeatLength: 1, capped: $('caps').checked });
        const geometry = new Geometry3D({ ...buffers, quantizeNormals: false, quantizeTangents: false });
        const next = new Mesh3D({ geometry, material, castShadow: true, receiveShadow: true, eventMode: 'static', hitVolume: geometry });
        if (mesh) { mesh.removeFromParent(); mesh.destroy({ geometry: true }); }
        mesh = next; view.root.addChild(mesh);
        const bounds = mesh.getLocalBounds(); target = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 };
        $('status').textContent = `${fixture.label} path · ${buffers.pathLength.toFixed(2)}m · ${(buffers.indices.length / 3).toLocaleString()} triangles · Generated in ${(performance.now() - startTime).toFixed(1)}ms · Bounds follow the curved mesh`;
        document.body.dataset.ready = 'spline';
        render();
    } catch (error) { $('status').textContent = error.message; console.error(error); }
}
for (const id of ['length', 'offset', 'bend', 'rise', 'angle', 'caps']) $(id).addEventListener('input', rebuild);
let drag = null;
element.addEventListener('pointerdown', event => { element.setPointerCapture(event.pointerId); drag = { x: event.clientX, y: event.clientY }; });
element.addEventListener('pointermove', event => { if (!drag) return; yaw -= (event.clientX - drag.x) * 0.006; pitch = Math.max(0.04, Math.min(1.5, pitch + (event.clientY - drag.y) * 0.006)); drag = { x: event.clientX, y: event.clientY }; render(); });
for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(event, () => { drag = null; });
element.addEventListener('wheel', event => { event.preventDefault(); distance = Math.max(1, Math.min(100, distance * Math.exp(event.deltaY * 0.001))); render(); }, { passive: false });
$('reset').addEventListener('click', () => { yaw = -0.85; pitch = 0.6; distance = 20; render(); });
new ResizeObserver(() => { app.renderer.resize(element.clientWidth, element.clientHeight); render(); }).observe(element);
rebuild();
