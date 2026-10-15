<script setup lang="ts">
import NixieToolPresetsSection from '#nixie/components/nixie/toolbar/NixieToolPresetsSection.vue';
import { computed } from 'vue';
import {
    DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE,

} from '#foxhole/plugins/foxhole/nixie/binocular-line.ts';
import type { FoxholeBinocularLineEndCap } from '#foxhole/plugins/foxhole/nixie/binocular-line.ts';
import { useNixieToolbarContext } from '#nixie/composables/useNixieToolbarContext.ts';
import {
    clamp,
    colorToHex,
    hexToColorNumber,
    toBoolean,
    toNumber,
} from '#nixie/utils/nixie-toolbar-option-utils.ts';

interface BinocularLineToolOptions {
    scaleWithZoom?: boolean;
    strokeColor?: number | string;
    strokeWidth?: number;
    strokeAlpha?: number;
    multiSegmentAlpha?: number;
    showDistance?: boolean;
    showAzimuth?: boolean;
    showAzimuthArrows?: boolean;
    labelColor?: number | string;
    labelFontSize?: number;
    labelBackgroundColor?: number | string;
    labelBackgroundAlpha?: number;
    labelPadding?: number;
    labelStrokeWidth?: number;
    endpointRadius?: number;
    startCap?: FoxholeBinocularLineEndCap;
    endCap?: FoxholeBinocularLineEndCap;
    meterPixels?: number;
    decimals?: number;
}

const endCapOptions = [
    { value: 'none', label: 'None' },
    { value: 'arrow', label: 'Arrow' },
    { value: 'circle', label: 'Circle' },
] as const;

const toolbar = useNixieToolbarContext();
const canEdit = computed(() => toolbar.canEdit.value);
const options = computed(() => toolbar.getToolOptions<BinocularLineToolOptions>());
const defaults = DEFAULT_FOXHOLE_BINOCULAR_LINE_STATE;

function patchOptions(patch: Partial<BinocularLineToolOptions>): void {
    toolbar.patchActiveToolOptions<BinocularLineToolOptions>(patch);
}

const strokeColor = computed({
    get: () => colorToHex(options.value.strokeColor, defaults.strokeColor),
    set: value => patchOptions({ strokeColor: hexToColorNumber(value) }),
});

const strokeWidth = computed({
    get: () => toNumber(options.value.strokeWidth, defaults.strokeWidth),
    set: value => patchOptions({ strokeWidth: Math.max(1, value) }),
});

const strokeAlpha = computed({
    get: () => toNumber(options.value.strokeAlpha, defaults.strokeAlpha),
    set: value => patchOptions({ strokeAlpha: clamp(value, 0, 1) }),
});

const multiSegmentAlpha = computed({
    get: () => toNumber(options.value.multiSegmentAlpha, defaults.multiSegmentAlpha),
    set: value => patchOptions({ multiSegmentAlpha: clamp(value, 0, 1) }),
});

const startCap = computed({
    get: () => options.value.startCap ?? defaults.startCap,
    set: value => patchOptions({ startCap: value as FoxholeBinocularLineEndCap }),
});

const endCap = computed({
    get: () => options.value.endCap ?? defaults.endCap,
    set: value => patchOptions({ endCap: value as FoxholeBinocularLineEndCap }),
});

const decimals = computed({
    get: () => toNumber(options.value.decimals, defaults.decimals),
    set: value => patchOptions({ decimals: Math.round(clamp(value, 0, 4)) }),
});

const meterPixels = computed({
    get: () => toNumber(options.value.meterPixels, defaults.meterPixels),
    set: value => patchOptions({ meterPixels: Math.max(1, value) }),
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

const endpointRadius = computed({
    get: () => toNumber(options.value.endpointRadius, defaults.endpointRadius),
    set: value => patchOptions({ endpointRadius: Math.max(0, value) }),
});

const scaleWithZoom = computed({
    get: () => toBoolean(options.value.scaleWithZoom, defaults.scaleWithZoom),
    set: value => patchOptions({ scaleWithZoom: value }),
});

const showDistance = computed({
    get: () => toBoolean(options.value.showDistance, defaults.showDistance),
    set: value => patchOptions({ showDistance: value }),
});

const showAzimuth = computed({
    get: () => toBoolean(options.value.showAzimuth, defaults.showAzimuth),
    set: value => patchOptions({ showAzimuth: value }),
});

const showAzimuthArrows = computed({
    get: () => toBoolean(options.value.showAzimuthArrows, defaults.showAzimuthArrows),
    set: value => patchOptions({ showAzimuthArrows: value }),
});
</script>

<template>
    <NixieToolPresetsSection
        title="Stroke"
        sectionKey="foxhole.tool.stroke"
    >
        <div class="nixie-sidebar-property-fields">
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
                v-model="multiSegmentAlpha"
                class="nixie-sidebar-property-field"
                :min="0"
                :max="1"
                :step="0.05"
                label="Segment Alpha"
                :disabled="!canEdit"
            />
            <NxSelect
                v-model="startCap"
                class="nixie-sidebar-property-field"
                :options="endCapOptions"
                label="Start Cap"
                :disabled="!canEdit"
            />
            <NxSelect
                v-model="endCap"
                class="nixie-sidebar-property-field"
                :options="endCapOptions"
                label="End Cap"
                :disabled="!canEdit"
            />
            <NxNumberInput
                v-model="endpointRadius"
                class="nixie-sidebar-property-field"
                :min="0"
                :step="1"
                label="Point Radius"
                suffix="px"
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
            <NxSwitch
                v-model="scaleWithZoom"
                class="nixie-sidebar-property-field"
                label="Screen Size"
                :disabled="!canEdit"
            />
            <NxSwitch
                v-model="showDistance"
                class="nixie-sidebar-property-field"
                label="Distance"
                :disabled="!canEdit"
            />
            <NxSwitch
                v-model="showAzimuth"
                class="nixie-sidebar-property-field"
                label="Azimuth"
                :disabled="!canEdit"
            />
            <NxSwitch
                v-model="showAzimuthArrows"
                class="nixie-sidebar-property-field"
                label="Arrows"
                :disabled="!canEdit || !showAzimuth"
            />
        </div>
    </NixieToolPresetsSection>
</template>
