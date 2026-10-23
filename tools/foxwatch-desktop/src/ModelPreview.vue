<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
const props = defineProps<{ bytes: Uint8Array }>();
const emit = defineEmits<{ ready: [] }>();
const host = ref<HTMLElement>();
const loading = ref(true),
  error = ref(''),
  statistics = ref('');
let disposed = false;
let cleanup: (() => void) | undefined;
let reset = () => {};
onMounted(async () => {
  try {
    const { createModelPreview } = await import('./model-viewer');
    if (disposed || !host.value) return;
    const viewer = await createModelPreview(
      host.value,
      props.bytes,
      () => disposed,
    );
    if (!viewer) return;
    cleanup = viewer.destroy;
    reset = viewer.reset;
    statistics.value = viewer.statistics;
  } catch (cause) {
    console.error(cause);
    if (!disposed)
      error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (!disposed) {
      loading.value = false;
      emit('ready');
    }
  }
});
onBeforeUnmount(() => {
  disposed = true;
  cleanup?.();
});
</script>
<template>
  <div class="model-preview">
    <div class="preview-toolbar">
      <button :disabled="loading || !!error" @click="reset">Reset View</button
      ><span class="muted"
        >Drag to orbit · Right-drag to pan · Scroll to zoom</span
      >
      <div class="toolbar-spacer" />
      <span>{{ statistics }}</span>
    </div>
    <div ref="host" class="model-viewport" aria-label="3D Model Preview">
      <div
        v-if="loading || error"
        class="model-message"
        :role="error ? 'alert' : undefined"
      >
        {{ error || 'Loading model…' }}
      </div>
    </div>
  </div>
</template>
