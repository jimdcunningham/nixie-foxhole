# Foxhole World

FoxWatch owns world preparation. Prepared game assets belong in the private assets repository under `foxhole/assets/world`, alongside catalog assets, and must not be checked into this source package.

## Delivery Policy

The default export is **compact recipes**. Keep encoded textures and compact, verified road/terrain/decal recipes. Reconstruction runs in workers. Expanded GPU-ready geometry is an explicit research candidate (`--world-format baked-candidate`), not the delivery default. Compare actual network bytes, time to scene assembly, first render submission and frame time; do not trade a significant download increase for a small assembly improvement.

`export-world.mjs --world-input <prepared-cache> --world-assets <assets/world>` publishes all regions, or `--world-regions deadlands,callahans` selects a subset. The prepared cache contains `viewer/dependency-bundles`, `viewer/recipe-rollout`, their referenced files, and `blobs`. `adopt-prepared.mjs` migrates an existing verified cache without extracting the game again. The CUE4Parse importer and audit projects are generation tools, never client dependencies.

Published files are immutable and shared by content hash. Only a selected region's dependency closure is loaded. Expanded recipe fallbacks and aliases are excluded. JSON/glTF dependencies are rewritten to static relative URLs during publication; production needs no prototype server, URL globals or fetch monkeypatch. Publish the index last. Retain old immutable files until deployment/rollback policy allows garbage collection.

Files under `world/content/br/**` require `Content-Encoding: br`; the Foxhole Nuxt layer configures this. Configure the same headers if hosting the assets elsewhere. The browser handles transport decompression; workers decode meshopt, textures and lossless geometry recipes. Recipe inputs have a persistent compressed Cache API cache. Model/image dependencies use the same explicit persistent cache and immutable HTTP caching. Cache API quota failure is nonfatal.

The runtime overlaps independent terrain, model, road and decal preparation. Cache reads, gzip decoding and integrity checks run in a dedicated worker; source buffers are transferred rather than copied back. Model loading has bounded concurrency and throttled progress updates. Verified rendered recipe outputs also use a separate, compressed browser-only cache capped at 1 GiB per origin. This cache never changes the asset bundle or texture/geometry quality; eviction and first-time population still require reconstruction. Independent canvas loads retain separate cancellation lifetimes.

A separate, compressed browser-only terrain pixel cache (1 GiB cap) reuses the exact jsquash-decoded RGBA bytes, including RGB beneath transparent alpha. Keys include encoded-source identity and decoder version. Bump that version if decoding changes. Finished bridge-clipped road groups and shoulder buffers also share the 1 GiB derived-geometry budget, keyed by immutable region manifest plus an assembly version. Bump the assembly version when clipping, shoulders or partitioning change. Corruption and storage-quota failures fall back to the original full-quality path. Initial cache population and evicted entries still cost reconstruction time; these are local caches and add no delivery assets.

Warm loads skip intermediate road-buffer decoding when a verified finished snapshot is available. Independent decals, effect textures and utility textures prepare before bridge seams; dependent road overlays retain native bridge cuts. First-frame static model material preparation is reused per exact geometry/material/view combination until postrender, with separate mutable pass caches for instances. Unused model color buffers are omitted only where materials disable vertex colors; positions, normals, UVs, indices, textures, placement counts and native LODs remain unchanged. WebGPU terrain arrays upload as they decode, while model textures retain normal lazy upload. Native sky filtering runs early on an open encoder with the same 512-pixel BRDF LUT, 256-pixel cube and 1,024 samples as the renderer, overlapping model assembly. The retained viewer keeps its empty view rendering during loading for the same preparation.

## Empty Foliage Containers

The importer omits instanced mesh components with no native instances. Older prepared caches can contain a standalone placement for these containers, typically at the region origin. Compact publication removes only records explicitly marked non-instanced whose actor and component identities identify a native foliage container; real instances and ordinary static meshes at the origin remain untouched. This cleanup runs without mesh or texture regeneration.

## Native Foliage Cutouts

After adopting an older prepared cache, pass `--world-native-textures <extracted-texture-root>` (or `FOXWATCH_WORLD_NATIVE_TEXTURES`) to `export-world.mjs`. This runs the idempotent `prepare-foliage-alpha.mjs` normalizer before publication. The texture root is the native extraction folder containing `Textures/Foliage`; no texture files are added to this source package.

