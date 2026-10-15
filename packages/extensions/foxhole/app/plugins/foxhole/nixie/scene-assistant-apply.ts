import { getNixieEditorDocumentSessionBridge } from '#nixie/utils/nixie-editor-document-session-bridge.ts';
import { useRuntimeConfig } from '#imports';
import { resolveNixieEditorRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { showNxToast } from '#nixie/composables/useNxToast.ts';
import type {
    NixieAssistantFoxholeSceneMutateAction,
    NixieAssistantFoxholeSceneMutateOp,
} from '#foxhole/utils/assistant-client-actions.ts';
import type { NixieProjectOperation } from '#nixie/plugins/nixie/project.ts';
import {
    createFoxholeAssetsBaseUrl,
    getFoxholeStructureCatalog,
} from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import { createFoxholeStructureAssetSnapshot } from '#foxhole/plugins/foxhole/nixie/structure-asset-snapshot.ts';
import { createFoxholeSplineConnectorSnapshot } from '#foxhole/plugins/foxhole/nixie/spline-connector-snapshot.ts';
import { createFoxholeBinocularLineSnapshot } from '#foxhole/plugins/foxhole/nixie/binocular-line-snapshot.ts';
import { hasFoxholePowerSocketTag, normalizeFoxholeSocketTags } from '#foxhole/plugins/foxhole/nixie/structure-socket-snapping.ts';
import type { FoxholeManifestBuildSocket } from '#foxhole/plugins/foxhole/nixie/manifest.ts';

const FOOTPRINT_OVERLAY_PIXELS_PER_UNIT = 32;

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function rotatePoint(point: { x: number; y: number; }, rotation: number): { x: number; y: number; } {
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    return {
        x: (point.x * cos) - (point.y * sin),
        y: (point.x * sin) + (point.y * cos),
    };
}

function findPowerSocket(buildSockets: readonly FoxholeManifestBuildSocket[]): FoxholeManifestBuildSocket | null {
    for (const socket of buildSockets) {
        const name = String(socket.name ?? '').trim();
        const tags = normalizeFoxholeSocketTags(socket.socketTags);
        if (name.toLowerCase() === 'powersocket' || hasFoxholePowerSocketTag(tags)) {
            return socket;
        }
    }
    return null;
}

function resolvePowerSocketWorldPosition(options: {
    nodeX: number;
    nodeY: number;
    rotation: number;
    socket: FoxholeManifestBuildSocket;
}): { x: number; y: number; rotation: number; socketName: string; } {
    const socketName = String(options.socket.name ?? 'PowerSocket').trim() || 'PowerSocket';
    const socketX = (Number(options.socket.x ?? 0) / 100) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT;
    const socketY = (Number(options.socket.y ?? 0) / 100) * FOOTPRINT_OVERLAY_PIXELS_PER_UNIT;
    const socketRotationRadians = (Number(options.socket.rotation ?? 0) * Math.PI) / 180;
    const rotated = rotatePoint({ x: socketX, y: socketY }, options.rotation);
    return {
        x: options.nodeX + rotated.x,
        y: options.nodeY + rotated.y,
        rotation: options.rotation + socketRotationRadians,
        socketName,
    };
}

async function applyFoxholeSceneOp(
    op: NixieAssistantFoxholeSceneMutateOp,
    options: {
        project: NonNullable<ReturnType<typeof resolveNixieEditorRuntime>>['projectStore']['project'];
        context: ReturnType<NonNullable<ReturnType<typeof resolveNixieEditorRuntime>>['createCommandContext']>;
        assetsBaseUrl: string;
    },
): Promise<boolean> {
    const { project, context, assetsBaseUrl } = options;
    if (!project) {
        return false;
    }

    const catalog = getFoxholeStructureCatalog(assetsBaseUrl);

    if (op.op === 'placeStructure') {
        const asset = catalog.assetByKey[op.foxholeKey]
            ?? catalog.assetByKey[op.foxholeKey.toLowerCase()]
            ?? null;
        if (!asset) {
            return false;
        }
        const structure = catalog.structureByKey[asset.foxholeKey]
            ?? catalog.structureByKey[asset.foxholeKey.toLowerCase()]
            ?? null;
        const parentAsset = asset.parentStructureId
            ? (catalog.assetByKey[String(asset.parentStructureId).trim()]
                ?? catalog.assetByKey[String(asset.parentStructureId).trim().toLowerCase()]
                ?? null)
            : null;
        const snapshot = createFoxholeStructureAssetSnapshot({
            asset,
            structure,
            parentAsset,
            label: normalizeString(op.label) || asset.name,
            x: op.x,
            y: op.y,
            z: 0,
        });
        if (op.id) {
            snapshot.id = op.id;
        }
        const created = await project.createNode(
            snapshot,
            undefined,
            undefined,
            'assistant:foxhole-scene:place-structure',
        );
        if (!created) {
            return false;
        }
        context.setSelectedNodeIds([String(snapshot.id)], {
            reason: 'assistant:foxhole-scene:select',
        });
        return true;
    }

    if (op.op === 'createBinocularLine') {
        const snapshot = createFoxholeBinocularLineSnapshot({
            ...(op.id ? { id: op.id } : {}),
            points: op.points,
        });
        const created = await project.createNode(
            snapshot,
            undefined,
            undefined,
            'assistant:foxhole-scene:binocular-line',
        );
        if (!created) {
            return false;
        }
        context.setSelectedNodeIds([String(snapshot.id)], {
            reason: 'assistant:foxhole-scene:select',
        });
        return true;
    }

    if (op.op === 'connectPower') {
        const fromNode = project.scene.getNodeById(op.fromNodeId);
        const toNode = project.scene.getNodeById(op.toNodeId);
        if (!fromNode || !toNode) {
            return false;
        }

        const fromState = fromNode.boardState as {
            foxholeKey?: unknown;
            x?: unknown;
            y?: unknown;
            rotation?: unknown;
            socketAttachments?: Record<string, { nodeId: string; socketName: string; }>;
        };
        const toState = toNode.boardState as {
            foxholeKey?: unknown;
            x?: unknown;
            y?: unknown;
            rotation?: unknown;
            socketAttachments?: Record<string, { nodeId: string; socketName: string; }>;
        };

        const fromKey = normalizeString(fromState.foxholeKey);
        const toKey = normalizeString(toState.foxholeKey);
        const fromStructure = catalog.structureByKey[fromKey]
            ?? catalog.structureByKey[fromKey.toLowerCase()]
            ?? null;
        const toStructure = catalog.structureByKey[toKey]
            ?? catalog.structureByKey[toKey.toLowerCase()]
            ?? null;
        if (!fromStructure || !toStructure) {
            return false;
        }

        const fromSocket = findPowerSocket(fromStructure.buildSockets ?? []);
        const toSocket = findPowerSocket(toStructure.buildSockets ?? []);
        if (!fromSocket || !toSocket) {
            return false;
        }

        const fromPower = resolvePowerSocketWorldPosition({
            nodeX: Number(fromState.x ?? 0),
            nodeY: Number(fromState.y ?? 0),
            rotation: Number(fromState.rotation ?? 0),
            socket: fromSocket,
        });
        const toPower = resolvePowerSocketWorldPosition({
            nodeX: Number(toState.x ?? 0),
            nodeY: Number(toState.y ?? 0),
            rotation: Number(toState.rotation ?? 0),
            socket: toSocket,
        });

        const powerlineAsset = catalog.assetByKey.powerline
            ?? catalog.assetByKey.PowerLine
            ?? null;
        const powerlineStructure = catalog.structureByKey.powerline
            ?? catalog.structureByKey.PowerLine
            ?? null;
        if (!powerlineAsset || !powerlineStructure) {
            return false;
        }

        const dx = toPower.x - fromPower.x;
        const dy = toPower.y - fromPower.y;
        const powerlineId = normalizeString(op.id) || undefined;
        const snapshot = createFoxholeSplineConnectorSnapshot({
            ...(powerlineId ? { id: powerlineId } : {}),
            foxholeKey: 'powerline',
            structure: powerlineStructure,
            label: powerlineAsset.name,
            x: fromPower.x,
            y: fromPower.y,
            start: { x: 0, y: 0, rotation: fromPower.rotation },
            end: { x: dx, y: dy, rotation: toPower.rotation },
        });

        (snapshot.state as Record<string, unknown>).startAttachment = {
            nodeId: String(fromNode.boardId),
            socketName: fromPower.socketName,
        };
        (snapshot.state as Record<string, unknown>).endAttachment = {
            nodeId: String(toNode.boardId),
            socketName: toPower.socketName,
        };

        const created = await project.createNode(
            snapshot,
            undefined,
            undefined,
            'assistant:foxhole-scene:connect-power',
        );
        if (!created) {
            return false;
        }

        const connectorId = String(snapshot.id);
        const fromAttachments = {
            ...(fromState.socketAttachments ?? {}),
            [fromPower.socketName]: { nodeId: connectorId, socketName: 'BackSocket' },
        };
        const toAttachments = {
            ...(toState.socketAttachments ?? {}),
            [toPower.socketName]: { nodeId: connectorId, socketName: 'FrontSocket' },
        };

        const operations: NixieProjectOperation[] = [
            {
                type: 'update',
                nodeId: String(fromNode.boardId),
                patch: { socketAttachments: fromAttachments },
            },
            {
                type: 'update',
                nodeId: String(toNode.boardId),
                patch: { socketAttachments: toAttachments },
            },
        ];
        const inverseOperations: NixieProjectOperation[] = [
            {
                type: 'update',
                nodeId: String(fromNode.boardId),
                patch: { socketAttachments: { ...(fromState.socketAttachments ?? {}) } },
            },
            {
                type: 'update',
                nodeId: String(toNode.boardId),
                patch: { socketAttachments: { ...(toState.socketAttachments ?? {}) } },
            },
        ];

        await project.executeBatch(
            operations,
            inverseOperations,
            'assistant:foxhole-scene:power-attachments',
            'Connect Power',
        );

        context.setSelectedNodeIds(
            [String(fromNode.boardId), String(toNode.boardId), connectorId],
            { reason: 'assistant:foxhole-scene:select' },
        );
        return true;
    }

    return false;
}

export async function applyNixieAssistantFoxholeSceneMutate(
    action: NixieAssistantFoxholeSceneMutateAction,
): Promise<boolean> {
    const session = getNixieEditorDocumentSessionBridge();
    const sceneId = normalizeString(action.sceneId);
    if (!session?.isSceneActive.value
        || normalizeString(session.activeSceneId.value) !== sceneId) {
        showNxToast({
            kind: 'error',
            title: 'Scene Edit Failed',
            message: 'Open the target scene before applying a Nixie edit.',
        });
        return false;
    }

    const runtime = resolveNixieEditorRuntime();
    if (!runtime?.canEdit.value) {
        showNxToast({
            kind: 'warning',
            title: 'Scene Edit Failed',
            message: 'This project is read-only, so the scene could not be edited.',
        });
        return false;
    }

    const project = runtime.projectStore.project;
    if (!project) {
        showNxToast({
            kind: 'error',
            title: 'Scene Edit Failed',
            message: 'Scene project data is unavailable.',
        });
        return false;
    }

    const runtimeConfig = useRuntimeConfig();
    const assetsBaseUrl = createFoxholeAssetsBaseUrl(runtimeConfig.app.baseURL);
    const context = runtime.createCommandContext();
    let applied = 0;
    for (const op of action.ops) {
        const ok = await applyFoxholeSceneOp(op, { project, context, assetsBaseUrl });
        if (ok) {
            applied += 1;
        }
    }

    if (applied > 0) {
        showNxToast({
            kind: 'success',
            title: 'Scene Updated',
            message: 'Nixie applied a Foxhole scene edit. Use Undo to reverse it.',
        });
        return true;
    }

    showNxToast({
        kind: 'error',
        title: 'Scene Edit Failed',
        message: 'None of the requested Foxhole scene changes could be applied.',
    });
    return false;
}
