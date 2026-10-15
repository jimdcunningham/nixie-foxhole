<script setup lang="ts">
import NixieSidebarHeadingOverflow from '#nixie/components/nixie/NixieSidebarHeadingOverflow.vue';
import type { ResolvedMenuItem } from '#nixie/plugins/nixie/registry/menu-resolver.ts';
import { useFoxholeStatsSidebarHeaderState } from '#foxhole/composables/foxholeStatsSidebarHeaderState.ts';

const emit = defineEmits<{
    'close-sidebar': [];
}>();
const { openExportDialog } = useFoxholeStatsSidebarHeaderState();
const items: ResolvedMenuItem[] = [{
    type: 'item',
    label: 'Export Statistics',
    icon: 'ph:export',
    closeOnClick: true,
    adminOnly: false,
    disabled: false,
    visible: true,
    onClick: openExportDialog,
}];
</script>

<template>
    <NixieSidebarHeadingOverflow :items="items" @close-sidebar="emit('close-sidebar')" />
</template>
