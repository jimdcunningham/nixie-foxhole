<script setup lang="ts">
import { computed, ref } from 'vue';
import FoxholePlannerLanding from '#foxhole/components/foxhole/FoxholePlannerLanding.vue';
import {
    buildNxSoftwareApplicationJsonLd,
    resolveNxSiteOrigin,
} from '#nixie/utils/nx-site-seo.ts';

defineRouteRules({
    ssr: true,
});

definePageMeta({
    title: 'Foxhole Planner',
    shellFooter: false,
});

const FOXHOLE_TITLE = 'Foxhole Planner';
const FOXHOLE_DESCRIPTION = 'Plan bunkers, facilities, and logistics in one workspace. Start a Foxhole plan in Nixie Studio, with no account required.';

const runtimeConfig = useRuntimeConfig();
const requestURL = useRequestURL();
const starting = ref(false);
const startError = ref('');

async function startPlanning(): Promise<void> {
    if (starting.value) {
        return;
    }

    starting.value = true;
    startError.value = '';
    try {
        const { createAndOpenFoxholePlannerProject } = await import('#foxhole/utils/foxhole-planner-project.ts');
        await createAndOpenFoxholePlannerProject();
    } catch (error) {
        startError.value = error instanceof Error
            ? error.message
            : 'Unable to start the project. Please try again.';
    } finally {
        starting.value = false;
    }
}

const jsonLd = computed(() => {
    const origin = resolveNxSiteOrigin({
        siteOrigin: runtimeConfig.public.siteOrigin,
        requestOrigin: requestURL.origin,
    });
    if (!origin) {
        return null;
    }

    return buildNxSoftwareApplicationJsonLd({
        origin,
        name: FOXHOLE_TITLE,
        description: FOXHOLE_DESCRIPTION,
        path: '/foxhole-planner',
        applicationCategory: 'DesignApplication',
        operatingSystem: 'Web, Windows, macOS',
    });
});

useSeoMeta({
    title: FOXHOLE_TITLE,
    description: FOXHOLE_DESCRIPTION,
    ogTitle: FOXHOLE_TITLE,
    ogDescription: FOXHOLE_DESCRIPTION,
});

useNxJsonLd(jsonLd, 'nx-foxhole-json-ld');
</script>

<template>
    <FoxholePlannerLanding
        :starting="starting"
        :startError="startError"
        @start="startPlanning"
    />
</template>
