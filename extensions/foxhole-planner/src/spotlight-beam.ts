import type { NixieExtensionGraphicsCommandV1 } from '@nixie/extension-sdk/experimental/scene-v2';

export interface FoxholeSpotlightBeam {
    planarProjectionScale: number;
    coneLength: number;
    baseOffsetPixels: number;
    baseHalfWidthPixels: number;
    outerConeAngleRadians: number;
    beamColorHex: string;
    beamStrength: number;
    innerConeAngleRadians?: number;
    lightFalloffExponent?: number;
    useInverseSquaredFalloff?: boolean;
}

export interface FoxholeAuthoredSpotlight {
    name?: string;
    x: number; y: number; z: number; rotation: number; planarProjectionScale: number;
    outerConeAngle: number; innerConeAngle: number; attenuationRadius: number;
    intensity?: number; lightColor?: string; sourceRadius?: number; softSourceRadius?: number; sourceLength?: number;
    lightFalloffExponent?: number; useInverseSquaredFalloff?: boolean;
}

/** Normalize both FoxWatch's full records and its compact published fields. */
export function readFoxholeAuthoredSpotlight(value: unknown): FoxholeAuthoredSpotlight | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    const number = (key: string, short = key, fallback?: number) => {
        const value = source[key] ?? source[short];
        return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    };
    const attenuationRadius = number('attenuationRadius', 'a');
    const outerConeAngle = number('outerConeAngle', 'o');
    if (!attenuationRadius || attenuationRadius <= 0 || !outerConeAngle || outerConeAngle <= 0) return null;
    const color = source.lightColor ?? source.lc;
    const name = source.name ?? source.n;
    const inverse = source.useInverseSquaredFalloff ?? source.isf;
    return { x: number('x', 'x', 0)!, y: number('y', 'y', 0)!, z: number('z', 'z', 0)!,
        rotation: number('rotation', 'r', 0)!, planarProjectionScale: number('planarProjectionScale', 'ps', 1)!,
        attenuationRadius, outerConeAngle, innerConeAngle: number('innerConeAngle', 'i', 0)!,
        intensity: number('intensity', 'v'), lightFalloffExponent: number('lightFalloffExponent', 'fe'),
        sourceRadius: number('sourceRadius', 'sr'), softSourceRadius: number('softSourceRadius', 'ssr'), sourceLength: number('sourceLength', 'sl'),
        ...(typeof color === 'string' ? { lightColor: color.replace(/^#/, '').slice(0, 6) } : {}),
        ...(typeof name === 'string' ? { name } : {}),
        ...(typeof inverse === 'boolean' ? { useInverseSquaredFalloff: inverse } : {}),
    };
}

type BeamCommand = Extract<NixieExtensionGraphicsCommandV1, { op: 'circle' | 'polygon' | 'fill' | 'fill-radial-gradient'; }>;
export interface FoxholeSpotlightBeamGraphic {
    id: string;
    kind: 'graphics';
    scaleY?: number;
    commands: BeamCommand[];
}

/** The vehicle headlight's cone, elliptical falloff and lens hotspot.
 * Compensating the beam's Y coordinates keeps its outline intact while a
 * scaleY transform gives the radial gradient its original elliptical shape.
 */
export function createFoxholeSpotlightBeamGraphics(spotlight: FoxholeSpotlightBeam): FoxholeSpotlightBeamGraphic[] {
    const color = /^[0-9a-f]{6}$/i.test(spotlight.beamColorHex) ? parseInt(spotlight.beamColorHex, 16) : 0xFFE3AC;
    const stop = (offset: number, alpha: number) => ({ offset, color, alpha });
    if (!Number.isFinite(spotlight.coneLength) || spotlight.planarProjectionScale <= 0.01 || spotlight.coneLength <= 0.01) {
        const coreRadius = Math.max(3, spotlight.baseHalfWidthPixels * 1.6);
        const radius = Math.max(22, spotlight.baseHalfWidthPixels * 16);
        return [{ id: 'light-glow', kind: 'graphics', commands: [
            { op: 'circle', x: 0, y: 0, radius: coreRadius },
            { op: 'fill', color, alpha: 0.18 + spotlight.beamStrength * 0.16 },
            { op: 'circle', x: 0, y: 0, radius },
            { op: 'fill-radial-gradient', center: { x: 0, y: 0 }, outerRadius: radius,
                colorStops: [stop(0, 0.22 + spotlight.beamStrength * 0.16), stop(0.4, 0.09 + spotlight.beamStrength * 0.08), stop(1, 0)] },
        ] }];
    }
    const halfAngle = spotlight.outerConeAngleRadians / 2;
    if (spotlight.lightFalloffExponent !== undefined && spotlight.useInverseSquaredFalloff === false) {
        // UE's non-inverse-square radial attenuation, with one continuous
        // beam. Elliptical falloff softens the penumbra without a second cone.
        const radius = spotlight.coneLength;
        const alpha = 0.045 + spotlight.beamStrength * 0.09;
        const exponent = Math.max(0.01, Math.min(64, spotlight.lightFalloffExponent));
        const gradient = (strength: number): BeamCommand => ({ op: 'fill-radial-gradient', center: { x: 0, y: 0 }, outerRadius: radius,
            // Values below one part per million are invisible in the preview;
            // quantization also keeps CSS-based host adapters out of exponent notation.
            colorStops: Array.from({ length: 17 }, (_, index) => stop(index / 16,
                Math.round(strength * Math.pow(Math.max(0, 1 - (index / 16) ** 2), exponent) * 1e6) / 1e6)) });
        const cone = (angle: number): BeamCommand => ({ op: 'polygon', close: true, points: [{ x: 0, y: 0 },
            ...Array.from({ length: 33 }, (_, index) => {
                const heading = -angle + angle * 2 * index / 32;
                return { x: Math.cos(heading) * radius, y: Math.sin(heading) * radius };
            })] });
        const inner = Math.max(0.0001, Math.min(halfAngle, (spotlight.innerConeAngleRadians ?? spotlight.outerConeAngleRadians) / 2));
        const scaleY = Math.max(0.1, Math.min(0.7, (Math.sin(halfAngle) + Math.sin(inner)) / 2));
        const shape = cone(halfAngle);
        if (shape.op !== 'polygon') return [];
        return [{ id: 'light-beam', kind: 'graphics', scaleY, commands: [
            { ...shape, points: shape.points.map(point => ({ x: point.x, y: point.y / scaleY })) }, gradient(alpha),
        ] }];
    }
    const axialLength = spotlight.coneLength + spotlight.baseOffsetPixels;
    const halfWidth = Math.tan(halfAngle) * axialLength;
    const arcRadius = axialLength / Math.cos(halfAngle);
    const beamRadius = Math.max(arcRadius, spotlight.coneLength, spotlight.baseHalfWidthPixels * 8);
    const beamScale = Math.max(0.18, Math.min(0.65, ((halfWidth / beamRadius) || 0) * 1.15));
    const beamAlpha = 0.045 + spotlight.beamStrength * 0.09;
    const hotspotAlpha = 0.04 + spotlight.beamStrength * 0.07;
    const hotspotX = Math.max(spotlight.baseHalfWidthPixels, 4);
    const points = [
        { x: 0, y: -spotlight.baseHalfWidthPixels },
        ...Array.from({ length: 25 }, (_, index) => {
            const angle = -halfAngle + halfAngle * 2 * index / 24;
            return { x: -spotlight.baseOffsetPixels + Math.cos(angle) * arcRadius, y: Math.sin(angle) * arcRadius };
        }),
        { x: 0, y: spotlight.baseHalfWidthPixels },
    ];
    return [
        { id: 'light-beam', kind: 'graphics', scaleY: beamScale, commands: [
            { op: 'polygon', points: points.map(point => ({ x: point.x, y: point.y / beamScale })), close: true },
            { op: 'fill-radial-gradient', center: { x: 0, y: 0 }, outerRadius: beamRadius,
                colorStops: [stop(0, beamAlpha), stop(0.42, beamAlpha * 0.34), stop(1, 0)] },
        ] },
        { id: 'light-hotspot', kind: 'graphics', commands: [
            { op: 'polygon', points, close: true },
            { op: 'fill-radial-gradient', center: { x: hotspotX, y: 0 },
                outerCenter: { x: hotspotX + Math.max(spotlight.baseOffsetPixels * 0.6, 6), y: 0 },
                outerRadius: Math.max(18, spotlight.baseOffsetPixels * 2.4, spotlight.baseHalfWidthPixels * 7),
                colorStops: [stop(0, hotspotAlpha), stop(0.5, hotspotAlpha * 0.45), stop(1, 0)] },
        ] },
    ];
}
