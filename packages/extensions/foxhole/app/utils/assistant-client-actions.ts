/** Foxhole extension scene ops — applied by the Foxhole assistant context. */
export type NixieAssistantFoxholeSceneMutateOp
    = | {
        op: 'placeStructure';
        foxholeKey: string;
        x: number;
        y: number;
        label?: string;
        id?: string;
    }
    | {
        op: 'connectPower';
        fromNodeId: string;
        toNodeId: string;
        id?: string;
    }
    | {
        op: 'createBinocularLine';
        points: number[];
        id?: string;
    };

export type NixieAssistantFoxholeSceneMutateAction = {
    type: 'foxhole.scene.mutate';
    sceneId: string;
    ops: NixieAssistantFoxholeSceneMutateOp[];
};


function normalizeString(value: unknown): string { return typeof value === 'string' ? value.trim() : ''; }
function asRecord(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function normalizeFiniteNumber(value: unknown): number | undefined { const number = Number(value); return Number.isFinite(number) ? number : undefined; }
function normalizeNumberArray(value: unknown): number[] { return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : []; }

export function normalizeNixieAssistantFoxholeSceneMutateOp(
    value: unknown,
): NixieAssistantFoxholeSceneMutateOp | null {
    const record = asRecord(value);
    const op = normalizeString(record.op);

    if (op === 'placeStructure') {
        const foxholeKey = normalizeString(record.foxholeKey);
        const x = normalizeFiniteNumber(record.x);
        const y = normalizeFiniteNumber(record.y);
        if (!foxholeKey || x === undefined || y === undefined) {
            return null;
        }
        const next: Extract<NixieAssistantFoxholeSceneMutateOp, { op: 'placeStructure'; }> = {
            op: 'placeStructure',
            foxholeKey,
            x,
            y,
        };
        const label = normalizeString(record.label);
        if (label) {
            next.label = label;
        }
        const id = normalizeString(record.id);
        if (id) {
            next.id = id;
        }
        return next;
    }

    if (op === 'connectPower') {
        const fromNodeId = normalizeString(record.fromNodeId);
        const toNodeId = normalizeString(record.toNodeId);
        if (!fromNodeId || !toNodeId) {
            return null;
        }
        const next: Extract<NixieAssistantFoxholeSceneMutateOp, { op: 'connectPower'; }> = {
            op: 'connectPower',
            fromNodeId,
            toNodeId,
        };
        const id = normalizeString(record.id);
        if (id) {
            next.id = id;
        }
        return next;
    }

    if (op === 'createBinocularLine') {
        const points = normalizeNumberArray(record.points);
        if (points.length < 4) {
            return null;
        }
        const next: Extract<NixieAssistantFoxholeSceneMutateOp, { op: 'createBinocularLine'; }> = {
            op: 'createBinocularLine',
            points,
        };
        const id = normalizeString(record.id);
        if (id) {
            next.id = id;
        }
        return next;
    }

    return null;
}

export function normalizeNixieAssistantFoxholeSceneMutateOps(
    value: unknown,
): NixieAssistantFoxholeSceneMutateOp[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const ops: NixieAssistantFoxholeSceneMutateOp[] = [];
    for (const entry of value) {
        const normalized = normalizeNixieAssistantFoxholeSceneMutateOp(entry);
        if (normalized) {
            ops.push(normalized);
        }
    }
    return ops;
}


export function normalizeFoxholeAssistantAction(value: unknown): NixieAssistantFoxholeSceneMutateAction | null {
    const record = asRecord(value);
    if (record.type !== 'foxhole.scene.mutate') return null;
    const sceneId = normalizeString(record.sceneId);
    const ops = normalizeNixieAssistantFoxholeSceneMutateOps(record.ops);
    return sceneId && ops.length ? { type: 'foxhole.scene.mutate', sceneId, ops } : null;
}
export function foxholeAssistantNodeLabel(type: string, state: unknown): string | null {
    if (!type.toLowerCase().includes('foxhole')) return null;
    return normalizeString(asRecord(state).foxholeKey) || null;
}
