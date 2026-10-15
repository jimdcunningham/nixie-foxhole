<script setup lang="ts">
import NixieToolPresetsSection from '#nixie/components/nixie/toolbar/NixieToolPresetsSection.vue';
import { computed } from 'vue';
import {
    getFoxholeTacticalLinePreset,

} from '#foxhole/plugins/foxhole/nixie/tactical-line.ts';
import type { FoxholeTacticalLineCap, FoxholeTacticalLineCurveMode, FoxholeTacticalLineDecoratorMode, FoxholeTacticalLineDecoratorSide, FoxholeTacticalLinePresetId, FoxholeTacticalLineStrokeStyle } from '#foxhole/plugins/foxhole/nixie/tactical-line.ts';
import { useNixieToolbarContext } from '#nixie/composables/useNixieToolbarContext.ts';
import {
    clamp,
    colorToHex,
    hexToColorNumber,
    toBoolean,
    toNumber,
} from '#nixie/utils/nixie-toolbar-option-utils.ts';

interface TacticalLineToolOptions {
    scaleWithZoom?: boolean;
    curveMode?: FoxholeTacticalLineCurveMode;
    strokeColor?: number | string;
    strokeWidth?: number;
    strokeAlpha?: number;
    strokeStyle?: FoxholeTacticalLineStrokeStyle;
    strokeDashLength?: number;
    strokeDashGap?: number;
    startCap?: FoxholeTacticalLineCap;
    endCap?: FoxholeTacticalLineCap;
    decoratorMode?: FoxholeTacticalLineDecoratorMode;
    decoratorSide?: FoxholeTacticalLineDecoratorSide;
    decoratorSize?: number;
    decoratorSpacing?: number;
    decoratorFill?: boolean;
    decoratorColor?: number | string;
    decoratorAlpha?: number;
}

const curveOptions = [
    { id: 'polyline', label: 'Polyline' },
    { id: 'smooth', label: 'Smooth' },
] as const;

const strokeStyleOptions = [
    { id: 'solid', label: 'Solid' },
    { id: 'dashed', label: 'Dashed' },
] as const;

const capOptions = [
    { value: 'none', label: 'None' },
    { value: 'arrow', label: 'Arrow' },
    { value: 'flag', label: 'Flag' },
    { value: 'circle', label: 'Circle' },
] as const;

const decoratorOptions = [
    { value: 'none', label: 'None' },
    { value: 'semicircle', label: 'Semicircle' },
    { value: 'triangle', label: 'Triangle' },
    { value: 'tick', label: 'Tick' },
    { value: 'block', label: 'Block' },
    { value: 'cross', label: 'Cross' },
    { value: 'arrow', label: 'Arrow' },
] as const;

const decoratorSideOptions = [
    { id: 'left', label: 'Left' },
    { id: 'both', label: 'Both' },
    { id: 'right', label: 'Right' },
] as const;

const toolbar = useNixieToolbarContext();
const canEdit = computed(() => toolbar.canEdit.value);
const options = computed(() => toolbar.getToolOptions<TacticalLineToolOptions>());
const activePreset = computed(() => getFoxholeTacticalLinePreset(
    (options.value as TacticalLineToolOptions & { presetId?: FoxholeTacticalLinePresetId; }).presetId ?? 'frontline',
));
const isDashed = computed(() => (options.value.strokeStyle ?? activePreset.value.strokeStyle) === 'dashed');
const isDecorated = computed(() => (options.value.decoratorMode ?? activePreset.value.decoratorMode) !== 'none');

function patchOptions(patch: Partial<TacticalLineToolOptions>): void {
    toolbar.patchActiveToolOptions<TacticalLineToolOptions>(patch);
}

const curveMode = computed({
    get: () => options.value.curveMode ?? activePreset.value.curveMode,
    set: value => patchOptions({ curveMode: value as FoxholeTacticalLineCurveMode }),
});

const strokeStyle = computed({
    get: () => options.value.strokeStyle ?? activePreset.value.strokeStyle,
    set: value => patchOptions({ strokeStyle: value as FoxholeTacticalLineStrokeStyle }),
});

const strokeColor = computed({
    get: () => colorToHex(options.value.strokeColor, activePreset.value.strokeColor),
    set: value => patchOptions({ strokeColor: hexToColorNumber(value) }),
});

const strokeWidth = computed({
    get: () => toNumber(options.value.strokeWidth, activePreset.value.strokeWidth),
    set: value => patchOptions({ strokeWidth: Math.max(1, value) }),
});

const strokeAlpha = computed({
    get: () => toNumber(options.value.strokeAlpha, activePreset.value.strokeAlpha),
    set: value => patchOptions({ strokeAlpha: clamp(value, 0, 1) }),
});

const strokeDashLength = computed({
    get: () => toNumber(options.value.strokeDashLength, activePreset.value.strokeDashLength),
    set: value => patchOptions({ strokeDashLength: Math.max(2, value) }),
});

const strokeDashGap = computed({
    get: () => toNumber(options.value.strokeDashGap, activePreset.value.strokeDashGap),
    set: value => patchOptions({ strokeDashGap: Math.max(1, value) }),
});

const startCap = computed({
    get: () => options.value.startCap ?? activePreset.value.startCap,
    set: value => patchOptions({ startCap: value as FoxholeTacticalLineCap }),
});

const endCap = computed({
    get: () => options.value.endCap ?? activePreset.value.endCap,
    set: value => patchOptions({ endCap: value as FoxholeTacticalLineCap }),
});

