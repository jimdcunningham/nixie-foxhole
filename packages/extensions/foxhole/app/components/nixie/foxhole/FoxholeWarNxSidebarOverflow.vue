<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import NixieSidebarHeadingOverflow from '#nixie/components/nixie/NixieSidebarHeadingOverflow.vue';
import type { ResolvedMenuItem } from '#nixie/plugins/nixie/registry/menu-resolver.ts';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { FOXHOLE_MAP_SETTING_KEYS, readFoxholeMapSettings } from '#foxhole/plugins/foxhole/nixie/map-settings.ts';

interface FoxholeShardOption {
    id: string;
    name: string;
    default: boolean;
}

const emit = defineEmits<{
    'close-sidebar': [];
}>();

const runtime = useNixieRuntime();
const settingsStore = useNixieSettingsStore();
const shards = ref<FoxholeShardOption[]>([]);
const mapSettings = computed(() => readFoxholeMapSettings(
    runtime.projectStore.settings,
    settingId => settingsStore.getValueOr(settingId, ''),
));
const notificationsEnabled = computed(() => Boolean(mapSettings.value.eventFeedToasts));

const items = computed<ResolvedMenuItem[]>(() => [
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
            closeOnClick: true,
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
        closeOnClick: true,
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
