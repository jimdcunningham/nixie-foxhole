# FoxWatch

FoxWatch is the local asset pipeline for Foxhole Planner inside the nixie monorepo. It reads Foxhole game assets from a local Foxhole install, extracts structured data and meshes, renders planner images through Blender, and publishes the generated outputs into `packages/extensions/foxhole/public/foxhole/assets`.

Use this README as the main operator guide for setup, configuration, and common workflows. Blender-specific rendering details live in `tools/foxwatch/blender/README.md`.

## What FoxWatch writes

FoxWatch primarily works with two output areas:
- `tools/foxwatch/tmp/` for intermediate manifests, extracted assets, render scenes, diagnostics, and temporary outputs
- `packages/extensions/foxhole/public/foxhole/assets/` for published planner assets that the app serves locally

The published assets directory is a separate private git repository. The nixie monorepo ignores it, so asset snapshots are tracked there instead of in the main codebase. See `packages/extensions/foxhole/public/foxhole/README.md` for clone and setup instructions.

Common paths:
- `tools/foxwatch/tmp/foxwatch-manifest.v1.json`: raw generated source manifest
- `tools/foxwatch/tmp/modification-render-index.v1.json`: canonical modification `renderId` index
- `tools/foxwatch/tmp/renders/`: generated Blender render scene bundles
- `tools/foxwatch/tmp/assets/`: extracted mesh and material packages used during rendering
- `tools/foxwatch/tmp/rendered-assets/`: Blender image outputs (`types/`, `shared/`) before publish
- `packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json`: published planner manifest
- `packages/extensions/foxhole/public/foxhole/assets/planner-compat.json`: CI metadata tying assets to planner version and schema versions

## Prerequisites

Required:
- Node.js 22 or newer
- npm
- .NET SDK 8
- A local Foxhole install with access to `War/Content/Paks`

Optional, but required for render workflows such as `refresh`:
- Blender 5.x or another compatible Blender install on `PATH`

Install workspace dependencies from the repo root:

```powershell
npm install
```

Build the FoxWatch .NET service from the repo root:

```powershell
npm run build:foxwatch
```

## Quick start

If you want a fresh local Foxhole Planner asset set after cloning the repo, the main command is:

```powershell
npm run foxwatch -- refresh -- --deep
```

That workflow:
- builds the FoxWatch .NET service
- generates a full raw FoxWatch manifest
- generates full render scene bundles
- renders planner images through Blender
- publishes outputs into `packages/extensions/foxhole/public/foxhole/assets`

If Blender is not installed yet, start with non-render workflows such as `generate-manifest`, `generate-map-data`, or `extract-ui-assets`.

## Command wrapper

Run FoxWatch from the repo root through the npm wrapper:

```powershell
npm run foxwatch -- <command>
```

When the command needs option flags, use a second `--` so npm passes those flags through unchanged:

```powershell
npm run foxwatch -- refresh -- --only trencht1
```

```powershell
npm run foxwatch -- generate-manifest -- --pak-path "D:/SteamLibrary/steamapps/common/Foxhole/War/Content/Paks"
```

## Configuration

FoxWatch reads configuration from:
- CLI arguments
- environment variables
- `tools/foxwatch/appsettings.json`
- built-in defaults in the FoxWatch source

### Pak directory

FoxWatch resolves the Foxhole pak directory in this order:
- `--pak-path <path>`
- `FoxWatch__PakDirectoryPath` environment variable
- `FoxWatch:PakDirectoryPath` in `tools/foxwatch/appsettings.json`
- built-in Steam install fallbacks in `FoxWatchWorkspace.cs`

PowerShell example:

```powershell
$env:FoxWatch__PakDirectoryPath = "D:/SteamLibrary/steamapps/common/Foxhole/War/Content/Paks"
```

You can also add this to `tools/foxwatch/appsettings.json`:

```json
{
  "FoxWatch": {
    "PakDirectoryPath": "D:/SteamLibrary/steamapps/common/Foxhole/War/Content/Paks"
  }
}
```

### Blender executable

The Node wrapper resolves Blender from:
- `BLENDER_PATH`
- otherwise `blender` on `PATH`

PowerShell example:

```powershell
$env:BLENDER_PATH = "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe"
```

## Common workflows

### 1. First-time full local asset generation

Use this after cloning the repo when you need a complete local planner asset set:

```powershell
npm run foxwatch -- refresh -- --deep
```

### 2. Full manifest generation without publishing

Use this when you want to inspect the raw FoxWatch manifest before publish:

```powershell
npm run foxwatch -- generate-manifest
```

Output:
- `tools/foxwatch/tmp/foxwatch-manifest.v1.json`

### 3. Publish the current raw manifest

Use this after generating a full manifest:

```powershell
npm run foxwatch -- publish-manifest
```

This writes the published manifest and related published asset metadata into `packages/extensions/foxhole/public/foxhole/assets`, including `planner-compat.json` for the assets repo release workflow.

### 4. Targeted refresh during iteration

Use this when you are iterating on a single asset or category and want the render and publish stages to stay narrow:

```powershell
npm run foxwatch -- refresh -- --only trencht1
```

```powershell
npm run foxwatch -- refresh -- --category trenches
```

### 5. Generate render bundles without rendering

