<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useViewPreferences } from './view-preferences';
const props = defineProps<{ bytes: Uint8Array; mime: string; label: string }>();
const emit = defineEmits<{ ready: [] }>();
const url = URL.createObjectURL(
  new Blob([new Uint8Array(props.bytes)], { type: props.mime }),
);
const viewport = ref<HTMLElement>();
const image = ref<HTMLImageElement>();
const { imageBackground: background } = useViewPreferences();
const width = ref(0),
  height = ref(0),
  zoom = ref(1),
  x = ref(0),
  y = ref(0),
  error = ref(false);
const fitMode = ref(true);
const percentage = computed(() => `${Math.round(zoom.value * 100)}%`);
let observer: ResizeObserver;
let drag: { x: number; y: number } | null = null;
function fit() {
  if (!viewport.value || !width.value || !height.value) return;
  zoom.value = Math.max(
    0.01,
    Math.min(
      1,
      (viewport.value.clientWidth - 48) / width.value,
      (viewport.value.clientHeight - 48) / height.value,
    ),
  );
  x.value = y.value = 0;
  fitMode.value = true;
}
function loaded() {
  if (!image.value) return;
  width.value = image.value.naturalWidth;
  height.value = image.value.naturalHeight;
  fit();
  emit('ready');
}
function setZoom(value: number) {
  fitMode.value = false;
  zoom.value = Math.max(0.01, Math.min(32, value));
}
function chooseBackground(value: string) {
  background.value = value;
}
function down(event: PointerEvent) {
  if (event.button !== 0) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  drag = { x: event.clientX, y: event.clientY };
}
function move(event: PointerEvent) {
  if (!drag) return;
  x.value += event.clientX - drag.x;
  y.value += event.clientY - drag.y;
  drag = { x: event.clientX, y: event.clientY };
}
onMounted(() => {
  observer = new ResizeObserver(() => {
    if (fitMode.value) fit();
  });
  if (viewport.value) observer.observe(viewport.value);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  URL.revokeObjectURL(url);
});
</script>
<template>
  <div class="image-preview">
    <div class="preview-toolbar">
      <button @click="fit">Fit</button
      ><button
        @click="
          x = y = 0;
          setZoom(1);
        "
      >
        1:1</button
      ><button aria-label="Zoom Out" @click="setZoom(zoom / 1.25)">−</button
      ><span class="zoom-value">{{ percentage }}</span
      ><button aria-label="Zoom In" @click="setZoom(zoom * 1.25)">+</button
      ><span v-if="width" class="muted image-dimensions"
        >{{ width }} × {{ height }}</span
      >
      <div class="toolbar-spacer" />
      <div
        class="background-controls"
        role="group"
        aria-label="Image Background"
      >
        <button
          v-for="value in ['checker', 'dark', 'light']"
          :key="value"
          :aria-label="`${value.charAt(0).toUpperCase()}${value.slice(1)} Background`"
          :aria-pressed="background === value"
          :class="['background-swatch', value]"
          @click="chooseBackground(value)"
        />
      </div>
    </div>
    <div
      ref="viewport"
      class="image-viewport"
      @wheel.prevent="setZoom(zoom * Math.exp(-$event.deltaY * 0.001))"
      @pointerdown="down"
      @pointermove="move"
      @pointerup="drag = null"
      @lostpointercapture="drag = null"
      @pointercancel="drag = null"
      @dblclick="fit"
    >
      <p v-if="error" role="alert">This image could not be decoded.</p>
      <div
        v-else
        class="image-frame"
        :class="background"
        :style="{
          width: `${width * zoom}px`,
          height: `${height * zoom}px`,
          transform: `translate(-50%, -50%) translate(${x}px, ${y}px)`,
        }"
      >
        <img
          ref="image"
          :src="url"
          :alt="label"
          draggable="false"
          @load="loaded"
          @error="
            error = true;
            emit('ready');
          "
        />
      </div>
    </div>
  </div>
</template>