The qualified `BirchBushSnow` and `BirchBushSmall` instances use Materiality blue for its cutout, while its DXT1 colour texture has no alpha. The normalizer copies the authored linear mask into a lossless RGBA colour image, preserves decoded RGB, UVs, samplers and geometry, and declares the native 0.333 cutoff. Solid materials sharing the original image remain unchanged. New immutable blobs and dependency references are shared by every affected region; old blobs remain available for rollback. Subsequent exports of the normalized cache need no extraction folder.

## Viewer

Run `npm run build:viewer --workspace @nixie/foxhole-world` in the Nixie host, which supplies the pinned Pixi 3D beta renderer. Set `FOXWATCH_WORLD_OUTPUT` to a published world directory and run `serve-viewer.mjs`. Open `/ab-built/viewer.html`. It uses the same compact loader as Nixie, with region selection, camera controls, projection and load/FPS diagnostics. `build:authoring` retains the detailed research/generation viewer separately. Neither renderer is required to publish compact prepared assets.

## Verification And Remaining Work

All 53 regions were published through FoxWatch from the existing verified prepared dataset. The reachable delivery union is 2,696,575,190 bytes (2.511 GiB), with 11,576 immutable resources. Deadlands is 650,305,285 bytes (620.18 MiB) before shared cache reuse. The transport fix renames Brotli payloads with legacy logical `.gz` names to `.bin`; bytes remain unchanged.

The compact Deadlands viewer loaded all 113,621 placements and native LODs without model or shader failures. A warm-cache framed run prepared in 40.2 seconds, submitted its first render in 45.4 seconds and downloaded zero map payload bytes. Those are local prototype observations, not production benchmarks. Nixie browser checks render Deadlands in 3D and 2.5D, retire it in flat mode, and render Farranac Coast with automatic region framing. Warm preparation was 61.6 seconds for Deadlands and 52.1 seconds for Farranac Coast, with zero map payload bytes downloaded. The first coast load after Deadlands downloaded 82.9 MiB. These are the pre-optimization baselines. The subsequent local Nixie WebGPU warm-cache checks prepared Deadlands in 24.8 seconds and Farranac Coast in 23.4 seconds, submitted the first frame at 28.5 and 26.6 seconds, and completed that GPU work at 29.7 and 27.9 seconds respectively. Both downloaded zero map payload bytes and returned no GPU validation error. Farranac Coast geometry and placement-slot counts matched the baseline; full road-partition outputs and randomized boundary/clipping checks matched the original algorithms exactly. The map asset index is unchanged. These remain machine-specific dev-build observations, not production benchmarks or cold-cache guarantees.

Native importer and audit projects compile. The old fresh-game Node preparation orchestration is not yet a fully migrated production command. `export-world` publishes prepared region and recipe output; it does not claim to regenerate that cache from PAKs. A complete FoxWatch refresh includes compact publication when `FOXWATCH_WORLD_INPUT` is configured; scoped catalog refreshes leave it alone.

The spatial WebGPU device requests up to 1 GiB buffer capacity when supported: the full Deadlands vertex atlas exceeds WebGPU's default 256 MiB cap. This requests a limit, not an allocation. Keep client decoding/reconstruction when it improves download/startup cost; do not default to expanded geometry.

`retireUnusedWorldContent` can explicitly quarantine superseded immutable files outside the served world directory after validating the complete index. Retain deployed versions until the deployment rollback policy permits retirement.

The verified compact inputs have been adopted into `tools/foxwatch/tmp/world-prepared`, using content-verified hard links on this machine. Re-export with `node tools/foxwatch/run-foxwatch.mjs export-world --world-input tools/foxwatch/tmp/world-prepared`. The publisher accepts region subsets without removing the rest of the index. This removes the prototype folder as a publication dependency without duplicating the immutable source bytes.

Assets release packaging includes the catalog model metadata and only the current world dependency closure. Large CI archives are split into checksummed 1 GiB parts plus an index, and Nixie reassembles and validates them before extraction. This changes CI transport only; client delivery remains individual on-demand immutable files. Legacy single-archive releases are still supported.

## Consistent Warm-Cache Checks (2026-10-19)

