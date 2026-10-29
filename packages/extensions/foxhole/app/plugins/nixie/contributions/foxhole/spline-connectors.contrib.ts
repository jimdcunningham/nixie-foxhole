import { getFoxholeLegacyStructureCatalog } from '#foxhole/plugins/foxhole/nixie/legacy-asset-catalog.ts';
import { FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/spline-connector.ts';
import { foxholeSplineConnectorStateSchema } from '#foxhole/plugins/foxhole/nixie/spline-connector-schema.ts';
import { remapFoxholeConnectorSnapshotCloneReferences } from '#foxhole/plugins/foxhole/nixie/snapshot-clone-references.ts';
import { getFoxholeSnapshotDependencies } from '#foxhole/plugins/foxhole/nixie/snapshot-dependencies.ts';
import { FoxholeSplineConnectorNode } from '#foxhole/plugins/nixie/board/types/foxhole-spline-connector.ts';
import { defineContribution } from '#nixie/plugins/nixie/registry/index.ts';

const getStructureCatalog = getFoxholeLegacyStructureCatalog;

export default defineContribution({
    nodes: [
        {
            type: FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE,
            name: 'Foxhole Spline Connector',
            description: 'A Foxhole-local cubic-bezier connector for spline-backed assets like Facility Pipe.',
            icon: 'ph:bezier-curve',
            capabilities: {
                move: true,
                rotate: true,
                scale: false,
                tint: true,
            },
        },
    ],
    boardNodes: [
        {
            type: FOXHOLE_SPLINE_CONNECTOR_NODE_TYPE,
            stateSchema: foxholeSplineConnectorStateSchema,
            getSnapshotDependencies: snapshot => getFoxholeSnapshotDependencies(snapshot, getStructureCatalog()),
            remapCloneReferences: (snapshot, { idMap }) => remapFoxholeConnectorSnapshotCloneReferences(snapshot, idMap),
            create: (snapshot, context) => new FoxholeSplineConnectorNode({
                id: snapshot.id,
                type: snapshot.type,
                key: snapshot.key,
                version: snapshot.version,
                state: snapshot.state,
                historyRecorder: context.historyRecorder,
                syncAdapter: context.syncAdapter,
                definition: {
                    assetResolver: foxholeKey => getStructureCatalog().assetByKey[String(foxholeKey ?? '').trim()],
                    structureResolver: foxholeKey => getStructureCatalog().structureByKey[String(foxholeKey ?? '').trim()],
                },
            }),
        },
    ],
});
