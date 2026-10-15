import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import { NIXIE_URL_SPRITE_NODE_TYPE } from '#nixie/plugins/nixie/contributions/assets/shared/url-sprite.ts';
import { createRectangleGraphicsSnapshot, createLineGraphicsSnapshot } from '#nixie/plugins/nixie/board/utils/graphics-shape-snapshot.ts';
import { createLayerSnapshot } from '#nixie/plugins/nixie/board/utils/layer-snapshot.ts';
import { createTextSnapshot } from '#nixie/plugins/nixie/board/utils/text-snapshot.ts';
import type { FoxholeItemCatalog, FoxholeStructureCatalog } from '../catalog.ts';
import {
    createFoxholeProductionCommodityKey,
    getFoxholeProductionRecipeBuildTarget,
    parseFoxholeProductionBuildTargetId,
} from './index.ts';
import type {
    FoxholeProductionChannel,
    FoxholeProductionIndex,
    FoxholeProductionPlanBuildCostEntry,
    FoxholeProductionPlanNode,
    FoxholeProductionPlanResult,
    FoxholeProductionRecipe,
    FoxholeProductionSceneCoverage,
} from './types.ts';

const COMMODITY_WIDTH = 268;
const COMMODITY_HEIGHT = 94;
const PRODUCER_WIDTH = 292;
const PRODUCER_HEIGHT = 138;
const PROVIDER_WIDTH = 244;
const PROVIDER_HEIGHT = 88;
const COLUMN_GAP = 190;
const ROW_GAP = 28;
const NODE_PADDING_X = 14;
const NODE_PADDING_Y = 12;
const ICON_SIZE = 42;
const ICON_TEXT_GAP = 12;
const ELBOW_INSET = 44;
const TITLE_FONT_SIZE = 16;
const TITLE_LINE_HEIGHT = 18;
const SUBTITLE_FONT_SIZE = 13;
const SUBTITLE_LINE_HEIGHT = 15;
const EDGE_Z = 10;
const CARD_Z = 20;
const ICON_Z = 30;
const TEXT_Z = 40;
const EPSILON = 1e-9;

type TreeNodeKind = 'commodity' | 'producer' | 'provider';
type ProviderKind = 'stock' | 'external' | 'missing' | 'cycle' | 'ambiguous';

type TreeNode = {
    id: string;
    kind: TreeNodeKind;
    title: string;
    subtitleLines: string[];
    iconUrl: string | null;
    width: number;
    height: number;
    children: TreeNode[];
    color: {
        fill: number;
        stroke: number;
        text: number;
    };
};

type LayoutNode = {
    node: TreeNode;
    centerX: number;
    centerY: number;
};

type GraphLayerSnapshotResult = {
    layerSnapshot: BoardNodeSnapshot;
    nodeCount: number;
    edgeCount: number;
    bounds: {
        minX: number;
        minY: number;
        maxX: number;
        maxY: number;
    };
};

type GraphBuildContext = {
    index: FoxholeProductionIndex;
    plan: FoxholeProductionPlanResult;
    sceneCoverage: FoxholeProductionSceneCoverage | null | undefined;
    itemCatalog: FoxholeItemCatalog | null | undefined;
    structureCatalog: FoxholeStructureCatalog | null | undefined;
    nextId: number;
};

type WrappedTextResult = {
    text: string;
    lineCount: number;
};

