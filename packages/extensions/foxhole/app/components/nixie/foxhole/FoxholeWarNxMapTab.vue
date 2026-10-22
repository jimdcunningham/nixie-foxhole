<script setup lang="ts">
import { plannerRoadTourActions, plannerRoadTourOptions, plannerRoadTourStatus } from '#foxhole/plugins/foxhole/nixie/map/road-tour-state.ts';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import NixieSidebarFormSection from '#nixie/components/nixie/NixieSidebarFormSection.vue';
import NxButton from '#nixie/components/NxButton.vue';
import NxIconButton from '#nixie/components/NxIconButton.vue';
import NxProgress from '#nixie/components/NxProgress.vue';
import NxSelect from '#nixie/components/NxSelect.vue';
import NxToggleGrid from '#nixie/components/NxToggleGrid.vue';
import type { NxToggleGridOption, NxToggleGridOptionClick } from '#nixie/components/NxToggleGrid.vue';
import { requestNxConfirmDialog } from '#nixie/composables/useNxConfirmDialog.ts';
import { showNxToast } from '#nixie/composables/useNxToast.ts';
import { useNixieEditorDocumentSessionOptional } from '#nixie/composables/useNixieEditorDocumentSession.ts';
import { useNixieRuntime } from '#nixie/composables/useNixieRuntime.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import {
    FOXHOLE_MAP_ICON_CATEGORY_KEYS,
    FOXHOLE_MAP_LAYER_DEFINITIONS,
    FOXHOLE_MAP_LAYER_GROUPS,
    FOXHOLE_MAP_SETTING_KEYS,
    isFoxholeMapUserSettingKey,
    readFoxholeMapSettings,
    serializeFoxholeMapStringList,
} from '#foxhole/plugins/foxhole/nixie/map-settings.ts';
import type { FoxholeMapIconCategoryKey, FoxholeMapLayerKey } from '#foxhole/plugins/foxhole/nixie/map-settings.ts';
import { FOXHOLE_WORLD_LAYER_GROUPS, activeWorldLayerGroups, worldLayerGroupPatch } from '#foxhole/plugins/foxhole/nixie/map/world-layer-groups.ts';
import { rawFoxholePublishedMapIcons } from '#foxhole/plugins/foxhole/nixie/map/data.ts';
import { createFoxholeAssetsBaseUrl } from '#foxhole/plugins/foxhole/nixie/catalog.ts';
import {
    importFoxholeMapModPak,
    importFoxholeMapModPngFiles,
} from '#foxhole/plugins/foxhole/nixie/map/mod-importer.ts';
import {
    getFoxholeMapModStore,
} from '#foxhole/plugins/foxhole/nixie/map/mod-store.ts';
import type { FoxholeMapModImportProgress } from '#foxhole/plugins/foxhole/nixie/map/mod-store.ts';

interface RawFoxholeMapIcon {
    name?: string;
    icon?: string;
    category?: string;
}

interface FoxholeMapIconEntry {
    key: string;
    name: string;
    iconUrl: string | null;
    category: FoxholeMapIconCategoryKey;
}

const IMM_BASE_LAYER_KEYS = ['colors', 'base_map', 'base_map_full'] as const satisfies readonly FoxholeMapLayerKey[];

const runtime = useNixieRuntime();
const documentSession = useNixieEditorDocumentSessionOptional();
const isSpatialView = computed(() => {
    const controls = documentSession?.isSceneV2Active.value
        ? documentSession.sceneV2Editor.value?.controller.canvas.getViewControls()
        : null;
    return Boolean(controls && controls.mode !== 'flat');
});
const settingsStore = useNixieSettingsStore();
const runtimeConfig = useRuntimeConfig();
const assetsBaseUrl = createFoxholeAssetsBaseUrl(runtimeConfig.app.baseURL);
const mapModStore = getFoxholeMapModStore();
const mapModFileInput = ref<HTMLInputElement | null>(null);
const mapModEpoch = ref(0);
const pakImportStatus = shallowRef<FoxholeMapModImportProgress>({ ...mapModStore.pakImportStatus });

let unsubscribeMapMod: (() => void) | null = null;

onMounted(() => {
    void mapModStore.ensureLoaded();
    unsubscribeMapMod = mapModStore.subscribe(() => {
        mapModEpoch.value += 1;
        pakImportStatus.value = { ...mapModStore.pakImportStatus };
    });
});

onBeforeUnmount(() => {
    unsubscribeMapMod?.();
    unsubscribeMapMod = null;
});

const mapSettings = computed(() => readFoxholeMapSettings(
    runtime.projectStore.settings,
    settingId => settingsStore.getValueOr(settingId, ''),
));

const hasImportedMapMod = computed(() => {
    void mapModEpoch.value;
    return mapModStore.hasImportedMapMod();
});

