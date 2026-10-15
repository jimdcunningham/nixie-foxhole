<script setup lang="ts">
import { computed } from 'vue';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import type { NixieProjectChatCustomSegment } from '#nixie/utils/nixie-project-chat.ts';
import {
    getFoxholeChatMapGridCameraTarget,
    isFoxholeChatMapGridSegment,

} from '#foxhole/plugins/foxhole/nixie/chat/map-grid.ts';
import type { FoxholeChatMapGridReference } from '#foxhole/plugins/foxhole/nixie/chat/map-grid.ts';

const props = defineProps<{
    segment: NixieProjectChatCustomSegment;
}>();

const runtime = useNixieRuntime();

const reference = computed<FoxholeChatMapGridReference | null>(() => {
    if (!isFoxholeChatMapGridSegment(props.segment)) {
        return null;
    }

    return props.segment.data.reference;
});

function focusReference(): void {
    if (!reference.value) {
        return;
    }

    const viewport = runtime.session.viewportRef.value;
    if (!viewport) {
        runtime.session.cameraTo({
            time: 260,
            position: reference.value.worldPosition,
        });
        return;
    }

    const target = getFoxholeChatMapGridCameraTarget(reference.value, viewport);
    runtime.session.cameraTo({
        time: 260,
        position: target.position,
        scale: target.scale,
    });
}
</script>

<template>
    <button
        type="button"
        class="foxhole-chat-map-reference-segment"
        :disabled="!reference"
        @click="focusReference"
    >
        <Icon name="ph:hexagon" />
        <span>{{ reference?.label || segment.text }}</span>
    </button>
</template>

<style scoped>
.foxhole-chat-map-reference-segment {
    display: inline-flex;
    align-items: center;
    gap: 0.32rem;
    max-width: 100%;
    padding: 0.26rem 0.58rem;
    border: 0;
    border-radius: 999px;
    background: rgb(255 255 255 / 0.08);
    color: inherit;
    font: inherit;
    font-size: 0.92em;
    line-height: 1.18;
    vertical-align: middle;
    transition: background-color 140ms ease, transform 140ms ease;
}

.foxhole-chat-map-reference-segment:hover:not(:disabled) {
    background: rgb(255 255 255 / 0.14);
    transform: translateY(-1px);
}

.foxhole-chat-map-reference-segment:disabled {
    opacity: 0.7;
    cursor: default;
}

.foxhole-chat-map-reference-segment > span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
