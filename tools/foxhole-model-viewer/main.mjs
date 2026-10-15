import { Application, Assets } from 'pixi.js';
import { View3D, Container3D, Model3D, DirectionalLight, AmbientLight, Mesh3D, Material3D, PlaneGeometry } from '@pixi/3d';
import { prepareNixieSceneV2ModelGlb } from '#nixie-host/app/plugins/nixie/scene-v2/spatial-model-resource.ts';
import { NixieSceneV2Camera3D } from '#nixie-host/app/plugins/nixie/scene-v2/spatial-camera.ts';
import { reviewModelPlan, reviewAssemblyOptions } from './review-models.mjs';

const $ = id => document.getElementById(id);
const variants = [
    { id: 'exportdefault', group: 'review', label: 'Packaged Model' },
    { id: 'lossless', group: 'control', label: 'Full Triangles' },
];
const measurements = await (await fetch('/measurements.json')).json();
const categoryNames = { facility: 'Facilities', power: 'Power', mining: 'Mining', liquids: 'Liquids', foundation: 'Foundations' };
for (const [categoryId, label] of Object.entries(categoryNames)) {
    const group = document.createElement('optgroup');
    group.label = label;
    for (const row of measurements.review.rows.filter(row => row.id === row.assetId && row.categoryId === categoryId)
        .sort((a, b) => a.label.localeCompare(b.label))) {
        group.append(new Option(`${row.label}${row.newlyExported ? ' · New' : ''}`, row.id));
    }
    if (categoryId === 'power') for (const row of measurements.blockedAssets) {
        const option = new Option(`${row.label} · Procedural (No GLB)`, row.id);
        option.disabled = true;
        group.append(option);
    }
    $('asset').append(group);
}
$('asset').value = 'facilityfactoryaircraft';
function updateChoices() {
    const asset = $('asset').value;
    const available = variants.filter(variant => measurements[variant.group].rows.some(row => row.id === asset && row.profile === variant.id));
    for (const id of ['reference', 'variant']) {
        $(id).replaceChildren(...available.map(variant => new Option(variant.label, variant.id)));
    }
    $('variant').value = 'exportdefault';
    $('reference').value = available.find(variant => variant.id === 'lossless')?.id ?? 'exportdefault';
    $('assembly').replaceChildren(new Option('Default', ''), ...reviewAssemblyOptions(measurements.review, asset)
        .map(option => new Option(option.label, option.value)));
    $('assembly').disabled = $('assembly').options.length === 1;
}
updateChoices();
const panels = [];
const cameraState = { yaw: -0.85, pitch: 0.6, distance: 100, radius: 30, target: { x: 0, y: 0, z: 0 } };
let requestId = 0;

const lightingPresets = {
    studio: { environment: 0.25, ambient: 3, sun: 4.5, rotation: [0, 0, 0] },
    soft: { environment: 0.25, ambient: 0.5, sun: 2.5, rotation: [0.35, -0.45, 0] },
    direct: { environment: 0, ambient: 0, sun: 3, rotation: [0.35, -0.45, 0] },
};
function updateLighting() {
    for (const [index, panel] of panels.entries()) {
        const preset = lightingPresets[$(index === 0 ? 'left-lighting' : 'right-lighting').value];
        panel.view.environment = { skyColor: 0xffffff, groundColor: 0xa3a09a, intensity: preset.environment, up: { x: 0, y: 0, z: 1 } };
        panel.ambient.intensity = preset.ambient;
        panel.sun.intensity = preset.sun;
        panel.sun.rotation.set(...preset.rotation);
        panel.sun.castShadow = $('shadows').checked;
        panel.ground.visible = $('shadows').checked;
    }
    syncCameras();
}

