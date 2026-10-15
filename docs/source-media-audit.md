# Source Media Boundary

The source repository must not track extracted game models, textures, icons, maps, audio, or screenshots containing game artwork. Generated assets are separate local/release inputs, not MIT-licensed source.

Run `npm run test:source-media` after staging a change. It checks the actual indexed Git blob bytes, not just extensions or the working tree. New media/binary content, changed approved bytes, embedded payloads and generated-asset paths fail closed. Add an exact SHA-256 and a reviewed provenance note in `config/source-media.json` only for independently authored tooling/branding/synthetic fixtures. The CUE4Parse submodule is a separate third-party code/license boundary.

## Reviewed Retained Files

- Icon-publish fixtures contain one constant RGBA color per image (including a fully transparent fixture), verified by decoding every pixel. They contain no game artwork.
- `RegionMask.png` is only a geometric hexagon mask.
- `render-template.blend` contains the authored camera/light rig: four objects, no meshes, materials or packed images, verified in headless Blender.
- The monitor icon and two SVGs are Nixie branding and generic UI icons.

## Removed Source Files

The 11,249,504-byte exported Resource Transfer Station GLB, its extraction metadata, and eight Planner screenshots were removed. The old saved model resource ID now points at `/foxhole/assets/models/facilitytransferresource.glb` in the separately supplied asset bundle. No game geometry or textures are inlined as a replacement. The screenshots were unreferenced by runtime source. Generated position/recipe migration reports and an old pose backup were also removed; authored tests and compatibility documentation remain.

## History Is Not Clean Yet

The exported model blob is `a9e427cdfcd4a271ff2ef95e956ec9ff00b0713f` in both repositories. Old source paths include `packages/nixie/app/assets/scene-v2/resource-transfer-station.glb` in Nixie and `packages/extensions/foxhole/app/assets/legacy-scene-v2/resource-transfer-station.glb` here. Both histories also contain the removed screenshots. Nixie additionally has historical game-bearing output images and authored game-icon overrides under `output/` and `tools/foxwatch/asset-overrides/`.

A current-tree deletion does not erase these objects, remote copies, tags or forks. The owner must flatten/rewrite publication history before treating the public source history as clean. After flattening, Nixie must pin the new external commit hash. Do not retain/publish old source branches or tags. No history rewrite or remote publication is performed by this cleanup. This audit is not a legal clearance or a review of separately distributed asset releases.
