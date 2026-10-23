<script setup lang="ts">
import { computed } from 'vue';
import type { AssetComparison } from '../shared/contracts';
import ImageComparison from './ImageComparison.vue';
import ModelComparison from './ModelComparison.vue';
import ManifestComparison from './ManifestComparison.vue';
const props = defineProps<{ pair: AssetComparison }>();
defineEmits<{ready:[]}>();
const kind = computed(() => props.pair.after?.asset.kind ?? props.pair.before?.asset.kind);
</script>
<template>
  <div class="comparison-content">
    <div class="comparison-caption"><span>A · Approved {{ pair.approvedAt ? new Date(pair.approvedAt).toLocaleString() : '(No Baseline)' }}</span><span>B · Working Files</span></div>
    <ImageComparison v-if="kind === 'image'" :pair="pair" @ready="$emit('ready')"/>
    <ModelComparison v-else-if="kind === 'model'" :pair="pair" @ready="$emit('ready')"/>
    <ManifestComparison v-else :pair="pair" @ready="$emit('ready')"/>
  </div>
</template>
