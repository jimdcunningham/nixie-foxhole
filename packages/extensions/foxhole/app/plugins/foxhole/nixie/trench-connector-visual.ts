import { Container, Mesh, MeshGeometry, Texture } from 'pixi.js';
import { trenchLayerQuad, trenchConnectorCorners } from './trench-connector.ts';
import type { TrenchEndpoint, TrenchLayerFrame } from './trench-connector.ts';
import { centeredPolygonUvs, trenchWallPieces, trenchFloorPolygon, pieceFrame, polygonCentroid } from './trench-connector-pieces.ts';
import type { TrenchPiece } from './trench-connector-pieces.ts';
import { loadFoxholeContactShadowProjection } from './contact-shadow.ts';
import type { FoxholeContactShadowProjection } from './contact-shadow.ts';
import { trenchContactShadow } from './trench-connector-shadow.ts';
import { FOXHOLE_STRUCTURE_RENDER_LANES } from './render-lanes.ts';
import { trenchConcreteFloorInterior, TRENCH_CONCRETE_FLOOR_INSET } from './trench-floor-texture.ts';
import { destroyedTrenchConnectorPieces } from '../../../../../../../extensions/foxhole-planner/src/destroyed-trench-connector.ts';

interface TrenchRenderLayer extends TrenchLayerFrame { textureUrl: string; }

const T3_CONNECTOR_DETAIL_LANE = {
    laneId: 'foxhole:connector:concrete-wall-detail',
    laneOrder: 55,
    label: 'Concrete connector details above trench corner trim',
};
const T3_CONNECTOR_SEAM_LANE = {
    laneId: 'foxhole:connector:concrete-seam',
    laneOrder: 56,
    label: 'Concrete seam blocks above wall details',
};

interface TrenchVisualOptions {
    start: TrenchEndpoint;
    end: TrenchEndpoint;
    layers: readonly TrenchRenderLayer[];
    floor?: TrenchRenderLayer;
    modifications?: readonly TrenchPiece[];
    startConnected?: boolean;
    endConnected?: boolean;
    alpha: number;
    tint: number;
    contactShadows?: boolean;
    destroyedTier?: number;
}

/** Small batched quads, updated in place. No render textures, stencil masks, or ticker. */
export class TrenchConnectorVisual extends Container {
    private pieces = new Map<string, { mesh: Mesh; url: string; baseAlpha: number }>();
    private roofHoverAlpha = 1;
    private readonly loadTexture: (url: string) => Promise<Texture | null | undefined>;
    private projections = new Map<string, FoxholeContactShadowProjection | null>();
    private latestOptions?: TrenchVisualOptions;
    private readonly loadProjection: typeof loadFoxholeContactShadowProjection;

    constructor(loadTexture: (url: string) => Promise<Texture | null | undefined>,
        loadProjection = loadFoxholeContactShadowProjection) {
        super();
        this.loadTexture = loadTexture;
        this.loadProjection = loadProjection;
        this.eventMode = 'none';
    }

    /** Refresh attachment previews without replacing the current drag geometry or transform. */
    syncOccupancy(startConnected: boolean, endConnected: boolean): void {
        const options = this.latestOptions;
        if (!options || (Boolean(options.startConnected) === startConnected && Boolean(options.endConnected) === endConnected)) return;
        this.sync({ ...options, startConnected, endConnected });
    }

    /** Keep the roof fade independent of floors, walls, side mods and geometry rebuilds. */
    setRoofHoverAlpha(alpha: number): void {
        this.roofHoverAlpha = Math.max(0, Math.min(1, alpha));
        for (const [id, piece] of this.pieces) {
            if (id.includes('Roof')) {
                piece.mesh.alpha = piece.baseAlpha * this.roofHoverAlpha;
            }
        }
    }

