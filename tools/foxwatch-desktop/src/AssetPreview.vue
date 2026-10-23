<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type {
  AssetDetails,
  AssetPreview as Preview,
} from '../shared/contracts';
import ImagePreview from './ImagePreview.vue';
import ModelPreview from './ModelPreview.vue';
import Icon from './Icon.vue';
const props = defineProps<{ rootId: string; asset: AssetDetails }>();
const preview = shallowRef<Preview | null>(null);
const loading = ref(false);
const error = ref('');
const pretty = ref(true);
let version = 0;
const text = computed(() => {
  const value = preview.value;
  if (value?.type !== 'text') return '';
  if (pretty.value && value.json && !value.truncated) {
    try {
      return JSON.stringify(JSON.parse(value.text), null, 2);
    } catch {
      /* Preserve invalid JSON for inspection. */
    }
  }
  return value.text;
});
watch(
  () => [props.rootId, props.asset.path, props.asset.modifiedAt],
  async () => {
    const token = ++version;
    preview.value = null;
    error.value = '';
    loading.value = true;
    try {
      const value = await window.foxwatch.preview(
        props.rootId,
        props.asset.path,
      );
      if (token === version) preview.value = value;
    } catch (cause) {
      if (token === version)
        error.value = String(
          cause instanceof Error ? cause.message : cause,
        ).replace(/^Error invoking remote method '[^']+': Error: /, '');
    } finally {
      if (token === version) loading.value = false;
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => version++);
</script>
<template>
  <div class="asset-preview">
    <div
      v-if="loading || error || preview?.type === 'unsupported'"
      class="preview-placeholder"
      :role="error ? 'alert' : undefined"
    >
      <Icon :name="asset.kind" :size="40" />
      <p>
        {{
          loading
            ? 'Loading preview…'
            : error || (preview?.type === 'unsupported' ? preview.message : '')
        }}
      </p>
    </div>
    <ImagePreview
      v-else-if="preview?.type === 'image'"
      :key="asset.path"
      :bytes="preview.bytes"
      :mime="preview.mime"
      :label="asset.label"
    />
    <ModelPreview
      v-else-if="preview?.type === 'model'"
      :key="asset.path"
      :bytes="preview.bytes"
    />
    <template v-else-if="preview?.type === 'text'">
      <div class="preview-toolbar">
        <span>{{ preview.json ? 'JSON' : 'Text' }}</span
        ><span v-if="preview.truncated" class="muted"
          >Showing the first 1 MB</span
        >
        <div class="toolbar-spacer" />
        <button
          v-if="preview.json && !preview.truncated"
          :aria-pressed="pretty"
          @click="pretty = !pretty"
        >
          {{ pretty ? 'Formatted' : 'Raw' }}
        </button>
      </div>
      <pre
        class="text-preview"
        tabindex="0"
        aria-label="File Contents"
      ><code>{{ text }}</code></pre>
    </template>
  </div>
</template>
