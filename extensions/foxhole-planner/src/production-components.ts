import {
    parseNixieExperimentalComponentProductV1,
    validateNixieExperimentalComponentDataV1,
} from '@nixiejs/extension-sdk/experimental/scene-v2';
import { parseNixieExtensionManifestV1 } from '@nixiejs/extension-sdk';

type NixieExperimentalComponentJsonObjectV1 = import('@nixiejs/extension-sdk/experimental/scene-v2').NixieExperimentalComponentJsonObjectV1;
type NixieExperimentalComponentProductV1 = import('@nixiejs/extension-sdk/experimental/scene-v2').NixieExperimentalComponentProductV1;
type NixieExtensionManifestV1 = import('@nixiejs/extension-sdk').NixieExtensionManifestV1;

export const FOXHOLE_COMPONENT_OWNER_ID = 'nixie.foxhole-planner';
export const FOXHOLE_FACILITY_PRODUCT_ID = 'facility.ammo-factory';
export const FOXHOLE_ASSET_COMPONENT_ID = 'asset';
export const FOXHOLE_APPEARANCE_COMPONENT_ID = 'appearance';
export const FOXHOLE_MODIFICATION_COMPONENT_ID = 'modification';
export const FOXHOLE_CARGO_COMPONENT_ID = 'cargo';
export const FOXHOLE_SOCKET_ATTACHMENTS_COMPONENT_ID = 'socket-attachments';
export const FOXHOLE_PRODUCTION_ORDER_COMPONENT_ID = 'production-order';

export interface FoxholeFacilityProductionInputV1 {
    selections?: Array<{ slotId: string; variantId: string; }>;
    orders?: Array<{
        id: string;
        recipeId: string;
        parent?: boolean;
        /** Omitted means the production order runs without a cycle limit. */
        cycles?: number;
        label?: string;
    }>;
    disabled?: boolean;
}

function requireFoxholeManifest(value: unknown): NixieExtensionManifestV1 {
    const manifest = parseNixieExtensionManifestV1(value);
    if (manifest.id !== FOXHOLE_COMPONENT_OWNER_ID) {
        throw new Error(`Expected ${FOXHOLE_COMPONENT_OWNER_ID}, received ${manifest.id}.`);
    }
    return manifest;
}

/** Resolves the canonical facility template from the extension manifest. */
export function getFoxholeFacilityProductV1(
    manifestValue: unknown,
): NixieExperimentalComponentProductV1 {
    const manifest = requireFoxholeManifest(manifestValue);
    const product = manifest.contributes.experimentalProducts?.find(candidate => (
        candidate.id === FOXHOLE_FACILITY_PRODUCT_ID
    ));
    if (!product) {
        throw new Error(`The extension manifest does not declare ${FOXHOLE_FACILITY_PRODUCT_ID}.`);
    }
    return parseNixieExperimentalComponentProductV1(product);
}

/**
 * Applies entity-local selections and orders to the manifest-owned template.
 * Definitions and recipe bodies remain in extension catalogs and are never
 * copied into the returned component templates.
 */
export function createFoxholeFacilityProductionProductV1(
    manifestValue: unknown,
    input: FoxholeFacilityProductionInputV1,
): NixieExperimentalComponentProductV1 {
    const manifest = requireFoxholeManifest(manifestValue);
    const product = getFoxholeFacilityProductV1(manifest);
    const definitions = new Map(
        (manifest.contributes.experimentalComponents?.components ?? []).map(definition => [definition.id, definition]),
    );
    const dataByComponent = new Map<string, NixieExperimentalComponentJsonObjectV1>([
        [FOXHOLE_MODIFICATION_COMPONENT_ID, { selections: input.selections ?? [] }],
        [FOXHOLE_PRODUCTION_ORDER_COMPONENT_ID, {
            orders: input.orders ?? [],
            ...(input.disabled === undefined ? {} : { disabled: input.disabled }),
        }],
    ]);
    return parseNixieExperimentalComponentProductV1({
        ...product,
        components: product.components.map(component => {
            const nextData = dataByComponent.get(component.componentId) ?? component.data;
            const definition = definitions.get(component.componentId);
            if (!definition || definition.version !== component.version) {
                throw new Error(`Missing matching definition for ${component.componentId}@${component.version}.`);
            }
            return {
                ...component,
                data: validateNixieExperimentalComponentDataV1(definition.schema, nextData),
            };
        }),
    });
}
