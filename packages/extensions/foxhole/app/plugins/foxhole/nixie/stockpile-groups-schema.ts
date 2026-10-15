import { z } from 'zod';

const optionalNumber = z.number().nullish().transform(value => value ?? undefined);
const nativeRecords = z.array(z.unknown()).nullish().transform(value => value ?? undefined);

/** Additive native stores. The singular stockpile/holdProfile stays a legacy projection. */
export const foxholeStockpileGroupSchema = z.object({
    componentName: z.string().min(1),
    stockpileIndex: optionalNumber,
    allowContainerSubmission: z.boolean().nullish().transform(value => value ?? undefined),
    replicates: z.boolean().nullish().transform(value => value ?? undefined),
    retrieveDurationModifier: optionalNumber,
    configs: z.array(z.object({
        entryType: z.string(),
        listType: z.string().nullish().transform(value => value ?? undefined),
        quantityLimit: optionalNumber,
        totalQuantityLimit: optionalNumber,
        itemCategoryFilter: optionalNumber,
        validEntriesOverride: z.array(z.string()).nullish().transform(value => value ?? undefined),
        quantityOverrides: nativeRecords,
        totalQuantityOverrides: nativeRecords,
        preStockedEntries: nativeRecords,
        retrieveDurationModifiers: nativeRecords,
    })),
    references: z.array(z.object({
        componentName: z.string(),
        componentType: z.string(),
        stockpileIndex: z.number(),
        inventoryIndex: optionalNumber,
    })).default([]),
});

export type FoxholeManifestStockpileGroup = z.infer<typeof foxholeStockpileGroupSchema>;
