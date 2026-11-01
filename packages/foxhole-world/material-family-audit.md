# World Material Family Audit

Checked 2026-11-01 against the locally published Deadlands world and native
material inspections. This is a bounded audit, not a claim of parity for all maps.

## Scope And Method

Resolve `world/index.json` to the Deadlands receipt and `world.json`. For each
prototype, follow its base glTF or eligible `night-materials.json` replacement.
Inspect only material slots referenced by mesh primitives; do not count unused
fallback slots such as the barrel's preceding WorldGridMaterial. Match qualified
`foxholeMaterialSource` identities to the native inspection, and group using the
owner paths of inherited native material expressions, not material basenames.

The inventory covers 691 effective model documents from 1,740 world prototype
records and 335 source identities (including one unqualified bucket). Eight
prototype references have no published model: the river, rail switch helpers,
and a boat water stencil. These have separate runtime policies. Catalog-replaced
buildings, terrain, transport shaders and particle systems are outside this count.

Counts below describe material-slot placement uses. A multi-material object can
contribute to several rows. A missing shared-translation marker is not itself a
rendering defect: foliage masks, night emission, wind, hidden FX and contained
water have separate handlers.

## Coverage At The Audit Baseline

| Native master | Material identities | Slot placement uses | Existing handling |
| --- | ---: | ---: | --- |
| Props | 249 | 29,168 | 133 carry the shared surface-map translation |
| Tree | 10 | 28,590 | All 10 carry the shared translation |
| MasterFoliage | 18 | 74,608 | Separate foliage/alpha/wind paths; not audited for full shader parity |
| GrassBlades | 9 | 9,733 | Includes the existing BirchBushSmall/Snow cutout recoveries |
| VertexBlend | 20 | 303 | Needs a separate layered-material recipe |
| Glass | 3 | 83 | Blend, color and some branch selection already survive; further controls need review |
| LanternEmissive | 1 | 61 | Existing night variants and time-of-day strength control |
| FireStatic | 2 | 48 | Native emissive FX graph is lost in the white PBR fallback |

143 of the 335 source identities carried `foxholeSharedMaterialVersion` before
the tint pass below. This number measures that particular preparation pass only.

## Completed: Preserve Existing Tints When Restoring Surface Maps

All 41 Props materials rejected for nonwhite `ColorShift` already contain the
native RGB multiplier in their glTF `baseColorFactor`. Multiplying or baking that
tint again would be incorrect. Ten have no other unsupported branch:

- DryStoneWall4 and DryStoneWall5
- Gravestone01, Gravestone02, Gravestone03 and Gravestone04
- Food01, CastleBrickSingle01, BarbedWireStraight and Wood

The shared translator now verifies that the glTF factor matches native ColorShift
before adding the ordinary surface/cutout maps. It preserves the existing factor
and albedo RGB. A mismatch stays unchanged rather than guessing which side owns
the color. Selective color masks, damage, layer blends and UV transformations
remain excluded.

The bounded preparation changed 30 unique model blobs referenced by 34 logical
model resources, covering these ten material definitions. Verification compares
all changed model geometry, transforms, accessors, original tint factors and
albedo bindings. Where a cutout requires a new image, decoded RGB is unchanged;
only authored opacity is restored. The world placement document is unchanged.
After the pass, 153 source identities carry the shared translation marker.

## Remaining Work By Family

### Glass

The qualified `Glass` master covers GlassBasic, LampGlass and
TownWindowGlassTranslucent. This is not three arbitrary per-object fixes.
Native inspection and the master graph expose `Diffuse Texture?`, `Mat Texture?`,
`Normal Map?`, `NPower`, `NTiling`, `MatTiling`, `RoughnessPower`, and the Fresnel
parameters. Existing exports already retain the color, overall opacity and some
switch choices. Do not replace these with an indiscriminate transmission preset.

GlassBasic has native NPower zero but an exported normal-map scale of one.
The native Normal output selects the normal-map/flat-normal branch through
`MaterialExpressionStaticSwitchParameter_12`. Its intermediate lerp is stripped
from this cooked expression export, so recover that operation before treating
NPower as an exact glTF normal-scale mapping. Review packed material channels and
refraction separately. The saved streetlamp view is an available visual fixture.

### FireStatic And Existing Emission

FireBarrel and Candlelight share the qualified FireStatic master. Its native
material explicitly uses unlit shading and an EmissiveColor graph driven by
fire colors, Brightness and the SmokeAlphas01 texture. The prepared materials
instead contain white translucent PBR color with no emissive output. There are
45 FireBarrel and three Candlelight slot placement uses in this map.

This is a confirmed family-level export loss. A repair needs the native mask,
animation/coverage and emission recipe, not a global brightness adjustment or
turning every translucent material into a glowing object. Fixtures include
streetlamp bulbs, CookPit and Candles1. Keep it separate from LanternEmissive:
that family already has warm emissive night variants whose zero daytime strength
is deliberate. SimpleEmissive also already exports an emissive factor.

### Remaining Props Branches

At baseline the 116 excluded Props identities have overlapping reasons:

| Reason | Material identities | Slot placement uses |
| --- | ---: | ---: |
| Damaged? | 65 | 2,059 |
| ColorShift | 41 | 1,673 |
| UseColorMask? | 33 | 1,603 |
| UV tiling | 3 | 201 |
| UseVBlend | 3 | 81 |
| Prototype Vehicle? | 6 | 72 |

The ten simple ColorShift cases are now handled. The other 31 tinted identities
also need at least one separate branch. FarmFence02 is a useful selective-mask
fixture (964 slot uses); RepeatingRope is a useful tiling fixture (185 uses).
Before adding UV transforms, prove whether the adopted mesh UVs already contain
the scale. Damage and vertex blending require their actual channels and weights.

## Next Bounded Pass

Prioritize the confirmed FireStatic emission/coverage loss, then complete the
Glass branch mapping. Follow with selective color masks and authored tiling.
Treat foliage subsurface lighting and layered damage as separate projects after
those smaller families, despite their much larger placement counts.

Keep game images and native inspection/expression JSON in ignored scratch storage.
The local audit evidence is under `C:/Code/nixie/tmp/culling-material-audit/`;
the inventory and comparisons are derived from current files, not source names
or texture suffix guesses.

## Implemented Follow-up

The FireStatic slice restores four independent native mask channels, palette,
instance controls and animated emissive coverage. Its bounded composition and
missing native depth fade/panner parity are documented in `fire-static.md`.

The Glass slice corrects the proven diffuse texture-or-color branch (previously
multiplied), opacity, disabled normal binding and scalar surface fallback. It
preserves night emission. `glass-materials.md` records the remaining stripped
NPower lerp, packed-channel and refraction questions rather than inferring those
operations from parameter names. Selective masks and authored tiling remain the
next separate material-family investigations.
