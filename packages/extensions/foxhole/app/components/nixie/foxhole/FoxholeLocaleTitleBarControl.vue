<script setup lang="ts">
import { computed, ref } from 'vue';
import type { NixieTitleBarContext } from '#nixie/plugins/nixie/registry/index.ts';
import type { ResolvedMenuItem } from '#nixie/plugins/nixie/registry/menu-resolver.ts';
import NxMenu from '#nixie/components/NxMenu.vue';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import {
    getFoxholeLocaleIcon,
    getFoxholeLocaleOption,
    FOXHOLE_LOCALE_OPTIONS,
    FOXHOLE_LOCALE_SETTING_ID,
} from '#foxhole/plugins/foxhole/nixie/asset-settings.ts';

defineProps<{
    context: NixieTitleBarContext;
}>();

const settingsStore = useNixieSettingsStore();
const menuPosition = ref<{ x: number; y: number; } | null>(null);
const localeSetting = settingsStore.useValueOr(FOXHOLE_LOCALE_SETTING_ID, 'en');

const selectedLocale = computed(() => {
    return getFoxholeLocaleOption(localeSetting.value);
});

const menuOpen = computed(() => menuPosition.value !== null);
const selectedIcon = computed(() => getFoxholeLocaleIcon(localeSetting.value));

const localeMenuItems = computed<ResolvedMenuItem[]>(() => {
    const activeLocale = selectedLocale.value.value;

    return FOXHOLE_LOCALE_OPTIONS.flatMap((option, index) => {
        const items: ResolvedMenuItem[] = [{
            type: 'checkbox',
            label: option.label,
            icon: option.icon,
            checked: option.value === activeLocale,
            disabled: false,
            visible: true,
            onClick: () => {
                setLocale(option.value);
            },
        }];

        if (index === 0 && FOXHOLE_LOCALE_OPTIONS.length > 1) {
            items.push({
                type: 'separator',
                visible: true,
            });
        }

        return items;
    });
});

function setLocale(value: string): void {
    settingsStore.setValue(FOXHOLE_LOCALE_SETTING_ID, value, {
        reason: 'foxhole:title-bar-locale',
    });
    closeMenu();
}

function toggleMenu(event: MouseEvent): void {
    const target = event.currentTarget as HTMLElement | null;
    if (!target) {
        return;
    }

    if (menuPosition.value) {
        closeMenu();
        return;
    }

    const rect = target.getBoundingClientRect();
    menuPosition.value = {
        x: rect.right,
        y: rect.bottom,
    };
}

function closeMenu(): void {
    menuPosition.value = null;
}
</script>

<template>
    <div class="foxhole-title-locale" @keydown.esc="closeMenu">
        <button
            type="button"
            class="btn-small"
            :class="{ 'btn-active': menuOpen }"
            :data-tooltip="`Language: ${selectedLocale.label}`"
            data-tooltip-position="bottom"
            @pointerdown.stop
            @click="toggleMenu($event)"
        >
            <Icon :name="selectedIcon" class="foxhole-title-locale__flag" />
        </button>

        <NxMenu
            v-if="menuPosition && localeMenuItems.length"
            :position="menuPosition"
            horizontalAlign="end"
            :items="localeMenuItems"
            anchorToTrigger
            @close="closeMenu"
        />
    </div>
</template>

<style scoped>
.foxhole-title-locale {
    position: relative;
    display: flex;
    align-items: stretch;
}

.foxhole-title-locale__flag {
    font-size: 16px;
}
</style>
