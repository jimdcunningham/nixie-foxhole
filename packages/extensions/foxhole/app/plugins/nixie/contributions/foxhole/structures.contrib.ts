import FoxholeStructureInspectorCard from '#foxhole/components/nixie/foxhole/FoxholeStructureInspectorCard.vue';

import { createFoxholeAssetsBaseUrl, getFoxholeItemCatalog, getFoxholeStructureCatalog, resolveFoxholeSharedPackagedPalletFromCatalog, resolveFoxholeTextureUrl } from '#foxhole/plugins/foxhole/nixie/catalog.ts';


import {
    foxholeRangeDebugUserSettings,
    foxholeRangeUserSettings,
} from '#foxhole/plugins/foxhole/nixie/range-settings.ts';
import { getFoxholeProductionIndex } from '#foxhole/plugins/foxhole/nixie/production/index.ts';
import { resolveFoxholeProductionOverlayOutputs } from '#foxhole/plugins/foxhole/nixie/production/overlay-outputs.ts';
import type { FoxholeProductionOverlayOutput } from '#foxhole/plugins/foxhole/nixie/production/overlay-outputs.ts';
import { foxholeStructureDebugSettings } from '#foxhole/plugins/foxhole/nixie/structure-debug-settings.ts';

import {
    FOXHOLE_COMMANDS_SETTINGS_PAGE_SECTION,
    withCommandSettingsPageSection,
} from '#foxhole/plugins/foxhole/nixie/settings-page-sections.ts';
import { foxholeStructureStateSchema } from '#foxhole/plugins/foxhole/nixie/schema.ts';
import { remapFoxholeStructureSnapshotCloneReferences } from '#foxhole/plugins/foxhole/nixie/snapshot-clone-references.ts';
import { resolveFoxholeStructureTierMutation } from '#foxhole/plugins/foxhole/nixie/structure-tier-actions.ts';
import type { FoxholeStructureTierDirection, FoxholeStructureTierMutation } from '#foxhole/plugins/foxhole/nixie/structure-tier-actions.ts';

