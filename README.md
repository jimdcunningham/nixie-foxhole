# Nixie Foxhole

Open-source Foxhole tooling maintained for Nixie Studio.

The first published component is [FoxWatch](tools/foxwatch/README.md), a local pipeline that reads a user's own Foxhole installation, extracts structured game data and meshes, renders planner assets through Blender, and produces a versioned asset bundle.

This repository also owns both Planner implementations:

- `extensions/foxhole-planner`: the portable public-SDK runtime, ECS components, products, renderers, and 3D resources.
- `packages/extensions/foxhole`: the trusted Studio integration, including the existing Vue panels, Inspector forms, V1 compatibility, imports, and Foxhole services.

Studio consumes a pinned revision of these sources before dependency installation. The internal integration is compiled with Studio and shares one activation identity, `nixie.foxhole-planner`, with the SDK runtime. Saved `foxhole` activation preferences remain supported. The internal integration still depends on private Studio interfaces; these are transitional integration dependencies, not public SDK APIs.

For integration development, connect this checkout once by running `npm run setup:foxhole -- --source ../nixie-foxhole --local` from Nixie, then `npm install`. Nixie's ignored `.vendor/nixie-foxhole` link points here; Nuxt and the SDK watcher consume this checkout directly. There is no source copy or synchronization step. Set `NIXIE_HOST_ROOT` for a nonstandard Nixie location. Run the host tests with `npm run test:host --workspace @nixie/extension-foxhole` from Nixie. The SDK-only packed-consumer gate remains `npm run verify:extension-standalone:planner`. Source code is public; generated game assets remain separate inputs inside this checkout.

The root npm workspace and CI remain FoxWatch/schema-only. Planner source packages are deliberately excluded from that install: the internal layer needs private Nixie host files, and the SDK's preview dependency is supplied and verified by the consuming Nixie workspace. Moving their source here must not make the FoxWatch build depend on a sibling Nixie checkout or generated game assets.

## Get started

Requirements:

- Node.js 24 LTS and npm
- .NET SDK 8
- A local Foxhole installation
- Blender 5.x for render workflows

Clone the repository and its parser dependency, then build and test FoxWatch:

```powershell
git clone --recurse-submodules https://github.com/jimdcunningham/nixie-foxhole.git
cd nixie-foxhole
npm install
npm run build:foxwatch
npm test
```

Run `npm run foxwatch -- help` for the command list. See the [FoxWatch operator guide](tools/foxwatch/README.md) for setup and workflows.

## Licensing and game assets

Original code in this repository is available under the [MIT License](LICENSE).

CUE4Parse is included as a Git submodule and remains under its own Apache-2.0 license and third-party notices. Generated files and assets extracted from Foxhole are deliberately excluded from this repository and are not relicensed under MIT. Users must provide their own legitimate Foxhole installation and are responsible for complying with the game's terms.

Foxhole is a trademark of Siege Camp. This community project is not affiliated with or endorsed by Siege Camp.

## FoxWatch desktop inspector

The standalone Electron/Vue inspector is in [tools/foxwatch-desktop](tools/foxwatch-desktop/README.md).
Run `npm run dev:desktop` to browse the local generated assets directory, or use its
File menu to open another directory. This first slice is read-only and leaves the
existing tray Monitor and Steam polling unchanged. No generated assets are bundled.
