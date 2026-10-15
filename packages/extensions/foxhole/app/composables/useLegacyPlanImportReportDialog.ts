import { reactive, readonly } from 'vue';
import type { LegacyPlanImportReport, LegacyPlanImportReportJson } from '#foxhole/plugins/foxhole/legacy/plan-import-report.ts';

interface LegacyPlanImportReportDialogState {
    open: boolean;
    report: LegacyPlanImportReportJson | null;
}

const state = reactive<LegacyPlanImportReportDialogState>({
    open: false,
    report: null,
});

export function useLegacyPlanImportReportDialogState(): Readonly<LegacyPlanImportReportDialogState> {
    return readonly(state) as Readonly<LegacyPlanImportReportDialogState>;
}

export function closeLegacyPlanImportReportDialog(): void {
    state.open = false;
    state.report = null;
}

export function openLegacyPlanImportReportDialog(
    report: LegacyPlanImportReport | LegacyPlanImportReportJson,
): void {
    state.report = typeof (report as LegacyPlanImportReport).toJSON === 'function'
        ? (report as LegacyPlanImportReport).toJSON()
        : (report as LegacyPlanImportReportJson);
    state.open = true;
}
