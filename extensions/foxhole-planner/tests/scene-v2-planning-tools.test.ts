import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseNixieExtensionManifestV1, validateNixieExperimentalComponentDataV1 } from '@nixie/extension-sdk';
import { projectNixieExperimentalInspectorSubjectV1, validateNixieExperimentalInspectorResultV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import type { NixieExtensionRenderNodeV1, NixieExperimentalComponentEntitySnapshotV1 } from '@nixie/extension-sdk/experimental/scene-v2';
import { renderFoxholeSceneV2Entity } from '../src/scene-v2-renderers.ts';
import { inspectFoxholeSceneV2PlanningPath } from '../src/scene-v2-inspector.ts';
import { FOXHOLE_TACTICAL_PRESET_CHOICES, FOXHOLE_TACTICAL_PRESET_FIELDS } from '../src/tactical-line-presets.ts';

const manifest = parseNixieExtensionManifestV1(JSON.parse(readFileSync(new URL('../nixie.extension.json', import.meta.url), 'utf8')));
function subject(id: string, points: number[]): NixieExperimentalComponentEntitySnapshotV1 {
    const tool = manifest.contributes.experimentalProductTools!.find(entry => entry.id === `planning.${id}`)!;
    const product = manifest.contributes.experimentalProducts!.find(entry => entry.id === tool.productId)!;
    const definition = manifest.contributes.experimentalComponents!.components.find(entry => entry.id === id)!;
    const components = product.components.map(component => ({ ...component, definitionAvailable: true,
        data: { ...component.data, [definition.geometryPropertyId ?? 'points']: points } }));
    for (const component of components) {
        validateNixieExperimentalComponentDataV1(definition.schema, component.data);
    }
    return { entityId: 'planning-fixture', revision: 1, components };
}
function nodes(node: NixieExtensionRenderNodeV1): NixieExtensionRenderNodeV1[] {
    return [node, ...(node.kind === 'group' ? node.children.flatMap(nodes) : [])];
}

test('planning tools reference declared paths and preserve the Native meter scale and rendered measurements', () => {
    for (const id of ['range', 'binocular-line', 'tactical-line']) {
        assert.equal(manifest.contributes.experimentalComponents!.components.find(entry => entry.id === id)?.geometry, 'polyline');
    }
    const range = subject('range', [0, 0, 320, 0]);
    const binoculars = subject('binocular-line', [0, 0, 320, 0, 320, 320]);
    assert.equal(range.components[0]!.data.meterPixels, 32);
    assert.equal(binoculars.components[0]!.data.meterPixels, 32);
    const text = (entity: typeof range) => nodes(renderFoxholeSceneV2Entity(entity).root).flatMap(node => node.kind === 'text' ? [node.text] : []);
    assert.ok(text(range).some(label => /10(?:\.0)?\s*m/.test(label)));
    assert.ok(text(binoculars).some(label => /10(?:\.0)?\s*m/.test(label)));
    assert.ok(text(binoculars).some(label => label.includes('°')));
    const tactical = subject('tactical-line', [0, 0, 160, -80, 320, 0]);
    assert.equal(tactical.components[0]!.data.decoratorMode, 'semicircle');
    assert.ok(nodes(renderFoxholeSceneV2Entity(tactical).root).some(node => node.kind === 'graphics' && node.commands.length > 3));
});

test('planning Inspectors hide fixed measurement scale and internal preset identity while retaining authored styling', () => {
    for (const id of ['range', 'binocular-line', 'tactical-line', 'triangulation']) {
        const entity = subject(id, id === 'triangulation' ? [0, 0, 320, 0, 0, 320] : [0, 0, 320, 0]);
        const provider = manifest.contributes.experimentalInspectorProviders!.find(entry => entry.id === id)!;
        const request = projectNixieExperimentalInspectorSubjectV1(entity, manifest.id, provider);
        const result = inspectFoxholeSceneV2PlanningPath(request);
        validateNixieExperimentalInspectorResultV1(result, provider, manifest.contributes.experimentalComponents!.components, request);
        assert.deepEqual(result.components[0]!.fields.find(field => field.path[0] === (id === 'tactical-line' ? 'presetId' : 'meterPixels')),
            { path: [id === 'tactical-line' ? 'presetId' : 'meterPixels'], hidden: true });
        assert.equal(result.components[0]!.fields.some(field => field.path[0] === 'strokeColor'), false);
    }
});

test('tactical preset choices reset all styling fields together and preserve authored vertices', () => {
    const entity = subject('tactical-line', [0, 0, 160, -80, 320, 0]);
    const provider = manifest.contributes.experimentalInspectorProviders!.find(entry => entry.id === 'tactical-line')!;
    const request = projectNixieExperimentalInspectorSubjectV1(entity, manifest.id, provider);
    const result = inspectFoxholeSceneV2PlanningPath(request);
    validateNixieExperimentalInspectorResultV1(result, provider, manifest.contributes.experimentalComponents!.components, request);
    const choices = result.components[0]!.fields.find(field => field.path.length === 0)!.choices!;
    assert.deepEqual(choices.valuePropertyIds, FOXHOLE_TACTICAL_PRESET_FIELDS);
    assert.equal(choices.options.length, 5);
    assert.ok(choices.valuePropertyIds!.length > 16);
    for (const preset of FOXHOLE_TACTICAL_PRESET_CHOICES) {
        assert.deepEqual(Object.keys(preset.value), FOXHOLE_TACTICAL_PRESET_FIELDS);
        assert.equal(typeof preset.value.strokeDashLength, 'number');
        assert.equal(typeof preset.value.strokeDashGap, 'number');
        const styled: NixieExperimentalComponentEntitySnapshotV1 = { ...entity,
            components: entity.components.map(component => ({ ...component, data: { ...component.data, ...preset.value } })) };
        assert.deepEqual(styled.components[0]!.data.points, entity.components[0]!.data.points);
        assert.ok(nodes(renderFoxholeSceneV2Entity(styled).root).some(node => node.kind === 'graphics' && node.commands.length > 3));
    }
});

test('triangulation product uses authored edge points and renders its fitted radius', () => {
    const entity = subject('triangulation', [0, 0, 320, 0, 0, 320]);
    const rendered = nodes(renderFoxholeSceneV2Entity(entity).root);
    assert.equal(Object.hasOwn(entity.components[0]!.data, 'points'), false);
    assert.equal(entity.components[0]!.data.meterPixels, 32);
    assert.ok(rendered.some(node => node.kind === 'text' && node.text.includes('7.1m')));
    assert.ok(rendered.some(node => node.kind === 'graphics' && node.commands.some(command => command.op === 'circle')));
});

test('range render plans declare their authored center as the host rotation origin', () => {
    for (const points of [[0, 0, 80, 0], [12, -40, -90, 30]]) {
        const plan = renderFoxholeSceneV2Entity(subject('range', points));
        assert.deepEqual(plan.experimentalSelectionGeometry?.transformOrigin, { x: points[0], y: points[1] });
    }
});
