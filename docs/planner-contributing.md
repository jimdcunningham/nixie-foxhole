# Contributing to Foxhole Planner

The SDK runtime lives in `extensions/foxhole-planner`. It can be developed against
an installed Nixie Studio desktop app. You do not need the private Nixie repo,
Blender, the .NET SDK, a game extraction pipeline, or publishing credentials for
this workflow. Generated catalog and geometry fixtures are downloaded from
pinned public receipts and verified by size and SHA-256.

## Setup

Use Node.js 24 (CI uses 24.22.1), npm, Git, and a compatible Studio desktop build.
Clone without submodules; the parser submodule is only needed for FoxWatch work.

```powershell
git clone https://github.com/jimdcunningham/nixie-foxhole.git
cd nixie-foxhole
npm run setup:planner
npm run dev:planner
```

Setup uses both committed npm lockfiles. Root dependencies support shared public
authoring helpers; Planner dependencies are installed separately because it is
not a root npm workspace. Install lifecycle scripts are disabled. Run setup in a
dedicated public-repo clone: npm ci replaces installed dependencies, and linked
private-host development checkouts have a different dependency layout.

Setup downloads the approximately 15 MB pinned catalog. Full checks also download
source metadata and approximately 1.2 GB of model fixtures (815 files in the current pin); allow additional download time and disk space.
They reuse verified cached files. These ignored inputs stay out of commits and
the extension archive. Ordinary runtime images/models are fetched by Studio's
verified asset cache as needed, so initial media use needs network access.

## Load Your Build in Studio

1. Open Editor Settings and search for Extensions.
2. Set Extensions Folder to the clone's **extensions** folder, not its root,
   foxhole-planner folder, or dist folder. Studio scans immediate subfolders.
3. Create or open an offline project and scene. In Explorer, switch its view to Extensions, then click the gear beside the Extensions heading to open Manage Extensions.
4. Approve Planner's requested local capabilities and enable Foxhole Planner.
5. Keep npm run dev:planner running. Edit files under extensions/foxhole-planner/src;
   Vite publishes completed builds to dist and Studio watches them for reload.

Local extensions currently run only in offline desktop projects. Use the
extension's DevTools and reload controls in Manage Extensions for diagnostics.
Changes that introduce new capabilities require approval. The watcher builds
JavaScript; Studio does not compile TypeScript itself.

Planner 0.4.2 currently declares Studio `0.9.4 || ^1.0.0`, SDK
`@nixiejs/extension-sdk@0.1.0-preview.3`, and packaging CLI
`@nixiejs/extension-package@0.1.0-preview.4`. These are declared compatibility
requirements, not a claim that every matching Studio release was tested.
Use a Studio build with local-source activation support. If Manage Extensions attempts to download Planner instead of enabling your local build, update Studio.

The verified workflow uses a clean Studio profile. A separately installed managed
Planner copy currently takes precedence over a local copy with the same ID.
If needed, launch Studio with a separate Electron `--user-data-dir` profile for
development so your ordinary projects and installed releases stay separate.

## Check Your Contribution

```powershell
npm run check:planner
```

This prepares pinned test fixtures, runs build-tool tests, typechecks and tests
Planner, builds dist, packs artifacts/extension.nxext, and verifies that archive.
The same commands run in pull-request CI on Windows and Linux without secrets.
To prepare fixtures separately, run `npm run fixtures:planner`, or include them
in initial setup with `npm run setup:planner -- --tests`.

If an existing input fails integrity validation, do not edit the receipt to make
it pass. Preserve any locally generated inputs, then use a fresh clone or move
the affected downloaded input aside and rerun preparation. Contributor commands
use the checked-in release pin and default fixture directory; asset-generation
environment overrides are intentionally ignored.

Include the behavior changed, checks run, and screenshots or a short recording
for visible changes in your pull request. Do not include generated game media,
downloaded fixtures, dist, or archives. Do not run publish:extension for a PR.

## What Can Be Changed Without Rebuilding Studio?

SDK components, product providers, render plans, sockets, connectors, and the
extension's own UI can use this reload loop. Existing compiled Vue panels,
Inspector forms, legacy V1 integration, and private host/map adapters under
packages/extensions/foxhole still require a Studio rebuild.

Catalog metadata and asset generation belong to FoxWatch. A normal Planner build
packages the pinned catalog without regenerating it; changes to generator source
need generator tests and a separately prepared asset release before appearing
in the runtime catalog.

## SDK Packages and Source

Published SDK JavaScript, TypeScript declarations, experimental Scene V2 exports,
and fake-host testing helpers are sufficient to build and test Planner. A separate
SDK Git repository is not required. Planner uses the public package entry points;
private Studio code is not part of the extension contract.

Do not rely on private source paths or local SDK tarballs in a Planner PR. SDK/host API changes need coordinated
package and Studio releases before ordinary contributors can use them.
