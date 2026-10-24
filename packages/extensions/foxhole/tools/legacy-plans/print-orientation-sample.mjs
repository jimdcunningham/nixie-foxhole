import fs from 'node:fs';

const src = fs.readFileSync(
    new URL('../../app/plugins/foxhole/legacy/plan-orientation-map.ts', import.meta.url),
    'utf8',
);
const socketSrc = fs.readFileSync(
    new URL('../../../../../extensions/foxhole-planner/src/legacy-plan-socket-id-map.ts', import.meta.url),
    'utf8',
);

function snippet(source, key) {
    const marker = `"${key}":`;
    const i = source.indexOf(marker);
    if (i < 0) {
        return 'MISSING';
    }
    return source.slice(i, i + 280).replace(/\s+/g, ' ');
}

for (const key of [
    'fortt1',
    'fortt2',
    'fortt3',
    'facilitysilooil',
    'facilityrefinery1',
    'facilitypipe',
    'foundation01t1',
]) {
    console.log('ORIENT', snippet(src, key));
    console.log('SOCKET', snippet(socketSrc, key));
}
