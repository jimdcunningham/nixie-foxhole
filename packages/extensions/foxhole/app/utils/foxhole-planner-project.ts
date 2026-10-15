import { createAndOpenNixieLocalProject } from '#nixie/utils/nixie-local-projects.ts';
import { seedNixieLocalProjectScene } from '#nixie/utils/nixie-local-project-name-sync.ts';
import { writePersistedNixieProjectViewTabs } from '#nixie/utils/nixie-project-view-tabs-storage.ts';
import { writePersistedNixieProjectAssetsTreeState } from '#nixie/utils/nixie-project-assets-tree-storage.ts';
import { writeNixieSidebarTabSelections } from '#nixie/utils/nixie-sidebar-tab-selection.ts';
import { writeBrowserStorageItem } from '#nixie/plugins/nixie/browser-storage.ts';
import { FOXHOLE_ASSET_SOURCE_ID } from '#foxhole/plugins/foxhole/nixie/assets-browser.ts';

export async function createAndOpenFoxholePlannerProject(): Promise<string> {
    return await createAndOpenNixieLocalProject('Untitled Foxhole Plan', {
        enabledExtensionIds: ['foxhole'],
        initialize: async projectId => {
            const sceneId = await seedNixieLocalProjectScene(projectId);
            writePersistedNixieProjectViewTabs(projectId, {
                openDocumentIds: [sceneId],
                activeViewId: sceneId,
            });
            writeBrowserStorageItem(`nixie:project-explorer-surface:v1:${projectId}`, 'extensions');
            writePersistedNixieProjectAssetsTreeState(projectId, {
                expandedFolderIds: [],
                expandedSyntheticIds: [`source:${FOXHOLE_ASSET_SOURCE_ID}`],
                collapsedSectionIds: [],
            });
            writeNixieSidebarTabSelections(projectId, {
                [sceneId]: {
                    initialSidebarViewId: 'project',
                },
            });
        },
    });
}
