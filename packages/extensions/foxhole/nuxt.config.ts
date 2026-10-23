import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'node:fs';
import { withoutLocalAssetPublicDirectory } from './asset-public-directory.ts';

const currentDir = dirname(fileURLToPath(import.meta.url));

// Build-time only (not runtimeConfig). Prefer FOXHOLE_BUILD_* so it is not confused with NUXT_* droplet env.
const enableScheduledTasks = process.env.FOXHOLE_BUILD_SCHEDULED_TASKS === 'true';

function readBooleanEnv(value: string | undefined, fallback = false): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

const configuredHostRoot = process.env.NIXIE_HOST_ROOT || process.env.INIT_CWD;
const nixieLayerDir = configuredHostRoot && existsSync(join(configuredHostRoot, 'packages/nixie'))
  ? join(configuredHostRoot, 'packages/nixie')
  : join(currentDir, '../../../../nixie/packages/nixie');

export default defineNuxtConfig({
  $meta: {
    name: 'foxhole',
  },
  css: [join(currentDir, './app/assets/css/host-compat.css')],
  // Nuxt's builder and Nitro watchers must also ignore generated asset writes.
  // The Nitro hook below separately excludes bulk assets from static output.
  ignore: ['public/foxhole/assets/**'],
  // Do not set global app.head brand tags here — they would pollute Studio hosts.
  runtimeConfig: {
    foxholeRealtimeAutostartEnabled: readBooleanEnv(
      process.env.NUXT_FOXHOLE_REALTIME_AUTOSTART_ENABLED,
      false,
    ),
    foxholePlaybackDbLoggingEnabled: readBooleanEnv(
      process.env.NUXT_FOXHOLE_PLAYBACK_DB_LOGGING_ENABLED,
      true,
    ),
    public: {
      legacyBlueprintDiscoveryEnabled: true,
      legacyBlueprintCopyEnabled: true,
      legacyBlueprintLibraryEnabled: true,
      legacyBlueprintInsertEnabled: true,
      foxholeRealtimeLocalEnabled: readBooleanEnv(
        process.env.NUXT_PUBLIC_FOXHOLE_REALTIME_LOCAL_ENABLED,
        true,
      ),
      foxholeRealtimeFallbackOrigin: process.env.NUXT_PUBLIC_FOXHOLE_REALTIME_FALLBACK_ORIGIN ?? 'https://foxholeplanner.com',
      foxholePlaybackApiEnabled: readBooleanEnv(
        process.env.NUXT_PUBLIC_FOXHOLE_PLAYBACK_API_ENABLED,
        true,
      ),
    },
  },
  alias: {
    '#nixie-internal': nixieLayerDir,
    '#foxhole': join(currentDir, './app'),
    '#foxhole-planner-assets': join(currentDir, '../../../extensions/foxhole-planner/src'),
    '#foxhole-server': join(currentDir, './server'),
  },
  hooks: {
    'nitro:config'(config) {
      config.publicAssets = withoutLocalAssetPublicDirectory(config.publicAssets ?? [], join(currentDir, 'public'));
    },
  },
  routeRules: {
    '/foxhole/assets/world/content/br/**': { headers: { 'Content-Encoding': 'br', 'Cache-Control': 'public, max-age=31536000, immutable' } },
    '/foxhole/assets/world/content/raw/**': { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
  },
  // Linked world workers are URL-loaded; Vite cannot infer their package from imports.
  vite: {
    server: {
      watch: {
        // FoxWatch rewrites generated manifests during exports. Keep serving
        // build inputs, but do not restart loaded regions for every asset write.
        ignored: [/[/\\]public[/\\]foxhole[/\\]assets(?:[/\\]|$)/],
      },
      fs: {
        allow: [join(nixieLayerDir, '../..'), currentDir, join(currentDir, '../../foxhole-world')],
      },
    },
  },
  nitro: {
    tasks: {
      'nixie:blueprints:moderate': {
        handler: join(currentDir, './tasks/blueprints/moderate.ts'),
        description: 'Moderate legacy blueprint text and images in the configured queue order.',
      },
      'foxhole:playback:purge': {
        handler: join(currentDir, './tasks/playback/purge.ts'),
        description: 'Purge expired Foxhole playback frames, checkpoints, and war events.',
      },
    },
    scheduledTasks: {
      ...(enableScheduledTasks ? { '0 8 * * *': 'foxhole:playback:purge' } : {}),
      ...(process.env.NIXIE_BUILD_SCHEDULED_TASKS === 'true' ? { '*/10 * * * *': 'nixie:blueprints:moderate' } : {}),
    },
  },
  icon: {
    clientBundle: {
      scan: {
        globInclude: [
          join(currentDir, './app/**/*.{vue,ts,tsx,jsx,md,mdc,mdx}'),
          join(nixieLayerDir, './app/**/*.{vue,ts,tsx,jsx,md,mdc,mdx}'),
        ],
      },
    },
  },
});
