<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, watch } from 'vue';
import { useNixieLegacySettingsImport } from '#foxhole/composables/useNixieLegacySettingsImport.ts';
import type { LegacySettingsChange } from '#foxhole/utils/nixie-legacy-settings.ts';

const props = defineProps<{ open: boolean; }>();
const emit = defineEmits<{ close: []; pending: [value: boolean]; }>();
const importer = useNixieLegacySettingsImport();
watch(importer.pending, value => emit('pending', value));
let previousFocus: HTMLElement | null = null;

function dialog(): HTMLElement | null {
    return document.getElementById('nx-legacy-settings-import-title')?.closest<HTMLElement>('[role="dialog"]') ?? null;
}

watch(() => props.open, async open => {
    if (open) {
        previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        await nextTick();
        dialog()?.querySelector<HTMLInputElement>('input[type="file"]')?.focus();
    } else {
        await nextTick();
        if (previousFocus?.isConnected) {
            previousFocus.focus();
        }
    }
});

watch(importer.report, async report => {
    if (!props.open) {
        return;
    }
    await nextTick();
    dialog()?.querySelector<HTMLElement>(report ? '[data-legacy-review]' : 'input[type="file"]')?.focus();
});

function handleKeydown(event: KeyboardEvent): void {
    if (!props.open) {
        return;
    }
    const root = dialog();
    if (!root) {
        return;
    }
    // Keep native button/file/checkbox behavior. NxModal's default Enter action
    // must never turn a keyboard Cancel or file selection into Apply.
    if (event.key === 'Enter' && root.contains(event.target as Node)) {
        event.stopPropagation();
    }
    if (event.key !== 'Tab') {
        return;
    }
    const elements = Array.from(root.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, a[href], [tabindex]'))
        .filter(element => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
    const first = elements[0];
    const last = elements.at(-1);
    if (!first || !last) {
        return;
    }
    if (event.shiftKey && (document.activeElement === first || !elements.includes(document.activeElement as HTMLElement))) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !elements.includes(document.activeElement as HTMLElement))) {
        event.preventDefault();
        first.focus();
    }
}

onMounted(() => document.addEventListener('keydown', handleKeydown, true));
onBeforeUnmount(() => document.removeEventListener('keydown', handleKeydown, true));

function close(): void {
    if (importer.pending.value) {
        return;
    }
    importer.cancelReview();
    emit('close');
}

async function chooseFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
        return;
    }
    try {
        await importer.readFile(file);
    } finally {
        input.value = '';
    }
}

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
    <NxModal
        :open="open"
        title="Import Legacy Settings"
        eyebrow="Foxhole Planner / Game Kitchen"
        labelledById="nx-legacy-settings-import-title"
        width="min(760px, calc(100vw - 32px))"
        :closeOnOverlay="!importer.pending.value"
        :closeOnEscape="!importer.pending.value"
        @close="close"
    >
        <div class="nx-legacy-settings">
            <p v-if="importer.error.value" role="alert" class="nx-legacy-settings__error">{{ importer.error.value }}</p>
            <p v-if="importer.message.value" role="status">{{ importer.message.value }}</p>
            <template v-if="!importer.report.value">
                <p>In the legacy planner, open Hub → Settings → Settings Management → Export Settings. Choose the downloaded settings JSON here to review what can be imported.</p>
                <p class="nx-text-muted">Use the browser and device where you saved your old preferences. Settings are stored there, separately from your account. Files stay on your device while you review them. Maximum file size: 5 MB.</p>
                <label class="nx-legacy-settings__file">
                    <span>Legacy Settings File</span>
                    <input
                        type="file"
                        accept=".json,application/json"
                        :disabled="importer.pending.value"
                        @change="chooseFile"
                    >
                </label>
                <p v-if="importer.pending.value" role="status">Reading settings and loading the Foxhole asset catalog…</p>
                <p class="nx-text-muted">Imports update only supported editor preferences and resolved toolbelt slots. Empty and skipped slots keep their current Nixie bindings. Account, security, project, and keyboard shortcut settings stay unchanged.</p>
            </template>
            <template v-else>
                <p class="nx-legacy-settings__filename" data-legacy-review tabindex="-1">{{ importer.filename.value }} · Legacy settings version {{ importer.report.value.version }}</p>
                <div class="nx-legacy-settings__choices">
                    <NxCheckbox v-model="importer.preferences.value" label="Editor Preferences" />
                    <NxCheckbox v-model="importer.toolbelts.value" label="Toolbelts And Palette" />
                </div>
                <p class="nx-text-muted">Only the mapped values below will be applied. Matching palette slots are replaced in their original rows; other slots are kept.</p>
                <div v-if="importer.report.value.changes.length" class="nx-legacy-settings__table-wrap">
                    <table class="nx-legacy-settings__table">
                        <caption>Mapped Preferences ({{ importer.report.value.changes.length }})</caption>
                        <thead><tr><th scope="col">Nixie Preference</th><th scope="col">Current</th><th scope="col">Imported</th></tr></thead>
                        <tbody>
                            <tr v-for="change in importer.report.value.changes" :key="change.source" :class="{ 'is-skipped': (change.paletteKey || change.source === 'showToolbelt') ? !importer.toolbelts.value : !importer.preferences.value }">
                                <th scope="row">{{ change.label }}</th>
                                <td>{{ displayValue(importer.currentValue(change), change) }}</td>
                                <td>{{ displayValue(change.value, change) }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <section v-if="importer.report.value.slots.length" :class="{ 'is-skipped': !importer.toolbelts.value }">
                    <h3>Mapped Toolbelt Slots ({{ importer.report.value.slots.length }})</h3>
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
                <p v-else role="status">{{ importer.selectedCount.value }} preferences and slots selected. Undo will be available after applying.</p>
            </template>
        </div>
        <template #footer>
            <NxButton
                v-if="importer.recovery.value"
                variant="secondary"
                :disabled="importer.pending.value"
                @click="importer.undo"
            >Undo Last Import</NxButton>
            <NxButton variant="ghost" :disabled="importer.pending.value" @click="close">{{ importer.report.value ? 'Cancel' : 'Close' }}</NxButton>
            <NxButton
                v-if="importer.report.value"
                variant="primary"
                :disabled="!importer.selectedCount.value || importer.pending.value"
                @click="importer.apply"
            >Apply Selected</NxButton>
        </template>
    </NxModal>
</template>

<style scoped>
.nx-legacy-settings { display: grid; gap: var(--nx-space-3); min-width: 0; }
.nx-legacy-settings p { margin: 0; font-size: 13px; line-height: 1.6; }
.nx-legacy-settings__error { color: var(--nx-danger); }
.nx-legacy-settings__filename { overflow-wrap: anywhere; }
.nx-legacy-settings__file { display: grid; gap: var(--nx-space-2); font-size: 13px; font-weight: 600; }
.nx-legacy-settings__file input { max-width: 100%; min-width: 0; font: inherit; padding: var(--nx-space-2); border: 1px solid var(--nx-border); border-radius: var(--nx-radius-md); }
.nx-legacy-settings__choices { display: flex; flex-wrap: wrap; gap: var(--nx-space-4); }
.nx-legacy-settings__table-wrap { overflow-x: auto; }
.nx-legacy-settings__table { width: 100%; border-collapse: collapse; font-size: 12px; }
.nx-legacy-settings__table caption, .nx-legacy-settings h3 { text-align: left; font-size: 13px; font-weight: 600; margin: 0 0 var(--nx-space-2); }
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
.is-skipped { opacity: 0.5; }
</style>