Local Nixie WebGPU checks retained the full asset payload and native quality. Repeated region loads completed their first GPU work in 26.3-28.8 seconds for Deadlands (including a return after Coast) and 18.7-23.0 seconds for Farranac Coast. A fresh page initially exposed a 36.0-second path; early native sky filtering fixed it. Three subsequent fresh-page Deadlands checks, timed from the actual Show Map click, completed at 28.8, 27.7 and 26.5 seconds. All hit the persistent pixel and finished-road caches, downloaded zero map payload bytes and completed without worker errors; GPU validation checks returned null. These are local machine observations with populated caches, not cold-download or all-device guarantees.

The first population of the new pixel cache took about 53 seconds in a local warm-input test. Missing or evicted derived data still has to be rebuilt. Local cache growth buys startup speed without larger downloads: texture pixels have a separate 1 GiB budget; finished roads and expanded recipes share a 1 GiB budget.

All 6,232 rendered Deadlands model geometries retained identical position, normal, UV and index hashes after omitting disabled color attributes. All 522 road geometries retained identical GPU attribute and index hashes through the finished-road cache. Full road/shoulder comparisons covered all 153 chunks and 4,387,800 triangles across Deadlands and Farranac Coast.

## Native Spawned Cranes

Prepared world recipes omit non-mesh crane spawn components. `authoring/native-crane-spawns.json` retains their native blueprint transforms from the same FoxWatch manifest that supplies catalog/2D scene generation. After a complete native manifest extraction, regenerate this table with `node tools/foxwatch/scripts/native-crane-spawns.mjs` from the repository root and review the diff. It reads the intermediate manifest and blueprint target index; it does not extract the game or regenerate region assets.

The compact runtime deduplicates component records by actor and places the catalog stationary crane at each native spawn, preserving actor rotation, scale and component yaw. Catalog GLBs retain spawn placeholders and reference a single content-addressed, posed crane. Its authored bone pose is baked once in that shared resource, rather than duplicated inside each building. Region instances reuse the catalog geometry/material source and retire independently when a region closes. Buildings and spawned cranes remain controlled by their existing category layers.

## Native Layout And Live War Selection

The shipped map stores alternative town layouts in `StructureLayerComponent.IncludedInLayers` and `ExcludedByLayers`, plus resource proxy candidates. Rendering all of them simultaneously creates overlapping buildings and excess oil rigs. `importer/PlacementRules.cs` preserves these masks and attached-actor ownership. Refresh the source metadata with `node tools/foxwatch/scripts/sync-world-placement-rules.mjs` (or `--only=westgate`); `FOXWATCH_PAK_PATH` overrides the local installed PAK directory. This reads map metadata and does not regenerate meshes, textures or compact recipes.

The compact runtime compares fixed native world-structure anchors with the same selected live/playback icon snapshot used by the map. It resolves layout masks, hides incompatible actors and their attached models/smoke/cranes, and enables offshore proxies only at matching API locations. If evidence is ambiguous, it retains actors common to the equally supported layouts instead of choosing an arbitrary layout. Missing war data hides unresolved alternatives/proxies until a snapshot arrives. These decisions update in place without downloading the region again. Icon display preferences do not control the required state subscription. Public war data is not a complete record of player-built or damaged scenery.

Native Y-up positions are `(Unreal X, Unreal Z, -Unreal Y) / 100`. A normalized War API point maps to native `(x * 2184 - 1092, 945 - y * 1890)` in X/Z. The board frame therefore maps native Z to negative board Y, including surface sampling, camera/LOD coordinates, excavation and shader conversions. Region instances use reversed index variants for that reflection while preserving cached source buffers. Three-dimensional icons and labels sample the corresponding terrain elevation; flat overlays keep their existing behavior.

## Native Water Mist

WaterMist is currently excluded from generic particle rendering. Its prepared recipe omits the native cylinder/axis-lock modules and animated CloudShapes material mask; drawing only ParticleAlpha creates bright circular sprites or dense white patches. Factory smoke and other supported particles remain enabled. The runtime reports these omissions as unsupportedParticleComponents. Re-enable WaterMist when its native material and particle modules are prepared together.

