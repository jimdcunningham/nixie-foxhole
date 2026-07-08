# FoxWatch asset output specification

This document is the **authoritative specification** for what FoxWatch produces: intermediate workspace layout, published file paths, image roles, formats, and manifest URL rules. Implementation should converge on this spec; when code and this doc disagree, treat the doc as the intended design unless an issue explicitly tracks a deliberate exception.

Operator setup and CLI workflows live in `tools/foxwatch/README.md`. Blender scene import details live in `tools/foxwatch/blender/README.md`.

## Pipeline stages

```
Foxhole paks
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Extract (C# / FoxWatchService)                           │
│    manifest, meshes, blueprint UI icons, render scene JSON  │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Render (Blender)                                         │
│    top-down textures, angled preview masters, pencil default│
└─────────────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Publish (Node: publish-manifest, publish-structure-icons)│
│    encode WebP, subtype overlays, manifest URLs, pruning    │
└─────────────────────────────────────────────────────────────┘
    │
    ▼
apps/foxhole-planner/public/foxhole/assets/
```

| Stage | Owns |
| --- | --- |
| Extract | Structured data, mesh paths, blueprint default icon **sources**, render scene bundles |
| Blender | **Pixels** for board textures and angled previews; pencil default when no blueprint icon exists |
| Publish | **Final** WebP deliverables, subtype composition, manifest paths, dedup aliases, pruning |

Subtype overlays are applied **only in publish**, never in Blender. That keeps lossless masters clean and lets preview stay unbadged while default/rendered icons carry subtype badges. Publish applies overlays both when co-locating blueprint/default icons (`publish-structure-icons`) and when deriving WebP icons from Blender PNG masters during raw sync (`preview.png` → `icon.rendered`, pencil `icon.default.png` → `icon.default`).

## Intermediate workspace (`tools/foxwatch/tmp/`)

These paths are **not** served to the planner. They are inputs to publish.

| Path | Contents |
| --- | --- |
| `foxwatch-manifest.v1.json` | Raw generated manifest (pre-publish) |
| `modification-render-index.v1.json` | Canonical `renderId` index for modification variants |
| `renders/` | Per-asset render scene bundles (`scene.json`, `output.json`, index) |
| `assets/` | Extracted mesh / material packages used as Blender import inputs |
| `rendered-assets/` | Blender image outputs (`types/…`, `shared/…`) synced by publish |
| `foxhole-icons/` | Extracted blueprint UI icons (PNG/WebP sources) from `extract-ui-assets` |

### Per-structure render bundle (`tmp/renders/<structureId>/`)

Each renderable asset has a bundle folder containing:

| File | Purpose |
| --- | --- |
| `scene.json` | Living structure scene graph for Blender |
| `destroyed.scene.json` | Destroyed variant scene (when applicable) |
| `modifications/<renderId>.scene.json` | Modification variant scene for a host structure |
| `modifications/<renderId>/components/<layerId>.scene.json` | Component-layer scene (splines, pipe spans, etc.) |
| `components/<layerId>.scene.json` | Structure component layer (when used) |

Blueprint default icon sources for the asset (when extracted) travel with the mesh/material export and are referenced from manifest `iconUrl` / slot variant icons until publish co-locates them.

### Blender image output (`tmp/rendered-assets/types/...`)

Blender writes **intermediate** images here before publish transforms them.

| Output | Format | Notes |
| --- | --- | --- |
| `<id>.texture.webp` | Lossy WebP | Final top-down board image; publish may sync as-is |
| `<id>.preview.png` | PNG | Lossless angled master at 512×512; publish converts to lossy WebP |
| `<id>.icon.default.png` | PNG | Pencil fallback when no blueprint default exists; only when `generateDefaultIcon` or equivalent applies |
| `destroyed.*` | Same pattern | Prefixed with `destroyed.` where applicable |

Blender does **not** emit `icon.rendered` in the target design. Publish derives rendered icons from the preview master.

Blender does **not** run the `icon` render mode in the target design (preview PNG replaces a separate icon pass).

Raw Blender PNG/WebP masters stay unbadged. When publish converts masters into co-located icon WebPs (`icon.rendered` from preview PNG, pencil `icon.default` from PNG), it applies subtype overlays in that same sharp write.

## Published output root