function createSnapshotId(prefix: string): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}:${crypto.randomUUID()}`;
    }

    return `${prefix}:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 10)}`;
}

function createTreeId(context: GraphBuildContext, prefix: string): string {
    context.nextId += 1;
    return `${prefix}:${context.nextId}`;
}

function normalizeLookupKey(value: string | null | undefined): string {
    return String(value ?? '').trim().toLowerCase();
}

function normalizeKey(value: string | null | undefined): string {
    return String(value ?? '').trim();
}

function normalizeQuantity(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function formatNumber(value: number): string {
    return Number.isInteger(value)
        ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)
        : new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function formatDurationSeconds(value: number | null): string {
    const totalSeconds = Math.max(0, Math.round(Number(value ?? 0)));
    if (totalSeconds <= 0) {
        return '';
    }

    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts: string[] = [];

    if (hours > 0) {
        parts.push(`${hours}h`);
    }
    if (minutes > 0) {
        parts.push(`${minutes}m`);
    }
    if (seconds > 0 || parts.length === 0) {
        parts.push(`${seconds}s`);
    }

    return parts.join(' ');
}

function parseCommodityKey(value: string | null | undefined): { channel: FoxholeProductionChannel; resourceId: string; } | null {
    const normalized = normalizeKey(value);
    if (!normalized) {
        return null;
    }

    const match = normalized.match(/^(item|crate|liquid|build):(.*)$/i);
    if (!match) {
        return {
            channel: 'item',
            resourceId: normalized,
        };
    }

    return {
        channel: match[1]!.toLowerCase() as FoxholeProductionChannel,
        resourceId: normalizeKey(match[2]),
    };
}

function formatFallbackLabel(value: string | null | undefined): string {
    return String(value ?? '')
        .trim()
        .replace(/[_-]+/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim() || 'Unknown';
}

function resolveStructureAsset(catalog: FoxholeStructureCatalog | null | undefined, structureId: string | null | undefined) {
    const normalized = normalizeKey(structureId);
    if (!catalog || !normalized) {
        return null;
    }

    const buildTarget = parseFoxholeProductionBuildTargetId(normalized);
    const lookupId = buildTarget?.structureId
        ?? normalized.replace(/^(structure|vehicle):/i, '');

    return catalog.assetByKey[lookupId]
        ?? catalog.assetByKey[lookupId.toLowerCase()]
        ?? catalog.assetByKey[normalized]
        ?? catalog.assetByKey[normalized.toLowerCase()]
        ?? null;
}

function resolveCommodityDisplay(
    commodityKey: string | null | undefined,
    itemCatalog: FoxholeItemCatalog | null | undefined,
    structureCatalog: FoxholeStructureCatalog | null | undefined,
): { label: string; iconUrl: string | null; } {
    const parsed = parseCommodityKey(commodityKey);
    if (!parsed) {
        return {
            label: 'Unknown commodity',
            iconUrl: null,
        };
    }

    if (parsed.channel === 'build') {
        const asset = resolveStructureAsset(structureCatalog, parsed.resourceId);
        return {
            label: asset?.name ?? formatFallbackLabel(
                parsed.resourceId.replace(/^(structure|vehicle):/i, ''),
            ),
            iconUrl: asset?.iconUrl ?? asset?.previewIconUrl ?? null,
        };
    }

    const item = itemCatalog?.assetByKey[normalizeLookupKey(parsed.resourceId)] ?? null;
    const label = item?.name ?? formatFallbackLabel(parsed.resourceId);
    return {
        label: parsed.channel === 'item' ? label : `${label} (${parsed.channel})`,
        iconUrl: item?.iconUrl ?? null,
    };
}

function resolveRecipeProducerDisplay(
    recipe: FoxholeProductionRecipe,
    structureCatalog: FoxholeStructureCatalog | null | undefined,
): { label: string; iconUrl: string | null; } {
    const structureAsset = resolveStructureAsset(structureCatalog, recipe.sourceStructureId);
    const variantIcon = recipe.sourceSlotId && recipe.sourceVariantId
        ? structureAsset?.modificationSlotById[recipe.sourceSlotId]?.variantById[recipe.sourceVariantId]?.iconUrl ?? null
        : null;

    return {
        label: recipe.sourceVariantName
            ? `${recipe.sourceStructureName} • ${recipe.sourceVariantName}`
            : recipe.sourceStructureName,
        iconUrl: variantIcon ?? structureAsset?.iconUrl ?? null,
    };
}

function iterateRecipeResources(
    recipe: Pick<FoxholeProductionRecipe, 'itemInput' | 'crateInput' | 'liquidInput' | 'itemOutput' | 'crateOutput' | 'liquidOutput' | 'buildOutput'>,
    direction: 'input' | 'output',
): Array<{ commodityKey: string; channel: FoxholeProductionChannel; resourceId: string; quantity: number; }> {
    const entries: Array<{ commodityKey: string; channel: FoxholeProductionChannel; resourceId: string; quantity: number; }> = [];
    const resourceMaps = direction === 'input'
        ? [
            ['item', recipe.itemInput],
            ['crate', recipe.crateInput],
            ['liquid', recipe.liquidInput],
        ] as const
        : [
            ['item', recipe.itemOutput],
            ['crate', recipe.crateOutput],
            ['liquid', recipe.liquidOutput],
            ['build', recipe.buildOutput],
        ] as const;

    for (const [channel, resourceMap] of resourceMaps) {
        for (const [resourceId, resource] of Object.entries(resourceMap ?? {})) {
            const quantity = normalizeQuantity(resource?.quantity);
            if (quantity <= EPSILON) {
                continue;
            }

            entries.push({
                commodityKey: createFoxholeProductionCommodityKey(channel, resourceId),
                channel,
                resourceId,
                quantity,
            });
        }
    }

    return entries;
}

function getRecipeOutputQuantity(recipe: FoxholeProductionRecipe, commodityKey: string): number {
    return iterateRecipeResources(recipe, 'output').find(entry => entry.commodityKey === commodityKey)?.quantity ?? 0;
}

function getRequiredRecipeRunCount(outputQuantity: number, requestedQuantity: number): number {
    if (outputQuantity <= EPSILON || requestedQuantity <= EPSILON) {
        return 0;
    }

    return Math.max(1, Math.ceil((requestedQuantity - EPSILON) / outputQuantity));
}

function getProviderColors(kind: ProviderKind): TreeNode['color'] {
    switch (kind) {
        case 'ambiguous':
            return { fill: 0x3C2F61, stroke: 0xD7B8FF, text: 0xF7F1FF };
        case 'external':
            return { fill: 0x36506E, stroke: 0x98C8FF, text: 0xF3F8FF };
        case 'stock':
            return { fill: 0x5B4C2A, stroke: 0xE7CA7D, text: 0xFFF9EA };
        case 'cycle':
            return { fill: 0x66363A, stroke: 0xFFB1BC, text: 0xFFF2F4 };
        default:
            return { fill: 0x6A2B35, stroke: 0xFF9EAE, text: 0xFFF1F4 };
    }
}

function createCommodityNode(
    context: GraphBuildContext,
    commodityKey: string,
    subtitleLines: string[],
): TreeNode {
    const display = resolveCommodityDisplay(commodityKey, context.itemCatalog, context.structureCatalog);
    return {
        id: createTreeId(context, 'commodity'),
        kind: 'commodity',
        title: display.label,
        subtitleLines,
        iconUrl: display.iconUrl,
        width: COMMODITY_WIDTH,
        height: COMMODITY_HEIGHT,
        children: [],
        color: { fill: 0x1D3A5C, stroke: 0xA6D1FF, text: 0xF3F8FF },
    };
}

function createProviderNode(
    context: GraphBuildContext,
    kind: ProviderKind,
    commodityKey: string,
    quantity: number,
    extraLabel?: string,
): TreeNode {
    const display = resolveCommodityDisplay(commodityKey, context.itemCatalog, context.structureCatalog);
    const title = kind === 'external'
        ? 'On Hand'
        : kind === 'stock'
            ? 'Surplus Stock'
            : kind === 'cycle'
                ? 'Cycle Detected'
                : kind === 'ambiguous'
                    ? 'Choose Recipe'
                    : 'No Producer';
    const subtitleLines = [`${display.label} x${formatNumber(quantity)}`];
    if (extraLabel) {
        subtitleLines.push(extraLabel);
    }

    return {
        id: createTreeId(context, `provider-${kind}`),
        kind: 'provider',
        title,
        subtitleLines,
        iconUrl: display.iconUrl,
        width: PROVIDER_WIDTH,
        height: PROVIDER_HEIGHT,
        children: [],
        color: getProviderColors(kind),
    };
}

function summarizeBuildCost(entries: readonly FoxholeProductionPlanBuildCostEntry[]): string {
    const parts = entries.slice(0, 2).map(entry => `${formatFallbackLabel(entry.resourceId)} x${formatNumber(entry.quantity)}`);
    if (entries.length > 2) {
        parts.push('...');
    }
    return parts.join(', ');
}

function findBuildCostSummary(context: GraphBuildContext, recipe: FoxholeProductionRecipe): string {
    const buildTarget = getFoxholeProductionRecipeBuildTarget(recipe);
    if (!buildTarget) {
        return '';
    }

    const ledger = context.plan.buildCostLedgers.find(entry => entry.rootBuildTarget.id === buildTarget.id) ?? null;
    if (!ledger || ledger.totalCostEntries.length === 0) {
        return '';
    }

    return summarizeBuildCost(ledger.totalCostEntries);
}

function findExecutionSummary(context: GraphBuildContext, recipeId: string): string {
    const row = context.sceneCoverage?.executionRows.find(entry => entry.recipeRuns.some(run => run.recipeId === recipeId)) ?? null;
    if (!row) {
        return '';
    }

    return row.status === 'covered'
        ? 'Scene ready'
        : row.status === 'upgradeable'
            ? 'Scene upgradeable'
            : 'Needs placement';
}

function createProducerNode(
    context: GraphBuildContext,
    recipe: FoxholeProductionRecipe,
    commodityKey: string,
    requestedQuantity: number,
    runCount: number,
    selected: boolean,
): TreeNode {
    const display = resolveRecipeProducerDisplay(recipe, context.structureCatalog);
    const outputQuantityPerRun = getRecipeOutputQuantity(recipe, commodityKey);
    const totalDuration = recipe.durationSeconds === null ? null : recipe.durationSeconds * runCount;
    const buildCostSummary = findBuildCostSummary(context, recipe);
    const executionSummary = selected ? findExecutionSummary(context, recipe.id) : '';
    const subtitleLines = [
        outputQuantityPerRun > 0 ? `Makes ${formatNumber(outputQuantityPerRun)} / run` : '',
        requestedQuantity > EPSILON ? `Need ${formatNumber(requestedQuantity)}` : '',
        `Runs ${formatNumber(runCount)}`,
        totalDuration ? `Time ${formatDurationSeconds(totalDuration)}` : '',
        buildCostSummary ? `Build ${buildCostSummary}` : '',
        executionSummary,
    ].filter(Boolean);

    return {
        id: createTreeId(context, selected ? 'producer-selected' : 'producer-option'),
        kind: 'producer',
        title: selected ? display.label : `${display.label} (option)`,
        subtitleLines,
        iconUrl: display.iconUrl,
        width: PRODUCER_WIDTH,
        height: PRODUCER_HEIGHT,
        children: [],
        color: selected
            ? { fill: 0x174B43, stroke: 0x93F1D8, text: 0xEDFFFA }
            : { fill: 0x3B3566, stroke: 0xCBB8FF, text: 0xF6F1FF },
    };
}

function buildPlanCommodityTree(
    context: GraphBuildContext,
    node: FoxholeProductionPlanNode,
): TreeNode {
    const commodityNode = createCommodityNode(context, node.commodityKey, [
        `Need ${formatNumber(node.requestedQuantity)}`,
        node.satisfiedQuantity + EPSILON < node.requestedQuantity
            ? `Resolved ${formatNumber(node.satisfiedQuantity)}`
            : '',
    ].filter(Boolean));

    if (node.consumedFromExternal > EPSILON) {
        commodityNode.children.push(createProviderNode(context, 'external', node.commodityKey, node.consumedFromExternal));
    }
    if (node.consumedFromStock > EPSILON) {
        commodityNode.children.push(createProviderNode(context, 'stock', node.commodityKey, node.consumedFromStock));
    }

    const requestedFromProducers = Math.max(0, node.requestedQuantity - node.consumedFromExternal - node.consumedFromStock);
    if (node.recipeId && requestedFromProducers > EPSILON) {
        const recipe = context.index.recipeById[node.recipeId] ?? null;
        if (recipe) {
            const outputQuantity = getRecipeOutputQuantity(recipe, node.commodityKey);
            const runCount = node.recipeRunCount !== null
                ? node.recipeRunCount
                : getRequiredRecipeRunCount(outputQuantity, requestedFromProducers);
            const producerNode = createProducerNode(context, recipe, node.commodityKey, requestedFromProducers, runCount, true);

            for (const child of node.children) {
                producerNode.children.push(buildPlanCommodityTree(context, child));
            }

            commodityNode.children.push(producerNode);
        }
    }

    if (commodityNode.children.length === 0) {
        const unresolvedQuantity = Math.max(0, node.requestedQuantity - node.satisfiedQuantity);
        commodityNode.children.push(createProviderNode(
            context,
            node.source === 'cycle'
                ? 'cycle'
                : node.source === 'ambiguous'
                    ? 'ambiguous'
                    : 'missing',
            node.commodityKey,
            unresolvedQuantity > EPSILON ? unresolvedQuantity : node.requestedQuantity,
            node.source === 'ambiguous' && node.candidateRecipeIds.length > 0
                ? `${formatNumber(node.candidateRecipeIds.length)} recipe options available`
                : undefined,
        ));
    }

    return commodityNode;
}

function measureTree(node: TreeNode): number {
    if (node.children.length === 0) {
        return node.height;
    }

    return node.children.reduce((total, child, index) => {
        return total + measureTree(child) + (index > 0 ? ROW_GAP : 0);
    }, 0);
}

function layoutTree(
    node: TreeNode,
    depth: number,
    top: number,
    layouts: LayoutNode[],
    edges: Array<{ sourceId: string; targetId: string; }>,
): void {
    const subtreeHeight = measureTree(node);
    const centerY = top + (subtreeHeight / 2);
    const centerX = depth * (PRODUCER_WIDTH + COLUMN_GAP);

    layouts.push({
        node,
        centerX,
        centerY,
    });

    let childTop = top;
    for (const child of node.children) {
        const childHeight = measureTree(child);
        edges.push({ sourceId: node.id, targetId: child.id });
        layoutTree(child, depth + 1, childTop, layouts, edges);
        childTop += childHeight + ROW_GAP;
    }
}

function createIconSnapshot(id: string, x: number, y: number, textureUrl: string): BoardNodeSnapshot {
    return {
        id,
        type: NIXIE_URL_SPRITE_NODE_TYPE,
        key: `${id}:icon`,
        state: {
            x,
            y,
            z: ICON_Z,
            rotation: 0,
            visible: true,
            alpha: 1,
            scaleX: 1,
            scaleY: 1,
            textureUrl,
            width: ICON_SIZE,
            height: ICON_SIZE,
            anchorX: 0,
            anchorY: 0,
        },
        children: [],
    };
}

function setSnapshotZ(snapshot: BoardNodeSnapshot, z: number): BoardNodeSnapshot {
    const state = typeof snapshot.state === 'object' && snapshot.state !== null
        ? snapshot.state as Record<string, unknown>
        : {};
    return {
        ...snapshot,
        state: {
            ...state,
            z,
        },
    };
}

function truncateWithEllipsis(value: string, maxLength: number): string {
    const normalized = value.trim();
    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd()}...`;
}

