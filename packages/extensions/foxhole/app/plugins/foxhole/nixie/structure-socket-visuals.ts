import * as PIXI from 'pixi.js';
import { NX_BOOTSTRAP_LIGHTNING_SVG } from '#nixie/utils/nx-bootstrap-lightning.ts';
import type { FoxholeManifestBuildSocket } from './manifest.ts';
import {
    hasFoxholeLiquidPipeSocketTag,
    hasFoxholePowerSocketTag,
    normalizeFoxholeSocketTags,
} from './structure-socket-snapping.ts';
import type { FoxholeSocketTagBitfield } from './structure-socket-snapping.ts';
import { FOXHOLE_UPRIGHT_OVERLAY_LABEL } from './upright-overlay-sync.ts';

/** Legacy Foxhole planner palette — flat fills, no outlines. */
export const FOXHOLE_POWER_SOCKET_COLOR = 0xFFD800;
export const FOXHOLE_PIPE_INPUT_SOCKET_COLOR = 0xFF2A2A;
export const FOXHOLE_PIPE_OUTPUT_SOCKET_COLOR = 0x3DDC4E;
export const FOXHOLE_PIPE_BIDIRECTIONAL_SOCKET_COLOR = 0x3D8BFF;
export const FOXHOLE_GENERIC_SOCKET_COLOR = 0xC77DFF;

const LEGACY_ICON_COLOR = 0xFFFFFF;

/** Socket +X axis points outward from the structure attachment. */
const POWER_SQUARE_SIZE = 9;
const PIPE_INDICATOR_GAP = 4;
const POWER_BOLT_SIZE = 22;
const POWER_BOLT_OFFSET_Y = -(
    (POWER_SQUARE_SIZE / 2)
    + PIPE_INDICATOR_GAP
    + (POWER_BOLT_SIZE / 2)
);

const PIPE_CAP_HALF_THICKNESS = 2.5;
const PIPE_CAP_THICKNESS = PIPE_CAP_HALF_THICKNESS * 2;
const PIPE_CAP_HALF_WIDTH = 13;
const PIPE_ARROW_HEAD_LENGTH = 10;
const PIPE_ARROW_HALF_WIDTH = 7;
const PIPE_BIDI_SPAN = 32;
const PIPE_SINGLE_ARROW_SPAN = 22;
const PIPE_BIDI_LINE_WIDTH = 5;

export const FOXHOLE_SOCKET_STEM_LENGTH = 28;
export const FOXHOLE_SOCKET_LABEL_DISTANCE = FOXHOLE_SOCKET_STEM_LENGTH + 8;
export const FOXHOLE_SOCKET_LABEL_LATERAL_OFFSET = 10;

export const FOXHOLE_SOCKET_LABEL_STYLE = {
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '700' as const,
    fill: 0xFFFFFF,
    stroke: {
        color: 0x081018,
        width: 3,
        join: 'round' as const,
    },
};

export type FoxholeStructureSocketKind = 'power' | 'pipe' | 'generic';
export type FoxholePipeSocketFlow = 'input' | 'output' | 'bidirectional';

export interface FoxholeSocketVisualPlacement {
    localX: number;
    localY: number;
    rotationRadians: number;
    label?: string;
    /** Ancestor node rotation (e.g. structure rotation) to counter for screen-upright overlays. */
    ancestorRotationRadians?: number;
}

export interface FoxholeSocketVisualSource {
    name?: string;
    componentType?: string;
    pipeType?: string | null;
    socketTags?: readonly FoxholeSocketTagBitfield[];
}

export function resolveFoxholeSocketOverlayOccupancyKeys(options: {
    liveAttachmentPreviewActive: boolean;
    localAttachmentKeys: ReadonlySet<string>;
    sceneOccupancyKeys: ReadonlySet<string>;
}): ReadonlySet<string> {
    return options.liveAttachmentPreviewActive
        ? options.localAttachmentKeys
        : options.sceneOccupancyKeys;
}

