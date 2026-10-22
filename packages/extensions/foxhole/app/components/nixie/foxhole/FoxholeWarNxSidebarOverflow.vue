<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import NixieSidebarHeadingOverflow from '#nixie/components/nixie/NixieSidebarHeadingOverflow.vue';
import type { ResolvedMenuItem } from '#nixie/plugins/nixie/registry/menu-resolver.ts';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { FOXHOLE_MAP_SETTING_KEYS, readFoxholeMapSettings } from '#foxhole/plugins/foxhole/nixie/map-settings.ts';

import { useNixieEditorDocumentSessionOptional } from '#nixie/composables/useNixieEditorDocumentSession.ts';
import { FOXHOLE_USE_SDK_MAP_SETTING_ID } from '#foxhole/plugins/foxhole/nixie/scene-map-renderer-setting.ts';

interface FoxholeShardOption {
    id: string;
    name: string;
    default: boolean;
}

const emit = defineEmits<{
    'close-sidebar': [];
}>();

const runtime = useNixieRuntime();
const documentSession = useNixieEditorDocumentSessionOptional();
const settingsStore = useNixieSettingsStore();
const shards = ref<FoxholeShardOption[]>([]);
const mapSettings = computed(() => readFoxholeMapSettings(
    runtime.projectStore.settings,
    settingId => settingsStore.getValueOr(settingId, ''),
));
const notificationsEnabled = computed(() => Boolean(mapSettings.value.eventFeedToasts));

