# FoxWatch

FoxWatch is the local asset pipeline for Foxhole Planner. It reads Foxhole game assets from a local Foxhole install, extracts structured data and meshes, renders planner images through Blender, and publishes the generated outputs into `packages/extensions/foxhole/public/foxhole/assets`.

Use this README as the main operator guide for setup, configuration, and common workflows. Blender-specific rendering details live in `tools/foxwatch/blender/README.md`.

For the nonmutating asset-delivery preflight and cross-region sharing report, see
[Asset Publication Inventory](../../docs/asset-publication.md).

## What FoxWatch writes

FoxWatch primarily works with two output areas:
- `tools/foxwatch/tmp/` for intermediate manifests, extracted assets, render scenes, diagnostics, and temporary outputs
- `packages/extensions/foxhole/public/foxhole/assets/` for published planner assets that the app serves locally

The published assets directory is ignored by this repository. Generated Foxhole game assets must not be committed or treated as MIT-licensed source code.

Common paths:
- `tools/foxwatch/tmp/foxwatch-manifest.v1.json`: raw generated source manifest
- `tools/foxwatch/tmp/modification-render-index.v1.json`: canonical modification `renderId` index
- `tools/foxwatch/tmp/renders/`: generated Blender render scene bundles
- `tools/foxwatch/tmp/decoded-asset-bundles/v1/<pak-fingerprint>/`: PAK-addressed, fully decoded package/inspection/mesh/material/texture/icon bundle
- `tools/foxwatch/tmp/assets/`: stable active view of the current bundle's canonical render assets
- `tools/foxwatch/tmp/foxhole-icons/`: stable active view of the current bundle's canonical UI textures and icon-key index
- `tools/foxwatch/tmp/rendered-assets/`: Blender image outputs (`types/`, `shared/`) before publish
- `packages/extensions/foxhole/public/foxhole/assets/manifest.v1.json`: published planner manifest
- `packages/extensions/foxhole/public/foxhole/assets/planner-compat.json`: CI metadata tying assets to planner version and schema versions

## Prerequisites

Required:
- Node.js 24 LTS
- npm
- .NET SDK 8
- A local Foxhole install with access to `War/Content/Paks`

Optional, but required for render workflows such as `refresh`:
- Blender 5.x or another compatible Blender install on `PATH`

Optional for automatic Steam acquisition:
- A Steam account that owns Foxhole and can access both `public` and `devbranch`
- Windows Task Scheduler (included with Windows)

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
- reuses a PAK-fingerprinted decoded asset bundle, rebuilding only missing or explicitly versioned package, inspection, geometry, material, texture, and icon sections
- generates a full raw FoxWatch manifest
- generates full render scene bundles
- renders planner images through Blender
- publishes outputs into `packages/extensions/foxhole/public/foxhole/assets`

If Blender is not installed yet, start with non-render workflows such as `generate-manifest`, `generate-map-data`, or `extract-ui-assets`.

## Automatic Steam Monitoring

Use [FoxWatch Desktop](../foxwatch-desktop/README.md) for Steam polling,
generation, inspection, credentials, and publishing.
The shared polling/generation CLI (`monitor-once`, `monitor-now`, `monitor`,
`monitor-status`, and `monitor-logs`) remains supported and is used by Desktop.

In Desktop Settings enable **Start With Windows** and **Start Minimized
at Login**, save settings, and choose **Start Polling** on the Dashboard when ready.
Saving Settings registers Desktop even when Start With Windows was already checked.
Credentials, Steam installations, generated assets, logs, and pipeline state are
reused. Desktop starts paused on first adoption.

Nixie notifications use the same saved webhook and **Nixie Checkpoint
Notifications** setting. Automatic polls send new-build, refresh-started,
refresh-finished, and failure checkpoints. Manual refreshes, unchanged polls,
asset preparation, upload checks, and publishing do not send these checkpoints.
Delivery failures are recorded in the run/monitor logs and do not fail generation.

### Configuration and Polling

Configure your Steam account, Blender path, polling interval, and optional Nixie
webhook in Desktop Settings. Credentials are encrypted with Windows DPAPI for
the current Windows account. Machine-local credentials, Steam installations,
state, locks, and logs remain under the ignored `tools/foxwatch/local/` folder.

Each poll selects the highest BuildID across public and devbranch, acquires and
verifies the inactive installation slot, then runs the refresh. A failed refresh
retains the verified installation for a retry; success is recorded only after the
refresh completes. Desktop owns startup registration and polling preferences.

