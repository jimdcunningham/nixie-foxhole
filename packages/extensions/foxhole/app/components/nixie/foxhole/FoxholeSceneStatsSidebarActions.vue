<script setup lang="ts">
import { computed, ref } from 'vue';
import NxButton from '#nixie/components/NxButton.vue';
import NxIconButton from '#nixie/components/NxIconButton.vue';
import NxMenu from '#nixie/components/NxMenu.vue';
import NxModal from '#nixie/components/NxModal.vue';
import NxNumberInput from '#nixie/components/NxNumberInput.vue';
import NxSelect from '#nixie/components/NxSelect.vue';
import type { ResolvedMenuItem } from '#nixie/plugins/nixie/registry/menu-resolver.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { actionMenuItem, separatorMenuItem } from '#nixie/utils/nx-resolved-menu-builders.ts';
import {
    FOXHOLE_CUSTOM_MAINTENANCE_INTERVAL_ID,
    FOXHOLE_DEFAULT_MAINTENANCE_INTERVAL_ID,
    FOXHOLE_MAINTENANCE_INTERVAL_OPTIONS,
    formatFoxholeMaintenanceIntervalLabel,
    normalizeFoxholeCustomIntervalSeconds,
    resolveFoxholeMaintenanceIntervalSeconds,
} from '#foxhole/plugins/foxhole/nixie/maintenance-supplies.ts';
import { FOXHOLE_STATS_SETTING_KEYS } from '#foxhole/plugins/foxhole/nixie/stats-settings.ts';

const customIntervalUnits = [
    { value: 'days', label: 'Days', seconds: 86400 },
    { value: 'hours', label: 'Hours', seconds: 3600 },
    { value: 'minutes', label: 'Minutes', seconds: 60 },
    { value: 'seconds', label: 'Seconds', seconds: 1 },
];

const settingsStore = useNixieSettingsStore();
const intervalButton = ref<HTMLElement | null>(null);
const intervalMenuOpen = ref(false);
const customIntervalOpen = ref(false);
const customAmount = ref<number | null>(1);
const customUnit = ref('hours');
const selectionEnabled = computed(() => (
    settingsStore.getValueOr(FOXHOLE_STATS_SETTING_KEYS.enableSelectionStats, true) !== false
));
const layerEnabled = computed(() => (
    settingsStore.getValueOr(FOXHOLE_STATS_SETTING_KEYS.enableLayerStats, true) === true
));
const intervalId = computed(() => {
    const value = String(settingsStore.getValueOr(FOXHOLE_STATS_SETTING_KEYS.timeInterval, FOXHOLE_DEFAULT_MAINTENANCE_INTERVAL_ID)).trim();
    return value === FOXHOLE_CUSTOM_MAINTENANCE_INTERVAL_ID
        || FOXHOLE_MAINTENANCE_INTERVAL_OPTIONS.some(option => option.id === value)
        ? value
        : FOXHOLE_DEFAULT_MAINTENANCE_INTERVAL_ID;
});
const customIntervalSeconds = computed(() => Number(
    settingsStore.getValueOr(FOXHOLE_STATS_SETTING_KEYS.customIntervalSeconds, 3600),
));
const intervalLabel = computed(() => (
    formatFoxholeMaintenanceIntervalLabel(intervalId.value, customIntervalSeconds.value)
));
const pendingCustomSeconds = computed(() => {
    const unit = customIntervalUnits.find(option => option.value === customUnit.value);
    return normalizeFoxholeCustomIntervalSeconds((customAmount.value ?? 0) * (unit?.seconds ?? 0));
});
const intervalMenuPosition = computed(() => {
    const bounds = intervalButton.value?.getBoundingClientRect();
    return bounds ? { x: bounds.right, y: bounds.bottom } : { x: 0, y: 0 };
});
const intervalMenuItems = computed<ResolvedMenuItem[]>(() => (
    [
        actionMenuItem('Set Custom Interval…', () => {
            intervalMenuOpen.value = false;
            openCustomIntervalDialog();
        }, { icon: 'ph:pencil-simple', selected: intervalId.value === FOXHOLE_CUSTOM_MAINTENANCE_INTERVAL_ID }),
        separatorMenuItem(),
        ...FOXHOLE_MAINTENANCE_INTERVAL_OPTIONS.map(option => actionMenuItem(
            option.label,
            () => {
                settingsStore.setValue(FOXHOLE_STATS_SETTING_KEYS.timeInterval, option.id, {
                    reason: 'foxhole.stats.timeInterval',
                });
                intervalMenuOpen.value = false;
            },
            { selected: intervalId.value === option.id },
        )),
    ]
));

