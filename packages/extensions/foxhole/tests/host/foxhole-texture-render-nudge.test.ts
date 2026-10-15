import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const foxholeBoardTypeSources = [
    new URL('../../app/plugins/nixie/board/types/foxhole-structure.ts', import.meta.url),
    new URL('../../app/plugins/nixie/board/types/foxhole-spline-connector.ts', import.meta.url),
];

test('Foxhole board textures use the render-nudging shared loader', () => {
    for (const sourceUrl of foxholeBoardTypeSources) {
        const source = readFileSync(sourceUrl, 'utf8');
        assert.match(source, /loadBoardUrlTexture as loadFoxholeTexture/);
        assert.doesNotMatch(source, /PIXI\.Assets\.load\(url\)/);
    }

    const sharedLoaderSource = readFileSync(
        new URL('../../../../nixie/app/plugins/nixie/board/utils/url-texture.ts', import.meta.url),
        'utf8',
    );
    assert.match(
        sharedLoaderSource,
        /const cached = getCachedBoardUrlMedia[\s\S]*?if \(cached\) \{[\s\S]*?queueBoardRenderNudge\(\);\s*return cached;/,
    );
    assert.match(sharedLoaderSource, /if \(media\) \{\s*queueBoardRenderNudge\(\);/);

    const boardCoreSource = readFileSync(
        new URL('../../../../nixie/app/plugins/nixie/board/core.ts', import.meta.url),
        'utf8',
    );
    assert.match(
        boardCoreSource,
        /boardRenderNudgeHandler = \(\) => \{\s*[^}]*lastSceneCullSignature = '';\s*app\.render\(\);/,
    );

    const boardSceneSource = readFileSync(
        new URL('../../../../nixie/app/plugins/nixie/board/scene.ts', import.meta.url),
        'utf8',
    );
    assert.match(
        boardSceneSource,
        /this\.renderLanes\.sync\(this\.layer, this\.roots\);[\s\S]*?queueBoardRenderNudge\(\);/,
    );
    assert.match(
        boardSceneSource,
        /node\.loadBoardSnapshot\(parsed,[\s\S]*?this\.indexTree\(node\);\s*this\.scheduleRenderLaneRefresh\(\);/,
    );
});

test('Foxhole spline mesh rebuilds reuse cached span textures synchronously', () => {
    const splineSource = readFileSync(foxholeBoardTypeSources[1]!, 'utf8');

    assert.match(
        splineSource,
        /getCachedSpanRibbonTexture[\s\S]*?getCachedTexture\(textureUrl\)[\s\S]*?configureSpanRibbonTexture\(texture\)/,
    );
    for (const method of ['syncWallBarbedWireMesh', 'syncUnderlayMesh', 'syncSpanMesh']) {
        const start = splineSource.indexOf(`private ${method}`);
        const end = splineSource.indexOf('\n    private ', start + 1);
        const methodSource = splineSource.slice(start, end);
        assert.match(methodSource, /texture: cachedTexture \?\? PIXI\.Texture\.EMPTY/);
    }
});

test('Foxhole structure layer rebuilds retain loaded textures synchronously', () => {
    const structureSource = readFileSync(foxholeBoardTypeSources[0]!, 'utf8');

    assert.match(
        structureSource,
        /structureRenderLayerTextures = new Map<string, PIXI\.Texture>\(\)/,
    );
    assert.match(
        structureSource,
        /createStructureRenderLayerVisual[\s\S]*?getCachedStructureRenderLayerTexture\(textureUrl\)[\s\S]*?new PIXI\.Sprite\(cachedTexture \?\? PIXI\.Texture\.EMPTY\)/,
    );
    assert.match(
        structureSource,
        /ensureStructureRenderLayerTextureLoaded[\s\S]*?structureRenderLayerTextures\.set\(textureUrl, loadedTexture\)/,
    );
});
