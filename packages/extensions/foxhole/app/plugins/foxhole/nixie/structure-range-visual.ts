import * as PIXI from 'pixi.js';
import type { FoxholeManifestRange } from './manifest.ts';
import { getFoxholeRangeColor } from './range-settings.ts';
import { createFoxholeNightRangePolygon } from './night-ranges.ts';

export const RANGE_OVERLAY_FILL_ALPHA = 0.15;
export const RANGE_OVERLAY_STROKE_ALPHA = 0.72;
export const RANGE_OVERLAY_STROKE_WIDTH = 3;
export const RANGE_OVERLAY_PIXELS_PER_METER = 32;
const RANGE_LABEL_OFFSET = 10;
const RANGE_LABEL_MIN_DISTANCE = 18;

export function formatFoxholeComponentDebugLabel(value: string): string {
    const trimmedValue = value.trim();
    if (!trimmedValue) {
        return value;
    }

    const namespaceIndex = trimmedValue.lastIndexOf(':');
    const withoutNamespace = namespaceIndex >= 0
        ? trimmedValue.slice(namespaceIndex + 1)
        : trimmedValue;
    const withoutBlueprintSuffix = withoutNamespace.replace(/_C$/i, '');
    const withoutComponentSuffix = withoutBlueprintSuffix.replace(/Component$/i, '');
    const withoutGeneratedSuffix = withoutComponentSuffix.replace(/_GEN_VARIABLE$/i, '');
    const withSpaces = withoutGeneratedSuffix
        .replace(/_/g, ' ')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .trim();
    return withSpaces || withoutGeneratedSuffix || withoutComponentSuffix || withoutBlueprintSuffix || withoutNamespace;
}

export function toFoxholeRangePosition(value: number | null | undefined): number {
    const normalized = Number(value ?? 0);
    return Number.isFinite(normalized) ? normalized * RANGE_OVERLAY_PIXELS_PER_METER : 0;
}

export function toFoxholeRangeDistance(value: number | null | undefined): number | null {
    const normalized = Number(value ?? NaN);
    return Number.isFinite(normalized) ? normalized * RANGE_OVERLAY_PIXELS_PER_METER : null;
}

function drawRangeArc(
    graphics: PIXI.Graphics,
    centerX: number,
    centerY: number,
    rotationRadians: number,
    halfArcRadians: number,
    innerRadius: number | null,
    outerRadius: number,
    color: number,
    strokeAlignment = 0.5,
    renderFill = true,
    renderStroke = true,
): void {
    if ((halfArcRadians * 2) >= ((Math.PI * 2) - 0.0001)) {
        drawRangeCircle(graphics, centerX, centerY, innerRadius, outerRadius, color, strokeAlignment, renderFill, renderStroke);
        return;
    }

    const start = rotationRadians - halfArcRadians;
    const end = rotationRadians + halfArcRadians;

    if (innerRadius && innerRadius > 0) {
        graphics.arc(centerX, centerY, innerRadius, end, start, true);
    } else {
        graphics.moveTo(centerX, centerY);
    }

    graphics.arc(centerX, centerY, outerRadius, start, end);
    if (innerRadius && innerRadius > 0) {
        graphics.closePath();
    } else {
        graphics.lineTo(centerX, centerY);
    }

    if (renderFill) {
        graphics.fill({ color, alpha: RANGE_OVERLAY_FILL_ALPHA });
    }
    if (renderStroke) {
        graphics.stroke({ color, alpha: RANGE_OVERLAY_STROKE_ALPHA, width: RANGE_OVERLAY_STROKE_WIDTH, alignment: strokeAlignment });
    }
}