const mapModSourceLabel = computed(() => {
    void mapModEpoch.value;
    const meta = mapModStore.getManifestMeta();
    if (!meta) {
        return '';
    }
    if (meta.sourceType === 'png') {
        return 'Loose PNG files';
    }
    const pakName = String(meta.sourcePakName ?? '').trim();
    return pakName || 'Imported map mod';
});

const isPakImportActive = computed(() => pakImportStatus.value.active === true);
const pakImportPercent = computed(() => Math.max(0, Math.min(100, Math.round(Number(pakImportStatus.value.percent ?? 0)))));
const pakImportDisplayFile = computed(() => pakImportStatus.value.fileName || 'mod.pak');
const pakImportCurrentFile = computed(() => pakImportStatus.value.currentFile || 'Preparing files…');

const layerGroups = FOXHOLE_MAP_LAYER_GROUPS;
const showRoadTour = import.meta.dev;
const roadTourRegions = computed(() => [{ value: '', label: 'Nearest Loaded Region' }, ...plannerRoadTourStatus.value.regions.map(region => ({ value: region.id, label: region.label }))]);
const roadTourViews = [{ value: 'variety', label: 'Variety' }, { value: 'close', label: 'Close' }, { value: 'scenic', label: 'Scenic' }, { value: 'high', label: 'High' }];
const roadTourSpeeds = [{ value: '6', label: '6 m/s' }, { value: '12', label: '12 m/s' }, { value: '24', label: '24 m/s' }, { value: '48', label: '48 m/s' }];
const roadTourShakeStrengths = [{ value: '0.35', label: 'Gentle' }, { value: '1', label: 'Medium' }, { value: '2', label: 'Strong' }];
function setRoadTourOption(key: 'region' | 'speed' | 'view' | 'shakeStrength', value: unknown): void {
    plannerRoadTourOptions.value = { ...plannerRoadTourOptions.value, [key]: key === 'speed' || key === 'shakeStrength' ? Number(value) : String(value) };
}
const worldLayerOptions: NxToggleGridOption[] = FOXHOLE_WORLD_LAYER_GROUPS.map(group => ({ id: group.id, label: group.label }));
const terrainOverlayOptions: NxToggleGridOption[] = [{ id: 'rdz', label: 'RDZ' }, { id: 'topo', label: 'Topo' }];
const activeTerrainOverlays = computed(() => [mapSettings.value.terrainRdz ? 'rdz' : '', mapSettings.value.terrainTopo ? 'topo' : ''].filter(Boolean));
function onTerrainOverlaysChange(ids: string[]): void {
    patchSettings({ [FOXHOLE_MAP_SETTING_KEYS.terrainRdz]: ids.includes('rdz'), [FOXHOLE_MAP_SETTING_KEYS.terrainTopo]: ids.includes('topo') }, 'foxhole-war-nx-map:terrain-overlays');
}
const activeWorldLayers = computed(() => activeWorldLayerGroups(mapSettings.value.worldLayers));
function onWorldLayerClick({ id, nextIds }: NxToggleGridOptionClick): void {
    patchSettings(worldLayerGroupPatch(id, nextIds.includes(id)), 'foxhole-war-nx-map:world-layers');
}
const layerDefinitions = FOXHOLE_MAP_LAYER_DEFINITIONS;
const rawMapIcons = rawFoxholePublishedMapIcons as Record<string, RawFoxholeMapIcon>;

function resolveMapIconUrl(iconName: string | null | undefined): string | null {
    const source = String(iconName ?? '').trim();
    if (!source) {
        return null;
    }

    if (source.startsWith('http://') || source.startsWith('https://') || source.startsWith('/')) {
        return source;
    }

    return `${assetsBaseUrl}maps/MapIcons/${source}.webp`;
}

const mapIconCategories = computed<Record<FoxholeMapIconCategoryKey, FoxholeMapIconEntry[]>>(() => {
    const categories: Record<FoxholeMapIconCategoryKey, FoxholeMapIconEntry[]> = {
        bases: [],
        resources: [],
        structures: [],
    };

    for (const [key, icon] of Object.entries(rawMapIcons)) {
        const category = FOXHOLE_MAP_ICON_CATEGORY_KEYS.includes(icon.category as FoxholeMapIconCategoryKey)
            ? icon.category as FoxholeMapIconCategoryKey
            : 'structures';
        categories[category].push({
            key,
            name: String(icon?.name ?? key).trim() || key,
            iconUrl: resolveMapIconUrl(icon?.icon),
            category,
        });
    }

    for (const categoryKey of FOXHOLE_MAP_ICON_CATEGORY_KEYS) {
        categories[categoryKey].sort((left, right) => {
            const leftId = Number(left.key);
            const rightId = Number(right.key);
            const leftIsCustom = leftId < 0;
            const rightIsCustom = rightId < 0;

            if (leftIsCustom !== rightIsCustom) {
                return leftIsCustom ? 1 : -1;
            }

            return leftId - rightId;
        });
    }

    return categories;
});

