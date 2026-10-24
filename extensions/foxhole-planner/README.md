# Foxhole Planner

Foxhole Planner is an independently published Nixie SDK extension. Studio installs compatible `.nxext` releases through the extension browser; explicit development roots also support unpublished builds. It imports only the published `@nixiejs/extension-sdk` entry points, including the explicit `/experimental/scene-v2` preview boundary.

## Publication and R2 Asset Contract

Supabase stores the immutable extension archive and marketplace metadata/media. The
game asset library belongs to R2, served through `https://assets.nixiejs.com/foxhole-planner/`.
`src/asset-release-pin.json` identifies immutable publication and resource-pack
indexes by URL, SHA-256, and byte length. Builds do not follow a mutable latest channel.

R2 owns the canonical catalog/model manifests, localization and map metadata,
models, textures, icons, and map payloads. The extension build downloads pinned
JSON inputs and compiles a derived catalog snapshot into its JavaScript. Models
and images remain in R2 and are loaded on demand through the host resource path.
An existing extension release keeps its snapshot and resource-pack pin; updating
R2 alone does not change its catalog. A catalog/asset update needs a reviewed pin
change, a rebuild, and a new immutable extension version.

The publishing workflow copies only this extension into a disposable consumer
under `extensions/foxhole-planner`, with sparse verified asset inputs alongside
it at `packages/extensions/foxhole/public/foxhole/assets`. This layout supports
existing Node-side imports without requiring the private Nixie repository.
`build/prepare-publication-inputs.mjs` downloads metadata plus model bytes needed
by geometry tests. Those test inputs are not part of `dist` or the `.nxext`.
`build/verify-publication-package.mjs` checks the completed archive retains the
exact R2 pack and contains no game model/image bytes before publication.

Publication needs only public R2 reads and a scoped Nixie publisher token; it
does not write R2 or require R2 credentials. Publishing the game library remains
a separate FoxWatch operation. Studio's compiled private APIs/adapters have their
own source/asset pin and deployment lifecycle.

The workflow requires the retry-capable `@nixiejs/extension-package@0.1.0-preview.2`.
That tooling release and the matching Studio broker must be available before
enabling automated publication; a local rehearsal can install its reviewed npm
tarball instead without publishing it.

Version `0.3.2` is the next prepared release. The original `0.3.1` publication's
HTML used CRLF; clean builds use LF. `index.html` is explicitly checked out with
LF so future publications use consistent source line endings. The changed
archive must use a new version even though its runtime behavior is unchanged.

## Map Status: Frozen Standalone Fallback

As of October 17, 2026, Studio uses the bundled Foxhole War panel and map controller for both Scene V1 and Scene V2, including 2.5D/3D presentation. The separate SDK `planning-map` and `planning-grid` renderers are frozen reference/fallback implementations. Their missing features, visual parity and performance are not blockers for ECS or Scene V2. Retain their existing tests; further map parity work requires an explicit scope decision and a concrete standalone consumer.

Local development builds expose **Foxhole War → More Options → Use SDK Map** in Scene V2 for comparison. Production omits the setting and menu item and always selects the bundled map, even if a saved local preference requests the SDK renderer. Scene V1 always uses the bundled map. SDK-only development hosts can still use the packaged fallback renderers. This freeze applies to the map, not the Planner's ECS components, products or other SDK capabilities.

## Live Connector Gestures

Scene V2 placement previews and endpoint handles use the public SDK geometry gesture path. Planner owns socket compatibility, capacity, attachment records, connector constraints, and handle presentation. Nixie owns pointer capture, bounded target snapshots, detached previews, validation, persistence, and undo. Power lines target a compatible power terminal when hovering the building body; pipes and rails use world-space socket proximity. Disabled snapping detaches the edited endpoint while preserving the opposite end and side branches.

From the repository root, run `node packages/extensions/foxhole/tools/test-sdk-host.mjs` for the adapter-free placement/endpoint/persistence/reload pressure test. Its loader registers no private host policy, discovery profile, or Nuxt state adapter. The standalone package's `npm test` covers connector types, socket capacity, reciprocal cleanup, and domain handle presentation.

Ctrl/Cmd+wheel curve controls are declared through SDK selection geometry. Studio validates the owner-local numeric field, applies bounded steps, and retains placement drafts without saving until placement completes. Planner supplies pipe curve policy; it does not receive native wheel events. Legacy V1 insertion and bundled panels remain compiled integrations.

## Selection and Socket Presentation

Accepted SDK selection fields take precedence over private compatibility hints. Core authored hitboxes still win, and missing fields retain older-plan fallbacks. Socket indicators, All Sockets status colors and grouped legacy labels, and connector guides are ordinary SDK graphics/text with host-owned bounds exclusion, selection visibility, upright orientation, and tool colors. Modern render plans retain empty socket groups when indicators are hidden so compatibility code cannot restore them. The private adapter leaves those plans intact; older generations keep their native fallback.

The pure legacy socket ID/name map lives in `src/legacy-plan-socket-id-map.ts`. Legacy imports re-export it and the existing generator updates that canonical source. This does not move legacy project import or bundled panel code into the sandbox.

## Development

Run `npm run dev --workspace @nixiejs/foxhole-planner-sdk`, choose the containing extensions folder in an offline project’s Manage Extensions dialog, approve its local migration capability, and enable it for that project.

The Explorer uses the SDK `assets` provider in both Scene V1 and Scene V2. Language, default/rendered icons, search aliases, categories, filters and upgrade entries come from that provider. The bundled layer no longer contributes an Explorer catalog.

The compiled integration retains legacy scene rendering and read-only identity adapters. Old `foxhole.structures` palette references resolve through the active SDK provider; imported legacy toolbelts use `sdk.nixie.foxhole-planner__assets` and canonical `asset.*` IDs. V1-to-V2 conversion canonicalizes historical asset keys and icon folders, retains supported appearance/modification state and model bindings, and preserves the original node snapshot. Unknown identities stay unresolved with their source data preserved.

The default 3D scope is the explicit 54-asset snapshot in `src/scene-v2-model-policy.json`: intact non-vehicles from Facilities, Power, Mining, Liquids, and Foundations. Destroyed/breached variants and vehicle GLBs are excluded from model bindings, resource declarations, and copied model files. Existing 2D catalog data, footprints, and resources remain available. Optional saved model bindings are preserved; Nixie's spatial renderer uses planar visuals when their model resource is no longer available.

The authored export policy lives in `C:\Code\nixie-foxhole\tools\foxwatch\asset-overrides\spatial-models.json`. Its approved default is `curved50-compact16` (precision reduction, 50% target with curved-detail protection, compact normals/tangents, original texture settings). Keep this private package's policy snapshot aligned with authored scope changes. Build hooks synchronize explicit model resource declarations and remove obsolete generated GLB copies from `dist`.

The requested follow-up batch exported 38 of the remaining 39 assets with `curved50-compact16`, including 22 default/upgrade parts. The bundle now has 53 allowed base models and 62 assembly parts (115 GLBs). Power Line remains procedural: its source scene has no mesh to export, so it keeps its existing visual path. The earlier 15 base models and their 40 parts were retained byte-for-byte. Visual approval of the new batch is still pending.
