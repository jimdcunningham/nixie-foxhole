# Spatial Geometry Packing

`scripts/publish-spatial-models.mjs` defaults to the approved `curved50-compact16` profile. Explicit `--geometry-profile=lossless` and `--geometry-profile=precision16` remain available for diagnostics. Compact integer positions/UVs and lower triangle targets are not part of this default.

The explicit allowlist in `asset-overrides/spatial-models.json` contains 104 intact assets from Facilities, Power, Mining, Liquids, Foundations, Defenses, Utilities, and Locomotives (`facility`, `power`, `mining`, `liquids`, `foundation`, `defense`, `misc`, `trains`). Destroyed and breached assets/upgrade variants are excluded. The 17 allowlisted utility/rail vehicles use static ground-contact references via `groundedVehicles`; vehicles outside the explicit list remain excluded. Utilities here means the structure/vehicle `misc` category, not Utility inventory items. The list is a review boundary: new catalog entries do not automatically enter the spatial export. `--only` narrows this list; requests outside it are skipped so a normal refresh of a non-spatial asset still works.

The publisher filters stale out-of-scope base and part references from its output manifest and records `packingPolicy`. It does not delete old GLB files. The Nixie extension uses a matching policy snapshot to filter model bindings, copied files, and resource declarations, including previously generated files outside the approved list. Reconcile both snapshots deliberately when adding approved assets.

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
