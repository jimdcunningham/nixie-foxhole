# Glass Controls

Run `node packages/foxhole-world/prepare-effect-materials.mjs --input <prepared root> --native <inspection directory> --regions deadlands --glass`.
The native directory uses the existing material inspection/texture probe outputs.
Only the qualified `War/Content/Materials/Environment/Glass` expression owner is
eligible. Neither display names nor every translucent material imply glass.

The surviving native graph proves these switches:

- `Diffuse Texture?` selects the diffuse texture **or** Diffuse Color. The old
  export multiplied both and darkened GlassBasic. The texture branch now uses a
  white RGB factor, while the color branch removes the unused texture.
- Overall Opacity remains the alpha factor, independent of Diffuse Color's alpha.
- Disabled `Mat Texture?` uses scalar Metallic and Roughness and removes the packed
  texture binding. Enabled packed branches retain their current translation.
- Disabled `Normal Map?` removes the unused normal binding. Enabled normal branches
  retain their existing normal scale until the native lerp can be recovered.
- Native two-sided translucent drawing is retained. Existing night-emission
  factors, textures and extensions are not rewritten.

The pass is immutable and idempotent. It changes model material/binding records
only, preserving geometry, placement documents and unrelated material families.
All three known instances (GlassBasic, LampGlass, TownWindowGlassTranslucent)
share this translation; there are no object-specific overrides.

The cooked graph strips the enabled normal branch's intermediate lerp and the
material-texture/refraction math. NPower is therefore **not** assumed to be an
exact glTF normal-scale multiplier. Packed channel assignments, NTiling,
MatTiling, mask/fresnel refraction and nonzero normal-strength translation remain
unresolved. No indiscriminate transmission preset or guessed IOR is introduced.
Local visual coverage uses the saved streetlamp fixture in Viewpoint 2; native
branch contracts and preservation of night emission have executable tests.