import { getFoxholeSnapshotDependencies } from '#foxhole/plugins/foxhole/nixie/snapshot-dependencies.ts';
import { FOXHOLE_ASSET_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/types.ts';
import { FOXHOLE_CONNECTOR_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/connector.ts';
import { FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/spline-connector.ts';
import type { FoxholeStructureState } from '#foxhole/plugins/foxhole/nixie/types.ts';
import { FoxholeStructureNode } from '#foxhole/plugins/nixie/board/types/foxhole-structure.ts';
import { NX_BOOTSTRAP_LIGHTNING_SVG } from '#nixie/utils/nx-bootstrap-lightning.ts';
import { createFoxholeItemHoverEntry } from '#foxhole/plugins/foxhole/nixie/inspector-hover-entry.ts';
import type { NixieResolvedAssetEntry } from '#nixie/plugins/nixie/registry/index.ts';

import { createNixieHitboxNodeId, createNixieHitboxSnapshot } from '#nixie/plugins/nixie/contributions/assets/shared/hitbox.ts';
import { registerNixieHitboxHostNodeType } from '#nixie/plugins/nixie/board/parenting.ts';
import { listHitboxChildren } from '#nixie/plugins/nixie/board/utils/hitbox-host.ts';
import { getHitboxHostSizeScale, readHitboxHostMetrics, scaleHitboxPointsToCurrentHostLocal } from '#nixie/plugins/nixie/board/utils/hitbox-texture.ts';
import type { NixieHitboxState } from '#nixie/plugins/nixie/contributions/assets/shared/hitbox.ts';
import { canDissolveHitboxPolygons, dissolveHitboxPolygons } from '#foxhole/plugins/foxhole/nixie/hitbox-dissolve.ts';
import { defineContribution } from '#nixie/plugins/nixie/registry/index.ts';

import { NIXIE_DEBUG_MENU_ID } from '#nixie/plugins/nixie/registry/menu-ids.ts';
import type { NixieCommandContext } from '#nixie/plugins/nixie/registry/types.ts';
import type { NixieProjectOperation } from '#nixie/plugins/nixie/project.ts';

const FOXHOLE_ASSET_BASE_URL = createFoxholeAssetsBaseUrl('/');
const FOXHOLE_CATALOG = getFoxholeStructureCatalog(FOXHOLE_ASSET_BASE_URL);
const FOXHOLE_ITEM_CATALOG = getFoxholeItemCatalog(FOXHOLE_ASSET_BASE_URL);
const FOXHOLE_PRODUCTION_INDEX = getFoxholeProductionIndex(FOXHOLE_ASSET_BASE_URL);
const FOXHOLE_STRUCTURE_POWER_DELTA_BY_ID = Object.fromEntries(
    Object.values(FOXHOLE_CATALOG.structureByKey).map(structure => [
        structure.id,
        structure.powerGridInfo?.powerDelta ?? null,
    ]),
);
const FOXWATCH_RENDER_PIXELS_PER_METER = 64;
const FOXHOLE_BOARD_PIXELS_PER_METER = 32;
const CENTIMETERS_PER_METER = 100;
const FOXHOLE_HITBOX_CLIPBOARD_KIND = 'foxhole-hitboxes';
const FOXHOLE_HITBOX_CLIPBOARD_VERSION = 1;

registerNixieHitboxHostNodeType(FOXHOLE_ASSET_NODE_TYPE);
function resolveFoxholeOverlayItemIconUrl(codename: string): string | null {
    const key = String(codename ?? '').trim();
    if (!key) {
        return null;
    }
    const item = FOXHOLE_ITEM_CATALOG.assetByKey[key]
        ?? FOXHOLE_ITEM_CATALOG.assetByKey[key.toLowerCase()];
    if (item?.iconUrl || item?.previewIconUrl) {
        return item.iconUrl ?? item.previewIconUrl;
    }
    const structure = FOXHOLE_CATALOG.assetByKey[key]
        ?? FOXHOLE_CATALOG.assetByKey[key.toLowerCase()];
    return structure?.iconUrl ?? structure?.previewIconUrl ?? null;
}

const overlayHoverEntries = new Map<string, NixieResolvedAssetEntry>();
function resolveFoxholeOverlayItemHoverEntry(codename: string): NixieResolvedAssetEntry | null {
    const key = String(codename ?? '').trim();
    if (!key) {
        return null;
    }
    const cached = overlayHoverEntries.get(key);
    if (cached) {
        return cached;
    }
    const item = FOXHOLE_ITEM_CATALOG.assetByKey[key]
        ?? FOXHOLE_ITEM_CATALOG.assetByKey[key.toLowerCase()]
        ?? null;
    const structure = FOXHOLE_CATALOG.assetByKey[key]
        ?? FOXHOLE_CATALOG.assetByKey[key.toLowerCase()];
    const entry = createFoxholeItemHoverEntry(
        item,
        key,
        (asset, fallback) => asset?.name ?? structure?.name ?? (fallback === 'power' ? 'Power' : fallback),
        asset => asset?.description ?? structure?.description ?? '',
        asset => asset?.categoryName ?? 'Production',
    );
    entry.iconUrl = entry.iconUrl || resolveFoxholeOverlayItemIconUrl(key) || '';
    if (!item && key === 'power') {
        entry.iconUrl = `data:image/svg+xml,${encodeURIComponent(NX_BOOTSTRAP_LIGHTNING_SVG)}`;
    }
    overlayHoverEntries.set(key, entry);
    return entry;
}

function resolveFoxholeStructureProductionOverlayOutputs(recipeId: string): FoxholeProductionOverlayOutput[] {
    const recipe = FOXHOLE_PRODUCTION_INDEX.recipeById[String(recipeId ?? '').trim()];
    if (!recipe) {
        return [];
    }
    return resolveFoxholeProductionOverlayOutputs(
        recipe,
        FOXHOLE_STRUCTURE_POWER_DELTA_BY_ID[recipe.sourceStructureId],
    );
}

interface FoxholeSelectionTierMutationEntry {
    nodeId: string;
    mutation: FoxholeStructureTierMutation;
}

function collectFoxholeSelectionTierMutationEntries(
    context: NixieCommandContext,
    direction: FoxholeStructureTierDirection,
): FoxholeSelectionTierMutationEntry[] {
    const selectedNodeIds = Array.from(new Set(context.getSelectedNodeIds().map(id => String(id ?? '').trim()).filter(Boolean)));
    return selectedNodeIds.flatMap(nodeId => {
        const node = context.project.scene.getNodeById(nodeId);
        const snapshot = node?.toBoardSnapshot();
        if (!snapshot || snapshot.type !== FOXHOLE_ASSET_NODE_TYPE) {
            return [];
        }

        const state = (snapshot.state ?? {}) as Partial<FoxholeStructureState>;
        if (state.destroyed === true || state.packaged === true) {
            return [];
        }

        const mutation = resolveFoxholeStructureTierMutation(FOXHOLE_CATALOG, state, direction);
        return mutation ? [{ nodeId, mutation }] : [];
    });
}

function canRunFoxholeSelectionTierCommand(
    context: NixieCommandContext,
    direction: FoxholeStructureTierDirection,
): boolean {
    if (!context.capabilities.canEdit) {
        return false;
    }

    const entries = collectFoxholeSelectionTierMutationEntries(context, direction);
    return entries.length > 0 && context.project.canMutateNodeIds(entries.map(entry => entry.nodeId));
}

function createFoxholeSelectionTierMutationGroupKey(patch: Record<string, unknown>): string {
    return JSON.stringify(patch);
}

function cloneFoxholeTierMutationValue<T>(value: T): T {
    if (typeof structuredClone === 'function') {
        return structuredClone(value);
    }

    return JSON.parse(JSON.stringify(value)) as T;
}

function buildFoxholeSelectionTierInversePatch(
    state: Partial<FoxholeStructureState>,
): Pick<FoxholeStructureState, 'foxholeKey' | 'modificationVariantIds'> {
    return {
        foxholeKey: String(state.foxholeKey ?? '').trim(),
        modificationVariantIds: cloneFoxholeTierMutationValue(state.modificationVariantIds ?? {}),
    };
}

async function runFoxholeSelectionTierCommand(
    context: NixieCommandContext,
    direction: FoxholeStructureTierDirection,
    reason: string,
): Promise<void> {
    const entries = collectFoxholeSelectionTierMutationEntries(context, direction);
    const eligibleNodeIds = entries.map(entry => entry.nodeId);
    if (!eligibleNodeIds.length || !context.project.canMutateNodeIds(eligibleNodeIds)) {
        return;
    }

    const operations: NixieProjectOperation[] = [];
    const inverseOperations: NixieProjectOperation[] = [];
    for (const entry of entries) {
        const node = context.project.scene.getNodeById(entry.nodeId);
        const snapshot = node?.toBoardSnapshot();
        if (!snapshot || snapshot.type !== FOXHOLE_ASSET_NODE_TYPE) {
            continue;
        }

        const currentState = (snapshot.state ?? {}) as Partial<FoxholeStructureState>;
        const patch = cloneFoxholeTierMutationValue(entry.mutation.patch as Record<string, unknown>);
        operations.push({
            type: 'update',
            nodeId: entry.nodeId,
            patch,
        });
        inverseOperations.unshift({
            type: 'update',
            nodeId: entry.nodeId,
            patch: buildFoxholeSelectionTierInversePatch(currentState),
        });
    }

    if (!operations.length) {
        return;
    }

    await context.project.executeBatch(
        operations,
        inverseOperations,
        reason,
        direction === 'down' ? 'Tier Down Foxhole Structures' : 'Tier Up Foxhole Structures',
    );
}

function getSingleSelectedFoxholeStructure(context: NixieCommandContext): FoxholeStructureNode | null {
    const selectedIds = context.getSelectedNodeIds();
    if (selectedIds.length !== 1) {
        return null;
    }
    const node = context.project.scene.getNodeById(selectedIds[0]!);
    return node instanceof FoxholeStructureNode ? node : null;
}

function exportFoxholeLineOfSightOverride(context: NixieCommandContext): void {
    const structure = getSingleSelectedFoxholeStructure(context);
    const foxholeKey = String(structure?.boardState.foxholeKey ?? '').trim().toLowerCase();
    if (!structure || !foxholeKey) {
        return;
    }

    const metrics = readHitboxHostMetrics(structure);
    const lineOfSightPolygons = listHitboxChildren(structure)
        .map(hitbox => {
            const state = hitbox.boardState as NixieHitboxState;
            const points = scaleHitboxPointsToCurrentHostLocal(
                state.points,
                Number(state.basisWidth) || metrics.width,
                Number(state.basisHeight) || metrics.height,
                metrics,
            ).map(point => Math.round((point / FOXHOLE_BOARD_PIXELS_PER_METER) * 1000) / 1000);
            return { shape: points };
        })
        .filter(polygon => polygon.shape.length >= 6);
    if (lineOfSightPolygons.length === 0 || typeof window === 'undefined') {
        return;
    }

    const blob = new Blob([JSON.stringify({ lineOfSightPolygons }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a');
    link.href = url;
    link.download = `${foxholeKey}.manifest.json`;
    link.click();
    URL.revokeObjectURL(url);
}

async function copyFoxholeLineOfSightAgentPrompt(context: NixieCommandContext): Promise<void> {
    const structure = getSingleSelectedFoxholeStructure(context);
    const foxholeKey = String(structure?.boardState.foxholeKey ?? '').trim().toLowerCase();
    if (!structure || !foxholeKey) {
        return;
    }
    const metrics = readHitboxHostMetrics(structure);
    const lineOfSightPolygons = listHitboxChildren(structure)
        .map(hitbox => {
            const state = hitbox.boardState as NixieHitboxState;
            return {
                shape: scaleHitboxPointsToCurrentHostLocal(
                    state.points,
                    Number(state.basisWidth) || metrics.width,
                    Number(state.basisHeight) || metrics.height,
                    metrics,
                ).map(point => Math.round((point / FOXHOLE_BOARD_PIXELS_PER_METER) * 1000) / 1000),
            };
        })
        .filter(polygon => polygon.shape.length >= 6);
    if (!lineOfSightPolygons.length) {
        return;
    }
    await context.clipboard.writeText([
        `Update the authored FoxWatch override for \`${foxholeKey}\`.`,
        '',
        'Repository: `https://github.com/jimdcunningham/nixie-foxhole`',
        '',
        `Edit \`tools/foxwatch/asset-overrides/${foxholeKey}/manifest.json\` and set \`lineOfSightPolygons\` to exactly:`,
        '```json',
        JSON.stringify(lineOfSightPolygons, null, 2),
        '```',
        '',
        `Preserve every other existing manifest property. From the nixie-foxhole repository root, run \`node ./tools/foxwatch/run-foxwatch.mjs refresh --only ${foxholeKey}\` to refresh the generated Foxhole assets. Do not edit generated public manifests directly.`,
    ].join('\n'));
}

async function addFoxholeLineOfSightHitbox(context: NixieCommandContext): Promise<void> {
    const structure = getSingleSelectedFoxholeStructure(context);
    if (!structure || !context.project.capabilities.value.canEdit) {
        return;
    }

    const metrics = readHitboxHostMetrics(structure);
    const existingCount = listHitboxChildren(structure).length;
    const fallback = [
        -metrics.width * metrics.anchorX, -metrics.height * metrics.anchorY,
        metrics.width * (1 - metrics.anchorX), -metrics.height * metrics.anchorY,
        metrics.width * (1 - metrics.anchorX), metrics.height * (1 - metrics.anchorY),
        -metrics.width * metrics.anchorX, metrics.height * (1 - metrics.anchorY),
    ];
    // Reuse the asset's authored LOS shape whenever it has one, so every added
    // hitbox begins at the same useful size instead of an arbitrary editor box.
    const points = structure.getDefaultLineOfSightHitboxes()[0]?.slice() ?? fallback;
    const created = await context.project.createNode(createNixieHitboxSnapshot({
        id: createNixieHitboxNodeId(),
        points,
        name: existingCount === 0 ? 'solid' : `solid-${existingCount + 1}`,
        role: 'solid',
        basisWidth: metrics.width,
        basisHeight: metrics.height,
    }), String(structure.boardId), undefined, 'foxhole-hitbox-add:create');

    if (created) {
        context.setSelectedNodeIds([String(structure.boardId)], 'foxhole-hitbox-add:select');
    }
}

async function ensureFoxholeLineOfSightHitboxes(context: NixieCommandContext): Promise<void> {
    const structure = getSingleSelectedFoxholeStructure(context);
    if (!structure || !context.project.capabilities.value.canEdit || listHitboxChildren(structure).length > 0) {
        return;
    }
    const metrics = readHitboxHostMetrics(structure);
    const sourcePolygons = structure.getDefaultLineOfSightHitboxes();
    if (sourcePolygons.length === 0) {
        return;
    }
    for (const [index, points] of sourcePolygons.entries()) {
        await context.project.createNode(createNixieHitboxSnapshot({
            id: createNixieHitboxNodeId(),
            points,
            name: index === 0 ? 'solid' : `solid-${index + 1}`,
            role: 'solid',
            basisWidth: metrics.width,
            basisHeight: metrics.height,
        }), String(structure.boardId), undefined, 'foxhole-hitbox-ensure:create');
    }
    context.setSelectedNodeIds([String(structure.boardId)], 'foxhole-hitbox-ensure:select');
}

async function dissolveFoxholeLineOfSightHitboxTriangles(context: NixieCommandContext): Promise<void> {
    const structure = getSingleSelectedFoxholeStructure(context);
    if (!structure || !context.project.capabilities.value.canEdit) {
        return;
    }
    const metrics = readHitboxHostMetrics(structure);
    const hitboxes = listHitboxChildren(structure)
        .map(hitbox => ({ hitbox, state: hitbox.boardState as NixieHitboxState }))
        .filter(({ state }) => state.points.length >= 6 && state.points.length % 2 === 0);
    const hitboxesByRole = new Map<NixieHitboxState['role'], typeof hitboxes>();
    for (const entry of hitboxes) {
        const entries = hitboxesByRole.get(entry.state.role) ?? [];
        entries.push(entry);
        hitboxesByRole.set(entry.state.role, entries);
    }

    let changed = false;
    for (const entries of hitboxesByRole.values()) {
        const dissolved = dissolveHitboxPolygons(entries.map(({ state }) => scaleHitboxPointsToCurrentHostLocal(
            state.points,
            Number(state.basisWidth) || metrics.width,
            Number(state.basisHeight) || metrics.height,
            metrics,
        )));
        if (!dissolved || dissolved.length >= entries.length) {
            continue;
        }
        for (const [index, points] of dissolved.entries()) {
            const { hitbox, state } = entries[index]!;
            const { scaleX, scaleY } = getHitboxHostSizeScale(
                Number(state.basisWidth) || metrics.width,
                Number(state.basisHeight) || metrics.height,
                metrics,
            );
            await context.project.patchNode(String(hitbox.boardId), {
                points: points.map((point, pointIndex) => point / (pointIndex % 2 === 0 ? scaleX : scaleY)),
                basisWidth: metrics.width,
                basisHeight: metrics.height,
            }, 'foxhole-hitbox-dissolve:update');
        }
        for (const { hitbox } of entries.slice(dissolved.length)) {
            await context.project.deleteNode(String(hitbox.boardId), 'foxhole-hitbox-dissolve:delete');
        }
        changed = true;
    }
    if (changed) {
        context.setSelectedNodeIds([String(structure.boardId)], 'foxhole-hitbox-dissolve:select');
    }
}

type FoxholeHitboxClipboardPayload = {
    kind: typeof FOXHOLE_HITBOX_CLIPBOARD_KIND;
    version: typeof FOXHOLE_HITBOX_CLIPBOARD_VERSION;
    polygons: Array<{
        points: number[];
        name?: string;
        role?: NixieHitboxState['role'];
    }>;
};

function parseFoxholeHitboxClipboardPayload(value: string): FoxholeHitboxClipboardPayload | null {
    try {
        const parsed = JSON.parse(value) as Partial<FoxholeHitboxClipboardPayload>;
        if (parsed.kind !== FOXHOLE_HITBOX_CLIPBOARD_KIND
            || parsed.version !== FOXHOLE_HITBOX_CLIPBOARD_VERSION
            || !Array.isArray(parsed.polygons)) {
            return null;
        }
        const polygons = parsed.polygons
            .filter((polygon): polygon is { points: unknown; name?: unknown; role?: unknown; } => !!polygon && typeof polygon === 'object')
            .map(polygon => ({
                points: Array.isArray(polygon.points)
                    ? polygon.points.filter((point): point is number => typeof point === 'number' && Number.isFinite(point))
                    : [],
                ...(typeof polygon.name === 'string' ? { name: polygon.name } : {}),
                ...(polygon.role === 'solid' || polygon.role === 'hurt' || polygon.role === 'sensor' || polygon.role === 'custom'
                    ? { role: polygon.role }
                    : {}),
            }))
            .filter(polygon => polygon.points.length >= 6 && polygon.points.length % 2 === 0);
        return polygons.length > 0 ? { kind: parsed.kind, version: parsed.version, polygons } : null;
    } catch {
        return null;
    }
}

async function copyFoxholeLineOfSightHitboxes(context: NixieCommandContext): Promise<void> {
    const structure = getSingleSelectedFoxholeStructure(context);
    if (!structure) {
        return;
    }
    const metrics = readHitboxHostMetrics(structure);
    if (!(metrics.width > 0) || !(metrics.height > 0)) {
        return;
    }
    const polygons = listHitboxChildren(structure).map(hitbox => {
        const state = hitbox.boardState as NixieHitboxState;
        const localPoints = scaleHitboxPointsToCurrentHostLocal(
            state.points,
            Number(state.basisWidth) || metrics.width,
            Number(state.basisHeight) || metrics.height,
            metrics,
        );
        return {
            points: localPoints.map((point, index) => index % 2 === 0
                ? (point / metrics.width) + metrics.anchorX
                : (point / metrics.height) + metrics.anchorY),
            name: state.name,
            role: state.role,
        };
    }).filter(polygon => polygon.points.length >= 6);
    if (!polygons.length) {
        return;
    }
    await context.clipboard.writeText(JSON.stringify({
        kind: FOXHOLE_HITBOX_CLIPBOARD_KIND,
        version: FOXHOLE_HITBOX_CLIPBOARD_VERSION,
        polygons,
    } satisfies FoxholeHitboxClipboardPayload));
}

async function pasteFoxholeLineOfSightHitboxes(context: NixieCommandContext): Promise<void> {
    const structure = getSingleSelectedFoxholeStructure(context);
    if (!structure || !context.project.capabilities.value.canEdit) {
        return;
    }
    const payload = parseFoxholeHitboxClipboardPayload(await context.clipboard.readText());
    if (!payload) {
        return;
    }
    const metrics = readHitboxHostMetrics(structure);
    const existingCount = listHitboxChildren(structure).length;
    let createdCount = 0;
    for (const polygon of payload.polygons) {
        const points = polygon.points.map((point, index) => index % 2 === 0
            ? (point - metrics.anchorX) * metrics.width
            : (point - metrics.anchorY) * metrics.height);
        const created = await context.project.createNode(createNixieHitboxSnapshot({
            id: createNixieHitboxNodeId(),
            points,
            name: polygon.name?.trim() || `solid-${existingCount + createdCount + 1}`,
            role: polygon.role ?? 'solid',
            basisWidth: metrics.width,
            basisHeight: metrics.height,
        }), String(structure.boardId), undefined, 'foxhole-hitbox-paste:create');
        if (created) {
            createdCount += 1;
        }
    }
    if (createdCount > 0) {
        context.setSelectedNodeIds([String(structure.boardId)], 'foxhole-hitbox-paste:select');
    }
}

function exportFoxholeLineOfSightHandoff(context: NixieCommandContext): void {
    const entries = context.getSelectedNodeIds()
        .map(id => context.project.scene.getNodeById(id))
        .filter((node): node is FoxholeStructureNode => node instanceof FoxholeStructureNode)
        .map(structure => {
            const foxholeKey = String(structure.boardState.foxholeKey ?? '').trim().toLowerCase();
            const metrics = readHitboxHostMetrics(structure);
            const lineOfSightPolygons = listHitboxChildren(structure).map(hitbox => {
                const state = hitbox.boardState as NixieHitboxState;
                return { shape: scaleHitboxPointsToCurrentHostLocal(state.points, Number(state.basisWidth) || metrics.width, Number(state.basisHeight) || metrics.height, metrics)
                    .map(point => Math.round((point / FOXHOLE_BOARD_PIXELS_PER_METER) * 1000) / 1000) };
            }).filter(polygon => polygon.shape.length >= 6);
            return { foxholeKey, lineOfSightPolygons };
        })
        .filter(entry => entry.foxholeKey && entry.lineOfSightPolygons.length > 0);
    const uniqueEntries = [...new Map(entries.map(entry => [entry.foxholeKey, entry])).values()];
    if (uniqueEntries.length === 0 || typeof window === 'undefined') return;
    const handoff = {
        kind: 'foxhole-line-of-sight-handoff', version: 1,
        repository: 'https://github.com/jimdcunningham/nixie-foxhole',
        instructions: 'In the nixie-foxhole repository, merge each lineOfSightPolygons value into tools/foxwatch/asset-overrides/<foxholeKey>/manifest.json, then run node ./tools/foxwatch/run-foxwatch.mjs refresh --only <comma-separated foxholeKey values> from that repository root.',
        overrides: uniqueEntries,
    };
    const payload = JSON.stringify(handoff, null, 2);
    void context.clipboard.writeText(payload);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement('a'); link.href = url; link.download = 'foxhole-line-of-sight-handoff.json'; link.click(); URL.revokeObjectURL(url);
}

export default defineContribution({
    settings: [
        ...foxholeRangeUserSettings,
        ...foxholeRangeDebugUserSettings,
        ...foxholeStructureDebugSettings,
    ],
    commands: withCommandSettingsPageSection([
        {
            id: 'foxhole.selection.tierDown',
            type: 'editor',
            icon: 'ph:arrow-down',
            name: 'Tier Down Foxhole Structures',
            description: 'Downgrade selected Foxhole structures, including clearing active facility upgrades back to their base structure.',
            defaultKeybinding: {
                primary: { key: '[' },
            },
            enabled: context => canRunFoxholeSelectionTierCommand(context, 'down'),
            run: async context => {
                await runFoxholeSelectionTierCommand(context, 'down', 'command:foxhole.selection.tierDown');
            },
        },
        {
            id: 'foxhole.selection.tierUp',
            type: 'editor',
            icon: 'ph:arrow-up',
            name: 'Tier Up Foxhole Structures',
            description: 'Upgrade selected Foxhole structures to their next explicit tier when available.',
            defaultKeybinding: {
                primary: { key: ']' },
            },
            enabled: context => canRunFoxholeSelectionTierCommand(context, 'up'),
            run: async context => {
                await runFoxholeSelectionTierCommand(context, 'up', 'command:foxhole.selection.tierUp');
            },
        },
        {
            id: 'foxhole.lineOfSight.addHitbox',
            type: 'editor',
            icon: 'ph:plus-circle',
            name: 'Add Foxhole Hitbox',
            description: 'Add a centered rectangle hitbox to the selected asset.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => Boolean(getSingleSelectedFoxholeStructure(context) && context.project.capabilities.value.canEdit),
            run: async context => await addFoxholeLineOfSightHitbox(context),
        },
        {
            id: 'foxhole.lineOfSight.ensureHitboxes',
            type: 'editor',
            icon: 'ph:polygon',
            name: 'Prepare Foxhole Hitboxes',
            description: 'Load authored Foxhole hitboxes into the selected asset for editing.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => {
                const structure = getSingleSelectedFoxholeStructure(context);
                return Boolean(structure
                    && context.project.capabilities.value.canEdit
                    && listHitboxChildren(structure).length === 0
                    && structure.getDefaultLineOfSightHitboxes().length > 0);
            },
            run: async context => await ensureFoxholeLineOfSightHitboxes(context),
        },
        {
            id: 'foxhole.lineOfSight.dissolveTriangles',
            type: 'editor',
            icon: 'ph:magic-wand',
            name: 'Dissolve Foxhole Hitbox Triangles',
            description: 'Merge same-role hitboxes that share an edge into their outside polygons.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => {
                const structure = getSingleSelectedFoxholeStructure(context);
                if (!structure || !context.project.capabilities.value.canEdit) {
                    return false;
                }
                const metrics = readHitboxHostMetrics(structure);
                const polygonsByRole = new Map<NixieHitboxState['role'], number[][]>();
                for (const hitbox of listHitboxChildren(structure)) {
                    const state = hitbox.boardState as NixieHitboxState;
                    const polygons = polygonsByRole.get(state.role) ?? [];
                    polygons.push(scaleHitboxPointsToCurrentHostLocal(
                        state.points,
                        Number(state.basisWidth) || metrics.width,
                        Number(state.basisHeight) || metrics.height,
                        metrics,
                    ));
                    polygonsByRole.set(state.role, polygons);
                }
                return [...polygonsByRole.values()].some(polygons => canDissolveHitboxPolygons(polygons));
            },
            run: async context => await dissolveFoxholeLineOfSightHitboxTriangles(context),
        },
        {
            id: 'foxhole.lineOfSight.copyHitboxes',
            type: 'editor',
            icon: 'ph:copy',
            name: 'Copy Foxhole Hitboxes',
            description: 'Copy the selected asset’s hitboxes for another Foxhole asset.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => {
                const structure = getSingleSelectedFoxholeStructure(context);
                return Boolean(structure && listHitboxChildren(structure).length > 0);
            },
            run: async context => await copyFoxholeLineOfSightHitboxes(context),
        },
        {
            id: 'foxhole.lineOfSight.pasteHitboxes',
            type: 'editor',
            icon: 'ph:clipboard',
            name: 'Paste Foxhole Hitboxes',
            description: 'Paste copied hitboxes onto the selected asset.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => Boolean(getSingleSelectedFoxholeStructure(context) && context.project.capabilities.value.canEdit),
            run: async context => await pasteFoxholeLineOfSightHitboxes(context),
        },
        {
            id: 'foxhole.lineOfSight.exportOverride',
            type: 'editor',
            icon: 'ph:eye',
            name: 'Export Foxhole Line of Sight Override',
            description: 'Export the selected asset’s drawn hitboxes to its FoxWatch manifest override payload.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => {
                const structure = getSingleSelectedFoxholeStructure(context);
                return Boolean(structure && listHitboxChildren(structure).length > 0);
            },
            run: context => {
                exportFoxholeLineOfSightOverride(context);
            },
        },
        {
            id: 'foxhole.lineOfSight.copyAgentPrompt',
            type: 'editor',
            icon: 'ph:robot',
            name: 'Copy Foxhole Hitbox Agent Prompt',
            description: 'Copy an agent-ready FoxWatch override prompt for the selected asset.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => {
                const structure = getSingleSelectedFoxholeStructure(context);
                return Boolean(structure && listHitboxChildren(structure).length > 0);
            },
            run: async context => await copyFoxholeLineOfSightAgentPrompt(context),
        },
        {
            id: 'foxhole.lineOfSight.exportHandoff', type: 'editor', icon: 'ph:clipboard-text',
            name: 'Export Foxhole Hitbox Handoff', description: 'Download and copy all selected assets’ hitbox overrides for an agent handoff.',
            availableWhen: { accessibleInDev: true, surfaces: ['scene'] },
            enabled: context => context.getSelectedNodeIds().some(id => context.project.scene.getNodeById(id) instanceof FoxholeStructureNode),
            run: context => exportFoxholeLineOfSightHandoff(context),
        },
    ], FOXHOLE_COMMANDS_SETTINGS_PAGE_SECTION),
    menus: [
        {
            menu: NIXIE_DEBUG_MENU_ID, order: 356,
            item: { label: 'Export Hitbox Handoff', commandId: 'foxhole.lineOfSight.exportHandoff' },
        },
    ],
    textureResolvers: [
        {
            id: 'foxhole.textures',
            order: 100,
            resolveTextureUrl: (textureKey, context) => resolveFoxholeTextureUrl(
                textureKey,
                createFoxholeAssetsBaseUrl(context.appBaseUrl),
            ),
        },
    ],
    nodes: [
        {
            type: FOXHOLE_ASSET_NODE_TYPE,
            name: 'Foxhole Asset',
            description: 'A Foxhole catalog asset node for structures, vehicles, and related placements.',
            icon: 'ph:factory',
            capabilities: {
                move: true,
                rotate: true,
                scale: false,
                transformGizmo: true,
                tint: true,
            },
        },
    ],
    boardNodes: [
        {
            type: FOXHOLE_ASSET_NODE_TYPE,
            stateSchema: foxholeStructureStateSchema,
            getSnapshotDependencies: snapshot => getFoxholeSnapshotDependencies(snapshot, FOXHOLE_CATALOG),
            remapCloneReferences: (snapshot, { idMap }) => remapFoxholeStructureSnapshotCloneReferences(snapshot, idMap),
            create: (snapshot, context) => {
                const state = snapshot.state as FoxholeStructureState;
                const foxholeKey = String(state.foxholeKey ?? '').trim();
                const catalogAsset = foxholeKey ? FOXHOLE_CATALOG.assetByKey[foxholeKey] : null;

                return new FoxholeStructureNode({
                    id: snapshot.id,
                    type: snapshot.type,
                    key: snapshot.key ?? catalogAsset?.name ?? foxholeKey ?? String(snapshot.id),
                    version: snapshot.version,
                    state,
                    historyRecorder: context.historyRecorder,
                    syncAdapter: context.syncAdapter,
                    definition: {
                        assetResolver: foxholeKey => FOXHOLE_CATALOG.assetByKey[String(foxholeKey ?? '').trim()],
                        structureResolver: foxholeKey => FOXHOLE_CATALOG.structureByKey[String(foxholeKey ?? '').trim()],
                        packagedPalletResolver: shippableType => resolveFoxholeSharedPackagedPalletFromCatalog(FOXHOLE_CATALOG, shippableType),
                        modificationVisualResolver: (foxholeKey, slotId, variantId) => {
                            const asset = FOXHOLE_CATALOG.assetByKey[String(foxholeKey ?? '').trim()];
                            const slot = asset?.modificationSlotById[String(slotId ?? '').trim()];
                            const variant = slot?.variantById[String(variantId ?? '').trim()];
                            const isUpgrade = variant?.isUpgrade === true;
                            const textureUrl = variant?.textureUrl ?? null;
                            if (!textureUrl) {
                                return null;
                            }

                            const slotOffsetX = isUpgrade
                                ? 0
                                : Number(slot?.x ?? 0) * (FOXWATCH_RENDER_PIXELS_PER_METER / CENTIMETERS_PER_METER);
                            const slotOffsetY = isUpgrade
                                ? 0
                                : Number(slot?.y ?? 0) * (FOXWATCH_RENDER_PIXELS_PER_METER / CENTIMETERS_PER_METER);
                            const slotRotationDegrees = isUpgrade ? 0 : Number(slot?.rotation ?? 0);

                            return {
                                kind: 'full-structure' as const,
                                variantId: variant?.id,
                                textureUrl,
                                width: variant?.textureWidth ?? null,
                                height: variant?.textureHeight ?? null,
                                anchorX: variant?.anchorX ?? 0.5,
                                anchorY: variant?.anchorY ?? 0.5,
                                offsetX: variant?.offsetX ?? 0,
                                offsetY: variant?.offsetY ?? 0,
                                worldOffsetX: Number.isFinite(slotOffsetX) ? slotOffsetX : 0,
                                worldOffsetY: Number.isFinite(slotOffsetY) ? slotOffsetY : 0,
                                rotationDegrees: Number.isFinite(slotRotationDegrees) ? slotRotationDegrees : 0,
                            };
                        },
                        textureResolver: context.textureResolver,
                        textureUrlResolver: textureKey => resolveFoxholeTextureUrl(textureKey, FOXHOLE_ASSET_BASE_URL),
                        itemIconUrlResolver: resolveFoxholeOverlayItemIconUrl,
                        itemHoverEntryResolver: resolveFoxholeOverlayItemHoverEntry,
                        productionOutputsResolver: resolveFoxholeStructureProductionOverlayOutputs,
                    },
                });
            },
        },
    ],
    inspector: [
        {
            id: 'foxhole.inspector.structure',
            target: [
                FOXHOLE_ASSET_NODE_TYPE,
                FOXHOLE_CONNECTOR_NODE_TYPE,
                FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE,
            ],
            order: 90,
            supportsMultiTarget: true,
            component: FoxholeStructureInspectorCard,
        },

    ],
});
