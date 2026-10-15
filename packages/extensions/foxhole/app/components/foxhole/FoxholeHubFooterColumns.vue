<script setup lang="ts">
import { useNxAppTitle } from '#nixie/composables/useNxAppTitle.ts';

defineProps<{
    latestUpdateLinks?: Array<{
        title: string;
        to: string;
        version: string;
        date: string;
        dateTime: string;
    }>;
}>();

const appTitle = useNxAppTitle();
const runtimeConfig = useRuntimeConfig();

const resourceLinks = computed(() => [
    {
        label: 'What’s New',
        to: '/updates',
    },
    {
        label: 'Community',
        to: '/community',
    },
    ...(!runtimeConfig.public.desktop
        ? [{
            label: 'Download',
            to: '/download',
        }]
        : []),
    {
        label: 'Status',
        href: 'https://status.nixiejs.com',
    },
] as const);
</script>

<template>
    <div class="nx-hub-footer__columns">
        <section class="nx-hub-footer__block nx-hub-footer__block--hero">
            <p class="nx-hub-footer__kicker">About</p>
            <div class="nx-hub-footer__copy-stack">
                <p class="nx-hub-footer__copy">
                    {{ appTitle }} is a collaborative workspace for planning, documenting, and building together.
                </p>
                <p class="nx-hub-footer__copy nx-hub-footer__copy--disclaimer">
                    Foxhole and related names, marks, and assets remain the intellectual property of Siege Camp.
                </p>
            </div>
        </section>

        <section v-if="latestUpdateLinks?.length" class="nx-hub-footer__block nx-hub-footer__latest" aria-label="Latest">
            <p class="nx-hub-footer__kicker">Latest</p>
            <ul class="nx-hub-footer__link-list" role="list">
                <li v-for="link in latestUpdateLinks" :key="link.to">
                    <NuxtLink class="nx-hub-footer__link" :to="link.to">
                        <span>{{ link.title }}</span>
                        <span class="nx-hub-footer__update-meta">
                            v{{ link.version }}
                            <time v-if="link.date" :datetime="link.dateTime"> · {{ link.date }}</time>
                        </span>
                    </NuxtLink>
                </li>
            </ul>
        </section>

        <section class="nx-hub-footer__block" aria-label="Resources">
            <p class="nx-hub-footer__kicker">Resources</p>
            <ul class="nx-hub-footer__link-list" role="list">
                <li
                    v-for="link in resourceLinks"
                    :key="'to' in link ? link.to : link.href"
                >
                    <NuxtLink
                        v-if="'to' in link"
                        class="nx-hub-footer__link"
                        :to="link.to"
                    >{{ link.label }}</NuxtLink>
                    <a
                        v-else
                        class="nx-hub-footer__link"
                        :href="link.href"
                        target="_blank"
                        rel="noreferrer"
                    >{{ link.label }}</a>
                </li>
            </ul>
        </section>
    </div>
</template>
