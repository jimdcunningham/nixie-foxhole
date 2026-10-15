<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps<{
    outputs: readonly string[];
    /** Optional hard clamp; when omitted the list fills its flex parent. */
    maxHeightPx?: number | null;
}>();

const clipEl = ref<HTMLElement | null>(null);
const listEl = ref<HTMLElement | null>(null);
const hiddenCount = ref(0);

let resizeObserver: ResizeObserver | null = null;
let frameId = 0;

function measureHiddenCount(): void {
    const clip = clipEl.value;
    const list = listEl.value;
    if (!clip || !list) {
        hiddenCount.value = 0;
        return;
    }

    // Measure against the clip box — the list may be taller than the available flex space.
    const bounds = clip.getBoundingClientRect();
    if (bounds.height < 1) {
        hiddenCount.value = 0;
        return;
    }

    /** A name counts as shown only if at least this much of its height is visible. */
    const minVisibleRatio = 0.85;
    let hidden = 0;
    for (const child of list.children) {
        if (!(child instanceof HTMLElement)) {
            continue;
        }
        const rect = child.getBoundingClientRect();
        const itemHeight = Math.max(1, rect.height);
        const visibleTop = Math.max(rect.top, bounds.top);
        const visibleBottom = Math.min(rect.bottom, bounds.bottom);
        const visibleHeight = Math.max(0, visibleBottom - visibleTop);
        const visibleRatio = visibleHeight / itemHeight;
        if (visibleRatio < minVisibleRatio) {
            hidden += 1;
        }
    }
    hiddenCount.value = hidden;
}

function scheduleMeasure(): void {
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(() => {
        measureHiddenCount();
    });
}

function connectObserver(): void {
    resizeObserver?.disconnect();
    resizeObserver = null;

    if (typeof ResizeObserver === 'undefined') {
        scheduleMeasure();
        return;
    }

    resizeObserver = new ResizeObserver(() => {
        scheduleMeasure();
    });
    if (clipEl.value) {
        resizeObserver.observe(clipEl.value);
    }
    if (listEl.value) {
        resizeObserver.observe(listEl.value);
    }
    scheduleMeasure();
}

onMounted(() => {
    connectObserver();
});

onBeforeUnmount(() => {
    cancelAnimationFrame(frameId);
    resizeObserver?.disconnect();
    resizeObserver = null;
});

watch(
    () => [props.outputs, props.maxHeightPx] as const,
    async () => {
        await nextTick();
        connectObserver();
    },
    { deep: true },
);
</script>

<template>
    <section class="foxhole-asset-hover-outputs">
        <div
            ref="clipEl"
            class="foxhole-asset-hover-outputs__clip"
            :class="{ 'has-overflow': hiddenCount > 0 }"
            :style="maxHeightPx ? { maxHeight: `${maxHeightPx}px` } : undefined"
        >
            <ul
                ref="listEl"
                class="foxhole-asset-hover-outputs__list"
                :title="outputs.join(', ')"
            >
                <li
                    v-for="outputName in outputs"
                    :key="outputName"
                    :title="outputName"
                >
                    {{ outputName }}
                </li>
            </ul>
        </div>
        <p
            v-if="hiddenCount > 0"
            class="foxhole-asset-hover-outputs__more"
        >
            +{{ hiddenCount }} more
        </p>
    </section>
</template>

<style scoped>
.foxhole-asset-hover-outputs {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    gap: var(--nx-space-1);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    padding-block: var(--nx-space-2);
    padding-inline: var(--nx-space-4);
    border-block: 1px solid var(--nx-border);
}

.foxhole-asset-hover-outputs__clip {
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.foxhole-asset-hover-outputs__clip.has-overflow::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 28px;
    pointer-events: none;
    background: linear-gradient(
        to bottom,
        color-mix(in srgb, var(--nx-panel-bg) 0%, transparent),
        var(--nx-panel-bg)
    );
}

.foxhole-asset-hover-outputs__list {
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    align-items: baseline;
    justify-content: space-between;
    row-gap: 8px;
    column-gap: 12px;
    margin: 0;
    padding: 0;
    list-style: none;
    color: var(--nx-success);
    font-size: var(--nx-text-sm);
    font-weight: 400;
    line-height: var(--nx-leading-normal);
}

.foxhole-asset-hover-outputs__list > li {
    min-width: 0;
    max-width: 100%;
}

.foxhole-asset-hover-outputs__more {
    flex: 0 0 auto;
    margin: 0;
    color: var(--nx-text-muted);
    font-size: var(--nx-text-xs);
    line-height: var(--nx-leading-normal);
}
</style>