Use this when you only need scene bundle output for debugging or Blender import work:

```powershell
npm run foxwatch -- generate-render-scenes
```

Targeted examples:

```powershell
npm run foxwatch -- generate-render-scenes -- --only trencht1
```

```powershell
npm run foxwatch -- generate-render-scenes -- --category factories
```

### 6. Extract UI textures from the game

Use this for map icons and other UI texture asset work:

```powershell
npm run foxwatch -- extract-ui-assets
```

### 7. Generate map data

Use this to regenerate Foxhole map data outputs:

```powershell
npm run foxwatch -- generate-map-data
```

### 8. Open and watch an asset manifest override

Use this to scaffold or edit a per-asset manifest override:

```powershell
npm run foxwatch -- open-asset-manifest -- --only trencht1
```

With auto-refresh on save:

```powershell
npm run foxwatch -- open-asset-manifest -- --only trencht1 --watch-refresh
```

### 9. Open the pose editor for one asset

Use this to work on pose overrides in Blender for a single asset:

```powershell
npm run foxwatch -- open-pose-editor -- --only trencht1
```

## Publish safety

`publish-manifest` protects against accidentally publishing a targeted source manifest as though it were a full manifest.

Example failure:
- you run `refresh -- --only trencht1`
- `tools/foxwatch/tmp/foxwatch-manifest.v1.json` now contains only that targeted asset set
- you then run `npm run foxwatch -- publish-manifest`
- FoxWatch refuses the publish because the source looks partial compared to the current published manifest

Use one of these instead:
- regenerate a full source manifest, then publish
- keep the publish targeted with `--only` or `--category`
- intentionally override the safety check with `--allow-partial-source`

Examples:

```powershell
npm run foxwatch -- publish-manifest -- --only trencht1
```

```powershell
npm run foxwatch -- publish-manifest -- --allow-partial-source
```

### Publish performance

The slowest publish step is usually copying/converting Blender output (`tmp/rendered-assets` → `public/foxhole/assets`), especially preview PNG → WebP and derived `icon.rendered` generation.

Defaults now:

- Process raw asset sync in parallel (`--publish-concurrency`, default ≈ CPU count, capped at 16)
- Co-locate per-structure published icons in parallel (same concurrency)
- Copy shared game icons to `public/icons/` in parallel (same concurrency)
- Index published render URLs in parallel (same concurrency), including batched image visibility checks
- Emit summary lines instead of logging every file (pass `--verbose` for the old per-file output)

Other useful flags:

```powershell
# Re-publish manifest only after a code/doc change; skip image work when outputs already exist
npm run foxwatch -- publish-manifest -- --skip-existing-assets

# Scoped refresh/publish is much faster than --deep when only a few assets changed
npm run foxwatch -- refresh -- --only trencht1

# More/less parallelism during publish (refresh forwards these flags)
npm run foxwatch -- refresh --deep -- --publish-concurrency 12
```

`--skip-existing-assets` is a big win when Blender output is unchanged and you only need manifest URL rewiring.

By default, publish logs only section summaries plus warnings/errors. Pass `--verbose` for per-file success logs.

Vehicle destroyed visuals are deny-by-default. Allowlist IDs in `tools/foxwatch/asset-overrides/vehicle-destroyed-whitelist.json`, or set `"publishDestroyedVisuals": true` in a structure's `asset-overrides/<codename>/manifest.json`.

## Useful lower-level commands

These pass straight through to the FoxWatch .NET CLI:
- `generate-map-data`
- `generate-manifest`
- `extract-ui-assets`
- `generate-render-scenes`
- `probe-mesh-export`
- `find-mesh-assets`
- `find-assets`
- `inspect-blueprint`
- `compare-animation-reference-pose`
- `export-mesh`
- `export-mesh-dir`
- `dump-package-files`
- `dump-matching-packages`

Examples:

```powershell
npm run foxwatch -- find-assets -- --query Trench --path-prefix War/Content/Blueprints/
```

```powershell
npm run foxwatch -- inspect-blueprint -- --asset-path War/Content/Blueprints/Structures/Trenches/BPTrenchT1.uasset
```

```powershell
npm run foxwatch -- dump-matching-packages -- --query LargeCrane,FacilityCrane --path-prefix War/Content/Animation/ --output-dir tools/foxwatch/tmp/package-dumps/crane-animation
```

## Troubleshooting

### Missing pak directory path

Set one of:
- `--pak-path <path>`
- `FoxWatch__PakDirectoryPath`
- `FoxWatch.PakDirectoryPath` in `tools/foxwatch/appsettings.json`

### Blender not found

Install Blender and either:
- add `blender` to `PATH`
- or set `BLENDER_PATH`

### `publish-manifest` refuses an unfiltered publish

Your source manifest is probably targeted. Regenerate a full source manifest or publish with matching target filters.

### I only need raw manifest or inspection data

You do not need Blender for `generate-manifest`, `generate-map-data`, `find-assets`, `inspect-blueprint`, or package dump workflows.

## Related docs

- `tools/foxwatch/ASSET-OUTPUT.md` for the authoritative published file layout, image roles, formats, and manifest URL rules
- `tools/foxwatch/blender/README.md` for Blender scene import and render bundle details
- `packages/extensions/foxhole/public/foxhole/assets/README.md` for the private assets repo release model