<script setup lang="ts">
defineProps<{
    starting: boolean;
    startError: string;
}>();
defineEmits<{ start: []; }>();

const workspaceFeatures = [
    { icon: 'ph:blueprint', title: 'Plan Your Build', description: 'Lay out bunkers and facilities with Foxhole structures, snapping, and connections.' },
    { icon: 'nx:lightning', title: 'Work Out the Numbers', description: 'See construction costs, power, and production inputs and outputs as you plan.' },
    { icon: 'ph:users-three', title: 'Bring Your Regiment', description: 'Use a Nixie workspace to share plans, write briefings, and organize logistics together.' },
];
</script>

<template>
    <div class="foxhole-landing">
        <main class="foxhole-landing__content">
            <div class="foxhole-landing__atmosphere" aria-hidden="true" />
            <section class="foxhole-landing__hero" aria-labelledby="foxhole-landing-title">
                <div class="foxhole-landing__identity">
                    <NuxtLink to="/welcome" class="foxhole-landing__brand">
                        <NxIcon name="nx:nixie-outline" aria-hidden="true" />
                        Powered by Nixie Studio
                    </NuxtLink>
                    <h1 id="foxhole-landing-title">Foxhole Planner</h1>
                    <p class="foxhole-landing__lede">Plan bunkers, facilities, and logistics<br class="foxhole-landing__line-break"> in one workspace.</p>
                    <div class="foxhole-landing__actions">
                        <NxButton
                            class="foxhole-landing__primary"
                            variant="primary"
                            size="lg"
                            :disabled="starting"
                            :aria-busy="starting"
                            @click="$emit('start')"
                        >
                            {{ starting ? 'Starting…' : 'Start Planning' }}
                            <NxIcon :name="starting ? 'ph:circle-notch' : 'ph:arrow-right'" :class="{ 'foxhole-landing__spinner': starting }" aria-hidden="true" />
                        </NxButton>
                    </div>
                    <p v-if="startError" class="foxhole-landing__error" role="alert">{{ startError }}</p>
                </div>
            </section>

            <section class="foxhole-landing__workspace" aria-label="Planner Features">
                <div class="foxhole-landing__features">
                    <div v-for="feature in workspaceFeatures" :key="feature.title" class="foxhole-landing__feature">
                        <div class="foxhole-landing__feature-heading">
                            <NxIcon :name="feature.icon" aria-hidden="true" />
                            <h2>{{ feature.title }}</h2>
                        </div>
                        <p>{{ feature.description }}</p>
                    </div>
                </div>
            </section>
        </main>
        <ClientOnly>
            <NxHubFooter />
        </ClientOnly>
    </div>
</template>

