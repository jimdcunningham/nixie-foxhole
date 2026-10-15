<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { NxCheckboxGroupOption } from '#nixie/components/NxCheckboxGroup.vue';
import NxButton from '#nixie/components/NxButton.vue';
import NxCallout from '#nixie/components/NxCallout.vue';
import NxCheckboxGroup from '#nixie/components/NxCheckboxGroup.vue';
import NxEmptyState from '#nixie/components/NxEmptyState.vue';
import NxModal from '#nixie/components/NxModal.vue';
import NxTooltip from '#nixie/components/NxTooltip.vue';
import { getNixieEditorDocumentSessionBridge } from '#nixie/utils/nixie-editor-document-session-bridge.ts';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { showNxToast } from '#nixie/composables/useNxToast.ts';
import { writeClipboardText } from '#nixie/plugins/nixie/clipboard.ts';
import { NixieYjsProject } from '#nixie/plugins/nixie/yjs-project.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import { nixieSpreadsheetContentFromCsv } from '#nixie/utils/nixie-spreadsheet-csv.ts';
import {
    buildFoxholeStatsExportCsvFileName,
    buildFoxholeStatsExportCsvText,
    buildFoxholeStatsExportListText,
    buildFoxholeStatsExportSpreadsheetTitle,
    FOXHOLE_STATS_EXPORT_SECTION_IDS,
    FOXHOLE_STATS_EXPORT_SECTION_LABELS,
    parseFoxholeStatsExportIdList,
    resolveFoxholeStatsExportSectionAvailability,
    serializeFoxholeStatsExportIdList,

} from '#foxhole/plugins/foxhole/nixie/stats-export.ts';
import type { FoxholeStatsExportScopePayload, FoxholeStatsExportSectionId } from '#foxhole/plugins/foxhole/nixie/stats-export.ts';
import { FOXHOLE_STATS_SETTING_KEYS } from '#foxhole/plugins/foxhole/nixie/stats-settings.ts';

const props = defineProps<{
    open: boolean;
    scope: FoxholeStatsExportScopePayload | null;
    intervalLabel?: string | null;
}>();

const emit = defineEmits<{
    close: [];
}>();

const runtime = useNixieRuntime();
const settingsStore = useNixieSettingsStore();

const selectedSectionIds = ref<string[]>([]);
const busy = ref(false);
const actionError = ref('');

const availableSectionIds = computed(() => {
    const scope = props.scope;
    if (!scope || scope.nodeCount <= 0) {
        return [] as FoxholeStatsExportSectionId[];
    }

    const availability = resolveFoxholeStatsExportSectionAvailability(scope);
    return FOXHOLE_STATS_EXPORT_SECTION_IDS.filter(sectionId => availability[sectionId]);
});

const sectionOptions = computed<NxCheckboxGroupOption[]>(() => (
    availableSectionIds.value.map(sectionId => ({
        value: sectionId,
        label: FOXHOLE_STATS_EXPORT_SECTION_LABELS[sectionId],
    }))
));

const selectedExportSectionIds = computed(() => (
    parseFoxholeStatsExportIdList(selectedSectionIds.value.join(','), FOXHOLE_STATS_EXPORT_SECTION_IDS)
));

const canExport = computed(() => (
    Boolean(props.scope && props.scope.nodeCount > 0)
    && selectedExportSectionIds.value.length > 0
    && !busy.value
));

const canCreateSpreadsheet = computed(() => {
    const project = runtime.projectStore.project;
    return runtime.canEdit.value
        && project instanceof NixieYjsProject
        && project.capabilities.value.canEdit;
});

const createSpreadsheetTooltip = computed(() => (
    canCreateSpreadsheet.value
        ? 'Create a new spreadsheet from the selected statistics'
        : 'Requires an editable collaborative project'
));

const exportOptions = computed(() => ({
    scopes: props.scope ? [props.scope] : [],
    scopeIds: props.scope ? [props.scope.id] : [],
    sectionIds: selectedExportSectionIds.value,
    intervalLabel: props.intervalLabel ?? null,
}));

function clampSectionIds(candidate: readonly string[]): FoxholeStatsExportSectionId[] {
    const allowed = new Set(availableSectionIds.value);
    const clamped = parseFoxholeStatsExportIdList(candidate.join(','), FOXHOLE_STATS_EXPORT_SECTION_IDS)
        .filter(sectionId => allowed.has(sectionId));
    return clamped.length > 0 ? clamped : [...availableSectionIds.value];
}

function readPersistedSectionIds(): FoxholeStatsExportSectionId[] {
    return parseFoxholeStatsExportIdList(
        settingsStore.getValueOr(FOXHOLE_STATS_SETTING_KEYS.exportSections, ''),
        FOXHOLE_STATS_EXPORT_SECTION_IDS,
    );
}

function persistSelection(): void {
    settingsStore.setValue(
        FOXHOLE_STATS_SETTING_KEYS.exportSections,
        serializeFoxholeStatsExportIdList(selectedExportSectionIds.value),
        { reason: 'foxhole.stats.export.sections' },
    );
}

