export interface FoxholeStructureFloorMaskPoint {
    x: number;
    y: number;
}

export function createFoxholeCornerWallMaskPoints(
    codeName: string | null | undefined,
    layer: { id: string; width: number; height: number; offsetX: number; offsetY: number; },
    footprintSize: number,
    occupiedSocketTags: ReadonlySet<string>,
): FoxholeStructureFloorMaskPoint[] {
    if (isFoxholeTrenchEmplacementCodeName(codeName)) {
        return createFoxholeTrenchEmplacementMaskPoints(codeName, layer, footprintSize, 'walls', occupiedSocketTags);
    }
    if (String(codeName ?? '').toLowerCase() !== 'fortcornert3' || !/^wallangle[12]$/i.test(layer.id) || !occupiedSocketTags.has('angle')) {
        return [];
    }
    // T3 short-wall textures include their end caps. Trim only the occupied
    // diagonal half-plane, retaining the exterior portion of the short wall.
    const plane = footprintSize * (1 - 1 / Math.SQRT2);
    const corners = [
        { x: layer.offsetX - layer.width / 2, y: layer.offsetY - layer.height / 2 },
        { x: layer.offsetX + layer.width / 2, y: layer.offsetY - layer.height / 2 },
        { x: layer.offsetX + layer.width / 2, y: layer.offsetY + layer.height / 2 },
        { x: layer.offsetX - layer.width / 2, y: layer.offsetY + layer.height / 2 },
    ];
    const points: FoxholeStructureFloorMaskPoint[] = [];
    for (let index = 0; index < corners.length; index++) {
        const start = corners[index]!;
        const end = corners[(index + 1) % corners.length]!;
        const startDistance = start.x + start.y - plane;
        const endDistance = end.x + end.y - plane;
        if (startDistance <= 0) {
            points.push(start);
        }
        if ((startDistance <= 0) !== (endDistance <= 0)) {
            const t = startDistance / (startDistance - endDistance);
            points.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
        }
    }
    return points;
}

export function createFoxholeStructureFloorMaskPoints(
    codeName: string | null | undefined,
    floor: { width: number; height: number; offsetX: number; offsetY: number; },
    footprintSize = 320,
    occupiedSocketTags: ReadonlySet<string> = new Set(),
): FoxholeStructureFloorMaskPoint[] {
    const id = String(codeName ?? '').trim().toLowerCase();
    if (/^trenchintt[123]$/.test(id) && Number.isFinite(footprintSize) && footprintSize > 0) {
        // The walls enclose 3 m, but the authored sockets sit on a 5 m square.
        // Keep the floor tucked under solid walls and reveal only joined approaches.
        const core = footprintSize * 0.3;
        const socket = footprintSize / 2;
        const back = occupiedSocketTags.has('back') ? socket : core;
        const front = occupiedSocketTags.has('front') ? socket : core;
        const left = occupiedSocketTags.has('left') ? socket : core;
        const right = occupiedSocketTags.has('right') ? socket : core;
        const outline = [
            { x: -core, y: -left }, { x: core, y: -left }, { x: core, y: -core },
            { x: front, y: -core }, { x: front, y: core }, { x: core, y: core },
            { x: core, y: right }, { x: -core, y: right }, { x: -core, y: core },
            { x: -back, y: core }, { x: -back, y: -core }, { x: -core, y: -core },
        ];
        return outline.filter((point, index) => {
            const previous = outline[(index + outline.length - 1) % outline.length]!;
            return point.x !== previous.x || point.y !== previous.y;
        });
    }
    // Fixed floor footprints are baked into their FoxWatch textures. Only an
    // occupied angled corner still needs a scene-dependent tighter cut.
    if (/^fortcornert[123]$/.test(id) && occupiedSocketTags.has('angle')) {
        const half = footprintSize / 2;
        const diagonalEnd = half - footprintSize / Math.SQRT2;
        return [
            { x: -half, y: -half }, { x: half, y: -half },
            { x: half, y: diagonalEnd }, { x: diagonalEnd, y: half },
            { x: -half, y: half },
        ];
    }
    return isFoxholeTrenchEmplacementCodeName(id)
        ? createFoxholeTrenchEmplacementMaskPoints(id, floor, footprintSize, 'floor', occupiedSocketTags)
        : [];
}