function patchSettings(patch: Record<string, boolean | number | string>, reason: string): void {
    const projectPatch: Record<string, boolean | number | string> = {};

    for (const [settingId, value] of Object.entries(patch)) {
        if (isFoxholeMapUserSettingKey(settingId)) {
            settingsStore.setValue(settingId, value, { reason });
            continue;
        }

        projectPatch[settingId] = value;
    }

    if (Object.keys(projectPatch).length > 0) {
        runtime.projectStore.patchSettings(projectPatch, reason);
    }
}

function setBoolean(key: string, value: boolean): void {
    patchSettings({ [key]: value }, `foxhole-war-nx-map:${key}`);
}

function layerKeyToSettingKey(layerKey: FoxholeMapLayerKey): string {
    switch (layerKey) {
        case 'base_map':
            return FOXHOLE_MAP_SETTING_KEYS.baseMap;
        case 'base_map_full':
            return FOXHOLE_MAP_SETTING_KEYS.baseMapFull;
        case 'roads_tiers':
            return FOXHOLE_MAP_SETTING_KEYS.roadsTiers;
        case 'dark_rdz':
            return FOXHOLE_MAP_SETTING_KEYS.darkRdz;
        case 'rail_bridge':
            return FOXHOLE_MAP_SETTING_KEYS.railBridge;
        case 'underwater_rocks_stripes':
            return FOXHOLE_MAP_SETTING_KEYS.underwaterRocksStripes;
        default:
            return `foxhole.map.${layerKey}`;
    }
}

function isLayerEnabled(layerKey: FoxholeMapLayerKey): boolean {
    const settings = mapSettings.value;
    switch (layerKey) {
        case 'base_map':
            return settings.baseMap;
        case 'base_map_full':
            return settings.baseMapFull;
        case 'roads_tiers':
            return settings.roadsTiers;
        case 'dark_rdz':
            return settings.darkRdz;
        case 'rail_bridge':
            return settings.railBridge;
        case 'underwater_rocks_stripes':
            return settings.underwaterRocksStripes;
        default:
            return Boolean(settings[layerKey]);
    }
}

function getLayerDefinitionDisables(layerKey: FoxholeMapLayerKey): readonly FoxholeMapLayerKey[] {
    return layerDefinitions[layerKey]?.disables ?? [];
}

function getLayerLabel(layerKey: FoxholeMapLayerKey): string {
    const definition = layerDefinitions[layerKey];
    return definition.alias ?? definition.name;
}

function getLayerGroupTitle(group: typeof FOXHOLE_MAP_LAYER_GROUPS[number]): string {
    switch (group.heading) {
        case 'Labels':
            return 'Map Labels';
        case 'Layers':
            return 'Map Overlays';
    }

    const subheading = 'subheading' in group && typeof group.subheading === 'string'
        ? group.subheading.trim()
        : '';

    return subheading ? `${group.heading} ${subheading}` : group.heading;
}

function getLayerGroupSectionKey(group: typeof FOXHOLE_MAP_LAYER_GROUPS[number]): string {
    return `foxhole-war-nx.map.${group.heading.toLowerCase().replace(/\s+/g, '-')}`;
}

function getLayerGroupDefaultOpen(group: typeof FOXHOLE_MAP_LAYER_GROUPS[number]): boolean {
    return group.heading === 'Labels' || group.heading === 'Layers';
}

function formatCategoryLabel(categoryKey: FoxholeMapIconCategoryKey): string {
    switch (categoryKey) {
        case 'bases':
            return 'Bases';
        case 'resources':
            return 'Resources';
        case 'structures':
            return 'Structures';
    }
}

function getLayerGroupOptions(group: typeof FOXHOLE_MAP_LAYER_GROUPS[number]): NxToggleGridOption[] {
    return group.layers.map(layerKey => ({
        id: layerKey,
        label: getLayerLabel(layerKey),
    }));
}

function getLayerGroupActiveIds(group: typeof FOXHOLE_MAP_LAYER_GROUPS[number]): string[] {
    return group.layers.filter(layerKey => isLayerEnabled(layerKey));
}

function onLayerGroupChange(
    group: typeof FOXHOLE_MAP_LAYER_GROUPS[number],
    nextIds: string[],
): void {
    const previous = new Set(getLayerGroupActiveIds(group));
    const next = new Set(nextIds);

    for (const layerKey of previous) {
        if (!next.has(layerKey)) {
            toggleLayer(layerKey as FoxholeMapLayerKey, false);
        }
    }

    for (const layerKey of next) {
        if (!previous.has(layerKey)) {
            toggleLayer(layerKey as FoxholeMapLayerKey, true);
        }
    }
}