function openCustomIntervalDialog(): void {
    const seconds = resolveFoxholeMaintenanceIntervalSeconds(intervalId.value, customIntervalSeconds.value);
    const unit = customIntervalUnits.find(option => seconds % option.seconds === 0)
        ?? customIntervalUnits[customIntervalUnits.length - 1]!;
    customUnit.value = unit.value;
    customAmount.value = seconds / unit.seconds;
    customIntervalOpen.value = true;
}

function saveCustomInterval(): void {
    if (pendingCustomSeconds.value === null) {
        return;
    }
    settingsStore.setValue(FOXHOLE_STATS_SETTING_KEYS.customIntervalSeconds, pendingCustomSeconds.value, {
        reason: 'foxhole.stats.customIntervalSeconds',
    });
    settingsStore.setValue(FOXHOLE_STATS_SETTING_KEYS.timeInterval, FOXHOLE_CUSTOM_MAINTENANCE_INTERVAL_ID, {
        reason: 'foxhole.stats.timeInterval',
    });
    customIntervalOpen.value = false;
}

function toggleSelection(): void {
    settingsStore.toggle(FOXHOLE_STATS_SETTING_KEYS.enableSelectionStats, {
        reason: 'foxhole.stats.enableSelectionStats',
    });
}

function toggleLayer(): void {
    settingsStore.toggle(FOXHOLE_STATS_SETTING_KEYS.enableLayerStats, {
        reason: 'foxhole.stats.enableLayerStats',
    });
}
</script>

<template>
    <div class="foxhole-scene-stats-sidebar-actions">
        <NxIconButton
            icon="ph:cursor"
            label="Selection Statistics"
            tooltip="Selection Statistics"
            variant="ghost"
            size="sm"
            :active="selectionEnabled"
            @click="toggleSelection"
        />
        <NxIconButton
            icon="ph:stack"
            label="Layer Statistics"
            tooltip="Layer Statistics"
            variant="ghost"
            size="sm"
            :active="layerEnabled"
            @click="toggleLayer"
        />
        <span ref="intervalButton" @pointerdown.stop>
            <NxIconButton
                icon="ph:clock"
                label="Time Interval"
                :tooltip="`Time Interval · ${intervalLabel}`"
                variant="ghost"
                size="sm"
                :active="intervalMenuOpen"
                @click="intervalMenuOpen = !intervalMenuOpen"
            />
        </span>
        <NxMenu
            v-if="intervalMenuOpen"
            :position="intervalMenuPosition"
            horizontalAlign="end"
            :items="intervalMenuItems"
            :autoFocus="false"
            anchorToTrigger
            ariaLabel="Statistics time interval"
            @close="intervalMenuOpen = false"
        />
        <NxModal
            :open="customIntervalOpen"
            title="Set Custom Interval"
            width="min(380px, calc(100vw - 32px))"
            @close="customIntervalOpen = false"
        >
            <div class="foxhole-scene-stats-sidebar-actions__custom-fields">
                <NxSelect
                    v-model="customUnit"
                    label="Interval"
                    :options="customIntervalUnits"
                />
                <NxNumberInput
                    v-model="customAmount"
                    label="Amount"
                    :min="0.01"
                    :step="0.01"
                    nullable
                />
                <p class="nx-form-hint">The interval can be up to 30 days.</p>
            </div>
            <template #footer>
                <NxButton label="Cancel" variant="secondary" @click="customIntervalOpen = false" />
                <NxButton
                    label="Save"
                    variant="primary"
                    :disabled="pendingCustomSeconds === null"
                    @click="saveCustomInterval"
                />
            </template>
        </NxModal>
    </div>
</template>

<style scoped>
.foxhole-scene-stats-sidebar-actions {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: flex-start;
    gap: var(--nx-space-1);
}

.foxhole-scene-stats-sidebar-actions__custom-fields {
    display: grid;
    gap: var(--nx-space-3);
}
</style>
