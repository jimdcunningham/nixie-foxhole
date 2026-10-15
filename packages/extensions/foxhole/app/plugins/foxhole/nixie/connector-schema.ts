import { z } from 'zod';

const endpointAttachmentSchema = z.object({
    nodeId: z.string().min(1),
    socketName: z.string().min(1),
});

const nullableEndpointAttachmentSchema = endpointAttachmentSchema.nullable().optional();

export const foxholeConnectorStateSchema = z.object({
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
    points: z.array(z.number()).min(4),
    startSocketName: z.string().optional(),
    endSocketName: z.string().optional(),
    startAttachment: nullableEndpointAttachmentSchema,
    endAttachment: nullableEndpointAttachmentSchema,
});
