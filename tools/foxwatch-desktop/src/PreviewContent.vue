<script setup lang="ts">
import { computed, onMounted } from 'vue';
import type { AssetDetails, AssetPreview } from '../shared/contracts';
import ImagePreview from './ImagePreview.vue';
import ModelPreview from './ModelPreview.vue';
import Icon from './Icon.vue';
import { useViewPreferences } from './view-preferences';

const props = defineProps<{
  asset: AssetDetails;
  preview: AssetPreview;
  error?: string;
}>();
const emit = defineEmits<{ ready: [] }>();
const { formattedJson: pretty } = useViewPreferences();
const text = computed(() => {
  if (props.preview.type !== 'text') return '';
  if (pretty.value && props.preview.json && !props.preview.truncated) {
    try {
      return JSON.stringify(JSON.parse(props.preview.text), null, 2);
    } catch {
      /* Preserve invalid JSON for inspection. */
    }
  }
  return props.preview.text;
});
onMounted(() => {
  if (props.preview.type !== 'image' && props.preview.type !== 'model')
    emit('ready');
});
</script>

<template>
  <div class="preview-content">
    <div
      v-if="preview.type === 'unsupported'"
      class="preview-placeholder"
      :role="error ? 'alert' : undefined"
    >
      <Icon :name="asset.kind" :size="40" />
      <p>{{ error || preview.message }}</p>
    </div>
    <ImagePreview
      v-else-if="preview.type === 'image'"
      :bytes="preview.bytes"
      :mime="preview.mime"
      :label="asset.label"
      @ready="emit('ready')"
    />
    <ModelPreview
      v-else-if="preview.type === 'model'"
      :bytes="preview.bytes"
      @ready="emit('ready')"
    />
    <template v-else-if="preview.type === 'text'">
      <div class="preview-toolbar">
        <span>{{ preview.json ? 'JSON' : 'Text' }}</span>
        <span v-if="preview.truncated" class="muted"
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