function syncCameras() {
    for (const panel of panels) {
        const camera = panel.view.camera;
        const horizontal = cameraState.distance * Math.cos(cameraState.pitch);
        camera.position.set(cameraState.target.x + Math.cos(cameraState.yaw) * horizontal,
            cameraState.target.y + Math.sin(cameraState.yaw) * horizontal,
            cameraState.target.z + Math.sin(cameraState.pitch) * cameraState.distance);
        camera.near = Math.max(0.0001, cameraState.distance * 0.002);
        camera.far = Math.max(cameraState.distance * 20, cameraState.radius * 20);
        camera.lookAt(cameraState.target);
        panel.app.render();
    }
}

function resetView() {
    cameraState.yaw = -0.85;
    cameraState.pitch = 0.6;
    cameraState.target = cameraState.center ?? { x: 0, y: 0, z: 0 };
    fitView();
}

function fitView() {
    const out = [Math.cos(cameraState.yaw) * Math.cos(cameraState.pitch), Math.sin(cameraState.yaw) * Math.cos(cameraState.pitch), Math.sin(cameraState.pitch)];
    const right = [-Math.sin(cameraState.yaw), Math.cos(cameraState.yaw), 0];
    const up = [-Math.cos(cameraState.yaw) * Math.sin(cameraState.pitch), -Math.sin(cameraState.yaw) * Math.sin(cameraState.pitch), Math.cos(cameraState.pitch)];
    let distance = cameraState.radius;
    for (const panel of panels) {
        if (!panel.element.clientWidth || !panel.element.clientHeight) {
            continue;
        }
        const verticalTan = Math.tan(panel.view.camera.fov * Math.PI / 360);
        const horizontalTan = verticalTan * panel.element.clientWidth / panel.element.clientHeight;
        for (const corner of cameraState.corners ?? []) {
            const relative = corner.map((v, i) => v - [cameraState.target.x, cameraState.target.y, cameraState.target.z][i]);
            const dot = axis => relative.reduce((sum, v, i) => sum + v * axis[i], 0);
            distance = Math.max(distance, dot(out) + Math.abs(dot(right)) * 1.12 / horizontalTan,
                dot(out) + Math.abs(dot(up)) * 1.12 / verticalTan);
        }
    }
    cameraState.distance = distance;
    syncCameras();
}