function wrapTextToLines(value: string, maxCharsPerLine: number, maxLines: number): WrappedTextResult {
    const normalized = value
        .split(/\r?\n/g)
        .map(line => line.trim())
        .filter(Boolean)
        .join(' ');
    if (!normalized) {
        return {
            text: '',
            lineCount: 0,
        };
    }

    const words = normalized.split(/\s+/g);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
        const nextLine = currentLine ? `${currentLine} ${word}` : word;
        if (nextLine.length <= maxCharsPerLine) {
            currentLine = nextLine;
            continue;
        }

        if (currentLine) {
            lines.push(currentLine);
            currentLine = '';
        }
        if (lines.length >= maxLines) {
            break;
        }

        currentLine = word.length > maxCharsPerLine
            ? truncateWithEllipsis(word, maxCharsPerLine)
            : word;
    }

    if (currentLine && lines.length < maxLines) {
        lines.push(currentLine);
    }

    if (lines.length === maxLines && normalized.length > lines.join(' ').length) {
        lines[lines.length - 1] = truncateWithEllipsis(lines[lines.length - 1]!, maxCharsPerLine);
    }

    return {
        text: lines.join('\n'),
        lineCount: lines.length,
    };
}

function estimateMaxCharsPerLine(width: number, fontSize: number): number {
    const averageCharacterWidth = Math.max(5, fontSize * 0.56);
    return Math.max(8, Math.floor(width / averageCharacterWidth));
}

