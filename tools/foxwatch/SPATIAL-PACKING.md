# Spatial Geometry Packing

`scripts/publish-spatial-models.mjs` defaults to the approved `curved50-compact16` profile. Explicit `--geometry-profile=lossless` and `--geometry-profile=precision16` remain available for diagnostics. Compact integer positions/UVs and lower triangle targets are not part of this default.

The authored `assetSelection: "catalog"` policy considers every catalog entry: structures,
vehicles, aircraft, naval assets, items, and destroyed/breached states. New catalog entries
become candidates automatically. `--only` narrows the selection and accepts repeated flags
from targeted Monitor refreshes. The extension binds available validated model output using
the same policy; an asset without exported output retains its 2D representation.

Scenes without visible static meshes (including procedural-only cables and icon-only items)
are skipped with a reason in the timing report. Missing scenes are also reported explicitly.
Unexpected export/packing failures are collected while other assets continue, and the process
exits unsuccessfully after saving the report. Failed assets do not retain model-manifest
references to potentially partial output. Retry fixes/re-exports just the missing or changed groups.

Vehicles use their static mesh contact bounds as ground references. Exported planar models
receive a minimum 0.001-metre selection extent without changing their actual geometry.
Existing upgrade assemblies, packing quality, source transforms, and resource bounds remain
in effect. Availability means a static export exists; it does not assert interactive animation,
articulation, in-game material parity, or per-asset visual review.

The publisher records the effective catalog policy in its output manifest. It does not delete
old GLB files. The matching extension policy admits available bases and parts across all
categories while preserving catalog identity and validating model metadata and paths.

The precision profile preserves all triangles and keeps the texture pipeline unchanged. It rounds position values to a shared power-of-two grid, normals/tangents to a 12-bit precision target, and UVs to a 16-bit fractional precision target. It retains FLOAT accessors and uses the existing `EXT_meshopt_compression` decoder format. It also reorders geometry for compression locality, uses the triangle index codec, and removes byte-identical complete vertex duplicates.

If rounding would collapse or reverse an existing face, the profile restores original position precision at that face's vertices. Coincident positions are restored together across meshes and attribute seams. Material bindings, nodes, authored anchors, and assembly metadata stay intact. The profile does not simplify geometry or reduce texture quality/resolution.

For a deliberately scoped run, use an explicit selection and output root. From this repository:

```powershell
node tools/foxwatch/scripts/publish-spatial-models.mjs --only=facilitytransferliquid,facilitytransferresource --geometry-profile=precision16 --repack-existing --output-root=<prepared-scratch-asset-root>
```

The output root must already contain a matching catalog `manifest.v1.json`; `--repack-existing` requires the raw GLBs and sidecars in the existing spatial export scratch directory. Omit that flag to invoke the configured Blender export. Do not use this example against the shipped asset directory merely to investigate a profile.

The accepted three-file precision experiment is approximately:

| Asset | Current GLB | Precision GLB |
| --- | ---: | ---: |
| Aircraft carrier | 15.462 MB | 11.142 MB |
| Liquid transfer station | 1.537 MB | 1.097 MB |
| Resource transfer station | 0.509 MB | 0.456 MB |

An integration check reconstructed decoded input from these three original packed GLBs and confirmed this implementation produces the accepted candidates byte-for-byte. Tiny-fixture regressions cover face preservation, unchanged texture bytes/materials/anchors, and rejection of unsupported inputs before mutation. This validates the packing implementation; it does not claim that the full Blender/game extraction pipeline was rerun or that the catalog was regenerated.

The publisher records `geometryProfile` and `precisionOptimization` in resource metadata for optimized profiles. Explicit lossless output retains its existing resource metadata shape. Run the affected regressions with:

```powershell
node --test tools/foxwatch/scripts/spatial-export-policy.test.mjs tools/foxwatch/scripts/spatial-geometry.test.mjs tools/foxwatch/scripts/spatial-gltf-geometry.test.mjs
```

`spatial-geometry.mjs` is private authoring-tool code. Its local mirror under the Nixie repository's `tools/experiments/` exists solely for bounded experiments, and the integration check requires the mirror and authored source to match exactly. No browser, host renderer, or public SDK dependency crosses into the packing code.

## Approved Curved-Detail and Compact Profile

