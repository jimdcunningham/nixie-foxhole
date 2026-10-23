# FoxWatch Desktop

The standalone Electron/Vue FoxWatch suite combines Steam build monitoring,
generation, asset inspection, A/B comparison, and explicit R2 publishing. The inspector stays
available while the existing FoxWatch CLI performs background work.

**View → Dashboard** shows the latest/successful builds, polling state, overall
stage progress, and run actions. **View → Workers & Logs** shows Blender workers,
3D export activity, counters, and recent output. The run strip remains visible
while browsing assets. Full per-run logs are saved in `tools/foxwatch/local/logs`.

**Run → Settings** (Ctrl+,) contains startup behavior, Steam/Blender/Node settings,
encrypted credentials, asset publication configuration, and cache maintenance.
Existing repository configuration and Windows DPAPI credentials are reused.
Secret values are never returned to the renderer. Empty credential fields keep
the saved values. Saving a password or key does not run a poll or upload.

Closing the window hides it in the native tray. Its menu opens the app, navigates
to the Dashboard/Settings, starts/pauses polling, or quits. Reopening FoxWatch
focuses the existing instance. **Start With Windows** registers the built app;
**Start Minimized at Login** keeps its initial window hidden. The built renderer
must exist before enabling startup; Windows login does not start a Vite server.

First adoption starts paused. **Retire Legacy Monitor** asks the WinForms monitor
to finish active work and exit, then removes only its old startup command. It
never kills the legacy process. Once it has exited, enable Windows startup here
and use **Start Polling**. The legacy executable is retained for rollback.

Only one pipeline operation runs at a time. Each automatic poll includes any
required acquisition/generation; the next interval starts only after completion.
**Pause Polling** leaves an active run alone; **Cancel Run** explicitly stops its
process tree and pauses future polling. Quit can wait for the active run without
disabling the saved polling preference for the next launch. CLI monitor/refresh
locks continue to protect work started outside Electron.

Publishing is manual: **Prepare Assets**, inspect/review, **Check Upload**, then
**Publish Assets**. Prepare/check never upload; publish requires confirmation and
updates the public stable channel only after verification. Generation never
automatically uploads, and publishing changes neither the local approved baseline
nor Nixie's checked-in release pin. Inspection/downloads work without Windows;
Steam, generation, DPAPI credentials, and this publishing controller are Windows-only.

From the `nixie-foxhole` checkout:

```powershell
npm install
npm run dev --workspace @nixie/foxwatch-desktop
```

For a built inspector, run `npm run build --workspace @nixie/foxwatch-desktop`,
then `npm run start --workspace @nixie/foxwatch-desktop`.
An alternate initial directory can be supplied with `-- --assets C:\Assets`.

The default is `packages/extensions/foxhole/public/foxhole/assets` in this checkout.
**File → Open Assets Directory** (Ctrl+O) selects another root and remembers it in
Electron's user-data directory. **Open Generated Assets** returns to the checkout's
generated assets. Hidden entries and symlinks/junctions are excluded. No generated
assets or game files are bundled into the app.

The left tree opens folders lazily and virtualizes visible rows. Arrow keys navigate;
Right/Left expand/collapse. Moving onto a file immediately opens it in the inspector,
as does a single click. Drag the divider to resize the
sidebar. **View → Refresh Assets** (Ctrl+R) refreshes expanded folders; Ctrl+B toggles
the sidebar. Right-click a file to reveal it in Explorer; a folder also offers opening
that folder directly. The directory navigator has no create, rename, delete, or upload actions.

**Review → Approve Current Assets as Baseline** explicitly saves an approved local
snapshot in Electron user data. **Compare With Approved Baseline** (or Refresh after
approval) hashes the working files and marks additions, modifications, and deletions.
**Changes Only** filters the navigator. Deleted files remain navigable and preview
from the approved copy; approval is independent of uploading or publishing.
Snapshot objects are deduplicated by content and original basename. Reopening a
folder remembers its approval; comparison is explicit, avoiding a full-library hash
scan at startup. World Brotli recompression alone does not count as an asset change.

**Return to Baseline…** below the directory controls (also in **Review**) discards
all reviewed file changes in the open directory. Its confirmation shows the exact
folder, approval date, number of modified/deleted files to restore, and additions
to remove; Cancel is the default. The baseline and its approval date are kept.
Successful restoration clears change markers and turns off Changes Only.

The app holds its operation guard while preparing, confirming, and restoring, so
automatic polling and manual generation cannot start in that interval. Generated
output also uses the CLI's refresh lock; other review folders use a local lock.
If working files change after confirmation, the restore stops and requires a new
confirmation. Every needed approved object is staged and content-verified before
working files move. Links, filesystem roots, and file/directory type conflicts are
rejected. Hidden metadata is kept, and only empty parents of removed additions
are pruned. If a later step fails, the error identifies a hidden
`.foxwatch-restore-*` directory containing recoverable working files and a journal.
Resolving the problem and returning to baseline again can finish the restore.
Existing prepared upload snapshots are independent; prepare again before
publishing restored working files.

