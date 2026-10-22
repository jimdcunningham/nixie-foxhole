# Asset Publication Inventory

This is the local preflight for future remote asset delivery. It does not upload,
provision storage, modify SDK contracts, repair assets, or delete old files.

From the nixie-foxhole checkout, write the report outside the served asset tree:

```powershell
node tools/foxwatch/scripts/asset-publication-inventory.mjs --assets packages/extensions/foxhole/public/foxhole/assets --output .tmp/publication/inventory.json
```

The root `assets:inventory` npm script is an alias. Direct Node invocation avoids
PowerShell npm-shim argument forwarding differences. `--help` lists the flags.
The command exits with status 1 when the generated inventory contains errors;
the report is still written for inspection. Invalid input metadata or unsafe paths
can stop the command before a report is produced.

## What Is Verified

- Encoded file byte lengths and SHA-256 receipts from catalog and world manifests.
- HTTP-decoded byte hashes, with streamed Brotli decoding and a per-object budget.
- Each region's declared dependency closure, including references found inside
  JSON/glTF/cubemap payloads; a dependency in another region is insufficient.
- Declared shared model parts, missing files, conflicting encodings, and unsafe
  paths or symbolic links.
- Actual media signatures rather than legacy file extensions. A WebP payload
  named `asset.png` receives `image/webp` in the inventory.

`validation: encoded-and-http-decoded-receipts` describes the scope of `valid`.
Application codecs, delta parameters and application-decoded receipts are carried
in each object's `uses`; the inventory does not render models, run every domain
decoder, validate lossy image quality or prove GPU performance. For example,
word-planar water geometry remains `application/octet-stream` after HTTP decoding
until its declared application codec reconstructs the GLB. Do not infer a loader
from the stored suffix alone.

Oversized textures and media/suffix mismatches are actionable warnings rather
than silent format rewrites. Current published roots use PNG/WebP/GLB/JSON/binary
signatures; unrecognized formats remain opaque bytes for a future typed decoder.

## Runtime Roots and Retention

`packages/foxhole-world/publication-roots.mjs` draws on the same authored JSON
descriptors used by runtime flag, smoke and foliage adapters. It adds those
dependencies even when they are absent from region manifests. New runtime
resources need a publication root or an ordinary declared graph dependency.

The existing world retirement utility protects code-declared world-content roots
too. The preflight only lists other unreferenced world files; it never removes
them. That list describes the current index, not every older supported release.
An eventual retention policy must retain the union of supported release graphs.

Groups distinguish catalog/support files, region closures and world-runtime
roots. Every physical object is listed once, even when several regions use it.
The report's world sharing totals exclude external catalog model receipts, so
they measure sharing between maps independently of catalog reuse.

The inventory is deterministic for unchanged bytes and declarations; its digest
covers the report including validation results. It is a local preflight artifact,
not a finalized SDK asset-pack schema or an R2 upload manifest.

## Refresh Stale Catalog Receipts

After a scoped model export, reconcile dependent region receipts explicitly:

```powershell
node packages/foxhole-world/catalog-references.mjs packages/extensions/foxhole/public/foxhole/assets/world
```

The root `assets:refresh-world-receipts` npm script is an alias. The refresh creates
new immutable region manifests and replaces the index last. Existing map objects
and previous manifests remain available. Rerun the inventory afterward; do not
publish a report whose `valid` field is false.

## Measured Baseline (2026-10-22)

The first full run covered 22,495 selected objects (4.116 GB), with four additional
runtime roots included and current-index-unreferenced world objects omitted. It
identified stale hospital hash/size receipts in 39 regions; current catalog model
receipts were already correct.

Across 53 regions, 11,226 unique world objects occupied 2.695 GB. Of these, 5,579
objects (1.010 GB) were shared by multiple regions. Summing each region's closure
independently would occupy 25.764 GB: the existing global content-addressed store
therefore avoids about 23.069 GB of repeated encoded payloads. This is storage
reuse, not a claim about a single view's download or GPU residency.

Shared content includes textures, GLB models, glTF documents and binary geometry,
not only catalog assets. Identical existing paths are reused; this slice does not
re-encode textures or invent region archives. Cross-model embedded-image sharing,
GPU compression, selective physical bundles and local HTTP serving are separate
experiments after this preflight.