World image decoding premultiplies ImageBitmap colors for upload-premultiplied textures at decode time, since WebGL ignores its unpack premultiplication flag for ImageBitmap. Data maps retain straight channels. The water-mist browser fixture checks a 25%-alpha swatch numerically on both backends.

## Catalog Resource Fields

Compact maps omit the generic ScrapField01 resource-field proxy meshes. Candidate actor transforms come from the native map; the matching active war/playback icon (20/21/23/61) selects salvagefield/componentsfield/sulfurfield/coalfield from the existing catalog. Matching uses the same normalized native coordinates as layout selection, within two metres, and assigns each icon only once. Unmatched candidates stay hidden. Catalog source geometry/materials are shared, blueprint offsets are restored, and instances are batched per field type. Snapshot changes update active batch slots without a region reload. The Structures layer controls these fields. Resource mines and offshore rigs now use the catalog policy described below.

## Shared Catalog World Models

The compact runtime and publisher use unambiguous native blueprint matches in authoring/native-catalog-bindings.json. Regenerate this table with node tools/foxwatch/scripts/native-catalog-bindings.mjs after a catalog refresh. It checks source GLBs and excludes skinning, animation and runtime assembly selectors; bridges, splines, rivers and infrastructure retain their native geometry.

Matched actors retain native transforms, terrain elevation and layout/ownership metadata, while their meshes, materials, posed cranes and other shared parts come from the existing catalog. Resource mine proxies select sulfurmine/scrapmine/componentmine from icons 32/38/40. Offshore proxies select facilitymineoilrig at icon 75. Proxy Area slabs and inactive mesh alternatives are omitted. Catalog assets are batched by category and model and remain governed by the existing map layer controls.

Compact publication replaces covered prototypes with actor metadata and catalog bindings, prunes their unused LOD/night resources and private render dependencies, and records external catalog resources separately. Shared map textures and inputs referenced by geometry recipes remain in the map closure. Old immutable files can remain on disk for rollback; release archives use the current reachable closure. No catalog GLB is copied into the world content directory.

## Catalog Material Export

The spatial Blender export flattens the authored masked ColorShift graph into an albedo image before glTF image discovery. The calculation uses linear RGB, preserves the original albedo alpha and texture UV transform, and keeps normal/roughness/metallic textures separate. This prevents glTF from selecting the packed material mask as the visible color texture. Flat render source materials and images stay unchanged. Existing affected GLBs require a normal scoped spatial export; repacking an old GLB cannot repair its shader binding. The Blender material regression compares the authored shader with the flattened image and checks exported PNG pixels.

After a scoped catalog refresh, `node packages/foxhole-world/catalog-references.mjs <published-world-directory>` updates only the external catalog receipts and byte totals in region manifests. It verifies existing manifest integrity, retains all map payloads and rollback manifests, and publishes the updated index last. A full world publication uses the same catalog reference builder.

## Multiple Selected Regions

Every explicitly selected region loads in 2.5D/3D, without a region-count cap. Up to two regions prepare concurrently to overlap network/cache reads and independent preparation. Shared terrain array decoding remains limited to two jobs, and texture quality replacements remain serialized under their existing byte budget; already loaded and progressively revealed regions remain visible. Adding or removing selections retains unchanged regions, cancels retired preparation, and queues the remaining selection. Retired preparations drain before queued work starts a new lifetime, so cancellation cannot create extra overlapping allocations. Concurrent regions share one controller-owned index request; cancelling one region does not cancel metadata needed by another. Flat mode or no explicit selection retires the spatial regions.

Each region keeps its native board frame, live war state, LOD camera, terrain sampling and excavation masks. Region-specific terrain/road passes coexist, while fullscreen surface decal and ambient-occlusion passes run once per view. Adjacent attached regions hide their shared border walls; exterior walls and floors retain the Terrain layer preference. The panel reports aggregate completion and failures, and an unavailable region does not evict ready neighbors. Selection retains region height data and enabled assets. Display terrain geometry now refines and releases detail with camera distance; other world categories retain their existing residency policy. Terrain textures have the separate budget described below.

## Loading Enabled Layers

The War map loads only enabled 3D layer groups and their required dependencies. Terrain and Water do not start native world model, catalog, road, decal, puddle or particle loads. Common region metadata, height sampling and lighting remain available. Enabling another group queues its assets in the existing region without reloading terrain or resetting the camera. Disabling a group stops queued work and aborts further assembly; an already-running shared asset request may finish into the cache. Completed groups stay hidden and reusable until the region is deselected or the scene is disposed; this is not a distance-based memory eviction system.

