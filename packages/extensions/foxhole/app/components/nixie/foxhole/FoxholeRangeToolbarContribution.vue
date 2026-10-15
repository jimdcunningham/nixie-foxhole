<script setup lang="ts">
import NixieToolPresetsSection from '#nixie/components/nixie/toolbar/NixieToolPresetsSection.vue';
import { computed } from 'vue';
import {
    DEFAULT_FOXHOLE_RANGE_STATE,
    isFullRangeSweep,

} from '#foxhole/plugins/foxhole/nixie/range.ts';
import type { FoxholeRangeStrokeStyle } from '#foxhole/plugins/foxhole/nixie/range.ts';
import { useNixieToolbarContext } from '#nixie/composables/useNixieToolbarContext.ts';
import {
    clamp,
    colorToHex,
    hexToColorNumber,
    toBoolean,
    toNumber,
} from '#nixie/utils/nixie-toolbar-option-utils.ts';

interface RangeToolOptions {
    sweepAngle?: number;
    scaleWithZoom?: boolean;
    strokeColor?: number | string;
    strokeWidth?: number;
    strokeAlpha?: number;
    strokeStyle?: FoxholeRangeStrokeStyle;
    strokeDashLength?: number;
    strokeDashGap?: number;
    fillColor?: number | string;
    fillAlpha?: number;
    showCenterAxis?: boolean;
    showRadius?: boolean;
    showAngle?: boolean;
    labelColor?: number | string;
    labelFontSize?: number;
    labelBackgroundColor?: number | string;
    labelBackgroundAlpha?: number;
    labelPadding?: number;
    labelStrokeWidth?: number;
    centerMarkerRadius?: number;
    meterPixels?: number;
    decimals?: number;
    radiusMeters?: number;
}

const strokeStyleOptions = [
    { id: 'solid', label: 'Solid' },
    { id: 'dashed', label: 'Dashed' },
] as const;

const toolbar = useNixieToolbarContext();
const canEdit = computed(() => toolbar.canEdit.value);
const options = computed(() => toolbar.getToolOptions<RangeToolOptions>());
const defaults = DEFAULT_FOXHOLE_RANGE_STATE;
const isPie = computed(() => !isFullRangeSweep(toNumber(options.value.sweepAngle, defaults.sweepAngle)));
const isDashed = computed(() => (options.value.strokeStyle ?? defaults.strokeStyle) === 'dashed');
const radiusDecimals = computed(() => Math.round(clamp(toNumber(options.value.decimals, defaults.decimals), 0, 4)));
const radiusStep = computed(() => 10 ** -radiusDecimals.value);

function patchOptions(patch: Partial<RangeToolOptions>): void {
    toolbar.patchActiveToolOptions<RangeToolOptions>(patch);
}

const sweepAngle = computed({
    get: () => toNumber(options.value.sweepAngle, defaults.sweepAngle),
    set: value => patchOptions({ sweepAngle: Math.round(clamp(value, 1, 360)) }),
});

const radiusMeters = computed({
    get: () => toNumber(options.value.radiusMeters, radiusStep.value),
    set: value => patchOptions({ radiusMeters: Math.max(radiusStep.value, value) }),
});

const strokeStyle = computed({
    get: () => options.value.strokeStyle ?? defaults.strokeStyle,
    set: value => patchOptions({ strokeStyle: value as FoxholeRangeStrokeStyle }),
});

const strokeColor = computed({
    get: () => colorToHex(options.value.strokeColor, defaults.strokeColor),
    set: value => patchOptions({ strokeColor: hexToColorNumber(value) }),
});

const fillColor = computed({
    get: () => colorToHex(options.value.fillColor, defaults.fillColor),
    set: value => patchOptions({ fillColor: hexToColorNumber(value) }),
});

const strokeWidth = computed({
    get: () => toNumber(options.value.strokeWidth, defaults.strokeWidth),
    set: value => patchOptions({ strokeWidth: Math.max(1, value) }),
});

