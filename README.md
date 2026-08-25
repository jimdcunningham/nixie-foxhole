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

## Automatic Steam monitoring

FoxWatch can maintain its own verified Foxhole installation without reading the
normal Steam client installation. Setup is guided and idempotent:

```powershell
npm run foxwatch -- setup-monitor
```

The first setup asks for:

- the Steam username and password
- an optional Discord incoming webhook URL

Passwords and webhook URLs are encrypted with Windows DPAPI for the current
Windows account and are never written as plaintext configuration. SteamCMD
receives the decrypted password transiently for its login command, so it can be
visible to same-user or administrator process inspection while SteamCMD runs. Existing encrypted credentials are retained when
setup is rerun unless `--replace-credentials` is provided.

Setup downloads the official SteamCMD bootstrap, verifies authentication and
the BuildIDs for both `public` and `devbranch`, then publishes and starts the
lightweight FoxWatch Windows tray monitor. It polls once every ten minutes by
default and starts with the current user's Windows session. Closing its window
hides it back to the notification area; **Exit** stops the background monitor.
The resolved Blender executable is stored in the non-secret local configuration
so the scheduled task does not depend on a temporary shell environment. Use
`--blender-path <path>` if Blender is not already available through
`BLENDER_PATH` or `PATH`.

All machine-local data stays under the ignored directory
`tools/foxwatch/local/`:

```text
local/
  credentials/       DPAPI-encrypted credentials
  downloads/         SteamCMD bootstrap archive
  installs/          isolated public or devbranch acquisition slots
  locks/              concurrent-run protection
  logs/               monitor and FoxWatch output
  monitor-app/        published Windows tray monitor
  state/              observed, acquired, and successful BuildIDs
  steamcmd/           metadata and branch-specific SteamCMD clients
```

Every poll queries both branches and selects the numerically higher BuildID so
FoxWatch always follows the latest available build. Equal BuildIDs select
`public`. When Steam reports a new selected BuildID, the monitor updates that
branch's inactive installation slot, runs SteamCMD validation,
checks the installed app manifest, inventories the PAK/UTOC/UCAS files, and
writes an acquisition receipt. FoxWatch cannot consume the installation until
all checks agree on the requested BuildID.

Acquisition and pipeline success are separate states. If Blender or publishing
fails, the verified Steam installation remains reusable, but that BuildID stays
pending and is retried on the next poll. A completed build is not marked
successful until the deep refresh exits successfully.

Useful monitor commands:

```powershell
npm run foxwatch -- monitor-status
npm run foxwatch -- open-monitor
npm run foxwatch -- install-monitor-app
npm run foxwatch -- monitor-now
npm run foxwatch -- monitor-now -- --force-refresh
npm run foxwatch -- monitor-logs
npm run foxwatch -- monitor-logs -- --lines 250
npm run foxwatch -- monitor
npm run foxwatch -- uninstall-monitor
```

`open-monitor` shows the existing tray monitor window. `install-monitor-app`
migrates an existing configured monitor from the legacy repeating scheduled
task without asking for credentials again. Pass `-- --paused` to inspect a
failed or pending state before allowing the first tray-hosted poll. `monitor`
runs the same polling loop in the foreground for diagnostics.

### Tray app lifecycle

The tray app source is committed under `tools/foxwatch/monitor/`; its generated
Windows binaries are not committed. First-time `setup-monitor` configures the
Steam account and optional Discord webhook, downloads SteamCMD, publishes the
Release app into the ignored `tools/foxwatch/local/monitor-app/` directory,
registers it for the current user's Windows startup, and starts it.

Opening the generated executable does not perform first-time setup by itself.
After setup, use `open-monitor` or double-click the notification-area icon to
show the existing process. Closing its window returns it to the notification
area. `Start with Windows` controls the startup registration, while `Start
Minimized` controls whether that Windows-startup launch stays in the tray or
opens the monitor window. The monitor shows the current pipeline stage, overall
progress, aggregate Blender batch progress, and separate per-worker scene
progress. It also records the exact elapsed poll time and estimates remaining
Blender time from aggregate scene throughput. Full child-process output remains
in the persistent log files opened by `Open Logs`; it is intentionally not
rendered in the monitor window.

`Stop` terminates the active FoxWatch process tree and disables automatic
polling. The stopped state is saved under `local/state/`, so restarting the tray
app or Windows does not silently resume work. `Start` re-enables polling and
immediately begins a Steam metadata check. The monitor shows the exact local
time of the next scheduled poll whenever it is idle.

After pulling changes to the tray app source, run `install-monitor-app` to stop
the existing host, publish the updated binaries, preserve the machine-local
configuration and preferences, restart it, and open the updated window:

```powershell
npm run foxwatch -- install-monitor-app -- --paused
```

Omit `--paused` when the monitor should resume polling immediately. To remove
the app, run `uninstall-monitor`. It stops the tray host and removes both its
current-user startup entry and any legacy scheduled task, while deliberately
preserving Steam installations, decoded caches, credentials, state, and logs:

```powershell
npm run foxwatch -- uninstall-monitor
```

For unattended setup, provide `FOXWATCH_STEAM_USERNAME` and
`FOXWATCH_STEAM_PASSWORD`, optionally
`FOXWATCH_DISCORD_WEBHOOK_URL`, and run:

```powershell
npm run foxwatch -- setup-monitor -- --non-interactive --interval-minutes 10
```

The environment values are consumed only during setup and persisted as
DPAPI-encrypted values. Clear the environment variables after setup.

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
