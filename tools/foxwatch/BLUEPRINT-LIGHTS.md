# Blueprint Lights

FoxWatch carries native point and spot light component defaults through inherited templates, nested components, and modification scenes. Local transforms stay in the render hierarchy. Blender captures their evaluated world placement before mesh baking; the publisher emits `KHR_lights_punctual` nodes alongside the baked meshes. This does not add lamps to the Blender scene or change 2D renders.

GLBs retain source color, intensity units, range, cone angles, temperature, shadow preference, enabled state, and source shape/falloff metadata. Colors are converted from authored sRGB to glTF linear RGB; ranges become metres. Lumens and legacy unitless inverse-square intensities become candelas. Unreal custom falloff is approximated by an inverse-square light matched at half the authored attenuation radius, with the original curve retained in node extras. Finite source radius and length remain metadata because punctual lights have no area shape.

Optional light-bearing modifications use semantic visibility groups on ordinary structures as well as bunkers. Upgrade parts retain their own lights and inherited transforms. Missing required groups and more than 64 fixture lights per model fail export. Source changes invalidate the spatial cache, and decoded component inspection cache version 5 includes light defaults.

Nixie loads the glTF lights lazily with their models. The host adjusts range and inverse-square intensity for world scale, preserves authored disabled lights, and applies scene-wide active-light and spot-shadow budgets. Selected modifications and hidden model groups govern their descendant lights. Unreal event graphs, power simulation, and a day/night clock are not executed by this extraction path; authored component defaults are the initial state.

Verify changes with the blueprint-light .NET test project, spatial-blueprint-lights and spatial-structure-profiles Node tests, and Blender's test_export_scene_lights.py. A scoped `generate-render-scenes --only ... --pak-path ...` followed by `publish-spatial-models.mjs --only ...` can verify real fixtures without a full batch.
