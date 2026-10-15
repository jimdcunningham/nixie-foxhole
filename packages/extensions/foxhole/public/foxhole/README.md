# Foxhole public assets

The `assets/` directory is a separate private git repository and is ignored by the nixie monorepo.

## Setup

After cloning nixie, either clone the assets repository:

```powershell
git clone git@github.com:jimdcunningham/foxhole-planner-assets.git assets
```

Or clone [nixie-foxhole](https://github.com/jimdcunningham/nixie-foxhole) and generate assets with FoxWatch from that repository root. Configure its output directory to this `assets/` checkout, then run:

```powershell
node ./tools/foxwatch/run-foxwatch.mjs refresh --deep
```

See the `tools/foxwatch/README.md` file in `nixie-foxhole` for FoxWatch setup and operator workflows.

## CI consumption model

Production deploys do not build assets from this checkout directly. Instead:

1. FoxWatch publish workflows write `planner-compat.json` alongside `manifest.v1.json`.
2. Pushes to the assets repo `main` branch create a GitHub release tagged `{plannerVersion}-{7charSha}`.
3. The nixie `Deploy Nixie` workflow resolves the newest compatible release, downloads the tarball, and bakes assets into the Nuxt production build.

Asset semver resolution uses planner version `packages/extensions/foxhole/package.json` and optional `foxholeAssets` override. When unset, CI defaults to `^major.minor.0`.

See `docs/deployment/nixie-droplet.md` for deploy configuration and `packages/extensions/foxhole/public/foxhole/assets/README.md` for assets repo release details.