async function createPanel(id) {
    const element = $(id);
    const app = new Application();
    await app.init({ width: element.clientWidth, height: element.clientHeight, preference: 'webgl',
        resolution: Math.min(devicePixelRatio, 1.5), autoDensity: true, antialias: true,
        autoStart: false, background: 0x343b44, preserveDrawingBuffer: true });
    element.append(app.canvas);
    const view = new View3D({ autoResize: true, camera: new NixieSceneV2Camera3D({ near: 0.01, far: 10000 }),
        toneMapping: 'none', shadowFilter: 'pcf-high', environment: { skyColor: 0xffffff, groundColor: 0xa3a09a, intensity: 0.25, up: { x: 0, y: 0, z: 1 } } });
    const sun = new DirectionalLight({ color: 0xfff5eb, intensity: 4.5, castShadow: true });
    const ambient = new AmbientLight({ color: 0xffffff, intensity: 3 });
    const ground = new Mesh3D({ geometry: new PlaneGeometry({ width: 1, height: 1 }),
        material: new Material3D({ baseColor: 0x383838, metallic: 0, roughness: 1, specular: { factor: 0 } }),
        castShadow: false, receiveShadow: true, eventMode: 'none' });
    view.root.addChild(sun, ambient, ground);
    app.stage.addChild(view);
    const panel = { app, view, element, sun, ambient, ground, model: null, loaded: [] };
    new ResizeObserver(() => {
        if (element.clientWidth && element.clientHeight) {
            app.renderer.resize(element.clientWidth, element.clientHeight);
            syncCameras();
        }
    }).observe(element);
    let drag = null;
    element.addEventListener('contextmenu', event => event.preventDefault());
    element.addEventListener('pointerdown', event => {
        element.setPointerCapture(event.pointerId);
        drag = { x: event.clientX, y: event.clientY, pan: event.shiftKey || event.button === 2 };
    });
    element.addEventListener('pointermove', event => {
        if (!drag) {
            return;
        }
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        drag.x = event.clientX;
        drag.y = event.clientY;
        if (drag.pan) {
            const scale = cameraState.distance / Math.max(element.clientHeight, 1);
            const right = { x: -Math.sin(cameraState.yaw), y: Math.cos(cameraState.yaw) };
            cameraState.target.x -= right.x * dx * scale;
            cameraState.target.y -= right.y * dx * scale;
            cameraState.target.z += dy * scale;
        } else {
            cameraState.yaw -= dx * 0.006;
            cameraState.pitch = Math.max(-1.5, Math.min(1.5, cameraState.pitch + dy * 0.006));
        }
        syncCameras();
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) {
        element.addEventListener(event, () => {
            drag = null;
        });
    }
    element.addEventListener('wheel', event => {
        event.preventDefault();
        cameraState.distance = Math.max(cameraState.radius * 0.015, Math.min(cameraState.radius * 30, cameraState.distance * Math.exp(event.deltaY * 0.001)));
        syncCameras();
    }, { passive: false });
    return panel;
}

async function releaseModels(loaded) {
    for (const { model, blobUrl } of loaded) {
        model.unload();
        model.destroy();
        await Assets.unload(blobUrl);
        URL.revokeObjectURL(blobUrl);
    }
}

async function replaceModel(panel, plan, group, token) {
    panel.element.querySelector('.loading').hidden = false;
    const loaded = [];
    const root = new Container3D();
    try {
        for (const row of plan) {
            const response = await fetch(pathFor(row.id, group, row.profile));
            if (!response.ok) throw new Error(`Model request failed (${response.status}): ${row.id}`);
            const bytes = prepareNixieSceneV2ModelGlb(new Uint8Array(await response.arrayBuffer()));
            const jsonLength = new DataView(bytes.buffer).getUint32(12, true);
            const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
            const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'model/gltf-binary' }));
            let source;
            try { source = await Assets.load({ src: blobUrl, parser: 'glb' }); }
            catch (error) { URL.revokeObjectURL(blobUrl); throw error; }
            const model = new Model3D({ source, autoUpdate: false });
            loaded.push({ model, blobUrl });
            // Keep native metres and the authored blueprint placement for every slice.
            // Identical texture settings isolate geometry changes in the control view.
            model.rotation.set(Math.PI / 2, 0, 0);
            const anchor = json.asset.extras.nixieModelAnchor;
            model.position.set(anchor.offsetX / 32, -anchor.offsetY / 32, anchor.offsetZ / 32);
            root.addChild(model);
            if (token !== requestId) break;
        }
    } catch (error) {
        await releaseModels(loaded);
        root.destroy();
        throw error;
    }
    if (token !== requestId) {
        await releaseModels(loaded);
        root.destroy();
        return;
    }
    const bounds = root.getLocalBounds();
    panel.ground.position.set((bounds.min.x + bounds.max.x) / 2, (bounds.min.y + bounds.max.y) / 2,
        (plan[0].blueprintOrigin?.z ?? 0) / 32 - 0.001);
    const size = Math.max(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z) * 8;
    panel.ground.scale.set(size, size, 1);
    if (panel.model) {
        panel.view.root.removeChild(panel.model);
        panel.model.destroy();
    }
    const previous = panel.loaded;
    panel.model = root;
    panel.loaded = loaded;
    panel.view.root.addChild(root);
    panel.element.querySelector('.loading').hidden = true;
    await releaseModels(previous);
    return root;
}

