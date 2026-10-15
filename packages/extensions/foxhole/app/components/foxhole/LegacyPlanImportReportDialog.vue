<script setup lang="ts">
import { computed, ref } from 'vue';
import { showNxToast } from '#nixie/composables/useNxToast.ts';
import {
    closeLegacyPlanImportReportDialog,
    useLegacyPlanImportReportDialogState,
} from '#foxhole/composables/useLegacyPlanImportReportDialog.ts';

const dialog = useLegacyPlanImportReportDialogState();
const titleId = 'legacy-plan-import-report-title';
const descriptionId = 'legacy-plan-import-report-description';
const copyBusy = ref(false);

const reportJsonText = computed(() => {
    if (!dialog.report) {
        return '';
    }
    return JSON.stringify(dialog.report, null, 2);
});

type ReportSection = {
    title: string;
    items: string[];
};

const sections = computed((): ReportSection[] => {
    const report = dialog.report;
    if (!report) {
        return [];
    }
    const result: ReportSection[] = [];

    if (report.unresolvedBuildingKeys.length) {
        result.push({
            title: 'Unresolved Buildings',
            items: report.unresolvedBuildingKeys,
        });
    }
    if (report.unresolvedFacilityUpgrades.length) {
        result.push({
            title: 'Unresolved Facility Upgrades',
            items: report.unresolvedFacilityUpgrades,
        });
    }
    if (report.unresolvedIconKeys.length) {
        result.push({
            title: 'Unresolved Icons',
            items: report.unresolvedIconKeys,
        });
    }
    if (report.unresolvedImageKeys?.length) {
        result.push({
            title: 'Unresolved Images',
            items: report.unresolvedImageKeys,
        });
    }
    if (report.unresolvedSocketIds.length) {
        result.push({
            title: 'Unresolved Sockets',
            items: report.unresolvedSocketIds,
        });
    }
    const disconnected = report.unresolvedSocketFindings.filter(finding => finding.reason === 'misaligned_after_import');
    if (disconnected.length) {
        result.push({
            title: 'Disconnected Connections',
            items: disconnected.map(finding =>
                `Entity ${finding.entityId} (${finding.legacySocketId}) ↔ Entity ${finding.peerEntityId} (${finding.peerSocketId})`),
        });
    }
    if (report.unresolvedCargoKeys.length) {
        result.push({
            title: 'Unresolved Storage',
            items: report.unresolvedCargoKeys,
        });
    }
    if (report.unmatchedModslots.length) {
        result.push({
            title: 'Unmatched Modslots',
            items: report.unmatchedModslots,
        });
    }

    const skipped = Object.entries(report.skippedEntityTypes);
    if (skipped.length) {
        result.push({
            title: 'Skipped Entity Types',
            items: skipped.map(([type, count]) => `${type} ×${count}`),
        });
    }

    const shapes = Object.entries(report.importedShapeCounts);
    if (shapes.length) {
        result.push({
            title: 'Imported Shapes',
            items: shapes.map(([type, count]) => `${type} ×${count}`),
        });
    }

    if (report.unmappedEntityFields.length) {
        result.push({
            title: 'Unmapped Entity Fields',
            items: report.unmappedEntityFields.map(entry => (
                `${entry.field} ×${entry.count}${entry.samples.length ? ` (${entry.samples.slice(0, 3).join('; ')})` : ''}`
            )),
        });
    }
    if (report.unmappedProjectFields.length) {
        result.push({
            title: 'Unmapped Project Fields',
            items: report.unmappedProjectFields.map(entry => `${entry.field} ×${entry.count}`),
        });
    }
    if (report.unknownEntityFields.length) {
        result.push({
            title: 'Unknown Entity Fields',
            items: report.unknownEntityFields.map(entry => (
                `${entry.field} ×${entry.count}${entry.samples.length ? ` (${entry.samples.slice(0, 3).join('; ')})` : ''}`
            )),
        });
    }
    if (report.unknownProjectFields.length) {
        result.push({
            title: 'Unknown Project Fields',
            items: report.unknownProjectFields.map(entry => `${entry.field} ×${entry.count}`),
        });
    }
    if (report.upgradeWarnings.length) {
        result.push({
            title: 'Upgrade Warnings',
            items: report.upgradeWarnings.map(warning => `${warning.code}: ${warning.message}`),
        });
    }

    return result;
});

const summaryLine = computed(() => {
    const report = dialog.report;
    if (!report) {
        return '';
    }
    const version = `${report.fromVersion ?? '(missing)'} → ${report.toVersion}`;
    return `${report.entityCount} entities · version ${version}`;
});

