# Publishing Planner

The SDK extension is published independently of Nixie Studio. Studio's private
Foxhole server APIs and compatibility adapters still ship with Studio; publishing
an extension does not deploy or replace them.

## First Release

Before enabling the workflow:

1. Distribute `@nixiejs/extension-sdk` and `@nixiejs/extension-package` at the exact
   versions declared in `package.json`. Both are standalone npm packages; the
   publisher is the package tool's `nixie-extension publish` command. No access to
   the private Nixie repository is required by this workflow.
2. Ensure the registry migrations and publishing broker exist in the target
   Supabase project. If the broker is not deployed yet, run the new Nixie server
   locally against that project for the first publication. Studio's cutover
   deployment requires a compatible published package before it can proceed.
3. Provision a publisher grant for `nixie.foxhole-planner` from
   `jimdcunningham/nixie-foxhole`, then create a scoped `nxp_` automation token.
4. Store that token as the repository secret `NIXIE_EXTENSION_PUBLISH_TOKEN`.
   Do not provide a Supabase service-role key or a private Nixie repository token.
5. Publish and verify the asset release referenced by `src/asset-release-pin.json`.

## Release Changes

Bump the extension's semantic version in both `package.json` and
`nixie.extension.json` for each changed release. Set `engines.nixie` to the Studio
versions that actually support this runtime and its remaining private adapters.
Keep the range narrow while those contracts are evolving; a private adapter change
must advance the Studio version before a new extension can depend on it.

Pushing relevant changes to `main`, or dispatching **Publish Planner SDK Extension**,
builds an isolated consumer, verifies it, packages the generated runtime manifest,
and publishes the exact `.nxext`. Equal version/hash retries are idempotent; reusing
a version with different bytes fails. Publication never deploys Studio or changes
its private integration source pin. Nixie chooses the newest stable compatible
release when a user installs or updates; an open editor keeps its accepted runtime.

For local packaging after installing the exact tooling dependencies and preparing
the pinned build metadata:

```sh
npm run typecheck
npm test
npm run build
npm run pack
# Requires the scoped token and source repository/commit environment variables:
npm run publish:extension
```

The production asset library remains remote and pinned. Maps and models are not
copied into the published package merely to make them available to Studio.