    sync(options: TrenchVisualOptions): void {
        this.latestOptions = options;
        const { start, end } = options;
        const wanted = new Set<string>();
        const hiddenEnd = (id: string) => /^(?:wall|dirt|corner)back/.test(id) && options.startConnected
            || /^(?:wall|dirt|corner)front/.test(id) && options.endConnected;
        const update = (layer: Pick<TrenchRenderLayer, 'id' | 'textureUrl'> & Partial<TrenchRenderLayer>, positions: number[], uvs = [0, 0, 1, 0, 1, 1, 0, 1], opacity = 1) => {
            if (positions.length < 6) return;
            wanted.add(layer.id);
            let piece = this.pieces.get(layer.id);
            if (piece && piece.url !== layer.textureUrl) {
                piece.mesh.geometry.destroy();
                piece.mesh.destroy();
                this.pieces.delete(layer.id);
                piece = undefined;
            }
            if (!piece) {
                const mesh = new Mesh({ geometry: new MeshGeometry({
                    positions: new Float32Array(positions.length),
                    uvs: new Float32Array(uvs.length),
                    indices: new Uint32Array(fanIndices(positions.length / 2)),
                }), texture: Texture.EMPTY });
                mesh.eventMode = 'none';
                piece = { mesh, url: layer.textureUrl, baseAlpha: 1 };
                this.pieces.set(layer.id, piece);
                this.addChild(mesh);
                // A drag does not invalidate this request; a removed/replaced piece does.
                void this.loadTexture(layer.textureUrl).then(texture => {
                    if (!mesh.destroyed && texture && !texture.destroyed) mesh.texture = layer.id === 'floor' && layer.textureUrl.includes('/trencht3/')
                        ? trenchConcreteFloorInterior(texture) : texture;
                });
            }
            const mesh = piece.mesh;
            const geometry = mesh.geometry as MeshGeometry;
            if (geometry.positions.length !== positions.length) {
                geometry.positions = new Float32Array(positions);
                geometry.uvs = new Float32Array(uvs);
                geometry.indices = new Uint32Array(fanIndices(positions.length / 2));
            } else {
                geometry.positions.set(positions);
                geometry.uvs.set(uvs);
            }
            geometry.getBuffer('aPosition').update();
            geometry.getBuffer('aUV').update();
            piece.baseAlpha = options.alpha * opacity;
            mesh.alpha = piece.baseAlpha * (layer.id.includes('Roof') ? this.roofHoverAlpha : 1);
            mesh.tint = options.tint;
            mesh.visible = !hiddenEnd(layer.id);
            this.setChildIndex(mesh, wanted.size - 1);
        };

        if (options.floor && !options.destroyedTier) {
            const polygon = trenchFloorPolygon(start, end, options.layers, options.startConnected, options.endConnected);
            const inset = options.floor.textureUrl.includes('/trencht3/') ? TRENCH_CONCRETE_FLOOR_INSET : { x: 0, y: 0 };
            // Socket occupancy clips the floor, but must not move its texture origin.
            const textureCenter = polygonCentroid(trenchConnectorCorners(start, end));
            update(options.floor, polygon.flatMap(p => [p.x, p.y]), centeredPolygonUvs(polygon,
                Math.max(1, (options.floor.width ?? 640) / 2 - inset.x), Math.max(1, (options.floor.height ?? 640) / 2 - inset.y), Math.atan2(end.y - start.y, end.x - start.x), textureCenter));
        }
        const surfaces = options.destroyedTier
            ? destroyedTrenchConnectorPieces(options.destroyedTier, options.layers, start, end, options.startConnected, options.endConnected)
            : trenchWallPieces(options.layers, start, end, options.startConnected, options.endConnected);
        const showDirt = Boolean(pieceFrame(options.layers, 'TrenchT3Short02'));
        // Dirt first, then covers, walls and rigid corner pieces.
        const rank = (id: string) => id.startsWith('dirt') ? 0 : id === 'floorsplineconnector' ? 1 : id.startsWith('wall') ? 2 : id.startsWith('visual') ? 3 : 4;
        for (const layer of [...options.layers].sort((a, b) => rank(a.id) - rank(b.id))) {
            if (options.destroyedTier) {
                break;
            }
            if (!showDirt && layer.id.startsWith('dirt')) continue;
            // Only endpoint-owned parts use socket-frame transforms. The side
            // strips and interval details above are native mesh instances.
            if (/^(?:wall|corner|dirt)/.test(layer.id) && /back|front/.test(layer.id)) surfaces.push({
                id: layer.id, textureUrl: layer.textureUrl, positions: trenchLayerQuad(layer, start, end), uvs: [0, 0, 1, 0, 1, 1, 0, 1], alpha: 1,
            });
        }
        if (!options.destroyedTier) {
            surfaces.push(...options.modifications ?? []);
        }
        const ground = (piece: TrenchPiece) => piece.id.startsWith('dirt') || piece.id.startsWith('floorcover')
            || Boolean(options.destroyedTier && (piece.id === 'floor' || piece.id.startsWith('visualdirt')));
        for (const piece of surfaces.filter(ground)) update(piece, piece.positions, piece.uvs, piece.alpha);
        const addShadow = (surface: TrenchPiece) => {
            if (options.contactShadows === false || ground(surface) || surface.id.includes(':panel')
                || hiddenEnd(surface.id)) return;
            if (!this.projections.has(surface.textureUrl)) {
                this.projections.set(surface.textureUrl, null);
                void this.loadProjection(surface.textureUrl).then(projection => {
                    if (this.destroyed) return;
                    this.projections.set(surface.textureUrl, projection);
                    if (projection && this.latestOptions) this.sync(this.latestOptions);
                }).catch(() => { /* Shadows are optional; the surface remains usable. */ });
            }
            const projection = this.projections.get(surface.textureUrl);
            const shadow = projection && trenchContactShadow(surface, projection);
            if (shadow) update(shadow, shadow.positions, shadow.uvs, shadow.alpha);
        };
        const roof = (piece: TrenchPiece) => piece.id.includes('Roof');
        for (const piece of surfaces.filter(piece => !roof(piece))) addShadow(piece);
        for (const piece of surfaces.filter(piece => !ground(piece) && !roof(piece))) update(piece, piece.positions, piece.uvs, piece.alpha);
        // Roof panels receive the trim/cap shadows above the trench interior.
        for (const piece of surfaces.filter(piece => roof(piece) && piece.id.includes(':panel'))) update(piece, piece.positions, piece.uvs, piece.alpha);
        for (const piece of surfaces.filter(roof)) addShadow(piece);
        for (const piece of surfaces.filter(piece => roof(piece) && !piece.id.includes(':panel'))) update(piece, piece.positions, piece.uvs, piece.alpha);
        const activeFamilies = new Set([...wanted].map(id => id.slice(0, id.lastIndexOf(':') + 1)));
        for (const [id, piece] of this.pieces) {
            if (!wanted.has(id)) {
                // Keep a bounded spare when a drag crosses an interval boundary.
                // Changing/removing a mod family still releases all its meshes.
                const family = id.slice(0, id.lastIndexOf(':') + 1);
                if (family && activeFamilies.has(family)) {
                    piece.mesh.visible = false;
                    continue;
                }
                piece.mesh.geometry.destroy();
                piece.mesh.destroy();
                this.pieces.delete(id);
            }
        }
    }

