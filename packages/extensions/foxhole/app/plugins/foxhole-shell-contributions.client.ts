import { defineNuxtPlugin } from '#app';
import { markRaw } from 'vue';
import FoxholeHubFooterColumns from '#foxhole/components/foxhole/FoxholeHubFooterColumns.vue';
import FoxholeLegacyPlanImportReportDialog from '#foxhole/components/foxhole/LegacyPlanImportReportDialog.vue';
import { tryUseNxShellContributions } from '#nixie/contributions/shell-contribution.ts';

export default defineNuxtPlugin({
    name: 'foxhole-shell-contributions',
    dependsOn: ['shell-registry'],
    setup() {
        const registry = tryUseNxShellContributions();
        if (!registry) {
            return;
        }

        registry.register({
            id: 'foxhole.legacy-plan-import-report',
            slot: 'modal-host',
            order: 100,
            component: markRaw(FoxholeLegacyPlanImportReportDialog),
        });

        registry.register({
            id: 'foxhole.hub-footer-columns',
            slot: 'hub-footer',
            order: 100,
            component: markRaw(FoxholeHubFooterColumns),
        });
    },
});
