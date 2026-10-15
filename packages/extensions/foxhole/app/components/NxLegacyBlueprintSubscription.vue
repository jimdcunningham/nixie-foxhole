<script setup lang="ts">
import { legacyBlueprintFlag } from '#nixie/utils/legacy-blueprints.ts';

const props = defineProps<{ listingId: string; }>();
const enabled = legacyBlueprintFlag(useRuntimeConfig().public.legacyBlueprintLibraryEnabled);
const subscribed = ref<boolean | null>(null);
const busy = ref(false);
const checking = ref(false);
const message = ref('');
let revision = 0;

function endpoint(): string {
    return `/api/nixie/legacy-blueprints/${encodeURIComponent(props.listingId)}/subscription`;
}
function explain(error: unknown): string {
    const response = error as { statusCode?: number; data?: { statusMessage?: string; }; };
    return response.statusCode === 401
        ? 'Sign in to manage your Blueprint subscriptions.'
        : response.data?.statusMessage || 'Blueprint subscriptions could not be checked. Try again.';
}
async function refresh(): Promise<void> {
    if (!enabled || busy.value || checking.value) {
        return;
    }
    const current = ++revision;
    checking.value = true;
    subscribed.value = null;
    message.value = '';
    try {
        const result = await $fetch<{ subscribed: boolean; }>(endpoint());
        if (current === revision) {
            subscribed.value = result.subscribed;
        }
    } catch (error) {
        if (current === revision) {
            message.value = explain(error);
        }
    } finally {
        if (current === revision) {
            checking.value = false;
        }
    }
}
async function toggle(): Promise<void> {
    if (busy.value || subscribed.value === null) {
        return;
    }
    busy.value = true;
    message.value = '';
    const current = ++revision;
    try {
        const result = await $fetch<{ subscribed: boolean; }>(endpoint(), { method: 'PUT', body: { subscribed: !subscribed.value } });
        if (current === revision) {
            subscribed.value = result.subscribed;
        }
    } catch (error) {
        if (current === revision) {
            subscribed.value = null;
            message.value = explain(error);
        }
    } finally {
        if (current === revision) {
            busy.value = false;
        }
    }
}
watch(() => props.listingId, () => {
    busy.value = false;
    checking.value = false;
    void refresh();
});
onMounted(() => {
    void refresh();
});
onUnmounted(() => {
    revision++;
});
</script>

<template>
    <section
        v-if="enabled"
        class="nx-discovery-detail__subscription"
        aria-label="Blueprint Subscription"
        aria-live="polite"
        :aria-busy="busy || checking"
    >
        <NxButton v-if="subscribed !== null" :disabled="busy" @click="toggle">
            <NxIcon :name="subscribed ? 'ph:bookmark-simple-fill' : 'ph:bookmark-simple'" />
            {{ busy ? 'Updating Subscription…' : subscribed ? 'Unsubscribe From Blueprint' : 'Subscribe to Blueprint' }}
        </NxButton>
        <p v-if="checking" class="nx-discovery-detail__hint">Checking subscription…</p>
        <p v-if="message" class="nx-discovery-detail__error">{{ message }}</p>
        <NxButton
            v-if="message"
            size="sm"
            :disabled="checking"
            @click="refresh"
        >Refresh Subscription</NxButton>
        <p class="nx-discovery-detail__hint">Follow the latest public version in your library. This subscription is shared with Foxhole Planner for the same account; copies and inserted designs stay pinned.</p>
        <p class="nx-discovery-detail__hint">Subscribing is separate from joining a collaborative project.</p>
        <NuxtLink class="nx-discovery-detail__link" to="/discover/library">My Discovery Library<NxIcon name="ph:arrow-right" /></NuxtLink>
    </section>
</template>

<style scoped>
.nx-discovery-detail__subscription { display: grid; gap: var(--nx-space-3); }
</style>
