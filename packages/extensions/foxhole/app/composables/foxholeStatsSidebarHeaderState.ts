import { readonly } from 'vue';

export function useFoxholeStatsSidebarHeaderState() {
    const scopeLabel = useState('foxhole:stats-sidebar:scope-label', () => 'Scene');
    const exportDialogOpen = useState('foxhole:stats-sidebar:export-open', () => false);

    return {
        scopeLabel: readonly(scopeLabel),
        exportDialogOpen: readonly(exportDialogOpen),
        setScopeLabel: (label: string) => {
            scopeLabel.value = label;
        },
        openExportDialog: () => {
            exportDialogOpen.value = true;
        },
        closeExportDialog: () => {
            exportDialogOpen.value = false;
        },
    };
}
