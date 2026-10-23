<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type {
  AssetComparison,
  AssetDetails,
  AssetPreview,
} from '../shared/contracts';
import PreviewContent from './PreviewContent.vue';
import ComparisonContent from './ComparisonContent.vue';

const props = defineProps<{
  rootId: string;
  asset: AssetDetails;
  requestedPath: string;
  inspecting: boolean;
  compare: boolean;
  approvedAt: string | null;
}>();
interface PreviewEntry {
  id: number;
  asset: AssetDetails;
  preview: AssetPreview;
  comparison?: AssetComparison;
  error?: string;
}
const displayed = shallowRef<PreviewEntry | null>(null);
const candidate = shallowRef<PreviewEntry | null>(null);
const layers = computed(() =>
  [displayed.value, candidate.value].filter(
    (entry): entry is PreviewEntry => !!entry,
  ),
);
const loading = ref(false);
const showLoading = ref(false);
let version = 0;
let hintTimer: ReturnType<typeof setTimeout> | undefined;

function finish(id: number) {
  if (id !== version || candidate.value?.id !== id) return;
  // The candidate is already decoded and rendered. Keep its keyed DOM instance
  // while removing the outgoing preview, so there is no empty/loading frame.
  displayed.value = candidate.value;
  candidate.value = null;
  loading.value = false;
  showLoading.value = false;
  clearTimeout(hintTimer);
}

watch(
  () => [
    props.rootId,
    props.asset.path,
    props.asset.modifiedAt,
    props.requestedPath,
    props.inspecting,
    props.compare,
    props.approvedAt,
  ],
  async () => {
    const token = ++version;
    candidate.value = null;
    clearTimeout(hintTimer);
    showLoading.value = false;
    loading.value =
      props.inspecting || props.asset.path === props.requestedPath;
    if (loading.value)
      hintTimer = setTimeout(() => {
        showLoading.value = true;
      }, 250);
    // A new keyboard selection invalidates staged work immediately, even while
    // its metadata is still being read by the main process.
    if (props.inspecting || props.asset.path !== props.requestedPath) return;
    const asset = props.asset;
    try {
      if (props.compare) {
        const comparison = await window.foxwatch.comparison(
          props.rootId,
          asset.path,
        );
        if (token === version)
          candidate.value = {
            id: token,
            asset,
            comparison,
            preview: { type: 'unsupported', message: '' },
          };
        return;
      }
      const preview = await window.foxwatch.preview(props.rootId, asset.path);
      if (token === version) candidate.value = { id: token, asset, preview };
    } catch (cause) {
      if (token !== version) return;
      const error = String(
        cause instanceof Error ? cause.message : cause,
      ).replace(/^Error invoking remote method '[^']+': Error: /, '');
      candidate.value = {
        id: token,
        asset,
        preview: { type: 'unsupported', message: error },
        error,
      };
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  version++;
  clearTimeout(hintTimer);
});
</script>

<template>
  <div
    class="asset-preview"
    :aria-busy="loading"
    :data-preview-path="displayed?.asset.path"
  >
    <div class="preview-stage">
      <div
        v-for="layer in layers"
        :key="layer.id"
        class="preview-layer"
        :class="{ 'is-pending': layer.id !== displayed?.id }"
        :inert="layer.id !== displayed?.id"
        :aria-hidden="layer.id !== displayed?.id"
      >
        <ComparisonContent
          v-if="layer.comparison"
          :pair="layer.comparison"
          @ready="finish(layer.id)"
        />
        <PreviewContent
          v-else
          :asset="layer.asset"
          :preview="layer.preview"
          :error="layer.error"
          @ready="finish(layer.id)"
        />
      </div>
    </div>
    <span v-if="showLoading" class="preview-loading" role="status"
      >Loading preview…</span
    >
  </div>
</template>
