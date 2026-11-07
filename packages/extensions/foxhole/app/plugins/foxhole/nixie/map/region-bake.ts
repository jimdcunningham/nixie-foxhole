import { NIXIE_SPATIAL_DEFAULT_LIGHTING, NixieSpatialSceneLighting } from '#nixie/plugins/nixie/scene-v2/spatial-scene-lighting.ts';
import { Camera3D, View3D } from '@pixi/3d';
import { Rectangle } from 'pixi.js';
import type { Renderer } from 'pixi.js';
import { shallowRef } from 'vue';
import { FOXHOLE_REGION_WIDTH, FOXHOLE_REGION_HEIGHT } from './constants.ts';
import { FoxholeRegionSceneController } from './region-scene-controller.mjs';

export const regionBakeAction = shallowRef<((scale: 1 | 2, supersample?: boolean) => Promise<{ png: Blob; filename: string }>) | null>(null);

type WorldOptions = ConstructorParameters<typeof FoxholeRegionSceneController>[0];
type SyncOptions = Parameters<FoxholeRegionSceneController['sync']>[0];

export async function bakeFoxholeRegion(
    renderer: Renderer,
    worldOptions: WorldOptions,
    settings: SyncOptions['settings'],
    region: NonNullable<SyncOptions['regions']>[number],
    signal: AbortSignal,
    scale: 1 | 2,
    supersample = false,
): Promise<Blob> {
    const width = 2048 * scale;
    const height = 1776 * scale;
    const renderWidth = supersample ? width * 2 : width;
    const renderHeight = supersample ? height * 2 : height;
    const camera = new Camera3D({ near: 1, far: FOXHOLE_REGION_WIDTH * 4 });
    camera.mode = 'orthographic';
    camera.orthographicSize = Math.max(FOXHOLE_REGION_WIDTH, FOXHOLE_REGION_HEIGHT * width / height) / 2;
    camera.position.set(region.position.x, -region.position.y, FOXHOLE_REGION_WIDTH);
    camera.lookAt({ x: region.position.x, y: -region.position.y, z: 0 }, { x: 0, y: 1, z: 0 });
    const view = new View3D({
        width: renderWidth, height: renderWidth, autoResize: false, camera,
        environment: {
            skyColor: NIXIE_SPATIAL_DEFAULT_LIGHTING.skyColor,
            groundColor: NIXIE_SPATIAL_DEFAULT_LIGHTING.groundColor,
            intensity: NIXIE_SPATIAL_DEFAULT_LIGHTING.environmentIntensity,
            up: { x: 0, y: 0, z: 1 },
        },
    });
    const lighting = new NixieSpatialSceneLighting(view);
    type LoadedRegion = Awaited<ReturnType<WorldOptions['loadRegion']>>;
    let loaded: LoadedRegion | undefined;
    const { promise, resolve, reject } = Promise.withResolvers<LoadedRegion>();
    const abort = () => reject(signal.reason);
    const world = new FoxholeRegionSceneController({
        ...worldOptions,
        async loadRegion(options) {
            loaded = await worldOptions.loadRegion(options);
            return loaded;
        },
        onStatus(status) {
            if (status.phase === 'Ready' && loaded) resolve(loaded);
            else if (status.phase === 'error') reject(new Error(status.error ?? 'Could not prepare the region.'));
        },
    });
    const sync = () => world.sync({
        view,
        mode: '3d',
        settings: {
            ...settings,
            adaptiveStreaming: false,
            terrainLod: false,
            adaptiveTextures: false,
            vegetationDensity: 'full',
            frustumCulling: false,
            ambientOcclusion: false,
            worldLayers: { ...settings.worldLayers, shell: false },
            // RDZ stays enabled when selected. Planning graphics belong to the editor.
            terrainTopo: false,
            borders: false,
            voronoi: false,
            faction: false,
            grid: false,
            frontline: false,
            frontAlt: false,
            hotspots: false,
        },
        regions: [region],
        deltaMS: 0,
    });
    try {
        signal.throwIfAborted();
        signal.addEventListener('abort', abort, { once: true });
        sync();
        const scene = await promise;
        await scene.whenLayersReady?.();
        signal.throwIfAborted();
        sync();
        lighting.sync();
        // WebGPU depth copies must cover the full attachment. Pixi can allocate
        // a square backing texture for this region, so render the square first.
        const square = renderer.extract.canvas({
            target: view,
            frame: new Rectangle(0, 0, renderWidth, renderWidth),
            resolution: 1,
            antialias: false,
            clearColor: 'transparent',
        }) as HTMLCanvasElement;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not crop the region PNG.');
        context.imageSmoothingEnabled = supersample;
        context.imageSmoothingQuality = 'high';
        context.drawImage(square, 0, (renderWidth - renderHeight) / 2, renderWidth, renderHeight, 0, 0, width, height);
        const image = context.getImageData(0, 0, width, height);
        // Clip at pixel centers so the PNG keeps the same hard hex edge at either size.
        for (let y = 0; y < height; y++) {
            const inset = Math.floor(Math.abs(y + 0.5 - height / 2) * width / (2 * height) + 0.5);
            const row = y * width * 4;
            image.data.fill(0, row, row + inset * 4);
            image.data.fill(0, row + (width - inset) * 4, row + width * 4);
        }
        if (!image.data.some((value, index) => index % 4 === 3 && value !== 0)) {
            throw new Error('The renderer produced an empty region image.');
        }
        context.putImageData(image, 0, 0);
        return await new Promise<Blob>((done, fail) => {
            canvas.toBlob(blob => blob ? done(blob) : fail(new Error('Could not encode the region PNG.')), 'image/png');
        });
    } finally {
        signal.removeEventListener('abort', abort);
        world.destroy();
        await world.whenDisposed();
        view.destroy({ children: true });
    }
}
