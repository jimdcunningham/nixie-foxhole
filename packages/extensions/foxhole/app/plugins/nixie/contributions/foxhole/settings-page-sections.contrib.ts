import { defineContribution } from '#nixie/plugins/nixie/registry/index.ts';
import { FOXHOLE_SETTINGS_PAGE_SECTIONS } from '#foxhole/plugins/foxhole/nixie/settings-page-sections.ts';

export default defineContribution({
    settingsPageSections: FOXHOLE_SETTINGS_PAGE_SECTIONS,
});