function drawRangeCircle(
    graphics: PIXI.Graphics,
    centerX: number,
    centerY: number,
    innerRadius: number | null,
    outerRadius: number,
    color: number,
    strokeAlignment = 0.5,
    renderFill = true,
    renderStroke = true,
): void {
    if (innerRadius && innerRadius > 0) {
        graphics.circle(centerX, centerY, outerRadius);
        if (renderFill) {
            graphics.fill({ color, alpha: RANGE_OVERLAY_FILL_ALPHA });
        }
        graphics.circle(centerX, centerY, innerRadius);
        graphics.cut();
        if (renderStroke) {
            graphics.circle(centerX, centerY, outerRadius);
            graphics.stroke({ color, alpha: RANGE_OVERLAY_STROKE_ALPHA, width: RANGE_OVERLAY_STROKE_WIDTH, alignment: strokeAlignment });
            graphics.circle(centerX, centerY, innerRadius);
            graphics.stroke({ color, alpha: RANGE_OVERLAY_STROKE_ALPHA, width: RANGE_OVERLAY_STROKE_WIDTH, alignment: strokeAlignment });
        }
        return;
    }

    graphics.circle(centerX, centerY, outerRadius);
    if (renderFill) {
        graphics.fill({ color, alpha: RANGE_OVERLAY_FILL_ALPHA });
    }
    if (renderStroke) {
        graphics.stroke({ color, alpha: RANGE_OVERLAY_STROKE_ALPHA, width: RANGE_OVERLAY_STROKE_WIDTH, alignment: strokeAlignment });
    }
}

function getRangeDebugLabel(range: FoxholeManifestRange): string {
    const codeName = formatFoxholeComponentDebugLabel(String(range.codeName ?? '').trim());
    const rangeType = formatFoxholeComponentDebugLabel(String(range.type ?? '').trim());
    if (codeName && rangeType) {
        return `${codeName} (${rangeType})`;
    }

    return codeName || rangeType || 'Range';
}

function getRangeLabelPosition(
    range: FoxholeManifestRange,
    centerX: number,
    centerY: number,
    minRadius: number | null,
    maxRadius: number | null,
    overlapRadius: number | null,
    reachRadius: number | null,
): { x: number; y: number; anchorX: number; anchorY: number; } {
    const arcDegrees = Number(range.arc ?? NaN);
    if (Number.isFinite(arcDegrees) && arcDegrees > 0) {
        const rotationRadians = (Number(range.rotation ?? 0) * Math.PI) / 180;
        const labelDistance = Math.max(
            RANGE_LABEL_MIN_DISTANCE,
            maxRadius ?? minRadius ?? overlapRadius ?? reachRadius ?? 0,
        );
        const directionX = Math.cos(rotationRadians);
        const directionY = Math.sin(rotationRadians);

        return {
            x: centerX + (directionX * (labelDistance + RANGE_LABEL_OFFSET)),
            y: centerY + (directionY * (labelDistance + RANGE_LABEL_OFFSET)),
            anchorX: directionX >= 0 ? 0 : 1,
            anchorY: 0.5,
        };
    }

    const outerRadius = Math.max(maxRadius ?? 0, overlapRadius ?? 0, reachRadius ?? 0, RANGE_LABEL_MIN_DISTANCE);
    return {
        x: centerX,
        y: centerY - outerRadius - RANGE_LABEL_OFFSET,
        anchorX: 0.5,
        anchorY: 1,
    };
}