function createTreeNodeSnapshot(layout: LayoutNode): BoardNodeSnapshot {
    const node = layout.node;
    const localLeft = -(node.width / 2);
    const localTop = -(node.height / 2);
    const textX = localLeft + NODE_PADDING_X + (node.iconUrl ? ICON_SIZE + ICON_TEXT_GAP : 0);
    const textWidth = node.width - ((textX - localLeft) + NODE_PADDING_X);
    const title = wrapTextToLines(node.title, estimateMaxCharsPerLine(textWidth, TITLE_FONT_SIZE), 2);
    const subtitle = wrapTextToLines(node.subtitleLines.join(' • '), estimateMaxCharsPerLine(textWidth, SUBTITLE_FONT_SIZE), node.kind === 'producer' ? 4 : 3);
    const iconY = localTop + Math.round((node.height - ICON_SIZE) * 0.5);
    const children: BoardNodeSnapshot[] = [setSnapshotZ(createRectangleGraphicsSnapshot({
        id: createSnapshotId('foxhole-production-graph-rect'),
        key: `${node.id}:frame`,
        rect: {
            minX: localLeft,
            minY: localTop,
            maxX: localLeft + node.width,
            maxY: localTop + node.height,
        },
        fill: {
            color: node.color.fill,
            alpha: 0.94,
        },
        stroke: {
            color: node.color.stroke,
            width: 2,
            alpha: 0.96,
        },
    }), CARD_Z)];

    if (node.iconUrl) {
        children.push(createIconSnapshot(
            createSnapshotId('foxhole-production-graph-icon'),
            localLeft + NODE_PADDING_X,
            iconY,
            node.iconUrl,
        ));
    }

    children.push(setSnapshotZ(createTextSnapshot({
        id: createSnapshotId('foxhole-production-graph-title'),
        key: `${node.id}:title`,
        x: textX,
        y: localTop + NODE_PADDING_Y,
        text: title.text,
        style: {
            fontFamily: 'Jost',
            fontSize: TITLE_FONT_SIZE,
            fontWeight: '600',
            fill: node.color.text,
            lineHeight: TITLE_LINE_HEIGHT,
            wordWrap: true,
            wordWrapWidth: textWidth,
        },
    }), TEXT_Z));

    if (subtitle.text) {
        children.push(setSnapshotZ(createTextSnapshot({
            id: createSnapshotId('foxhole-production-graph-subtitle'),
            key: `${node.id}:subtitle`,
            x: textX,
            y: localTop + NODE_PADDING_Y + (title.lineCount * TITLE_LINE_HEIGHT) + 2,
            text: subtitle.text,
            style: {
                fontFamily: 'Jost',
                fontSize: SUBTITLE_FONT_SIZE,
                fontWeight: '500',
                fill: node.color.text,
                lineHeight: SUBTITLE_LINE_HEIGHT,
                wordWrap: true,
                wordWrapWidth: textWidth,
            },
        }), TEXT_Z));
    }

    return {
        id: createSnapshotId('foxhole-production-graph-node'),
        type: 'container',
        key: node.id,
        state: {
            x: layout.centerX,
            y: layout.centerY,
            z: CARD_Z,
            rotation: 0,
            visible: true,
            alpha: 1,
            scaleX: 1,
            scaleY: 1,
            locked: false,
            interactiveChildren: true,
        },
        children,
    };
}

