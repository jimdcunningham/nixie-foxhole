# Blueprint Material Assignments

Mesh defaults are not the final material assignment for a blueprint component.
FoxWatch retains `OverrideMaterials` with native slot indices, including holes,
and the world importer resolves those slots without modifying its cached mesh.
New native GLB primitives also retain their original material-slot indices.

For an adopted prepared world, inspect and translate the affected components:

```powershell
dotnet build packages/foxhole-world/importer/Importer.csproj
node packages/foxhole-world/prepare-blueprint-materials.mjs --input tools/foxwatch/tmp/world-prepared --native tools/foxwatch/tmp/blueprint-materials --pak "C:/Program Files (x86)/Steam/steamapps/common/Foxhole/War/Content/Paks" --regions deadlands --blueprints WoodBarrelWater,BPCoverStreetlamp1a,BPCoverBollard1c
node packages/foxhole-world/export-world.mjs --world-input tools/foxwatch/tmp/world-prepared --world-regions deadlands
```

The preparation command checks both component name and qualified mesh identity.
It creates a component-specific glTF variant and updates only that prototype's
file reference. Geometry, image URIs, placements, mesh defaults, and unrelated
components are retained. Repeated runs do not create additional variants.
Ambiguous blueprint names, missing slots, and untranslated materials fail before
the manifests are updated. Existing immutable blobs are retained for recovery.

Qualified materials already translated in the prepared source can be reused,
including their texture and sampler bindings. The native `Puddles` family has a
static PBR approximation using its authored linear color, opacity, roughness,
metallic and specular values. This removes the debug-material water disk without
claiming to reproduce its animated normals, depth fade or refraction. Unknown
water families do not receive that approximation.

Native inspection JSON and game images belong in ignored `tmp/` directories.
The `blueprint-materials` importer probe can also inspect a small explicit
`blueprint-names.json` list without extracting any map geometry.
