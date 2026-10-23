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
Right/Left expand/collapse; Enter opens a file. Single-click opens file metadata and
a format-specific preview placeholder on the right. Drag the divider to resize the
sidebar. **View → Refresh Assets** (Ctrl+R) refreshes expanded folders; Ctrl+B toggles
the sidebar. Right-click a file to reveal it in Explorer; a folder also offers opening
that folder directly. There are no create, rename, delete, or upload actions.

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
keyboard navigation, virtualized large folders, directory switching, and the IPC
boundary. It does not touch the running Monitor or upload anything.