function dedupePolyline(points: number[]): number[] {
    if (points.length <= 4) {
        return points;
    }

    const deduped = [points[0]!, points[1]!];
    for (let index = 2; index < points.length; index += 2) {
        const x = points[index]!;
        const y = points[index + 1]!;
        const previousX = deduped[deduped.length - 2]!;
        const previousY = deduped[deduped.length - 1]!;
        if (Math.abs(previousX - x) <= 0.001 && Math.abs(previousY - y) <= 0.001) {
            continue;
        }
        deduped.push(x, y);
    }

    return deduped;
}

function createElbowPoints(source: LayoutNode, target: LayoutNode): number[] {
    const startX = source.centerX + (source.node.width / 2);
    const startY = source.centerY;
    const targetX = target.centerX - (target.node.width / 2);
    const targetY = target.centerY;
    const routeStartX = startX + ELBOW_INSET;
    const routeEndX = targetX - ELBOW_INSET;
    const middleX = startX < targetX
        ? (routeStartX + routeEndX) / 2
        : (startX + targetX) / 2;

    return dedupePolyline([
        startX,
        startY,
        routeStartX,
        startY,
        middleX,
        startY,
        middleX,
        targetY,
        routeEndX,
        targetY,
        targetX,
        targetY,
    ]);
}