const strokeAlpha = computed({
    get: () => toNumber(options.value.strokeAlpha, defaults.strokeAlpha),
    set: value => patchOptions({ strokeAlpha: clamp(value, 0, 1) }),
});

const fillAlpha = computed({
    get: () => toNumber(options.value.fillAlpha, defaults.fillAlpha),
    set: value => patchOptions({ fillAlpha: clamp(value, 0, 1) }),
});

const strokeDashLength = computed({
    get: () => toNumber(options.value.strokeDashLength, defaults.strokeDashLength),
    set: value => patchOptions({ strokeDashLength: Math.max(1, value) }),
});

const strokeDashGap = computed({
    get: () => toNumber(options.value.strokeDashGap, defaults.strokeDashGap),
    set: value => patchOptions({ strokeDashGap: Math.max(1, value) }),
});

const decimals = computed({
    get: () => toNumber(options.value.decimals, defaults.decimals),
    set: value => patchOptions({ decimals: Math.round(clamp(value, 0, 4)) }),
});

const meterPixels = computed({
    get: () => toNumber(options.value.meterPixels, defaults.meterPixels),
    set: value => patchOptions({ meterPixels: Math.max(1, value) }),
});

const scaleWithZoom = computed({
    get: () => toBoolean(options.value.scaleWithZoom, defaults.scaleWithZoom),
    set: value => patchOptions({ scaleWithZoom: value }),
});

const showCenterAxis = computed({
    get: () => toBoolean(options.value.showCenterAxis, defaults.showCenterAxis),
    set: value => patchOptions({ showCenterAxis: value }),
});

const showRadius = computed({
    get: () => toBoolean(options.value.showRadius, defaults.showRadius),
    set: value => patchOptions({ showRadius: value }),
});

const showAngle = computed({
    get: () => toBoolean(options.value.showAngle, defaults.showAngle),
    set: value => patchOptions({ showAngle: value }),
});

const labelFontSize = computed({
    get: () => toNumber(options.value.labelFontSize, defaults.labelFontSize),
    set: value => patchOptions({ labelFontSize: Math.max(6, value) }),
});

const labelColor = computed({
    get: () => colorToHex(options.value.labelColor, defaults.labelColor),
    set: value => patchOptions({ labelColor: hexToColorNumber(value) }),
});

const labelBackgroundColor = computed({
    get: () => colorToHex(options.value.labelBackgroundColor, defaults.labelBackgroundColor),
    set: value => patchOptions({ labelBackgroundColor: hexToColorNumber(value) }),
});

const labelBackgroundAlpha = computed({
    get: () => toNumber(options.value.labelBackgroundAlpha, defaults.labelBackgroundAlpha),
    set: value => patchOptions({ labelBackgroundAlpha: clamp(value, 0, 1) }),
});

const labelPadding = computed({
    get: () => toNumber(options.value.labelPadding, defaults.labelPadding),
    set: value => patchOptions({ labelPadding: Math.max(0, value) }),
});

const labelStrokeWidth = computed({
    get: () => toNumber(options.value.labelStrokeWidth, defaults.labelStrokeWidth),
    set: value => patchOptions({ labelStrokeWidth: Math.max(0, value) }),
});

const centerMarkerRadius = computed({
    get: () => toNumber(options.value.centerMarkerRadius, defaults.centerMarkerRadius),
    set: value => patchOptions({ centerMarkerRadius: Math.max(1, value) }),
});
</script>

