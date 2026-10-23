# FoxWatch Desktop

The first Electron/Vue slice of the standalone FoxWatch tooling suite. This is a
read-only local asset inspector. It does not replace, launch, stop, or modify the
existing Windows tray Monitor. Steam polling, generation, A/B rendering, approval,
publishing, and the new background controller are later slices.

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
that folder directly. There are no create, rename, delete, or upload actions.

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
animations, and A/B comparison are not included yet. Unsupported formats still show
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
virtualized large folders, directory switching, and the IPC
boundary. It does not touch the running Monitor or upload anything.
