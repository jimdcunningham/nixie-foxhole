# Foxhole Planner Legacy-Parity Audit

**Audited:** 2026-08-18  
**Direction:** `C:\Code\game-kitchen` legacy planner -> Nixie Foxhole Planner only. Nixie-only features are not parity debt.

## Decision summary

Nixie is ready to treat **facility planning, core placement, normal legacy-plan import,
production statistics, map import, and the normal range overlays** as completed migration
surfaces. Do not keep them in a general “unfinished Foxhole” bucket.

The remaining migration work has four independently shippable sweeps:

1. **Socket visual-certification sweep** — import mapping is essentially complete, but only
   8 socket-bearing assets have explicit visual confirmation. Prioritize bunker/trench
   connectors and then facility pipe/power connectors.
2. **Train sweep** — preserve `locomotive_undercarriage` and its relationships; locomotive
   bodies already import as normal structures.
3. **Scenery closeout** — roads, trees, player markers, and tank mines now resolve on import.
   Roads are intentionally static meshes, so their old spline connections do not migrate.
4. **Unported legacy features decision** — garrison radius, tech-tree browser, strict
   placement validation, and legacy network toggle visualizations need an explicit
   implement-or-retire call. LOS is different: the legacy feature is present but appears
   disabled/unfinished, so it is not a parity blocker unless Nixie deliberately adopts it.

## Evidence and method

- Read the legacy editor sources in `C:\Code\game-kitchen\app`, including the range,
  network, map-region, project-options, asset-browser, and planner runtime surfaces.
- Read Nixie’s extension implementation, migration importer, migration docs, manifest
  pipeline, and focused test coverage.
- Ran `npm run legacy:migration-status` on **1,282** locally downloaded legacy plans:
  198,643 source entities produced 198,465 board snapshots (99.9% yield), with **0** import
  errors and **1,269 / 1,282 (99.0%)** plans usable without critical issues.
- Ran the extension test suite. It executed 386 tests: **385 pass, 0 fail, 1 skipped**. The
  skipped downloaded-fixture inventory test is informational; the full corpus is instead
  covered by the migration-status scorecard above.

## Status matrix

Legend: **Done** = implemented and covered enough to stop treating as general WIP.
**Partial** = usable but bounded residual fidelity or presentation work. **Missing** = a
legacy surface with no Nixie equivalent. **Retire/decide** = legacy behavior needs a product
decision before implementation.