export function resolveFoxholePipeSocketFlow(pipeType?: string | null): FoxholePipeSocketFlow {
    const normalized = String(pipeType ?? '').trim().toLowerCase();
    if (normalized === 'output') {
        return 'output';
    }
    if (normalized === 'input') {
        return 'input';
    }
    return 'bidirectional';
}

export function resolveFoxholePipeSocketColor(flow: FoxholePipeSocketFlow): number {
    switch (flow) {
        case 'output':
            return FOXHOLE_PIPE_OUTPUT_SOCKET_COLOR;
        case 'input':
            return FOXHOLE_PIPE_INPUT_SOCKET_COLOR;
        default:
            return FOXHOLE_PIPE_BIDIRECTIONAL_SOCKET_COLOR;
    }
}

export function resolveFoxholeSocketKind(source: FoxholeSocketVisualSource): FoxholeStructureSocketKind {
    const name = String(source.name ?? '').trim();
    const componentType = String(source.componentType ?? '').trim();
    const socketTags = source.socketTags ?? [];

    if (
        name.includes('PowerSocket')
        || componentType.includes('Power')
        || hasFoxholePowerSocketTag(socketTags)
    ) {
        return 'power';
    }

    if (
        String(source.pipeType ?? '').trim()
        || /Pipe(?:Input|Output)/i.test(name)
        || componentType.includes('Pipeline')
        || hasFoxholeLiquidPipeSocketTag(socketTags)
    ) {
        return 'pipe';
    }

    return 'generic';
}

export function resolveFoxholeSocketKindFromBuildSocket(socket: FoxholeManifestBuildSocket): FoxholeStructureSocketKind {
    return resolveFoxholeSocketKind({
        name: socket.name,
        componentType: socket.componentType,
        pipeType: socket.pipeType,
        socketTags: normalizeFoxholeSocketTags(socket.socketTags),
    });
}

function buildSocketVisualContainer(placement: FoxholeSocketVisualPlacement): PIXI.Container {
    const container = new PIXI.Container();
    container.eventMode = 'none';
    container.position.set(placement.localX, placement.localY);
    container.rotation = placement.rotationRadians;
    return container;
}

function fillRect(graphics: PIXI.Graphics, x: number, y: number, width: number, height: number, color: number): void {
    graphics.rect(x, y, width, height);
    graphics.fill({ color, alpha: 1 });
}

function drawArrowHead(graphics: PIXI.Graphics, tipX: number, direction: 1 | -1): void {
    const baseX = tipX - (direction * PIPE_ARROW_HEAD_LENGTH);
    graphics.poly([
        tipX, 0,
        baseX, -PIPE_ARROW_HALF_WIDTH,
        baseX, PIPE_ARROW_HALF_WIDTH,
    ]);
    graphics.fill({ color: LEGACY_ICON_COLOR, alpha: 1 });
}

/** Bootstrap's filled lightning glyph, centered and screen-upright. */
function drawBootstrapLightningBolt(graphics: PIXI.Graphics, centerX: number, centerY: number): void {
    graphics.svg(NX_BOOTSTRAP_LIGHTNING_SVG);
    graphics.scale.set(POWER_BOLT_SIZE / 16);
    graphics.position.set(
        centerX - (POWER_BOLT_SIZE / 2),
        centerY - (POWER_BOLT_SIZE / 2),
    );
}

/** Pipe cap flush to attachment, extending outward along +X. */
function drawLegacyPipeCap(graphics: PIXI.Graphics, color: number): number {
    fillRect(
        graphics,
        0,
        -PIPE_CAP_HALF_WIDTH,
        PIPE_CAP_THICKNESS,
        PIPE_CAP_HALF_WIDTH * 2,
        color,
    );
    return PIPE_CAP_THICKNESS;
}

