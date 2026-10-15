import type { Viewport } from 'pixi-viewport';
import {
    FOXHOLE_MAP_REGIONS,
    FOXHOLE_REGION_HEIGHT,
    FOXHOLE_REGION_WIDTH,
    getFoxholeRegionPosition,
} from '../map/constants.ts';
import type {
    NixieProjectChatCustomSegment,
    NixieProjectChatMessageSegmentMatch,
    NixieProjectChatMessageSegmentParser,
} from '#nixie/utils/nixie-project-chat.ts';

const FOXHOLE_GRID_CELL_SIZE = 125 * 32;
const FOXHOLE_GRID_SUBCELL_SIZE = FOXHOLE_GRID_CELL_SIZE / 3;

export const FOXHOLE_CHAT_MAP_GRID_RENDERER_ID = 'foxhole.chat.map-grid';

export interface FoxholeChatMapGridReference {
    raw: string;
    label: string;
    regionKey: string;
    regionName: string;
    column: string;
    row: number;
    quadrant: number;
    worldPosition: {
        x: number;
        y: number;
    };
}

export interface FoxholeChatMapGridSegment extends NixieProjectChatCustomSegment {
    rendererId: typeof FOXHOLE_CHAT_MAP_GRID_RENDERER_ID;
    data: {
        reference: FoxholeChatMapGridReference;
    };
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeRegionName(value: string): string {
    return String(value ?? '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function createRegionNamePattern(value: string): string {
    return escapeRegex(value).replace(/\s+/g, '\\s+');
}

const foxholeRegionsByName = new Map(
    FOXHOLE_MAP_REGIONS.map(region => [normalizeRegionName(region.name), region] as const),
);

const foxholeRegionNamePattern = FOXHOLE_MAP_REGIONS
    .map(region => createRegionNamePattern(region.name))
    .sort((left, right) => right.length - left.length)
    .join('|');

function createAnchoredFoxholeChatMapGridPattern(): RegExp {
    return new RegExp(`^(${foxholeRegionNamePattern})\\s*-\\s*([A-Qa-q])(1[0-5]|[1-9])[Kk]([1-9])$`, 'i');
}

function createFoxholeChatMapGridSearchPattern(): RegExp {
    return new RegExp(`(${foxholeRegionNamePattern})\\s*-\\s*([A-Qa-q])(1[0-5]|[1-9])[Kk]([1-9])`, 'gi');
}

function resolveFoxholeChatMapGridReference(
    regionName: string,
    columnValue: string,
    rowValue: number,
    quadrantValue: number,
    raw: string,
): FoxholeChatMapGridReference | null {
    const region = foxholeRegionsByName.get(normalizeRegionName(regionName));
    if (!region) {
        return null;
    }

    const column = String(columnValue ?? '').trim().charAt(0).toUpperCase();
    const row = Number(rowValue);
    const quadrant = Number(quadrantValue);
    const columnIndex = column.charCodeAt(0) - 65;
    if (columnIndex < 0 || columnIndex >= 17 || row < 1 || row > 15 || quadrant < 1 || quadrant > 9) {
        return null;
    }

    const rowIndex = row - 1;
    const quadrantIndex = quadrant - 1;
    const subColumnIndex = quadrantIndex % 3;
    const subRowIndex = 2 - Math.floor(quadrantIndex / 3);
    const regionPosition = getFoxholeRegionPosition(region);
    const regionLeft = regionPosition.x - (FOXHOLE_REGION_WIDTH / 2);
    const regionTop = regionPosition.y - (FOXHOLE_REGION_HEIGHT / 2);

    return {
        raw: String(raw ?? '').trim() || `${region.name}-${column}${row}k${quadrant}`,
        label: `${region.name}-${column}${row}k${quadrant}`,
        regionKey: region.key,
        regionName: region.name,
        column,
        row,
        quadrant,
        worldPosition: {
            x: regionLeft + (columnIndex * FOXHOLE_GRID_CELL_SIZE) + (subColumnIndex * FOXHOLE_GRID_SUBCELL_SIZE) + (FOXHOLE_GRID_SUBCELL_SIZE / 2),
            y: regionTop + (rowIndex * FOXHOLE_GRID_CELL_SIZE) + (subRowIndex * FOXHOLE_GRID_SUBCELL_SIZE) + (FOXHOLE_GRID_SUBCELL_SIZE / 2),
        },
    };
}

export function parseFoxholeChatMapGridReference(value: string): FoxholeChatMapGridReference | null {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        return null;
    }

    const match = createAnchoredFoxholeChatMapGridPattern().exec(normalized);
    if (!match) {
        return null;
    }

    return resolveFoxholeChatMapGridReference(
        match[1],
        match[2],
        Number(match[3]),
        Number(match[4]),
        normalized,
    );
}

export function isFoxholeChatMapGridSegment(value: unknown): value is FoxholeChatMapGridSegment {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const segment = value as Partial<FoxholeChatMapGridSegment>;
    return segment.type === 'custom'
        && segment.rendererId === FOXHOLE_CHAT_MAP_GRID_RENDERER_ID
        && Boolean(segment.data)
        && typeof segment.data === 'object'
        && 'reference' in segment.data;
}

export function getFoxholeChatMapGridCameraTarget(
    reference: FoxholeChatMapGridReference,
    viewport: Pick<Viewport, 'screenWidth' | 'screenHeight'>,
): {
    position: {
        x: number;
        y: number;
    };
    scale: number;
} {
    const availableWidth = Math.max(1, viewport.screenWidth - 192);
    const availableHeight = Math.max(1, viewport.screenHeight - 192);
    const focusBounds = {
        width: FOXHOLE_GRID_CELL_SIZE * 0.75,
        height: FOXHOLE_GRID_CELL_SIZE * 0.75,
    };

    return {
        position: reference.worldPosition,
        scale: Math.min(
            availableWidth / focusBounds.width,
            availableHeight / focusBounds.height,
        ),
    };
}

export const FOXHOLE_CHAT_MAP_GRID_SEGMENT_PARSER: NixieProjectChatMessageSegmentParser = {
    id: 'foxhole.chat.map-grid',
    order: 125,
    parse(message: string, startIndex: number): NixieProjectChatMessageSegmentMatch | null {
        const pattern = createFoxholeChatMapGridSearchPattern();
        pattern.lastIndex = startIndex;

        const match = pattern.exec(message);
        const raw = match?.[0] ?? '';
        const matchIndex = match?.index ?? -1;
        if (!raw || matchIndex < startIndex) {
            return null;
        }

        const reference = resolveFoxholeChatMapGridReference(
            match[1],
            match[2],
            Number(match[3]),
            Number(match[4]),
            raw,
        );
        if (!reference) {
            return null;
        }

        return {
            index: matchIndex,
            length: raw.length,
            segment: {
                type: 'custom',
                rendererId: FOXHOLE_CHAT_MAP_GRID_RENDERER_ID,
                text: reference.raw,
                data: {
                    reference,
                },
            },
        };
    },
};