For diagnostics, the shared CLI remains available:

```powershell
npm run foxwatch -- monitor-status
npm run foxwatch -- monitor-now
npm run foxwatch -- monitor-now -- --force-refresh
npm run foxwatch -- monitor-logs -- --lines 250
npm run foxwatch -- monitor
```

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
npm run foxwatch -- generate-manifest
```

## Configuration

FoxWatch reads configuration from:
- CLI arguments
- environment variables
- `tools/foxwatch/appsettings.json`
- built-in defaults in the FoxWatch source

### Pak directory

FoxWatch extraction uses the latest fully acquired and inventory-verified SteamCMD
installation recorded by the monitor. The Node workflow validates the acquisition
receipt and current PAK fingerprint before selecting it. Run `npm run foxwatch -- monitor-status` to inspect the selected build.

For an explicit diagnostic run, pass `--pak-path <path>` to the Node wrapper or
the C# CLI. The CLI passes that path to every extractor in the command. Without
a verified monitor installation or an explicit path, the Node wrapper stops
instead of reading the regular Steam library.

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

### 8. Benchmark direct PAK, loose raw snapshot, and decoded sources

Use this isolated benchmark to compare full manifest generation from the Foxhole PAK, the same CUE4Parse-recognized files extracted once into `tools/foxwatch/tmp/pak-snapshots/v1/`, generic decoded exports backed by that loose snapshot, and the production hybrid of decoded exports backed by the original PAK for residual typed reads:

```powershell
npm run foxwatch -- benchmark-manifest-source
```

The benchmark creates immutable raw and decoded fixtures keyed by the current Steam build and PAK inventory, then reuses them on later runs. Normal deep refreshes do not create or retain the loose raw fixture. All benchmark sources execute the same strict FoxWatch manifest extractor without the semantic raw-manifest cache, and the benchmark fails unless every generated manifest is byte-identical.

Deep refreshes maintain a generic decoded bundle under `tools/foxwatch/tmp/decoded-asset-bundles/v1/<pak-fingerprint>/`. It contains decoded Unreal export JSON, a persisted canonical package index and scene-inspection lookups, plus canonical GLBs, material sidecars, lossless textures, and UI icon pixels. Every game asset retains its Unreal virtual path below its section (`War/Content/...`); flat public icon keys live only in `icons/icon-source-index.v1.json`. No raw `.uasset`, `.uexp`, or `.ubulk` copies are retained.

The bundle identity depends on the PAK fingerprint and explicit per-section format versions, not arbitrary FoxWatch implementation hashes. A manifest interpretation, Blender, or publisher change therefore reuses the decoded bundle. If a canonical decoder format intentionally changes, bump only that section's contract version; texture invalidation also refreshes material metadata so referenced texture discovery remains complete. A Foxhole PAK change creates a new bundle. The original installed PAK remains the source of truth for constructing or repairing a bundle, and missing decoded packages fail closed rather than falling back silently.

Run additional alternating trials when comparing noisy timings:

```powershell
npm run foxwatch -- benchmark-manifest-source -- --iterations 3
```

Benchmark artifacts and `benchmark-results.v2.json` are written under `tools/foxwatch/tmp/manifest-source-benchmarks/`. This command does not render or publish assets.

### 9. Open and watch an asset manifest override

Use this to scaffold or edit a per-asset manifest override:

```powershell
npm run foxwatch -- open-asset-manifest -- --only trencht1
```

With auto-refresh on save:

```powershell
npm run foxwatch -- open-asset-manifest -- --only trencht1 --watch-refresh
```

### 10. Open the pose editor for one asset

Use this to work on pose overrides in Blender for a single asset:

```powershell
npm run foxwatch -- open-pose-editor -- --only trencht1
```

## 3D connector profiles

The model publisher emits a versioned `pathProfile` beside each supported model in `models/manifest.v1.json`. Roles refer to exported geometry indices and pre-bake mesh origins; runtime code does not depend on Blender object order. The model cache includes the profile recipe and prepared scene dependencies.

Overhead pipelines use native start/end supports, a repeatable connecting span, and the insulation upgrade's own profile. Normal and small-gauge rail variants reuse native rails, sleepers, and the trackbed where one is authored. Barbed wire repeats two coil rows and endpoint posts. Barbed-wire fences keep three straight panel sections, corner posts, and intermediate posts. These presentations use the existing connector path and interval rules, including endpoint elevation and attachment previews. Profiles remain resource metadata; saved connector and model components do not persist them.

`spatial-connector-profiles.mjs` prepares export-only scenes: it removes the sample span's axial stretch and adds the fence middle-post prototype when the minimum-length sample has no instance. Canonical 2D scenes remain unchanged. A subsequent deep refresh through FoxWatch Monitor rebuilds these profiles automatically; no separate render command or full batch is required to wire support.

## Structural 3D layers and modifications

Spatial export preserves authored bunker, trench, and foundation component identities in a versioned `structuralProfile`. Composite component scenes define roles such as roof plus roof dirt; Blender transform baking keeps these roles as named GLB groups. Foundation borders and corner pillars follow the existing socket visibility rules, and the floor group supplies the ground-contact surface.

Bunker and trench non-upgrade modifications are included in their owning asset GLB, parented under the original slot hierarchy. Canonical shared modification identities resolve shared prototypes; slot-specific scenes take precedence. Doors, firing ports, stairs, roofs, bridges, sandbags, wire, and infrastructure use independent groups. The Planner shows selected groups, hides replaced default walls, and applies connected-wall and roof/wall settings. Selection data stays unchanged; the visibility recipe is resource metadata.

The asset GLB loads on demand with its optional groups included. Existing model size and visibility budgets still apply. Prepared scenes and their mesh/material dependencies participate in the normal export cache, so the next Monitor deep refresh produces the new bindings without a separate migration. Missing modification scenes or ambiguous slots fail the individual export explicitly. Canonical 2D scenes are unchanged.

## Trench connector geometry and partial cutouts

Trench connector tiers T1–T3 export canonical component prototypes, including pieces absent from the minimum-length sample. The cache fingerprints the prepared prototypes and all mesh/material dependencies. The 3D presentation uses V1's shared native piece placements and independently rotated endpoint corners: wall and dirt sections, interval details, T2 floor covers, rigid end caps, and selected roof/sandbag/barbed-wire parts. Floors extend beneath closed ends and trim back to connected sockets; clipping retains the original UV mapping. Endpoint previews preserve the cut geometry and overhang weights. Saved connector state remains unchanged.

Joined left/right sides of regular trenches select their authored open-wall meshes, retaining the opposite solid side and corner pieces. Intersection floor approaches, occupied bunker-corner diagonal cuts, and emplacement floor/wall regions use the same socket occupancy and mask rules as V1. The host clips real triangles per model instance; clearing a connection restores the original geometry. Concave floor outlines are partitioned into convex regions without filling their empty corners. These recipes are regenerated by the next Monitor deep refresh; no full batch is needed for wiring or targeted verification.

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

Refreshes reuse existing render bytes when the visual scene, mesh/material/texture contents,
Blender template, rendering code/version, and render options match. Every cached image and
sidecar must also match its recorded content hash. Changing descriptions or balance metadata
does not invalidate renders. Missing or damaged outputs are rebuilt.

Publication caches image conversion separately, including the lossless master, encoding
options/library versions, and subtype overlay contents. An overlay change updates icons
without requiring a new Blender render. Cache records live under
`tools/foxwatch/tmp/pipeline-cache/v1/` and are disposable.

Use `npm run foxwatch -- refresh -- --only trencht1 --force-render` to bypass render reuse.
Use `npm run foxwatch -- clear-cache` to clear both render and publication cache records.
Limited/debug renders and partial selections within a dependent structure group render
normally so they cannot reuse incomplete wall-component postprocessing.

Blender produces one 256 × 256 PNG source for each rendered icon. Publishing applies
subtype badges and converts it to `icon.rendered.webp`; preview URLs reuse that icon.
The internal `.preview.png` filename is still used for the sole rendered-icon source,
not for a separate delivered preview.

After committing the generated manifest, publishing refreshes the world regions’
external catalog-model receipts, then removes unreferenced `.preview.webp` files
(including directional variants) beneath generated `types/` and `shared/`.
Cleanup validates the full deletion set first and refuses referenced previews or
symbolic links. PNG sources, current icons/textures/models, and map payloads remain.
Metadata-only publication skips both finalization steps. Neither step contacts R2.

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

Run `npm run foxwatch -- monitor-status` and ensure SteamCMD has a verified
acquisition. For a diagnostic run, pass `--pak-path <path>` explicitly.

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
- the repository root README for source-code and generated-asset licensing boundaries

### Firing Envelope Metadata

Mount range extraction preserves `MinYaw`, `MaxYaw`, `MinPitch`, `MaxPitch`, the resolved mount transform and the dynamic-data row name. These define an aiming envelope, not projectile spread or a ballistic hit prediction. Missing pitch limits retain ground coverage. Planar arcs use half of the source yaw span.

Normal manifest publication carries `firingVolume` as compact `fv` metadata and applies the same authored origin/heading overrides as the ground range. To migrate existing catalogs without touching images, models or unrelated metadata, first generate a targeted source manifest, then run:

```powershell
node tools/foxwatch/scripts/publish-firing-volumes.mjs <extracted-manifest> <published-catalog> <fixture-catalog>
dotnet run --project tools/foxwatch/tools/firing-volume-tests/FiringVolumeTests.csproj
node --test tools/foxwatch/scripts/firing-volume-schema.test.mjs
```

The SDK renderer restores the model's exported Blueprint-origin offset before drawing volumes. Supply, detection and other coverage radii remain ground overlays. AI turrets export `FiringConeAngle`, their resolved origin and orientation as `ai-turret` metadata; the SDK renders a circular radial cone. Artillery garrisons preserve their separate `FiringAngle` and minimum range as `ai-artillery` metadata. An absent/nonpositive angle retains the existing omnidirectional coverage convention as a full-angle volume. Nighttime and powered spotlights intersect eligible AI cones with the same structure-centered visibility cylinder used by ground ranges, preserving existing exceptions.


## Firing origin metadata

3D firing frames use the Blueprint muzzle component or the gunner's `MuzzleInfo` socket, including bone ancestry, mesh transforms and scale. Multi-barrel mounts use their first declared muzzle. Equivalent sockets shared by modular mesh parts are coalesced; genuinely different candidate frames are rejected. Artillery garrisons without a declared muzzle use their named barrel or gun pivot and keep the structure aiming frame.

Shared-skeleton candidates are ranked by render-section bone ownership: a mesh using the muzzle bone wins over a part using only a more distant ancestor. Equally owned, different frames remain unresolved. Physical sockets retain their authored model hierarchy and never receive the legacy planar body-axis inference. The legacy mech binds seat indices 1, 2 and 3 to its named main, left and right gun sockets. Its named scene components are initialized by the game and serialize at zero, so their static transforms are never used as muzzle positions.

`firingVolume.originSource` and `originName` record this provenance. `reference` preserves the ground range frame so authored corrections do not erase muzzle offsets. Legacy seat/ground-frame corrections do not rotate a resolved model-space muzzle. An unresolved native constructor frame stays `firing-component`; Planner keeps its ground coverage but does not present that position as a 3D muzzle. Generate against the PAK-addressed decoded package and inspection bundle used for the models.

For a metadata-only migration from the current source manifest, use `publish-firing-volumes.mjs --source-frame <source> <catalog> [catalog...]`. This preserves every existing 2D range field and replaces only firing metadata; old generated ground offsets are not applied to the new muzzle frame.

## Region World Assets

The authored world publisher, native importer/audit tools, compact runtime and retained viewers live in [packages/foxhole-world](../../packages/foxhole-world/README.md). Generated world content is published under the private assets repository's `world/` directory. It is not added to the catalog as unnamed mesh-only entries.

Publish an existing verified prepared cache without re-extracting the game:

```powershell
node tools/foxwatch/run-foxwatch.mjs export-world --world-input <prepared-cache>
```

Compact recipes are the default. This keeps existing texture encodings and reconstructs lossless road/terrain/decal geometry in browser workers. The expanded baked candidate is research only. Configure `FOXWATCH_WORLD_INPUT` to include compact world publication in complete, unlimited `refresh` runs. Targeted catalog refreshes do not touch world data. The configured cache must already contain the verified region preparation and recipe outputs; fresh-game Node preparation orchestration is still separate from this publisher.

Serve `world/content/br/**` with only `Content-Encoding: br`, and immutable caching for both `content/br/**` and `content/raw/**`. The Nuxt layer applies these headers. Files use payload-appropriate extensions rather than legacy `.gz` names so static hosting cannot infer a second encoding. The small root index is revalidated; content-addressed dependencies are reused across regions and cached locally.


### Remote Asset Publishing

Use `assets-prepare`, then `assets-publish` for a local dry run; add `--upload`
only when the prepared target and release are ready to publish. The Monitor's
**Asset Publishing** panel exposes the same workflow with encrypted local
credentials. See [the publication guide](../../docs/asset-publication.md).