function drawLegacyPipeFlowArrows(graphics: PIXI.Graphics, flow: FoxholePipeSocketFlow, capOuterEdge: number): void {
    const span = flow === 'bidirectional' ? PIPE_BIDI_SPAN : PIPE_SINGLE_ARROW_SPAN;
    const leftTip = capOuterEdge + PIPE_INDICATOR_GAP;
    const rightTip = leftTip + span;
    const leftBase = leftTip + PIPE_ARROW_HEAD_LENGTH;
    const rightBase = rightTip - PIPE_ARROW_HEAD_LENGTH;

    let lineStart = leftBase;
    let lineEnd = rightBase;
    if (flow === 'output') {
        lineStart = leftTip;
    } else if (flow === 'input') {
        lineEnd = rightTip;
    }

    graphics.moveTo(lineStart, 0);
    graphics.lineTo(lineEnd, 0);
    graphics.stroke({
        color: LEGACY_ICON_COLOR,
        alpha: 1,
        width: PIPE_BIDI_LINE_WIDTH,
        cap: 'butt',
        join: 'miter',
    });

    if (flow === 'output') {
        drawArrowHead(graphics, rightTip, 1);
        return;
    }

    if (flow === 'input') {
        drawArrowHead(graphics, leftTip, -1);
        return;
    }

    drawArrowHead(graphics, leftTip, -1);
    drawArrowHead(graphics, rightTip, 1);
}

export function createFoxholePowerSocketVisual(placement: FoxholeSocketVisualPlacement): PIXI.Container {
    const container = buildSocketVisualContainer(placement);
    const squareGraphics = new PIXI.Graphics();
    squareGraphics.eventMode = 'none';

    const half = POWER_SQUARE_SIZE / 2;
    fillRect(squareGraphics, -half, -half, POWER_SQUARE_SIZE, POWER_SQUARE_SIZE, FOXHOLE_POWER_SOCKET_COLOR);
    container.addChild(squareGraphics);

    const boltContainer = new PIXI.Container();
    boltContainer.label = FOXHOLE_UPRIGHT_OVERLAY_LABEL;
    boltContainer.eventMode = 'none';
    boltContainer.rotation = -(placement.rotationRadians + (placement.ancestorRotationRadians ?? 0));
    const boltGraphics = new PIXI.Graphics();
    boltGraphics.eventMode = 'none';
    drawBootstrapLightningBolt(boltGraphics, 0, POWER_BOLT_OFFSET_Y);
    boltContainer.addChild(boltGraphics);
    container.addChild(boltContainer);

    if (placement.label) {
        container.addChild(createFoxholeSocketLabel(placement.label, FOXHOLE_POWER_SOCKET_COLOR, placement.rotationRadians));
    }

    return container;
}

export function createFoxholePipeSocketVisual(
    placement: FoxholeSocketVisualPlacement,
    pipeType?: string | null,
): PIXI.Container {
    const flow = resolveFoxholePipeSocketFlow(pipeType);
    const color = resolveFoxholePipeSocketColor(flow);
    const container = buildSocketVisualContainer(placement);
    const graphics = new PIXI.Graphics();
    graphics.eventMode = 'none';

    const capOuterEdge = drawLegacyPipeCap(graphics, color);
    drawLegacyPipeFlowArrows(graphics, flow, capOuterEdge);
    container.addChild(graphics);

    if (placement.label) {
        container.addChild(createFoxholeSocketLabel(placement.label, color, placement.rotationRadians));
    }

    return container;
}

export function createFoxholeSocketLabel(
    text: string,
    color: number,
    rotationRadians: number,
): PIXI.Text {
    const label = new PIXI.Text({
        text,
        style: {
            ...FOXHOLE_SOCKET_LABEL_STYLE,
            fill: color,
        },
    });
    label.eventMode = 'none';
    const directionX = Math.cos(rotationRadians);
    const directionY = Math.sin(rotationRadians);
    const side = directionX >= 0 ? 1 : -1;

    label.anchor.set(side > 0 ? 0 : 1, 0.5);
    label.position.set(
        (directionX * FOXHOLE_SOCKET_LABEL_DISTANCE) + (side * 6),
        (directionY * FOXHOLE_SOCKET_LABEL_DISTANCE) - FOXHOLE_SOCKET_LABEL_LATERAL_OFFSET,
    );
    label.rotation = -rotationRadians;
    return label;
}
