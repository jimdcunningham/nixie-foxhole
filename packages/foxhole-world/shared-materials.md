# Shared World Materials

The adopted world source contains simplified glTF materials. Restore native
surface maps before publishing the compact world, rather than applying object-name
exceptions in the renderer.

From the Foxhole checkout:

```powershell
dotnet build packages/foxhole-world/importer/Importer.csproj
node packages/foxhole-world/prepare-shared-materials.mjs --input tools/foxwatch/tmp/world-prepared --native tools/foxwatch/tmp/shared-materials --pak "C:/Program Files (x86)/Steam/steamapps/common/Foxhole/War/Content/Paks"
node packages/foxhole-world/export-world.mjs --world-input tools/foxwatch/tmp/world-prepared
```

Use `--regions deadlands` on the preparation command and `--world-regions deadlands` on
the export command for a bounded visual check. Preparation retains old immutable
blobs, updates their region receipts, and is idempotent. The normal publication
step assigns fresh content hashes, so decoded and persistent caches cannot reuse
the preceding materials.

The preparation command extracts only referenced native material names, then
matches their complete qualified package identities. Master graph expression
ownership distinguishes the Props and Tree families. Their packed maps use red
for metallic and green for roughness. Active Props cutouts use packed alpha;
Tree's `Use Alpha Channel?` branch selects packed blue. Albedo RGB, geometry,
instance transforms and UV bindings are preserved. Solid materials sharing an
image do not acquire another material's cutout.

Simple ColorShift tints are supported only when the existing glTF RGB factor
matches the native multiplier; the factor is preserved rather than baked again.
Selective tint, tiled and albedo-alpha branches remain unchanged until
their graphs have equivalent translations. Unknown families and qualified
identity mismatches are also preserved. This is not a universal Unreal material
interpreter, and it does not replace custom weather, water, glass or emissive
shaders with a generic PBR guess.

Native extracted images and inspection records belong under ignored `tmp/`
directories. They are generated game data and must not be committed.