function enableLocalMapMod(): void {
    const patch: Record<string, boolean> = {
        [FOXHOLE_MAP_SETTING_KEYS.modded]: true,
        [FOXHOLE_MAP_SETTING_KEYS.colors]: false,
        [FOXHOLE_MAP_SETTING_KEYS.baseMap]: false,
        [FOXHOLE_MAP_SETTING_KEYS.baseMapFull]: false,
    };
    patchSettings(patch, 'foxhole-war-nx-map:modded:enable');
}

function toggleModdedLayer(): void {
    if (mapSettings.value.modded) {
        setBoolean(FOXHOLE_MAP_SETTING_KEYS.modded, false);
        return;
    }
    if (!hasImportedMapMod.value) {
        showNxToast({
            kind: 'warning',
            title: 'No Map Mod',
            message: 'Import a .pak or PNG map mod before showing it.',
        });
        return;
    }
    enableLocalMapMod();
}

function toggleLayer(layerKey: FoxholeMapLayerKey, enabled: boolean): void {
    const patch: Record<string, boolean> = {
        [layerKeyToSettingKey(layerKey)]: enabled,
    };

    if (enabled) {
        for (const disabledKey of getLayerDefinitionDisables(layerKey)) {
            patch[layerKeyToSettingKey(disabledKey)] = false;
        }
    }

    if (enabled && (IMM_BASE_LAYER_KEYS as readonly string[]).includes(layerKey)) {
        patch[FOXHOLE_MAP_SETTING_KEYS.modded] = false;
    }

    patchSettings(patch, `foxhole-war-nx-map:layer:${layerKey}`);
}

function openMapModFilePicker(): void {
    mapModFileInput.value?.click();
}

async function onMapModFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement | null;
    const fileList = input?.files ? Array.from(input.files) : [];
    if (input) {
        input.value = '';
    }
    if (!fileList.length) {
        return;
    }

    const pakFile = fileList.find(file => file.name.toLowerCase().endsWith('.pak'));
    const pngFiles = pakFile
        ? []
        : fileList.filter(file => (
            file.type === 'image/png' || file.name.toLowerCase().endsWith('.png')
        ));

    if (!pakFile && !pngFiles.length) {
        showNxToast({
            kind: 'warning',
            title: 'Unsupported Files',
            message: 'Select a .pak map mod or one or more .png hex textures.',
        });
        return;
    }

    if (!(await confirmReplaceMapMod())) {
        return;
    }

    if (pakFile) {
        await importMapModPakFile(pakFile);
        return;
    }

    await importMapModPngFileList(pngFiles);
}

async function confirmReplaceMapMod(): Promise<boolean> {
    if (!hasImportedMapMod.value) {
        return true;
    }

    const cachedLabel = mapModSourceLabel.value || 'the current map mod';
    return await requestNxConfirmDialog({
        eyebrow: 'Replace Map Mod',
        title: 'Replace the current map mod?',
        message: `This replaces “${cachedLabel}” on this device. The cached textures will be removed.`,
        confirmLabel: 'Replace Mod',
        cancelLabel: 'Cancel',
        destructive: true,
    });
}

async function importMapModPakFile(file: File): Promise<void> {
    const importFileName = file.name || 'mod.pak';
    mapModStore.setPakImportStatus({
        active: true,
        fileName: importFileName,
        currentFile: '',
        processed: 0,
        total: 0,
        percent: 0,
        error: null,
    });

    try {
        const results = await importFoxholeMapModPak({
            contents: file,
            fileName: importFileName,
            onProgress: progress => {
                mapModStore.setPakImportStatus({
                    active: progress.active === true,
                    fileName: String(progress.fileName || importFileName),
                    currentFile: String(progress.currentFile || ''),
                    processed: Number(progress.processed ?? 0),
                    total: Number(progress.total ?? 0),
                    percent: Number(progress.percent ?? 0),
                    error: null,
                });
            },
        });

        if (results.cancelled) {
            showNxToast({
                kind: 'warning',
                title: 'Import Cancelled',
                message: 'Stopped importing the map mod. The previous cached mod was kept.',
            });
            return;
        }

        if ((results.pngCount ?? 0) > 0) {
            enableLocalMapMod();
        }

        showNxToast({
            kind: results.pngCount < results.processedCount ? 'warning' : 'success',
            title: results.pngCount < results.processedCount ? 'Map Mod Partially Imported' : 'Map Mod Imported',
            message: `Imported ${results.pngCount}/${results.processedCount} map textures from ${results.pakName || importFileName}.`,
        });
    } catch (error) {
        console.warn('[foxhole:map-mod] pak import failed:', error);
        mapModStore.setPakImportStatus({
            active: false,
            error: error instanceof Error ? error.message : String(error),
        });
        showNxToast({
            kind: 'error',
            title: 'Import Failed',
            message: error instanceof Error ? error.message : 'Failed to import the .pak map mod.',
        });
    } finally {
        mapModStore.setPakImportStatus({ active: false });
    }
}