function initializeSelection(): void {
    actionError.value = '';
    selectedSectionIds.value = [...clampSectionIds(readPersistedSectionIds())];
}

function downloadTextFile(fileName: string, content: string, mimeType: string): void {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
}

watch(() => props.open, open => {
    if (open) {
        initializeSelection();
    }
});

watch(selectedSectionIds, () => {
    if (!props.open) {
        return;
    }

    const nextSections = clampSectionIds(selectedSectionIds.value);
    if (
        nextSections.length !== selectedExportSectionIds.value.length
        || nextSections.some((sectionId, index) => sectionId !== selectedExportSectionIds.value[index])
    ) {
        selectedSectionIds.value = [...nextSections];
        return;
    }

    persistSelection();
}, { deep: true });

watch(() => props.scope, () => {
    if (!props.open) {
        return;
    }
    selectedSectionIds.value = [...clampSectionIds(selectedSectionIds.value)];
});

async function copyStats(): Promise<void> {
    if (!canExport.value) {
        return;
    }

    busy.value = true;
    actionError.value = '';
    try {
        const text = buildFoxholeStatsExportListText(exportOptions.value);
        if (!text) {
            throw new Error('Nothing to copy for the current selection.');
        }
        await writeClipboardText(text);
        showNxToast({
            title: 'Statistics',
            message: 'Copied statistics to the clipboard.',
            kind: 'success',
            durationMs: 3200,
        });
    } catch (error) {
        actionError.value = error instanceof Error ? error.message : 'Unable to copy statistics.';
    } finally {
        busy.value = false;
    }
}

function downloadCsv(): void {
    if (!canExport.value) {
        return;
    }

    busy.value = true;
    actionError.value = '';
    try {
        const csv = buildFoxholeStatsExportCsvText(exportOptions.value);
        downloadTextFile(
            buildFoxholeStatsExportCsvFileName({
                scopeIds: props.scope ? [props.scope.id] : [],
            }),
            csv,
            'text/csv',
        );
        showNxToast({
            title: 'Statistics',
            message: 'Downloaded statistics CSV.',
            kind: 'success',
            durationMs: 3200,
        });
    } catch (error) {
        actionError.value = error instanceof Error ? error.message : 'Unable to download CSV.';
    } finally {
        busy.value = false;
    }
}

async function createSpreadsheet(): Promise<void> {
    if (!canExport.value || !canCreateSpreadsheet.value) {
        return;
    }

    busy.value = true;
    actionError.value = '';
    try {
        const project = runtime.projectStore.project;
        if (!(project instanceof NixieYjsProject)) {
            throw new Error('Spreadsheet export requires a collaborative project.');
        }

        const csv = buildFoxholeStatsExportCsvText(exportOptions.value);
        const content = nixieSpreadsheetContentFromCsv(csv);
        const title = buildFoxholeStatsExportSpreadsheetTitle({
            scopeIds: props.scope ? [props.scope.id] : [],
        });
        const created = project.createSpreadsheetView(title, null, content);
        if (!created) {
            throw new Error('Could not create spreadsheet.');
        }

        getNixieEditorDocumentSessionBridge()?.openView(created.id);
        showNxToast({
            title: 'Spreadsheet',
            message: `Created “${created.title}” from statistics.`,
            kind: 'success',
            durationMs: 4200,
        });
        emit('close');
    } catch (error) {
        actionError.value = error instanceof Error
            ? error.message
            : 'Unable to create a spreadsheet right now.';
    } finally {
        busy.value = false;
    }
}
</script>

<template>
    <NxModal
        :open="open"
        title="Export Statistics"
        width="min(420px, calc(100vw - 32px))"
        showClose
        @close="emit('close')"
    >
        <div class="foxhole-stats-export-dialog">
            <NxCheckboxGroup
                v-if="sectionOptions.length > 0"
                v-model="selectedSectionIds"
                :options="sectionOptions"
                compact
                aria-label="Export sections"
            />

            <NxEmptyState
                v-else
                message="No statistics are available to export for the current scope."
            />

            <NxCallout
                v-if="actionError"
                variant="danger"
                :message="actionError"
            />
        </div>

        <template #footer>
            <NxButton
                variant="secondary"
                :disabled="!canExport"
                label="Copy"
                @click="copyStats"
            />
            <NxButton
                variant="secondary"
                :disabled="!canExport"
                label="Download CSV"
                @click="downloadCsv"
            />
            <NxTooltip :text="createSpreadsheetTooltip" position="top">
                <NxButton
                    variant="primary"
                    :disabled="!canExport || !canCreateSpreadsheet"
                    label="Create Spreadsheet"
                    @click="createSpreadsheet"
                />
            </NxTooltip>
        </template>
    </NxModal>
</template>

<style scoped>
.foxhole-stats-export-dialog {
    display: grid;
    gap: var(--nx-space-3);
}
</style>
