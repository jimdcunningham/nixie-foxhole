import { getFoxholeLegacyStructureCatalog } from '#foxhole/plugins/foxhole/nixie/legacy-asset-catalog.ts';
import { defineContribution } from '#nixie/plugins/nixie/registry/index.ts';
import { FoxholeConnectorNode } from '#foxhole/plugins/nixie/board/types/foxhole-connector.ts';
import { foxholeConnectorStateSchema } from '#foxhole/plugins/foxhole/nixie/connector-schema.ts';
import { FOXHOLE_CONNECTOR_NODE_TYPE } from '#foxhole/plugins/foxhole/nixie/connector.ts';
import { remapFoxholeConnectorSnapshotCloneReferences } from '#foxhole/plugins/foxhole/nixie/snapshot-clone-references.ts';
import { getFoxholeSnapshotDependencies } from '#foxhole/plugins/foxhole/nixie/snapshot-dependencies.ts';

const getStructureCatalog = getFoxholeLegacyStructureCatalog;

export default defineContribution({
    nodes: [
        {
            type: FOXHOLE_CONNECTOR_NODE_TYPE,
            name: 'Foxhole Connector',
            description: 'A Foxhole-local editable connector path for spline-backed assets like Power Line.',
            icon: 'ph:bezier-curve',
            capabilities: {
                move: true,
                rotate: true,
                scale: false,
                tint: false,
            },
        },
    ],
    boardNodes: [
        {
            type: FOXHOLE_CONNECTOR_NODE_TYPE,
            stateSchema: foxholeConnectorStateSchema,
            getSnapshotDependencies: snapshot => getFoxholeSnapshotDependencies(snapshot, getStructureCatalog()),
            remapCloneReferences: (snapshot, { idMap }) => remapFoxholeConnectorSnapshotCloneReferences(snapshot, idMap),
            create: (snapshot, context) => new FoxholeConnectorNode({
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
