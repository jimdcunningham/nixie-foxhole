import { createSpatialModelExporter } from './spatial-model-engine.mjs';
let exporter;
const stop = () => { exporter?.cancel(); process.exit(1); };
process.on('disconnect', stop);
process.on('SIGTERM', stop);
process.on('message', async message => {
    try {
        if (message.kind === 'initialize') {
            exporter = await createSpatialModelExporter({ ...message.options, onProgress: event => process.send({ kind: 'phase', ...event }) });
            process.send({ kind: 'ready' });
        } else if (message.kind === 'asset' && exporter) {
            const result = await exporter.exportAsset(message.id);
            process.send({ kind: 'result', id: message.id, result });
        } else throw Error('Invalid 3D worker request');
    } catch (error) { process.send?.({ kind: 'fatal', error: error.stack ?? String(error) }); }
});
