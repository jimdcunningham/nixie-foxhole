export interface ResolvedConnectorBehavior {
    trimSpan: boolean;
    fieldConnectorSpan: boolean;
    mineSpline: boolean;
    railTrack: boolean;
    railForkEndCaps: boolean;
    powerline: boolean;
    pipeCurveScale: boolean;
    pipeExtension: boolean;
    undergroundPipe: boolean;
    socketSnapping: boolean;
    tankStop: boolean;
    renderEndCaps: boolean;
}

export interface FoxholeConnectorBehaviorManifest {
    trimSpan?: boolean | null;
    fieldConnectorSpan?: boolean | null;
    mineSpline?: boolean | null;
    railTrack?: boolean | null;
    railForkEndCaps?: boolean | null;
    powerline?: boolean | null;
    pipeCurveScale?: boolean | null;
    pipeExtension?: boolean | null;
    undergroundPipe?: boolean | null;
    socketSnapping?: boolean | null;
    tankStop?: boolean | null;
    renderEndCaps?: boolean | null;
}

export interface FoxholeConnectorBehaviorSource {
    behavior?: FoxholeConnectorBehaviorManifest | null;
}

export interface FoxholeConnectorBehaviorStructure {
    id?: string;
    connector?: FoxholeConnectorBehaviorSource | null;
}

export function normalizeConnectorFoxholeKey(value?: string): string {
    return String(value ?? '').trim().toLowerCase();
}

/** These blueprints publish BackSocket/FrontSocket but omit the connector endpoint fields. */
const DEFENSE_SPLINE_ENDPOINT_KEYS = new Set(['barbedwirespline', 'barbedwirewallspline', 'sandbaghalfspline', 'sandbagfullspline', 'waterwallsplinet1']);

export function resolveConnectorEndpointSocketNames(
    foxholeKey?: string,
    connector?: { backSocketName?: string | null; frontSocketName?: string | null; } | null,
): { backSocketName?: string; frontSocketName?: string; } {
    const knownDefenseSpline = DEFENSE_SPLINE_ENDPOINT_KEYS.has(normalizeConnectorFoxholeKey(foxholeKey));
    return {
        backSocketName: String(connector?.backSocketName ?? '').trim() || (knownDefenseSpline ? 'BackSocket' : undefined),
        frontSocketName: String(connector?.frontSocketName ?? '').trim() || (knownDefenseSpline ? 'FrontSocket' : undefined),
    };
}

/** Resolve editable path modes where blueprint mesh metadata describes a different behavior. */
export function resolveConnectorVisualPathStyle(pathStyle?: string, foxholeKey?: string): string | undefined {
    const normalizedPathStyle = String(pathStyle ?? '').trim().toLowerCase();
    // Crespine Netting is a rigid span between two anchors, despite its published spline mode.
    if (normalizeConnectorFoxholeKey(foxholeKey) === 'waterwallsplinet1') {
        return 'straight-telescoping';
    }
    if (normalizeConnectorFoxholeKey(foxholeKey) === 'barbedwirespline'
        && normalizedPathStyle === 'straight-telescoping') {
        return 'spline';
    }
    return normalizedPathStyle || undefined;
}

export function requiresStraightConnectorSocketAlignment(foxholeKey?: string): boolean {
    const normalizedKey = normalizeConnectorFoxholeKey(foxholeKey);
    return normalizedKey === 'fieldbridge'
        || normalizedKey === 'fieldpier'
        || normalizedKey === 'facilitycatwalkbridge'
        || normalizedKey === 'facilitypipeoverhead';
}

function resolveConnectorBehaviorFlag(
    manifestValue: boolean | null | undefined,
    fallbackValue: boolean,
): boolean {
    return typeof manifestValue === 'boolean' ? manifestValue : fallbackValue;
}

