# FoxWatch Blender Render Bundles

These scripts replace the old `meshes.json` boundary with the new FoxWatch render bundles generated under `tools/foxwatch/tmp/renders`.

For overall setup, prerequisites, configuration, and common FoxWatch workflows, start with `tools/foxwatch/README.md`.

Run the examples below from the repo root so the relative paths resolve correctly.

Current status:
- FoxWatch now emits scaffold bundle scene manifests with structure identity, canonical category data, placeholder visuals, sprite metadata, render defaults, and a stable scene-graph shape.
- The Blender importer now treats placeholder width and height as world size at `64 px/m`, so the temporary plane path renders at true scale instead of normalizing everything to an arbitrary size.
- The render pipeline now supports three orthographic modes:
  - `topdown`: straight-down, size-accurate output at `64 px/m`
  - `preview`: 45 degree orthographic view for structure previews
  - `icon`: tighter 45 degree orthographic framing for icon-style renders

## Generate render bundles

From the repo root:

```powershell
npm run foxwatch -- generate-render-scenes
```

This writes per-structure render inputs to `tools/foxwatch/tmp/renders/<id>/scene.json`, per-structure render output metadata to `tools/foxwatch/tmp/renders/<id>/output.json`, an index manifest to `tools/foxwatch/tmp/renders/`, and exported mesh/material assets to `tools/foxwatch/tmp/assets/`.

## Override the Foxhole pak path

FoxWatch resolves the pak directory in this order:
- `--pak-path <path>` on the CLI
- `FoxWatch__PakDirectoryPath` from the environment
- `FoxWatch:PakDirectoryPath` in `tools/foxwatch/appsettings.json`
- the built-in Steam install fallbacks in `FoxWatchWorkspace.cs`

Examples:

```powershell
npm run foxwatch -- generate-manifest -- --pak-path "D:/SteamLibrary/steamapps/common/Foxhole/War/Content/Paks"
```

```powershell
$env:FoxWatch__PakDirectoryPath = "D:/SteamLibrary/steamapps/common/Foxhole/War/Content/Paks"
npm run foxwatch -- generate-manifest
```

## Configure the template blend

Run this against `tools/foxwatch/blender/render-template.blend` to create or refresh the named cameras and daylight sun used by the importer and renderer:

```powershell
blender "./tools/foxwatch/blender/render-template.blend" --background --python "./tools/foxwatch/blender/setup_render_template.py" -- --save
```

The template setup script ensures these named rig objects exist:
- `FoxWatchTopdownCamera`
- `FoxWatchPreviewCamera`
- `FoxWatchIconCamera`
- `FoxWatchSun`

## Import a single bundle scene in Blender

```powershell
blender "./tools/foxwatch/blender/render-template.blend" --python "./tools/foxwatch/blender/import_render_scene.py" -- \
  --scene "./tools/foxwatch/tmp/renders/artilleryait1/scene.json" \
  --mode preview \
  --replace-existing
```

You can also resolve through the index:

```powershell
blender "./tools/foxwatch/blender/render-template.blend" --python "./tools/foxwatch/blender/import_render_scene.py" -- \
  --index "./tools/foxwatch/tmp/renders/index.render-scenes.v1.json" \
  --structure-id artilleryait1 \
  --mode topdown \
  --replace-existing
```

Useful options:
- `--mode topdown|preview|icon`
- `--pixels-per-meter 64`
- `--preview-size 512`
- `--icon-size 256`
- `--purge-existing`

Scene node transforms can also be authored from raw Unreal blueprint values:
- `unrealLocationCentimeters`: `[x, y, z]` in Unreal centimeters
- `unrealRotationDegrees`: `[pitch, yaw, roll]` in Unreal rotator degrees
- `unrealSceneLocationCentimeters`: `[x, y, z]` in authored Unreal scene-component space

The importer converts those fields using the same `SwapYZ` + `0.01` basis used by the CUE4Parse glTF exporter, which keeps blueprint-derived attachment transforms in the same coordinate space as exported GLBs.