function createEdgeSnapshot(source: LayoutNode, target: LayoutNode): BoardNodeSnapshot {
    const snapshot = setSnapshotZ(createLineGraphicsSnapshot({
        id: createSnapshotId('foxhole-production-graph-line'),
        key: `${source.node.id}->${target.node.id}`,
        points: createElbowPoints(source, target),
        stroke: {
            color: 0xD8E3F5,
            width: 3,
            alpha: 0.78,
            cap: 'round',
            join: 'round',
        },
        metadata: {
            sourceTool: 'foxhole-production-graph',
        },
    }), EDGE_Z);

    return {
        ...snapshot,
        state: {
            ...(typeof snapshot.state === 'object' && snapshot.state !== null ? snapshot.state : {}),
            locked: true,
        },
    };
}

function collectBounds(layouts: readonly LayoutNode[]): GraphLayerSnapshotResult['bounds'] {
    if (layouts.length === 0) {
        return {
            minX: -(COMMODITY_WIDTH / 2),
            minY: -(COMMODITY_HEIGHT / 2),
            maxX: COMMODITY_WIDTH / 2,
            maxY: COMMODITY_HEIGHT / 2,
        };
    }

    return layouts.reduce((bounds, layout) => ({
        minX: Math.min(bounds.minX, layout.centerX - (layout.node.width / 2) - ELBOW_INSET),
        minY: Math.min(bounds.minY, layout.centerY - (layout.node.height / 2)),
        maxX: Math.max(bounds.maxX, layout.centerX + (layout.node.width / 2) + ELBOW_INSET),
        maxY: Math.max(bounds.maxY, layout.centerY + (layout.node.height / 2)),
    }), {
        minX: Number.POSITIVE_INFINITY,
        minY: Number.POSITIVE_INFINITY,
        maxX: Number.NEGATIVE_INFINITY,
        maxY: Number.NEGATIVE_INFINITY,
    });
}