`curved50-compact16` combines the accepted precision profile with a 50% triangle retention target, 0.1% relative simplifier error limit, locked borders, and attribute weights of 1. It protects connected curved regions no larger than one metre, detected using interpolated normal differences from 1 to 60 degrees. Coincident positions across seams are protected together. The 50% target is a lower retention bound for the simplification request; protection and error limits often keep more triangles. This heuristic does not promise semantic recognition of every valve or circular feature.

After simplifying, NORMAL and TANGENT attributes are stored as normalized signed 16-bit integers, using VEC3/VEC4 accessors with an 8-byte stride and required `KHR_mesh_quantization`. Conversion matches the current Nixie Pixi3D renderer's clamping and truncation, including tangent handedness. Positions and UVs remain FLOAT values with the accepted precision treatment. A shared float view is retained separately when a non-vector attribute also references it. The texture encoding pipeline remains unchanged.

The user reviewed and accepted these three combined samples:

| Asset | Combined GLB | Actual triangles retained |
| --- | ---: | ---: |
| Aircraft carrier | 10,367,336 bytes | 337,507 (92.5%) |
| Liquid transfer station | 968,056 bytes | 32,040 (78.7%) |
| Resource transfer station | 447,652 bytes | 3,808 (81.2%) |

The publisher reports actual packed `triangles`, the pre-packing `sourceTriangles`, the selected `geometryProfile`, precision/simplification statistics in `precisionOptimization`, and vector format/storage statistics in `compactVertexOptimization`. Precision angle metrics describe the intermediate float precision step; the compact step is separately verified against the current renderer's uploaded values.

For a future explicitly scoped export into a prepared scratch output root:

```powershell
node tools/foxwatch/scripts/publish-spatial-models.mjs --only=facilitytransferliquid,facilitytransferresource --repack-existing --output-root=<prepared-scratch-asset-root>
```

The implementation is integrated locally. No broad catalog generation, shipping asset refresh, commit, or publication was run. The Nixie integration verifier reconstructs decoded input from the same three packed originals and requires identical document values, binary data, and sizes against the accepted viewer files. Only JSON property ordering differs for the combined profile; the precision-only profile remains byte-identical. It also checks that the source implementation and workbench mirror are byte-identical. Regression tests cover curved tiny-face protection, tangent handedness, shared vector/position views, and invalid profiles, in addition to the precision-only regressions. This is packing-helper integration evidence, not a rerun of the complete Blender/game extraction pipeline.

After approval as the default, the actual publisher was exercised without a geometry-profile override for the resource and liquid transfer stations using existing Blender exports. It produced 447,652 and 968,056-byte GLBs in scratch. Nixie's installed loader verifies their materials, authored anchors, and uploaded geometry buffers match the accepted comparisons. No new full Blender/game extraction or broad model generation was run. Packing does not select scene lighting, bake runtime shadows, or establish in-game material fidelity; those need separate material/pixel and renderer comparisons.

## Spatial Cache and Timing

Normal Monitor refreshes reuse complete model groups from `tmp/pipeline-cache/v1/spatial-models/`.
A group includes the base, default part, all selected upgrade parts, and their manifest metadata.
Reuse verifies every output hash. Missing, corrupt, or partial output regenerates the group.
Fingerprints cover scene documents, source meshes and external glTF buffers/images, material
sidecars and their referenced textures, placement/assembly settings, packing settings, exporter
sources, Blender version, Sharp versions, and meshoptimizer version. Content is checked even
when file timestamps are unchanged. Missing and ambiguous optional sidecars are fingerprinted
as unresolved, so later availability invalidates reuse.

`--force-render` bypasses spatial reuse as well as 2D render reuse. The standalone publisher
also accepts `--force-spatial`. Monitor Clear Cache removes the shared pipeline-cache tree.
`--repack-existing` uses a distinct cache identity and verifies the existing raw GLBs and
metadata; it cannot bless an unverified full-export cache hit.

Each asset logs check, Blender export, packing, and total wall time. The final summary reports
exported/reused/failed counts. `tmp/spatial-timing-last.v1.json` saves the latest run, including
per-asset timings and failure details. `--timing-report=<path>` chooses another report location.
Timings describe the additional spatial publication stage, not the entire FoxWatch refresh.
