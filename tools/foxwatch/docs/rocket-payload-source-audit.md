# Rocket Payload Source Audit

Source build: Steam 25730371; decoded bundle `8e23a0eda0a7455e8a45d3e7c223c3434ba903f557de3613ae052f39133dda42`.
Native executable SHA-256: `ed99e371a3742af48bee4b19d9e0ce4e58595f556523e39b8cedc98b62e90abf`.
No game process was launched.

## Payload Grid

The cooked Blueprint binds `PayloadMeshes.GunnerIndex` and opts into `bUseForMuzzleTransform`. Its `PayloadInstancedStaticMeshComponent` declares byte-valued Rows/Columns and signed RowSpacing/ColumnSpacing in centimeters.

The native component's payload interface (vtable RVA `0x3624890`, slot 6, function RVA `0xd3fcf0`) divides the payload index by Columns. The quotient is the row; the remainder is the column. It produces local translation `[0, -column * ColumnSpacing, -row * RowSpacing]`. The rotation is identity for firing transforms; MeshRotation is optional artwork rotation. Slot 7 (RVA `0xd3fef0`) composes this local transform with the component-to-world transform, including its animated socket attachment.

| Asset | Rows | Columns | Row Spacing | Column Spacing |
| --- | ---: | ---: | ---: | ---: |
| Squire (`armoredcar2multiw`) | 2 | 5 | -39 | -28.2 |
| Retiarius (`truckmultic`) | 2 | 8 | 42 | 43.5 |
| Lucian (`gunboat2c`) | 1 | 6 | 0 | 50.5 |

`FoxWatchPayloadGrid` implements the local layout with bounded allocation and signed spacing. Offline regressions cover each authored grid, row rollover, invalid counts and nonfinite spacing. These offsets must be composed with the launcher frame; they are not world-space offsets and must not acquire the rocket artwork's -90-degree yaw.

The native loaded-count update (interface slot 3, RVA `0xd4fe60`) adds payload instances using the current count as their index and removes instances from the end when ammunition decreases. Muzzle selection and deployment-pose sampling require separate verification before treating this as a complete firing-order implementation.

## Firing-Ready Pose

The cooked animation graphs copy `SimVehicleGunnerSupportAnimInstance.GunnerPitch` directly into these 1D blend spaces. `FoxWatchManifestPayloadPoses` validates that binding, reads their authored sample coordinates and animation clips, blends local transforms with normalized quaternion interpolation, overlays the named gun-bone subtree onto the mesh reference hierarchy, then resolves the payload socket and relative component transform.

| Asset | Source Blend Space | Gun Bone | Native Input Interval | Sampled Physical Interval |
| --- | --- | --- | --- | --- |
| Squire | `BS_ArmoredCar2MultiW_Vertical` | `Rocket_GunPivot` | 15-25 | approximately 15-25 degrees |
| Retiarius | `BS_TuckMultiC_Pitch` | `rocketRack_pivot` | 65-80 | approximately 26-32 degrees |
| Lucian | `BS_Gunboat2C_MainTurret_Vertical` | `MainGunVertical` | 20-35 | approximately 20-35 degrees |

Squire and Retiarius explicitly require deployment in `DeploymentLogic`; Lucian does not declare that requirement. The native gunner animation update copies its current pitch/yaw into the graph inputs (native update helper RVA `0xbda7d0`). The native muzzle wrapper (for example RVA `0xd42a70`) selects the opted-in payload component and requests its world transform with artwork rotation disabled. Physical muzzle frames therefore come from the animated launcher, not the numeric input interpreted as an angle.

For the static planning envelope, the reference state is minimum permitted firing input with neutral yaw. `payloadPose` preserves the input interval, animation/blend-space paths, gun bone, deployment requirement and maximum-input anchor. The envelope orientation uses the sampled minimum frame; its relative pitch interval is zero through the sampled physical pitch change. This avoids applying elevation twice. All payload indices retain their own composed origins in `muzzleOrigins`.

This is a firing-ready planning state, not a live game simulation. The full envelope uses the minimum-input launch points; the muzzle's small pivot translation as the player aims through the interval is recorded at the maximum input but is not swept into the envelope. The three generated model resources now bake the same minimum-input firing-ready pose using the shared source sampler. Vehicle placement roots, wheels and unrelated gun branches keep their reference transforms. Ammunition timing, rocket removal and animated deployment are not played in Studio. Physical payload indices are row-major; no chronological firing order is inferred solely from mesh removal.

Unsupported bindings, additive clips, missing bones/sockets and out-of-domain inputs keep the prior source reference frame rather than inventing a pose. All existing 2D range fields remain unchanged.

## Verification

- Native local-layout and socket-composition regressions passed in the offline C# firing-volume harness.
- Focused extraction of Squire, Retiarius and Lucian produced 10, 16 and 6 distinct origins, with source animation input intervals and calibrated physical pitch spans.
- All 1,017 Planner tests and 259 FoxWatch tests passed; Planner typecheck and production build passed. The completed artifact declares 812 resources, all verified present.
- Metadata-only publication changed only the three firing-volume records; every other range field was checked for equality. Canonical-frame regressions preserve all payload points and the maximum-input anchor through publication, including idempotence.
- Disposable Studio verification observed six GPU volumes with distinct 50.5 cm column spacing for Lucian in both 3D and 2.5D. Turning Vehicle Weapon Ranges off removed all six. The fixture was deleted, and the overlay was restored to false.


## Firing-Ready Model Baking

`FoxWatchPayloadPoseSampler` supplies the same local source bone transforms to firing-frame extraction and render-scene generation. The graph's pitch-layer branch filters include the supporting mechanisms: Squire's declared rocket branches (ignoring inherited names absent from its mesh), Retiarius's rack and `piston_bottom`, and Lucian's `MainGunVertical`, `MainGunVerticalPistons` and `MainGunVerticalBase`. No pitch is guessed from the input number.

The exporter converts those transforms into deltas against the imported mesh's own rest skeleton, normalizes their quaternions and uses the existing static skinned-mesh bake. A changed scene/model hash invalidates the persistent resource cache through the existing content identity. No new host or SDK pose API is necessary. This changes the static launcher mechanism; it does not simulate payload ammunition, deployment transitions, live aiming or salvo timing.

Focused local-source checks (Steam build 25730371):

```powershell
$env:FOXWATCH_TEST_PAK_PATH = '<local Foxhole PAK directory>'
$env:FOXWATCH_TEST_POSE_PROOF = '<scratch>/payload-source-proof.json'
dotnet run --project tools/foxwatch/tools/payload-pose-tests/PayloadPoseTests.csproj -p:EnableDefaultContentItems=false
blender -b --python tools/foxwatch/blender/test_payload_pose_source.py -- '<generated scene root>' '<exported source mesh root>' $env:FOXWATCH_TEST_POSE_PROOF
```

The source harness checks the three calibrated elevations, unchanged wheel bones and rejection of unverified bindings. The independent Blender check compares the actual skin-deformation matrices against composed source rest/posed matrices for every bone: Squire 18, Retiarius 13 and Lucian 13. Maximum matrix error was below 0.000003. Fresh extraction preserved all three published firing volumes exactly. The existing 259 FoxWatch tests and offline firing-volume harness passed.
