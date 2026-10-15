# Legacy `.plan` fixtures

Downloaded Foxhole blueprint archives used by the legacy import tests.

## Layout

- `raw/{file}.zip` — blueprint zips from public Supabase storage
  - Community presets keep their `presetMap` key (`halberd_bunker.zip`)
  - Everything else is `bp-{uuid}.zip`
- `extracted/{file}.json` — optional extracted / decompressed project payload
- `manifest.json` — catalog of what was downloaded (gitignored)
- `sample-project.json` — tiny committed synthetic save for unit tests

`raw/`, `extracted/`, and `manifest.json` are gitignored.

## Download

The `blueprints` storage bucket cannot be listed with the anon key, but every
row in the `blueprints` table points at a public zip URL:

`…/storage/v1/object/public/blueprints/{id}/versions/{version}.zip`

```bash
# All foxhole blueprints (~1200+)
npm run legacy:download-presets

# Public only / presets only / capped
node ./tools/legacy-plans/download-presets.mjs --privacy public
node ./tools/legacy-plans/download-presets.mjs --source presets
node ./tools/legacy-plans/download-presets.mjs --limit 50 --concurrency 12
```

Requires `NUXT_PUBLIC_SUPABASE_KEY` (loaded from `apps/nixie-studio/.env` or `game-kitchen/.env`).

## Tests

```bash
npm run test:legacy-plans
```

The fixture suite fails intentionally until entity fields are fully ingested.

## Migration status (corpus scorecard)

Imports every downloaded fixture, buckets plans by issue severity, and inventories every
persisted `projectSettings` key with type and representative values (without the all-or-nothing fail gate):

```bash
npm run legacy:migration-status
# optional: --limit=100 --concurrency=6 --json=path/to/report.json
```

Writes `tools/legacy-plans/migration-status-report.json` by default.
