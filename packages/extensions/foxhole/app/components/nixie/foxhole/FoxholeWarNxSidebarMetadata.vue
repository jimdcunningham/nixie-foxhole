<script setup lang="ts">
import { useFoxholeWarStatusHeader } from '#foxhole/composables/useFoxholeWarStatusHeader.ts';

const { statusDetail } = useFoxholeWarStatusHeader();
</script>

<template>
    <span :title="statusDetail.title ?? undefined">{{ statusDetail.label }}</span>
</template>