`unrealSceneLocationCentimeters` is available for component data that behaves like authored scene-space placement rather than mesh-local export space. It converts as `X, -Y, Z` in meters, which is useful for socket-style blueprint components such as facility build sockets.

## Batch render bundles in Blender

This example renders all three orthographic outputs for ten structures:

```powershell
blender "./tools/foxwatch/blender/render-template.blend" --background --python "./tools/foxwatch/blender/render_render_scenes.py" -- \
  --index "./tools/foxwatch/tmp/renders/index.render-scenes.v1.json" \
  --output-dir "./apps/foxhole-planner/public/foxhole/assets/types" \
  --mode topdown \
  --mode preview \
  --mode icon \
  --limit 10 \
  --purge-existing
```

Output files use these names:
- `<structureId>.texture.webp` for top-down structure renders
- `<structureId>.preview.webp` for preview renders
- `<structureId>.icon.rendered.webp` for rendered icons
- `components/<componentId>/<componentId>.texture.webp` for standalone render layers
- `../../shared/modifications/<sharedRenderKey>/<sharedRenderKey>.*.webp` for shared modification renders

## Dump animation packages for pose trials

To inspect pose and animation assets straight from the pak without changing the main render pipeline yet:

```powershell
npm run foxwatch -- dump-matching-packages --query LargeCrane,FacilityCrane,StaticCrane --path-prefix War/Content/Animation/ --output-dir tools/foxwatch/tmp/package-dumps/crane-animation
```

That dumps any matching crane animation packages under `tools/foxwatch/tmp/package-dumps/crane-animation/`.

You can also target one crane at a time:

```powershell
npm run foxwatch -- dump-matching-packages --query LargeCrane --path-prefix War/Content/Animation/ --output-dir tools/foxwatch/tmp/package-dumps/largecrane-animation
```

```powershell
npm run foxwatch -- dump-matching-packages --query FacilityCrane,StaticCrane --path-prefix War/Content/Animation/ --output-dir tools/foxwatch/tmp/package-dumps/facilitycrane-animation
```

Or use the raw FoxWatch CLI for other asset families:

```powershell
npm run foxwatch -- dump-matching-packages --query LargeCrane,FacilityCrane --path-prefix War/Content/Animation/ --output-dir tools/foxwatch/tmp/package-dumps/crane-animation
```

Optional filters:
- `--only artilleryait1,artilleryait2`
- `--category factories`
- `--limit 25`
- `--public-root <path>`
- `--foxwatch-output-root <path>`

Render bundle generation also supports the same targeting on the FoxWatch CLI:

```powershell
npm run foxwatch -- generate-render-scenes --category factories
```

```powershell
npm run foxwatch -- generate-render-scenes --only facilityfactoryammo,facilityfactorysmallarms,facilityrefineryoil
```

If both `--category` and `--only` are provided, both filters apply.

## Publish manifest safety

`publish-manifest` refuses an unfiltered publish when the source manifest looks targeted compared to the currently published manifest. That is what happens if you run a targeted `generate-manifest` or `refresh --only ...` first and then immediately run an unfiltered publish.

Use one of these flows instead:
- Regenerate a full source manifest, then run `npm run foxwatch -- publish-manifest`
- Keep the publish targeted: `npm run foxwatch -- publish-manifest -- --only trencht1`
- Override the safety check intentionally: `npm run foxwatch -- publish-manifest -- --allow-partial-source`

## Asset path resolution

The importer looks for files in this order:
1. `./apps/foxhole-planner/public`
2. `./tools/foxwatch/tmp/assets`

That lets it consume both existing bridge placeholder textures and future FoxWatch-exported assets.

## What is missing

- Real mesh scene nodes and mesh assets are not emitted yet.
- Material asset export is not wired yet.
- Preview and icon sizing are currently fixed square outputs; once real meshes land, those defaults may need tuning per asset family.

The next FoxWatch-side step is to populate `scene.roots`, `assets.meshes`, and `assets.materials` with real extracted data so Blender can stop using placeholder planes.
