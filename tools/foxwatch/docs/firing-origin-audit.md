# Firing Origin Audit

Audited 2026-10-16 against the model-generation decoded bundle
`8e23a0eda0a7455e8a45d3e7c223c3434ba903f557de3613ae052f39133dda42`.

The initial 36 uncertain weapon entries belonged to 27 vehicle/aircraft assets.
All 16 existing AI garrison/pillbox/artillery entries already had source-backed origins.
The first pass recovered 22 entries. The initialization-binding follow-up resolves the remaining 14 entries across 12 assets. None of the original 36 entries remains unbound.
Vehicle firing volumes retain the existing debug gate.

## Resolution Rules

- Compose authored mesh, attachment, bone and socket transforms once. Do not apply legacy planar body-axis inference to physical muzzle frames.
- For shared skeletons, prefer the mesh whose render-section bone map uses the muzzle's parent bone, then its closest weighted ancestor. Equally supported, non-equivalent frames remain unresolved.
- The legacy mech's main/left/right seats (1/2/3) use `S_MainGunMuzzle`, `S_LeftGunMuzzle` and `S_RightGunMuzzle`. Its scene muzzle components serialize at zero and are initialized by the game; those zero transforms must never be published.
- Preserve every existing 2D range field during metadata publication.

## Initial Uncertain Inventory

Counts refer to weapon entries, not complete vehicles: a vehicle may have another gun that was already resolved.

| Asset | Initially Uncertain | Still Uncertain | Result / Blocker |
| --- | ---: | ---: | --- |
| 00MS “Stinger” (`motorcycleoffensivec`) | 1 | 0 | Unique active gun and canonical source muzzle |
| AB-11 “Doru” (`landingcraftoffensivec`) | 1 | 0 | Unique active gun and canonical source muzzle |
| Centurion MV-2 (`mech`) | 3 | 0 | Resolved from source muzzle sockets |
| Daimon aK-5 “Harpy” (`aircraftfighter2c`) | 1 | 0 | Declared animated actor mesh |
| Drummond Spitfire 100d (`scoutvehicleoffensivew`) | 1 | 0 | Unique active gun and canonical source muzzle |
| Flood Mk. I (`battletankw`) | 1 | 0 | Resolved from source muzzle sockets |
| Gallagher Highwayman Mk. III (`mediumtank2multiw`) | 1 | 0 | Resolved from source muzzle sockets |
| Gallagher Outlaw Mk. II (`mediumtank2rangew`) | 1 | 0 | Resolved from source muzzle sockets |
| H-19 “Vulcan” (`lighttankflamec`) | 1 | 0 | Resolved from source muzzle sockets |
| HC-2 “Scorpion” (`lighttank2infantryc`) | 2 | 0 | Resolved from source muzzle sockets |
| M925 Austringer Man-O-War (`aircrafttorpedow`) | 1 | 0 | Declared animated actor mesh |
| Mergo-4 “Myrmidon” (`aircraftdivec`) | 1 | 0 | Declared animated actor mesh |
| Niska Mk. III Scar Twin (`halftracktwinw`) | 2 | 0 | Resolved from source muzzle sockets |
| Niska-Rycker Mk. IX Skycaller (`halftrackmultiw`) | 1 | 0 | Resolved from source muzzle sockets |
| O’Brien V.130 Wild Jack (`armoredcarflamew`) | 1 | 0 | Resolved from source muzzle sockets |
| O’Brien v.200 Squire (`armoredcar2multiw`) | 1 | 0 | Explicit payload launcher binding |
| R-17 “Retiarius” Skirmisher (`truckmultic`) | 1 | 0 | Explicit payload launcher binding |
| R-9 “Speartip” Escort (`truckoffensivec`) | 1 | 0 | Unique active gun and canonical source muzzle |
| Rinnspeir Mk. I Zealot (`aircraftparatrooperw`) | 1 | 0 | Resolved from source muzzle sockets |
| Rinnspeir Ornitier-Class Gunship (`mediumboatw`) | 3 | 0 | Resolved from source muzzle sockets |
| Rycker 4/3-F Wasp Nest (`largefieldmultiw`) | 1 | 0 | Resolved from source muzzle sockets |
| Tulka P4 Welkinrive (`aircraftbomberw`) | 2 | 0 | Resolved from source muzzle sockets |
| Type B - “Lucian” (`gunboat2c`) | 1 | 0 | Explicit payload launcher binding |
| Type C - “Charon” (`gunboatc`) | 1 | 0 | Resolved from source muzzle sockets |
| UV-24 “Icarus” (`scoutvehicleoffensivec`) | 1 | 0 | Unique active gun and canonical source muzzle |
| V-1 Tzykalia (`aircraftbomberc`) | 3 | 0 | Declared animated actor mesh |
| V-5b Pegasus (`aircraftparatrooperc`) | 1 | 0 | Resolved from source muzzle sockets |

