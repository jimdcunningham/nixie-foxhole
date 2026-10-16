# Firing Origin Audit

Audited 2026-10-16 against the model-generation decoded bundle
`8e23a0eda0a7455e8a45d3e7c223c3434ba903f557de3613ae052f39133dda42`.

The initial 36 uncertain weapon entries belonged to 27 vehicle/aircraft assets.
All 16 existing AI garrison/pillbox/artillery entries already had source-backed origins.
This pass recovers 22 entries; 14 entries across 12 assets remain ground-only.
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
| 00MS “Stinger” (`motorcycleoffensivec`) | 1 | 1 | No serialized gunner-to-muzzle association |
| AB-11 “Doru” (`landingcraftoffensivec`) | 1 | 1 | No serialized gunner-to-muzzle association |
| Centurion MV-2 (`mech`) | 3 | 0 | Resolved from source muzzle sockets |
| Daimon aK-5 “Harpy” (`aircraftfighter2c`) | 1 | 1 | Declared muzzle socket not found in inspected mesh data |
| Drummond Spitfire 100d (`scoutvehicleoffensivew`) | 1 | 1 | No serialized gunner-to-muzzle association |
| Flood Mk. I (`battletankw`) | 1 | 0 | Resolved from source muzzle sockets |
| Gallagher Highwayman Mk. III (`mediumtank2multiw`) | 1 | 0 | Resolved from source muzzle sockets |
| Gallagher Outlaw Mk. II (`mediumtank2rangew`) | 1 | 0 | Resolved from source muzzle sockets |
| H-19 “Vulcan” (`lighttankflamec`) | 1 | 0 | Resolved from source muzzle sockets |
| HC-2 “Scorpion” (`lighttank2infantryc`) | 2 | 0 | Resolved from source muzzle sockets |
| M925 Austringer Man-O-War (`aircrafttorpedow`) | 1 | 1 | Conflicting mesh frames remain equally supported |
| Mergo-4 “Myrmidon” (`aircraftdivec`) | 1 | 1 | Conflicting mesh frames remain equally supported |
| Niska Mk. III Scar Twin (`halftracktwinw`) | 2 | 0 | Resolved from source muzzle sockets |
| Niska-Rycker Mk. IX Skycaller (`halftrackmultiw`) | 1 | 0 | Resolved from source muzzle sockets |
| O’Brien V.130 Wild Jack (`armoredcarflamew`) | 1 | 0 | Resolved from source muzzle sockets |
| O’Brien v.200 Squire (`armoredcar2multiw`) | 1 | 1 | Declared muzzle socket not found in inspected mesh data |
| R-17 “Retiarius” Skirmisher (`truckmultic`) | 1 | 1 | Declared muzzle socket not found in inspected mesh data |
| R-9 “Speartip” Escort (`truckoffensivec`) | 1 | 1 | No serialized gunner-to-muzzle association |
| Rinnspeir Mk. I Zealot (`aircraftparatrooperw`) | 1 | 0 | Resolved from source muzzle sockets |
| Rinnspeir Ornitier-Class Gunship (`mediumboatw`) | 3 | 0 | Resolved from source muzzle sockets |
| Rycker 4/3-F Wasp Nest (`largefieldmultiw`) | 1 | 0 | Resolved from source muzzle sockets |
| Tulka P4 Welkinrive (`aircraftbomberw`) | 2 | 0 | Resolved from source muzzle sockets |
| Type B - “Lucian” (`gunboat2c`) | 1 | 1 | Declared muzzle socket not found in inspected mesh data |
| Type C - “Charon” (`gunboatc`) | 1 | 0 | Resolved from source muzzle sockets |
| UV-24 “Icarus” (`scoutvehicleoffensivec`) | 1 | 1 | No serialized gunner-to-muzzle association |
| V-1 Tzykalia (`aircraftbomberc`) | 3 | 3 | Conflicting mesh frames remain equally supported |
| V-5b Pegasus (`aircraftparatrooperc`) | 1 | 0 | Resolved from source muzzle sockets |

## Remaining Evidence Needed

A missing association needs a verified gunner-to-muzzle binding from game initialization or an authored correction validated against the actual gun. A missing declared socket needs the corresponding current mesh/socket data or a verified replacement binding. Conflicting aircraft frames need the firing mesh or runtime pose/visibility relationship that distinguishes the candidates. A nearby socket, seat center, or arbitrarily selected mesh is insufficient evidence.

The generator keeps these cases marked `firing-component`; Planner retains their ground coverage and suppresses an unsupported 3D muzzle. These are extraction blockers, not claims that the in-game guns fire from incorrect positions.

## Verification

- Offline C# regressions cover duplicate planar rotation, shared-skeleton ownership, equal-owner rejection, and the mech's initialized socket positions.
- Focused extraction includes all 162 range-bearing source targets, without a render batch.
- Publication checks every non-firing range field for equality and preserves unrelated catalog edits.
- Planner catalog regressions cover every recovered family, independent port/starboard muzzles, forward battle-tank orientation and the mech's nonzero gun heights.