async function importMapModPngFileList(files: File[]): Promise<void> {
    const importFileName = 'PNG Files';
    mapModStore.setPakImportStatus({
        active: true,
        fileName: importFileName,
        currentFile: '',
        processed: 0,
        total: files.length,
        percent: files.length ? 0 : 100,
        error: null,
    });

    try {
        const pngEntries = files.map(file => ({
            file,
            data: file,
        }));
        const results = await importFoxholeMapModPngFiles({
            files: pngEntries,
            onProgress: progress => {
                mapModStore.setPakImportStatus({
                    active: progress.active === true,
                    fileName: String(progress.fileName || importFileName),
                    currentFile: String(progress.currentFile || ''),
                    processed: Number(progress.processed ?? 0),
                    total: Number(progress.total ?? files.length),
                    percent: Number(progress.percent ?? 0),
                    error: progress.error ? String(progress.error) : null,
                });
            },
        });

        if (results.cancelled) {
            showNxToast({
                kind: 'warning',
                title: 'Import Cancelled',
                message: 'Stopped importing the map mod. The previous cached mod was kept.',
            });
            return;
        }

        if ((results.pngCount ?? 0) > 0) {
            enableLocalMapMod();
        }

        showNxToast({
            kind: 'success',
            title: 'Map Mod Imported',
            message: `Imported ${results.pngCount}/${results.total ?? files.length} map textures from loose PNG files.`,
        });
    } catch (error) {
        console.warn('[foxhole:map-mod] PNG import failed:', error);
        mapModStore.setPakImportStatus({
            active: false,
            error: error instanceof Error ? error.message : String(error),
        });
        showNxToast({
            kind: 'error',
            title: 'Import Failed',
            message: 'Failed to import PNG map textures.',
        });
    } finally {
        mapModStore.setPakImportStatus({ active: false });
    }
}

async function deleteMapMod(): Promise<void> {
    const cachedLabel = mapModSourceLabel.value || 'the current map mod';
    const confirmed = await requestNxConfirmDialog({
        eyebrow: 'Delete Map Mod',
        title: 'Delete this map mod?',
        message: `Removes “${cachedLabel}” from this device. This cannot be undone.`,
        confirmLabel: 'Delete Mod',
        cancelLabel: 'Cancel',
        destructive: true,
    });
    if (!confirmed) {
        return;
    }

    try {
        await mapModStore.clearMapModCache();
        setBoolean(FOXHOLE_MAP_SETTING_KEYS.modded, false);
        showNxToast({
            kind: 'success',
            title: 'Map Mod Removed',
            message: 'Deleted the locally cached map mod textures.',
        });
    } catch (error) {
        console.warn('[foxhole:map-mod] delete failed:', error);
        showNxToast({
            kind: 'error',
            title: 'Delete Failed',
            message: 'Could not delete the local map mod cache.',
        });
    }
}

function isIconCategoryEnabled(categoryKey: FoxholeMapIconCategoryKey): boolean {
    return mapSettings.value.iconCategories[categoryKey];
}

function isIconHidden(iconKey: string): boolean {
    return mapSettings.value.iconBlacklist.includes(iconKey);
}

function iconCategorySettingKey(categoryKey: FoxholeMapIconCategoryKey): string {
    switch (categoryKey) {
        case 'bases':
            return FOXHOLE_MAP_SETTING_KEYS.iconCategoryBases;
        case 'resources':
            return FOXHOLE_MAP_SETTING_KEYS.iconCategoryResources;
        case 'structures':
            return FOXHOLE_MAP_SETTING_KEYS.iconCategoryStructures;
    }
}

function toggleIconCategory(categoryKey: FoxholeMapIconCategoryKey, enabled: boolean): void {
    const settingKey = iconCategorySettingKey(categoryKey);

    if (!enabled) {
        setBoolean(settingKey, false);
        return;
    }

    const blacklist = new Set(mapSettings.value.iconBlacklist);
    for (const icon of mapIconCategories.value[categoryKey]) {
        blacklist.delete(icon.key);
    }

    patchSettings({
        [settingKey]: true,
        [FOXHOLE_MAP_SETTING_KEYS.iconBlacklist]: serializeFoxholeMapStringList(Array.from(blacklist)),
    }, `foxhole-war-nx-map:${settingKey}`);
}

