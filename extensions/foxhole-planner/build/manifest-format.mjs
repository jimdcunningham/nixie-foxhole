import { readFile, writeFile } from 'node:fs/promises';
import { NIXIE_EXTENSION_PACKAGE_MAX_MANIFEST_BYTES } from '@nixiejs/extension-package';

const source = new URL('../nixie.extension.json', import.meta.url);

function formatManifest(value, depth = 0, maxDepth = 4) {
    if (depth === maxDepth || value === null || typeof value !== 'object') return JSON.stringify(value);
    const array = Array.isArray(value);
    const entries = Object.entries(value);
    if (!entries.length) return array ? '[]' : '{}';

    const indent = '  '.repeat(depth);
    const lines = entries.map(([key, entry]) => {
        const name = array ? '' : JSON.stringify(key) + ': ';
        // The packer also caps the source manifest. Keep each resource declaration on one line.
        const entryDepth = depth === 1 && key === 'resources' ? 3 : maxDepth;
        return indent + '  ' + name + formatManifest(entry, depth + 1, entryDepth);
    });
    return (array ? '[' : '{') + '\n' + lines.join(',\n') + '\n' + indent + (array ? ']' : '}');
}

const current = await readFile(source, 'utf8');
const formatted = formatManifest(JSON.parse(current)) + '\n';
const write = process.argv.includes('--write');
const actual = write ? formatted : current;
if (Buffer.byteLength(actual) > NIXIE_EXTENSION_PACKAGE_MAX_MANIFEST_BYTES) {
    console.error('nixie.extension.json exceeds the extension packer’s manifest size limit.');
    process.exitCode = 1;
} else if (current.replaceAll('\r\n', '\n') !== formatted) {
    if (write) {
        await writeFile(source, formatted);
    } else {
        console.error('nixie.extension.json needs formatting. Run npm run format:manifest.');
        process.exitCode = 1;
    }
}
