import type {
    NixieCommandDefinition,
    NixieSettingDefinition,
    NixieSettingsPageSection,
    NixieSettingsPageSectionContribution,
} from '#nixie/plugins/nixie/registry/types.ts';

export const FOXHOLE_MAP_SETTINGS_PAGE_SECTION = {
    id: 'foxhole-map',
    title: 'Foxhole Map',
    summary: 'Foxhole world map source selection and crop stored with the active project.',
    icon: 'ph:map-trifold',
    order: 200,
} satisfies NixieSettingsPageSectionContribution;

export const FOXHOLE_MAP_VIEW_SETTINGS_PAGE_SECTION = {
    id: 'foxhole-map-view',
    title: 'Foxhole Map View',
    summary: 'Foxhole world map viewer preferences that follow you across all projects.',
    icon: 'ph:map-pin-area',
    order: 210,
} satisfies NixieSettingsPageSectionContribution;

export const FOXHOLE_RANGES_SETTINGS_PAGE_SECTION = {
    id: 'foxhole-ranges',
    title: 'Foxhole Ranges',
    summary: 'Foxhole range overlay visibility preferences that follow you across all projects.',
    icon: 'ph:crosshair',
    order: 220,
} satisfies NixieSettingsPageSectionContribution;

export const FOXHOLE_BROWSER_SETTINGS_PAGE_SECTION = {
    id: 'foxhole-browser',
    editorGroupId: 'assets',
    title: 'Foxhole Browser',
    summary: 'Foxhole asset browser filters, icon preferences, and language that follow you.',
    icon: 'ph:binoculars',
    order: 230,
} satisfies NixieSettingsPageSectionContribution;

export const FOXHOLE_DEBUG_SETTINGS_PAGE_SECTION = {
    id: 'foxhole-debug',
    title: 'Foxhole Debug',
    summary: 'Foxhole structure diagnostics and overlay preferences for this editor.',
    icon: 'ph:bug',
    order: 240,
} satisfies NixieSettingsPageSectionContribution;

export const FOXHOLE_STATS_SETTINGS_PAGE_SECTION = {
    id: 'foxhole-stats',
    title: 'Foxhole Statistics',
    summary: 'Foxhole construction statistics scope and time-interval preferences that follow you.',
    icon: 'ph:chart-bar',
    order: 235,
} satisfies NixieSettingsPageSectionContribution;

export const FOXHOLE_COMMANDS_SETTINGS_PAGE_SECTION = {
    id: 'foxhole',
    title: 'Foxhole Commands',
    summary: 'Foxhole-specific commands and their bindings, separated from core editor actions.',
    icon: 'ph:crosshair',
    order: 100,
    surface: 'commands',
} satisfies NixieSettingsPageSectionContribution;

export const FOXHOLE_SETTINGS_PAGE_SECTIONS = [
    FOXHOLE_MAP_SETTINGS_PAGE_SECTION,
    FOXHOLE_MAP_VIEW_SETTINGS_PAGE_SECTION,
    FOXHOLE_RANGES_SETTINGS_PAGE_SECTION,
    FOXHOLE_BROWSER_SETTINGS_PAGE_SECTION,
    FOXHOLE_STATS_SETTINGS_PAGE_SECTION,
    FOXHOLE_DEBUG_SETTINGS_PAGE_SECTION,
    FOXHOLE_COMMANDS_SETTINGS_PAGE_SECTION,
] as const satisfies readonly NixieSettingsPageSectionContribution[];

export function withSettingsPageSection<TDefinition extends NixieSettingDefinition>(
    definitions: readonly TDefinition[],
    section: Pick<NixieSettingsPageSection, 'id'> | string,
): readonly TDefinition[] {
    const settingsPageSectionId = typeof section === 'string' ? section.trim() : String(section.id ?? '').trim();
    return definitions.map(definition => ({
        ...definition,
        settingsPageSectionId,
    })) as readonly TDefinition[];
}

export function withDevSettingsAccess<TDefinition extends NixieSettingDefinition>(
    definitions: readonly TDefinition[],
): readonly (TDefinition & { accessibleInDev: true; })[] {
    return definitions.map(definition => ({
        ...definition,
        accessibleInDev: true as const,
    }));
}

export function withCommandSettingsPageSection<TCommand extends NixieCommandDefinition>(
    commands: readonly TCommand[],
    section: Pick<NixieSettingsPageSection, 'id'> | string,
): readonly TCommand[] {
    const settingsPageSectionId = typeof section === 'string' ? section.trim() : String(section.id ?? '').trim();
    return commands.map(command => ({
        ...command,
        settingsPageSectionId,
    })) as readonly TCommand[];
}