/** Turn a disabled category back on with only the chosen icon active. */
function enableCategoryWithOnlyIcon(
    categoryKey: FoxholeMapIconCategoryKey,
    iconKey: string,
): void {
    const blacklist = new Set(mapSettings.value.iconBlacklist);
    for (const icon of mapIconCategories.value[categoryKey]) {
        if (icon.key === iconKey) {
            blacklist.delete(icon.key);
        } else {
            blacklist.add(icon.key);
        }
    }

    patchSettings({
        [iconCategorySettingKey(categoryKey)]: true,
        [FOXHOLE_MAP_SETTING_KEYS.iconBlacklist]: serializeFoxholeMapStringList(Array.from(blacklist)),
    }, `foxhole-war-nx-map:icon:${iconKey}:solo`);
}

/**
 * Restore legacy map-icon shift-click: solo this icon across all categories,
 * or clear the blacklist if it was already soloed.
 */
function toggleIconBlacklist(iconKey: string, event: MouseEvent): void {
    const blacklist = new Set(mapSettings.value.iconBlacklist);

    if (blacklist.has(iconKey)) {
        blacklist.delete(iconKey);
    } else if (event.shiftKey) {
        const allIcons = FOXHOLE_MAP_ICON_CATEGORY_KEYS.flatMap(categoryKey => (
            mapIconCategories.value[categoryKey]
        ));
        let changed = false;
        for (const candidate of allIcons) {
            if (candidate.key === iconKey) {
                continue;
            }
            if (!blacklist.has(candidate.key)) {
                blacklist.add(candidate.key);
                changed = true;
            }
        }
        if (!changed) {
            blacklist.clear();
        }
    } else {
        blacklist.add(iconKey);
    }

    patchSettings({
        [FOXHOLE_MAP_SETTING_KEYS.iconBlacklist]: serializeFoxholeMapStringList(Array.from(blacklist)),
    }, `foxhole-war-nx-map:icon:${iconKey}`);
}

function getCategoryIconOptions(categoryKey: FoxholeMapIconCategoryKey): NxToggleGridOption[] {
    return mapIconCategories.value[categoryKey].map(icon => ({
        id: icon.key,
        label: icon.name,
        imageUrl: icon.iconUrl ?? undefined,
        icon: icon.iconUrl ? undefined : 'ph:map-pin',
    }));
}

function getCategoryActiveIconIds(categoryKey: FoxholeMapIconCategoryKey): string[] {
    if (!isIconCategoryEnabled(categoryKey)) {
        return [];
    }

    return mapIconCategories.value[categoryKey]
        .filter(icon => !isIconHidden(icon.key))
        .map(icon => icon.key);
}

function onCategoryIconClick(
    categoryKey: FoxholeMapIconCategoryKey,
    payload: { id: string; event: MouseEvent; },
): void {
    if (!isIconCategoryEnabled(categoryKey)) {
        enableCategoryWithOnlyIcon(categoryKey, payload.id);
        return;
    }

    toggleIconBlacklist(payload.id, payload.event);
}

const mapControlsDisabled = computed(() => !mapSettings.value.enabled);
const mapIconsDisabled = computed(() => mapControlsDisabled.value || !mapSettings.value.icons);
const mapModControlsDisabled = computed(() => mapControlsDisabled.value || isPakImportActive.value);
const mapModImportLabel = computed(() => (
    hasImportedMapMod.value ? 'Replace Mod' : 'Import Mod'
));
const mapModVisibilityDisabled = computed(() => (
    mapModControlsDisabled.value || !hasImportedMapMod.value
));
</script>