## Initialization and Pose Bindings

Cooked Blueprint functions were decoded with CUE4Parse's script-data reader. Their vehicle-on event graphs handle lights, sound and effects; the needed bindings come from serialized actor/component descriptors and animation ownership.

- **Aircraft:** `MuzzleInfo` resolves on the explicitly bound actor `Mesh` when it has an animation class and competing candidates are unanimated `AircraftPartSlotComponent` visuals. Independent animated guns, missing actor bindings and unrelated mesh candidates retain normal ambiguity checks. The Harpy socket was present; the previous muzzle-name-only diagnostic had omitted its `Top_Gunner` name.
- **Rocket launchers:** `PayloadMeshes.GunnerIndex` and `bUseForMuzzleTransform` select the payload launcher. A single authored payload grid with valid rows/columns supplies its socket-attached launcher anchor. Visual rocket `MeshRotation` does not rotate the firing axes. Individual round offsets, salvo ordering and deployment animation are not simulated. Multiple unassociated grids remain unresolved.
- **Legacy single guns:** With no `MuzzleInfo`, the already classified armed vehicle seat can bind to the sole canonical `S_Muzzle` only if no other active weapon or unclassified mount competes. Extra muzzle names, conflicting frames, unknown mounts and explicit missing bindings are rejected. This is a constrained unique association; native C++ initialization is not executed.

Wiki armament descriptions provide role/layout sanity checks: [Stinger](https://foxhole.wiki.gg/wiki/00MS_%E2%80%9CStinger%E2%80%9D), [Doru](https://foxhole.wiki.gg/wiki/Doru), [Spitfire](https://foxhole.wiki.gg/wiki/Drummond_Spitfire_100d), [Speartip](https://foxhole.wiki.gg/wiki/R-9_%E2%80%9CSpeartip%E2%80%9D_Escort), [Retiarius](https://foxhole.wiki.gg/wiki/R17), [Man-O-War](https://foxhole.wiki.gg/wiki/M925_Austringer_Man-O-War) and [Tzykalia](https://foxhole.wiki.gg/wiki/Tzykalia). Coordinates and axes are extracted from the source transforms.

The vehicle debug gate, overlay settings and nighttime behavior remain unchanged. New unsupported cases retain ground coverage and are withheld from 3D firing volumes.

## Verification

- Offline C# regressions cover planar rotations, socket ownership, animated actor bindings, payload opt-ins, competing/unknown gun rejection, template declarations and initialized mech sockets.
- Focused extraction includes all 162 range-bearing source targets, without a render batch.
- Publication checks every non-firing range field for equality and preserves unrelated catalog edits.
- Planner catalog regressions cover every recovered family and all 14 initialization-bound entries, source offsets, independent port/starboard muzzles, firing axes and the vehicle debug gate.

- Full Planner suite: 1,016 tests passed; FoxWatch suite: 258 tests passed. Planner typecheck and offline C# firing-volume checks passed.
- Production Planner build passed with 812 declared resources verified against the completed artifact. An isolated Windows directory-rename failure was avoided on retry; the completed artifact was mirrored locally behind the normal discovery marker without restarting the running watcher or Studio server.
- Disposable Studio scene checks: Stinger 3D firing volume follows the vehicle rotation; Harpy renders its recovered volume in 2.5D; Retiarius generates its source-backed long-range volume (375-500 m, beyond the close-up camera). These are static authored reference frames, not live game aiming/deployment poses.
- Temporary Studio fixtures were removed, the prior view restored, and the vehicle weapon range debug overlay returned to false.
