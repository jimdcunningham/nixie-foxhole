<script setup lang="ts">
import NxActivityFeed from '#nixie/components/NxActivityFeed.vue';
import NxCallout from '#nixie/components/NxCallout.vue';
import NxEmptyState from '#nixie/components/NxEmptyState.vue';
import NxSkeleton from '#nixie/components/NxSkeleton.vue';
import { activateFoxholePlaybackEvent } from '#foxhole/composables/foxholeMapNavigation.ts';
import { describeFoxholePlaybackEvent } from '#foxhole/composables/foxholeWarPlaybackEventPresentation.ts';
import { useFoxholeWarLiveFeed } from '#foxhole/composables/useFoxholeWarLiveFeed.ts';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';

const runtime = useNixieRuntime();
const liveSkeletonRows = [0, 1, 2, 3, 4, 5];

const {
    mapSettings,
    eventsLoading,
    eventsError,
    activityGroups,
    eventsById,
} = useFoxholeWarLiveFeed();

const locatingEventId = ref('');
const locateError = ref('');

function onSelectActivityItem(eventId: string): void {
    if (locatingEventId.value === eventId) {
        return;
    }

    const event = eventsById.value.get(eventId);
    if (!event) {
        return;
    }

    locateError.value = '';
    void activateFoxholePlaybackEvent({
        runtime,
        mapSettings: mapSettings.value,
        event,
        eventLabel: describeFoxholePlaybackEvent(event),
        onLoadingEventIdChange: nextId => {
            locatingEventId.value = nextId;
        },
        onErrorMessageChange: message => {
            locateError.value = message;
        },
        reason: 'foxhole-war-nx-live:focus-event',
    }).catch(() => {});
}
</script>

<template>
    <div class="foxhole-war-nx-live-tab">
        <div
            v-if="eventsLoading"
            class="foxhole-war-nx-live-tab__skeleton"
            aria-busy="true"
            aria-label="Loading live war events"
        >
            <div
                v-for="row in liveSkeletonRows"
                :key="row"
                class="foxhole-war-nx-live-tab__skeleton-row"
            >
                <NxSkeleton width="20px" height="20px" shape="rect" />
                <div class="foxhole-war-nx-live-tab__skeleton-copy">
                    <NxSkeleton width="76%" height="12px" shape="pill" />
                    <NxSkeleton width="54%" height="10px" shape="pill" />
                </div>
            </div>
        </div>

        <NxCallout
            v-else-if="eventsError"
            title="Unable to Load Events"
            :message="eventsError"
            variant="danger"
        />

        <template v-else-if="activityGroups.length">
            <NxCallout
                v-if="locateError"
                title="Unable to Locate Event"
                :message="locateError"
                variant="warning"
            />

            <NxActivityFeed
                interactive
                :groups="activityGroups"
                @select="onSelectActivityItem"
            />
        </template>

        <NxEmptyState
            v-else
            icon="ph:radio"
            message="No live war events yet."
        />
    </div>
</template>

<style scoped>
.foxhole-war-nx-live-tab {
    display: flex;
    flex-direction: column;
    gap: var(--nx-space-2);
    min-height: 0;
}

.foxhole-war-nx-live-tab__skeleton {
    display: grid;
    gap: var(--nx-space-1);
    padding-bottom: var(--nx-space-3);
}

.foxhole-war-nx-live-tab__skeleton-row {
    display: flex;
    align-items: center;
    gap: var(--nx-space-2);
    min-width: 0;
    padding: var(--nx-space-2);
    border: 1px solid var(--nx-border);
    border-radius: var(--nx-radius-sm);
}

.foxhole-war-nx-live-tab__skeleton-copy {
    display: grid;
    flex: 1 1 auto;
    gap: 6px;
    min-width: 0;
}

/* Match the old war-history event card accents (brightened for dark icons). */
.foxhole-war-nx-live-tab :deep(.nx-activity-feed__item--success) {
    --nx-activity-feed-tone: #9bc07a;
}

.foxhole-war-nx-live-tab :deep(.nx-activity-feed__item--info),
.foxhole-war-nx-live-tab :deep(.nx-activity-feed__item--accent) {
    --nx-activity-feed-tone: #7e9fd0;
}

.foxhole-war-nx-live-tab :deep(.nx-activity-feed__item--warning) {
    --nx-activity-feed-tone: #d0926c;
}

.foxhole-war-nx-live-tab :deep(.nx-activity-feed__item--danger) {
    --nx-activity-feed-tone: #e07070;
}
</style>
