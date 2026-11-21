<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { AssetComparison } from '../shared/contracts';
import type { ManifestDiff } from '../shared/asset-diff';
import type { ManifestSource } from '../shared/source-diff';
import ManifestSourceDiff from './ManifestSourceDiff.vue';
import { comparisonTask } from './comparison-task';
import { useViewPreferences } from './view-preferences';
const props = defineProps<{ pair: AssetComparison }>();
const emit = defineEmits<{ ready: [] }>();
const { manifestMode: preferredMode, manifestFilter: filter } = useViewPreferences();
const mode = computed(() => error.value ? 'source' : preferredMode.value);
const query = ref(''), visible = ref(200);
const diff = shallowRef<ManifestDiff | null>(null), error = ref('');
const source = shallowRef<ManifestSource | null>(null);
const sourceError = ref('');
const sourceLoading = ref(false);
const controller = new AbortController();
const before = props.pair.before?.preview, after = props.pair.after?.preview;
const text = (side: typeof before) => side?.type === 'text' ? side.text : null;
const completeJson = (side: typeof before) => side?.type === 'text' && side.json && !side.truncated;
const comparable = [before, after].every(side => !side || completeJson(side));
watch(mode, async value => {
  if (value !== 'source' || source.value || sourceLoading.value || sourceError.value) return;
  sourceLoading.value = true;
  try {
    source.value = await comparisonTask<ManifestSource>({
      kind: 'manifest-source', before: text(before), after: text(after),
      comparable,
    }, controller.signal);
  } catch (cause) {
    if (!controller.signal.aborted) sourceError.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    sourceLoading.value = false;
  }
}, { immediate: true });
const filtered = computed(() => (diff.value?.changes ?? []).filter(row =>
  (filter.value === 'all' || row.kind === filter.value) && (!query.value || (row.path + row.before + row.after).toLowerCase().includes(query.value.toLowerCase()))));
const counts = computed(() => {
  const changes = diff.value?.changes ?? [];
  return { added: changes.filter(row => row.kind === 'added').length, removed: changes.filter(row => row.kind === 'removed').length, changed: changes.filter(row => row.kind === 'changed').length };
});
onMounted(async () => {
  try {
    if (!comparable) throw new Error('Comparison needs complete JSON files up to 8 MB.');
    diff.value = await comparisonTask<ManifestDiff>({ kind: 'manifest', before: text(before), after: text(after), catalogReview: !!props.pair.labels }, controller.signal);
  } catch (cause) { if (!controller.signal.aborted) { error.value = cause instanceof Error ? cause.message : String(cause); } }
});
watch(() => mode.value === 'source' ? !!(source.value || sourceError.value) : !!diff.value, ready => {
  if (ready && !controller.signal.aborted) emit('ready');
});
onBeforeUnmount(() => controller.abort());
</script>
<template>
  <div class="comparison-content manifest-comparison">
    <div class="preview-toolbar comparison-toolbar">
      <button :disabled="!diff" :aria-pressed="mode === 'fields'" @click="preferredMode = 'fields'">Fields</button>
      <button :aria-pressed="mode === 'source'" @click="preferredMode = 'source'">Source</button>
      <span v-if="diff" class="muted">{{ counts.added }} Added · {{ counts.removed }} Removed · {{ counts.changed }} Changed</span>
      <div class="toolbar-spacer" />
      <input v-if="mode === 'fields'" v-model="query" type="search" placeholder="Search paths or values…" aria-label="Search Manifest Changes" @input="visible = 200">
      <select v-if="mode === 'fields'" v-model="filter" aria-label="Change Type" @change="visible = 200"><option value="all">All Changes</option><option value="added">Added</option><option value="removed">Removed</option><option value="changed">Changed</option></select>
    </div>
    <p v-if="error" class="comparison-note">{{ error }}</p>
    <p v-if="mode === 'fields' && diff?.limited" class="comparison-note">Comparison reached its field or depth limit. The list shows the changes found before that limit.</p>
    <div v-if="mode === 'fields'" class="manifest-changes">
      <p v-if="diff && !diff.changes.length" class="comparison-empty">No field changes. JSON formatting and object key order are ignored.</p>
      <p v-else-if="!filtered.length" class="comparison-empty">No changes match this search.</p>
      <table v-else class="manifest-table"><thead><tr><th>Path</th><th>A · {{ pair.labels?.before ?? 'Approved' }}</th><th>B · {{ pair.labels?.after ?? 'Working' }}</th></tr></thead><tbody>
        <tr v-for="(row,index) in filtered.slice(0,visible)" :key="index" :class="row.kind"><td><span class="field-kind">{{ row.kind }}</span><code>{{ row.path }}</code></td><td><pre>{{ row.before ?? 'Not present' }}</pre></td><td><pre>{{ row.after ?? 'Not present' }}</pre></td></tr>
      </tbody></table>
      <button v-if="filtered.length > visible" class="text-button" @click="visible += 200">Show More Changes ({{ filtered.length - visible }} Remaining)</button>
    </div>
    <template v-else>
      <p v-if="sourceLoading" class="comparison-note" role="status">Comparing source…</p>
      <p v-else-if="sourceError" class="comparison-note">{{ sourceError }}</p>
      <p v-else-if="source?.unavailable && !error" class="comparison-note">Source comparison needs complete, valid JSON.</p>
      <p v-if="source?.limited" class="comparison-note">Source reached its comparison limit. Review the changed values in Fields.</p>
      <p v-if="source && !source.unavailable && !source.parts.length && !source.limited" class="comparison-empty">No Source Changes</p>
      <ManifestSourceDiff v-if="source?.parts.length" :parts="source.parts"
        :before-label="pair.labels?.before ?? 'Approved'"
        :after-label="pair.labels?.after ?? 'Working'" />
    </template>
  </div>
</template>
