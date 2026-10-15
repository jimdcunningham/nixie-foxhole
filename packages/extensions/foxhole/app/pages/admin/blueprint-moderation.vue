<script setup lang="ts">
import { checkboxMenuItem, separatorMenuItem, submenuMenuItem } from '#nixie/utils/nx-resolved-menu-builders.ts';
definePageMeta({ title: 'Blueprint Moderation', middleware: ['admin-only'] });
useSeoMeta({ title: 'Blueprint Moderation', robots: 'noindex, nofollow' });
type Job = { blueprint_id: string; fingerprint: string; state: string; reason: string; published_at: string; blueprints: { name: string; privacy: string; }; };
type Review = { title: string; fingerprint: string; archiveSha256: string; reason: string; text: string[]; warnings: string[]; blank: boolean; images: { name: string; dataUrl: string; }[]; imageCount: number; offset: number; };
const category = ref('needs_review');
const rejectionType = ref('all');
const options = [
    { value: 'needs_review', label: 'Needs Review' },
    { value: 'retry', label: 'Retrying' },
    { value: 'rejected', label: 'Rejected' },
    { value: 'approved', label: 'Approved' },
];
const rejectionOptions = [
    { value: 'all', label: 'All' },
    { value: 'automatic', label: 'Automatic' },
    { value: 'manual', label: 'Manual' },
];
const filterLabel = computed(() => {
    const label = options.find(option => option.value === category.value)?.label;
    return category.value === 'rejected' && rejectionType.value !== 'all'
        ? `${label}, ${rejectionOptions.find(option => option.value === rejectionType.value)?.label}`
        : label;
});
const filterMenu = computed(() => [
    ...options.map(option => checkboxMenuItem(option.label, category.value === option.value, () => {
        category.value = option.value;
        rejectionType.value = 'all';
    }, { closeOnClick: false })),
    ...(category.value === 'rejected' ? [
        separatorMenuItem(),
        submenuMenuItem('Rejection Type', rejectionOptions.flatMap(option => {
            const item = checkboxMenuItem(option.label, rejectionType.value === option.value, () => {
                rejectionType.value = option.value;
            }, { closeOnClick: true });
            return option.value === 'all' ? [item, separatorMenuItem()] : [item];
        })),
    ] : []),
]);
const items = ref<Job[]>([]);
const selected = ref<Job | null>(null);
const review = ref<Review | null>(null);
const busy = ref(false);
const loading = ref(false);
const error = ref('');
const previewError = ref('');
let revision = 0;
const message = (failure: unknown) => (failure as { data?: { statusMessage?: string; }; }).data?.statusMessage || 'Moderation could not be loaded.';
const plannerUrl = (id: string) => `https://foxholeplanner.com/app?hub=blueprints&page=view/${encodeURIComponent(id)}`;
async function load() {
    const current = ++revision;
    loading.value = true;
    error.value = '';
    try {
        const result = await $fetch<{ items: Job[]; }>('/api/nixie/admin/blueprint-moderation', { query: { state: category.value, outcome: category.value === 'rejected' ? rejectionType.value : 'all' } });
        if (current !== revision) {
            return;
        }
        items.value = result.items;
    } catch (failure) {
        if (current === revision) {
            error.value = message(failure);
        }
    } finally {
        if (current === revision) {
            loading.value = false;
        }
    }
}
async function open(job: Job, offset = 0) {
    if (busy.value) {
        return;
    }
    selected.value = job;
    review.value = null;
    previewError.value = '';
    busy.value = true;
    try {
        review.value = await $fetch<Review>(`/api/nixie/admin/blueprint-moderation/${job.blueprint_id}`, { query: { offset } });
    } catch (failure) {
        previewError.value = message(failure);
    } finally {
        busy.value = false;
    }
}
async function decide(decision: 'approved' | 'rejected') {
    if (!selected.value || busy.value) {
        return;
    }
    busy.value = true;
    error.value = '';
    try {
        await $fetch(`/api/nixie/admin/blueprint-moderation/${selected.value.blueprint_id}`, { method: 'PUT', body: {
            state: decision, fingerprint: review.value?.fingerprint || selected.value.fingerprint, archiveSha256: review.value?.archiveSha256,
        } });
        selected.value = null;
        review.value = null;
        await load();
    } catch (failure) {
        error.value = message(failure);
    } finally {
        busy.value = false;
    }
}
watch([category, rejectionType], () => {
    selected.value = null;
    review.value = null;
    previewError.value = '';
    void load();
});
onMounted(() => {
    void load();
});
onBeforeUnmount(() => {
    revision++;
});
</script>

