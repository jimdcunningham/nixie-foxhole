<script setup lang="ts">
import type { NxSegmentedTabItem } from '#nixie/components/NxSegmentedTabs.vue';
import NxSegmentedTabs from '#nixie/components/NxSegmentedTabs.vue';

const warViewTabItems: readonly NxSegmentedTabItem[] = [
    { id: 'map', label: 'Map' },
    { id: 'live', label: 'Live' },
    { id: 'pulse', label: 'Pulse' },
    { id: 'split', label: 'Split' },
];

const model = defineModel<string>({ required: true });
</script>

<template>
    <NxSegmentedTabs
        v-model="model"
        :items="warViewTabItems"
        aria-label="Foxhole War Views"
    />
</template>
