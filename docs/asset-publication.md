# Asset Publication Inventory

The inventory is the read-only preflight for remote asset delivery. FoxWatch now
provides separate preparation and explicit publication commands below. Neither
command switches production consumers or removes previous releases.

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

## Prepare and Publish a Pinned Release

Copy `config/asset-publication.example.json` to
`tools/foxwatch/local/asset-publication.json`. Configure the assets directory,
output directory, S3 endpoint, bucket, public HTTPS base URL, and an isolated
object prefix. The local config and credentials are ignored by Git. Public URLs
must already have working HTTPS, CORS, and caching; the publisher does not change
Cloudflare account settings.

```powershell
node tools/foxwatch/run-foxwatch.mjs assets-prepare --config tools/foxwatch/local/asset-publication.json
node tools/foxwatch/run-foxwatch.mjs assets-publish --config tools/foxwatch/local/asset-publication.json
# Explicit upload of the checked snapshot:
node tools/foxwatch/run-foxwatch.mjs assets-publish --config tools/foxwatch/local/asset-publication.json --upload
```

`assets:prepare` and `assets:publish` are npm aliases. `--plan <plan.json>` selects
an earlier prepared release instead of the latest local plan. Prepare can use
`--output <new-directory>`; it refuses to overwrite an existing snapshot and must
write outside the served assets tree. Commands share FoxWatch's refresh lock,
preventing a local export and publication from changing the same inputs.

Preparation builds a fresh validated inventory, snapshots each payload, checks
its encoded hash again, and produces content-addressed objects, SDK-compatible
catalog/region indexes, logical path mappings, and one pinned release descriptor.
Self-contained catalog GLBs receive Brotli transport compression; existing world
content paths and bytes stay intact so relative glTF references still resolve.
Actual MIME types, HTTP-decoded hashes, application codecs, delta parameters, and
application-decoded receipts are retained. Shared objects upload once across
regions and releases. The top-level world index is bootstrap metadata rather
than an eagerly loaded whole-world SDK pack.

Indexes are partitioned by catalog, support, runtime roots, and region. Each is
bounded by the SDK's 8 MiB decoded index limit. Data receipts allow up to 512 MiB
and 4,096 direct dependencies, including legitimate empty binary buffers. Those
limits describe indexable streamed data; the Nixie renderer still limits files
to 32 MiB and requested closures to 128 objects / 128 MiB. A release may describe
more region packs than one installed extension mounts at once. The current
planner consumes the pinned release through its remote asset integration. This
publisher does not update the extension's pin or deploy Nixie.

The first `assets-publish` command above is a dry run: it verifies the snapshot
without sending requests or needing credentials. `--upload` performs bounded
concurrent S3 requests, checks existing object metadata before reusing bytes,
uses conditional creates, and verifies receipts after each upload. Payloads must
finish before indexes; the pinned release descriptor is published last. The
supported conditional-create and Content-MD5 behavior is documented in
[Cloudflare's S3 compatibility table](https://developers.cloudflare.com/r2/api/s3/api/).
Transient failures retry with backoff; each retry opens a fresh stream. Stop or
failure leaves the completed immutable objects available for the next attempt.
Rerun the same plan to resume; remote receipts are checked again rather than
trusting a local success journal. The uploader never deletes or replaces objects,
updates a `latest` channel, or silently accepts header/hash mismatches.

A successful upload writes `publication-receipt.json` next to the prepared plan,
including the pinned release URL, decoded hash and length, target, uploaded and
reused counts, and timestamp. Retain the previous release pin for rollback. A
consumer may select an older pin without any upload. Garbage collection and
retirement of old generated assets remain separate, explicit work.

## Credentials and Monitor Controls

Use bucket-scoped R2 S3 credentials with object read/write access. They are
separate from Wrangler's OAuth login. The Node publisher accepts only
`FOXWATCH_ASSETS_ACCESS_KEY_ID` and `FOXWATCH_ASSETS_SECRET_ACCESS_KEY`; it does not
fall back to another AWS profile. Set these locally in the shell that launches
the command, or use the Monitor's **Asset Publishing** panel. Never put keys in
chat, command arguments, source control, public manifests, or publication logs.

The Monitor panel provides **Save Settings**, **Save Credentials**, **Prepare
Assets**, **Check Upload**, **Publish Assets**, and **Open Output**. Saved Monitor
credentials use the existing current-user Windows DPAPI helper and an ignored
local `.dpapi` file referenced by `credentialFile` in the config. Fields are not
backfilled with stored secrets. On other systems, use the explicit environment
variables; an optional local `credentialEnvFile` is also supported. Automatic
Steam polling does not publish assets, and the normal Stop Run action stops the
uploader's process tree. Opening the configuration panel defers new automatic
polls until it closes.

## Portable Planner Product Catalogs

Planner now consumes a FoxWatch-generated packaged catalog and readable immutable
asset-release paths. The old Planner alias-overlay publication command has been
removed. See [Packaged Product Catalogs](./product-catalog-assets.md) for preparation,
publication ordering, local verification, and the catalog/CI-fixture distinction.

## Private Integration Metadata Builds

The compiled private Foxhole server/map integration retains its existing world
publication pin and metadata bootstrap. Its legacy `build/prepare-build-inputs.mjs`
helper still retrieves the eight verified source JSON inputs and checks the pinned
build metadata for those consumers. It is not the portable Planner build path.

Ordinary Planner builds use `build/prepare-catalog-input.mjs` instead and require
only the single generated catalog. New Planner catalog pins never replace the
private world pin or silently update an installed extension. Cached resources
remain demand-loaded; uncached resources still require a connection.

## Production Asset Delivery

`assets.nixiejs.com` is the sole public asset hostname and connects to the
`nixie-extension-assets` bucket. The development `r2.dev` URL is disabled. The
Nixie repository tracks the read-only web, desktop and local CORS policy in
`config/foxhole-assets-cors.json`. The **Nixie Asset Delivery** cache rule matches
only this hostname, marks responses eligible for cache and retains the objects'
Cache-Control TTLs.

The library uses the `foxhole-planner/` object prefix. Keep the local publication
config pointed at `nixie-extension-assets` with `prefix: "foxhole-planner"`; old
prepared plans targeting another prefix must be prepared again. The previous
test prefix has been retired, so builds must use the current checked-in asset pin.
The bucket name is infrastructure configuration and never appears in public URLs.

A prefix migration can copy existing objects within R2 without regenerating models
or uploading the library from the local machine. Release metadata and the extension
pin must then be regenerated for the new paths. The promotion command below only
publishes the small rewritten metadata; it does not copy the referenced payloads.

For a future hostname change, prepare a promotion without network writes or pin changes (substitute the new hostname):

```powershell
node tools/foxwatch/scripts/asset-pack-promote-host.mjs --public-base-url https://assets.nixiejs.com/
```

After explicit approval, add `--upload` to publish only the rewritten release
and derived metadata. The command verifies public receipts before changing the
source pin, local publisher base URL and latest-plan pointer. Existing object
keys, bulk bytes and older release descriptors remain available. This command
does not push source changes, deploy Nixie, or change a running application's pin.
