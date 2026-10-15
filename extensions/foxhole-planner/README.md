# Foxhole Planner (SDK)

This is the first-class migration target for Foxhole Planner on the public Nixie extension SDK. It is discovered from a configured local extensions folder like any third-party extension and imports only the published `@nixie/extension-sdk` entry points, including the explicit `/experimental/scene-v2` preview boundary.

Run `npm run dev --workspace @nixie/foxhole-planner-sdk`, choose the containing extensions folder in an offline project’s Manage Extensions dialog, approve its local migration capability, and enable it for that project.

The default 3D scope is the explicit 54-asset snapshot in `src/scene-v2-model-policy.json`: intact non-vehicles from Facilities, Power, Mining, Liquids, and Foundations. Destroyed/breached variants and vehicle GLBs are excluded from model bindings, resource declarations, and copied model files. Existing 2D catalog data, footprints, and resources remain available. Optional saved model bindings are preserved; Nixie's spatial renderer uses planar visuals when their model resource is no longer available.

The authored export policy lives in `C:\Code\nixie-foxhole\tools\foxwatch\asset-overrides\spatial-models.json`. Its approved default is `curved50-compact16` (precision reduction, 50% target with curved-detail protection, compact normals/tangents, original texture settings). Keep this private package's policy snapshot aligned with authored scope changes. Build hooks synchronize explicit model resource declarations and remove obsolete generated GLB copies from `dist`.

The requested follow-up batch exported 38 of the remaining 39 assets with `curved50-compact16`, including 22 default/upgrade parts. The bundle now has 53 allowed base models and 62 assembly parts (115 GLBs). Power Line remains procedural: its source scene has no mesh to export, so it keeps its existing visual path. The earlier 15 base models and their 40 parts were retained byte-for-byte. Visual approval of the new batch is still pending.