const pathFor = (asset, group, profile) => `/models/${group}/${asset}.${profile}.glb`;
const sizeText = bytes => bytes >= 1e6 ? `${(bytes / 1e6).toFixed(2)} MB` : `${(bytes / 1000).toFixed(1)} KB`;
async function loadComparison(reset = false) {
    const token = ++requestId;
    const asset = $('asset').value;
    const variant = variants.find(v => v.id === $('variant').value);
    const reference = variants.find(v => v.id === $('reference').value);
    const planFor = variant => reviewModelPlan(measurements[variant.group], asset, $('assembly').value);
    const candidatePlan = planFor(variant), referencePlan = planFor(reference);
    const totals = plan => plan.reduce((sum, row) => ({ bytes: sum.bytes + row.bytes, triangles: sum.triangles + row.triangles }), { bytes: 0, triangles: 0 });
    const candidate = totals(candidatePlan), control = totals(referencePlan);
    $('reference-title').textContent = reference.label;
    $('candidate-title').textContent = variant.label;
    const precisionNote = referencePlan.some(row => row.geometryProfile === 'precision16') ? ' · Precision reduced to fit the resource limit' : '';
    $('original-stats').textContent = `${sizeText(control.bytes)} · ${control.triangles.toLocaleString()} triangles · ${referencePlan.length} GLB${referencePlan.length === 1 ? '' : 's'} · 512px textures${precisionNote}`;
    const comparison = reference.id !== variant.id ? ` · ${(100 * (1 - candidate.bytes / control.bytes)).toFixed(1)}% smaller than reference` : ' · Same model, independent lighting';
    $('candidate-stats').textContent = `${sizeText(candidate.bytes)} · ${candidate.triangles.toLocaleString()} triangles · ${candidatePlan.length} GLB${candidatePlan.length === 1 ? '' : 's'} · 512px textures${comparison}`;
    $('download').href = pathFor(asset, variant.group, variant.id);
    $('download').download = `${asset}.${variant.id}.glb`;
    $('status').textContent = 'Loading comparison…';
    try {
        await Promise.all([replaceModel(panels[0], referencePlan, reference.group, token), replaceModel(panels[1], candidatePlan, variant.group, token)]);
        if (token !== requestId) {
            return;
        }
        if (reset) {
            const bounds = panels[0].model.getLocalBounds();
            cameraState.radius = Math.max(0.01, Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z) / 2);
            cameraState.center = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 };
            cameraState.corners = [];
            for (const x of [bounds.min.x, bounds.max.x]) {
                for (const y of [bounds.min.y, bounds.max.y]) {
                    for (const z of [bounds.min.z, bounds.max.z]) {
                        cameraState.corners.push([x, y, z]);
                    }
                }
            }
            resetView();
        }
        syncCameras();
        $('status').textContent = 'Ready — cameras are synchronized';
        document.body.dataset.ready = `${asset}:${variant.id}`;
    } catch (error) {
        if (token !== requestId) {
            return;
        }
        $('status').textContent = `Could not load: ${error.message}`;
        console.error(error);
    }
}

panels.push(await createPanel('original'));
panels.push(await createPanel('candidate'));
updateLighting();
$('left-lighting').addEventListener('change', updateLighting);
$('right-lighting').addEventListener('change', updateLighting);
$('shadows').addEventListener('change', updateLighting);
$('asset').addEventListener('change', () => { updateChoices(); loadComparison(true); });
$('assembly').addEventListener('change', () => loadComparison(true));
$('variant').addEventListener('change', () => loadComparison());
$('reference').addEventListener('change', () => loadComparison());
$('reset').addEventListener('click', resetView);
$('zoom-in').addEventListener('click', () => {
    cameraState.distance *= 0.8;
    syncCameras();
});
$('zoom-out').addEventListener('click', () => {
    cameraState.distance *= 1.25;
    syncCameras();
});
$('top').addEventListener('click', () => {
    cameraState.pitch = 1.5;
    fitView();
});
$('side').addEventListener('click', () => {
    cameraState.pitch = 0;
    fitView();
});
$('fullscreen').addEventListener('click', () => {
    document.body.classList.toggle('single');
    $('fullscreen').textContent = document.body.classList.contains('single') ? 'Show Both Views' : 'Enlarge Compressed View';
});
await loadComparison(true);
