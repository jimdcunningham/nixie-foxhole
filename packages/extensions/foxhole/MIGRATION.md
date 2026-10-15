# Foxhole Planner: Legacy (game-kitchen) → Nixie Migration

This document tracks parity between the legacy Foxhole Planner (`game-kitchen`, Pixi.js `/app` editor) and the current Nixie-based Foxhole Planner (`packages/extensions/foxhole` in the nixie monorepo).

**Direction of travel:** Nixie is the product. game-kitchen is maintenance debt. New game content ships through FoxWatch into the nixie assets pipeline only. Asset rollout gating, experimental consent, and early-access launch checks have been removed — the app is live.

**Last corpus check:** run `npm run legacy:migration-status` in this package (imports every downloaded fixture under `tests/fixtures/legacy-plans/raw`). As of 2026-08-01 against **1282** blueprints: **0** hard import errors, **99.1%** usable without critical issues, **97.2%** entity → board-snapshot yield. Remaining work is **fidelity**, not “build the importer.”

---

## Executive summary

| Area | Status |
|------|--------|
| Asset data pipeline | **Nixie wins** — FoxWatch manifest, rendered icons/textures, locale files |
| Core structure editing | **Mostly there** — placement, snap, sockets, splines, modifications, upgrades |
| Map overlay | **Nixie wins** — richer layers, mod pak import, war integration |
| Planning overlays | **Nixie wins or equal** — ranges, binocular lines, tactical lines |
| Statistics / production math | **Complete** — persisted structure orders feed scene statistics and export |
| Legacy `.plan` save import | **Shipped (fidelity WIP)** — archive + clipboard import live; soft field gaps remain |
| Community bunker presets | **Partial** — corpus downloadable as `.plan` fixtures; productized `?preset=` / hub seeds still missing |
| Tech tree browser | **Missing** |
| Network / garrison overlays | **Partial** |

---

## Feature comparison

Legend: ✅ Complete · 🟡 Partial · ❌ Missing · ➖ N/A or intentionally different

### Data & assets

| Feature | Legacy (game-kitchen) | Nixie (foxhole-planner) | Notes |
|---------|----------------------|-------------------------|-------|
| Game content source | `data.js` + manual `tools/legacy/update.js` | FoxWatch → `manifest.v1.json` | Legacy path is stale vs FoxWatch |
| Icons & textures | Game UI textures + manual packing | Blender renders + published webp | Legacy icons are hit-or-miss; nixie renders are authoritative |
| Localization | Baked English strings in `data.js` | Locale key files under `assets/localizations/` | Nixie UI resolves keys at runtime |
| Asset visibility gating | `hideInList` in data | `hideInList` from manifest | Rollout whitelist removed — all manifest assets visible unless `hideInList` |
| Destroyed / breached variants | In `data.js` | In manifest + placement catalog | ✅ |
| Modification slots | In `data.js` `modslots` | Manifest `modificationSlots` | ✅ |
| `legacyKey` for save import | Implicit (`data.js` keys) | Building-key map + overrides | Generated via `legacy:generate-building-key-map`; corpus shows **0** unresolved structure keys |

### Structure editing

| Feature | Legacy | Nixie | Notes |
|---------|--------|-------|-------|
| Point placement | ✅ | ✅ | |
| Snap & rotation | ✅ | ✅ | |
| Socket connections | Numeric socket ids | Socket names | Import remaps via `plan-socket-id-map`; unresolved sockets ~**0.2%** of fixtures |
| Spline structures (trenches, pipes, rails, water walls) | ✅ Bezier placement | ✅ `FoxholeSplineConnectorNode` | Asset splines work; generic spline **drawing tool** removed from toolbar |
| Modification slot picker | ✅ | ✅ Inspector + placement | Import modslot matching clean on current corpus |
| Structure upgrades / tier routes | ✅ | ✅ Build routes + upgrade assets | |
| Packaged pallet preview | ✅ | ✅ | |
| Foundation / water build rules | ✅ | 🟡 | Some validation gaps |
| Building placement validation | Optional (`enableBuildingValidation`) | 🟡 | Legacy toggle exists; nixie validation incomplete |
| Union selection / multi-structure | ✅ | 🟡 | |
| Emplaced / tripod structures | ✅ | ✅ | |

### Overlays & planning tools