**File → Download Published Assets** opens the download/update dialog. Choose the
entire library or catalog and models, check for updates, then **Download & Open**.
The public HTTPS release restores original logical filenames and verifies decoded
SHA-256/size receipts. No R2 credentials, Steam, .NET, or generation tools are needed
for inspection. The client uses Node/Electron filesystem APIs on Windows and macOS;
Explorer/Finder actions and native keyboard accelerators follow the platform. macOS
packaging and a native Mac runtime check remain future work.

Downloads live under Electron user data in `published-library`, separate from local
generation output. Compressed world files stay Brotli-compressed in both the cache
and readable library. Interrupted downloads leave the current library untouched;
retrying reuses verified cached content. A complete verified download opens as a new
local snapshot. Approval is never automatic, and an approved published-library
baseline follows later downloaded snapshots of the same scope. Older snapshots and
baseline content are retained; automatic pruning is not included yet.

The inspector checks `foxhole-planner/channels/stable.json`. Until that channel is
first published, it uses the release pin copied into the app at build time. Future
explicit full-library publishes update the channel only after all immutable objects
and release metadata verify. Planner-only metadata overlays do not change it.

Select a file and click **Compare** in the inspector header to inspect its
approved local version (A) against the current working file (B). Create the first
baseline using **Review → Approve Current Assets as Baseline**. Every comparison shows approved and working file sizes plus the signed byte and
percentage change. Hover a size for exact bytes on disk; added/deleted files and
empty baselines are labeled explicitly. A whole-directory
comparison is not required just to open one file's A/B view. Added and deleted
files show an explicit missing side; the approved file is never presented as
the current working version.

- Images: linked pan/zoom, side-by-side, swipe, overlay opacity, and pixel
  differences. Dimensions are shown for each side; backgrounds stay within image
  bounds. Pink highlights changed visible RGBA pixels, including alpha changes;
  hidden RGB in fully transparent pixels is ignored. Differences above four
  million pixels are sampled and labeled with the sampled resolution.
- Models: linked orbit/pan/zoom, side-by-side or A/B switching, and geometry,
  material, texture, and file-size summaries. Both use one camera and combined
  bounds in original coordinates; they are not independently rescaled to fit.
- JSON/manifests: searchable, filterable additions/removals/changed values with
  approved and working values alongside their field paths. Object key ordering
  and whitespace are ignored. Arrays with unique id/key/path/name fields match
  by identity, while meaningful reordering is reported separately. Raw sources
  remain available, including invalid JSON and text files.

Inspector view preferences are remembered across files and app restarts: image
comparison mode, separate swipe position and overlay opacity, image background,
model A/B mode, manifest view and change filter, and formatted/raw JSON. Camera
framing and image pan/zoom reset for each asset.

JSON comparisons read up to 8 MB per version and run off the renderer thread.
Field results stop at 3,000 changes, 200,000 visited nodes, or 64 nested levels,
with an explicit limit notice. Source display is capped at 1 MB per side.
Pixel work also runs in a worker. Viewer loading retains the prior rendered
asset until its replacement is ready, including switching comparison types.
Comparing never changes approval, generated files, publishing state, or pins.

Preview support:

- Images: PNG, WebP, JPEG, GIF, and SVG, with fit/actual-size zoom, drag panning,
  dimensions, and checkerboard, dark, or light backgrounds.
- Models: self-contained GLB 2.0, including meshopt geometry and embedded WebP
  textures, with orbit, pan, zoom, and reset controls. Rendering uses PixiJS and
  the vendored MIT-licensed `@pixi/3d` library, independently of Studio.
- Metadata: selectable text and JSON, including formatted/raw JSON and transparent
  decoding of Brotli world metadata. Text previews stop at 1 MB.

Images and models have a 32 MB source limit; decoded model geometry has a 128 MB
limit. External GLTF dependencies, Draco models, audio playback, material editing,
and animations are not included yet. Unsupported formats still show
file properties. Preview decoding and adaptation happen in memory; assets are never
rewritten. The 3D renderer is loaded only when a model is selected and renders on
interaction or resize rather than running an idle animation loop.

Original local filenames remain intact. Shared models receive readable owner/part
labels from the local model manifest, and region-manifest storage folders receive
region labels from the world index. Low-level content without an authored name uses
a compact shared-content label; the exact physical path remains available in the
tooltip and inspector. Labels never rename files or alter R2 fingerprints.

The sandboxed renderer has a narrow typed preload API. Main-process filesystem
operations resolve paths within the chosen canonical root, reject traversal and
links outside it, and reject stale root IDs. The inspector does not execute asset
files or render HTML from inspected content.

Validation:

```powershell
npm run typecheck --workspace @nixie/foxwatch-desktop
npm test --workspace @nixie/foxwatch-desktop
npm run build --workspace @nixie/foxwatch-desktop
```

Run `npm run test:desktop --workspace @nixie/foxwatch-desktop` for the Electron UI
smoke test. It uses isolated temporary assets and a temporary profile, opens its
own inspector, and intercepts Explorer launches. It checks native menus, browsing,
immediate keyboard selection, image/JSON/model previews, model orbit controls,
virtualized large folders, directory switching, image comparison modes, manifest
field searches, linked model cameras, missing A/B sides, cancelled/confirmed
baseline restoration, and the IPC
boundary. It does not touch the running legacy monitor, run Steam/generation, or upload anything. Controller integration checks use a synthetic CLI and temporary DPAPI credentials.
