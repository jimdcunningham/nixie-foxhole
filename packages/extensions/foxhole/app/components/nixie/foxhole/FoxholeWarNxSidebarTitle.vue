<script setup lang="ts">
import { computed } from 'vue';
import { useFoxholeWarStatusHeader } from '#foxhole/composables/useFoxholeWarStatusHeader.ts';

const { warSummary, warPhaseDisplay } = useFoxholeWarStatusHeader();
const title = computed(() => {
    const warNumber = warSummary.value?.warNumber;
    const base = typeof warNumber === 'number' && Number.isFinite(warNumber)
        ? `Foxhole War #${warNumber}`
        : 'Foxhole War';
    const phase = warPhaseDisplay.value.label;
    return phase && phase !== 'Awaiting data' ? `${base} · ${phase}` : base;
});
</script>

<template>
    {{ title }}
</template>
