<script setup lang="ts">
import { computed, watch } from 'vue';
import { useNixieLegacySettingsImport } from '#foxhole/composables/useNixieLegacySettingsImport.ts';
import type { LegacySettingsChange } from '#foxhole/utils/nixie-legacy-settings.ts';

const props = defineProps<{ file: File; includePreferences: boolean; includeToolbelts: boolean; disabled?: boolean; }>();
const emit = defineEmits<{ ready: [value: boolean]; pending: [value: boolean]; }>();
const importer = useNixieLegacySettingsImport();
const visibleChanges = computed(() => importer.report.value?.changes.filter(change =>
    change.paletteKey || change.source === 'showToolbelt' ? props.includeToolbelts : props.includePreferences,
) ?? []);

watch([() => props.includePreferences, () => props.includeToolbelts, importer.report], ([preferences, toolbelts]) => {
    importer.preferences.value = preferences;
    importer.toolbelts.value = toolbelts;
}, { immediate: true, flush: 'sync' });

watch([importer.pending, importer.selectedCount], ([pending, count]) => {
    emit('ready', !pending && count > 0);
}, { immediate: true });
watch(() => props.file, file => { void importer.readFile(file); }, { immediate: true });
watch(importer.pending, pending => emit('pending', pending), { immediate: true });
defineExpose({ apply: importer.apply });

function displayValue(value: unknown, change?: LegacySettingsChange): string {
    if (change?.paletteKey === 'selectedPaletteRow') {
        return `Row ${Number(value) + 1}`;
    }
    if (typeof value === 'boolean') {
        return value ? 'On' : 'Off';
    }
    return ({ 'all': 'All factions', 'c': 'Colonial', 'w': 'Warden', 'create': 'Create', 'exchange-single': 'Replace one selected', 'exchange-all': 'Replace all selected' } as Record<string, string>)[String(value)] ?? String(value);
}
</script>

<template>
    <section class="nx-legacy-settings" aria-label="Editor settings and toolbelts">
            <p v-if="importer.error.value" role="alert" class="nx-legacy-settings__error">{{ importer.error.value }}</p>
            <p v-if="importer.message.value" role="status">{{ importer.message.value }}</p>
            <template v-if="!importer.report.value">
                <p v-if="importer.pending.value" role="status">Reading settings…</p>
            </template>
            <template v-else-if="includePreferences || includeToolbelts">
                <p v-if="includeToolbelts && importer.report.value.slots.length" class="nx-text-muted">Matching palette slots are replaced in their original rows; other slots are kept.</p>
                <div v-if="visibleChanges.length" class="nx-legacy-settings__table-wrap">
                    <table class="nx-legacy-settings__table" aria-label="Settings to import">
                        <thead><tr><th scope="col">Nixie Setting</th><th scope="col">Current</th><th scope="col">Imported</th></tr></thead>
                        <tbody>
                            <tr v-for="change in visibleChanges" :key="change.source">
                                <th scope="row">{{ change.label }}</th>
                                <td>{{ displayValue(importer.currentValue(change), change) }}</td>
                                <td>{{ displayValue(change.value, change) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <section v-if="includeToolbelts && importer.report.value.slots.length">
                    <h3>Toolbelt Slots</h3>
                    <ul class="nx-legacy-settings__slots">
                        <li v-for="item in importer.report.value.slots" :key="item.source">
                            <span class="nx-legacy-settings__slot-position">Row {{ item.row + 1 }} · Key {{ item.slot === 9 ? '0' : item.slot + 1 }}</span>
                            <span><small>Current</small>{{ importer.currentSlotLabel(item.row, item.slot) }}</span>
                            <span><small>Imported</small><strong>{{ item.binding.kind === 'asset' ? item.binding.label : '' }}</strong></span>
                        </li>
                    </ul>
                </section>
                <details v-if="importer.report.value.skipped.length" class="nx-legacy-settings__skipped">
                    <summary>Skipped Items ({{ importer.report.value.skipped.length }})</summary>
                    <ul>
                        <li v-for="item in importer.report.value.skipped" :key="item.source"><code>{{ item.source }}</code> — {{ item.reason }}</li>
                    </ul>
                </details>
                <p v-if="!importer.selectedCount.value" role="status">No supported items are selected. Your settings will be kept.</p>
            </template>
    </section>
</template>

<style scoped>
.nx-legacy-settings { display: grid; gap: var(--nx-space-3); min-width: 0; }
.nx-legacy-settings p { margin: 0; font-size: 13px; line-height: 1.6; }
.nx-legacy-settings__error { color: var(--nx-danger); }
.nx-legacy-settings__file { display: grid; gap: var(--nx-space-2); font-size: 13px; font-weight: 600; }
.nx-legacy-settings__file input { max-width: 100%; min-width: 0; font: inherit; padding: var(--nx-space-2); border: 1px solid var(--nx-border); border-radius: var(--nx-radius-md); }
.nx-legacy-settings__table-wrap { overflow-x: auto; }
.nx-legacy-settings__table { width: 100%; border-collapse: collapse; font-size: 12px; }
.nx-legacy-settings h3 { text-align: left; font-size: 13px; font-weight: 600; margin: 0 0 var(--nx-space-2); }
.nx-legacy-settings__table th, .nx-legacy-settings__table td { padding: var(--nx-space-2); border-bottom: 1px solid var(--nx-border); text-align: left; overflow-wrap: anywhere; }
.nx-legacy-settings__table thead th { color: var(--nx-text-muted); font-weight: 500; }
.nx-legacy-settings__table tbody th { font-weight: 500; }
.nx-legacy-settings__slots { list-style: none; display: grid; gap: var(--nx-space-2); padding: 0; margin: 0; }
.nx-legacy-settings__slots li { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: var(--nx-space-2); font-size: 12px; border-bottom: 1px solid var(--nx-border); padding-bottom: var(--nx-space-2); overflow-wrap: anywhere; }
.nx-legacy-settings__slot-position { grid-column: 1 / -1; font-weight: 500; }
.nx-legacy-settings__slots small { display: block; color: var(--nx-text-muted); margin-bottom: var(--nx-space-1); }
.nx-legacy-settings__slots strong { font-weight: 500; overflow-wrap: anywhere; }
.nx-legacy-settings__skipped { font-size: 12px; }
.nx-legacy-settings__skipped summary { cursor: pointer; font-weight: 600; padding: var(--nx-space-2) 0; }
.nx-legacy-settings__skipped ul { margin: var(--nx-space-2) 0 0; padding-left: var(--nx-space-4); display: grid; gap: var(--nx-space-2); overflow-wrap: anywhere; }
</style>
