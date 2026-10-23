<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import type { AssetComparison } from '../shared/contracts';
import { unionBounds, type PreviewCamera } from '../shared/asset-diff';
import type { createModelPreview } from './model-viewer';
const props = defineProps<{ pair: AssetComparison }>();
const emit = defineEmits<{ ready: [] }>();
type Viewer = NonNullable<Awaited<ReturnType<typeof createModelPreview>>>;
const hosts: Array<HTMLElement|null> = [null,null], viewers: Array<Viewer|null> = [null,null];
const mode = ref('both'), ready = ref(false), messages = ref(['','']), stats = ref(['','']);
const bounds = shallowRef<ReturnType<typeof unionBounds> | null>(null);
let disposed = false;
function host(element: unknown, index: number) { hosts[index] = element as HTMLElement | null; }
function sync(camera: PreviewCamera, source: number) { if (ready.value) viewers.forEach((viewer,index) => { if (source !== index) viewer?.setCamera(camera); }); }
function reset() {
  const aspects = hosts.filter((element): element is HTMLElement => !!element?.clientWidth && !!element.clientHeight).map(element => element.clientWidth/element.clientHeight);
  const aspect = Math.max(.1, Math.min(...aspects, 1));
  if (bounds.value) viewers.forEach(viewer => viewer?.setFrame(bounds.value!,aspect));
}
function summary(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const doc = JSON.parse(new TextDecoder().decode(bytes.subarray(20,20+view.getUint32(12,true))));
  let vertices = 0, triangles = 0;
  for (const mesh of doc.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    const count = doc.accessors?.[primitive.attributes?.POSITION]?.count ?? 0; vertices += count;
    if ((primitive.mode ?? 4) === 4) triangles += Math.floor((doc.accessors?.[primitive.indices]?.count ?? count)/3);
  }
  return `${vertices.toLocaleString()} vertices · ${triangles.toLocaleString()} triangles · ${(doc.materials?.length ?? 0)} materials · ${(doc.textures?.length ?? 0)} textures`;
}
onMounted(async () => {
  try {
    const { createModelPreview } = await import('./model-viewer');
    if (disposed) return;
    await Promise.all([props.pair.before,props.pair.after].map(async (side,index) => {
      if (!side) { messages.value[index] = index ? 'Deleted from working files' : 'Not in the approved baseline'; return; }
      if (side.preview.type !== 'model') { messages.value[index] = side.preview.type === 'unsupported' ? side.preview.message : 'This version is not a GLB model.'; return; }
      try {
        const viewer = await createModelPreview(hosts[index]!, side.preview.bytes, () => disposed, camera => sync(camera,index));
        if (!viewer) return;
        if (disposed) { viewer.destroy(); return; }
        viewers[index] = viewer; stats.value[index] = summary(side.preview.bytes);
      } catch (cause) { messages.value[index] = cause instanceof Error ? cause.message : String(cause); }
    }));
    if (disposed) return;
    const available = viewers.filter((viewer): viewer is Viewer => !!viewer);
    if (available.length) { bounds.value = unionBounds(available.map(viewer => viewer.bounds)); reset(); }
    ready.value = true; await nextTick(); emit('ready');
  } catch (cause) { if (!disposed) { messages.value = [String(cause),String(cause)]; emit('ready'); } }
});
onBeforeUnmount(() => { disposed = true; viewers.forEach(viewer => viewer?.destroy()); });
</script>
<template>
  <div class="comparison-content model-comparison">
    <div class="preview-toolbar comparison-toolbar"><button :aria-pressed="mode === 'both'" @click="mode = 'both'">Side by Side</button><button :aria-pressed="mode === 'before'" @click="mode = 'before'">A · Approved</button><button :aria-pressed="mode === 'after'" @click="mode = 'after'">B · Working</button><div class="toolbar-spacer"/><span class="muted">Linked Cameras · Shared Scale</span><button :disabled="!ready" @click="reset">Reset Views</button></div>
    <div class="comparison-sides">
      <section v-for="(side,index) in [pair.before,pair.after]" v-show="mode === 'both' || mode === (index ? 'after' : 'before')" :key="index" :data-side="index ? 'working' : 'approved'">
        <header>{{ index ? 'B · Working' : 'A · Approved' }}<span>{{ side ? (side.asset.bytes/1024).toFixed(1) + ' KB' : 'Missing' }}</span></header>
        <div :ref="element => host(element,index)" class="model-viewport" :aria-label="index ? 'Working Model' : 'Approved Model'"><div v-if="messages[index]" class="model-message">{{ messages[index] }}</div></div>
        <div class="comparison-model-stats">{{ stats[index] }}</div>
      </section>
    </div>
    <p class="comparison-note">Drag either model to orbit both · Right-drag to pan · Scroll to zoom. Original coordinates and dimensions are preserved.</p>
  </div>
</template>