export function createFoxholeStructureRangeVisual(range: FoxholeManifestRange, lineOfSight = false, nightVisionRadius: number | null = null): { visual: PIXI.Container; strokeVisual: PIXI.Graphics | null; label: PIXI.Text | null; } | null {
    const nightPolygon = createFoxholeNightRangePolygon(range, nightVisionRadius);
    if (nightPolygon?.length === 0) return null;
    const color = getFoxholeRangeColor(range.type);
    const strokeAlignment = lineOfSight ? 1 : 0.5;
    const centerX = toFoxholeRangePosition(range.x);
    const centerY = toFoxholeRangePosition(range.y);
    const minRadius = toFoxholeRangeDistance(range.min);
    const maxRadius = toFoxholeRangeDistance(range.max);
    const overlapRadius = toFoxholeRangeDistance(range.overlap);
    const reachRadius = toFoxholeRangeDistance(range.reach);
    const container = new PIXI.Container();
    container.eventMode = 'none';
    const fillGraphics = new PIXI.Graphics();
    fillGraphics.eventMode = 'none';
    const strokeGraphics = new PIXI.Graphics();
    strokeGraphics.eventMode = 'none';
    let hasGeometry = false;

    const hasCircleRange = Boolean(maxRadius && maxRadius > 0);
    if (nightPolygon) {
        const points = nightPolygon.map(value => value * RANGE_OVERLAY_PIXELS_PER_METER);
        fillGraphics.poly(points, true).fill({ color, alpha: RANGE_OVERLAY_FILL_ALPHA });
        strokeGraphics.poly(points, true).stroke({ color, alpha: RANGE_OVERLAY_STROKE_ALPHA, width: RANGE_OVERLAY_STROKE_WIDTH, alignment: strokeAlignment });
        hasGeometry = true;
    } else if (hasCircleRange) {
        const arcDegrees = Number(range.arc ?? NaN);
        const hasArc = Number.isFinite(arcDegrees) && arcDegrees > 0;
        if (hasArc) {
            const rotationRadians = (Number(range.rotation ?? 0) * Math.PI) / 180;
            drawRangeArc(
                fillGraphics,
                centerX,
                centerY,
                rotationRadians,
                (arcDegrees * Math.PI) / 180,
                minRadius,
                maxRadius!,
                color,
                strokeAlignment,
                true,
                false,
            );
            drawRangeArc(
                strokeGraphics,
                centerX,
                centerY,
                rotationRadians,
                (arcDegrees * Math.PI) / 180,
                minRadius,
                maxRadius!,
                color,
                strokeAlignment,
                false,
                true,
            );
        } else {
            drawRangeCircle(fillGraphics, centerX, centerY, minRadius, maxRadius!, color, strokeAlignment, true, false);
            drawRangeCircle(strokeGraphics, centerX, centerY, minRadius, maxRadius!, color, strokeAlignment, false, true);
        }
        hasGeometry = true;
    }

    if (overlapRadius && overlapRadius > 0) {
        strokeGraphics.circle(centerX, centerY, overlapRadius);
        strokeGraphics.stroke({ color, alpha: RANGE_OVERLAY_STROKE_ALPHA, width: RANGE_OVERLAY_STROKE_WIDTH, alignment: strokeAlignment });
        hasGeometry = true;
    }

    if (!hasCircleRange && overlapRadius && overlapRadius > 0) {
        container.addChild(strokeGraphics);
        return { visual: container, strokeVisual: strokeGraphics, label: null };
    }

    if (reachRadius && maxRadius && reachRadius > maxRadius) {
        strokeGraphics.circle(centerX, centerY, ((maxRadius + reachRadius) / 2));
        strokeGraphics.stroke({
            color,
            alpha: RANGE_OVERLAY_FILL_ALPHA,
            width: Math.max(1, reachRadius - maxRadius),
            alignment: strokeAlignment,
        });
        hasGeometry = true;
    }

    if (!hasGeometry) {
        return null;
    }

    container.addChild(fillGraphics, strokeGraphics);

    const labelPosition = getRangeLabelPosition(range, centerX, centerY, minRadius, maxRadius, overlapRadius, reachRadius);
    const label = new PIXI.Text({
        text: getRangeDebugLabel(range),
        style: {
            fontFamily: 'monospace',
            fontWeight: '700',
            fontSize: 11,
            fill: color,
        },
    });
    label.eventMode = 'none';
    label.anchor.set(labelPosition.anchorX, labelPosition.anchorY);
    label.position.set(labelPosition.x, labelPosition.y);
    label.visible = false;
    container.addChild(label);

    return { visual: container, strokeVisual: strokeGraphics, label };
}