function resolveConnectorBehaviorFromCodename(foxholeKey: string): ResolvedConnectorBehavior {
    const normalizedKey = normalizeConnectorFoxholeKey(foxholeKey);

    return {
        trimSpan: normalizedKey === 'fieldbridge'
            || normalizedKey === 'fieldpier'
            || normalizedKey === 'facilitycatwalkbridge'
            || normalizedKey === 'barbedwirespline'
            || normalizedKey === 'barbedwirewallspline'
            || normalizedKey.startsWith('wallspline')
            || normalizedKey.startsWith('waterwallspline'),
        fieldConnectorSpan: normalizedKey === 'fieldbridge'
            || normalizedKey === 'fieldpier'
            || normalizedKey === 'facilitycatwalkbridge',
        mineSpline: normalizedKey === 'minespline'
            || normalizedKey === 'infantryminespline'
            || normalizedKey === 'tankminespline'
            || normalizedKey === 'waterminespline'
            || normalizedKey === 'surfacewaterminespline',
        railTrack: normalizedKey.includes('railtrackspline') && !normalizedKey.includes('cranerail'),
        railForkEndCaps: normalizedKey.includes('railtrackspline')
            && !normalizedKey.includes('cranerail')
            && normalizedKey.includes('biarc'),
        powerline: normalizedKey === 'powerline',
        pipeCurveScale: normalizedKey === 'facilitypipe'
            || normalizedKey === 'barbedwirewallspline'
            || normalizedKey === 'facilitypipeunderground'
            || normalizedKey === 'facilitypipeoverhead',
        pipeExtension: normalizedKey === 'facilitypipe'
            || normalizedKey === 'facilitypipeunderground'
            || normalizedKey === 'facilitypipeoverhead',
        undergroundPipe: normalizedKey.includes('underground') && normalizedKey.includes('pipe'),
        socketSnapping: normalizedKey === 'powerline'
            || DEFENSE_SPLINE_ENDPOINT_KEYS.has(normalizedKey)
            || /^trenchconnector(?:buildsite|t[123])$/.test(normalizedKey)
            || normalizedKey === 'fieldbridge'
            || normalizedKey === 'fieldpier'
            || normalizedKey === 'facilitycatwalkbridge'
            || normalizedKey === 'facilitypipe'
            || normalizedKey === 'facilitypipeunderground'
            || normalizedKey === 'facilitypipeoverhead'
            || /^wallsplinet[123]$/.test(normalizedKey)
            || (
                !normalizedKey.includes('cranerail')
                && (normalizedKey.startsWith('smallrailtrackspline') || normalizedKey.startsWith('railtrackspline'))
            ),
        tankStop: normalizedKey.startsWith('tankstopspline'),
        renderEndCaps: !(normalizedKey.includes('railtrackspline') && !normalizedKey.includes('cranerail')),
    };
}

export function resolveConnectorBehavior(
    foxholeKey?: string,
    connector?: FoxholeConnectorBehaviorSource | null,
): ResolvedConnectorBehavior {
    const fallback = resolveConnectorBehaviorFromCodename(foxholeKey ?? '');
    const manifestBehavior = connector?.behavior;

    return {
        trimSpan: resolveConnectorBehaviorFlag(manifestBehavior?.trimSpan, fallback.trimSpan),
        fieldConnectorSpan: resolveConnectorBehaviorFlag(manifestBehavior?.fieldConnectorSpan, fallback.fieldConnectorSpan),
        mineSpline: resolveConnectorBehaviorFlag(manifestBehavior?.mineSpline, fallback.mineSpline),
        railTrack: resolveConnectorBehaviorFlag(manifestBehavior?.railTrack, fallback.railTrack),
        railForkEndCaps: resolveConnectorBehaviorFlag(manifestBehavior?.railForkEndCaps, fallback.railForkEndCaps),
        powerline: resolveConnectorBehaviorFlag(manifestBehavior?.powerline, fallback.powerline),
        pipeCurveScale: resolveConnectorBehaviorFlag(manifestBehavior?.pipeCurveScale, fallback.pipeCurveScale),
        pipeExtension: resolveConnectorBehaviorFlag(manifestBehavior?.pipeExtension, fallback.pipeExtension),
        undergroundPipe: resolveConnectorBehaviorFlag(manifestBehavior?.undergroundPipe, fallback.undergroundPipe),
        socketSnapping: resolveConnectorBehaviorFlag(manifestBehavior?.socketSnapping, fallback.socketSnapping),
        tankStop: resolveConnectorBehaviorFlag(manifestBehavior?.tankStop, fallback.tankStop),
        renderEndCaps: resolveConnectorBehaviorFlag(manifestBehavior?.renderEndCaps, fallback.renderEndCaps),
    };
}

export function resolveConnectorBehaviorFromStructure(
    structure?: FoxholeConnectorBehaviorStructure | null,
): ResolvedConnectorBehavior {
    return resolveConnectorBehavior(structure?.id, structure?.connector);
}

export function usesConnectorEndpointOnlyHitTesting(
    foxholeKey?: string,
    connector?: FoxholeConnectorBehaviorSource | null,
): boolean {
    return resolveConnectorBehavior(foxholeKey, connector).undergroundPipe;
}

export function isConnectorEndpointHit(
    localPoint: { x: number; y: number; },
    start: { x: number; y: number; },
    end: { x: number; y: number; },
    hitRadius: number,
): boolean {
    const radius = Math.max(0, hitRadius);
    return Math.hypot(localPoint.x - start.x, localPoint.y - start.y) <= radius
        || Math.hypot(localPoint.x - end.x, localPoint.y - end.y) <= radius;
}
