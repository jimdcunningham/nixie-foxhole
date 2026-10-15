import { z } from 'zod';

const splineEndpointSchema = z.object({
    x: z.number(),
    y: z.number(),
    rotation: z.number(),
    handleLength: z.number().optional(),
});

const connectorEndpointAttachmentSchema = z.object({
    nodeId: z.string().min(1),
    socketName: z.string().min(1),
}).nullish();

export const foxholeSplineConnectorStateSchema = z.object({
    foxholeKey: z.string().min(1),
    x: z.number(),
    y: z.number(),
    z: z.number().optional(),
    rotation: z.number(),
    visible: z.boolean(),
    alpha: z.number(),
    scaleX: z.number(),
    scaleY: z.number(),
    locked: z.boolean().optional(),
    start: splineEndpointSchema,
    end: splineEndpointSchema,
    minLength: z.number(),
    maxLength: z.number(),
    minRadius: z.number(),
    maxRadius: z.number(),
    maxBuffer: z.number(),
    curveT: z.number().min(0).max(1).optional(),
    maxTargetAngleDeg: z.number().optional(),
    maxArcAngleDeg: z.number().optional(),
    startSocketName: z.string().optional(),
    endSocketName: z.string().optional(),
    startAttachment: connectorEndpointAttachmentSchema,
    endAttachment: connectorEndpointAttachmentSchema,
    socketAttachments: z.record(z.string(), z.object({
        nodeId: z.string().min(1),
        socketName: z.string().min(1),
    })).nullish(),
    modificationVariantIds: z.record(z.string(), z.string()).default({}),
    blueprint: z.boolean().optional(),
});
