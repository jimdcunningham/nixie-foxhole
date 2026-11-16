import assert from 'node:assert/strict';
import { projectNixieInspectorSubjectV1 } from '@nixiejs/extension-sdk/scene-v2';
import type { NixieSceneV2ComponentHost } from '../../../../nixie/desktop-extensions/scene-v2-component-host.ts';
import { inspectFoxholeSceneV2Structure } from '../../../../../extensions/foxhole-planner/src/scene-v2-inspector.ts';

export function applyFoxholeAppearanceChoice(
    host: NixieSceneV2ComponentHost,
    entityId: string,
    provider: Parameters<typeof projectNixieInspectorSubjectV1>[2],
    label: string,
) {
    const ownerId = 'nixie.foxhole-planner';
    const subject = host.readEntity(entityId);
    const request = projectNixieInspectorSubjectV1(subject, ownerId, provider);
    const appearance = inspectFoxholeSceneV2Structure(request).components.find(entry => entry.componentId === 'appearance');
    const value = appearance?.fields.find(field => field.path.length === 0)?.choices?.options.find(option => option.label === label)?.value;
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), label);
    return host.applyEditorComponentPatch({ entityId, ownerId, componentId: 'appearance', set: value, createIfMissing: true });
}