Transport and Surface Detail need bridge surface geometry for road/decal seam clipping. That dependency loads only bridge prototypes, with no placement batches or LODs, rather than enabling other world categories. Standalone spawned cranes follow Props; shared parts of catalog buildings follow their catalog owner. The loader exposes per-task request/loading/ready/error state in `metrics.layers` and `whenLayersReady()` for verification. Decoder workers stop after preparation and restart when a newly requested group needs them.

## Progressive Region Loading

The War map's Region View includes a device-local **Progressive Loading** preference, off by default. Changing it retires the current region and reloads it through the existing caches without changing the camera or scene content. The disabled path retains complete-region attachment and category-wide batches.

When enabled, `loadCompactRegion` calls `onSceneReady` with the live region handle after native terrain geometry and its environment are ready. A bounded loading-only mesh samples the existing terrain height query on a grid of at most 128 cells across the region, with the native hex clip and a plain material. The exact ground sampler remains available while native geometry and textures load. Full native terrain stays in its direct render pass; it must not be placed in the mesh atlas as a temporary preview. Packing native previews grew the shared atlas into gigabyte arrays and threw an allocation error during a twelve-region load, stopping the animation loop even though asset preparation completed. The same scene handle receives finished materials and assets; the load promise resolves only when all stages finish. `firstVisibleMs` measures preview preparation/attachment readiness, while `readyMs` remains full preparation time.

Native prototype sources are prioritized by distance from the initial camera. Completed native and shared-catalog parts reveal through a cooperative 4 ms work queue with at most 512 slots per batch. Distant native placements use their resident coarse LOD while loading, then return to the regular distance controller. Existing catalog resources remain shared. War/layout masks and layer preferences apply before each reveal; road/detail stages retain bridge dependencies and stable draw ordering. The queue bounds reveal work, not every source decode or GPU shader compilation.

A partial scene is an owned loading resource. Retirement aborts pending work and detaches its root/passes immediately; destruction of shared stage resources waits for asynchronous siblings to drain. A late completion cannot attach to a different selection. Full load errors remove the partial view and restore the previous environment.

A local Nevish Line browser run showed terrain preparation at 1.3 seconds and full preparation at 15.9 seconds. This is one local observation, not a cold-cache, throughput, or all-device guarantee. Progressive rendering can trade some total preparation throughput for earlier interaction, which is why it remains optional.

## Adaptive Terrain Textures

Compact terrain starts with 128-pixel material arrays. Camera coverage selects higher power-of-two tiers through the native resolution, using the nearest point of the region bounds and a conservative texel margin. Upgrades wait 180 ms and downgrades 900 ms to avoid rebuilding on every camera movement. A complete replacement binds atomically; failed or retired upgrades retain the old rendered set or release their pending resources. The authoring loader without compact descriptors retains its native texture path.

Identical ordered arrays share reference-counted image sources within a renderer. The pool reserves at most 2 GiB, including mip chains and in-flight replacements, and falls back to a lower tier when needed. This is a terrain-array budget, not a measurement or cap on total GPU use: geometry, water, lighting, auxiliary noise/snow textures and other enabled layers are additional. No region-count limit is imposed.

Decoding and reduction run in a worker with two array jobs at a time. Colour filtering averages linear light; normal vectors are renormalized. Distant region blend masks are capped at 512 pixels (1024 at the 512 material tier); closer views use native masks. Shader coordinates and layer transforms retain the original dimensions. Derived material pixels use versioned local cache keys separate from native decoded pixels. Source and published assets remain unchanged. First-time reductions still fetch and decode the original encoded images; smaller delivery downloads require publishing a precomputed mip/tile pyramid. This currently adapts whole-region material arrays rather than streaming spatial texture tiles.

## Terrain Surface Comparison

The War map's Terrain Surface preference selects Detailed (default), Map or Plain. It is stored on the device. Changing it retires and reloads selected regions, retaining the camera and layer preferences. The selector is available with the 3D layer controls before showing the map.