const items = computed<ResolvedMenuItem[]>(() => [
    {
        type: 'checkbox', label: 'Colored Map Icons', icon: 'ph:palette',
        description: 'Use the classic planner colors for resource fields, mines, and wells.',
        checked: mapSettings.value.coloredIcons, closeOnClick: false,
        adminOnly: false, disabled: false, visible: true,
        onClick: () => settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.coloredIcons, !mapSettings.value.coloredIcons, { reason: 'foxhole-war-nx:colored-icons' }),
    },
    {
        type: 'checkbox',
        label: 'Adaptive Streaming',
        icon: 'ph:arrows-clockwise',
        checked: mapSettings.value.adaptiveStreaming,
        closeOnClick: false,
        adminOnly: false,
        disabled: false,
        visible: true,
        onClick: () => settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.adaptiveStreaming, !mapSettings.value.adaptiveStreaming, { reason: 'foxhole-war-nx:adaptive-streaming' }),
    },
    {
        type: 'checkbox',
        label: 'Model LOD',
        icon: 'ph:cube',
        checked: mapSettings.value.modelLod,
        closeOnClick: false,
        adminOnly: false,
        disabled: false,
        visible: true,
        onClick: () => settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.modelLod, !mapSettings.value.modelLod, { reason: 'foxhole-war-nx:model-lod' }),
    },
    {
        type: 'submenu', label: 'Terrain Surface', icon: 'ph:mountains',
        badge: { plain: 'Plain', map: 'Map', native: 'Detailed' }[mapSettings.value.terrainSurface],
        adminOnly: false, disabled: false, visible: true,
        children: ([['plain', 'Plain'], ['map', 'Map'], ['native', 'Detailed']] as const).map(([value, label]) => ({
            type: 'checkbox', label, checked: mapSettings.value.terrainSurface === value,
            closeOnClick: false, adminOnly: false, disabled: false, visible: true,
            onClick: () => { if (mapSettings.value.terrainSurface !== value) settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.terrainSurface, value, { reason: 'foxhole-war-nx:terrain-surface' }); },
        })),
    },
    {
        type: 'checkbox',
        label: 'Terrain LOD',
        icon: 'ph:mountains',
        checked: mapSettings.value.terrainLod,
        closeOnClick: false,
        adminOnly: false,
        disabled: false,
        visible: true,
        onClick: () => settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.terrainLod, !mapSettings.value.terrainLod, { reason: 'foxhole-war-nx:terrain-lod' }),
    },
    {
        type: 'checkbox',
        label: 'Adaptive Terrain Textures',
        icon: 'ph:image',
        checked: mapSettings.value.adaptiveTextures,
        closeOnClick: false,
        adminOnly: false,
        disabled: false,
        visible: true,
        onClick: () => settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.adaptiveTextures, !mapSettings.value.adaptiveTextures, { reason: 'foxhole-war-nx:adaptive-textures' }),
    },
    {
        type: 'checkbox',
        label: 'Frustum Culling',
        icon: 'ph:bounding-box',
        checked: mapSettings.value.frustumCulling,
        closeOnClick: false,
        adminOnly: false,
        disabled: false,
        visible: true,
        onClick: () => settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.frustumCulling, !mapSettings.value.frustumCulling, { reason: 'foxhole-war-nx:frustum-culling' }),
    },
    {
        type: 'checkbox', label: 'Ambient Occlusion', icon: 'ph:circle-half-tilt',
        checked: mapSettings.value.ambientOcclusion, closeOnClick: false,
        adminOnly: false, disabled: false, visible: true,
        onClick: () => settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.ambientOcclusion, !mapSettings.value.ambientOcclusion, { reason: 'foxhole-war-nx:ambient-occlusion' }),
    },
    {
        type: 'checkbox', label: 'Water Reflections', icon: 'ph:drop',
        checked: mapSettings.value.waterReflections, closeOnClick: false,
        adminOnly: false, disabled: false, visible: true,
        onClick: () => settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.waterReflections, !mapSettings.value.waterReflections, { reason: 'foxhole-war-nx:water-reflections' }),
    },
    {
        type: 'checkbox', label: 'Vegetation Wind', icon: 'ph:wind',
        checked: mapSettings.value.vegetationWind, closeOnClick: false,
        adminOnly: false, disabled: false, visible: true,
        onClick: () => settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.vegetationWind, !mapSettings.value.vegetationWind, { reason: 'foxhole-war-nx:vegetation-wind' }),
    },
    {
        type: 'checkbox', label: 'Vegetation Shadows', icon: 'ph:tree',
        checked: mapSettings.value.vegetationShadows, closeOnClick: false,
        adminOnly: false, disabled: false, visible: true,
        onClick: () => settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.vegetationShadows, !mapSettings.value.vegetationShadows, { reason: 'foxhole-war-nx:vegetation-shadows' }),
    },
    {
        type: 'checkbox', label: 'Soft Shadows', icon: 'ph:sun-dim',
        checked: mapSettings.value.softShadows, closeOnClick: false,
        adminOnly: false, disabled: false, visible: true,
        onClick: () => settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.softShadows, !mapSettings.value.softShadows, { reason: 'foxhole-war-nx:soft-shadows' }),
    },
    {
        type: 'submenu', label: 'Shadow Strength', icon: 'ph:circle-half-tilt',
        badge: { light: 'Light', medium: 'Medium', strong: 'Strong' }[mapSettings.value.shadowStrength],
        adminOnly: false, disabled: false, visible: true,
        children: ([['light', 'Light'], ['medium', 'Medium'], ['strong', 'Strong']] as const).map(([value, label]) => ({
            type: 'checkbox', label, checked: mapSettings.value.shadowStrength === value,
            closeOnClick: false, adminOnly: false, disabled: false, visible: true,
            onClick: () => settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.shadowStrength, value, { reason: 'foxhole-war-nx:shadow-strength' }),
        })),
    },
    {
        type: 'submenu', label: 'Vegetation', icon: 'ph:plant',
        badge: { full: 'Full', reduced: 'Reduced', minimal: 'Minimal' }[mapSettings.value.vegetationDensity],
        adminOnly: false, disabled: false, visible: true,
        children: ([['full', 'Full', 'ph:tree', 'Keep all small foliage.'], ['reduced', 'Reduced', 'ph:plant', 'Keep about half of small foliage.'], ['minimal', 'Minimal', 'ph:leaf', 'Keep about 15 percent of small foliage.']] as const).map(([value, label, icon, description]) => ({
            type: 'checkbox', label, icon, description, checked: mapSettings.value.vegetationDensity === value,
            closeOnClick: false, adminOnly: false, disabled: false, visible: true,
            onClick: () => { if (mapSettings.value.vegetationDensity !== value) settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.vegetationDensity, value, { reason: 'foxhole-war-nx:vegetation-density' }); },
        })),
    },
    {
        type: 'submenu', label: 'Shadow Quality', icon: 'ph:sun-dim',
        badge: { off: 'Off', low: 'Low', medium: 'Medium', high: 'High' }[mapSettings.value.shadowQuality],
        adminOnly: false, disabled: false, visible: true,
        children: ([['off', 'Off', 'ph:prohibit', 'Keep lighting; skip cast shadows.'], ['low', 'Low', 'ph:sun-dim', '512 px maps and simple filtering.'], ['medium', 'Medium', 'ph:sun', '1024 px shadow maps.'], ['high', 'High', 'ph:sun-horizon', '2048 px shadow maps.']] as const).map(([value, label, icon, description]) => ({
            type: 'checkbox', label, icon, description, checked: mapSettings.value.shadowQuality === value,
            closeOnClick: false, adminOnly: false, disabled: false, visible: true,
            onClick: () => { if (mapSettings.value.shadowQuality !== value) settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.shadowQuality, value, { reason: 'foxhole-war-nx:shadow-quality' }); },
        })),
    },
    {
        type: 'checkbox',
        label: 'Use SDK Map',
        accessibleInDev: true,
        icon: 'ph:code',
        checked: settingsStore.getValueOr(FOXHOLE_USE_SDK_MAP_SETTING_ID, false) === true,
        closeOnClick: false,
        adminOnly: false,
        disabled: false,
        visible: import.meta.dev && documentSession?.isSceneV2Active.value === true,
        onClick: () => settingsStore.toggle(FOXHOLE_USE_SDK_MAP_SETTING_ID, {
            reason: 'foxhole-war-nx:map-renderer',
        }),
    },
    {
        type: 'submenu',
        label: 'Switch Shard',
        icon: 'ph:share-network',
        adminOnly: false,
        disabled: shards.value.length === 0,
        visible: true,
        children: shards.value.map(shard => ({
            type: 'checkbox',
            label: shard.name,
            icon: 'ph:share-network',
            checked: mapSettings.value.shardId ? mapSettings.value.shardId === shard.id : shard.default,
            closeOnClick: false,
            adminOnly: false,
            disabled: false,
            visible: true,
            onClick: () => runtime.projectStore.patchSettings({
                [FOXHOLE_MAP_SETTING_KEYS.shardId]: shard.id,
            }, 'foxhole-war-nx:shard'),
        })),
    },
    {
        type: 'item',
        label: notificationsEnabled.value ? 'Disable Notifications' : 'Enable Notifications',
        icon: notificationsEnabled.value ? 'ph:bell-slash' : 'ph:bell-ringing',
        closeOnClick: false,
        adminOnly: false,
        disabled: false,
        visible: true,
        onClick: () => settingsStore.setValue(FOXHOLE_MAP_SETTING_KEYS.eventFeedToasts, !notificationsEnabled.value, {
            reason: 'foxhole-war-nx:event-feed-toasts',
        }),
    },
]);

onMounted(async () => {
    try {
        const response = await $fetch<FoxholeShardOption[]>('/api/foxhole/shards');
        shards.value = Array.isArray(response)
            ? response.filter(shard => Boolean(shard?.id) && Boolean(shard?.name))
            : [];
    } catch (error) {
        console.error('Failed to load Foxhole shard list.', error);
        return;
    }

    const selected = String(mapSettings.value.shardId ?? '').trim();
    if (shards.value.some(shard => shard.id === selected)) {
        return;
    }
    const fallback = shards.value.find(shard => shard.default) ?? shards.value[0];
    if (fallback && fallback.id !== selected) {
        runtime.projectStore.patchSettings({
            [FOXHOLE_MAP_SETTING_KEYS.shardId]: fallback.id,
        }, 'foxhole-war-nx:shard');
    }
});
</script>

<template>
    <NixieSidebarHeadingOverflow :items="items" @close-sidebar="emit('close-sidebar')" />
</template>
