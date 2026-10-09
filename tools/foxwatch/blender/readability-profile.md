# Top-down Readability Profile

`blender/render_readability.py` owns the shared `topdown-contact-v2` profile.
It applies to structure and vehicle board textures, including internal
modifications. Preview renders and item icons keep their existing render path.
The top-down pass restores its color management, world and sun lighting, and
renderer before previews/icons run. `test_preview_profile_isolation.py` verifies
that their pixels match a render without a preceding top-down pass.

Cycles selects an available GPU automatically (CUDA first), disables CPU co-rendering, and logs the selected backend and devices once per worker. If no supported GPU is available it logs a CPU fallback. Set `FOXWATCH_CYCLES_DEVICE` to `CPU`, `CUDA`, `OPTIX`, `HIP`, `ONEAPI`, or `METAL` to override automatic selection. Preferences are process-local and are not saved.

The profile uses Cycles with 12 samples, a broad overhead sun, Khronos PBR
Neutral color management at +0.8 EV, and short-range ambient occlusion at 15%
strength over 0.5 meters. These are the shared settings selected as candidate 16
in the render comparison lab. The separate contact-shadow profile remains at
62% strength over 1 meter, rendered with 6 Cycles samples and denoising. Surface
renders use 12 samples; the shadow pass restores the prior sample count even
if rendering fails. There are no per-asset strength overrides.

Surface shading is inserted inside the material's clip and transparency
wrappers. The shading closure also preserves Principled Alpha, including
texture cutouts. `test_render_readability.py` renders an occluded cutout and a
separate clip mask to prevent shading from filling their transparent pixels.

## Contact Shadows

Contact shadows are separate transparent black WebP images. They use the host
floor's height and bounds when a floor component exists, otherwise the object's
base. Their padded frame preserves the same 64 pixels per meter while leaving
the surface texture's dimensions and anchor unchanged.

Ground, roof, exterior dirt, and repeated terrain layers receive surface lighting
but do not emit a second footprint shadow. Other components, vehicles and
modifications use the same contact-shading algorithm.

The adjacent `*.texture.json` projection gains an optional `contactShadow`:

```json
{
  "contactShadow": {
    "profile": "topdown-contact-v2",
    "file": "frontwall.shadow.webp",
    "width": 199,
    "height": 449,
    "anchorPixelX": -81.347845,
    "anchorPixelY": 224.5,
    "offsetX": 180.847845,
    "offsetY": 0,
    "receiverZ": -1.598
  }
}
```

The values above illustrate the projection format; the renderer computes them
from the evaluated camera and root origin. Color/faction variants have their own
sidecars and sibling shadow filenames. Publication preserves these shadow
images and sidecars. The render cache fingerprints the profile implementation
and verifies shadow files alongside surface outputs.

Scene loads an optional shadow only from its sibling projection and gives it
the surface's transform, visibility and alpha. Shadows draw above ground layers
and below all object surfaces. Interior machinery has a separate surface lane
above shadows and below roofs. A socket-hidden wall also hides its shadow.
Decorative shadows never define the placement or selection footprint.

## Reviewing a Batch

1. Save a baseline of the selected asset directories before refreshing.
2. Refresh a small varied set through the normal targeted FoxWatch workflow.
3. Compare surface dimensions and origin projections with the baseline. Check
   transparent cutouts as well as decoded colors; file byte changes alone are
   insufficient evidence of a visual regression.
4. Open the same review layout in local Studio and production Studio. Use the
   same zoom and roof visibility, and include joined pieces, internal
   modifications, vehicles and a building on a foundation.
5. Repeat the renderer with unchanged inputs to verify cache reuse includes the
   new shadow outputs. Expand the refresh after the representative batch looks
   consistent; introduce subclass profiles only for demonstrated recurring gaps.

Generate the reusable review report with:

```powershell
node tools/foxwatch/scripts/review-render-batch.mjs --baseline <snapshot-root> --candidate tools/foxwatch/tmp/rendered-assets --output tools/foxwatch/tmp/render-review
```

Both roots should preserve the same `types/` and `shared/` directory layout.
The report has searchable asset/component/modification views, before/after
sliders, frame-change flags, and transparent-support comparisons. Small edge
changes should be inspected at native size when switching render engines.
