import { showNxToast } from '#nixie/composables/useNxToast.ts';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { isBoardNodePlacementProvider } from '#nixie/plugins/nixie/board/types/node.ts';
import type { FoxholeStructureAsset } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { getFoxholeStructureCatalog } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { createFoxholeStructureAssetSnapshot } from '#foxhole/plugins/foxhole/nixie/structure-asset-snapshot.ts';

let placing = false;

/**
 * Place a Foxhole structure/vehicle into the scene from an assistant chip click.
 * Mirrors assets-browser placement (center of viewport, then desktop placement drag).
 */
export async function placeFoxholeAssistantStructure(options: {
    structure: FoxholeStructureAsset;
    label?: string;
    assetsBaseUrl: string;
    reason?: string;
}): Promise<boolean> {
    if (placing) {
        return false;
    }

    const runtime = useNixieRuntime();
    if (!runtime.canEdit.value) {
        showNxToast({
            kind: 'warning',
            message: 'This project is read-only, so the asset could not be placed.',
        });
        return false;
    }

    const catalog = getFoxholeStructureCatalog(options.assetsBaseUrl);
    const asset = options.structure;
    const label = String(options.label ?? asset.name ?? asset.foxholeKey).trim() || asset.foxholeKey;
    const structure = catalog.structureByKey[asset.foxholeKey]
        ?? catalog.structureByKey[asset.foxholeKey.toLowerCase()]
        ?? null;
    const parentAsset = asset.parentStructureId
        ? (catalog.assetByKey[String(asset.parentStructureId).trim()]
            ?? catalog.assetByKey[String(asset.parentStructureId).trim().toLowerCase()]
            ?? null)
        : null;

    const viewport = runtime.session.viewportRef.value;
    const worldPosition = viewport
        ? viewport.toWorld((viewport.screenWidth ?? 0) / 2, (viewport.screenHeight ?? 0) / 2)
        : { x: 0, y: 0 };

    const snapshot = createFoxholeStructureAssetSnapshot({
        asset,
        structure,
        parentAsset,
        label,
        x: worldPosition.x,
        y: worldPosition.y,
        z: 0,
    });

    placing = true;
    try {
        const created = await runtime.projectStore.createNode(
            snapshot,
            undefined,
            undefined,
            options.reason || 'foxhole-assistant:place-structure',
        );
        if (!created) {
            showNxToast({
                kind: 'error',
                message: `Could not place ${label}.`,
            });
            return false;
        }

        const commandContext = runtime.createCommandContext();
        const nodeId = String(snapshot.id);
        commandContext.setSelectedNodeIds([nodeId], 'foxhole-assistant:select');

        const placedNode = commandContext.project.scene.getNodeById(nodeId);
        if (isBoardNodePlacementProvider(placedNode)) {
            commandContext.setToolOptions('selection', {
                assetPlacementRequest: { nodeId },
            });
        }
        await commandContext.beginSelectionPlacement([nodeId]);

        return true;
    } finally {
        placing = false;
    }
}
