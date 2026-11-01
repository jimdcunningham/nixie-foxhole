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
static PBR fallback using its authored linear color, opacity, roughness,
metallic and specular values. The compact runtime retains the native family
identity by material slot and promotes these surfaces to the animated Water2
refraction/reflection pass. Contained water keeps the authored color, opacity and
roughness, uses calm ripples, and omits river foam and boat masks. Its optical
depth comes from the opaque interior rather than the region terrain heightmap.
This reuses Nixie's water optics; it is not an exact port of Unreal's Puddles graph.
Unknown material families retain their existing translation.

Each model-layer owner shares matching water profiles and releases them with its
materials. The region clock and Water Reflections preference update every live
contained-water surface, including when the regional Water layer is hidden.
Batch slots explicitly join the blended-refraction pass and do not cast opaque
shadows. Shader controls reuse one existing vector to fit the fixed material row.

Native inspection JSON and game images belong in ignored `tmp/` directories.
The `blueprint-materials` importer probe can also inspect a small explicit
`blueprint-names.json` list without extracting any map geometry.