const decoratorMode = computed({
    get: () => options.value.decoratorMode ?? activePreset.value.decoratorMode,
    set: value => patchOptions({ decoratorMode: value as FoxholeTacticalLineDecoratorMode }),
});

const decoratorSide = computed({
    get: () => options.value.decoratorSide ?? activePreset.value.decoratorSide,
    set: value => patchOptions({ decoratorSide: value as FoxholeTacticalLineDecoratorSide }),
});

const decoratorColor = computed({
    get: () => colorToHex(options.value.decoratorColor, activePreset.value.decoratorColor),
    set: value => patchOptions({ decoratorColor: hexToColorNumber(value) }),
});

const decoratorSize = computed({
    get: () => toNumber(options.value.decoratorSize, activePreset.value.decoratorSize),
    set: value => patchOptions({ decoratorSize: Math.max(1, value) }),
});

const decoratorSpacing = computed({
    get: () => toNumber(options.value.decoratorSpacing, activePreset.value.decoratorSpacing),
    set: value => patchOptions({ decoratorSpacing: Math.max(4, value) }),
});

const scaleWithZoom = computed({
    get: () => toBoolean(options.value.scaleWithZoom, activePreset.value.scaleWithZoom),
    set: value => patchOptions({ scaleWithZoom: value }),
});

const decoratorFill = computed({
    get: () => toBoolean(options.value.decoratorFill, activePreset.value.decoratorFill),
    set: value => patchOptions({ decoratorFill: value }),
});
</script>

<template>
    <NixieToolPresetsSection
        title="Stroke"
        sectionKey="foxhole.tool.stroke"
    >
        <div class="nixie-sidebar-property-fields">
            <div class="nx-field nixie-sidebar-property-field">
                <span class="nx-field__label">Curve</span>
                <NxSlidingSwitcher
                    v-model="curveMode"
                    :items="curveOptions"
                    ariaLabel="Curve"
                />
            </div>
            <div class="nx-field nixie-sidebar-property-field">
                <span class="nx-field__label">Style</span>
                <NxSlidingSwitcher
                    v-model="strokeStyle"
                    :items="strokeStyleOptions"
                    ariaLabel="Stroke Style"
                />
            </div>
            <NxColorInput
                v-model="strokeColor"
                class="nixie-sidebar-property-field"
                label="Color"
                separateSwatch
                :disabled="!canEdit"
            />
            <NxNumberInput
                v-model="strokeWidth"
                class="nixie-sidebar-property-field"
                :min="1"
                :step="1"
                label="Width"
                suffix="px"
                :disabled="!canEdit"
            />
            <NxNumberInput
                v-model="strokeAlpha"
                class="nixie-sidebar-property-field"
                :min="0"
                :max="1"
                :step="0.05"
                label="Alpha"
                :disabled="!canEdit"
            />
            <NxNumberInput
                v-if="isDashed"
                v-model="strokeDashLength"
                class="nixie-sidebar-property-field"
                :min="2"
                :step="1"
                label="Dash"
                suffix="px"
                :disabled="!canEdit"
            />
            <NxNumberInput
                v-if="isDashed"
                v-model="strokeDashGap"
                class="nixie-sidebar-property-field"
                :min="1"
                :step="1"
                label="Gap"
                suffix="px"
                :disabled="!canEdit"
            />
            <NxSwitch
                v-model="scaleWithZoom"
                class="nixie-sidebar-property-field"
                label="Screen Size"
                :disabled="!canEdit"
            />
        </div>
    </NixieToolPresetsSection>

    <NixieToolPresetsSection
        title="Caps"
        sectionKey="foxhole.tool.caps"
    >
        <div class="nixie-sidebar-property-fields">
            <NxSelect
                v-model="startCap"
                class="nixie-sidebar-property-field"
                :options="capOptions"
                label="Start"
                :disabled="!canEdit"
            />
            <NxSelect
                v-model="endCap"
                class="nixie-sidebar-property-field"
                :options="capOptions"
                label="End"
                :disabled="!canEdit"
            />
        </div>
    </NixieToolPresetsSection>

    <NixieToolPresetsSection
        title="Markers"
        sectionKey="foxhole.tool.markers"
    >
        <div class="nixie-sidebar-property-fields">
            <NxSelect
                v-model="decoratorMode"
                class="nixie-sidebar-property-field"
                :options="decoratorOptions"
                label="Mode"
                :disabled="!canEdit"
            />
            <div v-if="isDecorated" class="nx-field nixie-sidebar-property-field">
                <span class="nx-field__label">Side</span>
                <NxSlidingSwitcher
                    v-model="decoratorSide"
                    :items="decoratorSideOptions"
                    ariaLabel="Marker Side"
                />
            </div>
            <NxColorInput
                v-if="isDecorated"
                v-model="decoratorColor"
                class="nixie-sidebar-property-field"
                label="Color"
                separateSwatch
                :disabled="!canEdit"
            />
            <NxNumberInput
                v-if="isDecorated"
                v-model="decoratorSize"
                class="nixie-sidebar-property-field"
                :min="1"
                :step="1"
                label="Size"
                suffix="px"
                :disabled="!canEdit"
            />
            <NxNumberInput
                v-if="isDecorated"
                v-model="decoratorSpacing"
                class="nixie-sidebar-property-field"
                :min="4"
                :step="1"
                label="Spacing"
                suffix="px"
                :disabled="!canEdit"
            />
            <NxSwitch
                v-if="isDecorated"
                v-model="decoratorFill"
                class="nixie-sidebar-property-field"
                label="Fill Marker"
                :disabled="!canEdit"
            />
        </div>
    </NixieToolPresetsSection>
</template>