```
apps/foxhole-planner/public/foxhole/assets/
├── manifest.v1.json
├── planner-compat.json
├── localizations/
│   └── <locale>.json
├── icons/                          # Global shared icon pool (see below)
├── maps/
├── ui/
├── shared/
│   ├── modifications/
│   │   └── <renderId>/
│   │       ├── <renderId>.texture.webp
│   │       ├── <renderId>.preview.webp
│   │       ├── <renderId>.icon.default.webp
│   │       └── <renderId>.icon.rendered.webp
│   └── packaging/
│       └── <shippableType>/
│           └── ...
└── types/
    ├── structures/
    ├── items/
    └── vehicles/
        └── <codename>/
            ├── <codename>.texture.webp
            ├── <codename>.texture.json          # sprite anchor sidecar
            ├── <codename>.preview.webp
            ├── <codename>.icon.default.webp
            ├── <codename>.icon.rendered.webp
            ├── <codename>.destroyed.texture.webp
            ├── <codename>.destroyed.preview.webp
            ├── <codename>.destroyed.icon.default.webp
            ├── <codename>.destroyed.icon.rendered.webp
            ├── components/
            │   └── <layerId>/
            │       └── <layerId>.texture.webp
            └── modifications/
                └── <renderId>/
                    ├── <renderId>.texture.webp
                    ├── <renderId>.preview.webp
                    ├── <renderId>.icon.default.webp
                    ├── <renderId>.icon.rendered.webp
                    └── components/
                        └── <layerId>/
                            └── <layerId>.texture.webp
```

`<codename>` and `<renderId>` are lowercase normalized identifiers.

Color variants (when present) use a hex suffix: `<codename>.texture.<rrggbb>.webp`, `<codename>.preview.<rrggbb>.webp`, etc.

Packaged variants use a `packaged.` infix: `<codename>.packaged.texture.webp`, etc.

## Image roles

| Role | Filename suffix | Typical size | WebP encoding | Subtype overlay |
| --- | --- | --- | --- | --- |
| Board texture | `.texture.webp` | Variable (64 px/m top-down) | Lossy | No |
| Inspector preview | `.preview.webp` | 512×512 | Lossy (`quality: 90`, `alphaQuality: 100`) | No |
| Default icon | `.icon.default.webp` | ≤256×256 | **Lossless** | **Yes** (when applicable) |
| Rendered icon | `.icon.rendered.webp` | ≤256×256 | Lossy (`quality: 90`) | **Yes** (when applicable) |

### Default icon sources (priority)

1. **Blueprint extraction** — UI icon from game assets (`extract-ui-assets` → `tmp/foxhole-icons/`).
2. **Blender pencil** — Freestyle lineart fallback when no blueprint icon exists and the asset is configured to generate one (`generateDefaultIcon`).

Publish always materializes a co-located `<codename>.icon.default.webp` (or modification equivalent). The manifest `icons.default` URL points at that file.

### Rendered icon derivation

When a preview master exists:

```
preview.png (lossless, 512)
    → compose subtype at full resolution (if applicable)
    → downscale to ≤256
    → encode lossy WebP → icon.rendered.webp
```

When no preview exists, the manifest references the **same URL** as `icons.default` for `icons.rendered` / `previewIconUrl`. **Do not copy the file** — URL alias only.

### Destroyed visuals

Structures with a trustworthy `destroyed.scene.json` get a parallel `destroyed.*` file set under the same codename folder.

Destroyed default and rendered icons **always** receive the wrecked subtype overlay at publish unless an explicit `subTypeIconUrl` overrides it.

## `/icons/` vs co-located assets

### `icons/` — global shared pool

Path: `/foxhole/assets/icons/<iconKey>.webp`

**Purpose:** Icons referenced by **many** manifest entries by game icon name, not owned by a single structure folder.

| Belongs in `icons/` | Does not belong in `icons/` |
| --- | --- |
| Extracted blueprint item/material icons used as publish **inputs** | Structure `texture`, `preview`, `icon.rendered` |
| Subtype badge sources (`subtypewreckedicon`, `subtypemetal`, …) | Co-located `types/.../<codename>.icon.default.webp` |
| Category icons | Modification renders under `types/.../modifications/` |
| Legacy `iconUrl` keys that truly are global game icons | Duplicates of co-located structure defaults |

Publish syncs **only** icon keys still referenced by the manifest under `/foxhole/assets/icons/`. When a structure’s `icons.default` is co-located, the manifest must point at the co-located path, not `/icons/<codename>`.

### Co-located — per-asset canonical paths

Path: `/foxhole/assets/types/<structures|items|vehicles>/<codename>/...`

Every structure (and modification `renderId` folder) owns its published visuals here. This is what the planner loads for board placement and inspectors.

## Modifications

### Slots, `dataClassPath`, and `variantId`

