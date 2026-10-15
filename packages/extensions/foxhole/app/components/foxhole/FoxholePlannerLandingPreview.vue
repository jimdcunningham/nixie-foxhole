<script setup lang="ts">
const assetsBase = '/foxhole/assets/types/structures';
const buildings = [
    { id: 'power', name: 'Diesel Power Plant', image: `${assetsBase}/facilitypowerdiesel/modifications/petrol/petrol.texture.webp`, icon: `${assetsBase}/facilitypowerdiesel/facilitypowerdiesel.icon.default.webp` },
    { id: 'materials', name: 'Materials Factory', image: `${assetsBase}/facilityrefinery1/facilityrefinery1.texture.webp`, icon: `${assetsBase}/facilityrefinery1/facilityrefinery1.icon.default.webp` },
    { id: 'metalworks', name: 'Metalworks Factory', image: `${assetsBase}/facilityrefinery2/facilityrefinery2.texture.webp`, icon: `${assetsBase}/facilityrefinery2/facilityrefinery2.icon.default.webp` },
];
</script>

<template>
    <figure class="foxhole-preview" aria-label="Example Foxhole facility plan with connected factories and power and production statistics">
        <div class="foxhole-preview__titlebar">
            <span><NxIcon name="ph:strategy" aria-hidden="true" /> Westgate Facility</span>
            <span class="foxhole-preview__example">Example Plan</span>
        </div>
        <div class="foxhole-preview__body">
            <div class="foxhole-preview__explorer" aria-hidden="true">
                <div class="foxhole-preview__panel-title">Explorer <NxIcon name="ph:dots-three" /></div>
                <div class="foxhole-preview__explorer-mode"><NxIcon name="ph:puzzle-piece" /> Foxhole Assets</div>
                <div class="foxhole-preview__asset-grid">
                    <div v-for="building in buildings" :key="building.id"><img
                        :src="building.icon"
                        alt=""
                        width="48"
                        height="48"
                    ></div>
                </div>
                <div class="foxhole-preview__scene-heading">Scene</div>
                <div v-for="building in buildings" :key="building.id" class="foxhole-preview__tree-row">
                    <NxIcon name="ph:cube" /> {{ building.name }}
                </div>
            </div>
            <div class="foxhole-preview__canvas">
                <div class="foxhole-preview__canvas-bar" aria-hidden="true"><span><NxIcon name="ph:cursor" /> Selection</span><span><NxIcon name="ph:grid-four" /> <NxIcon name="ph:stack" /></span></div>
                <div class="foxhole-preview__plan">
                    <svg
                        class="foxhole-preview__connections"
                        viewBox="0 0 700 430"
                        fill="none"
                        aria-hidden="true"
                    >
                        <path
                            d="M215 252H325V132H405M325 252H495V304H530"
                            stroke="currentColor"
                            stroke-width="3"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                        <circle
                            cx="215"
                            cy="252"
                            r="5"
                            fill="currentColor"
                        /><circle
                            cx="405"
                            cy="132"
                            r="5"
                            fill="currentColor"
                        /><circle
                            cx="530"
                            cy="304"
                            r="5"
                            fill="currentColor"
                        />
                    </svg>
                    <div
                        v-for="building in buildings"
                        :key="building.id"
                        class="foxhole-preview__building"
                        :class="`foxhole-preview__building--${building.id}`"
                    >
                        <img
                            :src="building.image"
                            :alt="building.name"
                            width="491"
                            height="520"
                        >
                    </div>
                    <div class="foxhole-preview__power-label"><NxIcon name="nx:lightning" aria-hidden="true" /> 12 MW</div>
                    <div class="foxhole-preview__output-label"><NxIcon name="ph:package" aria-hidden="true" /> Construction Materials</div>
                </div>
                <div class="foxhole-preview__status" aria-hidden="true"><span><i /> Saved</span><span>Layer 1 · 3 Structures</span><span>100%</span></div>
            </div>
            <div class="foxhole-preview__stats">
                <div class="foxhole-preview__panel-title">Statistics <NxIcon name="ph:chart-bar" aria-hidden="true" /></div>
                <div class="foxhole-preview__stat-section">
                    <h3>Facility Power</h3>
                    <dl><div><dt>Produced</dt><dd class="foxhole-preview__positive">12 MW</dd></div><div><dt>Consumed</dt><dd>7 MW</dd></div><div><dt>Net Total</dt><dd class="foxhole-preview__positive">5 MW</dd></div></dl>
                </div>
                <div class="foxhole-preview__stat-section">
                    <h3>Production Output</h3>
                    <p class="foxhole-preview__interval">Per Hour</p>
                    <dl><div><dt>Construction Materials</dt><dd>×144</dd></div><div><dt>Assembly Materials I</dt><dd>×60</dd></div></dl>
                </div>
                <div class="foxhole-preview__stat-section foxhole-preview__hint"><NxIcon name="nx:lightning" aria-hidden="true" /> See how your whole facility fits together.</div>
            </div>
        </div>
    </figure>