<template>
    <div class="nx-blueprint-moderation">
        <aside class="nx-blueprint-moderation__sidebar" aria-label="Blueprint Queue">
            <header class="nx-blueprint-moderation__header nx-contextual-header">
                <NxMenuButton class="nx-blueprint-moderation__filter" :items="filterMenu" :disabled="busy">
                    <template #trigger="{ toggle, open: menuOpen, triggerId }">
                        <button type="button" class="nx-control nx-select__trigger nx-select__trigger--compact" :class="{ 'is-open': menuOpen }" aria-label="Moderation Category" aria-haspopup="menu" :aria-expanded="menuOpen" :data-nx-menu-trigger="triggerId" :disabled="busy" :title="filterLabel" @click="toggle">
                            <span class="nx-select__value"><span class="nx-select__value-label">{{ filterLabel }}</span></span>
                            <NxIcon name="ph:caret-down" size="sm" class="nx-select__icon" />
                        </button>
                    </template>
                </NxMenuButton>
                <NxIconButton icon="ph:arrows-clockwise" label="Refresh Queue" size="sm" variant="bare" :disabled="busy || loading" @click="load()" />
            </header>
            <div class="nx-blueprint-moderation__queue" :aria-busy="loading">
                <p v-if="loading" class="nx-blueprint-moderation__hint" role="status">Loading blueprints…</p>
                <p v-else-if="!items.length" class="nx-blueprint-moderation__hint">No uploads in this queue.</p>
                <ul aria-label="Blueprints">
                    <li v-for="item in items" :key="item.blueprint_id">
                        <button type="button" class="nx-blueprint-moderation__item nx-settings-nav__item nx-sidebar-nav-item" :class="{ 'is-active': selected?.blueprint_id === item.blueprint_id }" :aria-pressed="selected?.blueprint_id === item.blueprint_id" :disabled="busy || loading" @click="open(item)">
                            <span class="nx-blueprint-moderation__item-copy">
                                <strong>{{ item.blueprints?.name }}</strong>
                                <span :title="item.reason">{{ item.reason }}</span>
                                <small>{{ new Date(item.published_at).toLocaleDateString() }} · {{ item.blueprints?.privacy }}</small>
                            </span>
                        </button>
                    </li>
                </ul>
            </div>
        </aside>
        <section class="nx-blueprint-moderation__detail" aria-label="Blueprint Review">
            <header class="nx-blueprint-moderation__header nx-blueprint-moderation__detail-header nx-contextual-header">
                <div class="nx-blueprint-moderation__heading">
                    <strong>{{ selected?.blueprints?.name || 'Blueprint Review' }}</strong>
                    <small v-if="selected">{{ selected.reason }}</small>
                    <small v-else>Select a blueprint to review its text and uploaded images.</small>
                </div>
                <div v-if="selected" class="nx-blueprint-moderation__actions">
                    <a :href="plannerUrl(selected.blueprint_id)" target="_blank" rel="noopener noreferrer">View in Planner<NxIcon name="ph:arrow-up-right" /></a>
                    <template v-if="['needs_review', 'rejected'].includes(selected.state)">
                        <NxButton size="sm" variant="primary" :disabled="busy || !review || review.blank" @click="decide('approved')">Approve</NxButton>
                        <NxButton size="sm" :disabled="busy" @click="decide('rejected')">Reject</NxButton>
                    </template>
                </div>
            </header>
            <div class="nx-blueprint-moderation__body">
                <NxCallout v-if="error" kind="danger" title="Moderation Unavailable" :message="error" />
                <NxCallout v-if="previewError" kind="danger" title="Preview Unavailable" :message="previewError" />
                <p v-if="busy && !review && !previewError" role="status">Loading blueprint…</p>
                <template v-if="review">
                    <NxCallout v-for="warning in review.warnings" :key="warning" title="Published Icon Missing" :message="warning" />
                    <h3>Project Text</h3>
                    <pre>{{ review.text.join('\n') || 'No project text.' }}</pre>
                    <h3>Uploaded Images ({{ review.imageCount }})</h3>
                    <div class="nx-blueprint-moderation__images">
                        <figure v-for="image in review.images" :key="image.name"><img :src="image.dataUrl" :alt="image.name"><figcaption>{{ image.name }}</figcaption></figure>
                    </div>
                    <div v-if="selected && review.imageCount > 8" class="nx-blueprint-moderation__pagination">
                        <NxButton :disabled="busy || review.offset === 0" @click="open(selected, Math.max(0, review.offset - 8))">Previous Images</NxButton>
                        <span>{{ review.offset + 1 }}–{{ Math.min(review.offset + 8, review.imageCount) }} of {{ review.imageCount }}</span>
                        <NxButton :disabled="busy || review.offset + 8 >= review.imageCount" @click="open(selected, review.offset + 8)">Next Images</NxButton>
                    </div>
                </template>
            </div>
        </section>
    </div>