| Feature | Legacy | Nixie | Notes |
|---------|--------|-------|-------|
| Structure range overlays (killbox, AT, MG, arty, flame, rocket) | ✅ Per-type toggles | ✅ Auto from manifest + range tool | |
| Anti-air (`killboxAA`) overlay | ✅ | ✅ Added 3.4.x | |
| Garrison supply radius | ✅ `baseGarrisonRadius` | ❌ | Legacy loader synthesizes range circles |
| Crane / radio / resource field ranges | ✅ Toggle | 🟡 | Some types covered |
| Manual range circles | Limited | ✅ Foxhole range tool | Nixie is better here |
| Binocular planning lines | ✅ | ✅ Legacy color preserved | |
| Tactical lines (frontline, etc.) | ❌ | ✅ | Nixie-only |
| Power / pipeline / socket network viz | ✅ Settings toggles | 🟡 | Partial |
| Map underlay | ✅ Improved Map Mod layers | ✅ + mod pak importer | Nixie is ahead |

### Statistics & production

| Feature | Legacy | Nixie | Notes |
|---------|--------|-------|-------|
| Construction cost rollup | ✅ Statistics panel | ✅ Scene stats sidebar | |
| Repair cost | ✅ | ✅ | |
| Production input/output | ✅ Deep integration | ✅ Structure orders + scene statistics | Legacy order state imports into persisted Nixie production orders |
| Liquid / fuel capacity | ✅ | 🟡 | |
| Bunker health / destruction stats | ✅ | 🟡 | Raidbreaker etc. added in 3.5 |
| Production time @ rate | ✅ `statistics.displayTime` | ✅ | Uses the selected Nixie statistics interval |
| Copy cost list / export | Limited | ✅ CSV from scene stats | |
| Per-selection vs whole scene | ✅ | ✅ selection / layer / scene scopes | |

### Saves, presets & sharing

| Feature | Legacy | Nixie | Notes |
|---------|--------|-------|-------|
| `.plan` export (LZMA zip) | ✅ | ➖ Nixie project format | Different format going forward |
| `.plan` import | ✅ | 🟡 | **Shipped** — file + clipboard UI; fidelity gaps below |
| Save version upgrader (`convertSaveVersion`) | ✅ Chain to 1.0.5 | ✅ | Ported; corpus mostly `1.0.5` (+ some `1.0.4`) |
| URL `?preset=` deep links | ✅ `presetMap` | ❌ | Fixtures retain preset keys; product deep links not wired |
| Community bunker presets | ✅ ~hundreds in `data.js` | 🟡 | Downloadable as import fixtures; not seeded as Nixie templates |
| Blueprints hub (cloud) | game-kitchen has hosting | ✅ Nixie blueprints | Different product surface |

### Tech & meta UI

| Feature | Legacy | Nixie | Notes |
|---------|--------|-------|-------|
| Tech tree browser | ✅ `techTrees` in data.js | ❌ | Structures reference `techId` but no tree UI |
| Tech unlock icons / descriptions | ✅ | ❌ | |
| Faction filter (C/W) | ✅ Project faction | ✅ User asset-browser preference | Legacy faction is deliberately not imported, because it must not overwrite a user's global filter |
| Favorites in asset browser | ❌ | ✅ | |
| Fuse.js asset search | ✅ | ✅ | |

### War & realtime (nixie-only advantages)

| Feature | Legacy | Nixie | Notes |
|---------|--------|-------|-------|
| Live war summary sidebar | ❌ | ✅ | |
| War event playback / 24h history | ❌ | ✅ | Admin/dev gated tabs |
| Realtime collaboration | ❌ | ✅ Nixie sessions | |
| Shard menu / war API | Limited | ✅ | |

### Platform (nixie core — not in legacy)

| Feature | Nixie | Notes |
|---------|-------|-------|
| Layers, groups, locking | ✅ | |
| Brush / eraser / shapes | ✅ | |
| Undo/redo history | ✅ | |
| Keybind customization | ✅ | |
| Accounts / blueprints cloud | ✅ | |
| Content reporting | ✅ | |

---

## Legacy `.plan` import — current fidelity

Implementation lives under `app/plugins/foxhole/legacy/` with tooling in `tools/legacy-plans/`.

### Corpus scorecard (how to refresh)

```bash
# Download public blueprint zips (needs NUXT_PUBLIC_SUPABASE_KEY)
npm run legacy:download-presets

# Scorecard — buckets plans without the all-or-nothing fail gate
npm run legacy:migration-status

# Fixture suite (still fails until fields are fully ingested)
npm run test:legacy-plans
```

Default JSON report: `tools/legacy-plans/migration-status-report.json`.

### What works

