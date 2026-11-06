# Structure Volume Audit

Audited on 2026-11-05 against the local decoded bundle
`4921442e5efed7a450d1d849e2a965e119c749ded3075a25d2ea04f6584d7cf6`.
These are cooked export records (including reusable templates), not distinct
shipped buildings. The compiled extractor accepts both serialized properties
and the decoded runtime-property view.

## Findings and Changes

`IsStructureVolumeComponent` previously required the type name to contain
`BoxComponent`. Cooked native and Blueprint subclasses do not necessarily retain
that substring, even when they expose authored `BoxExtent` geometry. It now
accepts explicit box geometry and continues to exclude dedicated build footprint
components, which use their existing extraction path. No extent is invented
when source data is absent. Category and label classification now use component
type as well as instance name.

| Previously skipped component type | Export records | Overlay category |
| --- | ---: | --- |
| BPStructureInteriorArea_C | 151 | Interior Area |
| SeatTriggerComponent | 31 | Seat Triggers (new, default off) |
| BoatHullComponent | 19 | Other Volumes |
| BPLoadingAreaBox_C | 15 | Loading Area |
| BPTrenchBlockerBox_C | 13 | Other Volumes |
| RailSwitchUseComponent | 8 | Use Area |
| DockComponent | 6 | Docking |
| LadderComponent | 5 | Other Volumes |
| VisibilityToggleAreaComponent | 4 | Other Volumes |
| BPKillVolume_C | 2 | Kill Volume |
| SafeHouseVisibilityToggleComponent | 1 | Other Volumes |
| Total | 255 | |

Unknown semantics remain under Other Volumes; a box parameter is not by itself
proof of a player interaction boundary. Names can still provide an existing
more specific category. Trench blockers are not assumed to prohibit building.

## Facility Crane

A fresh strict extraction from the local public game PAK confirms:

- `UseAreaBox`: half-extents (165, 165, 525) cm; center (0, 0, 525) cm.
- `CraneOccupiableComponentTrigger_GEN_VARIABLE`: half-extents (300, 300, 300)
  cm; center (0, 0, 300) cm. This gives a 6 m square in plan view.
- The structure seat names this trigger through `TriggerName` and has
  `MountCodeName: CraneOperator`. This identifies the operator-entry trigger,
  without establishing the full in-game interaction rules.
- Crane reach remains 4.5–22.5 m and is independent of the seat trigger.

Seat Triggers is wired through the legacy Structure Volumes menu, standalone
extension settings and renderer dependencies, catalog category normalization,
and both overlay palettes. It does not replace Use Area or vehicle seat markers.

## Remaining Limits

14 seat-trigger export records in this bundle have no directly readable extents.
Inherited component templates and native defaults need a separate resolution
audit; the new geometry check deliberately does not guess their size.
`ProceduralUseVolumeFactor` is also present on the crane (1.0), but its runtime
formula has not been established, so it is not used to derive a boundary.
Nonuniform component scale and tilted 3D boxes remain subject to the existing
planar overlay representation and were not changed in this work.

## Verification

- Compiled extractor regression harness: ten component classes, crane dimensions
  and label, missing extents, dedicated footprint exclusion.
- Real PAK crane extraction into `tools/foxwatch/tmp/structure-volume-validation.json`.
- Volume normalization and render-plan validation, including a separate seat
  trigger toggle, disabled/packaged behavior and renderer setting dependencies.
- Planner typecheck, all 1,176 tests, production build and `.nxext` packaging.
  Packaging used the matching local `extension-package/dist/cli.js` directly
  because this checkout lacks the `nixie-extension` command shim.

No live Studio or in-game visual verification was performed. Published asset
manifests/catalog pins are not rewritten by this source change; the next normal
asset generation and release must carry the newly extracted volume records.

Reproduce the decoded-package audit with:

```powershell
dotnet run --project tools/foxwatch/tools/structure-volume-tests/StructureVolumeTests.csproj -- <decoded-bundle>/packages/War/Content/Blueprints/Structures
```