async function copyReportJson(): Promise<void> {
    if (!reportJsonText.value || copyBusy.value) {
        return;
    }
    copyBusy.value = true;
    try {
        await navigator.clipboard.writeText(reportJsonText.value);
        showNxToast({
            kind: 'success',
            title: 'Report Copied',
            message: 'Import report JSON was copied to the clipboard.',
        });
    } catch {
        showNxToast({
            kind: 'error',
            title: 'Copy Failed',
            message: 'Unable to copy the import report JSON.',
        });
    } finally {
        copyBusy.value = false;
    }
}
</script>

<template>
    <NixieModalShell
        :open="dialog.open"
        title="Legacy Import Report"
        eyebrow="Import Details"
        :labelledById="titleId"
        :describedById="descriptionId"
        width="min(720px, calc(100vw - 32px))"
        @close="closeLegacyPlanImportReportDialog()"
    >
        <p :id="descriptionId" class="legacy-import-report__summary">
            {{ summaryLine }}
        </p>

        <div v-if="sections.length" class="legacy-import-report__sections">
            <section
                v-for="section in sections"
                :key="section.title"
                class="legacy-import-report__section"
            >
                <h3 class="legacy-import-report__section-title">{{ section.title }}</h3>
                <ul class="legacy-import-report__list">
                    <li
                        v-for="item in section.items"
                        :key="`${section.title}:${item}`"
                        class="legacy-import-report__item"
                    >
                        {{ item }}
                    </li>
                </ul>
            </section>
        </div>
        <p v-else class="legacy-import-report__empty">
            No import issues were recorded for this plan.
        </p>

        <template #footer>
            <button
                type="button"
                class="legacy-import-report__secondary"
                :disabled="copyBusy || !reportJsonText"
                @click="copyReportJson()"
            >
                Copy JSON
            </button>
            <button
                type="button"
                class="legacy-import-report__primary"
                @click="closeLegacyPlanImportReportDialog()"
            >
                Close
            </button>
        </template>
    </NixieModalShell>
</template>

<style scoped>
.legacy-import-report__summary {
    margin: 0 0 16px;
    color: #c3b7aa;
    font-size: 14px;
    line-height: 1.6;
}

.legacy-import-report__sections {
    display: grid;
    gap: 14px;
    max-height: min(52vh, 460px);
    overflow: auto;
    padding-right: 4px;
}

.legacy-import-report__section {
    margin: 0;
}

.legacy-import-report__section-title {
    margin: 0 0 6px;
    color: #f5ebe0;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.02em;
}

.legacy-import-report__list {
    margin: 0;
    padding-left: 18px;
    color: #c3b7aa;
    font-size: 13px;
    line-height: 1.55;
}

.legacy-import-report__item {
    margin: 0 0 2px;
    word-break: break-word;
}

.legacy-import-report__empty {
    margin: 0;
    color: #c3b7aa;
    font-size: 14px;
    line-height: 1.6;
}

.legacy-import-report__primary,
.legacy-import-report__secondary {
    min-height: 42px;
    padding: 0 18px;
    border-radius: 12px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.03em;
    transition: border-color 120ms ease, background 120ms ease, transform 120ms ease;
}

.legacy-import-report__primary {
    border: 1px solid rgba(255, 168, 97, 0.34);
    background:
        linear-gradient(180deg, rgba(255, 193, 135, 0.18), rgba(255, 153, 81, 0.09)),
        linear-gradient(180deg, #2a1b12 0%, #1f140f 100%);
    color: #f9ecdf;
}

.legacy-import-report__secondary {
    border: 1px solid rgba(195, 183, 170, 0.28);
    background: linear-gradient(180deg, #241c17 0%, #1a1511 100%);
    color: #e8ddd1;
}

.legacy-import-report__primary:hover,
.legacy-import-report__primary:focus-visible,
.legacy-import-report__secondary:hover,
.legacy-import-report__secondary:focus-visible {
    outline: none;
    transform: translateY(-1px);
}

.legacy-import-report__primary:hover,
.legacy-import-report__primary:focus-visible {
    border-color: rgba(255, 143, 61, 0.45);
}

.legacy-import-report__secondary:hover,
.legacy-import-report__secondary:focus-visible {
    border-color: rgba(226, 210, 192, 0.42);
}

.legacy-import-report__secondary:disabled {
    opacity: 0.55;
    transform: none;
    cursor: not-allowed;
}

@media (max-width: 640px) {
    .legacy-import-report__primary,
    .legacy-import-report__secondary {
        width: 100%;
    }
}
</style>