<template>
    <NixieToolPresetsSection
        title="Shape"
        sectionKey="foxhole.tool.shape"
    >
        <div class="nixie-sidebar-property-fields">
            <NxNumberInput
                v-model="sweepAngle"
                class="nixie-sidebar-property-field"
                :min="1"
                :max="360"
                :step="1"
                label="Sweep Angle"
                suffix="°"
                :disabled="!canEdit"
            />
            <NxNumberInput
                v-model="radiusMeters"
                class="nixie-sidebar-property-field"
                :min="radiusStep"
                :step="radiusStep"
                label="Radius"
                suffix="m"
                :disabled="!canEdit"
            />
        </div>
    </NixieToolPresetsSection>

    <NixieToolPresetsSection
        title="Stroke"
        sectionKey="foxhole.tool.stroke"
    >
        <div class="nixie-sidebar-property-fields">
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
                :min="1"
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
        </div>
    </NixieToolPresetsSection>

    <NixieToolPresetsSection
        title="Fill"
        sectionKey="foxhole.tool.fill"
    >
        <div class="nixie-sidebar-property-fields">
            <NxColorInput
                v-model="fillColor"
                class="nixie-sidebar-property-field"
                label="Color"
                separateSwatch
                :disabled="!canEdit"
            />
            <NxNumberInput
                v-model="fillAlpha"
                class="nixie-sidebar-property-field"
                :min="0"
                :max="1"
                :step="0.05"
                label="Alpha"
                :disabled="!canEdit"
            />
        </div>
    </NixieToolPresetsSection>

    <NixieToolPresetsSection
        title="Measurement"
        sectionKey="foxhole.tool.measurement"
    >
        <div class="nixie-sidebar-property-fields">
            <NxNumberInput
                v-model="decimals"
                class="nixie-sidebar-property-field"
                :min="0"
                :max="4"
                :step="1"
                label="Decimals"
                :disabled="!canEdit"
            />
            <NxNumberInput
                v-model="meterPixels"
                class="nixie-sidebar-property-field"
                :min="1"
                :step="1"
                label="Pixels Per Meter"
                suffix="px/m"
                :disabled="!canEdit"
            />
        </div>
    </NixieToolPresetsSection>

    <NixieToolPresetsSection
        title="Labels"
        sectionKey="foxhole.tool.labels"
    >
        <div class="nixie-sidebar-property-fields">
            <NxNumberInput
                v-model="labelFontSize"
                class="nixie-sidebar-property-field"
                :min="6"
                :step="1"
                label="Font Size"
                suffix="px"
                :disabled="!canEdit"
            />
            <NxColorInput
                v-model="labelColor"
                class="nixie-sidebar-property-field"
                label="Text Color"
                separateSwatch
                :disabled="!canEdit"
            />
            <NxColorInput
                v-model="labelBackgroundColor"
                class="nixie-sidebar-property-field"
                label="Background Color"
                separateSwatch
                :disabled="!canEdit"
            />
            <NxNumberInput
                v-model="labelBackgroundAlpha"
                class="nixie-sidebar-property-field"
                :min="0"
                :max="1"
                :step="0.05"
                label="Background Alpha"
                :disabled="!canEdit"
            />
            <NxNumberInput
                v-model="labelPadding"
                class="nixie-sidebar-property-field"
                :min="0"
                :step="1"
                label="Padding"
                suffix="px"
                :disabled="!canEdit"
            />
            <NxNumberInput
                v-model="labelStrokeWidth"
                class="nixie-sidebar-property-field"
                :min="0"
                :step="1"
                label="Stroke Width"
                suffix="px"
                :disabled="!canEdit"
            />
        </div>
    </NixieToolPresetsSection>

    <NixieToolPresetsSection
        title="Display"
        sectionKey="foxhole.tool.display"
    >
        <div class="nixie-sidebar-property-fields">
            <NxNumberInput
                v-model="centerMarkerRadius"
                class="nixie-sidebar-property-field"
                :min="1"
                :step="1"
                label="Center Marker"
                suffix="px"
                :disabled="!canEdit"
            />
            <NxSwitch
                v-model="scaleWithZoom"
                class="nixie-sidebar-property-field"
                label="Screen Size"
                :disabled="!canEdit"
            />
            <NxSwitch
                v-model="showCenterAxis"
                class="nixie-sidebar-property-field"
                label="Center Axis"
                :disabled="!canEdit"
            />
            <NxSwitch
                v-model="showRadius"
                class="nixie-sidebar-property-field"
                label="Distance"
                :disabled="!canEdit"
            />
            <NxSwitch
                v-model="showAngle"
                class="nixie-sidebar-property-field"
                label="Angle"
                :disabled="!canEdit || !isPie"
            />
        </div>
    </NixieToolPresetsSection>
</template>