| Legacy surface | Status | Evidence / remaining condition |
|---|---|---|
| `.plan` archive and clipboard import, including LZMA | **Partial** | Archive reader, save upgrader, import UI, and importer tests exist. Current corpus: 0 hard errors. Remaining entity fidelity is listed below. |
| Positions, rotations, heights, structure keys, facility upgrades, mod slots | **Done** | Importer maps these fields; corpus has 0 unresolved structure keys and 0 unmatched mod slots. Rotation maps require continuing visual certification, not a mapping rewrite. |
| Project identity: description, authors, tags | **Done** | Explicit identity mapper and tests. |
| Map context: shard, selected regions, enabled state | **Done** | Explicit project-settings mapper and tests. |
| Project crop bounds | **Missing** | `regionCrop` occurs in two corpus fixtures, is retained in the importer inventory, but deliberately omitted from Nixie map settings. |
| Legacy view preferences: map sublayers, range choices, network choices, selected-range setting | **Retire/decide** | These are mostly per-user/global Nixie preferences. Importing them would overwrite user preferences; current omission is reasonable but must be documented as intentional. |
| Legacy faction filter | **Retire/decide** | Nixie uses a user-level browser preference; importer intentionally does not overwrite it. |
| Point placement, rotation, socket snapping, upgrades, modifications | **Done** | Nixie structure, socket, modification, and snapping suites are extensive. |
| Bunker/trench socket visual changes | **Partial** | Attachment/render-layer behavior is implemented and tested; the full corpus now has no unresolved sockets after mapping the historical electric-water-pump power socket. Socket visual QA still has only 8 confirmed assets. |
| Socket persistence / union split behavior | **Partial** | Reciprocal attachments and bunker/trench network tests exist. Exercise disconnect/reconnect in a browser before calling it done. |
| Spline trenches, pipes, rails, water walls | **Done** | Dedicated connector, rotation, texture-mapping, pipe, and rail tests exist. The generic freehand spline tool was intentionally not ported. |
| Locomotive bodies | **Done** | Imported as normal structures at baked pose. |
| Locomotive undercarriages / drivable trains | **Missing** | 34 `locomotive_undercarriage` entities were skipped in the corpus. Track snapping is implemented, but vehicle assembly and drivability are not. |
| World décor: roads, trees, players, tank mines | **Done** | All current corpus keys resolve. Legacy road spline sockets are intentionally ignored because Nixie roads are independent static meshes. |
| Images / custom project icon | **Partial** | Archive texture images materialize into project files; a legacy custom/excluded baked project icon is not a compatible Nixie export surface. |
| Tilesets / tilemaps | **Retire/decide** | Legacy generic editor functionality, not a demonstrated Foxhole-plan requirement. No Nixie Foxhole tilemap equivalent. |
| Asset browser: categories, search, hover card, upgrades, recipes | **Partial** | Nixie has catalog/search/hover/production implementation. Defense ordering now follows the published build-order buckets, with localized display names resolving ties. |
| Missing legacy-only assets | **Partial** | Current import has no unresolved structural asset keys. Remaining legacy décor and unpublished train-underbody assets should be treated as the asset gap, rather than guessing from old icons. |
| Construction cost, repair, maintenance, production, stats export | **Done** | Scene-stat, maintenance, production-order, cost, and export tests pass. |
| Liquid capacity, including pipelines | **Done** | Pipeline and silo bucket logic is explicitly tested. Validate rendered totals during the facility smoke test before closing. |
| Facility power / selected-production display | **Done** | Power delta aggregation and production-order handling are tested. Production output only renders for active non-disabled orders. |
| Bunker health, breachability, destruction | **Partial** | Health and destruction calculations are tested, including socket breaches. Needs a gameplay-number comparison for the reported T3 BMat/CMat and total-vs-breachable-health concerns. |
| Map underlay, map-mod pak import, live war surfaces | **Done** | Nixie map and map-mod harness coverage exists; it is beyond legacy parity. Live-war availability remains an external-data/runtime check. |
| Region crop editing | **Missing** | Legacy has add/remove crop mode; Nixie importer deliberately omits crop and no equivalent editor surface was found. |
| Dark map, color icons, camera lock | **Partial** | Legacy options exist. Nixie map has a different shell/settings model; verify each is exposed in current UI rather than importing legacy toggles. |
| Map icon hover/card and icon visibility toggles | **Partial** | Nixie has map data/search/hover infrastructure, but no evidence of a one-for-one legacy blacklist/category-control UI. |
| Defense, support, logistics, artillery, AA range overlays | **Done** | Nixie reads authored manifest ranges and provides range visibility settings and manual range tooling. |
| Garrison supply radius | **Missing** | Legacy synthesizes it from `baseGarrisonRadius`; Nixie has no equivalent range resolver. |
| Crane / radio / resource-field ranges | **Partial** | Manifest ranges support these where authored. Make an asset-data coverage check before asserting all legacy types are represented. |
| Range overlap / selection-only visibility | **Done** | Manifest range rendering and selection-only settings exist. Legacy project setting is intentionally not imported. |
| Line of sight | **Retire/decide** | Legacy UI exposes an LOS switch, but its richer mode menu is commented out and it relies on legacy range masks/hitboxes. Nixie has selection geometry, not a LOS/occlusion engine. Do not add hitboxes merely for parity until LOS is explicitly adopted as a feature. |
| Power, pipeline, engine, breach network visual toggles | **Partial** | Nixie implements socket/power/pipe/breach visuals primarily as debug/structure overlays, not the legacy project-level network panel. Decide whether user-facing toggles are required. |
| Tech tree browser and unlock details | **Missing** | Legacy has `techTrees`; Nixie assets retain `techId` but no tree data/UI was found. |
| Community preset deep links / seeded presets | **Missing** | Downloaded presets are import fixtures, but legacy `?preset=` behavior and Nixie template seeding are not productized. |
| Cloud blueprints / subscriptions / social links | **Retire/decide** | Nixie Discover/blueprints is a different platform surface. Migration design requires owner review; do not automatically port legacy hosting mechanics. |
| Project custom properties, export exclude-layers/icon, LZMA export | **Retire/decide** | These are legacy generic-editor/export conventions. Nixie’s project format is the forward format; import compatibility exists. |
| Mouse-controls breakdown, menus, changelog shell | **Partial** | Nixie core owns these shell surfaces. No one-for-one Foxhole legacy menu parity requirement was found. |

