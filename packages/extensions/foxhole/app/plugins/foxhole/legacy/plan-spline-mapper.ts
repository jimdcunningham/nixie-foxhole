import type { LegacyPlanBezierPoint, LegacyPlanEntity } from './plan-types.ts';
import { createFoxholeSplineConnectorSnapshot } from '../nixie/spline-connector-snapshot.ts';
import {
    isFoxholeSplineConnectorStructure,
    normalizeSplineRotationRadians,
    usesSocketFacingEndRotation,

} from '../nixie/spline-connector.ts';
import type { FoxholeSplineConnectorState } from '../nixie/spline-connector.ts';
import type { FoxholeManifestStructure } from '../nixie/manifest.ts';
import type { FoxholeStructureModificationSelectionMap } from '../nixie/modification-slots.ts';
import type { BoardNodeSnapshot } from '#nixie/plugins/nixie/board/types/node.ts';
import type { FoxholeStructureSocketAttachmentMap } from '../nixie/types.ts';
import { applyLegacyTintBrightness } from './plan-tint.ts';

const DEG_TO_RAD = Math.PI / 180;
const FOXHOLE_BOARD_PIXELS_PER_CENTIMETER = 32 / 100;

/**
 * Legacy bezier rotations face the opposite of Nixie into-span tangents.
 * A straight rightward span is stored as 180° in .plan files and 0 rad in Nixie.
 */
function mapLegacyBezierIntoSpanRotationRad(degrees: number): number {
    return normalizeSplineRotationRadians((Number(degrees) * DEG_TO_RAD) + Math.PI);
}

/**
 * Map a legacy bezier endpoint rotation into Nixie storage.
 * Ground pipes keep socket-facing end rotations (into-span + π); everything else
 * stores the into-span tangent directly.
 */
function mapLegacyBezierEndpointRotationRad(
    degrees: number,
    endpoint: 'start' | 'end',
    foxholeKey: string,
): number {
    const intoSpan = mapLegacyBezierIntoSpanRotationRad(degrees);
    if (endpoint === 'end' && usesSocketFacingEndRotation(foxholeKey)) {
        return normalizeSplineRotationRadians(intoSpan + Math.PI);
    }
    return intoSpan;
}

function pickBezierEndpoints(bezier: LegacyPlanBezierPoint[] | undefined): {
    start: LegacyPlanBezierPoint;
    end: LegacyPlanBezierPoint;
} | null {
    if (!Array.isArray(bezier) || bezier.length < 2) {
        return null;
    }
    return {
        start: bezier[0]!,
        end: bezier[bezier.length - 1]!,
    };
}

/**
 * Builds spline connector snapshots from legacy bezier / handle-width entities.
 */
export class LegacyPlanSplineMapper {
    canMapAsSpline(structure: FoxholeManifestStructure | null | undefined): boolean {
        return isFoxholeSplineConnectorStructure(structure);
    }

    createSnapshot(options: {
        id: string;
        entity: LegacyPlanEntity;
        foxholeKey: string;
        structure: FoxholeManifestStructure;
        label: string;
        modificationVariantIds?: FoxholeStructureModificationSelectionMap;
        socketAttachments?: FoxholeStructureSocketAttachmentMap;
        rotationRad: number;
    }): BoardNodeSnapshot<FoxholeSplineConnectorState> {
        const endpoints = pickBezierEndpoints(options.entity.bezier);
        const connector = options.structure.connector;
        let start = {
            x: 0,
            y: 0,
            rotation: 0,
        };
        let end = {
            x: centimetersToLength(connector?.minLengthCm ?? 300),
            y: 0,
            rotation: 0,
        };

        if (endpoints) {
            start = {
                x: Number(endpoints.start.x ?? 0),
                y: Number(endpoints.start.y ?? 0),
                rotation: endpoints.start.rotation !== undefined
                    ? mapLegacyBezierEndpointRotationRad(
                        Number(endpoints.start.rotation),
                        'start',
                        options.foxholeKey,
                    )
                    : 0,
            };
            end = {
                x: Number(endpoints.end.x ?? 0),
                y: Number(endpoints.end.y ?? 0),
                rotation: endpoints.end.rotation !== undefined
                    ? mapLegacyBezierEndpointRotationRad(
                        Number(endpoints.end.rotation),
                        'end',
                        options.foxholeKey,
                    )
                    : 0,
            };
        } else if (typeof options.entity.width === 'number' && Number.isFinite(options.entity.width)) {
            // Non-bezier handle width (e.g. power line stretch length in board pixels).
            end = {
                x: Math.max(1, Number(options.entity.width)),
                y: 0,
                rotation: 0,
            };
        }

        const snapshot = createFoxholeSplineConnectorSnapshot({
            id: options.id,
            foxholeKey: options.foxholeKey,
            structure: options.structure,
            label: options.label,
            x: Number(options.entity.x ?? 0),
            y: Number(options.entity.y ?? 0),
            z: options.entity.z != null ? Number(options.entity.z) : undefined,
            rotation: options.rotationRad,
            locked: options.entity.locked === true,
            modificationVariantIds: options.modificationVariantIds,
            start,
            end,
        });

        if (options.socketAttachments && Object.keys(options.socketAttachments).length) {
            snapshot.state.socketAttachments = { ...options.socketAttachments };
            const startName = snapshot.state.startSocketName;
            const endName = snapshot.state.endSocketName;
            if (startName && options.socketAttachments[startName]) {
                snapshot.state.startAttachment = { ...options.socketAttachments[startName]! };
            }
            if (endName && options.socketAttachments[endName]) {
                snapshot.state.endAttachment = { ...options.socketAttachments[endName]! };
            }
        }

        if (options.entity.packaged === true) {
            snapshot.state.packaged = true;
            snapshot.state.blueprint = false;
        } else if (options.entity.blueprint === true) {
            snapshot.state.blueprint = true;
        }
        applyLegacyTintBrightness(snapshot.state, options.entity);

        return snapshot;
    }
}

function centimetersToLength(cm: number): number {
    return Math.max(1, cm * FOXHOLE_BOARD_PIXELS_PER_CENTIMETER);
}
