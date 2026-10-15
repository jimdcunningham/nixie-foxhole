import { navigateTo, useSupabaseClient, useSupabaseUser } from '#imports';
import { showNxToast } from '#nixie/composables/useNxToast.ts';
import { createProjectRecord, requestNewProjectCreation } from '#nixie/plugins/nixie/project-create.ts';
import { loadProjectSummaries } from '#nixie/plugins/nixie/project-home.ts';
import {
    buildNixieEditorRoute,
    setLastOpenedProjectId,
} from '#nixie/plugins/nixie/runtime/project-route.ts';
import type { NixieImportProjectArchiveOptions } from '#nixie/plugins/nixie/project-archive-import.ts';
import { uploadNixieProjectImageAsset } from '#nixie/plugins/nixie/project-assets.ts';
import { importNixieOfflineProjectSnapshot } from '#nixie/utils/nixie-offline-project-import.ts';
import {
    createNixieLocalProject,
    removeNixieLocalProject,
    touchNixieLocalProject,
} from '#nixie/utils/nixie-local-projects.ts';
import type { NixieProjectAssetSummary } from '#nixie/utils/nixie-project-assets.ts';
import type { LegacyBlueprintProvenance } from '#nixie/utils/legacy-blueprints.ts';
import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import type { NixieYjsBoardNodeSnapshot } from '#nixie/utils/nixie-yjs-document.ts';
import type { NixieCommandContext } from '#nixie/plugins/nixie/registry/types.ts';
import { captureDiscoveryInsertTarget, commitDiscoveryInsertion } from '#nixie/plugins/nixie/discovery-insert.ts';
import { confirmDiscoveryExtensions } from '#nixie/plugins/nixie/discovery-extensions.ts';
import { runDiscoveryImagePreparation } from '#nixie/utils/discovery-image-preparation.ts';
import { paletteBlobDataUrl } from '#nixie/plugins/nixie/palette-content.ts';
import { openLegacyPlanImportReportDialog } from '#foxhole/composables/useLegacyPlanImportReportDialog.ts';
import { isLegacyPlanArchiveBytes } from '#foxhole/plugins/foxhole/legacy/plan-archive.ts';
import {
    createLegacyPlanImageFile,
    createLegacyPlanImageSpriteSnapshot,
} from '#foxhole/plugins/foxhole/legacy/plan-image-mapper.ts';
import { mapLegacyPlanIdentitySettings } from '#foxhole/plugins/foxhole/legacy/plan-identity-settings.ts';
import { mapLegacyPlanProjectSettings } from '#foxhole/plugins/foxhole/legacy/plan-project-settings.ts';
import { LegacyPlanImporter } from '#foxhole/plugins/foxhole/legacy/plan-importer.ts';
import { getFoxholeManifest } from '#foxhole/plugins/foxhole/nixie/manifest.ts';

type LegacyPlanImportResult = import('#foxhole/plugins/foxhole/legacy/plan-importer.ts').LegacyPlanImportResult;

