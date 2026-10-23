<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import type { AssetComparison } from '../shared/contracts';
import { comparisonTask } from './comparison-task';
const props = defineProps<{ pair: AssetComparison }>();
const emit = defineEmits<{ ready: [] }>();
type Side = { url: string; image: HTMLImageElement; width: number; height: number };
const sides = shallowRef<Array<Side|null>>([null,null]);
const mode = ref('side'), background = ref(localStorage.getItem('foxwatch.imageBackground') ?? 'checker');
const zoom = ref(1), x = ref(0), y = ref(0), mix = ref(50), fitMode = ref(true), error = ref('');
const host = ref<HTMLElement>(), difference = ref<HTMLCanvasElement>();
const diffImage = shallowRef<ImageData | null>(null), diffInfo = ref(''), diffBusy = ref(false);
const controller = new AbortController();
const urls: string[] = [];
let observer: ResizeObserver | undefined, drag: {x:number;y:number} | null = null;
const width = computed(() => Math.max(1,...sides.value.map(side => side?.width ?? 0)));
const height = computed(() => Math.max(1,...sides.value.map(side => side?.height ?? 0)));
const transform = computed(() => ({width: `${width.value * zoom.value}px`, height: `${height.value * zoom.value}px`, transform: `translate(-50%, -50%) translate(${x.value}px, ${y.value}px)`}));
const dimension = (index: number) => sides.value[index] ? `${sides.value[index]!.width} × ${sides.value[index]!.height}` : 'Missing';
const setZoom = (value: number) => { fitMode.value = false; zoom.value = Math.max(.01, Math.min(32,value)); };
function fit() {
  const viewport = host.value?.querySelector('.comparison-image-viewport') as HTMLElement | null;
  if (!viewport?.clientWidth || !viewport.clientHeight) return;
  zoom.value = Math.max(.01,Math.min(1,(viewport.clientWidth - 48)/width.value,(viewport.clientHeight - 48)/height.value));
  x.value = y.value = 0; fitMode.value = true;
}
function down(event: PointerEvent) { if (event.button === 0) { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); drag = {x:event.clientX,y:event.clientY}; } }
function move(event: PointerEvent) { if (drag) { x.value += event.clientX - drag.x; y.value += event.clientY - drag.y; drag = {x:event.clientX,y:event.clientY}; } }
function chooseBackground(value: string) { background.value = value; localStorage.setItem('foxwatch.imageBackground',value); }
function setDifference(element: unknown) { difference.value = element as HTMLCanvasElement | undefined; if (diffImage.value) drawDifference(); }
function drawDifference() {
  const canvas = difference.value, image = diffImage.value;
  if (!canvas || !image) return;
  canvas.width = image.width; canvas.height = image.height;
  canvas.getContext('2d')?.putImageData(image,0,0);
}
async function calculateDifference() {
  if (diffImage.value || diffBusy.value) { await nextTick(); drawDifference(); return; }
  diffBusy.value = true;
  try {
    // Large texture comparisons are sampled, avoiding unbounded bitmap allocations.
    const ratio = Math.min(1, Math.sqrt(4_000_000/(width.value*height.value)));
    const w = Math.max(1,Math.floor(width.value*ratio)), h = Math.max(1,Math.floor(height.value*ratio));
    const pixels = sides.value.map(side => {
      const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
      const context = canvas.getContext('2d', {willReadFrequently:true});
      if (!context) throw new Error('Image comparison is unavailable.');
      if (side) context.drawImage(side.image,0,0,side.width*ratio,side.height*ratio);
      const data = context.getImageData(0,0,w,h).data;
      canvas.width = canvas.height = 0;
      return data;
    });
    const result = await comparisonTask<{pixels:Uint8ClampedArray;changed:number;total:number}>({kind:'pixels', before:pixels[0], after:pixels[1]}, controller.signal, pixels.map(data => data.buffer));
    if (controller.signal.aborted) return;
    diffImage.value = new ImageData(new Uint8ClampedArray(result.pixels),w,h);
    diffInfo.value = `${result.changed.toLocaleString()} / ${result.total.toLocaleString()} pixels differ (${(100*result.changed/result.total).toFixed(2)}%)${ratio < 1 ? ` · Sampled at ${w} × ${h}` : ''}`;
    await nextTick(); drawDifference();
  } catch (cause) { if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { diffBusy.value = false; }
}
watch(mode, async value => { await nextTick(); if (fitMode.value) fit(); if (value === 'difference') await calculateDifference(); });
onMounted(async () => {
  try {
    sides.value = await Promise.all([props.pair.before,props.pair.after].map(async version => {
      if (!version) return null;
      if (version.preview.type !== 'image') throw new Error('Both versions must be decodable images.');
      const url = URL.createObjectURL(new Blob([new Uint8Array(version.preview.bytes)],{type:version.preview.mime})); urls.push(url);
      const image = new Image(); image.src = url; await image.decode();
      return {url,image,width:image.naturalWidth,height:image.naturalHeight};
    }));
    if (controller.signal.aborted) return;
    await nextTick(); fit();
    observer = new ResizeObserver(() => { if (fitMode.value) fit(); }); if (host.value) observer.observe(host.value);
  } catch (cause) { if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : String(cause); }
  finally { if (!controller.signal.aborted) emit('ready'); }
});
onBeforeUnmount(() => { controller.abort(); observer?.disconnect(); urls.forEach(url => URL.revokeObjectURL(url)); });
</script>
<template>
  <div ref="host" class="comparison-content image-comparison">
    <div class="preview-toolbar comparison-toolbar">
      <button v-for="[value,label] in [['side','Side by Side'],['swipe','Swipe'],['overlay','Overlay'],['difference','Difference']]" :key="value" :aria-pressed="mode === value" @click="mode = value!">{{ label }}</button>
      <div class="toolbar-spacer"/><button @click="fit">Fit</button><button @click="x = y = 0; setZoom(1)">1:1</button>
      <button aria-label="Zoom Out" @click="setZoom(zoom/1.25)">−</button><span>{{ Math.round(zoom*100) }}%</span><button aria-label="Zoom In" @click="setZoom(zoom*1.25)">+</button>
      <div class="background-controls" role="group" aria-label="Image Background"><button v-for="value in ['checker','dark','light']" :key="value" :class="['background-swatch',value]" :aria-label="`${value[0]!.toUpperCase()}${value.slice(1)} Background`" :aria-pressed="background === value" @click="chooseBackground(value)"/></div>
    </div>
    <div v-if="mode === 'swipe' || mode === 'overlay'" class="comparison-adjust"><label>{{ mode === 'swipe' ? 'Swipe Position' : 'Working Opacity' }}<input v-model.number="mix" type="range" min="0" max="100" :aria-label="mode === 'swipe' ? 'Swipe Position' : 'Working Opacity'"></label><span>{{ mix }}%</span></div>
    <p v-if="error" class="comparison-note" role="alert">{{ error }}</p>
    <p v-if="mode === 'difference'" class="comparison-note">{{ diffBusy ? 'Computing pixel differences…' : diffInfo }} · Pink marks changed pixels. Transparent RGB is ignored.</p>
    <div class="comparison-sides" :class="{'combined-image':mode !== 'side'}">
      <section v-for="index in mode === 'side' ? [0,1] : [0]" :key="index" :data-side="mode === 'side' ? (index ? 'working' : 'approved') : 'combined'">
        <header v-if="mode === 'side'">{{ index ? 'B · Working' : 'A · Approved' }}<span>{{ dimension(index) }}</span></header>
        <header v-else>A · Approved {{ dimension(0) }}<span>B · Working {{ dimension(1) }}</span></header>
        <div class="comparison-image-viewport" @wheel.prevent="setZoom(zoom*Math.exp(-$event.deltaY*.001))" @pointerdown="down" @pointermove="move" @pointerup="drag = null" @lostpointercapture="drag = null" @pointercancel="drag = null" @dblclick="fit">
          <p v-if="mode === 'side' && !sides[index]" class="comparison-empty">{{ index ? 'Deleted from working files' : 'Not in the approved baseline' }}</p>
          <div v-else class="comparison-image-space" :style="transform">
            <template v-if="mode === 'side'"><div class="comparison-image-frame" :class="background" :style="{width:`${sides[index]!.width*zoom}px`,height:`${sides[index]!.height*zoom}px`}"><img :src="sides[index]!.url" :alt="index ? 'Working image' : 'Approved image'" draggable="false"></div></template>
            <div v-else-if="mode === 'difference'" class="comparison-image-frame" :class="background" :style="{width:'100%',height:'100%'}"><canvas :ref="setDifference" style="width:100%;height:100%"/></div>
            <template v-else>
              <div v-for="(side,sideIndex) in sides" :key="sideIndex" class="comparison-image-layer" :style="{clipPath:sideIndex && mode === 'swipe' ? `inset(0 ${100-mix}% 0 0)` : undefined, opacity:sideIndex && mode === 'overlay' ? mix/100 : 1}">
                <div v-if="side" class="comparison-image-frame" :class="background" :style="{width:`${side.width*zoom}px`,height:`${side.height*zoom}px`}"><img :src="side.url" :alt="sideIndex ? 'Working image' : 'Approved image'" draggable="false"></div>
              </div>
              <div v-if="mode === 'swipe'" class="swipe-divider" :style="{left:`${mix}%`}"/>
            </template>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