## Current corpus gaps (actionable, measured)

| Gap | Corpus evidence | Close condition |
|---|---:|---|
| Train undercarriages | 34 skipped entities | Publish/author a compatible undercarriage asset, import attachment relationship, and add an archive fixture. |
| Missing-asset `pipematerials` points | Intentionally ignored | Legacy editor fallback for an unavailable icon; all six corpus instances lack annotation payload and are silently dropped. Other point types remain reported for future generic-plan support. |
| Legacy excavation marker | Intentionally ignored | Some legacy saves persisted `excavation` construction state in inventory/stockpile fields; skip it rather than showing an invalid cargo overlay or warning. |
| Roads | **Closed** | Four legacy road aliases resolve to distinct static road assets; old spline sockets are intentionally ignored. |
| Trees | **Closed** | `tree` resolves to the rendered FirBunch01 catalog asset. |
| Tank mines | **Closed** | Published as a placeable Defense asset at its legacy order; legacy bare placements import, and Shift-click places the matching icon form. |
| Player markers | **Closed** | Colonial and Warden markers resolve to assembled player assets with uniform default icons and rendered hover previews. |
| Socket visual QA | 8 explicit confirmations vs 70 orientation confirmations | Confirm a representative bunker/trench/facility matrix by visual fixtures and promote confidence only after screenshot review. |

## Recommended closure order

1. **Close socket visual certification.** Start with `fort*`, `trench*`, foundations, bunker upgrades, pipes, and powerlines. Include attach, detach, rotate, upgrade/modification, imported save, and reload cases. This is verification work, not a new socket architecture.
2. **Choose product scope for legacy-only features.** The only material candidates are garrison radius, tech tree, region crop, and network toggles. Keep LOS, generic tilesets, LZMA export, and automatic preset migration out unless a current Nixie use case justifies them.
3. **Treat trains as a separate feature.** Do not conflate successful static train-body placement and track snapping with full train parity.

## Completion gates

Mark the migration “functionally complete” when all are true:

- The full extension test suite is green.
- The import scorecard stays at zero hard import errors and zero unresolved structure/mod-slot keys.
- Socket visual QA covers the selected bunker/trench/facility connector matrix, including reload and disconnect behavior.
- Train undercarriages, scenery, crop, garrison, tech tree, and network UI each have an explicit **implemented**, **intentionally omitted**, or **out-of-scope** decision.
- A small, committed fixture set covers each remaining accepted import entity type, so import compatibility is checked without opening the app.

## Machine-Readable Sweep Status

The companion [`tools/legacy-plans/parity-audit.json`](tools/legacy-plans/parity-audit.json)
records each sweep as `verified`, `partial`, `missing`, or `deferred`. It is the compact
source for future review and can be updated independently as a sweep closes.
