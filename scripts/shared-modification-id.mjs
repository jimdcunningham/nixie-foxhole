import { createHash } from 'node:crypto';

export function normalizeStandaloneModificationKeyComponent(value) {
    return String(value ?? '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

export function normalizeStandaloneModificationIdentityPart(value) {
    return String(value ?? '').trim().toLowerCase();
}

export function createSharedModificationHashDiagnosticInput(value) {
    const raw = value == null ? '' : String(value);
    return {
        raw,
        normalized: normalizeStandaloneModificationIdentityPart(raw),
    };
}

export function getStandaloneModificationIdentityText(value) {
    if (typeof value === 'string') {
        return value;
    }

    if (value && typeof value === 'object') {
        if (typeof value.fallback === 'string' && value.fallback.trim()) {
            return value.fallback;
        }

        if (typeof value.id === 'string' && value.id.trim()) {
            return value.id;
        }
    }

    return '';
}

export function resolveTemplatePathForSharedModificationIdentity(variant) {
    const templateActorPath = String(variant?.templateActorPath ?? '').trim();
    if (templateActorPath) {
        return templateActorPath;
    }

    const templateMeshPath = String(variant?.templateMeshPath ?? '').trim();
    if (templateMeshPath) {
        return templateMeshPath;
    }

    return String(variant?.previewMeshPath ?? '').trim();
}

function finalizeSharedModificationIdComputation({
    variantIdInput,
    templatePathInput,
    previewDirection = 'se',
    extraInputs = {},
}) {
    const identity = [
        variantIdInput.normalized,
        templatePathInput.normalized,
    ].join('|');
    const normalizedVariantId = normalizeStandaloneModificationKeyComponent(variantIdInput.raw);
    const fullHashHex = createHash('sha256').update(identity).digest('hex');
    const truncatedHashHex = fullHashHex.slice(0, 12);

    return {
        previewDirection,
        variantIdInput,
        templatePathInput,
        templateActorPathInput: extraInputs.templateActorPathInput ?? createSharedModificationHashDiagnosticInput(''),
        templateMeshPathInput: extraInputs.templateMeshPathInput ?? createSharedModificationHashDiagnosticInput(''),
        previewMeshPathInput: extraInputs.previewMeshPathInput ?? createSharedModificationHashDiagnosticInput(''),
        nameInput: extraInputs.nameInput ?? createSharedModificationHashDiagnosticInput(''),
        descriptionInput: extraInputs.descriptionInput ?? createSharedModificationHashDiagnosticInput(''),
        previewDirectionInput: extraInputs.previewDirectionInput ?? createSharedModificationHashDiagnosticInput(previewDirection),
        identity,
        normalizedVariantId,
        fullHashHex,
        truncatedHashHex,
        generatedSharedModificationId: normalizedVariantId
            ? `${normalizedVariantId}-${truncatedHashHex}`
            : truncatedHashHex,
    };
}

export function buildSharedModificationIdComputation(variantId, variant, structurePreviewDirection) {
    const previewDirection = normalizeStandaloneModificationIdentityPart(variant?.previewDirection)
        || normalizeStandaloneModificationIdentityPart(structurePreviewDirection)
        || 'se';
    const variantIdInput = createSharedModificationHashDiagnosticInput(variantId);
    const templatePathInput = createSharedModificationHashDiagnosticInput(
        resolveTemplatePathForSharedModificationIdentity(variant),
    );

    return finalizeSharedModificationIdComputation({
        variantIdInput,
        templatePathInput,
        previewDirection,
        extraInputs: {
            templateActorPathInput: createSharedModificationHashDiagnosticInput(variant?.templateActorPath),
            templateMeshPathInput: createSharedModificationHashDiagnosticInput(variant?.templateMeshPath),
            previewMeshPathInput: createSharedModificationHashDiagnosticInput(variant?.previewMeshPath),
            nameInput: createSharedModificationHashDiagnosticInput(getStandaloneModificationIdentityText(variant?.name)),
            descriptionInput: createSharedModificationHashDiagnosticInput(getStandaloneModificationIdentityText(variant?.description)),
            previewDirectionInput: createSharedModificationHashDiagnosticInput(previewDirection),
        },
    });
}

export function buildLegacySharedModificationIdComputation(variantId, variant, structurePreviewDirection) {
    const previewDirection = normalizeStandaloneModificationIdentityPart(variant?.previewDirection)
        || normalizeStandaloneModificationIdentityPart(structurePreviewDirection)
        || 'se';
    const variantIdInput = createSharedModificationHashDiagnosticInput(variantId);
    const templateActorPathInput = createSharedModificationHashDiagnosticInput(variant?.templateActorPath);
    const templateMeshPathInput = createSharedModificationHashDiagnosticInput(variant?.templateMeshPath);
    const previewMeshPathInput = createSharedModificationHashDiagnosticInput(variant?.previewMeshPath);
    const nameInput = createSharedModificationHashDiagnosticInput(getStandaloneModificationIdentityText(variant?.name));
    const descriptionInput = createSharedModificationHashDiagnosticInput(getStandaloneModificationIdentityText(variant?.description));
    const previewDirectionInput = createSharedModificationHashDiagnosticInput(previewDirection);
    const identity = [
        variantIdInput.normalized,
        templateActorPathInput.normalized,
        templateMeshPathInput.normalized,
        previewMeshPathInput.normalized,
        nameInput.normalized,
        descriptionInput.normalized,
        previewDirectionInput.normalized,
    ].join('|');
    const normalizedVariantId = normalizeStandaloneModificationKeyComponent(variantId);
    const fullHashHex = createHash('sha256').update(identity).digest('hex');
    const truncatedHashHex = fullHashHex.slice(0, 12);

    return {
        previewDirection,
        variantIdInput,
        templatePathInput: createSharedModificationHashDiagnosticInput(resolveTemplatePathForSharedModificationIdentity(variant)),
        templateActorPathInput,
        templateMeshPathInput,
        previewMeshPathInput,
        nameInput,
        descriptionInput,
        previewDirectionInput,
        identity,
        normalizedVariantId,
        fullHashHex,
        truncatedHashHex,
        generatedSharedModificationId: normalizedVariantId
            ? `${normalizedVariantId}-${truncatedHashHex}`
            : truncatedHashHex,
    };
}