</template>

<style scoped>
.foxhole-preview { position: relative; width: min(1120px, 100%); margin: 46px auto 0; overflow: hidden; border: 1px solid var(--nx-border-strong); border-radius: var(--nx-radius-lg); background: var(--nx-bg); box-shadow: 0 22px 80px color-mix(in srgb, var(--nx-bg) 80%, transparent), 0 0 60px color-mix(in srgb, var(--nx-accent) 4%, transparent); }
.foxhole-preview__titlebar { display: flex; align-items: center; justify-content: space-between; min-height: 42px; padding: 0 18px; border-bottom: 1px solid var(--nx-border); background: var(--nx-surface); font-size: 12px; color: var(--nx-text-muted); }
.foxhole-preview__titlebar > span:first-child { display: flex; align-items: center; gap: 8px; color: var(--nx-text); }
.foxhole-preview__titlebar :deep(.nx-icon) { color: var(--nx-accent); }
.foxhole-preview__example { font-size: 10px; color: var(--nx-text-subtle); }
.foxhole-preview__body { display: grid; grid-template-columns: 170px minmax(0, 1fr) 220px; }
.foxhole-preview__explorer, .foxhole-preview__stats { min-width: 0; padding: 14px 12px; background: var(--nx-surface); }
.foxhole-preview__explorer { border-right: 1px solid var(--nx-border); }
.foxhole-preview__stats { border-left: 1px solid var(--nx-border); }
.foxhole-preview__panel-title { display: flex; align-items: center; justify-content: space-between; color: var(--nx-text-heading); font-size: 11px; font-weight: 600; }
.foxhole-preview__panel-title :deep(.nx-icon) { color: var(--nx-text-subtle); }
.foxhole-preview__explorer-mode { display: flex; align-items: center; gap: 6px; margin: 25px 0 12px; color: var(--nx-accent); font-size: 10px; }
.foxhole-preview__asset-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.foxhole-preview__asset-grid > div { display: grid; place-items: center; aspect-ratio: 1; border: 1px solid var(--nx-border); border-radius: var(--nx-radius-sm); }
.foxhole-preview__asset-grid img { width: 34px; height: 34px; object-fit: contain; opacity: 0.9; }
.foxhole-preview__scene-heading { margin: 32px 0 12px; font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--nx-text-subtle); }
.foxhole-preview__tree-row { display: flex; align-items: center; gap: 6px; margin: 13px 0; color: var(--nx-text-muted); font-size: 9px; }
.foxhole-preview__tree-row :deep(.nx-icon) { flex-shrink: 0; }
.foxhole-preview__canvas { min-width: 0; background-color: var(--nx-bg); background-image: linear-gradient(color-mix(in srgb, var(--nx-border) 45%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--nx-border) 45%, transparent) 1px, transparent 1px); background-size: 22px 22px; }
.foxhole-preview__canvas-bar { display: flex; justify-content: space-between; align-items: center; height: 34px; padding: 0 14px; border-bottom: 1px solid var(--nx-border); font-size: 10px; color: var(--nx-text-muted); background: var(--nx-bg); }
.foxhole-preview__canvas-bar > span { display: inline-flex; gap: 10px; align-items: center; }
.foxhole-preview__plan { position: relative; aspect-ratio: 700 / 430; min-height: 320px; }
.foxhole-preview__connections { position: absolute; inset: 0; width: 100%; height: 100%; color: color-mix(in srgb, var(--nx-accent) 75%, transparent); }
.foxhole-preview__building { position: absolute; transform: translate(-50%, -50%); }
.foxhole-preview__building img { display: block; width: 100%; height: auto; filter: drop-shadow(0 8px 10px color-mix(in srgb, var(--nx-bg) 65%, transparent)); }
.foxhole-preview__building--power { width: 22%; left: 23%; top: 55%; }
.foxhole-preview__building--materials { width: 20%; left: 56%; top: 36%; }
.foxhole-preview__building--metalworks { width: 28%; left: 77%; top: 69%; }
.foxhole-preview__power-label, .foxhole-preview__output-label { position: absolute; display: flex; align-items: center; gap: 5px; padding: 5px 8px; border: 1px solid var(--nx-border-strong); border-radius: var(--nx-radius-sm); background: var(--nx-bg); font-size: 9px; white-space: nowrap; }
.foxhole-preview__power-label { left: 10%; top: 80%; color: var(--nx-accent); }
.foxhole-preview__output-label { left: 43%; top: 7%; color: var(--nx-text-muted); }
.foxhole-preview__status { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 26px; padding: 0 12px; border-top: 1px solid var(--nx-border); background: var(--nx-bg); color: var(--nx-text-subtle); font-size: 9px; }
.foxhole-preview__status > span:first-child { display: flex; align-items: center; gap: 5px; }
.foxhole-preview__status i { width: 4px; height: 4px; border-radius: 50%; background: var(--nx-success); }
.foxhole-preview__stat-section { margin-top: 20px; padding: 12px 10px; border: 1px solid var(--nx-border); border-radius: var(--nx-radius-md); }
.foxhole-preview h3 { margin: 0 0 14px; font-size: 9px; font-weight: 500; color: var(--nx-text-muted); letter-spacing: 0.07em; text-transform: uppercase; }
.foxhole-preview dl { display: grid; gap: 11px; margin: 0; font-size: 10px; }
.foxhole-preview dl > div { display: flex; justify-content: space-between; gap: 10px; }
.foxhole-preview dt { color: var(--nx-text-muted); }
.foxhole-preview dd { margin: 0; white-space: nowrap; color: var(--nx-text); }
.foxhole-preview dd.foxhole-preview__positive { color: var(--nx-success); }
.foxhole-preview__interval { margin: -5px 0 12px; color: var(--nx-text-subtle); font-size: 9px; }
.foxhole-preview__hint { display: flex; gap: 8px; align-items: flex-start; color: var(--nx-text-subtle); font-size: 10px; line-height: 1.6; }
.foxhole-preview__hint :deep(.nx-icon) { flex-shrink: 0; margin-top: 2px; color: var(--nx-accent); }
@media (max-width: 900px) {
    .foxhole-preview__body { grid-template-columns: minmax(0, 1fr) 190px; }
    .foxhole-preview__explorer { display: none; }
}
@media (max-width: 640px) {
    .foxhole-preview { margin-top: 36px; }
    .foxhole-preview__body { grid-template-columns: minmax(0, 1fr); }
    .foxhole-preview__stats { display: none; }
    .foxhole-preview__plan { min-height: 0; }
    .foxhole-preview__titlebar { padding: 0 12px; }
    .foxhole-preview__power-label, .foxhole-preview__output-label { font-size: 8px; padding: 4px 6px; }
}
</style>
