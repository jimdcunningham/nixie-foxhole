# Nixie Foxhole extension

This package owns the trusted Foxhole Studio integration: existing Vue panels, Inspector forms, Scene V1 compatibility, importers, and Foxhole services. The portable SDK runtime lives in `../../../extensions/foxhole-planner`.

Nixie materializes both packages at a pinned revision before `npm ci`, then compiles this layer and bundles the SDK runtime with Studio. Edit this repository and refresh the consuming host with `node ./tools/prepare-foxhole-source.mjs --source ../nixie-foxhole --local` from the Nixie checkout. Tests for the internal integration run in that prepared host because its private `#nixie` imports are not public SDK contracts.

FoxWatch currently writes generated planner assets beneath `public/foxhole/assets/`. That output is intentionally ignored and is not covered by the repository's MIT license.
