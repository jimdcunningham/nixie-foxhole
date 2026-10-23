<script setup lang="ts">
import { computed } from 'vue';
import type { AssetComparison } from '../shared/contracts';
import ImageComparison from './ImageComparison.vue';
import ModelComparison from './ModelComparison.vue';
import ManifestComparison from './ManifestComparison.vue';
import { compareFileSizes, formatFileSize } from '../shared/file-size';
const props = defineProps<{ pair: AssetComparison }>();
defineEmits<{ready:[]}>();
const beforeBytes = computed(() => props.pair.before?.asset.bytes ?? null);
const afterBytes = computed(() => props.pair.after?.asset.bytes ?? null);
const sizeChange = computed(() => compareFileSizes(beforeBytes.value, afterBytes.value));
const exactSize = (bytes: number | null) => bytes === null ? 'File not present' : `${bytes.toLocaleString()} B on disk`;
const kind = computed(() => props.pair.after?.asset.kind ?? props.pair.before?.asset.kind);
</script>
<template>
  <div class="comparison-content">
    <div class="comparison-caption"><span>A · Approved {{ pair.approvedAt ? new Date(pair.approvedAt).toLocaleString() : '(No Baseline)' }}</span><span>B · Working Files</span></div>
    <div class="comparison-sizes" role="group" aria-label="File Size Comparison">
      <span :title="exactSize(beforeBytes)"><span class="muted">A · Approved Size</span><strong>{{ beforeBytes === null ? 'Not Present' : formatFileSize(beforeBytes) }}</strong></span>
      <span :title="exactSize(afterBytes)"><span class="muted">B · Working Size</span><strong>{{ afterBytes === null ? 'Not Present' : formatFileSize(afterBytes) }}</strong></span>
      <span :title="sizeChange.exact + ' on disk'" aria-label="Size Change"><span class="muted">Change</span><strong>{{ sizeChange.label }}</strong></span>
    </div>
    <ImageComparison v-if="kind === 'image'" :pair="pair" @ready="$emit('ready')"/>
    <ModelComparison v-else-if="kind === 'model'" :pair="pair" @ready="$emit('ready')"/>
    <ManifestComparison v-else :pair="pair" @ready="$emit('ready')"/>
  </div>
</template>
