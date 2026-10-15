# Foxhole Model Viewer

Run from the nixie-foxhole repository with an installed Nixie checkout beside it. Set `NIXIE_STUDIO_ROOT` to use another host checkout:

```powershell
node tools/foxhole-model-viewer/server.mjs
```

Open `http://127.0.0.1:4187/` for model/upgrade comparisons and `http://127.0.0.1:4187/spline.html` for the 3D spline feasibility demo. The latter uses the real planner path sampler with a diagnostic tube; it is not the completed Studio pipeline feature.

The comparison viewer uses the generated Foxhole models and retained local review metadata/controls in `artifacts/facility-spatial-policy/batch/`. It no longer depends on the completed compression or texture trial directories. The full-triangle controls remain useful for visual comparison; they are not shipped with the extension.

```powershell
node --test --experimental-strip-types tools/foxhole-model-viewer/test.mjs
```

See the Nixie host’s `docs/developer-kit/foxhole-3d-checkpoint.md` for the paused implementation state and next blockers.