- Each **modification slot** on a blueprint is a `ModificationSlotComponent` with a **`name`**, transform, and **`dataClassPath`** pointing at a modification **catalog** asset (lists barbed wire, bunk bed, insulation, etc.).
- A **`variantId`** (e.g. `bunkbed`, `insulation`, `barbedwire`) is an entry inside that catalog.
- **Directional trench/fort slots** (front, back, left, right) often have **different** `dataClassPath` values even when the template actor is identical; direction is `slot.name` + transform, not a different prop.
- **Facility pipe hosts** also have **different** `dataClassPath` values while often sharing the same insulation template actor; host-specific pixels are separated by scene fingerprint, not by hashing `dataClassPath`.

### Modification render identity (`renderId`)

Dedup and file naming use a stable **`renderId`**, not bare `variantId`:

```
identity = variantId | templatePath
renderId = {variantId}-{sha256(identity)[0:12]}
```

| Input | Role |
| --- | --- |
| `variantId` | Human-stable mod name (`bunkbed`, `insulation`) |
| `templatePath` | Visual discriminator: `templateActorPath` → else `templateMeshPath` → else `previewMeshPath` |

**Not in the hash:** `dataClassPath`, `slotName`, `previewDirection`, structure id. Directional fort/trench slots share the same prop; pipe hosts that share a template actor keep one `renderId` even when their catalogs differ.

### Scene-fingerprint routing (shared vs host storage)

`renderId` answers “what mod is this?” Storage answers “can these Blender pixels be reused?”

1. Build a per-consumer modification scene for each `(structureId, slotName, variantId)`.
2. Group consumers by `renderId`.
3. Hash each scene (`CreateStandaloneModificationSceneFingerprint`: meshes, materials, node tree, render settings).
4. If every consumer in the group has the **same fingerprint** → one Blender output under `shared/modifications/<renderId>/`.
5. If fingerprints **differ** (host mesh overrides, pipe insulation components, etc.) → keep per-host scenes under `types/structures/<host>/modifications/<renderId>/` — still the same `renderId` folder name.

Fingerprint is a comparison tool available only after scene generation. It is **not** the public identity.

### Modification manifest rules

- Slot `variants` in `manifest.v1.json` reference URLs for texture, preview, and icons.
- When a visual is identical to another URL already in the manifest (shared mod, or fallback to default), emit the **same URL string** — never duplicate bytes on disk.
- `sharedModificationId` is **not** a published manifest field in the target design; `renderId` is a **file-path** concept, not a manifest hydration indirection.
- Publish sets `sharedModificationId` on slot variants **only** when the modification render index marks that consumer as fingerprint-shared (`storage: shared` or multi-host dedup). Same `renderId` with differing host fingerprints (pipe insulation, etc.) stays co-located under `types/structures/<host>/modifications/<renderId>/` and does **not** enter `shared.modifications`.

## Manifest URL rules (no duplicate files)

Publish writes a file **only when the bytes are unique**. Logical roles that share identical pixels use the same URL:

| Condition | `icons.rendered` / `previewIconUrl` |
| --- | --- |
| Preview master exists | Co-located `<codename>.icon.rendered.webp` (derived) |
| No preview | Same URL as `icons.default` |
| Mod uses shared deduped render | URL under `shared/modifications/<renderId>/...` |
| Mod matches host default | URL alias to existing icon (no copy into `modifications/` folder) |

The manifest is authoritative. The planner should not need runtime guesswork to find fallback paths.

### Published manifest icon fields (structures)

| Field | Meaning |
| --- | --- |
| `icons.default` | Blueprint or pencil default (lossless WebP, subtype applied) |
| `icons.rendered` | Angled thumbnail for UI lists (derived from preview, or alias of default) |
| `previewUrl` | Larger angled inspector image (lossy WebP, no subtype) |
| `previewIconUrl` | Legacy alias; prefer `icons.rendered` |
| `variants.default.textureUrl` | Board placement texture |
| `sprite.*` | Anchor metadata; `sprite.source` typically matches texture URL |

## Subtype overlays (publish only)

Applied via `composeSubtypeIcon` in:

- `publish-structure-icons` when co-locating composable icon kinds
- `publish-manifest` raw sync when deriving `icon.rendered` from preview PNG masters or converting pencil `icon.default.png`

| Source | When |
| --- | --- |
| Explicit `subTypeIconUrl` on structure or variant | Always wins |
| Wrecked subtype | Destroyed structures, breached structures, `*destroyed` / `*breached` codenames, destroyed icon asset kinds |
| Variant `subTypeIconUrl` from extraction | Mod slot variants that define one |

Overlay scale is ~28% of base icon in the top-left corner. Subtype source icons resolve from extracted `foxhole-icons/` / generated icon keys.