All modes use the same adaptive terrain geometry directly, retain lighting, depth, hex clipping, excavation and exact ground sampling, and leave Water independent. Plain uses a constant colour and requests no terrain material images. Map projects the existing north-up processed `map/terrain.webp` onto the native relief, with one colour sample and no detailed arrays, blend masks or native terrain weather textures. Detailed retains the adaptive native layered material. A terrain-only baked colour image could use this same projection; this change does not generate or publish new bakes. Map detail is limited by the existing region image resolution.


## Adaptive Terrain Geometry

Compact regions initially draw source landscape components at a 32-sample step, without reconstructing the full `terrain-lod1.glb` recipe or allocating terrain UV buffers. Source components are grouped by their centres on a 256-metre chunk grid. Projected native cell size selects steps 32, 16, 8, 4, 2 or 1 independently for each visible chunk, using perspective distance to exact component bounds or orthographic pixel scale. Step 1 reproduces the original position, normal and triangle topology. Component transforms, overlaps and the last row/column remain intact. Coarser levels add downward edge skirts to conceal gaps against neighboring detail levels; the existing shader still clips to the playable hex and building excavation volumes.

Refinements wait 200 ms and coarsening waits 800 ms. Builds are serialized, yield cooperatively after approximately 4 ms of component work, and cancel when the camera changes to another tier or the region retires. A complete replacement binds atomically. A region retains one coarse base, index-only chunk views that share its vertex buffers, and at most one active finer geometry per refined chunk; replaced finer geometries release their CPU/GPU buffers. A fully visible all-coarse region stays one draw. Partial views draw only chunks accepted by the render camera frustum, transformed into native coordinates; an entirely off-screen region submits no terrain geometry. Failed refinements retain the previous visible geometry and retry after ten seconds. Hiding Terrain returns its display geometry to the coarse base. Region metrics expose `terrainGeometry` with active step, triangles, bytes, pending state and errors.

Ground placement continues querying the original source landscape triangles at full precision, independently of visual LOD. Excavation ceilings use original height metadata, so coarse silhouettes cannot change cutout bounds. Surface modes and geometry quality are independent.

All regions in one renderer share a 256 MiB terrain geometry allocation target. It counts the coarse base, duplicate index views, active detail and pending replacement buffers. Nearer visible chunks take priority; lower-priority detail is evicted first and rejected requests fall back through coarser levels. Reservations precede typed-array construction, and both old and new detail count during a replacement. Jobs are prioritized, serialized and cooperatively yielding. Hiding terrain or looking away releases fine chunks after the downgrade delay.

Required coarse relief is never removed to enforce a byte target. If uncapped region selection makes coarse geometry alone exceed the target, `coarseOverBudget` is reported and new fine allocations stop; regions remain visible. This is allocation accounting, not a total VRAM or application-memory limit. Exact height data, textures, lighting, model geometry and driver allocations are outside this pool. Full source height positions remain resident for exact queries. No exported assets or region-count caps are introduced.

A local WebGPU run with 53 selected regions in Plain mode improved the fixed whole-world overview from 3.6 to 60 FPS: submitted terrain triangles fell from 357,106,806 to 1,079,688, and Pixi-managed application GPU buffer capacity fell from 8.21 GiB to 128.8 MiB. A close view restored native step-1 geometry in the nearby region and remained at 60 FPS. These are local steady-state frame observations, not cold-cache, hardware timestamp or all-device guarantees; Detailed materials and other enabled world categories have separate costs.


The follow-up chunked run kept the same 53-region Plain overview at 60 FPS. At the same close camera, submitted terrain fell from 43,179,960 to 3,641,240 triangles and Pixi-managed GPU buffers fell from 1,190.86 to 219.54 MiB. Facing away submitted zero terrain draws and released all fine reservations. Unit coverage additionally forces allocation pressure across multiple region owners; this measured browser view did not exhaust the shared budget. Steady-state frame results do not establish the absence of transition hitches or performance with Detailed materials and all world layers enabled.

## Native Particle Emission

`authoring/native-particle-modules.json` preserves native Cascade spawn shapes,
axis constraints, location-generated velocity, drag, rotation, orbit and finite
loop/duration/burst metadata. Regenerate it from `EffectsProbe` metadata with:

```sh
node packages/foxhole-world/tools/prepare-native-particles.mjs <particle-systems.json> packages/foxhole-world/authoring/native-particle-modules.json
```

The input can also be a directory containing one native export-array JSON per
system. This updates metadata only; it does not duplicate models or textures.
The runtime supplements existing immutable region recipes, so these corrections
do not require rebaking every map.

Sphere/cylinder launches and velocity retain native centimetres and axes until
the component and region transforms are applied. Continuous ambient emitters
use rate-based, prewarmed shader clocks: capacity bounds the lifetime window,
while dead slots remain clipped until their next emission. Uniform spawn-rate
distributions use their mean for the settled ambient approximation. Per-slot
samples repeat deterministically, rather than running a CPU particle simulation.
Native drag, billboard spin and single-module orbit motion run in shaders.

Finite emitters are excluded from persistent map scenery until an appropriate
game event can trigger them. Their native loop, delay, duration and burst data
remain available for that future path. WaterMist remains excluded because its
native material mask is incomplete. Other unsupported dynamic-material or
orientation modules are counted as approximations; this does not claim full
Cascade material/blueprint-state parity.

Effects follow their owning actor's layer, including attached actors. Native
waterfalls and splashes belong to Water, and standalone natural ambient effects
belong to Nature. Effect demand is independent for each enabled owner layer;
Water-only effects do not load model metadata, and other effects reuse the
region's existing metadata without loading its model geometry. All effect groups
share one immutable region effect document.


### Unsupported Particle Materials

Prepared SmallParticles masks (including Dustmotes and aliases) and native
WaterSplashes/WaterfallSplash material approximations are excluded before
texture loading and GPU allocation. Their single exported masks cannot reproduce
the native diffuse/lighting or animated water graph. The earlier volume support
spread these inaccurate sprites into conspicuous bright swarms; module extraction
coverage alone did not establish visual fidelity. Source recipes remain intact.
Chimney smoke and steam remain available. WaterMist's existing exclusion remains.
The details summary reports unsupportedMaterialParticleComponents separately.

Legacy published `BirchBushSmall` models also restore the exact qualified native cutout before decoding. Regenerate its immutable compatibility texture with `node tools/foxwatch/scripts/publish-world-foliage-mask.mjs --input <focused-material-textures-export>`; export `BirchBushThinA` and `BirchBranchThinM` first. The texture stays in the asset repository. Normalized models retain their own opacity metadata and need no override.

### Vegetation Wind

Native upright Nature and Trees placements use a shared vertex shader for gentle wind bending. Roots remain anchored, tree trunks bend less than small plants, and a shared pair of 40 m / 17 m gust bands travels downwind at 5 m/s. Gusts sample world-space plant anchors, so nearby plants respond to the same passing front independently of camera position, instance rotation or model LOD. Scene wind controls travel direction and bending strength; calm wind and the live Vegetation Wind overflow toggle restore the rest pose. Dead/fallen timber, rocks and buildings stay rigid. Material leases preserve native colours, cutouts, textures and geometry, reuse the same wind variant for model LOD, and retire with their last streamed cell. This is bounded visual deformation, not a reconstruction of Unreal wind painting or physical collision motion.

The browser fixture `tests/browser/vegetation-wind.mjs` loads a real native bush and compares rendered frames on both backends, with shadows enabled: animated frames must differ, while disabled frames remain identical. It also disables leaf flutter and shadows to isolate the gust field, then checks that moving plants and camera downwind by 10 m after 2 s reproduces the same rendered pose, in both wind directions. Resident regions receive one shared monotonic wind clock; standalone callers can supply the existing update time in seconds to synchronize independently loaded regions.

The private view-scoped depth adapter uses the same wind transform and current material-store rows for shadow casters, so visible foliage and shadows follow the same gusts. Rigid casters retain the stock depth path. Compact-region callers attach it with prepareWindShadows(view); both Nixie and the standalone world viewer do this. It borrows the renderer-owned store without changing shared geometry, patches no global prototypes or dependency files, and prepares replacement passes after graph rebuilds. The browser fixture isolates shadow-only foliage over a ground receiver: wind must change the shadows, while disabled and calm wind must leave them visually unchanged (one 8-bit color step of raster roundoff is tolerated). It also checks the real reflected Z-up board frame, draw-command reuse, graph rebuilds, and resource unload/reload.

