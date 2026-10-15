<script setup lang="ts">
import { recordDiscoveryExposure } from '#nixie/utils/discovery-tracking.ts';
import type { LegacyBlueprintListing } from '#nixie/utils/legacy-blueprints.ts';
import { legacyBlueprintFlag } from '#nixie/utils/legacy-blueprints.ts';
import { reuseLegacyBlueprint } from '#nixie/plugins/nixie/legacy-blueprint-import.ts';

const props = defineProps<{ listingId: string; }>();
const { data, error, status, refresh } = useFetch<{ blueprint: LegacyBlueprintListing; }>(() => `/api/nixie/legacy-blueprints/${encodeURIComponent(props.listingId)}`);
const blueprint = computed(() => data.value?.blueprint);
const copyEnabled = legacyBlueprintFlag(useRuntimeConfig().public.legacyBlueprintCopyEnabled);
const busy = ref(false);
const actionError = ref('');
const metadata = computed(() => {
    const rows = [{ label: 'Source', value: 'Foxhole Planner' }, { label: 'Requires', value: 'Foxhole Planner Extension' }];
    const date = blueprint.value?.updatedAt;
    return date && !Number.isNaN(Date.parse(date))
        ? [...rows, { label: 'Updated', value: new Date(date).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }), datetime: date }]
        : rows;
});
async function copy(): Promise<void> {
    if (!blueprint.value || busy.value || !copyEnabled) {
        return;
    }
    busy.value = true;
    actionError.value = '';
    try {
        await reuseLegacyBlueprint(blueprint.value);
    } catch (copyError) {
        actionError.value = copyError instanceof Error ? copyError.message : 'Blueprint could not be copied.';
    } finally {
        busy.value = false;
    }
}
useSeoMeta({
    title: () => blueprint.value ? `${blueprint.value.title} · Nixie Discover` : 'Blueprint · Nixie Discover',
    description: () => blueprint.value?.description || 'A public Foxhole Planner Blueprint.',
});
const analytics = useNixieAnalyticsConsent();
onMounted(() => {
    watch([blueprint, analytics.enabled], ([value, enabled]) => {
        if (value && enabled) {
            recordDiscoveryExposure('legacy-foxhole-blueprint', value.id, 'view');
        }
    }, { immediate: true });
});
</script>

<template>
    <NxDiscoveryDetailStatus
        v-if="status === 'pending' || error || !blueprint"
        :loading="status === 'pending'"
        title="Blueprint Unavailable"
        message="This public Blueprint could not be loaded. It may be unavailable or have been removed."
        @retry="refresh()"
    />
    <NxDiscoveryDetailLayout
        v-else
        :title="blueprint.title"
        source="Legacy Blueprint"
        icon="ph:blueprint"
        :version="blueprint.version.label"
        :creator="blueprint.credits"
        creatorLabel="Credits:"
        :description="blueprint.description"
        aboutTitle="About This Blueprint"
        :previewUrl="blueprint.thumbnailUrl"
        :tags="blueprint.tags"
        :metadata="metadata"
    >
        <template #actions>
            <NxButton
                v-if="copyEnabled"
                variant="primary"
                :disabled="busy"
                :aria-busy="busy"
                @click="copy"
            >
                <NxIcon :name="busy ? 'ph:hourglass' : 'ph:copy'" />
                {{ busy ? 'Opening Copy…' : 'Open a Copy' }}
            </NxButton>
            <p v-if="copyEnabled" class="nx-discovery-detail__hint">Creates an independent project with source credits, saved locally or in a cloud workspace. Later Blueprint edits won’t change your copy.</p>
            <p v-if="actionError" class="nx-discovery-detail__error" role="alert">{{ actionError }}</p>
            <a
                class="nx-discovery-detail__link"
                :href="blueprint.sourceUrl"
                target="_blank"
                rel="noopener noreferrer"
            >
                View in Foxhole Planner<NxIcon name="ph:arrow-up-right" />
            </a>
            <NxLegacyBlueprintSubscription :listingId="listingId" />
        </template>
        <section class="nx-discovery-detail__section">
            <h2>Use and Compatibility</h2>
            <p class="nx-discovery-detail__prose">This published design requires the Foxhole Planner extension. Original authors retain their ownership. Legacy publication does not assign a new Nixie license.</p>
        </section>
    </NxDiscoveryDetailLayout>
</template>
