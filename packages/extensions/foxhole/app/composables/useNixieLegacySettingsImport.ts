import { getFoxholeManifest } from '../plugins/foxhole/nixie/manifest.ts';
import { computed, ref, shallowRef, watch } from 'vue';
import { useSupabaseUser } from '#imports';
import { useNixieRegistry } from '#nixie/composables/useNixieRegistry.ts';
import { useNixieSettingsStore } from '#nixie/stores/settings.ts';
import type { NixieUserSettings } from '#nixie/stores/settings.ts';
import { ensureNixieExtensionContributions, getNixieExtension } from '#nixie/plugins/nixie/extensions/index.ts';
import {
    LEGACY_SETTINGS_MAX_BYTES,
    buildLegacySettingsPatch,
    buildLegacySettingsUndo,
    createLegacySettingsAssetIndex,
    parseLegacySettings,
} from '../utils/nixie-legacy-settings.ts';
import type { LegacySettingsReport } from '../utils/nixie-legacy-settings.ts';

export function useNixieLegacySettingsImport() {
    const store = useNixieSettingsStore();
    const registry = useNixieRegistry();
    const user = useSupabaseUser();
    const owner = computed(() => user.value?.sub ?? null);
    const pending = ref(false);
    const report = shallowRef<LegacySettingsReport | null>(null);
    const filename = ref('');
    const error = ref('');
    const message = ref('');
    const preferences = ref(true);
    const toolbelts = ref(true);
    const recovery = shallowRef<{
        before: NixieUserSettings;
        applied: ReturnType<typeof buildLegacySettingsPatch>;
    } | null>(null);
    const selectedCount = computed(() => {
        if (!report.value) {
            return 0;
        }
        return report.value.changes.filter(change => (change.paletteKey || change.source === 'showToolbelt') ? toolbelts.value : preferences.value).length
            + (toolbelts.value ? report.value.slots.length : 0);
    });

    watch(owner, () => {
        report.value = null;
        recovery.value = null;
        filename.value = '';
        error.value = '';
        message.value = '';
    });

    function assertReady(): void {
        if (!store.getPaletteStorageContext().ready) {
            throw new Error('Wait for your account settings to finish loading, then try again.');
        }
    }

    function cancelReview(): void {
        if (pending.value) {
            return;
        }
        report.value = null;
        filename.value = '';
        error.value = '';
    }

    async function readFile(file: File): Promise<void> {
        if (pending.value) {
            return;
        }
        pending.value = true;
        error.value = '';
        message.value = '';
        report.value = null;
        const expectedOwner = owner.value;
        try {
            assertReady();
            if (file.size > LEGACY_SETTINGS_MAX_BYTES) {
                throw new Error('Choose a settings JSON file smaller than 5 MB.');
            }
            const text = await file.text();
            // Validate before loading the optional catalog or touching preferences.
            parseLegacySettings(text, []);
            if (getNixieExtension('foxhole')) {
                await ensureNixieExtensionContributions(['foxhole']);
            }
            if (owner.value !== expectedOwner) {
                throw new Error('Your account changed. Choose the file again.');
            }
            const manifest = getFoxholeManifest('/foxhole/assets/');
            const mapped = parseLegacySettings(text, createLegacySettingsAssetIndex(manifest.assets,
                manifest.localizations.find(bundle => bundle.locale === 'en')?.strings));
            // Missing extension definitions are reported, never retained as arbitrary overrides.
            mapped.changes = mapped.changes.filter(change => {
                if (!change.settingId) {
                    return true;
                }
                const definition = registry.getSettingDefinition(change.settingId);
                if (definition?.scope === 'user' && store.canAccessSetting(definition)) {
                    return true;
                }
                mapped.skipped.push({ source: change.source, reason: 'This preference is unavailable in this Nixie installation.' });
                return false;
            });
            preferences.value = true;
            toolbelts.value = true;
            filename.value = file.name;
            report.value = mapped;
        } catch (cause) {
            error.value = cause instanceof Error ? cause.message : 'Unable to read this settings file.';
        } finally {
            pending.value = false;
        }
    }

    function apply(): void {
        if (pending.value || !report.value || !selectedCount.value) {
            return;
        }
        error.value = '';
        try {
            assertReady();
            const before = store.snapshot();
            for (const change of report.value.changes) {
                if (change.settingId && !Object.hasOwn(before.values, change.settingId)) {
                    before.values[change.settingId] = store.getValue(change.settingId);
                }
            }
            const applied = buildLegacySettingsPatch(before, report.value, preferences.value, toolbelts.value);
            store.patch(applied);
            recovery.value = { before, applied };
            message.value = `Applied ${selectedCount.value} mapped preferences and slots. You can undo this import until the next import or until Nixie closes.`;
            report.value = null;
        } catch (cause) {
            error.value = cause instanceof Error ? cause.message : 'Unable to apply these settings.';
        }
    }

    function undo(): void {
        if (pending.value || !recovery.value) {
            return;
        }
        error.value = '';
        try {
            assertReady();
            store.patch(buildLegacySettingsUndo(store.snapshot(), recovery.value.before, recovery.value.applied));
            recovery.value = null;
            report.value = null;
            message.value = 'Import undone. Preferences and slots you changed afterwards were kept.';
        } catch (cause) {
            error.value = cause instanceof Error ? cause.message : 'Unable to undo this import.';
        }
    }

    function currentValue(change: LegacySettingsReport['changes'][number]): unknown {
        return change.settingId ? store.getValue(change.settingId) : store.snapshot()[change.paletteKey!];
    }

    function currentSlotLabel(row: number, slot: number): string {
        const snapshot = store.snapshot();
        const binding = snapshot.paletteRows[row]?.[slot];
        if (!binding) {
            return 'Empty';
        }
        if ('label' in binding) {
            return binding.label;
        }
        const tool = registry.getAllTools().find(entry => entry.metadata.id === binding.toolId);
        if (binding.kind === 'preset') {
            const preset = snapshot.toolPresets[binding.toolId]?.find(entry => entry.id === binding.presetId);
            return preset?.name ?? 'Unavailable preset';
        }
        return tool?.metadata.name ?? 'Unavailable tool';
    }

    return { pending, report, filename, error, message, preferences, toolbelts, recovery, selectedCount, readFile, cancelReview, apply, undo, currentValue, currentSlotLabel };
}