<template>
    <div class="nixie-sidebar-form">
        <template v-for="group in layerGroups" :key="group.heading">
            <NixieSidebarFormSection
                v-if="group.heading === 'Improved Map Mod'"
                title="2.5D / 3D Layers"
                sectionKey="foxhole-war-nx.map.world-layers"
                collapsible
                :defaultOpen="true"
            >
                <div class="foxhole-war-nx-map-tab__layer-controls">
                    <NxToggleGrid
                        class="foxhole-war-nx-map-tab__world-layers"
                        :modelValue="activeWorldLayers"
                        :options="worldLayerOptions"
                        :disabled="mapControlsDisabled"
                        aria-label="2.5D / 3D Layers"
                        @option-click="onWorldLayerClick"
                    />

                    <NxToggleGrid
                        :modelValue="activeTerrainOverlays"
                        :options="terrainOverlayOptions"
                        :disabled="mapControlsDisabled"
                        aria-label="Terrain Overlays"
                        title="RDZ shows the 150 m border zone and known 50 m resource/world-base exemptions. Conditional border-base protection is not included. Topo shows 10 m elevation contours, with stronger 50 m lines."
                        @update:model-value="onTerrainOverlaysChange"
                    />
                </div>

                <div v-if="showRoadTour && plannerRoadTourStatus.attached" class="foxhole-war-nx-map-tab__road-tour" role="group" aria-label="Road Tour">
                    <NxSelect label="Tour Region" :modelValue="plannerRoadTourOptions.region" :options="roadTourRegions" :disabled="plannerRoadTourStatus.state !== 'idle'" @update:modelValue="setRoadTourOption('region', $event)" />
                    <div class="foxhole-war-nx-map-tab__tour-options">
                        <NxSelect label="Speed" :modelValue="String(plannerRoadTourOptions.speed)" :options="roadTourSpeeds" @update:modelValue="setRoadTourOption('speed', $event)" />
                        <NxSelect label="View" :modelValue="plannerRoadTourOptions.view" :options="roadTourViews" @update:modelValue="setRoadTourOption('view', $event)" />
                    </div>
                    <div class="foxhole-war-nx-map-tab__tour-actions">
                        <NxButton size="sm" :label="plannerRoadTourStatus.state === 'running' ? 'Pause Tour' : plannerRoadTourStatus.state === 'paused' ? 'Resume Tour' : 'Start Tour'" :disabled="!plannerRoadTourStatus.canRun || plannerRoadTourStatus.state === 'loading'" @click="plannerRoadTourActions?.start()" />
                        <NxButton size="sm" variant="secondary" label="Next Road" :disabled="!plannerRoadTourStatus.canRun || plannerRoadTourStatus.state === 'loading'" @click="plannerRoadTourActions?.next()" />
                        <NxButton size="sm" variant="secondary" label="Stop Tour" :disabled="plannerRoadTourStatus.state === 'idle'" @click="plannerRoadTourActions?.stop()" />
                    </div>
                    <NxSelect label="Shake Strength" :modelValue="String(plannerRoadTourOptions.shakeStrength)" :options="roadTourShakeStrengths" @update:modelValue="setRoadTourOption('shakeStrength', $event)" />
                    <NxButton size="sm" variant="secondary" :label="plannerRoadTourStatus.shaking ? 'Stop Shake' : 'Shake Camera'" :aria-pressed="plannerRoadTourStatus.shaking" :disabled="!plannerRoadTourStatus.canShake" @click="plannerRoadTourActions?.toggleCameraShake()" />
                    <p v-if="plannerRoadTourStatus.error" role="alert" class="text-xs opacity-70">{{ plannerRoadTourStatus.error }}</p>
                </div>
            </NixieSidebarFormSection>
            <NixieSidebarFormSection
                v-if="group.heading !== 'Improved Map Mod' || !isSpatialView"
                :title="getLayerGroupTitle(group)"
                :sectionKey="getLayerGroupSectionKey(group)"
                collapsible
                :defaultOpen="getLayerGroupDefaultOpen(group)"
            >
                <NxToggleGrid
                    :modelValue="getLayerGroupActiveIds(group)"
                    :options="getLayerGroupOptions(group)"
                    :disabled="mapControlsDisabled"
                    :aria-label="getLayerGroupTitle(group)"
                    preserveLabelCase
                    @update:model-value="onLayerGroupChange(group, $event)"
                />
            </NixieSidebarFormSection>

        </template>

        <NixieSidebarFormSection
            title="Custom Map Mod"
            sectionKey="foxhole-war-nx.map.custom-map-mod"
            collapsible
            :defaultOpen="true"
        >
            <template #actions>
                <NxIconButton
                    class="nixie-sidebar-row__action"
                    :icon="mapSettings.modded ? 'ph:eye' : 'ph:eye-slash'"
                    :label="mapSettings.modded ? 'Hide Mod' : 'Show Mod'"
                    :tooltip="mapSettings.modded ? 'Hide Mod' : 'Show Mod'"
                    variant="bare"
                    size="sm"
                    :disabled="mapModVisibilityDisabled"
                    :active="!mapSettings.modded"
                    @click="toggleModdedLayer"
                />
            </template>

            <div class="nixie-sidebar-form-dense foxhole-war-nx-map-tab__mod-panel">
                <div
                    v-if="!isPakImportActive"
                    class="nx-toggle-grid foxhole-war-nx-map-tab__mod-actions"
                    role="group"
                    aria-label="Custom Map Mod Actions"
                >
                    <NxButton
                        variant="secondary"
                        size="sm"
                        :label="mapModImportLabel"
                        :disabled="mapModControlsDisabled"
                        @click="openMapModFilePicker"
                    />
                    <NxButton
                        variant="danger"
                        size="sm"
                        label="Delete Mod"
                        :disabled="mapModControlsDisabled || !hasImportedMapMod"
                        @click="deleteMapMod"
                    />
                </div>

                <div
                    v-else
                    class="foxhole-war-nx-map-tab__mod-progress"
                    role="status"
                    aria-live="polite"
                >
                    <div
                        class="foxhole-war-nx-map-tab__mod-progress-title"
                        :title="`Importing ${pakImportDisplayFile}`"
                    >
                        Importing {{ pakImportDisplayFile }}
                    </div>
                    <div
                        class="foxhole-war-nx-map-tab__mod-progress-file"
                        :title="pakImportCurrentFile"
                    >
                        {{ pakImportCurrentFile }}
                    </div>
                    <NxProgress
                        :value="pakImportPercent"
                        size="sm"
                        variant="accent"
                        :label="`Importing ${pakImportDisplayFile}`"
                    />
                    <div class="foxhole-war-nx-map-tab__mod-progress-stats">
                        {{ pakImportStatus.processed }}/{{ pakImportStatus.total }} ({{ pakImportPercent }}%)
                    </div>
                </div>

                <input
                    ref="mapModFileInput"
                    class="foxhole-war-nx-map-tab__mod-file-input"
                    type="file"
                    accept=".pak,.png,image/png"
                    multiple
                    @change="onMapModFilesSelected"
                >
            </div>
        </NixieSidebarFormSection>

        <NixieSidebarFormSection
            v-for="categoryKey in FOXHOLE_MAP_ICON_CATEGORY_KEYS"
            :key="categoryKey"
            :title="formatCategoryLabel(categoryKey)"
            :sectionKey="`foxhole-war-nx.map.icons.${categoryKey}`"
            collapsible
            :defaultOpen="false"
        >
            <template #actions>
                <NxIconButton
                    class="nixie-sidebar-row__action"
                    :icon="isIconCategoryEnabled(categoryKey) ? 'ph:eye' : 'ph:eye-slash'"
                    :label="isIconCategoryEnabled(categoryKey) ? 'Hide Category' : 'Show Category'"
                    :tooltip="isIconCategoryEnabled(categoryKey) ? 'Hide Category' : 'Show Category'"
                    variant="bare"
                    size="sm"
                    :disabled="mapIconsDisabled"
                    :active="!isIconCategoryEnabled(categoryKey)"
                    @click="toggleIconCategory(categoryKey, !isIconCategoryEnabled(categoryKey))"
                />
            </template>

            <NxToggleGrid
                appearance="icon"
                class="foxhole-war-nx-map-tab__icon-grid"
                :class="{ 'is-category-muted': !isIconCategoryEnabled(categoryKey) }"
                :modelValue="getCategoryActiveIconIds(categoryKey)"
                :options="getCategoryIconOptions(categoryKey)"
                :disabled="mapIconsDisabled"
                :aria-label="formatCategoryLabel(categoryKey)"
                preserveLabelCase
                @option-click="onCategoryIconClick(categoryKey, $event)"
            />
        </NixieSidebarFormSection>
    </div>