- LZMA `.plan` / blueprint zip archives and clipboard payloads
- Save version upgrade through current corpus versions
- Structure keys, facility upgrades, modslots (clean on latest scorecard)
- Socket id → name remapping for nearly all fixtures
- Orientation map (~382 keys; most `high` confidence)
- Import report dialog for residual gaps
- Images partially supported (materialized into project files)
- Project identity on import: `description` → description, `authors` → credits, `tags` → tags

### Remaining gaps (from latest scorecard)

| Priority | Gap | Notes |
|----------|-----|-------|
| Medium | Remaining project metadata | Map context now imports; crop bounds are deferred. Legacy faction is intentionally not imported because it is a user preference. |
| Medium | Trains | `locomotive` / `locomotive_undercarriage` still skipped |
| Medium | Socket visual QA | Only ~8 keys confirmed vs ~70 orientation confirms |
| Low | World decor | roads, trees, player markers, tank mines |
| Low | Rare cargo / points | e.g. `excavation` cargo; legacy `point` entities |

---

## Prioritized backlog

### P0 — Ship game updates without legacy maintenance

These unblock "stop patching game-kitchen."

1. **Treat FoxWatch manifest as sole content source** — done in nixie; stop dual-publishing to `data.js`.
2. **Remove asset rollout gating** — done. All manifest assets visible unless `hideInList`.
3. **Remove launch / experimental consent gating** — done. No `NUXT_PUBLIC_NIXIE_LAUNCH_UNLOCKED` or consent modal.
4. **Point marketing at Nixie** — public listing is `https://nixiejs.com/foxhole-planner` (domain redirects later, if ever).
5. **Communicate format change** — import exists; say Nixie projects are the new save format and `.plan` import covers migration.

### P1 — Import fidelity + retention

1. **Finish project settings** — shard, selected regions, and map enabled state now land on import; crop bounds are deferred and legacy view/range toggles remain user preferences. Legacy faction is intentionally not imported because Nixie stores it per user.
2. **Train / locomotive entity types**
3. **Socket + orientation visual QA** — keep confirming high-traffic bunker connectors
4. **Community presets as product** — seed Nixie templates / `?preset=` (or equivalent) from the downloaded corpus

### P2 — Parity gaps regular users notice

1. **Garrison supply radius overlay** — legacy synthesizes from `baseGarrisonRadius`
2. **Tech tree browser** — manifest has `techId`; need tree data + UI
3. **Building placement validation** — optional strict mode like legacy
4. **Network overlays** — power, pipeline, engine lines (legacy `settings.network`)
5. **World decor on import** — roads / trees if map scenery matters

### P3 — Nice to have / legacy cruft not worth porting

1. **`tools/legacy/update.js` full data.js regen** — delete when ready to archive game-kitchen
2. **`publish-legacy-data.mjs` bridge** — delete with game-kitchen
3. **Generic spline path drawing tool** — removed; asset splines remain
4. **LZMA `.plan` export compatibility** — optional; nixie format is fine going forward
5. **Pixi-specific rendering quirks** — don't port; fix in FoxWatch metadata instead

---

## Data pipeline (target state)

```
Foxhole game paks
       ↓
FoxWatch (jimdcunningham/nixie-foxhole)
       ↓
packages/extensions/foxhole/public/foxhole/assets/   ← private assets repo
       ↓
Foxhole Planner (nixie)
```

**Retire:**

```
game-kitchen/tools/legacy/update.js  →  data.js
game-kitchen/tools/foxwatch/scripts/publish-legacy-data.mjs
```

---

## Retiring game-kitchen checklist

- [x] Legacy save import shipped and corpus-tested (`legacy:migration-status`)
- [ ] Import fidelity: train undercarriages and optional scenery (if needed)
- [ ] Top community presets productized (templates / deep links)
- [x] Production orders and statistics panel at parity for facility planners
- [ ] `/app` redirects to nixie editor
- [ ] game-kitchen repo archived read-only
- [ ] Remove `publish-legacy-data.mjs` and `tools/legacy/` from game-kitchen

---

## Related docs

- [`jimdcunningham/nixie-foxhole`](https://github.com/jimdcunningham/nixie-foxhole) — FoxWatch source and asset generation
- `packages/extensions/foxhole/public/foxhole/README.md` — assets repo setup
- `packages/extensions/foxhole/tests/fixtures/legacy-plans/README.md` — fixture download + status commands
- `packages/extensions/foxhole/tools/legacy-plans/` — maps, QA JSON, download + status scripts
- `game-kitchen/prompts/planFoxholeLegacySaveImport.prompt.md` — original import design notes
- `game-kitchen/tools/foxwatch/scripts/publish-legacy-data.mjs` — deprecated bridge (merge-only, no new assets)