</template>

<style scoped>
.nx-blueprint-moderation { display: grid; grid-template-columns: 17rem minmax(0, 1fr); width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; }
.nx-blueprint-moderation__sidebar { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; border-right: 1px solid var(--nx-border); background: var(--nx-bg-subtle); }
.nx-blueprint-moderation__header { display: flex; align-items: center; justify-content: space-between; gap: 6px; height: var(--nx-shell-pane-header-height); min-width: 0; padding: 0 8.5px 0 var(--nx-space-3); border-bottom: 1px solid var(--nx-border); background: var(--nx-bg-subtle); }
.nx-blueprint-moderation__sidebar > .nx-blueprint-moderation__header { padding-left: var(--nx-space-2); }
.nx-blueprint-moderation__header strong { font-size: var(--nx-text-sm); overflow-wrap: anywhere; }
.nx-blueprint-moderation__filter { flex: 1 1 auto; min-width: 0; }
.nx-blueprint-moderation__filter :deep(.nx-select-wrap), .nx-blueprint-moderation__filter :deep(.nx-select__trigger) { width: 100%; min-width: 0; max-width: 100%; }
.nx-blueprint-moderation__filter :deep(.nx-select__value) { min-width: 0; overflow: hidden; }
.nx-blueprint-moderation__filter :deep(.nx-select__value-label) { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.nx-blueprint-moderation small, .nx-blueprint-moderation__hint { color: var(--nx-text-muted); font-size: var(--nx-text-xs); }
.nx-blueprint-moderation__queue { overflow: auto; min-height: 0; padding: var(--nx-space-2); }
.nx-blueprint-moderation__queue ul { list-style: none; padding: 0; margin: 0; }
.nx-blueprint-moderation__hint { padding: var(--nx-space-2); }
.nx-blueprint-moderation__item { align-items: flex-start; padding-block: var(--nx-space-2); margin-bottom: 2px; }
.nx-blueprint-moderation__item-copy { display: grid; gap: 2px; min-width: 0; flex: 1; }
.nx-blueprint-moderation__item-copy strong { font-size: var(--nx-text-sm); font-weight: 600; overflow-wrap: anywhere; }
.nx-blueprint-moderation__item-copy > span { color: var(--nx-text-muted); font-size: var(--nx-text-xs); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
.nx-blueprint-moderation__item.is-active .nx-blueprint-moderation__item-copy :is(span, small) { color: inherit; opacity: .8; }
.nx-blueprint-moderation__item:focus-visible { outline: 2px solid var(--nx-accent); outline-offset: -2px; }
.nx-blueprint-moderation__item:disabled { cursor: default; }
.nx-blueprint-moderation__detail { display: grid; grid-template-rows: auto minmax(0, 1fr); min-width: 0; min-height: 0; }
.nx-blueprint-moderation__heading { display: flex; flex-direction: column; justify-content: center; gap: 2px; min-width: 0; flex: 1 1 auto; }
.nx-blueprint-moderation__heading strong { color: var(--nx-text); font-size: var(--nx-text-sm); line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nx-blueprint-moderation__heading small { font-weight: 400; line-height: 1.1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.nx-blueprint-moderation__actions, .nx-blueprint-moderation__pagination { display: flex; align-items: center; flex-wrap: wrap; gap: var(--nx-space-3); }
.nx-blueprint-moderation__actions a { display: inline-flex; align-items: center; gap: var(--nx-space-1); color: var(--nx-text); font-size: var(--nx-text-sm); }
.nx-blueprint-moderation__body { min-height: 0; overflow: auto; padding: var(--nx-space-5); }
h3 { font-size: var(--nx-text-sm); margin: var(--nx-space-4) 0 var(--nx-space-2); }
pre { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; background: var(--nx-surface); padding: var(--nx-space-3); }
.nx-blueprint-moderation__images { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(240px, 100%), 1fr)); gap: var(--nx-space-3); }
figure { margin: 0; } img { width: 100%; max-height: 32rem; object-fit: contain; } figcaption { overflow-wrap: anywhere; font-size: .8rem; }
@media (max-width: 760px) { .nx-blueprint-moderation { grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(12rem, 35%) minmax(0, 1fr); } .nx-blueprint-moderation__sidebar { border-right: 0; border-bottom: 1px solid var(--nx-panel-border); } }
</style>
