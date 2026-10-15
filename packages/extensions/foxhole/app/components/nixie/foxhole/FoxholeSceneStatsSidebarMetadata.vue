<script setup lang="ts">
import { useFoxholeStatsSidebarHeaderState } from '#foxhole/composables/foxholeStatsSidebarHeaderState.ts';

const { scopeLabel } = useFoxholeStatsSidebarHeaderState();
</script>

<template>
    {{ scopeLabel }}
</template>