/** Clip baked emplacement parts to the authored wall faces, in root coordinates. */
export function createFoxholeTrenchEmplacementMaskPoints(
    codeName: string | null | undefined,
    _surface: { width: number; height: number; offsetX: number; offsetY: number; },
    footprintSize: number,
    part: 'floor' | 'walls',
    occupiedSocketTags: ReadonlySet<string> = new Set(),
): FoxholeStructureFloorMaskPoint[] {
    const id = String(codeName ?? '').trim().toLowerCase();
    const profiles: Record<string, { floor: number; walls: number; }> = {
        trenchempt1: { floor: 0.42, walls: 0.445 },
        trenchempt2: { floor: 0.435, walls: 0.47 },
        trenchempt3: { floor: 0.47, walls: 0.53 },
    };
    const profile = profiles[id];
    if (!profile || !Number.isFinite(footprintSize) || footprintSize <= 0) {
        return [];
    }
    // Emplacements span two standard 5 m footprints. The side planes follow
    // their 4.2 m wall centers and tier-specific wall thickness, not texture padding.
    const diameter = footprintSize * 2;
    const directions = ['front', 'frontright', 'right', 'backright', 'back', 'backleft', 'left', 'frontleft'];
    const limit = diameter * profile[part];
    const halfApproach = diameter * (part === 'floor' ? 0.15 : 0.175);
    const halfSide = limit * Math.tan(Math.PI / 8);
    const points: FoxholeStructureFloorMaskPoint[] = [];
    for (const [index, direction] of directions.entries()) {
        const angle = index * Math.PI / 4;
        const normalX = Math.cos(angle), normalY = Math.sin(angle);
        const point = (distance: number, tangent: number) => ({
            x: normalX * distance - normalY * tangent,
            y: normalY * distance + normalX * tangent,
        });
        points.push(point(limit, -halfSide));
        if (occupiedSocketTags.has(direction) && footprintSize > limit) {
            // Reveal only the 3 m passage (plus its side walls), not the entire
            // neighboring face. These strips do not overlap outside the octagon.
            points.push(point(limit, -halfApproach), point(footprintSize, -halfApproach),
                point(footprintSize, halfApproach), point(limit, halfApproach));
        }
        points.push(point(limit, halfSide));
    }
    return points.filter((point, index) => {
        const previous = points[(index + points.length - 1) % points.length]!;
        return Math.hypot(point.x - previous.x, point.y - previous.y) > 1e-6;
    });
}

/** Convex pieces keep clipped texture meshes and stencil masks geometrically identical. */
export function createFoxholeTrenchEmplacementMaskPolygons(
    codeName: string | null | undefined,
    surface: { width: number; height: number; offsetX: number; offsetY: number; },
    footprintSize: number,
    part: 'floor' | 'walls',
    occupiedSocketTags: ReadonlySet<string>,
): FoxholeStructureFloorMaskPoint[][] {
    const core = createFoxholeTrenchEmplacementMaskPoints(codeName, surface, footprintSize, part);
    if (!core.length) {
        return [];
    }
    const limit = Math.max(...core.map(point => point.x));
    const halfApproach = footprintSize * (part === 'floor' ? 0.3 : 0.35);
    const polygons = [core];
    const directions = ['front', 'frontright', 'right', 'backright', 'back', 'backleft', 'left', 'frontleft'];
    if (footprintSize > limit) {
        for (const [index, direction] of directions.entries()) {
            if (!occupiedSocketTags.has(direction)) {
                continue;
            }
            const angle = index * Math.PI / 4;
            const normalX = Math.cos(angle), normalY = Math.sin(angle);
            polygons.push([[limit, -halfApproach], [footprintSize, -halfApproach],
                [footprintSize, halfApproach], [limit, halfApproach]].map(([distance, tangent]) => ({
                x: normalX * distance! - normalY * tangent!, y: normalY * distance! + normalX * tangent!,
            })));
        }
    }
    const planes = [
        [1, 0, surface.offsetX + surface.width / 2], [-1, 0, -surface.offsetX + surface.width / 2],
        [0, 1, surface.offsetY + surface.height / 2], [0, -1, -surface.offsetY + surface.height / 2],
    ];
    return polygons.map(polygon => {
        let points = polygon;
        for (const [normalX, normalY, boundary] of planes) {
            const clipped: FoxholeStructureFloorMaskPoint[] = [];
            for (let edge = 0; edge < points.length; edge++) {
                const start = points[edge]!, end = points[(edge + 1) % points.length]!;
                const a = start.x * normalX! + start.y * normalY! - boundary!;
                const b = end.x * normalX! + end.y * normalY! - boundary!;
                if (a <= 0) {
                    clipped.push(start);
                }
                if ((a <= 0) !== (b <= 0)) {
                    const t = a / (a - b);
                    clipped.push({ x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t });
                }
            }
            points = clipped;
        }
        return points;
    }).filter(points => points.length >= 3);
}

export function isFoxholeTrenchEmplacementCodeName(
    codeName: string | null | undefined,
): boolean {
    return /^trenchempt[123]$/i.test(String(codeName ?? '').trim());
}

export function createFoxholeFlatTopOctagonPoints(
    diameter: number,
    centerX = 0,
    centerY = 0,
): FoxholeStructureFloorMaskPoint[] {
    if (!Number.isFinite(diameter) || diameter <= 0) {
        return [];
    }

    const radius = diameter / 2;
    const cornerOffset = Math.PI / 8;
    return Array.from({ length: 8 }, (_, index) => {
        const angle = cornerOffset + (index * Math.PI) / 4;
        return {
            x: centerX + Math.cos(angle) * radius,
            y: centerY + Math.sin(angle) * radius,
        };
    });
}