### Water Depth

Water uses parallel camera rays in orthographic views, including the reflected Z-up board frame, so zooming out does not reduce optical depth and reveal the seabed. Perspective views retain position-based rays. Water composites its own transmission with alpha 1 and writes surface depth after the opaque scene copy, so later ambient occlusion cannot shade submerged cliffs through it.

The browser fixture `tests/browser/water-depth.mjs` checks close and wide orthographic views, at the centre and off-centre, on WebGL and WebGPU with native and host frames. It checks physical versus optical depth, parallel view direction, and actual water colour over white/black seabeds: an 8 m bed must be obscured while a 25 cm shallow remains visible.
The same fixture isolates AO over solid-colour water: raising a submerged cliff must affect the old non-writing depth path, and change zero pixels with water surface depth enabled, in both projections. Graph rebuild and unload/reload are also exercised. The view-scoped adapter only changes the pinned beta refraction pass depth attachment declaration; the opaque colour/depth copies used for refraction remain separate and unchanged.

### Faction Flags and Surface Decals

World views draw masked faction cloth once after projected surface decals and before water and airborne transparency. This keeps wall moss and leaks off hanging flags while retaining cloth cutouts, foreground occlusion and shadow membership. Compact regions and the authoring viewer enable this automatically; standalone catalog/native model callers can opt in with `flagSurfacePass: true` when their view includes `SurfaceDecalPass`. Callers without the pass retain ordinary opaque flags.

The browser fixture `tests/browser/faction-flag-decals.mjs` compares a decal-covered flag with the corrected phase on WebGL and WebGPU, in native and reflected host frames. It checks solid cloth, an alpha cutout, the adjacent wall and foreground occlusion, then repeats after graph rebuild and resource unload/reload.

### Smoke Compositing

Native smokestack sprites retain view-depth sorting, and the Smoke/Steam variants retain their authored oldest-first order. Small smoke uses view-distance order. Each emitter owns a small dynamic index buffer; sort keys follow the same ballistic drag, gravity, particle age and scene wind as the shader. Spawn attributes and shared quad buffers stay immutable, and unchanged order does not upload again. Camera-facing billboards retain their live indices through the reflected board frame. The standalone viewer supplies its camera direction as well.

The rendered `tests/browser/smoke-compositing.mjs` fixture exposes the original incorrect dark/pale overlap, reverses the camera, moves particles across depth, and checks graph rebuild and unload/reload on WebGL and WebGPU in both native and board frames. The native dark-to-light colour, opacity curves, rate and lifetime remain intact. This corrects ordering; the prepared single sprite still approximates the native animated CloudShapes material rather than reconstructing its complete Unreal graph.

### Animated Smoke Masks and Outlets

SmokeStacks now combines its prepared ParticleAlpha sprite with two moving samples of the native CloudShapes alpha channel and deterministic per-particle offsets. The shared immutable texture lives in the asset repository; regenerate it with `node tools/foxwatch/scripts/publish-world-smoke.mjs --clouds <native-CloudShapes.png>`. Compact regions load it only when an enabled effect uses SmokeStacks. Standalone detail callers can pass an async `smokeCloudTexture` loader; without one they retain the existing sprite path. Native material arithmetic and panner rates are stripped from the cooked export, so the two bounded panners approximate that motion rather than claim exact Unreal graph parity.

SmokeStacks coverage is reduced to 32 percent; other native smoke/steam/dust coverage is reduced to 72 percent after authored material opacity and lifetime curves. The darkest SmokeStacks puffs retain 12 percent of that coverage, blending back to full coverage for light smoke so overlapping young particles do not form a black core. RGB, particle counts, sizes, velocities and lifetimes are unchanged; flame and spark coverage is independent. IndustrialChimneyFurnace01/02 origins are aligned to centres measured from their mesh top-ring vertices; a world-space lip plane prevents the expanding billboards from bleeding down the chimney wall. Unknown meshes retain their exported origins.

The `tests/browser/smoke-mask.mjs` fixture checks actual native texture animation with stationary particles, stable output at fixed time, a static-mask control, lip clipping, graph rebuild and unload/reload on both renderers and in the reflected board frame. The smoke compositing fixture retains overlap ordering coverage at the adjusted opacity.
