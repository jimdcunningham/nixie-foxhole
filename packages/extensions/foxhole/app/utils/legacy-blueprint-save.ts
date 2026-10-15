import { LEGACY_BLUEPRINT_LIMITS } from '#nixie/utils/legacy-blueprint-archive-bounds.ts';
const containers = new Set(['layer', 'container', 'group', 'ly', 'cn']);

export function checkLegacyBlueprintSave(save: unknown): void {
    if (!save || typeof save !== 'object' || !Array.isArray((save as { entities?: unknown; }).entities)) {
        throw new Error('Invalid Blueprint project data.');
    }
    const entities = (save as { entities: Record<string, unknown>[]; }).entities;
    if (entities.length > LEGACY_BLUEPRINT_LIMITS.entities) {
        throw new Error('Blueprint has too many entities.');
    }
    let images = 0;
    const ids = new Set<string>();
    for (const entity of entities) {
        if (!entity || typeof entity !== 'object' || Array.isArray(entity) || ids.has(String(entity.id))
            || !((typeof entity.id === 'number' && Number.isFinite(entity.id))
                || (typeof entity.id === 'string' && entity.id.trim().length > 0 && entity.id.length <= 128))) {
            throw new Error('Invalid or duplicate Blueprint entity identity.');
        }
        ids.add(String(entity.id));
        if (entity.type === 'image') {
            if (++images > LEGACY_BLUEPRINT_LIMITS.images) {
                throw new Error('Blueprint has too many images.');
            }
            if (typeof entity.textureData === 'string' && (entity.textureData.length > LEGACY_BLUEPRINT_LIMITS.imageBytes
                || /^data:(?!image\/(?:png|jpeg|webp|gif)(?:;|,))/i.test(entity.textureData))) {
                throw new Error('Unsupported Blueprint image data.');
            }
            if (typeof entity.textureFile === 'string' && /^(?:https?:|\/\/|data:)/i.test(entity.textureFile)) {
                throw new Error('External Blueprint images are unsupported.');
            }
        }
    }
}

export function legacyHasPublicationContent(entities: unknown): boolean {
    return Array.isArray(entities) && entities.some(entity => {
        if (!entity || typeof entity !== 'object') {
            return false;
        }
        if (entity.type === 'text') {
            return Boolean(String(entity.label ?? '').trim());
        }
        if (entity.type === 'image') {
            return Boolean(entity.textureFile || entity.textureData);
        }
        return Boolean(entity.key || (entity.type && !containers.has(entity.type)));
    });
}
