import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'node:fs';

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
    '#foxhole-server': join(currentDir, './server'),
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
