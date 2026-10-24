import { FOXHOLE_LEGACY_CONNECTOR_RENDER_LANE, foxholeRenderLane, resolveFoxholeConnectorRenderLane } from './render-lanes.ts';
import { resolveFoxholePowerlineStroke } from './powerline-stroke.ts';
import type {
    NixieExtensionGraphicsCommandV1,
    NixieExtensionRenderGraphicsV1,
} from '@nixiejs/extension-sdk/experimental/scene-v2';

export interface FoxholeSceneV2ConnectorData {
    foxholeKey: string;
    points: number[];
}

const DEFAULT_CONNECTOR_STROKE_COLOR = 0xD9F6FF;
const DEFAULT_CONNECTOR_HANDLE_COLOR = 0x5BC0FF;

function connectorPathCommands(data: FoxholeSceneV2ConnectorData): NixieExtensionGraphicsCommandV1[] {
    const commands: NixieExtensionGraphicsCommandV1[] = [
        { op: 'move-to', x: data.points[0]!, y: data.points[1]! },
    ];
    for (let index = 2; index < data.points.length; index += 2) {
        commands.push({ op: 'line-to', x: data.points[index]!, y: data.points[index + 1]! });
    }
    commands.push({
        op: 'stroke',
        alpha: 1,
        cap: 'round',
        join: 'round',
        ...(data.foxholeKey === 'powerline' ? resolveFoxholePowerlineStroke() : { color: DEFAULT_CONNECTOR_STROKE_COLOR, width: 6 }),
    });
    return commands;
}

function connectorHandleCommands(data: FoxholeSceneV2ConnectorData): NixieExtensionGraphicsCommandV1[] {
    if (data.foxholeKey === 'powerline') {
        return [];
    }
    const commands: NixieExtensionGraphicsCommandV1[] = [];
    for (let index = 0; index < data.points.length; index += 2) {
        commands.push(
            { op: 'circle', x: data.points[index]!, y: data.points[index + 1]!, radius: 7 },
            { op: 'fill', color: DEFAULT_CONNECTOR_HANDLE_COLOR, alpha: 0.95 },
        );
    }
    return commands;
}

export function renderFoxholeSceneV2Connector(
    data: FoxholeSceneV2ConnectorData,
): NixieExtensionRenderGraphicsV1[] {
    return [{
        id: 'connector-line',
        kind: 'graphics',
        ...foxholeRenderLane(resolveFoxholeConnectorRenderLane(data.foxholeKey, FOXHOLE_LEGACY_CONNECTOR_RENDER_LANE)),
        commands: connectorPathCommands(data),
    }, {
        id: 'connector-handles',
        kind: 'graphics',
        experimentalPresentation: { contractVersion: 1, selectionOnly: true, excludeFromBounds: true },
        laneId: 'details',
        commands: connectorHandleCommands(data),
    }];
}
