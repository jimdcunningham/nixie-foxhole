# Legacy Clipboard Snapshots

Paste the same payload into **legacy Foxhole Planner** and **foxhole-planner** for visual A/B.

## How to use

1. Open `<name>.txt`
2. Copy the entire file contents (starts with `data:plan;plain,`)
3. Paste into both editors (Ctrl+V)

## Regenerate

```bash
npm run legacy:generate-clipboard-snapshots
npm run legacy:generate-clipboard-snapshots -- --mode missing-buildings
npm run legacy:generate-clipboard-snapshots -- --mode shapes
npm run legacy:generate-clipboard-snapshots -- --mode icons
npm run legacy:generate-clipboard-snapshots -- --mode socket-compass
npm run legacy:generate-clipboard-snapshots -- --mode socket-compass --only fortt3_atgunait3
npm run legacy:generate-clipboard-snapshots -- --mode socket-pairs --only fortt3_atgunait3
npm run legacy:generate-clipboard-snapshots -- --mode socket-pairs --all-bunkers --single-pair --out connected-all-bunkers-compact
npm run legacy:generate-clipboard-snapshots -- --only facilitypowerdiesel,facilitycrane
npm run legacy:generate-clipboard-snapshots -- --confidence low --limit 20
```

Default layout: grid (`4` columns) — label above each asset at rotation `0`
(frame offset is applied on spawn, so extra entity rotations do not help QA).

Confirmed / skipped keys live in `../orientation-qa.json` and are omitted from orientation snapshots.
Manual rotation fixes live in `../orientation-overrides.json`.