<style scoped>
.foxhole-landing { flex: 1 1 auto; height: 100%; min-height: 0; overflow: auto; overflow-x: hidden; background: var(--nx-bg); color: var(--nx-text); }
.foxhole-landing__content { position: relative; isolation: isolate; }
.foxhole-landing__hero { padding: clamp(56px, 10vh, 100px) 24px 0; }
.foxhole-landing__atmosphere { position: absolute; z-index: -1; inset: 0; pointer-events: none; background: radial-gradient(ellipse 75% 90% at 50% 35%, color-mix(in srgb, var(--nx-accent) 11%, transparent), transparent 85%); }
.foxhole-landing__atmosphere::after { position: absolute; inset: 0; content: ''; opacity: 0.22; mask-image: radial-gradient(ellipse 85% 100% at 50% 30%, black, transparent 85%); background-image: linear-gradient(var(--nx-border-strong) 1px, transparent 1px), linear-gradient(90deg, var(--nx-border-strong) 1px, transparent 1px); background-size: 32px 32px; }
.foxhole-landing__identity { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; animation: foxhole-landing-rise 500ms var(--nx-ease-out) both; }
.foxhole-landing__brand { display: inline-flex; align-items: center; gap: 8px; color: var(--nx-accent); font-size: 16px; text-decoration: none; }
.foxhole-landing__brand:hover { color: var(--nx-text); }
.foxhole-landing__brand :deep(.nx-icon) { width: 18px; height: 18px; font-size: 18px; }
.foxhole-landing h1 { margin: 14px 0 16px; font-family: var(--nx-font-display); font-size: clamp(42px, 5.8vw, 76px); font-weight: 600; letter-spacing: -0.045em; line-height: 1.04; color: var(--nx-text-heading); }
.foxhole-landing__lede { margin: 0; color: var(--nx-text-muted); font-size: clamp(17px, 1.6vw, 21px); line-height: 1.5; }
.foxhole-landing__actions { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; margin: 40px 0 14px; }
.foxhole-landing__primary { min-width: 240px; min-height: 56px; gap: 10px; padding: 0 30px; border: 1px solid color-mix(in srgb, var(--nx-accent) 72%, transparent); border-radius: var(--nx-radius-md); background: color-mix(in srgb, var(--nx-bg) 78%, var(--nx-accent) 22%); color: var(--nx-accent); font-size: 17px; font-weight: 600; box-shadow: 0 0 24px color-mix(in srgb, var(--nx-accent) 15%, transparent), inset 0 0 12px color-mix(in srgb, var(--nx-accent) 5%, transparent); transition: background 180ms ease, box-shadow 180ms ease, transform 180ms ease; }
.foxhole-landing__primary:not(:disabled):hover { background: color-mix(in srgb, var(--nx-bg) 66%, var(--nx-accent) 34%); box-shadow: 0 0 32px color-mix(in srgb, var(--nx-accent) 22%, transparent); transform: translateY(-2px); }
.foxhole-landing__primary:focus-visible, .foxhole-landing__brand:focus-visible { outline: 2px solid var(--nx-accent); outline-offset: 5px; }
.foxhole-landing__error { max-width: 36rem; margin: 16px 0 0; color: var(--nx-danger); font-size: 14px; }
.foxhole-landing__workspace { max-width: 1200px; margin: 0 auto; padding: 46px 24px 50px; text-align: center; }
.foxhole-landing__features { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; margin: 0 auto; text-align: left; }
.foxhole-landing__feature { min-width: 0; padding: 24px; border: 1px solid var(--nx-border); border-radius: var(--nx-radius-lg); }
.foxhole-landing__feature-heading { display: flex; align-items: center; gap: 12px; }
.foxhole-landing__feature-heading > :deep(.nx-icon) { flex: 0 0 24px; width: 24px; height: 24px; color: var(--nx-accent); font-size: 24px; }
.foxhole-landing h2 { margin: 0; color: var(--nx-text-heading); font-size: 16px; font-weight: 600; }
.foxhole-landing__feature p { margin: 14px 0 0; color: var(--nx-text-muted); font-size: 14px; line-height: 1.7; }
.foxhole-landing__spinner { animation: foxhole-landing-spin 900ms linear infinite; }
@keyframes foxhole-landing-rise { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
@keyframes foxhole-landing-spin { to { transform: rotate(360deg); } }
@media (max-width: 900px) {
    .foxhole-landing__features { grid-template-columns: minmax(0, 1fr); max-width: 560px; gap: 16px; }
}
@media (max-width: 640px) {
    .foxhole-landing__hero { padding: 32px 16px 0; }
    .foxhole-landing__actions { width: 100%; }
    .foxhole-landing__primary { width: min(100%, 300px); min-width: 0; }
    .foxhole-landing__workspace { padding: 46px 24px 50px; }
}
@media (prefers-reduced-motion: reduce) {
    .foxhole-landing__identity, .foxhole-landing__spinner { animation: none; }
    .foxhole-landing__primary { transition: none; }
    .foxhole-landing__primary:not(:disabled):hover { transform: none; }
}
</style>
