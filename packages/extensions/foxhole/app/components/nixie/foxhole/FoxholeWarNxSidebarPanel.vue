<script setup lang="ts">
import { computed, ref } from 'vue';
import NxEditorToolbar from '#nixie/components/NxEditorToolbar.vue';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { canAccessNixieDevFeatures, isNixieAdminUser } from '#nixie/utils/nixie-admin.ts';
import FoxholeWarNxLiveTab from '#foxhole/components/nixie/foxhole/FoxholeWarNxLiveTab.vue';
import FoxholeWarNxMapTab from '#foxhole/components/nixie/foxhole/FoxholeWarNxMapTab.vue';
import FoxholeWarNxMapToolbar from '#foxhole/components/nixie/foxhole/FoxholeWarNxMapToolbar.vue';
import FoxholeWarNxPulseTab from '#foxhole/components/nixie/foxhole/FoxholeWarNxPulseTab.vue';
import FoxholeWarNxSplitTab from '#foxhole/components/nixie/foxhole/FoxholeWarNxSplitTab.vue';
import FoxholeWarNxViewTabs from '#foxhole/components/nixie/foxhole/FoxholeWarNxViewTabs.vue';
import FoxholeWarPlaybackFooter from '#foxhole/components/nixie/foxhole/FoxholeWarPlaybackFooter.vue';

type FoxholeWarNxTabId = 'map' | 'live' | 'pulse' | 'split';

const user = useSupabaseUser();
const settingsStore = useNixieSettingsStore();
const activeTab = ref<FoxholeWarNxTabId>('map');

const canAccessWarTimeline = computed(() => {
    void user.value;
    const canAccessDevFeatures = canAccessNixieDevFeatures(isNixieAdminUser(user.value));
    return canAccessDevFeatures && settingsStore.getValue('nixie.debug.overlay') === true;
});
</script>

<template>
    <div class="foxhole-war-nx-panel">
        <NxEditorToolbar
            variant="secondary"
            sidebar
        >
            <template #main>
                <FoxholeWarNxViewTabs v-model="activeTab" />
            </template>
        </NxEditorToolbar>

        <FoxholeWarNxMapToolbar v-if="activeTab === 'map'" />

        <div class="foxhole-war-nx-panel__body nx-panel-body">
            <FoxholeWarNxMapTab v-if="activeTab === 'map'" />
            <FoxholeWarNxLiveTab v-else-if="activeTab === 'live'" />
            <FoxholeWarNxPulseTab v-else-if="activeTab === 'pulse'" />
            <FoxholeWarNxSplitTab v-else-if="activeTab === 'split'" />
        </div>

        <FoxholeWarPlaybackFooter v-if="canAccessWarTimeline" />
    </div>
</template>

<style scoped>
.foxhole-war-nx-panel {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
}
</style>

<style src="#nixie-internal/app/components/nixie/nixie-sidebar-form.css"></style>
