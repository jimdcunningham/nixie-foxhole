# Nixie Foxhole

Open-source Foxhole tooling maintained for Nixie Studio.

The first published component is [FoxWatch](tools/foxwatch/README.md), a local pipeline that reads a user's own Foxhole installation, extracts structured game data and meshes, renders planner assets through Blender, and produces a versioned asset bundle.

The Nixie Foxhole Planner extension will move into this repository as the public extension SDK grows. Keeping the Foxhole code here lets the toolchain, shared schemas, and extension evolve independently from the closed Nixie Studio application.

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