export function createFoxholeProductionGraphLayerSnapshot(options: {
    plan: FoxholeProductionPlanResult;
    index: FoxholeProductionIndex;
    sceneCoverage?: FoxholeProductionSceneCoverage | null;
    itemCatalog?: FoxholeItemCatalog | null;
    structureCatalog?: FoxholeStructureCatalog | null;
    layerName?: string;
}): GraphLayerSnapshotResult {
    const context: GraphBuildContext = {
        index: options.index,
        plan: options.plan,
        sceneCoverage: options.sceneCoverage,
        itemCatalog: options.itemCatalog,
        structureCatalog: options.structureCatalog,
        nextId: 0,
    };

    const rootTrees = options.plan.demandNodes.length > 0
        ? options.plan.demandNodes.map(node => buildPlanCommodityTree(context, node, []))
        : [createCommodityNode(context, '', ['No plan output'])];
    const layouts: LayoutNode[] = [];
    const edges: Array<{ sourceId: string; targetId: string; }> = [];
    let nextTop = -(measureTree(rootTrees[0]!) / 2);
    rootTrees.forEach((rootTree, index) => {
        if (index > 0) {
            nextTop += ROW_GAP * 2;
        }
        layoutTree(rootTree, 0, nextTop, layouts, edges);
        nextTop += measureTree(rootTree);
    });

    const layoutById = new Map(layouts.map(layout => [layout.node.id, layout]));
    const children = [
        ...edges
            .map(edge => {
                const source = layoutById.get(edge.sourceId);
                const target = layoutById.get(edge.targetId);
                return source && target ? createEdgeSnapshot(source, target) : null;
            })
            .filter((snapshot): snapshot is BoardNodeSnapshot => snapshot !== null),
        ...layouts.map(createTreeNodeSnapshot),
    ];

    return {
        layerSnapshot: createLayerSnapshot({
            id: createSnapshotId('foxhole-production-graph-layer'),
            key: normalizeKey(options.layerName) || 'Production Graph',
            visible: true,
            locked: false,
            children,
        }),
        nodeCount: layouts.length,
        edgeCount: edges.length,
        bounds: collectBounds(layouts),
    };
}
