<script setup lang="ts">
import { computed } from 'vue';
import type { NxAssistantChatBlockPresentation } from '#nixie/plugins/nixie/assistant/chat-blocks-context.ts';
import type { NxAssistantChatPlaceBlock } from '#nixie/components/nx-assistant-chat.model.ts';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { focusFoxholeMapSearchEntry } from '#foxhole/composables/foxholeMapNavigation.ts';
import { setFoxholeMapAssistantHighlights } from '#foxhole/plugins/foxhole/nixie/map/assistant-highlights.ts';
import {
    FOXHOLE_MAP_SETTING_KEYS,
    readFoxholeMapSettings,
} from '#foxhole/plugins/foxhole/nixie/map-settings.ts';
import type { FoxholeMapSearchEntry } from '#foxhole/plugins/foxhole/nixie/map/search.ts';

const props = withDefaults(defineProps<{
    block: NxAssistantChatPlaceBlock;
    presentation?: NxAssistantChatBlockPresentation;
}>(), {
    presentation: 'card',
});

const isLink = computed(() => props.presentation === 'link');
const runtime = useNixieRuntime();

const subtitle = computed(() => {
    switch (props.block.placeType) {
        case 'region':
            return 'Region';
        case 'town':
            return 'Town';
        case 'resource_field':
            return 'Resource Field';
        case 'resource_mine':
            return 'Resource Mine';
        default:
            return 'District';
    }
});

function toSearchEntry(): FoxholeMapSearchEntry {
    return {
        id: props.block.placeId,
        type: props.block.placeType,
        label: props.block.label,
        regionKey: props.block.regionKey,
        regionLabel: props.block.regionKey,
        searchLabel: props.block.label,
        worldPosition: {
            x: props.block.worldPosition.x,
            y: props.block.worldPosition.y,
        },
    };
}

function focusPlace(): void {
    const project = runtime.projectStore.project;
    if (!project) {
        return;
    }
    const mapSettings = readFoxholeMapSettings(project.settings.value);
    const entry = toSearchEntry();
    setFoxholeMapAssistantHighlights([
        {
            id: props.block.placeId,
            label: props.block.label,
            worldPosition: props.block.worldPosition,
        },
    ]);
    focusFoxholeMapSearchEntry({
        runtime,
        mapSettings,
        entry,
        shardId: String(project.settings.value?.[FOXHOLE_MAP_SETTING_KEYS.shardId] ?? '').trim(),
        ensureMapEnabled: true,
        clearPlaybackPreview: true,
        reason: 'foxhole-assistant:focus-place',
    });
}
</script>

<template>
    <button
        v-if="!isLink"
        type="button"
        class="foxhole-assistant-place-chip"
        :title="`Focus ${block.label} on the map`"
        @click="focusPlace"
    >
        <NxIcon
            name="ph:map-pin"
            size="sm"
            class="foxhole-assistant-place-chip__icon"
        />
        <span class="foxhole-assistant-place-chip__text">
            <span class="foxhole-assistant-place-chip__label">{{ block.label }}</span>
            <span class="foxhole-assistant-place-chip__meta">{{ subtitle }}</span>
        </span>
    </button>
    <span
        v-else
        class="foxhole-assistant-place-chip foxhole-assistant-place-chip--link nx-assistant-entity-link"
        role="button"
        tabindex="0"
        :title="`Focus ${block.label} on the map`"
        @click="focusPlace"
        @keydown.enter.prevent="focusPlace"
        @keydown.space.prevent="focusPlace"
    >{{ block.label }}</span>
</template>

<style scoped>
.foxhole-assistant-place-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    max-width: 100%;
    margin: 0;
    padding: 0.2rem 0.5rem 0.2rem 0.35rem;
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-sm);
    background: var(--nx-hover-surface);
    color: var(--nx-text);
    font: inherit;
    font-size: 0.92em;
    line-height: 1.2;
    cursor: pointer;
    text-align: left;
    vertical-align: baseline;
}

.foxhole-assistant-place-chip:hover,
.foxhole-assistant-place-chip:focus-visible {
    border-color: var(--nx-accent-muted);
    outline: none;
}

.foxhole-assistant-place-chip--link {
    display: inline;
    max-width: none;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--nx-accent-text);
    font-size: inherit;
    line-height: inherit;
    font-weight: inherit;
    text-decoration: none;
    white-space: inherit;
    cursor: pointer;
}

.foxhole-assistant-place-chip--link:hover,
.foxhole-assistant-place-chip--link:focus-visible {
    border: none;
    color: var(--nx-accent-hover);
    filter: none;
    outline: none;
}

.foxhole-assistant-place-chip__icon {
    flex: 0 0 auto;
    color: var(--nx-accent);
}

.foxhole-assistant-place-chip__text {
    display: inline-flex;
    flex-direction: column;
    min-width: 0;
    gap: 0.05rem;
}

.foxhole-assistant-place-chip--link .foxhole-assistant-place-chip__text {
    display: inline;
}

.foxhole-assistant-place-chip__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.foxhole-assistant-place-chip--link .foxhole-assistant-place-chip__label {
    overflow: visible;
    text-overflow: clip;
    white-space: inherit;
}

.foxhole-assistant-place-chip__meta {
    color: var(--nx-text-muted);
    font-size: 0.78em;
}
</style>