**Never** bake subtype into Blender output or preview masters. If publish copies or converts an icon with sharp into a public composable icon path, subtype must be applied in that write.

## Component layers and splines

Some assets render extra top-down layers (pipe spans, barbed wire splines, trench upgrades):

```
types/structures/<codename>/components/<layerId>/<layerId>.texture.webp
types/structures/<codename>/modifications/<renderId>/components/<layerId>/<layerId>.texture.webp
```

Component layers are **texture-only** in the published tree unless a separate preview/icon spec is added later.

## Compression summary

| Stage | Format | Lossless? |
| --- | --- | --- |
| Blender preview master | PNG | Yes |
| Blender pencil default | PNG | Yes |
| Blender texture | WebP | No (final) |
| Publish preview | WebP | No |
| Publish icon.default | WebP | Yes |
| Publish icon.rendered | WebP | No |

Publish never derives `icon.rendered` from an already-lossy `preview.webp`. It always forks from the lossless preview master (PNG in `tmp/`).

## Dedup lifecycle

1. **Manifest generation (C#)** computes `renderId` once per slot variant and writes `modification-render-index.v1.json`.
2. **Render scene generation** keys scenes and Blender `outputKey` paths by `renderId`; groups identical fingerprints into `mods/{renderId}` for shared Blender output.
3. **Blender** writes `shared/modifications/{renderId}/` when deduped, otherwise `types/structures/{host}/modifications/{renderId}/`.
4. **Publish** reads `renderId` from the raw manifest only, syncs assets, derives `preview.webp` and `icon.rendered` from PNG masters, and emits URL aliases instead of copying files.

## Pruning

After publish, orphaned files under `public/foxhole/assets/` that no manifest URL references should be removed. This includes:

- Stale `shared/modifications/` folders for retired `renderId` values
- Co-located structure files for removed codenames
- `icons/` entries no longer referenced

Scoped (`--only`) publishes skip global pruning unless explicitly intended.

## Validation

`tools/foxwatch/scripts/validate-assets.mjs` enforces the published tree shape. It should accept:

- Repeated URLs across manifest roles (same file, multiple references)
- Omitted `previewUrl` when no preview was rendered
- `icons.rendered` URL equal to `icons.default` URL without a separate `icon.rendered` file on disk

## Asset overrides

Structure-specific overrides live in `tools/foxwatch/asset-overrides/<codename>/manifest.json`. Cross-cutting modification overrides live in `tools/foxwatch/asset-overrides/modifications.json` under a `modifications` object.

Modification override keys resolve with this precedence (first match wins):

| Priority | Key format | Example |
| --- | --- | --- |
| 1 | `<structureId>/<slotName>/<variantId>` | `fortt2/pipefront/pipe` |
| 2 | `<structureId>/<variantId>` | `fortt2/bunkbed` |
| 3 | `<renderId>` | `bunkbed-47e016ce52d5` |
| 4 | `<variantId>` | `bunkbed` |

The same precedence is used in C# manifest hydration (`FoxWatchManifestReferenceHydrator`) and publish-time preview-direction preservation (`publish-manifest.mjs`). Prefer `renderId` keys in `modifications.json` when the same `variantId` appears in multiple slots or data classes.

## Related implementation files

| Area | Location |
| --- | --- |
| Manifest generation | `FoxWatchManifestAssetExtractor.cs`, `FoxWatchManifestGenerator.cs` |
| Render scene generation | `FoxWatchRenderSceneGenerator.cs` |
| Blueprint scene / slots | `FoxWatchRenderBlueprintSceneExtractor.cs` |
| Blender render | `tools/foxwatch/blender/render_render_scenes.py` |
| Publish | `tools/foxwatch/scripts/publish-manifest.mjs`, `publish-structure-icons.mjs` |
| Icon composition | `tools/foxwatch/scripts/publish-icon-utils.mjs` |
| Asset overrides | `tools/foxwatch/asset-overrides/` |
| Validation | `tools/foxwatch/scripts/validate-assets.mjs` |

## Implementation status

The pipeline implements the target design for:

- Canonical `renderId` as `variantId|templatePath` at manifest generation
- Scene-fingerprint routing for shared vs host modification storage
- PNG preview masters with publish-time WebP fork and derived `icon.rendered`
- Publish reads `renderId` from raw manifest without JS re-hash
- `modifications.json` override lookup by `structureId/slotName/variantId`, `structureId/variantId`, `renderId`, or `variantId`

Remaining convergence work is mostly operational validation across a full FoxWatch refresh cycle.