</template>

<style scoped>
.foxhole-war-nx-map-tab__layer-controls {
    display: grid;
    gap: var(--nx-space-1);
    min-width: 0;
}


.foxhole-war-nx-map-tab__road-tour {
    display: grid;
    gap: var(--nx-space-2);
    margin-top: var(--nx-space-2);
    padding-top: var(--nx-space-2);
    border-top: 1px solid var(--nx-border);
    min-width: 0;
}

.foxhole-war-nx-map-tab__tour-options {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--nx-space-2);
}

.foxhole-war-nx-map-tab__tour-options > * {
    min-width: 0;
}

.foxhole-war-nx-map-tab__tour-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--nx-space-1);
}

.foxhole-war-nx-map-tab__icon-grid.is-category-muted {
    opacity: 0.45;
}

.foxhole-war-nx-map-tab__mod-panel {
    min-width: 0;
    max-width: 100%;
}

/* Same track sizing/gap as layer grids; NxButton fills each cell. */
.foxhole-war-nx-map-tab__mod-actions :deep(.nx-btn) {
    width: 100%;
    min-width: 0;
    min-height: var(--nx-control-height-sm);
    height: 100%;
}

.foxhole-war-nx-map-tab__mod-progress {
    display: grid;
    gap: var(--nx-space-1);
    min-width: 0;
    max-width: 100%;
}

.foxhole-war-nx-map-tab__mod-progress-title,
.foxhole-war-nx-map-tab__mod-progress-file,
.foxhole-war-nx-map-tab__mod-progress-stats {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--nx-text-xs);
}

.foxhole-war-nx-map-tab__mod-progress-title {
    color: var(--nx-text);
}

.foxhole-war-nx-map-tab__mod-progress-file,
.foxhole-war-nx-map-tab__mod-progress-stats {
    color: var(--nx-text-muted);
}

.foxhole-war-nx-map-tab__mod-progress-stats {
    text-align: right;
}

.foxhole-war-nx-map-tab__mod-progress :deep(.nx-progress) {
    min-width: 0;
    max-width: 100%;
}

.foxhole-war-nx-map-tab__mod-file-input {
    display: none;
}
</style>