    override destroy(): void {
        for (const { mesh } of this.pieces.values()) {
            mesh.geometry.destroy();
            mesh.destroy();
        }
        this.pieces.clear();
        this.projections.clear();
        this.latestOptions = undefined;
        super.destroy();
    }

    containsLocalPoint(point: { x: number; y: number }): boolean {
        return [...this.pieces].some(([id, { mesh }]) => !id.startsWith('shadow:') && mesh.visible && mesh.containsPoint(point));
    }

    getSelectionMeshes(): Mesh[] {
        return [...this.pieces].filter(([id, { mesh }]) => !id.startsWith('shadow:') && mesh.visible).map(([, { mesh }]) => mesh);
    }

    getElevatedRenderPieces() {
        const detailLane = pieceFrame(this.latestOptions?.layers ?? [], 'TrenchT3Short02')
            ? T3_CONNECTOR_DETAIL_LANE : FOXHOLE_STRUCTURE_RENDER_LANES.corners;
        return [...this.pieces].flatMap(([id, { mesh }]) => {
            const surfaceId = id.replace(/^shadow:/, '');
            const lane = /roof/i.test(surfaceId) ? FOXHOLE_STRUCTURE_RENDER_LANES.upperModification
                // T3 dirtcorner assets are concrete seam blocks, not ground dirt.
                : detailLane === T3_CONNECTOR_DETAIL_LANE && surfaceId.startsWith('dirtcorner') ? T3_CONNECTOR_SEAM_LANE
                : /^(?:detail:|corner)/.test(surfaceId) ? detailLane : null;
            return lane ? [{ id, mesh, lane }] : [];
        }).sort((a, b) => this.getChildIndex(a.mesh) - this.getChildIndex(b.mesh));
    }
}

function fanIndices(count: number): number[] {
    return Array.from({ length: Math.max(0, count - 2) }, (_, i) => [0, i + 1, i + 2]).flat();
}
