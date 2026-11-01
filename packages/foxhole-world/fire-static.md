# FireStatic Translation

`prepare-effect-materials.mjs --input <prepared root> --native <inspection directory> --regions deadlands`
selects the qualified `War/Content/FX/Materials/FireStatic` expression owner.
The inspection directory contains `material-inspection.json`, `material-source.json`
and decoded textures from the existing importer material probes. No names or
mesh-specific exceptions select the effect. Rerunning the pass is idempotent.

Native FireBarrel and Candlelight masks, four linear fire colors, Power,
Brightness, Opacity and Tiling survive in immutable model metadata and declared
textures. Independent RGB and alpha mask planes are published opaque, preserving
data through image decoding and avoiding premultiplication. Material replacements
are shared inside each model-layer lifetime, use the existing region clock,
retain source geometry/actor visibility and are released on rollback/unload.
Fire is emissive rather than sun-lit, alpha blended without depth writes, and does
not cast an opaque shadow. Unrelated glass and existing night variants are untouched.

This is a bounded renderer translation, not Unreal shader parity. The cooked
graph retains four mask samplers and references to panners but strips their speeds,
intermediate math and particle dynamic offsets. Conservative UV motion and
four-channel palette weighting approximate that missing composition. Native
Depth Fade is retained in metres as provenance but is not evaluated: transparent
fire does not currently sample opaque scene depth. No guessed refraction, local
lights, bloom or particle emitters are added. These remain distinct future work.

Local verification uses saved Viewpoint 2 (streetlamp flame). Both authored
presets, independent channels, material sharing, framed uniform capacity and
world actor/geometry/shadow behavior have focused executable tests. Game images
and probe JSON remain ignored local outputs.
