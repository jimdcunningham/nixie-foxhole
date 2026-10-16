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