let manifestDigest: Promise<string> | null = null;
async function pinLegacyBlueprintConversion(source: LegacyBlueprintProvenance): Promise<LegacyBlueprintProvenance> {
    manifestDigest ??= crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(getFoxholeManifest('/foxhole/assets/'))))
        .then(bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
    return { ...source, assetManifestSha256: await manifestDigest };
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function countImportedShapes(result: LegacyPlanImportResult): number {
    return Object.values(result.report.importedShapeCounts).reduce((sum, count) => sum + count, 0);
}

function buildImportToastMessage(result: LegacyPlanImportResult, imageCount: number): string {
    const structureCount = result.boardSnapshots.length - countImportedShapes(result);
    const shapeCount = countImportedShapes(result);
    const issueCount = result.report.issueCount;
    const parts: string[] = [];

    if (structureCount > 0 && shapeCount > 0) {
        parts.push(
            `Imported ${structureCount} structure${structureCount === 1 ? '' : 's'} and ${shapeCount} shape${shapeCount === 1 ? '' : 's'}.`,
        );
    } else if (shapeCount > 0) {
        parts.push(`Imported ${shapeCount} shape${shapeCount === 1 ? '' : 's'}.`);
    } else {
        parts.push(`Imported ${structureCount} structure${structureCount === 1 ? '' : 's'}.`);
    }

    if (imageCount > 0) {
        parts.push(`${imageCount} image${imageCount === 1 ? '' : 's'}.`);
    }

    if (issueCount > 0) {
        parts.push(`${issueCount} issue${issueCount === 1 ? '' : 's'}.`);
    }
    return parts.join(' ');
}

function stripLegacyPlanExtension(filename: string): string {
    return filename.replace(/\.(plan|zip|json|project\.zip)$/i, '');
}

async function materializeLegacyPlanImages(options: {
    projectId: string;
    result: LegacyPlanImportResult;
    strict?: boolean;
    assertCurrent?: () => void;
    recordCompletedUpload?: () => void;
    catalogAssets?: () => readonly NixieProjectAssetSummary[];
}): Promise<{
    snapshots: BoardNodeSnapshot[];
    assets: NixieProjectAssetSummary[];
}> {
    if (!options.result.pendingImages.length) {
        return { snapshots: [], assets: [] };
    }

    const supabase = useSupabaseClient();
    const assetsByTextureKey = new Map<string, NixieProjectAssetSummary>();
    const assets: NixieProjectAssetSummary[] = [];
    const snapshots: BoardNodeSnapshot[] = [];
    const unresolved: string[] = [];

    if (options.strict && options.result.pendingImages.some(pending => 'unresolved' in createLegacyPlanImageFile({ pending, assets: options.result.archive.assets }))) {
        throw new Error('This Blueprint contains missing image data. View the source in Foxhole Planner.');
    }

    for (const pending of options.result.pendingImages) {
        options.assertCurrent?.();
        const resolved = createLegacyPlanImageFile({
            pending,
            assets: options.result.archive.assets,
        });
        if ('unresolved' in resolved) {
            unresolved.push(resolved.unresolved);
            continue;
        }

        const cacheKey = pending.textureFile
            || `inline:${pending.legacyId}`;
        let asset = assetsByTextureKey.get(cacheKey) ?? null;
        if (!asset) {
            const uploadOutcome = await uploadNixieProjectImageAsset({
                supabase,
                projectId: options.projectId,
                file: resolved.file,
                displayName: pending.name || pending.textureFile || resolved.file.name,
                usageType: 'attachment',
                catalogAssets: [...(options.catalogAssets?.() ?? []), ...assets],
            });
            if (uploadOutcome.outcome === 'uploaded') {
                options.recordCompletedUpload?.();
            }
            asset = uploadOutcome.asset;
            assetsByTextureKey.set(cacheKey, asset);
            if (!assets.some(entry => entry.id === asset!.id)) {
                assets.push(asset);
            }
        }

        snapshots.push(createLegacyPlanImageSpriteSnapshot({
            projectId: options.projectId,
            asset,
            pending,
        }));
        options.result.report.importedShapeCounts.image = (
            options.result.report.importedShapeCounts.image ?? 0
        ) + 1;
    }

    if (unresolved.length) {
        options.result.report.unresolvedImageKeys = [...new Set([
            ...options.result.report.unresolvedImageKeys,
            ...unresolved,
        ])].sort();
    }

    return { snapshots, assets };
}

async function writeLegacyPlanRoots(options: {
    projectId: string;
    name: string;
    description?: string;
    credits?: string;
    tags?: string;
    projectSettings?: Record<string, unknown>;
    provenance?: LegacyBlueprintProvenance;
    enabledExtensionIds: string[];
    roots: BoardNodeSnapshot[];
    assets: NixieProjectAssetSummary[];
    offline: boolean;
}): Promise<void> {
    const updatedAt = new Date().toISOString();
    const settings: Record<string, unknown> = {
        name: options.name,
    };
    if (options.description) {
        settings.description = options.description;
    }
    if (options.credits) {
        settings.credits = options.credits;
    }
    if (options.tags) {
        settings.tags = options.tags;
    }
    Object.assign(settings, options.projectSettings);
    Object.assign(settings, { enabledExtensionIds: options.enabledExtensionIds });
    if (options.provenance) {
        settings.legacyBlueprintSource = JSON.stringify(options.provenance);
    }

    const document = {
        settings,
        roots: options.roots.map(function toWireRoot(root): NixieYjsBoardNodeSnapshot {
            return { ...root, id: String(root.id), children: root.children.map(toWireRoot) };
        }),
        folders: [],
        assets: options.assets,
        updatedAt,
    };

    if (options.offline) {
        await importNixieOfflineProjectSnapshot(options.projectId, {
            ...document,
            folders: [],
            assets: options.assets,
        });
        touchNixieLocalProject(options.projectId, { name: options.name });
        return;
    }

    await $fetch(`/api/nixie/projects/${encodeURIComponent(options.projectId)}/yjs-snapshot`, {
        method: 'POST',
        body: { document },
    });
}

export async function isLegacyPlanImportCandidate(file: File): Promise<boolean> {
    const name = normalizeString(file.name).toLowerCase();
    if (name.endsWith('.plan')) {
        return true;
    }
    if (name.endsWith('.json') || name.endsWith('.zip') || name.endsWith('.project.zip')) {
        return await isLegacyPlanArchiveBytes(await file.arrayBuffer());
    }
    return false;
}

/** Prepare a portable template without editing a project or prompting during Palette warmup. */
export async function prepareLegacyBlueprintFile(file: File, source: LegacyBlueprintProvenance) {
    const result = await new LegacyPlanImporter({ fixtureName: file.name, boundedArchive: true }).importArchive(await file.arrayBuffer());
    if (result.report.unresolvedBuildingKeys.length || result.report.unresolvedSocketIds.length) {
        throw new Error('This Blueprint contains unresolved structures or socket references. View the source in Foxhole Planner.');
    }
    const roots = [...result.boardSnapshots];
    for (const pending of result.pendingImages) {
        const image = createLegacyPlanImageFile({ pending, assets: result.archive.assets });
        if ('unresolved' in image) throw new Error('This Blueprint contains missing image data.');
        const snapshot = createLegacyPlanImageSpriteSnapshot({ projectId: 'palette', pending,
            asset: { id: String(pending.legacyId), displayName: image.file.name, originalFilename: image.file.name,
                mimeType: image.file.type, width: pending.width, height: pending.height } });
        snapshot.state.textureUrl = await paletteBlobDataUrl(image.file);
        delete snapshot.state.projectAssetId;
        roots.push(snapshot);
    }
    if (!roots.length) throw new Error('This Blueprint has no insertable content.');
    return { roots, provenance: { ...await pinLegacyBlueprintConversion(source) } };
}

export async function insertLegacyBlueprintFile(file: File, source: LegacyBlueprintProvenance, context: NixieCommandContext): Promise<boolean> {
    let target = captureDiscoveryInsertTarget(context);
    await context.finalizeSelectionPlacement();
    target.assertCurrent();
    const result = await new LegacyPlanImporter({ fixtureName: file.name, boundedArchive: true }).importArchive(await file.arrayBuffer());
    if (result.report.unresolvedBuildingKeys.length || result.report.unresolvedSocketIds.length) {
        throw new Error('This Blueprint contains unresolved structures or socket references. View the source in Foxhole Planner.');
    }
    target.assertCurrent();
    const provenance = await pinLegacyBlueprintConversion(source);
    if (!result.boardSnapshots.length && !result.pendingImages.length) {
        throw new Error('This Blueprint has no insertable content.');
    }
    if (result.pendingImages.some(pending => 'unresolved' in createLegacyPlanImageFile({ pending, assets: result.archive.assets }))) {
        throw new Error('This Blueprint contains missing image data. View the source in Foxhole Planner.');
    }
    if (!await confirmDiscoveryExtensions(target, ['foxhole'])) return false;
    target = captureDiscoveryInsertTarget(context, ['foxhole']);
    const ids = await runDiscoveryImagePreparation(target.assertCurrent, async recordCompletedUpload => {
        const images = await materializeLegacyPlanImages({ projectId: target.project.id, result, strict: true,
            assertCurrent: target.assertCurrent, recordCompletedUpload,
            catalogAssets: () => target.project.yjsSession.exportSnapshot().assets });
        return commitDiscoveryInsertion({ target, roots: [...result.boardSnapshots, ...images.snapshots], assets: images.assets, provenance: { ...provenance } });
    });
    context.setSelectedNodeIds(ids, 'discovery:insert:select');
    if (result.report.hasReportableFindings) {
        openLegacyPlanImportReportDialog(result.report);
    }
    return true;
}

/**
 * Import an already-selected legacy plan file into a new Nixie project.
 */
export async function importLegacyPlanFile(
    planFile: File,
    options: NixieImportProjectArchiveOptions & { provenance?: LegacyBlueprintProvenance; } = {},
): Promise<string | null> {
    const bytes = await planFile.arrayBuffer();
    const result = await new LegacyPlanImporter({
        fixtureName: planFile.name,
        boundedArchive: Boolean(options.provenance),
    }).importArchive(bytes);

    if (!result.boardSnapshots.length && !result.pendingImages.length) {
        throw new Error('This legacy plan did not contain any importable structures, shapes, icons, or images.');
    }

    const suggestedName = normalizeString(options.initialName) || normalizeString(result.stubDocument.name)
        || normalizeString(stripLegacyPlanExtension(planFile.name))
        || 'Imported Legacy Plan';

    const user = useSupabaseUser();
    const creation = await requestNewProjectCreation({
        mode: 'import',
        initialName: suggestedName,
        initialExtensionIds: ['foxhole'],
        guestOnly: !user.value,
        initialSurface: options.initialSurface,
        initialWorkspaceId: normalizeString(options.initialWorkspaceId) || undefined,
    });
    if (!creation) {
        return null;
    }

    const name = normalizeString(creation.name) || suggestedName;
    const target = creation.target;
    const offline = target.kind === 'offline';
    if (options.provenance && (result.report.unresolvedBuildingKeys.length || result.report.unresolvedSocketIds.length)) {
        throw new Error('This Blueprint contains unresolved structures or socket references. View the source in Foxhole Planner.');
    }

    let projectId = '';
    let persisted = false;
    try {
        if (target.kind === 'offline') {
            projectId = createNixieLocalProject(name).id;
        } else {
            projectId = await createProjectRecord({
                name,
                target,
                enabledExtensionIds: [...new Set([...creation.enabledExtensionIds, 'foxhole'])],
            });
        }

        const materializedImages = await materializeLegacyPlanImages({
            projectId,
            result,
            strict: Boolean(options.provenance),
        });

        const identity = mapLegacyPlanIdentitySettings(result.upgradedSave);
        const projectSettings = mapLegacyPlanProjectSettings(result.upgradedSave.projectSettings);
        if (options.provenance) {
            identity.credits = options.provenance.credits;
        }
        if (!result.boardSnapshots.length && !materializedImages.snapshots.length) {
            throw new Error('This legacy plan did not contain any importable content.');
        }

        await writeLegacyPlanRoots({
            projectId,
            name,
            ...identity,
            projectSettings,
            provenance: options.provenance ? await pinLegacyBlueprintConversion(options.provenance) : undefined,
            enabledExtensionIds: [...new Set([...creation.enabledExtensionIds, 'foxhole'])],
            roots: [
                ...result.boardSnapshots,
                ...materializedImages.snapshots,
            ],
            assets: materializedImages.assets,
            offline,
        });

        persisted = true;

        await loadProjectSummaries({ force: true }).catch(() => {});
        setLastOpenedProjectId(projectId);
        await navigateTo(buildNixieEditorRoute(projectId));

        const shouldOpenReport = result.report.hasReportableFindings;
        showNxToast({
            kind: shouldOpenReport ? 'warning' : 'success',
            title: 'Legacy Plan Imported',
            message: buildImportToastMessage(result, materializedImages.snapshots.length),
            actionLabel: 'View Report',
            onClick: () => {
                openLegacyPlanImportReportDialog(result.report);
            },
        });
        if (shouldOpenReport) {
            openLegacyPlanImportReportDialog(result.report);
        }

        return projectId;
    } catch (error) {
        if (projectId && !persisted) {
            if (offline) {
                removeNixieLocalProject(projectId);
            } else {
                try {
                    await $fetch(`/api/nixie/projects/${encodeURIComponent(projectId)}`, { method: 'DELETE' });
                } catch {
                    throw new Error(`Import failed and its new project could not be removed. Remove project ${projectId} from your workspace.`, { cause: error });
                }
            }
        }
        throw error;
    }
}
