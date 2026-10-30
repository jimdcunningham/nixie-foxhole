# Compact World Transport Bundles

The compact runtime optionally reads native HTTP Brotli bundles. A bundle contains
unchanged HTTP-decoded resource bodies; its manifest records each body's offset,
length and SHA-256. Individual resource paths and decoded identities remain the
fallback and persistent cache keys. There is no new image or geometry codec.

Prepare an isolated candidate from a canonical, unbundled world index:

```powershell
node packages/foxhole-world/bundle-compact.mjs --source packages/extensions/foxhole/public/foxhole/assets/world --target C:/path/to/new-candidate --regions deadlands
```

Use `--regions all` to prepare all regions, or comma-separated region IDs to
prepare a subset. Generation reads all region manifests to classify shared
content, then packs each selected region's declared closure independently.
Identical archives share a content-addressed file; different regional layouts
can repeat asset bytes in transport archives. Cached individual assets remain
globally reusable by decoded hash, even when the next region uses another archive.
The candidate directory must be empty and outside the canonical source, including
when existing ancestor directories are junction aliases.
Canonical export, the checked-in release pin, and publication channels are not
changed by this command. Retain the original individual files for old clients,
fallback, and rollback.

Chunks have a hard 4 MiB decoded bound. Larger individual resources remain
independent. Terrain color/normal tiers, water, transport, sky, and native model
categories/LODs are partitioned separately. Rewritten glTF/cubemap dependencies
inherit their consumer roles. Unclassified resources remain independent. Shared
ownership families reduce fragmentation within a region; this is per-region
transport packing, not a claim that every archive is globally shared across all
53 regions. Persistent per-asset cache reuse remains global by decoded SHA-256.

The provider attaches bundle descriptors only in memory after validating the
region manifest. Those descriptors travel with existing resource/terrain/geometry
worker jobs. A cache hit needs no bundle request. On a miss, a cross-worker Web
Lock lets one reader download and verify the bundle and every entry, then seed
the existing retained resource cache in bounded batches. No region-wide prefetch
runs at startup, and the existing layer-demand scheduler remains authoritative.

The final cancelled subscriber waits for started downloads and cache writes to
drain. Missing or corrupt bundles fall back to individually verified resources;
unexpected programming failures still propagate. Cache unavailability keeps the
existing individual-file path. Network observations deduplicate shared bundle
transfers, and bundle request/byte/fallback counters are included in worker
cache metrics.

Run focused tests and the world suite:

```powershell
node --test packages/foxhole-world/tests/compact-bundles.test.mjs
node --test packages/foxhole-world/tests/*.test.mjs
node packages/foxhole-world/build-client.mjs
node packages/foxhole-world/audit-compact-bundles.mjs --root C:/path/to/new-candidate --expected-regions 53 --report C:/path/to/audit.json
```

The audit verifies every encoded and decoded receipt, every bundle slice, the
4 MiB bound, regional closure, rewritten dependencies, logical resource refs and
download totals. Its summary separates retained originals from added archives:
the output retains individual fallback files, so total publication storage is
larger than the bytes any one region downloads. Do not describe transport bundling
as an asset-size reduction. Generate into a new candidate to exclude stale output.
The publication inventory labels declared archives as `application/octet-stream`,
even when the first concatenated body has an image or model signature. Include
the normal catalog and authored runtime roots when preparing a publication;
legacy foliage repairs can request a runtime texture outside a region manifest.

Before publishing a wider rollout, verify a rendered full-editor cold/warm run,
terrain-only demand, cross-region cache reuse, cancellation, and the publication
graph. Download-only viewer timings do not measure scene construction, texture
upload, cache writes, or GPU memory. A fixture's memory-reserve stop is not proof
of an editor crash or successful load.
