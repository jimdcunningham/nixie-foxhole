import foxholeChatMapContribution from '#foxhole/plugins/nixie/contributions/foxhole/chat-map.contrib.ts';
import foxholeConnectorsContribution from '#foxhole/plugins/nixie/contributions/foxhole/connectors.contrib.ts';
import foxholeSplineConnectorsContribution from '#foxhole/plugins/nixie/contributions/foxhole/spline-connectors.contrib.ts';
import foxholeDebugContribution from '#foxhole/plugins/nixie/contributions/foxhole/debug.contrib.ts';
import foxholeMapContribution from '#foxhole/plugins/nixie/contributions/foxhole/map.contrib.ts';
import foxholeAssistantToolsContribution from '#foxhole/plugins/nixie/contributions/foxhole/assistant-tools.contrib.ts';
import { FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS } from '#foxhole/plugins/foxhole/nixie/contribution-source-ids.ts';
import foxholeBinocularLinesContribution from '#foxhole/plugins/nixie/contributions/foxhole/binocular-lines.contrib.ts';
import foxholeTriangulationContribution from '#foxhole/plugins/nixie/contributions/foxhole/triangulation.contrib.ts';
import foxholeRangeContribution from '#foxhole/plugins/nixie/contributions/foxhole/range.contrib.ts';
import foxholeStructuresContribution from '#foxhole/plugins/nixie/contributions/foxhole/structures.contrib.ts';
import foxholeTacticalLinesContribution from '#foxhole/plugins/nixie/contributions/foxhole/tactical-lines.contrib.ts';
import foxholeSettingsPageSectionsContribution from '#foxhole/plugins/nixie/contributions/foxhole/settings-page-sections.contrib.ts';
import foxholeComponentExamplesContribution from '#foxhole/plugins/nixie/contributions/foxhole/component-examples.contrib.ts';
import foxholeToolbarContribution from '#foxhole/plugins/nixie/contributions/foxhole/toolbar.contrib.ts';

import foxholeSceneFactionContribution from '#foxhole/plugins/nixie/contributions/foxhole/scene-faction.contrib.ts';

export const foxholeNixieContributionEntries = [
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.sceneFaction,
        contribution: foxholeSceneFactionContribution,
    },
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.settingsPageSections,
        contribution: foxholeSettingsPageSectionsContribution,
    },
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.componentExamples,
        contribution: foxholeComponentExamplesContribution,
    },
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.toolbar,
        contribution: foxholeToolbarContribution,
    },
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.debug,
        contribution: foxholeDebugContribution,
    },
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.chatMap,
        contribution: foxholeChatMapContribution,
    },
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.map,
        contribution: foxholeMapContribution,
    },
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.assistantTools,
        contribution: foxholeAssistantToolsContribution,
    },
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.structures,
        contribution: foxholeStructuresContribution,
    },
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.tacticalLines,
        contribution: foxholeTacticalLinesContribution,
    },
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.binocularLines,
        contribution: foxholeBinocularLinesContribution,
    },
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.ranges,
        contribution: foxholeRangeContribution,
    },
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.triangulation,
        contribution: foxholeTriangulationContribution,
    },
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.connectors,
        contribution: foxholeConnectorsContribution,
    },
    {
        sourceId: FOXHOLE_NIXIE_CONTRIBUTION_SOURCE_IDS.splineConnectors,
        contribution: foxholeSplineConnectorsContribution,
    },
] as const;
